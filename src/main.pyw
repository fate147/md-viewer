#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MD Viewer 入口：WebView2 单页双态架构（2026-10-11 重构）。

编辑器（CodeMirror 6）与阅读层同页共存于 assets/app.html，F2 页内显隐
切换；Tk 只剩窗口壳（菜单/状态栏/文件对话框/配置）。文本缓冲的权威在
页面，Python 只存元数据；落盘经桥异步拉全文。

铁律（2026-10-01/11 实测）：
- WebView2 是 STA COM 组件：必须在 import tkinter/clr 之前对主线程
  CoInitializeEx(STA)；Tk mainloop 留在主线程，绝不挪进 CLR 托管线程。
- .NET 事件回调里只允许 queue.put（ui/web_client.py 已收敛）；
  App 侧一切事件都来自主线程常驻轮询器的分发。
"""

from __future__ import annotations

import sys
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import tkinter as tk

from core.session import tab_key
from ui.web_client import (EXIT_NO_WEBVIEW2, EXIT_RUNTIME_BROKEN, WebClient,
                           assets_dir, webview_available)


def _trace(msg: str) -> None:
    """启动追踪：设 MDV_BOOT_TRACE=1 时打到 stderr（windowed exe 默认无输出，
    控制台调试版配合使用；2026-10-11 排查打包假活加的）。"""
    import os
    if os.environ.get("MDV_BOOT_TRACE"):
        print(f"[boot] {msg}", file=sys.stderr, flush=True)


class App:
    """应用控制器：状态中心 + 事件路由（桥事件 → actions）。"""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self._loaded: set[int] = set()   # JS 侧已持有内容的 tab id
        self._save_timer = None
        self._web_ready = False

        self.root.title("MD Viewer")
        self._set_window_icon()
        self.root.minsize(600, 400)
        self.root.protocol("WM_DELETE_WINDOW", self._quit)

        from core import config as config_mod
        self.config = config_mod.load()
        self.theme_id = self.config.get("theme", "paper")

        from core.session import Session
        self.sess = Session()

        self.web = WebClient(root, on_ready=self._on_web_ready,
                             on_event=self._on_web_event, on_nav=self._on_nav)
        from ui.main_window import MainWindow
        self.win = MainWindow(root, self, self.web)

        w = self.config.get("window", {})
        geo = f"{w.get('width', 1280)}x{w.get('height', 800)}"
        if w.get("x") is not None and w.get("y") is not None:
            geo += f"+{w['x']}+{w['y']}"
        self.root.geometry(geo)

        self.win.apply_theme(self.theme_id)
        self.win.refresh_recent_menu(self.config.get("recent_files", []))

        # 第二期：自定义外壳（去系统标题栏 + 自绘标题栏，specs/01 R-01-07）
        # 必须在窗口映射后再套（未映射时取不到真正的顶层 wrapper，去标题栏会加到内层）
        self._cfg_after = None
        if self.config.get("window", {}).get("chrome", "custom") == "custom":
            self.root.bind("<Configure>", self._on_configure, add=True)
            self.root.after(180, self._apply_custom_frame)

    def _apply_custom_frame(self) -> None:
        try:
            from ui import win_chrome
            from core import theme as theme_mod
            bg = theme_mod.get(self.theme_id)["ui"]["bg"]
            win_chrome.apply_custom(
                self.root,
                self.config.get("layout", {}).get("ui_theme", "system"),
                content_dark=(self.theme_id == "midnight"),
                bg_hex=bg)
        except Exception:
            pass

    def _on_configure(self, _event=None) -> None:
        """尺寸变化后（去抖）重算 Win10 自绘圆角。"""
        try:
            if self._cfg_after:
                self.root.after_cancel(self._cfg_after)
        except Exception:
            pass
        self._cfg_after = self.root.after(140, self._apply_round)

    def _apply_round(self) -> None:
        self._cfg_after = None
        try:
            from ui import win_chrome
            win_chrome.apply_round_region(self.root)
        except Exception:
            pass

    def _push_window_title(self, text: str) -> None:
        """同步窗口标题：Tk 标题 + 页面自绘标题栏。"""
        self.root.title(text)
        try:
            self.web.set_window_title(text)
        except Exception:
            pass

    def _win_min(self) -> None:
        try:
            from ui import win_chrome
            win_chrome.minimize(self.root)
        except Exception:
            pass

    def _win_max(self) -> None:
        try:
            from ui import win_chrome
            win_chrome.toggle_maximize(self.root)
        except Exception:
            pass

    def _win_drag(self) -> None:
        try:
            from ui import win_chrome
            win_chrome.drag(self.root)
        except Exception:
            pass

    def _win_resize(self, edge: str) -> None:
        """无边框窗口的程序化边缘/角落缩放（按住左键期间实时改窗口矩形）。

        去掉了系统 WS_THICKFRAME，故自绘边缘把手 + 本方法用 GetWindowRect/
        SetWindowPos 实时缩放，兼顾"无边框铺满主题色"与"可自由拖边改大小"。
        """
        if not edge:
            return
        import ctypes
        import time
        from ctypes import wintypes
        u = ctypes.windll.user32
        hwnd = getattr(self.root, "_mdv_hwnd", 0)
        if not hwnd:
            return
        u.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        u.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
        u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        p0 = wintypes.POINT()
        u.GetCursorPos(ctypes.byref(p0))
        r = wintypes.RECT()
        u.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(r))
        sx, sy = p0.x, p0.y
        x, y, w, h = r.left, r.top, r.right - r.left, r.bottom - r.top
        minw, minh = 600, 400
        flags = 0x0004 | 0x0010            # SWP_NOZORDER | SWP_NOACTIVATE
        while u.GetAsyncKeyState(0x01) & 0x8000:      # 左键仍按住
            p = wintypes.POINT()
            u.GetCursorPos(ctypes.byref(p))
            dx, dy = p.x - sx, p.y - sy
            nx, ny, nw, nh = x, y, w, h
            if "w" in edge:
                nx, nw = x + dx, w - dx
            if "e" in edge:
                nw = w + dx
            if "n" in edge:
                ny, nh = y + dy, h - dy
            if "s" in edge:
                nh = h + dy
            if nw < minw:
                if "w" in edge:
                    nx = x + (w - minw)
                nw = minw
            if nh < minh:
                if "n" in edge:
                    ny = y + (h - minh)
                nh = minh
            u.SetWindowPos(wintypes.HWND(hwnd), wintypes.HWND(0), nx, ny, nw, nh, flags)
            try:
                self.root.update()          # 让 Tk/WebView 随缩放重排（拖动手感）
            except Exception:
                pass
            time.sleep(0.006)

    def _set_window_icon(self) -> None:
        """标题栏/任务栏图标（缺文件不影响启动）。"""
        ico = assets_dir() / "mdviewer.ico"
        try:
            self.root.iconbitmap(str(ico))
        except tk.TclError:
            pass

    # ================================================================ 页面就绪 / 初始内容

    def _on_web_ready(self) -> None:
        self._web_ready = True
        from core import theme as theme_mod
        f = self.config.get("font", {})
        self.web.set_theme(theme_mod.css_vars(self.theme_id))
        self.web.set_font(f.get("size", 17), f.get("family", "Georgia"))
        self.web.set_reading_mode(
            self.config.get("layout", {}).get("reading_mode", "auto"))
        # 启动只下发初始状态，不写 manual —— 否则文档模式的 auto 隐藏会失效
        self.web.set_toc_mode(
            self.config.get("layout", {}).get("toc_mode", "auto"))
        self.web.init_toc_visible(
            bool(self.config.get("layout", {}).get("toc_visible", True)))
        self._send_ui_meta()
        self._init_content()

    def _send_ui_meta(self) -> None:
        """下发页面内菜单所需元数据（主题列表 + 当前状态，specs/05 R-05-12）。"""
        from core import theme as theme_mod
        layout = self.config.get("layout", {})
        ui_theme = layout.get("ui_theme", "system")
        try:
            from ui import win_chrome
            shell_dark = win_chrome.resolve_dark(ui_theme)
        except Exception:
            shell_dark = False
        self.web.set_ui_meta({
            "chrome": self.config.get("window", {}).get("chrome", "custom"),
            "themes": [{"id": t["id"], "name": t["name"]} for t in theme_mod.THEMES],
            "theme": self.theme_id,
            "readingMode": layout.get("reading_mode", "auto"),
            "tocMode": layout.get("toc_mode", "auto"),
            "shellDark": shell_dark,
        })

    def _init_content(self) -> None:
        from actions import open_file as _open_file, new_tab as _new_tab

        opened = False
        for arg in sys.argv[1:]:
            if Path(arg).is_file() and Path(arg).suffix.lower() == ".md":
                _open_file(self, arg)
                opened = True
                break

        if not opened:
            s = self.config.get("session", {})
            restored = False
            restored_paths: list[str] = []
            for p in s.get("open_tabs", [])[:8]:
                if Path(p).is_file():
                    _open_file(self, p)
                    restored_paths.append(p)
                    restored = True
            if restored:
                # 恢复上次活动标签（2026-11-02，specs/02 R-02-08）：按实际存在文件的
                # 顺序解析 active_tab，越界回退 0。修前只打开不定位，停在最后一个。
                from actions import select_tab_by_id
                ai = s.get("active_tab", 0)
                if not isinstance(ai, int) or not (0 <= ai < len(restored_paths)):
                    ai = 0
                target = str(restored_paths[ai])
                tab = next((t for t in self.sess.tabs
                            if t.path and str(t.path) == target), None)
                if tab is not None:
                    select_tab_by_id(self, tab_key(tab))
            else:
                from ui.welcome import WELCOME
                _new_tab(self)
                tab = self.sess.active()
                self.web.send_text(tab_key(tab), WELCOME, tab.name, None)

    # ================================================================ 桥事件

    def _on_web_event(self, d: dict) -> None:
        stats = d.get("stats")
        if stats:
            self._update_stats(stats)
        for ev in d.get("events", []):
            t = ev.get("type")
            if t == "docChanged":
                self._on_doc_changed()
            elif t == "save":
                self.save()
            elif t == "saveAs":
                self.save_as()
            elif t == "open":
                self.open_dialog()
            elif t == "new":
                self.new_tab()
            elif t == "quit":
                self._quit()
            elif t == "selectTab":
                from actions import select_tab_by_id
                select_tab_by_id(self, ev["id"])
            elif t == "closeTab":
                from actions import close_tab_by_id
                close_tab_by_id(self, ev["id"])
            elif t == "clipboardSet":
                self._clipboard_set(ev["text"])
            elif t == "clipboardGet":
                self._clipboard_paste()
            elif t == "copyPlain":
                self.copy_as_plain_text()
            elif t == "exportHtml":
                self.export_html()
            elif t == "section":
                self._on_section(ev)
            elif t == "tocToggle":
                self._on_toc_toggle(ev)
            elif t == "toast":
                # 页面侧提示（如「文档过大，暂不支持编辑」）
                self.win.statusbar.set_temp(ev.get("text") or "")
            elif t == "theme":
                self.switch_theme(ev.get("id") or "paper")
            elif t == "readingMode":
                self.set_reading_mode(ev.get("mode") or "auto")
            elif t == "tocMode":
                self.set_toc_mode(ev.get("mode") or "auto")
            elif t == "help":
                self.win._show_help()
            elif t == "about":
                self.win._show_about()
            elif t == "windowMin":
                self._win_min()
            elif t == "windowMax":
                self._win_max()
            elif t == "windowClose":
                self._quit()
            elif t == "windowDrag":
                self._win_drag()
            elif t == "windowResize":
                self._win_resize(ev.get("edge") or "")

    def _on_section(self, ev: dict) -> None:
        """阅读态滚动换章：刷新状态栏位置（specs/03 R-03-10 消费点之一）。"""
        self._section = {
            "volume": ev.get("volume") or "",
            "chapter": ev.get("chapter") or "",
            "percent": ev.get("percent", 0),
        }
        self._update_status_tail()

    def _on_toc_toggle(self, ev: dict) -> None:
        """目录手动开关：记忆到配置（specs/06 R-06-07 逃生阀）。"""
        from core import config as config_mod
        visible = bool(ev.get("visible"))
        self.config.setdefault("layout", {})["toc_visible"] = visible
        config_mod.save(self.config)
        if hasattr(self, "_toc_var"):
            try:
                self._toc_var.set(visible)
            except Exception:
                pass

    def set_toc_visible(self, visible: bool) -> None:
        """菜单/快捷键入口：置显示状态并记忆。"""
        from core import config as config_mod
        self.config.setdefault("layout", {})["toc_visible"] = bool(visible)
        config_mod.save(self.config)
        self.web.set_toc_visible(bool(visible))

    def set_toc_mode(self, mode: str) -> None:
        """目录显示模式 auto|always|never（菜单入口，specs/06 R-06-07）。"""
        from core import config as config_mod
        m = mode if mode in ("auto", "always", "never") else "auto"
        self.config.setdefault("layout", {})["toc_mode"] = m
        config_mod.save(self.config)
        # 菜单选择视为用户显式动作：清除手动覆盖，令所选模式立即生效
        self.web.set_toc_mode(m, clear_manual=True)
        self._send_ui_meta()

    def _on_nav(self, kind: str, uri: str) -> None:
        if kind == "open_md":
            from actions import open_md_url
            open_md_url(self, uri)
        elif kind == "external":
            webbrowser.open(uri)

    def _on_doc_changed(self) -> None:
        tab = self.sess.active()
        if not tab:
            return
        tab.dirty = True
        tab_name = tab.name
        self._push_window_title(f"MD Viewer ● - {tab_name}")
        self._schedule_auto_save()

    def _clipboard_set(self, text: str) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(text or "")

    def _clipboard_paste(self) -> None:
        try:
            text = self.root.clipboard_get()
        except tk.TclError:
            return
        self.web.insert_text(text)

    # ================================================================ 文件/标签（转 actions）

    def tab_by_id(self, tab_id: int):
        for t in self.sess.tabs:
            if tab_key(t) == tab_id:
                return t
        return None

    def open_dialog(self) -> None:
        from actions import open_dialog as _open_dialog
        _open_dialog(self)

    def open_file(self, path: str) -> None:
        from actions import open_file as _open_file
        _open_file(self, path)

    def new_tab(self) -> None:
        from actions import new_tab as _new_tab
        _new_tab(self)

    def save(self) -> None:
        from actions import save as _save
        _save(self)

    def save_as(self) -> None:
        from actions import save_as as _save_as
        _save_as(self)

    def export_html(self) -> None:
        from actions import export_html as _export_html
        _export_html(self)

    def _quit(self) -> None:
        from actions import quit as _quit_app
        _quit_app(self)

    def quit(self) -> None:     # 菜单/快捷键入口名
        self._quit()

    # ================================================================ 自动保存

    def _schedule_auto_save(self) -> None:
        if self._save_timer:
            self.root.after_cancel(self._save_timer)
        self._save_timer = self.root.after(2000, self._auto_save)

    def _auto_save(self) -> None:
        self._save_timer = None
        tab = self.sess.active()
        if not self.config.get("auto_save", True):
            return
        if not tab or not tab.path or not tab.dirty:
            return

        def _got(text):
            if not text or not text.strip():
                return
            try:
                from core import fileio
                fileio.write(tab.path, text, tab.encoding)
            except Exception:
                self.win.statusbar.set_temp("自动保存失败")
                return
            tab.dirty = False
            self.web.set_dirty(tab_key(tab), False)
            self._push_window_title(f"MD Viewer - {tab.name}")
            self.win.statusbar.set_temp("已自动保存")

        self.web.request_text(tab_key(tab), _got)

    # ================================================================ 复制纯文本

    def copy_as_plain_text(self) -> None:
        tab = self.sess.active()
        if not tab:
            return

        def _got(text):
            if text is None:
                return
            from services.plain_text import to_plain_text
            self._clipboard_set(to_plain_text(text))
            self.win.statusbar.set_temp("已复制纯文本")

        self.web.request_text(tab_key(tab), _got)

    # ================================================================ 主题

    def switch_theme(self, theme_id: str) -> None:
        from core import config as config_mod
        from core import theme as theme_mod
        self.theme_id = theme_id
        self.config["theme"] = theme_id
        config_mod.save(self.config)
        self.win.apply_theme(theme_id)
        self.web.set_theme(theme_mod.css_vars(theme_id))
        # 深色内容主题 → 深色 DWM 边框（消除 Win10 白边）
        if self.config.get("window", {}).get("chrome", "custom") == "custom":
            try:
                from ui import win_chrome
                win_chrome.refresh_theme(
                    self.root,
                    self.config.get("layout", {}).get("ui_theme", "system"),
                    content_dark=(theme_id == "midnight"))
                win_chrome.set_class_bg(
                    win_chrome._hwnd(self.root), theme_mod.get(theme_id)["ui"]["bg"])
            except Exception:
                pass
        self._send_ui_meta()
        self._update_status_tail()

    def set_reading_mode(self, mode: str) -> None:
        """排版模式（auto|book|doc）：菜单切换，记忆到配置。"""
        from core import config as config_mod
        self.config.setdefault("layout", {})["reading_mode"] = mode
        config_mod.save(self.config)
        self.web.set_reading_mode(mode)
        self._send_ui_meta()
        names = {"auto": "自动判别", "book": "书卷", "doc": "文档"}
        self.win.statusbar.set_temp(f"排版模式：{names.get(mode, mode)}")

    # ================================================================ 刷新

    def refresh_all(self) -> None:
        active = self.sess.active()
        items = [{"id": tab_key(t), "name": t.name,
                  "active": t is active} for t in self.sess.tabs]
        self.web.set_tabs(items)
        tab = active
        if tab:
            mark = " ●" if tab.dirty else ""
            self._push_window_title(f"MD Viewer{mark} - {tab.name}")
        else:
            self._push_window_title("MD Viewer")
        self._update_status_tail()

    def _update_stats(self, s: dict) -> None:
        self._last_stats = s
        self.win.statusbar.set_char_count(s["chars"], s["words"])
        self._stat_pos = (s["line"], s["col"])
        self._update_status_tail()

    def _update_status_tail(self) -> None:
        from core import theme as theme_mod
        tab = self.sess.active()
        pos = getattr(self, "_stat_pos", (1, 1))
        parts = [f"{pos[0]}:{pos[1]}"]
        sec = getattr(self, "_section", None)
        if sec and (sec["chapter"] or sec["volume"]):
            loc = " · ".join([x for x in (sec["volume"], sec["chapter"]) if x])
            parts.append(f"{loc} · {sec['percent']}%")
        if tab:
            parts.append(tab.encoding)
            if tab.path:
                parts.append(tab.path.name)
        parts.append(theme_mod.get(self.theme_id)["name"])
        self.win.statusbar.set_info(" | ".join(parts))

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    import ctypes
    import traceback

    def _log_path() -> Path:
        """诊断日志落点：便携版在 exe 同级，源码模式在 src 同级。"""
        base = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) \
            else Path(__file__).resolve().parent
        return base.joinpath("md-viewer-error.log")

    def _crash_log(exc_lines: str) -> None:
        try:
            _log_path().write_text(exc_lines, encoding="utf-8")
        except Exception:
            pass

    def _guarded() -> None:
        try:
            _trace("have_runtime 检测前")
            ok, reason, detail = webview_available()
            if not ok:
                _trace(f"WebView2 检测失败 reason={reason}")
                if detail:                      # R-01-06②：装配失败必须落盘
                    _crash_log(detail)
                from tkinter import messagebox
                r = tk.Tk()
                r.withdraw()
                if reason == "missing":
                    messagebox.showerror(
                        "MD Viewer",
                        "未检测到 WebView2 运行时，无法启动。\n\n"
                        "请安装 Microsoft Edge WebView2（Evergreen）：\n"
                        "https://developer.microsoft.com/microsoft-edge/webview2/\n\n"
                        "（若已安装仍见此提示，可能是 .NET Framework 低于 4.6.2。）")
                else:
                    messagebox.showerror(
                        "MD Viewer",
                        "运行时装配失败（CLR / pythonnet 初始化未通过），无法启动。\n\n"
                        f"诊断日志：{_log_path()}\n\n"
                        "这不是「没装 WebView2」——WebView2 可能已安装，"
                        "是 Python 侧的 .NET 装配坏了。")
                r.destroy()
                sys.exit(EXIT_NO_WEBVIEW2 if reason == "missing"
                         else EXIT_RUNTIME_BROKEN)
            _trace("runtime OK，建 Tk root")
            root = tk.Tk()
            _trace("Tk root OK，初始化 App")
            App(root)
            _trace("App 初始化完成，进 mainloop")
            root.mainloop()
        except Exception:
            _crash_log(traceback.format_exc())
            raise

    # WebView2 是 STA COM 组件：必须在导入 clr/tkinter 之前把主线程注册为
    # STA（hr=0 S_OK / 1 S_FALSE 均可）。禁止改到 CLR 托管线程里跑
    # Tk.mainloop——会在 dooneevent 处触发 PyEval_RestoreThread 崩溃。
    try:
        _hr = ctypes.oledll.ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED
    except Exception:
        _hr = -1

    _guarded()
