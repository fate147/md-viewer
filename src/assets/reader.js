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
  MDV.STRUCT_RES = [
    { re: new RegExp("^第[" + NUM + "]+\\s*[卷部]"), kind: "volume" },   // 第一卷：
    { re: new RegExp("^第[" + NUM + "]+\\s*[章节回]"), kind: "chapter" }, // 第一章：
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
