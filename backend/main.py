"""
main.py — FastAPI WebSocket server for the real-time transcription/translation
signal chain.

Signal flow:
    Microphone → PyAudio → Whisper API → GPT-4o → WebSocket → React HUD
                                                             → SRT file

Start the server:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Environment variables (see .env):
    OPENAI_API_KEY   — required
    SOURCE_LANG      — ISO-639-1, defaults to "en"
    MIC_DEVICE_INDEX — optional integer, auto-selects default device if omitted
"""

import asyncio
import json
import os
import time
import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from audio_capture import MicrophoneCapture, list_input_devices
from transcriber   import transcribe_with_timestamps
from translator    import translate_segments, SUPPORTED_LANGUAGES
from srt_exporter  import SRTExporter

load_dotenv()

# ── App factory ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("┌─────────────────────────────────────────┐")
    print("│  DRIS//CORE  —  Transcription Engine     │")
    print("│  POST: /devices  │  WS: /ws/transcribe  │")
    print("└─────────────────────────────────────────┘")
    yield

app = FastAPI(title="DRIS//CORE Transcription API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],   # tighten for production
    allow_methods  = ["*"],
    allow_headers  = ["*"],
)


# ── REST helpers ──────────────────────────────────────────────────────────────

@app.get("/devices")
def get_devices():
    """List available microphone input devices."""
    return {"devices": list_input_devices()}


@app.get("/languages")
def get_languages():
    """List supported output languages."""
    return {"languages": SUPPORTED_LANGUAGES}


# ── WebSocket — main signal chain ─────────────────────────────────────────────

@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):
    """
    WebSocket protocol:

    Client → server  (JSON):
        { "action": "start", "target_lang": "fr", "source_lang": "en",
          "device_index": null }
        { "action": "stop" }

    Server → client  (JSON):
        { "type": "status",      "message": "..." }
        { "type": "transcript",  "original": "...", "timestamp": 0.0 }
        { "type": "translation", "text": "...", "lang": "fr",
          "start": 0.0, "end": 3.2, "segment_id": "..." }
        { "type": "srt_ready",   "filename": "...", "content": "..." }
        { "type": "error",       "message": "..." }
    """
    await websocket.accept()
    session_id  = str(uuid.uuid4())[:8]
    active      = False
    mic         = None
    capture_task= None
    exporter    = None

    async def send(payload: dict):
        await websocket.send_text(json.dumps(payload))

    await send({"type": "status", "message": f"GHOST> SESSION {session_id} — READY"})

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)

            # ── START command ─────────────────────────────────────────────
            if msg.get("action") == "start" and not active:
                target_lang  = msg.get("target_lang", "fr")
                source_lang  = msg.get("source_lang", os.getenv("SOURCE_LANG", "en"))
                device_index = msg.get("device_index")
                if isinstance(device_index, float):
                    device_index = int(device_index)

                if target_lang not in SUPPORTED_LANGUAGES:
                    await send({"type": "error",
                                "message": f"Unsupported language: {target_lang}"})
                    continue

                exporter = SRTExporter(
                    target_lang = target_lang,
                    output_dir  = "./exports",
                    session_id  = session_id,
                )

                await send({
                    "type"   : "status",
                    "message": (
                        f"GHOST> ON-AIR ▶  {source_lang.upper()} → "
                        f"{SUPPORTED_LANGUAGES[target_lang].upper()}"
                    ),
                })

                active = True
                mic    = MicrophoneCapture(device_index=device_index)
                mic.__enter__()

                # Fire-and-forget capture loop as a background task
                capture_task = asyncio.create_task(
                    _capture_loop(
                        websocket   = websocket,
                        mic         = mic,
                        source_lang = source_lang,
                        target_lang = target_lang,
                        exporter    = exporter,
                        send        = send,
                    )
                )

            # ── STOP command ──────────────────────────────────────────────
            elif msg.get("action") == "stop" and active:
                active = False
                if capture_task:
                    capture_task.cancel()
                if mic:
                    mic.stop()

                srt_path    = exporter.save() if exporter else None
                srt_content = ""
                if srt_path and os.path.exists(srt_path):
                    with open(srt_path, "r", encoding="utf-8") as f:
                        srt_content = f.read()

                await send({
                    "type"    : "srt_ready",
                    "filename": os.path.basename(srt_path) if srt_path else "",
                    "content" : srt_content,
                })
                await send({"type": "status",
                            "message": "GHOST> STANDBY ◼  Session closed."})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await send({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        if mic:
            mic.stop()
        if capture_task and not capture_task.done():
            capture_task.cancel()


# ── Capture loop (background task) ────────────────────────────────────────────

async def _capture_loop(
    websocket   : WebSocket,
    mic         : MicrophoneCapture,
    source_lang : str,
    target_lang : str,
    exporter    : SRTExporter,
    send,
):
    """
    Consumes audio chunks from the mic, transcribes, translates,
    streams results over the WebSocket, and writes to the SRT exporter.
    """
    chunk_offset = 0.0   # running timeline offset in seconds
    from audio_capture import CHUNK_SECONDS

    try:
        async for wav_bytes in mic.stream_wav_chunks():
            t_start = time.perf_counter()

            # 1. Transcribe
            segments = await transcribe_with_timestamps(wav_bytes, language=source_lang)
            if not segments:
                chunk_offset += CHUNK_SECONDS
                continue

            # Shift segment timestamps by the running offset
            for seg in segments:
                seg["start"] += chunk_offset
                seg["end"]   += chunk_offset

            # Stream raw transcript to the HUD immediately
            combined_original = " ".join(s["text"] for s in segments)
            await send({
                "type"     : "transcript",
                "original" : combined_original,
                "timestamp": round(chunk_offset, 2),
            })

            # 2. Translate all segments in parallel
            translated = await translate_segments(segments, target_lang)

            # 3. Stream each translated segment to HUD + write to SRT
            for seg in translated:
                seg_id = str(uuid.uuid4())[:8]
                await send({
                    "type"      : "translation",
                    "text"      : seg["translation"],
                    "lang"      : target_lang,
                    "start"     : round(seg["start"], 3),
                    "end"       : round(seg["end"],   3),
                    "segment_id": seg_id,
                })
                exporter.add_segment(seg["start"], seg["end"], seg["translation"])

            chunk_offset += CHUNK_SECONDS
            elapsed = time.perf_counter() - t_start
            print(f"[PIPELINE] chunk {chunk_offset:.0f}s  processed in {elapsed:.2f}s")

    except asyncio.CancelledError:
        pass
    except Exception as exc:
        await send({"type": "error", "message": f"Pipeline error: {exc}"})
