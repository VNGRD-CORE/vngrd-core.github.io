// NeuralGlitch — Gesture-Commanded IDM Machine with Granular Synthesis
// Granular engine: pre-synthesized metallic-click grain buffer → time-stretched clouds
//
// PINCH  → Granular bitcrush (grain pitch scatter + density)
// FIST   → Sub-grain cluster + LP filter close
// PALM   → Granular reverb shimmer flood
// Wrist height → Master filter cutoff (continuous)

const SPHERE_VERT = `
uniform float uTime; uniform float uMorph; uniform float uBeat;
varying vec3 vNormal; varying float vNoise;
float h31(vec3 p){ p=fract(p*vec3(443.8975,397.2973,491.1871)); p+=dot(p.zxy,p.yxz+19.19); return fract(p.x*p.y*p.z); }
void main(){
    vNormal = normalMatrix * normal;
    vec3 pos = position;
    float n = h31(pos * 2.2 + uTime * 0.2) * uMorph * 0.85;
    n += uBeat * 0.6 * sin(pos.y * 8.0 + uTime * 12.0);
    pos *= 1.0 + n;
    vNoise = n;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const SPHERE_FRAG = `
uniform float uTime; uniform float uBeat; uniform float uCutoff;
uniform float uMorph; uniform float uPinch; uniform float uReverb;
varying vec3 vNormal; varying float vNoise;
void main(){
    vec3 N = normalize(vNormal);
    float rim = pow(1.0 - abs(dot(N, vec3(0.0,0.0,1.0))), 2.5);
    vec3 dark = vec3(0.01, 0.02, 0.05);
    vec3 crushCol = mix(vec3(0.0, 0.65, 1.0), vec3(1.0, 0.28, 0.0), uPinch);
    vec3 washCol  = mix(vec3(0.5, 0.0, 1.0), vec3(0.0, 1.0, 0.8), uReverb);
    vec3 glitch   = mix(crushCol, washCol, uReverb * 0.6);
    vec3 col = dark + rim * glitch * (0.45 + uBeat * 2.2 + uMorph * 0.5);
    col += glitch * uBeat * 0.55 + glitch * uPinch * 0.12;
    col = min(col, vec3(1.6));
    gl_FragColor = vec4(col, 1.0);
}`;

// ── Gesture detectors ─────────────────────────────────────────────────────
function pinchAmt(lms) {
    if (!lms[4] || !lms[8]) return 0;
    return Math.max(0, Math.min(1, 1 - Math.hypot(lms[4].x-lms[8].x, lms[4].y-lms[8].y) * 8));
}
function fistAmt(lms) {
    let closed = 0;
    [[8,5],[12,9],[16,13],[20,17]].forEach(([t,b]) => {
        if (lms[t] && lms[b] && lms[t].y > lms[b].y - 0.02) closed++;
    });
    return closed / 4;
}
function palmOpenness(lms) {
    if (!lms[5] || !lms[17]) return 0;
    return Math.max(0, Math.min(1, Math.hypot(lms[5].x-lms[17].x, lms[5].y-lms[17].y) * 3.8));
}

export class NeuralGlitch {
    constructor(scene, audioCtx, THREE, masterDest) {
        this._scene      = scene;
        this._ctx        = audioCtx;
        this._T          = THREE;
        this._masterDest = masterDest;

        this._mesh   = null;
        this._uni    = null;
        this._active = false;

        // Audio nodes
        this._masterGain = null;
        this._mGain      = null;   // compressor input
        this._filter     = null;
        this._reverbGain = null;
        this._reverb     = null;
        this._crushOsc   = null;
        this._crushGain  = null;
        this._grainBuf   = null;   // pre-synthesized grain source buffer

        // Smoothed gesture values
        this._pinch = 0;
        this._fist  = 0;
        this._palm  = 0;

        // Cool-downs
        this._fistCool = 0;
        this._palmCool = 0;
    }

    async init() {
        this._buildMesh();
        this._buildGrainBuffer();
        this._buildAudio();
    }

    _buildMesh() {
        const T = this._T;
        this._uni = {
            uTime:   { value: 0 }, uBeat:   { value: 0 }, uCutoff: { value: 0.3 },
            uMorph:  { value: 0 }, uPinch:  { value: 0 }, uReverb: { value: 0 },
        };
        this._mesh = new T.Mesh(
            new T.SphereGeometry(1.9, 80, 80),
            new T.ShaderMaterial({
                uniforms: this._uni, vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG,
                side: T.DoubleSide,
            })
        );
        this._mesh.visible = false;
        this._scene.add(this._mesh);
    }

    // Pre-synthesize a metallic click grain — used as the granular source material
    _buildGrainBuffer() {
        const ctx = this._ctx;
        const sr  = ctx.sampleRate;
        const len = Math.floor(sr * 0.085); // 85ms grain window
        this._grainBuf = ctx.createBuffer(2, len, sr);

        for (let c = 0; c < 2; c++) {
            const d = this._grainBuf.getChannelData(c);
            for (let i = 0; i < len; i++) {
                const t    = i / sr;
                const env  = Math.exp(-t * 52);  // fast metallic decay
                const jitter = c === 1 ? 0.003 : 0; // stereo micro-offset
                d[i] = (
                    Math.sin((t + jitter) * 2 * Math.PI * 880)  * 0.45 +
                    Math.sin((t + jitter) * 2 * Math.PI * 1320) * 0.22 +
                    Math.sin((t + jitter) * 2 * Math.PI * 440)  * 0.28 +
                    Math.sin((t + jitter) * 2 * Math.PI * 2640) * 0.08 +
                    (Math.random() * 2 - 1) * 0.12               // noise texture
                ) * env;
            }
        }
    }

    // ── Granular engine ───────────────────────────────────────────────────────
    // Scatter `count` overlapping grains with pitch and timing variations
    _playGranular(destNode, basePitch, density, count) {
        const ctx = this._ctx;
        const grainCount = Math.max(2, Math.round(count));
        const grainDur   = 0.032 + density * 0.022; // 32–54ms grains

        for (let g = 0; g < grainCount; g++) {
            const offset = g * (0.006 + Math.random() * 0.005);
            const grain  = ctx.createBufferSource();
            grain.buffer = this._grainBuf;
            // Pitch scatter: base ± 50% + random detune
            grain.playbackRate.value = basePitch * (0.72 + Math.random() * 0.56);
            grain.detune.value       = (Math.random() - 0.5) * 280; // ±140 cents

            const env = ctx.createGain();
            const now = ctx.currentTime + offset;
            const pk  = Math.max(0.05, 0.38 - g * 0.02);
            env.gain.setValueAtTime(0, now);
            env.gain.linearRampToValueAtTime(pk, now + grainDur * 0.28);
            env.gain.exponentialRampToValueAtTime(0.001, now + grainDur);

            grain.connect(env);
            env.connect(destNode);
            grain.start(now);
            grain.stop(now + grainDur + 0.012);
        }
    }

    _buildAudio() {
        const ctx  = this._ctx;
        const dest = this._masterDest || ctx.destination;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0;
        this._masterGain.connect(dest);

        // Master LP filter — wrist height
        this._filter = ctx.createBiquadFilter();
        this._filter.type = 'lowpass';
        this._filter.frequency.value = 1200;
        this._filter.Q.value = 5;
        this._filter.connect(this._masterGain);

        // Compressor for industrial punch
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        comp.attack.value = 0.003;  comp.release.value = 0.12;
        comp.connect(this._filter);
        this._mGain = comp; // granular engine feeds here

        // Live bitcrusher oscillator (pinch-controlled)
        this._crushOsc  = ctx.createOscillator();
        this._crushOsc.type = 'sawtooth';
        this._crushOsc.frequency.value = 220;
        this._crushGain = ctx.createGain();
        this._crushGain.gain.value = 0;
        this._crushOsc.connect(this._crushGain);
        this._crushGain.connect(this._mGain);
        this._crushOsc.start();

        // Convolution reverb for palm wash
        const len = Math.floor(ctx.sampleRate * 2.8);
        const ir  = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++)
                d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 0.72);
        }
        this._reverb = ctx.createConvolver();
        this._reverb.buffer = ir;
        this._reverbGain = ctx.createGain();
        this._reverbGain.gain.value = 0;
        this._reverb.connect(this._reverbGain);
        this._reverbGain.connect(this._masterGain);
    }

    _processHands(hr) {
        if (!hr || !hr.multiHandLandmarks || !hr.multiHandLandmarks.length) return;
        const now = performance.now();
        const ctx = this._ctx;
        const lms = hr.multiHandLandmarks[0];
        if (!lms) return;

        // PINCH → granular bitcrush: density + crush oscillator
        const p = pinchAmt(lms);
        this._pinch += (p - this._pinch) * 0.15;
        // Pitch of bitcrush oscillator rises with pinch
        this._crushOsc.frequency.setTargetAtTime(80 + this._pinch * this._pinch * 1600, ctx.currentTime, 0.02);
        this._crushGain.gain.setTargetAtTime(this._pinch * 0.42, ctx.currentTime, 0.02);
        // Granular scatter cloud follows pinch — triggered when crossing threshold
        if (this._pinch > 0.55 && now > (this._pinchGrainCool || 0)) {
            this._pinchGrainCool = now + 55; // rapid-fire grains
            this._playGranular(this._mGain, 2.0 + this._pinch * 4, this._pinch, 3 + Math.floor(this._pinch * 6));
        }
        this._uni.uPinch.value = this._pinch;
        this._uni.uMorph.value = this._pinch * 0.45;

        // FIST → granular sub-bass cluster + filter close
        const f = fistAmt(lms);
        this._fist += (f - this._fist) * 0.12;
        if (f > 0.85 && now > this._fistCool) {
            this._fistCool = now + 480;
            // Low-pitch, dense granular cloud for industrial sub feel
            this._playGranular(this._mGain, 0.35 + Math.random() * 0.15, 0.9, 8);
            this._uni.uBeat.value = 1.0;
        }
        const filterFreq = 180 + (1 - this._fist) * 3600;
        this._filter.frequency.setTargetAtTime(filterFreq, ctx.currentTime, 0.04);

        // PALM → granular reverb shimmer (high-pitch airy grains through reverb)
        const op = palmOpenness(lms);
        this._palm += (op - this._palm) * 0.10;
        if (op > 0.78 && now > this._palmCool) {
            this._palmCool = now + 120;
            this._playGranular(this._reverb, 3.5 + Math.random() * 2.5, 0.55, 5);
        }
        this._reverbGain.gain.setTargetAtTime(this._palm * 0.72, ctx.currentTime, 0.04);
        this._uni.uReverb.value = this._palm;

        // Wrist height → filter uniform
        if (lms[0]) this._uni.uCutoff.value = 1 - lms[0].y;
    }

    activate() {
        this._active = true;
        this._mesh.visible = true;
        if (this._masterGain) this._masterGain.gain.setTargetAtTime(0.82, this._ctx.currentTime, 0.1);
    }

    deactivate() {
        this._active = false;
        this._mesh.visible = false;
        if (this._masterGain) this._masterGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        if (this._crushGain)  this._crushGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.08);
        if (this._reverbGain) this._reverbGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
    }

    update(hr, t) {
        if (!this._active) return;
        this._uni.uTime.value = t;
        this._uni.uBeat.value = Math.max(0, this._uni.uBeat.value - 0.028);
        this._mesh.rotation.y = t * 0.07;
        this._mesh.rotation.x = Math.sin(t * 0.045) * 0.10;
        this._processHands(hr);
    }
}
