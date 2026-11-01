#!/usr/bin/env bash
# 把 installer/assets/md-editor-icon-dark*.svg 渲染成 ICO 用的多尺寸透明 PNG。
# 光栅器用本机 Edge headless（零依赖；不需要装 Inkscape/ImageMagick）。
# 统一使用**深色版**（2026-11-02 用户指定）：#1A1B1E 底 + 浅色 M + 亮蓝 D。
# 尺寸分流：16/24/32/48px 用 md-editor-icon-dark-small.svg（笔画加粗、D 镂空孔放大），
#   64px 起用 md-editor-icon-dark.svg 主版——单张 svg 通吃会让 M/D 在小尺寸糊掉。
# 用法：bash tools/icon/render_svg.sh [输出目录]   （默认 %TEMP%\mdv-icon）
# 之后：python tools/icon/build_ico.py <输出目录> installer/assets/mdviewer.ico
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-${LOCALAPPDATA:-/tmp}/mdv-icon}"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
[ -x "$EDGE" ] || EDGE="/c/Program Files/Google/Chrome/Application/chrome.exe"
win() { cygpath -w "$1" | sed 's|\\|/|g'; }
SVG="file:///$(win "$ROOT/installer/assets/md-editor-icon-dark.svg")"
SVG_SMALL="file:///$(win "$ROOT/installer/assets/md-editor-icon-dark-small.svg")"
mkdir -p "$OUT"
for N in 16 24 32 48 64 128 256; do
  SRC="$SVG"; [ "$N" -le 48 ] && SRC="$SVG_SMALL"
  printf '<body style="margin:0"><img src="%s" width=%d height=%d>' "$SRC" $N $N > "$OUT/w-$N.html"
  "$EDGE" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=$N,$N --default-background-color=00000000 \
    --screenshot="$(cygpath -w "$OUT/icon-$N.png")" \
    "file:///$(win "$OUT/w-$N.html")" >/dev/null 2>&1
  [ -s "$OUT/icon-$N.png" ] || { echo "渲染失败：$N"; exit 1; }
done
rm -f "$OUT"/w-*.html
echo "OK $OUT（$(ls "$OUT"/icon-*.png | wc -l) 个尺寸）"
