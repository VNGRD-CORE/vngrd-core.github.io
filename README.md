# VNGRD//
**Browser-native real-time audiovisual production system**

> A VJ engine, broadcast recorder, live transcriber, and Web3 workstation — running entirely in a single browser tab.

**[Launch System →](https://vngrd-core.github.io)**  No installation. No build step.

---

## Overview

VNGRD// CORE treats the browser as a real-time media execution environment.

Modern AV production workflows are fragmented across DAWs, VJ software, capture tools, streaming clients, and post-production suites. VNGRD// consolidates that stack into a single monolithic interface — from input capture to composited broadcast output to decentralised export.

```
Microphone · Camera · Files · MIDI · Hands · Keyboard · Wallet · P2P
                              │
                         APP (global state)
                              │
           ┌──────────────────┼──────────────────┐
      AUDIO GRAPH         RENDER PIPELINE      BROADCAST
      Web Audio API        Canvas 2D / WebGL   Recording + P2P
           │                   │                   │
           └───────────────────▼───────────────────┘
                              │
               Speakers · Canvas · Download · IPFS · Peer
```

---

## Capabilities

### Audio
- Live microphone capture with real-time level metering
- Full DAW-style audio chain: low/high shelf EQ → compressor → side-chain ducking → spatial modes (HRTF, Dolby) → master limiter
- Synthesis engine with oscillators, envelopes, and ambient kit presets (Void Drift, Dark Ether, Spectral, Glitch Ops, Cassette Noir, Neural Static, Deep Field)
- 16-pad Groovebox Slicer with drag-and-drop WAV/MP3 slicing (Renoise-style)
- Stereo rotation automation, WebMIDI device mapping + learn mode

### Visuals
- 60FPS canvas render engine with seismic and punch physics
- Audio-reactive VJ engine: bass-driven RGB shift, brightness, saturation, hue, pixelate
- WebGL virtual backgrounds with GLSL displacement
- Three.js 3D logo compositing (GLB model → WebGL → canvas drawImage)
- Identity Trinity: Station Bug + 2D Logo + 3D Logo — always at identity transform above the FX stack
- Lower thirds: 5 styles (Classic / Split / Neon / Glitch / Breaking)
- FX overlays: NVG, VHS, SCAN, TEAR
- Hand-gesture synthesis via MediaPipe → audio engine bridge
- AI image generation via Pollinations.AI → live canvas injection

### Broadcast & Recording
- Iron-Clad Recorder: VP9 + Opus, 1920×1080 @ 60fps, 15 Mbps (`Compositor.js`)
- VGD Clip capture with timer HUD and download
- P2P audio/video calling via WebRTC / PeerJS
- Screenshot export (`canvas.toDataURL → .png`)

### Platform
- Real-time multilingual transcription — Deepgram Nova-2/3 via WebSocket proxy
- Broadcast-quality translation via GPT-4o
- Web3: MetaMask wallet, DNA signing, NFT vault, Alchemy API, ERC-20/721, IPFS via Pinata
- GHOST terminal — structured logging + AI companion
- Weather-reactive atmosphere engine (METAR fetch)
- Session save/restore + IPFS export/import

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Vanilla JS · No bundler · No framework |
| Rendering | Canvas 2D · WebGL · Three.js r128 |
| Audio | Web Audio API · Tone.js · WebMIDI |
| Vision | MediaPipe HandLandmarker (GPU) |
| Streaming | WebRTC · PeerJS · MediaRecorder |
| Backend | FastAPI · Deepgram · Fal.ai · Pinata |
| Web3 | ethers.js · Alchemy · IPFS |
| Deploy | GitHub Pages · Heroku · GitHub Actions |

---

## Quick Start

**Browser launch:**
```
https://vngrd-core.github.io
```
Allow microphone and camera access. No sign-in required.

**Local (no API keys):**
```bash
python system_init.py
```
Uses Google Speech + deep-translator free tier. WebSocket at `ws://localhost:8000/ws/transcribe`.

**Full backend:**
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```
Requires `DEEPGRAM_API_KEY`, `FAL_KEY`, `PINATA_JWT` in `backend/.env`.

---

## Repository Layout

```
vngrd-core.github.io/
│
├── index.html                    # Monolithic UI (4,200+ lines)
├── main.py                       # Backend entry point
├── system_init.py                # Zero-key bootstrapper
├── requirements.txt
├── Procfile                      # Heroku process config
│
├── src/
│   ├── js/                       # Core files
│   │   ├── main.js               # APP state + boot sequence (~4,600 lines)
│   │   ├── vj-engine.js          # Bass-reactive VJ tick
│   │   ├── logo-3d.js            # Three.js GLB loader + WebGL composite
│   │   ├── speech-engine.js      # Polytranslator (webkitSpeechRecognition + P2P)
│   │   ├── vb-shader.js          # WebGL virtual backgrounds (GLSL)
│   │   ├── gesture.js            # MediaPipe → synth bridge
│   │   └── audio-rotation.js     # Stereo rotation (ES module)
│   │
│   ├── modules/                  # Domain modules (26 files)
│   │   ├── render-loop.js        # 60FPS canvas engine
│   │   ├── audio-chain.js        # DAW engine: file load, playback, spatial modes
│   │   ├── audio-synth.js        # Synthesis engine
│   │   ├── sonic-suite.js        # Studio shell + master clock
│   │   ├── slicer-card.js        # 16-pad sampler + step sequencer
│   │   ├── mixer-card.js         # Per-card fader/mute/solo + master meter
│   │   ├── ghost.js              # GHOST terminal
│   │   ├── wallet.js             # MetaMask + NFT vault
│   │   ├── workspace.js          # Session save/restore + IPFS
│   │   └── ...                   # See ARCHITECTURE.md for full catalogue
│   │
│   ├── Compositor.js             # Iron-Clad Recorder (VP9/Opus 15Mbps 1080p@60)
│   ├── synesthesia-voice-engine.js
│   └── hand-tracker.js           # MediaPipe Tasks HandLandmarker (GPU)
│
├── backend/
│   ├── main.py                   # WebSocket transcription proxy + image gen + IPFS
│   ├── router.py                 # Pollinations fallback router
│   ├── transcriber.py            # Whisper API wrapper
│   └── translator.py             # GPT-4o broadcast-quality translation
│
└── assets/                       # Static media
```

Full architecture, module catalogue, APP state map, render pipeline, audio graph, and script load order: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

---

## Modules

26 domain modules in `src/modules/`. Script load order is explicit — all modules share `window`, no ESM (except `audio-rotation.js`). `APP` is the single source of truth and message bus: modules read and write it directly rather than calling each other.

| Module | Responsibility |
|---|---|
| `render-loop.js` | 60FPS canvas engine, physics, FX overlays, lower thirds |
| `audio-chain.js` | DAW engine: file load, playback, spatial modes, VU |
| `audio-synth.js` | Synthesis engine: oscillators, envelopes, ambient kits |
| `sonic-suite.js` | Studio card shell + master clock |
| `slicer-card.js` | 16-pad sampler + step sequencer |
| `ghost.js` | GHOST terminal — structured logging + AI companion |
| `workspace.js` | Session save/restore + IPFS export/import |
| `wallet.js` | MetaMask connect, DNA signing, NFT vault |
| `ticker.js` | Crypto prices (Binance), broadcast ticker |
| `weather.js` | METAR fetch → atmosphere engine |

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the complete table.

---

## Changelog

Latest: Ambient Engine + Groovebox Slicer update — 7 new ambient kits, Renoise-style drag-and-drop slicer, Deep Field stability fixes.

Full notes: [`CHANGELOG.md`](./CHANGELOG.md)

---

## Deployment

- **Frontend:** GitHub Pages (`gh-pages` branch, `.nojekyll` in root)
- **Backend:** Heroku — `DEEPGRAM_API_KEY`, `FAL_KEY`, `PINATA_JWT` set in dashboard
- **CI/CD:** GitHub Actions injects `ALCHEMY_KEY` at build time — never hardcoded
- **Paths:** All relative. No absolute paths (`/`) — GitHub Pages requirement

See [`DEPLOY.md`](./DEPLOY.md) for full deployment runbook.

---

## Author

**Andrea Merella** — Audio Specialist / Creative Developer, Amsterdam  
Media systems · broadcast workflows · sound design

---

*VNGRD// is not a replacement for professional desktop tools. It is a rethink of where real-time AV production can run.*
