# -*- coding: utf-8 -*-
"""桥链路集成测试：装载 → 页内编辑 → 拉全文保存 → 磁盘校验。

替代旧 test_webview_integration.py（双引擎回归，已随 tkinterweb 退役）。
跑法：py test_bridge_integration.py（会短暂弹窗，自动退出）
"""
import importlib.util
import sys
import time
from pathlib import Path

import ctypes
try:
    ctypes.oledll.ole32.CoInitializeEx(None, 0x2)
except Exception:
    pass

import tkinter as tk

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

# 配置隔离：App 会经 _save_recent 全量落盘配置，必须指向临时文件，
# 否则测试文件会污染真实 .md-viewer-config.json（2026-10-11 踩坑）
from core import config as config_mod  # noqa: E402
config_mod.CONFIG_PATH = ROOT / ".mdv-test-config.json"

spec = importlib.util.spec_from_file_location("mdv_main", ROOT / "src" / "main.pyw")
main_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main_mod)

from actions import open_file, save  # noqa: E402

TEST_FILE = ROOT / "mdv-it-test.md"
ORIGINAL = "# 标题\n\n第一段。\n"
TEST_FILE.write_text(ORIGINAL, encoding="utf-8")

PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, cond: bool, extra: str = "") -> None:
    (PASS if cond else FAIL).append(f"{name} {extra}")
    print(("PASS" if cond else "FAIL"), name, extra)


def pump(root, seconds: float) -> None:
    end = time.time() + seconds
    while time.time() < end:
        root.update()
        time.sleep(0.02)


def wait_until(root, cond, timeout: float) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        root.update()
        time.sleep(0.05)
        try:
            if cond():
                return True
        except Exception:
            pass
    return False


root = tk.Tk()
root.withdraw()
app = main_mod.App(root)
root.deiconify()

check("web_ready", wait_until(root, lambda: app._web_ready, 30))

open_file(app, str(TEST_FILE))
pump(root, 1.0)
got: dict = {}
app.web.request_text(id(app.sess.active()), lambda t: got.__setitem__("t", t))
check("doc_loaded",
      wait_until(root, lambda: "t" in got, 15) and got.get("t") == ORIGINAL,
      repr(got.get("t", "")[:40]))

# 页内编辑：全选替换（等价真实键入，走 CM6 事务）
app.web.run_cmd("selectAll")
app.web.insert_text(ORIGINAL + "\n追加的内容 HELLO\n")
pump(root, 0.5)

save(app)
check("save_roundtrip",
      wait_until(root, lambda: "追加的内容 HELLO" in TEST_FILE.read_text(encoding="utf-8"), 15))

check("dirty_cleared", not app.sess.active().dirty)

# ---------------- 多标签：内容隔离 + 切换 + 关闭 ----------------
from actions import close_tab_by_id, select_tab_by_id  # noqa: E402

FA = ROOT / "mdv-it-a.md"
FB = ROOT / "mdv-it-b.md"
FA.write_text("AAAA\n", encoding="utf-8")
FB.write_text("BBBB\n", encoding="utf-8")
open_file(app, str(FA))
pump(root, 1.0)
open_file(app, str(FB))
pump(root, 1.0)
# 启动时可能有 WELCOME 标签在前面，按路径找
tab_a = next(t for t in app.sess.tabs if t.path and t.path.name == "mdv-it-a.md")
tab_b = next(t for t in app.sess.tabs if t.path and t.path.name == "mdv-it-b.md")
check("two_tabs", len(app.sess.tabs) >= 2 and app.sess.active() is tab_b)

app.web.run_cmd("selectAll")
app.web.insert_text("BBBB\nEDIT-B\n")
pump(root, 0.5)

select_tab_by_id(app, id(tab_a))
pump(root, 0.5)
got_a: dict = {}
app.web.request_text(id(tab_a), lambda t: got_a.__setitem__("t", t))
check("tab_a_intact",
      wait_until(root, lambda: "t" in got_a, 10) and got_a.get("t") == "AAAA\n",
      repr(got_a.get("t", ""))[:40])

select_tab_by_id(app, id(tab_b))
pump(root, 0.5)
got_b: dict = {}
app.web.request_text(id(tab_b), lambda t: got_b.__setitem__("t", t))
check("tab_b_kept_edit",
      wait_until(root, lambda: "t" in got_b, 10) and got_b.get("t") == "BBBB\nEDIT-B\n",
      repr(got_b.get("t", ""))[:40])

close_tab_by_id(app, id(tab_b), force=True)
pump(root, 0.5)
check("close_b_back_to_a",
      tab_b not in app.sess.tabs and app.sess.active() is tab_a)

FA.unlink(missing_ok=True)
FB.unlink(missing_ok=True)
app.root.destroy()
TEST_FILE.unlink(missing_ok=True)
print(f"INTEGRATION_PASS={len(FAIL) == 0}")
sys.exit(0 if not FAIL else 1)
