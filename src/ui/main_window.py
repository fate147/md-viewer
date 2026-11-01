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


class MainWindow:
    """主窗口：菜单 + 状态栏 + web 客户区容器。"""

    def __init__(self, root: tk.Tk, handler, web: tk.Widget) -> None:
        self.root = root
        self.h = handler
        self.web = web
        self._theme_id = "paper"

        self.root.title("MD Viewer")
        self.root.minsize(600, 400)

        self.statusbar = StatusBar(root)
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
        mb.add_cascade(label="视图", menu=vm)

        hm = tk.Menu(mb, tearoff=0)
        hm.add_command(label="快捷键", command=self._show_help)
        hm.add_command(label="关于", command=self._show_about)
        mb.add_cascade(label="帮助", menu=hm)

        self.root.config(menu=mb)

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
        self.root.bind("<F2>", lambda e: h.web.toggle_mode())

    # ================================================================ 内部

    def _show_help(self) -> None:
        messagebox.showinfo(
            "快捷键",
            "Ctrl+O        打开文件\n"
            "Ctrl+N        新建标签\n"
            "Ctrl+S        保存\n"
            "Ctrl+Shift+S  另存为\n"
            "Ctrl+F / H    查找 / 替换\n"
            "F2            编辑 ⇄ 阅读切换\n"
            "Ctrl+Z / Y    撤销 / 重做\n"
            "Ctrl+Q        退出\n\n"
            "菜单 → 编辑 → 复制纯文本",
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
