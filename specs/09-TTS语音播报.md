# 规格 09 · TTS 语音播报

> 类型：主规格（机制契约）｜建立：2026-11-19｜来源：计划 `plans/20261119-tts-voice-readout.md`（决策 D-01~D-07 全按推荐拍板）
> 本规格规定 TTS 语音播报的机制与契约。产品口径（功能清单/数值）见 `specs/00`，桥方法/事件登记见 `specs/05`，配置字段见 `specs/06`，朗读文本来源见 `specs/07`。
> 迁移状态：⏳ 待同步（Phase 0 规格先行，代码于 Phase 2~5 实现）。

## 适用范围

朗读当前文档（全文或选中文字）、语音合成引擎、分块与流式播放、播放控件、手动缓存、失败降级。覆盖 `src/services/tts.py`、`src/actions.py`、`src/main.pyw`、`src/ui/web_client.py`、`src/assets/app.js`、`src/assets/app.html`、`src/assets/app.css`。

## 必须遵守的规则

**R-09-01【引擎与音色】** 采用 edge-tts（微软 Edge 朗读端点，云端神经合成、免费、无 key、**需联网**），非本地系统语音、非 Azure 付费。默认音色 `zh-CN-XiaoxiaoNeural`（晓晓），默认语速 `+0%`。音色/语速取值以 `tts.py` 的常量集合为唯一源；非法值回落默认。降级不自动切本地（D-07），保留手动切换扩展位。
- 依据：计划 D-05/D-07；`services/tts.py`

**R-09-02【分块与流式 · 背压同步】** 朗读文本按句读/段落边界切成 **1200 字/块**（约 8 分钟音频，卡在服务端 10 分钟上限内）；禁止整篇一次性合成。必须**边合成边播**（流式），**严格播完一块再合成下一块**（R-09-12 的背压门控），单任务串行、一个在途。禁止"全速合成完再播"——合成速度远快于播放（数分钟音频几秒即合成完），若不等播放确认就全量下发 + 提前发 `ttsDone`，会导致播放队列被 `ttsDone` 的清理逻辑掐断（2026-11-19"播到一半停"根因）。分块器在 `tts.py` 实现，禁止别处另写切分逻辑。
- 依据：计划 D-05；端点 10 分钟上限 / 4096 字节分块 / OOM 风险；2026-11-19 播放中断排查；`services/tts.py`

**R-09-03【后台线程纪律】** 合成必须在独立线程 + 独立 `asyncio` 事件循环执行，**绝不占用 Tk 主线程**；状态/进度/错误经线程安全队列回传主线程（延续 `web_client.py` 的队列收敛铁律）。禁止在 `_on_web_event` 或轮询器内直接跑合成协程——否则 `_POLL_MS` 轮询停摆、桥回调超时误判。
- 依据：计划 `main.pyw` 轮询约束；`services/tts.py`、`main.pyw`

**R-09-04【朗读文本来源】** 朗读文本经 `actions.py` 的 `speak` 走 `request_text` 异步取整篇（处理 `None`），再经 `services/plain_text.py` 的 `to_plain_text` 去标记；**只朗读、不改原文**。选中文字朗读取页面编辑器选区，同样去标记。禁止另写 Markdown→纯文本转换（见 07 R-07-03）。
- 依据：计划 D-02；`actions.py`、`plain_text.py`

**R-09-05【播放控件】** 状态栏上方呈现轻量播放条（播放/暂停/停止 + 块进度 + 缓存开关），样式吃主题 CSS 变量、遵循外壳克制口径（见 00 应用外壳视觉法）。控件状态由 Python 经下行方法 `set_tts_state` 驱动（见 05 R-05-12），页面只呈现、不自行持有播放状态。
- 依据：计划 D-03；`app.html`、`app.css`、`app.js`、`web_client.py`

**R-09-06【缓存：手动、默认关】** 缓存开关**默认关闭**；仅用户在播放条/菜单显式开启的文档，其合成音频按块落盘 MP3。缓存粒度为**按文档记住标记**（存 `tts.cache_docs`，见 06），目录 `%LOCALAPPDATA%/MDViewer/tts-cache/`（仓库内不写本机绝对路径，D-04）。缓存键 = 音色 + 语速 + 块文本哈希；文档内容变更使对应块失效重合成。命中缓存直接本地播放，不再请求云端。
- 依据：计划 D-04；`config.py`、`services/tts.py`

**R-09-07【缓存管理】** 提供缓存管理入口：查看占用、删除单文档、清空。**禁止自动 LRU/定时删除**——缓存是用户手动选择保留的内容，系统只提示占用，不替用户删。
- 依据：计划 D-04；`services/tts.py`

**R-09-08【失败与降级】** 429/403 等端点错误采用指数退避 + jitter 重试（上限 4 次）。失败分两类处理：
- **空音频（NoAudioReceived / 输出 0 字节）**：非致命。记日志 + 上抛非致命 `ttsSkip` 事件（状态栏临时提示"第 N 段无音频，已跳过"），**跳过该块继续合成后续块**，不终止整篇。这样单块异常不会让一篇（尤其短文档）整体播放失败。
- **其他端点错误（429/403/网络等）重试耗尽**：致命。经状态通道提示用户并**停止播放**，不留半截状态。

全部块都因空音频失败时，最终 emit `ttsError(fatal)` 提示用户。错误一律落 `md-viewer-error.log`（延续 D-01 不静默原则）。禁止静默吞异常。
- 依据：计划 D-07、分发纪律 D-01、2026-11-19 短文档 `NoAudioReceived` 排查；`services/tts.py`

**R-09-11【错误态不被停止态覆盖】**（2026-11-19 建立）致命错误（ttsError fatal）发生后，播放条须保留错误提示，禁止被紧随的 `ttsState: stopped` 清除。Python 侧致命错误后不再 emit `stopped`；JS 侧 error 分支清空音频队列/音频元素但保留播放条与错误文案，用户再次点播放时清除旧错误文案并从头开始。手动停止（stop）仍正常收起播放条。
- 依据：2026-11-19 短文档播放失败后播放条消失排查；`services/tts.py`、`app.js`

**R-09-12【背压门控：播完一块再合成下一块】**（2026-11-19 建立）合成与播放必须严格串行同步：
- Python 侧每合成一块并发 `ttsChunk`（带 `index`）后，**阻塞等待**对应 `ttsChunkPlayed(index)` 确认，才合成下一块；收到 `stop` 可中断等待。
- JS 侧每次 `Audio` 播放结束（`ended`）经上行事件 `ttsChunkPlayed(index)` 回传确认；播放出错（`error`）也须回传（携带同一 index），避免后端永久等待。
- `ttsDone` 只在**最后一块播放确认后**发出，禁止在合成完成时提前发出。非缓存会话的临时音频目录须等 `ttsDone`（播放真正结束）后才清理，禁止提前删除正在播放的音频。
- 该确认事件登记于 05 R-05-05，经 `__drain` 上行、`_on_web_event` 派发至 TTS 控制器。
- 依据：2026-11-19「播到一半停」根因（合成完成早于播放完成，ttsDone 提前清理队列）；`services/tts.py`、`app.js`、`main.pyw`

**R-09-09【性能不回归】** 安装 TTS 后"不朗读态"的打开时间/F2 切换耗时须与现状持平（依赖懒加载：未点播放不 import edge-tts）；朗读态不得阻塞主线程、不得触发桥回调超时。验收以 `perf_baseline.py`（授权后）同机对照为准。
- 依据：计划 Phase 6；`main.pyw`、`services/tts.py`

**R-09-10【桥契约】** 上行事件 `ttsPlay`（含 scope: full|selection，selection 可带 `text`）/ `ttsPause` / `ttsResume` / `ttsStop` / `ttsCacheToggle` / `ttsCacheManage`（打开缓存管理）登记于 05 R-05-05 并经 `_on_web_event` 派发；下行方法 `set_tts_state` 经既有 `evaluate_js` 通道，禁止旁路（延续 05 R-05-09）。音频播放 URL 由缓存目录经虚拟 host 映射（沿用字体映射方案，R-04-04），page 侧只播放、不持有合成状态。
- 依据：计划 Phase 3；`main.pyw`、`web_client.py`、`app.js`

## 禁止事项

- 禁止整篇一次性合成、禁止在主线程跑合成协程（R-09-02/03）。
- 禁止朗读时改动原文、禁止另写纯文本转换（R-09-04）。
- 禁止默认开启缓存、禁止自动删除用户缓存（R-09-06/07）。
- 禁止静默吞合成错误、禁止自动切本地音色（R-09-08/R-09-01）。
- 禁止新增绕过 `__app.*` / `_on_web_event` 的桥旁路（R-09-10）。

## 与其它规格的依赖

- 依赖 **00**（F26 功能清单与播放条外壳口径）、**05**（事件/下行方法登记）、**06**（`tts` 配置字段）、**07**（`plain_text` 唯一纯文本规则）。
- 依赖 **03**（`request_text` 取文契约由 02/05 定义，朗读不另开通道）。

## 依据

| 规则 | 来源 | 文件/符号 |
|---|---|---|
| R-09-01 | 计划 D-05/D-07 | `services/tts.py` |
| R-09-02 | 计划 D-05 | `services/tts.py` |
| R-09-03 | 计划轮询约束 | `services/tts.py`、`main.pyw` |
| R-09-04 | 计划 D-02 | `actions.py`、`plain_text.py` |
| R-09-05 | 计划 D-03 | `app.html`、`app.css`、`app.js`、`web_client.py` |
| R-09-06 | 计划 D-04 | `config.py`、`services/tts.py` |
| R-09-07 | 计划 D-04 | `services/tts.py` |
| R-09-08 | 计划 D-07 / D-01 | `services/tts.py` |
| R-09-09 | 计划 Phase 6 | `main.pyw`、`services/tts.py` |
| R-09-10 | 计划 Phase 3 | `main.pyw`、`web_client.py`、`app.js` |
