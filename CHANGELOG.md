# VNGRD// CORE Changelog

## Ambient Engine + Groovebox Slicer Update

### 1) New Architecture: Chord Synthesis Mode
Added a dedicated **Chord Mode** that runs **3 detuned voices per oscillator frequency**. This produces natural beating and chorusing for wider, richer pads.

This mode currently powers:
- **Dark Ether**
- **Spectral**
- **Glitch Ops**
- **Cassette Noir**
- **Neural Static**

---

### 2) 7 New Ambient Kits (Zero One-Shots)
All new kits are ambient, cinematic, and textural, emphasizing long tails and evolving soundscapes.

#### VOID DRIFT
- 12–15s ethereal low drones
- Built from noise, AM movement, resonant layers, and sine sweeps

#### DARK ETHER
- Cinematic sub-pressure foundation
- Chord-tension pads

#### SPECTRAL
- Crystalline shimmer profile
- Resonant highs, chord clusters, and ghost noise

#### GLITCH OPS
- Sustained digital glitch textures
- Databend sweeps and stutters with long tails

#### CASSETTE NOIR
- Lo-fi, warped AM/chord/resonant pads
- Heavy tape-style saturation

#### NEURAL STATIC (Full Ambient Rework)
- Re-tuned from harsh hits to evolving ambient textures
- Typical tails: 10–11s

#### Kit Voice Replacements
- **CORRUPT:** Bandpass/distorted hit replaced with lowpass noise
  - `freq: 680Hz`, `Q: 4.5`, `dist: 0.08`, `tail: 10s`
- **ENCODE:** Metallic hit replaced with resonant sweep
  - `220Hz → 95Hz`, `tail: 9.5s`
- **PHASE:** Fast AM retuned
  - `AM: 110Hz`, `LFO x1.4` (slow), light distortion, `tail: 10s`
- **MASK:** Sawtooth chord replaced with sine chord
  - `110/165/220Hz`, `detune: 18`, `tail: 11s`

---

### 3) DEEP FIELD Stability Rework
Resolved a silent pad issue caused by Chrome Web Audio rendering instability for ultra-low Biquad filter frequencies (below approximately 15Hz).

Changes:
- **HORIZON:** `freqEnd` raised from `10Hz` → `22Hz`
- **MATTER:** frequency raised from `22Hz` → `38Hz`; duration capped at `11s` to prevent large `OfflineAudioContext` allocations
- **EVENT:** sub raised from `26Hz` → `32Hz`; filter raised from `55Hz` → `80Hz` for reliable boom rendering

---

### 4) Groovebox Slicer (Renoise-Style Drop & Slice)

#### Drag & Drop
Drop any WAV or MP3 directly onto the **DROP WAV / MP3 → SLICE** zone in the tracker.

#### Engine
- Decodes and stores the dropped buffer instantly
- Routes all 4 tracker rows through the loaded source

#### Slicing
- Auto-generates 16 equal slice points
- Each cell can map slices via scroll wheel (`0–15`)

#### Visuals
- Waveform canvas draws the loaded source
- Includes all 16 vertical slice markers

#### Reset
- Dedicated **✕** button clears slicer buffer
- Rows revert to standard synth kits

---

### 5) UI / UX Calibration
- **Pad Footprint:** Height fixed at `34px` (balance point between 26px and 44px)
- **FX Label Visibility:** Moved from `bottom: 10px` to `bottom: 3px` for cleaner alignment and improved readability
- **Unified FX Coupling:** Gear menu now wires every `.sfx-btn` consistently so FX coupling behaves identically across all 12 pads
