// CyberHangdrum — traditional 9-pad hangdrum layout, metallic FM synthesis
// D Kurd scale: D3 center + A3 Bb3 C4 D4 E4 F4 G4 A4 ring
// No THREE static imports — receives T (THREE namespace) as constructor arg

// Classic hangdrum: 1 center Ding + 8 tonefields in ring
const R = 0.28; // ring radius in normalized screen space — wider spacing
const CX = 0.5, CY = 0.72; // lower screen where hands naturally rest

function ringPad(angle, note, freq, color) {
    return {
        cx: CX + R * Math.cos(angle),
        cy: CY + R * Math.sin(angle),
        freq, note, color,
        hitR: 0.09   // hit radius
    };
}

const PADS = [
    // Center Ding (D3 - deep bass)
    { cx: CX, cy: CY, freq: 146.83, note: 'D3', color: 0x00ffcc, hitR: 0.12, isCenter: true },
    // Ring — 8 pads clockwise from top
    ringPad(-Math.PI/2,        'A3',  220.00, 0x00ccff),   // top
    ringPad(-Math.PI/2 + Math.PI/4, 'Bb3', 233.08, 0x4488ff),
    ringPad(0,                 'C4',  261.63, 0x8844ff),   // right
    ringPad(Math.PI/4,         'D4',  293.66, 0xff44cc),
    ringPad(Math.PI/2,         'E4',  329.63, 0xff6600),   // bottom
    ringPad(Math.PI/2 + Math.PI/4, 'F4', 349.23, 0xffcc00),
    ringPad(Math.PI,           'G4',  392.00, 0x00ff88),   // left
    ringPad(Math.PI + Math.PI/4, 'A4', 440.00, 0x00ffcc),
];

export class CyberHangdrum {
    constructor(scene, audioCtx, THREE) {
        this._scene  = scene;
        this._ctx    = audioCtx;
        this._T      = THREE;
        this._discs  = [];   // main pad discs
        this._rings  = [];   // outline rings
        this._active = false;
        this._cool   = new Array(PADS.length).fill(0);
        this._prevHit = new Array(PADS.length).fill(false);
        this._reverb = null;
        this._masterGain = null;
    }

    async init() {
        this._buildMeshes();
        this._buildAudio();
    }

    _buildMeshes() {
        const T = this._T;
        PADS.forEach((p) => {
            const baseR = p.isCenter ? 0.62 : 0.32;
            const col   = new T.Color(p.color);

            // Filled disc
            const discGeo = new T.CircleGeometry(baseR, 48);
            const discMat = new T.MeshStandardMaterial({
                color:             col,
                emissive:          col,
                emissiveIntensity: 0.12,
                metalness: 0.85,
                roughness: 0.15,
                transparent: true,
                opacity: 0.55,
                side: T.DoubleSide
            });
            const disc = new T.Mesh(discGeo, discMat);
            disc.position.z = 0.1;
            disc.visible = false;
            this._scene.add(disc);
            this._discs.push(disc);

            // Glowing ring outline
            const ringGeo = new T.RingGeometry(baseR - 0.04, baseR + 0.02, 48);
            const ringMat = new T.MeshBasicMaterial({
                color: col,
                transparent: true,
                opacity: 0.8,
                side: T.DoubleSide
            });
            const ring = new T.Mesh(ringGeo, ringMat);
            ring.position.z = 0.15;
            ring.visible = false;
            this._scene.add(ring);
            this._rings.push(ring);
        });
    }

    _buildAudio() {
        const ctx = this._ctx;

        // Plate reverb — exponential-decay noise IR
        this._reverb = ctx.createConvolver();
        const len = Math.floor(ctx.sampleRate * 3.2);
        const ir  = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) {
                // Denser late diffusion for plate character
                d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6)
                     * (0.5 + 0.5 * Math.sin(i * 0.003)); // modulated density
            }
        }
        this._reverb.buffer = ir;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0.72;

        // EQ — boost metallic mids
        const eq = ctx.createBiquadFilter();
        eq.type = 'peaking';
        eq.frequency.value = 1200;
        eq.gain.value = 3;
        eq.Q.value = 1.2;

        this._reverb.connect(eq);
        eq.connect(this._masterGain);
        this._masterGain.connect(ctx.destination);
    }

    // Inharmonic metallic FM bell — cinematic quality
    _playPad(padIdx) {
        const ctx = this._ctx;
        const freq = PADS[padIdx].freq;
        const now  = ctx.currentTime;

        // Operator ratios for handpan character (slightly inharmonic = organic)
        const ratios   = [1.0, 2.756, 5.404, 8.1];
        const modDepths = [freq * 5.5, freq * 2.8, freq * 1.1, freq * 0.4];
        const modDecays = [0.6, 0.35, 0.15, 0.08];

        // Main carrier
        const carrier = ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.value = freq;

        const ampEnv = ctx.createGain();
        ampEnv.gain.setValueAtTime(0, now);
        ampEnv.gain.linearRampToValueAtTime(0.65, now + 0.003); // instant metallic attack
        ampEnv.gain.setValueAtTime(0.65, now + 0.006);
        ampEnv.gain.exponentialRampToValueAtTime(0.18, now + 0.25);
        ampEnv.gain.exponentialRampToValueAtTime(0.001, now + 4.2); // long tail

        // Three modulators for richness
        ratios.slice(1).forEach((r, i) => {
            const mod  = ctx.createOscillator();
            const mGain = ctx.createGain();
            mod.type = 'sine';
            mod.frequency.value = freq * r;
            mGain.gain.setValueAtTime(modDepths[i+1], now);
            mGain.gain.exponentialRampToValueAtTime(modDepths[i+1] * 0.02, now + modDecays[i+1]);
            mod.connect(mGain);
            mGain.connect(carrier.frequency);
            mod.start(now); mod.stop(now + 4.5);
        });

        // Sub harmonic for depth on center pad
        if (PADS[padIdx].isCenter) {
            const sub  = ctx.createOscillator();
            const sGain = ctx.createGain();
            sub.type = 'sine';
            sub.frequency.value = freq * 0.5;
            sGain.gain.setValueAtTime(0.35, now);
            sGain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);
            sub.connect(sGain); sGain.connect(ampEnv);
            sub.start(now); sub.stop(now + 3.5);
        }

        carrier.connect(ampEnv);
        ampEnv.connect(this._reverb);
        carrier.start(now);
        carrier.stop(now + 4.5);

        // Spark emissive
        this._discs[padIdx].material.emissiveIntensity = 3.5;
        this._rings[padIdx].material.opacity = 1.0;
    }

    // Project screen-space [0,1] pad to world at z=0
    _s2w(cx, cy, cam) {
        const T = this._T;
        const ndc = new T.Vector3(cx * 2 - 1, -(cy * 2 - 1), 0.5);
        ndc.unproject(cam);
        const dir  = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    _processHands(hr, cam) {
        if (!hr || !hr.multiHandLandmarks) return;
        const now = performance.now();

        for (const lms of hr.multiHandLandmarks) {
            // Check index (8), middle (12), thumb (4) fingertips
            for (const tipIdx of [8, 12, 4]) {
                const lm = lms[tipIdx];
                if (!lm) continue;

                PADS.forEach((p, i) => {
                    const dx = lm.x - p.cx;
                    const dy = lm.y - p.cy;
                    const inPad = (dx*dx + dy*dy) < p.hitR * p.hitR;

                    // Trigger on entry (not while holding)
                    if (inPad && !this._prevHit[i] && now > this._cool[i]) {
                        this._cool[i] = now + 280;
                        this._playPad(i);
                    }
                    // Track per-finger state
                    if (tipIdx === 8) this._prevHit[i] = inPad;
                });
            }
        }
    }

    activate() {
        this._active = true;
        this._discs.forEach(m => { m.visible = true; });
        this._rings.forEach(m => { m.visible = true; });
    }

    deactivate() {
        this._active = false;
        this._discs.forEach(m => { m.visible = false; });
        this._rings.forEach(m => { m.visible = false; });
    }

    update(hr, t, cam) {
        if (!this._active) return;
        const T = this._T;

        // Position pads in world space
        PADS.forEach((p, i) => {
            const wp = this._s2w(p.cx, p.cy, cam);
            this._discs[i].position.set(wp.x, wp.y, 0.1);
            this._rings[i].position.set(wp.x, wp.y, 0.15);

            // Slow rotation for organic feel
            this._discs[i].rotation.z = t * 0.08 + i * 0.4;

            // Decay emissive
            const mat = this._discs[i].material;
            if (mat.emissiveIntensity > 0.12)
                mat.emissiveIntensity = T.MathUtils.lerp(mat.emissiveIntensity, 0.12, 0.10);

            const rMat = this._rings[i].material;
            if (rMat.opacity > 0.8)
                rMat.opacity = T.MathUtils.lerp(rMat.opacity, 0.8, 0.10);
        });

        this._processHands(hr, cam);
    }
}
