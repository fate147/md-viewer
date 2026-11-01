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
from core import fileio, session


# ================================================================ 文件

def open_file(app, path: str) -> None:
    path = str(path)
    try:
        text, enc = fileio.read(path)
    except Exception as e:
        messagebox.showerror("错误", f"无法打开文件:\n{e}")
        return
    tab = app.sess.open_tab(path, enc)      # 已打开则激活
    if session.tab_key(tab) not in app._loaded:
        app._loaded.add(session.tab_key(tab))
        base = str(tab.path.parent) if tab.path else None
        app.web.send_text(session.tab_key(tab), text, tab.name, base)
    _after_tab_switch(app, tab)


def open_dialog(app) -> None:
    path = filedialog.askopenfilename(
        title="选择 Markdown 文件",
        filetypes=[("Markdown 文件", "*.md"), ("所有文件", "*.*")])
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
    if not tab.path:
        save_as(app)
        return
    _pull_and_write(app, tab)


def save_as(app) -> None:
    tab = app.sess.active()
    if not tab:
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
        from ui.welcome import WELCOME
        new_tab(app)
        app.web.send_text(session.tab_key(app.sess.active()), WELCOME, "未命名", None)


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
    """窗口状态记忆。"""
    try:
        w = app.config.setdefault("window", {})
        geo = app.root.geometry()
        m = re.match(r"(\d+)x(\d+)([+-]\d+)([+-]\d+)", geo)
        if m:
            w.update({"width": int(m.group(1)), "height": int(m.group(2)),
                      "x": int(m.group(3)), "y": int(m.group(4))})
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
