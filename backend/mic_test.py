#!/usr/bin/env python3
"""
mic_test.py — 5-second microphone signal verification.

Two modes:
  REAL  — captures 5s from the default input device via sounddevice.
  SIM   — generates a synthetic 440 Hz tone (used in headless/CI environments
           where no audio hardware is present). Validates the WAV encoding
           pipeline without needing a physical microphone.

Run: python3 mic_test.py [--sim]
"""

import io
import os
import sys
import time
import wave
import queue
import argparse
import numpy as np

SAMPLE_RATE    = 16_000
CHANNELS       = 1
DTYPE          = "int16"
BLOCKSIZE      = 1_024
RECORD_SECONDS = 5
OUTPUT_WAV     = "/tmp/mic_test_output.wav"

# ── CLI arg ────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--sim", action="store_true",
                    help="Synthetic signal mode (no hardware required)")
args = parser.parse_args()

print("=" * 52)
print("  DRIS//CORE — Microphone Signal Check")
print("=" * 52)

# ── Auto-detect headless ───────────────────────────────────────────────────────
def _has_audio_hw() -> bool:
    """Return True if ALSA or /dev/snd devices exist."""
    import os.path
    return os.path.isdir("/dev/snd") and bool(os.listdir("/dev/snd"))

headless = args.sim or not _has_audio_hw()

if headless:
    print("\n  MODE: Synthetic signal (headless / no audio hardware)")
    print(f"  Generating {RECORD_SECONDS}s of 440 Hz tone at {SAMPLE_RATE} Hz ...\n")

    t   = np.linspace(0, RECORD_SECONDS, SAMPLE_RATE * RECORD_SECONDS, endpoint=False)
    pcm = (np.sin(2 * np.pi * 440 * t) * 16_000).astype(np.int16).reshape(-1, 1)

else:
    try:
        import sounddevice as sd
    except (ImportError, OSError) as e:
        print(f"\n  sounddevice unavailable: {e}")
        print("  Install: sudo apt install libportaudio2  &&  pip install sounddevice")
        sys.exit(1)

    devices      = sd.query_devices()
    input_devices = [(i, d) for i, d in enumerate(devices) if d["max_input_channels"] > 0]

    if not input_devices:
        sys.exit("FAIL: No input devices found. Connect a microphone and retry.")

    print(f"\n  MODE: Real hardware capture")
    print(f"  Detected {len(input_devices)} input device(s):")
    for idx, d in input_devices:
        marker = " ◀ DEFAULT" if idx == sd.default.device[0] else ""
        print(f"    [{idx}] {d['name']}{marker}")

    default_in = sd.default.device[0]
    print(f"\n  Using device [{default_in}]: {devices[default_in]['name']}")
    print(f"\n  Listening for {RECORD_SECONDS} seconds ... (speak now)")
    print("-" * 52)

    frames: list[np.ndarray] = []
    q: queue.Queue           = queue.Queue()

    def _cb(indata, frame_count, time_info, status):
        if status:
            print(f"  [!] {status}")
        q.put(indata.copy())

    start = time.perf_counter()
    with sd.InputStream(
        samplerate = SAMPLE_RATE,
        channels   = CHANNELS,
        dtype      = DTYPE,
        blocksize  = BLOCKSIZE,
        callback   = _cb,
    ):
        while time.perf_counter() - start < RECORD_SECONDS:
            try:
                frames.append(q.get(timeout=0.5))
            except queue.Empty:
                pass

    if not frames:
        sys.exit("FAIL: No audio frames captured.")

    pcm = np.concatenate(frames, axis=0)

# ── Analyse ────────────────────────────────────────────────────────────────────
rms  = float(np.sqrt(np.mean(pcm.astype(np.float32) ** 2)))
peak = int(np.abs(pcm).max())

print(f"  Frames captured : {len(pcm):,}")
print(f"  RMS amplitude   : {rms:.1f}")
print(f"  Peak amplitude  : {peak}")

# ── WAV encode ─────────────────────────────────────────────────────────────────
buf = io.BytesIO()
with wave.open(buf, "wb") as wf:
    wf.setnchannels(CHANNELS)
    wf.setsampwidth(2)
    wf.setframerate(SAMPLE_RATE)
    wf.writeframes(pcm.tobytes())
wav_bytes = buf.getvalue()

with open(OUTPUT_WAV, "wb") as f:
    f.write(wav_bytes)

size_kb = len(wav_bytes) / 1024
print(f"  WAV size        : {size_kb:.1f} KB")
print(f"  Written to      : {OUTPUT_WAV}")

# ── WAV integrity check ─────────────────────────────────────────────────────────
try:
    with wave.open(OUTPUT_WAV, "rb") as verify:
        assert verify.getnchannels()  == CHANNELS,    "Bad channel count"
        assert verify.getframerate()  == SAMPLE_RATE, "Bad sample rate"
        assert verify.getsampwidth()  == 2,           "Bad sample width"
        assert verify.getnframes()    >  0,           "Zero frames"
    print("  WAV integrity   : OK")
except (AssertionError, wave.Error) as e:
    print(f"FAIL: WAV integrity check failed — {e}")
    sys.exit(1)

# ── Result ─────────────────────────────────────────────────────────────────────
print("\n" + "=" * 52)
if headless:
    print("  PASS ✓  Synthetic WAV pipeline verified.")
    print("  WAV encoding → file write → integrity check: all GREEN.")
    print()
    print("  On your local machine with a mic attached, run:")
    print("    python3 mic_test.py          (real hardware mode)")
    print()
    print("  Required on your machine:")
    print("    sudo apt install libportaudio2 portaudio19-dev ffmpeg")
    print("    pip install sounddevice")
elif rms < 1.0:
    print("  WARNING: Low signal (RMS < 1). Check mic input volume.")
    print("  The Ear is open but very quiet.")
else:
    print(f"  PASS ✓  The Ear is receiving signal.  RMS={rms:.0f}")
    print("  Pipeline is READY for Whisper ingestion.")
print("=" * 52)
