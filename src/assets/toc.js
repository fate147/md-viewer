// 目录侧栏（toc.js）：卷/章树渲染 + 点击跳转 + 滚动同步高亮。
// 数据唯一来源 = reader.js 的 MDV.outlineTree()（specs/03 R-03-10）：
// 本文件不解析标题、不重算 slug，只消费索引。
// 显示策略（specs/06 R-06-07）：toc_mode=auto → 书卷显示、文档隐藏；
// 用户手动切换后不被下一次 auto 判定覆盖（逃生阀）。
(function () {
  "use strict";
  var MDV = (window.MDV = window.MDV || {});
  var el = null;          // #toc
  var bodyEl = null;      // #toc-list
  var emptyEl = null;     // #toc-empty
  var visible = false;
  var manual = null;
  var _rows = [];      // 扁平化行（卷/章）
  var _winFrom = 0;    // 当前窗口化的可见范围
  var _winTo = 0;      // 用户手动覆盖：true/false/null

  // v2：旧键 mdv.toc.manual 在 2026-11-02 之前会被启动下发误写成 "1"
  // （见 specs/06「启动下发 ≠ 用户手动」），导致文档模式也永远显示目录。
  // 换键名让被污染的旧值自然失效，并在 initToc 里顺手清除。
  var LS_KEY = "mdv.toc.manual.v2";
  var LS_LEGACY = "mdv.toc.manual";

  // 计划 2.3（2026-11-01）：条目超过阈值时**只渲染可见窗口**，不再整表放弃。
  // 旧实现 >400 项直接不显示，导致 400–2000 项的长篇完全没有目录；
  // 现改为窗口化：固定行高 + 顶部/底部空白占位，只建视口内的行。
  // 实测 3955 项整表重建 234ms，窗口化后为个位数毫秒。
  var TOC_MAX_ITEMS = 200;     // 超过此数启用窗口化（计划原值 200）
  var TOC_ROW_H = 27;          // 单行高度（2026-11-02 实测 .toc-item 为 27px；原写 24 会漂移）
  var _userScrolledAt = 0;     // 用户最近一次手动滚目录的时间戳
  var USER_GRACE_MS = 1200;    // 此窗口内不因正文滚动而强行把目录拉回

  function loadManual() {
    try {
      var v = localStorage.getItem(LS_KEY);
      return v === null ? null : v === "1";
    } catch (e) { return null; }
  }
  function saveManual(v) {
    try {
      if (v === null) localStorage.removeItem(LS_KEY);
      else localStorage.setItem(LS_KEY, v ? "1" : "0");
    } catch (e) {}
  }

  MDV.initToc = function (tocEl) {
    el = tocEl;
    bodyEl = el.querySelector("#toc-list");
    emptyEl = el.querySelector("#toc-empty");
    // 清掉可能被污染的旧键（一次性迁移）
    try { localStorage.removeItem(LS_LEGACY); } catch (e) {}
    manual = loadManual();

    // 点击跳转（事件委托，避免每次重建都挂监听）
    bodyEl.addEventListener("click", function (e) {
      var item = e.target.closest("[data-id]");
      if (!item) return;
      var id = item.getAttribute("data-id");
      if (id) MDV.scrollToHeading(id);
    });

    // 侧栏自身滚动 → 重算窗口化可见范围（计划 2.3）
    var wraf = 0;
    el.addEventListener("scroll", function () {
      // 用户手动滚动目录：记录时间，grace 窗口内不让正文滚动把它拉回
      _userScrolledAt = Date.now();
      if (wraf) return;
      wraf = requestAnimationFrame(function () {
        wraf = 0;
        if (_rows.length > TOC_MAX_ITEMS) windowize();
        syncActive(true);
      });
    }, { passive: true });

    // 滚动同步：rAF 节流
    var raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        syncActive();
        if (MDV.emitSection) MDV.emitSection();
      });
    }
    var reader = document.getElementById("reader");
    if (reader) reader.addEventListener("scroll", onScroll, { passive: true });
  };

  // 是否应显示（auto 判定 + 手动逃生阀，specs/06 R-06-07）
  function shouldShow(isDocMode) {
    // 只有「手动显示」是粘性的逃生阀；「手动隐藏」不跨越 auto 判定，
    // 否则用户在文档模式下隐藏一次，回到书卷也再看不到目录。
    if (manual === true) return true;
    return !isDocMode;      // auto：书卷显示、文档隐藏
  }

  // 由 app.js 在每次渲染 / 切换排版模式后调用
  MDV.refreshToc = function (isDocMode) {
    if (!el) return;
    var show = shouldShow(isDocMode);
    el.hidden = !show;
    visible = show;
    if (!show) return;
    render();
    syncActive();
  };

  // 下行入口（specs/05 R-05-11）：只承载显示/隐藏状态
  // 启动初始化（2026-11-02）：只设「给定初始状态」，**不写 manual**。
  // 修前 defect：启动时下发 toc_visible=true 会走 setTocVisible(true)，
  // 把 manual 置 true 并写 localStorage —— 而 manual=true 会让 shouldShow()
  // 直接返回 true、跳过 auto 判定，于是文档模式也永远显示目录，且状态被持久化。
  MDV.initTocVisible = function (defaultVisible) {
    var reader = document.getElementById("reader");
    var isDoc = !!(reader && reader.classList.contains("doc-mode"));
    // 决策顺序：用户手动显示(true)优先 → 否则 auto 判定（书卷显示 / 文档隐藏）
    // 注意：defaultVisible 只是「配置里记的初始值」，不参与 auto 覆盖 —— auto 以内容为准。
    var show;
    if (manual === true) show = true;
    else show = !isDoc;
    el.hidden = !show;
    visible = show;
    if (show) { render(); syncActive(); }
    return show;
  };

  // 用户手动切换（菜单 / Ctrl+Shift+O）—— 只有这里才写 manual + localStorage
  MDV.setTocVisible = function (on) {
    manual = on ? true : null;   // 仅「显示」粘性；「隐藏」交回 auto
    saveManual(manual);
    var reader = document.getElementById("reader");
    var isDoc = !!(reader && reader.classList.contains("doc-mode"));
    el.hidden = !manual;
    visible = manual;
    if (manual) { render(); syncActive(); }
    else if (isDoc) { el.hidden = true; visible = false; }
    return manual;
  };

  MDV.isTocVisible = function () { return visible; };

  function render() {
    var tree = MDV.outlineTree();
    bodyEl.innerHTML = "";

    if (!tree.length) {
      emptyEl.hidden = false;
      emptyEl.textContent = "无目录";
      _rows = [];
      return;
    }
    emptyEl.hidden = true;

    // 扁平化为行（卷 → 其子章），窗口化与全量渲染共用这一份
    _rows = [];
    for (var i = 0; i < tree.length; i++) {
      var node = tree[i];
      if (node.type === "volume" || node.type === "pseudo") {
        _rows.push({ node: node, isVol: true });
        for (var j = 0; j < (node.children || []).length; j++) {
          _rows.push({ node: node.children[j], isVol: false });
        }
      } else {
        _rows.push({ node: node, isVol: false });
      }
    }

    if (_rows.length <= TOC_MAX_ITEMS) {
      renderRange(0, _rows.length);   // 短目录：整表渲染
    } else {
      windowize();                    // 长目录：只渲染可见窗
    }
  }

  // 只渲染 [from, to) 行，前后用等高占位撑出滚动范围
  function renderRange(from, to) {
    bodyEl.innerHTML = "";
    if (from > 0) {
      var padTop = document.createElement("div");
      padTop.className = "toc-pad";
      padTop.style.height = (from * TOC_ROW_H) + "px";
      bodyEl.appendChild(padTop);
    }
    for (var i = from; i < to; i++) {
      bodyEl.appendChild(nodeRow(_rows[i].node, _rows[i].isVol));
    }
    if (to < _rows.length) {
      var padBot = document.createElement("div");
      padBot.className = "toc-pad";
      padBot.style.height = ((_rows.length - to) * TOC_ROW_H) + "px";
      bodyEl.appendChild(padBot);
    }
  }

  // 按侧栏滚动位置计算可见窗（上下各预渲染 20 行）
  function windowize() {
    var vh = el.clientHeight || 600;
    var start = Math.floor(el.scrollTop / TOC_ROW_H) - 20;
    var end = Math.ceil((el.scrollTop + vh) / TOC_ROW_H) + 20;
    start = Math.max(0, start);
    end = Math.min(_rows.length, end);
    renderRange(start, end);
    _winFrom = start;
    _winTo = end;
  }

  function nodeRow(node, isVol) {
    var d = document.createElement("div");
    d.className = "toc-item " + (isVol ? "toc-vol" : "toc-chap");
    if (node.id) d.setAttribute("data-id", node.id);
    var t = document.createElement("span");
    t.className = "toc-text";
    t.textContent = node.text || "";
    d.appendChild(t);
    if (node.chars) {
      var c = document.createElement("span");
      c.className = "toc-count";
      c.textContent = fmtChars(node.chars);
      d.appendChild(c);
    }
    return d;
  }

  function fmtChars(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + "万";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  // 当前章高亮（数据取 MDV.currentSection，与状态栏同源）
  function syncActive(fromSidebar) {
    if (!visible) return;
    var sec = MDV.currentSection();
    var wantId = sec.chapterId || sec.volumeId || null;
    if (!wantId) return;
    // 用户刚手动滚过目录 → 不把窗口强行拉回当前章（否则目录根本滚不动）
    var userBusy = fromSidebar || (Date.now() - _userScrolledAt < USER_GRACE_MS);

    // ① 先在完整行数组里定位目标行——窗口化时它很可能不在 DOM 里，
    //    只查 DOM 会得到空高亮（2026-11-01 实测：滚到第 79 章，active 为空）。
    var targetRow = -1;
    for (var i = 0; i < _rows.length; i++) {
      if (_rows[i].node.id === wantId) { targetRow = i; break; }
    }
    if (targetRow < 0) return;

    // ② 长目录窗口化：若目标行不在当前窗口内，滚动侧栏使窗口覆盖它，再重绘高亮
    if (_rows.length > TOC_MAX_ITEMS && !userBusy) {
      var vh = el.clientHeight || 600;
      var rowTop = targetRow * TOC_ROW_H;
      if (rowTop < el.scrollTop || rowTop + TOC_ROW_H > el.scrollTop + vh) {
        // 把目标行放到视口中部
        el.scrollTop = Math.max(0, rowTop - Math.floor(vh / 2));
        windowize();
      }
    }

    // ③ 在当前 DOM 里高亮（也顺手清掉上一帧残留）
    var items = bodyEl.querySelectorAll(".toc-item");
    for (var j = 0; j < items.length; j++) {
      var id = items[j].getAttribute("data-id");
      items[j].classList.toggle("active", !!id && id === wantId);
    }

    var act = bodyEl.querySelector(".toc-item.active");
    if (act) {
      var r = act.getBoundingClientRect();
      var pr = el.getBoundingClientRect();
      if (r.top < pr.top || r.bottom > pr.bottom) {
        act.scrollIntoView({ block: "nearest" });
      }
    }
  }
})();