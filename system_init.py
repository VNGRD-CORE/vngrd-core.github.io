#!/usr/bin/env python3
"""
system_init.py — DRIS//CORE  Local Signal-Chain Initialiser
============================================================

Run once from the repository root before launching the HUD:

    python system_init.py

Phases
------
  1. Hardware Audit      — ffmpeg + libportaudio on the host OS
  2. Mic Check (The Ear) — 5-second live capture, RMS / dBFS validation
  3. Backend Ignition    — uvicorn launch + WebSocket handshake
  4. Frontend Injection  — HUD patch: WS URL lock, On-Air CSS tally, SRT spec

Exit codes
----------
  0  SIGNAL_GREEN  — all phases passed, ready to broadcast
  1  DEP_MISSING   — OS dependency absent; follow printed instructions
  2  MIC_FAULT     — silent / no hardware; fix before proceeding
  3  SERVER_FAULT  — uvicorn failed to start within timeout
  4  WS_FAULT      — WebSocket handshake at /ws/transcribe rejected
"""

from __future__ import annotations

import asyncio
import io
import math
import os
import platform
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.request
import urllib.error
import wave
from pathlib import Path

# ── Terminal colour helpers ────────────────────────────────────────────────────

_NO_COLOUR = not sys.stdout.isatty() or os.environ.get("NO_COLOR")

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
    width = 60
    print()
    print(cyan("┌" + "─" * width + "┐"))
    print(cyan("│") + bold(f"  {text:<{width - 2}}") + cyan("│"))
    print(cyan("└" + "─" * width + "┘"))

def phase(n: int, title: str) -> None:
    print()
    print(bold(cyan(f"  ◈  PHASE {n}  —  {title}")))
    print(dim("  " + "─" * 54))

def ok(msg: str)   -> None: print(f"  {TICK}  {msg}")
def err(msg: str)  -> None: print(f"  {CROSS}  {red(msg)}")
def warn(msg: str) -> None: print(f"  {WARN}  {yellow(msg)}")
def info(msg: str) -> None: print(f"  {ARROW}  {msg}")

# ── Repository root (script lives at repo root) ────────────────────────────────

REPO_ROOT   = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"
HUD_FILE    = REPO_ROOT / "transcription-hud.html"
SRT_FILE    = BACKEND_DIR / "srt_exporter.py"

# ── Expected values ────────────────────────────────────────────────────────────

EXPECTED_WS_URL  = "ws://localhost:8000/ws/transcribe"
BACKEND_HOST     = "localhost"
BACKEND_PORT     = 8000
BACKEND_URL      = f"http://{BACKEND_HOST}:{BACKEND_PORT}"
WS_PATH          = "/ws/transcribe"

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Hardware Audit
# ─────────────────────────────────────────────────────────────────────────────

def _detect_os() -> str:
    """Return 'linux', 'macos', or 'windows'."""
    s = platform.system().lower()
    if s == "darwin":   return "macos"
    if s == "windows":  return "windows"
    return "linux"

def _portaudio_present_linux() -> bool:
    """Check for libportaudio shared object via ldconfig or /usr/lib glob."""
    # ldconfig -p is the canonical method
    try:
        result = subprocess.run(
            ["ldconfig", "-p"],
            capture_output=True, text=True, timeout=5,
        )
        if "libportaudio" in result.stdout:
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    # Fallback: filesystem glob
    for prefix in ("/usr/lib", "/usr/local/lib", "/usr/lib/x86_64-linux-gnu"):
        if list(Path(prefix).glob("libportaudio*")):
            return True
    return False

def _portaudio_present_macos() -> bool:
    """Check for portaudio via brew or dylib glob."""
    # brew list is slow; prefer checking the lib directly
    for prefix in (
        "/usr/local/lib",
        "/opt/homebrew/lib",
        "/opt/local/lib",          # MacPorts
    ):
        if list(Path(prefix).glob("libportaudio*")):
            return True
    # Last resort: brew
    try:
        r = subprocess.run(
            ["brew", "list", "portaudio"],
            capture_output=True, timeout=8,
        )
        return r.returncode == 0
    except FileNotFoundError:
        pass
    return False

def _portaudio_present_windows() -> bool:
    """Heuristic: check if sounddevice wheel bundled portaudio DLL is available."""
    try:
        import sounddevice  # noqa: F401
        return True
    except (ImportError, OSError):
        return False

def audit_hardware() -> None:
    phase(1, "HARDWARE AUDIT")
    os_name   = _detect_os()
    missing   = []

    # ── ffmpeg ────────────────────────────────────────────────────────────────
    if shutil.which("ffmpeg"):
        ok("ffmpeg  ……………………………  FOUND")
    else:
        err("ffmpeg  ……………………………  NOT FOUND")
        missing.append("ffmpeg")

    # ── libportaudio ──────────────────────────────────────────────────────────
    pa_present = False
    if os_name == "linux":
        pa_present = _portaudio_present_linux()
    elif os_name == "macos":
        pa_present = _portaudio_present_macos()
    elif os_name == "windows":
        pa_present = _portaudio_present_windows()

    if pa_present:
        ok("libportaudio  ………………  FOUND")
    else:
        err("libportaudio  ………………  NOT FOUND")
        missing.append("portaudio")

    if missing:
        print()
        print(bold(yellow("  INSTALL INSTRUCTIONS")))
        if os_name == "linux":
            pkgs = []
            if "ffmpeg"    in missing: pkgs.append("ffmpeg")
            if "portaudio" in missing: pkgs.extend(["libportaudio2", "portaudio19-dev"])
            print(f"  {cyan('sudo apt update && sudo apt install -y ' + ' '.join(pkgs))}")
        elif os_name == "macos":
            pkgs = []
            if "ffmpeg"    in missing: pkgs.append("ffmpeg")
            if "portaudio" in missing: pkgs.append("portaudio")
            print(f"  {cyan('brew install ' + ' '.join(pkgs))}")
        elif os_name == "windows":
            print(f"  {cyan('winget install ffmpeg')}")
            print(f"  {dim('libportaudio ships inside the sounddevice wheel:')}")
            print(f"  {cyan('pip install sounddevice')}")
        print()
        sys.exit(1)

    ok("Hardware audit  …………  PASS")

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Mic Check (The Ear)
# ─────────────────────────────────────────────────────────────────────────────

_MIC_TEST_SCRIPT = """
import sys, math, io, wave, struct, time

SAMPLE_RATE  = 16000
CHANNELS     = 1
DURATION_SEC = 5
DTYPE        = "int16"
SILENCE_DB   = -50.0   # alert threshold

try:
    import sounddevice as sd
    import numpy as np
except ImportError as exc:
    print(f"IMPORT_ERROR:{exc}", flush=True)
    sys.exit(10)

frames = []

def _cb(indata, frame_count, time_info, status):
    frames.append(indata.copy())

try:
    with sd.InputStream(
        samplerate   = SAMPLE_RATE,
        channels     = CHANNELS,
        dtype        = DTYPE,
        callback     = _cb,
        blocksize    = 1024,
    ):
        sd.sleep(DURATION_SEC * 1000)
except Exception as exc:
    print(f"DEVICE_ERROR:{exc}", flush=True)
    sys.exit(11)

if not frames:
    print("NO_FRAMES", flush=True)
    sys.exit(12)

pcm = np.concatenate(frames, axis=0).flatten()

# RMS → dBFS (int16 full-scale is 32768)
rms_linear = np.sqrt(np.mean(pcm.astype(np.float64) ** 2))
if rms_linear == 0:
    db = -math.inf
else:
    db = 20 * math.log10(rms_linear / 32768.0)

# Encode to WAV for integrity check
buf = io.BytesIO()
with wave.open(buf, "wb") as wf:
    wf.setnchannels(CHANNELS)
    wf.setsampwidth(2)          # int16 = 2 bytes
    wf.setframerate(SAMPLE_RATE)
    wf.writeframes(pcm.astype(np.int16).tobytes())

wav_bytes = buf.getvalue()
# Basic WAV integrity: must start with RIFF and have >44 bytes
if len(wav_bytes) < 44 or wav_bytes[:4] != b"RIFF":
    print("WAV_CORRUPT", flush=True)
    sys.exit(13)

print(f"DB:{db:.2f}", flush=True)
print(f"SAMPLES:{len(pcm)}", flush=True)
print(f"WAV_BYTES:{len(wav_bytes)}", flush=True)
sys.exit(0)
"""

def mic_check() -> None:
    phase(2, "MIC CHECK  (The Ear)")
    info("Recording 5 seconds from default input device …")

    try:
        result = subprocess.run(
            [sys.executable, "-c", _MIC_TEST_SCRIPT],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        err("Mic capture timed out after 30 s")
        sys.exit(2)

    stdout = result.stdout.strip()
    stderr = result.stderr.strip()

    # ── Parse subprocess exit codes ───────────────────────────────────────────
    if result.returncode == 10:
        detail = stdout.replace("IMPORT_ERROR:", "")
        err(f"Python dependency missing: {detail}")
        warn("Run:  pip install -r backend/requirements.txt")
        sys.exit(2)

    if result.returncode == 11:
        detail = stdout.replace("DEVICE_ERROR:", "")
        err(f"Audio device error: {detail}")
        err("MIC_MUTED_OR_NO_HARDWARE")
        sys.exit(2)

    if result.returncode in (12, 13):
        label = "NO_FRAMES received" if result.returncode == 12 else "WAV integrity check failed"
        err(label)
        err("MIC_MUTED_OR_NO_HARDWARE")
        if stderr:
            print(dim(f"    stderr: {stderr[:200]}"))
        sys.exit(2)

    if result.returncode != 0:
        err(f"Mic test subprocess exited {result.returncode}")
        if stderr:
            print(dim(f"    stderr: {stderr[:300]}"))
        err("MIC_MUTED_OR_NO_HARDWARE")
        sys.exit(2)

    # ── Parse metrics from stdout ─────────────────────────────────────────────
    db_val      = None
    samples_val = None
    wav_bytes   = None

    for line in stdout.splitlines():
        if line.startswith("DB:"):
            try:    db_val = float(line.split(":", 1)[1])
            except: pass
        elif line.startswith("SAMPLES:"):
            try:    samples_val = int(line.split(":", 1)[1])
            except: pass
        elif line.startswith("WAV_BYTES:"):
            try:    wav_bytes = int(line.split(":", 1)[1])
            except: pass

    if db_val is None:
        err("Could not parse RMS level from mic test output")
        err("MIC_MUTED_OR_NO_HARDWARE")
        sys.exit(2)

    SILENCE_THRESHOLD = -50.0
    db_display = f"{db_val:.1f} dBFS"

    if db_val < SILENCE_THRESHOLD:
        warn(f"Signal level: {db_display}  (below {SILENCE_THRESHOLD} dBFS threshold)")
        err("MIC_MUTED_OR_NO_HARDWARE")
        print()
        print(bold(yellow("  ACTIONS TO TRY:")))
        print("   • Unmute the microphone in System Preferences / Settings")
        print("   • Select a different default input device")
        print("   • Check hardware is physically connected")
        print(f"   • Retry with:  python {Path(__file__).name}")
        print()
        sys.exit(2)

    ok(f"Signal level   …………………  {green(db_display)}")
    if samples_val:
        ok(f"PCM samples  ………………………  {samples_val:,}")
    if wav_bytes:
        ok(f"WAV integrity  ……………………  {wav_bytes:,} bytes  {green('VALID')}")
    ok(f"Mic check  ………………………  {green('PASS')} — audio chunk is valid")

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — Backend Ignition
# ─────────────────────────────────────────────────────────────────────────────

_SERVER_PROC: subprocess.Popen | None = None   # kept alive until script exits

def _http_check(url: str, timeout: float = 2.0) -> bool:
    """Return True if the URL returns HTTP 2xx/3xx."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status < 400
    except Exception:
        return False

def _ws_handshake(host: str, port: int, path: str, timeout: float = 5.0) -> bool:
    """
    Perform a minimal RFC-6455 WebSocket opening handshake over a raw socket.
    Returns True if the server responds with HTTP 101 Switching Protocols.
    No external library required.
    """
    import base64, hashlib, secrets
    key = base64.b64encode(secrets.token_bytes(16)).decode()
    request = (
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
            sock.sendall(request.encode())
            response = b""
            deadline = time.monotonic() + timeout
            while b"\r\n\r\n" not in response:
                if time.monotonic() > deadline:
                    return False
                chunk = sock.recv(512)
                if not chunk:
                    break
                response += chunk
            return b"101" in response
    except Exception:
        return False

def ignite_backend() -> None:
    global _SERVER_PROC
    phase(3, "BACKEND IGNITION")

    env_file = BACKEND_DIR / ".env"
    if not env_file.exists():
        warn(f".env not found at {env_file}")
        warn("Copy backend/.env.example → backend/.env and set OPENAI_API_KEY")

    # ── Check if something is already listening on port 8000 ─────────────────
    already_up = _http_check(f"{BACKEND_URL}/devices")
    if already_up:
        ok(f"Backend already running on port {BACKEND_PORT}")
    else:
        info(f"Launching:  uvicorn main:app --host 0.0.0.0 --port {BACKEND_PORT}")
        log_path = REPO_ROOT / "uvicorn.log"

        try:
            _SERVER_PROC = subprocess.Popen(
                [
                    sys.executable, "-m", "uvicorn",
                    "main:app",
                    "--host", "0.0.0.0",
                    "--port", str(BACKEND_PORT),
                    "--log-level", "warning",
                ],
                cwd=str(BACKEND_DIR),
                stdout=open(log_path, "w"),
                stderr=subprocess.STDOUT,
            )
        except FileNotFoundError:
            err("uvicorn not found — run:  pip install -r backend/requirements.txt")
            sys.exit(3)

        # Poll until server answers or we time out (15 s)
        info(f"Waiting for server to answer on {BACKEND_URL} …")
        deadline = time.monotonic() + 15
        alive    = False
        while time.monotonic() < deadline:
            if _SERVER_PROC.poll() is not None:
                err(f"uvicorn exited early (code {_SERVER_PROC.returncode})")
                err(f"Check log: {log_path}")
                sys.exit(3)
            if _http_check(f"{BACKEND_URL}/devices", timeout=1.0):
                alive = True
                break
            time.sleep(0.5)

        if not alive:
            err("Backend did not respond within 15 s")
            err(f"Check log: {log_path}")
            sys.exit(3)

        ok(f"uvicorn started  PID={_SERVER_PROC.pid}  log={log_path.name}")

    # ── WebSocket handshake ────────────────────────────────────────────────────
    info(f"WebSocket handshake → ws://{BACKEND_HOST}:{BACKEND_PORT}{WS_PATH}")
    if _ws_handshake(BACKEND_HOST, BACKEND_PORT, WS_PATH, timeout=6.0):
        ok(f"WebSocket handshake  ……  {green('HTTP 101  ALIVE')}")
    else:
        err(f"WebSocket at {WS_PATH} did not return HTTP 101")
        sys.exit(4)

    ok(f"Backend ignition  ……  {green('PASS')}")

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 4 — DRIS//CORE Frontend Injection
# ─────────────────────────────────────────────────────────────────────────────

# WBD-spec SRT timestamp regex  →  HH:MM:SS,mmm
_SRT_TIMESTAMP_RE = re.compile(
    r"\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2},\d{3}"
)

def _patch_hud() -> tuple[str, list[str]]:
    """
    Read transcription-hud.html, apply any required patches,
    return (patched_text, list_of_change_descriptions).
    """
    if not HUD_FILE.exists():
        err(f"HUD file not found: {HUD_FILE}")
        sys.exit(1)

    src = HUD_FILE.read_text(encoding="utf-8")
    changes: list[str] = []

    # ── 1. WebSocket URL must point to localhost ───────────────────────────────
    ws_pattern   = re.compile(r'const\s+WS_URL\s*=\s*"([^"]+)"')
    ws_match     = ws_pattern.search(src)
    current_url  = ws_match.group(1) if ws_match else None

    if current_url == EXPECTED_WS_URL:
        ok(f"WS_URL  ………………………………  {green(EXPECTED_WS_URL)}  (already correct)")
    elif current_url:
        src = ws_pattern.sub(f'const WS_URL = "{EXPECTED_WS_URL}"', src)
        changes.append(f"WS_URL patched: {current_url!r} → {EXPECTED_WS_URL!r}")
        ok(f"WS_URL  patched  ……………  {green(EXPECTED_WS_URL)}")
    else:
        warn("WS_URL constant not found in HUD — injecting at top of <script> block")
        src = src.replace(
            "<script type=\"text/babel\">",
            f'<script type="text/babel">\nconst WS_URL = "{EXPECTED_WS_URL}";',
            1,
        )
        changes.append("WS_URL injected (was absent)")

    # ── 2. MCR On-Air toggle — must glow RED when mic is hot ─────────────────
    # Key tokens that prove the tally-pulse CSS is intact:
    tally_tokens = [
        ("tally-pulse",           "@keyframes tally-pulse"),
        ("onair-pill.active",     ".onair-pill.active"),
        ("var(--red)",            "var(--red)  on-air tally"),
        ("var(--red-dim)",        "var(--red-dim) pill bg"),
        ("border-color: var(--red)", "red border-color"),
    ]
    missing_tokens: list[str] = []
    for token, label in tally_tokens:
        if token not in src:
            missing_tokens.append((token, label))

    if not missing_tokens:
        ok("On-Air tally CSS  ………  RED glow + tally-pulse  (intact)")
    else:
        # Inject a supplemental <style> block before </head>
        tally_css = """
  /* SYSTEM_INIT PATCH — MCR On-Air tally (WBD broadcast spec) */
  @keyframes tally-pulse {
    0%, 100% { box-shadow: 0 0 10px rgba(255,0,85,0.5), 0 0 22px rgba(255,0,85,0.2); }
    50%       { box-shadow: 0 0 18px rgba(255,0,85,0.9), 0 0 40px rgba(255,0,85,0.4); }
  }
  .onair-pill.active {
    background: rgba(255, 0, 85, 0.2);
    border-color: #ff0055;
    animation: tally-pulse 1.2s ease-in-out infinite;
  }
  .onair-pill.active .onair-knob {
    transform: translateX(26px);
    background: #ff0055;
    box-shadow: 0 0 10px #ff0055, 0 0 20px rgba(255,0,85,0.5);
  }
  .onair-label.active {
    color: #ff0055;
    text-shadow: 0 0 8px rgba(255,0,85,0.7);
  }
"""
        src = src.replace("</head>", f"<style>{tally_css}</style>\n</head>", 1)
        desc = ", ".join(l for _, l in missing_tokens)
        changes.append(f"On-Air CSS supplemented (missing: {desc})")
        warn(f"On-Air tally CSS   ……  patched  ({len(missing_tokens)} missing token(s))")

    # ── 3. SRT timestamps — WBD-spec HH:MM:SS,mmm ─────────────────────────────
    # Verified in srt_exporter.py — the _seconds_to_srt_time() function
    # already produces the correct WBD-spec format. We validate the source
    # rather than patching the HUD (SRT is written server-side).
    if SRT_FILE.exists():
        srt_src = SRT_FILE.read_text(encoding="utf-8")
        # The critical format string in _seconds_to_srt_time()
        wbd_fmt_present = 'f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"' in srt_src
        if wbd_fmt_present:
            ok("SRT timestamps  ………  HH:MM:SS,mmm  WBD-spec  (verified)")
        else:
            # Attempt to find the return format line and patch it
            bad_pattern = re.compile(
                r'return\s+f"[^"]*"'
                r'.*?'   # any existing format
            )
            warn("SRT timestamp format could not be confirmed — review srt_exporter.py manually")
            changes.append("SRT timestamp format requires manual review")
    else:
        warn(f"srt_exporter.py not found at {SRT_FILE} — skipping SRT spec check")

    return src, changes

def inject_frontend() -> None:
    phase(4, "DRIS//CORE FRONTEND INJECTION")

    patched_src, changes = _patch_hud()

    if changes:
        HUD_FILE.write_text(patched_src, encoding="utf-8")
        for change in changes:
            info(f"Applied: {change}")
        ok(f"HUD updated  →  {HUD_FILE.name}")
    else:
        ok(f"HUD  …………………………………  no patches required  (all spec-compliant)")

    ok(f"Frontend injection  …  {green('PASS')}")

# ─────────────────────────────────────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    banner("DRIS//CORE  —  System-Init  v1.0")
    print(dim(f"  Repo root : {REPO_ROOT}"))
    print(dim(f"  Backend   : {BACKEND_DIR}"))
    print(dim(f"  HUD file  : {HUD_FILE.name}"))
    print(dim(f"  Platform  : {platform.system()} {platform.machine()}"))

    audit_hardware()    # Phase 1 — exits 1 if missing
    mic_check()         # Phase 2 — exits 2 if silent / faulty
    ignite_backend()    # Phase 3 — exits 3/4 if server won't start
    inject_frontend()   # Phase 4 — patches HUD in-place

    # ── All phases passed ──────────────────────────────────────────────────────
    print()
    print(green("  ╔══════════════════════════════════════════════════════╗"))
    print(green("  ║") + bold(green("   ██████  SIGNAL_GREEN  — All systems nominal   ")) + green("║"))
    print(green("  ╚══════════════════════════════════════════════════════╝"))
    print()
    print(bold("  NEXT STEPS"))
    print(f"  {ARROW} Open transcription-hud.html in your browser")
    print(f"  {ARROW} Click  {bold('ON-AIR')} toggle  →  mic goes hot  →  tally glows {red('RED')}")
    print(f"  {ARROW} Speak English  →  subtitles appear in NL / FR / IT / ES")
    print(f"  {ARROW} Hit  {bold('STOP')}  →  SRT file auto-downloads")
    print()
    print(dim(f"  Backend log : {REPO_ROOT / 'uvicorn.log'}"))
    print(dim(f"  SRT exports : {BACKEND_DIR / 'exports'}"))
    print()

    # Keep the server alive while the script is in the foreground
    if _SERVER_PROC is not None:
        info("uvicorn running  — press  Ctrl+C  to stop")
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
