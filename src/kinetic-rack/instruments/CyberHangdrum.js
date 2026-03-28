import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// CYBER HANGDRUM — Torus pad hit-zones + WAV samples + Bloom overdrive
// ─────────────────────────────────────────────────────────────────────────────

const PADS = [
    // cx, cy in normalized [0,1] screen space, note name, frequency fallback
    { cx: 0.50, cy: 0.35, note: 'D4',  freq: 293.66, color: 0x00ffcc },
    { cx: 0.35, cy: 0.45, note: 'F4',  freq: 349.23, color: 0x00ccff },
    { cx: 0.65, cy: 0.45, note: 'A4',  freq: 440.00, color: 0xff00cc },
    { cx: 0.28, cy: 0.60, note: 'C5',  freq: 523.25, color: 0xffcc00 },
    { cx: 0.72, cy: 0.60, note: 'E5',  freq: 659.25, color: 0xff6600 },
    { cx: 0.40, cy: 0.72, note: 'G5',  freq: 783.99, color: 0x66ff00 },
    { cx: 0.60, cy: 0.72, note: 'B5',  freq: 987.77, color: 0x0066ff },
    { cx: 0.50, cy: 0.82, note: 'D5',  freq: 587.33, color: 0xcc00ff },
];

const WAV_URLS = []; // Populated if samples available; fallback to synthesis

export class CyberHangdrum {
    constructor(scene, audioCtx) {
        this._scene    = scene;
        this._ctx      = audioCtx;
        this._meshes   = [];
        this._buffers  = new Array(PADS.length).fill(null);
        this._cooldown = new Array(PADS.length).fill(0);
        this._masterGain = null;
        this._reverb     = null;
        this._drone      = null;
        this._active     = false;
    }

    async init() {
        this._buildMeshes();
        this._buildAudio();
        await this._loadSamples();
    }

    _buildMeshes() {
        PADS.forEach((p, i) => {
            const geo = new THREE.TorusGeometry(0.55, 0.08, 16, 60);
            const mat = new THREE.MeshStandardMaterial({
                color:             new THREE.Color(p.color),
                emissive:          new THREE.Color(p.color),
                emissiveIntensity: 0.3,
                metalness: 0.8,
                roughness: 0.2,
                transparent: true,
                opacity: 0.85
            });
            const mesh = new THREE.Mesh(geo, mat);
            // Position will be set in update() based on camera FOV; store cx/cy
            mesh.userData.padIndex = i;
            mesh.visible = false;
            this._scene.add(mesh);
            this._meshes.push(mesh);
        });
    }

    _buildAudio() {
        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.setValueAtTime(0.7, this._ctx.currentTime);

        // Plate reverb via convolver
        this._reverb = this._ctx.createConvolver();
        this._reverb.connect(this._masterGain);
        this._masterGain.connect(this._ctx.destination);

        // Generate a simple IR (exponential decay noise)
        const len  = this._ctx.sampleRate * 2.8;
        const ir   = this._ctx.createBuffer(2, len, this._ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) {
                d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
            }
        }
        this._reverb.buffer = ir;

        // Granular pad drone — two detuned sine oscillators
        const osc1 = this._ctx.createOscillator();
        const osc2 = this._ctx.createOscillator();
        const droneGain = this._ctx.createGain();
        osc1.type = 'sine'; osc1.frequency.value = 73.4;   // D2
        osc2.type = 'sine'; osc2.frequency.value = 73.4 * 1.007; // slight detune
        droneGain.gain.value = 0;
        osc1.connect(droneGain); osc2.connect(droneGain);
        droneGain.connect(this._ctx.destination);
        osc1.start(); osc2.start();
        this._drone = droneGain;
    }

    async _loadSamples() {
        // Try to load WAV samples; fall back to synthesis silently
        for (let i = 0; i < PADS.length; i++) {
            if (!WAV_URLS[i]) continue;
            try {
                const r = await fetch(WAV_URLS[i]);
                if (!r.ok) continue;
                const ab = await r.arrayBuffer();
                this._buffers[i] = await this._ctx.decodeAudioData(ab);
            } catch(_) { /* fallback to synth */ }
        }
    }

    // Convert screen-space [0,1] pad position to world coordinates at z=0
    _s2w(cx, cy, cam) {
        const ndc = new THREE.Vector3(cx * 2 - 1, -(cy * 2 - 1), 0.5);
        ndc.unproject(cam);
        const dir = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    _playPad(i) {
        const pad = PADS[i];
        if (this._buffers[i]) {
            const src = this._ctx.createBufferSource();
            src.buffer = this._buffers[i];
            src.connect(this._reverb);
            src.start();
        } else {
            // Synthesis fallback — bell-like FM
            const carrier = this._ctx.createOscillator();
            const modulator = this._ctx.createOscillator();
            const modGain  = this._ctx.createGain();
            const envGain  = this._ctx.createGain();

            carrier.type   = 'sine';
            carrier.frequency.value = pad.freq;
            modulator.type = 'sine';
            modulator.frequency.value = pad.freq * 2.756;
            modGain.gain.value = pad.freq * 1.8;

            modulator.connect(modGain);
            modGain.connect(carrier.frequency);
            carrier.connect(envGain);
            envGain.connect(this._reverb);

            const now = this._ctx.currentTime;
            envGain.gain.setValueAtTime(0, now);
            envGain.gain.linearRampToValueAtTime(0.6, now + 0.005);
            envGain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);

            carrier.start(now); modulator.start(now);
            carrier.stop(now + 2.5); modulator.stop(now + 2.5);
        }
    }

    _processHands(handsResults, cam) {
        if (!handsResults || !handsResults.multiHandLandmarks) return;
        const now = performance.now();

        for (const lms of handsResults.multiHandLandmarks) {
            // Check index fingertip (8) and middle fingertip (12)
            for (const tipIdx of [8, 12]) {
                const lm = lms[tipIdx];
                if (!lm) continue;

                PADS.forEach((pad, i) => {
                    const dx = lm.x - pad.cx;
                    const dy = lm.y - pad.cy;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 0.07 && now > this._cooldown[i]) {
                        this._cooldown[i] = now + 400;
                        this._playPad(i);
                        // Spike emissive for Bloom capture
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

    update(handsResults, t, cam) {
        if (!this._active) return;

        // Position meshes in world space
        this._meshes.forEach((mesh, i) => {
            const wp = this._s2w(PADS[i].cx, PADS[i].cy, cam);
            mesh.position.copy(wp);
            mesh.position.z = 0.5;
            mesh.rotation.x = Math.sin(t * 0.4 + i) * 0.1;
            mesh.rotation.y = t * 0.2 + i * 0.8;

            // Decay emissive back to resting
            const mat = mesh.material;
            if (mat.emissiveIntensity > 0.3) {
                mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, 0.3, 0.12);
            }
        });

        this._processHands(handsResults, cam);
    }
}
