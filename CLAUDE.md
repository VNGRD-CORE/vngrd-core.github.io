# Vanguard-Core Project Guidelines

## Project Overview
**VNGRD//CORE** is a browser-native real-time audiovisual production suite — a VJ engine, recorder, transcriber, and Web3 workstation in a single `index.html`. No build step. No framework.

**Core Philosophy:** Treat the browser as a real-time media execution environment.

## Architecture

### Frontend (Static, GitHub Pages)
- `index.html` — Monolithic UI (1MB+), entire DRIS//CORE interface
- `src/app.js` — Master `APP` state object (3000+ lines): audio, video, MIDI, Web3, recording, WebXR
- `src/Compositor.js` — Iron-clad recorder: 1920×1080, 60fps, 15 Mbps, VP9+Opus, 3-layer compositing
- `src/RecorderWorker.js` — Web Worker for non-blocking recording
- `src/synesthesia-voice-engine.js` — TTS with mood modes (CYBER/DRIFT/CLEAN), multilingual auto-detect
- `src/kinetic-rack/` — Hand-gesture synthesis (MediaPipe → AudioEngine → NeuralComposer → SpatialSynth)

### Backend (Python/FastAPI, Heroku)
- `backend/main.py` — WebSocket transcription proxy (Deepgram Nova-2/3), image gen (Fal.ai → Pollinations fallback), IPFS export (Pinata)
- `backend/router.py` — Alternative router with free Pollinations fallback
- `backend/transcriber.py` — Whisper API wrapper
- `backend/translator.py` — GPT-4o broadcast-quality translation
- `system_init.py` — Zero-API-key bootstrapper (Google Speech + deep-translator free mode)

### Key Technologies
- **Frontend:** Vanilla JS, Web Audio API, Three.js, Canvas 2D, Tone.js, MediaPipe, WebRTC/PeerJS, WebMIDI, WebXR, Service Worker
- **Backend:** FastAPI, Deepgram, Fal.ai, Pinata/IPFS, Alchemy (NFT)
- **Deploy:** GitHub Pages (frontend) + Heroku (backend) + GitHub Actions CI/CD

## 🛡️ CRITICAL: UI INVARIANTS (DO NOT TOUCH)
- **Clock & Ticker:** CSS and JS for time display and news ticker are 100% stable. Do NOT refactor, rename classes, or move these files.
- **HUD Layout:** The grid and absolute positioning of the "DRIS//CORE" interface must remain intact.

## 🛠️ FIX PRIORITIES
1. **3D Logo Loading:** Always use **relative paths** (e.g., `./assets/logo.glb`). Use a `LoadingManager` to verify model exists before rendering.
2. **WebMIDI:** Must initialize inside a user gesture (click event). Add fallback if `navigator.requestMIDIAccess` is denied.
3. **P2P Calling:** Ensure `secure: true` and `port: 443` in PeerJS/WebRTC config. Redirect logs to "GHOST> " terminal in UI.

## ⚙️ DEPLOYMENT RULES
- **GitHub Pages:** Always include `.nojekyll` in root to prevent asset blocking.
- **Paths:** No absolute paths (starting with `/`). Everything must be relative to repo root.
- **Secrets:** `ALCHEMY_KEY` injected via GitHub Actions at build time. Never hardcode keys.
- **Backend env vars:** `DEEPGRAM_API_KEY`, `FAL_KEY`, `PINATA_JWT` — stored in Heroku dashboard or `backend/.env` (never committed).

## Development Notes
- No build step — changes to `src/` and `index.html` deploy directly
- Backend runs: `uvicorn backend.main:app --host 0.0.0.0 --port 8000`
- Free local mode (no API keys): `python system_init.py`
- WebSocket endpoint: `ws://localhost:8000/ws/transcribe`
