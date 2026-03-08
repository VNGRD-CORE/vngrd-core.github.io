"""
main.py — DRIS//CORE  Transcription + Image Backend
=====================================================
Signal flow:
    Browser MediaRecorder → WS /ws/transcribe → Deepgram Live → JSON to HUD
    Browser prompt        → POST /generate    → fal-ai/flux-pro → image URL

Start:
    python backend/main.py
    — or —
    uvicorn main:app --host 0.0.0.0 --port 8000

Environment variables (backend/.env):
    DEEPGRAM_API_KEY  — required for /ws/transcribe
    FAL_KEY           — required for /generate
"""

import asyncio
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import fal_client
import uvicorn
from deepgram import (
    DeepgramClient,
    DeepgramClientOptions,
    LiveOptions,
    LiveTranscriptionEvents,
)
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")
FAL_KEY          = os.environ.get("FAL_KEY", "")

# fal-client picks up FAL_KEY automatically from the environment
os.environ.setdefault("FAL_KEY", FAL_KEY)

SUPPORTED_LANGS = {
    "nl": "Dutch", "fr": "French", "it": "Italian", "es": "Spanish", "en": "English",
}

# BCP-47 codes for Deepgram language option
_DG_LANG = {
    "en": "en-US", "nl": "nl", "fr": "fr", "it": "it", "es": "es",
}


# ── Startup banner ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app):
    dg_ok  = "✔  DEEPGRAM_API_KEY set" if DEEPGRAM_API_KEY else "✘  DEEPGRAM_API_KEY missing — /ws/transcribe will return 503"
    fal_ok = "✔  FAL_KEY set"          if FAL_KEY          else "✘  FAL_KEY missing — /generate will return 503"
    print("\n┌─────────────────────────────────────────────────────┐")
    print("│  DRIS//CORE  —  Deepgram + fal-ai Backend           │")
    print("│  WS : ws://localhost:8000/ws/transcribe             │")
    print("│  POST: http://localhost:8000/generate               │")
    print(f"│  {dg_ok:<51}│")
    print(f"│  {fal_ok:<51}│")
    print("└─────────────────────────────────────────────────────┘\n")
    yield


app = FastAPI(title="DRIS//CORE Backend (Deepgram + fal-ai)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status" : "ok",
        "engines": {
            "asr"  : "deepgram" if DEEPGRAM_API_KEY else "unconfigured",
            "image": "fal-ai"   if FAL_KEY          else "unconfigured",
        },
    }


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
        blocks.append("{}\n{} --> {}\n{}\n".format(
            seg["index"], _srt_ts(seg["start"]), _srt_ts(seg["end"]), seg["text"],
        ))
    return "\n".join(blocks)


# ── WebSocket — /ws/transcribe ────────────────────────────────────────────────

@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):
    await websocket.accept()

    session_id = str(uuid.uuid4())[:8]
    active     = False
    dg_conn    = None
    drain_task = None

    # Queue through which Deepgram callbacks push final transcripts
    transcript_q: asyncio.Queue = asyncio.Queue()

    srt_segments: list = []
    srt_index    = 1
    chunk_offset = 0.0
    CHUNK_SEC    = 4.0
    target_lang  = "nl"

    async def send(payload: dict) -> None:
        await websocket.send_text(json.dumps(payload))

    await send({"type": "status", "message": "GHOST> SESSION {} — READY".format(session_id)})

    if not DEEPGRAM_API_KEY:
        await send({"type": "error", "message": "DEEPGRAM_API_KEY not set in backend/.env"})
        await websocket.close(code=1011)
        return

    # ── Deepgram callback (called from Deepgram's thread) ─────────────────────
    loop = asyncio.get_event_loop()

    def _on_transcript(conn, result, **kwargs):
        try:
            alt = result.channel.alternatives[0]
            if result.is_final and alt.transcript.strip():
                asyncio.run_coroutine_threadsafe(
                    transcript_q.put({"text": alt.transcript, "confidence": alt.confidence}),
                    loop,
                )
        except Exception:
            pass

    def _on_error(conn, error, **kwargs):
        asyncio.run_coroutine_threadsafe(
            transcript_q.put({"error": str(error)}),
            loop,
        )

    # ── Background task: drain transcript queue, translate, push to browser ───
    async def _drain_loop():
        nonlocal srt_index, chunk_offset
        while True:
            item = await transcript_q.get()

            if "error" in item:
                await send({"type": "error", "message": "Deepgram: {}".format(item["error"])})
                continue

            transcript = item["text"]
            seg_start  = chunk_offset
            seg_end    = chunk_offset + CHUNK_SEC
            chunk_offset += CHUNK_SEC

            await send({
                "type"      : "transcript",
                "original"  : transcript,
                "timestamp" : round(seg_start, 2),
                "confidence": round(item.get("confidence", 0.0), 3),
            })

            # Translate in thread-pool (blocking network call)
            translation = await loop.run_in_executor(
                None, _translate, transcript, target_lang,
            )

            if translation:
                await send({
                    "type"      : "translation",
                    "text"      : translation,
                    "lang"      : target_lang,
                    "start"     : round(seg_start, 3),
                    "end"       : round(seg_end,   3),
                    "segment_id": str(uuid.uuid4())[:8],
                })
                srt_segments.append({
                    "index": srt_index,
                    "start": seg_start,
                    "end"  : seg_end,
                    "text" : translation,
                })
                srt_index += 1

    # ── Main receive loop ─────────────────────────────────────────────────────
    try:
        while True:
            message = await websocket.receive()

            # JSON command
            if "text" in message:
                msg = json.loads(message["text"])

                if msg.get("action") == "start" and not active:
                    target_lang  = msg.get("target_lang", "nl")
                    source_lang  = msg.get("source_lang", "en")
                    active       = True
                    srt_segments = []
                    srt_index    = 1
                    chunk_offset = 0.0

                    # Open Deepgram live connection
                    dg_client = DeepgramClient(
                        DEEPGRAM_API_KEY,
                        config=DeepgramClientOptions(options={"keepalive": "true"}),
                    )
                    dg_conn = dg_client.listen.websocket.v("1")
                    dg_conn.on(LiveTranscriptionEvents.Transcript, _on_transcript)
                    dg_conn.on(LiveTranscriptionEvents.Error,      _on_error)

                    dg_opts = LiveOptions(
                        model        = "nova-2",
                        language     = _DG_LANG.get(source_lang, "en-US"),
                        smart_format = True,
                        encoding     = "linear16",
                        sample_rate  = 16000,
                    )
                    dg_conn.start(dg_opts)

                    drain_task = asyncio.create_task(_drain_loop())

                    lang_name = SUPPORTED_LANGS.get(target_lang, target_lang).upper()
                    await send({
                        "type"   : "status",
                        "message": "GHOST> ON-AIR \u25b6  {} \u2192 {}".format(
                            source_lang.upper(), lang_name,
                        ),
                    })

                elif msg.get("action") == "stop" and active:
                    active = False
                    if dg_conn:
                        dg_conn.finish()
                        dg_conn = None

                    # Drain anything left in the queue
                    await asyncio.sleep(0.5)
                    if drain_task:
                        drain_task.cancel()
                        drain_task = None

                    srt_content = _build_srt(srt_segments)
                    ts          = time.strftime("%Y-%m-%dT%H%M%S")
                    filename    = "{}_{}_{}.srt".format(ts, session_id, target_lang)
                    exports     = Path(__file__).parent / "exports"
                    exports.mkdir(exist_ok=True)
                    (exports / filename).write_text(srt_content, encoding="utf-8")

                    await send({"type": "srt_ready", "filename": filename, "content": srt_content})
                    await send({"type": "status", "message": "GHOST> STANDBY \u25fc  Session closed."})

            # Binary audio chunk from browser MediaRecorder
            elif "bytes" in message:
                if not active or dg_conn is None:
                    continue
                audio_bytes = message["bytes"]
                if audio_bytes and len(audio_bytes) >= 200:
                    dg_conn.send(audio_bytes)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await send({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        if dg_conn:
            dg_conn.finish()
        if drain_task and not drain_task.done():
            drain_task.cancel()


# ── Translation helper (blocking — run in executor) ───────────────────────────

def _translate(text: str, target_lang: str) -> str:
    if not text.strip() or target_lang == "en":
        return text
    try:
        from deep_translator import GoogleTranslator
        result = GoogleTranslator(source="auto", target=target_lang).translate(text)
        return result or text
    except Exception:
        return text   # offline passthrough


# ── POST /generate — fal-ai Flux-Pro image generation ────────────────────────

class GenerateRequest(BaseModel):
    prompt: str
    width : int = 1024
    height: int = 1024


@app.post("/generate")
async def generate_image(req: GenerateRequest):
    if not FAL_KEY:
        return JSONResponse(
            status_code=503,
            content={"error": "FAL_KEY not set in backend/.env"},
        )

    try:
        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: fal_client.subscribe(
                "fal-ai/flux-pro",
                arguments={
                    "prompt": req.prompt,
                    "width" : req.width,
                    "height": req.height,
                },
            ),
        )
        images = result.get("images") or []
        if not images:
            return JSONResponse(status_code=502, content={"error": "fal-ai returned no images"})

        return {"url": images[0]["url"], "prompt": req.prompt}

    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
