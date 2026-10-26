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

## 2026-10-26（内部深度清理 · 第 1 批：死代码与废弃资产）

**背景**：开源前最后一次内部大扫除。静态排查（AST + 全仓 grep）定位死代码后，用户拍板分三批执行。本批为**无行为变更的纯删除**。

**代码删除（零引用，均已反向核验）**：
- `src/core/theme.py`：删 `theme_ids()`、`theme_names()`（原 `:180-185`，全仓零调用）。
- `src/core/session.py`：删 `Session.restore()`（原 `:125-130`，零调用——会话恢复实际由 `main.pyw:108-117` 内联实现）；`from dataclasses import dataclass, field` 去掉未使用的 `field`（`:11`，原地改写，行数不变）。
- `src/actions.py`：删未使用的 `import tkinter as tk`（原 `:16`，全文件零 `tk.` 调用，只用 `:17` 的 `filedialog`/`messagebox`）。
- `src/ui/web_client.py`：删未使用的 `import threading`（原 `:24`）。
- `src/ui/statusbar.py`：删 `StatusBar.hide()`（原 `:42-44`，零调用）。

**资产删除**：
- `installer/legacy/`（`register.bat` 27 行、`mdviewer_reg.py` 280 行）整目录删除——`register.bat` 引用的是 v2 平铺布局（`%~dp0installer\…` + `%~dp0md-viewer\…`）且要求 `pyinstaller md-viewer.spec`（该 spec 已不存在），`mdviewer_reg.py` 的 UserChoice 哈希已被 `mdviewer-assoc.cs` 逐行取代（`_wordswap`⇄`WordSwap`、`_reversible`⇄`Reversible`、`_set_user_choice`⇄`WriteUserChoice`）。历史留档见 `docs/log/2026-10.md:67`。
- `installer/mdviewer-assoc.log`（2026-10-04 运行残留）、空目录 `installer/dist-app/`（误生成的 `OutputDir` 占位）。

**D-02 落码（`installer/md-launcher.cs`）**：原 `:13` 的 `if (!File.Exists(pyw) || !File.Exists(script)) return;` 是 D-02 明令禁止的静默退出（winexe 无控制台，双击表现为「毫无反应」）。重写为 MessageBox + 分离退出码：**1**=缺 `runtime\pythonw.exe`、**2**=缺 `app\main.pyw`、**3**=调起运行时失败（含异常类型与消息），文案均给出缺失的绝对路径。用 user32 的 `MessageBoxW` 而非 `System.Windows.Forms`，以免打包命令需额外 `/r` 引用（`AGENTS.md` 打包步骤不变）。

**`.gitignore`**：新增 `mdv-it-*.md`（`test_bridge_integration.py` 在仓库根生成的三份临时文档，中途崩溃会留尸）与 `installer/dist-app/`（防误生成目录复现）。

**已知影响（须在下一批消化）**：删行导致**依据行号整体位移**，`specs/01~07` 内的 `文件:行号` 引用暂时失效：
- `src/actions.py` 自 `:17` 起 **−1**（主规格内 40 处引用）
- `src/ui/web_client.py` 自 `:25` 起 **−1**（主规格内 41 处）
- `src/core/theme.py` 自 `:188` 起 **−8**（`css_vars` 188→180、`preview_css` 210→202；主规格内 14 处，且原 `:173-185` 区间的语义已变）
- `src/core/session.py`：`:11` 原地改写、`:125-130` 位于文件尾 → **行号未变**
- `src/main.pyw`、`src/services/*`：本批未动 → **未变**

处置：并入第 2 批（还要再删 `theme.py` 的 `PYG_STYLE`/`pygments_style` 与 `main.pyw` 的 `_auto_register`，届时位移叠加）**一次性重算**，避免改两遍。

**对照表同步（C-17）**：`specs/风险覆盖对照表.md` —— `:4` 状态措辞改为「只证明风险有规则覆盖，代码同步逐条见本 changelog」（原写「代码未同步」已不成立）；`:15` R8 行改为「已判死」并写明 `registry.py:20` 必抛 `ModuleNotFoundError`、关联移交 `mdviewer-assoc.cs`；`:21` 覆盖结论补同义说明；`:28` 01 规则数 **4 → 6**（`R-01-01 ~ R-01-06`）；`:35` 合计 **47 → 49**。

**未预期的既有改动（未处理，待用户决定）**：`docs/archive/tabs.md` 工作区版本比 HEAD 少末尾「## 验收」两行，文件 mtime 为 2026-10-26 11:32（本会话只读阶段），**非本次清理造成**。已列为 C-20 保留原样，未纳入本批改动。

**未同步（待第 2 批）**：`specs/01:20-22` 的 `_auto_register` 分句与 `mdviewer_reg` 待确认条、`specs/02` R-02-01 迁移状态、`specs/04:31`、`specs/07:37`、`AGENTS.md:104` pip 行、`docs/plans/implementation-plan.md:25`。

**依据**：用户拍板（第 1 批范围 + C-16/C-18）；`AGENTS.md` D-02；内部清理候选清单 C-01~C-19。
**是否已同步代码**：**是**（`src/` 5 文件、`installer/` 3 项、`.gitignore`、`AGENTS.md` D-02 依据与「保留资产」段、`:93` 待确认项）。
**验证**：`py_compile` 语法校验 5 个改动文件全通过；已删符号（`theme_ids`/`theme_names`/`Session.restore`/`StatusBar.hide`/`web_client` 的 `threading`）反向检索零命中；保留项（`mark_dirty`、`preview_css`、`css_vars`）确认仍在。**未运行任何测试脚本**（铁律三）。

---

## 2026-10-26（内部深度清理 · 第 2 批：规格先行 + 删僵尸注册链 + 测试脚本收口）

**规格先行（铁律二，先于代码）**：
- `specs/01` R-01-04：删除尾句「冻结模式下在后台守护线程执行 `.md` 关联注册（`_auto_register`…），失败静默吞掉」，改为**迁移状态**说明（便携分发下 `sys.frozen` 恒 `False`，分支不可达；`_auto_register()` 与 `services/registry.py` 已删除）；依据行号去掉 `:73-74`、`:323-328`；原「待确认：`mdviewer_reg` 失败模式」一条删除（文件已不存在）。
- `specs/01` **禁止事项新增**：「禁止在应用进程内做 `.md` 关联注册」——并写明正确归属（`mdviewer.iss:45,51` 调 `mdviewer-assoc.exe --install/--uninstall`，`mdviewer-assoc.cs:427` 写 `Run\MDViewerAssoc` 做登录守护）。
- `specs/02` R-02-01：唯一键出口补「仓库根测试脚本同样适用，不得例外」；迁移状态补「测试脚本同步（8 处）」。
- `specs/04` R-04-05：补第二段——「代码高亮唯一实现为 highlight.js，禁止引入第二套高亮器（如 Pygments）」；`:31` 与 `specs/07` 的依赖句去掉 `pygments_style`，改为「`preview_css`/`hljs` 同源 + 导出内联 hljs CSS」；`:17`/`:40` 依据删 `:219-220`。
- `docs/plans/implementation-plan.md:25`：08 暂缓原因改为「Python 侧实现已整体删除，风险面收敛为 `mdviewer-assoc.cs` 单文件」。

**代码（规格对齐后执行）**：
- `src/core/theme.py`：删 `PYG_STYLE`（`pygments` 配色表）与 `pygments_style()`；模块 docstring 改指「高亮唯一实现是 highlight.js，本模块不参与高亮配色」。
- `src/main.pyw`：删 `import threading`、`sys.frozen` 守卫 + 起线程块、`App._auto_register()` 与 `# ==== 注册` 段落。
- `src/services/registry.py`：**整文件删除**（其 `import mdviewer_reg` 在 `installer/legacy/` 删除后必抛 `ModuleNotFoundError`，且唯一调用方已被删）。
- `smoke_app.py:48`、`perf_baseline.py:101`、`test_bridge_integration.py:78,114,117,122,125,130`：`id(...)` → `tab_key(...)`，各文件补 `from core.session import tab_key`。**实为 8 处**（首轮漏计 `perf_baseline.py`，第二轮补扫发现）。

**依据行号一次性重算（P-5）**：用 `difflib` 按 `HEAD` → 工作区实际差异生成 old→new 行映射，批量改写 `specs/01~07` 的 `文件:行号`，共 **107 处**（01:18、02:27、03:2、04:16、05:25、06:15、07:4）。`specs/archive/` 与 `specs/changelog.md` 旧条目**不动**（前者是历史证据，后者是流水账）。唯一落到删除边界的 `theme.py:185` 已人工校正为 `:99-175`（`THEMES` ~ `get()`）。
顺手校正一处**既有**错误：R-01-01 依据 `main.pyw:372-378` 在 `HEAD` 版里指向 messagebox 文案（非 STA 代码），已改为 `main.pyw:377-383`（`CoInitializeEx` 块）。

**依据**：用户拍板（第 2 批范围 + P-1~P-5 全部照准）；内部清理候选清单 C-03/C-09/C-10/C-11/C-12。
**是否已同步代码**：**是**（`theme.py`、`main.pyw`、`services/registry.py`、3 个测试脚本、4 份规格、1 份计划）。
**验证**：`py_compile` 6 个改动文件全通过；`registry|pygments|PYG_STYLE|_auto_register` 在 `src/` 与根脚本内**零命中**；裸 `id(` 仅剩 `session.py:46` 的 `return id(tab)` 本体（`tab_key` 第一步实现）；重算后抽查 5 处行号（`actions.py:224`=`recent[:10]`、`theme.py:196`=`__hljs`、`main.pyw:96-100`=argv 循环、`web_client.py:413`=`webview_available`）全部指对。**未运行任何测试脚本**（铁律三）。

---

## 2026-10-26（开源基建与收尾 · 依赖清单 / 贡献流程 / 换行策略）

本节记录**工程纪律与仓库层面**的变更（不改任何行为规则），便于日后回溯「为什么仓库长这样」。

**依赖声明（`requirements.txt`）**：锁定 3 个直接依赖（`tkwebview2==3.5.0`、`pywebview==4.4.1`、`pythonnet==3.2.0`）+ 4 个传递依赖（`bottle`/`proxy-tools`/`cffi`/`typing-extensions`）。`clr-loader==0.2.6` **不进本文件**，改用第二步 `pip install "clr-loader==0.2.6" --no-deps`——`pythonnet 3.2.0` 声明 `clr_loader>=0.3.1`，与实测可用的 `0.2.6` 冲突，同文件写入会让 pip 直接 `ResolutionImpossible`（2026-10-26 实测）。明确**不写入** `markdown`、`pygments`（代码零引用，见第 2 批）。

**一键启动（`run.bat`）**：自检 Python 3.12 → `import tkwebview2` → `clr-loader` 版本，缺什么直接打印可复制的命令；前台运行 `python.exe` 而非 `pythonw`，保证 traceback 与退出码（2/3，见 R-01-06）可见。CRLF 换行。

**对外 / 内部分工**：新建 `CHANGELOG.md` 面向使用者，**只写用户可感知的变更**；`tab_key` 收口、死代码清理、依据行号重算等内部改动只留在本文件。`CONTRIBUTING.md` 置顶硬性声明「不附带 `specs/` 修改的 PR 一律拒绝」，并写明两段式安装与验证命令。`.github/ISSUE_TEMPLATE/bug_report.md` 强制要求 `md-viewer-error.log`，`feature_request.md` 列明「不在范围内」。

**README**：顶部加开发者入口（先读 `AGENTS.md` → `specs/` → `src/`）；「工程方法」小节扩写为「架构方法：规格驱动开发」，补 7 份规格的职责表与阅读顺序；快速开始改为 `requirements.txt` 两段式。

**`AGENTS.md`**：常用命令的 `pip install` 行改为两段式（原命令装 5 个包，其中 `markdown`/`pygments` 已无引用）；文档路由表新增「对外版本记录 / 贡献流程 / issue 模板」一行。

**换行策略（`.gitattributes`）**：默认 `text=auto eol=lf`；`*.bat`/`*.cmd`/`*.ps1` 强制 CRLF（cmd 对 LF 下的 `goto`/label 解析不可靠）；`*.sh`/`*.py`/`*.pyw`/`*.cs` 强制 LF；二进制与生成物标记 `-diff`/`linguist-generated`；`specs/`、`docs/` 标记 `linguist-documentation`。实测：仓库内 blob 本就是 LF（`git add --renormalize .` 零产出），但**工作区**有 28 个文件被检出为 CRLF，已按字节归一化；同时把仓库级 `core.autocrlf` 置 `false`（属性已显式化，留着只会产生「`git diff` 为空但 `git status` 报 M」的假阳性）。

**依据**：用户拍板（5 项全按建议）；`pip install --dry-run` 冲突实测。
**是否已同步代码**：**是**（新增 8 个基建文件；`AGENTS.md` 两处；28 个工作区文件换行归一化）。
**验证**：`ast.parse` 校验 `src/` 全部 Python 文件 + 根脚本通过；`git ls-files --eol` 全仓 `w/lf`（仅 `run.bat` 为 `w/crlf`，符合属性）；脱敏自查（`C:\Users\` 等）零命中。**未运行任何测试脚本**（铁律三）。

---

## 2026-10-26（P-5 收尾抽检 · 行号引用失真修正）

本节记录**依据行号重算后的全量校验**结果，以及校验暴露出的 4 处历史失真。不改任何行为规则，只让「规格里写的行号」能真的指到代码。

**校验方法**：`ast` 导出 `src/` 全部符号定义行 → 正则抽取 `specs/01~07` 内所有 `文件:行号` → 逐条比对「行号是否越界」+「标注的符号名是否真落在该区间」。

**结论**：仓库内引用 **129 处，越界 0**；第三方库引用 12 处（`clr_loader`、`tkwebview2`、`webview/platforms`）不在仓库内，跳过。

**修正明细**：

| # | 位置 | 原文（失真） | 改为 | 性质 |
|---|---|---|---|---|
| 1 | `01:12` | 死代码 `main.pyw:398-405` | 两处 `sys.frozen` 分支，清理前位于 `main.pyw:75-76`、`:325-331`；并注明旧坐标**已废止** | 失效坐标：清理前文件仅 398 行，且**代码内从无 `chdir` 块**，该引用指向不存在的行 |
| 2 | `01:46` | `main.pyw:326-332`（`_crash_log`）、`:334-348`（`_guarded`） | `:327-331`（`_log_path`）、`:333-337`（`_crash_log`）、`:339-375`（`_guarded`） | **符号串位**：把 `_log_path` 的区间标成了 `_crash_log`，`_crash_log` 的标成了 `_guarded`。清理前（`339-345`/`347-361`）**同样串位**，非本轮造成；本轮位移量本身算对（−13） |
| 3 | `07:23`、`07:48` | `actions.py:253-265` | `main.pyw:251-263`（`copy_as_plain_text`） | 越界：`actions.py` 清理前 252 行、清理后 251 行，**任何版本都不存在 253 行**。`copy_as_plain_text` 实际一直在 `main.pyw` |
| 4 | `07:26` | `actions.py:78-100`、`:253-265` | `actions.py:78-100`（`export_html`）、`main.pyw:251-263` | 同上；因换了文件，省略式 `:253-265` 必须补全文件名 |
| 5 | `02:42`、`:43`、`:71` | `main.pyw:105` 的 `open_tabs[:8]` | `:107` 的 `s.get("open_tabs", [])[:8]` | **机械换算继承了既有偏差**：原引用 `:109` 在清理前快照里就差 2 行（实际 `:111`）。它指向了正确的函数、错误的语句——越界校验查不出，只有抽验「声称的片段是否真在那一行」才能发现 |
| 6 | `docs/architecture.md:51` | tab 身份用 `id(tab)`（对象身份） | 统一经 `tab_key(tab)`（全仓唯一出口），注明当前 `return id(tab)`、第二步 `return tab.seq` | 文档滞后：`tab_key` 收口后未同步此文件（`docs/sync.py` 的 mtime 检查提示了这条） |

**顺带订正**：本节之前那段「抽查 5 处行号」里写的 `web_client.py:413`=`webview_available`，实测 `def` 在 **`:414`**（`:413` 是空行），已按 `ast` 结果更正。

**为什么这 6 处不能靠重算解决**：`difflib` 只能保证「新旧版本的同一行」对齐，无法判断规格里那句 `（`_crash_log`）` 是否从头就贴错了符号、也无法发现「引用的行号在所有历史版本里都不存在」。第 5 项更隐蔽——**位移算得完全正确**，错的是被位移的那个起点，机械换算只会把既有偏差原样搬运。这类失真必须靠 `ast` 符号表 + 「声称片段 vs 实际行」双重交叉校验才能查出来。

**依据**：`ast` 符号表 + 全量正则比对（129 处）；用户拍板 P-5「只重算 `specs/01~07`，改完给对照表抽查」。
**是否已同步代码**：**不涉及**（纯规格文本修正，代码零改动）。
**验证**：越界引用 **0**；符号配对错配 **0**（`DEFAULTS` 为变量非函数，校验脚本按 `def|class` 判定，该条为误报）。**未运行任何测试脚本**（铁律三）。

---

*（后续每次规格更新在此追加一行；主规格文件本身只写规则、不写流水账。）*
