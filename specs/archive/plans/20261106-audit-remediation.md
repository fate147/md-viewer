# 2026-11-06 · 体检整改完整实施计划

> **状态**：待拍板。本文件只描述实施蓝图，不代表任何条目已经获准执行。按铁律一，确认前不得动业务代码、配置或规格。
>
> **输入材料**：
>
> - `specs/archive/AUDIT-01-信息层级体检-2026-11-06.md`（记为 **IA-xx**）
> - `specs/archive/AUDIT-02-动效体检与增补建议-2026-11-06.md`（记为 **MO-xx**）
> - `specs/00`～`07`、`AGENTS.md`、`TODO.md`
> - 本地 `.md-viewer-config.json` 最近文件实际值
>
> **适用范围**：MD Viewer v1.0.6 工作树。默认 `window.chrome=custom`（页面内自绘菜单/状态栏）；`chrome=native` 仅作原生回退。
> **命名说明**：Windows 写路径时统一使用 `C:\Projects\md-viewer\...`，不要将其他本机盘符或用户目录写入仓库文件。

---

## 0. 一页结论（如果只批准三件）

MD Viewer 的阅读引擎本身已经成熟；这次整改的重点不是重构，而是**把已有但接线断了的入口接上，把只能用鼠标完成的动作补上键盘路径**。

**建议优先级**：

1. **先补规格，再改代码**——至少先把 F2 的 0ms 豁免、状态栏固定槽、最近文件入口、目录焦点口径写进规格。
2. **A 级先行**——reduced-motion、代码工具条焦点、时长 token、标签选中过渡，风险最低、收益可验证。
3. **两个硬连接必须做**——键盘语义 + Ctrl+W（IA-03）、最近文件接回自定义菜单（IA-01）。

**冻结项**：不借这次机会重写架构、不动内容区排版口径、不换主题、不引入新依赖、不改阅读/编辑双态锚点算法。`specs/archive/` 中两份审计是快照事实源，不把它们当作已确认规格；审计里的 B/C 级条目必须再次拍板。

---

## 1. 整体实施原则

1. **先规格，后代码**——逻辑/契约/视觉口径变化必须先修订 `specs/0X` 与 `specs/changelog.md`。
2. **一次拍板，分阶段交付**——同时改十几处会让回滚面过大；每阶段自成一个可回退单元。
3. **默认外壳优先**——`window.chrome=custom` 是真实默认；`chrome=native` 的原生菜单只维护一套回退口径或明确降级。
4. **阅读区冻结**——`editor-host` / `reader` 的渲染预算、分块渲染、撤销历史不参与本轮优化。
5. **每阶段都可回滚**——规格条目必须标明 `✅（日期，阶段N同步）` 或 `⏳ 未同步`；`tools/specs_check.py` 必须协调。
6. **测试不可自行运行**——`smoke_app.py` / `test_bridge_integration.py` / `perf_baseline.py` 必须用户明确说「测一下」才能执行。
7. **截图未授权**——没有用户许可不得自动启动应用或截图；验收以清单和终端输出为准。
8. **审计条目不是需求**——IA-xx / MO-xx 编号仅用于追溯，不作为提交范围承诺。

---

## 2. 工作包总矩阵

| WP | 追溯来源 | 优先级 | 主要改动面 | 审批等级 | 前置依赖 |
|---|---|---|---|---|---|
| WP-01 | MO-02 / M-01 | **P0** | `app.css` reduced-motion 补 `animation` | A | 无 |
| WP-02 | MO-03 / M-02 | **P0** | 代码块复用工具条焦点显形、`pointer-events` | A | 无 |
| WP-03 | MO-01 / M-03 | **P0** | 目录开关保阅读锚点 + `#toc-list` 淡入 | A（行为无口径） | WP-01 基线 |
| WP-04 | MO-05 | A | 命令面板 Esc/点遮罩关闭过渡 | A | WP-01 |
| WP-05 | MO-07 | A | 120/160/180ms 时长 token 化 | A | 无 |
| WP-06 | MO-08 | A | 标签选中 120ms 过渡 | A | WP-05 |
| WP-07 | MO-09 | A/可选 | 全局 `:active` 按下态 | A | WP-05 |
| WP-08 | **IA-03** | **P0** | 菜单行/标签/TOC 键盘语义 + roving focus | **A** | WP-05 |
| WP-09 | IA-01 | **P0** | `recent_files` 接回自定义 File 菜单 | **B** | WP-08（共享菜单模型） |
| WP-10 | IA-02 | **P0** | 单文档关闭路径：File「关闭文件」+ Ctrl+W + 标签条单标签 | **B** | WP-08、WP-09 |
| WP-11 | IA-04 | B | 快捷键单源、三处文案对齐、Ctrl+H 阅读态、Ctrl+K 入口 | **B** | WP-08 |
| WP-12 | IA-05 | B | 目录控制去重 + 当前规则文案 | **B** | WP-08 |
| WP-13 | IA-07 | B | 命令面板显示勾选态、快捷键列、分组与可发现性 | **B** | WP-05、WP-11 |
| WP-14 | IA-06 | B | 顶级菜单重组：文件 / 编辑 / 视图 / 帮助 | **B** | WP-12、WP-13 |
| WP-15 | IA-08 / MO-10 | B | 状态栏固定槽 + 自动保存静默化 + toast 口径 | **B** | WP-05 |
| WP-16 | IA-09 | B | 状态栏/标题栏阅读·编辑 chip | **B** | WP-15 的槽位决策 |
| WP-17 | IA-01/02/10 | B | 关闭最后文档后的空态/开始页 | **C** | WP-10 方案拍板 |
| WP-18 | MO-04 / M-04 | B | F2 = 0ms 豁免与标签条首次出现动画 | **B** | specs/00 修订 |
| WP-19 | MO-06 / M-09 | B（可选） | 主题切换 0ms 或单层遮罩 | **B** | specs/00 修订 |
| WP-20 | MO-10 / M-10 | B | 规格 `toast 180ms` 的实际对应物 | **B** | specs/00 修订 |
| WP-21 | P3-01 | B/A 取决于范围 | README「多标签上限 8」与真实行为对齐 | 先拍板范围 | 无 |
| WP-22 | P3-02 | A | `fmtChars` 单位统一 | A | 无 |
| WP-23 | P3-03 | B/A | 查找/替换菜单合并、Ctrl+H 阅读态生效 | B | WP-11 |
| WP-24 | P3-04 | B | 原生回退：删/降级或共用自定义菜单模型 | **B** | WP-14 |
| WP-25 | P3-05 | B | 文件名双处标记去重 | **B** | WP-15 |
| WP-26 | P3-06 | B | 无大纲时自动隐藏书卷目录 | **B** | WP-12 |
| WP-27 | P3-07 | A | 命令面板输入框保留可见焦点环 | A | WP-13 |
| WP-28 | P3-08 | A | 删除未被 UI 引用的 `TabState.title` | A（先确认无引用） | 全局搜索 |
| WP-29 | IA-10 | C | 独立开始页（非 Markdown 空态） | **C** | WP-17 拍板 |
| WP-30 | 全案 | 收口 | 规格更新、`changelog`、README、TODO、归档 | 不可跳过 | 所有已执行 WP |

**估算**：A 级合计约 4～6 人日；B 级约 6～9 人日；C 级（开始页）2～3 人日。不含测试授权后的回归验证时间。

---

## 3. 需要用户拍板的决策点

以下条目在实施前必须确认；确认只影响是否做，**不等于自动执行**。

### D-01 默认外壳最近文件是否直接显示（IA-01 / WP-09）

- **推荐**：是。最近文件常驻「文件」菜单，末尾附「清除最近文件列表」。
- 备选 A：只显示 5 条 + 「更多…」
- 备选 B：不显示，只保留 native 回退
- 若选 A：`specs/06` `R-06-05` 无需改数字；`specs/05` `R-05-12` 需补 `recent` 字段；`specs/00` 菜单口径需补一行。

**批准结果**：待选。

---

### D-02 单文档时标签条如何处理（IA-02 / WP-10）

- **推荐**：全宽度显示单标签（36px），File 菜单增加「关闭文件」，并绑定 Ctrl+W；标签数为 1 时仍保留关闭和脏标记。
- 备选 A：标签条始终隐藏，只在 File 菜单放「关闭文件」+ Ctrl+W
- 备选 B：完全不保留单标签，关闭最后文档直接进入开始页
- 推荐方案实现成本最低，但属于**外壳行为变更**，必须拍板。

**批准结果**：待选。

---

### D-03 最后一个文档关闭后显示什么（Phase 5 / WP-17）

- 选项 1：继续沿用「新建未命名文档 + 欢迎文本」（当前行为）
- 选项 2：按 IA-10 做不可编辑「开始页」（推荐）
- 选项 3：显示空应用外壳 + 仅状态栏「零文档」
- 选项 2 属于 C 级：新增「非文档状态」，需要单独方案与规格；不能作为顺手修改混进 WP-10。

**批准结果**：待选。

---

### D-04 目录两个控制如何呈现（IA-05 / WP-12）

- **推荐**：
  - 主开关：`切换目录（显示/隐藏）` 只反映当前动作的结果，不显示互斥勾选
  - 规则：`目录规则：自动 / 始终显示 / 始终隐藏` 三态单选
  - 菜单顶部增加只读状态，如「当前：隐藏（目录规则）」
- 备选：保留「显示目录」复选 + 三态规则，但两处都必须同步，不推荐。
- 不改变 `shouldShow` 优先级（手动 > 规则 > 自动），只改菜单层。

**批准结果**：待选。

---

### D-05 顶级菜单归并方案（IA-06 / WP-14）

- **推荐**：四个顶级：`文件 / 编辑 / 视图 / 帮助`
  - 视图：模式 → 编辑 ⇄ 阅读、阅读排版模式（自动/书卷/文档）
  - 视图：目录 → 显示/隐藏、规则集
  - 视图：外观 → 主题、阅读字体
  - 命令面板：放「帮助」→「命令面板… Ctrl+K」
- 备选：保留五个顶级（字体/主题合并为「外观」），视图不变
- 不影响快捷键和功能数量，只改分组与层级。
- 该决策需要你接受：**视觉层菜单标题会变**。

**批准结果**：待选。

---

### D-06 状态栏右侧槽位（IA-08 / WP-15）

- **推荐**：
  - 左：`N 字 · M 词`
  - 左中/中：`行:列`
  - 右：`编码 | 主题名`（**删除文件名**，文件名已在标题栏和标签存在）
  - 行列之后可加 `卷 · 章 · 百分比`
  - 临时消息用独立槽位，不覆盖以上常驻信息
- 备选：保留文件名但压缩字号
- **自动保存静默化**建议：成功不显示文字；失败才用 2 秒临时槽。
  - 若认可特定视觉，需在 `specs/00` 写入「固定状态栏槽位」；
  - 如果不希望减少信息，则可只做“临时消息不覆盖基础行列”的最低版本。

**批准结果**：待选。

---

### D-07 阅读/编辑指示（IA-09 / WP-16）

- **推荐**：状态栏左侧加单词 chip `阅读` / `编辑`；悬停或 title 提示 `F2 切换`。不额外做按钮、不做工具栏。
- 备选：只在标题栏文件名后加 `（编辑）` / `（阅读）`

**批准结果**：待选。

---

### D-08 F2 是否明确列为 0ms 豁免（MO-04 / WP-18）

- **推荐**：是。编辑层与阅读层是**同一文字的两种表示**，不得叠化；标签条首次出现可单独做 120ms `opacity + translateY(-4px)`。
- 规格中将原句「切换 160ms」改成：
  - 外壳面板/标签条首次出现：120ms
  - 外壳切换/关闭：160ms（如果采用退出动画）
  - **内容双态切换 F2：0ms（豁免）**
- 备选：保持全 0ms 或者全部补 160ms（不推荐）

**批准结果**：待选。

---

### D-09 主题切换如何处理（MO-06 / WP-19）

- **推荐**：不加逐元素过渡；将「主题切换」列为 0ms 豁免。
- 备选：用一层固定遮罩从旧背景淡出，160ms `opacity`
  - 只动一层、不动每个元素
  - 新增临时 DOM，增加首帧和切换路径复杂度
- 若不选遮罩，则 MO-06 只剩“更新规格，说明为何不做”的闭环。

**批准结果**：待选。

---

### D-10 toast 的实际定义（MO-10 / WP-20）

- **推荐**：把 `specs/00` 的「toast 180ms」改成：
  - 「状态栏临时消息：出现/消失 120ms opacity；大字浮层 toast 暂不做」
- 备选：真正实现底部浮层 toast（自底向上/180ms/2 秒消失），二选一，不建议同时存在两套提示
- 影响规格 00，需要明确写入：浮层 toast 未纳入当前版本。

**批准结果**：待选。

---

### D-11 README 的「多标签上限 8 个」谁说了算（P3-01 / WP-21）

- 选项 1：修正 README 为"会话恢复上限 8 个；运行时标签数量不额外截断"（最小、A 级）
- 选项 2：给 `open_tab` 增加真实上限 8 并给出提示（改行为，需规格 02 R-02-08 相关口径）
- **推荐**：选项 1。本次不新增人为上限。

**批准结果**：待选。

---

### D-12 命令面板入口位置（IA-04/IA-07 / WP-13）

- **推荐**：`帮助 → 命令面板… Ctrl+K`，同时 `Ctrl+K` 已有；不提高其可见性靠菜单，命令面板仍以快捷键为主。
- 备选：放在「视图」
- 影响菜单结构，需与 D-05 一起拍板。

**批准结果**：待选。

---

### D-13 是否修正「多标签上限 8」和原 `TabState.title`（P3-08 / WP-28）

- **推荐**：修正 README + 删除 `TabState.title`（前置全局 `rg "title"` 确认无脚本引用）
- 若脚本仍依赖 `title`，则保留并仅删除 `●` 语义或改为属性不使用
- 需要一次性 `git grep -n "title"` 验证；本计划仅列出步骤，不在未批准前执行删除。

**批准结果**：待选。

---

## 4. 先行的规格修订清单

按铁律二，这些条目必须先改规格；否则代码会与规格冲突，`tools/specs_check.py` 不通过。

| 规格文件 | 条目 | 修订方向 | 触发 WP | 说明 |
|---|---|---|---|---|
| `specs/00` | 应用外壳视觉法 / 动效数值 | 动效拆成 hover / 外壳切换 / F2 豁免 / 状态栏临时消息 | WP-18、WP-20、WP-15 | `00` 无 R 编号，按「口径修订」 |
| `specs/00` | 状态栏槽位 & 文件名 | 明确固定槽位、字数与位置、删文件名（按 D-06） | WP-15 | 需用户书面确认 |
| `specs/00` | 最近文件可见行为 | 写入「默认自定义 shell 显示最近文件（上限 10）」 | WP-09 | 属于外壳功能清单 |
| `specs/02` | `R-02-02` 关闭顺序 | 补充「最后一个文档的行为」（开始页/未命名+欢迎） | WP-10/WP-17 | 未选开始页则只补Ctrl+W入口 |
| `specs/02` | `R-02-08` 会话恢复 | 维持 8，不增改数量；如选真实上限则另提案 | WP-21 | 推荐不改 |
| `specs/03` | `R-03-02/R-03-03` | F2 双态切换仍为 0ms（已符合）；补「目录切换先保标题锚点」 | WP-03/WP-18 | 与 `R-03-09` 锚点机制一致 |
| `specs/05` | `R-05-12` `set_ui_meta` | 增加 `recent` 字段/清晰 `recent` 类型；`docMaxWidth` 既有 | WP-09 | 需明确 payload JSON 字段 |
| `specs/05` | `R-05-11` | `tocToggle` 优先级保持不变 | WP-12 | 不改逻辑 |
| `specs/06` | `R-06-05` | recent_files：不改编号/上限；如界面新增「清除」则补「清除入口不影响 10 条上限规则」 | WP-09 | 也可不改规格正文，仅 changelog 记录 |
| `specs/06` | `R-06-07` | 目录手动 > toc_mode > auto 不变；新控件呈现说明 | WP-12 | 应是「呈现规则」修订 |
| `specs/07` | 无 | 不涉及 | — |
| `specs/changelog.md` | 每阶段 | 日期/变更/依据/已同步 | 全案 | 必写 |

### 规格修订示例（D-08，提交前交用户书面确认）

- 位置：`specs/00-视觉法与产品口径.md` → 外壳视觉法 / 动效行
- 改后条款建议：

```text
动效 | hover 120ms / 外壳切换 160ms（无则省略）/ 状态栏临时消息 120ms；
      内容双态切换（F2）不使用过渡，保持 0ms；
      prefers-reduced-motion: reduce 下 animation 与 transition 全量禁用
```

---

## 5. 分阶段实施方案

每个阶段结束都要人工验收、更新 `specs/changelog.md`；未触及的规格不改。

### Phase 0 · 规格修订提案（先批，后改）

**交付物**：本计划的 13 个决策点填写结果 + 规格修订片段。

**步骤**：

1. 用户批准 D-01～D-13（可以跳过不做的，在本文件标注「不做」）
2. 对每个通过的条目，生成对应规格完整的「修订提案」：
   - 要改的 R/口径位置
   - 修订前后对比
   - 是否还影响 `tools/specs_check.py` 的检查
3. 写入 `specs/0X` 与 `specs/changelog.md`（`待同步` 状态）；通过后进入 Phase 1。
4. 不允许 Phase 0 直接动 `.md-viewer-config.json`；最近文件清理单独记 TODO 待办。

**验收**：在 `tools/specs_check.py` 通过前，禁止声称"任务完成"。

---

### Phase 1 · 无风险 CSS 修复（A）

目标：纯静态外壳动效修复，不改 DOM 结构。

**WP-01**：Reduced motion 关 `animation`

- 文件：`src/assets/app.css` → `@media (prefers-reduced-motion: reduce)`
- 修改：`animation: none !important;` + `animation-duration: .01ms !important;`
- 不要删 `transition: none !important`
- 验收：DevTools 模拟 reduce 时 `#palette-box` 无位移/透明度过渡
- 回退：还原该媒体块

**WP-02**：代码复制工具条键盘可见

- 文件：`src/assets/reader.js::enhanceCodeBlocks`, `src/assets/app.css`
- CSS：`.code-wrap:focus-within .code-bar { opacity:1; }`
- `.code-bar` 默认 `pointer-events:none`；`.code-wrap:hover` 与 `:focus-within` 改回 `auto`
- 可将 150ms 收敛为 `120ms var(--mo-hover)`（与 WP-05 做）
- 验收：Tab 到复制按钮前工具条已可见；鼠标拖选代码不触发按钮

**WP-05**：时长 token 化

- 文件：`src/assets/app.css` `:root` 新增 `--mo-hover:120ms`、`--mo-switch:160ms`
  、`--mo-invert:120ms`（名称以实现为准）
- 150→120、140/160 与对应角色统一
- 验收：`rg -n '\d+ms' src/assets/app.css` 中除 token 定义外无硬编码时长
- 回退：保留历史注释 30 天后可删

**WP-05/06/07 共用**：WP-06 标签选中 120ms 过渡 / WP-07 可选 `:active`

- 标签只改 `background,color`，不要改 `.tab` 宽度和边框
- `:active` 只加背景，不做缩放
- 验收：切标签与点章颜色过渡手感一致；窗口按钮有按下态

---

### Phase 2 · 键盘可达（IA-03 / WP-08）

**目标**：拔掉鼠标能完成核心闭环。

**共用设计**：在 `app.js` 顶部引入专注管理工具（例如 `createMenuRovingFocus(menuEl)` /
`attachTabKeyboard(tabbar)` / `attachTocKeyboard(listEl)`），传统 JS，无新依赖。

**Step 1：菜单模型**

- `renderMenus`：
  - `div.menu-item` 改成 `button[type=button].menu-item`
  - 行为 `role="menuitem"` + `tabindex="-1"` + roving tabindex（菜单键导航）
  - 菜单容器 `role="menu"`
- 快捷键：
  - `ArrowUp/ArrowDown` 移动
  - `Home/End` 首/尾
  - `Enter/Space` 执行
  - `Escape` 关闭菜单并返回 `menu-btn`

**Step 2：主按钮**

- `button.menu-btn` 加 `aria-expanded`（`open` 时 true）
- Escape / 点击外部关闭统一走 `closeMenus`

**Step 3：标签条**

- `div.tab` 改成：
  - `role="tab"` + `tabindex="0"`（active）/ `-1`
  - `span.close` 改成真 `<button class="tab-close" aria-label="关闭 <name>">×</button>`
  - `Enter/Space` 激活标签
  - `Delete` 或 `Ctrl+W` 关闭当前标签
- 同时修正 `close` 现在鼠标中键 title 中文误导的问题：改 `关闭（Delete / Ctrl+W）`

**Step 4：目录**

- `.toc-item` 改成 `button.toc-item`
- 进入目录后按 `ArrowUp/Down`、`Home/End`、`Enter`
- 当前项必须 `aria-current="true"`（视觉上本来就有 `.active`）
- 目录仍由 `toc.js` 事件委托承接，不改它的滚动跟随逻辑

**Step 5：全局快捷键**

- `Ctrl+W` → 关闭当前标签（事件 `closeTab`，传当前 id）
- 找不到标签时阻止默认关闭窗口文案
- `Ctrl+H` → `MDV.runCmd("find")`，阅读态生效
- `Ctrl+K` → 打开命令面板（已有，不再写死说明）
- `Ctrl+Shift+O` 不改，`Ctrl+Shift+P` 不改

**Step 6：验收清单（交给用户）**

- [ ] Tab 进菜单、键入字母是否自动选中？（若做了字母快捷键，要在 CHANGELOG 写明）
- [ ] 无鼠标下能打开菜单、选主题、关标签、切章？
- [ ] 焦点可见矩形始终存在？
- [ ] 不增加多触点/屏幕阅读器专用兼容承诺（本轮不做）

**不动**：阅读区密集滚动焦点、CodeMirror 的键盘抢占。

---

### Phase 3 · 单一快捷键源 + 最近文件接线（IA-01 / WP-09）

**Step 1：单源表**

- 新增 `src/assets/shortcuts.js`（或 JSON 变量）：
  ```js
  window.MDV_SHORTCUTS = [
    {id, keys:"Ctrl+O", scope:"global", desc:"打开文件"},
    ...
  ];
  ```
- `welcome.py`、`main_window.py::_show_help`、命令面板都转换为“从源表生成”字符串/HTML。
- JS 没法直接读 Python 字符串，故：
  - 保存一份 `src/assets/shortcuts.json` 也可，或者直接用 `shortcuts.js` 变量 + 渲染函数
  - 简单：welcome 补一行/不补也行，手工同步；`help` 调用 JSBridge `MDV.shortcutHelpHtml()` 再把结果填到对话框；或者直接保持 welcome 为唯一「首屏示例」，不生成
- 决策：**不**为 Python 端再加构建步骤；改为：
  - `shortcuts.js` 在前端暴露`MDV.SHORTCUTS`
  - 帮助对话框改经 `help` 事件，Python 用 `messagebox.showinfo` 渲染静态模板 + 手工源表落成 `src/assets/shortcuts.html`? \u2014 这会很复杂。推荐：**直接消除 UI 重复**：
    - `welcome.py` 文本保留给首屏示例，不列全表
    - 原生帮助框只列最常用 10 条，加上「打开命令面板查看全部…」
    - 命令面板 placeholder 保留 `Ctrl+K`，菜单项说明见 tooltip
    - 单源高度化：`shortcuts.js` 生成 help 的 web 端覆盖层？需 UI 设计。
  - **必须用户拍板**：help 是否改为浏览器端面板。若不改，双向 source 并实现同步校验 marker——本计划不建议做未经确认的漂移检测器。

**Step 2：帮助入口**

- 菜单 `帮助` 增加 `命令面板… Ctrl+K`
- 菜单 `帮助` 增加 `快捷键面板…`（如果不做 overlay，仍沿用 messagebox，但补齐 Ctrl+K / Ctrl+Shift+O / Ctrl+Shift+P / Ctrl+←/→ / Ctrl+H）

**Step 3：最近文件接线**

- `main.pyw::_send_ui_meta` 增加：
  ```python
  "recent": list(recent_files)[:10]
  ```
- `setUIMeta` 合并 `recent`
- `buildMenuModel` `文件`：
  - 打开 / 新建
  - `最近文件` 子菜单（末尾「清除列表」）
  - 子菜单项 `ev: {type:"openRecent", path}`；`filename` 显示基名，`title` 显示完整路径
  - 点空白项（无）时禁用
- `_on_web_event` 增加 `openRecent` / `clearRecent` 两条
- `actions.py::open_file` 复用；若 path 不存在 → 提示并移除条目
- 清除 → `config.recent_files = []` + `refresh_recent_menu`（native 回退也清）
- `clearRecent` 需确认或无操作（推荐无需确认）

**验收**：

- 默认首次启动：文件 → 最近文件出现；点某条 → 打开；关闭再打开，列表更新
- 不存在的 path：弹出错误，并从列表移除，不破坏 `recent_files` 其余项
- native 回退和 custom 外壳列表一致（若 D-04/WP-24 处理）
- `tools/specs_check.py` 兼容

---

### Phase 4 · 关闭最后一个文档（IA-02 / WP-10）

**前提**：D-02、D-03 已拍板。

**Step 1：标签条**

- `MDV.setTabs`：`tabbar.hidden = list.length < 1`（或基于 D-02 单标签）
- 首次一个标签：36px 条、包含关闭按钮、脏标记
- 第二个标签：自动出现（不改现有条件式）

**Step 2：关闭事件**

- File 菜单新增 `关闭文件`，`ev: {type:"closeActive"}`
- `Ctrl+W` → 发送 `closeActive`（无标签则 no-op）
- Python `_on_web_event` 新增；`actions.py` 公共入口：
  ```python
  def close_active(app) -> None:
      tab = app.sess.active()
      if tab: close_tab_by_id(app, session.tab_key(tab))
  ```
- 复用 `close_tab_by_id`；脏确认链路不变

**Step 3：最后一个文档的去向**

- 选项 2（推荐）：走独立「开始页」 → 迁移到 WP-29，单独实现
- 选项 1（最小实现）：
  - 继续 `new_tab()` 但 `welcome` 灌入「只读示例」：
    - 标签名「欢迎（示例）」
    - 添加不可编辑提示
  - 为「统计」「保存」「导出」增加保护（空 path 依然弹另存为——语义可接受）
- 推荐挑选 `D-03` 的选项 2；否则最小实现保留为后备

**Step 4：Close 菜单交互**

- 当前 File 菜单：6 个叶子 + 关闭文件 = 7
- 空态：没有标签（全部关掉）时 `closeActive` 和 File 菜单「关闭文件」显示disabled

**验收**：按 Ctrl+W 进入 0 文档状态；退出程序回到 0；再开则从最近文件列表取回。

---

### Phase 5 · 状态栏 + 自动保存静默（IA-08、MO-10 / WP-15）

**目标**：不再把状态栏当 toast。

**目标槽位**（按 D-06）：

- 左：字数 · 词数
- 中：行列（`7:12`）
- 右：`编码 | 主题名`（或保留百分比）
- 章节位置由 section 事件覆盖右或独立槽；**删除文件名**

**实现**：

1. `main.pyw::_update_status_tail` 生成三个字段：
   - `set_status({left, right, mid})`，或
   - `set_status({left, center, right})`（需要桥协议更新，规格同步）
2. `statusbar.py::set_info/set_temp`：
   - `set_info<mid>` 中间附加时不覆盖
3. toast 断开到独立 `set_status_temp` 的临时槽：
   - 自动保存成功：不调用 `set_temp`
   - 自动保存失败：`set_temp("自动保存失败")`，保留 2s
   - 其他通知（导出完成等）仍用 temp；只叫一条通道，参照 D-10
4. `specs/00` 修改状态栏口径；`changelog` 写明删除文件名。

**验收**：

- 删除 `tab.path.name` 后标题栏仍可见；不出现「同一文件名三次」
- 自动保存成功后 2 秒内行列/章节不被擦除
- 「导出成功」仍然可以看到 2 秒，不跳走行列

**Toast 口径**：先走 `statusbar.set_status_temp`，不创建浮层；否则需要新组件设计再Phase 8 提案。

---

### Phase 6 · 目录体验与当前规则（IA-05、MO-01 / WP-03+WP-12）

**MO-01 锚点**：

- 文件：`src/assets/toc.js`, `src/assets/app.js`, `reader.js`
- 新 `MDV.toggleToc`：
  ```js
  var anchor = MDV.currentSection();
  var v = MDV.view;
  /* 如果 DOM 可拿到 el id */
  MDV.setTocVisible(on);
  requestAnimationFrame(function(){
    if (anchor.chapterId) MDV.scrollToHeading(anchor.chapterId);
    /* 再校正一笔：top 差距 <= 24 像素 */
  });
  ```
- 只在「手动切换」时生效；启动刷新不跑
- `#toc-list` 内容给 120ms `opacity`，不给 `#toc` 宽度动画

**IA-05 菜单去重**：

- `buildMenuModel`：
  - 单行 `切换目录`（无勾选）
  - 子菜单 `目录规则：自动/始终显示/始终隐藏`（原 radio）
  - 只读状态 `当前：显示（手动）/ 隐藏（规则）/ 显示（自动）`
- Python 的原生回退菜单同步改动或者明确降级（D-04 + D-05）

**IA-12？不涉及**

**验收**：在 50% 高度切换目录，目标行仍在 ±24px；菜单不会出现两个互斥勾同时亮起。

---

### Phase 7 · 命令面板完整化 + 菜单重组（IA-06/IA-07 / WP-13+WP-14）

**WP-13 面板**：

- 每行解析成：
  ```
  { label: "视图 › 目录规则：始终显示", kbd: "（无）", checked: true }
  ```
- 右侧 kbd 列；当前勾写上 `✓`
- 分组标题 `File/Edit/View/Help`（或中文）
- 支持输入 `export` / `导出` 即命中
- 匹配：
  - 低成本把 `indexOf` 升级为子序列匹配，或保留子串 + 搜索范围 = label + kbd + keywords
  - 输入组合键本身也应匹配（如 `ctrl p` / `f` / `ctrl+s`）

**WP-14 顶级归并**：

- 按 D-05 四个顶级，重排 `buildMenuModel`
- 原生回退同步或在 native 模式下显式提示“自定义外壳已归并”（Phase 8 测试路径）
- 确认不影响 F2/拖动/关闭

**验收**：命令面板按回车执行与菜单同等路径；无键盘冒泡 bug。

---

### Phase 8 · 可选与收口（WP-19 ～ WP-30）

- WP-18 / WP-19 / WP-20：仅当 D-08、D-09、D-10 批准后执行
- WP-21 README 修正
- WP-22 ~ WP-28 P3 半修
- WP-29：开始页建议单独一项（如用户批准）
- WP-30：归档、规格更新、TODO.md 状态推进

**归档步骤**：

1. 修改完成后将 `plans/20261106-audit-remediation.md` 迁移到 `specs/archive/plans/`
2. README 与 `specs/changelog.md` 写明 commit
3. TODO.md 追加该阶段，删除“待办”里对应条
4. 关闭方式按项目规约：先 commit 由用户执行；提交信息按变更性质：`Spec: none` 或 `Spec: 00,02,05,06`

---

## 6. 逐项修改清单（工程师照抄的一页纸）

### 6.1 `src/assets/app.html`

- `#statusbar` 内结构：
  - `<span id="status-left"></span>`
  - `<span id="status-mid"></span>`（D-06）
  - `<span id="status-right"></span>`
  - `<span id="status-spot"></span>`（可选，P2）
- `#palette` 保留；如 D-10 同意，临时槽走 status。
- `#win-title` 保留。
- 文件/最近菜单：HTML 不新增；静态 JSON 在 `events` 渲染

### 6.2 `src/assets/app.css`

- 新增 token `:root { --mo-hover:120ms; --mo-switch:160ms; }`
- reduced-motion 块补 `animation:none`
- `.code-bar` 补 `pointer-events`
- `.tab` 补 `background/color` 过渡
- `.menu-item` / `button` 补按下态（可选）

### 6.3 `src/assets/app.js`

- `setTabs`：单标签时不隐藏；标签元素改 role/aria
- `buildMenuModel`：新增「关闭文件」、recent 子菜单、`clearRecent`、Help 命令面板
- `renderMenus`：`button.menu-item` + roving focus + `aria-expanded`
- keydown：`Ctrl+W`, `Ctrl+H`
- `collectCommands`：解析 label/kbd/group/checked
- 事件：`openRecent`, `clearRecent`, `closeActive`
- `MDV.toggleToc`：保锚点
- `MDV.setStatus*`：中间槽

### 6.4 `src/assets/toc.js`

- `nodeRow`：改为 `button`；树/列表 role
- 键盘委托（可与 `app.js` 共用工具）

### 6.5 `src/assets/reader.js`

- 代码工具条 `enhanceCodeBlocks` 只读/焦点型适配
- 新增或改用 `MDV.scrollToHeading(id, offset)`，默认不动上限，额外偏移参数默认 0

### 6.6 `src/ui/main_window.py`

- `_show_help`：补 Ctrl+K / K / Shift+P 等，或重构成模板渲染
- `_bind_shortcuts`：加 Ctrl+W fallback（有焦点窗口时落在 Tk）
- `refresh_recent_menu`：保持兼容；加空列表提示
- `refresh_recent_menu` 或用 `_format_open_recent` 做更友好 label

### 6.7 `src/ui/statusbar.py`

- 新增中间槽推送（`set_mid`）或 `set_status({left, center, right})`
- 自动保存静默链路：只有失败写 temp

### 6.8 `src/main.pyw`

- `_send_ui_meta`：加入 `recent`
- `_on_web_event`：openRecent / clearRecent / closeActive
- `_update_status_tail`：生成 mid/right，改 spots
- `set_*`：与 `toast` 协议对齐
- native 回退：与 custom 共享 10 条 recent 逻辑

### 6.9 `src/actions.py`

- 新增 `close_active`
- `open_recent` 路径存在性校验并触发最近列表刷新
- `clear_recent`

### 6.10 `src/core/session.py`

- 删 `TabState.title`（先 `rg` 确认无外部引用）
- 保留 path/encoding/dirty/cursor/seq 不变

### 6.11 `src/core/config.py`

- 不新增用户字段；如 D-10 把 toast 配置化再谈

### 6.12 文档

- `README.md`：按 D-11 改"8"表述
- `TODO.md`：追加本次阶段状态
- `specs/changelog.md`：每阶段一条
- `plans/20261106-audit-remediation.md`：执行完后移 archive（人工 git mv）
- `AGENTS.md`：如引用计划文件新路径，必须更新

---

## 7. 测试与人工验收矩阵

| WP | 验收动作（人工或 DevTools） | 不可自动化依赖项 |
|---|---|---|
| WP-01 | 模拟 reduce → 打开命令面板无位移 | DevTools |
| WP-02 | Tab 到复制按钮前可见；拖选不触发复制 | 手工 |
| WP-03 | 2.3MB 文档在 50% 位置开/关目录，目标行 ±24px | 大文件副本放 `tmp/`；不碰原文件 |
| WP-08 | 无鼠标闭环；焦点环始终可见 | 手工 |
| WP-09 | 菜单点最近文件；缺失文件报错并剔除 | 手工 |
| WP-10 | Ctrl+W 从 2→1→0；空态仍有可点行为 | 手工 |
| WP-11 | 帮助与欢迎页快捷键一致 | 手工 |
| WP-12 | 目录只显示一项互斥勾 | 手工 |
| WP-13 | 命令面板输 `d` 选中项执行 | 手工 |
| WP-15 | 写作 10 秒无污行列；导出仍可见 | 手工 |
| WP-18 | F2 不闪叠字；标签条 1→2 淡入 | 手工 |
| WP-19 | 深浅主题切换无白闪（若批准遮罩） | 手工 |
| WP-21 | README 文案与运行时一致 | 读代码 |
| WP-30 | specs_check.py 通过 | 需授权 |

**铁律三重申**：本计划不包含自动运行 `smoke_app.py` / `test_bridge_integration.py` / `perf_baseline.py`。需要用户明确「测一下」后单独授权。

**D-03 要求**：如果按规格要求重新生成打包环境，分发同步 `dist-app` 后要用户授权并执行 `diff -r src dist-app/MDViewer/app`（D-03），不能靠「改了」推断生效。

---

## 8. 风险与回滚

| 风险 | 表现 | 概率 | 回滚方式 |
|---|---|---|---|
| 菜单重写影响 F2 / 拖动 / 关闭 | 无法切换或拖动 | 中 | 在 `app.js` 保留旧路径 `renderMenus` 为 `renderMenusV1`，出问题切换回旧模式 |
| 键盘冒泡进入 CodeMirror | CM 已处理键被拦截 | 中 | `if (e.defaultPrevented) return` 保持不动；`Ctrl+W` 优先级最低 |
| 最近文件含其他盘符 / 已删除文件 | 点击报错 | 低 | 打开报错时剔除条目 + 弹窗 |
| 开始页引入非文档状态异常 | 保存/统计/自动保存崩溃 | 中/高 | 不在 WP-10 混入；新开 WP-29 单独拍板 |
| `spec_check.py` 阻止提交 | 项目无法提交 | 高 | 先完成规格与代码，再提交；`--no-verify` 不允许 |
| 状态栏定义变更 | 原生外壳污染 | 中 | 自定义外壳和 `native` 回退写两套结构；默认走 custom |

**回滚 Unit**：每个 Phase 结束都必须是 commit 单元；不要在一个 diff 里跨 WP-01~WP-08 一次性提交。

---

## 9. 不包含的内容

- 不新增第三方 JS 框架 / UI 库 / 动画库
- 不调整四套主题色板、正文字号、版心最大宽度
- 不增加 AI 总结、Markdown 渲染引擎更换
- 不加入触屏手势 / 移动适配
- 不实现 DeepSeek/本地模型接入
- 不改 `cm6.bundle.js` 及 CodeMirror 6 内部结构
- 不构建安装包；不修改 `installer/`
- 不承诺性能提升；分块渲染 60 块/帧不调整
- 不在审批前删除任何用户配置或清理 `.md-viewer-config.json` 中的旧最近文件

---

## 10. 完整任务执行顺序（推荐批准后的跑法）

1. 确认 D-01～D-13 与 Phase 0 规格修订
2. 执行 Phase 1（WP-01/WP-02/WP-05/WP-06/WP-22/WP-27）
3. 执行 WP-08（Phase 2）并验收键盘闭环
4. 执行 WP-09 + WP-10（Phase 3/4）并验收最近文件 / Ctrl+W
5. 执行 WP-11（帮助/快捷键单源）
6. 执行 WP-03（目录锚点）+ WP-12（目录去重）
7. 执行 WP-15（状态栏静默）
8. 执行 WP-13 + WP-14（面板 + 菜单归并）
9. 如批准：执行 WP-16/WP-18/WP-19/WP-20
10. WP-28/WP-21/WP-25 等 P3
11. 更新 Todos、changelog、README，归档计划；再执行 specs_check（授权前提下）

---

## 11. 每日检查清单（开发期间）

- [ ] 只做 Phase 内 WP，不跨阶段
- [ ] 规格是否先于代码变更？
- [ ] 自己能否解释“为什么这行动是 A/B/C 级”？
- [ ] 最近 `git diff --stat` 是否按 WP 拆分？
- [ ] `tools/specs_check.py` 状态（不改 compromise）
- [ ] 是否触碰 `tmp/` 中的示例文件？（原文件禁碰）
- [ ] `.md-viewer-config.json` 未手改
- [ ] 首屏／帮助／菜单三处说明与实际行为一致
- [ ] `--mo-*` token 只出现在 `:root`

---

## 12. 归档说明

本文件从 `plans/` 移动到 `specs/archive/plans/` 的条件：

1. 阶段 1～Phase 7 全部完成并已提交
2. `specs/changelog.md` 对应条目标注"已同步代码"
3. `TODO.md` 对应阶段标注 ✅
4. 用户书面确认可以归档

---

## 13. 一页总结：等待你填写的答案表

| # | 问题 | 待选项 | 你的选择 |
|---|---|---|---|
| D-01 | 最近文件怎么接入 | 推荐 | 待选 |
| D-02 | 单文档关闭形态 | 推荐 | 待选 |
| D-03 | 最后文档去向 | 推荐选项2/最小实现 | 待选 |
| D-04 | 目录控件呈现 | 推荐 | 待选 |
| D-05 | 四顶级菜单 | 推荐 | 待选 |
| D-06 | 状态栏槽位 | 推荐 | 待选 |
| D-07 | 阅读/编辑 chip | 推荐 | 待选 |
| D-08 | F2 0ms 豁免 | 推荐 | 待选 |
| D-09 | 主题切换策略 | 推荐豁免 | 待选 |
| D-10 | toast 定义 | 推荐临时槽 | 待选 |
| D-11 | README 多标签 8 | 推荐改 README | 待选 |
| D-12 | 命令面板在 Help | 推荐 | 待选 |
| D-13 | TabState.title | 推荐删除（先 rg） | 待选 |

填完以后，将从 **Phase 0** 开始执行。任何阶段若走偏，回到 Phase 0 重新提案，不得把"顺手加的小功能"不经审批带入实现。
