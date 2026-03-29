// CyberHangdrum — Hexagonal prism pads, 3D Raycasting triggers, haptic pulse
// D Kurd scale: D3 center + A3 Bb3 C4 D4 E4 F4 G4 A4 ring
// NO 2D distance checks — Three.js Raycaster through fingertip NDC position

const R  = 0.35;          // ring radius — wide spacing prevents random triggers
const CX = 0.5, CY = 0.72; // lower screen, natural hand position

function ringPad(angle, note, freq, color) {
    return { normX: CX + R * Math.cos(angle), normY: CY + R * Math.sin(angle), freq, note, color };
}

const PAD_DEFS = [
    { normX: CX, normY: CY, freq: 146.83, note: 'D3', color: 0x00ffcc, isCenter: true },
    ringPad(-Math.PI/2,              'A3',  220.00, 0x00d4ff),
    ringPad(-Math.PI/2 + Math.PI/4, 'Bb3', 233.08, 0x4488ff),
    ringPad(0,                       'C4',  261.63, 0x8844ff),
    ringPad(Math.PI/4,               'D4',  293.66, 0xff44cc),
    ringPad(Math.PI/2,               'E4',  329.63, 0xff6600),
    ringPad(Math.PI/2 + Math.PI/4,  'F4',  349.23, 0xffcc00),
    ringPad(Math.PI,                 'G4',  392.00, 0x00ff88),
    ringPad(Math.PI + Math.PI/4,    'A4',  440.00, 0x00ffcc),
];

const ALL_TIPS = [4, 8, 12, 16, 20]; // all 5 fingertips

export class CyberHangdrum {
    constructor(scene, audioCtx, THREE, camera, recDest) {
        this._scene   = scene;
        this._ctx     = audioCtx;
        this._T       = THREE;
        this._cam     = camera;
        this._recDest = recDest;
        this._pads    = [];   // { mesh, cage, topDisc, pulseT }
        this._active  = false;
        this._cool    = new Array(PAD_DEFS.length).fill(0);
        this._ray     = null;
        this._masterGain = null;
        this._reverbGain = null;
    }

    async init() {
        this._ray = new this._T.Raycaster();
        this._buildMeshes();
        this._buildAudio();
    }

    _buildMeshes() {
        const T = this._T;
        PAD_DEFS.forEach(p => {
            const baseR  = p.isCenter ? 0.52 : 0.26;
            const height = p.isCenter ? 0.16 : 0.10;
            const col    = new T.Color(p.color);

            // Hexagonal prism body
            const geo = new T.CylinderGeometry(baseR, baseR * 0.82, height, 6);
            const mat = new T.MeshStandardMaterial({
                color: col, emissive: col, emissiveIntensity: 0.18,
                metalness: 0.94, roughness: 0.06,
                transparent: true, opacity: 0.68
            });
            const mesh = new T.Mesh(geo, mat);
            mesh.rotation.y = Math.PI / 6;
            mesh.visible = false;
            this._scene.add(mesh);

            // Wireframe cage — EdgesGeometry (cinematic hex outline)
            const cage = new T.LineSegments(
                new T.EdgesGeometry(geo),
                new T.LineBasicMaterial({
                    color: col, transparent: true, opacity: 0.95,
                    blending: T.AdditiveBlending, depthWrite: false
                })
            );
            cage.rotation.y = Math.PI / 6;
            cage.visible = false;
            this._scene.add(cage);

            // Top face glow disc
            const topGeo = new T.CircleGeometry(baseR * 0.85, 6);
            const topMat = new T.MeshBasicMaterial({
                color: col, transparent: true, opacity: 0.14,
                blending: T.AdditiveBlending, side: T.DoubleSide, depthWrite: false
            });
            const topDisc = new T.Mesh(topGeo, topMat);
            topDisc.rotation.x = -Math.PI / 2;
            topDisc.position.y = height / 2 + 0.003;
            topDisc.visible = false;
            this._scene.add(topDisc);

            this._pads.push({ mesh, cage, topDisc, pulseT: 0, col });
        });
    }

    _buildAudio() {
        const ctx = this._ctx;

        // Plate reverb IR
        const len = Math.floor(ctx.sampleRate * 3.2);
        const ir  = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++)
                d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 1.6) * (0.5+0.5*Math.sin(i*0.003));
        }
        const reverb = ctx.createConvolver();
        reverb.buffer = ir;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0.8;
        this._masterGain.connect(ctx.destination);
        if (this._recDest) this._masterGain.connect(this._recDest);

        this._reverbGain = ctx.createGain();
        this._reverbGain.gain.value = 0.52;

        this._dryGain = ctx.createGain();
        this._dryGain.gain.value = 0.58;

        const eq = ctx.createBiquadFilter();
        eq.type = 'peaking'; eq.frequency.value = 1200; eq.gain.value = 3.5; eq.Q.value = 1.2;

        reverb.connect(eq); eq.connect(this._masterGain);
        this._dryGain.connect(this._masterGain);
        this._reverb = reverb;
    }

    _playPad(i) {
        const ctx  = this._ctx;
        const freq = PAD_DEFS[i].freq;
        const now  = ctx.currentTime;

        // Inharmonic FM bell (hangdrum character)
        const carrier = ctx.createOscillator();
        carrier.type = 'sine'; carrier.frequency.value = freq;

        const ampEnv = ctx.createGain();
        ampEnv.gain.setValueAtTime(0, now);
        ampEnv.gain.linearRampToValueAtTime(0.72, now + 0.003);
        ampEnv.gain.exponentialRampToValueAtTime(0.18, now + 0.28);
        ampEnv.gain.exponentialRampToValueAtTime(0.001, now + 4.2);

        [[2.756, freq*5.5, 0.6],[5.404, freq*2.8, 0.35],[8.1, freq*1.1, 0.15]].forEach(([r,d,dec]) => {
            const m = ctx.createOscillator(), g = ctx.createGain();
            m.type = 'sine'; m.frequency.value = freq * r;
            g.gain.setValueAtTime(d, now); g.gain.exponentialRampToValueAtTime(d*0.02, now+dec);
            m.connect(g); g.connect(carrier.frequency);
            m.start(now); m.stop(now+4.5);
        });

        if (PAD_DEFS[i].isCenter) {
            const sub = ctx.createOscillator(), sg = ctx.createGain();
            sub.type = 'sine'; sub.frequency.value = freq * 0.5;
            sg.gain.setValueAtTime(0.38, now); sg.gain.exponentialRampToValueAtTime(0.001, now+3.0);
            sub.connect(sg); sg.connect(ampEnv);
            sub.start(now); sub.stop(now+3.5);
        }

        carrier.connect(ampEnv);
        ampEnv.connect(this._reverb);
        ampEnv.connect(this._dryGain);
        carrier.start(now); carrier.stop(now+4.5);

        this._pads[i].pulseT = 1.0;
    }

    // NDC coordinate from MediaPipe [0,1] — mirrored X
    _lm2ndc(lm) {
        return new this._T.Vector2(-(lm.x*2-1), -(lm.y*2-1));
    }

    // World pos for pad screen-space center (for placement)
    _s2w(nx, ny) {
        const T = this._T;
        const ndc = new T.Vector3(-(nx*2-1), -(ny*2-1), 0.5);
        ndc.unproject(this._cam);
        const dir = ndc.sub(this._cam.position).normalize();
        const t   = -this._cam.position.z / dir.z;
        return this._cam.position.clone().add(dir.multiplyScalar(t));
    }

    _processHands(hr) {
        if (!hr || !hr.multiHandLandmarks) return;
        const now = performance.now();
        const padMeshes = this._pads.map(p => p.mesh);

        for (const lms of hr.multiHandLandmarks) {
            for (const tipIdx of ALL_TIPS) {
                const lm = lms[tipIdx];
                if (!lm) continue;
                // Raycast from camera through 3D fingertip position
                this._ray.setFromCamera(this._lm2ndc(lm), this._cam);
                const hits = this._ray.intersectObjects(padMeshes);
                if (!hits.length) continue;
                const pi = padMeshes.indexOf(hits[0].object);
                if (pi >= 0 && now > this._cool[pi]) {
                    this._cool[pi] = now + 260;
                    this._playPad(pi);
                }
            }
        }
    }

    activate() {
        this._active = true;
        this._pads.forEach(p => { p.mesh.visible = true; p.cage.visible = true; p.topDisc.visible = true; });
    }

    deactivate() {
        this._active = false;
        this._pads.forEach(p => { p.mesh.visible = false; p.cage.visible = false; p.topDisc.visible = false; });
    }

    update(hr, t, cam) {
        if (!this._active) return;
        this._cam = cam;
        const T = this._T;

        PAD_DEFS.forEach((def, i) => {
            const pad = this._pads[i];
            const wp  = this._s2w(def.normX, def.normY);
            const s   = 1 + pad.pulseT * 0.32;

            pad.mesh.position.set(wp.x, wp.y, 0);
            pad.mesh.scale.set(s, 1 + pad.pulseT * 0.18, s);
            pad.cage.position.set(wp.x, wp.y, 0);
            pad.cage.scale.set(s, 1, s);
            pad.topDisc.position.set(wp.x, wp.y + 0.06, 0);
            pad.topDisc.scale.setScalar(s);

            // Slow hex rotation
            const rot = t * 0.05 + i * 0.35;
            pad.mesh.rotation.y = rot; pad.cage.rotation.y = rot;

            // Decay pulse
            if (pad.pulseT > 0) pad.pulseT = Math.max(0, pad.pulseT - 0.055);

            // Emissive flash on hit
            pad.mesh.material.emissiveIntensity = 0.18 + pad.pulseT * 3.8;
            pad.cage.material.opacity   = 0.55 + pad.pulseT * 0.45;
            pad.topDisc.material.opacity = 0.12 + pad.pulseT * 0.65;
        });

        this._processHands(hr);
    }
}
