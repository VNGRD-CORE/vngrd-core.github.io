import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// TETHER VERLET — Plasma cables (CORE) | Constellation (CONST) | Flow (FLOW)
// ─────────────────────────────────────────────────────────────────────────────

const TETHER_VERT = `
varying vec3 vNormal;
varying vec3 vPos;
void main(){
    vNormal = normalMatrix * normal;
    vPos    = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const TETHER_FRAG = `
uniform vec3  uColor;
uniform float uGlow;
varying vec3  vNormal;
varying vec3  vPos;
void main(){
    vec3 N   = normalize(vNormal);
    vec3 V   = normalize(-vPos);
    float rim = pow(1.0 - abs(dot(N, V)), 2.5);
    vec3 col  = uColor + rim * uColor * uGlow;
    gl_FragColor = vec4(col, 1.0);
}`;

const FINGER_TIPS = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky
const CABLE_COLORS = [
    new THREE.Color(0x00ffcc),
    new THREE.Color(0xff00cc),
    new THREE.Color(0x00aaff),
    new THREE.Color(0xffaa00),
];

export class TetherVerlet {
    constructor(scene, audioCtx) {
        this._scene  = scene;
        this._ctx    = audioCtx;
        this._mode   = 'CORE';
        this._active = false;

        // CORE
        this._coreMeshes    = [];
        this._coreUniforms  = [];
        this._snapParticles = null;
        this._snapGeo       = null;
        this._snapActive    = false;
        this._snapTimer     = 0;

        // CONSTELLATION
        this._constLines    = null;
        this._constGeo      = null;

        // FLOW
        this._flowPoints    = [];

        // Audio
        this._masterGain = null;
        this._tcFilter   = null;
        this._wsNode     = null;
        this._delayNode  = null;
        this._feedbackGain = null;
    }

    async init() {
        this._buildCoreMeshes();
        this._buildConstellation();
        this._buildFlow();
        this._buildAudio();
        this._setModeVisibility();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    _lm2w(lm, cam) {
        // Mirror X (webcam is mirrored in shader but MediaPipe gives raw)
        const ndc = new THREE.Vector3(
            -(lm.x * 2 - 1),
            -(lm.y * 2 - 1),
            0.5
        );
        ndc.unproject(cam);
        const dir  = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    _distCurve(amount) {
        const n = 256;
        const curve = new Float32Array(n * 2 + 1);
        const k = amount;
        for (let i = -n; i <= n; i++) {
            const x = i / n;
            curve[i + n] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    // ── CORE ──────────────────────────────────────────────────────────────────
    _buildCoreMeshes() {
        for (let i = 0; i < 4; i++) {
            const uni = {
                uColor: { value: CABLE_COLORS[i].clone() },
                uGlow:  { value: 1.0 }
            };
            const mat = new THREE.ShaderMaterial({
                uniforms:       uni,
                vertexShader:   TETHER_VERT,
                fragmentShader: TETHER_FRAG,
                side: THREE.DoubleSide
            });
            // Placeholder geometry; replaced every frame
            const geo  = new THREE.TubeGeometry(
                new THREE.CatmullRomCurve3([
                    new THREE.Vector3(-1, 0, 0),
                    new THREE.Vector3(0, 0.5, 0),
                    new THREE.Vector3(1, 0, 0)
                ]), 12, 0.04, 6, false
            );
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            this._scene.add(mesh);
            this._coreMeshes.push(mesh);
            this._coreUniforms.push(uni);
        }

        // Pre-allocate snap burst particles (600 pts)
        const snapPos = new Float32Array(600 * 3);
        this._snapGeo = new THREE.BufferGeometry();
        this._snapGeo.setAttribute('position', new THREE.BufferAttribute(snapPos, 3));
        const snapMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.08,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this._snapParticles = new THREE.Points(this._snapGeo, snapMat);
        this._snapParticles.visible = false;
        this._scene.add(this._snapParticles);
    }

    _updateCore(handsResults, cam, t) {
        if (!handsResults || !handsResults.multiHandLandmarks) return;
        const lmsList = handsResults.multiHandLandmarks;
        if (lmsList.length === 0) return;

        const lms = lmsList[0]; // Use first hand for cables

        // Build one cable per finger (index 0..3 → fingers 1-4 excluding thumb)
        const fingerDefs = [
            [5, 6, 7, 8],   // index
            [9, 10, 11, 12], // middle
            [13, 14, 15, 16], // ring
            [17, 18, 19, 20], // pinky
        ];

        fingerDefs.forEach((joints, ci) => {
            const mesh = this._coreMeshes[ci];
            const uni  = this._coreUniforms[ci];

            const pts = joints.map(j => {
                const lm = lms[j];
                if (!lm) return new THREE.Vector3();
                return this._lm2w(lm, cam);
            });

            // Add elastic sag to mid-points
            pts[1].y -= 0.15;
            pts[2].y -= 0.1;

            const curve = new THREE.CatmullRomCurve3(pts);

            // Dispose old geometry
            mesh.geometry.dispose();
            const tip    = lms[joints[3]];
            const tipPrev = lms[joints[2]];
            let tension = 0;
            if (tip && tipPrev) {
                tension = Math.max(0, Math.min(1,
                    Math.hypot(tip.x - tipPrev.x, tip.y - tipPrev.y) * 8));
            }

            const radius = 0.04 + tension * 0.03;
            mesh.geometry = new THREE.TubeGeometry(curve, 12, radius, 6, false);
            mesh.visible  = true;

            // Color → white + glow spike on tension
            uni.uColor.value.lerpColors(CABLE_COLORS[ci], new THREE.Color(1, 1, 1), tension);
            uni.uGlow.value = 1.0 + tension * 4.0;

            // Snap detection — high velocity tip
            if (tension > 0.85) {
                const wp = this._lm2w(lms[joints[3]], cam);
                this._triggerSnapBurst(wp);
                this._playSnap();
            }
        });

        // Decay snap burst
        if (this._snapActive) {
            const dt = t - this._snapTimer;
            const op = Math.max(0, 1 - dt * 3);
            this._snapParticles.material.opacity = op;
            if (op <= 0) {
                this._snapActive = false;
                this._snapParticles.visible = false;
            }
            // Expand particles
            const pos = this._snapGeo.attributes.position.array;
            for (let i = 0; i < pos.length; i += 3) {
                pos[i]   *= 1.04;
                pos[i+1] *= 1.04;
                pos[i+2] *= 1.04;
            }
            this._snapGeo.attributes.position.needsUpdate = true;
        }
    }

    _triggerSnapBurst(origin) {
        this._snapTimer = this._scene.userData._t || 0;
        const pos = this._snapGeo.attributes.position.array;
        for (let i = 0; i < pos.length; i += 3) {
            pos[i]   = origin.x + (Math.random() - 0.5) * 0.4;
            pos[i+1] = origin.y + (Math.random() - 0.5) * 0.4;
            pos[i+2] = origin.z + (Math.random() - 0.5) * 0.4;
        }
        this._snapGeo.attributes.position.needsUpdate = true;
        this._snapParticles.material.opacity = 1.0;
        this._snapParticles.visible = true;
        this._snapActive = true;
    }

    // ── CONSTELLATION ─────────────────────────────────────────────────────────
    _buildConstellation() {
        // 21 landmarks × 20 pairs max = 210 pairs
        const maxPairs = 210;
        const posArr = new Float32Array(maxPairs * 2 * 3);
        this._constGeo = new THREE.BufferGeometry();
        this._constGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        const mat = new THREE.LineBasicMaterial({
            color: 0x00ffaa,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this._constLines = new THREE.LineSegments(this._constGeo, mat);
        this._constLines.visible = false;
        this._scene.add(this._constLines);
    }

    _updateConstellation(handsResults, cam) {
        if (!handsResults || !handsResults.multiHandLandmarks) return;
        const pos = this._constGeo.attributes.position.array;
        let ptr = 0;

        for (const lms of handsResults.multiHandLandmarks) {
            const pts = lms.map(lm => this._lm2w(lm, cam));
            for (let a = 0; a < pts.length; a++) {
                for (let b = a + 1; b < pts.length; b++) {
                    if (ptr + 6 > pos.length) break;
                    pos[ptr++] = pts[a].x; pos[ptr++] = pts[a].y; pos[ptr++] = pts[a].z;
                    pos[ptr++] = pts[b].x; pos[ptr++] = pts[b].y; pos[ptr++] = pts[b].z;
                }
            }
        }

        this._constGeo.setDrawRange(0, ptr / 3);
        this._constGeo.attributes.position.needsUpdate = true;
    }

    // ── FLOW ──────────────────────────────────────────────────────────────────
    _buildFlow() {
        for (let f = 0; f < 10; f++) { // 5 tips × 2 hands
            const arr = new Float32Array(42 * 3);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            const mat = new THREE.PointsMaterial({
                color: f % 2 === 0 ? 0x00ffcc : 0xff00cc,
                size: 0.06,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const pts = new THREE.Points(geo, mat);
            pts.visible = false;
            this._scene.add(pts);
            this._flowPoints.push({ pts, geo, trail: [], lastPos: null });
        }
    }

    _updateFlow(handsResults, cam) {
        if (!handsResults || !handsResults.multiHandLandmarks) return;

        let fi = 0;
        for (const lms of handsResults.multiHandLandmarks) {
            for (const tipIdx of FINGER_TIPS) {
                if (fi >= this._flowPoints.length) break;
                const fp = this._flowPoints[fi++];
                const lm = lms[tipIdx];
                if (!lm) continue;

                const wp = this._lm2w(lm, cam);

                // Compute velocity for delay
                let vel = 0;
                if (fp.lastPos) vel = fp.lastPos.distanceTo(wp);
                fp.lastPos = wp.clone();

                // Append to trail
                fp.trail.unshift(wp.clone());
                if (fp.trail.length > 42) fp.trail.pop();

                // Write to buffer
                const arr = fp.geo.attributes.position.array;
                fp.trail.forEach((p, i) => {
                    arr[i * 3]     = p.x;
                    arr[i * 3 + 1] = p.y;
                    arr[i * 3 + 2] = p.z;
                });
                fp.geo.setDrawRange(0, fp.trail.length);
                fp.geo.attributes.position.needsUpdate = true;
                fp.pts.visible = true;

                // Modulate delay
                if (this._delayNode) {
                    const delayTime = Math.min(0.9, vel * 6);
                    this._delayNode.delayTime.setTargetAtTime(delayTime, this._ctx.currentTime, 0.05);
                }
            }
        }
    }

    // ── Audio ─────────────────────────────────────────────────────────────────
    _buildAudio() {
        const ctx = this._ctx;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0;
        this._masterGain.connect(ctx.destination);

        // CORE: tonal cable hum filter
        this._tcFilter = ctx.createBiquadFilter();
        this._tcFilter.type = 'bandpass';
        this._tcFilter.frequency.value = 220;
        this._tcFilter.Q.value = 8;
        this._tcFilter.connect(this._masterGain);

        // CONSTELLATION: WaveShaper distortion
        this._wsNode = ctx.createWaveShaper();
        this._wsNode.curve = this._distCurve(200);
        this._wsNode.oversample = '4x';
        this._wsNode.connect(this._masterGain);

        // FLOW: granular delay
        this._delayNode    = ctx.createDelay(1.0);
        this._feedbackGain = ctx.createGain();
        this._feedbackGain.gain.value = 0.4;
        this._delayNode.connect(this._feedbackGain);
        this._feedbackGain.connect(this._delayNode);
        this._delayNode.connect(this._masterGain);
    }

    _playSnap() {
        const ctx = this._ctx;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.15);
        env.gain.setValueAtTime(0.5, ctx.currentTime);
        env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(env);
        env.connect(this._tcFilter);
        osc.start(); osc.stop(ctx.currentTime + 0.2);
    }

    // ── Mode switching ────────────────────────────────────────────────────────
    setMode(mode) {
        this._mode = mode;
        this._setModeVisibility();
    }

    _setModeVisibility() {
        const core  = this._mode === 'CORE';
        const const_ = this._mode === 'CONSTELLATION';
        const flow  = this._mode === 'FLOW';

        this._coreMeshes.forEach(m => { m.visible = core && this._active; });
        if (this._snapParticles) this._snapParticles.visible = false;
        if (this._constLines) this._constLines.visible = const_ && this._active;
        this._flowPoints.forEach(fp => { fp.pts.visible = false; });
    }

    activate() {
        this._active = true;
        this._setModeVisibility();
        if (this._masterGain) this._masterGain.gain.setTargetAtTime(0.7, this._ctx.currentTime, 0.2);
    }

    deactivate() {
        this._active = false;
        this._coreMeshes.forEach(m => { m.visible = false; });
        if (this._snapParticles) this._snapParticles.visible = false;
        if (this._constLines) this._constLines.visible = false;
        this._flowPoints.forEach(fp => { fp.pts.visible = false; fp.trail = []; });
        if (this._masterGain) this._masterGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
    }

    update(handsResults, t, cam) {
        if (!this._active) return;

        // Pass current time to scene for snap burst timer
        this._scene.userData._t = t;

        if (this._mode === 'CORE') {
            this._updateCore(handsResults, cam, t);
        } else if (this._mode === 'CONSTELLATION') {
            this._updateConstellation(handsResults, cam);
        } else if (this._mode === 'FLOW') {
            this._updateFlow(handsResults, cam);
        }
    }
}
