---
name: sfx
description: Sound effects, audio assets, WAV, MP3, crowd sounds, applause, airhorn, boom, sound triggers, Web Audio playback
---

# VNGRD SFX Skill

## Available Audio Assets
| File | Type | Description |
|------|------|-------------|
| `108512__buginthesys__applause_3.wav` | WAV 2.1MB | Crowd applause |
| `410868__nobodyyouknowof__crowd_cheering_and_clapping.wav` | WAV 628KB | Crowd cheer |
| `577697__cmudd14__airhorn.mp3` | MP3 76KB | Air horn |
| `67182__robinhood76__00897-massive-800-men-laugh.wav` | WAV 474KB | Crowd laugh |
| `BOOM.wav` | WAV 1.2MB | Explosion/impact |

All files are in the **repo root** — reference with relative paths: `./filename.wav`

## Playback via Web Audio API (recommended — respects audio graph)
```js
async function playSFX(url, ctx, gainNode) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(gainNode ?? ctx.destination);
  source.start();
}

// Usage
playSFX('./577697__cmudd14__airhorn.mp3', audioCtx, masterGain);
```

## Preload All SFX at Init
```js
const sfxCache = {};
const SFX_FILES = [
  './108512__buginthesys__applause_3.wav',
  './577697__cmudd14__airhorn.mp3',
  './BOOM.wav',
  // ...
];
async function preloadSFX(ctx) {
  for (const url of SFX_FILES) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    sfxCache[url] = await ctx.decodeAudioData(buf);
  }
}
```

## Simple HTML Audio (quick trigger, no graph routing)
```js
const sfx = new Audio('./577697__cmudd14__airhorn.mp3');
sfx.play();
```

## Adding New SFX
1. Drop file in repo root (or a `/sfx/` subdirectory)
2. Use relative path: `./sfx/newfile.wav`
3. Add to sw.js cache list if needed for offline use
4. Preload in the SFX init function

## Debugging Checklist
- [ ] AudioContext created inside a user gesture?
- [ ] File path is relative (not absolute)?
- [ ] File exists in the repo root?
- [ ] CORS issue? (should not occur for same-origin files)
- [ ] AudioContext not suspended? Call `ctx.resume()` if needed
