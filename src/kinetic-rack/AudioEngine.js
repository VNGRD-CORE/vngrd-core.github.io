/**
 * AudioEngine.js — 4-Channel IDM/Techno Master Graph
 *
 * Signal flow:
 *   KickChannel   (MembraneSynth → Distortion)       ─┐
 *   BassChannel   (FMSynth → Filter)                   │
 *   GlitchChannel (NoiseSynth → BitCrusher → Delay)    ├→ masterGain → Limiter → Destination
 *   AtmosChannel  (PolySynth/AMSynth → Reverb → Pan)  ─┘        ↓
 *   SpatialSynth oscillators → synthInput ────────────────→  Analyser (FFT monitor)
 *
 * New parameters:
 *   setBassFilterCutoff(x)   Left Index X → 80..5000 Hz
 *   setGlitchDepth(y)        Left Index Y → BitCrusher bits + delay wet
 *   setAtmosReverbWet(y)     Right Index Y → Reverb wet 0..0.9
 *   setSpatialPan(x)         Right Index X → pan -1..+1
 *   getFFT()                 → Float32Array(256) normalized 0..1
 *
 * Legacy API preserved:
 *   synthInput, triggerKick, triggerKit, switchKit, triggerSequencerNote,
 *   setVolume, setReverbMix, setManualFilter, setDronePitch, setFilterCutoff,
 *   setAutoFilterFreq, getRecordingDest, releaseRecordingDest, dispose
 */

const DRONE_NOTES = ['A1','C2','D2','F2','G2','A2','C3','D3','F3','G3','A3'];
const KIT_NAMES   = ['KICK','GLITCH','ATMOS'];

export class AudioEngine {
    constructor() {
        this.ctx          = null;

        // Master chain (Tone.js)
        this._limiter     = null;
        this._masterGain  = null;
        this._analyser    = null;
        this._fftData     = new Float32Array(256);

        // KickChannel
        this._kick        = null;
        this._kickDist    = null;

        // BassChannel
        this._bass        = null;
        this._bassFilter  = null;

        // GlitchChannel
        this._glitch      = null;
        this._bitCrusher  = null;
        this._pingPong    = null;

        // AtmosChannel
        this._atmos       = null;
        this._atmosReverb = null;
        this._atmosPanner = null;

        // SpatialSynth: Tone.Gain → masterGain; .input exposed as AudioNode
        this._synthGain   = null;
        this._synthInput  = null;

        // GestureLooper effects bus
        this._loopDelay   = null;   // Tone.PingPongDelay
        this._loopReverb  = null;   // Tone.Reverb

        this._kitIndex    = 0;
        this._recDest     = null;
    }

    async init() {
        const Tone = window.Tone;
        if (!Tone) throw new Error('Tone.js not loaded');

        await Tone.start();
        this.ctx = Tone.getContext().rawContext;

        // ── Master chain ──────────────────────────────────────────────────────
        this._limiter    = new Tone.Limiter(-3).toDestination();
        this._masterGain = new Tone.Gain(0.7).connect(this._limiter);

        // Analyser: parallel tap, NOT in main signal path
        this._analyser = new Tone.Analyser({ type: 'fft', size: 256 });
        this._masterGain.connect(this._analyser);

        // Bridge Tone's default output into our masterGain
        try {
            const toneDest = Tone.getDestination();
            toneDest.disconnect();
            toneDest.connect(this._masterGain);
        } catch (_) {}

        // ── SpatialSynth native input ─────────────────────────────────────────
        // Use a Tone.Gain so the connection to _masterGain uses Tone's own
        // routing — no .input property guessing, no silent-catch disconnect.
        this._synthGain  = new Tone.Gain(0.55).connect(this._masterGain);
        this._synthInput = this._synthGain.input;   // underlying GainNode

        // ── KickChannel ───────────────────────────────────────────────────────
        this._kickDist = new Tone.Distortion({ distortion: 0.35, wet: 0.4 })
            .connect(this._masterGain);

        this._kick = new Tone.MembraneSynth({
            pitchDecay:  0.12,
            octaves:     10,
            oscillator:  { type: 'sine' },
            envelope:    { attack: 0.001, decay: 0.55, sustain: 0, release: 0.2 },
        }).connect(this._kickDist);
        this._kick.volume.value = -2;

        // ── BassChannel ───────────────────────────────────────────────────────
        this._bassFilter = new Tone.Filter({
            type:      'lowpass',
            frequency: 800,
            Q:         4,
            rolloff:   -24,
        }).connect(this._masterGain);

        this._bass = new Tone.FMSynth({
            harmonicity:        0.5,
            modulationIndex:    4,
            oscillator:         { type: 'sawtooth' },
            envelope:           { attack: 0.6, decay: 0.1, sustain: 0.9, release: 3.0 },
            modulation:         { type: 'sine' },
            modulationEnvelope: { attack: 0.4, decay: 0, sustain: 1, release: 2.5 },
        }).connect(this._bassFilter);
        this._bass.volume.value = -14;
        this._bass.triggerAttack('A1');

        // ── GlitchChannel ─────────────────────────────────────────────────────
        this._pingPong = new Tone.PingPongDelay({
            delayTime: 0.25,
            feedback:  0.4,
            wet:       0.5,
        }).connect(this._masterGain);

        this._bitCrusher = new Tone.BitCrusher({ bits: 8 })
            .connect(this._pingPong);

        this._glitch = new Tone.NoiseSynth({
            noise:    { type: 'white' },
            envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.015 },
        }).connect(this._bitCrusher);
        this._glitch.volume.value = -18;

        // ── AtmosChannel ──────────────────────────────────────────────────────
        this._atmosPanner = new Tone.Panner(0).connect(this._masterGain);

        this._atmosReverb = new Tone.Reverb({ decay: 6.0, wet: 0.6 });
        await this._atmosReverb.ready;
        this._atmosReverb.connect(this._atmosPanner);

        this._atmos = new Tone.PolySynth(Tone.AMSynth, {
            harmonicity:        2.5,
            oscillator:         { type: 'sine' },
            envelope:           { attack: 1.2, decay: 0.5, sustain: 0.8, release: 4.0 },
            modulation:         { type: 'square' },
            modulationEnvelope: { attack: 0.8, decay: 0, sustain: 1, release: 3 },
        }).connect(this._atmosReverb);
        this._atmos.volume.value = -20;
        this._atmos.triggerAttack(['G2', 'D3', 'A3']);

        // ── GestureLooper effects bus (isolated — failure must NOT kill main init) ─
        // Chain: FMSynth → _loopDelay → _loopReverb → masterGain
        try {
            this._loopReverb = new Tone.Reverb({ decay: 4.0, wet: 0.35 });
            await this._loopReverb.ready;
            this._loopReverb.connect(this._masterGain);

            this._loopDelay = new Tone.PingPongDelay({
                delayTime: 0.25,
                feedback:  0.35,
                wet:       0.28,
            });
            this._loopDelay.connect(this._loopReverb);
        } catch (e) {
            console.warn('[AudioEngine] Loop bus init failed — loops will use dry output:', e);
            this._loopDelay = null;
            this._loopReverb = null;
        }
    }

    // ── SpatialSynth compat ───────────────────────────────────────────────────
    get synthInput() { return this._synthInput; }

    // ── GestureLooper bus ─────────────────────────────────────────────────────
    getLoopBus() { return this._loopDelay; }

    setLoopDelayWet(v) {
        try { this._loopDelay?.wet.rampTo(Math.max(0, Math.min(1, v)), 0.1); }
        catch (_) {}
    }

    // ── FFT ───────────────────────────────────────────────────────────────────
    /** @returns {Float32Array} 256 values normalized 0..1 */
    getFFT() {
        if (!this._analyser) return this._fftData;
        const raw = this._analyser.getValue();
        for (let i = 0; i < 256; i++) {
            this._fftData[i] = Math.max(0, Math.min(1, (raw[i] + 100) / 100));
        }
        return this._fftData;
    }

    // ── Kick ──────────────────────────────────────────────────────────────────
    triggerKick(vel = 1.0) {
        try {
            this._kick?.triggerAttackRelease('C1', '8n', undefined, Math.min(1, vel));
        } catch (_) {}
    }

    // ── New parameter controls ────────────────────────────────────────────────

    /** Left Index X → Bass Filter Cutoff (0..1 → 80..5000 Hz) */
    setBassFilterCutoff(x) {
        try {
            this._bassFilter?.frequency.rampTo(80 + x * 4920, 0.05);
        } catch (_) {}
    }

    /** Left Index Y → Glitch depth: BitCrusher bits (2..8) + PingPong wet */
    setGlitchDepth(y) {
        try {
            if (this._bitCrusher) this._bitCrusher.bits = Math.round(2 + (1 - y) * 6);
            this._pingPong?.wet.rampTo(0.2 + y * 0.7, 0.08);
        } catch (_) {}
    }

    /** Right Index Y → Atmos Reverb Wetness (0..0.9) */
    setAtmosReverbWet(y) {
        try {
            this._atmosReverb?.wet.rampTo(Math.min(0.9, y * 0.9), 0.1);
        } catch (_) {}
    }

    /** Right Index X → Atmos Spatial Pan (0..1 → -1..+1) */
    setSpatialPan(x) {
        try {
            this._atmosPanner?.pan.rampTo(x * 2 - 1, 0.08);
        } catch (_) {}
    }

    // ── NeuralComposer integration ────────────────────────────────────────────
    triggerSequencerNote(trackIdx, note, vel = 0.85) {
        const Tone = window.Tone;
        if (!Tone) return;
        try {
            switch (trackIdx) {
                case 0: this.triggerKick(vel); break;
                case 1: this._glitch?.triggerAttackRelease('32n', undefined, vel * 0.6); break;
                case 2: this._glitch?.triggerAttackRelease('32n', undefined, vel * 0.7); break;
                case 3: {
                    const s = new Tone.Synth({
                        oscillator: { type: 'square' },
                        envelope:   { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
                    }).connect(this._bitCrusher ?? this._masterGain);
                    s.volume.value = -16;
                    s.triggerAttackRelease(note, '16n', undefined, vel * 0.7);
                    setTimeout(() => { try { s.dispose(); } catch (_) {} }, 600);
                    break;
                }
                case 4: {
                    const s = new Tone.Synth({
                        oscillator: { type: 'triangle' },
                        envelope:   { attack: 0.01, decay: 0.12, sustain: 0.3, release: 0.4 },
                    }).connect(this._bassFilter ?? this._masterGain);
                    s.volume.value = -10;
                    s.triggerAttackRelease(note, '8n', undefined, vel);
                    setTimeout(() => { try { s.dispose(); } catch (_) {} }, 1200);
                    break;
                }
                case 5: {
                    const s = new Tone.Synth({
                        oscillator: { type: 'square' },
                        envelope:   { attack: 0.005, decay: 0.08, sustain: 0.1, release: 0.2 },
                    }).connect(this._masterGain);
                    s.volume.value = -14;
                    s.triggerAttackRelease(note, '16n', undefined, vel * 0.7);
                    setTimeout(() => { try { s.dispose(); } catch (_) {} }, 700);
                    break;
                }
                case 6: {
                    const s = new Tone.FMSynth({
                        harmonicity: 3, modulationIndex: 10,
                        envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
                    }).connect(this._masterGain);
                    s.volume.value = -12;
                    s.triggerAttackRelease(note, '8n', undefined, vel * 0.8);
                    setTimeout(() => { try { s.dispose(); } catch (_) {} }, 900);
                    break;
                }
                case 7: {
                    this._atmos?.triggerAttackRelease([note], '4n', undefined, vel * 0.6);
                    break;
                }
            }
        } catch (_) {}
    }

    triggerKit(vel = 0.7) {
        try { this._glitch?.triggerAttackRelease('32n', undefined, vel); } catch (_) {}
    }

    switchKit() {
        this._kitIndex = (this._kitIndex + 1) % KIT_NAMES.length;
        const el = document.getElementById('kr-status');
        if (el) el.textContent = 'KIT: ' + KIT_NAMES[this._kitIndex];
    }

    // ── Legacy stubs ──────────────────────────────────────────────────────────
    setDronePitch(x) {
        try {
            const idx  = Math.round(x * (DRONE_NOTES.length - 1));
            const note = DRONE_NOTES[Math.max(0, Math.min(DRONE_NOTES.length - 1, idx))];
            this._bass?.setNote(note);
        } catch (_) {}
    }

    setFilterCutoff(y)    { this.setBassFilterCutoff(y); }
    setAutoFilterFreq(y)  { this.setBassFilterCutoff(y); }

    // ── HUD sliders ───────────────────────────────────────────────────────────
    setVolume(v) {
        try {
            this._masterGain?.gain.rampTo(Math.max(0.001, v) * 0.85, 0.06);
        } catch (_) {}
    }

    setReverbMix(v)    { this.setAtmosReverbWet(v); }
    setManualFilter(v) { this.setBassFilterCutoff(v); }

    // ── Recording ─────────────────────────────────────────────────────────────
    getRecordingDest() {
        if (!this.ctx) return null;
        this._recDest = this.ctx.createMediaStreamDestination();
        try {
            // Tap post-limiter via Tone.Destination's output
            window.Tone?.getDestination().output.connect(this._recDest);
        } catch (_) {}
        return this._recDest;
    }

    releaseRecordingDest(dest) {
        try { window.Tone?.getDestination().output.disconnect(dest); } catch (_) {}
        this._recDest = null;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    dispose() {
        try {
            this._bass?.triggerRelease();
            this._atmos?.releaseAll();
            [
                this._kick, this._kickDist,
                this._bass, this._bassFilter,
                this._glitch, this._bitCrusher, this._pingPong,
                this._atmos, this._atmosReverb, this._atmosPanner,
                this._loopDelay, this._loopReverb,
                this._synthGain,
                this._masterGain, this._limiter, this._analyser,
            ].forEach(n => { try { n?.dispose(); } catch (_) {} });
            this._synthInput?.disconnect();
        } catch (_) {}
    }
}
