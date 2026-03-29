// NeuralGlitch — Gesture-Commanded IDM Machine
// THREE precise gestures → THREE distinct sound textures. Zero random triggers.
//
// PINCH  (index+thumb close)   → Bitcrush depth — continuous, progressive
// FIST   (all fingers closed)  → LP filter close + Sub-bass hit
// PALM   (hand fully open)     → Reverb wash / spectral shimmer
// Right wrist height           → Master filter cutoff (always active)

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
    // Pinch → cyan-to-orange crush palette
    vec3 crushCol = mix(vec3(0.0, 0.65, 1.0), vec3(1.0, 0.28, 0.0), uPinch);
    // Reverb → purple shimmer
    vec3 washCol = mix(vec3(0.5, 0.0, 1.0), vec3(0.0, 1.0, 0.8), uReverb);
    vec3 glitch = mix(crushCol, washCol, uReverb * 0.6);
    vec3 col = dark + rim * glitch * (0.45 + uBeat * 2.2 + uMorph * 0.5);
    col += glitch * uBeat * 0.55 + glitch * uPinch * 0.12;
    col = min(col, vec3(1.6));
    gl_FragColor = vec4(col, 1.0);
}`;

// ── Precise gesture detectors ──────────────────────────────────────────────
function pinchAmt(lms) {
    if (!lms[4] || !lms[8]) return 0;
    return Math.max(0, Math.min(1, 1 - Math.hypot(lms[4].x-lms[8].x, lms[4].y-lms[8].y) * 8));
}

function fistAmt(lms) {
    // Each fingertip Y > base Y = closed (screen Y increases downward)
    let closed = 0;
    [[8,5],[12,9],[16,13],[20,17]].forEach(([tip, base]) => {
        if (lms[tip] && lms[base] && lms[tip].y > lms[base].y - 0.02) closed++;
    });
    return closed / 4;
}

function palmOpenness(lms) {
    if (!lms[5] || !lms[17]) return 0;
    return Math.max(0, Math.min(1, Math.hypot(lms[5].x-lms[17].x, lms[5].y-lms[17].y) * 3.8));
}

export class NeuralGlitch {
    constructor(scene, audioCtx, THREE, recDest) {
        this._scene   = scene;
        this._ctx     = audioCtx;
        this._T       = THREE;
        this._recDest = recDest;
        this._mesh    = null;
        this._uni     = null;
        this._active  = false;
        this._masterGain = null;
        this._mGain   = null;
        this._filter  = null;
        this._reverbGain = null;
        this._crushOsc = null;
        this._crushGain = null;

        // Smoothed gesture values
        this._pinch = 0;
        this._fist  = 0;
        this._palm  = 0;

        // Cool-downs (ms)
        this._fistCool = 0;
        this._palmCool = 0;
    }

    async init() {
        this._buildMesh();
        this._buildAudio();
    }

    _buildMesh() {
        const T = this._T;
        this._uni = {
            uTime:   { value: 0 },
            uBeat:   { value: 0 },
            uCutoff: { value: 0.3 },
            uMorph:  { value: 0 },
            uPinch:  { value: 0 },
            uReverb: { value: 0 }
        };
        this._mesh = new T.Mesh(
            new T.SphereGeometry(1.9, 80, 80),
            new T.ShaderMaterial({
                uniforms: this._uni,
                vertexShader:   SPHERE_VERT,
                fragmentShader: SPHERE_FRAG,
                side: T.DoubleSide
            })
        );
        this._mesh.visible = false;
        this._scene.add(this._mesh);
    }

    _buildAudio() {
        const ctx = this._ctx;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0;
        this._masterGain.connect(ctx.destination);
        if (this._recDest) this._masterGain.connect(this._recDest);

        // Master LP filter — wrist height controls
        this._filter = ctx.createBiquadFilter();
        this._filter.type = 'lowpass';
        this._filter.frequency.value = 1200;
        this._filter.Q.value = 5;
        this._filter.connect(this._masterGain);

        // Dynamics compressor for industrial punch
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.12;
        comp.connect(this._filter);
        this._mGain = comp;

        // Live bitcrusher oscillator — pinch controls gain + frequency
        this._crushOsc  = ctx.createOscillator();
        this._crushOsc.type = 'sawtooth';
        this._crushOsc.frequency.value = 220;
        this._crushGain = ctx.createGain();
        this._crushGain.gain.value = 0;
        this._crushOsc.connect(this._crushGain);
        this._crushGain.connect(this._mGain);
        this._crushOsc.start();

        // Reverb convolver for palm wash
        const len = Math.floor(ctx.sampleRate * 2.8);
        const ir  = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++)
                d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 0.75);
        }
        const reverb = ctx.createConvolver();
        reverb.buffer = ir;
        this._reverbGain = ctx.createGain();
        this._reverbGain.gain.value = 0;
        reverb.connect(this._reverbGain);
        this._reverbGain.connect(this._masterGain);
        this._reverb = reverb;
    }

    _triggerSubBass() {
        const ctx = this._ctx, now = ctx.currentTime;
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(65, now);
        sub.frequency.exponentialRampToValueAtTime(28, now + 0.3);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.9, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        sub.connect(env); env.connect(this._mGain);
        sub.start(now); sub.stop(now + 1.0);
        this._uni.uBeat.value = 1.0;
    }

    _triggerPalmWash() {
        const ctx = this._ctx, now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.06);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d   = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * (1 - i/len);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain(); g.gain.value = 0.75;
        src.connect(g); g.connect(this._reverb);
        src.start(now); src.stop(now + 0.08);
    }

    _processHands(hr) {
        if (!hr || !hr.multiHandLandmarks || !hr.multiHandLandmarks.length) return;
        const now = performance.now();
        const ctx = this._ctx;
        const lms = hr.multiHandLandmarks[0];
        if (!lms) return;

        // PINCH → bitcrusher (smooth, continuous)
        const p = pinchAmt(lms);
        this._pinch += (p - this._pinch) * 0.15;
        this._crushOsc.frequency.setTargetAtTime(80 + this._pinch * this._pinch * 1600, ctx.currentTime, 0.02);
        this._crushGain.gain.setTargetAtTime(this._pinch * 0.5, ctx.currentTime, 0.02);
        this._uni.uPinch.value = this._pinch;
        this._uni.uMorph.value = this._pinch * 0.45;

        // FIST → sub-bass hit + close LP filter
        const f = fistAmt(lms);
        this._fist += (f - this._fist) * 0.12;
        if (f > 0.85 && now > this._fistCool) {
            this._fistCool = now + 500;
            this._triggerSubBass();
        }
        // Fist closes filter, open hand opens it
        const filterFreq = 180 + (1 - this._fist) * 3600;
        this._filter.frequency.setTargetAtTime(filterFreq, ctx.currentTime, 0.04);

        // PALM → reverb wash flood
        const op = palmOpenness(lms);
        this._palm += (op - this._palm) * 0.10;
        if (op > 0.78 && now > this._palmCool) {
            this._palmCool = now + 180;
            this._triggerPalmWash();
        }
        this._reverbGain.gain.setTargetAtTime(this._palm * 0.75, ctx.currentTime, 0.04);
        this._uni.uReverb.value = this._palm;

        // Wrist height → filter display uniform
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
