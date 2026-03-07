"""
VNGRD// CLOUD BACKEND — v1.0 Gold Standard 2026
  POST /generate       → Fal.ai Flux-Pro → SDXL → Pollinations (free fallback)
  WS   /ws/transcribe  → Deepgram Nova-3 proxy (browser-safe auth)
"""

import asyncio
import json
import os
import random
from urllib.parse import quote

import fal_client
import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Load .env from Desktop project folder first, then local fallback ──────────
_desktop_env = os.path.expanduser("~/Desktop/vanguard-core/.env")
if os.path.exists(_desktop_env):
    load_dotenv(dotenv_path=_desktop_env, override=True)
else:
    load_dotenv()

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
FAL_KEY = os.getenv("FAL_KEY", "")

if FAL_KEY:
    os.environ["FAL_KEY"] = FAL_KEY

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="VNGRD Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ────────────────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    prompt: str
    width: int = 1024
    height: int = 1024


# ── Image Generation ──────────────────────────────────────────────────────────
@app.post("/generate")
async def generate_image(req: GenerateRequest):
    """
    Try Fal.ai Flux-Pro → SDXL.  Always falls back to Pollinations (free).
    Returns { url, source } — frontend fetches the URL and creates a blob.
    """
    prompt = req.prompt

    # ── Tier 1: Fal.ai Flux-Pro ───────────────────────────────────────────────
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
            print(f"[VNGRD] FAL_FLUX_PRO_FAIL: {e}")

        # ── Tier 2: Fal.ai SDXL ───────────────────────────────────────────────
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
            print(f"[VNGRD] FAL_SDXL_FAIL: {e}")

    # ── Tier 3: Pollinations free fallback (always works) ────────────────────
    seed = random.randint(0, 999999)
    url = (
        f"https://image.pollinations.ai/prompt/{quote(prompt)}"
        f"?width={req.width}&height={req.height}&model=flux&seed={seed}&nologo=true"
    )
    return {"url": url, "source": "pollinations-fallback"}


# ── Deepgram Nova-3 WebSocket Proxy ──────────────────────────────────────────
@app.websocket("/ws/transcribe")
async def transcribe_ws(client_ws: WebSocket):
    """
    Browser connects here with raw audio (WebM/Opus, 250ms chunks).
    We proxy to Deepgram Nova-3 and stream JSON transcripts back.
    """
    await client_ws.accept()

    if not DEEPGRAM_API_KEY:
        await client_ws.send_text(json.dumps({"error": "DEEPGRAM_KEY_MISSING"}))
        await client_ws.close()
        return

    dg_url = (
        "wss://api.deepgram.com/v1/listen"
        "?model=nova-3"
        "&language=en-US"
        "&smart_format=true"
        "&punctuate=true"
        "&interim_results=true"
        "&encoding=webm-opus"
        "&sample_rate=48000"
        "&channels=1"
    )
    dg_headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}

    try:
        async with websockets.connect(dg_url, extra_headers=dg_headers) as dg_ws:

            async def audio_to_deepgram():
                """Forward raw audio from browser → Deepgram."""
                try:
                    while True:
                        data = await client_ws.receive_bytes()
                        await dg_ws.send(data)
                except (WebSocketDisconnect, Exception):
                    # Signal Deepgram to flush and close
                    try:
                        await dg_ws.send(json.dumps({"type": "CloseStream"}))
                    except Exception:
                        pass

            async def transcripts_to_browser():
                """Forward Deepgram JSON transcripts → browser."""
                try:
                    async for message in dg_ws:
                        await client_ws.send_text(message)
                except Exception:
                    pass

            await asyncio.gather(audio_to_deepgram(), transcripts_to_browser())

    except Exception as e:
        print(f"[VNGRD] DEEPGRAM_PROXY_FAIL: {e}")
        try:
            await client_ws.send_text(json.dumps({"error": f"DG_CONNECT_FAIL: {e}"}))
        except Exception:
            pass


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ONLINE",
        "fal_key": bool(FAL_KEY),
        "deepgram_key": bool(DEEPGRAM_API_KEY),
    }
