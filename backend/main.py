"""
main.py — DRIS//CORE  Podcast Transcription Backend  (v4 — websockets, no SDK)
================================================================================
Signal flow:
    Browser MediaRecorder → WS /ws/transcribe → Deepgram Live (raw websockets)
      → deep-translator (EN→ES, EN→FR) → vngrd_podcast_data JSON to HUD tray

    Browser prompt → POST /generate → fal-ai/flux-pro → image URL

Start:
    python backend/main.py

Environment variables (backend/.env):
    DEEPGRAM_API_KEY  — required for /ws/transcribe
    FAL_KEY           — required for /generate

macOS SSL fix: ssl_context with CERT_NONE is applied to the Deepgram connection
to permanently bypass certificate verification errors on macOS.
"""

import asyncio
import json
import os
import ssl
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import fal_client
import httpx
import uvicorn
import websockets
from deep_translator import GoogleTranslator
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")
FAL_KEY          = os.environ.get("FAL_KEY", "")
PINATA_JWT       = os.environ.get("PINATA_JWT", "")

os.environ.setdefault("FAL_KEY", FAL_KEY)

# ── SSL context — macOS cert fix ───────────────────────────────────────────────
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# ── Deepgram WebSocket URL ─────────────────────────────────────────────────────
_DG_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2"
    "&language=en-US"
    "&encoding=linear16"
    "&sample_rate=16000"
    "&smart_format=true"
)


# ── Startup banner ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app):
    port   = int(os.getenv("PORT", 8000))
    dg_ok  = "✔  DEEPGRAM_API_KEY set"  if DEEPGRAM_API_KEY else "✘  DEEPGRAM_API_KEY missing — /ws/transcribe → 503"
    fal_ok = "✔  FAL_KEY set"           if FAL_KEY          else "✘  FAL_KEY missing — /generate → 503"
    pin_ok = "✔  PINATA_JWT set"        if PINATA_JWT        else "✘  PINATA_JWT missing — /export-to-pinata → 503"
    print("\n┌─────────────────────────────────────────────────────┐")
    print("│  DRIS//CORE  —  Podcast Backend  (websockets)       │")
    print(f"│  WS  : ws://0.0.0.0:{port}/ws/transcribe              │")
    print(f"│  HTTP: http://0.0.0.0:{port}/generate                 │")
    print(f"│  {dg_ok:<51}│")
    print(f"│  {fal_ok:<51}│")
    print(f"│  {pin_ok:<51}│")
    print("└─────────────────────────────────────────────────────┘\n")
    yield


app = FastAPI(title="DRIS//CORE Podcast Backend", lifespan=lifespan)
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


# ── Translation helpers (blocking — run in executor) ─────────────────────────

def _translate_es(text: str) -> str:
    try:
        return GoogleTranslator(source="auto", target="es").translate(text) or text
    except Exception:
        return text


def _translate_fr(text: str) -> str:
    try:
        return GoogleTranslator(source="auto", target="fr").translate(text) or text
    except Exception:
        return text


# ── WebSocket — /ws/transcribe ────────────────────────────────────────────────

@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):
    await websocket.accept()

    session_id = str(uuid.uuid4())[:8]
    active     = False
    dg_ws      = None      # raw websockets connection to Deepgram
    dg_task    = None      # task reading from Deepgram
    drain_task = None

    transcript_q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    async def send(payload: dict) -> None:
        await websocket.send_text(json.dumps(payload))

    await send({"type": "status", "message": f"GHOST> SESSION {session_id} — READY"})

    if not DEEPGRAM_API_KEY:
        await send({"type": "error", "message": "DEEPGRAM_API_KEY not set in backend/.env"})
        await websocket.close(code=1011)
        return

    # ── Deepgram reader task ───────────────────────────────────────────────────
    async def _read_deepgram():
        """Read transcription results from Deepgram and push to queue."""
        nonlocal dg_ws
        try:
            async for raw in dg_ws:
                try:
                    msg = json.loads(raw)
                    if msg.get("type") == "Results":
                        alts = (
                            msg.get("channel", {})
                               .get("alternatives", [{}])
                        )
                        text = alts[0].get("transcript", "").strip() if alts else ""
                        is_final = msg.get("is_final", False)
                        if is_final and text:
                            conf = alts[0].get("confidence", 0.0) if alts else 0.0
                            await transcript_q.put({"text": text, "confidence": conf})
                except Exception:
                    pass
        except Exception:
            pass

    # ── Drain loop: translate and emit unified podcast packet ─────────────────
    async def _drain_loop():
        while True:
            item = await transcript_q.get()

            if "error" in item:
                await send({"type": "error", "message": item["error"]})
                continue

            en_text = item["text"]

            # Translate both languages in parallel using thread pool
            es_text, fr_text = await asyncio.gather(
                loop.run_in_executor(None, _translate_es, en_text),
                loop.run_in_executor(None, _translate_fr, en_text),
            )

            # Single unified packet — the vngrd_podcast_data format
            await send({
                "type": "vngrd_podcast_data",
                "en"  : en_text,
                "es"  : es_text,
                "fr"  : fr_text,
            })

    # ── Main receive loop ──────────────────────────────────────────────────────
    try:
        while True:
            message = await websocket.receive()

            # JSON command
            if "text" in message:
                msg = json.loads(message["text"])

                if msg.get("action") == "start" and not active:
                    active = True

                    # Open raw websockets connection to Deepgram with ssl_ctx
                    dg_ws = await websockets.connect(
                        _DG_URL,
                        extra_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                        ssl=_ssl_ctx,
                    )

                    dg_task    = asyncio.create_task(_read_deepgram())
                    drain_task = asyncio.create_task(_drain_loop())

                    await send({"type": "status", "message": "GHOST> ON-AIR ▶  EN → ES | FR"})

                elif msg.get("action") == "stop" and active:
                    active = False

                    if dg_ws:
                        try:
                            await dg_ws.close()
                        except Exception:
                            pass
                        dg_ws = None

                    await asyncio.sleep(0.4)

                    if dg_task and not dg_task.done():
                        dg_task.cancel()
                        dg_task = None

                    if drain_task and not drain_task.done():
                        drain_task.cancel()
                        drain_task = None

                    await send({"type": "status", "message": "GHOST> STANDBY ◼  Session closed."})

            # Binary audio chunk from browser MediaRecorder
            elif "bytes" in message:
                if not active or dg_ws is None:
                    continue
                audio_bytes = message["bytes"]
                if audio_bytes and len(audio_bytes) >= 200:
                    try:
                        await dg_ws.send(audio_bytes)
                    except Exception:
                        pass

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await send({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        if dg_ws:
            try:
                await dg_ws.close()
            except Exception:
                pass
        for t in [dg_task, drain_task]:
            if t and not t.done():
                t.cancel()


# ── POST /generate — fal-ai Flux-Pro image generation ────────────────────────

class GenerateRequest(BaseModel):
    prompt: str
    width : int = 1024
    height: int = 1024


@app.post("/generate")
async def generate_image(request: GenerateRequest):
    if not FAL_KEY:
        return JSONResponse(
            status_code=503,
            content={"error": "FAL_KEY not set in backend/.env"}
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: fal_client.subscribe(
                "fal-ai/flux-pro",
                arguments={
                    "prompt": request.prompt,
                    "width":  request.width,
                    "height": request.height,
                },
            ),
        )

        images = result.get("images") or []
        if not images:
            return JSONResponse(status_code=502, content={"error": "fal-ai returned no images"})

        return {"url": images[0]["url"], "prompt": request.prompt}

    except Exception as exc:
        print(f"[generate] ERROR: {exc}")
        return JSONResponse(status_code=500, content={"error": str(exc)})


# ── POST /export-to-pinata — pin JSON workspace to IPFS ──────────────────────

@app.post("/export-to-pinata")
async def export_to_pinata(request: Request):
    """Pin workspace snapshot JSON to IPFS via Pinata and return the CID."""
    if not PINATA_JWT:
        return JSONResponse(
            status_code=503,
            content={"error": "PINATA_JWT not set — add it to backend/.env or env vars"}
        )

    try:
        payload = await request.json()
        name    = f"VNGRD_WORKSPACE_{int(time.time() * 1000)}"

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.pinata.cloud/pinning/pinJSONToIPFS",
                json={
                    "pinataContent":  payload,
                    "pinataMetadata": {"name": name},
                },
                headers={"Authorization": f"Bearer {PINATA_JWT}"},
            )

        data = resp.json()

        if resp.status_code == 200 and data.get("IpfsHash"):
            cid = data["IpfsHash"]
            return {
                "cid": cid,
                "url": f"https://gateway.pinata.cloud/ipfs/{cid}",
            }

        return JSONResponse(
            status_code=502,
            content={"error": "Pinata rejected the request", "details": data},
        )

    except Exception as exc:
        print(f"[export-to-pinata] ERROR: {exc}")
        return JSONResponse(status_code=500, content={"error": str(exc)})

# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=_port, reload=False, log_level="info")
