# MD Viewer 工程规范（会话入口 · SDD 版）

> **规格驱动开发（SDD）已生效。** 本文件是 AI 与开发者接续工作的唯一入口，强制三条铁律。
> 最后核对：2026-10-26 ｜ SDD 落地：`specs/` 为「防爆宪法」，`docs/` 旧体系降为历史参考（经排查与代码多处不符，见 `specs/archive/功能地图与风险点排查.md` D1-D8）。
>
> 本文件不含进度状态。 进度台账仍在 docs/plans/implementation-plan.md（docs/ 降级后的唯一例外，仅状态追踪用，不作行为依据）。


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
- `specs/` 7 个主规格是当前 v3 行为的权威描述：
  `01` 启动与页面装载 · `02` 文件与标签生命周期 · `03` 编辑⇄阅读双态与排版 · `04` 主题与样式系统 · `05` 桥协议 · `06` 配置与持久化 · `07` 导出与复制纯文本。
- 任何规格变更记入 `specs/changelog.md`（格式：日期 / 变更 / 依据 / 是否已同步代码）。
- 08（安装与关联注册）暂缓，暂不建对应规格。
- 规格与代码冲突的处置顺序（不可跳步）：
    1，先判断是“代码不符合规格”还是“规格本身写错/过时”；
    2，若是代码问题 → 改代码符合规格；
    3，若是规格问题 → 必须先出“规格修订提案”（写明：哪条 R-xx、为什么错、依据 文件:行号、改后条款），用户书面拍板后才改规格，再改代码；
    4，禁止 AI 自行判定“规格错了”就直接改代码或改规格。

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

> 🔒 **任务完成 = 规格已对齐 + 代码完成 + changelog 已记**，缺一不算完成。

---

## 分发与诊断纪律（D-01 ~ D-03）

> 来源：2026-10-26「exe 报未检测到 WebView2」与「切换 bug 两次误判」排查。共性教训：**错误被伪装成另一个错误**，导致排查走弯路。

**D-01 · 启动检测不得吞异常**
能力检测（`webview_available()` 等）禁止裸 `except Exception: return False`。检测失败必须落盘 `md-viewer-error.log`（异常类型 + str + traceback），并区分「能力缺失」与「检测过程本身失败」——两者提示文案与退出码都必须不同。`pythonw` / `winexe` 无控制台，**落盘是唯一可观测通道**。
依据：`specs/01` R-01-06；`src/ui/web_client.py:410-424`；`src/main.pyw:347-361`。

**D-02 · 启动器缺依赖不得静默退出**
`md-launcher.cs` 找不到 `runtime\pythonw.exe` 或 `app\main.pyw` 时必须给出可见错误（MessageBox + 非 0 退出码），禁止 `return` 静默退场。
依据：`installer/md-launcher.cs:32-35`（缺依赖两道闸）、`:49-51`（调起失败）。**2026-10-26 已落码**：退出码 1=缺运行时、2=缺程序文件、3=调起失败，三种文案分别给出缺失路径（winexe 无控制台，MessageBox 是唯一可观测通道；用 user32 的 `MessageBoxW` 以免 csc 额外 `/r` 引用）。

**D-03 · 分发同步必须校验**
A 级快验同步（`cp -r src/. dist-app/MDViewer/app/`）后必须跑 `diff -r src dist-app/MDViewer/app`，校验无输出（唯一允许 ico）。否则验的是旧前端，会得出「改了没生效」的假结论。
依据：2026-10-26 切换 bug 两次误判。

**D-04 · 仓库内禁止出现绝对路径**
所有入库文件（代码 / 文档 / 脚本 / 配置模板）不得出现本机绝对路径或用户名。统一写法：用户目录 `%USERPROFILE%`（bash 用 `~/`）、本地程序目录 `%LOCALAPPDATA%`、临时目录 `tempfile.gettempdir()`、仓库内一律相对路径。新增或修改文件后自查 `C:\Users\` / `C:/Users/` / `D:\` 是否零命中。
依据：开源脱敏（2026-10-26）；`specs/01` R-01-05 的落点说明。

---

## 规格与旧文档的关系（重要）

- specs/ 是唯一权威：一切行为规则以 specs/ 为准。
- docs/ 旧体系（原 `docs/rules/`、`docs/bugs/`、`docs/features/`；2026-10-26 开源清理时已删除/归档）经排查与代码多处不符
  （D1-D8：如 session.py docstring 称 Tk Text 缓冲实际在浏览器、app.js:4 注释 256K 实际 100K、
  死字段真实落盘等），降级为历史参考，不再作为改代码依据。
- 若发现 docs/ 与 specs/ 冲突，以 specs/ 为准，并在排查中提示。
- **例外**：`docs/plans/implementation-plan.md` 是 `docs/` 降级后的唯一例外——**仅作进度追踪，不作行为依据**；其内容若与 `specs/` 冲突，一律以 `specs/` 为准。

## 文档路由（SDD 版）

| 要查什么 | 去哪 |
|---|---|
| 三条铁律 / 标准动作 | 本文件 `AGENTS.md` |
| 行为规则（防爆宪法） | `specs/01~07` + `specs/changelog.md` |
| 逆向摸底证据（D1-D8 / R1-R9） | `specs/archive/功能地图与风险点排查.md` |
| 历史参考（可能过时，**不以之为准**） | `docs/*` |
| 进度状态（仅追踪） | `docs/plans/implementation-plan.md` |
| 对外版本记录 / 贡献流程 / issue 模板 | `CHANGELOG.md`、`CONTRIBUTING.md`、`.github/ISSUE_TEMPLATE/` |

## 已知待确认（待拍板 / 待读，不得臆测）

- ~~`mdviewer_reg` 失败模式（R-01-04，属 08 暂缓范围）~~ → `installer/legacy/mdviewer_reg.py` 已于 2026-10-26 删除，关联注册全权移交 `installer/mdviewer-assoc.cs`；本条作废（`src/services/registry.py` 已随之删除，见 changelog）
- `cm6.bundle.js` 内部 API（R-03-08）
- `recent_files` 中 `PRODUCT.md` 悬空引用（R-06-05）

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
python smoke_app.py                 # 冒烟：启动→页面就绪→欢迎渲染
python perf_baseline.py             # 2.3MB 性能基线（在 %TEMP% 副本上测，不碰原文件）

# CodeMirror 6 离线 bundle 重建（改 tools/cm6/entry.js 后）
cd tools/cm6 && npm install && npm run build

# 打包（便携运行时 + Inno 安装器；负载与安装器都别放 Documents 下）
# ① 组装负载：拷本机 Python312 → dist-app\MDViewer\runtime（剪枝无关包至 ~155MB）
#    + src → dist-app\MDViewer\app
#    + csc 编译两个 exe，都要带图标（CSC=C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe；
#      必须在 installer\ 下用相对路径跑，绝对路径会被 csc 吞成文件名）：
#      $CSC -target:winexe -win32icon:assets/mdviewer.ico -out:../dist-app/MDViewer/md-viewer.exe md-launcher.cs
#      $CSC -target:winexe -win32icon:assets/mdviewer.ico -out:mdviewer-assoc.exe mdviewer-assoc.cs
#      再把 mdviewer-assoc.exe 拷进 dist-app\MDViewer\
# ② 🔥 搬家验证（不可跳过，见 specs/01 R-01-05）：dist-app 在 Documents/OneDrive 同步树下，
#    .NET 的 Assembly.LoadFrom 在该树下必挂（报 Failed to resolve … Loader.Initialize，
#    会被误当成「没装 WebView2」，2026-10-26 踩坑）。先把负载拷到非同步路径再验：
#      robocopy dist-app\MDViewer %USERPROFILE%\Build\md-viewer\portable /E /NFL /NDL
#      cd /d %USERPROFILE%\Build\md-viewer\portable
#      runtime\python.exe -B -c "import clr; print('CLR_OK')"                                          → 必须 CLR_OK
#      runtime\python.exe -B -c "from tkwebview2.tkwebview2 import have_runtime; print(have_runtime())" → 必须 True
#      runtime\python.exe app\main.pyw                                                                  → 窗口出现
#    三项全过才允许继续，任一失败即中止出包。**禁止在 dist-app 原地验证**（会得到假失败）。
# ③ WebView2 离线运行时：curl -L -o installer/WebView2RuntimeX64.exe ^
#      https://go.microsoft.com/fwlink/?linkid=2099617
# ④ 出安装包：
"$LOCALAPPDATA/Programs/Inno Setup 6/ISCC.exe" installer/mdviewer.iss
#    → dist-app\MDViewerSetup-1.0.0.exe
# ⑤ 🔥 换目录再跑（别在 Documents 下双击，会秒退或报 Error 5 拒绝访问）：
#    cp dist-app/MDViewerSetup-1.0.0.exe ~/Build/md-viewer/ && 从那里安装
#    静默装： Setup.exe /VERYSILENT /NORESTART

# 图标改版（改 installer\assets\mdviewer-icon.svg 之后）
bash tools/icon/render_svg.sh                 # Edge headless 渲 7 档尺寸到 %LOCALAPPDATA%\mdv-icon
python tools/icon/build_ico.py "$LOCALAPPDATA/mdv-icon" installer/assets/mdviewer.ico
#   然后重编上面两个 exe + 拷 ico 进 dist-app\MDViewer\app\assets\ + 重跑 ISCC
#   桌面/资源管理器图标有缓存：taskkill /f /im explorer.exe & explorer.exe 或 ie4uinit -show

# 文档（SDD 下仅记录用；行为规则以 specs/ 为准）
python docs/append_log.py "标题" --bg "背景" --do "处理" --ref "指针"
python docs/sync.py --check
```

## 保留资产

- `installer\mdviewer-assoc.cs` + 同名 `.exe` —— .md 关联守护（系统 csc 编译，勿删）
- `installer\md-launcher.cs` —— 便携版 C# 启动器源码
- `installer\mdviewer.iss` —— Inno Setup 安装器脚本
- `installer\assets\mdviewer-icon.svg` + `mdviewer.ico` —— 应用/文件图标（自绘矢量，蓝 `Md` 字样 + 纸页；ico 由 `tools/icon/` 生成，勿手改）
- `installer\WebView2RuntimeX64.exe` —— WebView2 离线运行时（不入库，fwlink 2099617 重下）
- `installer\legacy\` —— **已于 2026-10-26 开源清理删除**（`register.bat` 是 v2 平铺布局、`mdviewer_reg.py` 已被 `mdviewer-assoc.cs` 取代）。历史留档见 `docs/log/2026-10.md:67`
- `dist-app\` —— 打包负载与 MDViewerSetup 产物（不入库）
