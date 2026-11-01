# MD Viewer

> 无干扰的 Windows 桌面 Markdown 阅读与写作工具。界面的存在是为了被遗忘。

打开即读，F2 即写，装完接管 `.md` 关联。无账号、无网络、无遥测。

> **给开发者**：本项目遵循 **SDD（规格驱动开发）**。动手前请先读
> [`AGENTS.md`](AGENTS.md)，再读 [`specs/`](specs/)，最后才看 `src/`。
> 不带 `specs/` 修改的 PR 不予受理 —— 见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 特性

- **纸间微光排版**：衬线窄栏、两端对齐、段首缩进；四套主题（paper / midnight / forest / pure）
- **双排版模式**：自动识别「书卷」（小说/长文，卷章分层）与「文档」（笔记/技术文档），也可手动切换
- **大文件流畅**：2.3MB 纯文本实测 —— 打开 1.50s / F2 带重渲 93ms / 切回 13ms
- **超长文档可读**：超 100 万字符自动分块渲染，占位撑高 + 滚动增量注入，几十 MB 也能翻到底
- **编辑即写作**：CodeMirror 6 源码编辑，与阅读层同页 F2 秒切，光标锚点自动对齐
- **多标签**：上限 8 个，会话恢复 + 最近文件
- **本地优先**：配置只存在本地 JSON

## 架构

WebView2 **单页双态**：编辑层（CodeMirror 6）与阅读层（marked + highlight.js）常驻同一个
Chromium 页面，靠 `hidden` 属性切换；Tk 只做窗口壳。文本缓冲权威在页面 `state.docs`，
Python 只存元数据，落盘经桥异步拉全文（分块 100K，轮询 120ms）。

```
Tk 窗口壳 ────── WebView2 (Chromium)
  菜单 / 状态栏     ├─ 编辑层 CodeMirror 6
  文件对话框        ├─ 阅读层 marked + hljs
                    ├─ 标签条
                    └─ 桥（分块 / 轮询）
```

## 快速开始

源码运行（Windows + Python 3.12 + WebView2 Runtime）：

```bat
rem 依赖分两步装，第二步不能省（原因见 requirements.txt 注释）
pip install -r requirements.txt
pip install "clr-loader==0.2.6" --no-deps

run.bat
```

或手动 `python src/main.pyw`。也可以双击 `run.bat` —— 它会先自检 Python 与依赖，
缺什么直接告诉你该执行哪条命令。

安装版：`MDViewerSetup-x.y.z.exe`，用户级安装（免管理员权限），内嵌 WebView2 离线运行时。

## 已知限制

- 仅 Windows（依赖 WebView2 + .NET Framework 4.6.2+）
- **不要把程序放在 Documents / OneDrive 等同步目录下运行** —— .NET 的
  `Assembly.LoadFrom` 在这些目录会失败（详见 `specs/01` R-01-05）
- 标签上限 8 个；不做插件、不做云同步

## 架构方法：规格驱动开发（SDD）

这个项目把「文档」当「契约」用。`specs/` 不是给人看的说明书，是代码**必须满足**
的规则集合——它是全项目唯一权威。原 `docs/` 旧体系已于 2026-10-30 整体删除，
其中仍有价值的两份真源（视觉法、产品口径）已收编为 `specs/00`。

### 先读 AGENTS.md，再读代码

推荐顺序（约 40 分钟，比直接翻 `src/` 快得多）：

1. [`AGENTS.md`](AGENTS.md) —— 三条铁律、分发与诊断纪律 D-01~D-04、打包流程
2. [`specs/`](specs/) —— 8 份规格（00 口径 + 01~07 机制），每份由若干 `R-xx-xx` 规则条目组成
3. `src/` —— 此时再看代码，每条实现都能对上一条规则

| 规格 | 管什么 |
|---|---|
| [`00-视觉法与产品口径`](specs/00-视觉法与产品口径.md) | 四主题色值、排版数值、字体栈、F01–F20 功能清单、非功能需求与验收五步 |
| [`01-启动与页面装载`](specs/01-启动与页面装载.md) | STA 初始化、内容装载顺序、便携包落点约束、启动期报错必须吐真话 |
| [`02-文件与标签生命周期`](specs/02-文件与标签生命周期.md) | 跨语言主键、关闭时序、编码回写、标签上限 |
| [`03-编辑⇄阅读双态与排版`](specs/03-编辑⇄阅读双态与排版.md) | F2 切换、光标锚点、书卷/文档判定、渲染归属 |
| [`04-主题与样式系统`](specs/04-主题与样式系统.md) | 颜色唯一数据源、主题新增的三处同步点、高亮唯一实现 |
| [`05-桥协议`](specs/05-桥协议.md) | 上下行分块、轮询、在途回调超时与重发 |
| [`06-配置与持久化`](specs/06-配置与持久化.md) | 配置字段、原子写、最近文件 |
| [`07-导出与复制纯文本`](specs/07-导出与复制纯文本.md) | HTML 导出、纯文本规则、slug 同源 |
| [`changelog.md`](specs/changelog.md) | 每次规格变更的流水账（含「是否已同步代码」） |

### 三条铁律

1. **先查后改** —— 任何改动先出只读排查报告（带 `文件:行号`），拍板后才动代码
2. **先改规格再改代码** —— 行为变更必须先改 `specs/` 对应 `R-xx-xx`
3. **不跑未经授权的测试** —— 测试需要显式指令才执行

### 为什么不按常规来

因为这是一个人维护的项目，而 AI 参与度高。没有契约，模型每次都会「顺手优化」
出与既有行为不一致的代码；有了 `specs/` + `changelog.md`，任何偏离都能被指着
条款拒绝。代价是前期慢，收益是三个月后还能改得动。

### 目录

```
specs/       规格宪法（00 视觉法与产品口径 / 01 启动 / 02 标签 / 03 双态 /
             04 主题 / 05 桥 / 06 配置 / 07 导出 + changelog + archive）
src/         应用源码
installer/   C# 启动器 + Inno Setup 脚本
tools/       CodeMirror bundle 与图标生成链
TODO.md      进度台账（全项目唯一状态源）
```

## 技术栈

Python 3.12 · pywebview + tkwebview2（pythonnet / WebView2）· Tk（窗口壳）·
CodeMirror 6 · marked · highlight.js · Inno Setup 6

## License

[MIT](LICENSE)
