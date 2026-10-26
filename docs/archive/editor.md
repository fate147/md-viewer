# 编辑器组件 (ui/editor.py)

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-09-30

Tk Text + 行号 + Markdown 语法高亮。

## 功能

- 行号栏：左侧只读 Text，同步滚动
- 语法高亮：标题/粗体/斜体/代码/链接/引用
- 防抖 250ms：大文件不卡
- 撤销/重做：Tk Text 原生 undo
- 全文缓存：`get_text()` / `get_stats()` 命中缓存时零 Tk 调用

## 接口

- `get_text()` / `load_text(content, preserve_undo=False)`
- `get_stats()` → `(字符数, 词数)`
- `select_all()` / `get_selection()`
- `get_cursor()` / `set_cursor(row, col)`
- `jump_to_line(line)`
- `clear_search_highlights()` / `highlight_ranges(ranges)`
- `insert_at_cursor(s)`

## 性能：全文缓存（2026-09-30）

`Text.get("1.0", "end-1c")` 会把全文拷成新 Python 串。打开一个文件时原本要
取 **4~5 次全文**：`load_text` 内的高亮重扫 1 次、状态栏字数统计 1 次、预览
取文本 1 次，`_refresh_status` 还要额外 `strip()` + `split()` 各拷一份
（1MB 文档约 3ms/次 + 数十万字符串对象）。

改为：`load_text` 时把内容存进 `_text_cache`，`get_stats` 另存
`_stats_cache`；`<<Modified>>`（用户真实编辑）与 `insert_at_cursor` 时失效。

**等价性已实测**：`load_text(c)` 之后 `get_text()` 与 `Text.get("1.0","end-1c")`
在 17 组样本上逐字符一致（含尾部换行、`\r\n`、制表符、空行、emoji、10 万字符
长行）—— Tk 的 `end-1c` 对以 `\n` 结尾的内容**原样返回**内容，并不像直觉
那样削掉尾换行。查找替换走 `load_text(preserve_undo=True)`，同样安全。

97KB 文档实测：打开的同步工作量（读盘 + 灌入 + 高亮 + 状态栏）46ms。

## 已知限制

- 语法高亮仍是**全量重扫**（7 个正则逐行 + 最多 3,000 次 `tag_add`），
  靠 `_HIGHLIGHT_BUDGET` / `_HIGHLIGHT_MAX_LINE` 止血，无行级缓存。
  大文档下这一项仍是主要开销（见 `docs/log/2026-08.md` v1.0 遗留风险第 4 条）。
