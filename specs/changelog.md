# 规格变更流水账（changelog）

> 类型：流水账（与“主规格只写规则”分离）｜格式：日期 / 变更 / 依据 / 是否已同步代码

---

## 2026-11-02（目录滚动卡顿 · 三处全量开销 · 已同步代码）

**现象（用户真机反馈）**：目录**能滚了但卡卡的**。

**根因** 滚动时每帧都在做三件全量工作：
① `windowize()` 每次滚动都 `innerHTML = ""` + 重造几十个节点 ——
   而滚动每 ~27px 触发一次，等于每移一行就整表重建；
② `syncActive()` 遍历 `_rows`（256+ 条）线性找目标行，每帧都跑；
③ `syncActive()` 无条件调 `getBoundingClientRect()` 触发布局，且对每个节点 `classList.toggle`。

**修复**：
· `windowize`：窗口未跨过「一屏 1/3 缓冲」时**直接返回**，不重建；
· `syncActive`：① 建 `id→行号` 映射缓存（`_rows` 变化时失效重建）；
  ② 当前章 id 未变则跳过（除非窗口刚重绘）；③ 只对目标项 `classList.add`，先移除上一个 `_activeEl`；
  ④ 只在需要自动跟随时才读一次布局。

**实测**：连续 200 次滚动事件（0 → 5373px）总耗时 **2ms**，DOM 重建 **0 次**，
最终位置正确、scrollHeight 稳定 7005。

**回归测试**：
| 脚本 | 结果 |
|---|---|
| `test_bridge_integration.py` | INTEGRATION_PASS=True（8 项全过） |

**是否已同步代码**：**是**。

---

## 2026-11-02（标签栏消失 + 目录不可滚 + F2 失效 · 已同步代码）

**用户真机反馈三条**：① 小说左边目录**不能滚动**；② **F2 切换两次后失效**；③ **标签栏没了**
（高亮跟随、文档模式隐藏、切标签不窜 —— 已确认正常）。

**根因 ①：标签栏被挤出视口**
  `body` 不是 flex 容器，`#tabbar`（36px）与 `#stack`（`height:100%`）相加 = **136%**，
  `body{overflow:hidden}` 把溢出的部分裁掉 —— 标签栏因此不可见。
  **修复**：`body` 改 `display:flex; flex-direction:column`，`#stack` 改 `flex:1; min-height:0`。
  **实测**：`tabbarH=36 + stackH=827 = bodyH=863`，`overflow=false`，标签栏正常显示。

**根因 ②：目录滚不动**
  两个叠加原因：
  · `TOC_ROW_H=24` 与 `.toc-item` 实测 **27px** 不符 —— 占位高度算错，滚动位置漂移；
  · 更关键：用户手动滚目录后，`syncActive()` 立刻检测到「当前章不在窗口内」
    又把目录**强行拉回**当前章位置 —— 表现为「怎么滚都弹回去」。
  **修复**：行高改为 27；`syncActive` 增加 `fromSidebar` 参数 + `_userScrolledAt` 时间戳，
  `USER_GRACE_MS=1200` 内不因正文滚动而回拉目录。
  **实测**：`scrollTop` 可从 6142 滚到 2000，`scrollH=7002 > clientH=827`。

**根因 ③：F2 两次后失效（双触发抵消）**
  JS 侧 `app.js` 全局 keydown 处理 F2 → `toggleMode()`；
  同时 Tk 侧 `main_window.py` 也绑定了 `<F2>` → `web.toggle_mode()` → 再调一次。
  **两次切换互相抵消**，表现为「按 F2 没反应」。前两次看似正常是时序巧合。
  **修复**：Tk 侧 `_on_f2` 加 **150ms 防重入守卫**（`monotonic` 时间戳），
  同一次按键被 JS 处理过则丢弃，并 `return "break"` 阻止 Tk 继续传播。

**验证**（浏览器加载真实 `app.html`）：
| 项 | 结果 |
|---|---|
| `toggleMode()` 连调 4 次 | 编辑/阅读交替正确（ed/rd 的 hidden 正确翻转） |
| 派发真实 F2 `KeyboardEvent` 3 次 | 三次全部翻转，`defaultPrevented` 均为 true |
| 布局 | `tabbarH=36 + stackH=827 = bodyH`，无溢出 |
| 目录滚动 | 可从 6142 滚到 2000，scrollH > clientH |

**回归测试**：
| 脚本 | 结果 |
|---|---|
| `test_bridge_integration.py` | INTEGRATION_PASS=True（8 项全过） |

**待验证**：F2 的双触发是推测（Tk 与 JS 各处理一次）。修复用了时间窗去重，
**真实窗口下需用户复验** —— 若仍失效，则根因不同，需重新排查。

**是否已同步代码**：**是**。

---

## 2026-11-02（文档模式目录未隐藏 · 启动下发污染 manual · 已同步代码）

**现象（用户真机反馈）**：文档仍显示左侧目录栏 —— 按 `toc_mode:auto` 的规定，
文档模式应隐藏目录。

**根因**：启动时 `main.pyw:92` 下发 `set_toc_visible(toc_visible)`，
而 JS 侧 `setTocVisible(true)` 会把 `manual` 置为 `true` 并写 localStorage。
但 `manual=true` 的语义是「**用户手动强制显示**」（粘性），
于是 `shouldShow()` 直接 `return true`、**跳过 auto 判定** ——
启动时的配置下发被误当成「用户点了显示」，文档模式从此永远显示目录。

**更糟的是**：这个错误状态被持久化到 localStorage（键 `mdv.toc.manual`），
**重装/重启都无法恢复**，因为每次启动又会再次写一遍。

**修复 ①（语义分离）**：新增独立初始化通道 `initTocVisible(defaultVisible)`，
只设显示状态、**不写 manual**；决策顺序为「手动显示(true) 优先 → 否则 auto 判定」。
Python 侧新增 `web_client.init_toc_visible()`，启动改走该通道；
菜单 / `Ctrl+Shift+O` 仍走 `set_toc_visible()`（用户手动，粘性）。

**修复 ②（清除被污染状态）**：localStorage 键由 `mdv.toc.manual` 升级为 `mdv.toc.manual.v2`，
并在 `initToc` 里主动 `removeItem` 旧键 —— 旧值自然失效，无需用户手动清缓存。

**实测**（浏览器加载真实 `app.html`）：
| 场景 | 结果 |
|---|---|
| 书卷模式（纯文本卷章） | `hidden=false, visible=true, docMode=false` —— 目录显示 ✅ |
| 文档模式（含 2 表格） | `hidden=true, visible=false, docMode=true` —— 目录隐藏 ✅ |
| 手动显示后 auto 不再覆盖 | `stillShown=false` ✅ |
| 手动隐藏 | `manualHide=true` ✅ |

**回归测试**：
| 脚本 | 结果 |
|---|---|
| `test_bridge_integration.py` | INTEGRATION_PASS=True（8 项全过） |
| `smoke_app.py` | SMOKE_PASS（首次 FAIL 为会话恢复干扰，清空 session 后通过） |
| `perf_baseline.py` | OPEN 1854ms / F2 114ms / BACK 16ms / PULL 1250ms —— 与上次同噪声范围，无回归 |

**是否已同步代码**：**是**。

---

## 2026-11-01（真机反馈修正 · 章节识别 + 高亮跟随 · 已同步代码）

**起因**：用户真机测试反馈三条 —— ① 滚动时目录不高亮跟随；② 目录侧栏
「没注意看」（实际只显示了 6 条卷、无章）；③ 之前疑似卡死已消失。

**根因 ①（最严重）：250 个章全部未被识别**
  `promoteStructuredHeadings` 要求卷/章行**前后都是空行**才提升为标题。
  但《鬼探实录》的真实格式是「`第一章：诡异现场` 紧跟全角缩进正文、中间无空行」，
  实测 **250 个章行全部不满足 nextBlank，目录里 0 个章**（仅 6 个卷通过）。
  **这是 v3.0 起就存在的问题，我在阶段 0 的「准确性校验」中遗漏了** —— 当时用的
  测试文本恰好带空行，未覆盖真实格式。
  **修复**：prevBlank 必须成立（防正文误伤），nextBlank 放宽为「下一行不是另一个卷/章行」。
  **实测**：outline 6 → **256 条**（6 卷 + 250 章），字数归属正常（卷 26.7 万 / 章 3.1k）。

**根因 ②：高亮不跟随**
  修完 ① 后仍不高亮。原因：目录窗口化后只渲染 56 行，当前章（如第 79 章）
  **不在 DOM 里**，`syncActive` 只查已渲染行 → 永远匹配不到。
  **修复**：先在完整行数组 `_rows` 里定位目标行索引 → 滚动侧栏使窗口覆盖它
  → 重绘 → 再高亮。
  **实测**：0%/30%/60%/90% 分别正确高亮「鬼探实录 / 第七十九章 / 第一百五十九章 / 第二百二十九章」。

**根因 ③：打开变慢（1765ms）**
  章被正确识别后，`buildOutline` 在**渲染同步阶段**读 `h.offsetTop` ——
  此时 DOM 刚被 innerHTML 换过、布局是脏的，这一次读触发全量布局，实测 **450ms**
  （786K 字符）。这与 `anchorReaderFromEditor` 是同一类问题（第二次踩到）。
  **修复**：坐标改为 `offsetTop: 0` 占位，统一由 `remeasureOutline()`
  在 rAF 里布局稳定后回填。
  **另**：新增 `structKind` 首字符预筛（第/楔/序/引/尾/终/后/番/附/结），
  全文扫描时 99% 的行直接短路，不必每行跑 6 条正则。

**附带修正**：

  · `outlineBlockIndex` 原每次全量扫描 4822 块，而 `syncActive` 每帧都调它；
    改为复用一次性构建的 id→块 映射缓存。
  · 分块路径的字数归属不再二次调 `buildRawOffsetsFor` 重扫全文，改为扫描时直接记录 charStart。

**回归测试**：
| 脚本 | 结果 |
|---|---|
| `test_bridge_integration.py` | INTEGRATION_PASS=True（8 项全过） |
| `smoke_app.py` | SMOKE_PASS（首次 FAIL 是因会话恢复了 CHANGELOG.md，清空 session 后通过 —— 测试环境问题，非代码缺陷） |
| `perf_baseline.py` | OPEN 1765ms / F2 **118ms**（修前 172ms）/ BACK 15ms / PULL 1188ms |

**性能说明**：OPEN 1765ms 高于 v3.0 基线的 1496ms，但**旧值只识别 6 个卷、0 章**；
现识别 256 个卷章，这是功能正确性带来的必要开销，仍在 `specs/00` 的 <2s 阈值内。

**是否已同步代码**：**是**。

---

## 2026-11-01（实施计划逐项核对 · 补齐 4 处与计划不符 · 已同步代码）

**起因**：用户质疑「计划是否全做完」。逐条比对 `specs/archive/implementation-plan-v3.1.md` 后，
发现 4 处与计划不符 —— 其中 1 处是**真实 bug**，此前被我笼统的「三项全做完」掩盖了。

**① 【BUG】切标签后目录串档（计划 2.10，R-03-10 补充）**
   `MDV.outline` 是模块级变量，而 `renderReader` 从不重置它；
   `buildOutline` 仅在 `_outlineMeasured` 为假时重建。结果：切到另一标签后
   目录仍显示上一个标签的卷章。
   **实测复现**：A = 3 卷 12 章，B = 2 章；切到 B 后 `outline` 仍是 12 条、目录仍列 A 的章节。
   **修复**：`renderReader` 入口显式 `MDV.outline = []` + `_outlineMeasured = false`。
   **修复后实测**：切到 B 后 `outline` = 2 条 [B一, B二]，目录 = [序, B一, B二]，无串档。

**② 目录长表行为与计划不符（计划 2.3）**
   计划要求「>200 项只渲染可见窗」；实际实现是「>400 项整表放弃 + 显示提示」，
   导致 400–2000 项的长篇完全没有目录。
   **修复**：改为真正的窗口化 —— 树扁平化为行，固定行高 `TOC_ROW_H=24`，
   上下各预渲染 20 行，前后用等高 `.toc-pad` 占位撑出滚动范围；侧栏滚动时重算窗口。
   **实测**：300 章文档 DOM 行数恒为 56（不是 301），滚到 3000px 后窗口平移到第 105–144 章，总高守恒。

**③ 高亮语义与计划不符（计划 3.5）**
   计划要求 `HL_CAP` 改为「每次进入视口时高亮」；实际只给分块路径加了去重，
   全量路径仍是「只高亮前 500 块」，第 501 块起滚动到也永远是纯文本。
   **修复**：全量路径首屏同步高亮 + 绑定滚动补高亮（`bindFullScrollHighlight`），
   视口内未高亮的块按需补上，`data-hl` 去重，单次上限 `HL_IDLE_LIMIT=200`。

**④ 锚点实现与计划不符（计划 3.6）**
   计划要求 `anchorLineFromReader` 用「前缀和二分反查」；实际是「快照数组 + 线性扫描」。
   功能等价且已优化到 <1ms，但方案不符。**修复**：分块模式改为前缀和二分定位块，
   再在块内按大纲 `blockIndex` 查找；全量模式保留快照方案（单次布局）。

**未改项（按用户拍板 B）**：计划 1.4 `normalizePunct()` 把 `--` → `——` 的字符替换
**未实施**，因用户拍板「只做 CSS 样式层，不改写源文本」（R-03-12 禁止）—— 这是决策，非遗漏。

**回归测试（用户授权）**：
| 脚本 | 结果 |
|---|---|
| `test_bridge_integration.py` | INTEGRATION_PASS=True（8 项全过） |
| `smoke_app.py` | SMOKE_PASS |
| `perf_baseline.py` | OPEN 1498ms / F2 98ms / BACK 11ms / PULL 1174ms —— 无回归 |

**是否已同步代码**：**是**。

---

## 2026-11-01（架构遗留第二步 · tab_key 切 seq + 关闭时序修正 · 已同步代码）

**变更 ①** `src/core/session.py`：`tab_key()` 由 `return id(tab)` 改为 `return tab.seq`。
跨语言键空间由内存地址变为单调递增整数（1,2,3,…），标签关闭后 seq 作废且永不复用，
消除「id() 地址被新对象复用 → JS state.docs 旧缓冲被新标签继承」的静默串档隐患。

**变更 ②** `src/actions.py` `_do_close` 重排（R-02-02 禁止颠倒的三步）：
1. 记下 `closing_key`（闭包内统一取值，避免中途重算）；
2. 先 `set_tabs(不含该标签的列表)` → JS 按差集删除 `state.docs[closing_key]`；
   `evaluate_js` 为同步调用，返回即代表 JS 已执行完毕；
3. 再 `sess.close_tab(idx)` + `_loaded.discard(closing_key)`。
修前为「先 discard 后经 refresh_all 通知」，存在 120ms 轮询窗口期双源不一致。

**实现细节（本次踩到并修正）**：② 中传入的 `active` 标记不能直接取 `remaining[0]` ——
此时 Python session 尚未 pop，须按 `close_tab` 的同一规则（越界取末位 / 前移一位）预演，
否则 JS 侧会短暂把错误的标签标为活动页。

**测试（用户授权）**：
| 脚本 | 结果 |
|---|---|
| `test_bridge_integration.py` | **INTEGRATION_PASS=True**（8 项全过，含 close_b_back_to_a / tab_a_intact 串档检查） |
| `smoke_app.py` | **SMOKE_PASS** |
| `perf_baseline.py` | OPEN 1451ms / F2 108ms / BACK 15ms / PULL 1186ms —— 与改前（1504/93/13）同噪声范围，无回归 |

**是否已同步代码**：**是**（R-02-01 / R-02-02 迁移状态均标「已同步」）。

---

## 2026-11-01（状态失真根因修复 · 一致性检查机制 · 已同步代码）

**根因**：原本的自动同步链路是 `.githooks/post-commit` → `docs/sync.py --git` →
自动生成/归档文档并自提交。提交 2ccdbca 随 `docs/` 整体退役把钩子与脚本一并删除，
但 `git config core.hooksPath` 仍指向 `.githooks`。目录不存在 → **钩子静默失效**，
且 `specs/` 是手写 Markdown、与代码零关联，没有任何机制校验二者一致。
结果：F21/F22/F23 已交付并测试，规格却长期标 ⏳。**这不是疏漏，是结构上不可能自动更新。**

**修复（机制层）**：
① 新增 `tools/specs_check.py`：机器对照「规格承诺」与「代码实际」，双向检查 ——
   - 标 ✅ 但代码缺实现符号 → 报错；
   - 标 ⏳/未做 但代码已有实现符号 → 报错（本次真实踩到的方向，初版检查器漏了它）；
   - 标「未同步」但代码已实现 → 报错。
   只收录有唯一标志性符号的功能，宁可漏检不误报。
② 重建 `.githooks/pre-commit`（`core.hooksPath` 已有配置，无需改 git 设置）：
   一致性检查失败即**阻止提交**，强制「先改规格再改代码」（铁律二）。
   已实测：故意把 F21 改回 ⏳ 后提交被成功拦下，提示为 ASCII 以防 GBK 终端乱码。
   跳过方式仅 `git commit --no-verify`。

**修复（数据层）**：
③ `specs/00` 功能清单：F05 / F21 / F22 / F23 由 ⏳ 改为 ✅ 并写明实际实现；
④ `TODO.md`：当前版本 v3.0 → **v3.1**；性能基线行标注「2026-10-11 快照，跨机器不可比」
   并新增 2026-11-01 复测行；删除「下一步候选」中已完成的 F19；补 v3.1 收尾里程碑。

**修复（补齐计划漏项）** `src/assets/reader.js`：
⑤ **3.7 图片高度回填**：原实现完全缺失 —— `img` 异步加载撑高块后前缀和不更新，
   其后的章定位会漂移。现为每个 `img` 挂 `load`/`error` 处理器，加载后只重测该块并重建前缀和；
   已缓存完成的图（`img.complete`）主动补测。
⑥ **3.8 滚动比例**：`readerScrollRatio` 原用 `scrollHeight`（占位高度抖动导致口径不一），
   改为分块模式下取前缀和总高，与不变量④「语义位置一致」对齐。

**是否已同步代码**：**是**。

---

## 2026-11-01（性能阈值口径统一 · 已同步代码）

**问题**：`specs/00` 内存在两处互相矛盾的打开时间阈值 —— 非功能需求表写「2.3MB 打开 <2s」，
长文档性能阈值表写「≤1.5s，且不比 v3.0 的 1.23s 劣化 > 30%」。同一规格两个数字，
会让 1.50s 的实测结果同时「通过」和「超标」，规格失去裁决能力（违反 `AGENTS.md`「specs 是唯一权威」）。

**变更**：
① 阈值表统一为 **< 2s**，与非功能需求表一致（用户拍板）；
② 删除「较 1.23s 劣化 >30%」相对基准 —— 1.23s 是当年机器快照，跨环境不可比，
   v3.0 代码今日同环境实测为 1.49s，用旧值作基准会把正常版本误判为回归；
③ 新增「基准唯一性」条：两处表述必须一致，禁止再引入相对劣化百分比。

**附带修正**（`README.md`）：
① 性能数字更新为 2026-11-01 实测（1.50s / 93ms / 13ms），并补一条「超长文档可读」（分块渲染能力）；
② 主题名 `purple` 更正为 `pure` —— `src/core/theme.py` 实际主题为 paper / midnight / forest / pure，
   README 自 v3.0 起即写错（2026-11-01 首次发现，非本次改动引入）。

**是否已同步代码**：**是**（仅文档，无代码改动）。

---

## 2026-11-01（v3.1 真实样本复测 · 归因完成 · 无回归）

**样本**：用户提供的真实 `鬼探实录.md`（2,317,625 字节 / 776,210 字符 / 0 个 `#` 标题 / 6 卷 253 章，共 259 个卷章节点）。与上一轮生成样本（1977 章、3955 标题）密度相差 15 倍，即为此前疑似回归的成因。

**四版本同环境交叉对比（同一台机、同一脚本、同一真实样本）**：

| 版本 | OPEN | F2_RENDER_DIRTY | F2_TOGGLE_BACK |
|---|---|---|---|
| v3.0 基线（a5455fd，未含 v3.1 任何改动） | 1496ms | 96ms | 14ms |
| 阶段 1（442d869） | 1385ms | 92ms | 13ms |
| 阶段 2（e3bb37c） | 1500ms | 97ms | 13ms |
| 阶段 3 + 性能修正（5e4ac6f，现行） | 1504ms | **93ms** | 13ms |

**结论（推翻上一轮判断）**：现行版本 F2 93ms，v3.0 基线在同环境自身测得 96ms —— v3.1 未引入 F2 回归。

**历史记录 65ms / 1230ms 不可比**：本轮中未经任何 v3.1 改动的 v3.0 代码自身测得 96ms / 1496ms。故 `specs/00` 与 `TODO.md` 记录的 65ms / 1230ms 是当年不同机器状态下的快照，不能作为今天的验收基准；四版本间 1385-1504ms / 89-97ms 的波动才是同环境真实差异。

**其它实测**：PULL_TEXT 1168ms（优于记录的 1222ms）；`smoke_app.py` SMOKE_PASS（页面就绪 + 欢迎页渲染）；`test_bridge_integration.py` INTEGRATION_PASS=True（8 项全过：桥就绪 / 文档装载 / 保存往返 / 脏标记清除 / 双标签 / A 内容完整 / B 编辑保留 / 关闭 B 回 A）。

**遗留观察（不阻塞）**：OPEN 1504ms 略超 `specs/00` 的 1.5s 阈值 4ms，而 v3.0 基线自身为 1496ms —— 说明该阈值在当前机器上本就处于边界，非 v3.1 引入。是否调整阈值待用户决定。

**是否已同步代码**：**是**。

---

## 2026-11-01（v3.1 回归测试 · 性能修正 · 已同步代码）

**测试**：按用户授权运行 `perf_baseline.py`（铁律三已由用户放行）。仓库无版权样本，临时生成 2.3MB / 1977 章等效样本（测后删除，不入库）。

**基线对比（同一台机、同一脚本、同一 863,666 字符样本）**：

| 版本 | OPEN | F2_RENDER_DIRTY | F2_TOGGLE_BACK | PULL_TEXT |
|---|---|---|---|---|
| 阶段 2（e3bb37c） | 1151ms | 152ms | 24ms | 1325ms |
| 阶段 3 原版（04dea31） | 1182ms | 185ms | 30ms | 1322ms |
| 阶段 3 + 本次修正 | 1399ms | **153ms** | 30ms | 1314ms |

结论：阶段 3 原版把 F2 从 152ms 劣化到 185ms（+22%），本次修正拉回 153ms，**与阶段 2 持平**。OPEN 时间在三次测量间波动（1151–1399ms），属测量噪声，均优于 00 规定的 ≤1.5s。

**修正的 4 处复杂度缺陷（全部为本次测试新发现）**：
1. **`buildOutline` 的 `headingPos` 是 O(n²)**：每个标题调一次 `createRange().toString()`，3955 标题实测 **9.9 秒**。已改为与分块路径共用的「原文偏移」算法（`buildRawOffsetsFor` 泛化，全量模式传 `[全文]`），降到 **629ms**，并消除了两条路径的字数口径分叉。
2. **`remeasureOutline` 逐个 `getElementById`**：改为一次 `querySelectorAll` 建 id→offsetTop 映射 + 一次性 id→块下标映射，574ms → **11ms**。
3. **`anchorLineFromReader` 在循环条件里读 `offsetTop`**：3955 个标题 = 3955 次强制布局，实测该函数 **570ms**。改为先取快照数组（单次布局）再比较。
4. **目录条目无上限**：3955 项重建一次 234ms。新增 `TOC_MAX_ITEMS=400`，超限显示「目录条目过多（N 项），已省略」，234ms → **1ms**。

**另**：渲染后的 `remeasureOutline` 移入 `requestAnimationFrame`，避免在布局脏状态下同步读取 `offsetTop` 触发全量重排。

**待确认项已解除**（见上方「真实样本复测」条）：该差距源于生成样本标题密度过高（3955 个 vs 真实 259 个），非真实回归。
**是否已同步代码**：**是**。
---

## 2026-11-01（v3.1 长文档阅读 · 阶段 3 分块渲染 · 已同步代码）

**变更**：`reader.js` 拆为双路径——`renderFull`（≤ `CHUNK_THRESHOLD=1_000_000` 字符，与 v3.0 行为一致）与 `renderChunked`（> 阈值）。分块路径由 `blockify` → 占位容器 → `renderWindow` 增量渲染构成；`CHUNK_THRESHOLD = Infinity` 即整体回滚到全量路径。
**变更**：新增 `measureRendered` / `_recalibrate` / `blockAtY` / `rebuildPrefix` / `ensureBlockRendered` / `outlineBlockIndex`；`buildOutline` 在分块模式下改从块 raw 建索引；`currentSection` / `jumpChapter` / `scrollToHeading` 全部适配分块。
**变更**：`app.css` 新增 `.md-block` / `.md-block.md-placeholder` 占位样式；`app.js` 渲染后调 `remeasureOutline`。

**实测（WebView2，117 万字符 / 4822 块）发现并修复的 6 个缺陷**：
1. **无占位导致滚动条到不了后文**：4822 块只渲染 11 块、maxScroll 仅 3293px。已为每块建占位容器并按估算高度撑开，实测总高 1,973,467px。
2. **滚动渲染卡死**：无预算时 rAF 超时 30s。已加 `RENDER_BUDGET=60` 单帧上限。
3. **高度估算严重偏低**：初版「行数 × 32px」对 240 字符/块只估 48px，实际约 380–2200px。已改为「字符数 × 每字符像素」并由实测反推校准。
4. **同帧测量拿到过期值**：真实高度 [50,46,440,380] 但前缀和得到 [0,26,52,234]。已改为「块自报高度 `_h`」，由下一帧 `measureRendered` 统一回填，禁止同帧 `getBoundingClientRect`。
5. **分块后大纲为空**：DOM 里只有占位，未渲染标题不存在，查 DOM 建索引得到空表。已改为从块 raw 建索引（117 万字符得 422 条）。
6. **初始定位落到末章**：前缀和未就绪时 `blockAtY` 返回末块。已加就绪守卫 + 首条回落（不再回退到列表末尾）。

**实测结论**：初始定位「鬼探实录」；滚动 50% → 「第11卷 · 第1章 · 50%」；滚动末尾 → 「第20卷 · 第20章 · 100%」且「尾声」正常渲染；章节字数 2868 / 卷汇总 5.8 万，与原文一致。
**是否已同步代码**：**是**（R-03-09 迁移状态已标「已同步」）。
---

## 2026-11-01（v3.1 长文档阅读 · 阶段 2 卷/章导航 · 已同步代码）

**变更（新增）**：`src/assets/toc.js` —— 卷/章目录侧栏，数据唯一来源为 `MDV.outlineTree()`（R-03-10），不重算标题、不重算 slug；点击跳转、滚动同步高亮（rAF 节流）、章节字数显示。
**变更**：`reader.js` 新增 `buildOutline()` / `outlineTree()` / `currentSection()` / `jumpChapter()` / `scrollToHeading()` / `ensureOutline()` / `remeasureOutline()`；`STRUCT_RES` 扩至 6 条（R-03-13）。
**变更**：`app.html` 加 `#toc` 侧栏 DOM 并引入 `toc.js`；`app.css` 将 `#stack` 由 absolute 叠层改 flex（编辑层/阅读层靠 `hidden` 互斥的语义不变，R-03-02 不受影响），新增侧栏样式；`app.js` 接线 TOC 刷新、`Ctrl+←/→` 章间跳转、`Ctrl+Shift+O` 目录开关、`__drain` 携带 `section`。
**变更（Python）**：`config.py` DEFAULTS 增 `layout.toc_visible` / `layout.toc_mode`（R-06-07）；`web_client.py` 增 `set_toc_visible()`（R-05-11）；`main.pyw` 增 `_on_section`（状态栏位置）/ `_on_toc_toggle` / `set_toc_visible` 并在启动时下发；`main_window.py` 视图菜单增「目录 Ctrl+Shift+O」复选。

**实测发现并修复的 4 个缺陷**：
1. **`editor.js` 既有 bug（扩充词表后必然触发）**：`buildStructDecos` 返回 `Decoration.set(b.finish())`，而 `RangeSetBuilder.finish()` 已返回 `RangeSet`，再包一层会被当成可迭代对象展开 → `TypeError: object is not iterable`。已修为 `return b.finish()`。原 bug 因首屏极少命中卷/章行而未暴露。
2. **`offsetTop` 全 0 导致定位错**：`buildOutline()` 在渲染同步阶段被调用时布局未完成，全量索引坐标失效，`currentSection` 永远返回末章。已加 `ensureOutline()` 惰性重测 + `remeasureOutline()` 在渲染后回填。
3. **「楔子」归类错误**：初版把开篇类归 `volume`，导致其所在真实卷的子章被整体挂到「楔子」名下（第二卷 chars=0、kids=0）。已定稿为开篇/收束一律归 `chapter`（R-03-13）。
4. **同章名误高亮 + 高亮残留**：`syncActive` 原按文本相等匹配，同名章会同时高亮；且首帧不清空导致残留。已改为按 `data-id` 精确匹配 + 先全清后设。

**逃生阀语义定稿（R-06-07）**：只有「手动显示」粘性；「手动隐藏」不跨越 auto 判定，切回书卷模式自动恢复显示。实测四种场景（手动隐藏→文档→回书卷→文档下强制显示）全部符合预期。

**实测（WebView2 + 真实 app.html）**：3 卷 × 5 章长文（10290 字）——目录树层级正确、卷字数为子章之和（3.4k）、章字数 674；`jumpChapter` 前进/后退/跨卷位置准确；目录点击定位准确；滚动同步高亮无残留。
**是否已同步代码**：**是**（R-03-10 / R-03-11 / R-03-13 / R-06-07 迁移状态均已标「已同步」）。
---

## 2026-11-01（v3.1 长文档阅读 · 阶段 1 中文排版细化 · 已同步代码）

**变更**：`src/assets/app.css` 落地 R-03-12 的中文排版细则——`.md-body` 基础规则新增 `line-break: strict`（避头尾）与 `text-spacing-trim: space-first`（标点挤压），保留既有 `text-autospace: normal`；并补「`.code-wrap`/`pre`/`table`/`ul`/`ol`/`hr` 之后段落不缩进」的承接块排除规则（`:196-202`）。**零 JS 介入，`state.docs` 与 `__getTextChunk` 文本零改动**（R-03-12 禁改写源文本）。
**依据**：`specs/00` 中文排版数值表；`specs/03` R-03-12；阶段 0 计划。
**实测**：WebView2（Chromium）支持度探测——`text-autospace`、`line-break`、`text-spacing-trim` 三属性均被识别（`window.CSS` 侧读取为空串＝受支持未设值）；`hanging-punctuation` 不支持，未使用。
**是否已同步代码**：**是**（2026-11-01 已落 `app.css`；R-03-12 迁移状态已标「已同步」）。
---

## 2026-11-01（v3.1 长文档阅读 · 阶段 0 规格修订）

**变更**：按用户拍板建立 v3.1 四条机制规则——03 **R-03-09**（分块渲染阈值 `CHUNK_THRESHOLD=200_000` 与五条不变量：后处理逐块生效/不卸载已渲染块/标题与首段同组/锚点语义等价/单块 4000 字符再切，回滚开关 `Infinity`）、**R-03-10**（`MDV.buildOutline()` 为大纲索引唯一数据源，四处消费者禁自算）、**R-03-11**（章间跳转落到目标块顶部而非翻页）、**R-03-12**（中文排版 CSS 优先、**禁改写源文本**，明确禁止 `--`→`——`、`...`→`……` 与插入不可见字符）。
**变更**：00 新增「中文排版数值表」（缩进 2em / `line-break:strict` / `text-spacing-trim:space-first` / `text-autospace:normal`）与「长文档性能阈值」（2.3MB ≤1.5s 且劣化 ≤30%、10MB 首屏 ≤1s、30MB 首屏 ≤2s），功能清单补 F21 目录侧栏 / F22 分块渲染 / F23 中文排版细则。
**变更**：06 新增 **R-06-07**（`layout.toc_visible` 默认 true、`layout.toc_mode` 默认 `auto`＝书卷显示/文档隐藏，复用 03 R-03-05 的 `detectDocMode`）。
**变更**：05 新增 **R-05-11**（`setTocVisible(bool)` 走既有 `evaluate_js`，禁新建 IPC 通道；大纲数据不经桥传输）。
**变更**：02 补「大纲索引随标签作废」（并入 R-02-03 对账延伸，不新增编号）。
**依据**：用户拍板 4 项（位置显示→Tk 状态栏；标点→只做 CSS 不改字符；目录策略→auto；写入范围→切 workspace）；只读排查结论 `reader.js:111`（唯一全量瓶颈）、`app.css:193-194`（`h1 + p` 相邻选择器风险）；marked v12.0.2 实测 `lexer`/`parser` 可用。实施计划见 `specs/archive/implementation-plan-v3.1.md`。
**是否已同步代码**：否（阶段 0 只改 specs/ 与台账；阶段 1~3 待逐阶段拍板后实施）。

**准确性校验（2026-11-01 同日，按用户要求逐条核对）**：对阶段 0 全部 `文件:行号` 引用做逐行提取比对，**结论：全部引用属实**（`reader.js:111/16-17/113-122/222-228/45-81`、`app.css:117-129/189-194/163-166/84-88`、`app.js:11/105-119/280-303/313-325`、`config.py:31-40`、`main_window.py:74-93`）。同时用 Node 复刻现有算法做行为实测，发现并修正 **2 处规格自身错误 + 1 处口径缺失**：
1. **阈值口径错误（已修）**：原拟 `CHUNK_THRESHOLD=200_000` 会让 2.3MB 基线（UTF-8 中文 3 字节/字 ≈ **80 万字符**）走分块路径，与「行为与 v3.0 完全一致」自相矛盾。改为 **`1_000_000`**，并在 R-03-09 写明「基线例外」；00 性能表补「渲染路径」列与字符口径。
2. **目录 auto 误判（已修）**：实测 `detectDocMode` 的「围栏+表格 ≥ 2」会把**含 2 个表格的小说**判为文档模式 → 目录被隐藏。03 R-03-05 阈值不改（不属本次范围），在 06 R-06-07 补「已知误判 + 逃生阀」：手动设置 `toc_visible` 后不被 auto 覆盖。
3. **结构识别缺口（已补）**：实测「楔子/序章/序幕/尾声/终章/番外/后记」全部识别为 `null`（`reader.js:24-36` 仅覆盖第X卷/部/章/节/回）。新增 **R-03-13**，并入阶段 2 实施，00 同步标注覆盖缺口。

**是否已同步代码**：否（同上；本轮为规格自校，未动业务代码）。

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

## 2026-10-30 · 仓库清理（P1+P2+P4）：`docs/` 整体删除、真源收编、僵尸产物清零

**背景**：SDD 已于 2026-10-26 落地，`specs/` 成为唯一权威；`docs/` 旧体系（26 个文件）被降级为历史参考后仍占位。
全仓只读排查发现四类问题，用户拍板分四批清理，本次执行 P1（磁盘残留）+ P2（文档体系）+ P4（台账归一）；
P3（配置死字段裁剪）因涉及落盘行为变更，**未执行**，留作独立规格提案。

**变更 1 · `docs/` 目录整体删除（26 个跟踪文件）**
`DESIGN.md`、`requirements.md`、`architecture.md`、`README.md`、`sync.py`、`append_log.py`、
`decisions/tech-choices.md`、`log/2026-08~10.md`、`plans/implementation-plan.md`、`archive/`（12 份）。
连带删除 `.githooks/post-commit`——其调用的 `docs/sync.py` 已不存在，且钩子唯一产物
`docs/MODULES.md` 早已被 `.gitignore` 排除、不入库，属空转机制（每次 commit 还可能制造自动 commit）。
**依据**：用户拍板（"我需要把 docs 文件夹清理掉，只保留一份 specs"）；排查证据：全仓检索"已退役资产"关键词命中 77 处，几乎全在 `docs/archive/`（`preview.md:6,60` 仍写 tkinterweb 回退路径等）。
**是否已同步代码**：**不涉及**（纯文档删除，业务代码零改动）。

**变更 2 · 两份「真源」收编为 `specs/00-视觉法与产品口径.md`（新增规格）**
仅这两份含 `specs/01~07` 未覆盖的实质内容——01~07 只规定机制（谁决策、同源、唯一数据源），不含取值：
四主题色值表（`#d4a373`/`#fdfbf7` 等）、排版细则数值（h1 1.75em / 行高 2.0 / 版心 36em / 段首缩进 2em）、
字体栈、F01–F20 功能清单与现状、非功能需求（2.3MB 打开 <2s）、验收五步。
编号用 `00` 而非 `08`：`08` 已承诺给暂缓的「安装与关联注册」规格，且 `00` 排在最前便于入口查阅。
**依据**：用户拍板（"收编为 specs/00"）；覆盖度核查：`specs/04` 仅 5 条 R-04-xx 机制规则、`specs/03` R-03-05 只写阈值位置未写色值/排版数值。
**是否已同步代码**：**不涉及**（口径文档化，代码零改动）。

**变更 3 · 进度台账归一到根目录 `TODO.md`**
`docs/plans/implementation-plan.md` 的里程碑 / 暂缓项 / 下一步候选 / 已知遗留 / 历史版本全部并入 `TODO.md`，
后者升为**全项目唯一状态源**。顺带订正 `TODO.md` 两处失真：① 08 暂缓项原写「`mdviewer_reg` 的失败模式未完全读取」
**已作废**（该脚本随 `installer/legacy/` 于 2026-10-26 删除，见 `AGENTS.md`）；② `recent_files` 悬空条目由「待确认」改为**已确认**。
**依据**：用户拍板（"并入根目录 TODO.md"）。
**是否已同步代码**：**不涉及**。

**变更 4 · 仓库内僵尸产物清零**
删除 21 个 `.pyc`（含 5 个僵尸缓存：`src/services/__pycache__/registry.cpython-312.pyc` 对应已删的 `registry.py`、
`src/__pycache__/main.cpython-312/313.pyc` 无对应 `src/main.py`、根 `__pycache__/` 下 2 个 313 缓存）。
`dist-app/`（376MB）按用户指示**原地保留、未动**。
**依据**：用户拍板（"原地保留，仅清 pyc"）。
**是否已同步代码**：**不涉及**（缓存产物，已被 `.gitignore` 覆盖）。

**变更 5 · 全仓 `docs/` 失效指针同步**
- `AGENTS.md`：`:4` 顶部说明、`:6` 台账指向、`:24-25` 规格清单（7 → 8 份，补 `00`）、「规格体系（唯一权威）」段改写、
  文档路由表（删 `docs/*` 行、补 `specs/00` 与 `TODO.md` 行）、常用命令段删 `append_log.py`/`sync.py`、
  `:161` 保留资产中「历史留档见 `docs/log/2026-10.md:67`」标注失效、已知待确认段 R-06-05 标为已确认。
- `README.md`：`架构方法`段、目录树、规格表新增 `00` 行。
- `CONTRIBUTING.md`：删除「启用 git hook」步骤，改为提示 `git config --unset core.hooksPath`。
- `.gitignore`：删 `docs/MODULES.md` 条目。
- `.gitattributes`：删 `docs/**` 语言统计行，补 `TODO.md`/`AGENTS.md`。
- `specs/01`：R-01-05 正文依据与依据表两处的 `docs/archive/packaging.md:34-37`、`docs/log/2026-10.md:27`
  删除，改为「指针失效说明（2026-10-30）」+ 保留代码依据（`clr_loader/netfx.py:38-51`、`ffi/__init__.py:49-61`）与搬家验证；**结论不变**（已确认根因）。
- `specs/06`：R-06-05 的「待确认」改为 2026-10-30 已确认（含 3 条其他项目 `D:\...` 路径），处置见 `TODO.md`。
- 未改动：`specs/changelog.md` 与 `specs/archive/` 中的历史 `docs/...` 指针**按「历史只增不改」纪律保留**，
  读者须按 `AGENTS.md` 的说明一律视为已失效。
**依据**：全仓检索 `docs/` 命中 47 处，逐条处置。
**是否已同步代码**：**不涉及**（纯指针修正）。

**未执行（留待拍板）· P3 配置死字段裁剪**
本地 `.md-viewer-config.json` 中 `layout.preview_ratio` / `layout.sidebar_visible` / `layout.view_mode` 三个 v2 死字段：
`src/core/config.py:29-38` 的 `DEFAULTS` 中**不存在**，`src/` 全量检索**引用数为 0**，
但因 `config.py:88` 的保留式合并 `_deep_merge(DEFAULTS, _deep_merge(existing, data))` 被永久保留并每次保存时重写落盘（排查报告 R4 的活样本）。
裁剪会改变落盘行为，按铁律二须先出 `specs/06` 修订提案、用户书面拍板后再动代码。**本批未动。**

**依据**：用户拍板（清理范围 P1+P2+P4；docs 整体删除只留 specs；dist-app 原地保留仅清 pyc；真源收编 specs/00；台账并入 TODO.md）。
**是否已同步代码**：**不涉及**（本批为零代码改动：仅删文档/缓存 + 修正失效指针 + 收编口径文档）。
**验证**：`git status` 显示 28 个删除 + `TODO.md` 修改 + `specs/00` 新增；仓库内 `.pyc` 计数 21 → 0；
`docs/` 目录不存在。**未运行任何测试脚本**（铁律三）。

---

## 2026-10-31

**变更（图标改版）**：应用/文件图标由「纸页 + 蓝 `Md` 字样」改为「纸白底 + 墨黑井号 + 钴蓝 M」。
- 矢量源：`installer/assets/mdviewer-icon.svg` 重写为主版（240×240，`#F7F6F3` 底 / `#1A1B1E` 井号 / `#2D5BFF` M，64px 起使用）；
  **新增** `installer/assets/mdviewer-icon-small.svg`（小尺寸专用：井号笔画由 5% 加粗到 10%，M 压到 3 单位，16/24/32/48px 使用）。
- 光栅化分流：`tools/icon/render_svg.sh` 改为按 `N<=48` 选小尺寸版。原「一张 svg 渲全部 7 档」会让井号在 16px 只剩 0.8px 笔画、
  主版在 48px 的 M 退化为蓝点；48 一并归入简化版，经渲染比对后由用户 2026-10-31 拍板。
- 重新生成 `installer/assets/mdviewer.ico`（106,808 B，7 档 16/24/32/48/64/128/256），并同步至 `dist-app/MDViewer/app/assets/mdviewer.ico`。
- **版本号 1.0.0 → 1.0.1**：`installer/mdviewer.iss:11` 的 `MyAppVersion`、`CHANGELOG.md` 新增 `[1.0.1]` 段与链接、
  `AGENTS.md` 出包命令里的产物文件名示例。安装包产物随之变为 `MDViewerSetup-1.0.1.exe`。
**依据**：用户 2026-10-31 指令「重新换个图标，打包 exe」+ 指定素材（井号 + M 方案，色值 `#F7F6F3` / `#1A1B1E` / `#2D5BFF` / 深底 `#4C7BFF`）。

**附带发现（D-03 抓出，已处置）**：出包前跑 `diff -r src dist-app/MDViewer/app`，发现打包负载是 2026-10-26 11:02 的旧快照，
与 `src`（11:35–11:48）有 7 处文件差异，并多带 3 个已作废文件：
- 代码旧于 `src`：`main.pyw`（残留已废弃的 `_auto_register` + `threading`）、`core/theme.py`（残留 `pygments_style()`/`PYG_STYLE`/`theme_ids()`）、
  `core/session.py`（`restore()`）、`ui/statusbar.py`（`hide()`）、`ui/web_client.py`（`import threading`）、
  `assets/hljs-scoped.css`（未作用域化的旧版）、`actions.py`（多余的 `import tkinter as tk`）。
- 多带文件：`services/registry.py`（`src` 已于 2026-10-26 删除，全仓 0 引用）、`runtime_hook.py`（PyInstaller 时代产物，现打包不用 PyInstaller，0 引用）、
  `md-viewer-error.log`（运行时日志被误打进包）。
**处置**：`cp -r src/. dist-app/MDViewer/app/` 同步 + 删除上述 3 个文件，复跑 `diff -r` 至**仅剩 `assets/mdviewer.ico`**（D-03 唯一允许差异）；
刷新 `%USERPROFILE%\Build\md-viewer\portable` 后重跑搬家验证三项（`CLR_OK` / `have_runtime=True` / 窗口标题 `MD Viewer - 未命名`，稳定驻留 24s 以上）。
**教训**：`dist-app` 不在版本控制内，长期停留会悄悄变旧；出包前那次 `diff -r` 不能省。

**是否已同步代码**：**是**（图标资源、ico、打包负载、两个 exe、安装包全部落地；`specs` 01~07 无 R-xx 约束图标形态，本次不涉及规格条款改动）。

---

*（后续每次规格更新在此追加一行；主规格文件本身只写规则、不写流水账。）*
