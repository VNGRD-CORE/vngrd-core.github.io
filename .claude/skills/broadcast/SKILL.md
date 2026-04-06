---
name: broadcast
description: Broadcasting, video recording, compositing, VP9, Opus, MediaRecorder, Compositor, RecorderWorker, Iron-Clad Recorder, 15Mbps, 1080p, 60fps, time machine buffer
---

# VNGRD Broadcast / Recording Skill

## Stack
- **Compositor.js** — Iron-Clad Recorder Engine (offscreen 1920x1080 @ 60fps)
- **RecorderWorker.js** — Web Worker for chunk buffering (rolling 30s Time Machine)
- **MediaRecorder API** — VP9 video + Opus audio → WebM container
- **canvas.captureStream()** — real-time canvas → MediaStream
- **Target**: VP9 @ 15Mbps + Opus @ 128Kbps

## Codec Detection (required before recording)
```js
const mimeType = 'video/webm;codecs=vp9,opus';
if (!MediaRecorder.isTypeSupported(mimeType)) {
  // fallback to vp8 or h264
}
```

## Compositor Layer Order
```
Layer 1: Three.js 3D scene (WebGL canvas)
Layer 2: Camera feed (video element)
Layer 3: VJ effects overlay (2D canvas)
  ↓
Offscreen 1920x1080 composite canvas
  ↓
captureStream(60) → MediaRecorder → WebM chunks → RecorderWorker
```

## Recording Start Pattern
```js
const stream = compositeCanvas.captureStream(60);
const recorder = new MediaRecorder(stream, {
  mimeType: 'video/webm;codecs=vp9,opus',
  videoBitsPerSecond: 15_000_000,
  audioBitsPerSecond: 128_000,
});
recorder.ondataavailable = (e) => worker.postMessage({ chunk: e.data });
recorder.start(100); // 100ms chunks
```

## Time Machine (30s rolling buffer)
- `RecorderWorker.js` maintains a rolling buffer of chunks
- Prunes chunks older than 30 seconds
- On "save clip" — assembles last 30s into a Blob and triggers download

## Performance Targets
| Metric | Target |
|--------|--------|
| Resolution | 1920×1080 |
| Frame rate | 60fps |
| Video bitrate | 15 Mbps (VP9) |
| Audio bitrate | 128 Kbps (Opus) |
| VJ canvas | 540p internal → upscaled |

## Debugging Checklist
- [ ] VP9+Opus supported? (`MediaRecorder.isTypeSupported`)
- [ ] `captureStream(60)` called on the composite canvas (not the 3D canvas)?
- [ ] Worker receiving chunks? (check `postMessage` in `ondataavailable`)
- [ ] Frame drops detected? (check compositor's frame lock logic)
- [ ] Bitrate hitting 15Mbps? Run `verify-bitrate.js`
- [ ] Run `benchmark.js` to get baseline performance before profiling
