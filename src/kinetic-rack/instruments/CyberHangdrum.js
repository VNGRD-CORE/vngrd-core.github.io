// CyberHangdrum — receives THREE as constructor arg (no static imports)

const PADS = [
    { cx: 0.50, cy: 0.35, freq: 293.66, color: 0x00ffcc },
    { cx: 0.35, cy: 0.45, freq: 349.23, color: 0x00ccff },
    { cx: 0.65, cy: 0.45, freq: 440.00, color: 0xff00cc },
    { cx: 0.28, cy: 0.60, freq: 523.25, color: 0xffcc00 },
    { cx: 0.72, cy: 0.60, freq: 659.25, color: 0xff6600 },
    { cx: 0.40, cy: 0.72, freq: 783.99, color: 0x66ff00 },
    { cx: 0.60, cy: 0.72, freq: 987.77, color: 0x0066ff },
    { cx: 0.50, cy: 0.82, freq: 587.33, color: 0xcc00ff },
];

export class CyberHangdrum {
    constructor(scene, audioCtx, THREE) {
        this._scene  = scene;
        this._ctx    = audioCtx;
        this._T      = THREE;
        this._meshes  = [];
        this._cool    = new Array(PADS.length).fill(0);
        this._active  = false;
        this._reverb  = null;
        this._drone   = null;
    }

    async init() {
        const T = this._T;
        PADS.forEach((p) => {
            const geo = new T.TorusGeometry(0.55, 0.08, 16, 60);
            const mat = new T.MeshStandardMaterial({
                color: new T.Color(p.color), emissive: new T.Color(p.color),
                emissiveIntensity: 0.3, metalness: 0.8, roughness: 0.2,
                transparent: true, opacity: 0.85
            });
            const mesh = new T.Mesh(geo, mat);
            mesh.visible = false;
            this._scene.add(mesh);
            this._meshes.push(mesh);
        });
        this._buildAudio();
    }

    _buildAudio() {
        const ctx = this._ctx;
        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0.7;
        this._reverb = ctx.createConvolver();
        this._reverb.connect(this._masterGain);
        this._masterGain.connect(ctx.destination);

        const len = ctx.sampleRate * 2.8;
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 2.2);
        }
        this._reverb.buffer = ir;

        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        const dg = ctx.createGain(); dg.gain.value = 0;
        o1.type = o2.type = 'sine';
        o1.frequency.value = 73.4; o2.frequency.value = 73.4 * 1.007;
        o1.connect(dg); o2.connect(dg); dg.connect(ctx.destination);
        o1.start(); o2.start();
        this._drone = dg;
    }

    _s2w(cx, cy, cam) {
        const T = this._T;
        const ndc = new T.Vector3(cx*2-1, -(cy*2-1), 0.5);
        ndc.unproject(cam);
        const dir = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    _playPad(i) {
        const ctx = this._ctx, freq = PADS[i].freq;
        const carrier = ctx.createOscillator(), mod = ctx.createOscillator();
        const mGain = ctx.createGain(), env = ctx.createGain();
        carrier.type = 'sine'; carrier.frequency.value = freq;
        mod.type = 'sine'; mod.frequency.value = freq * 2.756;
        mGain.gain.value = freq * 1.8;
        mod.connect(mGain); mGain.connect(carrier.frequency);
        carrier.connect(env); env.connect(this._reverb);
        const now = ctx.currentTime;
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.6, now + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
        carrier.start(now); mod.start(now);
        carrier.stop(now + 2.5); mod.stop(now + 2.5);
    }

    _processHands(hr, cam) {
        if (!hr || !hr.multiHandLandmarks) return;
        const now = performance.now();
        for (const lms of hr.multiHandLandmarks) {
            for (const tipIdx of [8, 12]) {
                const lm = lms[tipIdx]; if (!lm) continue;
                PADS.forEach((p, i) => {
                    const d = Math.hypot(lm.x - p.cx, lm.y - p.cy);
                    if (d < 0.07 && now > this._cool[i]) {
                        this._cool[i] = now + 400;
                        this._playPad(i);
                        this._meshes[i].material.emissiveIntensity = 4.5;
                    }
                });
            }
        }
    }

    activate() {
        this._active = true;
        this._meshes.forEach(m => { m.visible = true; });
        if (this._drone) this._drone.gain.setTargetAtTime(0.04, this._ctx.currentTime, 0.3);
    }

    deactivate() {
        this._active = false;
        this._meshes.forEach(m => { m.visible = false; });
        if (this._drone) this._drone.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
    }

    update(hr, t, cam) {
        if (!this._active) return;
        const T = this._T;
        this._meshes.forEach((mesh, i) => {
            const wp = this._s2w(PADS[i].cx, PADS[i].cy, cam);
            mesh.position.copy(wp); mesh.position.z = 0.5;
            mesh.rotation.x = Math.sin(t*0.4+i)*0.1;
            mesh.rotation.y = t*0.2 + i*0.8;
            if (mesh.material.emissiveIntensity > 0.3)
                mesh.material.emissiveIntensity = T.MathUtils.lerp(mesh.material.emissiveIntensity, 0.3, 0.12);
        });
        this._processHands(hr, cam);
    }
}
