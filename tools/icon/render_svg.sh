#!/usr/bin/env bash
# 把 installer/assets/mdviewer-icon*.svg 渲染成 ICO 用的多尺寸透明 PNG。
# 光栅器用本机 Edge headless（零依赖；不需要装 Inkscape/ImageMagick）。
# 尺寸分流（2026-10-31）：16/24/32/48px 用 mdviewer-icon-small.svg（笔画加粗、M 缩到极限），
#   64px 起用 mdviewer-icon.svg 主版——单张 svg 通吃会让井号在 16px 只剩 0.8px 笔画而糊掉，
#   主版在 48px 的 M 也只剩一个蓝点，故 48 一并归入简化版。
# 用法：bash tools/icon/render_svg.sh [输出目录]   （默认 %TEMP%\mdv-icon）
# 之后：python tools/icon/build_ico.py <输出目录> installer/assets/mdviewer.ico
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-${LOCALAPPDATA:-/tmp}/mdv-icon}"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
[ -x "$EDGE" ] || EDGE="/c/Program Files/Google/Chrome/Application/chrome.exe"
win() { cygpath -w "$1" | sed 's|\\|/|g'; }
SVG="file:///$(win "$ROOT/installer/assets/mdviewer-icon.svg")"
SVG_SMALL="file:///$(win "$ROOT/installer/assets/mdviewer-icon-small.svg")"
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
