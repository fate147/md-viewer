# -*- coding: utf-8 -*-
"""导出服务（services）：渲染后导出独立可用 HTML（F06）。

2026-10-11 重构：渲染管线统一走 marked.js（与阅读层同源）。旧实现依赖
core.markdown_render（tkinterweb 路径，已退役）。本模块自包含：资产内联，
写出的 .html 双击即可在浏览器打开，无任何运行时依赖。
"""

from __future__ import annotations

import json
from pathlib import Path

from core import fileio, theme

_ASSET_CACHE: dict[str, str] = {}


def _assets() -> Path:
    from ui.web_client import assets_dir
    return assets_dir()


def _read_asset(name: str) -> str:
    if name not in _ASSET_CACHE:
        _ASSET_CACHE[name] = (_assets() / name).read_text(encoding="utf-8")
    return _ASSET_CACHE[name]


_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN" data-hljs="@@HLJSATTR@@">
<head>
<meta charset="utf-8">
<title>@@TITLE@@</title>
<style>
@@THEME_CSS@@
</style>
<style>
@@HLJS_CSS@@
</style>
</head>
<body>
<div id="md-body"></div>
<script>@@MARKED@@</script>
<script>@@HLJS@@</script>
<script>
(function () {
  var src = @@SOURCE@@;
  function slug(s) {
    s = s.trim().replace(/[^\\w\\u4e00-\\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
    return s.toLowerCase() || "section";
  }
  marked.use({gfm: true, breaks: true});
  document.getElementById("md-body").innerHTML = marked.parse(src);
  var used = {};
  document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(function (h) {
    var id = slug(h.textContent || "");
    var n = (used[id] = (used[id] || 0) + 1);
    if (n > 1) id = id + "-" + (n - 1);
    h.id = id;
  });
  var blocks = document.querySelectorAll("pre code");
  var lim = Math.min(blocks.length, 500);
  for (var i = 0; i < lim; i++) {
    try { hljs.highlightElement(blocks[i]); } catch (e) {}
  }
})();
</script>
</body>
</html>"""


def to_html(md_text: str, theme_id: str, out_path: str | Path) -> str:
    """导出带主题样式的独立 HTML 文件，返回写入路径。"""
    hljs_css = ("hljs-dark.min.css" if theme_id == "midnight"
                else "hljs-light.min.css")
    title = "Document"
    for line in (md_text or "").splitlines():
        s = line.strip()
        if s.startswith("#"):
            title = s.lstrip("#").strip() or title
            break
    html = _TEMPLATE
    for token, value in (
        ("@@TITLE@@", title),
        ("@@HLJSATTR@@", "dark" if theme_id == "midnight" else "light"),
        ("@@THEME_CSS@@", theme.preview_css(theme_id)),
        ("@@HLJS_CSS@@", _read_asset(hljs_css)),
        ("@@MARKED@@", _read_asset("marked.min.js")),
        ("@@HLJS@@", _read_asset("highlight.min.js")),
        ("@@SOURCE@@", json.dumps(md_text or "", ensure_ascii=False)
         .replace("</", "<\\/")),
    ):
        html = html.replace(token, value, 1)
    fileio.write(out_path, html, "utf-8")
    return str(out_path)
