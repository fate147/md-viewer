# 规格变更流水账（changelog）

> 类型：流水账（与“主规格只写规则”分离）｜格式：日期 / 变更 / 依据 / 是否已同步代码

---

## 2026-10-26

**变更**：建立 `specs/` 体系——新增 7 个主规格（01 启动、02 文件与标签生命周期、03 双态与排版、04 主题、05 桥协议、06 配置、07 导出与复制），并将《功能地图与风险点排查.md》修订版移入 `specs/archive/`。
**依据**：用户 SDD 第二步指令；入参为确认的排查报告。
**是否已同步代码**：否（仅写 specs，业务代码未改）。

**变更**：跨语言主键决策——采用方案 A：Python 维护单调递增 `tab_seq` 为唯一跨语言主键，`id()` 仅作 Python 内部键，桥上统一传 `tab_seq`，JS `state.docs` 键即 `tab_seq`（写入 02 R-02-01）。
**依据**：排查报告 R2 + 用户拍板前置决定。
**是否已同步代码**：否（当前代码仍用 `id()`，迁移在执行阶段）。

**变更**：桥分块权威值定为 `_CHUNK=100_000`；`app.js:4` 注释“256K”须与常量一致（写入 05 R-05-01/R-05-08）。
**依据**：排查报告 R1-③ + 用户拍板。
**是否已同步代码**：**是**（2026-10-26 已改 `app.js:4` 注释 256K→100K；见「第四步演练」条）。

**变更**：死字段规则——`preview_ratio`/`sidebar_visible`/`view_mode` 执行“不读、不再写、不主动删用户已有键”（写入 06 R-06-02）。
**依据**：排查报告 R4 + 用户拍板。
**是否已同步代码**：否（当前 `save` 仍为覆盖式合并，待改保留式）。

**变更**：08-安装与关联注册 **暂缓**——`installer` 未验证，暂不建对应规格。
**依据**：用户指令 + 排查报告 §7（installer `*.cs`/`*.iss` 未读内部，`mdviewer_reg` 失败模式待确认）。
**是否已同步代码**：N/A（规格未建）。

---

## 2026-10-26（补充 · 对齐确认骨架）

**变更**：按用户确认骨架对齐 7 个主规格——02 强化 `tab_seq` 宪法级主键与双源对齐、补 R-02-06（R6 编码回写不得丢 BOM：沿用读取编码/保留 BOM/探测失败报错，禁止 `actions.py:75` 无差别强制 utf-8）；01 合并 STA+CWD 与 `__appReady` 唯一信号；03 补术语统一“编辑↔阅读”禁“预览”（R-03-08）；05 补禁止桥旁路通道（R-05-09）+ 回调按 `tab_seq` 匹配（R-05-10）；06 补 DEFAULTS 只含 v3 字段（R-06-02）；07 补 plain_text 正则唯一（R-07-03）。
**依据**：用户确认骨架；排查报告 R1-R9。
**是否已同步代码**：否（业务代码未改、未跑测试）。

---

## 2026-10-26（补充 · 第三步 确立铁律）

**变更**：更新根目录 `AGENTS.md` 为 SDD 执行入口——置顶三条铁律（先查后改 / 先改规格再改代码 / 严禁私自跑测试），明确 `specs/` 为唯一权威、`docs/` 旧体系降为历史参考（不以之为准），固化第四步标准动作（读 AGENTS+specs → 只读排查 → 用户拍板 → 先改规格再改代码 → 更新 changelog）。保留原构建命令与保留资产，测试脚本加铁律三授权标注。
**依据**：用户 SDD 第三步指令。
**是否已同步代码**：N/A（仅改工程规范入口，业务代码未动、未跑测试）。

---

## 2026-10-26（补充 · 02 审校修订）

**变更**：02 审校修订——R-02-02 补关闭时序可执行顺序（① 记 tab_seq → ② 发关闭通知令 JS 删 `state.docs[tab_seq]` → ③ Python 再 `_loaded.discard` 并移 session，禁止先 discard 再通知），依据补 `web_client.py:183`(set_tabs)/`:196`(send_text)/`app.js:219,241,245`；R-02-08「上限 8 个」补出处 `main.pyw:109`（`open_tabs[:8]`），核实为真约束（非臆测，未删）；R-02-01 术语统一「标签标识符」并钉死「tab_seq 只增不减、不复用」；`【注】` 改为 `**迁移状态**` 格式。
**依据**：审校。
**是否已同步代码**：否（仅改 specs，业务代码未同步）。

## 2026-10-26（补充 · 05 审校修订）

**变更**：05 审校修订——开头加术语约定「本规格『标签标识符』= 02 R-02-01 的 tab_seq，不使用 tab_id 一词」；R-05-07 与 02 R-02-01 的「桥上所有 tab_id」改为「桥上所有标签标识符一律传 tab_seq（不存在名为 tab_id 的独立概念；历史代码若有 tab_id 参数，其值必须等于 tab_seq）」；R-05-02 行号核实改为 `web_client.py:32-38`（_CHUNK 在 :32，勿漏）；R-05-04 `:365-372` 核实为 `_on_ready_msg` 的 `_early` 补发逻辑（确认无误，保留）；R-05-05 加限定句「本节仅定义事件名与通道；各事件业务语义归 02/03/07，05 不重复定义其行为」；`【注】` 改为 `**迁移状态**` 格式。
**依据**：审校。
**是否已同步代码**：否（仅改 specs，业务代码未同步）。

---

## 2026-10-26（补充 · 06 审校修订）

**变更**：06 审校修订——R-06-01 加限定句「原子写只保证不损坏文件，不保证不丢键；是否保留用户已有键由 R-06-03③ 的保留式合并单独约束」；R-06-05「上限 10」核实为真（`actions.py:225` 的 `recent[:10]`），补去重 `:223-224`、有 path 才记 `:221`、菜单刷新 `:227` 的确切行号；R-06-01/04 行号核实（`:58-98`=原子写+load+save，`:76-87`=load、`:90-98`=save）；R-06-06 加「与 02 咬合」：session 上限只在 02 R-02-08、recent_files 以 06 R-06-05 为源；`【注】` 改 `**迁移状态**`；R-06-05 待确认改引 `.md-viewer-config.json:25`。
**依据**：审校。
**是否已同步代码**：否（仅改 specs，业务代码未同步）。

## 2026-10-26（补充 · 02/01/03/04/07 审校修订）

**变更**：02——R-02-02 关闭时序（①记 tab_seq → ②发通知令 JS 删 `state.docs` → ③再 `_discard`+移 session，禁先 discard 再通知）、依据补 `web_client.py:183`(set_tabs)/`:196`(send_text)、`app.js:219,241,245`；R-02-08「上限 8 个」出处 `main.pyw:109`（`open_tabs[:8]`），并加「单一真相」：session 上限在 02、recent_files 以 06 R-06-05 为源。01——R-01-04 删「最多 8 个」改「上限见 02 R-02-08」，行号改为 `main.pyw:100-104`（命令行）/`:107-117`（会话恢复+欢迎）/`:73-74`、`:323-328`（`_auto_register`），纠正 `:73-74` 非命令行参数。03——R-03-04 同源写明「引用同一实现」（`editor.js:67` 调 `reader.js:39-41` 的 `structKindOf`，基于 `STRUCT_RES`/`STRUCT_MAX_LEN`）；R-03-05「≥2」核实 `reader.js:106`。04——新增 R-04-05（前端与导出只消费 `css_vars`，禁写死主题色；`app.css` 十六进制为首帧兜底）；R-04-02 补「新增主题须同步 `THEMES`+`css_vars`+导出 hljs 三处」。07——R-07-02 slug 同源统一为「双份实现+两端行号+changelog 登记」（`reader.js:11-14`、`export.py:49-52`）。
**依据**：审校。
**是否已同步代码**：否（仅改 specs，业务代码未同步）。

## 2026-10-26（验收材料）

**变更**：新增 `specs/风险覆盖对照表.md`（R1–R9 → 规格/规则编号，R8 标注「08 暂缓，changelog 有记录」，附规则计数 47 条）。
**依据**：用户验收要求。
**是否已同步代码**：N/A（文档）。

## 2026-10-26（补充 · AGENTS.md 例外条款）
变更：AGENTS.md 增补——docs/plans/implementation-plan.md 明确为 docs/ 降级后唯一例外，仅作进度追踪、不作行为依据；顶部进度台账说明同步加注。
依据：审校。
是否已同步代码：N/A（仅工程规范入口，业务代码未动）。

---

## 2026-10-26（第四步演练 · 桥分块注释）

**变更**：`app.js:4` 注释「内容按 256K 字符分块」改为「内容按 100K 字符分块」，与 `_CHUNK = 100_000`（`web_client.py:32`）一致；仅改注释，未动任何逻辑。05 R-05-01 迁移状态记为已消除。
**依据**：用户拍板（第四步演练）；R-05-01/R-05-08；D2。
**是否已同步代码**：**是**（`src/assets/app.js:4`）。

---

## 2026-10-26（第四步演练 2 · 清理 AGENTS.md 孤立括号）

**变更**：删除 `AGENTS.md` 末尾 `:130-131` 两个孤立全角右括号 `）`（手工编辑残留；删除前全文件 `（`=44/`）`=46，删除后 44/44 平衡）。仅删这两行，未动其它内容；文件由 131 行变为 129 行。
**依据**：用户拍板（第四步演练 2）。
**是否已同步代码**：N/A（仅工程规范；AGENTS.md 非业务代码）。

---

## 2026-10-26（第四步演练 3+4 · 文档漂移 D1/D7）

**变更**：D1——`src/core/session.py:5` 与 `:23` 的「ui 层 Tk Text 控件」改为「浏览器前端 assets/app.js 的 state.docs」（docstring 与行内注释同步修正；`:6` 的 cursor 未动，留待 R-02-04）。D7——`src/ui/welcome.py:15`「编辑 ↔ 预览」→「编辑 ↔ 阅读」、`:22`「在编辑和预览之间切换」→「在编辑和阅读之间切换」。仅改文字，未动逻辑；`theme.py`/`web_client.py` 的技术用法未动。
**依据**：用户拍板（第四步演练 3+4）；02 R-02-05（D1）、03 R-03-08（D7）。
**是否已同步代码**：**是**（`session.py:5,23`、`welcome.py:15,22`）。
**补充**：02 R-02-05 迁移状态已消除。

---

## 2026-10-26（第四步任务 5 · 死字段治理落地 R-06-03）

**变更**：`src/core/config.py:34-35` 从 `DEFAULTS.layout` 删除 `preview_ratio`/`sidebar_visible`/`view_mode`，只留 `reading_mode`；`src/core/config.py:90-98` 的 `save` 改为保留式合并（现有文件 ← data ← DEFAULTS），并加读失败降级：文件不存在/解析失败时 `existing={}` 继续写，不中止、不丢数据。未改 `.md-viewer-config.json`（保留用户已有键）；06 R-06-03 迁移状态措辞已按审校更正。
**依据**：用户拍板（第四步任务 5）；06 R-06-02/03（R4/D3）。
**是否已同步代码**：**是**（`config.py:34-35`、`:89-110`；save 改前为 `:90-98`）。

---

## 2026-10-26（第四步任务 6·第一步 · tab_key 键出口收口，方案乙）

**变更（纯重构，行为零变化）**：
- `src/core/session.py`：`TabState` 加 `seq: int = 0`（`:23`，`0`=未分配）；`Session.__init__` 加 `_next_seq`（`:55`）；新增 `Session._alloc_seq()`（`:75-78`，只增不减、不复用）；新增模块级 `tab_key(tab)`（`:36-46`，**实现暂为 `return id(tab)`**）；`open_tab`（`:86`）与 `add_untitled`（`:93`）成为唯一 `seq` 分配点。
- `src/actions.py` 13 处 `id(...)` → `session.tab_key(...)`：`:33,34,36,50,51,101,111,121,134,154,165,171,201`（复用已有 `from core import fileio, session`，未加 import）。
- `src/main.pyw` 6 处 `id(...)` → `tab_key(...)`：`:118,186,246,250,266,293`；顶部 `:27` 新增 `from core.session import tab_key`。
- **未动**：`app.js`（零改动，键语义仍是 Python 传入的数字）；`web_client.py`（`tab_id: int` 参数名与 `id` 字段名均不变）；`actions.py:164-167` 关闭时序（留第二步）；`main.pyw:44` 注释（第二步随 seq 切换再改）。

**规格先行（铁律二）**：02 R-02-01 补「唯一键出口」（业务代码禁写 `id(tab)`/`tab.seq`，只经 `tab_key()`）+「分配规则」（`Session._next_seq` 自增、`open_tab`/`add_untitled` 唯一分配点、作废不复用），依据行号校正为实际 13 处；02 R-02-02 迁移状态补「当前代码顺序待修正（`actions.py:164` close → `:165` discard → `:167` 才通知 JS）」，修正并入第二步。

**等价性依据**：全项目 `\bid\(` 检索后，裸 `id(...)` 仅剩 `session.py:46` 的 `return id(tab)` 本体与两处 docstring 文字；`actions.py` 13 处、`main.pyw` 6 处 `tab_key(` 计数与改前 `id(` 计数一一对应（19/19）。

**依据**：用户拍板（方案乙第一步）；02 R-02-01/02；排查报告 R1-②/R2。
**是否已同步代码**：**是**（`session.py`、`actions.py`、`main.pyw`）。
**第二步待拍板**：`tab_key` 改 `return tab.seq` + 修 `_do_close` 时序。已核实零热切换风险——`tab_key` 改动必须重启 Python 进程才生效；`state.docs` 每次启动由 `app.js:20-21` 重建为空 Map；`_loaded` 属进程内集合，两侧同时归零，不存在旧 `id()` 键残留。

---

## 2026-10-26（切换 bug 修复 · 阅读层渲染归属 R-03-03）

**现象**：开 3 个文件后切换标签，阅读区永远显示最后打开的那个；按 F2 进编辑模式能看到正确文件，再按 F2 回阅读又变回错的。

**根因**：`renderedRev` 原为 per-tab `Map<id, rev>`，按标签记账「我曾渲染过 rev」，但阅读区**全局只有一份 DOM**（`app.js:14` 单个 `#reader`）。渲染 B/C 会覆盖 A 的 DOM，而 `renderedRev[A]` 仍留真账；`switchActive` 只做 `view.setState` + `swapVisibility`，从不渲染阅读层 → 切回 A 时 DOM 仍是 C。F2 往返也救不了（该标签 `rev` 未变，走跳过分支只恢复 `readerScroll`）。

**变更（全部在 `src/assets/app.js`，Python 侧零改动）**：
- `:30` `renderedRev` 由 `new Map()` 改为单值 `{ id: null, rev: -1 }`（语义 = 阅读区 DOM 当前归属）。
- `:73-100` `setMode` 的 reader 分支改用 `readerShows(state.activeId, d.rev)` 判断。
- `:102-119` 新增 `readerShows()` 与 `renderActiveReader()`：把原 reader 分支的渲染逻辑（`applyReadingClass` → `renderReader` → 记录归属 → `anchorReaderFromEditor`）抽出，供 `setMode` 与 `switchActive` 共用。
- `:142` `commitDoc` 里改为归属作废 `{ id: null, rev: -1 }`。
- `:233-236` `setTabs` 对账删除时，仅当归属确为该 id 才作废。
- `:295-299` `switchActive` 末尾按当前 mode 调 `renderActiveReader()`，并恢复该标签自己的 `readerScroll`（避免滚动位置串到上一个标签）。
- **未动** tabbar 指示色条逻辑（`:226-227` 一带）；**未加** HTML 缓存（性能单独评估）。

**规格先行（铁律二）**：`specs/03` R-03-03 由「阅读层仅在 `rev` 变化时才重渲染」改写为「**阅读区渲染归属**」——`renderedRev` 为单值 `{id, rev}`；仅当 `id === activeId && rev === d.rev` 才允许跳过；**切换标签必改归属、必须重渲染**；明确禁止用「该标签曾渲染过」推断「阅读区现在显示的是它」。同步修订禁止事项与依据表。

**定性**：**既有 bug**（规格缺陷导致的设计漏洞），与任务 6 第一步 `tab_key` 收口**无关**——同一对象 `id()` 恒定，第一步前后传给桥的是逐一相同的数字；且第一步未改动 `app.js` 任何字节。

**依据**：用户现场确认（高亮随切换、内容不随；F2 进编辑内容正确、回阅读又错）+ 拍板；03 R-03-03；排查记录 2026-10-26。
**是否已同步代码**：**是**（`app.js:30,73-100,102-119,142,233-236,295-299`）。

---

## 2026-10-26（启动可诊断性 · R-01-05/R-01-06 建立 + D-01~D-03 纪律）

**背景**：`md-viewer.exe` 启动报「未检测到 WebView2 运行时」。实际 WebView2 完全可用（`dist-app\MDViewer\runtime\python.exe.WebView2\EBWebView` 有 260 个真实文件、`Local State` 13366B 与本机 13365B 不同，证明是便携版自己生成的），真因是 `import clr` 的 CLR 装配失败（`Failed to resolve Python.Runtime.Loader.Initialize`）被 `webview_available()` 的裸 `except Exception: return False` 伪装成「环境缺 Runtime」；三个 CWD 判别实验全部失败，CWD 假设被推翻。

**变更（规格 · 铁律二先行）**：
- `specs/01` **R-01-01 改写**：删除「冻结模式必须 `chdir` 到 exe 目录」条款（归因错误）；保留 STA 与「mainloop 留主线程」；注明 `main.pyw:380-387` 为死代码（便携分发下 `sys.frozen` 恒 `False`），删除随 R-01-05 处置结论执行、**本轮不动**。
- `specs/01` **新增 R-01-05**（便携版运行时未知装配缺陷）：钉死「CWD 假设已被证伪」——三实验全失败且报错一致，且 `clr_loader/ffi/__init__.py:49-61` 用 `ffi.dlopen(绝对路径)`、`clr_loader/netfx.py:38-44` 传 `str(Path(assembly_path))` 绝对路径，CWD 不参与解析；**禁止**再用切 CWD 解释或修复；处置方向为「重新规范打包」或「专项排查 pythonnet/.NET 依赖」；补出包三前置闸（`import clr`→`CLR_OK`、`have_runtime()`→`True`、`app\main.pyw`→窗口）、`BUILD-INFO.txt`、禁止手工剪枝不留清单、禁止随包分发 `*.WebView2`；附「Documents/OneDrive 毒性」为**未验证线索**（有 `docs/archive/packaging.md:34-37`、`docs/log/2026-10.md:27` 记载，尚未实测，不得当结论）。
- `specs/01` **新增 R-01-06**（启动期检测必须报真话）：三元组 `(ok, reason, detail)`；失败必须落盘 `md-viewer-error.log`；`missing`/`broken` 文案与退出码分离（`EXIT_NO_WEBVIEW2=2` / `EXIT_RUNTIME_BROKEN=3`）；判定口径「抛异常→broken，返回布尔→missing」。
- `specs/01` 禁止事项删「未 `chdir` 就建 `Tk root`」，增「禁止用 CWD 解释 `Failed to resolve`」「禁止检测吞异常不落盘 / 用同一句『未检测到 WebView2』覆盖装配失败」；依据表补 R-01-05/R-01-06，R-01-01 行号校正为 `:372-378`。

**变更（工程纪律）**：`AGENTS.md` 新增「分发与诊断纪律 D-01~D-03」——D-01 启动检测不得吞异常（落盘 + 原因/退出码区分）；D-02 启动器缺依赖不得静默退出（`md-launcher.cs:13`）；D-03 A 级同步后必须 `diff -r src dist-app/MDViewer/app` 校验无输出（唯一允许 ico）。

**变更（代码）**：
- `src/ui/web_client.py:410-424` → `:410-450`：新增 `EXIT_NO_WEBVIEW2=2` / `EXIT_RUNTIME_BROKEN=3`；`webview_available()` 由 `-> bool` 改为返回 `(ok, reason, detail)`；`have_runtime()` 抛异常 → `broken` 并携带完整 traceback，正常返回 `False` → `missing`。
- `src/main.pyw:28-29`：import 增补两个退出码常量。`:339-345` 抽出 `_log_path()`、`_crash_log()` 复用之。`:347-361` → `:352-379`：`_guarded()` 解包三元组，`broken` 时先 `_crash_log(detail)` 落盘，再按 `reason` 分文案、分退出码。
- **未动**：`main.pyw:380-387`（frozen CWD 死代码，按用户指令等 R-01-05 结论）；`app.js` 与 `web_client.py` 其余部分。

**依据**：用户拍板（选顺序乙：先落规则再改代码）；`specs/01` R-01-05/R-01-06；三 CWD 实验（用户实测 2026-10-26）；`clr_loader/netfx.py:38-51`、`clr_loader/ffi/__init__.py:49-61`、`tkwebview2.py:141-143`。
**是否已同步代码**：**是**（`web_client.py:410-450`、`main.pyw:28-29,340-350,352-379`）。
**验证**：仅做 AST 语法解析（两文件均 OK）与调用点核对（`webview_available` 唯一调用点 `main.pyw:355` 已同步）。**未运行任何测试**，由用户本地 `python src/main.pyw` 验证。

---

## 2026-10-26（根因确认 · 便携包落点约束 + CWD 死代码删除 + 双份分发同步）

**根因确认**：把 `dist-app\MDViewer` 拷到 `%USERPROFILE%\Build\md-viewer\portable\` 后，`import clr` 输出 `CLR_OK`、`app\main.pyw` 正常出窗口——确证 **Documents / OneDrive 同步树下 .NET `Assembly.LoadFrom` 加载程序集失败**（`docs/archive/packaging.md:34-37`、`docs/log/2026-10.md:27` 早有记载）。CWD 归因彻底证伪。

**规格变更（`specs/01`）**：
- **R-01-05 定性升级**：由「便携版运行时未知装配缺陷」改为「**便携包落点约束（根因已确认）**」——整包禁止存放在 Documents / OneDrive / 任何同步树内运行；正确处置为搬到 `%USERPROFILE%\Build\md-viewer\`；保留「CWD 已证伪」与出包三闸，三闸明确要求**必须在非同步路径下执行**；原「已知线索（未验证）」升级为已确认根因并入正文；新增「已排除项（勿重复排查）」。
- **R-01-01 迁移状态**：`main.pyw:398-405` 死代码由「当前不动」改为「**已删除**」。
- 禁止事项新增「禁止把便携包放在同步树内运行或验证」；依据表 R-01-05 改名「便携包落点约束」并补 `docs/log/2026-10.md:27`。

**工程纪律（`AGENTS.md`）**：
- 打包流程插入新的 **② 搬家验证**（`robocopy` → 三道闸），原 ②③④ 顺延为 ③④⑤；明确「三项全过才允许继续」「禁止在 dist-app 原地验证（会得到假失败）」。

**代码变更**：
- `src/main.pyw:398-405`：删除 frozen 模式 `os.chdir()` 死代码及其 5 行误归因注释（便携分发下 `sys.frozen` 恒 `False`，该分支从未执行）。
- 未改动 `web_client.py`、`main.pyw:352-379`（上一轮已按 R-01-06 完成三元组 + 落盘 + 退出码分离）。

**分发同步（D-03）**：`cp -r src/.` → `dist-app/MDViewer/app/` 与 `%USERPROFILE%\Build\md-viewer\portable\app\` 两处；`diff -r` 唯一差异为 `assets/mdviewer.ico`（打包专用，D-03 允许）与 `src` 侧 `__pycache__`/日志残留；`main.pyw`、`web_client.py` 三份 sha1 全同（`8d39b0d9…` / `44fbfd8c…`）。

**依据**：用户拍板（搬家验证通过）；`specs/01` R-01-05/R-01-06；`docs/archive/packaging.md:34-37`。
**是否已同步代码**：**是**（`src/main.pyw` 删 8 行；`dist-app` 与 `Build/portable` 两份部署目录已同步）。
**验证**：仅 `ast.parse` 语法校验（两文件 OK）与 `chdir`/`frozen` 残留检索（无 CWD 残留）。**未运行任何测试**；由用户双击 `%USERPROFILE%\Build\md-viewer\portable\md-viewer.exe` 验证，异常看 `md-viewer-error.log`。

---

## 2026-10-26（开源前清理与重构 · 规格/文档/脱敏/历史重建）

**背景**：项目准备公开到 GitHub。排查发现三类问题：① 37 条历史提交含本机绝对路径与另外两个私有项目路径；② `docs/` 有 11 个 v2 架构文档已被 `specs/` 取代、留着会误导；③ 工作区多个文件含 `C:\Users\<用户>` 硬编码。

**规格与纪律**：
- `AGENTS.md` 新增 **D-04 · 仓库内禁止出现绝对路径**（统一用 `%USERPROFILE%` / `%LOCALAPPDATA%` / `tempfile.gettempdir()`；仓库内用相对路径）。
- `AGENTS.md` 的 `docs/` 降级说明同步修正（`rules/`、`bugs/`、`features/` 已删除或归档）。
- `specs/01` R-01-05 依据中的 `docs/features/packaging.md:34-37` → **`docs/archive/packaging.md:34-37`**（正文 + 依据表两处）；`specs/changelog.md` 同源引用一并修正。

**文档处置（删除 11 / 归档 7）**：
- 删除（v2 架构已失效）：`docs/rules/{core,README}.md`、`docs/bugs/{001..004,README}.md`、`docs/MODULES.md`、`docs/features/{README,statusbar,registry}.md`。
- 归档至 `docs/archive/`：`packaging.md`、`web-client.md`、`config.md`、`theme.md`、`export.md`、`plain_text.md`、`encoding.md`（其规则已并入 `specs/01~07`，`packaging.md` 的踩坑结论保留在 `specs/01` R-01-05）。
- `docs/README.md` 重写为「docs 导读」，明确 `specs/` 为唯一契约、docs 为历史参考；移除 `rules/`、`features/`、`bugs/`、`MODULES.md` 死链与私有项目简称。
- `docs/sync.py` 的 `MODULE_DOCS` 收敛为仅跟踪 `docs/architecture.md`，`FEATURE_STATUS` 清空（`docs/features/` 已移除）。

**脱敏（工作区 11 文件 24 处）**：`AGENTS.md:122,123,131,134`、`specs/01:27`、`specs/changelog:186,189,200,204,202`、`docs/archive/packaging.md:38,79`、`docs/log/2026-10.md:11`、`docs/log/2026-09.md:32`（私有项目名 → 「同类个人项目」）、`perf_baseline.py:35`（→ `tempfile.gettempdir()`）。统一替换为 `%USERPROFILE%` / `%LOCALAPPDATA%` / `~/`。

**文件清理**：删除 `installer/mdviewer-app.txt`（内容为一行失效绝对路径）、`src/runtime_hook.py`（PyInstaller 遗留，`.spec` 已不存在）；`鬼探实录.md`（2.3MB 版权样本）移出仓库至本地构建目录；`.gitignore` 全量重写（新增 `.workbuddy/`、`*.log`、`docs/MODULES.md`、虚拟环境、密钥、编辑器与系统文件等）。

**新建**：`README.md`（项目门面：特性 / 架构 / 快速开始 / 已知限制 / SDD 说明）、`LICENSE`（MIT）。

**暂缓项**：`docs/plans/implementation-plan.md` 新增「暂缓项」表——**08 安装与关联注册规格**、**重写打包脚本**。

**历史重建**：采用路线 A，`git checkout --orphan clean` 以脱敏后的当前快照作为首次提交；`user.email` 改为 GitHub 隐私邮箱（`@users.noreply.github.com`）。旧 37 条提交仅保留在本地 `main` 分支，不推送。

**依据**：用户拍板（任务 7 + 补充要求）；`AGENTS.md` D-04；开源脱敏清单。
**是否已同步代码**：**是**（`perf_baseline.py:35`、`docs/sync.py:29-42`、`AGENTS.md`、`specs/01`）。
**验证**：全项目本机用户名 / 私有项目名检索已归零（排除已删除文件与本地数据目录）；`ast.parse` 校验 4 个改动文件全通过；**未运行任何测试**。

---

*（后续每次规格更新在此追加一行；主规格文件本身只写规则、不写流水账。）*
