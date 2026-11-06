<!-- MACHINE-WORKSPACE-20261105 -->
## 本机统一项目与构建入口

操作前读取 C:\Projects\电脑统一规划\AGENT-RULES.md 和 projects.json，核对当前项目路径。
正式项目仅使用登记的 C:\Projects 下目录。D:\新建文件夹\DeepSeek 是迁移前保留副本，不再开发或构建。
不得为换 Agent 复制/clone/worktree 项目，不另设编译输出；未知输出先查配置。
所有生成物（安装包、便携负载、日志、截图、临时产物）只允许写在项目内；禁止写到 `%USERPROFILE%\Build`、Documents、桌面或任何项目外目录。旧外部落点 `C:\Users\89659\Build\md-viewer` 已删除，不再重建。
本项目原有产品、规格、数据保护和测试授权纪律仍须遵守。旧 E 盘/旧 Documents 路径属于迁移前记录，不据此新建目录。
<!-- /MACHINE-WORKSPACE-20261105 -->

# MD Viewer 工程规范（会话入口 · SDD 版）

> **规格驱动开发（SDD）已生效。** 本文件是 AI 与开发者接续工作的唯一入口，强制三条铁律。
> 最后核对：2026-10-30 ｜ SDD 落地：`specs/` 为「防爆宪法」，`docs/` 旧体系已于 2026-10-30 整体删除
> （原经排查与代码多处不符，见 `specs/archive/功能地图与风险点排查.md` D1-D8；其中两份真源文档
> `DESIGN.md` 视觉法、`requirements.md` 产品口径已收编为 `specs/00`）。
>
> 本文件不含进度状态。 进度台账在根目录 `TODO.md`（全项目唯一状态源，仅状态追踪用，不作行为依据）。


## ⛔ 三条铁律（不可逾越，优先级高于一切旧约定）

### 铁律一 · 先查后改
- 任何 bug / 需求 / 改动请求，**第一回应必须是「只做排查分析，不改代码」**。
- 输出带 `文件路径:行号` 的排查报告；读不到的标「未验证 / 待确认」，**严禁推测编造**。
- 用户拍板前，任何业务代码、配置、测试脚本都不得动。
- 依据：用户 SDD 第一步纪律（只查不改）+ 本步骤纪律。
- 接到任何 bug/需求，第一回应固定为：
“收到。按铁律一，我先只做排查分析、不改代码。将读 AGENTS.md + specs/XX，输出带 文件:行号 的排查报告与方案，交你拍板。在你拍板前不动任何代码/配置/测试。

### 铁律二 · 先改规格，再改代码
- 任何逻辑改动，**先更新 `specs/` 对应主规格的规则条目（R-xx），再动一行代码**。
- 规格是代码必须满足的契约；代码与规格冲突时，改代码去符合规格（或先提议改规格、等拍板）。
- `specs/` 8 份规格是当前 v3 行为的权威描述：
  `00` 视觉法与产品口径（取值与范围）· `01` 启动与页面装载 · `02` 文件与标签生命周期 · `03` 编辑⇄阅读双态与排版 · `04` 主题与样式系统 · `05` 桥协议 · `06` 配置与持久化 · `07` 导出与复制纯文本。
  其中 `01~07` 是机制契约（含 `R-xx-xx` 规则条目），`00` 是口径规格（色值/排版数值/功能清单/性能阈值），**不含 `R-xx` 条目**。
- 任何规格变更记入 `specs/changelog.md`（格式：日期 / 变更 / 依据 / 是否已同步代码）。
- 08（安装与关联注册）暂缓，暂不建对应规格（故 `00` 不占用 08 编号）。
- 规格与代码冲突的处置顺序（不可跳步）：
    1，先判断是“代码不符合规格”还是“规格本身写错/过时”；
    2，若是代码问题 → 改代码符合规格；
    3，若是规格问题 → 必须先出“规格修订提案”（写明：哪条 R-xx、为什么错、依据 文件:行号、改后条款），用户书面拍板后才改规格，再改代码；
    4，禁止 AI 自行判定“规格错了”就直接改代码或改规格。

### 变更分类与规格落点（2026-11-05 建立）

**不是每个小 bug 都要改规格。** 按变更性质分类：

| 变更性质 | 规格动作 | 提交声明 |
|---|---|---|
| 功能 / 流程 / 契约变化 | **必须**先改对应 `specs/0X` 的 R-xx/数值，再改代码；同步 `specs/changelog.md` | `Spec: 00,04`（列实际改的编号） |
| 小 bug / 重构 / 性能 / 纯样式修正 | 不强制改规格 | `Spec: none` |
| 纯文档 / 打包 / 构建流程 | 不强制改 `specs/`（改 `AGENTS.md`/打包文档即可） | `Spec: none` |

**规格落点速查**：

| 改动内容 | 对应规格 |
|---|---|
| 视觉数值、外壳尺寸、排版口径 | `00` + `04` |
| 启动、窗口、标题栏、最大化/缩放 | `01` |
| 编辑/阅读切换、目录、文档判别 | `03` |
| 主题、字体、CSS 变量、外壳 token | `04` |
| 桥方法、事件、`set_ui_meta` 字段 | `05` |
| 配置字段、持久化 | `06` |
| 导出 HTML、复制纯文本 | `07` |

闸门：`.githooks/commit-msg` 调用 `tools/sdd_gate.py`。`feat` 提交必须写 `Spec: 00,04` 并实际包含对应规格与 changelog；写 `Spec: none` 或漏写会被拒绝。`fix/refactor/perf/docs/chore` 可写 `Spec: none`。

### 铁律三 · 严禁私自跑测试
- 没有用户**明确「测一下」**的指令，绝不运行任何测试脚本
  （`test_bridge_integration.py` / `smoke_app.py` / `perf_baseline.py` 等）。
- 排查与分析阶段只读源码，不执行、不安装、不跑测试。

---

## 标准动作（第四步起，每次需求都走这套）

1. 读 `AGENTS.md` + 相关 `specs/*.md`（先确认规则）。
2. 只读排查，出方案（带 `文件:行号`），交用户拍板。
3. 用户拍板后：**先改 `specs/` 规则 → 再改代码**。
4. 改完更新 `specs/changelog.md`（把对应条目标为「已同步代码」）。
5. 跑 `py -3.12 tools/specs_check.py` 确认规格与代码一致（提交时钩子会自动跑一次）。
6. 提交信息按变更性质写 `Spec: 00,04` 或 `Spec: none`；commit-msg 钩子会校验。

> 🔒 **任务完成 = 规格已对齐 + 代码完成 + changelog 已记**，缺一不算完成。

### 一致性闸门（2026-11-01 建立）

`tools/specs_check.py` + `.githooks/pre-commit` 组成机器闸门，双向校验：

- 规格标 ✅ 但代码里找不到标志性符号 → **失败**
- 规格标 ⏳/未做 但代码已实现 → **失败**（F21/F22/F23 就是这样失真的）
- 规格标「未同步」但代码已实现 → **失败**

失败即**阻止提交**，强制回到铁律二。跳过只能用 `git commit --no-verify`。

> **来路**：原 `post-commit` 钩子靠 `docs/sync.py` 自动生成文档，随 `docs/` 退役一并删除；
> `core.hooksPath` 仍指向 `.githooks` 导致钩子静默失效，`specs/` 无任何校验机制，
> 状态失真因此长期不可见。本闸门即该空缺的替代品。

### 代码引用规范（2026-11-02 建立）

`specs/` 引用代码依据时**一律写「`文件` `符号名`」**（如 `web_client.py` `request_text`、`app.js` `MDV.setTabs`），**不再写裸行号**——行号随重构频繁漂移，会让规格“看着对、实则错”（本轮实测 `main.pyw` 因新增窗口逻辑，相关行号已整体偏移 100+ 行）。

- 历史遗留的 `文件:行号` 引用已**全部改为 `文件`/符号名**；`tools/specs_check.py` 现对 specs 中任何 `文件:行号` **直接阻止提交**（`check_no_line_refs`），从机制上杜绝再漂移。
- 新增/修改规格必须用符号引用；确实无法命名时才用行号，且不得越界。

### 计划文档与归档（2026-11-02 建立）

- **改功能先出计划**：计划文档写到 `plans/YYYYMMDD-<功能名>.md`（`plans/` 只放「进行中」的计划）。
- **完成即归档（提示词自带命令）**：当对应功能的「规格 + 代码 + 测试」都完成并提交后，执行：
  ```bash
  mkdir -p specs/archive/plans && git mv plans/<文件>.md specs/archive/plans/
  ```
  并在 `specs/changelog.md` 记一条（日期 / 变更 / 依据 / 是否已同步）。
- 目的：`plans/` 始终只留未完成项，历史计划归档到 `specs/archive/plans/`，避免越积越多；归档件是历史证据、只增不改。

---

## 分发与诊断纪律（D-01 ~ D-03）

> 来源：2026-10-26「exe 报未检测到 WebView2」与「切换 bug 两次误判」排查。共性教训：**错误被伪装成另一个错误**，导致排查走弯路。

**D-01 · 启动检测不得吞异常**
能力检测（`webview_available()` 等）禁止裸 `except Exception: return False`。检测失败必须落盘 `md-viewer-error.log`（异常类型 + str + traceback），并区分「能力缺失」与「检测过程本身失败」——两者提示文案与退出码都必须不同。`pythonw` / `winexe` 无控制台，**落盘是唯一可观测通道**。
依据：`specs/01` R-01-06；`web_client.py` `webview_available`；`main.pyw` `_guarded`。

**D-02 · 启动器缺依赖不得静默退出**
`md-launcher.cs` 找不到 `runtime\pythonw.exe` 或 `app\main.pyw` 时必须给出可见错误（MessageBox + 非 0 退出码），禁止 `return` 静默退场。
依据：`installer/md-launcher.cs`（缺依赖两道闸 / 调起失败）。**2026-10-26 已落码**：退出码 1=缺运行时、2=缺程序文件、3=调起失败，三种文案分别给出缺失路径（winexe 无控制台，MessageBox 是唯一可观测通道；用 user32 的 `MessageBoxW` 以免 csc 额外 `/r` 引用）。

**D-03 · 分发同步必须校验**
A 级快验同步（`cp -r src/. dist-app/MDViewer/app/`）后必须跑 `diff -r src dist-app/MDViewer/app`，校验无输出（唯一允许 ico）。否则验的是旧前端，会得出「改了没生效」的假结论。
依据：2026-10-26 切换 bug 两次误判。

**D-04 · 仓库内禁止出现绝对路径**
所有入库文件（代码 / 文档 / 脚本 / 配置模板）不得出现本机绝对路径或用户名。统一写法：用户目录 `%USERPROFILE%`（bash 用 `~/`）、本地程序目录 `%LOCALAPPDATA%`；**测试/截图/临时产物统一写项目内 `tmp/`（gitignored），禁止写系统临时目录或项目外**；仓库内一律相对路径。新增或修改文件后自查 `C:\Users\` / `C:/Users/` / `D:\` 是否零命中。
依据：开源脱敏（2026-10-26）；`specs/01` R-01-05 的落点说明。

---

## 规格体系（唯一权威）

- specs/ 是唯一权威：一切行为规则以 specs/ 为准。
- `docs/` 旧体系已于 **2026-10-30 整体删除**（26 个文件）。删除前经排查与代码多处不符
  （D1-D8：如 session.py docstring 称 Tk Text 缓冲实际在浏览器、app.js 注释 256K 实际 100K、
  死字段真实落盘等）。其中仅两份「真源」有保留价值，已收编进 specs，其余不再作为依据：
  - `docs/DESIGN.md`（视觉法） + `docs/requirements.md`（产品口径）→ **`specs/00-视觉法与产品口径.md`**
  - `docs/plans/implementation-plan.md`（进度台账）→ **根目录 `TODO.md`**
- 若在历史材料（`specs/changelog.md`、`specs/archive/`）中见到 `docs/...` 指针，一律视为**已失效**，
  以现行 `specs/` 正文为准。
- 规格编号：`00` 口径（取值与范围）｜`01~07` 机制契约｜`08` 暂缓未建（安装与关联注册）。

## 文档路由（SDD 版）

| 要查什么 | 去哪 |
|---|---|
| 三条铁律 / 标准动作 | 本文件 `AGENTS.md` |
| 行为规则（防爆宪法） | `specs/01~07` + `specs/changelog.md` |
| 产品口径 / 视觉法数值（色值·排版·功能清单·性能阈值） | `specs/00-视觉法与产品口径.md` |
| 逆向摸底证据（D1-D8 / R1-R9） | `specs/archive/功能地图与风险点排查.md` |
| 进度状态（仅追踪，全项目唯一） | 根目录 `TODO.md` |
| 对外版本记录 / 贡献流程 / issue 模板 | `CHANGELOG.md`、`CONTRIBUTING.md`、`.github/ISSUE_TEMPLATE/` |

## 已知待确认（待拍板 / 待读，不得臆测）

- ~~`mdviewer_reg` 失败模式（R-01-04，属 08 暂缓范围）~~ → `installer/legacy/mdviewer_reg.py` 已于 2026-10-26 删除，关联注册全权移交 `installer/mdviewer-assoc.cs`；本条作废（`src/services/registry.py` 已随之删除，见 changelog）
- `cm6.bundle.js` 内部 API（R-03-08）
- `recent_files` 中 `PRODUCT.md` 悬空引用（R-06-05）—— **2026-10-30 已确认存在**（本地配置含 `PRODUCT.md`、
  `docs/MODULES.md` 及 3 条其他项目的 D 盘绝对路径）；该文件被 `.gitignore` 覆盖、不入库，
  **属本地动作、尚未清理**，详见 `TODO.md`。

---

## 常用命令（原样保留；执行类需铁律三授权）

```bash
# 开发运行 / 依赖（双击 run.bat 亦可，它会自检 Python 版本与依赖，缺什么直接报命令）
pip install -r requirements.txt
pip install "clr-loader==0.2.6" --no-deps   # 第二步不可省：漏了会装 0.3.x，启动报「运行时装配失败」
python src/main.pyw

# 回归测试（GUI 短暂弹窗自动退出；跑完看 INTEGRATION_PASS / SMOKE_PASS）
# ⚠️ 铁律三：未经用户「测一下」授权，禁止运行以下任何脚本
python test_bridge_integration.py   # 桥链路：装载/编辑/保存/多标签隔离
python smoke_app.py                 # 冒烟：启动→页面就绪→开始页（零文档）
python perf_baseline.py             # 2.3MB 性能基线（在项目内 tmp/ 副本上测，不碰原文件）

# CodeMirror 6 离线 bundle 重建（改 tools/cm6/entry.js 后）
cd tools/cm6 && npm install && npm run build

# 打包（便携运行时 + Inno 安装器；所有生成物固定在项目内 dist-app，禁止复制到项目外）
# ① 组装负载：拷本机 Python312 → dist-app\MDViewer\runtime（剪枝无关包至 ~155MB）
#    + src → dist-app\MDViewer\app
#    + csc 编译两个 exe，都要带图标（CSC=C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe；
#      必须在 installer\ 下用相对路径跑，绝对路径会被 csc 吞成文件名）：
#      $CSC -target:winexe -win32icon:assets/mdviewer.ico -out:../dist-app/MDViewer/md-viewer.exe md-launcher.cs
#      $CSC -target:winexe -win32icon:assets/mdviewer.ico -out:mdviewer-assoc.exe mdviewer-assoc.cs
#      再把 mdviewer-assoc.exe 拷进 dist-app\MDViewer\
#      ▲ 上面两条 csc 的等价一键版：双击 tools\pack\build_exe.bat（相对路径已在脚本内处理，纯 ASCII 无中文）
# ② 🔥 出包前验证（不可跳过，见 specs/01 R-01-05）：项目已迁移到 C:\Projects（非同步树），
#    直接在项目内原地验证，不要再复制到 %USERPROFILE%\Build\md-viewer：
#      cd /d C:\Projects\md-viewer\dist-app\MDViewer
#      runtime\python.exe -B -c "import clr; print('CLR_OK')"                                          → 必须 CLR_OK
#      runtime\python.exe -B -c "from tkwebview2.tkwebview2 import have_runtime; print(have_runtime())" → 必须 True
#      runtime\pythonw.exe app\main.pyw                                                                 → 窗口出现
#    三项全过才允许继续，任一失败即中止出包。
# ③ WebView2 离线运行时：curl -L -o installer/WebView2RuntimeX64.exe ^
#      https://go.microsoft.com/fwlink/?linkid=2099617
# ④ 出安装包（产物固定在项目内 dist-app）：
"$LOCALAPPDATA/Programs/Inno Setup 6/ISCC.exe" installer/mdviewer.iss
#    → dist-app\MDViewerSetup-1.0.5.exe
# ⑤ 安装测试直接从项目内运行，禁止复制到项目外：
#    dist-app\MDViewerSetup-1.0.5.exe
#    静默装： dist-app\MDViewerSetup-1.0.5.exe /VERYSILENT /NORESTART

# 图标改版（改 installer\assets\mdviewer-icon.svg 主版 或 mdviewer-icon-small.svg 小尺寸版之后）
bash tools/icon/render_svg.sh tmp/icon        # Edge headless 渲 7 档尺寸到项目内 tmp/icon
                                              #   N<=48 用 small 版、64 起用主版（见脚本头注释）
python tools/icon/build_ico.py tmp/icon installer/assets/mdviewer.ico
#   然后重编上面两个 exe + 拷 ico 进 dist-app\MDViewer\app\assets\ + 重跑 ISCC
#   桌面/资源管理器图标有缓存：taskkill /f /im explorer.exe & explorer.exe 或 ie4uinit -show

# 文档（SDD 下仅记录用；行为规则以 specs/ 为准）
# docs/ 已于 2026-10-30 整体删除：append_log.py / sync.py 随之移除，无替代命令。
# 行为规则变更一律改 specs/ 主规格，并在 specs/changelog.md 留痕（格式：日期 / 变更 / 依据 / 是否已同步代码）。
# 进度状态改根目录 TODO.md（全项目唯一台账）。
```

## 保留资产

- `installer\mdviewer-assoc.cs` + 同名 `.exe` —— .md 关联守护（系统 csc 编译，勿删）
- `installer\md-launcher.cs` —— 便携版 C# 启动器源码
- `installer\mdviewer.iss` —— Inno Setup 安装器脚本
- `installer\assets\mdviewer-icon.svg`（主版）+ `mdviewer-icon-small.svg`（16–48px 专用）+ `mdviewer.ico` —— 应用/文件图标（自绘矢量，纸白底 `#F7F6F3` + 墨黑井号 `#1A1B1E` + 钴蓝 M `#2D5BFF`；ico 由 `tools/icon/` 生成，勿手改）
- `installer\WebView2RuntimeX64.exe` —— WebView2 离线运行时（不入库，fwlink 2099617 重下）
- `installer\legacy\` —— **已于 2026-10-26 开源清理删除**（`register.bat` 是 v2 平铺布局、`mdviewer_reg.py` 已被 `mdviewer-assoc.cs` 取代）。原「历史留档见 `docs/log/2026-10.md`」指针随 `docs/` 于 2026-10-30 删除而失效，结论以本行与 `specs/changelog.md` 为准
- `dist-app\` —— 打包负载与 MDViewerSetup 产物（不入库；唯一生成物落点，禁止复制到项目外）
