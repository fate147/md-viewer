# 实施计划 v3.1 · 长文档阅读能力

> 性质：**待拍板提案稿**。本文件不作为行为依据（行为依据在 `specs/`），也不作为进度状态源
> （状态源仅 `TODO.md`）。拍板后：规则条目并入 `specs/`、状态并入 `TODO.md`，本文件删除或移入
> `specs/archive/`。
>
> 编制日期：2026-11-01 ｜ 依据：只读排查（`AGENTS.md` 三条铁律第一条）
> 前置纪律：本文件完成前未改动任何业务代码、配置、测试脚本。

---

## 0. 目标与判据

mdview 类工具的前提是"读 README"。本计划的唯一目标是让本工具在**它做不到的负载**上成立：

| 指标 | 现状 | 目标 |
|---|---|---|
| 2.3MB 打开 | 1.23s | ≤ 1.5s（不劣化超过 30%） |
| 10MB 打开 | 不可用（全量 `innerHTML`） | 首屏 ≤ 1s |
| 30MB 打开 | 崩/卡死 | 可打开、滚动不掉帧 |
| 长篇导航 | 无（只有滚动条） | 卷/章两级目录 + 章间跳转 + 位置显示 |
| 中文排版 | `text-autospace` 一项 | 避头尾、标点挤压、省略号/破折号、数字间距 |

**不在本计划范围**：体积瘦身（另案）、EPUB 导出、Live Preview、全书检索（阶段四，本计划只预留索引接口）。

---

## 1. 排查结论（带 文件:行号，全部已读）

### 1.1 阅读层当前管线（`src/assets/reader.js`）

```
promoteStructuredHeadings(text)          :45-81   纯文本卷/章 → ## / ### 提升
  └ marked.parse() → innerHTML           :111     ← 全量解析 + 全量 DOM，瓶颈在此
    ├ 标题 id/slug + data-kind           :113-122  两遍 slug，O(标题数)
    ├ 相对图片改绝对 URL                  :125-132
    ├ hljs.highlightElement 前 500 块     :134-140  HL_CAP 常量在 :16-17
    └ enhanceCodeBlocks（语言标签+复制）  :144-180
```

结论：**唯一的全量瓶颈是 `:111` 一行**，其余后处理都是"遍历现成 DOM"。只要把 `:111` 拆成"按块产出 + 按需注入"，后处理即可按块复用，无需重写。

### 1.2 分块可行性（已实测）

`src/assets/marked.min.js` 是 **marked v12.0.2**，导出面含 `lexer` / `parser` / `Lexer` / `Parser`：

```
TOKEN TYPES: heading | paragraph | space | paragraph | space | code | space | table
marked.parser([toks[0], toks[1]]) → "<h1>第一卷</h1>\n<p>第一章</p>\n"
```

即：**可以只渲染指定 token 子集**，块级切分不需要自研解析器。

### 1.3 必须保护的既有约束（易被分块破坏）

| 约束 | 位置 | 被破坏的后果 |
|---|---|---|
| `.md-body p` 段首缩进 2em | `app.css:189` | 书卷模式失去排版特征 |
| `.md-body h1..h6 + p` 取消缩进 | `app.css:193-194` | 标题后首段多出 2em 缩进 |
| `#stack > * { position:absolute; inset:0; overflow:auto }` | `app.css:84-88` | 加侧栏会顶掉阅读区定位 |
| `renderedRev` 单值归属 | `app.js:30,105-107,109-119` | 03 R-03-03：切标签内容错乱 |
| 锚点算法 `offsetTop` | `reader.js:222-251` | 分块后 `offsetTop` 只对已渲染块有效 |
| `HL_CAP = 500` 上限 | `reader.js:16-17,135-138` | 分块后需改为"进入视口才高亮" |
| 排版模式 `doc` 类在 `#reader` 上 | `app.js:164-171` | 侧栏须与 `.md-body.doc-mode` 共存 |

**关键风险（已定位）**：`app.css:193-194` 用的是**相邻兄弟选择器** `h1 + p`。若在标题与其后首段之间插入占位节点，缩进取消规则立即失效。→ 规格化对策见 R-03-09 不变量 ③。

### 1.4 其它事实

- 滚动容器是 `#reader` 自身（`app.css:88` 给 `#stack > *` 设 `overflow:auto`），不是 `window`。
- `#reader` 有 `padding: 56px 32px 30vh`（`app.css:117-129`），累积高度计算须含 padding。
- 视图菜单入口在 `src/ui/main_window.py:74-93`（主题/排版模式已在此），加"目录"只需同处加一项。
- 配置默认值在 `src/core/config.py:31-40`，`layout` 下现有 `reading_mode` 一个键。
- 铁律三：`perf_baseline.py` / `smoke_app.py` / `test_bridge_integration.py` **未经你"测一下"授权不得运行**。

---

## 2. 阶段划分与依赖

```
阶段 0  规格修订提案（本文件获准后立即执行，只动 specs/ + TODO.md）
   │
   ├─ 阶段 1  中文排版细化        （纯 CSS + 少量渲染后处理，零架构风险）
   ├─ 阶段 2  卷/章导航            （新增 toc.js + 布局 + 配置 + 桥 + 菜单）
   └─ 阶段 3  分块渲染 + 虚拟滚动  （reader.js 重构，吃阶段 2 的索引）
                        ↑ 阶段 2 与 3 共用 R-03-10 大纲索引，故 2 必须先于 3
```

阶段 1 与阶段 2/3 无相互依赖，可并行；阶段 3 必须等阶段 2 的索引落地。

---

## 3. 阶段 0 · 规格修订提案（先改规格，铁律二）

> 拍板后执行顺序：先写 `specs/`，再写代码，最后 `specs/changelog.md` 记「是否已同步代码」。

### 3.1 `specs/03-编辑⇄阅读双态与排版.md` 新增四条

**R-03-09【分块渲染阈值与不变量】**
- 文本长度 ≤ `CHUNK_THRESHOLD`（200_000 字符，常量位置 `reader.js` 顶部）：走现行全量路径
  （`marked.parse` → `innerHTML`），行为与 v3.0 完全一致；> 阈值走分块路径。
- 分块路径 = `blockify(tokens)` → 块表 `{tokens, estHeight, rendered, el}` → `renderWindow(视口±2屏)`。
- **不变量（全部满足，缺一即视为违反本规格）**：
  1. 标题 id/slug 去重、`data-kind`、相对图片改写、代码块增强、hljs 高亮，五项后处理对**每一块**生效，且同一块不得重复执行（`WeakSet` 记账）；
  2. 分块**不得卸载已渲染块**——离开视口只停止继续渲染，已渲染内容保留。以保证选中全文、Ctrl+A、导出、滚动位置语义与全量模式一致；
  3. **标题与其紧随的首个段落必须同属一个块组**，以保证 `app.css:193-194` 的 `h1 + p` 相邻选择器不跨块失效；
  4. `anchorReaderFromEditor` / `anchorLineFromReader` / `readerScrollRatio` 在分块模式下必须返回与全量模式一致的语义位置（改用「块索引 + 块内偏移」，禁止依赖 `offsetTop` 直取）；
  5. 单块超过 4000 字符须按段落再切分，防止超长段落退化为全量。
- 依据：`reader.js:111,16-17,113-180`、`app.css:189,193-194`；marked v12 实测导出 `lexer/parser`
- 回滚方式：`CHUNK_THRESHOLD = Infinity` 即回到全量路径，无代码分叉。

**R-03-10【大纲索引唯一数据源】**
- 新增 `MDV.buildOutline()`，输出 `[{level, kind, text, id, blockIndex, offsetTop, chars}]`。
- 归属规则：`chapter` 归属其前最近的 `volume`；首个 `volume` 之前的 `chapter` 归伪卷「序」；无任何卷/章时退化为按 h1–h6 建树。
- **消费方四处（TOC 侧栏、位置显示、章间跳转、`renderedRev` 重建时机）只允许读该索引，禁止各自重算**（同源原则，类比 R-03-04）。
- 依据：`reader.js:113-122`（现有 heading 遍历）、`app.js:109-119`

**R-03-11【章间跳转语义】**
- 章间跳转 = 视口/光标落到目标块顶部（`offsetTop - 24`），**不是翻屏、不是翻页**。
- 目标块处于未渲染区时，必须先渲染该块再定位（与 R-03-09 协作），禁止跳到占位高度上。
- 依据：`reader.js:222-228`（既有 `-24` 偏移口径）

**R-03-12【中文排版规则口径】**
- 阅读层中文排版必须由本规格与 `specs/00` 数值表共同定义，禁止散落在 `app.css` 与 `reader.js` 各写一份。
- 允许的实现层次：CSS 优先（`line-break` / `text-spacing-trim` / `text-autospace`）；CSS 无法表达且**不改变原文语义**时，允许渲染后 DOM 处理；**禁止改写源文本**（`state.docs` 缓冲不得被排版逻辑触碰）。

### 3.2 `specs/00-视觉法与产品口径.md` 新增两节数值（无 R 条目）

**中文排版数值表**（补入「阅读层（书卷模式）排版细则」）

| 项 | 取值 |
|---|---|
| 段首缩进 | 2em（排除列表、引用、表格单元格、标题后首段） |
| `line-break` | `strict`（避头尾） |
| 行首禁则字符 | `，。、；：？！）〕］｝》」』""''…—～·` |
| 行尾禁则字符 | `（〔［｛《「『""…—` |
| 标点挤压 | `text-spacing-trim: space-first`（不支持则跳过，不得用 JS 插入空白字符） |
| 中西文间距 | `text-autospace: normal`（已启用） |
| 省略号/破折号 | 仅样式层处理，**不改写字符** |
| 数字与单位 | 不插入任何不可见字符 |

**长文档性能阈值**（补入「非功能需求」）

| 档位 | 打开耗时 | 滚动 |
|---|---|---|
| 2.3MB | ≤ 1.5s 且不比 v3.0 劣化 >30% | 无掉帧 |
| 10MB | 首屏 ≤ 1s | 无掉帧 |
| 30MB | ≤ 2s 首屏 | 允许偶发掉帧，不得卡死 |

### 3.3 `specs/06-配置与持久化.md` 新增一条

**R-06-07** `DEFAULTS.layout` 新增 `toc_visible`（bool，默认 `true`）与 `toc_mode`（`auto|always|never`，默认 `auto`：书卷模式显示、文档模式隐藏）。二字段纳入 R-06-02 白名单；写入走既有原子写。
- 依据：`src/core/config.py:31-40`

### 3.4 `specs/05-桥协议.md` 新增一条

**R-05-11** 新增下行方法 `setTocVisible(bool)`，走既有 `evaluate_js` 通道；**禁止新增独立 IPC 通道**（延续 R-05-09 禁旁路）。

### 3.5 `specs/02-文件与标签生命周期.md` 补一句（R-02 现有条目内追加，不新增编号）

切换标签时大纲索引必须随 `renderedRev` 一并作废重建，禁止跨标签复用（与 03 R-03-03 同源）。
- 依据：`app.js:105-119,280-303`

### 3.6 `TODO.md` 新增里程碑行

```
| v3.1 长文档阅读 | 中文排版细化 → 卷章导航 → 分块渲染（30MB 可读） | ⏳ |
```
并按 `specs/changelog.md` 格式登记本次规格变更。

---

## 4. 阶段 1 · 中文排版细化

**涉及文件**：`src/assets/app.css`（新增一节）、`src/assets/reader.js`（仅渲染后处理）、`specs/00`。
**不涉及**：Python 侧、桥、配置、`state.docs`。

| # | 任务 | 落点 | 说明 |
|---|---|---|---|
| 1.1 | 避头尾规则 | `app.css` 新增 `.md-body { line-break: strict }` | Chromium 原生支持，零成本 |
| 1.2 | 标点挤压 | `.md-body { text-spacing-trim: space-first }` | 需 WebView2 版本支持；不支持时静默降级（不得报错） |
| 1.3 | 缩进排除补全 | `app.css:189-194` 附近 | 确认 `li p` / `blockquote p` / `td p` 已排除（已存在）；补 `.md-body .code-wrap + p` 无需缩进的判断 |
| 1.4 | 省略号/破折号 | 渲染后 DOM pass，`reader.js` 新增 `normalizePunct()` | **仅当**目标文本节点不在 `code`/`pre`/`a[href]` 内；**待拍板项 B** |
| 1.5 | 中英混排间隙 | 沿用 `text-autospace`（`app.css:129`） | 已存在，只做验收，不新增实现 |
| 1.6 | 主题一致性 | 4 主题 × 2 模式目视 | 基准数据见 `specs/00` |

**验收**：4 主题 × {书卷, 文档} × 三份样例（中文章回、技术文档、中英混排），逐项核对 `specs/00` 数值表；`.md-body p` 段首缩进仍为 2em；标题后首段仍无缩进。
**风险**：低。全部为 CSS/后处理，不触碰文本权威。
**工时**：1–1.5 天。

---

## 5. 阶段 2 · 卷/章导航

**新增文件**：`src/assets/toc.js`（约 180 行）。
**修改文件**：`app.html`（DOM）、`app.css`（布局）、`app.js`（接线 + drain）、`src/ui/main_window.py`（菜单）、`src/ui/web_client.py`（转发）、`src/core/config.py`（字段）、`specs/06`。

### 5.1 数据流

```
reader.js: buildOutline()   ← 唯一索引（R-03-10）
   ├→ toc.js    侧栏树渲染 + 当前项高亮
   ├→ statusbar 位置显示「第一卷 · 第12章 · 63%」
   └→ 章间跳转  Ctrl+← / Ctrl+→
```

### 5.2 任务

| # | 任务 | 落点 | 说明 |
|---|---|---|---|
| 2.1 | `MDV.buildOutline()` | `reader.js` | 遍历标题，按 `data-kind` 归卷归章；输出 chars 字段（章节字数） |
| 2.2 | 侧栏骨架 | `app.html` 加 `#toc`；`app.css:84-88` 改 flex | `#stack` 由全 absolute 改 `display:flex`，`#toc` 220px，`#reader` 占剩余 |
| 2.3 | 树渲染 | `toc.js` | 卷→章两级；>200 项时只渲染可见窗（复用阶段 3 的窗口思路，可退化为全量渲染 + `content-visibility`） |
| 2.4 | 滚动同步 | `toc.js` | `#reader` scroll 事件 + `requestAnimationFrame` 节流；当前章高亮 |
| 2.5 | 点击/键跳转 | `toc.js` + `app.js` | 点击跳转；`Ctrl+←/→` 上一章/下一章（R-03-11 语义） |
| 2.6 | 位置显示 | `src/ui/statusbar.py` | **待拍板项 A**：Tk 状态栏（推荐，不动页面布局） vs 页内浮层 |
| 2.7 | 显示策略 | `toc.js` + `config.py` | `toc_mode: auto` → 书卷显示、文档隐藏；`Ctrl+Shift+O` 手动切换 |
| 2.8 | 菜单入口 | `main_window.py:74-93` | 「视图」下新增「目录  Ctrl+Shift+O」复选 |
| 2.9 | 桥与配置 | `web_client.py` / `config.py` | `setTocVisible(bool)` 下行；`layout.toc_visible/toc_mode` 持久化 |
| 2.10 | 标签联动 | `app.js:109-119,280-303` | 切标签重建 outline（R-03-03 同源） |
| 2.11 | 空态 | `toc.js` | 无卷无章时按 h1–h6 降级；无标题时不显示侧栏（避免空面板） |

### 5.3 验收

- 2.3MB 小说：目录构建 ≤ 50ms；卷/章层级与 `promoteStructuredHeadings` 提升结果一致。
- 滚动到 40 章：侧栏高亮项同步 ≤ 1 帧延迟。
- 8 标签往返切换 20 次：目录不串档（与 `renderedRev` 同步作废）。
- 文档模式：无 h1–h6 的纯文本不出现空目录。

### 5.4 风险

| 风险 | 对策 |
|---|---|
| `#stack` 改 flex 破坏编辑层定位 | 编辑层与阅读层同步改 `flex:1; min-width:0`；`#editor-host .cm-editor` 高度链不变 |
| 侧栏挤压 `.md-body` 的 `max-width:36em` 居中 | 版心不变，只缩外框；需目视 1280×800 与 1920×1080 两档 |
| `app.css:89` 的 `.hidden` 规则优先级 | `#toc[hidden]` 一并纳入 |

**工时**：3–4 天。

---

## 6. 阶段 3 · 分块渲染 + 虚拟滚动

**涉及文件**：`src/assets/reader.js`（重构 `renderReader`，约 +220 行）、`app.js`（锚点调用签名不变）、`specs/03` R-03-09/10/11。

### 6.1 新管线

```
renderReader(text, baseDir):
  text.length <= CHUNK_THRESHOLD ? renderFull()   ← 现有实现原样保留，作为回滚路径
                                 : renderChunked()

renderChunked():
  tokens = marked.lexer(promotedText)             ← 实测可用
  blocks = blockify(tokens)                       ← 归组（见 6.2）
  prefix = 估算高度前缀和                          ← 首屏后用实测高度校正
  renderWindow(0, 2屏)                            ← 首屏同步渲染
  绑定 scroll → rAF → renderWindow()              ← 滚动增量渲染
```

### 6.2 `blockify` 归组规则（对应 R-03-09 不变量 ③⑤）

1. `space` token 并入前一组，不单独成块；
2. **`heading` 与其紧随的首个非 space token 同组**（保护 `h1 + p` 缩进规则）；
3. 相邻 `list` / `blockquote` 合并为一组（避免列表被拆成十几块）；
4. 单组 `raw` 超过 4000 字符时按段落边界再切。

### 6.3 任务

| # | 任务 | 说明 |
|---|---|---|
| 3.1 | `blockify()` | 纯函数，可单测（不跑测试，只做静态检查） |
| 3.2 | 高度估算 + 校正 | 字符数 × 字宽估算；块渲染后用 `getBoundingClientRect` 回填并更新前缀和 |
| 3.3 | `renderWindow()` | 视口上下各 2 屏；已渲染块 `rendered=true` 不重复处理 |
| 3.4 | 后处理按块化 | 把 `:113-180` 抽为 `decorateBlock(root, baseDir)`，全量与分块共用（消除双份实现） |
| 3.5 | 高亮改按需 | `HL_CAP` 语义改为"每次进入视口时高亮"，`WeakSet` 去重 |
| 3.6 | 锚点适配 | `anchorReaderFromEditor` 先确保目标块渲染再定位；`anchorLineFromReader` 用前缀和二分反查 |
| 3.7 | 图片高度回填 | `img` load 事件后校正该块高度，防止图片加载导致锚点漂移 |
| 3.8 | 滚动比例 | `readerScrollRatio` 用 `scrollTop / (总估算高度 - clientHeight)`，与全量模式误差 ≤ 2% |

### 6.4 风险清单

| 风险 | 严重度 | 对策 |
|---|---|---|
| `app.css:193-194` 相邻选择器失效 | 高 | 6.2 规则 2：标题与首段同组 |
| `#reader` 的 `padding:30vh` 计入高度 | 中 | 前缀和起点含 paddingTop；`scrollHeight` 校验 |
| 已渲染块不卸载导致内存增长 | 中 | 30MB 全渲染约 200–400MB DOM，可接受；若超限，退化为"保留窗口 ±50 屏"并记入 00 阈值 |
| 表格 `display:block` 宽度不影响高度 | 低 | 已确认 `app.css:163-166` |
| 锚点误差累积 | 中 | 首次滚动后全量校正一次前缀和 |
| `renderedRev` 语义被破坏 | 高 | 分块路径不改变 `app.js:109-119` 调用契约，只换 `renderReader` 内部实现 |

### 6.5 回滚

`CHUNK_THRESHOLD = Infinity` → 全部走 `renderFull()`，`reader.js` 无分叉删除动作。**这是本阶段唯一的保险，必须在规格 R-03-09 写明。**

### 6.6 验收（**需你授权"测一下"后执行**）

| 项 | 方法 |
|---|---|
| 2.3MB 不劣化 | `perf_baseline.py` 现值 1.23s / 65ms / 12ms，允许 ≤1.5s |
| 10MB / 30MB | 在 `%TEMP%` 生成临时文件（不入库），目视 + 计时 |
| 滚动 | 连续滚动 30 秒无白屏、无跳位 |
| F2 往返 | 100 行、5 万行、50 万行三档，位置对应误差 ≤ 1 屏 |
| 标签隔离 | 8 标签随机切换，无串档 |

**工时**：5–7 天（含调优）。

---

## 7. 总排期

| 阶段 | 内容 | 工时 | 前置 |
|---|---|---|---|
| 0 | 规格修订（只动 specs/ + TODO.md） | 0.5 天 | 本文件拍板 |
| 1 | 中文排版细化 | 1–1.5 天 | 阶段 0 |
| 2 | 卷/章导航 | 3–4 天 | 阶段 0 |
| 3 | 分块渲染 | 5–7 天 | 阶段 2.1（大纲索引） |

合计约 **10–13 个工作日**。

---

## 8. 待拍板项（4 项）

| # | 问题 | 备选 | 推荐 |
|---|---|---|---|
| **A** | 阅读位置显示放哪 | ①Tk 状态栏 ②页内顶部浮层 | **①**：不动页面布局、不影响 `#stack` 定位、与主题同步已在 `theme.py` 做好 |
| **B** | 是否在阅读层把 `--`→`——`、`...`→`……` | ①只做 CSS 样式层 ②渲染层字符替换 | **①**：R-03-12 已禁改写源文本，替换会让「复制纯文本」与显示不一致 |
| **C** | 目录默认显示策略 | ①auto（书卷显示/文档隐藏）②始终显示 | **①**：技术文档读者不需要目录侧栏，符合"消失的设计" |
| **D** | 本计划文件是否入库 | ①拍板后删除，规则进 specs、状态进 TODO ②保留在根目录 | **①**：避免形成第二个状态源（`AGENTS.md` 已明确 `TODO.md` 是唯一状态源） |

---

## 9. 纪律声明

1. 本计划通过前，未修改任何业务代码、配置、测试脚本。
2. 拍板后按「先改 `specs/` → 再改代码 → 记 `specs/changelog.md`」推进，每阶段单独一次拍板确认。
3. 任何测试脚本（`perf_baseline.py` / `smoke_app.py` / `test_bridge_integration.py`）**须你明确说"测一下"才运行**（铁律三）。
4. 新增/修改文件后自查 `C:\Users\` / `C:/Users/` / `D:\` 零命中（D-04）。