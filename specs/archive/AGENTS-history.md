# AGENTS.md 历史来路（归档）

> 2026-11-24 从根目录 `AGENTS.md` 拆出的历史说明。**规则本身仍以 `AGENTS.md` 与 `specs/` 为准**，
> 本文件只解释「这些规矩是怎么来的」，只增不改。

## 一致性闸门的来路（2026-11-01）

原 `post-commit` 钩子靠 `docs/sync.py` 自动生成文档，随 `docs/` 退役一并删除；
`core.hooksPath` 仍指向 `.githooks` 导致钩子静默失效，`specs/` 无任何校验机制，
状态失真因此长期不可见。现行 `tools/specs_check.py` + `.githooks/pre-commit` 即该空缺的替代品。

## 一致性闸门检查项（随实现演进）

| 项 | 查什么 |
|---|---|
| A | `specs/00` 标 ✅ 的功能，其关键实现符号必须存在（`FEATURE_SYMBOLS`） |
| B | `specs/03` 标「未同步」的规则，代码里不得已有实现符号（`RULE_SYMBOLS`） |
| C1 | `TODO.md`「下一步候选」里的 F 编号不得在 `specs/00` 已标 ✅ |
| C2 | `TODO.md` 版本行必须等于 `installer/mdviewer.iss` 的 `MyAppVersion` |
| D | 规格里的 `文件:行号` 不得越界 |
| E | 规格里禁止出现 `文件:行号`（一律 `文件` + 符号名） |
| F | `specs/spec-changelog.md` 的日期标题不得重复（防插入时重复命中） |

## docs/ 旧体系退役（2026-10-30）

`docs/` 26 个文件整体删除。删除前经排查与代码多处不符（D1-D8：如 `session.py` docstring
称 Tk Text 缓冲实际在浏览器、`app.js` 注释 256K 实际 100K、死字段真实落盘等）。
其中仅两份「真源」有保留价值，已收编进 specs，其余不再作为依据：

- `docs/DESIGN.md`（视觉法）+ `docs/requirements.md`（产品口径）→ `specs/00-视觉法与产品口径.md`
- `docs/plans/implementation-plan.md`（进度台账）→ 根目录 `TODO.md`

历史材料（`specs/spec-changelog.md`、`specs/archive/`）中若见到 `docs/...` 指针，一律视为**已失效**。

## 分发与诊断纪律的来源（D-01 ~ D-04）

来源：2026-10-26「exe 报未检测到 WebView2」与「切换 bug 两次误判」排查。
共性教训：**错误被伪装成另一个错误**，导致排查走弯路。

- D-02 落码细节：`md-launcher.cs` 退出码 1=缺运行时、2=缺程序文件、3=调起失败，
  三种文案分别给出缺失路径（winexe 无控制台，MessageBox 是唯一可观测通道；
  用 user32 的 `MessageBoxW` 以免 csc 额外 `/r` 引用）。
- D-04 依据：开源脱敏（2026-10-26）；落点约束见 `specs/01` R-01-05。

## installer/legacy 删除（2026-10-26 开源清理）

`installer/legacy/` 中 `register.bat` 是 v2 平铺布局、`mdviewer_reg.py` 已被 `mdviewer-assoc.cs`
取代，整目录删除。原「历史留档见 `docs/log/2026-10.md`」指针随 `docs/` 删除失效。

## changelog 更名（2026-11-24）

`specs/changelog.md` → `specs/spec-changelog.md`：与根目录对外版本记录 `CHANGELOG.md`
区分开。历史材料里指向旧名的链接即指本目录下的 `specs/spec-changelog.md`。
