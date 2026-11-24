# MD Viewer 待办事项与路线图 (Roadmap)

> **本文件是全项目唯一进度状态源**（2026-10-30 起）。
> 原 `docs/plans/implementation-plan.md` 已随 `docs/` 目录清理删除，其内容并入本文。
> 其他文件一律不记状态——「现在做到哪」只看这里。
> 行为规则以 `specs/` 为准；本文只作进度追踪，不作行为依据，与 `specs/` 冲突时以 `specs/` 为准。
> 具体的开发纪律与代码修改，必须严格遵循 `AGENTS.md` 的三条铁律，并通过 `specs/` 驱动。

## 当前版本：v1.0.14（多格式 + 异常输入护栏 + TXT 正文排版 + 11 种扩展关联 + 启动首帧 + 大文档）｜产物 `dist-app\MDViewerSetup-1.0.14.exe`（219 MB，含 WebView2 离线运行时）；历史安装包只保留最新一个

> 历史：v1.0.10（启动首帧 + 大文档 20MB/100MB）· v1.0.9（TTS 语音播报）· v1.0.7（体检整改 + 窗口圆角修复）

## 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| v3.0 重构（M1+M2） | WebView2 单页双态：CodeMirror 6 编辑层 + marked 排版阅读层同页共存，F2 显隐切换；Tk 瘦身为壳；tkinterweb 双引擎退役；四主题 css_vars 化；卷/章节结构识别；双排版模式（书卷/文档自动判别） | ✅ 2026-10-11 |
| M3 打包 | PyInstaller 冻结路线判死 → 便携 Python 运行时 + C# 启动器 + Inno Setup 安装器（内嵌 WebView2 离线运行时）；静默安装 + 关联接管 + 双击 .md 仿真全部实测通过 | ✅ 2026-10-11 |
| 性能基线 | 鬼探实录 2.3MB：打开 1.23s / F2 带重渲 65ms / 切回 12ms / 全文拉取 1.22s（**2026-10-11 快照，跨机器不可比**） | ✅ 2026-10-11 |
| 性能复测 | 同机同脚本四版本交叉对比：v3.0 基线 1.49s/96ms，现行 v3.1 1.50s/93ms —— **v3.1 未引入回归** | ✅ 2026-11-01 |
| SDD 落地 | `specs/01~07` 主规格 + changelog + 覆盖表建立，`AGENTS.md` 改为规格驱动入口 | ✅ 2026-10-26 |
| 仓库清理 | `docs/` 旧体系整体删除（26 文件），视觉法与产品口径收编为 `specs/00`；仓库内僵尸 pyc 归零 | ✅ 2026-10-30 |
| v3.1 规格修订（阶段 0） | 03 补 R-03-09~13（分块渲染/大纲索引/章间跳转/中文排版口径/结构识别词表扩充）、00 补中文排版数值表+长文档性能阈值+F21~F23、06 补 R-06-07、05 补 R-05-11、02 补索引作废；changelog 已登记；**准确性校验已过（引用全属实，修正阈值口径与 auto 误判两处）** | ✅ 2026-11-01（代码未同步） |
| v3.1 阶段 1 · 中文排版细化 | `app.css` 落地 `line-break: strict` / `text-spacing-trim: space-first` / `text-autospace: normal` + 承接块缩进排除；零 JS、源文本零改写；WebView2 支持度已实测 | ✅ 2026-11-01（规格 R-03-12 已同步） |
| v3.1 阶段 2 · 卷章导航 | `buildOutline` 索引 + TOC 侧栏（`toc.js`）+ 章间跳转 Ctrl+←/→ + Tk 状态栏位置 + `toc_visible/toc_mode` + R-03-13 词表扩充；**连带修复 editor.js 装饰器既有 bug** | ✅ 2026-11-01（规格 R-03-10/11/13、R-06-07 已同步） |
| v3.1 阶段 3 · 分块渲染 | `blockify` + 占位 + `renderWindow`（预算 60 块/帧）+ 自报高度前缀和；示例 117 万字符定位准确、可滚到底 | ✅ 2026-11-01（规格 R-03-09 已同步） |
| v3.1 收尾 | 补齐计划漏项 3.7 图片高度回填 / 3.8 滚动比例前缀和口径；新增 `tools/specs_check.py` 规格-代码一致性检查 | ✅ 2026-11-01 |
| v3.1 测试修复（BUG-1~6） | 完整测试驱动：统一编辑入口 `enterEditor`（Ctrl+F 不再绕过超大书卷保护）、目录高亮缓存失效、`manual` 三态+toc_mode(always/never)+toc_visible 持久关闭、`active_tab` 恢复；收尾：书名 h1 不再当「章」、目录模式菜单、死变量清理；测试脚本隔离(B1/B2/B3)；specs 02/03/06 + changelog 已同步 | ✅ 2026-11-02 |
| 外壳现代化 第一期 | 页面内菜单栏 + 状态栏（自绘），`window.chrome=native` 回退原生；规格 00/01/04/05/06 + changelog 已同步；UI 探针全过 | ✅ 2026-11-02 |
| 外壳现代化 第二/三期 | 无边框 + 自绘标题栏（窗口按钮/拖拽/贴边/DPI，`win_chrome.py`）；`Ctrl+K` 命令面板、外壳深色跟随、动效、Win11 条件 Mica/圆角 | ✅ 2026-11-02 |
| 体检整改（IA/MO → 实施） | 按 `plans/20261106-audit-remediation.md`（01/02 两份 AUDIT）：开始页（F25）取代欢迎文档、File「最近文件/关闭文件」、`Ctrl+W`、全键盘可达、状态栏固定槽+自动保存静默、TOC 无大纲不常驻+开合保锚、Reduced Motion 含 animation、时长 token、命令面板快捷键列/勾选态/子序列匹配；规格 `00/02/03/05/06` 已同步，changelog 已记 | ✅ 2026-11-06 |
| TTS 语音播报（F26） | 按 `specs/archive/plans/20261119-tts-voice-readout.md`：edge-tts 云端神经音色（晓晓）朗读全文/选中文字，1200 字/块流式播放、后台线程不卡 UI、失败退避重试；状态栏播放条 + 菜单/快捷键；缓存默认关、按文档手动开启/管理；规格 `00/05/06/07/09` + changelog 已同步；测试（smoke/perf/GUI 端到端）经授权通过 | ✅ 2026-11-19 |
| 启动首帧修复（小框→大框） | `main.pyw` `_guarded` 建窗后第一件事 `withdraw()`+`alpha=0`；配置读取与几何计算紧跟建窗（不再排在 title/icon 之后）；`_reveal()` 早于 `_init_content()`。规格 `01` R-01-07 ④⑤⑥ + changelog 已登记。实测（`tmp/probe_verify.py`，10ms 采样）：修前先可见 216×239 小窗（1484ms）→ 2422ms 才上最终窗；修后**首个可见窗口即最终尺寸**（1672ms，无小窗记录） | ✅ 2026-11-24（`specs_check.py` PASS） |
| 大文档可读性治理（档 1+2） | `reader.js` `blockify` 相邻段落合并到 4KB（块数 97,308 → 3,540，27×）、`splitByParagraph` 四级降级切分、`measureRendered` 待测队列、`rebuildPrefix` 增量；`app.js` 大文档不建 `EditorState`（`raw` + 按需 `ensureState`）、字数/排版判别按标签缓存、`F2_EDIT_HARD_CHARS=3_000_000` 绝对上限。规格 `03` R-03-09/14/16 + changelog 已登记。实测：首屏 6.6s → 4.8–5.5s；目录跳到最后一章 0.08–0.12s 命中；2.3MB 全量与 9,211 字符小文档路径均无回归 | ✅ 2026-11-24（`specs_check.py` PASS） |
| 100MB 级文本（分段挂载） | 根因：Blink 元素高度上限 2^25 px，105MB 的 `scrollHeight` 被截在 33,554,432，后 40% 滚不到；且 `promoteStructuredHeadings` 一遇 `#` 就整篇短路，目录有 9,838 章、正文 0 个标题。改：`SEG_MAX_PX=12M` 分段挂载 + 段尾自动续读 + TOC 切段；提升逐行化并补空行；标题 id 与渲染顺序解耦（`slug-b<块>`）+ 三级定位兜底。规格 `03` R-03-09/R-03-13 已同步。实测 105.9MB：首屏 14.2s、TOC 跳最后一章命中；20.3MB 与 2.3MB 均无回归 | ✅ 2026-11-24 |
| 多格式文件查看（F27） | 新增 `specs/10`（R-10-01~06）+ `05` R-05-13 + `02` R-02-09 + `00` F27；`core/filetypes.py` 判型（扩展名 + 8KB 嗅探）；`text` 走 `renderPlain`（按行切块复用分块/分段、不做 markdown、TOC 仍识别卷章）、`image` 只读视图、`binary` 信息卡 + 系统打开；PDF 走 iframe + WebView2 内置查看器（R-10-07）；epub/mobi/azw3/rtf/odt/fb2 抽取为 Markdown 阅读（R-10-08）、html iframe（R-10-09）；编辑/保存/导出/朗读/复制全部按 `kind` 加护栏（禁止非文本写盘）。实测 `.py/.json/.txt(896KB, 106 章)/.png/.pdf/.exe` 六类通过 | ✅ 2026-11-24 |

## 🚨 核心架构遗留（高风险，需专门排期）

- [x] ~~**`tab_key` 主键完全切换（第二步）**~~ → **2026-11-01 已交付**：`tab_key()` 改为 `return tab.seq`（`session.py:47`）。跨语言键空间为 1,2,3,…，关闭后作废且永不复用，`id()` 地址复用串档隐患从根消除。依据 `specs/02` R-02-01（迁移状态：已同步）。

- [x] ~~**`_do_close` 关闭时序修正**~~ → **2026-11-01 已交付**：重排为「记 seq → 先 `set_tabs` 令 JS 删缓冲 → 再 `close_tab` + `discard`」，与主键切换同批；120ms 双源不一致窗口期消除。依据 `specs/02` R-02-02（迁移状态：已同步）。

- [ ] **新增待观察**：`main.pyw:217` `tab_by_id` 为线性扫描（上限 8 标签，无性能问题）。切到 seq 后可选改为直接索引，**非必要，暂不动**。

## ⏳ 暂缓项（明确不做，待条件成熟）

| 项 | 内容 | 暂缓原因 | 解冻条件 |
|---|---|---|---|
| 08 | 安装与 .md 关联注册规格 | `installer/*.cs` 与 `mdviewer.iss` 未逐行验证；Python 侧实现已于 2026-10-26 整体删除（`services/registry.py` + `installer/legacy/mdviewer_reg.py`），风险面收敛为 `mdviewer-assoc.cs` 单文件 | 关联注册纳入正式维护时 |
| — | 重写打包脚本 | 当前为 `AGENTS.md` 手工五步，未脚本化 | 打包频率上升或需要 CI 时 |

> 注：08 项原有的「`mdviewer_reg` 的失败模式未完全读取」一条**已作废**——该脚本随
> `installer/legacy/` 于 2026-10-26 删除，关联注册全权由 `installer/mdviewer-assoc.cs` 负责
> （见 `AGENTS.md`）。2026-10-30 仓库清理时同步修正。

## 🔍 待确认的微小隐患（随时可修）

- [x] ~~`recent_files` 中可能残留的悬空引用~~ → **2026-10-30 已确认存在**：本地
      `.md-viewer-config.json` 的 `recent_files` 含 `PRODUCT.md`（已随 `docs/` 删除）、
      `docs/MODULES.md`（已不入库），另含 3 条**其他项目**的 D 盘绝对路径。
      **未处理**——该文件已被 `.gitignore` 覆盖、不入库，清理属本地动作，
      留待下一次本地配置重置时一并处理。规则依据：`specs/06` R-06-05。
- [ ] 底层 `cm6.bundle.js` 的内部 API（未逐行验证，运行时以打包产物为准）。依据：`specs/03` R-03-08。

## 💡 下一步候选（按 backlog 优先级）

| # | 功能 | 说明 | 来源 |
|---|---|---|---|
| F20 | 提示块渲染 | `> [!NOTE]` / `> [!WARNING]` 语法 → 彩色提示框（GitHub Alerts 风格） | 2026-10-11 排版评审 |
| F15 | 自定义主题 | 用户可增改主题色（css_vars 体系已就绪） | `specs/00` 第二部分 P2 |
| F16 | 数学公式 | KaTeX 渲染（阅读层已由 Chromium 承载，可行性高于 v2 预估） | `specs/00` 第二部分 P2 |
| F17 | 导出 PDF | HTML→打印→PDF 链路 | `specs/00` 第二部分 P2 |
| F18 | 专注写作模式 | 全屏隐藏一切 UI | `specs/00` 第二部分 P2 |

## 未来的功能想法（Backlog）

- [ ] 大文件（2.3MB+）切换标签时的 HTML 渲染性能缓存（当前每次切标签会重新 render 阅读层）。
- [ ] （在这里随时添加你的新想法...）

## 已知遗留（非待办，仅记录）

- 桥回调偶发丢失已用超时重发兜底（根因在 pywebview 4.4.1 的 ContinueWith 续延，升级 pywebview 前无解）
- `MDV_BOOT_TRACE` 启动追踪打印保留（打包诊断用，默认关闭）
- `dist-app/`（打包负载）位于项目内 `C:\Projects\md-viewer`（非同步树），按 `specs/01` R-01-05 可直接原地验证；禁止复制到项目外。
- 测试/截图/临时产物统一写项目内 `tmp/`（gitignored），不再写 `%TEMP%`、`%LOCALAPPDATA%`、Documents 或桌面。

## 历史版本

- **v2.0（2026-08~09）**：Tk 分层架构 + tkinterweb/WebView2 双引擎预览（F01 分屏/F02 文件树/F07 行号等按 v2 口径部分实现，后随 v3 重构退役或改形）
- **v1.0（~2026-08）**：Tk 只读查看器起步
