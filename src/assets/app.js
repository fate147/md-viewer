// 单页客户端（app.js）：桥协议 + 标签 + 编辑/阅读切换。
//
// 桥的两条方向（与 Python 侧 ui/web_client.py 对应）：
// - 下行：Python 经 evaluate_js 调 window.__app.*（内容按 100K 字符分块）；
// - 上行：Python 常驻轮询 window.__drain() 取事件与状态（.NET 回调线程
//   只允许入队，一切状态变更在 Tk 主线程做——铁律）。
(function () {
  "use strict";
  var C = window.MDVC;
  var MDV = window.MDV;
  window.__app = MDV;

  var editorHost = document.getElementById("editor-host");
  var readerEl = document.getElementById("reader");
  var tabbar = document.getElementById("tabbar");
  var tocEl = document.getElementById("toc");
  var stackEl = document.getElementById("stack");
  var startEl = document.getElementById("start");
  var startRecentEl = document.getElementById("start-recent");
  var helpEl = document.getElementById("help");
  var helpListEl = document.getElementById("help-list");
  var helpCloseBtn = document.getElementById("help-close");
  var statusMidEl = document.getElementById("status-mid");
  var modeChipEl = document.getElementById("mode-chip");
  var SHORTCUTS = window.MDV_SHORTCUTS || [];
  MDV.initReader(readerEl);
  MDV.initToc(tocEl);

  // ---------------- 状态 ----------------
  // docs: id(tab 对象身份) -> {st, dirty, rev, baseDir, name, editorScroll, readerScroll}
  var state = {
    docs: new Map(),
    activeId: null,
    mode: "reader",        // "reader" | "editor"
    readingMode: "auto",   // "auto" | "book" | "doc"（Python 配置下发）
    pendingId: null,
    pendingMeta: null,
    pending: "",           // 分块接收缓冲
    events: [],
    statsStale: true,
    renderedRev: { id: null, rev: -1 }, // 阅读区 DOM 当前归属（单值，03 R-03-03）
  };

  // 滚动换章时轻量通知 Python（复用 events 通道，不新增桥方法）
  MDV.emitSection = function () {
    var sec = MDV.currentSection ? MDV.currentSection() : null;
    if (!sec) return;
    pushEvent({ type: "section", volume: sec.volume, chapter: sec.chapter,
                percent: sec.percent });
  };

  function pushEvent(ev) {
    var n = state.events.length;
    if (ev.type === "docChanged" && n && state.events[n - 1].type === "docChanged") {
      return; // 连击合并，Python 每 150ms 才收一次
    }
    state.events.push(ev);
  }

  // ---------------- 编辑器回调 ----------------
  MDV.createEditor(editorHost, function (u) {
    if (u.docChanged) {
      var d = state.docs.get(state.activeId);
      if (d) {
        d.dirty = true;
        d.rev++;
        d.st = u.state;   // 文本拉取读 d.st，必须在每次变更时回写
      }
      state.statsStale = true;
      pushEvent({ type: "docChanged" });
      renderTabDots();
    }
    if (u.selectionSet) state.statsStale = true;
  });

  function docText(id) {
    var d = state.docs.get(id);
    if (!d) return "";
    // specs/03 R-03-16：大文档不建 EditorState，文本权威退回原始字符串
    return d.st ? d.st.doc.toString() : (d.raw || "");
  }

  function docLength(id) {
    var d = state.docs.get(id);
    if (!d) return 0;
    return d.st ? d.st.doc.length : (d.raw || "").length;
  }

  // 大文档按需建编辑态（R-03-16）：真正要编辑时才为整篇建 EditorState
  function ensureState(d) {
    if (d && !d.st) d.st = MDV.stateFromDoc(d.raw || "");
    return d ? d.st : null;
  }

  function emptyState() {
    if (!MDV._emptyState) MDV._emptyState = MDV.stateFromDoc("");
    return MDV._emptyState;
  }

  // ---------------- 模式切换（F2：同页显隐互换，无导航） ----------------
  function swapVisibility(mode) {
    // 用 hidden 属性而不是 class：元素初始态就是 hidden 属性（app.html）
    editorHost.hidden = mode !== "editor";
    readerEl.hidden = mode !== "reader";
    updateModeChip();
  }

  // 超大书卷禁止进编辑态（specs/03 R-03-14，2026-11-02）
  // 实测：776K 字符小说切到编辑态，第二次要 636ms —— CodeMirror 首次真正
  // 布局全部 10690 行的固有开销（锚点 2ms、setState 1ms，均已排除）。
  // 小说模式下编辑需求低，直接拒绝比卡 0.6 秒更好。
  var F2_EDIT_MAX_CHARS = 200000;
  // 绝对上限（specs/03 R-03-14，2026-11-24）：任何排版模式都拒绝。
  // R-03-16 之后大文档平时不建 EditorState，若文档模式下放行，按一次 F2
  // 就要为 300 万字符以上建状态 —— 8M 字符实测线性外推是秒级卡死。
  var F2_EDIT_HARD_CHARS = 3000000;

  function tooLargeForEditor() {
    var d = state.docs.get(state.activeId);
    if (!d) return false;
    var len = docLength(state.activeId);
    if (len > F2_EDIT_HARD_CHARS) return true;
    if (len <= F2_EDIT_MAX_CHARS) return false;
    // 只拦书卷模式；文档模式（技术文档）通常标题少、行数少，允许编辑
    return !isDocModeNow();
  }

  // 统一「进入编辑态」入口：F2/菜单/查找替换等所有入口都必须过 R-03-14 守卫，
  // 禁止个别入口直接 setMode("editor") 绕过超大书卷限制（2026-11-02 修 BUG-1：
  // 修前 runCmd("find") 走 setMode("editor") 绕过守卫，776K 小说 Ctrl+F 实测卡 ~875ms）。
  function enterEditor() {
    var d0 = state.docs.get(state.activeId);
    if (!d0 || (d0.kind !== "markdown" && d0.kind !== "text")) {
      pushEvent({ type: "toast", text: "该文件类型不支持编辑" });
      return false;                        // specs/10 R-10-05
    }
    if (tooLargeForEditor()) {
      pushEvent({ type: "toast", text: "文档过大，暂不支持编辑（" +
        Math.round(docLength(state.activeId) / 10000) + " 万字）" });
      return false;
    }
    ensureState(state.docs.get(state.activeId));   // R-03-16：此时才建编辑态
    setMode("editor");
    return true;
  }

  MDV.toggleMode = function () {
    var d0 = state.docs.get(state.activeId);
    if (state.mode === "reader" &&
        (!d0 || (d0.kind !== "markdown" && d0.kind !== "text"))) {
      pushEvent({ type: "toast", text: "该文件类型不支持编辑" });
      return;                              // specs/10 R-10-05
    }
    if (state.mode === "reader" && tooLargeForEditor()) {
      pushEvent({ type: "toast", text: "文档过大，暂不支持编辑（" +
        Math.round(docLength(state.activeId) / 10000) + " 万字）" });
      return;   // 保持阅读态
    }
    if (state.mode === "reader") {
      ensureState(state.docs.get(state.activeId));
      setMode("editor");
      return;
    }
    setMode("reader");
  };

  function setMode(mode) {
    var d = state.docs.get(state.activeId);
    if (!d) return;
    var leaving = state.mode;
    if (leaving === "editor") d.editorScroll = MDV.view.scrollDOM.scrollTop;
    else d.readerScroll = readerEl.scrollTop;

    if (mode === "reader") {
      applyReadingClass();
      if (readerShows(state.activeId, d.rev)) {
        readerEl.scrollTop = d.readerScroll;
      } else {
        renderActiveReader();
      }
    } else {
      // R-03-16：大文档的 EditorState 是进编辑态的这一刻才建的，必须装进视图
      MDV.view.setState(ensureState(d));
      var text2 = docText(state.activeId);
      var line = MDV.anchorLineFromReader(text2);
      var l = MDV.view.state.doc.line(Math.min(line, MDV.view.state.doc.lines));
      MDV.view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
      swapVisibility(mode);
      readerEl.scrollTop = 0;
      MDV.view.focus();
      state.mode = mode;
      return;
    }
    swapVisibility(mode);
    state.mode = mode;
  }

  // ---------------- 阅读区渲染归属（03 R-03-03） ----------------
  // 阅读区全局只有一份 DOM，渲染别的标签会覆盖它——所以「谁在显示」必须记在
  // 「区」上（单值），不能记在「标签」上（per-tab Map 会留下假账）。
  function readerShows(id, rev) {
    return state.renderedRev.id === id && state.renderedRev.rev === rev;
  }

  // 代码类扩展名：只有这些按等宽排版，其余纯文本按正文排版
  var CODELIKE_EXT = /\.(py|pyw|js|mjs|cjs|ts|tsx|jsx|json|jsonc|css|scss|less|c|h|cc|cpp|hpp|cs|java|kt|go|rs|rb|php|swift|lua|pl|r|sh|bash|bat|cmd|ps1|sql|xml|yml|yaml|toml|ini|cfg|conf|vue|svelte|gradle|cmake)$/i;

  function renderActiveReader() {
    var d = state.docs.get(state.activeId);
    if (!d) return;
    var kind = d.kind || "markdown";
    if (kind === "image") {
      renderImageDoc(d);
    } else if (kind === "pdf") {
      renderPdfDoc(d);
    } else if (kind === "html") {
      renderHtmlDoc(d);
    } else if (kind === "binary") {
      renderBinaryDoc(d);
    } else {
      applyReadingClass();
      var text = docText(state.activeId);
      // specs/10 R-10-02：text 走纯文本渲染，markdown 走原管线
      if (kind === "text") {
        // 代码/配置用等宽；.txt/.log 这类正文用正文字体（specs/10 R-10-02）
        var codeLike = CODELIKE_EXT.test(d.name || "");
        MDV.renderPlain(text, d.baseDir, { mono: codeLike });
      }
      else MDV.renderReader(text, d.baseDir);   // markdown 与 ebook（已抽成 md）同一路径
      var cur = MDV.view.state.selection.main.head;
      var line0 = MDV.view.state.doc.lineAt(cur).number - 1;
      MDV.anchorReaderFromEditor(text, line0);
    }
    state.renderedRev = { id: state.activeId, rev: d.rev };
    var textKind = (kind === "markdown" || kind === "text" || kind === "ebook");
    var docMode = (kind === "markdown") && isDocModeNow();
    if (textKind) {
      // 渲染后目录随绘制更新（R-03-10：大纲唯一来源）
      MDV.refreshToc(docMode);
      requestAnimationFrame(function () {
        MDV.remeasureOutline();
        MDV.refreshToc(docMode);
      });
    } else if (tocEl) {
      tocEl.hidden = true;      // 图片/PDF/二进制没有大纲，不占侧栏
    }
  }

  // ---- 图片 / 二进制视图（specs/10 R-10-03/R-10-04）----
  function humanSize(n) {
    n = +n || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return n + " B";
  }

  function renderImageDoc(d) {
    readerEl.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "img-view";
    var img = document.createElement("img");
    img.alt = d.name || "";
    img.title = d.name || "";
    // 图裂了不能只留白：换成提示卡 + 系统打开（specs/10 R-10-03 增补）
    img.addEventListener("error", function () {
      renderBinaryDoc({
        name: d.name, size: d.size, path: d.path,
        note: "这张图片无法显示：文件可能已损坏，或尺寸超出解码上限。"
      });
    });
    img.src = d.src || "";
    wrap.appendChild(img);
    readerEl.appendChild(wrap);
  }

  // PDF：页面内 iframe 交给 WebView2 内置查看器（specs/10 R-10-07，2026-11-24 实测可用）
  function renderPdfDoc(d) {
    readerEl.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "pdf-view";
    var frame = document.createElement("iframe");
    frame.className = "pdf-frame";
    frame.src = d.src || "";
    frame.title = d.name || "PDF";
    wrap.appendChild(frame);
    readerEl.appendChild(wrap);
  }

  // HTML：页面内 iframe 直接渲染（specs/10 R-10-07 同族，只读）
  function renderHtmlDoc(d) {
    readerEl.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "html-view";
    var frame = document.createElement("iframe");
    frame.className = "html-frame";
    frame.src = d.src || "";
    frame.title = d.name || "HTML";
    wrap.appendChild(frame);
    readerEl.appendChild(wrap);
  }

  function renderBinaryDoc(d) {
    readerEl.innerHTML = "";
    var box = document.createElement("div");
    box.className = "bin-view";
    var h = document.createElement("h2");
    h.textContent = d.name || "未命名";
    var p = document.createElement("p");
    p.textContent = d.note
      ? d.note
      : "该类型不支持在应用内显示（文件大小 " + humanSize(d.size) + "）。";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bin-open";
    btn.textContent = "用系统默认程序打开";
    btn.addEventListener("click", function () {
      pushEvent({ type: "openExternal", path: d.path });
    });
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(btn);
    readerEl.appendChild(box);
  }

  // ---------------- 文档装载（Python 分块推送） ----------------
  MDV.openDoc = function (id, meta) {
    state.pendingId = id;
    state.pendingMeta = meta || {};
    state.pending = "";
  };

  MDV.pushChunk = function (s) { state.pending += s; };

  MDV.commitDoc = function (id) {
    if (state.pendingId !== id) return;   // 过期装载，忽略
    var raw = state.pending;
    var meta = state.pendingMeta || {};
    var kind = meta.kind || "markdown";
    var editable = kind === "markdown" || kind === "text";
    // specs/03 R-03-16：大文档不建 EditorState —— >F2_EDIT_MAX_CHARS 的文本本来
    // 就不许编辑（R-03-14），建了纯属白付秒级时间与几十 MB 内存；文本留在 raw。
    // specs/10：图片/二进制不产生文本，也不建编辑态。
    var st = (editable && raw.length <= F2_EDIT_MAX_CHARS) ? MDV.stateFromDoc(raw) : null;
    var d = {
      st: st,
      raw: st ? null : raw,
      kind: kind,                   // markdown | text | image | binary
      src: meta.src || "",          // 图片 file URL
      path: meta.path || "",        // 原始路径（系统打开用）
      size: meta.size || 0,
      note: meta.note || "",
      stats: null,          // 字数缓存（大文档只算一次）
      docMode: undefined,   // 排版模式判别缓存
      dirty: false, rev: 0,
      baseDir: meta.baseDir || "",
      name: meta.name || "",
      editorScroll: 0, readerScroll: 0,
    };
    state.pending = "";
    state.pendingId = null;
    state.docs.set(id, d);
    state.renderedRev = { id: null, rev: -1 };   // 归属作废，下次显示必重渲
    state.activeId = id;
    MDV.view.setState(st || emptyState());
    MDV.view.scrollDOM.scrollTop = 0;
    state.statsStale = true;
    Array.from(tabbar.children).forEach(function (el) {
      var selected = +el.dataset.id === id;
      el.classList.toggle("active", selected);
      el.setAttribute("aria-selected", String(selected));
      el.tabIndex = selected ? 0 : -1;
    });
    setMode((editable && !raw.length) ? "editor" : "reader");
  };

  MDV.setDirty = function (id, dirty) {
    var d = state.docs.get(id);
    if (d) { d.dirty = dirty; renderTabDots(); }
  };

  // ---------------- 排版模式（书卷 / 文档） ----------------
  MDV.setReadingMode = function (mode) {
    state.readingMode = mode || "auto";
    if (state.mode === "reader") applyReadingClass();
  };

  function applyReadingClass() {
    var doc = false;
    if (state.readingMode === "doc") doc = true;
    else if (state.readingMode === "auto") {
      var d = state.docs.get(state.activeId);
      // 判别结果按标签缓存（R-03-16）：全文逐行正则只跑一次
      if (d && d.docMode === undefined) {
        d.docMode = MDV.detectDocMode(docText(state.activeId));
      }
      doc = d ? !!d.docMode : false;
    }
    readerEl.classList.toggle("doc-mode", doc);
    MDV.refreshToc(doc);
  }

  // 当前是否文档模式（供 TOC 与状态栏同源判断）
  function isDocModeNow() {
    return readerEl.classList.contains("doc-mode");
  }

  MDV.setFont = function (size, family) {
    var root = document.documentElement.style;
    root.setProperty("--ed-size", size + "px");
    root.setProperty("--ed-font", family + ', "Microsoft YaHei UI", serif');
    root.setProperty("--fs", (size + 2) + "px");
  };

  MDV.setTheme = function (vars) {
    var root = document.documentElement;
    for (var k in vars) {
      if (k === "__hljs") root.setAttribute("data-hljs", vars[k]);
      else root.style.setProperty(k, vars[k]);
    }
  };

  // 手动显示/隐藏目录（写 localStorage 逃生阀，见 specs/06 R-06-07）
  MDV.toggleToc = function () {
    var on = !MDV.isTocVisible();
    var sec = MDV.currentSection ? MDV.currentSection() : null;
    var anchorId = sec && (sec.chapterId || sec.volumeId);
    MDV.setTocVisible(on);
    pushEvent({ type: "tocToggle", visible: on });
    // 位置保锚：列宽变化后正文换行，像素 scrollTop 不再对应原内容——
    // 切换后用 MDV.scrollToHeading 回到同一标题（specs/03 R-03-03 语义延伸）。
    if (anchorId) {
      requestAnimationFrame(function () { MDV.scrollToHeading(anchorId); });
    }
    if (typeof renderMenus === "function") renderMenus();
    return on;
  };

  MDV.runCmd = function (name) {
    var v = MDV.view;
    switch (name) {
      case "undo": C.undo(v); break;
      case "redo": C.redo(v); break;
      case "selectAll":
        v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
        break;
      case "cut":
        var s = v.state.selection.main;
        var t = v.state.sliceDoc(s.from, s.to);
        if (s.from !== s.to) {
          pushEvent({ type: "clipboardSet", text: t });
          v.dispatch(v.state.replaceSelection(""));
        }
        break;
      case "copy":
        var s2 = v.state.selection.main;
        if (s2.from !== s2.to) {
          pushEvent({ type: "clipboardSet",
                      text: v.state.sliceDoc(s2.from, s2.to) });
        }
        break;
      case "paste":
        pushEvent({ type: "clipboardGet" });
        break;
      case "find":
        // 统一守卫：超大书卷拒绝进入编辑态直接打开搜索（R-03-14 / 2026-11-02）
        if (state.mode !== "editor" && !enterEditor()) break;
        C.openSearchPanel(v);
        break;
      case "closeSearch": C.closeSearchPanel(v); break;
      case "toggleMode": MDV.toggleMode(); break;
    }
  };

  MDV.insertText = function (text) {
    // 只在编辑态插入；大文档（无 EditorState）先按需建状态，避免误改别的标签
    if (state.mode !== "editor") return;
    var d = state.docs.get(state.activeId);
    if (!d || (d.kind !== "markdown" && d.kind !== "text")) return;
    ensureState(d);
    MDV.view.dispatch(MDV.view.state.replaceSelection(text || ""));
  };

  // ---------------- 标签条 / 开始页 ----------------
  var _tabsShownOnce = false;
  function basename(p) {
    if (!p) return "未命名";
    var norm = String(p).replace(/\\/g, "/");
    var i = norm.lastIndexOf("/");
    return i >= 0 && i < norm.length - 1 ? norm.slice(i + 1) : norm;
  }
  function updateModeChip() {
    if (!modeChipEl) return;
    var hasDoc = !!(state.activeId != null && state.docs.has(state.activeId));
    modeChipEl.hidden = !hasDoc;
    if (!hasDoc) return;
    modeChipEl.textContent = state.mode === "editor" ? "编辑" : "阅读";
    modeChipEl.classList.toggle("mode-editing", state.mode === "editor");
  }
  function renderStartRecent() {
    if (!startRecentEl) return;
    var recents = Array.isArray(uiMeta.recent) ? uiMeta.recent.slice(0, 10) : [];
    startRecentEl.innerHTML = "";
    if (!recents.length) {
      var empty = document.createElement("div");
      empty.className = "start-recent-empty";
      empty.textContent = "还没有最近文件";
      startRecentEl.appendChild(empty);
      return;
    }
    recents.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "start-recent-item";
      b.title = String(p);
      var name = document.createElement("span"); name.className = "start-recent-name";
      name.textContent = basename(p);
      var full = document.createElement("span"); full.className = "start-recent-path";
      full.textContent = String(p);
      b.appendChild(name); b.appendChild(full);
      b.addEventListener("click", function () { pushEvent({ type: "openRecent", path: String(p) }); });
      startRecentEl.appendChild(b);
    });
  }
  function showStart() {
    if (startEl) startEl.hidden = false;
    if (stackEl) stackEl.hidden = true;
    if (tabbar) tabbar.hidden = true;
    if (tocEl) tocEl.hidden = true;
    renderStartRecent();
    updateModeChip();
  }
  function hideStart() {
    if (startEl) startEl.hidden = true;
    if (stackEl) stackEl.hidden = false;
    if (tocEl) { /* 目录的显隐由 refreshToc/initTocVisible 接管 */ }
    updateModeChip();
  }
  MDV.setTabs = function (list) {
    // 同步 docs：Python 关掉的标签连缓冲一起丢
    var ids = {};
    list.forEach(function (t) { ids[t.id] = true; });
    Array.from(state.docs.keys()).forEach(function (id) {
      if (!ids[id]) {
        state.docs.delete(id);
        if (state.renderedRev.id === id) state.renderedRev = { id: null, rev: -1 };
      }
    });
    tabbar.innerHTML = "";

    if (!list.length) {
      showStart();
      if (state.activeId !== null) state.activeId = null;
      return;
    }

    hideStart();
    var wasHidden = tabbar.hidden;
    tabbar.hidden = false;
    if (wasHidden && !_tabsShownOnce && list.length < 2) {
      // 标签条首次出现：只动标签条自身，不碰阅读区高度
      tabbar.classList.add("mdv-tabin");
      _tabsShownOnce = true;
      window.setTimeout(function () { tabbar.classList.remove("mdv-tabin"); }, 200);
    }
    list.forEach(function (t) {
      var el = document.createElement("div");
      el.className = "tab";
      el.dataset.id = t.id;
      el.tabIndex = t.id === state.activeId ? 0 : -1;
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(t.id === state.activeId));
      if (t.id === state.activeId) el.classList.add("active");

      var dot = document.createElement("span"); dot.className = "dot"; dot.setAttribute("aria-hidden", "true");
      var title = document.createElement("span");
      title.className = "tab-title"; title.textContent = t.name;
      var close = document.createElement("button");
      close.type = "button";
      close.className = "tab-close"; close.textContent = "×";
      close.title = "关闭（Ctrl+W / Delete）";
      close.setAttribute("aria-label", "关闭 " + t.name);
      el.appendChild(dot); el.appendChild(title); el.appendChild(close);

      el.addEventListener("click", function (e) {
        if (e.target === close) return;      // 关闭按钮不作为「切换」的冒泡
        if (t.id !== state.activeId) pushEvent({ type: "selectTab", id: t.id });
      });
      el.addEventListener("auxclick", function (e) {
        if (e.button === 1) pushEvent({ type: "closeTab", id: t.id });
      });
      el.addEventListener("keydown", function (e) {
        if (e.target === close) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pushEvent({ type: "selectTab", id: t.id }); }
        else if (e.key === "Delete") { e.preventDefault(); pushEvent({ type: "closeTab", id: t.id }); }
      });
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        pushEvent({ type: "closeTab", id: t.id });
      });
      close.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") return;   // 让原生 click 发生
        if (e.key === "Delete" || e.key === "Escape") { e.preventDefault(); el.focus(); }
      });
      tabbar.appendChild(el);
    });
    renderTabDots();
    if (state.activeId !== null && !state.docs.has(state.activeId)) {
      state.activeId = null;
    }
    if (state.activeId === null && list.length) {
      var act = list.filter(function (t) { return t.active; })[0] || list[0];
      switchActive(act.id);
    }
    updateModeChip();
  };

  MDV.activateTab = function (id) {
    if (state.docs.has(id)) switchActive(id);
  };

  function switchActive(id) {
    if (state.activeId === id) return;
    var cur = state.docs.get(state.activeId);
    if (cur) {
      if (cur.st) cur.st = MDV.view.state;   // 留存编辑状态与撤销历史（大文档无状态）
      cur.editorScroll = MDV.view.scrollDOM.scrollTop;
      if (state.mode === "reader") cur.readerScroll = readerEl.scrollTop;
    }
    var d = state.docs.get(id);
    if (!d) return;
    state.activeId = id;
    MDV.view.setState(d.st || emptyState());
    MDV.view.scrollDOM.scrollTop = d.editorScroll;
    state.statsStale = true;
    swapVisibility(state.mode);
    // 切标签必改 DOM 归属：阅读区只有一份，必须按新标签重渲（03 R-03-03）
    if (state.mode === "reader") {
      renderActiveReader();
      readerEl.scrollTop = d.readerScroll;   // 恢复该标签自己的阅读位置，不串到上一个
    }
    Array.from(tabbar.children).forEach(function (el) {
      var selected = +el.dataset.id === id;
      el.classList.toggle("active", selected);
      el.setAttribute("aria-selected", String(selected));
      el.tabIndex = selected ? 0 : -1;
    });
  }

  function renderTabDots() {
    Array.from(tabbar.children).forEach(function (el) {
      var d = state.docs.get(+el.dataset.id);
      el.classList.toggle("dirty", !!(d && d.dirty));
    });
  }

  // ---------------- 全局快捷键（焦点在 webview 时 Tk 收不到） ----------------
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;      // CM 已处理（如 F2/Ctrl+F）
    var mod = e.ctrlKey || e.metaKey;
    if (e.key === "F2") { e.preventDefault(); MDV.toggleMode(); return; }
    if (!mod) return;
    var k = e.key.toLowerCase();
    if (k === "k") { e.preventDefault(); if (typeof openPalette === "function") openPalette(); return; }
    if ((k === "arrowleft" || k === "arrowright") && state.mode === "reader") {
      e.preventDefault();
      MDV.jumpChapter(k === "arrowright" ? 1 : -1);
      return;
    }
    if (k === "o" && e.shiftKey && e.ctrlKey) { e.preventDefault(); MDV.toggleToc(); return; }
    if (k === "s") { e.preventDefault(); pushEvent({ type: e.shiftKey ? "saveAs" : "save" }); }
    else if (k === "o") { e.preventDefault(); pushEvent({ type: "open" }); }
    else if (k === "n") { e.preventDefault(); pushEvent({ type: "new" }); }
    else if (k === "q") { e.preventDefault(); pushEvent({ type: "quit" }); }
    else if (k === "p" && e.shiftKey) { e.preventDefault(); pushEvent({ type: "exportHtml" }); }
    else if (k === "h") { e.preventDefault(); MDV.runCmd("find"); }
    else if (k === "f") { e.preventDefault(); MDV.runCmd("find"); }
    else if (k === "w") { e.preventDefault(); var act = state.activeId; if (act != null) pushEvent({ type: "closeTab", id: act }); return; }
    else if (k === "l" && e.shiftKey) { e.preventDefault(); pushEvent({ type: "ttsPlay", scope: "full" }); return; }
    else if (k === "k" && e.shiftKey) { e.preventDefault(); pushEvent({ type: "ttsStop" }); return; }
  });

  // ---------------- 统计 ----------------
  function computeStats() {
    var v = MDV.view;
    var d = state.docs.get(state.activeId);
    // 有编辑态且视图正持有它 → 用视图（能报真实光标行列）
    if (!d || !d.st || v.state !== d.st) {
      if (!d) return { chars: 0, words: 0, line: 1, col: 1 };
      if (!d.stats) d.stats = countText(docText(state.activeId));
      return { chars: d.stats.chars, words: d.stats.words, line: 1, col: 1 };
    }
    var s = v.state.doc.toString();
    var cjk = (s.match(/[\u2e80-\u9fff\uf900-\ufaff]/g) || []).length;
    var latin = (s.replace(/[\u2e80-\u9fff\uf900-\ufaff]/g, " ")
                  .match(/[A-Za-z0-9_'-]+/g) || []).length;
    var head = v.state.selection.main.head;
    var ln = v.state.doc.lineAt(head);
    return {
      chars: v.state.doc.length,
      words: cjk + latin,
      line: ln.number,
      col: head - ln.from + 1,
    };
  }

  // 全文计数（一次；缓存到 d.stats，specs/03 R-03-16）
  function countText(s) {
    var cjk = (s.match(/[\u2e80-\u9fff\uf900-\ufaff]/g) || []).length;
    var latin = (s.replace(/[\u2e80-\u9fff\uf900-\ufaff]/g, " ")
                  .match(/[A-Za-z0-9_'-]+/g) || []).length;
    return { chars: s.length, words: cjk + latin };
  }

  // 诊断用（只读）：当前活动文档的装载元数据（specs/10 验证用）
  MDV.debugDoc = function () {
    var d = state.docs.get(state.activeId);
    if (!d) return null;
    return {
      kind: d.kind, name: d.name, size: d.size,
      rawLen: (d.raw || "").length,
      stLen: d.st ? d.st.doc.length : 0,
      mode: state.mode,
      readerFirstTag: (readerEl.firstElementChild || {}).className || "",
    };
  };

  // ---------------- 上行：Python 轮询 ----------------
  window.__drain = function () {
    var d = state.docs.get(state.activeId);
    var out = {
      mode: state.mode,
      activeId: state.activeId,
      dirty: d ? d.dirty : false,
      events: state.events,
      stats: null,
      section: null,
    };
    state.events = [];
    if (state.statsStale && d) {
      out.stats = computeStats();
      state.statsStale = false;
    }
    if (state.mode === "reader" && d) {
      var s = MDV.currentSection ? MDV.currentSection() : null;
      if (s) out.section = s;
    }
    return JSON.stringify(out);
  };

  // 文本拉取（保存/关闭确认用）：按 id 取任意标签内容，无需切走当前视图
  window.__getTextMeta = function (id) {
    var d = state.docs.get(id);
    return JSON.stringify(d ? { len: docLength(id) } : { len: 0 });
  };

  window.__getTextChunk = function (id, start, end) {
    var d = state.docs.get(id);
    if (!d) return JSON.stringify("");
    var s = d.st ? d.st.doc.sliceString(start, end) : (d.raw || "").slice(start, end);
    return JSON.stringify(s);
  };

  // ================= 应用外壳：菜单栏 + 状态栏（第一期，specs/00 外壳视觉法）=================
  var menubarEl = document.getElementById("menubar");
  var statusLeftEl = document.getElementById("status-left");
  var statusRightEl = document.getElementById("status-right");
  var uiMeta = { chrome: "custom", themes: [], theme: "", readingMode: "auto", tocMode: "auto", readingFont: "auto", readingFonts: [], recent: [] };
  var _statusRightBase = "";
  var _statusTimer = 0;

  MDV.setStatus = function (p) {
    if (!p) return;
    if (p.left != null && statusLeftEl) statusLeftEl.textContent = p.left;
    if (p.mid != null && statusMidEl) statusMidEl.textContent = p.mid;
    if (p.right != null) {
      _statusRightBase = p.right;
      // 临时消息期间（setStatusTemp 生效中）不覆盖基础信息
      if (statusRightEl && !_statusTimer) statusRightEl.textContent = p.right;
    }
  };
  MDV.setStatusTemp = function (msg, ms) {
    if (!statusRightEl) return;
    statusRightEl.textContent = msg || "";
    if (_statusTimer) clearTimeout(_statusTimer);
    _statusTimer = setTimeout(function () {
      statusRightEl.textContent = _statusRightBase;
    }, ms || 2000);
  };

  // ================= TTS 播放条（specs/09 R-09-05/R-09-10）=================
  // 页面只呈现状态与播放音频；合成/分块/缓存全在 Python 后台线程（R-09-03）。
  // chunk 事件带虚拟 host URL，入队流式播放（边合成边播，R-09-02）。
  var ttsbarEl = document.getElementById("ttsbar");
  var ttsPauseBtn = document.getElementById("tts-pause");
  var ttsCacheBtn = document.getElementById("tts-cache");
  var ttsProgressEl = document.getElementById("tts-progress");
  var ttsAudio = null;      // 当前 Audio 元素
  var ttsQueue = [];        // 待播队列：{url, index}
  var ttsCurIndex = -1;     // 当前正在播的块 index（背压确认用）
  var ttsPlaying = false;   // 是否有音频在播/待播
  var ttsPaused = false;

  function ttsShow() { if (ttsbarEl) ttsbarEl.hidden = false; }
  function ttsReset() {
    if (ttsbarEl) ttsbarEl.hidden = true;
    ttsQueue = [];
    ttsCurIndex = -1;
    if (ttsAudio) {
      try { ttsAudio.pause(); ttsAudio.removeAttribute("src"); } catch (e) {}
      ttsAudio = null;
    }
    ttsPlaying = false; ttsPaused = false;
    if (ttsPauseBtn) ttsPauseBtn.textContent = "\u275A\u275A";
  }
  // 一块播完（或出错）：先回传确认让后端推进下一块合成，再播队列下一块（R-09-12）
  function ttsOnPlayEnded() {
    var done = ttsCurIndex;
    ttsCurIndex = -1;
    if (done >= 0) pushEvent({ type: "ttsChunkPlayed", index: done });
    ttsPlayNext();
  }
  function ttsPlayNext() {
    if (!ttsQueue.length) { ttsPlaying = false; ttsCurIndex = -1; return; }
    if (!ttsAudio) {
      ttsAudio = new Audio();
      ttsAudio.addEventListener("ended", ttsOnPlayEnded);
      ttsAudio.addEventListener("error", ttsOnPlayEnded);
    }
    var item = ttsQueue.shift();
    ttsCurIndex = item.index;
    ttsAudio.src = item.url;
    ttsPlaying = true;
    var pr = ttsAudio.play();
    // 自动播放被拒或加载失败也要回传确认，避免后端永久等待
    if (pr && pr.catch) pr.catch(function () {
      var idx = ttsCurIndex; ttsCurIndex = -1;
      if (idx >= 0) pushEvent({ type: "ttsChunkPlayed", index: idx });
      ttsPlayNext();
    });
  }

  MDV.setTtsState = function (p) {
    if (!p) return;
    var s = p.state;
    if (s === "playing") {
      ttsShow(); ttsPaused = false;
      // 新一轮播放：清除上一次的错误文案（R-09-11）
      if (ttsProgressEl) ttsProgressEl.textContent = "";
      if (ttsPauseBtn) ttsPauseBtn.textContent = "\u275A\u275A";
      // 恢复播放（resume 与首播同发 playing）：若当前音频处于暂停则续播
      if (ttsAudio && ttsAudio.paused && ttsAudio.getAttribute("src")) {
        var r = ttsAudio.play(); if (r && r.catch) r.catch(function () {});
      }
      return;
    }
    if (s === "chunk") {
      ttsShow();
      if (p.url) {
        ttsQueue.push({ url: p.url, index: (typeof p.index === "number" ? p.index : -1) });
        if (!ttsPlaying && !ttsPaused) ttsPlayNext();
      }
      return;
    }
    if (s === "progress") {
      ttsShow();
      if (ttsProgressEl && p.total) {
        ttsProgressEl.textContent = (p.index || 0) + " / " + p.total + " 段 · " + (p.percent || 0) + "%";
      }
      return;
    }
    if (s === "paused") {
      ttsPaused = true;
      if (ttsPauseBtn) ttsPauseBtn.textContent = "\u25B6";
      if (ttsAudio) { try { ttsAudio.pause(); } catch (e) {} }
      return;
    }
    if (s === "cacheState") {
      if (ttsCacheBtn) ttsCacheBtn.classList.toggle("on", !!p.on);
      return;
    }
    if (s === "done" || s === "stopped" || s === "idle" || s === "error") {
      if (s === "error") {
        // 保留播放条显示错误文案，但清空音频队列/元素，避免下次 playing 误续旧音频（R-09-11）
        ttsQueue = [];
        ttsCurIndex = -1;
        if (ttsAudio) {
          try { ttsAudio.pause(); ttsAudio.removeAttribute("src"); } catch (e) {}
          ttsAudio = null;
        }
        ttsPlaying = false; ttsPaused = false;
        ttsShow();
        if (ttsProgressEl) ttsProgressEl.textContent = "播报失败：" + (p.message || "");
      } else {
        ttsReset();
      }
      return;
    }
  };

  if (document.getElementById("tts-play")) {
    document.getElementById("tts-play").addEventListener("click", function () {
      pushEvent({ type: "ttsPlay", scope: "full" });
    });
  }
  if (ttsPauseBtn) {
    ttsPauseBtn.addEventListener("click", function () {
      pushEvent({ type: ttsPaused ? "ttsResume" : "ttsPause" });
    });
  }
  if (document.getElementById("tts-stop")) {
    document.getElementById("tts-stop").addEventListener("click", function () {
      pushEvent({ type: "ttsStop" });
    });
  }
  if (ttsCacheBtn) {
    ttsCacheBtn.addEventListener("click", function () {
      pushEvent({ type: "ttsCacheToggle" });
    });
  }

  function menuEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll(".menu.open"),
      function (m) { m.classList.remove("open"); });
    Array.prototype.forEach.call(document.querySelectorAll(".menu-sub.open"),
      function (s) { s.classList.remove("open"); });
  }
  function closeMenuThen(fn) {
    return function (e) {
      e.stopPropagation();
      closeMenus();
      fn();
      renderMenus();
    };
  }
  function menuAction(it) {
    if (!it || it.disabled || it.info || it.group) return;
    if (it.ev) pushEvent(it.ev);
    else if (it.ttsSelection) {
      var view = MDV.view;
      var sel = "";
      if (view && view.state && view.state.selection && view.state.selection.main) {
        var m = view.state.selection.main;
        if (m.from < m.to && view.state.doc) sel = view.state.doc.sliceString(m.from, m.to);
      }
      pushEvent({ type: "ttsPlay", scope: "selection", text: sel });
    }
    else if (it.cmd) MDV.runCmd(it.cmd);
    else if (it.toggleToc) MDV.toggleToc();
    else if (it.palette) openPalette();
    else if (it.shortcuts) openHelp();
    else if (it.radio === "reading") { uiMeta.readingMode = it.value; pushEvent({ type: "readingMode", mode: it.value }); }
    else if (it.radio === "tocmode") { uiMeta.tocMode = it.value; pushEvent({ type: "tocMode", mode: it.value }); }
    else if (it.check === "toc") { MDV.toggleToc(); }
    else if (it.theme) { uiMeta.theme = it.theme; pushEvent({ type: "theme", id: it.theme }); }
    else if (it.radio === "font") { uiMeta.readingFont = it.value; pushEvent({ type: "readingFont", id: it.value }); }
  }
  function menuChecked(it) { return !!it.checked; }
  function buildMenuModel() {
    var themes = (uiMeta.themes || []).map(function (t) {
      return { label: t.name, theme: t.id, checked: t.id === uiMeta.theme };
    });
    var fonts = (uiMeta.readingFonts || []).map(function (f) {
      return { label: f.name, radio: "font", value: f.id, checked: f.id === uiMeta.readingFont };
    });
    var recents = (Array.isArray(uiMeta.recent) ? uiMeta.recent : []).slice(0, 10);
    var recentItems = recents.map(function (p) {
      return { label: basename(p), title: String(p),
               ev: { type: "openRecent", path: String(p) } };
    });
    var hasDocs = state.docs.size > 0;
    var seenLabel = MDV.tocStateLabel ? MDV.tocStateLabel() : "（自动）";
    var recentSection = recentItems.length
      ? recentItems.concat([{ sep: true },
          { label: "清除最近文件列表", ev: { type: "clearRecent" } }])
      : [{ label: "暂无最近文件", disabled: true }];
    return [
      { label: "文件", items: [
        { label: "打开…", acc: "Ctrl+O", ev: { type: "open" } },
        { label: "新建", acc: "Ctrl+N", ev: { type: "new" } },
        { sep: true },
        { label: "保存", acc: "Ctrl+S", ev: { type: "save" } },
        { label: "另存为…", acc: "Ctrl+Shift+S", ev: { type: "saveAs" } },
        { label: "导出 HTML…", ev: { type: "exportHtml" }, acc: "Ctrl+Shift+P" },
        { sep: true },
        { label: "最近文件", submenu: recentSection },
        { label: "关闭文件", acc: "Ctrl+W", ev: { type: "closeActive" }, disabled: !hasDocs },
        { sep: true },
        { label: "退出", acc: "Ctrl+Q", ev: { type: "quit" } }
      ]},
      { label: "编辑", items: [
        { label: "撤销", acc: "Ctrl+Z", cmd: "undo" },
        { label: "重做", acc: "Ctrl+Y", cmd: "redo" },
        { sep: true },
        { label: "剪切", acc: "Ctrl+X", cmd: "cut" },
        { label: "复制", acc: "Ctrl+C", cmd: "copy" },
        { label: "粘贴", acc: "Ctrl+V", cmd: "paste" },
        { label: "全选", acc: "Ctrl+A", cmd: "selectAll" },
        { sep: true },
        { label: "查找 / 替换…", acc: "Ctrl+F / Ctrl+H", cmd: "find" },
        { label: "复制纯文本", ev: { type: "copyPlain" } },
        { sep: true },
        { label: "朗读全文", acc: "Ctrl+Shift+L", ev: { type: "ttsPlay", scope: "full" } },
        { label: "朗读选中文字", ttsSelection: true },
        { label: "停止朗读", acc: "Ctrl+Shift+K", ev: { type: "ttsStop" } },
        { label: "缓存本文档音频", ev: { type: "ttsCacheToggle" } },
        { label: "管理音频缓存…", ev: { type: "ttsCacheManage" } }
      ]},
      { label: "视图", items: [
        { label: "编辑 ⇄ 阅读", acc: "F2", cmd: "toggleMode" },
        { sep: true },
        { label: "排版模式", submenu: [
            { group: "阅读呈现" },
            { label: "自动判别", radio: "reading", value: "auto", checked: uiMeta.readingMode === "auto" },
            { label: "书卷", radio: "reading", value: "book", checked: uiMeta.readingMode === "book" },
            { label: "文档", radio: "reading", value: "doc", checked: uiMeta.readingMode === "doc" }
        ]},
        { label: "目录", submenu: [
            { label: "切换目录", acc: "Ctrl+Shift+O", toggleToc: true },
            { sep: true },
            { group: "目录规则" },
            { label: "自动（书卷显示 / 文档长文显示）", radio: "tocmode", value: "auto", checked: uiMeta.tocMode === "auto" },
            { label: "始终显示", radio: "tocmode", value: "always", checked: uiMeta.tocMode === "always" },
            { label: "始终隐藏", radio: "tocmode", value: "never", checked: uiMeta.tocMode === "never" },
            { sep: true },
            { info: "当前：" + seenLabel }
        ]},
        { label: "外观", submenu: [
            { group: "主题" }
        ].concat(themes).concat([
            { sep: true },
            { group: "阅读字体" }
        ]).concat(fonts) }
      ]},
      { label: "帮助", items: [
        { label: "命令面板…", acc: "Ctrl+K", palette: true },
        { label: "快捷键面板…", shortcuts: true },
        { label: "关于", ev: { type: "about" } }
      ]}
    ];
  }
  function renderMenuRow(it) {
    if (it.sep) return menuEl("div", "menu-sep");
    if (it.group) return menuEl("div", "menu-item info", it.group);
    if (it.info) return menuEl("div", "menu-item info", it.info);
    var row = menuEl("button", "menu-item" + (menuChecked(it) ? " checked" : "") + (it.disabled ? " disabled" : ""));
    row.type = "button";
    if (it.disabled) row.disabled = true;
    if (it.title) row.title = it.title;
    row.appendChild(menuEl("span", "mi-label", (menuChecked(it) ? "✓ " : "") + it.label));
    if (it.acc) row.appendChild(menuEl("span", "mi-acc", it.acc));
    row.addEventListener("click", closeMenuThen(function () { menuAction(it); }));
    return row;
  }

  function renderMenuTree(items, container) {
    items.forEach(function (it) {
      if (it.submenu) {
        var wrap = menuEl("div", "has-sub");
        var btn = menuEl("button", "menu-item has-sub-btn");
        btn.type = "button";
        btn.style.width = "100%";
        btn.appendChild(menuEl("span", "mi-label", it.label));
        btn.appendChild(menuEl("span", "mi-sub", "▸"));
        var sub = menuEl("div", "menu-sub");
        sub.setAttribute("role", "menu");
        renderMenuTree(it.submenu, sub);
        btn.setAttribute("aria-haspopup", "menu");
        btn.setAttribute("aria-expanded", "false");
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var open = !sub.classList.contains("open");
          Array.prototype.forEach.call(container.querySelectorAll(".menu-sub.open"),
            function (s) { s.classList.remove("open"); });
          if (open) sub.classList.add("open");
          btn.setAttribute("aria-expanded", open ? "true" : "false");
        });
        btn.addEventListener("keydown", function (e) {
          if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
            e.preventDefault(); e.stopPropagation();
            Array.prototype.forEach.call(container.querySelectorAll(".menu-sub.open"),
              function (s) { s.classList.remove("open"); });
            sub.classList.add("open");
            btn.setAttribute("aria-expanded", "true");
            var first = sub.querySelector("button.menu-item:not(.disabled)");
            if (first) first.focus();
          } else if (e.key === "Escape") {
            e.preventDefault();
            sub.classList.remove("open");
            btn.focus();
          }
        });
        wrap.appendChild(btn);
        wrap.appendChild(sub);
        container.appendChild(wrap);
        return;
      }
      container.appendChild(renderMenuRow(it));
    });
  }

  function focusMenuItem(container, delta) {
    var items = Array.prototype.slice.call(
      container.querySelectorAll("button.menu-item:not(.disabled)"));
    if (!items.length) return;
    var i = items.indexOf(document.activeElement);
    if (i < 0) i = delta > 0 ? -1 : 0;
    i = (i + delta + items.length) % items.length;
    items[i].focus();
  }
  function focusMenuEdge(container, edge) {
    var items = Array.prototype.slice.call(
      container.querySelectorAll("button.menu-item:not(.disabled)"));
    var target = edge === "home" ? items[0] : items[items.length - 1];
    if (target) target.focus();
  }

  function renderMenus() {
    if (!menubarEl) return;
    menubarEl.innerHTML = "";
    if (uiMeta.chrome === "native") return;
    buildMenuModel().forEach(function (m) {
      var wrap = menuEl("div", "menu");
      var btn = menuEl("button", "menu-btn", m.label);
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", "false");
      var pop = menuEl("div", "menu-pop");
      pop.setAttribute("role", "menu");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var wasOpen = wrap.classList.contains("open");
        closeMenus();
        btn.setAttribute("aria-expanded", wasOpen ? "false" : "true");
        if (!wasOpen) {
          wrap.classList.add("open");
          var first = pop.querySelector("button.menu-item:not(.disabled)");
          if (first) first.focus();
        }
      });
      btn.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!wrap.classList.contains("open")) btn.click();
          focusMenuItem(pop, e.key === "ArrowDown" ? 1 : -1);
        } else if (e.key === "Escape" && wrap.classList.contains("open")) {
          e.preventDefault(); closeMenus(); btn.focus();
        }
      });
      renderMenuTree(m.items, pop);
      wrap.appendChild(btn);
      wrap.appendChild(pop);
      menubarEl.appendChild(wrap);
    });
  }
  document.addEventListener("keydown", function (e) {
    var openMenu = document.querySelector(".menu.open .menu-pop");
    if (!openMenu) return;
    var host = openMenu;
    var inSub = document.activeElement && document.activeElement.closest(".menu-sub.open");
    if (inSub) host = inSub;
    if (e.key === "ArrowDown") { e.preventDefault(); focusMenuItem(host, 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusMenuItem(host, -1); }
    else if (e.key === "Home") { e.preventDefault(); focusMenuEdge(host, "home"); }
    else if (e.key === "End") { e.preventDefault(); focusMenuEdge(host, "end"); }
    else if (e.key === "Escape") { e.preventDefault(); closeMenus(); }
    else if (e.key === "ArrowLeft" && inSub) {
      e.preventDefault();
      inSub.classList.remove("open");
      var parentBtn = inSub.parentElement.querySelector("button.has-sub-btn");
      if (parentBtn) parentBtn.focus();
    }
  });
  document.addEventListener("click", function () { closeMenus(); });

  MDV.setUIMeta = function (meta) {
    if (meta) {
      for (var k in meta) uiMeta[k] = meta[k];
      var rootStyle = document.documentElement.style;
      // 外壳色板由 Python theme.py shell_vars() 下发（specs/04 R-04-07）
      if (meta.shellVars) {
        for (var sk in meta.shellVars) rootStyle.setProperty(sk, meta.shellVars[sk]);
      }
      // 文档模式版心上限 = 屏幕宽 2/3（specs/05 R-05-12 / specs/00）
      if (meta.docMaxWidth) {
        rootStyle.setProperty("--doc-max-width", Math.round(meta.docMaxWidth) + "px");
      }
      // 阅读字体（specs/04 R-04-04）：auto 时移除变量，交回书卷/文档默认字体栈
      if (meta.readingFontCss) rootStyle.setProperty("--reading-font", meta.readingFontCss);
      else rootStyle.removeProperty("--reading-font");
    }
    document.body.classList.toggle("chrome-native", uiMeta.chrome === "native");
    document.body.classList.toggle("shell-dark", !!uiMeta.shellDark);
    renderMenus();
    renderStartRecent();
    updateModeChip();
  };

  // ---- 窗口控制（第二期：自绘标题栏，specs/01 R-01-07）----
  var winTitleEl = document.getElementById("win-title");
  var _winMin = document.getElementById("win-min");
  var _winMax = document.getElementById("win-max");
  var _winClose = document.getElementById("win-close");
  if (_winMin) _winMin.addEventListener("click", function (e) { e.stopPropagation(); pushEvent({ type: "windowMin" }); });
  if (_winMax) _winMax.addEventListener("click", function (e) { e.stopPropagation(); pushEvent({ type: "windowMax" }); });
  if (_winClose) _winClose.addEventListener("click", function (e) { e.stopPropagation(); pushEvent({ type: "windowClose" }); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-drag]"), function (elm) {
    var lastDown = 0;
    elm.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      var now = Date.now();
      var second = (now - lastDown) < 350;   // 双击的第二下
      lastDown = now;
      if (second) return;                    // 第二下不发起拖动，交给 dblclick 最大化
      pushEvent({ type: "windowDrag" });      // 按下即拖动（系统原生移动循环，顺滑）
    });
    elm.addEventListener("dblclick", function (e) { e.preventDefault(); pushEvent({ type: "windowMax" }); });
  });
  MDV.setWindowTitle = function (t) { if (winTitleEl) winTitleEl.textContent = t || "MD Viewer"; };

  // 边缘/角落缩放把手 → 通知 Python 程序化缩放（无边框窗口，specs/01 R-01-07）
  Array.prototype.forEach.call(document.querySelectorAll(".rz"), function (el) {
    el.addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      pushEvent({ type: "windowResize", edge: el.getAttribute("data-rz") });
    });
  });

  // ---- 命令面板 Ctrl+K（第三期，2026-11-06 增补：快捷键列 + 勾选态 + 子序列匹配）----
  var paletteEl = document.getElementById("palette");
  var paletteInput = document.getElementById("palette-input");
  var paletteList = document.getElementById("palette-list");
  var _palSel = 0, _palItems = [], _palClosing = false;

  function flattenMenuItems(items, prefix) {
    var out = [];
    (items || []).forEach(function (it) {
      if (it.sep || it.group || it.info || it.disabled) return;
      if (it.submenu) {
        out = out.concat(flattenMenuItems(it.submenu, prefix + " › " + it.label));
        return;
      }
      var kbd = it.acc || "";
      out.push({ label: prefix + " › " + it.label, kbd: kbd, it: it });
    });
    return out;
  }
  function collectCommands() {
    var out = [];
    buildMenuModel().forEach(function (m) {
      out = out.concat(flattenMenuItems(m.items, m.label));
    });
    return out;
  }
  function normQ(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); }
  function subsequence(q, s) {
    var i = 0;
    for (var j = 0; j < s.length && i < q.length; j++) if (s.charAt(j) === q.charAt(i)) i++;
    return i === q.length;
  }
  function matchCommand(c, q) {
    if (!q) return true;
    var hay = normQ(c.label + " " + c.kbd);
    if (hay.indexOf(q) >= 0) return true;
    return subsequence(q, hay);
  }
  function renderPalette(q) {
    q = normQ(q);
    _palItems = collectCommands().filter(function (c) { return matchCommand(c, q); });
    if (_palSel >= _palItems.length) _palSel = Math.max(0, _palItems.length - 1);
    paletteList.innerHTML = "";
    if (!_palItems.length) {
      var empty = menuEl("div", "pal-empty", "无匹配命令");
      paletteList.appendChild(empty);
      return;
    }
    _palItems.forEach(function (c, i) {
      var row = menuEl("button", "pal-item" + (i === _palSel ? " sel" : ""));
      row.type = "button";
      var check = menuEl("span", "pal-check", menuChecked(c.it) ? "✓" : "");
      check.setAttribute("aria-hidden", "true");
      row.appendChild(check);
      row.appendChild(menuEl("span", "pal-label", c.label));
      if (c.kbd) row.appendChild(menuEl("span", "pal-kbd", c.kbd));
      row.addEventListener("click", function () { _palSel = i; runPalette(); });
      row.addEventListener("mousemove", function () { if (_palSel !== i) { _palSel = i; renderPalette(paletteInput ? paletteInput.value : ""); } });
      paletteList.appendChild(row);
    });
  }
  function runPalette() {
    var c = _palItems[_palSel];
    if (!c) return;
    closePalette();
    // 等关闭动画（90ms）结束再执行，避免视觉上“消失得太急”
    window.setTimeout(function () { menuAction(c.it); }, _palClosing ? 80 : 0);
  }
  function openPalette() {
    if (!paletteEl) return;
    _palClosing = false;
    paletteEl.classList.remove("closing");
    paletteEl.hidden = false;
    if (paletteInput) { paletteInput.value = ""; paletteInput.focus(); }
    _palSel = 0;
    renderPalette("");
  }
  function closePalette() {
    if (!paletteEl || paletteEl.hidden) return;
    _palClosing = true;
    paletteEl.classList.add("closing");
    window.setTimeout(function () {
      paletteEl.hidden = true;
      paletteEl.classList.remove("closing");
    }, 110);
  }
  if (paletteEl) {
    paletteEl.addEventListener("mousedown", function (e) { if (e.target === paletteEl) closePalette(); });
  }
  if (paletteInput) {
    paletteInput.addEventListener("input", function () { _palSel = 0; renderPalette(paletteInput.value); });
    paletteInput.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (_palItems.length) { _palSel = (_palSel + 1) % _palItems.length; renderPalette(paletteInput.value); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (_palItems.length) { _palSel = (_palSel - 1 + _palItems.length) % _palItems.length; renderPalette(paletteInput.value); } }
      else if (e.key === "Enter") { e.preventDefault(); runPalette(); }
    });
  }
  MDV.openPalette = openPalette;
  MDV.closePalette = closePalette;

  // ---- 帮助面板（MDV_SHORTCUTS 单一来源，specs/00）----
  var _shortcutGroups = null;
  function groupShortcuts() {
    if (_shortcutGroups) return _shortcutGroups;
    var order = ["全局", "阅读态", "编辑器内"];
    var groups = {};
    SHORTCUTS.forEach(function (s) {
      var scope = s.scope || "全局";
      (groups[scope] = groups[scope] || []).push(s);
    });
    _shortcutGroups = order.filter(function (k) { return groups[k]; })
      .concat(Object.keys(groups).filter(function (k) { return order.indexOf(k) < 0; }))
      .map(function (k) { return { name: k, items: groups[k] }; });
    return _shortcutGroups;
  }
  function renderHelp() {
    if (!helpListEl) return;
    helpListEl.innerHTML = "";
    groupShortcuts().forEach(function (g) {
      var h = document.createElement("div");
      h.className = "help-group-title";
      h.textContent = g.name;
      helpListEl.appendChild(h);
      g.items.forEach(function (s) {
        var row = document.createElement("div");
        row.className = "help-row";
        var kbd = document.createElement("span");
        kbd.className = "help-keys";
        kbd.textContent = s.keys;
        var desc = document.createElement("span");
        desc.className = "help-desc";
        desc.textContent = s.desc;
        row.appendChild(kbd); row.appendChild(desc);
        helpListEl.appendChild(row);
      });
    });
  }
  function openHelp() {
    if (!helpEl) return;
    renderHelp();
    helpEl.hidden = false;
    if (helpCloseBtn) helpCloseBtn.focus();
  }
  function closeHelp() {
    if (helpEl) helpEl.hidden = true;
  }
  MDV.openHelp = openHelp;
  MDV.closeHelp = closeHelp;
  if (helpCloseBtn) helpCloseBtn.addEventListener("click", closeHelp);
  if (helpEl) helpEl.addEventListener("mousedown", function (e) { if (e.target === helpEl) closeHelp(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && helpEl && !helpEl.hidden) closeHelp();
  });

  // ---- 开始页（零文档状态）----
  if (startEl) {
    Array.prototype.forEach.call(startEl.querySelectorAll(".start-btn"), function (btn) {
      btn.addEventListener("click", function () {
        var action = btn.getAttribute("data-action");
        if (action === "open") pushEvent({ type: "open" });
        else if (action === "new") pushEvent({ type: "new" });
      });
    });
    var startHelpBtn = document.getElementById("start-help");
    if (startHelpBtn) startHelpBtn.addEventListener("click", openHelp);
  }

  window.__appReady = true;
})();
