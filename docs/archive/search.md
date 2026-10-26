# 模块：查找替换（F04）

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-09-14

## 功能
全文查找（大小写/正则），高亮命中，逐个/全部替换，命中计数；替换后可撤销。

## 实现
- **引擎**（services/search.py，零控件依赖）：
  - `find(text, term, case_sensitive, use_regex) -> [(start, end)]` 字符偏移列表（不重叠）。
  - `replace_all(...) -> (new_text, count)`（re.subn）；`count()` 计数。
  - 无效正则抛 `ValueError`（UI 层捕获提示）。
- **对话框**（ui/dialogs.py `find_replace_dialog`）：查找/替换双输入 + 大小写/正则勾选；"查找全部" → `editor.highlight_ranges(offsets)`（字符偏移换算 Tk 索引 `1.0+{n}c`）；"替换全部" → 确认后 `editor.load_text(new_text, preserve_undo=True)`——**undo 栈保留，Ctrl+Z 撤销两次回原文本**（Bug#002 修复：默认 load_text 会 edit_reset 清栈）。
- 命中计数/未找到提示走状态栏 `set_temp`。

## 已知坑
- 高亮 tag 颜色硬编码 `#FFEB3B` 黄底（design §5 查找对话框规范），主题切换时在 `Editor.apply_theme` 中重配。
- **load_text 默认清 undo 栈**（打开文件/切标签设计行为）——替换场景必须传 `preserve_undo=True`，见 `docs/bugs/002-替换全部不可撤销-load-text清栈.md`。

## 验收
✅ **整体五步验收通过（2026-08-14）**：find 命中/忽略大小写/replace_all 计数/无效正则 ValueError/UI 替换生效/替换后可撤销 —— 6 项 PASS。