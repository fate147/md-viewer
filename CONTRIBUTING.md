# 贡献指南

## ⛔ 硬性规定：本项目遵循 SDD（规格驱动开发）

**任何不附带 `specs/` 修改的 PR，一律拒绝，不做讨论。**

`specs/` 不是文档，是**契约**。代码与规格冲突时，以规格为准；要改行为，
先改规格里对应的规则条目（`R-xx-xx`），再改代码。

一个 PR 被接受的最低要求：

1. 修改了行为 → `specs/0X-*.md` 里对应 R 条目同步更新（含 `文件:行号` 依据）。
2. `specs/changelog.md` 追加一条记录，注明「是否已同步代码」。
3. PR 描述里贴出你在本地跑过的验证输出（见下「验证」）。
4. 纯重构 / 纯格式化 / 纯依赖升级可以不带 specs 修改，但必须在 PR 标题前缀
   `refactor:` / `style:` / `chore:`，并在描述里说明「无行为变更」。

不满足以上任一条 → 关闭，并附本文件链接。

## 三条铁律（维护者与贡献者同等适用）

1. **先查后改** —— 改动前先出只读排查报告，带 `文件:行号`；读不到的地方标「待确认」，不许猜。
2. **先改规格再改代码** —— 见上。
3. **不跑未经授权的测试** —— 不要提交会自动执行 GUI 的 CI 脚本。

## 开发环境

仅 Windows，Python 3.12.x。

```bat
git clone https://github.com/fate147/md-viewer.git
cd md-viewer

rem 依赖分两步装，第二步不能省（原因见 requirements.txt 注释）
pip install -r requirements.txt
pip install "clr-loader==0.2.6" --no-deps

rem 启用仓库自带的 git hook（commit 后自动同步 docs/）
git config core.hooksPath .githooks

run.bat
```

缺少 WebView2 Runtime 时，程序会自己弹提示并给出下载地址，不需要手动预装。

## 验证

**提交 PR 前请自行跑一遍，并把输出贴进 PR 描述：**

```bat
python smoke_app.py               rem 期望输出 SMOKE_PASS
python test_bridge_integration.py rem 期望输出 INTEGRATION_PASS=True
```

GUI 会短暂弹窗后自动退出。若 `INTEGRATION_PASS=False`，请贴完整输出而不是
只说「有 bug」。

性能相关改动另跑 `python perf_baseline.py`（需要自备 2 MB 级 `.md` 样本，
样本不入库，脚本会在缺失时给出提示）。

## 代码结构

| 路径 | 说明 |
|---|---|
| `specs/` | 行为契约，**先读这里** |
| `src/core/` | 零 UI 依赖：配置、会话、文件 IO、主题数据 |
| `src/ui/` | Tk 窗口壳 + WebView2 桥 |
| `src/services/` | 导出、纯文本 |
| `src/assets/` | 前端（CodeMirror 6 编辑层 + marked 阅读层） |
| `installer/` | C# 启动器 / 关联守护 + Inno Setup 脚本 |
| `tools/` | CodeMirror bundle 与图标生成链 |

文本缓冲的权威在前端 `state.docs`，Python 只存元数据——改桥相关逻辑前请先读
`specs/05-桥协议.md`。

## 提交信息

`<type>: <一句话>`，type 取 `feat` / `fix` / `refactor` / `docs` / `chore` / `spec`。
改了规格的 commit，标题请带 `spec:` 前缀。

## 许可

提交即表示你同意以 [MIT](LICENSE) 授权你的贡献。
