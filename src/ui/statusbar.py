# -*- coding: utf-8 -*-
"""状态栏组件（ui）：左侧字数统计 + 右侧编码/主题/文件名，临时消息（design §5）。

- 左：字数 · 词数
- 右：光标行列 | 编码 | 主题名 | 文件名
- 临时消息（如「已保存」）2s 后自动还原。
"""

from __future__ import annotations

import tkinter as tk
from typing import Callable


class StatusBar(tk.Frame):
    """全宽底部状态栏，高 28px。"""

    def __init__(self, master: tk.Widget) -> None:
        super().__init__(master, height=28)
        self.pack_propagate(False)
        self._divider = tk.Frame(master, height=1)

        self.left = tk.Label(self, text="0 字 · 0 词",
                             font=("Segoe UI", 9), anchor="w", padx=16, pady=3)
        self.right = tk.Label(self, text="就绪",
                              font=("Segoe UI", 9), anchor="e", padx=16, pady=3)
        self.left.pack(side=tk.LEFT, fill=tk.BOTH)
        self.right.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        self._temp_after = None
        self._base_right = ""
        self._refresh_cb: Callable[[], str] | None = None

    def show(self, before: tk.Widget | None = None) -> None:
        """挂载分割线 + 状态栏到主窗口（before 保证分割线在 main 之上）。"""
        if before:
            self._divider.pack(fill=tk.X, before=before)
        else:
            self._divider.pack(fill=tk.X)
        self.pack(fill=tk.X, side=tk.BOTTOM)

    def apply_theme(self, theme: dict) -> None:
        ui = theme["ui"]
        bg, fg = ui["status_bg"], ui["status_fg"]
        self.configure(bg=bg)
        self._divider.configure(bg=ui.get("divider", bg))
        self.left.configure(bg=bg, fg=fg)
        self.right.configure(bg=bg, fg=fg)

    # ---------------- 内容 ----------------

    def set_char_count(self, chars: int, words: int) -> None:
        self.left.configure(text=f"{chars} 字 · {words} 词")

    def set_info(self, text: str) -> None:
        """右侧常驻信息（行列 | 编码 | 主题 | 文件名）。"""
        self._base_right = text
        if not self._temp_after:
            self.right.configure(text=text)

    def set_temp(self, msg: str, timeout_ms: int = 2000) -> None:
        """临时消息，超时后还原常驻信息。"""
        if self._temp_after:
            self.after_cancel(self._temp_after)
        self.right.configure(text=msg)

        def _restore() -> None:
            self._temp_after = None
            self.right.configure(text=self._base_right)

        self._temp_after = self.after(timeout_ms, _restore)
