# -*- coding: utf-8 -*-
"""状态栏组件（ui）：字数统计 + 行列/位置 + 编码/主题，临时消息。

- 自定义外壳（window.chrome=custom）下，本组件把文本转发给页面内状态栏
  （`web.set_status` / `web.set_status_temp`）；原生外壳或未绑定时退回 Tk 控件。
- 左：字数 · 词数；中：行:列 + 章节位置；右：编码 | 主题名（不含文件名——
  文件名已在标题栏与标签存在，不再重复落字）。
- 临时消息（保存失败/导出成功等）只覆盖右侧槽位，超时后恢复常驻信息；
  自动保存成功不再推临时消息（specs/00 外壳视觉法）。
"""

from __future__ import annotations

import tkinter as tk
from typing import Callable


class StatusBar(tk.Frame):
    """全宽底部状态栏，高 28px（原生外壳回退）。"""

    def __init__(self, master: tk.Widget) -> None:
        super().__init__(master, height=28)
        self.pack_propagate(False)
        self._divider = tk.Frame(master, height=1)

        self.left = tk.Label(self, text="0 字 · 0 词",
                             font=("Segoe UI", 9), anchor="w", padx=16, pady=3)
        self.mid = tk.Label(self, text="",
                            font=("Segoe UI", 9), anchor="center", pady=3)
        self.right = tk.Label(self, text="",
                              font=("Segoe UI", 9), anchor="e", padx=16, pady=3)
        self.left.pack(side=tk.LEFT)
        self.mid.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.right.pack(side=tk.RIGHT)

        self._temp_after = None
        self._base_right = ""
        self._left_text = "0 字 · 0 词"
        self._mid_text = ""
        self._web = None                 # 页面内状态栏桥（custom 外壳时绑定）
        self._refresh_cb: Callable[[], str] | None = None

    def bind_page(self, web) -> None:
        """绑定页面内状态栏：此后文本经 web.set_status 下发到页面。"""
        self._web = web

    def show(self, before: tk.Widget | None = None) -> None:
        """挂载分割线 + 状态栏到主窗口（原生外壳时使用）。"""
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
        self.mid.configure(bg=bg, fg=fg)
        self.right.configure(bg=bg, fg=fg)

    # ---------------- 内容 ----------------

    def _push(self) -> None:
        if self._web is not None:
            try:
                self._web.set_status({"left": self._left_text,
                                      "mid": self._mid_text,
                                      "right": self._base_right})
            except Exception:
                pass

    def set_char_count(self, chars: int, words: int) -> None:
        self._left_text = f"{chars} 字 · {words} 词"
        self.left.configure(text=self._left_text)
        self._push()

    def set_mid(self, text: str) -> None:
        self._mid_text = text or ""
        self.mid.configure(text=self._mid_text)
        self._push()

    def set_right(self, text: str) -> None:
        """右侧常驻信息（编码 | 主题名）。"""
        self._base_right = text or ""
        if not self._temp_after:
            self.right.configure(text=self._base_right)
        self._push()

    # 向后兼容（旧调用点）
    set_info = set_right

    def set_temp(self, msg: str, timeout_ms: int = 2000) -> None:
        """临时消息，超时后还原常驻信息。仅副作用：覆盖右侧槽位。"""
        if self._temp_after:
            self.after_cancel(self._temp_after)
        self.right.configure(text=msg or "")
        if self._web is not None:
            try:
                self._web.set_status_temp(msg, timeout_ms)
            except Exception:
                pass

        def _restore() -> None:
            self._temp_after = None
            self.right.configure(text=self._base_right)
            self._push()

        self._temp_after = self.after(timeout_ms, _restore)
