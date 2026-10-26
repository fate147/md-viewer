# 模块：导出 HTML（F06）

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-10-11

## 功能
渲染后的文档导出为带主题样式的独立 HTML 文件，双击浏览器可看。

## 实现（2026-10-11 重构）
- **服务**（services/export.py）：`to_html(md_text, theme_id, out_path)`。
  旧实现依赖 core.markdown_render（tkinterweb 路径，已退役）；现自包含：
  marked.js + highlight.js + 主题 preview CSS 全部内联进单文件，
  页面加载时由 marked 渲染（与阅读层同一条渲染管线）。
- midnight → dark hljs 配色，其余 → light。
- `fileio.write` UTF-8 原子写。
- **入口**：菜单「文件 → 导出 HTML…」→ `App.export_html()` → 经桥
  `request_text` 异步拉全文 → 导出。
- 导出的 HTML 无外部依赖（marked/hljs 内联，无网络请求）。

## 验收
✅ 标题取首个 h1 文本作 `<title>`；独立可用。完整验收随 M3 打包统一回归。
