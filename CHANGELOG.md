# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [1.0.0] - 2026-10-26

首个公开版本。

### 新增

- **单页双态**：编辑层（CodeMirror 6）与阅读层（marked + highlight.js）常驻同一个
  WebView2 页面，`F2` 秒切，光标位置自动对齐。
- **纸间微光排版**：衬线窄栏、两端对齐、段首缩进；四套主题
  （paper / midnight / forest / purple）。
- **双排版模式**：自动识别「书卷」（小说、长文，卷章分层）与「文档」
  （笔记、技术文档），也可手动切换。
- **多标签**：上限 8 个，支持会话恢复与最近文件。
- **导出**：导出为独立 HTML（资产内联，双击即开），或复制纯文本。
- **编码保真**：读取按 `utf-8-sig → utf-8 → gbk` 探测，回写保留原编码与 BOM。
- **`.md` 关联接管**：安装版可接管 `.md` 默认程序，并在登录时自动夺回。

### 修复

- 修复多标签快速切换后内容串档：阅读层渲染归属改为按标签独立记录，
  不再被后一次渲染覆盖。
- 修复「明明装了 WebView2 却提示未检测到 WebView2」：启动检测不再把所有异常
  一律报成「缺少运行时」，现在区分两种情况并分别给出提示与退出码：
  - 退出码 2 —— 确实未安装 WebView2 Runtime
  - 退出码 3 —— WebView2 已安装，但 .NET / pythonnet 装配失败

  两种情况都会把诊断信息写入程序目录的 `md-viewer-error.log`。

### 性能

2.3 MB 纯文本实测：打开 1.23 s / `F2` 带重渲 65 ms / 切回阅读层 12 ms。

### 已知限制

- 仅 Windows（依赖 WebView2 与 .NET Framework 4.6.2+）。
- **请勿把程序放在 Documents、OneDrive 或其他同步目录下运行** —— .NET 的
  `Assembly.LoadFrom` 在这些目录会失败，表现为「运行时装配失败」。
  建议放 `%LOCALAPPDATA%\Programs\` 或任意非同步路径。
- 标签上限 8 个；不提供插件系统与云同步。

[1.0.0]: https://github.com/fate147/md-viewer/releases/tag/v1.0.0
