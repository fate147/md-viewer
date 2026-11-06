# -*- coding: utf-8 -*-
"""WebView2 单页客户端宿主（ui）：整个客户区就是一个 Chromium 页面。

2026-10-11 重构：编辑器（CodeMirror 6）与阅读层同页共存于 assets/app.html，
F2 只是页内显隐互换——不再有「预览面板」，也就不需要 NavigateToString /
临时 HTML / ShowWindow 那一套（那套机制随 tkinterweb 一起退役）。

桥协议（与 assets/app.js 对应）：
- 下行 Python→JS：evaluate_js 调 window.__app.*；文档内容按 _CHUNK 分块推，
  绕开 ExecuteScriptAsync 对超大脚本的不确定性。
- 上行 JS→Python：主线程常驻 after 轮询 __drain() 取事件/状态；文本拉取走
  __getTextMeta / __getTextChunk 分块取回（一个在途 + 队列排队）。

铁律不变：.NET 事件回调（core 就绪/导航）里只允许 queue.put；STA 已在入口
main.pyw 于 import tkinter 之前完成；一切状态变更收敛到主线程轮询器。
"""

from __future__ import annotations

import ctypes
import json
import queue
import sys
import time
from pathlib import Path
from urllib.parse import quote

import tkinter as tk

_SW_HIDE, SW_SHOW_NOACT = 0, 4   # WinForms 宿主上 SW_SHOWNA(11) 无效，必须用 4
_CHUNK = 100_000                 # 下行/上行单块字符数。128K 实测通过、
                                 # 200K 未验证（当年误判为回调丢失，实为
                                 # 测试脚本回调 arity 错）；100K 留余量勿盲目调大
_POLL_MS = 20                    # 常驻轮询（drain + 回调分发）。2026-11-05 由 40 下调：
                                 # 原生 resize/拖动的事件启动延迟 = 最多一个轮询周期，20ms≈50Hz。
_READY_RETRIES = 100             # 页面 JS 就绪探测最多重试（≈12s）
_CALLBACK_TIMEOUT_S = 5          # 在途回调超时（pywebview 续延偶发丢失，见 _sweep_inflight）
_CALLBACK_RETRIES = 2            # 超时重发次数上限，超过按 None 上抛


def assets_dir() -> Path:
    """前端资产目录（app.html 及其 JS/CSS/字体）。"""
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        cand = base / "assets"
        if not cand.exists():
            cand = Path(sys.executable).parent / "_internal" / "assets"
        return cand
    return Path(__file__).resolve().parent.parent / "assets"


def _file_url(path: Path) -> str:
    return "file:///" + quote(path.as_posix(), safe="/:")


def dir_file_url(path: str | Path | None) -> str:
    """目录形式的 file URL（相对图片的解析基点）；None 返回空串。"""
    if not path:
        return ""
    p = str(path).replace("\\", "/")
    if not p.endswith("/"):
        p += "/"
    return "file:///" + quote(p, safe="/:")


def _parse(result):
    """evaluate_js 回调结果 → Python 对象（tkwebview2 的封装层次不定，双保险）。"""
    if isinstance(result, str):
        try:
            return json.loads(result)
        except ValueError:
            return result
    return result


class WebClient(tk.Frame):
    """页面宿主 + 桥。所有公开方法必须在 Tk 主线程调用。"""

    def __init__(self, master: tk.Widget, on_ready=None, on_event=None,
                 on_nav=None, bg: str = "#ffffff",
                 theme_vars: dict | None = None,
                 width: int = 800, height: int = 600) -> None:
        # 宿主底色必须是当前主题色：默认白色会在深色主题下先闪一下白
        super().__init__(master, bg=bg)
        from tkwebview2.tkwebview2 import WebView2   # STA 线程内导入/创建

        self._on_ready = on_ready
        self._on_event = on_event       # drain 出来的 dict（主线程回调）
        self._on_nav = on_nav           # (kind, uri)：external / open_md

        self._core = None
        self._page_ready = False
        self._early: list[str] = []     # 页面 JS 就绪前排队的下行脚本
        # 在途请求：rid -> {js, fn, tries, t0, cb}。pywebview 4.4.1 的
        # ExecuteScriptAsync 续延偶发丢失（JS 已执行但回调永不触发，无报错），
        # 所以带 5s 超时重发（桥上的读操作全部幂等），两次失败按 None 上抛。
        self._inflight: dict[int, dict] = {}
        self._req_id = 0
        self._pull: dict | None = None  # 文本拉取状态机（一个在途）
        self._pull_queue: list[tuple] = []
        self._ready_left = 0
        self._q: queue.Queue = queue.Queue()

        import os, sys as _sys
        if os.environ.get("MDV_BOOT_TRACE"):
            print("[boot] WebClient: 建 WebView2 控件前", file=_sys.stderr, flush=True)
        # 按最终尺寸创建控件（800×600 之后被 geometry/SetParent 重排会造成首帧花屏）
        self.wv = WebView2(self, max(1, int(width)), max(1, int(height)))
        if os.environ.get("MDV_BOOT_TRACE"):
            print("[boot] WebClient: WebView2 控件 OK", file=_sys.stderr, flush=True)
        self.wv.pack(fill=tk.BOTH, expand=True)
        self._chwnd = self.wv.chwnd
        self._user32 = ctypes.windll.user32
        # tkwebview2 自带 <Configure> 处理用 MoveWindow(...,TRUE) 重显控件，且创建时
        # 先载入纯白 DEFAULT_HTML —— 深色主题下这就是那一下「白光」。接管尺寸同步，
        # 页面绘制完成前只调整位置不显示。
        try:
            self.wv.unbind("<Configure>")
        except Exception:
            pass
        self.wv.bind("<Configure>", self._on_wv_configure, add=True)
        self._show(False)                # 页面未绘制前先隐藏原生控件，杜绝白底外露
        self.set_background(bg)          # 控件默认白底 → 主题色，消除首帧白闪
        # tkwebview2 构造时已把纯白 DEFAULT_HTML 载入控件（webview/util.py）。
        # 立刻换成主题色空白页：即便某一刻控件可见，也是主题色而不是白。
        self._load_blank(bg)

        # .NET 回调线程只允许 put（铁律）
        self.wv.event_core_completed(
            lambda s, a: self._q.put(("core", s)))

        self.bind("<Map>", self._on_map, add=True)
        self.bind("<Unmap>", lambda e: self._show(False), add=True)

        # 首帧主题经 URL hash 注入（app.html 内联脚本先于首次绘制套用）
        base = _file_url(assets_dir() / "app.html")
        self._app_base_url = base
        self._app_url = base
        if theme_vars:
            self._app_url = (base + "#pre="
                             + quote(json.dumps(theme_vars, ensure_ascii=False),
                                     safe=""))
        # 控件已按最终尺寸创建，无需等映射即可导航；窗口此时可能是隐藏的，
        # 由 App 在页面就绪后再显示（避免白底外露）。
        self._url_loaded = True
        try:
            self.wv.load_url(self._app_url)
        except Exception:
            self._url_loaded = False
        if os.environ.get("MDV_BOOT_TRACE"):
            print("[boot] WebClient: load_url 已发", file=_sys.stderr, flush=True)
        self.after(_POLL_MS, self._poll)

    def _on_map(self, _event=None) -> None:
        self._maybe_load()
        if self._page_ready:        # 还原窗口：页面已就绪才显示控件
            self._show(True)

    def _on_wv_configure(self, _event=None) -> None:
        """替代 tkwebview2 的 <Configure>：只挪控件，不强制显示。

        原生实现在每次 Configure 里 MoveWindow(...,TRUE)，bRepaint=TRUE 会让
        尚未绘制页面的控件重新可见，深色主题下先露白底。
        """
        try:
            self._user32.MoveWindow(self._chwnd, 0, 0,
                                    max(1, self.wv.winfo_width()),
                                    max(1, self.wv.winfo_height()),
                                    False if not self._page_ready else True)
        except Exception:
            pass

    def _maybe_load(self) -> None:
        """映射且已有实际尺寸后才导航：避免未布局时的 800×600 白帧。"""
        if self._url_loaded:
            return
        try:
            if not self.winfo_ismapped():
                return
            w, h = self.winfo_width(), self.winfo_height()
        except Exception:
            return
        if w < 50 or h < 50:                 # 尺寸还没定，交给 _poll 兜底重试
            return
        self._url_loaded = True
        try:
            self.wv.load_url(self._app_url)
        except Exception:
            self._url_loaded = False

    def set_background(self, color_hex: str) -> None:
        """同步 WebView2 控件底色 + Tk 宿主底色（specs/01 R-01-07 首帧主题）。

        tkwebview2 建控件时传的 background_color 只有 transparent=True 才生效，
        控件实际是 WinForms 默认白底；不显式设 DefaultBackgroundColor，深色
        主题在 HTML 绘出前必然先闪一帧白。core 初始化后需要再设一次
        （WinForms 封装在初始化完成时可能重置该值）。
        """
        prev = getattr(self, "_bg_hex", None)
        self._bg_hex = color_hex or "#ffffff"
        try:
            self.configure(bg=self._bg_hex)
        except Exception:
            pass
        self._apply_default_bg()
        # 页面还没加载真实内容时，空白页也要跟着换色（切主题不应露旧色）
        if (prev is not None and prev != self._bg_hex
                and not getattr(self, "_url_loaded", False)):
            self._load_blank(self._bg_hex)

    def _load_blank(self, color_hex: str) -> None:
        """把控件内容换成主题色空白页（替换 tkwebview2 的白色 DEFAULT_HTML）。"""
        try:
            self.wv.load_html(
                "<!doctype html><html><head><meta charset='utf-8'>"
                "<style>html,body{margin:0;height:100%;background:"
                + (color_hex or "#ffffff") + "}</style></head><body></body></html>")
        except Exception:
            pass

    def _apply_default_bg(self) -> None:
        try:
            from System.Drawing import Color
            h = (getattr(self, "_bg_hex", "") or "").lstrip("#")
            if len(h) == 6:
                self.wv.web.DefaultBackgroundColor = Color.FromArgb(
                    int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
        except Exception:
            pass

    # ---------------- 下行：Python → JS ----------------

    def _eval(self, js: str, handler=None) -> None:
        """业务下行：页面 JS 未就绪时排队，就绪后按序补发。"""
        rid = None
        if handler is not None:
            self._req_id += 1
            rid = self._req_id
            self._inflight[rid] = {"js": js, "fn": handler, "tries": 0,
                                   "t0": time.monotonic(), "cb": None}
        if not self._page_ready:
            self._early.append((js, rid))
            return
        self._dispatch(js, rid)

    def _eval_core(self, js: str, handler=None) -> None:
        """绕过页面就绪门的直发（就绪探测用）；core 未就绪直接丢弃。"""
        if self._core is None:
            return
        rid = None
        if handler is not None:
            self._req_id += 1
            rid = self._req_id
            self._inflight[rid] = {"js": js, "fn": handler, "tries": 0,
                                   "t0": time.monotonic(), "cb": None}
        self._dispatch(js, rid)

    def _dispatch(self, js: str, rid: int | None) -> None:
        if rid is None:
            try:
                self.wv.evaluate_js(js)     # 纯下行：JS 必执行，无回调可丢
            except Exception:
                pass
            return
        entry = self._inflight.get(rid)
        if entry is None:
            return
        try:
            cb = lambda r, _r=rid: self._q.put(("js", _r, r))
            entry["cb"] = cb                # 强引用防 pythonnet 委托被 GC
            self.wv.evaluate_js(js, callback=cb)
        except Exception:
            self._inflight.pop(rid, None)

    def _call(self, expr: str, handler=None) -> None:
        """调 window.__app.* —— expr 是完整 JS 表达式。"""
        self._eval(expr, handler)

    # —— 业务下行 ——
    def set_theme(self, vars: dict) -> None:
        self._call("window.__app.setTheme(" + json.dumps(vars, ensure_ascii=False) + ")")

    def set_font(self, size: int, family: str) -> None:
        self._call(f"window.__app.setFont({int(size)},{json.dumps(family)})")

    def set_reading_mode(self, mode: str) -> None:
        self._call(f"window.__app.setReadingMode({json.dumps(mode)})")

    def init_toc_visible(self, default_visible: bool) -> None:
        """启动初始化目录状态（specs/06：**不写 manual**，auto 仍生效）。

        与 set_toc_visible 的区别：后者是用户在菜单里手动切换，会持久化并
        覆盖 auto 判定；本方法只给初始状态，文档模式仍应自动隐藏目录。
        """
        self._call(
            f"window.__app.initTocVisible({'true' if default_visible else 'false'})")

    def set_toc_visible(self, visible: bool) -> None:
        """用户手动切换目录显示（specs/05 R-05-11）：只传状态，不传大纲数据。"""
        self._call(f"window.__app.setTocVisible({'true' if visible else 'false'})")

    def set_toc_mode(self, mode: str, clear_manual: bool = False) -> None:
        """下发目录显示模式 auto|always|never（specs/06 R-06-07，2026-11-02）。

        clear_manual=True 用于菜单入口：清除用户手动覆盖，令所选模式立即生效；
        启动下发用默认 False，保留 localStorage 的手动偏好。
        """
        m = mode if mode in ("auto", "always", "never") else "auto"
        self._call(f"window.__app.setTocMode({json.dumps(m)},"
                   f"{'true' if clear_manual else 'false'})")

    # —— 应用外壳（第一期：页面内菜单/状态栏；specs/05 R-05-12）——
    def set_status(self, payload: dict) -> None:
        self._call("window.__app.setStatus(" + json.dumps(payload, ensure_ascii=False) + ")")

    def set_status_temp(self, msg: str, timeout_ms: int = 2000) -> None:
        self._call(f"window.__app.setStatusTemp({json.dumps(msg, ensure_ascii=False)},{int(timeout_ms)})")

    def set_ui_meta(self, meta: dict) -> None:
        self._call("window.__app.setUIMeta(" + json.dumps(meta, ensure_ascii=False) + ")")

    def set_window_title(self, text: str) -> None:
        self._call("window.__app.setWindowTitle(" + json.dumps(text, ensure_ascii=False) + ")")

    def set_tabs(self, items: list[dict]) -> None:
        self._call("window.__app.setTabs(" + json.dumps(items, ensure_ascii=False) + ")")

    def open_doc(self, tab_id: int, name: str, base_dir: str | None) -> None:
        meta = {"name": name, "baseDir": dir_file_url(base_dir)}
        self._call(f"window.__app.openDoc({tab_id},{json.dumps(meta, ensure_ascii=False)})")

    def push_chunk(self, text: str) -> None:
        self._call("window.__app.pushChunk(" + json.dumps(text, ensure_ascii=False) + ")")

    def commit_doc(self, tab_id: int) -> None:
        self._call(f"window.__app.commitDoc({tab_id})")

    def send_text(self, tab_id: int, text: str, name: str,
                  base_dir: str | None) -> None:
        """整文档推送：open_doc → 分块 → commit（1MB ≈ 6 次调用）。"""
        self.open_doc(tab_id, name, base_dir)
        for i in range(0, len(text), _CHUNK):
            self.push_chunk(text[i:i + _CHUNK])
        self.commit_doc(tab_id)

    def set_dirty(self, tab_id: int, dirty: bool) -> None:
        self._call(f"window.__app.setDirty({tab_id},{'true' if dirty else 'false'})")

    def activate_tab(self, tab_id: int) -> None:
        self._call(f"window.__app.activateTab({tab_id})")

    def toggle_mode(self) -> None:
        self._call("window.__app.toggleMode()")

    def run_cmd(self, name: str) -> None:
        self._call(f"window.__app.runCmd({json.dumps(name)})")

    def insert_text(self, text: str) -> None:
        self._call("window.__app.insertText(" + json.dumps(text, ensure_ascii=False) + ")")

    # ---------------- 上行：文本拉取（保存/关闭/复制用） ----------------

    def request_text(self, tab_id: int, cb) -> None:
        """异步取整篇文本；完成 cb(text)，失败 cb(None)。主线程回调。"""
        if self._pull is not None:
            self._pull_queue.append((tab_id, cb))
            return
        self._pull = {"id": tab_id, "cb": cb, "len": None, "buf": "", "pos": 0}
        # 注意：evaluate_js 回调自带一层 JSON 解包（JS 返回值原样到达），
        # __getTextMeta 自己返回 JSON.stringify(...)，这里不要再包 stringify
        self._eval(f"window.__getTextMeta({tab_id})",
                   self._make_handler(self._on_meta))

    def _make_handler(self, fn):
        def _h(result):
            try:
                fn(_parse(result))
            except Exception:
                self._pull_fail()
        return _h

    def _on_drain(self, d) -> None:
        if isinstance(d, dict) and self._on_event:
            self._on_event(d)

    def _on_meta(self, meta: dict) -> None:
        p = self._pull
        if p is None:
            return
        p["len"] = int(meta.get("len", 0))
        if p["len"] <= 0:
            self._pull_done("")
            return
        self._pull_next()

    def _pull_next(self) -> None:
        p = self._pull
        start, end = p["pos"], min(p["pos"] + _CHUNK, p["len"])
        self._eval(f"window.__getTextChunk({p['id']},{start},{end})",
                   self._make_handler(self._on_chunk))

    def _on_chunk(self, chunk) -> None:
        p = self._pull
        if p is None or not isinstance(chunk, str):
            self._pull_fail()
            return
        p["buf"] += chunk
        p["pos"] += len(chunk)
        if p["pos"] >= p["len"]:
            self._pull_done(p["buf"])
        else:
            self._pull_next()

    def _pull_done(self, text: str) -> None:
        p, self._pull = self._pull, None
        try:
            p["cb"](text)
        finally:
            self._pull_shift()

    def _pull_fail(self) -> None:
        if self._pull is None:
            return
        p, self._pull = self._pull, None
        try:
            p["cb"](None)   # 与「空文档」区分：调用方必须处理 None
        finally:
            self._pull_shift()

    def _pull_shift(self) -> None:
        if self._pull_queue and self._pull is None:
            tab_id, cb = self._pull_queue.pop(0)
            self.request_text(tab_id, cb)

    # ---------------- 主线程轮询器 ----------------

    def _poll(self) -> None:
        try:
            while True:
                try:
                    item = self._q.get_nowait()
                except queue.Empty:
                    break
                kind = item[0]
                if kind == "core":
                    self._on_core(item[1])
                elif kind == "js":
                    _, rid, result = item
                    entry = self._inflight.pop(rid, None)
                    if entry is not None:
                        entry["fn"](result)
                elif kind == "nav":
                    if self._on_nav:
                        self._on_nav(item[1], item[2])
        except tk.TclError:
            return

        self._sweep_inflight()
        if not self._url_loaded:
            self._maybe_load()          # 兜底：<Map> 若早于绑定则靠轮询补发
        if not self._page_ready:
            # tkwebview2 的 <Configure> 处理器用 MoveWindow(...,TRUE) 重显控件，
            # 会覆盖隐藏；页面绘制完成前持续压住，避免深色主题先露白帧。
            self._show(False)

        if self._core is not None:
            if not self._page_ready:
                if self._ready_left > 0:
                    self._ready_left -= 1
                    self._eval_core("!!window.__appReady",
                                    self._make_handler(self._on_ready_msg))
            elif self._on_event:
                self._eval_core("window.__drain()",
                                self._make_handler(self._on_drain))

        if self.winfo_exists():
            self.after(_POLL_MS, self._poll)

    def _sweep_inflight(self) -> None:
        """超时在途请求：重发（读操作幂等）或按 None 上抛。

        pywebview 4.4.1 的 ExecuteScriptAsync 续延偶发丢失——JS 已执行、
        回调永不触发且无任何报错（2026-10-11 探针实测）。不兜底的话
        文本拉取状态机会永久卡死、后续拉文全部排队饿死。
        """
        now = time.monotonic()
        for rid, entry in list(self._inflight.items()):
            if now - entry["t0"] < _CALLBACK_TIMEOUT_S:
                continue
            if entry["tries"] >= _CALLBACK_RETRIES:
                self._inflight.pop(rid, None)
                try:
                    entry["fn"](None)
                except Exception:
                    pass
            else:
                entry["tries"] += 1
                entry["t0"] = now
                self._dispatch(entry["js"], rid)

    def _on_core(self, sender) -> None:
        try:
            core = sender.CoreWebView2
        except Exception:
            return
        if core is None or self._core is not None:
            return
        self._core = core
        self._apply_default_bg()         # 初始化完成后重申主题底色
        self._install_nav_guard(core)
        if not self._ready_left:
            self._ready_left = _READY_RETRIES

    def _on_ready_msg(self, ok) -> None:
        if ok in (True, "true") and not self._page_ready:
            self._page_ready = True
            self._show(True)         # 页面已绘制：此刻才显示控件，首帧即主题色
            early, self._early = self._early, []
            for js, rid in early:
                self._dispatch(js, rid)
            if self._on_ready:
                self._on_ready()

    # ---------------- 导航守卫 ----------------

    def _install_nav_guard(self, core) -> None:
        """页内锚点放行；.md 本地链接交回应用打开；其余交给系统浏览器。"""
        def _on_nav(sender, e):
            try:
                uri = e.Uri or ""
            except Exception:
                return
            # 页面自身（含锚点跳转）放行；首帧主题 hash 不参与比较
            base = getattr(self, "_app_base_url", self._app_url)
            if uri.split("#")[0] == base:
                return
            try:
                e.Cancel = True
            except Exception:
                pass
            clean = uri.split("#")[0].split("?")[0].lower()
            if uri.startswith("file://") and clean.endswith(".md"):
                self._q.put(("nav", "open_md", uri))
            elif uri.startswith(("http://", "https://", "mailto:", "file://")):
                self._q.put(("nav", "external", uri))
        try:
            core.NavigationStarting += _on_nav
            self._nav_handler = _on_nav     # 防 delegate 目标被 GC
        except Exception:
            pass

    # ---------------- 显隐 ----------------

    def _show(self, visible: bool) -> None:
        try:
            self._user32.ShowWindow(self._chwnd,
                                    SW_SHOW_NOACT if visible else _SW_HIDE)
        except Exception:
            pass


# 启动失败退出码（01 R-01-06③）：区分「没装」与「装了但装配坏」，便于日志归因
EXIT_NO_WEBVIEW2 = 2      # WebView2 Runtime 未安装（或 .NET Framework < 4.6.2）
EXIT_RUNTIME_BROKEN = 3   # 已安装，但 CLR / pythonnet 装配失败


def webview_available() -> tuple:
    """探测 WebView2 可用性（01 R-01-06）。

    返回 ``(ok, reason, detail)``：
      - ``(True,  "ok",      "")``            可用
      - ``(False, "missing", "")``            Runtime 未安装 / .NET 版本过低
      - ``(False, "broken",  <traceback>)``   检测过程本身失败（CLR 装配坏）

    禁止把后两者混为一个 ``False``——2026-10-26 的教训是「CLR 装配失败」
    被报成「未检测到 WebView2」，把排查引向「环境缺 Runtime」的错方向。

    判定口径：``have_runtime()`` 自身不吞异常（``tkwebview2.py:141-143``
    直接转发 ``webview.platforms.winforms._is_chromium()``），所以它抛异常
    即装配失败；正常返回布尔才代表「真的没装」。
    """
    import os
    import sys
    import traceback

    try:
        from tkwebview2.tkwebview2 import have_runtime
        ok = bool(have_runtime())
    except Exception:
        detail = traceback.format_exc()
        if os.environ.get("MDV_BOOT_TRACE"):
            print("[boot] have_runtime CRASHED（CLR 装配失败）",
                  file=sys.stderr, flush=True)
            print(detail, file=sys.stderr, flush=True)
        return False, "broken", detail

    if os.environ.get("MDV_BOOT_TRACE"):
        print(f"[boot] have_runtime -> {ok}", file=sys.stderr, flush=True)

    if ok:
        return True, "ok", ""
    return False, "missing", ""
