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

  // 高亮护栏（v3.1 计划 3.5）：语义由「只高亮前 N 个」改为「进入视口才高亮」。
  // 旧行为：全量路径固定高亮前 500 块，第 501 块起永远是纯文本（用户滚到也看不到颜色）。
  // 新行为：首屏同步高亮 + 滚动时按需补高亮，配合 data-hl 去重（分块路径同款）。
  var HL_CAP = 500;
  var HL_IDLE_LIMIT = 200;   // 单次滚动补高亮的上限，避免长顿

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

  // 首字符预筛表（2026-11-01 性能）：正文里 99% 的行不可能是卷/章标题，
  // 先按首字符挡掉，避免每行跑 6 条正则。实测 786K 字符的全文扫描
  // 因此从 474ms 降到十毫秒级。
  var _STRUCT_FIRST = {
    "第": 1, "楔": 1, "序": 1, "引": 1,
    "尾": 1, "终": 1, "后": 1, "番": 1, "附": 1, "结": 1
  };

  function structKind(trimmed) {
    if (!trimmed || trimmed.length > STRUCT_MAX_LEN || trimmed.charCodeAt(0) === 35) return null;
    if (!_STRUCT_FIRST[trimmed.charAt(0)]) return null;
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
    var hasMdHeading = false;
    for (var i = 0; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) { hasMdHeading = true; break; }
    }
    // 2026-11-24：不再因「全文出现过 # 标题」就整体放弃提升。
    // 修前只要 100MB 里有任何一行以 "# " 开头，整篇章行都不提升 ——
    // 目录里有 9,838 个章，正文里一个标题都渲染不出来，TOC 跳转也就落空。
    var structSeen = false;
    var firstContent = true;   // 书名只考虑文件首个内容行（前后无需空行）
    var out = [];
    var inFence = false;
    for (var k = 0; k < lines.length; k++) {
      var raw = lines[k];
      var t = raw.trim();
      if (!t) { out.push(raw); continue; }
      if (t.slice(0, 3) === "```" || t.slice(0, 3) === "~~~") {
        inFence = !inFence;
        out.push(raw);
        continue;
      }
      if (inFence) { out.push(raw); continue; }
      var kind = structKind(t);
      var prevBlank = k === 0 || lines[k - 1].trim() === "";
      var nextLine = k === lines.length - 1 ? "" : lines[k + 1].trim();
      var nextIsStruct = !!structKind(nextLine);
      var nextBlank = nextLine === "" || !nextIsStruct;
      // 章行常常紧跟正文、前面没有空行。放宽为：prevBlank 或 行本身很短（≤24 字）
      var promote = kind && nextBlank && (prevBlank || t.length <= 24);
      if (promote) {
        // 提升的标题必须自成一段（前后补空行），否则 marked 把「正文行 + 章行」
        // 当成同一段落，标题根本不会渲染成 h2/h3。
        if (out.length && out[out.length - 1].trim() !== "") out.push("");
        out.push((kind === "volume" ? "## " : "### ") + t);
        out.push("");
        structSeen = true;
        firstContent = false;
        continue;
      }
      if (firstContent) {
        // 已有 markdown 标题的文档不再造「书名」，避免与作者自己的 h1 重复
        if (!hasMdHeading && !structSeen && t.length <= 30) {
          out.push("# " + t);
          out.push("");
        } else {
          out.push(raw);
        }
        firstContent = false;
        continue;
      }
      out.push(raw);
    }
    return out.join("\n");
  }

  MDV.initReader = function (el) { readerEl = el; };

  // ---------------- 文档/书卷双排版模式（2026-10-11，2026-11-05 升级） ----------------
  // 技术文档用无缩进左对齐的无衬线排版；小说散文保持衬线缩进两端对齐。
  // auto 判别（specs/03 R-03-05）：
  //   1) 有代码围栏或表格，且中文小说卷/章行 < 3 → 文档模式；
  //   2) 否则标题 ≥ 3 且列表/行内代码/链接特征足够 → 文档模式；
  //   3) 中文小说结构优先判书卷，避免误伤。
  MDV.detectDocMode = function (text) {
    if (!text) return false;
    var lines = text.split("\n");
    var fences = 0, inFence = false, tables = 0, prevPipe = false;
    var headings = 0, lists = 0, novel = 0;
    var NOVEL_RE = /^第[0-9一二三四五六七八九十百千万零两]+\s*[卷部章节回]/;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      var fenceMark = t.slice(0, 3);
      if (fenceMark === "```" || fenceMark === "~~~") {
        if (!inFence) fences++;
        inFence = !inFence;
        prevPipe = false;
        continue;
      }
      if (inFence) continue;
      if (/^#{1,6}\s+\S/.test(t)) headings++;
      if (/^([-*+]|\d+[.)])\s+\S/.test(t)) lists++;
      if (NOVEL_RE.test(t)) novel++;
      var isPipe = t.charAt(0) === "|";
      if (isPipe) { if (!prevPipe) tables++; }
      prevPipe = isPipe;
    }
    var inlineCode = (text.match(/`[^`\n]+`/g) || []).length;
    var links = (text.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
    if ((fences + tables) >= 1 && novel < 3) return true;
    return headings >= 3 && (lists >= 5 || inlineCode >= 4 || links >= 3);
  };

  // ================= 渲染管线（v3.1 阶段 3 / specs/03 R-03-09）=================
  // 阈值：≤ CHUNK_THRESHOLD 走全量（与 v3.0 行为完全一致，2.3MB 基线在此路径）；
  // > 阈值走分块。回滚开关：CHUNK_THRESHOLD = Infinity 即永远走全量。
  var CHUNK_THRESHOLD = 1000000;
  var BLOCK_MAX_RAW = 4000;     // 单块 raw 上限，超了按段落再切（不变量⑤）
  var WINDOW_SCREENS = 2;       // 视口上下各渲染 2 屏

  // slug 去重状态：全量与分块共用同一计数器，保证 id 全局唯一
  var _slugUsed = {};

  function dedupId(h) {
    var id = slug(h.textContent || "");
    var n = (_slugUsed[id] = (_slugUsed[id] || 0) + 1);
    if (n > 1) id = id + "-" + (n - 1);
    h.id = id;
    return id;
  }

  // ---- 六项后处理，抽成「对一个容器生效」（全量与分块共用，消除双份实现）----
  // 表格外包滚动容器：表格本体保持 table 布局，超宽时才由 .table-wrap 横向滚动。
  function wrapTables(root) {
    var tables = root.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      var parent = table.parentNode;
      if (parent && parent.className &&
          String(parent.className).indexOf("table-wrap") !== -1) continue;
      var wrap = document.createElement("div");
      wrap.className = "table-wrap";
      parent.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
  }

  function decorateBlock(root, baseDirUrl, blk) {
    var heads = root.querySelectorAll("h1,h2,h3,h4,h5,h6");
    var seen = blk ? Object.create(null) : null;
    for (var i = 0; i < heads.length; i++) {
      if (blk) {
        // 与 buildOutline 同源：slug + 块下标 + 块内同名去重（不依赖渲染顺序）
        var base = slug(heads[i].textContent || "");
        var dup = (seen[base] = (seen[base] || 0) + 1);
        heads[i].id = base + "-b" + blk.index + (dup > 1 ? "-" + (dup - 1) : "");
      } else {
        dedupId(heads[i]);
      }
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
    wrapTables(root);
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

  // ---- blockify：把 token 序列归组成块（不变量③⑤，2026-11-24 重写合并规则）----
  // 规则：
  //  1. space token 并入前一组，不单独成块；
  //  2. heading 与其紧随的首个非 space token 必须同组（保护 app.css h1 + p 缩进规则）；
  //  3. 相邻普通 token **持续合并到接近 BLOCK_MAX_RAW（4000）**再成块——
  //     修前每条段落各自成块，8M 字符实测 97,308 块，主线程被逐帧全表扫描吃死；
  //  4. 单组 raw 超 BLOCK_MAX_RAW 时按「空行 → 行 → 句末」降级切分。
  function blockify(tokens) {
    var blocks = [];
    var cur = null;

    function flush() { if (cur && cur.tokens.length) blocks.push(cur); cur = null; }
    function start(tk) {
      cur = { tokens: [tk], raw: tk.raw || "", lastType: tk.type };
    }

    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      var rawLen = (tk.raw || "").length;

      if (tk.type === "space") {
        if (cur) { cur.tokens.push(tk); cur.raw += tk.raw || ""; }
        continue;
      }

      if (tk.type === "heading") {
        flush();
        start(tk);
        continue;
      }

      if (!cur) {
        start(tk);
      } else if (cur.tokens.length > 1 && cur.raw.length + rawLen > BLOCK_MAX_RAW) {
        // 规则 3：本组已接近上限，另起一组
        flush();
        start(tk);
      } else {
        cur.tokens.push(tk);
        cur.raw += tk.raw || "";
        cur.lastType = tk.type;
      }

      // 规则 4：超长块切到合规为止（splitByParagraph 切不动时返回 null，循环自然结束）
      while (cur && cur.raw.length > BLOCK_MAX_RAW) {
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
      // 校准值变化不足 1% 时不动占位高度：避免每帧给上千个占位写 style（不变量⑥）
      if (per > 8 && per < 120 &&
          Math.abs(per - _calib.charPx) / _calib.charPx > 0.01) {
        _calib.charPx = per;
      }
    }
    var touched = false;
    for (var j = 0; j < _blocks.length; j++) {
      if (_blocks[j].rendered) continue;
      var nh = _estHeightFor(_blocks[j]);
      if (Math.abs(nh - _blocks[j].estHeight) > 4) {
        _blocks[j].estHeight = nh;
        if (_blocks[j].el) _blocks[j].el.style.height = nh + "px";
        touched = true;
      }
    }
    if (touched) _prefixDirty = 0;     // 估算高度整体变化：前缀和从头重算
  }

  // 超长块切分（不变量⑤）：空行 → 行 → 句末标点 → 安全码点硬切，四级降级。
  // 修前：找不到 "\n\n" 就 return [block, null]，中文小说（段间无空行）因此
  // 整章一个块、4000 字符护栏完全失效（2026-11-24 实测 97,308 块/滚不动）。
  function splitByParagraph(block) {
    var raw = block.raw || "";
    if (raw.length <= BLOCK_MAX_RAW) return [block, null];
    var half = Math.floor(raw.length / 2);
    var cut = raw.indexOf("\n\n", half);
    var skip = 2;
    if (cut < 0) cut = raw.lastIndexOf("\n\n", half);
    if (cut < 0) {                        // 中文小说：段间没有空行，退到单个换行
      cut = raw.indexOf("\n", half);
      skip = 1;
      if (cut < 0) cut = raw.lastIndexOf("\n", half);
    }
    if (cut < 0) {                        // 整段无换行：退到句末标点
      var re = /[。！？；.!?;]/g;
      re.lastIndex = half;
      var m = re.exec(raw);
      cut = m ? m.index + 1 : Math.min(raw.length - 1, half);
      skip = 0;
    }
    if (skip === 0 && cut > 0 && cut < raw.length) {
      var code = raw.charCodeAt(cut - 1);        // 不要把代理对切成两半
      if (code >= 0xD800 && code <= 0xDBFF) cut += 1;
    }
    if (cut <= 0 || cut >= raw.length) return [block, null];
    var head = raw.slice(0, cut);
    var tail = raw.slice(cut + skip);
    if (!tail) return [block, null];
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
  var _prefix = [];      // _prefix[i] = 前 i 块累计高度（绝对值，跨段有效）
  var _prefixDirty = 0;  // 从该下标起需要重算（不变量⑥：增量而非全表重建）
  var _needMeasure = [];  // 已渲染待测块的队列（禁止每帧全表扫描 _blocks）

  // ---- 分段（2026-11-24）：Chromium 元素高度上限 2^25 px ≈ 33.55M ----
  // 105MB 实测 scrollHeight 被截在 33,554,432，约 40% 文本永远滚不到（「后面都没有」）。
  // 超过 SEG_MAX_PX 的文档改为「一次只挂一段」：段内照旧视口增量渲染，
  // 滚到段尾自动续下一段，TOC 跳转会切到目标所在段。
  var SEG_MAX_PX = 12000000;
  var _segStart = 0, _segEnd = 0;
  var _advancing = false;

  function segmentEndFor(start) {
    var total = 0, end = start;
    while (end < _blocks.length && total + (_blocks[end].estHeight || 0) <= SEG_MAX_PX) {
      total += _blocks[end].estHeight || 0;
      end++;
    }
    if (end === start) end = Math.min(_blocks.length, start + 1);
    return end;
  }

  // 前缀和只读「块自报高度」_h（渲染时记录），不做实时布局测量。
  // 实时测量在同一帧内会拿到过期值，是 2026-11-01 定位错乱的主因。
  function rebuildPrefix() {
    if (_prefix.length !== _blocks.length + 1) {
      _prefix = new Array(_blocks.length + 1);
      _prefix[0] = 0;
      _prefixDirty = 0;
    }
    for (var i = _prefixDirty; i < _blocks.length; i++) {
      var h = _blocks[i]._h;
      if (!h || h <= 0) h = _blocks[i].estHeight;
      _prefix[i + 1] = _prefix[i] + h;
    }
    _prefixDirty = _blocks.length;
  }

  function markPrefixDirty(idx) {
    if (typeof idx === "number" && idx >= 0 && idx < _prefixDirty) _prefixDirty = idx;
  }

  // 二分：给定 y（绝对像素，含段偏移），返回块下标（限定在当前段内）
  function blockAtY(y) {
    if (!_blocks.length) return -1;
    var lo = _segStart, hi = Math.max(_segStart, _segEnd - 1);
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
    var base = _prefix[_segStart] || 0;
    var y = readerEl.scrollTop + base;
    var first = Math.max(_segStart, blockAtY(Math.max(0, y - vh * WINDOW_SCREENS)));
    var last = Math.min(Math.max(_segStart, _segEnd - 1),
                        blockAtY(y + vh * (1 + WINDOW_SCREENS)));
    if (last < first) last = first;

    var changed = false, budget = RENDER_BUDGET;
    for (var i = first; i <= last && i < _segEnd && budget > 0; i++) {
      if (_blocks[i].rendered) continue;
      renderOneBlock(_blocks[i]);
      changed = true;
      budget--;
    }
    if (budget === 0) scheduleRender();

    if (changed) rebuildPrefix();

    // 段尾自动续读（分段模式）：滚到本段底就把下一段挂上来，保持连续阅读
    if (!_advancing && _segEnd < _blocks.length &&
        readerEl.scrollTop + readerEl.clientHeight >= readerEl.scrollHeight - 8) {
      renderSegment(_segEnd);
    }
  }

  function renderOneBlock(blk) {
    // 每个块在 renderChunked 时已有占位容器；这里只把内容填进去。
    // 不新建、不插入 —— 占位保证顺序与总高度稳定（不变量②：已渲染块不卸载）。
    var wrap = blk.el;
    if (!wrap) return;

    // 记录填充前的实际高度，用于校正估算
    if (blk.plain) {
      // 纯文本块：转义后原样保留换行（specs/10 R-10-02）
      wrap.innerHTML = "<pre class=\"plain-text" + (_plainMono ? " mono" : "")
        + "\">" + escapeHtml(blk.raw) + "</pre>";
    } else {
      try {
        wrap.innerHTML = marked.parser(blk.tokens);
      } catch (e) {
        wrap.innerHTML = "";
      }
    }
    wrap.classList.remove("md-placeholder");
    wrap.style.height = "";          // 去掉占位固定高度，交回内容撑开
    if (!blk.plain) {                // 纯文本块不做 markdown 后处理（无标题/无代码复制按钮）
      decorateBlock(wrap, _baseDirUrl, blk);
      enhanceBlock(wrap);
    }
    blk.rendered = true;

    _blockMapStamp = -1;   // 块渲染后 DOM 归属变化，映射需重建

    // 真实高度要等下一帧布局完成才准确；先入待测队列，由 measureRendered() 回填。
    blk._needMeasure = true;
    _needMeasure.push(blk);
    markPrefixDirty(blk.index);   // 该块及之后的前缀和待重算（增量）

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
        if (h > 0) { blk._h = h; blk._needMeasure = false; markPrefixDirty(blk.index); rebuildPrefix(); }
        if (MDV.emitSection) MDV.emitSection();
      };
      img.addEventListener("load", remeasure);
      img.addEventListener("error", remeasure);
      // 已从缓存加载完成的图不会触发 load，需主动补测
      if (img.complete) remeasure();
    }
  }

  // 每帧结束前只测「已渲染且待测」的块（不变量⑥：队列驱动，不扫全表）
  function measureRendered() {
    if (!_needMeasure.length) return false;
    var changed = false;
    var keep = [];
    for (var k = 0; k < _needMeasure.length; k++) {
      var b = _needMeasure[k];
      if (!b || !b._needMeasure || !b.el) continue;
      var h = b.el.getBoundingClientRect().height;
      if (h > 0) {
        b._h = h;
        b._needMeasure = false;
        markPrefixDirty(b.index);
        changed = true;
      } else {
        keep.push(b);
      }
    }
    _needMeasure = keep;
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
    // 首屏同步高亮（后续块的补高亮交给滚动监听）
    var blocks = readerEl.querySelectorAll("pre code");
    var lim = Math.min(blocks.length, HL_CAP);
    for (var i = 0; i < lim; i++) {
      if (blocks[i].getAttribute("data-hl") === "1") continue;
      try { hljs.highlightElement(blocks[i]); } catch (e) {}
      blocks[i].setAttribute("data-hl", "1");
    }
    bindFullScrollHighlight();
    enhanceCodeBlocks(readerEl);
  }

  // 全量路径的滚动补高亮：把「未高亮且已进入视口」的块补上，单次上限 HL_IDLE_LIMIT。
  function bindFullScrollHighlight() {
    if (readerEl._hlBound) return;
    readerEl._hlBound = true;
    var raf = 0;
    readerEl.addEventListener("scroll", function () {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        if (_blocks.length) return;   // 分块路径由 renderWindow 自行按块高亮
        var vh = readerEl.clientHeight || 600;
        var top = readerEl.scrollTop - vh;
        var bottom = readerEl.scrollTop + vh * 2;
        var codes = readerEl.querySelectorAll("pre code");
        var done = 0;
        for (var i = 0; i < codes.length && done < HL_IDLE_LIMIT; i++) {
          var c = codes[i];
          if (c.getAttribute("data-hl") === "1") continue;
          var r = c.getBoundingClientRect();
          var y = r.top + readerEl.scrollTop;
          if (y < top || y > bottom) continue;
          try { hljs.highlightElement(c); } catch (e) {}
          c.setAttribute("data-hl", "1");
          done++;
        }
      });
    }, { passive: true });
  }

  // ---- 分段挂载：只把 [start,end) 的占位放进 DOM（超长文本必备）----
  function buildSegmentDom(start, end) {
    _segStart = start;
    _segEnd = end;
    // 段外块的 DOM 引用一律作废，否则会往已卸载的节点里渲染
    for (var i = 0; i < _blocks.length; i++) {
      var b = _blocks[i];
      if (i < start || i >= end) {
        b.el = null;
        b.rendered = false;
        b._h = 0;
        b._needMeasure = false;
      }
    }
    _needMeasure = [];
    readerEl.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var k = start; k < end; k++) {
      var blk = _blocks[k];
      blk.rendered = false;
      var ph = document.createElement("div");
      ph.className = "md-block md-placeholder";
      ph.style.height = blk.estHeight + "px";
      blk.el = ph;
      frag.appendChild(ph);
    }
    readerEl.appendChild(frag);
    readerEl.scrollTop = 0;
    _prefixDirty = Math.max(0, start);
    rebuildPrefix();
    renderWindow();
  }

  function renderSegment(start) {
    if (!_blocks.length || _advancing) return;
    _advancing = true;
    try {
      buildSegmentDom(start, segmentEndFor(start));
    } finally {
      _advancing = false;
    }
  }

  // ---- 分块路径 ----
  function renderChunked(text, baseDirUrl) {
    marked.use({ gfm: true, breaks: true });
    var promoted = promoteStructuredHeadings(text || "");
    var tokens = marked.lexer(promoted);
    _blocks = blockify(tokens);
    for (var i = 0; i < _blocks.length; i++) _blocks[i].index = i;
    _needMeasure = [];
    _baseDirUrl = baseDirUrl || "";
    _slugUsed = {};
    _segStart = 0;
    _segEnd = _blocks.length;
    _prefix = [];
    _prefixDirty = 0;
    rebuildPrefix();                     // 先算全量绝对前缀和（分段决策依据）
    if ((_prefix[_blocks.length] || 0) > SEG_MAX_PX) {
      renderSegment(0);                  // 超长文本：一次只挂一段
    } else {
      buildSegmentDom(0, _blocks.length);
    }
    // 首屏渲染完，下一帧（布局已稳定）统一测量已渲染块的真实高度并重建前缀
    requestAnimationFrame(function () {
      if (measureRendered()) { _recalibrate(); rebuildPrefix(); }
    });
    if (!readerEl._chunkBound) {
      readerEl.addEventListener("scroll", scheduleRender, { passive: true });
      readerEl._chunkBound = true;
    }
  }

  // ---- 纯文本路径（specs/10：.txt/源码/日志等不做 markdown 解析）----
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 按行边界切块（复用分块/前缀和/分段机制，超长 .txt 也能滚到底）
  function blockifyPlain(text) {
    var blocks = [];
    var i = 0, n = text.length;
    while (i < n) {
      var end = Math.min(n, i + BLOCK_MAX_RAW);
      if (end < n) {
        var nl = text.lastIndexOf("\n", end);
        if (nl > i) end = nl + 1;
      }
      blocks.push({ tokens: [], raw: text.slice(i, end), lastType: "paragraph",
                    plain: true, rendered: false, el: null, index: blocks.length });
      i = end;
    }
    for (var k = 0; k < blocks.length; k++) blocks[k].estHeight = _estHeightFor(blocks[k]);
    return blocks;
  }

  var _plainMono = false;      // 纯文本是否按代码排版（.py/.json… = 等宽；.txt/.log = 正文体）

  MDV.renderPlain = function (text, baseDirUrl, opts) {
    _plainMono = !!(opts && opts.mono);
    MDV.outline = [];
    MDV._outlineMeasured = false;
    _blocks = blockifyPlain(text || "");
    _needMeasure = [];
    _baseDirUrl = baseDirUrl || "";
    _slugUsed = {};
    _segStart = 0;
    _segEnd = _blocks.length;
    _prefix = [];
    _prefixDirty = 0;
    rebuildPrefix();
    if ((_prefix[_blocks.length] || 0) > SEG_MAX_PX) renderSegment(0);
    else buildSegmentDom(0, _blocks.length);
    requestAnimationFrame(function () {
      if (measureRendered()) { _recalibrate(); rebuildPrefix(); }
    });
    if (!readerEl._chunkBound) {
      readerEl.addEventListener("scroll", scheduleRender, { passive: true });
      readerEl._chunkBound = true;
    }
  };

  MDV.renderReader = function (text, baseDirUrl) {
    // 02 / 03 R-03-10：切换标签必然换一份内容，旧大纲必须作废。
    // 修前遗漏：buildOutline 只在 _outlineMeasured 为假时重建，而 outline 是
    // 模块级全局量、renderReader 从不重置 —— 切到另一个标签后目录仍显示
    // 「上一个标签」的卷章（实测：A 有 30 章，切到 5 章的 B，目录仍是 A 的）。
    MDV.outline = [];
    MDV._outlineMeasured = false;

    var len = (text || "").length;
    if (len > CHUNK_THRESHOLD) renderChunked(text, baseDirUrl);
    else { _blocks = []; _needMeasure = []; _prefix = []; _prefixDirty = 0;
           _segStart = 0; _segEnd = 0; renderFull(text, baseDirUrl); }
  };

  MDV.isChunked = function () { return _blocks.length > 0; };

  // 诊断用（只读）：分段/前缀和/待测队列的当前状态，供探针与现场排查
  MDV.debugState = function () {
    return {
      blocks: _blocks.length,
      segStart: _segStart,
      segEnd: _segEnd,
      advancing: _advancing,
      prefixLen: _prefix.length,
      prefixTotal: _prefix[_blocks.length] || 0,
      calib: _calib.charPx,
      domBlocks: readerEl ? readerEl.querySelectorAll(".md-block").length : 0,
    };
  };

  // 诊断用（只读）：查看某块原文前缀 / 是否已渲染
  MDV.debugBlock = function (i) {
    var b = _blocks[i];
    if (!b) return null;
    var hs = (b.raw || "").match(/^#{1,6}\s+.*$/gm) || [];
    return { index: i, rendered: !!b.rendered, hasEl: !!b.el,
             estHeight: b.estHeight, raw: (b.raw || "").slice(0, 60),
             rawLen: (b.raw || "").length,
             headingsInRaw: hs.slice(0, 3),
             tokenTypes: (b.tokens || []).map(function (t) { return t.type; }).slice(0, 12) };
  };

  // ---------------- 大纲索引（v3.1 阶段 2 / specs/03 R-03-10） ----------------
  // 唯一数据源：目录侧栏、状态栏位置、章间跳转只读本索引，禁止各自重算标题。
  // 输出 [{ level, kind, text, id, blockIndex, offsetTop, chars }]
  //   kind: volume | chapter | heading ；chars = 本章/卷正文字符数
  MDV.outline = [];

  MDV.buildOutline = function () {
    // ---- 分块模式：从块 raw 建索引（DOM 中未渲染的标题并不存在）----
    if (_blocks.length) {
      var outB = [];
      var idUsed = {};
      var accChar = 0;          // 全文字符游标（块 raw 累加）
      for (var bi = 0; bi < _blocks.length; bi++) {
        var raw = _blocks[bi].raw || "";
        var lines = raw.split("\n");
        var offInBlock = 0;
        var seenInBlock = Object.create(null);   // 块内同名去重（与渲染端同源）
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
          // 2026-11-24：id 与「渲染顺序」解耦 —— 以块下标 + 块内同名去重生成，
          // 分段/跳跃渲染时与 decorateBlock 结果一致，TOC 跳转才能命中。
          var dup = (seenInBlock[baseId] = (seenInBlock[baseId] || 0) + 1);
          var id = baseId + "-b" + bi + (dup > 1 ? "-" + (dup - 1) : "");
          outB.push({ level: level, kind: kind, text: text, id: id,
                      blockIndex: bi, lineIndex: li, offsetTop: 0, chars: 0,
                      charStart: accChar + offInBlock });
          offInBlock += ln.length + 1;
        }
        accChar += raw.length;
      }
      _totalRawLen = accChar;
      // 字数归属（2026-11-01 优化）：原先建完 outB 后再调 buildRawOffsetsFor
      // 重扫一遍全文，实测 256 条要 518ms。这里改为「已在扫描中记录过偏移」，
      // 直接线性推进算区间，整体 O(n)，不再二次遍历原文。
      var totalB = _totalRawLen;
      for (var a2 = 0; a2 < outB.length; a2++) {
        if (outB[a2].kind !== "chapter") continue;
        var s2 = outB[a2].charStart != null ? outB[a2].charStart : 0;
        var e2 = totalB;
        // 下一个「章或卷」的起点即本章终点（线性推进即可，无需每次从头找）
        for (var b2 = a2 + 1; b2 < outB.length; b2++) {
          if (outB[b2].kind === "chapter" || outB[b2].kind === "volume") {
            e2 = outB[b2].charStart != null ? outB[b2].charStart : totalB;
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
        // 不在渲染同步阶段读 offsetTop —— 刚 innerHTML 换完，DOM 是脏的，
        // 这一次读会触发全量布局（实测 786K 字符 ~450ms）。
        // 坐标统一由 remeasureOutline() 在 rAF 里、布局稳定后回填。
        offsetTop: 0,
        chars: 0,
      });
    }
    // 字数归属：chapter 取到下一章/卷之前；volume 汇总其子章。
    // 必须按「原文偏移」计算（含正文）——曾试过只累计标题文本长度，
    // 结果字数变成 788 而非实际值，属错误实现，已回退。
    // 性能由 structKind 的首字符预筛保证（见该函数注释）。
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
  // 标题 id → 块下标。2026-11-01 优化：原实现每次都全量扫描 _blocks（O(块×行)），
  // 而 currentSection / syncActive 在滚动时每帧都调它 —— 实测导致 buildOutline
  // 之后的高频调用把整体拖到 500ms 级。改为复用一次性构建的映射缓存。
  var _blockMapCache = null;
  var _blockMapStamp = -1;

  // 分块模式下：由标题 id 反查其所在块下标。已渲染的直接用 DOM 归属；
  // 未渲染的用大纲自带的 blockIndex（buildOutline 在分块模式已写入）。
  // 修前走 buildOutlineBlockMap 的「按标题文本匹配」，同名章会命中第一次出现的位置，
  // 跳转落错块（2026-11-24 实测 100MB 跳最后一章落到 410K px 处）。
  var _outlineIdx = null, _outlineIdxFor = null;

  function outlineBlockIndex(id) {
    if (!id || !_blocks.length) return -1;
    // 已渲染的标题：直接从 DOM 归属取块下标（最快，且总是最新）
    var el = document.getElementById(id);
    if (el) {
      var node = el;
      while (node && node.parentNode !== readerEl) node = node.parentNode;
      for (var q = _segStart; q < _segEnd; q++) {
        if (_blocks[q].el === node) return q;
      }
    }
    if (_outlineIdxFor !== MDV.outline) {
      _outlineIdx = Object.create(null);
      for (var k = 0; k < (MDV.outline || []).length; k++) {
        var o = MDV.outline[k];
        if (o && o.id && typeof o.blockIndex === "number" && o.blockIndex >= 0) {
          _outlineIdx[o.id] = o.blockIndex;
        }
      }
      _outlineIdxFor = MDV.outline;
    }
    var hit = _outlineIdx[id];
    return hit === undefined ? -1 : hit;
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
      var segBase = _prefix[_segStart] || 0;
      var bi = ready ? blockAtY(readerEl.scrollTop + segBase + 24) : 0;
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
      var totalH = _prefix[_blocks.length] || 0;
      var absY = segBase + readerEl.scrollTop;
      var pctS = totalH > 0
        ? Math.min(100, Math.round(absY / Math.max(1, totalH) * 100)) : 0;
      return { volume: vTxt, chapter: cTxt, percent: pctS,
               volumeId: vId, chapterId: cId };
    }

    // 第一步：游标位置 = 最后一个 offsetTop 已越过的条目
    var cur = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetTop - 24 <= top) cur = i; else break;
    }
    // 第二步：卷 → 填卷；章 → 填章并回溯卷；标题(heading) → 不计为章，仅回溯卷
    // （2026-11-02：纯文本小说提升的书名 h1 是 heading，修前被当成「章」上报）
    var vol = "", chap = "", volId = null, chapId = null;
    // 视口在首个标题之上（滚动顶部留白）时，视为全文开头 → 回落到第一条
    if (cur < 0 && list.length) cur = 0;
    if (cur >= 0) {
      if (list[cur].kind === "volume") {
        vol = list[cur].text; volId = list[cur].id;
      } else if (list[cur].kind === "chapter") {
        chap = list[cur].text; chapId = list[cur].id;
        for (var j = cur; j >= 0; j--) {
          if (list[j].kind === "volume") {
            vol = list[j].text; volId = list[j].id; break;
          }
        }
      } else {
        // kind === "heading"：书名/文档标题，不是章；只回溯最近卷
        for (var j2 = cur; j2 >= 0; j2--) {
          if (list[j2].kind === "volume") {
            vol = list[j2].text; volId = list[j2].id; break;
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
      // 分段模式：目标不在当前段 → 先把目标所在段挂上来
      if (bi < _segStart || bi >= _segEnd) renderSegment(Math.max(0, bi - 60));
      if (!_blocks[bi].rendered) advanceRenderTowards(bi);
      var el2 = document.getElementById(id);
      if (!el2 && _blocks[bi].el) {
        // 兜底：id 规则在极端文本下可能与渲染端不一致，按块内标题文本定位
        var base = id.split("-b")[0];
        var hs = _blocks[bi].el.querySelectorAll("h1,h2,h3,h4,h5,h6");
        for (var h = 0; h < hs.length; h++) {
          if (slug(hs[h].textContent || "") === base) { el2 = hs[h]; break; }
        }
      }
      if (!el2 && _blocks[bi].el) {
        // 再兜底：该行没有被渲染成标题（混合 markdown 的文本会跳过提升）——
        // 按大纲记录的行号在块内做比例定位，至少落回正确位置附近
        var entry = null;
        for (var e2 = 0; e2 < (MDV.outline || []).length; e2++) {
          if (MDV.outline[e2].id === id) { entry = MDV.outline[e2]; break; }
        }
        var wrapEl = _blocks[bi].el;
        var totalLines = (_blocks[bi].raw || "").split("\n").length;
        var frac = (entry && totalLines > 1)
          ? Math.min(1, Math.max(0, entry.lineIndex / totalLines)) : 0;
        var bh = wrapEl.getBoundingClientRect().height;
        readerEl.scrollTop = Math.max(0, wrapEl.offsetTop + frac * bh - 24);
        return true;
      }
      if (el2) { readerEl.scrollTop = Math.max(0, el2.offsetTop - 24); return true; }
      // 兜底：用前缀和（减去当前段起点，scrollTop 是段内坐标）
      readerEl.scrollTop = Math.max(0, _prefix[bi] - (_prefix[_segStart] || 0) - 24);
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
    // 计划 3.6（specs/03 R-03-09 不变量④）：分块模式下用「前缀和 + 二分」反查，
    // 全量模式用「offsetTop 快照 + 线性」——两条路径都只做一次布局读取。
    // 旧实现在循环条件里逐个读 offsetTop，3955 标题触发 3955 次强制布局（570ms）。
    var top = readerEl.scrollTop;
    var best = null;

    if (_blocks.length) {
      // 分块：先由前缀和二分定位块，再在该块内找最后一个已越过的标题
      var bi = blockAtY(top + 24);
      var list = ensureOutline();
      for (var q = 0; q < list.length; q++) {
        var pos = list[q].blockIndex;
        if (pos == null) pos = outlineBlockIndex(list[q].id);
        if (pos < 0) continue;
        if (pos > bi) break;
        var el = list[q].id ? document.getElementById(list[q].id) : null;
        if (el) best = el;
      }
      // 回退：若目标块内的标题未渲染，best 可能落后一块，用 DOM 兜底补齐
      if (!best || best.offsetTop - 24 > top) {
        var hs0 = readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6");
        var tops0 = new Array(hs0.length);
        for (var k0 = 0; k0 < hs0.length; k0++) tops0[k0] = hs0[k0].offsetTop;
        for (var i0 = 0; i0 < hs0.length; i0++) {
          if (tops0[i0] - 24 <= top) best = hs0[i0];
          else break;
        }
      }
    } else {
      var hs = readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6");
      // 一次性取快照（单次布局），再在数组上比较
      var tops = new Array(hs.length);
      for (var k = 0; k < hs.length; k++) tops[k] = hs[k].offsetTop;
      for (var i = 0; i < hs.length; i++) {
        if (tops[i] - 24 <= top) best = hs[i];
        else break;
      }
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

})();
