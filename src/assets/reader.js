// 阅读层（reader.js）：marked 渲染 + 标题锚点 + 相对图片改写 + 滚动位置对齐
// + 卷/章节结构识别（纯文本小说排版）。
// marked v12 的自定义 renderer 拿不到 this.parser（会抛异常），
// 所以沿用既定方案：默认渲染后走 DOM pass 补 id、改图片、限流高亮。
(function () {
  "use strict";
  var MDV = (window.MDV = window.MDV || {});
  var readerEl = null;

  // 与 Python 侧 slug 规则一致：保留中文/字母数字下划线，其余转 '-'
  function slug(s) {
    s = s.trim().replace(/[^\w\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
    return s.toLowerCase() || "section";
  }

  // 超大文档护栏：只高亮前 500 个代码块（9000 块实测多花 ~2s）
  var HL_CAP = 500;

  // ---------------- 卷/章节结构识别（2026-10-11） ----------------
  // 很多小说 md 是纯文本（无 # 标记），「第一卷」「第三章」只是普通段落，
  // 阅读时没有层级感。这里按行首模式识别卷/章/节/回，阅读前提升为标题、
  // 渲染后打 data-kind 供排版、编辑器给同款行加粗（见 editor.js）。
  var NUM = "0-9一二三四五六七八九十百千两零〇";
  // 词表（v3.1 阶段 2 / R-03-13）：扩充分卷分章 + 中文常见特殊章节。
  // 顺序有意义：volume 类先匹配，避免「楔子」被当正文。
  MDV.STRUCT_RES = [
    { re: new RegExp("^第[" + NUM + "]+\\s*[卷部]"), kind: "volume" },    // 第一卷 / 第2部
    { re: new RegExp("^第[" + NUM + "]+\\s*[章节回]"), kind: "chapter" }, // 第一章 / 第3回
    // 开篇/收束都属「章」而非「卷」：它们跟随所在卷，不另起卷（R-03-13）。
    // 首个卷之前出现时，由 outlineTree 归入伪卷「序」。
    { re: /^(楔子|序章|序幕|序言|引子)(\s|$|[：:·])/, kind: "chapter" },
    { re: /^(尾声|终章|后记|番外|附录|结局)(\s|$|[：:·])/, kind: "chapter" },
  ];
  var STRUCT_MAX_LEN = 40;   // 标题行长度护栏，防误伤长正文

  function structKind(trimmed) {
    if (!trimmed || trimmed.length > STRUCT_MAX_LEN || trimmed.charCodeAt(0) === 35) return null;
    for (var i = 0; i < MDV.STRUCT_RES.length; i++) {
      if (MDV.STRUCT_RES[i].re.test(trimmed)) return MDV.STRUCT_RES[i].kind;
    }
    return null;
  }

  // 供编辑器装饰（editor.js）复用：整行原文 → volume/chapter/null
  MDV.structKindOf = function (rawLine) {
    return structKind((rawLine || "").trim());
  };

  // 独立成段的卷/章行提升为 ## / ###；纯文本小说（全文无 # 标题且含卷章）
  // 时把首个短行提升为书名 #
  function promoteStructuredHeadings(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // BOM
    var lines = text.split("\n");
    var hasMdHeading = false, hasStruct = false, titleDone = false;
    for (var i = 0; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) { hasMdHeading = true; break; }
    }
    if (hasMdHeading) return text;    // 已是规范 markdown，不动
    for (var j = 0; j < lines.length; j++) {
      var t = lines[j].trim();
      if (structKind(t)) { hasStruct = true; break; }
    }
    if (!hasStruct) return text;

    var structSeen = false;
    var firstContent = true;   // 书名只考虑文件首个内容行（前后无需空行）
    for (var k = 0; k < lines.length; k++) {
      var raw = lines[k];
      var t = raw.trim();
      if (!t) continue;
      var kind = structKind(t);
      var prevBlank = k === 0 || lines[k - 1].trim() === "";
      var nextBlank = k === lines.length - 1 || lines[k + 1].trim() === "";
      if (kind && prevBlank && nextBlank) {
        lines[k] = (kind === "volume" ? "## " : "### ") + t;
        structSeen = true;
        firstContent = false;
        continue;
      }
      if (firstContent) {
        if (t.length <= 30) lines[k] = "# " + t;
        firstContent = false;
        titleDone = true;
      }
    }
    return lines.join("\n");
  }

  MDV.initReader = function (el) { readerEl = el; };

  // ---------------- 文档/书卷双排版模式（2026-10-11） ----------------
  // 技术文档（含代码块/表格）用无缩进左对齐的无衬线排版更易读；
  // 小说散文保持衬线缩进两端对齐。auto 时按内容特征判别：
  // 代码围栏数 + 表格数 ≥ 2 → 文档模式。
  MDV.detectDocMode = function (text) {
    if (!text) return false;
    var lines = text.split("\n");
    var fences = 0, inFence = false, tables = 0, prevPipe = false;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t.slice(0, 3) === "```") {
        if (!inFence) fences++;
        inFence = !inFence;
        prevPipe = false;
        continue;
      }
      if (inFence) continue;
      var isPipe = t.charAt(0) === "|";
      if (isPipe) { if (!prevPipe) tables++; }
      prevPipe = isPipe;
    }
    return (fences + tables) >= 2;
  };

  // ================= 渲染管线（v3.1 阶段 3 / specs/03 R-03-09）=================
  // 阈值：≤ CHUNK_THRESHOLD 走全量（与 v3.0 行为完全一致，2.3MB 基线在此路径）；
  // > 阈值走分块。回滚开关：CHUNK_THRESHOLD = Infinity 即永远走全量。
  var CHUNK_THRESHOLD = 1000000;
  var BLOCK_MAX_RAW = 4000;     // 单块 raw 上限，超了按段落再切（不变量⑤）
  var WINDOW_SCREENS = 2;       // 视口上下各渲染 2 屏

  // slug 去重状态：全量与分块共用同一计数器，保证 id 全局唯一
  var _slugUsed = {};

  function resetSlug() { _slugUsed = {}; }

  function dedupId(h) {
    var id = slug(h.textContent || "");
    var n = (_slugUsed[id] = (_slugUsed[id] || 0) + 1);
    if (n > 1) id = id + "-" + (n - 1);
    h.id = id;
    return id;
  }

  // ---- 五项后处理，抽成「对一个容器生效」（全量与分块共用，消除双份实现）----
  function decorateBlock(root, baseDirUrl) {
    var heads = root.querySelectorAll("h1,h2,h3,h4,h5,h6");
    for (var i = 0; i < heads.length; i++) {
      dedupId(heads[i]);
      var kind = structKind((heads[i].textContent || "").trim());
      if (kind) heads[i].setAttribute("data-kind", kind);
    }
    if (baseDirUrl) {
      var imgs = root.querySelectorAll("img");
      for (var j = 0; j < imgs.length; j++) {
        var src = imgs[j].getAttribute("src") || "";
        if (src && !/^(file|https?|data):/i.test(src)) {
          try { imgs[j].src = new URL(src, baseDirUrl).href; } catch (e) {}
        }
      }
    }
  }

  // 代码高亮 + 复制按钮：按块执行，块级去重（不变量①）
  function enhanceBlock(root) {
    var blocks = root.querySelectorAll("pre code");
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].getAttribute("data-hl") === "1") continue;
      try { hljs.highlightElement(blocks[i]); } catch (e) {}
      blocks[i].setAttribute("data-hl", "1");
    }
    enhanceCodeBlocks(root);
  }

  // ---- blockify：把 token 序列归组成块（不变量③⑤）----
  // 规则：
  //  1. space token 并入前一组，不单独成块；
  //  2. heading 与其紧随的首个非 space token 必须同组（保护 app.css h1 + p 缩进规则）；
  //  3. 相邻 list / blockquote 合并，避免列表被拆碎；
  //  4. 单组 raw 超 BLOCK_MAX_RAW 时按段落边界再切。
  function blockify(tokens) {
    var blocks = [];
    var cur = null;

    function flush() { if (cur && cur.tokens.length) blocks.push(cur); cur = null; }

    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (tk.type === "space") {
        if (cur) cur.tokens.push(tk);
        continue;
      }

      var wantJoin = cur && (
        cur.lastType === "heading" ||                       // 规则 2
        (tk.type === "list" && cur.lastType === "list") ||   // 规则 3
        (tk.type === "blockquote" && cur.lastType === "blockquote")
      );

      if (tk.type === "heading") {
        // 新标题一定开新组（除非上一组也是空壳）
        flush();
        cur = { tokens: [tk], raw: tk.raw || "", lastType: "heading" };
        continue;
      }

      if (wantJoin || !cur) {
        if (!cur) cur = { tokens: [], raw: "", lastType: "" };
        cur.tokens.push(tk);
        cur.raw += tk.raw || "";
        cur.lastType = tk.type;
      } else {
        flush();
        cur = { tokens: [tk], raw: tk.raw || "", lastType: tk.type };
      }

      // 规则 4：超长块按段落再切
      if (cur.raw.length > BLOCK_MAX_RAW) {
        var split = splitByParagraph(cur);
        blocks.push(split[0]);
        cur = split[1];
      }
    }
    flush();

    // 计算每块首次渲染的估算高度（1 行 ≈ 1.9em；先粗估，渲染后校正）
    for (var k = 0; k < blocks.length; k++) {
      blocks[k].estHeight = _estHeightFor(blocks[k]);
      blocks[k].rendered = false;
      blocks[k].el = null;
    }
    return blocks;
  }

  // ---- 高度估算校准（2026-11-01）----
  // 初版按「行数 x 32px」估，实测严重低估：4822 块平均 240 字符，
  // 估算 48px/块，实际约 2200px/块，导致前缀和总高只有 115 万而真实远大于此，
  // 滚动窗口算错、增量渲染失效。改为「字符数 x 每字符像素」并用实测反推校准。
  var _calib = { charPx: 26, blockPx: 20 };

  function _estHeightFor(blk) {
    var len = (blk.raw || "").length;
    var lines = Math.max(1, Math.ceil(len / 36));
    return Math.round(lines * _calib.charPx);
  }

  function _recalibrate() {
    var sumChar = 0, sumH = 0, n = 0;
    for (var i = 0; i < _blocks.length; i++) {
      var b = _blocks[i];
      if (!b.rendered || !b.el) continue;
      var h = b.el.getBoundingClientRect().height;
      var len = (b.raw || "").length;
      if (h > 0 && len > 40) { sumChar += len; sumH += h; n++; }
    }
    if (n >= 3 && sumChar > 0) {
      var perCharLine = sumH / sumChar;
      var per = perCharLine * 36;      // 折算成「每行像素」
      if (per > 8 && per < 120) _calib.charPx = per;
    }
    for (var j = 0; j < _blocks.length; j++) {
      if (_blocks[j].rendered) continue;
      var nh = _estHeightFor(_blocks[j]);
      if (Math.abs(nh - _blocks[j].estHeight) > 4) {
        _blocks[j].estHeight = nh;
        if (_blocks[j].el) _blocks[j].el.style.height = nh + "px";
      }
    }
  }

  // 超长块：在空行处切一半，保证不拆坏结构（段落边界）
  function splitByParagraph(block) {
    var raw = block.raw || "";
    var half = Math.floor(raw.length / 2);
    var cut = raw.indexOf("\n\n", half);
    if (cut < 0) cut = raw.lastIndexOf("\n\n", half);
    if (cut < 0) return [block, null];
    var head = raw.slice(0, cut);
    var tail = raw.slice(cut + 2);
    // 用 lexer 重新解析两段，保持 token 正确
    var a = { tokens: marked.lexer(head), raw: head, lastType: block.lastType };
    var b = { tokens: marked.lexer(tail), raw: tail, lastType: block.lastType };
    var out = [a, b];
    for (var i = 0; i < out.length; i++) {
      out[i].estHeight = _estHeightFor(out[i]);
      out[i].rendered = false;
      out[i].el = null;
    }
    return out;
  }

  // ---- 高度前缀和：位置换算的唯一依据（不变量④）----
  var _blocks = [];
  var _prefix = [];      // _prefix[i] = 前 i 块累计高度

  // 前缀和只读「块自报高度」_h（渲染时记录），不做实时布局测量。
  // 实时测量在同一帧内会拿到过期值，是 2026-11-01 定位错乱的主因。
  function rebuildPrefix() {
    _prefix = new Array(_blocks.length + 1);
    _prefix[0] = 0;
    for (var i = 0; i < _blocks.length; i++) {
      var h = _blocks[i]._h;
      if (!h || h <= 0) h = _blocks[i].estHeight;
      _prefix[i + 1] = _prefix[i] + h;
    }
  }

  // 二分：给定 y，返回「已渲染块」中的块下标
  function blockAtY(y) {
    if (!_blocks.length) return -1;
    var lo = 0, hi = _blocks.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (_prefix[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // ---- renderWindow：只渲染视口 ±N 屏内尚未渲染的块 ----
  var _renderRaf = 0;
  var _baseDirUrl = "";
  var _suppressScroll = 0;   // 渲染改写 DOM 引起的高度变化不应被当成用户滚动

  // 单次最多渲染的块数：防止滚动时一次性渲染过多导致卡死（2026-11-01 实测踩到）
  var RENDER_BUDGET = 60;

  function renderWindow() {
    if (!_blocks.length) return;
    var vh = readerEl.clientHeight || 600;
    var top = Math.max(0, readerEl.scrollTop - vh * WINDOW_SCREENS);
    var bottom = readerEl.scrollTop + vh * (1 + WINDOW_SCREENS);

    var first = blockAtY(top);
    var last = blockAtY(bottom);
    if (last < first) last = first;

    var changed = false, budget = RENDER_BUDGET;
    for (var i = first; i <= last && i < _blocks.length && budget > 0; i++) {
      if (_blocks[i].rendered) continue;
      renderOneBlock(_blocks[i]);
      changed = true;
      budget--;
    }
    if (budget === 0) scheduleRender();

    if (changed) rebuildPrefix();
  }

  function renderOneBlock(blk) {
    // 每个块在 renderChunked 时已有占位容器；这里只把内容填进去。
    // 不新建、不插入 —— 占位保证顺序与总高度稳定（不变量②：已渲染块不卸载）。
    var wrap = blk.el;
    if (!wrap) return;

    // 记录填充前的实际高度，用于校正估算
    try {
      wrap.innerHTML = marked.parser(blk.tokens);
    } catch (e) {
      wrap.innerHTML = "";
    }
    wrap.classList.remove("md-placeholder");
    wrap.style.height = "";          // 去掉占位固定高度，交回内容撑开
    decorateBlock(wrap, _baseDirUrl);
    enhanceBlock(wrap);
    blk.rendered = true;

    // 真实高度要等下一帧布局完成才准确；先标记待测，由 measureRendered() 统一回填。
    blk._needMeasure = true;

    // 3.7 图片高度回填（specs/03 R-03-09 不变量④）：
    // img 是异步加载的，加载后块会被撑高；若不回填，前缀和失准会让其后的章定位漂移。
    var imgs = wrap.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.getAttribute("data-hooked") === "1") continue;
      img.setAttribute("data-hooked", "1");
      var remeasure = function () {
        // 只重测该块，避免全量重建前缀和
        var h = wrap.getBoundingClientRect().height;
        if (h > 0) { blk._h = h; blk._needMeasure = false; rebuildPrefix(); }
        if (MDV.emitSection) MDV.emitSection();
      };
      img.addEventListener("load", remeasure);
      img.addEventListener("error", remeasure);
      // 已从缓存加载完成的图不会触发 load，需主动补测
      if (img.complete) remeasure();
    }
  }

  // 每帧结束前统一测量「已渲染但未测」的块，把真实高度写进 _h
  function measureRendered() {
    var changed = false;
    for (var i = 0; i < _blocks.length; i++) {
      var b = _blocks[i];
      if (!b._needMeasure || !b.el) continue;
      var h = b.el.getBoundingClientRect().height;
      if (h > 0) {
        b._h = h;
        b._needMeasure = false;
        changed = true;
      }
    }
    return changed;
  }

  function scheduleRender() {
    if (_renderRaf) return;
    _renderRaf = requestAnimationFrame(function () {
      _renderRaf = 0;
      if (measureRendered()) {
        _recalibrate();
        rebuildPrefix();
      }
      renderWindow();
    });
  }

  // ---- 全量路径：与 v3.0 完全一致 ----
  var _fullText = "";   // 全量模式下的原文（供 buildRawOffsetsFor 用）
  function renderFull(text, baseDirUrl) {
    marked.use({ gfm: true, breaks: true });
    _fullText = promoteStructuredHeadings(text || "");
    readerEl.innerHTML = marked.parse(_fullText);
    _slugUsed = {};
    decorateBlock(readerEl, baseDirUrl);
    var blocks = readerEl.querySelectorAll("pre code");
    var lim = Math.min(blocks.length, HL_CAP);
    for (var i = 0; i < lim; i++) {
      try { hljs.highlightElement(blocks[i]); } catch (e) {}
    }
    enhanceCodeBlocks(readerEl);
  }

  // ---- 分块路径 ----
  function renderChunked(text, baseDirUrl) {
    marked.use({ gfm: true, breaks: true });
    var promoted = promoteStructuredHeadings(text || "");
    var tokens = marked.lexer(promoted);
    _blocks = blockify(tokens);
    for (var i = 0; i < _blocks.length; i++) _blocks[i].index = i;
    _baseDirUrl = baseDirUrl || "";
    _slugUsed = {};
    readerEl.innerHTML = "";
    // 为每个块建立占位容器（撑起全文高度，保证滚动条可达末尾）
    var frag = document.createDocumentFragment();
    for (var b = 0; b < _blocks.length; b++) {
      var ph = document.createElement("div");
      ph.className = "md-block md-placeholder";
      ph.style.height = _blocks[b].estHeight + "px";
      _blocks[b].el = ph;
      frag.appendChild(ph);
    }
    readerEl.appendChild(frag);
    rebuildPrefix();
    renderWindow();
    // 首屏渲染完，下一帧（布局已稳定）统一测量已渲染块的真实高度并重建前缀
    requestAnimationFrame(function () {
      if (measureRendered()) { _recalibrate(); rebuildPrefix(); }
    });
    if (!readerEl._chunkBound) {
      readerEl.addEventListener("scroll", scheduleRender, { passive: true });
      readerEl._chunkBound = true;
    }
  }

  MDV.renderReader = function (text, baseDirUrl) {
    var len = (text || "").length;
    if (len > CHUNK_THRESHOLD) renderChunked(text, baseDirUrl);
    else { _blocks = []; renderFull(text, baseDirUrl); }
  };

  MDV.isChunked = function () { return _blocks.length > 0; };

  // 调试：分块窗口内部状态（仅诊断用，不参与业务）
  MDV._debugChunk = function () {
    return {
      blocks: _blocks.length,
      rendered: _blocks.filter(function (b) { return b.rendered; }).length,
      prefixLen: _prefix.length,
      prefixHead: _prefix.slice(0, 5).map(Math.round),
      prefixTail: _prefix.slice(-3).map(Math.round),
      scrollTop: Math.round(readerEl.scrollTop),
      clientHeight: readerEl.clientHeight,
      spaceTop: readerEl.scrollTop - (readerEl.clientHeight || 600) * WINDOW_SCREENS,
      spaceBottom: readerEl.scrollTop + (readerEl.clientHeight || 600) * (1 + WINDOW_SCREENS),
      el0Height: _blocks[0] && _blocks[0].el ? _blocks[0].el.getBoundingClientRect().height : null,
    };
  };
  MDV.chunkStats = function () {
    return { blocks: _blocks.length, rendered: _blocks.filter(function (b) { return b.rendered; }).length };
  };

  // ---------------- 大纲索引（v3.1 阶段 2 / specs/03 R-03-10） ----------------
  // 唯一数据源：目录侧栏、状态栏位置、章间跳转只读本索引，禁止各自重算标题。
  // 输出 [{ level, kind, text, id, blockIndex, offsetTop, chars }]
  //   kind: volume | chapter | heading ；chars = 本章/卷正文字符数
  MDV.outline = [];

  function isVolume(el) { return el.getAttribute("data-kind") === "volume"; }
  function isChapter(el) { return el.getAttribute("data-kind") === "chapter"; }

  MDV.buildOutline = function () {
    // ---- 分块模式：从块 raw 建索引（DOM 中未渲染的标题并不存在）----
    if (_blocks.length) {
      var outB = [];
      var idUsed = {};
      for (var bi = 0; bi < _blocks.length; bi++) {
        var raw = _blocks[bi].raw || "";
        var lines = raw.split("\n");
        for (var li = 0; li < lines.length; li++) {
          var ln = lines[li];
          var mh = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(ln);
          var text = null, level = 0, kind = "heading";
          if (mh) {
            level = mh[1].length;
            text = mh[2].trim();
            var sk = structKind(text);
            if (sk) kind = sk;
          } else if (structKind(ln.trim()) && ln.trim().length <= STRUCT_MAX_LEN) {
            text = ln.trim();
            kind = structKind(text);
            level = kind === "volume" ? 2 : 3;
          }
          if (!text) continue;
          var baseId = slug(text);
          var n = (idUsed[baseId] = (idUsed[baseId] || 0) + 1);
          var id = n > 1 ? baseId + "-" + (n - 1) : baseId;
          outB.push({ level: level, kind: kind, text: text, id: id,
                      blockIndex: bi, lineIndex: li, offsetTop: 0, chars: 0 });
        }
      }
      // 字数归属（按原文偏移，见 buildRawOffsets）
      var posB = buildRawOffsetsFor(outB);
      var totalB = _totalRawLen;
      for (var a2 = 0; a2 < outB.length; a2++) {
        if (outB[a2].kind !== "chapter") continue;
        var s2 = posB[outB[a2].id] != null ? posB[outB[a2].id] : 0;
        var e2 = totalB;
        for (var b2 = a2 + 1; b2 < outB.length; b2++) {
          if (outB[b2].kind === "chapter" || outB[b2].kind === "volume") {
            e2 = posB[outB[b2].id] != null ? posB[outB[b2].id] : totalB;
            break;
          }
        }
        outB[a2].chars = Math.max(0, e2 - s2);
      }
      MDV.outline = outB;
      MDV._outlineMeasured = true;
      return outB;
    }

    var heads = Array.prototype.slice.call(
      readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    var out = [];
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var kind = h.getAttribute("data-kind") || "heading";
      var level = +(h.tagName.charAt(1)) || 6;
      // 纯文本小说里，卷/章已被提升为 h2/h3；其余按原级别
      out.push({
        level: level,
        kind: kind,
        text: (h.textContent || "").trim(),
        id: h.id,
        blockIndex: i,
        offsetTop: h.offsetTop,
        chars: 0,
      });
    }
    // 字数归属：chapter 取到下一章/卷之前；volume 汇总其子章。
    // 分块模式下未渲染的标题没有 DOM，故优先用「原文偏移」（2026-11-01 修）：
    // blockify 保序、raw 逐块拼接即原文，以 raw 累计长度作字符坐标可靠。
    // v3.1 性能修正（2026-11-01）：原先每个标题调一次 headingPos()，
    // 内部是 createRange().toString() —— 3955 个标题实测 9.9 秒（O(n^2)）。
    // 改为统一用「原文偏移」（与分块路径同一算法），O(n)。
    var positions = buildRawOffsetsFor(out,
      _blocks.length ? null : [_fullText]);
    var total = _totalRawLen;

    for (var a = 0; a < out.length; a++) {
      if (out[a].kind !== "chapter") continue;
      var startPos = positions[out[a].id] != null ? positions[out[a].id] : 0;
      var endPos = total;
      for (var b = a + 1; b < out.length; b++) {
        if (out[b].kind === "chapter" || out[b].kind === "volume") {
          endPos = positions[out[b].id] != null ? positions[out[b].id] : total;
          break;
        }
      }
      out[a].chars = Math.max(0, endPos - startPos);
    }
    // offsetTop 在首次渲染时可能全为 0（布局未完成）；用 _measured 记录，
    // currentSection / jumpChapter 读取前会惰性重测（见 ensureOutline）。
    MDV.outline = out;
    MDV._outlineMeasured = out.length > 0 && out.some(function (o) { return o.offsetTop > 0; });
    return out;
  };

  var _totalRawLen = 0;

  // 标题 id → 原文偏移（分块模式）。按块 raw 累计 + 块内标题行偏移。
  function buildRawOffsets() { return buildRawOffsetsFor(MDV.outline); }

  // 标题 id → 原文偏移。sources 为「原始文本块数组」（分块模式传各块 raw，
  // 全量模式传单元素 [全文]）——两种路径共用同一算法，避免字数口径分叉。
  function buildRawOffsetsFor(list, sources) {
    var srcs = sources || _blocks.map(function (b) { return b.raw || ""; });
    var map = {};
    var acc = 0;
    var textToId = {};
    for (var i = 0; i < list.length; i++) textToId[list[i].text] = list[i].id;
    for (var b = 0; b < srcs.length; b++) {
      var raw = srcs[b] || "";
      var lines = raw.split("\n");
      var off = 0;
      for (var l = 0; l < lines.length; l++) {
        var ln = lines[l];
        var m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(ln);
        var titleText = m ? m[1].trim()
                          : (structKind(ln.trim()) ? ln.trim() : null);
        if (titleText && textToId[titleText] != null && map[textToId[titleText]] == null) {
          map[textToId[titleText]] = acc + off;
        }
        off += ln.length + 1;
      }
      acc += raw.length;
    }
    _totalRawLen = acc;
    return map;
  }

  // 分块模式下：由标题 id 反查其所在块下标。
  // 已渲染的直接用 DOM 位置；未渲染的靠块的 token 原文里是否含该标题文本定位。
  function outlineBlockIndex(id) {
    if (!id || !_blocks.length) return -1;
    // 快速路径：该标题已渲染
    var el = document.getElementById(id);
    if (el) {
      var node = el;
      while (node && node.parentNode !== readerEl) node = node.parentNode;
      var idx = _blocks.findIndex(function (b) { return b.el === node; });
      if (idx >= 0) return idx;
    }
    // 未渲染：只在「块内的标题行」里精确匹配，避免命中正文同名文字
    var txt = null;
    for (var i = 0; i < MDV.outline.length; i++) {
      if (MDV.outline[i].id === id) { txt = MDV.outline[i].text; break; }
    }
    if (!txt) return -1;
    for (var j = 0; j < _blocks.length; j++) {
      var lines = (_blocks[j].raw || "").split("\n");
      for (var l = 0; l < lines.length; l++) {
        var ln = lines[l];
        var m = /^#{1,6}\s+(.+?)\s*$/.exec(ln);
        var tl = m ? m[1].trim() : (structKind(ln.trim()) ? ln.trim() : null);
        if (tl === txt) return j;
      }
    }
    return -1;
  }

  // 确保某块已渲染（跳转前置，R-03-11「必须先渲染再定位」）
  function ensureBlockRendered(idx) {
    if (idx < 0 || idx >= _blocks.length) return false;
    var guard = 0;
    while (!_blocks[idx].rendered && guard++ < 200) {
      renderWindow();
      // 推动视口到该块附近，让 renderWindow 覆盖到它
      var y = _prefix[idx];
      if (readerEl.scrollTop + readerEl.clientHeight < y) {
        readerEl.scrollTop = Math.max(0, y - readerEl.clientHeight / 2);
      }
      if (!advanceRenderTowards(idx)) break;
    }
    return _blocks[idx].rendered;
  }

  // 直接渲染指定块（不受视口窗口限制）
  function advanceRenderTowards(idx) {
    if (idx < 0 || idx >= _blocks.length) return false;
    if (_blocks[idx].rendered) return false;
    renderOneBlock(_blocks[idx]);
    rebuildPrefix();
    return true;
  }

  // 取可用索引：若上次测量失效（全 0）则重测一次。
  // 避免 buildOutline 在布局未完成时被调用留下坏坐标（2026-11-01 实测踩到）。
  function ensureOutline() {
    if (!MDV.outline || !MDV.outline.length || !MDV._outlineMeasured) {
      MDV.buildOutline();
    }
    return MDV.outline;
  }

  // 渲染后调用：把已构建的索引坐标重新测一遍（布局此时已完成）
  // v3.1 性能修正（2026-11-01）：
  // 初版对每个标题调一次 getElementById + 分块回退再线性扫块，3955 标题实测 574ms。
  // 改为「一次 querySelectorAll 建 id→offsetTop 映射」，复杂度 O(标题数)，实测 <10ms。
  MDV.remeasureOutline = function () {
    if (!MDV.outline || !MDV.outline.length) return MDV.outline;

    var map = null;
    var heads = readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6");
    if (heads.length) {
      map = Object.create(null);
      for (var h = 0; h < heads.length; h++) {
        var id = heads[h].id;
        if (id) map[id] = heads[h].offsetTop;
      }
    }
    var blockMap = null;   // id → 块下标（仅分块模式且确有必要时构建一次）
    for (var i = 0; i < MDV.outline.length; i++) {
      var o = MDV.outline[i];
      if (map && o.id && map[o.id] != null) { o.offsetTop = map[o.id]; continue; }
      if (!_blocks.length) continue;
      if (!blockMap) blockMap = buildOutlineBlockMap();
      var bi = o.id != null ? blockMap[o.id] : undefined;
      if (bi != null && bi >= 0) o.offsetTop = _prefix[bi] + 24;
    }
    MDV._outlineMeasured = MDV.outline.some(function (x) { return x.offsetTop > 0; });
    return MDV.outline;
  };

  // id → 块下标，一次扫描建成（供 remeasureOutline 使用，替代逐个线性查找）
  function buildOutlineBlockMap() {
    var m = Object.create(null);
    for (var b = 0; b < _blocks.length; b++) {
      var lines = (_blocks[b].raw || "").split("\n");
      for (var l = 0; l < lines.length; l++) {
        var ln = lines[l];
        var mh = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(ln);
        var txt = mh ? mh[1].trim() : (structKind(ln.trim()) ? ln.trim() : null);
        if (!txt) continue;
        if (m[txt] === undefined) m[txt] = b;
      }
    }
    var byId = Object.create(null);
    for (var i = 0; i < MDV.outline.length; i++) {
      var o = MDV.outline[i];
      if (o.id && m[o.text] !== undefined && byId[o.id] === undefined) byId[o.id] = m[o.text];
    }
    return byId;
  }

  // 卷/章树（供 TOC 侧栏）：无卷时以 h1–h6 建树，章归属前一个卷
  MDV.outlineTree = function () {
    var list = ensureOutline();
    var tree = [], curVol = null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.kind === "volume") {
        curVol = { type: "volume", text: it.text, id: it.id, offsetTop: it.offsetTop,
                   chars: 0, children: [] };
        tree.push(curVol);
      } else {
        var node = { type: it.kind === "chapter" ? "chapter" : "heading",
                     text: it.text, id: it.id, offsetTop: it.offsetTop,
                     chars: it.chars, level: it.level };
        if (curVol) {
          curVol.children.push(node);
          curVol.chars += it.chars || 0;
        } else {
          // 首个 volume 之前的章 → 伪卷「序」
          if (!tree.length || tree[0].type !== "pseudo") {
            curVol = { type: "pseudo", text: "序", id: null, offsetTop: 0,
                       chars: 0, children: [] };
            tree.unshift(curVol);
          }
          tree[0].children.push(node);
          tree[0].chars += it.chars || 0;
        }
      }
    }
    // 没有任何卷/章时退化为按标题建树（文档模式）
    if (!tree.length && list.length) {
      for (var j = 0; j < list.length; j++) {
        tree.push({ type: "heading", text: list[j].text, id: list[j].id,
                    offsetTop: list[j].offsetTop, chars: 0, level: list[j].level });
      }
    }
    return tree;
  };

  // 当前视口所在的章/卷（滚动同步与状态栏位置共用，避免两处各算一份）
  MDV.currentSection = function () {
    var top = readerEl.scrollTop + 24;
    var list = ensureOutline();

    // 分块模式：用「滚动位置 → 块下标」再反查该块之前最近的标题（前缀和可靠，
    // 大纲缓存的 offsetTop 在滚动后不更新，直接比会一直停在第一章）。
    if (_blocks.length) {
      // 前缀和未建立（首次渲染前）时 blockAtY 会返回末块，造成「初始即末章」。
      // 只有前缀和完整且总高有效时才采信。
      var ready = _prefix.length === _blocks.length + 1 &&
                  _prefix[_blocks.length] > 0;
      var bi = ready ? blockAtY(readerEl.scrollTop + 24) : 0;
      var vId = null, vTxt = "", cId = null, cTxt = "";
      for (var q = 0; q < list.length; q++) {
        var pos = list[q].blockIndex;
        if (pos == null) pos = outlineBlockIndex(list[q].id);
        if (pos < 0) continue;
        if (pos > bi) break;
        if (list[q].kind === "volume") { vId = list[q].id; vTxt = list[q].text; cId = null; cTxt = ""; }
        else if (list[q].kind === "chapter") { cId = list[q].id; cTxt = list[q].text; }
      }
      // 视口在第一个条目之前：落到第一条（不回退到列表末尾）
      if (!vTxt && !cTxt && list.length) {
        var first = list[0];
        if (first.kind === "volume") vTxt = first.text;
        else cTxt = first.text;
      }
      var maxS = readerEl.scrollHeight - readerEl.clientHeight;
      var pctS = maxS > 0 ? Math.round(readerEl.scrollTop / maxS * 100) : 0;
      return { volume: vTxt, chapter: cTxt, percent: pctS,
               volumeId: vId, chapterId: cId };
    }

    // 第一步：游标位置 = 最后一个 offsetTop 已越过的条目
    var cur = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetTop - 24 <= top) cur = i; else break;
    }
    // 第二步：该条目是卷 → 章留空；是章/标题 → 向上回溯最近卷
    var vol = "", chap = "", volId = null, chapId = null;
    // 视口在首个标题之上（滚动顶部留白）时，视为全文开头 → 回落到第一条
    if (cur < 0 && list.length) cur = 0;
    if (cur >= 0) {
      if (list[cur].kind === "volume") {
        vol = list[cur].text; volId = list[cur].id;
      } else {
        chap = list[cur].text; chapId = list[cur].id;
        for (var j = cur; j >= 0; j--) {
          if (list[j].kind === "volume") {
            vol = list[j].text; volId = list[j].id; break;
          }
        }
      }
    }
    var max = readerEl.scrollHeight - readerEl.clientHeight;
    var pct = max > 0 ? Math.round(readerEl.scrollTop / max * 100) : 0;
    // 同时返回 id：TOC 高亮按 id 精确匹配，避免同名章/卷误命中
    return { volume: vol, chapter: chap, percent: pct,
             volumeId: volId, chapterId: chapId };
  };

  // 章间跳转（R-03-11）：落到目标章顶部，不是翻页
  MDV.jumpChapter = function (dir) {
    var list = (ensureOutline())
      .filter(function (x) { return x.kind === "chapter" || x.kind === "volume"; });
    if (!list.length) return false;
    var top = readerEl.scrollTop + 24;
    var cur = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetTop - 24 <= top) cur = i; else break;
    }
    var target = Math.max(0, Math.min(list.length - 1, cur + (dir > 0 ? 1 : -1)));
    var y = list[target].offsetTop - 24;
    if (_blocks.length && list[target].id) {
      var bi = outlineBlockIndex(list[target].id);
      if (bi >= 0 && !_blocks[bi].rendered) advanceRenderTowards(bi);
      var el3 = document.getElementById(list[target].id);
      if (el3) y = el3.offsetTop - 24;
    }
    readerEl.scrollTop = Math.max(0, y);
    return true;
  };

  // 滚到指定 id（TOC 点击）
  MDV.scrollToHeading = function (id) {
    if (_blocks.length) {
      // 分块：先确保目标块渲染，再按 DOM 实测位置定位（R-03-11）
      var bi = outlineBlockIndex(id);
      if (bi < 0) return false;
      if (!_blocks[bi].rendered) advanceRenderTowards(bi);
      var el2 = document.getElementById(id);
      if (el2) { readerEl.scrollTop = Math.max(0, el2.offsetTop - 24); return true; }
      // 兜底：用前缀和
      readerEl.scrollTop = Math.max(0, _prefix[bi] - 24);
      return true;
    }
    var el = id ? document.getElementById(id) : null;
    if (!el) {
      // 分块外的兜底：用大纲里的 offsetTop
      for (var i = 0; i < (MDV.outline || []).length; i++) {
        if (MDV.outline[i].id === id) {
          readerEl.scrollTop = Math.max(0, MDV.outline[i].offsetTop - 24);
          return true;
        }
      }
      return false;
    }
    readerEl.scrollTop = Math.max(0, el.offsetTop - 24);
    return true;
  };

  // 代码块增强：语言标签 + 悬浮复制按钮（借鉴 GitHub / Typora）
  function enhanceCodeBlocks(root) {
    (root || readerEl).querySelectorAll("pre").forEach(function (pre) {
      if (pre.parentNode && pre.parentNode.className === "code-wrap") return;
      var code = pre.querySelector("code");
      var m = code ? /language-([\w+#.-]+)/.exec(code.className) : null;
      var wrap = document.createElement("div");
      wrap.className = "code-wrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      var bar = document.createElement("div");
      bar.className = "code-bar";
      var label = document.createElement("span");
      label.className = "code-lang";
      label.textContent = m ? m[1] : "";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy";
      btn.textContent = "复制";
      btn.addEventListener("click", function () {
        var txt = (code || pre).textContent;
        var done = function () {
          btn.textContent = "已复制";
          setTimeout(function () { btn.textContent = "复制"; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done, function () {
            fallbackCopy(txt); done();
          });
        } else {
          fallbackCopy(txt); done();
        }
      });
      bar.appendChild(label);
      bar.appendChild(btn);
      wrap.appendChild(bar);
    });
  }

  function fallbackCopy(txt) {
    var ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  // ---------------- 滚动锚点（F2 切换时对齐位置） ----------------

  // 一行文本若可作锚点（markdown 标题或卷/章行），返回其标题文本
  function lineAnchorText(raw) {
    var m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (m) return m[1];
    var t = raw.trim();
    if (t.charCodeAt && t.charCodeAt(0) !== 35 && structKind(t)) return t;
    return null;
  }

  function currentHeadingLine(lines, cursor0) {
    // 从光标行（含）向上找最近锚点；index = 上方同名锚点的出现序数
    var nearest = null;
    var sameAbove = 0;
    for (var i = cursor0; i >= 0; i--) {
      var txt = lineAnchorText(lines[i]);
      if (!txt) continue;
      var id = slug(txt);
      if (!nearest) {
        nearest = { line: i, slug: id };
      } else if (id === nearest.slug) {
        sameAbove++;
      }
    }
    if (!nearest) return null;
    nearest.index = sameAbove;
    return nearest;
  }

  // 编辑 → 阅读：光标所在小节对应的元素滚到视口顶部
  MDV.anchorReaderFromEditor = function (docText, cursor0) {
    var lines = docText.split("\n");
    var h = currentHeadingLine(lines, cursor0);
    if (!h) { readerEl.scrollTop = 0; return; }
    var wantId = h.index > 0 ? h.slug + "-" + h.index : h.slug;
    // v3.1 性能修正（2026-11-01）：渲染刚结束，布局是脏的；此时读 offsetTop
    // 会触发一次全量重排（3955 标题实测 ~570ms）。
    // 优先用大纲已缓存的 offsetTop；缓存不可用才回退到 DOM 读取。
    var cached = null;
    for (var i = 0; i < (MDV.outline || []).length; i++) {
      if (MDV.outline[i].id === wantId) { cached = MDV.outline[i].offsetTop; break; }
    }
    if (cached != null && cached > 0) {
      readerEl.scrollTop = Math.max(0, cached - 24);
      return;
    }
    var el = document.getElementById(wantId);
    readerEl.scrollTop = el ? Math.max(0, el.offsetTop - 24) : 0;
  };

  // 阅读 → 编辑：视口顶部最近的标题对应到编辑器行号（1 起）
  MDV.anchorLineFromReader = function (docText) {
    var top = readerEl.scrollTop;
    var best = null;
    var hs = readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6");
    // v3.1 性能修正（2026-11-01）：原先在循环条件里逐个读 offsetTop，
    // 3955 个标题会触发 3955 次强制布局（实测该函数 570ms）。
    // 改为先一次性取快照数组（单次布局），再在数组上比较。
    var tops = new Array(hs.length);
    for (var k = 0; k < hs.length; k++) tops[k] = hs[k].offsetTop;
    for (var i = 0; i < hs.length; i++) {
      if (tops[i] - 24 <= top) best = hs[i];
      else break;
    }
    if (!best) return 1;
    var lines = docText.split("\n");
    var seen = {};
    for (var j = 0; j < lines.length; j++) {
      var txt = lineAnchorText(lines[j]);
      if (!txt) continue;
      var id = slug(txt);
      var n = (seen[id] = (seen[id] || 0) + 1);
      var cand = n > 1 ? id + "-" + (n - 1) : id;
      if (cand === best.id) return j + 1;
    }
    return 1;
  };

  MDV.readerScrollRatio = function () {
    // 3.8 分块模式下用「前缀和总高」而非 scrollHeight（specs/03 R-03-09 不变量④）：
    // 占位块高度是估算值，scrollHeight 会随之抖动；前缀和是同一套口径，
    // 与全量模式的语义位置一致。
    var total = _blocks.length && _prefix.length === _blocks.length + 1
      ? _prefix[_blocks.length]
      : readerEl.scrollHeight;
    var max = total - readerEl.clientHeight;
    return max > 0 ? Math.min(1, readerEl.scrollTop / max) : 0;
  };
})();
