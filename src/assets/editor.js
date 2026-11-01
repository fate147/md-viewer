// 编辑层（editor.js）：CodeMirror 6 markdown 源码编辑。
// 依赖 cm6.bundle.js 暴露的 window.MDVC；配色全部走 CSS 变量，
// 因此主题/字号切换由 app.js 改变量即可，无需重建视图。
// 多标签 = 每个 tab 一份 EditorState，切换时 view.setState()，
// 撤销历史随状态天然隔离。
(function () {
  "use strict";
  var C = window.MDVC;
  var MDV = (window.MDV = window.MDV || {});

  // markdown 语法配色：标题分级放大（Obsidian 风格），颜色走主题变量
  var mdHighlight = C.HighlightStyle.define([
    { tag: C.tags.heading1, color: "var(--heading)", fontWeight: "700", fontSize: "1.5em" },
    { tag: C.tags.heading2, color: "var(--heading)", fontWeight: "700", fontSize: "1.3em" },
    { tag: C.tags.heading3, color: "var(--heading)", fontWeight: "700", fontSize: "1.15em" },
    { tag: C.tags.heading4, color: "var(--heading)", fontWeight: "600" },
    { tag: C.tags.heading5, color: "var(--muted)", fontWeight: "600" },
    { tag: C.tags.heading6, color: "var(--muted)", fontWeight: "600" },
    { tag: C.tags.strong, fontWeight: "700", color: "var(--heading)" },
    { tag: C.tags.emphasis, fontStyle: "italic" },
    { tag: C.tags.link, color: "var(--accent)" },
    { tag: C.tags.url, color: "var(--muted)" },
    { tag: C.tags.monospace, fontFamily: "Cascadia Mono, Consolas, monospace" },
    { tag: C.tags.quote, color: "var(--muted)", fontStyle: "italic" },
    { tag: C.tags.list, color: "var(--accent)" },
    { tag: C.tags.meta, color: "var(--muted)" },
    { tag: C.tags.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  ]);

  var edTheme = C.EditorView.theme({
    "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--fg)" },
    ".cm-content": { caretColor: "var(--caret)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--caret)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "var(--select)" },
    ".cm-gutters": { display: "none" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-selectionMatch": { backgroundColor: "var(--select)" },
    ".cm-searchMatch": { backgroundColor: "var(--select)", outline: "1px solid var(--accent)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent)" },
    ".cm-panels": { backgroundColor: "var(--pre-bg)", color: "var(--fg)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
    ".cm-textfield": {
      backgroundColor: "var(--bg)", color: "var(--fg)",
      border: "1px solid var(--border)", borderRadius: "4px",
    },
    ".cm-button": {
      backgroundColor: "var(--btn-bg)", color: "var(--btn-fg)",
      border: "none", borderRadius: "4px",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--code-bg)", color: "var(--code-fg)", border: "none",
    },
  });

  // 卷/章行整行加粗（与阅读层的结构识别同源，见 reader.js 的 STRUCT_RES）。
  // 只扫可视区（ViewPlugin 惯例），2.3MB 小说无压力。
  function buildStructDecos(view) {
    var b = new C.RangeSetBuilder();
    var ranges = view.visibleRanges;
    for (var r = 0; r < ranges.length; r++) {
      var pos = ranges[r].from;
      var to = ranges[r].to;
      while (pos <= to) {
        var line = view.state.doc.lineAt(pos);
        var kind = window.MDV.structKindOf(line.text);
        if (kind) {
          b.add(line.from, line.from,
                C.Decoration.line({ class: kind === "volume" ? "cm-vol-line" : "cm-chap-line" }));
        }
        if (line.to >= to) break;
        pos = line.to + 1;
      }
    }
    // v3.1 修复：RangeSetBuilder.finish() 已返回 RangeSet，
    // 再包一层 Decoration.set() 会被当成可迭代对象展开 → "object is not iterable"。
    // 该 bug 原先因首屏极少命中卷/章行而未暴露；R-03-13 扩充词表后（楔子/尾声）必然触发。
    return b.finish();
  }

  function StructDeco(view) { this.decos = buildStructDecos(view); }
  StructDeco.prototype.update = function (u) {
    if (u.docChanged || u.viewportChanged) this.decos = buildStructDecos(u.view);
  };

  function buildExtensions(onUpdate) {
    return [
      edTheme,
      C.syntaxHighlighting(mdHighlight),
      C.ViewPlugin.fromClass(StructDeco, { decorations: function (v) { return v.decos; } }),
      C.markdown({ base: C.markdownLanguage, addKeymap: true }),
      C.highlightSpecialChars(),
      C.history(),
      C.drawSelection(),
      C.dropCursor(),
      C.EditorState.allowMultipleSelections.of(true),
      C.highlightSelectionMatches(),
      C.indentOnInput(),
      C.bracketMatching(),
      C.rectangularSelection(),
      C.crosshairCursor(),
      C.highlightActiveLine(),
      C.keymap.of([
        { key: "F2", run: function () { MDV.toggleMode(); return true; } },
        { key: "Mod-h", run: function () { C.openSearchPanel(MDV.view); return true; } },
        ...C.searchKeymap,
        ...C.historyKeymap,
        ...C.defaultKeymap,
        C.indentWithTab,
      ]),
      C.EditorView.lineWrapping,
      C.EditorView.updateListener.of(function (u) {
        if (u.docChanged || u.selectionSet) onUpdate(u);
      }),
    ];
  }

  // 整个应用只有一个 EditorView，多标签靠换 EditorState
  MDV.createEditor = function (host, onUpdate) {
    MDV._extensions = buildExtensions(onUpdate);
    MDV.view = new C.EditorView({
      state: C.EditorState.create({ doc: "", extensions: MDV._extensions }),
      parent: host,
    });
    return MDV.view;
  };

  // 由文本创建可切换的标签状态（切标签时 view.setState(it)）
  MDV.stateFromDoc = function (text) {
    return C.EditorState.create({ doc: text, extensions: MDV._extensions });
  };
})();
