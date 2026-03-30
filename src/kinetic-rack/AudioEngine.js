/**
 * AudioEngine.js — Pro master audio chain
 *
 * Signal flow:
 *   instruments → masterIn → [dry | reverbSend → convolver] → compressor → LIMITER → destination
 *
 * The hard limiter (ratio 20, threshold -3 dB) is the last node before the
 * AudioDestinationNode. Nothing can clip.
 */
export class AudioEngine {
    constructor() {
        this.ctx          = null;
        this._masterIn    = null;   // all sound sources connect here
        this._synthFilter = null;   // shared LP filter, controlled by right hand
        this._reverb      = null;
        this._reverbSend  = null;
        this._dryGain     = null;
        this._limiter     = null;
        this._irCache     = null;
    }

    async init(existingCtx = null) {
        this.ctx = existingCtx || new (window.AudioContext || window.webkitAudioContext)();
        await this.ctx.resume().catch(() => {});

        const ctx = this.ctx;

        // ── Glue compressor (gentle)  ─────────────────────────────────────────
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value      = 6;
        comp.ratio.value     = 4;
        comp.attack.value    = 0.003;
        comp.release.value   = 0.12;

        // ── Hard limiter (as spec'd) ──────────────────────────────────────────
        this._limiter = ctx.createDynamicsCompressor();
        this._limiter.threshold.value = -3;
        this._limiter.knee.value      = 0;
        this._limiter.ratio.value     = 20;
        this._limiter.attack.value    = 0.005;
        this._limiter.release.value   = 0.05;

        // ── Convolution reverb ────────────────────────────────────────────────
        this._reverb     = ctx.createConvolver();
        this._reverb.buffer = this._makeIR(2.8);
        this._reverbSend = ctx.createGain();
        this._reverbSend.gain.value = 0.28;
        this._dryGain    = ctx.createGain();
        this._dryGain.gain.value = 0.82;

        // ── Master input gain ─────────────────────────────────────────────────
        this._masterIn = ctx.createGain();
        this._masterIn.gain.value = 0.82;

        // ── Shared synth LP filter (right-hand controlled) ────────────────────
        this._synthFilter = ctx.createBiquadFilter();
        this._synthFilter.type = 'lowpass';
        this._synthFilter.frequency.value = 900;
        this._synthFilter.Q.value = 4;
        // Synth filter feeds masterIn so reverb/limiter wraps it
        this._synthFilter.connect(this._masterIn);

        // ── Routing: masterIn → dry + reverb → comp → limiter → out ──────────
        this._masterIn.connect(this._dryGain);
        this._masterIn.connect(this._reverbSend);
        this._reverbSend.connect(this._reverb);
        this._dryGain.connect(comp);
        this._reverb.connect(comp);
        comp.connect(this._limiter);
        this._limiter.connect(ctx.destination);
    }

    // ── Public accessors ──────────────────────────────────────────────────────

    /** All raw sound sources (drums, synth osc, etc.) connect here. */
    get input()       { return this._masterIn; }

    /**
     * Tether oscillators connect here.
     * Flows: synthFilter → masterIn (so reverb and limiter wrap it)
     */
    get synthInput()  { return this._synthFilter; }

    // ── Impulse response (synthesised cinematic hall) ─────────────────────────
    _makeIR(dur) {
        const rate = this.ctx.sampleRate;
        const len  = Math.floor(rate * dur);
        const buf  = this.ctx.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) {
                const t   = i / len;
                const env = Math.pow(1 - t, 1.9);
                // Pre-delay spike at ~20ms
                const preDelay = i === Math.floor(rate * 0.02) ? 0.6 : 0;
                d[i] = (Math.random() * 2 - 1) * env + preDelay * (ch === 0 ? 1 : -1);
            }
        }
        return buf;
    }

    // ── Drum synthesis ────────────────────────────────────────────────────────

    /**
     * Deep 808-style kick. Pitch sweeps 150 Hz → 20 Hz.
     * @param {number} vel  0..1 velocity
     */
    triggerKick(vel = 1.0) {
        if (!this.ctx) return;
        const ctx = this.ctx, now = ctx.currentTime;

        // Body (sine sweep)
        const osc  = ctx.createOscillator();
        const oEnv = ctx.createGain();
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.48);
        oEnv.gain.setValueAtTime(0, now);
        oEnv.gain.linearRampToValueAtTime(vel * 0.78, now + 0.002);
        oEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);
        osc.connect(oEnv);
        oEnv.connect(this._masterIn);
        osc.start(now);
        osc.stop(now + 0.55);

        // Click transient
        const nLen = Math.floor(ctx.sampleRate * 0.014);
        const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
        const nd   = nBuf.getChannelData(0);
        for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
        const noise = ctx.createBufferSource();
        const nEnv  = ctx.createGain();
        nEnv.gain.setValueAtTime(vel * 0.42, now);
        nEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
        noise.buffer = nBuf;
        noise.connect(nEnv);
        nEnv.connect(this._masterIn);
        noise.start(now);
    }

    /**
     * Closed hi-hat: filtered white noise burst.
     * @param {number} vel  0..1
     */
    triggerHihat(vel = 0.5) {
        if (!this.ctx) return;
        const ctx = this.ctx, now = ctx.currentTime;
        const nLen = Math.floor(ctx.sampleRate * 0.04);
        const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
        const nd   = nBuf.getChannelData(0);
        for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        const hpf   = ctx.createBiquadFilter();
        const env   = ctx.createGain();
        hpf.type = 'highpass';
        hpf.frequency.value = 7500;
        env.gain.setValueAtTime(vel * 0.22, now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);
        noise.buffer = nBuf;
        noise.connect(hpf);
        hpf.connect(env);
        env.connect(this._masterIn);
        noise.start(now);
    }

    /**
     * Short detuned synth stab (for NeuralComposer notes).
     * @param {number} freq   Hz
     * @param {number} dur    seconds
     * @param {number} vel    0..1
     * @param {string} type   'pluck'|'pad'|'bass'
     */
    triggerSynth(freq, dur = 0.18, vel = 0.5, type = 'pluck') {
        if (!this.ctx) return;
        const ctx = this.ctx, now = ctx.currentTime;
        const detunes = type === 'pad' ? [-8, 0, 8] : [-5, 0, 5];

        const merge = ctx.createGain();
        const attack  = type === 'pad'  ? 0.08 : 0.004;
        const release = type === 'pad'  ? 1.2  : dur * 0.9;
        merge.gain.setValueAtTime(0, now);
        merge.gain.linearRampToValueAtTime(vel * 0.3, now + attack);
        merge.gain.setValueAtTime(vel * 0.3, now + dur - 0.01);
        merge.gain.exponentialRampToValueAtTime(0.0001, now + dur + release);
        merge.connect(this._synthFilter);

        detunes.forEach(dt => {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.value = freq;
            o.detune.value = dt;
            o.connect(merge);
            o.start(now);
            o.stop(now + dur + release + 0.05);
        });
    }

    // ── Right-hand continuous modulation ──────────────────────────────────────

    /** Y-axis → master volume (0 = silent, 1 = full) */
    setVolume(v) {
        if (!this.ctx) return;
        this._masterIn.gain.setTargetAtTime(Math.max(0.001, v * 0.82), this.ctx.currentTime, 0.04);
    }

    /** X-axis → filter cutoff (50..14000 Hz) */
    setFilterCutoff(hz) {
        if (!this.ctx) return;
        this._synthFilter.frequency.setTargetAtTime(
            Math.max(50, Math.min(14000, hz)), this.ctx.currentTime, 0.03
        );
    }

    /** Depth/Z → filter resonance (0.5..22) */
    setFilterResonance(q) {
        if (!this.ctx) return;
        this._synthFilter.Q.setTargetAtTime(
            Math.max(0.5, Math.min(22, q)), this.ctx.currentTime, 0.05
        );
    }

    /** RVB slider → reverb mix (0..1) */
    setReverbMix(v) {
        if (!this.ctx) return;
        this._reverbSend.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.06);
        this._dryGain.gain.setTargetAtTime(Math.max(0.2, 1 - v * 0.3), this.ctx.currentTime, 0.06);
    }

    dispose() {
        try { this._masterIn?.disconnect(); } catch {}
        try { this._limiter?.disconnect(); } catch {}
    }
}
