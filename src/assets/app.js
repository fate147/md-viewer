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
        if (state.mode !== "editor") setMode("editor");
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

  window.__appReady = true;
})();
