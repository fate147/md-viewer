#!/usr/bin/env python3
"""把渲染好的多尺寸 PNG 合成 Windows .ico（纯标准库，无 Pillow 依赖）。

用法：python tools/icon/build_ico.py <png目录> <输出.ico>
约定：目录内文件名 icon-{16,24,32,48,64,128,256}.png。
≤128 写成经典 32bpp BMP-DIB 条目（老加载器也认），256 直接内嵌 PNG。
PNG 由 headless Edge 从 installer/assets/md-editor-icon-dark*.svg 渲染得到
（深色版；16–48px 用 -small 简化版）。
"""
import struct
import sys
import zlib
from pathlib import Path

SIZES = (16, 24, 32, 48, 64, 128, 256)


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def decode_png(data: bytes) -> tuple[int, int, bytearray]:
    """解 8bit RGBA/RGB/灰度 PNG，返回 (w, h, RGBA 像素)。"""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    pos, idat, w, h, depth, ctype = 8, b"", 0, 0, 8, 6
    while pos < len(data):
        ln, typ = struct.unpack_from(">I4s", data, pos)
        body = data[pos + 8: pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and not struct.unpack(">B", body[12:13])[0], "只支持 8bit 非隔行"
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
    channels = {0: 1, 4: 2, 2: 3, 6: 4}[ctype]
    raw = zlib.decompress(idat)
    stride = w * channels
    px = bytearray(h * stride)
    for y in range(h):
        off = y * (stride + 1)
        ft, line = raw[off], bytearray(raw[off + 1: off + 1 + stride])
        prev = px[(y - 1) * stride: y * stride] if y else bytearray(stride)
        if ft == 1:
            for i in range(stride):
                line[i] = (line[i] + (line[i - channels] if i >= channels else 0)) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                c = prev[i - channels] if i >= channels else 0
                line[i] = (line[i] + _paeth(a, prev[i], c)) & 0xFF
        px[y * stride: (y + 1) * stride] = line
    if channels == 4:
        return w, h, px
    out = bytearray(w * h * 4)
    for i in range(w * h):
        s = i * channels
        if channels == 1:
            out[i * 4: i * 4 + 4] = bytes([px[s]] * 3 + [255])
        elif channels == 2:
            out[i * 4: i * 4 + 4] = bytes([px[s]] * 3 + [px[s + 1]])
        else:
            out[i * 4: i * 4 + 4] = bytes(px[s:s + 3]) + b"\xff"
    return w, h, out


def as_bmp_entry(rgba: bytearray, size: int) -> bytes:
    """RGBA → ICO 里的 32bpp BGRA DIB（自底向上）+ 全 0 AND 掩码。"""
    rows = []
    for y in range(size - 1, -1, -1):
        row = rgba[y * size * 4: (y + 1) * size * 4]
        out = bytearray(len(row))
        out[0::4], out[1::4], out[2::4], out[3::4] = row[2::4], row[1::4], row[0::4], row[3::4]
        rows.append(bytes(out))
    mask_pad = ((size + 31) // 32) * 4
    header = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0,
                         size * size * 4, 0, 0, 0, 0)
    return header + b"".join(rows) + b"\x00" * mask_pad * size


def build(png_dir: Path, dest: Path) -> None:
    entries = []
    for n in SIZES:
        f = png_dir / f"icon-{n}.png"
        if not f.exists():
            continue
        w, h, rgba = decode_png(f.read_bytes())
        assert (w, h) == (n, n), f"{f.name} 实际 {w}x{h}"
        if n == 256:
            entries.append((n, f.read_bytes()))
        else:
            entries.append((n, as_bmp_entry(rgba, n)))
    assert entries, f"{png_dir} 下没有 icon-*.png"

    count = len(entries)
    body_off = 6 + 16 * count
    head, images = struct.pack("<HHH", 0, 1, count), b""
    for n, blob in entries:
        wh = 0 if n >= 256 else n
        head += struct.pack("<BBBBHHII", wh, wh, 0, 0, 1, 32, len(blob), body_off)
        body_off += len(blob)
        images += blob
    dest.write_bytes(head + images)
    print(f"OK {dest} ({dest.stat().st_size} bytes, {count} sizes: "
          f"{','.join(str(n) for n, _ in entries)})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    build(Path(sys.argv[1]), Path(sys.argv[2]))
