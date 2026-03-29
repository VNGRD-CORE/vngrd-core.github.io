// NeuralGlitch — Hand-controlled IDM/industrial glitch machine
// NO auto-loop. Each gesture triggers specific sounds.
// Right hand: wrist height = filter, pinch = effect depth
// Left hand: each finger triggers a different industrial sound

const SPHERE_VERT = `
uniform float uTime; uniform float uDisplace; uniform float uBeat;
varying vec3 vNormal; varying float vNoise;
float hash(vec3 p){ p=fract(p*vec3(443.8975,397.2973,491.1871)); p+=dot(p.zxy,p.yxz+19.19); return fract(p.x*p.y*p.z); }
void main(){
    vNormal = normalMatrix * normal;
    vec3 pos = position;
    // Subtle procedural displacement — controlled by uDisplace, NOT constant
    float n = hash(pos * 1.8 + uTime * 0.3) * uDisplace;
    n += uBeat * 0.4 * sin(pos.y * 6.0 + uTime * 10.0);
    pos *= 1.0 + n;
    vNoise = n;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const SPHERE_FRAG = `
uniform float uTime; uniform float uBeat; uniform float uCutoff; uniform float uDisplace;
varying vec3 vNormal; varying float vNoise;
void main(){
    vec3 N = normalize(vNormal);
    // Dark base that only glows on beat — prevents white blowout
    float rim = pow(1.0 - abs(dot(N, vec3(0.0,0.0,1.0))), 2.8);
    vec3 dark  = vec3(0.02, 0.04, 0.08);
    vec3 glitch = mix(vec3(0.0, 0.5, 0.9), vec3(0.9, 0.0, 0.7), vNoise * 4.0);
    glitch = mix(glitch, vec3(1.0, 0.4, 0.0), uCutoff);
    // Only light up on rim + beat flash — rest stays dark
    vec3 col = dark + rim * glitch * (0.6 + uBeat * 1.5);
    col += glitch * uBeat * 0.4;  // inner flash on beat
    // Hard cap to prevent bloom blowout
    col = min(col, vec3(1.8));
    gl_FragColor = vec4(col, 1.0);
}`;

// Extended finger detection: tip further from base joint = extended
function isExtended(lms, tip, base) {
    if (!lms[tip] || !lms[base]) return false;
    // Tip Y < base Y in screen space (MediaPipe) means finger pointing up
    return lms[tip].y < lms[base].y - 0.04;
}

// Industrial sound design
const SOUNDS = {
    // Industrial kick: punch with frequency drop
    kick: (ctx, dest, cutoff) => {
        const osc = ctx.createOscillator(), env = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 200 + cutoff * 3000;
        osc.type = 'sine';
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(38, now + 0.18);
        env.gain.setValueAtTime(1.1, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(env); env.connect(filter); filter.connect(dest);
        osc.start(now); osc.stop(now + 0.4);
    },
    // Metallic snare: noise + ring mod
    snare: (ctx, dest, cutoff) => {
        const now = ctx.currentTime;
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 800 + cutoff * 2000;
        bp.Q.value = 0.8;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.55, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        // Ring mod click at start
        const ring = ctx.createOscillator();
        ring.type = 'triangle';
        ring.frequency.value = 180;
        const ringEnv = ctx.createGain();
        ringEnv.gain.setValueAtTime(0.4, now);
        ringEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        ring.connect(ringEnv); ringEnv.connect(dest);
        ring.start(now); ring.stop(now + 0.08);
        noise.connect(bp); bp.connect(env); env.connect(dest);
        noise.start(now); noise.stop(now + 0.22);
    },
    // Industrial hihat: ultra-high freq noise burst
    hat: (ctx, dest) => {
        const now = ctx.currentTime;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 9000;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.28, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
        src.connect(hp); hp.connect(env); env.connect(dest);
        src.start(now); src.stop(now + 0.07);
    },
    // Glitch burst: bit-crushed chaos + detuned noise
    glitch: (ctx, dest) => {
        const now = ctx.currentTime;
        const duration = 0.28;
        const sr = ctx.sampleRate;
        const buf = ctx.createBuffer(1, Math.floor(sr * duration), sr);
        const d = buf.getChannelData(0);
        const bits = 3;
        const steps = Math.pow(2, bits);
        let phase = 0;
        const pitchJump = 440 * (1 + Math.random() * 8);
        for (let i = 0; i < d.length; i++) {
            phase += pitchJump / sr;
            const raw = Math.sin(phase * Math.PI * 2) * (Math.random() > 0.3 ? 1 : -1);
            d[i] = Math.round(raw * steps) / steps * (1 - i / d.length);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.6, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + duration);
        src.connect(env); env.connect(dest);
        src.start(now); src.stop(now + duration + 0.05);
    },
    // Deep industrial rumble / sub drone
    sub: (ctx, dest, cutoff) => {
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator();
        osc1.type = 'sawtooth'; osc1.frequency.value = 40 + cutoff * 60;
        osc2.type = 'sawtooth'; osc2.frequency.value = 40.3 + cutoff * 60; // detuned
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 120 + cutoff * 400;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.45, now + 0.02);
        env.gain.setValueAtTime(0.45, now + 0.08);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        osc1.connect(env); osc2.connect(env); env.connect(filter); filter.connect(dest);
        osc1.start(now); osc2.start(now);
        osc1.stop(now + 1.0); osc2.stop(now + 1.0);
    }
};

export class NeuralGlitch {
    constructor(scene, audioCtx, THREE) {
        this._scene  = scene;
        this._ctx    = audioCtx;
        this._T      = THREE;
        this._mesh   = null;
        this._uni    = null;
        this._active = false;
        this._mGain  = null;
        this._compressor = null;
        this._beatFlash = 0;
        this._cutoff = 0.2;    // 0-1, controlled by wrist height
        this._displace = 0.06; // controlled by right hand pinch

        // Finger state tracking (prevent re-triggering while held)
        this._fingerWasExtended = [false, false, false, false]; // index,mid,ring,pinky
        this._cool = [0, 0, 0, 0, 0];
    }

    async init() {
        this._buildMesh();
        this._buildAudio();
    }

    _buildMesh() {
        const T = this._T;
        this._uni = {
            uTime:     { value: 0 },
            uBeat:     { value: 0 },
            uCutoff:   { value: 0.2 },
            uDisplace: { value: 0.06 }
        };
        const geo = new T.SphereGeometry(2.0, 64, 64);
        const mat = new T.ShaderMaterial({
            uniforms: this._uni,
            vertexShader:   SPHERE_VERT,
            fragmentShader: SPHERE_FRAG,
            side: T.DoubleSide
        });
        this._mesh = new T.Mesh(geo, mat);
        this._mesh.visible = false;
        this._scene.add(this._mesh);
    }

    _buildAudio() {
        const ctx = this._ctx;
        this._compressor = ctx.createDynamicsCompressor();
        this._compressor.threshold.value = -14;
        this._compressor.ratio.value = 4;
        this._compressor.attack.value = 0.003;
        this._compressor.release.value = 0.12;

        this._mGain = ctx.createGain();
        this._mGain.gain.value = 0;
        this._compressor.connect(this._mGain);
        this._mGain.connect(ctx.destination);
    }

    _processHands(hr) {
        if (!hr || !hr.multiHandLandmarks) return;
        const now = performance.now();

        for (let hi = 0; hi < hr.multiHandLandmarks.length; hi++) {
            const lms  = hr.multiHandLandmarks[hi];
            const side = hr.multiHandedness?.[hi]?.label;

            if (side === 'Right' || (!side && hi === 0)) {
                // Right hand = parameter control
                const wrist = lms[0];
                if (wrist) {
                    // Wrist Y in [0,1] → cutoff [0,1] (hand up = open filter)
                    this._cutoff = Math.max(0, Math.min(1, 1 - wrist.y));
                    this._uni.uCutoff.value = this._cutoff;
                }
                // Pinch (index tip to thumb tip) = displacement amount
                const idx = lms[8], thm = lms[4];
                if (idx && thm) {
                    const pinch = Math.max(0, Math.min(1, 1 - Math.hypot(idx.x - thm.x, idx.y - thm.y) * 7));
                    this._displace = 0.02 + pinch * 0.22;
                    this._uni.uDisplace.value = this._displace;
                }

            } else {
                // Left hand = trigger different sounds on finger extension
                const triggers = [
                    { tip: 8,  base: 5,  sound: 'kick',  coolMs: 180 },  // index  → kick
                    { tip: 12, base: 9,  sound: 'snare', coolMs: 180 },  // middle → snare
                    { tip: 16, base: 13, sound: 'hat',   coolMs: 80  },  // ring   → hat
                    { tip: 20, base: 17, sound: 'glitch',coolMs: 220 },  // pinky  → glitch
                ];

                triggers.forEach((tr, i) => {
                    const ext = isExtended(lms, tr.tip, tr.base);
                    if (ext && !this._fingerWasExtended[i] && now > this._cool[i]) {
                        this._cool[i] = now + tr.coolMs;
                        SOUNDS[tr.sound](this._ctx, this._compressor, this._cutoff);
                        this._beatFlash = 1.0;
                    }
                    this._fingerWasExtended[i] = ext;
                });

                // Sub drone when all fingers closed (fist)
                const allClosed = [8,12,16,20].every(tip => !isExtended(lms, tip, tip-2));
                if (allClosed && now > this._cool[4]) {
                    this._cool[4] = now + 900;
                    SOUNDS.sub(this._ctx, this._compressor, this._cutoff);
                    this._beatFlash = 0.5;
                }
            }
        }
    }

    activate() {
        this._active = true;
        this._mesh.visible = true;
        if (this._mGain) this._mGain.gain.setTargetAtTime(0.8, this._ctx.currentTime, 0.1);
    }

    deactivate() {
        this._active = false;
        this._mesh.visible = false;
        if (this._mGain) this._mGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        this._fingerWasExtended = [false, false, false, false];
    }

    update(hr, t) {
        if (!this._active) return;
        this._uni.uTime.value  = t;
        this._beatFlash = Math.max(0, this._beatFlash - 0.04);
        this._uni.uBeat.value  = this._beatFlash;
        // Gentle rotation — stops when no hands
        this._mesh.rotation.y = t * 0.12;
        this._mesh.rotation.x = Math.sin(t * 0.07) * 0.15;
        this._processHands(hr);
    }
}
