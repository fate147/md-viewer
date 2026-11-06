# -*- coding: utf-8 -*-
"""主窗口（ui）：原生菜单 + 状态栏 + WebView2 客户区的窗口壳。

2026-10-11 重构：客户区整个交给 ui.web_client.WebClient（页面内含编辑器
与阅读层、F2 切换、标签条），本模块只剩原生菜单、状态栏与 Tk 底色。
菜单动作分两类：
- 文件操作（打开/保存/另存为/标签管理）→ 直接走 handler（App）；
- 编辑器命令（撤销/剪切/查找…）→ web.run_cmd 转发进页面。
"""

from __future__ import annotations

import tkinter as tk
from tkinter import messagebox

from core import theme as theme_mod
from ui.statusbar import StatusBar


def _close_active(handler) -> None:
    """原生外壳回退菜单入口 → actions.close_active（Ctrl+W 共享同一实现）。"""
    from actions import close_active
    close_active(handler)


class MainWindow:
    """主窗口：菜单 + 状态栏 + web 客户区容器。"""

    def __init__(self, root: tk.Tk, handler, web: tk.Widget) -> None:
        self.root = root
        self.h = handler
        self.web = web
        self._theme_id = "paper"
        # 外壳模式：custom=页面自绘菜单/状态栏（默认）；native=原生 Tk 菜单/状态栏（回退）
        self._chrome = self.h.config.get("window", {}).get("chrome", "custom")

        self.root.title("MD Viewer")
        self.root.minsize(600, 400)

        self.statusbar = StatusBar(root)
        self.statusbar.bind_page(web)
        if self._chrome == "native":
            self.statusbar.show()
        web.pack(fill=tk.BOTH, expand=True)

        self._build_menu()
        self._bind_shortcuts()

    # ================================================================ 菜单

    def _build_menu(self) -> None:
        h = self.h
        mb = tk.Menu(self.root)

        fm = tk.Menu(mb, tearoff=0)
        fm.add_command(label="打开…  Ctrl+O", command=h.open_dialog)
        fm.add_command(label="新建  Ctrl+N", command=h.new_tab)
        fm.add_separator()
        fm.add_command(label="保存  Ctrl+S", command=h.save)
        fm.add_command(label="另存为…  Ctrl+Shift+S", command=h.save_as)
        fm.add_command(label="导出 HTML…", command=h.export_html)
        fm.add_separator()
        self.recent_menu = tk.Menu(fm, tearoff=0)
        fm.add_cascade(label="最近文件", menu=self.recent_menu)
        fm.add_command(label="关闭文件  Ctrl+W", command=lambda: _close_active(h))
        fm.add_separator()
        fm.add_command(label="退出  Ctrl+Q", command=h.quit)
        mb.add_cascade(label="文件", menu=fm)

        em = tk.Menu(mb, tearoff=0)
        w = lambda name: (lambda: h.web.run_cmd(name))
        em.add_command(label="撤销  Ctrl+Z", command=w("undo"))
        em.add_command(label="重做  Ctrl+Y", command=w("redo"))
        em.add_separator()
        em.add_command(label="剪切  Ctrl+X", command=w("cut"))
        em.add_command(label="复制  Ctrl+C", command=w("copy"))
        em.add_command(label="复制纯文本", command=h.copy_as_plain_text)
        em.add_command(label="粘贴  Ctrl+V", command=w("paste"))
        em.add_command(label="全选  Ctrl+A", command=w("selectAll"))
        em.add_separator()
        em.add_command(label="查找  Ctrl+F", command=w("find"))
        em.add_command(label="替换  Ctrl+H", command=w("find"))
        mb.add_cascade(label="编辑", menu=em)

        ffm = tk.Menu(mb, tearoff=0)
        self._reading_font_var = tk.StringVar(
            value=h.config.get("font", {}).get("reading_family", "auto"))
        for f in theme_mod.READING_FONTS:
            ffm.add_radiobutton(
                label=f["name"], variable=self._reading_font_var,
                value=f["id"],
                command=lambda fid=f["id"]: h.set_reading_font(fid))
        mb.add_cascade(label="字体", menu=ffm)

        tm = tk.Menu(mb, tearoff=0)
        for t in theme_mod.THEMES:
            tm.add_command(label=t["name"],
                           command=lambda tid=t["id"]: h.switch_theme(tid))
        mb.add_cascade(label="主题", menu=tm)

        vm = tk.Menu(mb, tearoff=0)
        vm.add_command(label="编辑 ⇄ 阅读  F2", command=h.web.toggle_mode)
        vm.add_separator()
        self._reading_mode_var = tk.StringVar(
            value=h.config.get("layout", {}).get("reading_mode", "auto"))
        rm = tk.Menu(vm, tearoff=0)
        for value, label in (("auto", "自动判别（推荐）"),
                             ("book", "书卷（小说/散文）"),
                             ("doc", "文档（技术文档）")):
            rm.add_radiobutton(label=label, variable=self._reading_mode_var,
                               value=value,
                               command=lambda: h.set_reading_mode(
                                   self._reading_mode_var.get()))
        vm.add_cascade(label="排版模式", menu=rm)
        vm.add_separator()
        self._toc_var = tk.BooleanVar(
            value=bool(h.config.get("layout", {}).get("toc_visible", True)))
        vm.add_checkbutton(label="目录  Ctrl+Shift+O", variable=self._toc_var,
                           command=lambda: h.set_toc_visible(self._toc_var.get()))
        # 目录显示模式 auto|always|never（specs/06 R-06-07，2026-11-02）
        self._toc_mode_var = tk.StringVar(
            value=h.config.get("layout", {}).get("toc_mode", "auto"))
        tmm = tk.Menu(vm, tearoff=0)
        for value, label in (("auto", "自动（书卷显示 / 文档隐藏）"),
                             ("always", "始终显示"),
                             ("never", "始终隐藏")):
            tmm.add_radiobutton(label=label, variable=self._toc_mode_var,
                                value=value,
                                command=lambda: h.set_toc_mode(
                                    self._toc_mode_var.get()))
        vm.add_cascade(label="目录显示模式", menu=tmm)
        mb.add_cascade(label="视图", menu=vm)

        hm = tk.Menu(mb, tearoff=0)
        hm.add_command(label="快捷键", command=self._show_help)
        hm.add_command(label="关于", command=self._show_about)
        mb.add_cascade(label="帮助", menu=hm)

        if self._chrome == "native":
            self.root.config(menu=mb)   # custom 外壳使用页面内菜单，不挂原生菜单

    # ================================================================ 快捷键

    def _bind_shortcuts(self) -> None:
        # 焦点在页面里时这些键由页面 JS 捕获并经桥回调（见 app.js）；
        # 这里兜底焦点落在菜单/窗口本身的情形。
        h = self.h
        self.root.bind("<Control-o>", lambda e: h.open_dialog())
        self.root.bind("<Control-O>", lambda e: h.open_dialog())
        self.root.bind("<Control-n>", lambda e: h.new_tab())
        self.root.bind("<Control-s>", lambda e: h.save())
        self.root.bind("<Control-S>", lambda e: h.save_as())
        self.root.bind("<Control-q>", lambda e: h.quit())
        self.root.bind("<Control-w>", lambda e: _close_active(h))
        self.root.bind("<Control-W>", lambda e: _close_active(h))
        self.root.bind("<Control-h>", lambda e: h.web.run_cmd("find"))
        self.root.bind("<Control-H>", lambda e: h.web.run_cmd("find"))
        # F2 兜底：焦点在菜单/窗口本身时由 Tk 处理。
        # 2026-11-02：加 150ms 防重入 —— 焦点在 WebView 内时 JS 的全局 keydown
        # 也会处理 F2，两者若同时到达会各切一次、相互抵消（表现为「按 F2 没反应」）。
        self._f2_last = 0.0
        self.root.bind("<F2>", self._on_f2)

    def _on_f2(self, _event=None):
        import time as _t
        now = _t.monotonic()
        if now - self._f2_last < 0.15:
            return "break"          # 与 JS 侧同一次按键，丢弃
        self._f2_last = now
        self.h.web.toggle_mode()
        return "break"

    # ================================================================ 内部

    def _show_help(self) -> None:
        """原生回退外壳的快捷键说明；自定义外壳走页面内帮助面板（MDV_SHORTCUTS 单一来源）。"""
        messagebox.showinfo(
            "快捷键",
            "Ctrl+O        打开文件\n"
            "Ctrl+N        新建文档\n"
            "Ctrl+S        保存\n"
            "Ctrl+Shift+S  另存为\n"
            "Ctrl+W        关闭当前文件\n"
            "Ctrl+F / H    查找 / 替换\n"
            "F2            编辑 ⇄ 阅读切换\n"
            "Ctrl+K        命令面板\n"
            "Ctrl+Shift+O  显示 / 隐藏目录\n"
            "Ctrl+← / →    上一章 / 下一章（阅读态）\n"
            "Ctrl+Z / Y    撤销 / 重做\n"
            "Ctrl+Shift+P  导出 HTML\n"
            "Ctrl+Q        退出\n",
        )

    def _show_about(self) -> None:
        messagebox.showinfo(
            "关于 MD Viewer",
            "MD Viewer\n\n"
            "Markdown 阅读 & 编辑器\n"
            "单页双态 · 编辑/阅读 F2 秒切 · 大文件流畅\n"
            "4 套护眼主题",
        )

    # ================================================================ 状态刷新

    def apply_theme(self, theme_id: str) -> None:
        self._theme_id = theme_id
        t = theme_mod.get(theme_id)
        self.root.configure(bg=t["ui"]["bg"])
        self.statusbar.apply_theme(t)

    def refresh_recent_menu(self, recent: list[str]) -> None:
        self.recent_menu.delete(0, "end")
        for p in recent:
            self.recent_menu.add_command(
                label=p, command=lambda path=p: self.h.open_file(path))
        if not recent:
            self.recent_menu.add_command(label="（无）", state="disabled")
