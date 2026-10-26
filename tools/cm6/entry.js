// CodeMirror 6 离线打包入口。
// 产出 IIFE bundle，挂 window.MDVC；app.js 只依赖这个全局对象。
// 重建方式：cd tools/cm6 && npm install && npm run build
import { EditorView, keymap, lineNumbers, highlightActiveLine,
         highlightActiveLineGutter, drawSelection, dropCursor,
         rectangularSelection, crosshairCursor, highlightSpecialChars,
         ViewPlugin, Decoration } from "@codemirror/view";
import { EditorState, Compartment, RangeSetBuilder } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, undo, redo,
         indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel,
         closeSearchPanel, selectNextOccurrence } from "@codemirror/search";
import { bracketMatching, foldGutter, indentOnInput,
         syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";

window.MDVC = {
    EditorView, EditorState, keymap, Compartment,
    defaultKeymap, history, historyKeymap, undo, redo, indentWithTab,
    searchKeymap, highlightSelectionMatches, openSearchPanel,
    closeSearchPanel, selectNextOccurrence,
    bracketMatching, foldGutter, indentOnInput,
    syntaxHighlighting, HighlightStyle, tags,
    ViewPlugin, Decoration, RangeSetBuilder,
    markdown, markdownLanguage, basicSetup,
    highlightSpecialChars, drawSelection, dropCursor,
    rectangularSelection, crosshairCursor,
    highlightActiveLine, highlightActiveLineGutter, lineNumbers,
};
