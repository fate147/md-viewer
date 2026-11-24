# -*- coding: utf-8 -*-
"""文件/标签/退出编排（actions）：App 委托的业务动作。

2026-10-11 重构：文本缓冲的权威在页面（CodeMirror 的 EditorState），
Python 侧只存元数据（core/session 铁律不变）。凡是要落盘/复制/导出，
都经 web.request_text 异步拉全文——回调由主线程轮询器分发，因此这里
大量出现「确认 → 拉文本 → 写盘 → 下一步」的回调链。
"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote, urlparse

from tkinter import filedialog, messagebox

from core import config as config_mod
from core import fileio, filetypes, session
from ui.web_client import file_url


# ================================================================ 文件

def open_file(app, path: str) -> None:
    """打开任意受支持类型（specs/10）：markdown / text / image / binary。"""
    path = str(path)
    p = Path(path)
    kind = filetypes.detect(p)
    text, enc, note = "", "utf-8", ""
    if kind == "ebook":
        # specs/10 R-10-08：电子书/RTF/ODT/FB2 抽取成 Markdown 再交给阅读层（只读）
        from core import ebook
        try:
            text = ebook.extract(path)
            enc = "utf-8"
        except ebook.EbookError as e:
            kind, note = "binary", str(e)
        except Exception as e:
            kind, note = "binary", f"解析失败：{e}"
    elif kind == "html":
        if not p.is_file():
            messagebox.showerror("错误", "文件不存在: " + path)
            return
    elif kind in ("markdown", "text"):
        try:
            text, enc = fileio.read(path)
        except ValueError:
            kind = "binary"          # 头部能解码、整篇解码失败 → 按二进制兜底
        except Exception as e:
            messagebox.showerror("错误", f"无法打开文件:\n{e}")
            return
    else:
        if not p.is_file():
            messagebox.showerror("错误", f"文件不存在:\n{path}")
            return

    tab = app.sess.open_tab(path, enc, kind)      # 已打开则激活
    if session.tab_key(tab) not in app._loaded:
        app._loaded.add(session.tab_key(tab))
        base = str(tab.path.parent) if tab.path else None
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        app.web.send_text(session.tab_key(tab), text, tab.name, base,
                          kind=kind, src=file_url(p), path=str(p), size=size,
                          note=note)
    _after_tab_switch(app, tab)


def open_dialog(app) -> None:
    path = filedialog.askopenfilename(
        title="选择文件",
        filetypes=[("Markdown 文件", "*.md *.markdown *.mdown"),
                   ("文本与代码", "*.txt *.log *.json *.yaml *.yml *.toml *.ini "
                                 "*.csv *.xml *.html *.css *.js *.ts *.py *.ps1 *.bat"),
                   ("图片", "*.png *.jpg *.jpeg *.gif *.webp *.bmp *.svg *.ico"),
                   ("所有文件", "*.*")])
    if path:
        open_file(app, path)


def new_tab(app) -> None:
    tab = app.sess.add_untitled()
    app._loaded.add(session.tab_key(tab))
    app.web.send_text(session.tab_key(tab), "", tab.name, None)
    _after_tab_switch(app, tab)


def save(app) -> None:
    tab = app.sess.active()
    if not tab:
        return
    if not filetypes.is_text_like(tab.kind):
        app.win.statusbar.set_temp("该文件类型不支持保存")
        return
    if not tab.path:
        save_as(app)
        return
    _pull_and_write(app, tab)


def save_as(app) -> None:
    tab = app.sess.active()
    if not tab:
        return
    if not filetypes.is_text_like(tab.kind):
        app.win.statusbar.set_temp("该文件类型不支持保存")
        return
    path = filedialog.asksaveasfilename(
        title="另存为", defaultextension=".md",
        filetypes=[("Markdown 文件", "*.md"), ("所有文件", "*.*")])
    if not path:
        return
    tab.path = Path(path)
    tab.encoding = "utf-8"
    _pull_and_write(app, tab)


def export_html(app) -> None:
    tab = app.sess.active()
    if not tab:
        return
    if not filetypes.is_text_like(tab.kind):
        app.win.statusbar.set_temp("该文件类型不支持导出")
        return
    path = filedialog.asksaveasfilename(
        title="导出 HTML", defaultextension=".html",
        filetypes=[("HTML 文件", "*.html"), ("所有文件", "*.*")])
    if not path:
        return

    def _got(text):
        if text is None:
            app.win.statusbar.set_temp("导出失败：内容取回失败")
            return
        try:
            from services import export
            export.to_html(text, app.theme_id, path)
        except Exception as e:
            messagebox.showerror("导出失败", f"{e}")
            return
        app.win.statusbar.set_temp(f"已导出: {path}")

    app.web.request_text(session.tab_key(tab), _got)


def _pull_and_write(app, tab: session.TabState) -> None:
    def _got(text):
        if text is None:
            app.win.statusbar.set_temp("保存失败：内容取回失败")
            return
        _write_file(app, tab, text)

    app.web.request_text(session.tab_key(tab), _got)


def _write_file(app, tab: session.TabState, text: str) -> None:
    try:
        fileio.write(tab.path, text, tab.encoding)
    except Exception as e:
        messagebox.showerror("保存失败", f"无法保存文件:\n{e}")
        return
    tab.dirty = False
    app.web.set_dirty(session.tab_key(tab), False)
    app.refresh_all()
    app.win.statusbar.set_temp(f"已保存: {tab.path.name}")


# ================================================================ 标签

def select_tab_by_id(app, tab_id: int) -> None:
    tab = app.tab_by_id(tab_id)
    if tab is None:
        return
    idx = app.sess.tabs.index(tab)
    app.sess.activate(idx)
    app.web.activate_tab(session.tab_key(tab))
    _after_tab_switch(app, tab)


def close_tab_by_id(app, tab_id: int, force: bool = False) -> None:
    tab = app.tab_by_id(tab_id)
    if tab is None:
        return
    idx = app.sess.tabs.index(tab)
    if tab.dirty and not force:
        r = messagebox.askyesnocancel(
            "未保存", f"「{tab.name}」有未保存的修改。\n关闭前是否保存？")
        if r is None:
            return
        if r:
            def _saved_then_close(text):
                if text is None:
                    return          # 取回失败宁可不动，避免丢内容
                _write_file(app, tab, text)
                close_tab_by_id(app, tab_id, force=True)
            app.web.request_text(session.tab_key(tab), _saved_then_close)
            return
        tab.dirty = False           # 用户选择不保存 → 丢弃
    _do_close(app, idx)


def _do_close(app, idx: int) -> None:
    """关闭标签（02 R-02-02 顺序，禁止颠倒）。

    ① 记下 tab_seq；
    ② 先把「新标签列表」推给 JS，令其按列表差集删除 state.docs[tab_seq]
       并清理缓冲 —— 此刻 Python 侧 session 尚未移除该标签；
    ③ 再 close_tab + _loaded.discard。

    反序（先 discard 再通知）会留下一个窗口期：Python 已认为标签关闭，
    而 JS state.docs 仍持有旧缓冲，桥消息在此期间抵达就会双源不一致，
    表现为「标签内容变空 / 串档」。
    """
    tab = app.sess.tabs[idx]
    if idx == app.sess.active_index:
        app.sess.active_index = max(0, idx - 1)

    # ① 记下要关闭的跨语言主键（后面每处都用同一个值）
    closing_key = session.tab_key(tab)

    # ② 通知 JS：把「不含该标签」的新列表推下去，JS 在 setTabs 内按差集删除缓冲。
    #    evaluate_js 是同步调用，JS 执行完才会返回，故返回即代表 JS 已清理。
    #    注意：此处 Python session 尚未 pop，故 active 需按 close_tab 的同一规则预演，
    #    不能直接取 remaining[0]（会标错活动标签，导致 JS 侧短暂显示错误的当前页）。
    remaining = [tt for i, tt in enumerate(app.sess.tabs) if i != idx]
    if remaining:
        new_active = app.sess.active_index
        if new_active >= len(remaining):
            new_active = max(0, len(remaining) - 1)
        elif idx < new_active:
            new_active -= 1
        active_tab = remaining[new_active]
    else:
        active_tab = None

    app.web.set_tabs([
        {"id": session.tab_key(tt), "name": tt.name, "active": tt is active_tab}
        for tt in remaining
    ])

    # ③ JS 已清理，现在才更新 Python 侧双源
    app.sess.close_tab(idx)
    app._loaded.discard(closing_key)

    if app.sess.tabs:
        _after_tab_switch(app, app.sess.active())
    else:
        # 零文档状态：页面显示开始页（不可编辑）；不再创建未命名欢迎文档
        app._empty_state()


# ================================================================ 退出

def quit(app) -> None:
    _quit_step(app, list(app.sess.tabs))


def _quit_step(app, remaining: list[session.TabState]) -> None:
    while remaining and not remaining[0].dirty:
        remaining.pop(0)
    if not remaining:
        _finish_quit(app)
        return
    tab = remaining.pop(0)
    r = messagebox.askyesnocancel(
        "未保存", f"「{tab.name}」有未保存的修改。\n退出前是否保存？")
    if r is None:
        return
    if not r:
        tab.dirty = False
        _quit_step(app, remaining)
        return

    def _saved_then_quit(text):
        if text is not None:
            _write_file(app, tab, text)
        _quit_step(app, remaining)

    app.web.request_text(session.tab_key(tab), _saved_then_quit)


def _finish_quit(app) -> None:
    # TTS：先停后台线程 + 取消轮询，再销毁窗口（specs/09 R-09-03）
    try:
        app.tts.stop()
        if getattr(app, "_tts_poll_after", None):
            app.root.after_cancel(app._tts_poll_after)
    except Exception:
        pass
    _save_layout(app)
    _save_session_config(app)
    config_mod.save(app.config)
    app.root.destroy()


# ================================================================ 私有

def _after_tab_switch(app, tab: session.TabState | None) -> None:
    _save_recent(app)
    app.refresh_all()
    _save_session_config(app)


def _save_recent(app) -> None:
    tab = app.sess.active()
    if not tab or not tab.path:
        return
    recent = [str(tab.path)] + [p for p in app.config.get("recent_files", [])
                                if p != str(tab.path)]
    app.config["recent_files"] = recent[:10]
    config_mod.save(app.config)
    app.win.refresh_recent_menu(recent)


def _save_layout(app) -> None:
    """窗口状态记忆：只保存正常尺寸，最大化尺寸不落盘（specs/01 R-01-07）。"""
    try:
        w = app.config.setdefault("window", {})
        normal = getattr(app, "_normal_geo", None)
        if app.root.state() == "zoomed" and normal:
            w.update(normal)
            return
        geo = app.root.geometry()
        m = re.match(r"(\d+)x(\d+)([+-]\d+)([+-]\d+)", geo)
        if m:
            normal = {"width": int(m.group(1)), "height": int(m.group(2)),
                      "x": int(m.group(3)), "y": int(m.group(4))}
            app._normal_geo = normal
            w.update(normal)
    except Exception:
        pass


def _save_session_config(app) -> None:
    app.config["session"] = app.sess.to_config()


def open_md_url(app, uri: str) -> None:
    """页内点了个本地 .md 链接 → 转成路径在应用里打开。"""
    p = unquote(urlparse(uri).path)
    if p[:3] == "/C:":      # file:///C:/... → C:/...
        p = p[1:]
    open_file(app, p)


# ================================================================ 关闭当前文档 / 最近文件（开始页）

def close_active(app) -> None:
    """关闭当前标签（Ctrl+W / 自定义菜单「关闭文件」；零文档时 no-op）。"""
    tab = app.sess.active()
    if not tab:
        return
    close_tab_by_id(app, session.tab_key(tab))


def open_recent(app, path: str) -> None:
    """从最近列表打开；缺失文件时提示并剔除该项。"""
    from tkinter import messagebox
    p = Path(path or "")
    if not p.is_file():
        messagebox.showerror("最近文件", f"文件不存在：\n{path}\n已从最近列表移除。")
        recent = [x for x in app.config.get("recent_files", []) if x != path]
        app.config["recent_files"] = recent
        config_mod.save(app.config)
        app.win.refresh_recent_menu(recent)
        if hasattr(app, "_send_ui_meta"):
            app._send_ui_meta()
        return
    open_file(app, str(p))
    if hasattr(app, "_send_ui_meta"):
        app._send_ui_meta()


def clear_recent(app) -> None:
    app.config["recent_files"] = []
    config_mod.save(app.config)
    app.win.refresh_recent_menu([])
    if hasattr(app, "_send_ui_meta"):
        app._send_ui_meta()


# ================================================================ TTS 语音播报（specs/09）

def _tts_config(app) -> dict:
    """取 tts 配置（非法值回落由 tts.py 的 normalize_* 负责）。"""
    return app.config.get("tts", {}) if isinstance(app.config.get("tts", {}), dict) else {}


def _doc_cache_id(app) -> str | None:
    """当前文档的缓存标识：有 path 用绝对路径，无 path 用 tab_seq（specs/09 R-09-06）。"""
    tab = app.sess.active()
    if not tab:
        return None
    return str(tab.path) if tab.path else f"untitled-{session.tab_key(tab)}"


def speak(app, scope: str = "full", sel_text: str | None = None) -> None:
    """朗读（specs/09 R-09-04）：选中文字用事件带来的 sel_text；全文走 request_text 异步拉取。

    - 纯文本转换统一经 services.plain_text.to_plain_text（R-07-03 唯一规则）。
    - 文本为空或取回 None 不启动，状态栏提示。
    """
    from services import tts as tts_mod
    from services.plain_text import to_plain_text

    if scope == "selection":
        raw = sel_text
        if not raw or not raw.strip():
            app.win.statusbar.set_temp("请先选中要朗读的文字")
            return
        _start_tts(app, tts_mod, to_plain_text(raw))
        return

    tab = app.sess.active()
    if not tab:
        return
    if not filetypes.is_text_like(tab.kind):
        app.win.statusbar.set_temp("该文件类型不支持朗读")
        return

    def _got(text):
        if text is None:
            app.win.statusbar.set_temp("朗读失败：内容取回失败")
            return
        _start_tts(app, tts_mod, to_plain_text(text))

    app.web.request_text(session.tab_key(tab), _got)


def _start_tts(app, tts_mod, plain: str) -> None:
    """调控制器启动朗读（音色/语速/缓存标记来自配置，specs/09 R-09-01/06）。"""
    cfg = _tts_config(app)
    doc_id = _doc_cache_id(app)
    cache_docs = cfg.get("cache_docs") or []
    cache_enabled = bool(doc_id and doc_id in cache_docs)
    started = app.tts.play(
        plain,
        voice=cfg.get("voice"),
        rate=cfg.get("rate"),
        cache_enabled=cache_enabled,
        doc_id=doc_id,
    )
    if not started:
        app.win.statusbar.set_temp("正在朗读中，请先停止当前播放")


def speak_stop(app) -> None:
    """停止朗读（specs/09 R-09-03）：仅置停止事件，不阻塞主线程。"""
    app.tts.stop()


def tts_cache_toggle(app) -> None:
    """切换当前文档的缓存开关（specs/09 R-06-10/R-09-06）：写入 tts.cache_docs 并持久化。"""
    doc_id = _doc_cache_id(app)
    if not doc_id:
        app.win.statusbar.set_temp("当前文档不支持缓存")
        return
    cfg = app.config.setdefault("tts", {})
    docs = cfg.get("cache_docs") or []
    if doc_id in docs:
        docs = [d for d in docs if d != doc_id]
        on = False
    else:
        docs = list(docs) + [doc_id]
        on = True
    cfg["cache_docs"] = docs
    config_mod.save(app.config)
    app.win.statusbar.set_temp(f"音频缓存已{'开启' if on else '关闭'}")
    # 回显开关态给播放条（无论是否正在朗读）
    app._push_tts_cache_state()
