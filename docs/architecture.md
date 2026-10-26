# 架构设计

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-10-12

## 架构概览

**WebView2 单页双态架构**（2026-10-11 重构）：编辑器（CodeMirror 6）与
阅读层同页共存于一个 Chromium 页面，F2 页内显隐切换；Tk 只剩窗口壳。

```text
┌──────────────────────────────────────────────┐
│ Tk 菜单栏（文件/编辑/主题/视图/帮助，原生）      │
├──────────────────────────────────────────────┤
│ WebView2 客户区 = assets/app.html 单页        │
│   ┌ Tabbar（CSS 绘制，≥2 文件才显示）          │
│   ├ CodeMirror 6 编辑层  ⇄ F2 ⇄  阅读层       │
│   │   （两个层常驻同一 DOM，显隐互换零导航）     │
├──────────────────────────────────────────────┤
│ Tk 状态栏（字数 | 行列 | 编码 | 文件名 | 主题）  │
└──────────────────────────────────────────────┘
```

## 三层架构

```text
ui/     →  services/  →  core/
壳+桥        业务服务       基础逻辑
```

- **core**：纯逻辑，零 UI 依赖（config/theme/fileio/session）
- **services**：业务服务，零 UI 依赖（plain_text/export/registry）
- **ui**：窗口壳 + WebView2 宿主与桥（web_client/main_window/statusbar）

**文本缓冲权威在页面**（CodeMirror 的 EditorState，每标签一份，撤销历史
天然隔离）；Python 侧只存元数据（core/session 铁律延续，2026-08-14 审计）。
落盘/复制/导出经桥 `request_text` 异步拉全文。

## 桥（ui/web_client.py ⇄ assets/app.js）

- 下行：`evaluate_js` 调 `window.__app.*`，文档内容 200K 字符分块推送
- 上行：主线程 120ms 常驻轮询 `window.__drain()`（事件/状态/统计）
- 文本拉取：`__getTextMeta` + `__getTextChunk` 分块，一个在途 + 队列
- 铁律不变：STA 先于 import tkinter/clr；.NET 回调只 queue.put

## 状态管理

`App`（main.pyw）是唯一状态中心：
- `config` - 配置字典
- `sess` - Session（标签元数据：path/encoding/dirty/cursor）
- `_loaded` - JS 侧已持有内容的 tab id 集合
- tab 身份统一经 `core.session.tab_key(tab)` 取值（**全仓唯一出口**，业务代码与测试脚本均不得直接用 `id(...)`；当前实现 `return id(tab)`，第二步改为 `return tab.seq`），JS 侧 docs Map 同键——避免旧版「索引键重排」坑（bugs/004 的根源已随 Tk 编辑器删除）

## 模块职责

> 行数由 `docs/MODULES.md` 自动统计；下表仅列职责。

| 模块 | 职责 |
|---|---|
| main.pyw | 入口（STA/运行时检测/frozen CWD 切换/窗口图标）+ App 状态中心 + 桥事件路由 + 自动保存 |
| actions.py | 文件/标签/退出编排（保存链 = 确认 → 拉全文 → 写盘 → 下一步） |
| ui/web_client.py | WebView2 宿主 + 桥协议（分块推送/拉取/轮询/导航守卫/在途超时重发） |
| ui/main_window.py | 原生菜单（含 视图→排版模式）+ 快捷键兜底 + 状态栏挂载 |
| ui/statusbar.py | 状态栏（沿用） |
| assets/app.{html,css,js} + editor/reader.js | 单页客户端（编辑层/阅读层/标签条/F2） |
| core/theme.py | 主题定义 + css_vars()（页面颜色唯一数据源） |
| services/export.py | 独立 HTML 导出（marked 管线，资产内联） |

## 性能关键路径（2026-10-11 更新）

- 编辑：CM6 视口虚拟化，只渲染可见行——旧版「语法高亮全量重扫」瓶颈随
  Tk Text 编辑器一起消失；878KB 文档实测打字/滚动流畅
- 阅读：marked.js + hljs 在浏览器进程内渲染（沿用 WebView2 路径实测数据）；
  hljs 前 500 块护栏保留；F2 未改动内容 0ms 直显
- 传输：分块推送/拉取，2.3MB 文档实测全链路通过
