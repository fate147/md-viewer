# 2026-11-05 · PhotoMM 外壳视觉对齐 + 启动尺寸 + 版心加宽

## 背景与拍板

用户认可 PhotoMM 的圆角窗口与菜单质感，要求：

1. 圆角窗口真正露出桌面；外壳尺寸跟随 PhotoMM；
2. 内容区仍用 md-viewer 自己的排版，只把版心适当加宽；
3. 启动永远是普通窗口，不再铺满桌面。

拍板值：外壳 44px 标题栏 / 14px 菜单与侧栏；内容版心 42em（书卷）/ 46em（文档、编辑器）；启动始终普通窗口。

## 范围

**做**

- Win10 用 `SetWindowRgn` + 10px 圆角 + 2px 外缩；最大化时清区域；Win11 走系统圆角。
- 外壳**结构/尺寸**跟随 PhotoMM（44px 标题栏、14px 菜单/侧栏、10px 圆角），配色仍由原四主题决定；标题栏、菜单、下拉、TOC、窗口按钮、滚动条、命令面板统一。
- 外壳 token 改由 `theme.py` 下发，`app.js.setUIMeta` 应用；`app.css` 只消费变量。
- 启动尺寸夹取到屏幕 90% 内并居中；退出时保存最后正常尺寸，最大化尺寸不落盘；启动不恢复最大化。
- 版心：书卷 42em、文档 46em、编辑器 46em、导出版心同步 42em。
- 滚动条贴窗口最右：`#reader` / `#editor-host` 保持全宽滚动，版心移到 `.md-body > *` / `.cm-content`。

**不做**

- 不动内容主题、字体、阅读排版规则、编辑器/TOC/导出逻辑。
- 不引入 Tauri、npm 或任何新依赖。
- 不构建、不跑测试脚本（按铁律三）；不修改 PhotoMM。

## 规格变更（先行）

- `specs/00`：外壳数值表、外壳色板、版心数值、圆角说明。
- `specs/01` R-01-07：Win10 区域圆角；启动始终普通窗口、尺寸记忆与夹取。
- `specs/04` R-04-07：外壳 token 改为 `--shell-*`，由 `theme.py shell_vars()` 经 `setUIMeta` 下发。
- `specs/06` R-06-08：`window.maximized` 为死字段，不读不写。
- `specs/changelog.md`：记录本次变更。

## 代码落点

| 文件 | 改动 |
|---|---|
| `src/ui/win_chrome.py` | `apply_round_region` 恢复实现（DPI、2px 外缩、最大化清区域） |
| `src/main.pyw` | `_normal_geo` 跟踪、启动尺寸夹取、最大化后重算圆角、`shellVars` 下发 |
| `src/actions.py` | `_save_layout` 保存正常尺寸而非最大化尺寸 |
| `src/core/config.py` | 默认 1200×800，删除 `window.maximized` |
| `src/core/theme.py` | `shell_vars()` 浅/深色板；导出版心 42em |
| `src/assets/app.css` | 外壳组件样式、版心三处、外壳 token 兜底 |
| `src/assets/app.js` | `setUIMeta` 应用 `shellVars` |
| `src/assets/app.html` | 不新增结构；沿用现有标题栏/菜单 |

## 验收

- Win10 普通窗口四角露桌面、最大化无缺口；拖边/还原/切主题后不破。
- 关闭再启动始终普通窗口，尺寸不铺满；最大化后退出，下次回到正常尺寸。
- 书卷/文档/编辑区版心一致变宽；四套内容主题与导出样式不受影响。
- `tools/specs_check.py` 通过（规格一致性闸门，不是测试脚本）。

## 风险

- Win10 区域圆角无抗锯齿，近看可能有轻微锯齿；如不可接受，另行立项做透明宿主验证。
- 圆角区域与 DPI、多显示器、拖边缩放需要实机验证。