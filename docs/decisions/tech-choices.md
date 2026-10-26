# 🧭 技术决策记录（Tech Choices）

> 文档状态：追加式决策（只增不改，推翻时追加勘误条目） ｜ 最后更新：2026-10-01

> 编号追加，每条记录「决策 + 原因 + 日期 + 下一步」。选型拍板当天记录，别等忘了再补。

---

## TC-001 技术栈：Tkinter + tkinterweb（否决 pywebview）

- **日期**：2026-08-14
- **决策**：保留 Tkinter 生态，预览模块采用 **tkinterweb**（纯 Tkinter HTML 渲染组件）内嵌实现 Markdown 渲染；**否决 pywebview**。
- **原因**：
  - pywebview 是独立原生窗口，**无法嵌入 Tkinter 布局**，做不到「左编辑右预览」分屏一体，只能弹窗，体验割裂。
  - tkinterweb 基于 Tkinter 原生渲染（4.25.3，活跃维护），可嵌入任意 Frame，支持 HTML/CSS 子集 + 图片 + 表格，够 Markdown 渲染用。
  - 保留现有 4 套主题资产与打包管线（PyInstaller），exe 体积小（tkinterweb 纯 Python，无 WebView2 runtime 依赖）。
- **权衡**：tkinterweb 无完整 CSS3/JS（不可用 KaTeX、highlight.js），代码高亮改用 Pygments 服务端渲染内联样式 HTML（见 TC-003）。
- **下一步**：编码阶段验证 tkinterweb 对表格/图片/代码块的实际渲染效果；不满足则回退方案 = 独立预览窗口 + WebView（pywebview）。

## TC-002 架构分层：界面与逻辑严格分离

- **日期**：2026-08-14
- **决策**：废弃单文件结构，按 `core / services / ui / assets` 四层划分（对齐规则库 R2.2）。
- **原因**：v1.0 单文件 855 行，主题/文件/语音/UI 全在一个类里，扩展即腐化；规则库明确「组件纯渲染、逻辑在 services、状态集中管理」。
- **下一步**：编码阶段按 `docs/architecture.md` 目录结构落地。

## TC-003 Markdown 渲染管线：python-markdown + Pygments + 主题 CSS

- **日期**：2026-08-14
- **决策**：渲染链路 = `md 文本 → python-markdown（extensions: fenced_code/tables/toc）→ Pygments 代码高亮（内联样式）→ 主题 CSS 注入 → tkinterweb 显示`。
- **原因**：tkinterweb 无 JS，highlight.js/KaTeX 不可用；Pygments 服务端生成带内联 class 的 HTML，由主题 CSS 着色，效果稳定且无网络依赖。
- **下一步**：数学公式（KaTeX）暂列 P2，若 tkinterweb 支持不够则用独立 WebView 预览方案承载。

## TC-004 配置：保留 JSON 配置文件并扩展

- **日期**：2026-08-14
- **决策**：继续使用 `.md-viewer-config.json`（v1.0 已有），扩展字段：窗口尺寸/最近文件/标签页列表/预览模式/字体大小。
- **原因**：零迁移成本；配置无需数据库。
- **下一步**：定义完整 schema（见 `docs/architecture.md` 数据模型）。

## TC-005 打包：PyInstaller onefile + runtime_hook 崩溃钩子

- **日期**：2026-08-14
- **决策**：沿用 PyInstaller onefile 单 exe 管线（v1.0 保留，TC-001 确认），正式版 `console=False`（windowed）；新增 `src/runtime_hook.py` 全局异常钩子（未捕获异常写 exe 同目录 `md-viewer-crash.log`）；另备 `md-viewer-dbg.spec`（console=True 调试版，崩溃可见 traceback）。
- **原因**：
  - windowed 模式崩溃无输出、用户无法反馈；崩溃钩子在 import 阶段即生效，任何未捕获异常落盘可查。
  - 调试版与正式版同 spec 结构，仅 console 开关 + exe 名不同，排障时一键构建。
- **排障教训**（本次会话卡死根因）：打包验证时 `tasklist //FI "IMAGENAME eq ..."` 在 git-bash 下查询失效（查不到明明存活的进程）→ 误判"程序没跑起来"→ 陷入无限排障循环。正确验证 = `tasklist | grep` 或 PowerShell `Get-Process`（看 `MainWindowTitle` + `Responding`）；PyInstaller onefile 是**双进程**（小内存 bootloader + 大内存 python 子进程），成对出现属正常；判断 windowed exe 是否健康用「窗口标题 + Responding」，模拟关闭用 WM_CLOSE（勿 taskkill /F 制造无痕退出假象）。
- **下一步**：无（打包完成，待家长验收）。

## TC-006 打包改用 onedir（推翻 TC-005 的 onefile 决策）

- **日期**：2026-09-30
- **决策**：`md-viewer.spec` 由 onefile 改为 onedir（`EXE(exclude_binaries=True)` + `COLLECT`），交付形态变为 `md-viewer\md-viewer.exe` + `md-viewer\_internal\`（约 75MB）。同时显式 `upx=False`。
- **原因**：本机 D 盘上**任何** PyInstaller onefile exe 都无法创建 bootloader 临时目录（`%TEMP%\_MEIxxxxxx`），启动即弹 `Could not create temporary directory` 并 exit -1，程序完全不可用。onedir 不使用临时目录，从根上绕开。
- **排查过程**（逐项排除，结论已写入 `md-viewer.spec` 顶部注释与 `AGENTS.md` 铁律）：
  - 与项目代码无关：`pyinstaller -F hello.py` 生成的 6.9MB 空 exe，**放在 C 盘能跑、复制到 D 盘即失败**。
  - 与 PyInstaller 版本无关：6.14.2 / 6.21.0 / 6.22.3 全部同样失败（6.14.2 尚无「临时目录安全描述符」逻辑，说明失败点不是 SDDL 而是 `CreateDirectory` 本身）。
  - 与临时目录位置无关：`--runtime-tmpdir` 指向一个已存在的 C 盘目录仍然失败。
  - 与权限/ACL 无关：ctypes 直接调 `CreateDirectoryW`（带与不带 SECURITY_ATTRIBUTES）在 C、D 两盘均返回成功；`whoami /user` 的 SID 与 bootloader 打印的 SDDL 完全一致。
  - 排除：磁盘空间（C 盘 798GB 空闲）、Defender 拦截、UAC manifest（双方均 `asInvoker`）、exe 网络下载标记、盘符文件系统（均 NTFS）、路径长度。
  - 结论：疑似 D 盘上的第三方文件系统过滤驱动（加密/安全软件）影响；`fltmc filters` 需管理员权限无法确认。
- **已知矛盾**：用户 9-11 打包的旧 onefile exe 在 D 盘**能正常运行**，说明该环境此后发生了变化。旧 exe 已丢失，无法对比还原。
- **连带影响**：`register.bat` 的 exe 路径改为 `%~dp0md-viewer\md-viewer.exe`；`.md` 关联由 `services/registry.py` 在 frozen 模式下取 `sys.executable`，自动指向新路径，无需改动代码。
- **收益**：onedir 启动更快（无需每次把 33MB 解包到临时目录）。
- **下一步**：无。若将来确认 D 盘无过滤驱动且问题消失，可重新评估 onefile。


## TC-007 预览引擎：新增 WebView2（Chromium）渲染路径，tkinterweb 降级为回退

- **日期**：2026-10-01
- **决策**：预览默认改用 **tkwebview2 3.5.0**（pythonnet + pywebview 4.4.1 的 EdgeChrome，把 Edge WebView2 嵌进 Tk frame）；新增 `core/web_render.py`（生成自渲染 HTML 文档，marked.js + highlight.js 页面内转换）与 `ui/webview_preview.py`（组件）。tkinterweb 路径完整保留为回退：配置 `preview_engine: auto|webview2|tkinterweb`，启动探测失败（无 Runtime / STA 注册失败 / 组件创建异常）自动落回。
- **原因**：大文档卡顿根因是 tkhtml 主线程排版（实测 ~6ms/1K 字符，373K HTML 冻结主线程 6.1s）+ python-markdown 纯 Python 转换在 GIL 下 1.2s/120K——两者在 tkinterweb 架构内无解。WebView2 排版在浏览器进程：1MB 文档注入返回 2ms，Tk 主循环最大抖动 33ms。
- **勘误 TC-001**：当年否决 pywebview 的理由是"无法嵌入 Tkinter 布局"。tkwebview2 通过 pythonnet 把 WebView2 控件 SetParent 进 Tk frame，恰好补上这块；独立窗口问题不存在。
- **关键约束**（全部实测换来，详见 webview_preview.py 模块注释）：
  - 主线程必须在建 Tk 前 `CoInitializeEx(STA)`；Tk mainloop 挪到 CLR 线程会在 dooneevent 处 PyEval_RestoreThread 崩溃。
  - .NET 事件回调线程里**只允许 queue.put**，任何 Tk 调用跨线程即崩；主线程常驻 after 轮询消费。
  - `NavigateToString` 有 2MB 上限 → 渲染文档写临时文件走 `file://` 导航（顺带 `<base href>` 支持相对图片）。
  - `ShowWindow(SW_SHOWNA)` 对宿主 Control 无效，须用 SW_SHOWNOACTIVATE(4)。
  - tkwebview2/pywebview 版本强耦合（`web_view` 属性名），钉死 pywebview==4.4.1。
- **下一步**：重打包验证 exe 内嵌 assets（`md-viewer.spec` 已加 datas 与 hiddenimports）；若体积增长明显，评估 hljs 语言子集。

---
*决策记录创建：2026-08-14；TC-006 追加：2026-09-30；TC-007 追加：2026-10-01*
