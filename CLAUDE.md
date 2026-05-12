# VNGRD// CORE — Claude Guidelines

## Project Overview

**VNGRD// CORE** is a browser-native real-time audiovisual production suite — a VJ engine, broadcast recorder, live transcriber, and Web3 workstation in a single `index.html`. No build step. No framework. No bundler.

**Core philosophy:** treat the browser as a real-time media execution environment.

**Live system:** https://vngrd-core.github.io

---

## Architecture Summary

### Frontend (GitHub Pages — static)
- `index.html` — monolithic UI (4,200+ lines), entire DRIS//CORE interface
- `src/js/main.js` — master `APP` state object (~4,600 lines): audio, video, MIDI, Web3, recording, WebXR, P2P
- `src/Compositor.js` — Iron-Clad Recorder: 1920×1080, 60fps, 15 Mbps, VP9+Opus, 3-layer compositing
- `src/modules/` — 26 domain modules (render loop, audio chain, synthesis, slicer, ghost terminal, wallet, workspace, weather, etc.)
- `src/synesthesia-voice-engine.js` — TTS with mood modes (CYBER/DRIFT/CLEAN), multilingual auto-detect
- `src/hand-tracker.js` — MediaPipe Tasks HandLandmarker (GPU)

### Backend (FastAPI — Heroku)
- `backend/main.py` — WebSocket transcription proxy (Deepgram Nova-2/3), image gen (Fal.ai → Pollinations fallback), IPFS export (Pinata)
- `backend/router.py` — alternative router with free Pollinations fallback
- `backend/transcriber.py` — Whisper API wrapper
- `backend/translator.py` — GPT-4o broadcast-quality translation
- `system_init.py` — zero-API-key bootstrapper (Google Speech + deep-translator free mode)

### Key Technologies
- **Frontend:** Vanilla JS, Web Audio API, Three.js r128, Canvas 2D, Tone.js, MediaPipe, WebRTC/PeerJS, WebMIDI, WebXR, Service Worker
- **Backend:** FastAPI, Deepgram, Fal.ai, Pinata/IPFS, Alchemy (NFT)
- **Deploy:** GitHub Pages (frontend) + Heroku (backend) + GitHub Actions CI/CD

---

## Module System

All 26 modules in `src/modules/` share `window` — no ESM except `audio-rotation.js`. Script load order is explicit and critical (see `ARCHITECTURE.md`). `APP` is the single source of truth and message bus — modules read and write it directly.

**Never add `import`/`export` to non-module files.** Never break the script load order.

---

## Skills Available

Use the skill system (`/audio`, `/broadcast`, `/3d`, etc.) for domain-specific work:

- `/audio` — Web Audio API, Deepgram, Whisper, spatial audio, mic ducking, MediaRecorder
- `/broadcast` — VP9/Opus recording, Compositor, Iron-Clad Recorder, 15Mbps 1080p@60fps
- `/3d` — Three.js, GLB model loading, WebGL compositing, WebXR
- `/design` — HUD layout, CSS variables, cyber-noir themes, Orbitron font, glassmorphism
- `/deploy` — GitHub Pages, .nojekyll, Alchemy key injection, GitHub Actions, Heroku
- `/midi` — WebMIDI, controller mapping, MIDI learn, NoteOn, ControlChange
- `/p2p` — WebRTC, PeerJS, guest mode bridge, streaming
- `/web3` — MetaMask, ethers.js, NFT vault, Alchemy API, ERC-20/721, sovereign mode
- `/ipfs` — Pinata, NFT pinning, media upload, CID, IPFS gateway
- `/sfx` — Sound effects, WAV/MP3, Web Audio playback triggers

---

## UI INVARIANTS — DO NOT TOUCH

These are locked. Do not refactor, rename classes, restructure, or move these:

- **Clock & Ticker** — CSS and JS for the time display and broadcast news ticker are 100% stable
- **HUD Layout** — the DRIS//CORE grid and absolute positioning must remain intact
- **Identity Trinity** — Bug, 2D Logo, 3D Logo actors must always render at identity transform (no zoom/shake). They sit above the FX stack
- **Render loop gate** — `≥16ms` frame gate must be preserved; never remove the timestamp check

---

## Fix Priorities

1. **3D Logo Loading:** Always use relative paths (`./assets/logo.glb`). Use a `LoadingManager` to verify the model exists before rendering. Never use absolute paths.
2. **WebMIDI:** Must initialise inside a user gesture (click event). Add fallback if `navigator.requestMIDIAccess` is denied.
3. **P2P Calling:** Ensure `secure: true` and `port: 443` in PeerJS/WebRTC config. Redirect logs to the `GHOST>` terminal in the UI.

---

## Deployment Rules

- **GitHub Pages:** Always include `.nojekyll` in root to prevent Jekyll from blocking assets
- **Paths:** No absolute paths (starting with `/`). Everything must be relative to repo root
- **Secrets:** `ALCHEMY_KEY` injected via GitHub Actions at build time — never hardcode
- **Backend env vars:** `DEEPGRAM_API_KEY`, `FAL_KEY`, `PINATA_JWT` — stored in Heroku dashboard or `backend/.env` (never committed)
- **Branches:** `main` → GitHub Pages; `heroku` (or Procfile root) → Heroku backend

---

## Development Notes

- No build step — changes to `src/` and `index.html` deploy directly on push
- Backend local run: `uvicorn backend.main:app --host 0.0.0.0 --port 8000`
- Free local mode (no API keys): `python system_init.py`
- WebSocket endpoint: `ws://localhost:8000/ws/transcribe`
- All modules are inspectable from the browser console via `window.APP`
- `main.js` DOMContentLoaded closure (lines 531–4556) is intentionally not yet modularised — refactor one domain at a time into `src/modules/`, maintaining the global-scope contract

---

## Audio Synthesis — Current Kit State

The ambient engine ships 10+ kits. Recent additions (Groovebox Slicer update):

- **Chord Mode:** 3 detuned voices per oscillator for natural beating and chorusing — powers Dark Ether, Spectral, Glitch Ops, Cassette Noir, Neural Static
- **Deep Field stability:** Chrome Web Audio Biquad filter floor raised across HORIZON (`22Hz`), MATTER (`38Hz`), EVENT sub (`32Hz`) — do not lower these
- **Groovebox Slicer:** drag-and-drop WAV/MP3 → 16 auto-sliced equal points → scroll-wheel cell mapping. Waveform canvas + slice markers. Reset via ✕ button

---

## Author

**Andrea Merella** — Audio Specialist / Creative Developer, Amsterdam
