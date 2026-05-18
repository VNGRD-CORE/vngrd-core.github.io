/**
 * VNGRD// BLEP OSCILLATOR WORKLET
 * Band-Limited Exponential Pulse (PolyBLEP) oscillator.
 * Eliminates the harsh aliasing of native WebAudio OscillatorNode at
 * high pitches, giving the TB-303 and other synths professional sound quality.
 *
 * Loaded via: audioCtx.audioWorklet.addModule('./src/modules/blep-oscillator-worklet.js')
 * Used as:    new AudioWorkletNode(ctx, 'blep-oscillator')
 *
 * Parameters:
 *   frequency  — Hz (a-rate, default 440)
 *   detune     — cents (a-rate, default 0)
 *   waveform   — 0=saw, 1=square, 2=triangle (k-rate, default 0)
 *   pulseWidth — 0–1 for square wave (k-rate, default 0.5)
 */
class BlepOscillator extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'frequency',  defaultValue: 440,  minValue: 20,    maxValue: 22050, automationRate: 'a-rate' },
            { name: 'detune',     defaultValue: 0,    minValue: -4800, maxValue: 4800,  automationRate: 'a-rate' },
            { name: 'waveform',   defaultValue: 0,    minValue: 0,     maxValue: 2,     automationRate: 'k-rate' },
            { name: 'pulseWidth', defaultValue: 0.5,  minValue: 0.05,  maxValue: 0.95,  automationRate: 'k-rate' },
        ];
    }

    constructor(options) {
        super(options);
        this._phase = 0.0;
        this._lastPhase = 0.0;  // for triangle integration
        this._triIntegrator = 0.0;
        this._port.onmessage = (e) => {
            if (e.data.type === 'reset') this._phase = 0;
        };
    }

    /** PolyBLEP residual — smooths the discontinuity at phase 0 and 1 */
    _blep(phase, dt) {
        if (phase < dt) {
            const t = phase / dt;
            return t + t - t * t - 1.0;
        } else if (phase > 1.0 - dt) {
            const t = (phase - 1.0) / dt;
            return t * t + t + t + 1.0;
        }
        return 0.0;
    }

    process(inputs, outputs, parameters) {
        const output  = outputs[0];
        const freqArr = parameters.frequency;
        const detArr  = parameters.detune;
        const wv      = Math.round(parameters.waveform[0]);
        const pw      = Math.max(0.05, Math.min(0.95, parameters.pulseWidth[0]));
        const sr      = sampleRate;
        const len     = output[0].length;

        for (let i = 0; i < len; i++) {
            const f   = freqArr.length > 1 ? freqArr[i] : freqArr[0];
            const det = detArr.length  > 1 ? detArr[i]  : detArr[0];
            const fHz = f * Math.pow(2, det / 1200);
            const dt  = Math.min(fHz / sr, 0.5);  // normalised phase increment

            let sample = 0;

            if (wv === 0) {
                // ── Sawtooth ──────────────────────────────────────
                sample = 2.0 * this._phase - 1.0;
                sample -= this._blep(this._phase, dt);

            } else if (wv === 1) {
                // ── Square / Pulse ────────────────────────────────
                sample = this._phase < pw ? 1.0 : -1.0;
                sample += this._blep(this._phase, dt);
                // BLEP at the falling edge (phase = pw)
                let p2 = this._phase - pw;
                if (p2 < 0) p2 += 1.0;
                sample -= this._blep(p2, dt);

            } else {
                // ── Triangle (integrated square) ──────────────────
                // Generate square first
                let sq = this._phase < pw ? 1.0 : -1.0;
                sq += this._blep(this._phase, dt);
                let p2 = this._phase - pw;
                if (p2 < 0) p2 += 1.0;
                sq -= this._blep(p2, dt);
                // Leaky integrator (normalise amplitude)
                this._triIntegrator += 4.0 * dt * sq;
                this._triIntegrator *= 0.9995;  // prevent DC drift
                sample = this._triIntegrator;
            }

            // Advance phase
            this._phase += dt;
            if (this._phase >= 1.0) this._phase -= 1.0;

            // Write to all channels
            for (let ch = 0; ch < output.length; ch++) {
                output[ch][i] = sample;
            }
        }
        return true;
    }
}

registerProcessor('blep-oscillator', BlepOscillator);
