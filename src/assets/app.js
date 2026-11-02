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
    return d ? d.st.doc.toString() : "";
  }

  // ---------------- 模式切换（F2：同页显隐互换，无导航） ----------------
  function swapVisibility(mode) {
    // 用 hidden 属性而不是 class：元素初始态就是 hidden 属性（app.html）
    editorHost.hidden = mode !== "editor";
    readerEl.hidden = mode !== "reader";
  }

  // 超大书卷禁止进编辑态（specs/03 R-03-14，2026-11-02）
  // 实测：776K 字符小说切到编辑态，第二次要 636ms —— CodeMirror 首次真正
  // 布局全部 10690 行的固有开销（锚点 2ms、setState 1ms，均已排除）。
  // 小说模式下编辑需求低，直接拒绝比卡 0.6 秒更好。
  var F2_EDIT_MAX_CHARS = 200000;

  function tooLargeForEditor() {
    var d = state.docs.get(state.activeId);
    if (!d) return false;
    if (d.st.doc.length <= F2_EDIT_MAX_CHARS) return false;
    // 只拦书卷模式；文档模式（技术文档）通常标题少、行数少，允许编辑
    return !isDocModeNow();
  }

  // 统一「进入编辑态」入口：F2/菜单/查找替换等所有入口都必须过 R-03-14 守卫，
  // 禁止个别入口直接 setMode("editor") 绕过超大书卷限制（2026-11-02 修 BUG-1：
  // 修前 runCmd("find") 走 setMode("editor") 绕过守卫，776K 小说 Ctrl+F 实测卡 ~875ms）。
  function enterEditor() {
    if (tooLargeForEditor()) {
      pushEvent({ type: "toast", text: "文档过大，暂不支持编辑（" +
        Math.round(state.docs.get(state.activeId).st.doc.length / 10000) + " 万字）" });
      return false;
    }
    setMode("editor");
    return true;
  }

  MDV.toggleMode = function () {
    if (state.mode === "reader" && tooLargeForEditor()) {
      pushEvent({ type: "toast", text: "文档过大，暂不支持编辑（" +
        Math.round(state.docs.get(state.activeId).st.doc.length / 10000) + " 万字）" });
      return;   // 保持阅读态
    }
    setMode(state.mode === "editor" ? "reader" : "editor");
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
      var text2 = d.st.doc.toString();
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

  function renderActiveReader() {
    var d = state.docs.get(state.activeId);
    if (!d) return;
    applyReadingClass();
    var text = d.st.doc.toString();
    MDV.renderReader(text, d.baseDir);
    state.renderedRev = { id: state.activeId, rev: d.rev };
    var cur = MDV.view.state.selection.main.head;
    var line0 = MDV.view.state.doc.lineAt(cur).number - 1;
    MDV.anchorReaderFromEditor(text, line0);
    // v3.1 性能修正（2026-11-01）：
    // renderReader 刚用 innerHTML 换掉全文，布局是脏的。此时同步读 offsetTop 会
    // 触发一次强制重排（3955 标题实测 ~600ms），直接拖慢 F2。
    // 改为下一帧再测（那时重排本就要发生，等于零成本）+ 目录随绘制更新。
    MDV.refreshToc(isDocModeNow());
    requestAnimationFrame(function () {
      MDV.remeasureOutline();
      MDV.refreshToc(isDocModeNow());
    });
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
    var d = {
      st: MDV.stateFromDoc(state.pending),
      dirty: false, rev: 0,
      baseDir: state.pendingMeta.baseDir || "",
      name: state.pendingMeta.name || "",
      editorScroll: 0, readerScroll: 0,
    };
    state.pending = "";
    state.pendingId = null;
    state.docs.set(id, d);
    state.renderedRev = { id: null, rev: -1 };   // 归属作废，下次显示必重渲
    state.activeId = id;
    MDV.view.setState(d.st);
    MDV.view.scrollDOM.scrollTop = 0;
    state.statsStale = true;
    Array.from(tabbar.children).forEach(function (el) {
      el.classList.toggle("active", +el.dataset.id === id);
    });
    setMode(d.st.doc.length ? "reader" : "editor");
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
      doc = MDV.detectDocMode(docText(state.activeId));
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
    MDV.setTocVisible(on);
    pushEvent({ type: "tocToggle", visible: on });
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
    MDV.view.dispatch(MDV.view.state.replaceSelection(text || ""));
  };

  // ---------------- 标签条 ----------------
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
    tabbar.hidden = list.length < 2;
    tabbar.innerHTML = "";
    list.forEach(function (t) {
      var el = document.createElement("div");
      el.className = "tab";
      el.dataset.id = t.id;
      if (t.id === state.activeId) el.classList.add("active");

      var dot = document.createElement("span"); dot.className = "dot";
      var title = document.createElement("span");
      title.className = "tab-title"; title.textContent = t.name;
      var close = document.createElement("span");
      close.className = "close"; close.textContent = "×";
      close.title = "关闭 (中键)";
      el.appendChild(dot); el.appendChild(title); el.appendChild(close);

      el.addEventListener("click", function () {
        if (t.id !== state.activeId) pushEvent({ type: "selectTab", id: t.id });
      });
      el.addEventListener("auxclick", function (e) {
        if (e.button === 1) pushEvent({ type: "closeTab", id: t.id });
      });
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        pushEvent({ type: "closeTab", id: t.id });
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
  };

  MDV.activateTab = function (id) {
    if (state.docs.has(id)) switchActive(id);
  };

  function switchActive(id) {
    if (state.activeId === id) return;
    var cur = state.docs.get(state.activeId);
    if (cur) {
      cur.st = MDV.view.state;          // 留存编辑状态与撤销历史
      cur.editorScroll = MDV.view.scrollDOM.scrollTop;
      if (state.mode === "reader") cur.readerScroll = readerEl.scrollTop;
    }
    var d = state.docs.get(id);
    if (!d) return;
    state.activeId = id;
    MDV.view.setState(d.st);
    MDV.view.scrollDOM.scrollTop = d.editorScroll;
    state.statsStale = true;
    swapVisibility(state.mode);
    // 切标签必改 DOM 归属：阅读区只有一份，必须按新标签重渲（03 R-03-03）
    if (state.mode === "reader") {
      renderActiveReader();
      readerEl.scrollTop = d.readerScroll;   // 恢复该标签自己的阅读位置，不串到上一个
    }
    Array.from(tabbar.children).forEach(function (el) {
      el.classList.toggle("active", +el.dataset.id === id);
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
    else if (k === "f") { e.preventDefault(); MDV.runCmd("find"); }
  });

  // ---------------- 统计 ----------------
  function computeStats() {
    var v = MDV.view;
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
    return JSON.stringify(d ? { len: d.st.doc.length } : { len: 0 });
  };

  window.__getTextChunk = function (id, start, end) {
    var d = state.docs.get(id);
    return JSON.stringify(d ? d.st.doc.sliceString(start, end) : "");
  };

  // ================= 应用外壳：菜单栏 + 状态栏（第一期，specs/00 外壳视觉法）=================
  var menubarEl = document.getElementById("menubar");
  var statusLeftEl = document.getElementById("status-left");
  var statusRightEl = document.getElementById("status-right");
  var uiMeta = { chrome: "custom", themes: [], theme: "", readingMode: "auto", tocMode: "auto" };
  var _statusRightBase = "";
  var _statusTimer = 0;

  MDV.setStatus = function (p) {
    if (!p) return;
    if (p.left != null && statusLeftEl) statusLeftEl.textContent = p.left;
    if (p.right != null) {
      _statusRightBase = p.right;
      if (statusRightEl) statusRightEl.textContent = p.right;
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

  function menuEl(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll(".menu.open"),
      function (m) { m.classList.remove("open"); });
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
    if (it.ev) pushEvent(it.ev);
    else if (it.cmd) MDV.runCmd(it.cmd);
    else if (it.radio === "reading") { uiMeta.readingMode = it.value; pushEvent({ type: "readingMode", mode: it.value }); }
    else if (it.radio === "tocmode") { uiMeta.tocMode = it.value; pushEvent({ type: "tocMode", mode: it.value }); }
    else if (it.check === "toc") { MDV.toggleToc(); }
    else if (it.theme) { uiMeta.theme = it.theme; pushEvent({ type: "theme", id: it.theme }); }
  }
  function buildMenuModel() {
    var themes = (uiMeta.themes || []).map(function (t) {
      return { label: t.name, theme: t.id, checked: t.id === uiMeta.theme };
    });
    return [
      { label: "文件", items: [
        { label: "打开…", acc: "Ctrl+O", ev: { type: "open" } },
        { label: "新建", acc: "Ctrl+N", ev: { type: "new" } },
        { sep: true },
        { label: "保存", acc: "Ctrl+S", ev: { type: "save" } },
        { label: "另存为…", acc: "Ctrl+Shift+S", ev: { type: "saveAs" } },
        { label: "导出 HTML…", ev: { type: "exportHtml" } },
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
        { label: "复制纯文本", ev: { type: "copyPlain" } },
        { label: "全选", acc: "Ctrl+A", cmd: "selectAll" },
        { sep: true },
        { label: "查找…", acc: "Ctrl+F", cmd: "find" },
        { label: "替换…", acc: "Ctrl+H", cmd: "find" }
      ]},
      { label: "视图", items: [
        { label: "编辑 ⇄ 阅读", acc: "F2", cmd: "toggleMode" },
        { sep: true },
        { label: "自动判别", radio: "reading", value: "auto", checked: uiMeta.readingMode === "auto" },
        { label: "书卷", radio: "reading", value: "book", checked: uiMeta.readingMode === "book" },
        { label: "文档", radio: "reading", value: "doc", checked: uiMeta.readingMode === "doc" },
        { sep: true },
        { label: "显示目录", acc: "Ctrl+Shift+O", check: "toc", checked: MDV.isTocVisible() },
        { sep: true },
        { label: "目录：自动", radio: "tocmode", value: "auto", checked: uiMeta.tocMode === "auto" },
        { label: "目录：始终显示", radio: "tocmode", value: "always", checked: uiMeta.tocMode === "always" },
        { label: "目录：始终隐藏", radio: "tocmode", value: "never", checked: uiMeta.tocMode === "never" }
      ]},
      { label: "主题", items: themes },
      { label: "帮助", items: [
        { label: "快捷键", ev: { type: "help" } },
        { label: "关于", ev: { type: "about" } }
      ]}
    ];
  }
  function renderMenus() {
    if (!menubarEl) return;
    menubarEl.innerHTML = "";
    if (uiMeta.chrome === "native") return;
    buildMenuModel().forEach(function (m) {
      var wrap = menuEl("div", "menu");
      var btn = menuEl("button", "menu-btn", m.label);
      var pop = menuEl("div", "menu-pop");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var wasOpen = wrap.classList.contains("open");
        closeMenus();
        if (!wasOpen) wrap.classList.add("open");
      });
      m.items.forEach(function (it) {
        if (it.sep) { pop.appendChild(menuEl("div", "menu-sep")); return; }
        var row = menuEl("div", "menu-item" + (it.checked ? " checked" : ""));
        row.appendChild(menuEl("span", "mi-label", (it.checked ? "✓ " : "") + it.label));
        if (it.acc) row.appendChild(menuEl("span", "mi-acc", it.acc));
        row.addEventListener("click", closeMenuThen(function () { menuAction(it); }));
        pop.appendChild(row);
      });
      wrap.appendChild(btn);
      wrap.appendChild(pop);
      menubarEl.appendChild(wrap);
    });
  }
  document.addEventListener("click", function () { closeMenus(); });

  MDV.setUIMeta = function (meta) {
    if (meta) { for (var k in meta) uiMeta[k] = meta[k]; }
    document.body.classList.toggle("chrome-native", uiMeta.chrome === "native");
    document.body.classList.toggle("shell-dark", !!uiMeta.shellDark);
    renderMenus();
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

  // ---- 命令面板 Ctrl+K（第三期）----
  var paletteEl = document.getElementById("palette");
  var paletteInput = document.getElementById("palette-input");
  var paletteList = document.getElementById("palette-list");
  var _palSel = 0, _palItems = [];
  function collectCommands() {
    var out = [];
    buildMenuModel().forEach(function (m) {
      m.items.forEach(function (it) {
        if (it.sep) return;
        out.push({ label: m.label + " › " + it.label, it: it });
      });
    });
    return out;
  }
  function renderPalette(q) {
    q = (q || "").trim().toLowerCase();
    _palItems = collectCommands().filter(function (c) {
      return !q || c.label.toLowerCase().indexOf(q) >= 0;
    });
    if (_palSel >= _palItems.length) _palSel = Math.max(0, _palItems.length - 1);
    paletteList.innerHTML = "";
    _palItems.forEach(function (c, i) {
      var row = menuEl("div", "pal-item" + (i === _palSel ? " sel" : ""), c.label);
      row.addEventListener("click", function () { _palSel = i; runPalette(); });
      paletteList.appendChild(row);
    });
  }
  function runPalette() {
    var c = _palItems[_palSel];
    if (!c) return;
    closePalette();
    menuAction(c.it);
  }
  function openPalette() {
    if (!paletteEl) return;
    paletteEl.hidden = false;
    if (paletteInput) { paletteInput.value = ""; paletteInput.focus(); }
    _palSel = 0;
    renderPalette("");
  }
  function closePalette() { if (paletteEl) paletteEl.hidden = true; }
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

  window.__appReady = true;
})();
