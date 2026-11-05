# 2026-11-05 · 技术文档模式排版（A + B）

## 拍板

- 范围：A（文档模式 CSS/表格）+ B（自动判别 + 长文档自动目录）；C（提示块/锚点等）留待后续。
- 正文最大宽度：屏幕宽的 **2/3**（同时不超过当前可用阅读宽度）。
- 目录：短文档不显示；长文档（大纲条目多）自动显示；用户手动切换仍优先。
- 表格：自适应正文宽；单元格到上限自动换行；极宽表才出现表格内部横向滚动。

## 规格

- `specs/00`：文档模式宽度/表格/TOC 口径。
- `specs/03` R-03-05：`detectDocMode` 判别升级；R-03-09：表格包裹纳入后处理。
- `specs/04` R-04-06：滚动容器全宽；文档模式版心与表格滚动容器。
- `specs/05` R-05-12：`set_ui_meta` 增加 `docMaxWidth`。
- `specs/06` R-06-07：auto 模式长文档显示目录。
- `specs/changelog.md`：记录。

## 代码

| 文件 | 改动 |
|---|---|
| `src/main.pyw` | `_send_ui_meta` 下发 `docMaxWidth = 屏幕宽 × 2/3` |
| `src/assets/app.js` | `setUIMeta` 应用 `--doc-max-width` |
| `src/assets/app.css` | doc 版心 `min(--doc-max-width, 100%)`；段落 1em；表格容器、自动列宽、换行 |
| `src/assets/reader.js` | `detectDocMode` 新启发式；`wrapTables` 包 `.table-wrap` |
| `src/assets/toc.js` | doc 模式大纲 ≥ 6 条时 auto 显示目录 |

## 验收

- 技术文档自动进入文档模式（1 个代码块或表格即可）。
- 正文宽度随窗口/屏幕变化，最大不超过屏幕 2/3。
- 表格默认铺满正文宽、自动列宽、单元格换行；极宽表在表格内部滚动。
- 长文档自动出现目录，短文档无目录；手动开关仍生效。
- 不构建、不跑测试脚本。