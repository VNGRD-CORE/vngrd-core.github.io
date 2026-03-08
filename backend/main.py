"""
POLYTRANSLATOR // V1.0_SYNC  —  Backend Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  POST /generate       →  Fal.ai Flux-Pro → SDXL → Pollinations fallback
  WS   /ws/transcribe  →  Deepgram Nova-3 STT + MyMemory translation
  GET  /health         →  Service status check

Start:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Environment (.env):
    DEEPGRAM_API_KEY  — Deepgram Nova-3 speech-to-text
    FAL_KEY           — Fal.ai image generation
"""

import asyncio
import json
import os
import random
import time
import uuid
from contextlib import asynccontextmanager
from urllib.parse import quote

import fal_client
import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Load .env — check Desktop project folder first, then local ───────────────
_desktop_env = os.path.expanduser("~/Desktop/vanguard-core/.env")
if os.path.exists(_desktop_env):
    load_dotenv(dotenv_path=_desktop_env, override=True)
load_dotenv()  # local .env as fallback / supplement

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
FAL_KEY = os.getenv("FAL_KEY", "")

if FAL_KEY:
    os.environ["FAL_KEY"] = FAL_KEY

# ── Translation config ───────────────────────────────────────────────────────
SUPPORTED_LANGUAGES = {
    "nl": "Dutch",
    "fr": "French",
    "it": "Italian",
    "es": "Spanish",
}

# ── App ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("┌───────────────────────────────────────────────┐")
    print("│  POLYTRANSLATOR // V1.0_SYNC  —  BACKEND      │")
    print("│  POST /generate  │  WS /ws/transcribe         │")
    print(f"│  DEEPGRAM: {'✓' if DEEPGRAM_API_KEY else '✗'}   FAL: {'✓' if FAL_KEY else '✗'}                          │")
    print("└───────────────────────────────────────────────┘")
    yield

app = FastAPI(title="POLYTRANSLATOR Backend", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════════════
#  POST /generate  —  AI Image Generation (Fal.ai → Pollinations fallback)
# ══════════════════════════════════════════════════════════════════════════════

class GenerateRequest(BaseModel):
    prompt: str
    width: int = 1024
    height: int = 1024


@app.post("/generate")
async def generate_image(req: GenerateRequest):
    """
    Tier 1: Fal.ai Flux-Pro  →  Tier 2: Fal.ai SDXL  →  Tier 3: Pollinations
    Returns { url, source } — frontend fetches the URL and creates a blob.
    """
    prompt = req.prompt

    # ── Tier 1: Fal.ai Flux-Pro ──────────────────────────────────────────────
    if FAL_KEY:
        try:
            result = await fal_client.run_async(
                "fal-ai/flux-pro",
                arguments={
                    "prompt": prompt,
                    "image_size": "square_hd",
                    "num_images": 1,
                    "safety_tolerance": "2",
                },
            )
            url = result["images"][0]["url"]
            return {"url": url, "source": "fal-flux-pro"}
        except Exception as e:
            print(f"[POLYTRANSLATOR] FAL_FLUX_PRO_FAIL: {e}")

        # ── Tier 2: Fal.ai SDXL ─────────────────────────────────────────────
        try:
            result = await fal_client.run_async(
                "fal-ai/stable-diffusion-xl",
                arguments={
                    "prompt": prompt,
                    "image_size": "square_hd",
                    "num_images": 1,
                },
            )
            url = result["images"][0]["url"]
            return {"url": url, "source": "fal-sdxl"}
        except Exception as e:
            print(f"[POLYTRANSLATOR] FAL_SDXL_FAIL: {e}")

    # ── Tier 3: Pollinations free fallback (always works) ────────────────────
    seed = random.randint(0, 999999)
    url = (
        f"https://image.pollinations.ai/prompt/{quote(prompt)}"
        f"?width={req.width}&height={req.height}&model=flux&seed={seed}&nologo=true"
    )
    return {"url": url, "source": "pollinations-fallback"}


# ══════════════════════════════════════════════════════════════════════════════
#  WS /ws/transcribe  —  Deepgram Nova-3 STT + Translation
# ══════════════════════════════════════════════════════════════════════════════
#
#  POLYTRANSLATOR// protocol  (matches frontend expectations):
#
#  Client → Server:
#    JSON:   { action:"start", target_lang:"nl", source_lang:"en" }
#            { action:"stop" }
#    Binary: Raw webm/opus audio chunks from MediaRecorder
#
#  Server → Client:
#    { type:"status",      message:"..." }
#    { type:"transcript",  original:"...", timestamp:0.0 }
#    { type:"translation", text:"...", lang:"nl", start:0.0, end:4.0 }
#    { type:"srt_ready",   filename:"...", content:"..." }
#    { type:"error",       message:"..." }
# ══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/transcribe")
async def ws_transcribe(client_ws: WebSocket):
    await client_ws.accept()

    session_id = str(uuid.uuid4())[:8]
    target_lang = "nl"
    source_lang = "en"
    on_air = False
    dg_ws = None
    tasks = []
    srt_segments = []
    chunk_time = 0.0

    async def send(payload: dict):
        try:
            await client_ws.send_text(json.dumps(payload))
        except Exception:
            pass

    # ── Greeting — triggers LED green in frontend ────────────────────────────
    await send({
        "type": "status",
        "message": f"GHOST> SESSION {session_id} — READY",
    })

    try:
        while True:
            message = await client_ws.receive()

            # ── Binary audio: forward to Deepgram ────────────────────────────
            if "bytes" in message and message["bytes"] and dg_ws:
                try:
                    await dg_ws.send(message["bytes"])
                except Exception:
                    pass
                continue

            # ── Text messages: JSON commands ──────────────────────────────────
            raw = message.get("text", "")
            if not raw:
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = msg.get("action", "")

            # ── START ────────────────────────────────────────────────────────
            if action == "start" and not on_air:
                target_lang = msg.get("target_lang", "nl")
                source_lang = msg.get("source_lang", "en")
                srt_segments = []
                chunk_time = 0.0

                if target_lang not in SUPPORTED_LANGUAGES:
                    await send({
                        "type": "error",
                        "message": f"Unsupported language: {target_lang}",
                    })
                    continue

                if not DEEPGRAM_API_KEY:
                    await send({
                        "type": "error",
                        "message": "DEEPGRAM_KEY_MISSING — add to .env",
                    })
                    continue

                await send({
                    "type": "status",
                    "message": (
                        f"GHOST> ON-AIR ▶  {source_lang.upper()} → "
                        f"{SUPPORTED_LANGUAGES[target_lang].upper()}"
                    ),
                })

                # Open Deepgram Nova-3 WebSocket
                dg_url = (
                    "wss://api.deepgram.com/v1/listen"
                    f"?model=nova-3"
                    f"&language={source_lang}"
                    "&smart_format=true"
                    "&punctuate=true"
                    "&interim_results=true"
                    "&encoding=webm-opus"
                    "&sample_rate=48000"
                    "&channels=1"
                )
                dg_headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}

                try:
                    dg_ws = await websockets.connect(
                        dg_url, extra_headers=dg_headers
                    )
                except Exception as e:
                    await send({
                        "type": "error",
                        "message": f"DEEPGRAM_CONNECT_FAIL: {e}",
                    })
                    continue

                on_air = True

                # Background task: read Deepgram results → transform → send
                task = asyncio.create_task(
                    _deepgram_reader(
                        dg_ws=dg_ws,
                        client_send=send,
                        target_lang=target_lang,
                        srt_segments=srt_segments,
                        session_id=session_id,
                    )
                )
                tasks.append(task)

            # ── STOP ─────────────────────────────────────────────────────────
            elif action == "stop" and on_air:
                on_air = False

                # Signal Deepgram to flush
                if dg_ws:
                    try:
                        await dg_ws.send(json.dumps({"type": "CloseStream"}))
                        await asyncio.sleep(0.5)
                        await dg_ws.close()
                    except Exception:
                        pass
                    dg_ws = None

                # Cancel reader task
                for t in tasks:
                    t.cancel()
                tasks.clear()

                # Build and send SRT
                srt_content = _build_srt(srt_segments)
                filename = (
                    f"{time.strftime('%Y-%m-%dT%H%M%S')}"
                    f"_{session_id}_{target_lang}.srt"
                )
                await send({
                    "type": "srt_ready",
                    "filename": filename,
                    "content": srt_content,
                })
                await send({
                    "type": "status",
                    "message": "GHOST> STANDBY ◼  Session closed.",
                })

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await send({"type": "error", "message": str(exc)})
    finally:
        if dg_ws:
            try:
                await dg_ws.close()
            except Exception:
                pass
        for t in tasks:
            t.cancel()


# ── Deepgram reader — transforms Nova-3 JSON → POLYTRANSLATOR protocol ──────

async def _deepgram_reader(
    dg_ws,
    client_send,
    target_lang: str,
    srt_segments: list,
    session_id: str,
):
    """
    Reads Deepgram WebSocket results, extracts final transcripts,
    translates them, and pushes both to the frontend in POLYTRANSLATOR format.
    """
    try:
        async for raw_msg in dg_ws:
            try:
                data = json.loads(raw_msg)
            except json.JSONDecodeError:
                continue

            # Only process speech results
            if data.get("type") != "Results":
                continue

            channel = data.get("channel", {})
            alternatives = channel.get("alternatives", [])
            if not alternatives:
                continue

            alt = alternatives[0]
            transcript = alt.get("transcript", "").strip()
            if not transcript:
                continue

            is_final = data.get("is_final", False)
            start = data.get("start", 0.0)
            duration = data.get("duration", 0.0)

            # Always send transcript (interim + final) so HUD feels live
            await client_send({
                "type": "transcript",
                "original": transcript,
                "timestamp": round(start, 2),
            })

            # Only translate final results (not interim) to avoid spam
            if is_final and transcript:
                translated = await _translate(transcript, target_lang)
                if translated:
                    end = start + duration

                    await client_send({
                        "type": "translation",
                        "text": translated,
                        "lang": target_lang,
                        "start": round(start, 3),
                        "end": round(end, 3),
                    })

                    srt_segments.append({
                        "start": start,
                        "end": end,
                        "text": translated,
                    })

    except asyncio.CancelledError:
        pass
    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        await client_send({
            "type": "error",
            "message": f"DEEPGRAM_STREAM_ERR: {e}",
        })


# ── Translation — MyMemory API (free, no key) ───────────────────────────────

_LANG_CODES = {
    "nl": "nl-NL",
    "fr": "fr-FR",
    "it": "it-IT",
    "es": "es-ES",
}

_http_client = httpx.AsyncClient(timeout=10.0)


async def _translate(text: str, target_lang: str) -> str:
    """Translate text using MyMemory API (free, no API key required)."""
    lang_pair = f"en|{_LANG_CODES.get(target_lang, target_lang)}"
    try:
        resp = await _http_client.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text, "langpair": lang_pair},
        )
        if resp.status_code == 200:
            data = resp.json()
            translated = data.get("responseData", {}).get("translatedText", "")
            if translated and translated.upper() != text.upper():
                return translated
    except Exception as e:
        print(f"[POLYTRANSLATOR] TRANSLATE_FAIL ({target_lang}): {e}")
    return ""


# ── SRT builder ──────────────────────────────────────────────────────────────

def _srt_time(seconds: float) -> str:
    """Convert seconds to SRT timestamp format: HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _build_srt(segments: list) -> str:
    """Build SRT content from a list of {start, end, text} segments."""
    lines = []
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{_srt_time(seg['start'])} --> {_srt_time(seg['end'])}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ONLINE",
        "engine": "POLYTRANSLATOR // V1.0_SYNC",
        "deepgram_key": bool(DEEPGRAM_API_KEY),
        "fal_key": bool(FAL_KEY),
    }


# ── Direct run ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
