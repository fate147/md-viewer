# -*- coding: utf-8 -*-
"""会话模块（core）：标签页元数据管理（架构 §5.2）。

重要约定（审计 2.2 定案）：**本模块不存文本内容**。
编辑缓冲由浏览器前端（assets/app.js 的 state.docs）每标签独立持有（撤销/重做栈天然隔离，
core 层保持零 UI 依赖）。这里只管理 path / encoding / dirty / cursor 元数据。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class TabState:
    """单个标签页的元数据。"""

    path: Path | None = None
    encoding: str = "utf-8"
    dirty: bool = False
    cursor: tuple[int, int] = (1, 0)  # (行, 列)，1 起
    seq: int = 0                      # 跨语言主键（02 R-02-01）；0=未分配，作废后不复用
    # 编辑缓冲不在此处——由浏览器前端 assets/app.js 的 state.docs 持有

    @property
    def name(self) -> str:
        return self.path.name if self.path else "未命名"

    @property
    def title(self) -> str:
        """标签条显示文本：未保存加 ● 前缀（F03）。"""
        return ("● " if self.dirty else "") + self.name


def tab_key(tab: TabState) -> int:
    """标签的跨语言主键出口（02 R-02-01）。

    桥上所有标签标识符、`app.js` 的 `state.docs` 键都必须是本函数返回值。
    业务代码禁止直接写 `id(tab)` 或 `tab.seq`——切换主键实现只改这里，
    保证 Python `_loaded` 与 JS `state.docs` 两侧键空间原子切换。

    第一步（2026-10-26）：仍返回 `id(tab)`，行为与改前完全等价。
    第二步（待拍板）：改为 `return tab.seq`。
    """
    return id(tab)


class Session:
    """全局会话：标签列表 + 活动标签索引。App 单例持有（架构 §1 设计原则 2）。"""

    def __init__(self) -> None:
        self.tabs: list[TabState] = []
        self.active_index: int = 0
        self._next_seq: int = 0          # tab_seq 分配器：只增不减、不复用

    # ---------------- 查询 ----------------

    def active(self) -> TabState | None:
        if not self.tabs:
            return None
        idx = min(self.active_index, len(self.tabs) - 1)
        return self.tabs[idx]

    def index_of(self, path: str | Path) -> int:
        """按路径找标签索引；未打开返回 -1。"""
        p = Path(path).resolve()
        for i, t in enumerate(self.tabs):
            if t.path and t.path.resolve() == p:
                return i
        return -1

    # ---------------- 增删改 ----------------

    def _alloc_seq(self) -> int:
        """分配新的 tab_seq（02 R-02-01：只增不减、永不复用）。"""
        self._next_seq += 1
        return self._next_seq

    def open_tab(self, path: str | Path, encoding: str = "utf-8") -> TabState:
        """打开（或激活已打开的）标签，返回 TabState。"""
        idx = self.index_of(path)
        if idx >= 0:
            self.active_index = idx
            return self.tabs[idx]
        tab = TabState(path=Path(path), encoding=encoding, seq=self._alloc_seq())
        self.tabs.append(tab)
        self.active_index = len(self.tabs) - 1
        return tab

    def add_untitled(self) -> TabState:
        """新建未命名标签（Ctrl+N）。"""
        tab = TabState(path=None, seq=self._alloc_seq())
        self.tabs.append(tab)
        self.active_index = len(self.tabs) - 1
        return tab

    def close_tab(self, index: int) -> TabState | None:
        """关闭标签；返回被关闭的 TabState（不存在返回 None）。"""
        if not (0 <= index < len(self.tabs)):
            return None
        tab = self.tabs.pop(index)
        if self.active_index >= len(self.tabs):
            self.active_index = max(0, len(self.tabs) - 1)
        elif index < self.active_index:
            self.active_index -= 1
        return tab

    def activate(self, index: int) -> None:
        if 0 <= index < len(self.tabs):
            self.active_index = index

    def mark_dirty(self, tab: TabState, dirty: bool) -> None:
        tab.dirty = dirty

    # ---------------- 持久化 ----------------

    def to_config(self) -> dict:
        """导出会话到配置字段（F12 窗口状态记忆 / 启动恢复标签）。"""
        return {
            "open_tabs": [str(t.path) for t in self.tabs if t.path],
            "active_tab": self.active_index,
        }
