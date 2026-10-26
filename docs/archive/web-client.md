# 模块：WebView2 单页客户端（ui/web_client.py + src/assets）

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-10-11

2026-10-11 重构核心：**编辑器与阅读层同页共存**于一个 Chromium 页面，
F2 只是页内显隐互换。Tk 退化为窗口壳（菜单/状态栏/文件对话框/配置）。
取代已退役的 ui/editor.py（Tk Text）、ui/preview.py（tkinterweb）、
ui/webview_preview.py（预览面板）。

## 前端资产（src/assets/，离线可用）

| 文件 | 职责 |
|---|---|
| app.html | 单页骨架（标签条 + 编辑层 + 阅读层） |
| app.css | 排版与界面样式；颜色全走 CSS 变量；`:root` 内置 paper 兜底防闪白 |
| editor.js | CodeMirror 6 装配（markdown 语言、语法配色 HighlightStyle、主题 CSS `var()` 化） |
| reader.js | marked 渲染 + 标题 slug id + 相对图片改写绝对 file URL + F2 滚动锚点 |
| app.js | 桥协议、标签条、F2 模式切换、分块接收、文本拉取 API、全局快捷键 |
| cm6.bundle.js | CodeMirror 6 离线 IIFE 打包（window.MDVC）；重建：`cd tools/cm6 && npm install && npm run build` |
| marked/hljs min.* | 与旧 web_render 同源的渲染资产 |
| hljs-scoped.css | 两套 hljs 配色按 `[data-hljs]` 作用域化（tools 生成一次） |

## 桥协议

- **下行** Python→JS：`evaluate_js` 调 `window.__app.*`（setTheme/setFont/setReadingMode/setTabs/
  openDoc/pushChunk/commitDoc/setDirty/activateTab/toggleMode/runCmd/insertText）。
  文档内容按 100K 字符分块推送（send_text）。**在途回调带 5s 超时重发**：
  pywebview 4.4.1 的 `ExecuteScriptAsync().ContinueWith()` 续延偶发丢失
  （JS 已执行、回调永不触发、无报错——edgechromium.py:88，2026-10-11 探针实测），
  桥上的读操作全部幂等，超时重发两次后按 None 上抛，拉文状态机不会卡死。
- **上行** JS→Python：主线程 120ms 常驻轮询 `window.__drain()` 取
  `{mode, activeId, dirty, stats, events[]}`；事件含 save/saveAs/open/new/quit/
  selectTab/closeTab/docChanged/clipboardSet/clipboardGet/copyPlain/exportHtml。
- **文本拉取**：`request_text(tab_id, cb)` → `__getTextMeta`（长度）→
  `__getTextChunk` 分块（一个在途 + 队列排队），失败回调 `None`（与空文档区分）。
- ⚠️ **回调自带一层 JSON 解包**：JS 返回值原样到达 Python（探针实测
  `1+1` → `2`）。JS 侧函数自返回 `JSON.stringify(...)`，Python 侧 `_parse` 再
  loads 一次即可；表达式里**不要**再包 stringify（双重编码曾致拉文失败）。
- 页面就绪握手：core 就绪 → 轮询 `!!window.__appReady` → flush 早于就绪的命令队列。

## 文本缓冲权威

页面持有每个标签的 `EditorState`（文本 + 撤销历史），`d.st` 在每次
docChanged 时回写（否则拉到旧文——2026-10-11 实测）。Python 侧 core/session
仍只存元数据（path/encoding/dirty/cursor），保存/复制/导出/关闭确认都经
request_text 异步拉全文（actions.py 回调链）。

## 关键行为

- **F2**：编辑 ⇄ 阅读同页互换，零导航；内容未改 0ms，改过才重渲（marked 纯 JS）。
  滚动位置按标题 slug + 同名标题序数对齐（reader.js anchor*）。
- **双排版模式**（2026-10-11）：`layout.reading_mode = auto|book|doc`。
  `auto` 时按内容判别（代码围栏 + 表格数 ≥ 2 → 文档模式：无衬线、左对齐、
  无缩进、行高 1.75、40em 栏宽）；书卷模式（衬线缩进两端对齐）留给小说散文。
  文档模式下宽表格横向滚动、代码块悬浮工具条（语言标签 + 一键复制，
  借鉴 GitHub/Typora）；`text-autospace` 中西文间隙为渐进增强。
- **卷/章节结构识别**（2026-10-11）：很多小说 md 是纯文本（无 # 标记）。
  阅读前把独立成段的「第X卷/部」提升为 h2、「第X章/节/回」提升为 h3
  （仅当全文无 markdown 标题且含卷章行；首个内容行 ≤30 字提升为书名 h1），
  卷=居中加大加粗（data-kind=volume）、章=左对齐加粗；编辑器对同款行做
  整行加粗装饰（只扫可视区）；滚动锚点同时认 markdown 标题与卷/章行——
  纯文本小说 F2 对位不再跳回顶部。
- **快捷键**：焦点在页面时由 JS 捕获（F2/Ctrl+S/O/N/Q/Shift+P、Ctrl+F/H 走
  CM6 搜索面板）；Tk 侧绑定兜底焦点在菜单的情形。Ctrl+S 必须由 JS
  preventDefault（否则触发浏览器另存）。
- **标签条**：CSS 绘制，≥2 个文件才显示；点选/中键关/× 关；dirty 圆点 JS 侧实时。
- **导航守卫**：页内锚点放行；本地 .md 链接交回应用打开；其余取消并交系统浏览器。
- **链接/剪贴板**：复制/剪切经 JS 事件由 Tk 剪贴板完成；粘贴反向
  `insertText`（绕开 WebView2 剪贴板权限问题）。
- **大文件**：CM6 视口虚拟化（878KB 实测编辑流畅）；hljs 只高亮前 500 块；
  2.3MB 小说实测阅读/编辑/分块推送全通过。

## 性能基线（鬼探实录.md，2.3MB / 77.6 万字，2026-10-11，perf_baseline.py）

| 指标 | 实测 |
|---|---|
| 打开（读盘+分块推送+提交+首渲） | 1.23s |
| F2 编辑→阅读（含 marked 全文重渲） | 65ms |
| F2 阅读→编辑（含滚动锚点映射） | 12ms |
| 全文拉取往返（24 块，保存链路） | 1.22s |
| 未改动内容 F2 切换 | ≈0ms |

## 线程铁律（不变）

STA 在入口 main.pyw 于 import tkinter/clr 之前完成；.NET 事件回调只
queue.put；一切状态变更收敛到主线程 `_poll`（after 120ms）。
