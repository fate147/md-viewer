# 预览组件 (ui/webview_preview.py / ui/preview.py)

> 文档状态：活文档（随代码原地更新） ｜ 最后更新：2026-10-01

双引擎：默认 **WebView2**（Chromium，tkwebview2 嵌入 Tk frame），回退
**tkinterweb**。引擎在入口探测（`main._detect_engine`，配置
`preview_engine: auto|webview2|tkinterweb` + Runtime 检测 + 创建异常兜底），
两套实现同一组接口。

## 功能

- Markdown → HTML 渲染，延迟创建（首次进预览才初始化）
- 链接点击：页内锚点原生滚动；其余取消导航、交系统浏览器（外链拦截）
- F2 切回编辑时手动隐藏原生子窗口（SetParent 窗口不随 pack_forget 隐藏）
- 大纲（toc）从页面取回，接侧栏目录
- 相对图片：`<base href>` 指向 md 所在目录（WebView2 路径）

## 接口（两引擎对齐）

```python
render_now(md_text, theme_id, tab_key=0, base_dir=None)  # 渲染（内容+主题未变则零开销）
drop_cache(tab_key)                        # 标签关闭时失效
invalidate(tab_key=None)                   # 作废当前显示标记
scroll_to_heading(toc_id)                  # 按标题跳转
```

`tab_key` 用 `id(tab)`（标签对象身份，非索引）；WebView2 路径的短路键为
`(tab_key, len, hash, theme_id)` 内容指纹。

## 排版（微信阅读风格，2026-10-01）

`theme._PREVIEW_BASE` 统一控制、四套主题共用（配色仍随主题）：衬线正文
（Georgia/宋体）19px、行距 2、窄栏居中（max-width 34em）、两端对齐、
段首缩进两字符、h1 居中标题；列表/表格/引用内段落不缩进。tkinterweb
回退路径共用同一份 CSS（tkhtml 不支持的选择器自动降级）。

## WebView2 架构（2026-10-01，TC-007）

- `core/web_render.py`：把 md **源文本**装进自渲染 HTML 模板（marked.js +
  highlight.js + 主题 CSS 全部内联，离线可用），Python 端零计算不抢 GIL。
- 换行语义：`marked.use({breaks:true})`——源文本内单个换行即换行。中文笔记
  普遍不写空行，标准 CommonMark 会把连续行并成一段（观感"排版乱"）；此设置
  与旧 tkinterweb 的显示一致（2026-10-01 修复）。
- 渲染结果写临时文件（`%TEMP%/md-viewer-preview/mdv-<pid>-<gen>.html`，只留
  最近 3 份）后 `load_url(file://)` 导航——`NavigateToString` 有 2MB 上限。
- 页面 JS 完成后置 `window.__mdv_done = gen`；组件主线程常驻 after 轮询
  （100ms）经 evaluate_js 取回大纲。
- 线程模型：入口在建 Tk 前 `CoInitializeEx(STA)`；**.NET 回调里只允许
  queue.put**，一切 Tk 调用收敛到主线程轮询器（跨线程 Tk 调用 = GIL 崩）。
- 超大文档护栏：代码块高亮只处理前 500 块（9000 块实测多花 ~2s）。

## 性能（2026-10-01 集成实测，1MB / 9000 标题 / 9000 代码块）

| 指标 | WebView2 | tkinterweb（旧） |
|------|----------|------------------|
| Tk 主循环最大抖动 | 33 ms | 冻结 ~6 s |
| 端到端（导航→大纲回传） | 2.9~3.4 s（浏览器进程内，UI 全程可交互） | 同量级但主线程卡死 |
| 注入调用返回 | 2 ms | 整体替换、阻塞 |

## 回退路径：tkinterweb（ui/preview.py）

原实现完整保留：worker 单飞转换 + 每标签 HTML 缓存（上限 4 条）+ HTML≥30K
渐进渲染（1/4 首屏→补全，切点落在顶层块级闭合标签后）。瓶颈是 tkhtml 主线程
排版 ~6ms/1K 字符（22K body 实测排版 231ms、占 95%；373K HTML 冻结 6.1s），
python-markdown 1.2s/120K 在 GIL 下放线程也不解。这些历史数据与 TTFP 对比表
见 `docs/log/2026-09.md` 与 TC-007。
