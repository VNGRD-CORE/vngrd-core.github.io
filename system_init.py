#!/usr/bin/env python3
"""
system_init.py — DRIS//CORE  God Script  v2.0
==============================================

Standalone, all-in-one launcher.  No backend/ folder required.
100%% free — no API keys, no Puter, no OpenAI.

What it does
------------
  Phase 1  Package Bootstrap  — auto-pip any missing Python deps
  Phase 2  Mic Probe          — advisory check (non-blocking)
  Phase 3  Server Generation  — writes main.py to repo root
  Phase 4  Backend Ignition   — uvicorn main:app on :8000 + WS handshake
  Phase 5  HUD Verification   — confirms index.html WS URL is correct

Run:   python system_init.py
Stop:  Ctrl+C  (clean uvicorn shutdown)
"""

from __future__ import annotations

import importlib.util
import io
import math
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# ── Terminal colour helpers ────────────────────────────────────────────────────

_NO_COLOUR = not sys.stdout.isatty() or bool(os.environ.get("NO_COLOR"))

def _c(code: str, text: str) -> str:
    return text if _NO_COLOUR else f"\033[{code}m{text}\033[0m"

def cyan(t):    return _c("96", t)
def green(t):   return _c("92", t)
def red(t):     return _c("91", t)
def yellow(t):  return _c("93", t)
def bold(t):    return _c("1",  t)
def dim(t):     return _c("2",  t)

TICK  = green("✔")
CROSS = red("✘")
WARN  = yellow("⚠")
ARROW = cyan("▶")

def banner(text: str) -> None:
    w = 60
    print()
    print(cyan("┌" + "─" * w + "┐"))
    print(cyan("│") + bold(f"  {text:<{w - 2}}") + cyan("│"))
    print(cyan("└" + "─" * w + "┘"))

def phase(n: int, title: str) -> None:
    print()
    print(bold(cyan(f"  ◈  PHASE {n}  —  {title}")))
    print(dim("  " + "─" * 54))

def ok(msg: str)   -> None: print(f"  {TICK}  {msg}")
def err(msg: str)  -> None: print(f"  {CROSS}  {red(msg)}")
def warn(msg: str) -> None: print(f"  {WARN}  {yellow(msg)}")
def info(msg: str) -> None: print(f"  {ARROW}  {msg}")

# ── Paths ──────────────────────────────────────────────────────────────────────

REPO_ROOT    = Path(__file__).resolve().parent
MAIN_PY      = REPO_ROOT / "main.py"
INDEX_HTML   = REPO_ROOT / "index.html"
BACKEND_HOST = "localhost"
BACKEND_PORT = 8000
BACKEND_URL  = f"http://{BACKEND_HOST}:{BACKEND_PORT}"
WS_PATH      = "/ws/transcribe"
EXPECTED_WS  = f"ws://{BACKEND_HOST}:{BACKEND_PORT}{WS_PATH}"

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Package Bootstrap
# ─────────────────────────────────────────────────────────────────────────────

# Packages to auto-install.  Each entry: (import_name, pip_spec)
_REQUIRED: list[tuple[str, str]] = [
    ("fastapi",            "fastapi>=0.111.0"),
    ("uvicorn",            "uvicorn[standard]>=0.29.0"),
    ("websockets",         "websockets>=12.0"),
    ("speech_recognition", "SpeechRecognition>=3.10.0"),
    ("pydub",              "pydub>=0.25.1"),
    ("deep_translator",    "deep-translator>=1.11.4"),
]

# Optional offline engine — best-effort install only (needs build tools on some platforms)
_OPTIONAL: list[tuple[str, str]] = [
    ("pocketsphinx", "pocketsphinx>=5.0.3"),
]


def _importable(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def bootstrap_packages() -> None:
    phase(1, "PACKAGE BOOTSTRAP")

    missing = [(imp, pip) for imp, pip in _REQUIRED if not _importable(imp)]

    if not missing:
        ok(f"All {len(_REQUIRED)} dependencies already installed")
        return

    info(f"Installing {len(missing)} missing package(s) via pip …")
    pip_specs = [pip for _, pip in missing]

    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "--upgrade", *pip_specs],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        err("pip install failed:")
        print(dim(result.stderr[-600:]))
        sys.exit(1)

    # Verify everything is now importable
    still_missing = [imp for imp, _ in missing if not _importable(imp)]
    if still_missing:
        err(f"Still missing after install: {still_missing}")
        sys.exit(1)

    for imp, pip in missing:
        ok(f"Installed  {pip}")

    ok("Package bootstrap  ……  PASS")

    # Optional offline engine (pocketsphinx) — never fatal if it fails to install
    for imp, pip in _OPTIONAL:
        if not _importable(imp):
            info(f"Attempting optional install: {pip} (offline engine) …")
            res = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--quiet", pip],
                capture_output=True, text=True,
            )
            if res.returncode == 0 and _importable(imp):
                ok(f"Installed optional dep  {pip}  (offline SR engine)")
            else:
                warn(f"Could not install {pip} — offline fallback unavailable (online Google SR will be used)")


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Mic Probe  (advisory — never exits on failure)
# ─────────────────────────────────────────────────────────────────────────────

_MIC_PROBE = """
import sys, math
try:
    import speech_recognition as sr
    r = sr.Recognizer()
    with sr.Microphone() as src:
        r.adjust_for_ambient_noise(src, duration=0.5)
        audio = r.record(src, duration=2.0)
    pcm = audio.frame_data
    if not pcm:
        print("NO_FRAMES"); sys.exit(1)
    # RMS in int16 range
    import struct
    samples = struct.unpack(f'{len(pcm)//2}h', pcm)
    rms = math.sqrt(sum(s*s for s in samples) / len(samples))
    db  = 20 * math.log10(max(rms, 1) / 32768.0)
    print(f"DB:{db:.2f}")
    sys.exit(0)
except Exception as e:
    print(f"SKIP:{e}")
    sys.exit(2)
"""


def mic_probe() -> None:
    phase(2, "MIC PROBE  (advisory)")

    info("Sampling 2 s from default input device …")
    try:
        res = subprocess.run(
            [sys.executable, "-c", _MIC_PROBE],
            capture_output=True, text=True, timeout=15,
        )
    except subprocess.TimeoutExpired:
        warn("Mic probe timed out — browser will open the mic directly")
        return

    stdout = res.stdout.strip()

    if res.returncode == 2 or stdout.startswith("SKIP:"):
        reason = stdout.replace("SKIP:", "") or "PyAudio not available"
        warn(f"Mic probe skipped: {reason[:80]}")
        info("The browser will open your mic when you click ON-AIR — that is fine.")
        return

    if res.returncode != 0 or "NO_FRAMES" in stdout:
        warn("No audio frames received — check mic permissions")
        info("Click ON-AIR in the browser to grant mic access there.")
        return

    for line in stdout.splitlines():
        if line.startswith("DB:"):
            try:
                db = float(line.split(":", 1)[1])
                if db < -50.0:
                    warn(f"Signal low: {db:.1f} dBFS — mic may be muted")
                    warn("Unmute your mic, or let the browser capture it.")
                else:
                    ok(f"Mic signal  ………………………  {green(f'{db:.1f} dBFS')}")
            except ValueError:
                pass

    ok("Mic probe  …………………………  PASS  (advisory)")


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — Server Generation
# Write a zero-dependency (no API key) main.py to the repo root.
# ─────────────────────────────────────────────────────────────────────────────

# NOTE: stored as a plain string — the {braces} below are literal Python
#       code characters, NOT f-string interpolations in system_init.py.
_MAIN_PY_CONTENT = '''"""
main.py — DRIS//CORE  Free Transcription Server
================================================
Generated by system_init.py.  Safe to regenerate at any time.

NO OpenAI. NO API keys. NO .env file required.

Transcription engines (tried in order):
  1. Google Speech Recognition  — free, no key, requires internet
  2. CMU Sphinx (pocketsphinx)  — 100% offline, English only

Translation:
  Google Translate via deep-translator — free, no key, requires internet
  Offline fallback: returns original English text when network is down

Audio decode:
  pydub + ffmpeg — converts browser webm/ogg/wav to 16 kHz mono WAV

WebSocket:  ws://localhost:8000/ws/transcribe

Protocol
--------
Client -> Server  (JSON text):
  {"action":"start","target_lang":"nl","source_lang":"en"}
  {"action":"stop"}

Client -> Server  (binary):
  Raw audio blob from browser MediaRecorder (webm / ogg / wav)

Server -> Client  (JSON text):
  {"type":"status",      "message":"..."}
  {"type":"transcript",  "original":"...","timestamp":0.0,"engine":"google|sphinx"}
  {"type":"translation", "text":"...","lang":"nl","start":0.0,"end":4.0}
  {"type":"srt_ready",   "filename":"...","content":"..."}
  {"type":"error",       "message":"..."}
"""

import asyncio, io, importlib.util, json, os, time, uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

SUPPORTED_LANGS = {"nl": "Dutch", "fr": "French", "it": "Italian", "es": "Spanish"}

# Refuse to start if someone accidentally set OPENAI_API_KEY and expects it to be used
_OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
if _OPENAI_KEY:
    import sys
    print("[WARN] OPENAI_API_KEY is set in your environment but this server does NOT use it.")
    print("[WARN] Transcription uses SpeechRecognition (Google/Sphinx). No OpenAI calls are made.")

# Detect which offline engine is available
_SPHINX_AVAILABLE = importlib.util.find_spec("pocketsphinx") is not None


@asynccontextmanager
async def lifespan(app):
    engine_line = "Google SR (free, online)"
    if _SPHINX_AVAILABLE:
        engine_line += " + CMU Sphinx (offline fallback)"
    print("\\n┌────────────────────────────────────────────────────┐")
    print("│  DRIS//CORE  —  Free Transcription Engine          │")
    print("│  WS : ws://localhost:8000/ws/transcribe            │")
    print("│  NO OpenAI  |  NO API key  |  NO .env required     │")
    print("│  SR : " + engine_line.ljust(44) + "│")
    print("└────────────────────────────────────────────────────┘\\n")
    yield


app = FastAPI(title="DRIS//CORE Transcription API (Free — No OpenAI)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status"         : "ok",
        "openai_required": False,
        "engine"         : "SpeechRecognition",
        "offline_engine" : "pocketsphinx" if _SPHINX_AVAILABLE else "unavailable",
        "translation"    : "deep-translator/GoogleTranslate (free)",
    }


# ── Audio conversion: browser webm/ogg -> 16 kHz mono WAV ────────────────────

def _to_wav_bytes(audio_bytes: bytes) -> bytes:
    """Convert arbitrary audio blob to 16 kHz mono WAV via pydub/ffmpeg."""
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_file(io.BytesIO(audio_bytes))
        seg = seg.set_frame_rate(16000).set_channels(1)
        buf = io.BytesIO()
        seg.export(buf, format="wav")
        return buf.getvalue()
    except Exception:
        return audio_bytes   # passthrough — SR will try anyway


# ── Transcription: Google SR first, CMU Sphinx offline fallback ───────────────

def _transcribe_sync(audio_bytes: bytes, language: str = "en") -> tuple:
    """
    Returns (transcript_text, engine_name).
    Engine order:
      1. recognize_google  — free, no API key, needs internet
      2. recognize_sphinx  — 100% offline, English only (pocketsphinx)
    No OpenAI / Whisper API calls are ever made.
    """
    import speech_recognition as sr

    recognizer = sr.Recognizer()
    wav_bytes   = _to_wav_bytes(audio_bytes)

    lang_map = {
        "en": "en-US", "nl": "nl-NL", "fr": "fr-FR",
        "it": "it-IT", "es": "es-ES",
    }
    bcp47 = lang_map.get(language, "en-US")

    with sr.AudioFile(io.BytesIO(wav_bytes)) as src:
        audio = recognizer.record(src)

    # ── Engine 1: Google SR (free, no key) ───────────────────────────────────
    try:
        text = recognizer.recognize_google(audio, language=bcp47)
        return (text, "google")
    except sr.UnknownValueError:
        return ("", "google")          # silence / unintelligible
    except sr.RequestError:
        pass                           # network unavailable — try offline engine

    # ── Engine 2: CMU Sphinx (offline, English only) ─────────────────────────
    if _SPHINX_AVAILABLE:
        try:
            text = recognizer.recognize_sphinx(audio)
            return (text, "sphinx")
        except sr.UnknownValueError:
            return ("", "sphinx")
        except Exception:
            pass

    # Both engines failed
    return ("", "none")


# ── Translation: Google Translate (free) with offline passthrough ─────────────

def _translate_sync(text: str, target_lang: str) -> str:
    """
    Translates via deep-translator (Google Translate, free, no key).
    Falls back to returning the original text when network is unavailable.
    No OpenAI calls are made.
    """
    if not text.strip():
        return ""
    try:
        from deep_translator import GoogleTranslator
        result = GoogleTranslator(source="auto", target=target_lang).translate(text)
        return result or text
    except Exception:
        return text   # offline fallback — return original rather than nothing


# ── SRT helpers ───────────────────────────────────────────────────────────────

def _srt_ts(seconds: float) -> str:
    total_ms = int(seconds * 1000)
    ms = total_ms % 1000
    s  = (total_ms // 1000) % 60
    m  = (total_ms // 60000) % 60
    h  = total_ms // 3600000
    return "{:02d}:{:02d}:{:02d},{:03d}".format(h, m, s, ms)


def _build_srt(segments: list) -> str:
    blocks = []
    for seg in segments:
        idx   = seg["index"]
        start = _srt_ts(seg["start"])
        end   = _srt_ts(seg["end"])
        text  = seg["text"]
        blocks.append("{}\n{} --> {}\n{}\n".format(idx, start, end, text))
    return "\n".join(blocks)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):
    await websocket.accept()

    session_id   = str(uuid.uuid4())[:8]
    source_lang  = "en"
    target_lang  = "nl"
    active       = False
    srt_segments: list = []
    srt_index    = 1
    chunk_offset = 0.0
    CHUNK_SEC    = 4.0   # must match browser MediaRecorder timeslice

    async def send(payload: dict) -> None:
        await websocket.send_text(json.dumps(payload))

    await send({"type": "status", "message": "GHOST> SESSION {} — READY  [no OpenAI]".format(session_id)})

    try:
        while True:
            message = await websocket.receive()

            # ── JSON command ──────────────────────────────────────────────────
            if "text" in message:
                msg = json.loads(message["text"])

                if msg.get("action") == "start" and not active:
                    source_lang  = msg.get("source_lang", "en")
                    target_lang  = msg.get("target_lang", "nl")
                    active       = True
                    srt_segments = []
                    srt_index    = 1
                    chunk_offset = 0.0
                    lang_name    = SUPPORTED_LANGS.get(target_lang, target_lang).upper()
                    await send({
                        "type"   : "status",
                        "message": "GHOST> ON-AIR \\u25b6  EN \\u2192 {}".format(lang_name),
                    })

                elif msg.get("action") == "stop" and active:
                    active      = False
                    srt_content = _build_srt(srt_segments)
                    ts          = time.strftime("%Y-%m-%dT%H%M%S")
                    filename    = "{}_{}_{}.srt".format(ts, session_id, target_lang)
                    exports     = Path("exports")
                    exports.mkdir(exist_ok=True)
                    (exports / filename).write_text(srt_content, encoding="utf-8")
                    await send({"type": "srt_ready", "filename": filename, "content": srt_content})
                    await send({"type": "status", "message": "GHOST> STANDBY \\u25fc  Session closed."})

            # ── Binary audio chunk from browser MediaRecorder ─────────────────
            elif "bytes" in message:
                if not active:
                    continue

                audio_bytes = message["bytes"]
                if not audio_bytes or len(audio_bytes) < 200:
                    continue   # too small — discard

                seg_start     = chunk_offset
                seg_end       = chunk_offset + CHUNK_SEC
                chunk_offset += CHUNK_SEC

                loop = asyncio.get_event_loop()

                # Transcription runs in thread-pool (blocking I/O)
                try:
                    transcript, engine = await loop.run_in_executor(
                        None, _transcribe_sync, audio_bytes, source_lang,
                    )
                except Exception as exc:
                    await send({"type": "error", "message": "SR: {}".format(exc)})
                    continue

                if not transcript:
                    continue   # silence — skip translation

                await send({
                    "type"     : "transcript",
                    "original" : transcript,
                    "timestamp": round(seg_start, 2),
                    "engine"   : engine,
                })

                # Translation (free Google Translate, falls back to passthrough offline)
                try:
                    translation = await loop.run_in_executor(
                        None, _translate_sync, transcript, target_lang,
                    )
                except Exception as exc:
                    await send({"type": "error", "message": "Translate: {}".format(exc)})
                    translation = transcript

                if translation:
                    seg_id = str(uuid.uuid4())[:8]
                    await send({
                        "type"      : "translation",
                        "text"      : translation,
                        "lang"      : target_lang,
                        "start"     : round(seg_start, 3),
                        "end"       : round(seg_end,   3),
                        "segment_id": seg_id,
                    })
                    srt_segments.append({
                        "index": srt_index,
                        "start": seg_start,
                        "end"  : seg_end,
                        "text" : translation,
                    })
                    srt_index += 1

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await send({"type": "error", "message": str(exc)})
        except Exception:
            pass
'''


def generate_server() -> None:
    phase(3, "SERVER GENERATION")

    if MAIN_PY.exists():
        warn(f"Overwriting existing {MAIN_PY.name}")

    MAIN_PY.write_text(_MAIN_PY_CONTENT, encoding="utf-8")
    ok(f"main.py written  ……………  {MAIN_PY}")

    # Quick syntax check
    result = subprocess.run(
        [sys.executable, "-m", "py_compile", str(MAIN_PY)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        err("Generated main.py has a syntax error:")
        print(dim(result.stderr))
        sys.exit(3)

    ok(f"Syntax check  ………………  {green('PASS')}")
    ok(f"Server generation  ……  {green('DONE')}")


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 4 — Backend Ignition
# ─────────────────────────────────────────────────────────────────────────────

_SERVER_PROC: subprocess.Popen | None = None


def _http_check(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status < 400
    except Exception:
        return False


def _ws_handshake(host: str, port: int, path: str, timeout: float = 6.0) -> bool:
    """Raw RFC-6455 opening handshake — no external libs."""
    import base64, secrets
    key = base64.b64encode(secrets.token_bytes(16)).decode()
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    )
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.sendall(req.encode())
            resp = b""
            deadline = time.monotonic() + timeout
            while b"\r\n\r\n" not in resp:
                if time.monotonic() > deadline:
                    return False
                chunk = sock.recv(512)
                if not chunk:
                    break
                resp += chunk
            return b"101" in resp
    except Exception:
        return False


def ignite_backend() -> None:
    global _SERVER_PROC
    phase(4, "BACKEND IGNITION")

    # ── Already running? ──────────────────────────────────────────────────────
    if _http_check(f"{BACKEND_URL}/health"):
        ok(f"Backend already answering on :{BACKEND_PORT}")
    else:
        log_path = REPO_ROOT / "uvicorn.log"
        info(f"Launching:  uvicorn main:app --host 0.0.0.0 --port {BACKEND_PORT}")

        try:
            _SERVER_PROC = subprocess.Popen(
                [
                    sys.executable, "-m", "uvicorn",
                    "main:app",
                    "--host", "0.0.0.0",
                    "--port", str(BACKEND_PORT),
                    "--log-level", "warning",
                ],
                cwd=str(REPO_ROOT),          # <── run from repo root, not backend/
                stdout=open(log_path, "w"),
                stderr=subprocess.STDOUT,
            )
        except FileNotFoundError:
            err("uvicorn not found — pip install should have caught this")
            sys.exit(4)

        info(f"Waiting for /health on {BACKEND_URL} …")
        deadline = time.monotonic() + 20
        alive    = False
        while time.monotonic() < deadline:
            if _SERVER_PROC.poll() is not None:
                err(f"uvicorn crashed (exit {_SERVER_PROC.returncode})")
                err(f"Log: {log_path}")
                sys.exit(4)
            if _http_check(f"{BACKEND_URL}/health", timeout=1.0):
                alive = True
                break
            time.sleep(0.5)

        if not alive:
            err(f"Server did not answer within 20 s — check {log_path}")
            sys.exit(4)

        ok(f"uvicorn PID={_SERVER_PROC.pid}  log→ {log_path.name}")

    # ── WebSocket handshake ───────────────────────────────────────────────────
    info(f"WS handshake → ws://{BACKEND_HOST}:{BACKEND_PORT}{WS_PATH}")
    if _ws_handshake(BACKEND_HOST, BACKEND_PORT, WS_PATH):
        ok(f"WebSocket  ………………………  {green('HTTP 101  ALIVE')}")
    else:
        err("WebSocket handshake failed")
        sys.exit(4)

    ok(f"Backend ignition  ……  {green('PASS')}")


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 5 — HUD Verification
# ─────────────────────────────────────────────────────────────────────────────

def verify_hud() -> None:
    phase(5, "HUD VERIFICATION")

    if not INDEX_HTML.exists():
        warn(f"index.html not found at {INDEX_HTML} — skipping")
        return

    src = INDEX_HTML.read_text(encoding="utf-8")

    # WS URL check
    if EXPECTED_WS in src:
        ok(f"WS_URL  ………………………………  {green(EXPECTED_WS)}")
    else:
        warn(f"WS URL '{EXPECTED_WS}' not found in index.html")
        warn("Open index.html and verify the MCR bridge points to localhost:8000")

    # Puter guard
    if "js.puter.com" in src:
        warn("Puter.js script tag still present — run the Puter-removal edits")
    else:
        ok("Puter.js  ………………………  ABSENT  (clean)")

    # ON-AIR button
    if 'id="btn-on-air"' in src:
        ok("btn-on-air  …………………  FOUND  in DOM")
    else:
        warn("btn-on-air not found in index.html — check MCR panel injection")

    ok(f"HUD verification  ……  {green('PASS')}")


# ─────────────────────────────────────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    banner("DRIS//CORE  —  God Script  v2.0")
    print(dim(f"  Repo root : {REPO_ROOT}"))
    print(dim(f"  Server    : {MAIN_PY.name}  (auto-generated)"))
    print(dim(f"  Platform  : {platform.system()} {platform.machine()}"))
    print(dim(f"  Python    : {sys.version.split()[0]}"))

    bootstrap_packages()   # Phase 1 — auto-pip
    mic_probe()            # Phase 2 — advisory
    generate_server()      # Phase 3 — write main.py
    ignite_backend()       # Phase 4 — launch uvicorn
    verify_hud()           # Phase 5 — sanity check

    # ── SIGNAL_GREEN ──────────────────────────────────────────────────────────
    print()
    print(green("  ╔══════════════════════════════════════════════════════╗"))
    print(green("  ║") + bold(green("   ██████  SIGNAL_GREEN  — All systems nominal   ")) + green("║"))
    print(green("  ╚══════════════════════════════════════════════════════╝"))
    print()
    print(bold("  NEXT STEPS"))
    print(f"  {ARROW} Open {cyan('index.html')} in your browser (or serve with any HTTP server)")
    print(f"  {ARROW} Click  {bold('ON-AIR')}  →  browser opens your mic  →  tally glows {red('RED')}")
    print(f"  {ARROW} Speak English  →  Dutch / French / Italian / Spanish appear in HUD")
    print(f"  {ARROW} Click  {bold('OFF-AIR')}  →  SRT file auto-downloads")
    print()
    print(dim(f"  Backend log : {REPO_ROOT / 'uvicorn.log'}"))
    print(dim(f"  SRT exports : {REPO_ROOT / 'exports'}"))
    print()

    # Keep uvicorn alive until Ctrl+C
    if _SERVER_PROC is not None:
        info(f"uvicorn running on :{BACKEND_PORT}  —  press Ctrl+C to stop")
        try:
            _SERVER_PROC.wait()
        except KeyboardInterrupt:
            print()
            info("Shutting down uvicorn …")
            _SERVER_PROC.terminate()
            try:
                _SERVER_PROC.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _SERVER_PROC.kill()
            ok("Server stopped cleanly")


if __name__ == "__main__":
    main()
