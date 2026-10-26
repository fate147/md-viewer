"""
MD Viewer 默认程序自动注册模块（纯 Python 实现，无外部依赖）。

原理：Windows 10/11 的 UserChoice 受哈希保护，系统会用密钥的 LastWriteTime
重建哈希校验。本模块实现公开逆向出的「专利哈希」算法（WordSwap + Reversible，
MD5 作种子），直接生成合法的 UserChoice，从而在无任何弹窗、无管理员权限的
前提下把 .md 关联到 MD Viewer。
"""

import base64
import ctypes
import struct
import subprocess
import winreg

_MASK = 0xFFFFFFFF
_GUID_STR = "user choice set via windows user experience {d18b6dd5-6124-4341-9318-804003bafa0b}"


def _u(x):
    return x & _MASK


def _r32(data, off):
    return struct.unpack_from("<I", data, off)[0]


def _wordswap(a, sz, md5):
    o1 = 0
    o2 = 0
    ta = 0
    ts = sz
    ti = ((sz - 2) >> 1) + 1
    c0 = _u((_r32(md5, 0) | 1) + 0x69FB0000)
    c1 = _u((_r32(md5, 4) | 1) + 0x13DB0000)
    for _ in range(ti):
        n = _u(_r32(a, ta) + o1)
        ta += 8
        ts -= 2
        t = _u(_u(n * c0) - _u(0x10FA9605 * (n >> 16)))
        v1 = _u(_u(0x79F8A395 * t) + _u(0x689B6B9F * (t >> 16)))
        v2 = _u(_u(0xEA970001 * v1) - _u(0x3C101569 * (v1 >> 16)))
        v3 = _u(_r32(a, ta - 4) + v2)
        v4 = _u(_u(v3 * c1) - _u(0x3CE8EC25 * (v3 >> 16)))
        v5 = _u(_u(0x59C3AF2D * v4) - _u(0x2232E0F1 * (v4 >> 16)))
        o1 = _u(_u(0x1EC90001 * v5) + _u(0x35BD1EC9 * (v5 >> 16)))
        o2 = _u(o2 + o1 + v2)
    if ts == 1:
        n = _u(_r32(a, ta) + o1)
        t = _u(_u(n * c0) - _u(0x10FA9605 * (n >> 16)))
        inner = _u(_u(0x79F8A395 * t) + _u(0x689B6B9F * (t >> 16)))
        v2 = _u(_u(0xEA970001 * inner) - _u(0x3C101569 * (inner >> 16)))
        v3 = _u(_u(v2 * c1) - _u(0x3CE8EC25 * (v2 >> 16)))
        inner2 = _u(_u(0x59C3AF2D * v3) - _u(0x2232E0F1 * (v3 >> 16)))
        o1 = _u(_u(0x1EC90001 * inner2) + _u(0x35BD1EC9 * (inner2 >> 16)))
        o2 = _u(o2 + o1 + v2)
    return (o1, o2)


def _reversible(a, sz, md5):
    o1 = 0
    o2 = 0
    ta = 0
    ts = sz
    ti = ((sz - 2) >> 1) + 1
    c0 = _r32(md5, 0) | 1
    c1 = _r32(md5, 4) | 1
    for _ in range(ti):
        n = _u(_u(_r32(a, ta) + o1) * c0)
        n = _u(_u(0xB1110000 * n) - _u(0x30674EEF * (n >> 16)))
        ta += 8
        ts -= 2
        v1 = _u(_u(0x5B9F0000 * n) - _u(0x78F7A461 * (n >> 16)))
        inner = _u(_u(0x12CEB96D * (v1 >> 16)) - _u(0x46930000 * v1))
        v2 = _u(_u(0x1D830000 * inner) + _u(0x257E1D83 * (inner >> 16)))
        v3 = _u(_r32(a, ta - 4) + v2)
        v4 = _u(_u(_u(0x16F50000 * c1) * v3) - _u(0x5D8BE90B * (_u(c1 * v3) >> 16)))
        inner2 = _u(_u(0x96FF0000 * v4) - _u(0x2C7C6901 * (v4 >> 16)))
        v5 = _u(_u(0x2B890000 * inner2) + _u(0x7C932B89 * (inner2 >> 16)))
        o1 = _u(_u(0x9F690000 * v5) - _u(0x405B6097 * (v5 >> 16)))
        o2 = _u(o2 + o1 + v2)
    if ts == 1:
        n = _u(_r32(a, ta) + o1)
        v1 = _u(_u(_u(0xB1110000 * c0) * n) - _u(0x30674EEF * (_u(c0 * n) >> 16)))
        v2 = _u(_u(0x5B9F0000 * v1) - _u(0x78F7A461 * (v1 >> 16)))
        inner = _u(_u(0x12CEB96D * (v2 >> 16)) - _u(0x46930000 * v2))
        v3 = _u(_u(0x1D830000 * inner) + _u(0x257E1D83 * (inner >> 16)))
        v4 = _u(_u(_u(0x16F50000 * c1) * v3) - _u(0x5D8BE90B * (_u(c1 * v3) >> 16)))
        v5 = _u(_u(0x96FF0000 * v4) - _u(0x2C7C6901 * (v4 >> 16)))
        inner2 = _u(_u(0x2B890000 * v5) + _u(0x7C932B89 * (v5 >> 16)))
        o1 = _u(_u(0x9F690000 * inner2) - _u(0x405B6097 * (inner2 >> 16)))
        o2 = _u(o2 + o1 + v2)
    return (o1, o2)


def _patent_hash(a):
    sz = (len(a) >> 2) - ((len(a) >> 2) & 1) * 1
    md5 = __import__("hashlib").md5(a).digest()
    a1 = _wordswap(a, sz, md5)
    a2 = _reversible(a, sz, md5)
    left = a1[1] ^ a2[1]
    right = a1[0] ^ a2[0]
    value = (left << 32) | right
    return value


def _user_choice_hash(extension, sid, progid, writetime_hex):
    raw = f"{extension}{sid}{progid}{writetime_hex}{_GUID_STR}".lower()
    data = raw.encode("utf-16-le") + b"\x00\x00"
    value = _patent_hash(data)
    return base64.b64encode(struct.pack("<Q", value)).decode("ascii")


def get_user_sid():
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value"],
            capture_output=True, timeout=20)
        return r.stdout.decode("utf-8", errors="ignore").strip()
    except Exception:
        return None


class _FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", ctypes.c_uint),
                ("dwHighDateTime", ctypes.c_uint)]


def _get_key_last_write_time(subkey):
    adv = ctypes.windll.advapi32
    HKEY_CURRENT_USER = 0x80000001
    KEY_READ = 0x20019
    hkey = ctypes.c_void_p()
    r = adv.RegOpenKeyExW(HKEY_CURRENT_USER, subkey, 0, KEY_READ,
                          ctypes.byref(hkey))
    if r != 0:
        raise OSError(f"RegOpenKeyExW failed: {r}")
    try:
        ft = _FILETIME()
        r = adv.RegQueryInfoKeyW(
            hkey, None, None, None, None, None, None, None, None, None, None,
            ctypes.byref(ft))
        if r != 0:
            raise OSError(f"RegQueryInfoKeyW failed: {r}")
        return (ft.dwHighDateTime << 32) | ft.dwLowDateTime
    finally:
        adv.RegCloseKey(hkey)


_USERCHOICE_SUBKEY = (
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice")


def _read_userchoice_progid():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _USERCHOICE_SUBKEY, 0,
                            winreg.KEY_READ) as k:
            return winreg.QueryValueEx(k, "ProgId")[0]
    except OSError:
        return None


def _read_reg_default(path):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_READ) as k:
            return winreg.QueryValueEx(k, "")[0]
    except OSError:
        return None


def _write_reg_default(path, value):
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, path, 0,
                            winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, value)


def _register_progid(exe_path):
    exe_arg = f'"{exe_path}" "%1"'
    icon = f'"{exe_path}",0'

    _write_reg_default(r"Software\Classes\.md", "mdfile")
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,
                                r"Software\Classes\.md\OpenWithProgids", 0,
                                winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, "mdfile", 0, winreg.REG_NONE, b"")
    except (TypeError, OSError):
        pass

    _write_reg_default(r"Software\Classes\mdfile", "Markdown File")
    _write_reg_default(r"Software\Classes\mdfile\DefaultIcon", icon)
    _write_reg_default(r"Software\Classes\mdfile\shell\open\command", exe_arg)

    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,
                            r"Software\Classes\Applications\md-viewer.exe", 0,
                            winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, "FriendlyAppName", 0, winreg.REG_SZ, "MD Viewer")
    _write_reg_default(
        r"Software\Classes\Applications\md-viewer.exe\shell\open\command",
        exe_arg)

    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,
                            r"Software\Classes\md-viewer\Capabilities", 0,
                            winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, "ApplicationName", 0, winreg.REG_SZ, "MD Viewer")
        winreg.SetValueEx(k, "ApplicationDescription", 0, winreg.REG_SZ,
                          "Markdown 阅读与编辑器")
        winreg.SetValueEx(k, "ApplicationIcon", 0, winreg.REG_SZ, icon)
    try:
        with winreg.CreateKeyEx(
                winreg.HKEY_CURRENT_USER,
                r"Software\Classes\md-viewer\Capabilities\FileAssociations", 0,
                winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, ".md", 0, winreg.REG_SZ, "mdfile")
    except OSError:
        pass
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,
                            r"Software\RegisteredApplications", 0,
                            winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, "MD Viewer", 0, winreg.REG_SZ,
                          r"Software\Classes\md-viewer\Capabilities")


def _set_user_choice(extension, sid, progid):
    key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, _USERCHOICE_SUBKEY, 0,
                             winreg.KEY_SET_VALUE)
    try:
        try:
            winreg.QueryValueEx(key, "Hash")
        except OSError:
            winreg.SetValueEx(key, "ProgId", 0, winreg.REG_SZ, progid)
            winreg.SetValueEx(key, "Hash", 0, winreg.REG_SZ, "x")
            winreg.FlushKey(key)
        try:
            winreg.DeleteValue(key, "Hash")
        except OSError:
            pass
        winreg.FlushKey(key)

        ft = _get_key_last_write_time(_USERCHOICE_SUBKEY)
        trunc = ft // 600000000 * 600000000
        high = trunc >> 32
        low = trunc & 0xFFFFFFFF
        writetime_hex = f"{high:08x}{low:08x}"

        hash_val = _user_choice_hash(extension, sid, progid, writetime_hex)

        winreg.SetValueEx(key, "ProgId", 0, winreg.REG_SZ, progid)
        winreg.SetValueEx(key, "Hash", 0, winreg.REG_SZ, hash_val)
        winreg.FlushKey(key)
    finally:
        winreg.CloseKey(key)


def ensure_default(exe_path):
    """确保 .md 默认关联到当前 exe（幂等，可在每次启动时调用）。"""
    exe_path = str(exe_path)
    _register_progid(exe_path)

    expect = f'"{exe_path}" "%1"'
    if (_read_userchoice_progid() == "mdfile"
            and _read_reg_default(
                r"Software\Classes\mdfile\shell\open\command") == expect):
        return True

    sid = get_user_sid()
    if not sid:
        return False

    _set_user_choice(".md", sid, "mdfile")

    try:
        ctypes.windll.shell32.SHChangeNotify(
            0x08000000, 0x1000, None, None)
    except Exception:
        pass

    return _read_userchoice_progid() == "mdfile"
