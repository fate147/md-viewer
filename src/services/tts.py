# -*- coding: utf-8 -*-
"""TTS 核心服务（services）：edge-tts 云端神经合成 + 分块流式 + 手动缓存（F26 / specs/09）。

设计纪律（specs/09）：
- R-09-01 引擎：edge-tts（微软 Edge 朗读端点、需联网），默认音色/语速以本模块常量为唯一源。
- R-09-02 分块：1200 字/块，按句读/段落边界切分，块序列单任务串行。
- R-09-03 后台线程：合成在独立线程 + 独立 asyncio 事件循环；状态/进度/错误经线程安全
  queue 回传主线程（延续 web_client.py 队列收敛铁律），绝不占 Tk 主线程。
- R-09-06/07 缓存：默认关、按文档显式开启；键 = 音色+语速+块文本哈希；无自动删除。
- R-09-08 失败：429/403 指数退避 + jitter 重试（上限 4），错误落盘 + 事件上抛，不静默。
- R-09-09 性能：edge_tts 懒加载（点播放才 import），未朗读态零开销。

本模块不接 UI、不碰桥：主线程在 Tk after 轮询器里 drain() 本服务的事件，再经
web_client.set_tts_state 下发给页面（Phase 3 接线）。本模块零 Tk 依赖（services 层硬约束）。
"""

from __future__ import annotations

import hashlib
import os
import queue
import random
import re
import shutil
import threading
import time
import traceback
from pathlib import Path

# —— 常量（specs/09 R-09-01/02/08；取值唯一源）——
DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_RATE = "+0%"             # edge-tts 格式：如 "-10%" / "+20%"
CHUNK_CHARS = 1200               # 每块字数（约 8 分钟音频，卡在服务端 10 分钟上限内）
MAX_RETRIES = 4                  # 99/408 端点错误重试上限（含首次）
RETRY_BASE_S = 0.8               # 退避基数：0.8, 1.6, 3.2 ... + jitter
CACHE_DIR_NAME = "MDViewer/tts-cache"
_CORPUS_DIR_NAME = "_stream"     # 非缓存播放的临时音频目录（随会话清理）

# 音色候选：取值集合以本表为唯一源；非法值由 normalize_voice/rate 回落默认。
VOICES: dict[str, str] = {
    "zh-CN-XiaoxiaoNeural": "晓晓（女，通用）",
    "zh-CN-YunxiNeural": "云希（男，通用）",
    "zh-CN-YunyangNeural": "云扬（男，播报）",
    "zh-CN-XiaoyiNeural": "晓伊（女）",
    "zh-CN-liaoning-XiaobeiNeural": "晓北（东北话）",
}


def normalize_voice(value: str | None) -> str:
    """合法音色返回原值，否则回落默认（R-09-01）。"""
    return value if value in VOICES else DEFAULT_VOICE


_RATE_RE = re.compile(r"^[+-]\d{1,3}%$")


def normalize_rate(value: str | None) -> str:
    """合法语速（如 '+10%' / '-20%'）返回原值，否则回落默认。"""
    return value if isinstance(value, str) and _RATE_RE.match(value) else DEFAULT_RATE


# —— 分块（R-09-02）：按句读/段落边界切，尽量贴近 CHUNK_CHARS 但不切断句子 ——
# 句末标点（中英文），块优先在标点后断开；超长无标点段落按硬上限切。
_BOUNDARY_RE = re.compile(r"(?<=[。！？!?；;\n])")


def split_text(text: str, max_chars: int = CHUNK_CHARS) -> list[str]:
    """把纯文本切成 <=max_chars 的块，优先按句读/换行断句，空文本返回 []。"""
    if not text:
        return []
    out: list[str] = []
    for para in text.split("\n\n"):
        para = para.strip()
        if not para:
            continue
        # 先按句读拆成句子（保留标点），再贪心装块
        sentences = [s for s in _BOUNDARY_RE.split(para) if s]
        buf = ""
        for sent in sentences:
            # 单句超过上限：按硬上限切片（罕见，如超长代码行）
            while len(sent) > max_chars:
                if buf:
                    out.append(buf)
                    buf = ""
                out.append(sent[:max_chars])
                sent = sent[max_chars:]
            if not sent:
                continue
            if len(buf) + len(sent) <= max_chars:
                buf += sent
            else:
                if buf:
                    out.append(buf)
                buf = sent
        if buf:
            out.append(buf)
    return out


# —— 缓存路径与键（R-09-06/07；目录用 %LOCALAPPDATA% 拼接，仓库内无绝对路径 D-04）——
def cache_root() -> Path:
    """缓存根目录：优先 %LOCALAPPDATA%，缺失时回落用户主目录下的 .mdviewer（运行时，非仓库）。"""
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / CACHE_DIR_NAME
    return Path.home() / ".mdviewer" / "tts-cache"


def _chunk_key(voice: str, rate: str, text: str) -> str:
    h = hashlib.sha256()
    h.update(voice.encode("utf-8"))
    h.update(b"\x00")
    h.update(rate.encode("utf-8"))
    h.update(b"\x00")
    h.update(text.encode("utf-8"))
    return h.hexdigest()[:24]


def _log_path() -> Path:
    """错误日志落点：frozen 时 exe 目录，源码时项目根（与 web_client 一致）。"""
    import sys
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "md-viewer-error.log"
    return Path(__file__).resolve().parent.parent.parent / "md-viewer-error.log"


def _log_error(msg: str) -> None:
    try:
        with _log_path().open("a", encoding="utf-8") as f:
            f.write(f"[tts] {msg}\n")
    except Exception:
        pass  # 落盘失败不再二次抛：事件通道仍会带出错误


class TTSController:
    """TTS 播放控制器。主线程调用公开方法，后台线程做合成，事件经 drain() 回传。

    事件（dict，均有 'type'）：
    - ttsState   {state: playing|paused|stopped|idle}
    - ttsProgress{index, total, percent}         块进度
    - ttsChunk   {index, path, cached}           一块音频就绪（path 供页面播放）
    - ttsError   {message, fatal}                错误（fatal=True 表示播放终止）
    - ttsDone    {}                              全部完成
    """

    def __init__(self) -> None:
        self._q: queue.Queue[dict] = queue.Queue()
        self._stop_evt = threading.Event()
        self._pause_evt = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop = None
        self._busy = False
        self._fatal_errored = False   # 本轮是否发过致命错误（R-09-11）
        # 背压（R-09-12）：每块播放确认。_play_evt 在收到确认或停止时置位，
        # _played_lock 保护 _played 集合（主线程写、合成线程读）。
        self._play_evt = threading.Event()
        self._played: set[int] = set()
        self._played_lock = threading.Lock()

    # ---------- 主线程 API ----------
    @property
    def busy(self) -> bool:
        return self._busy

    def play(self, text: str, *, voice: str | None = None, rate: str | None = None,
             cache_enabled: bool = False, doc_id: str | None = None) -> bool:
        """启动朗读。text 必须是已去标记的纯文本（由 actions.speak 处理）。

        cache_enabled=False 时用临时目录放音频、播完可清理；True 时按文档键落缓存。
        已有任务在跑返回 False（单任务串行，R-09-02）。
        """
        if self._busy:
            return False
        voice = normalize_voice(voice)
        rate = normalize_rate(rate)
        blocks = split_text(text)
        if not blocks:
            self._emit({"type": "ttsDone"})
            return True

        self._stop_evt.clear()
        self._pause_evt.clear()
        self._fatal_errored = False
        self._play_evt.clear()
        with self._played_lock:
            self._played.clear()
        self._busy = True
        self._thread = threading.Thread(
            target=self._thread_main,
            args=(blocks, voice, rate, cache_enabled, doc_id),
            name="mdv-tts", daemon=True,
        )
        self._thread.start()
        return True

    def pause(self) -> None:
        self._pause_evt.set()
        if self._busy:
            self._emit({"type": "ttsState", "state": "paused"})

    def resume(self) -> None:
        self._pause_evt.clear()
        if self._busy:
            self._emit({"type": "ttsState", "state": "playing"})

    def stop(self) -> None:
        self._stop_evt.set()
        self._pause_evt.clear()
        self._play_evt.set()   # 唤醒正在等待播放确认的合成线程（R-09-12）

    def notify_chunk_played(self, index: int) -> None:
        """JS 上报某块音频播放结束/出错（R-09-12 背压确认）。主线程调用。"""
        with self._played_lock:
            self._played.add(index)
        self._play_evt.set()

    def drain(self) -> list[dict]:
        """取走全部待处理事件（主线程轮询器调用）。"""
        items: list[dict] = []
        while True:
            try:
                items.append(self._q.get_nowait())
            except queue.Empty:
                break
        return items

    # ---------- 缓存管理（R-09-07）：只查看/删除，无自动 LRU ----------
    @staticmethod
    def cache_manifest_path() -> Path:
        return cache_root() / "manifest.json"

    @classmethod
    def cache_info(cls) -> list[dict]:
        """列出各文档缓存占用：{doc_id, voice, rate, chunks, bytes, mtime}。"""
        mf = cls._load_manifest()
        out: list[dict] = []
        for doc_id, rec in mf.get("docs", {}).items():
            nbytes = 0
            for h in rec.get("hashes", []):
                p = cache_root() / f"{h}.mp3"
                if p.exists():
                    nbytes += p.stat().st_size
            out.append({
                "doc_id": doc_id,
                "voice": rec.get("voice", ""),
                "rate": rec.get("rate", ""),
                "chunks": len(rec.get("hashes", [])),
                "bytes": nbytes,
                "mtime": rec.get("mtime", 0),
            })
        return out

    @classmethod
    def cache_delete(cls, doc_id: str) -> int:
        """删除单个文档的缓存音频，返回删除文件数。"""
        mf = cls._load_manifest()
        rec = mf.get("docs", {}).pop(doc_id, None)
        if not rec:
            return 0
        removed = 0
        for h in rec.get("hashes", []):
            p = cache_root() / f"{h}.mp3"
            if p.exists():
                try:
                    p.unlink()
                    removed += 1
                except OSError:
                    pass
        cls._save_manifest(mf)
        return removed

    @classmethod
    def cache_clear(cls) -> int:
        """清空全部缓存（用户手动触发），返回删除文件数。"""
        root = cache_root()
        n = 0
        if root.exists():
            for p in root.glob("*.mp3"):
                try:
                    p.unlink()
                    n += 1
                except OSError:
                    pass
        mf = cls._load_manifest()
        mf["docs"] = {}
        cls._save_manifest(mf)
        return n

    # ---------- manifest 读写 ----------
    @staticmethod
    def _load_manifest() -> dict:
        p = TTSController.cache_manifest_path()
        try:
            if p.exists():
                import json
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
        except Exception as exc:
            _log_error(f"manifest 读取失败（降级为空）：{exc!r}")
        return {"docs": {}}

    @staticmethod
    def _save_manifest(data: dict) -> None:
        p = TTSController.cache_manifest_path()
        try:
            import json
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(p)
        except Exception as exc:
            _log_error(f"manifest 写入失败：{exc!r}")

    # ---------- 后台线程 ----------
    def _emit(self, ev: dict) -> None:
        # 致命错误置标志：finally 不再发 stopped，避免覆盖错误态（R-09-11）
        if ev.get("type") == "ttsError" and ev.get("fatal"):
            self._fatal_errored = True
        self._q.put(ev)

    def _thread_main(self, blocks: list[str], voice: str, rate: str,
                     cache_enabled: bool, doc_id: str | None) -> None:
        """线程入口：建独立事件循环跑合成；任何异常落盘 + 事件上抛（D-01 不静默）。"""
        import asyncio
        try:
            asyncio.run(self._async_synth(blocks, voice, rate, cache_enabled, doc_id))
        except Exception as exc:
            _log_error(f"合成线程异常：{exc!r}\n{traceback.format_exc()}")
            self._emit({"type": "ttsError", "message": str(exc), "fatal": True})
        finally:
            self._busy = False
            # 致命错误时保留错误态（JS error 分支显示文案），不再发 stopped 覆盖（R-09-11）
            if not self._fatal_errored:
                self._emit({"type": "ttsState", "state": "stopped"})

    async def _async_synth(self, blocks: list[str], voice: str, rate: str,
                           cache_enabled: bool, doc_id: str | None) -> None:
        import asyncio
        # 懒加载（R-09-09）：到这里才 import edge_tts
        import edge_tts  # noqa: F401  （异常由 _thread_main 兜底落盘）

        total = len(blocks)
        root = cache_root()
        root.mkdir(parents=True, exist_ok=True)
        # 非缓存播放：每会话一个临时子目录，stop/done 后清理
        stream_dir = root / _CORPUS_DIR_NAME / f"s{int(time.time() * 1000)}"
        if not cache_enabled:
            stream_dir.mkdir(parents=True, exist_ok=True)

        mf = self._load_manifest() if cache_enabled else {"docs": {}}
        doc_rec = {"voice": voice, "rate": rate, "hashes": [], "mtime": time.time()}
        if cache_enabled and doc_id:
            # 复用同参数的既有记录，避免二次命中缓存播放时把 hashes 重置为空、
            # 导致缓存文件脱离索引（cache_delete/cache_info 找不到）。
            existing = mf.setdefault("docs", {}).get(doc_id)
            if (existing and existing.get("voice") == voice
                    and existing.get("rate") == rate):
                doc_rec = existing
                doc_rec["mtime"] = time.time()
            else:
                mf["docs"][doc_id] = doc_rec

        self._emit({"type": "ttsState", "state": "playing"})
        skipped = 0
        try:
            for i, text in enumerate(blocks):
                # 暂停闸门（R-09-03：不阻塞主线程，仅在该协程内等待）
                while self._pause_evt.is_set() and not self._stop_evt.is_set():
                    await asyncio.sleep(0.05)
                if self._stop_evt.is_set():
                    return

                key = _chunk_key(voice, rate, text)
                cached_path = root / f"{key}.mp3"
                live_path = cached_path if cache_enabled else stream_dir / f"{i:05d}.mp3"
                cached = cache_enabled and cached_path.exists() and cached_path.stat().st_size > 0

                if not cached:
                    result = await self._synth_one(edge_tts, text, voice, rate, live_path)
                    if result == "fatal":
                        self._emit({"type": "ttsError", "message": "合成失败，已停止播放",
                                    "fatal": True})
                        return
                    if result == "skip":
                        if self._stop_evt.is_set():
                            return  # 用户主动停止，不作跳过处理
                        skipped += 1
                        _log_error(f"第 {i + 1}/{total} 块空音频，已跳过（voice={voice}）")
                        self._emit({"type": "ttsSkip", "index": i + 1, "total": total})
                        continue  # 跳过该块，继续后续（R-09-08）

                if cache_enabled and key not in doc_rec["hashes"]:
                    doc_rec["hashes"].append(key)  # 命中旧块也补登索引，保证 manifest 完整
                    self._save_manifest(mf)  # 每块落一次，崩溃不丢已缓存块索引

                self._emit({"type": "ttsChunk", "index": i,
                            "path": str(live_path), "cached": cached})
                self._emit({"type": "ttsProgress", "index": i + 1, "total": total,
                            "percent": int((i + 1) * 100 / total)})
                # 背压（R-09-12）：等这块真正播完再合成下一块，避免 ttsDone 提前清理
                await self._await_played(i)

            if cache_enabled and doc_id:
                self._save_manifest(mf)
            if skipped == total:
                # 全部块均空音频：整篇等于没播，提示用户（R-09-08）
                self._emit({"type": "ttsError",
                            "message": "全部段落均无音频，播放失败（可换音色重试）",
                            "fatal": True})
            else:
                self._emit({"type": "ttsDone"})
        finally:
            # 非缓存会话：播完/停止即清理临时音频
            if not cache_enabled and stream_dir.exists():
                shutil.rmtree(stream_dir, ignore_errors=True)

    async def _synth_one(self, edge_tts, text: str, voice: str, rate: str,
                         out_path: Path) -> str:
        """合成单块：指数退避 + jitter 重试（R-09-08）。

        返回三态（由调用方决定如何上抛，R-09-08/R-09-11）：
        - "ok"    成功
        - "skip"  空音频类失败（NoAudioReceived / 0 字节）——非致命，跳过该块
        - "fatal" 其他端点错误（429/403/网络等）重试耗尽——致命
        """
        last = ""
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                comm = edge_tts.Communicate(text, voice, rate=rate)
                tmp = out_path.with_suffix(".part")
                with tmp.open("wb") as f:
                    async for msg in comm.stream():
                        if self._stop_evt.is_set():
                            try:
                                tmp.unlink()
                            except OSError:
                                pass
                            return "skip"  # 用户主动停止，交由上层判断
                        if msg.get("type") == "audio":
                            f.write(msg["data"])
                if tmp.stat().st_size <= 0:
                    raise RuntimeError("合成返回空音频")
                tmp.replace(out_path)
                return "ok"
            except Exception as exc:
                last = f"{type(exc).__name__}: {exc}"
                _log_error(f"合成失败 attempt={attempt}/{MAX_RETRIES} voice={voice}: {last}")
                # 空音频类错误：非致命，重试耗尽后跳过该块（R-09-08）
                empty_audio = ("NoAudioReceived" in last or "空音频" in last)
                if attempt == MAX_RETRIES:
                    return "skip" if empty_audio else "fatal"
                delay = RETRY_BASE_S * (2 ** (attempt - 1)) + random.uniform(0, 0.4)
                await _async_sleep(delay)
        return "fatal"


    async def _await_played(self, index: int) -> None:
        """背压门控（R-09-12）：等待 JS 确认第 index 块播放结束，才继续合成下一块。

        用 asyncio.sleep 轮询，不阻塞事件循环；stop 或确认到达即返回；15 分钟
        兜底超时（单块音频最多约 8 分钟）防止 JS 未回传导致永久卡死。
        """
        import asyncio
        deadline = time.monotonic() + 900
        while True:
            if self._stop_evt.is_set():
                return
            with self._played_lock:
                if index in self._played:
                    return
            if time.monotonic() > deadline:
                _log_error(f"第 {index + 1} 块播放确认超时，继续（背压兜底）")
                return
            await asyncio.sleep(0.1)


async def _async_sleep(seconds: float) -> None:
    import asyncio
    await asyncio.sleep(seconds)
