# 主题模块 (core/theme.py)

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-10-11

4 套护眼主题，一键切换全局生效（页面 + Tk 外壳）。

## 主题列表

| ID | 名称 | 风格 | hljs 配色 |
|---|---|---|---|
| paper | 温润纸白 | 暖色调日间 | light (default) |
| midnight | 深夜墨黑 | 暗色夜间 | dark (monokai) |
| forest | 森之息 | 自然浅色 | light (friendly) |
| pure | 极简纯白 | 高对比极简 | light (xcode) |

## 数据结构

每套主题包含：
- `ui`：Tk 外壳 tokens（bg/fg/accent/toolbar/status/divider/line_numbers）
- `editor`：编辑器样式（font/bg/fg/select/insertbackground）
- `preview`：预览 CSS 规则字典（现仅 services/export 的 HTML 导出使用）
- `_PREVIEW_COLORS`（模块级）：语义色板，`css_vars()` 与 preview 规则共用的唯一色源

## 接口

```python
get(theme_id)             # 按 id 取主题
theme_ids() / theme_names()
css_vars(theme_id) -> dict   # 前端 CSS 变量表（页面颜色的唯一数据源）
preview_css(theme_id)     # 预览 CSS 文本（HTML 导出用）
pygments_style(theme_id)  # Pygments 高亮风格（HTML 导出用）
```

`css_vars()` 输出 `--bg/--fg/--accent/--heading/--code-bg/--pre-bg/--border/...`
加 `__hljs`（light/dark，app.js 用它切 `<html data-hljs>` 选 hljs 配色）。

## 切换链路（2026-10-11 起）

菜单 → `App.switch_theme(id)`：
1. `config.save`（主题记忆）
2. `win.apply_theme`（Tk 根窗口 + 状态栏底色）
3. `web.set_theme(css_vars(id))` → JS `setTheme` 逐条 `setProperty`——
   编辑层（CodeMirror 主题全部用 `var()` 写色）与阅读层瞬时全换，无需重渲。
