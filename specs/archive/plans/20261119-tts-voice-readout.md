# 2026-11-19 · TTS 语音播报（方案 B：edge-tts 云端神经音色 + 手动缓存）

> **状态**：Phase 0~7 全部 ✅（已归档）。Phase 7 收口：changelog 改标「已同步代码」、F26 标 ✅、`specs_check.py` 补 F26 符号映射、TODO 推进、本计划从 `plans/` 归档至 `specs/archive/plans/`。未提交（提交由用户决定）。
>
> **补丁（2026-11-19 晚 · 短文档播放失败）**：修 R-09-08（空音频 NoAudioReceived 非致命、跳过该块继续）+ 新增 R-09-11（致命错误态不被 stopped 覆盖）。代码：`tts.py` 三态返回 + skip 统计 + fatal 抑制 stopped；`main.pyw` 转发 ttsSkip 状态栏提示；`app.js` error 保留文案/清队列、playing 清旧错误。离线单测 `ALL_PASS`（三态/全跳过 fatal/部分跳过继续/fatal 后无 stopped），闸门 PASS。
>
> **补丁（2026-11-19 晚 · "播到一半停"背压修复）**：根因=合成全速完成早于播放、ttsDone 提前清理队列。R-09-02 改"严格播完一块再合成下一块"，新增 R-09-12 背压门控（每块等 `ttsChunkPlayed` 确认、`ttsDone` 延后、临时目录延后清理），05 R-05-05 登记 `ttsChunkPlayed`。代码：`tts.py` 加 `_await_played` + `notify_chunk_played` + stop 唤醒；`main.pyw` 派发 ttsChunkPlayed；`app.js` 队列带 index、ended/error 回传确认。定位中修复 `_await_played` 漏 import asyncio 的真实 bug。离线单测 `BACKPRESSURE_OK` + `ALL_PASS`，闸门 PASS。
>
> **输入材料**：
> - 本轮对话的技术结论（B 路线 / 分块流式 / 后台线程 / 手动缓存 / 无 SLA 需降级）
> - `AGENTS.md`、`specs/00`、`specs/05`、`specs/06`、`specs/07`
> - `src/ui/web_client.py`、`src/actions.py`、`src/main.pyw`、`src/assets/app.js`、`src/core/config.py`、`tools/specs_check.py`
>
> **适用范围**：MD Viewer 当前工作树。默认 `chrome=custom`（页面内自绘菜单/状态栏）。
> **路径纪律**：缓存目录运行时用环境变量拼接（如 `%LOCALAPPDATA%`），仓库内不写任何本机绝对路径（D-04）。

---

## 0. 一页结论

- **方向已拍板**：B 路线——`edge-tts` 连微软 Edge 朗读端点（云端神经音色、免费、无 key、需联网），中文默认 `zh-CN-XiaoxiaoNeural`（晓晓）。
- **三条不可破的实现纪律**：
  1. **合成放独立后台线程 + 自己的 asyncio 事件循环**，绝不占 Tk 主线程（否则 `_POLL_MS=20` 轮询停摆 → UI 冻结 + 桥回调 5s 超时误判）。
  2. **按块 1000~1300 字切分 + 流式边合成边播**，绝不整篇一次性合成（10 分钟音频上限 / 4096 字节分块 / OOM 风险）。
  3. **缓存是手动开关、默认关**，用户显式选保留才落盘 MP3；不做自动 LRU 删除。
- **最大风险**：该端点是微软非官方协议、无 SLA，2025-12 与 2026-10 各变过一次。故**降级兜底是必需项**，缓存同时充当"端点失效后仍可听"的保险。
- **先规格后代码**：Phase 0 规格修订 → Phase 1 依赖探测 → Phase 2~5 代码 → Phase 6 验证 → Phase 7 收口归档。

---

## 1. 已拍板 vs 待拍板

**已拍板（本轮对话）**：B 路线；中文优先音色；分块流式；后台线程不卡 UI；缓存在本地、手动开启、默认不留文件；手动管理缓存不自动删。

**待拍板（实施前必须确认，确认只决定是否做，不等于自动执行）**：

### D-01 规格承载方式（首要）
- **推荐**：新建 `specs/09-TTS语音播报.md` 承载 TTS 机制契约（08 是"安装与关联注册"暂缓，与 TTS 无关；TTS 是独立功能域，塞进 00/05/06/07 会碎），并同步修订 `AGENTS.md` 规格体系说明（编号补 09）。
- 备选：不新建，全部拆进现有规格（00 功能清单+口径 / 05 桥 / 06 配置 / 07 纯文本来源）。
- **批准结果**：待选。

### D-02 朗读范围
- **推荐**：全文朗读 + 选中文字朗读（小说走全文，文档走选中），入口分别放菜单与右键/快捷键。
- 备选：仅全文。
- **批准结果**：待选。

### D-03 播放控件形态
- **推荐**：状态栏上方一条轻量播放条（播放/暂停/停止 + 块进度 + 缓存开关按钮），跟随主题 CSS 变量，符合"外壳克制"口径。
- 备选：仅菜单项 + 状态栏文字提示。
- **批准结果**：待选。

### D-04 缓存开关粒度与目录
- **推荐**：按文档记住标记（"这本要留"符合你的语义），标记存配置 `tts.cache_docs`；缓存目录 `%LOCALAPPDATA%/MDViewer/tts-cache/`（安装版无 Program Files 写权限风险）。
- 备选：每次播放临时决定（关掉即失效）；缓存目录放应用基目录 `cache/`。
- **批准结果**：待选。

### D-05 默认音色 / 语速 / 分块
- **推荐**：音色 `zh-CN-XiaoxiaoNeural`，语速 `+0%`，分块 1200 字/块（约 8 分钟音频，卡在 10 分钟上限内）。
- **批准结果**：待选。

### D-06 依赖安装与"读一句话"探测授权
- **推荐**：授权。需 `pip install "edge-tts>=7.3.0"` 并联网读一句话，确认本机网络能连端点（公开资料显示 7.3.0 已适配 2026-10 变更，但未在本机实测）。
- 这是执行动作（装依赖 + 联网），必须你明确同意；且不碰项目业务代码。
- **批准结果**：待选。

### D-07 降级目标
- **推荐**：云端失败时提示并停止，不自动切本地（本地方案 Huihui 机械音，自动切换体验割裂）；保留手动切换本地的后续扩展位。
- 备选：自动切 Windows SAPI（需额外引入 pyttsx3/ctypes）。
- **批准结果**：待选。

---

## 2. 规格落点（按 D-01 推荐方案展开；若选备选则拆分）

| 规格文件 | 条目 | 修订方向 |
|---|---|---|
| `specs/09-TTS语音播报.md`（新） | 全部 R-09-xx | 引擎与音色口径、分块与流式、后台线程纪律、缓存手动规则、播放控件状态机、降级规则、性能不回归条款 |
| `specs/00` | 功能清单 + 外壳视觉法 | 新增 F26「TTS 语音播报 ✅」；播放条外壳口径（高度/克制/主题变量） |
| `specs/05` | R-05-05 / R-05-12 | 登记新上行事件 `ttsPlay` / `ttsStop` / `ttsCacheToggle` / `ttsState`；新增下行方法 `set_tts_state`（状态→播放条） |
| `specs/06` | R-06-04 / 新条目 | `DEFAULTS.tts`（voice/rate/cache_docs 等）；缓存标记持久化走既有原子写 |
| `specs/07` | R-07-03 补充 | 朗读文本来源必须复用 `plain_text.to_plain_text`（唯一纯文本规则），禁止另写去标记逻辑 |
| `specs/changelog.md` | 新增一条 | 日期/变更/依据/是否已同步代码 |
| `AGENTS.md` | 规格体系与落点速查 | 补 09 编号、TTS 落点行、FEATURE_SYMBOLS 说明 |

> 按铁律二顺序：Phase 0 先写规格 → 后续代码。标 `✅` 的功能需在 `tools/specs_check.py` 的 `FEATURE_SYMBOLS` 补对应标志符号，否则 A 项校验会报"标 ✅ 但找不到符号"；`specs/` 内禁止 `文件:行号` 引用（E 项）。

---

## 3. 分阶段实施

每阶段结束人工验收 + 更新 `specs/changelog.md`；未触及的规格不改。每阶段自成一个可回退单元。

### Phase 0 · 规格修订提案（先批后改，不碰代码）
1. 用户填写 D-01~D-07。
2. 按结果生成规格条目全文（R-09-xx 编号、00/05/06/07 修订片段、changelog 条目、AGENTS.md 落点）。
3. 写入 `specs/` 与 `AGENTS.md`，状态标「待同步」。
4. 验收：`specs_check.py` 的 E 项（无行号引用）与格式自检通过（跑脚本需授权；未授权时人工核对）。

### Phase 1 · 依赖安装与端点探测（需 D-06 授权）
1. `pip install "edge-tts>=7.3.0"`（不改 `requirements.txt` 之外的环境）。
2. `requirements.txt` 增 `edge-tts>=7.3.0`。
3. 联网"读一句话"验证：能返回 MP3 + 字幕边界即通过；失败则记录错误落盘，回到 D-07 讨论降级。
4. 验收：本机确认可用，且未改动业务代码。

### Phase 2 · TTS 核心服务 `src/services/tts.py`（新增，无 UI）
1. 引擎封装：`edge_tts.Communicate` 流式合成，音色/语速可配；版本与端点常量集中。
2. 分块器：按句读/段落切 1000~1300 字块，块哈希 = 音色+语速+文本。
3. 后台线程：独立 `asyncio` 事件循环 + 线程安全队列，回传"块就绪/进度/错误"；提供 start/pause/stop。
4. 重试：429/403 指数退避 + jitter（上限 4 次），错误经队列上抛，不静默。
5. 缓存管理（先写接口，开关在 Phase 5 接）：按块读写 MP3 + manifest；命中则跳过合成。
6. 验收：独立脚本喂一段中文能产出流式音频（在 `tmp/` 内，不碰原文件）；不接 UI。

### Phase 3 · 桥接与取文本
1. `src/actions.py`：新增 `speak(app, scope)` —— 走 `request_text` 取全文（异步，处理 `None`）→ `plain_text.to_plain_text` → 交 `tts.py`；`speak_stop` / `tts_cache_toggle`。
2. `src/main.pyw`：`App.__init__` 持有 TTS 控制器；`_on_web_event` 增 `ttsPlay/ttsStop/ttsCacheToggle` 分支；退出时先 stop 再销毁；下行 `set_tts_state` 推状态。
3. `src/ui/web_client.py`：新增下行方法 `set_tts_state(payload)`（经既有 `evaluate_js` 通道，R-05-09 禁旁路）。
4. 验收：事件能从页面→Python→服务→回到状态显示，链路贯通。

### Phase 4 · UI 控件与菜单
1. `src/assets/app.html`：播放条 DOM（播放/暂停/停止、进度、缓存开关）。
2. `src/assets/app.css`：播放条样式，吃主题 CSS 变量，克制动效。
3. `src/assets/app.js`：`MDV.setTtsState` 更新控件；菜单项与快捷键 `pushEvent`；选中文字朗读取 `MDV.view` 选区。
4. `src/assets/shortcuts.js` + `src/ui/main_window.py::_show_help`：快捷键单源同步。
5. `src/ui/main_window.py`：原生回退菜单加 TTS 入口。
6. 验收：按 D-02/D-03 的方案可点可达、状态回显正确、焦点与 F2/快捷键不冲突。

### Phase 5 · 缓存（手动、按 D-04）
1. 缓存开关默认关；仅用户开启的文档合成结果落盘 MP3。
2. 目录 `%LOCALAPPDATA%/MDViewer/tts-cache/`，manifest 记录 文档标识→块哈希/路径。
3. 命中缓存直接本地播（虚拟host映射或 `file://` 音频，参照字体映射方案处理 CORS）。
4. 缓存管理入口：列出占用、删单文档、清空（手动，无自动删除）。
5. 文档内容变更 → 相应块哈希失效重合成。
6. 验收：开缓存播一遍 → 关网/停服务 → 再播命中本地文件；未开缓存的文档零残留。

### Phase 6 · 性能与降级验证（测试需授权）
1. 不朗读态对照：打开时间 / F2 切换耗时与现状比，无回归（铁律三：用户说"测一下"才跑 `perf_baseline.py` / `smoke_app.py`）。
2. 朗读态：边播边编辑/切标签/保存，UI 不掉帧、桥不超时。
3. 降级：端点 403/429 时提示用户并停止，不留半截状态。
4. `tools/specs_check.py`（授权后跑）。

### Phase 7 · 收口归档
1. `specs/changelog.md` 对应条目标「已同步代码」；`TODO.md` 推进状态。
2. 分发同步（若涉及 `dist-app`）：按 D-03 跑 `diff -r src dist-app/MDViewer/app`。
3. 计划归档：`git mv plans/20261119-tts-voice-readout.md specs/archive/plans/`。
4. 提交信息：`Spec: 00,05,06,07,09`（列实际改的编号），钩子校验。

---

## 4. 逐项文件清单（工程师照抄）

| 文件 | 改动 |
|---|---|
| `specs/09-TTS语音播报.md` | **新建**：全部 R-09-xx 机制契约 |
| `specs/00` | F26 功能清单 + 播放条外壳口径 |
| `specs/05` | 事件登记 + 下行 `set_tts_state` |
| `specs/06` | `DEFAULTS.tts` 配置字段 |
| `specs/07` | R-07-03 补"朗读复用 plain_text" |
| `specs/changelog.md` / `AGENTS.md` / `TODO.md` | 留痕与落点 |
| `tools/specs_check.py` | `FEATURE_SYMBOLS` 补 F26 标志符号 |
| `requirements.txt` | `edge-tts>=7.3.0` |
| `src/services/tts.py` | **新建**：合成/分块/后台线程/缓存/重试 |
| `src/actions.py` | `speak` / `speak_stop` / `tts_cache_toggle` |
| `src/main.pyw` | 控制器持有 / `_on_web_event` 分支 / 退出停止 / 状态下行 |
| `src/ui/web_client.py` | `set_tts_state` 下行方法 |
| `src/assets/app.html` / `app.css` / `app.js` | 播放条 DOM / 样式 / 交互 |
| `src/assets/shortcuts.js` | 快捷键单源 |
| `src/ui/main_window.py` | 原生回退菜单 + 帮助文案 |
| `installer/mdviewer.iss`（**仅打包阶段单独授权**） | 便携运行时纳入新依赖 |

---

## 5. 验收矩阵（人工 / 授权脚本）

| 阶段 | 验收动作 | 依赖 |
|---|---|---|
| Phase 1 | 联网读一句话返回 MP3 | D-06 授权 |
| Phase 2 | 独立喂中文产流式音频，产物在 `tmp/` | 无 |
| Phase 3 | 事件链路贯通、状态回显 | 无 |
| Phase 4 | 全文/选中朗读可点、快捷键不冲突 | 无 |
| Phase 5 | 缓存命中后离线可播；未开缓存零残留 | 无 |
| Phase 6 | 打开/F2 无回归；朗读态不卡；降级提示 | `perf_baseline.py` / `smoke_app.py` 需授权 |
| Phase 7 | `specs_check.py` 通过、`diff -r` 无输出 | 需授权 |

**铁律三重申**：本计划不含自动运行任何测试脚本；需你明确"测一下"才执行。

---

## 6. 风险与回滚

| 风险 | 表现 | 回滚方式 |
|---|---|---|
| 端点 403/429（无 SLA） | 合成失败 | 退避重试 → 提示并停止（D-07）；缓存内容仍可听 |
| 后台线程异常 | 播放停但主 UI 存活 | 线程隔离，错误经队列上抛落 log，不拖垮 Tk |
| 缓存膨胀 | 磁盘占用增长 | 纯手动管理，不自动删；给用户占用提示 |
| 依赖装不进便携运行时 | 打包后 TTS 不可用 | Phase 1 先本机验证；打包单独授权 |
| `specs_check.py` 阻止提交 | 无法提交 | 先规格后代码，完成后再提交，不 `--no-verify` |

---

## 7. 不包含

- 不自动跑测试、不自动启动应用截图（铁律三）。
- 不构建安装包（打包单独授权）。
- 不引入本地神经模型（ToBe SAID/Piper/Kokoro，属方案 C）。
- 不改阅读区排版、分块渲染、主题色板、F2 锚点算法。
- 不在审批前删任何用户配置或清理缓存。

---

## 8. 等待你填写的答案表

| # | 问题 | 拍板结果（2026-11-19 全按推荐） |
|---|---|---|
| D-01 | 规格承载方式 | **新建 `specs/09-TTS语音播报.md`** + 改 `AGENTS.md` 规格体系 |
| D-02 | 朗读范围 | **全文 + 选中文字** |
| D-03 | 播放控件形态 | **状态栏上方轻量播放条**（主题变量驱动） |
| D-04 | 缓存粒度与目录 | **按文档记住标记**（`tts.cache_docs`）+ `%LOCALAPPDATA%/MDViewer/tts-cache/` |
| D-05 | 默认音色/语速/分块 | **`zh-CN-XiaoxiaoNeural` / `+0%` / 1200 字每块** |
| D-06 | 依赖安装与探测授权 | **授权**（Phase 1 装 `edge-tts>=7.3.0` 并联网读一句验证） |
| D-07 | 降级目标 | **失败提示并停止**，保留手动切本地的后续扩展位 |

决策已全部确定，从 **Phase 0** 开始执行。任何阶段走偏回到 Phase 0 重新提案，不得把"顺手加的小功能"未经审批带入实现。
