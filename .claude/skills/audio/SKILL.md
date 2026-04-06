---
name: audio
description: Pro audio, Web Audio API, Deepgram transcription, Whisper, spatial audio, side-chain ducking, compressor, master gain, MediaRecorder, real-time speech-to-text
---

# VNGRD Pro Audio Skill

## Stack
- **Web Audio API** — processing, panning, compression, limiting
- **Deepgram Nova-3** — live WebSocket speech-to-text
- **OpenAI Whisper** — fallback transcription with timestamps
- **GPT-4o** — broadcast-quality translation (EN→ES/FR/NL/IT)
- **MediaRecorder** — audio chunk streaming to backend
- **Backend**: FastAPI WebSocket (`backend/main.py`)

## Audio Pipeline
```
Microphone → getUserMedia → AudioContext
  → GainNode (master gain)
  → DynamicsCompressorNode
  → Side-chain ducker (mic triggers ducking on music bus)
  → Spatial panner (stereo/3D/Dolby modes)
  → DestinationNode / captureStream
```

## Deepgram Live Transcription Flow
```
Browser MediaRecorder → chunks → WebSocket → backend/main.py
  → Deepgram Nova-3 WebSocket → transcript → back to browser
```

## Key Patterns

### Create AudioContext (must be in user gesture)
```js
const ctx = new AudioContext();
const gain = ctx.createGain();
const compressor = ctx.createDynamicsCompressor();
gain.connect(compressor);
compressor.connect(ctx.destination);
```

### Side-chain ducking
```js
// When mic is active, reduce music gain
micAnalyser.on('voice', () => musicGain.gain.setTargetAtTime(0.2, ctx.currentTime, 0.1));
micAnalyser.on('silence', () => musicGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.3));
```

### Spatial audio (3D mode)
```js
const panner = ctx.createPanner();
panner.panningModel = 'HRTF';
panner.distanceModel = 'inverse';
```

## Debugging Checklist
- [ ] AudioContext created inside a user gesture?
- [ ] `getUserMedia` permissions granted?
- [ ] Deepgram WebSocket connected? (check `backend/main.py` WebSocket endpoint)
- [ ] `DEEPGRAM_API_KEY` set in `backend/.env`?
- [ ] MediaRecorder producing chunks? (check MIME type support)
- [ ] Compressor not clipping? (check threshold/ratio settings)
- [ ] Side-chain ducker not killing audio permanently?
- [ ] Backend server running? (`uvicorn main:app --host 0.0.0.0 --port 8000`)
