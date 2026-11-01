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

  MDV.renderReader = function (text, baseDirUrl) {
    marked.use({ gfm: true, breaks: true });
    readerEl.innerHTML = marked.parse(promoteStructuredHeadings(text || ""));

    var used = {};
    var headings = readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6");
    headings.forEach(function (h) {
      var id = slug(h.textContent || "");
      var n = (used[id] = (used[id] || 0) + 1);
      if (n > 1) id = id + "-" + (n - 1);
      h.id = id;
      var kind = structKind((h.textContent || "").trim());
      if (kind) h.setAttribute("data-kind", kind);
    });

    // 相对图片：单页应用没有 <base>，渲染后改写为文件绝对 URL
    if (baseDirUrl) {
      readerEl.querySelectorAll("img").forEach(function (img) {
        var src = img.getAttribute("src") || "";
        if (src && !/^(file|https?|data):/i.test(src)) {
          try { img.src = new URL(src, baseDirUrl).href; } catch (e) {}
        }
      });
    }

    var blocks = readerEl.querySelectorAll("pre code");
    var lim = Math.min(blocks.length, HL_CAP);
    for (var i = 0; i < lim; i++) {
      try { hljs.highlightElement(blocks[i]); } catch (e) {}
    }

    enhanceCodeBlocks();
  };

  // ---------------- 大纲索引（v3.1 阶段 2 / specs/03 R-03-10） ----------------
  // 唯一数据源：目录侧栏、状态栏位置、章间跳转只读本索引，禁止各自重算标题。
  // 输出 [{ level, kind, text, id, blockIndex, offsetTop, chars }]
  //   kind: volume | chapter | heading ；chars = 本章/卷正文字符数
  MDV.outline = [];

  function isVolume(el) { return el.getAttribute("data-kind") === "volume"; }
  function isChapter(el) { return el.getAttribute("data-kind") === "chapter"; }

  MDV.buildOutline = function () {
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
    // 字数归属：chapter 取到下一个 chapter/volume 之前；volume 汇总其子章
    var total = (readerEl.textContent || "").length;
    for (var a = 0; a < out.length; a++) {
      if (out[a].kind !== "chapter") continue;
      var end = a + 1 < out.length ? out[a + 1].blockIndex : -1;
      var startPos = headingPos(out[a].id);
      var endPos = end >= 0 ? headingPos(out[end].id) : total;
      out[a].chars = Math.max(0, endPos - startPos);
    }
    // offsetTop 在首次渲染时可能全为 0（布局未完成）；用 _measured 记录，
    // currentSection / jumpChapter 读取前会惰性重测（见 ensureOutline）。
    MDV.outline = out;
    MDV._outlineMeasured = out.length > 0 && out.some(function (o) { return o.offsetTop > 0; });
    return out;
  };

  // 用 id 反查该标题在全文中的字符起点（供字数归属用）
  function headingPos(id) {
    var el = id ? document.getElementById(id) : null;
    if (!el) return 0;
    // 标题前所有已渲染内容的文本长度（用 Range 累计）
    try {
      var r = document.createRange();
      r.setStart(readerEl, 0);
      r.setEndBefore(el);
      return r.toString().length;
    } catch (e) { return el.offsetTop; }
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
  MDV.remeasureOutline = function () {
    if (!MDV.outline || !MDV.outline.length) return MDV.outline;
    for (var i = 0; i < MDV.outline.length; i++) {
      var el = MDV.outline[i].id ? document.getElementById(MDV.outline[i].id) : null;
      if (el) MDV.outline[i].offsetTop = el.offsetTop;
    }
    MDV._outlineMeasured = MDV.outline.some(function (o) { return o.offsetTop > 0; });
    return MDV.outline;
  };

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
    readerEl.scrollTop = Math.max(0, list[target].offsetTop - 24);
    return true;
  };

  // 滚到指定 id（TOC 点击）
  MDV.scrollToHeading = function (id) {
    var el = id ? document.getElementById(id) : null;
    if (!el) return false;
    readerEl.scrollTop = Math.max(0, el.offsetTop - 24);
    return true;
  };

  // 代码块增强：语言标签 + 悬浮复制按钮（借鉴 GitHub / Typora）
  function enhanceCodeBlocks() {
    readerEl.querySelectorAll("pre").forEach(function (pre) {
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
    var el = h ? document.getElementById(
      h.index > 0 ? h.slug + "-" + h.index : h.slug) : null;
    readerEl.scrollTop = el ? Math.max(0, el.offsetTop - 24) : 0;
  };

  // 阅读 → 编辑：视口顶部最近的标题对应到编辑器行号（1 起）
  MDV.anchorLineFromReader = function (docText) {
    var top = readerEl.scrollTop;
    var best = null;
    var hs = readerEl.querySelectorAll("h1,h2,h3,h4,h5,h6");
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].offsetTop - 24 <= top) best = hs[i];
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
    var max = readerEl.scrollHeight - readerEl.clientHeight;
    return max > 0 ? readerEl.scrollTop / max : 0;
  };
})();
