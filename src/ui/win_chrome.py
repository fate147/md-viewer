# -*- coding: utf-8 -*-
"""窗口外壳增强（Win32/DWM）：第二/三期。

职责（specs/01 R-01-07 / specs/00 应用外壳视觉法）：
- 去掉系统标题栏（保留 WS_THICKFRAME → 系统缩放/贴边/阴影/无障碍仍在）；
- DwmExtendFrameIntoClientArea 让客户区覆盖标题栏区域，标题栏由页面自绘；
- 深色标题栏 DWMWA_USE_IMMERSIVE_DARK_MODE（Win10 1809+）；
- Win11 22H2+：系统圆角 + 可选 Mica；Win10：SetWindowRgn 自绘圆角近似；
- 拖动窗口（HTCAPTION）、最小化/最大化/关闭、系统亮暗检测。

所有 ctypes 调用均 try/except 包裹：任何失败静默降级，绝不影响启动。
"""

from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes

_user32 = ctypes.windll.user32
_dwmapi = ctypes.windll.dwmapi
_gdi32 = ctypes.windll.gdi32

GWL_STYLE = -16
WS_CAPTION = 0x00C00000
WS_THICKFRAME = 0x00040000
WS_BORDER = 0x00800000
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_FRAMECHANGED = 0x0020
WM_NCLBUTTONDOWN = 0x00A1
HTCAPTION = 2

DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_WINDOW_CORNER_PREFERENCE = 33
DWMWA_SYSTEMBACKDROP_TYPE = 38
DWMWCP_ROUND = 2
DWMSBT_MAINWINDOW = 2   # Mica

try:
    _GetWindowLongPtr = _user32.GetWindowLongPtrW
    _GetWindowLongPtr.restype = ctypes.c_ssize_t
    _GetWindowLongPtr.argtypes = [wintypes.HWND, ctypes.c_int]
    _SetWindowLongPtr = _user32.SetWindowLongPtrW
    _SetWindowLongPtr.restype = ctypes.c_ssize_t
    _SetWindowLongPtr.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
except AttributeError:            # 32 位兜底
    _GetWindowLongPtr = _user32.GetWindowLongW
    _SetWindowLongPtr = _user32.SetWindowLongW


class _Margins(ctypes.Structure):
    _fields_ = [("cLeft", ctypes.c_int), ("cRight", ctypes.c_int),
                ("cTop", ctypes.c_int), ("cBottom", ctypes.c_int)]


def win_build() -> int:
    try:
        return sys.getwindowsversion().build
    except Exception:
        return 0


def is_win11() -> bool:
    return win_build() >= 22000


def system_is_dark() -> bool:
    """读注册表判断系统应用亮暗（AppsUseLightTheme=0 → 深色）。"""
    try:
        import winreg
        k = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        v, _ = winreg.QueryValueEx(k, "AppsUseLightTheme")
        return int(v) == 0
    except Exception:
        return False


def _hwnd(root) -> int:
    """取真正的顶层窗口句柄（必须映射后再取）。

    Tk 的 winfo_id 是内层子窗口；真正带系统标题栏的是外层 wrapper。
    用 GetAncestor(GA_ROOT) 上溯；若返回自身再退回 GetParent。
    注意：窗口未映射时 GA_ROOT 可能返回 0 —— 故 apply 必须在映射后调用。
    """
    try:
        h = root.winfo_id()
        r = _user32.GetAncestor(wintypes.HWND(h), 2)  # GA_ROOT
        if not r or r == h:
            p = _user32.GetParent(wintypes.HWND(h))
            if p:
                r = p
        return r or h
    except Exception:
        return 0


def _set_dwm(hwnd: int, attr: int, value: int) -> None:
    try:
        v = ctypes.c_int(value)
        _dwmapi.DwmSetWindowAttribute(wintypes.HWND(hwnd), attr,
                                      ctypes.byref(v), ctypes.sizeof(v))
    except Exception:
        pass


def _resolve_dark(ui_theme: str) -> bool:
    if ui_theme == "dark":
        return True
    if ui_theme == "light":
        return False
    return system_is_dark()


def resolve_dark(ui_theme: str) -> bool:
    """公开：按 ui_theme(system|light|dark) 解析是否深色外壳。"""
    return _resolve_dark(ui_theme)


_BRUSHES = []   # 防 GDI 刷子被回收


def set_class_bg(hwnd: int, color_hex: str) -> None:
    """把窗口类背景刷子设为主题背景色，使窗口边缘那一圈"无颜色/白色"补满主题色。

    Tk 顶层 wrapper 的边缘由窗口类背景刷子（默认系统白）填充；改类刷子即可
    让它与主题一致，消除突兀的外圈（2026-11-02 用户反馈定位）。
    """
    try:
        h = (color_hex or "").lstrip("#")
        if len(h) != 6:
            return
        r = int(h[0:2], 16); gg = int(h[2:4], 16); b = int(h[4:6], 16)
        colorref = r | (gg << 8) | (b << 16)   # COLORREF = 0x00BBGGRR
        _gdi32.CreateSolidBrush.restype = wintypes.HBRUSH
        _gdi32.CreateSolidBrush.argtypes = [ctypes.c_uint32]
        brush = _gdi32.CreateSolidBrush(colorref)
        if not brush:
            return
        _BRUSHES.append(brush)                 # 保持引用
        _user32.SetClassLongPtrW.restype = ctypes.c_ssize_t
        _user32.SetClassLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
        _user32.SetClassLongPtrW(wintypes.HWND(hwnd), -10, ctypes.c_ssize_t(brush))
        # RDW_INVALIDATE|RDW_ERASE|RDW_ALLCHILDREN
        _user32.RedrawWindow(wintypes.HWND(hwnd), None, None, 0x0001 | 0x0004 | 0x0080)
    except Exception:
        pass


def apply_custom(root, ui_theme: str = "system", content_dark: bool = False,
                 bg_hex: str | None = None) -> int:
    """去标题栏 + 扩展边框 + 深色标题栏/边框 + 平台圆角/Mica。返回 hwnd。"""
    hwnd = _hwnd(root)
    if not hwnd:
        return 0
    try:
        style = _GetWindowLongPtr(hwnd, GWL_STYLE)
        # 去掉标题栏 + 可缩放边框 + 边框：让客户区铺满整窗（主题底色到边，无白色/黑色边框圈）
        # 注：代价是失去“拖边缘缩放/贴边吸附”（最大化/最小化/关闭仍可用）。
        style = int(style) & ~WS_CAPTION & ~WS_THICKFRAME & ~0x00800000
        _SetWindowLongPtr(hwnd, GWL_STYLE, style)
        m = _Margins(-1, -1, -1, -1)
        _dwmapi.DwmExtendFrameIntoClientArea(wintypes.HWND(hwnd), ctypes.byref(m))
        _user32.SetWindowPos(wintypes.HWND(hwnd), 0, 0, 0, 0, 0,
                             SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED)
    except Exception:
        pass
    root._mdv_hwnd = hwnd
    if bg_hex:
        set_class_bg(hwnd, bg_hex)
    refresh_theme(root, ui_theme, content_dark)
    return hwnd


def refresh_theme(root, ui_theme: str = "system", content_dark: bool = False) -> None:
    """亮暗/材质随 ui_theme 或内容主题更新（不重建窗口）。

    关键：Win10 下可缩放窗口的 DWM 边框默认是白色；深色内容主题（midnight）
    必须强制深色边框，否则出现一圈白边（2026-11-02 真实截图定位）。
    """
    hwnd = getattr(root, "_mdv_hwnd", 0) or _hwnd(root)
    if not hwnd:
        return
    root._mdv_hwnd = hwnd
    dark = bool(content_dark) or _resolve_dark(ui_theme)
    root._mdv_dark = dark
    _set_dwm(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, 1 if dark else 0)
    if is_win11():
        _set_dwm(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND)
        # Mica 仅 Win11 22H2+；深色/亮色都可用，失败静默
        if win_build() >= 22621:
            _set_dwm(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_MAINWINDOW)


def apply_round_region(root) -> None:
    """圆角已按用户要求取消（去边框铺满主题色），此处直接返回。"""
    return


def drag(root) -> None:
    """拖动窗口：等价按住标题栏（不阻塞，交给系统移动循环）。"""
    hwnd = getattr(root, "_mdv_hwnd", 0) or _hwnd(root)
    try:
        _user32.ReleaseCapture()
        _user32.PostMessageW(wintypes.HWND(hwnd), WM_NCLBUTTONDOWN, HTCAPTION, 0)
    except Exception:
        pass


def minimize(root) -> None:
    try:
        root.iconify()
    except Exception:
        pass


def is_maximized(root) -> bool:
    # 以 Tk 自身状态为准（比 IsZoomed(hwnd) 稳；Tk 的 winfo_id 常为子窗口）
    try:
        return root.state() == "zoomed"
    except Exception:
        return False


def toggle_maximize(root) -> None:
    try:
        root.state("normal" if root.state() == "zoomed" else "zoomed")
    except Exception:
        pass
