# VNGRD// CORE — Architecture

Browser-native real-time audiovisual production system.  
Single-page application, no build step, no framework, no bundler.

---

## System Map

```
┌─────────────────────────────────────────────────────────────────┐
│                          INPUTS                                  │
│  Microphone  Camera  Files  MIDI  Hands  Keyboard  Wallet  P2P  │
└────────────────────────┬────────────────────────────────────────┘
                         │
          ┌──────────────▼──────────────┐
          │        APP (global state)    │
          │   single source of truth    │
          └──────────────┬──────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌───────────────┐ ┌────────────┐ ┌──────────────┐
│  AUDIO GRAPH  │ │   RENDER   │ │  BROADCAST   │
│  Web Audio    │ │  Pipeline  │ │  Recording   │
│  API chain    │ │  Canvas 2D │ │  + P2P out   │
└───────┬───────┘ └─────┬──────┘ └──────┬───────┘
        │               │               │
        └───────────────▼───────────────┘
                        │
              ┌─────────▼──────────┐
              │      OUTPUTS        │
              │  Speakers  Canvas  │
              │  Download  Stream  │
              │  IPFS      Peer    │
              └────────────────────┘
```

---

## Repository Layout

```
vngrd-core.github.io/
│
├── index.html              # Entry point (4,200+ lines — UI, inline SVG, script tags)
├── CLAUDE.md               # AI assistant constraints (UI invariants, deploy rules)
├── .nojekyll               # Prevents GitHub Pages from running Jekyll on assets
│
├── src/
│   ├── js/                 # Legacy + core files (not yet modularised)
│   │   ├── main.js         # APP state, boot sequence, DOMContentLoaded closure (~4,600L)
│   │   ├── speech-engine.js # Polytranslator — webkitSpeechRecognition + P2P sync
│   │   ├── logo-3d.js      # Three.js pipeline — GLB model loading + WebGL composite
│   │   ├── vj-engine.js    # Bass-reactive VJ tick (called from mainLoop)
│   │   ├── vb-shader.js    # WebGL virtual backgrounds (GLSL displacement)
│   │   ├── gesture.js      # MediaPipe hand-tracking → synth gesture bridge
│   │   ├── audio-rotation.js # (ES module) stereo rotation automation
│   │   └── vb-timers.js    # Virtual background timing helpers
│   │
│   ├── modules/            # Extracted domains — each owns a clear responsibility
│   │   │
│   │   │  ── RENDER PIPELINE ──────────────────────────────────────────
│   │   ├── render-loop.js       # 60FPS canvas engine, physics, FX overlays, lower thirds
│   │   ├── media-strip.js       # Canvas draw: toggle tab, NFT vault, media queue strip
│   │   ├── vfx-layer.js         # WebGL chromatic aberration + displacement overlay
│   │   ├── gif-decoder.js       # LZW GIF decode + frame compositor for captureStream
│   │   │
│   │   │  ── AUDIO ─────────────────────────────────────────────────────
│   │   ├── audio-chain.js       # DAW engine: file load, playback, spatial modes, VU
│   │   ├── audio-synth.js       # Synthesis engine: oscillators, envelopes, effects
│   │   ├── mic-ducking.js       # Side-chain: auto-duck music when mic is live
│   │   │
│   │   │  ── MEDIA ─────────────────────────────────────────────────────
│   │   ├── media-loader.js      # Bulk file upload → queue (EXIF-corrected dimensions)
│   │   ├── media-controls.js    # Video/audio wiring, rotate, eject, queue management
│   │   ├── summoner.js          # NFT vault click, seam controls, media queue navigation
│   │   │
│   │   │  ── SONIC SUITE (card ecosystem) ──────────────────────────────
│   │   ├── sonic-suite.js       # Studio shell + master clock (owns window.SonicSuite)
│   │   ├── code-card.js         # Live-coding DSL for Sonic Suite
│   │   ├── slicer-card.js       # 16-pad sampler + step sequencer
│   │   ├── mixer-card.js        # Per-card fader/mute/solo + master meter + reverb
│   │   │
│   │   │  ── IDENTITY / UI ────────────────────────────────────────────
│   │   ├── trinity-input.js     # Mouse + touch bridge for Trinity actor drag/scale
│   │   ├── ticker.js            # Crypto prices (Binance), broadcast ticker, ethereal mode
│   │   ├── ui-utils.js          # Themes, FX toggles, clock, fullscreen, system reset
│   │   │
│   │   │  ── BROADCAST / RECORD ─────────────────────────────────────────
│   │   ├── nft-recording.js     # VGD clip capture, timer HUD, finalize + download
│   │   ├── camera.js            # Live capture, loop inject, broadcast recording
│   │   │
│   │   │  ── WEB3 ───────────────────────────────────────────────────────
│   │   ├── wallet.js            # MetaMask connect, DNA signing, NFT vault load
│   │   ├── liquid-library.js    # VJ Heavy Sync + cinematic synth pad presets
│   │   │
│   │   │  ── PLATFORM ──────────────────────────────────────────────────
│   │   ├── ghost.js             # GHOST terminal — structured logging + AI companion
│   │   ├── workspace.js         # Session save/restore + IPFS export/import
│   │   ├── weather.js           # METAR fetch → atmosphere engine
│   │   └── ai-generator.js      # Pollinations.AI cascade → live canvas injection
│   │
│   ├── Compositor.js           # Iron-Clad Recorder (VP9/Opus, 15Mbps, 1080p@60fps)
│   ├── synesthesia-voice-engine.js  # Voice-reactive visual engine
│   └── hand-tracker.js         # MediaPipe Tasks HandLandmarker (GPU)
│
└── assets/                     # Static media (logo, hero GIF, GLB model)
```

---

## Module Catalogue

| Module | Lines | Owns | Key Globals Needed |
|---|---|---|---|
| `render-loop.js` | 1,129 | `renderLoop`, `triggerImpact`, `makeDraggable` | `APP`, `rotateMedia`, `drawMediaStripToggle` |
| `ghost.js` | 879 | `ghostLog`, GHOST terminal UI | `$`, `APP` |
| `slicer-card.js` | 801 | 16-pad sampler, step sequencer | `SonicSuite`, `_ssAnalyser` |
| `audio-synth.js` | 799 | synthesis engine, oscillators | `APP`, `igniteAudio` |
| `workspace.js` | 644 | session snapshot, IPFS export | `$`, `APP`, `log`, `setTheme` |
| `vb-shader.js` | 632 | WebGL virtual backgrounds | none at parse time |
| `sonic-suite.js` | 486 | `SonicSuite`, master clock | `APP`, `igniteAudio` |
| `media-strip.js` | 504 | `drawMediaStripToggle`, `drawNFTVault`, `drawMediaQueue` | `$`, `APP` |
| `liquid-library.js` | 306 | pad presets, VJ sync | `APP`, `igniteAudio`, `ensureAudioChain` |
| `summoner.js` | 327 | `initSummonerLogic`, `summonNFTByIndex`, `_durSteps` | `$`, `APP`, `triggerImpact` |
| `camera.js` | 289 | `initCamera`, `startCameraRecord` | `$`, `APP`, `log` |
| `media-controls.js` | 237 | `rotateMedia`, `updateQueueDisplay`, `connectVideoAudio` | `$`, `APP`, `log` |
| `code-card.js` | 221 | live-coding DSL | `SonicSuite` |
| `vfx-layer.js` | 218 | `VFXLayer`, `_vfxFrameTick` | none at parse time |
| `ticker.js` | 215 | `fetchCrypto`, broadcast ticker | `$`, `APP` |
| `audio-chain.js` | 200 | `loadAudioFiles`, `playTrack`, `setAudioMode`, `updateVU` | `$`, `APP`, `log` |
| `mixer-card.js` | 184 | fader/mute/solo, master meter | `SonicSuite`, `_ssAnalyser`, `_ssReverbReturn` |
| `nft-recording.js` | 165 | `startNFTRecording`, `updateNFTTimer` | `$`, `APP`, `log`, `ensureAudioChain` |
| `trinity-input.js` | 163 | drag + pinch for Trinity actors | `$`, `APP` |
| `ui-utils.js` | 142 | `setTheme`, FX toggles, clock | `$`, `APP`, `log` |
| `wallet.js` | 138 | `connectWallet`, NFT vault load | `$`, `APP`, `log` |
| `ai-generator.js` | 136 | Pollinations.AI fetch + inject | `$`, `APP`, `log`, `updateQueueDisplay` |
| `weather.js` | 126 | METAR fetch, atmosphere update | `$`, `APP` |
| `mic-ducking.js` | 41 | `updateDucking` (called from mainLoop) | `APP` |
| `gif-decoder.js` | 69 | `_gifLzwDecode`, `_decodeGIF` | none |
| `media-loader.js` | 50 | `loadMediaFiles` | `$`, `APP`, `log`, `rotateMedia` |

---

## Global State — `APP`

Single object defined in `main.js` line 43. All modules read and write it directly.

| Namespace | Owns |
|---|---|
| `APP.state` | Live/record/fullscreen flags, theme, cycle timer |
| `APP.vj` | Visual parameters: brightness, contrast, saturation, hue, RGB, pixelate, seismic physics |
| `APP.audio` | Web Audio context, nodes, playlist, VU data, spatial mode |
| `APP.inputDevices` | Mic device list, 48kHz raw stream, analyzer for level meter |
| `APP.media` | Queue, current element, A/B transition state, seam controls |
| `APP.render` | Canvas, 2D context, resolution, FPS counter, pixel-art buffer |
| `APP.trinity` | Bug (x/y/scale/visible), logo 2D, logo 3D — the three broadcast actors |
| `APP.bug` | Station bug text, style, color, render mode, P2P remote identity |
| `APP.lowerThird` | Visibility, preset, animation timing, style colour |
| `APP.camera` | Live stream, recorder, mic stream, preview element |
| `APP.nft` | Clip recorder, chunk buffer, timer, DNA snapshot |
| `APP.broadcast` | Broadcast recorder + chunks |
| `APP.peer` | PeerJS peer, active call, local stream |
| `APP.guest` | Remote peer video element, audio source, active flag |
| `APP.wallet` | MetaMask connection, address, chain, NFT list |
| `APP.user` | Loaded NFT assets (images + videos) |
| `APP.nftVault` | Vault thumbnail hit zones, scroll offset |
| `APP.midi` | Web MIDI access, bindings map, learn mode, synth state |
| `APP.compositor` | Iron-Clad Recorder instance |
| `APP.web3` | ethers provider/signer, address, sovereign mode |
| `APP.atmosphere` | Weather data, rain engine, canvas, MIDI override |
| `APP.ghost` | Seismic energy, secured nodes, directory handle |
| `APP.shooting` | Fracture/dent state, machine-gun interval, repair timer |
| `APP.status` | Boot guards: `is3DActive`, `isMidiActive`, `isAudioActive`, `booted` |

---

## Script Load Order

Order matters. All files share `window` — no import/export. A module can only call functions defined in files loaded before it.

```
1.  CDN: Three.js r128 + OBJLoader + STLLoader   (window.THREE)
2.  CDN: PeerJS 1.5.2                             (window.Peer)
3.  CDN: Tone.js 14.8.49                          (window.Tone)
4.  CDN: ethers.js 5.7.2                          (window.ethers)
5.  src/Compositor.js                             (window.Compositor)
6.  CDN: QRCode.js
    ── DOMContentLoaded not yet fired ──
7.  src/js/main.js           → defines APP, $, log, initCanvas,
                               bootSequence, ensureAudioChain,
                               and the DOMContentLoaded closure
8.  src/modules/render-loop.js   → renderLoop, triggerImpact, makeDraggable
9.  src/modules/summoner.js      → initSummonerLogic, summonNFTByIndex
10. src/modules/media-loader.js  → loadMediaFiles
11. src/modules/media-strip.js   → drawMediaStripToggle, drawNFTVault, drawMediaQueue
12. src/modules/gif-decoder.js   → _gifLzwDecode, _decodeGIF
13. src/modules/trinity-input.js → drag/pinch IIFE (executes immediately)
14. src/modules/media-controls.js → rotateMedia, updateQueueDisplay
15. src/modules/mic-ducking.js    → updateDucking
16. src/modules/ticker.js         → fetchCrypto
17. src/modules/ghost.js          → ghostLog
18. src/modules/weather.js        → fetchWeather
19. src/modules/workspace.js      → saveSession, loadSession
20. src/modules/ui-utils.js       → setTheme (IIFE sets up clock + FX toggles)
21. src/modules/ai-generator.js   → triggerAIGenerate
22. src/modules/audio-synth.js    → synthesis engine
23. src/modules/camera.js         → initCamera
24. src/modules/audio-chain.js    → loadAudioFiles, playTrack, setAudioMode
25. src/modules/nft-recording.js  → startNFTRecording
26. src/modules/wallet.js         → connectWallet
27. src/modules/liquid-library.js → pad presets
28. src/modules/vfx-layer.js      → VFXLayer (IIFE, no external deps)
29. src/modules/sonic-suite.js    → SonicSuite (card container)
30. src/modules/code-card.js      → depends on SonicSuite
31. src/modules/slicer-card.js    → depends on SonicSuite
32. src/modules/mixer-card.js     → depends on SonicSuite, _ssReverbReturn
33. src/js/audio-rotation.js      → (ES module) stereo rotation automation
34. src/js/vj-engine.js           → bass-reactive VJ tick
35. src/js/vb-shader.js           → virtual background IIFE
36. src/js/gesture.js             → MediaPipe hand tracking
37. src/synesthesia-voice-engine.js
38. src/hand-tracker.js
    ── DOMContentLoaded fires → main.js closure executes ──
```

---

## Render Pipeline

Every animation frame (target: 60FPS, gated to ≥16ms):

```
renderLoop(timestamp)
    │
    ├─ Seismic engine    — velocity accumulator → canvas translate
    ├─ Punch engine      — underdamped spring → canvas scale (tweeter model)
    ├─ Filter stack      — brightness/contrast/saturation/hue + FX grade
    │
    ├─ Source draw
    │   ├─ A/B transition engine (optical-fade / dip-black / snap)
    │   └─ object-fit:cover  — EXIF-corrected aspect ratio
    │
    ├─ RGB shift         — screen-blend canvas read-back (bass-reactive)
    │
    ├─ Identity Trinity  [always at identity transform — never zoom/shake]
    │   ├─ Actor 1: Station Bug   (text styles: solid/pulse/glitch/knockout/inverted)
    │   ├─ Actor 2: 2D Logo       (static PNG or GIF with LZW frame compositor)
    │   └─ Actor 3: 3D Logo       (Three.js WebGL → drawImage composite)
    │
    ├─ Lower Third       (5 styles: classic / split / neon / glitch / breaking)
    ├─ Media strips      (toggle tab + NFT vault + media queue — canvas hit zones)
    ├─ VNGRD signature
    ├─ Party mode flash  (screen-blend rainbow, LED strobe)
    │
    └─ FX overlays       [identity transform, sit above everything]
        ├─ NVG:  tube vignette + CRT scanlines + GPNVG-18 reticle
        ├─ VHS:  chroma bleed + scanline jitter + dropout + head-switch artifact
        ├─ SCAN: animated cyan laser sweep bar
        └─ TEAR: horizontal slice displacement (14 bands)
```

---

## Audio Graph

```
MediaElementSource (file/mic)
        │
        ▼
    Panner (HRTF) ──────────────────────────────────────┐
        │                                                │
    Low Shelf EQ (60Hz)                           Dolby Panner
        │                                                │
    High Shelf EQ (12kHz)                               │
        │                                                │
    DynamicsCompressor                                   │
        │                                                │
    Ducking Gain ◄── updateDucking() [mainLoop tick]    │
        │                                                │
    Analyser (fftSize:64) → vuData → renderLoop          │
        │                                                │
    Master Gain ─────────────────────────────────────────┘
        │               │
        │         Stereo Gain
        │               │
    Output Limiter ◄────┘
   (-12dB, ratio 2.5)
        │
    ctx.destination (speakers)
        │
    MediaStreamDestination → MediaRecorder (recording)
```

Mic input routes to `inputDevices.analyzer` only — never to `panner` (prevents acoustic feedback).

---

## Recording Paths

**VGD Clip** (`nft-recording.js`):  
`masterGain → recorderDest → MediaRecorder (VP9/Opus)` → `.webm` download

**Broadcast** (`camera.js`):  
`canvas.captureStream(60) + micStream → Compositor → high-bitrate .webm`

**Screenshot** (`main.js:takeScreenshot`):  
`canvas.toDataURL('image/png')` → `.png` download

**P2P Stream** (`main.js DOMContentLoaded`):  
`canvas.captureStream() + localStream → RTCPeerConnection → remote peer`

---

## Design Decisions

**No bundler, no ESM (mostly).** Script tags in load order give full control over parse time vs. execution time. The single exception is `audio-rotation.js` which uses `type="module"` for its own scope isolation.

**`APP` as the message bus.** Modules don't call each other directly — they read and write `APP`. This keeps coupling explicit and makes state inspectable from the browser console at any time.

**Canvas is the recorder.** All visual output — Trinity actors, lower thirds, FX overlays — is drawn directly to the `<canvas>` element that `captureStream()` taps. There is no separate "recording canvas." What you see is what the recording captures.

**Function declarations, not classes.** Deliberate choice for this scale. Each module file is a flat list of function declarations that go straight onto `window`. No instantiation overhead, no `this` binding issues across event handlers.

**DOMContentLoaded closure.** `main.js` lines 531–4556 is one arrow-function closure. Code inside it (P2P engine, boot sequence, input handlers) has access to the full closure scope. Code outside it (all `src/modules/`) accesses the system through `APP` and globally-declared functions.

---

## What's Still in `main.js`

The DOMContentLoaded closure has not yet been broken up. It currently owns:

- Boot sequence + audio context init
- P2P / WebRTC call engine (~700 lines)
- MIDI initialisation + learn mode
- Hand-tracking init + SFX engine
- Voice input (polytranslator) wiring
- Camera + mic input switching
- ElevenLabs voiceover director
- `mainLoop` tick scheduler

Ongoing refactor: extracting these into `src/modules/` one domain at a time, maintaining the global-scope contract.
