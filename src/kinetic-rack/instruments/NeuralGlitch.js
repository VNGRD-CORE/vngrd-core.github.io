import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// NEURAL GLITCH — Vertex-displaced sphere + IDM beat scheduler + bitcrusher
// ─────────────────────────────────────────────────────────────────────────────

const GLITCH_VERT = `
uniform float uTime;
uniform float uBeat;
uniform float uCrush;
varying vec3 vNormal;
varying float vDisplace;

float hash(vec3 p){
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.zxy, p.yxz + 19.19);
    return fract(p.x * p.y * p.z);
}

void main(){
    vNormal = normalMatrix * normal;
    vec3 pos = position;

    // Base noise displacement
    float n = hash(pos * 2.3 + uTime * 0.4) * 0.18;

    // Beat burst — radial spike on kick
    n += uBeat * 0.55 * (0.5 + 0.5 * sin(pos.y * 8.0 + uTime * 12.0));

    // Crush warp — collapses geometry on uCrush
    pos *= 1.0 + n;
    pos.x += uCrush * sin(pos.y * 14.0 + uTime * 20.0) * 0.25;
    pos.y += uCrush * cos(pos.x * 12.0 + uTime * 18.0) * 0.25;

    vDisplace = n;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const GLITCH_FRAG = `
uniform float uTime;
uniform float uBeat;
uniform float uCrush;
varying vec3 vNormal;
varying float vDisplace;

void main(){
    vec3 N = normalize(vNormal);

    // Scanline stripes
    float stripe = step(0.5, fract(N.y * 18.0 + uTime * 0.5));

    // Cold base color with crush heat
    vec3 cold = mix(vec3(0.0, 0.6, 0.9), vec3(0.7, 0.0, 0.9), vDisplace * 3.0);
    cold = mix(cold, vec3(1.0, 0.3, 0.0), uCrush);

    // Beat flash — white burst
    cold = mix(cold, vec3(1.0), uBeat * 0.7);

    // Apply stripe
    cold *= 0.7 + stripe * 0.3;

    // Rim glow
    float rim = pow(1.0 - abs(dot(N, vec3(0.0, 0.0, 1.0))), 2.2);
    cold += rim * vec3(0.0, 0.9, 1.0) * 0.6;

    gl_FragColor = vec4(cold, 1.0);
}`;

// 16-step IDM patterns  (1 = trigger)
const PATTERNS = {
    kick:  [1,0,0,0, 1,0,0,1, 0,0,1,0, 1,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,1,0],
    hat:   [1,1,0,1, 1,1,0,1, 1,1,0,1, 1,0,1,1],
};
const BPM = 142;

export class NeuralGlitch {
    constructor(scene, audioCtx) {
        this._scene  = scene;
        this._ctx    = audioCtx;
        this._mesh   = null;
        this._uniforms = null;
        this._active = false;

        // Audio nodes
        this._masterGain  = null;
        this._compressor  = null;
        this._crushInput  = null;
        this._scriptNode  = null;
        this._bitDepth    = 16;

        // Scheduler
        this._step       = 0;
        this._nextTime   = 0;
        this._schedTimer = null;
        this._beatFlash  = 0; // decays each frame
    }

    async init() {
        this._buildMesh();
        this._buildAudio();
    }

    _buildMesh() {
        this._uniforms = {
            uTime:  { value: 0 },
            uBeat:  { value: 0 },
            uCrush: { value: 0 }
        };
        const geo = new THREE.SphereGeometry(2.4, 72, 72);
        const mat = new THREE.ShaderMaterial({
            uniforms:       this._uniforms,
            vertexShader:   GLITCH_VERT,
            fragmentShader: GLITCH_FRAG,
            side: THREE.DoubleSide
        });
        this._mesh = new THREE.Mesh(geo, mat);
        this._mesh.visible = false;
        this._scene.add(this._mesh);
    }

    _buildAudio() {
        const ctx = this._ctx;

        this._compressor = ctx.createDynamicsCompressor();
        this._compressor.threshold.value = -18;
        this._compressor.ratio.value = 6;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0;

        this._compressor.connect(this._masterGain);
        this._masterGain.connect(ctx.destination);

        // ScriptProcessor bitcrusher (legacy but widely supported)
        this._crushInput = ctx.createGain();
        this._crushInput.gain.value = 1;

        const bufSize = 4096;
        this._scriptNode = ctx.createScriptProcessor(bufSize, 1, 1);
        this._scriptNode.onaudioprocess = (e) => {
            const inp = e.inputBuffer.getChannelData(0);
            const out = e.outputBuffer.getChannelData(0);
            const steps = Math.pow(2, this._bitDepth);
            for (let i = 0; i < inp.length; i++) {
                out[i] = Math.round(inp[i] * steps) / steps;
            }
        };

        this._crushInput.connect(this._scriptNode);
        this._scriptNode.connect(this._compressor);
    }

    _scheduleNote(time, type) {
        const ctx = this._ctx;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.connect(env);
        env.connect(this._crushInput);

        if (type === 'kick') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(160, time);
            osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
            env.gain.setValueAtTime(1.2, time);
            env.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
            osc.start(time); osc.stop(time + 0.25);
            this._beatFlash = 1.0;
        } else if (type === 'snare') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, time);
            const noise = ctx.createBufferSource();
            const nb = ctx.createBuffer(1, 4096, ctx.sampleRate);
            const nd = nb.getChannelData(0);
            for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
            noise.buffer = nb; noise.loop = true;
            const nEnv = ctx.createGain();
            nEnv.gain.setValueAtTime(0.4, time);
            nEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
            noise.connect(nEnv); nEnv.connect(this._crushInput);
            noise.start(time); noise.stop(time + 0.18);
            env.gain.setValueAtTime(0.5, time);
            env.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
            osc.start(time); osc.stop(time + 0.12);
        } else if (type === 'hat') {
            osc.type = 'square';
            osc.frequency.value = 8000 + Math.random() * 4000;
            env.gain.setValueAtTime(0.15, time);
            env.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
            osc.start(time); osc.stop(time + 0.05);
        }
    }

    _tick() {
        if (!this._active) return;
        const ctx  = this._ctx;
        const look = 0.1;

        while (this._nextTime < ctx.currentTime + look) {
            const s = this._step % 16;
            if (PATTERNS.kick[s])  this._scheduleNote(this._nextTime, 'kick');
            if (PATTERNS.snare[s]) this._scheduleNote(this._nextTime, 'snare');
            if (PATTERNS.hat[s])   this._scheduleNote(this._nextTime, 'hat');

            this._nextTime += 60 / BPM / 4; // 16th note
            this._step++;
        }
    }

    _processHands(handsResults) {
        if (!handsResults || !handsResults.multiHandLandmarks) return;

        for (let hi = 0; hi < handsResults.multiHandLandmarks.length; hi++) {
            const lms  = handsResults.multiHandLandmarks[hi];
            const hand = handsResults.multiHandedness[hi];
            const wrist = lms[0];

            if (hand && hand.label === 'Right') {
                // Wrist Y → crush depth (raise hand = more crush)
                const crush = Math.max(0, Math.min(1, 1 - wrist.y));
                this._uniforms.uCrush.value = crush;
                this._bitDepth = Math.round(THREE.MathUtils.lerp(16, 2, crush));

                // Pinch index(8) to thumb(4) → manual kick
                const idx = lms[8]; const thm = lms[4];
                if (idx && thm) {
                    const d = Math.hypot(idx.x - thm.x, idx.y - thm.y);
                    if (d < 0.04) {
                        this._scheduleNote(this._ctx.currentTime + 0.01, 'kick');
                    }
                }
            } else {
                // Left hand: ratchet via finger spread
                // (stub — speed multiplier based on spread)
            }
        }
    }

    activate() {
        this._active = true;
        if (this._mesh) this._mesh.visible = true;
        if (this._masterGain) this._masterGain.gain.setTargetAtTime(0.8, this._ctx.currentTime, 0.1);
        this._nextTime = this._ctx.currentTime + 0.1;
        this._step = 0;
        this._schedTimer = setInterval(() => this._tick(), 25);
    }

    deactivate() {
        this._active = false;
        if (this._mesh) this._mesh.visible = false;
        if (this._masterGain) this._masterGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        if (this._schedTimer) { clearInterval(this._schedTimer); this._schedTimer = null; }
    }

    update(handsResults, t, cam) {
        if (!this._active) return;

        this._uniforms.uTime.value = t;

        // Decay beat flash
        this._beatFlash = Math.max(0, this._beatFlash - 0.05);
        this._uniforms.uBeat.value = this._beatFlash;

        // Slow spin
        this._mesh.rotation.y = t * 0.15;
        this._mesh.rotation.x = Math.sin(t * 0.1) * 0.2;

        this._processHands(handsResults);
    }
}
