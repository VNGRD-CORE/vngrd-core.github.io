// TetherVerlet — Plasma String Synthesizer
//
// CORE = PLASMA STRING: stretch between both wrists → pitch + cinematic drone
//   Distance between hands → pitch (close=low, far=high)
//   Left hand height → filter sweep
//   Sharp pull-apart → pluck trigger
//
// CONSTELLATION = NEURAL WEB: all finger landmarks connected, crossing lines trigger glitch
//
// FLOW = THEREMIN: right hand X=pitch, Y=volume; left hand X=filter, Y=delay
//
// NO TubeGeometry creation per frame — uses Line with position updates (performant)

export class TetherVerlet {
    constructor(scene, audioCtx, THREE) {
        this._scene  = scene;
        this._ctx    = audioCtx;
        this._T      = THREE;
        this._mode   = 'CORE';
        this._active = false;

        // CORE string visuals — 3 parallel plasma lines
        this._stringLines  = [];
        this._stringGeos   = [];
        this._STRING_PTS   = 48; // points per line

        // CONSTELLATION
        this._constGeo   = null;
        this._constLines = null;

        // FLOW trail
        this._flowTrails = [];

        // Audio nodes
        this._masterGain = null;
        this._oscA = null;    // sawtooth carrier
        this._oscB = null;    // detune
        this._filter = null;  // moog-style lowpass
        this._delayNode = null;
        this._fbGain = null;
        this._reverbGain = null;
        this._dryGain = null;

        // State
        this._prevDist   = -1;
        this._pluckCool  = 0;
        this._targetFreq = 110;
        this._currentFreq = 110;
        this._handVisible = false;
    }

    async init() {
        this._buildCoreLines();
        this._buildConstellation();
        this._buildFlowTrails();
        this._buildAudio();
        this._setVis();
    }

    // ── World helpers ──────────────────────────────────────────────────────────
    _lm2w(lm, cam) {
        const T = this._T;
        const ndc = new T.Vector3(-(lm.x*2-1), -(lm.y*2-1), 0.5);
        ndc.unproject(cam);
        const dir  = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    // Map distance (world units) to frequency
    _distToFreq(worldDist) {
        // 0..6 world units → 55 Hz (A1) to 880 Hz (A5), logarithmic
        const t = Math.max(0, Math.min(1, worldDist / 6.0));
        return 55 * Math.pow(16, t); // 55 × 16^t = 55 at t=0, 880 at t=1
    }

    // ── CORE plasma string lines ──────────────────────────────────────────────
    _buildCoreLines() {
        const T = this._T;
        const colors   = [0x00ffcc, 0xff00cc, 0x00aaff];
        const offsets  = [0, 0.06, -0.06]; // vertical offset per line

        for (let li = 0; li < 3; li++) {
            const pts = new Float32Array(this._STRING_PTS * 3);
            const geo = new T.BufferGeometry();
            geo.setAttribute('position', new T.BufferAttribute(pts, 3));
            const mat = new T.LineBasicMaterial({
                color: new T.Color(colors[li]),
                transparent: true,
                opacity: li === 0 ? 0.9 : 0.4,
                blending: T.AdditiveBlending,
                depthWrite: false
            });
            const line = new T.Line(geo, mat);
            line.visible = false;
            this._scene.add(line);
            this._stringLines.push(line);
            this._stringGeos.push(geo);
            this._lineOffsets = offsets;
        }
    }

    _updateStringLine(lineIdx, from, to, sag, t) {
        const T = this._T;
        const pos  = this._stringGeos[lineIdx].attributes.position.array;
        const n    = this._STRING_PTS;
        const yOff = this._lineOffsets[lineIdx];

        for (let i = 0; i < n; i++) {
            const u  = i / (n - 1);
            // Catenary-like sag in the middle
            const sagY = Math.sin(u * Math.PI) * sag;
            // Slight lateral wave for plasma effect
            const wave = Math.sin(u * Math.PI * 4 + t * 3) * 0.04 * (1 - lineIdx * 0.3);

            pos[i*3]   = from.x + (to.x - from.x) * u + wave;
            pos[i*3+1] = from.y + (to.y - from.y) * u - sagY + yOff;
            pos[i*3+2] = from.z + (to.z - from.z) * u;
        }
        this._stringGeos[lineIdx].attributes.position.needsUpdate = true;
    }

    _updateCore(hr, cam, t) {
        const T = this._T;
        if (!hr || !hr.multiHandLandmarks || hr.multiHandLandmarks.length < 2) {
            // One hand or none → fade string, silence
            this._stringLines.forEach(l => { l.visible = false; });
            if (this._handVisible) {
                this._handVisible = false;
                this._oscA && this._oscA.gain && this._oscA.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
                this._oscB && this._oscB.gain && this._oscB.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
            }
            return;
        }

        // Use wrist (0) of each hand
        const lm0 = hr.multiHandLandmarks[0][0]; // wrist hand 0
        const lm1 = hr.multiHandLandmarks[1][0]; // wrist hand 1

        const from = this._lm2w(lm0, cam);
        const to   = this._lm2w(lm1, cam);
        const dist = from.distanceTo(to);

        // Sag based on distance
        const sag = Math.max(0.05, 0.6 - dist * 0.1);

        this._stringLines.forEach((line, li) => {
            line.visible = true;
            this._updateStringLine(li, from, to, sag, t);
        });

        // Pitch from distance
        this._targetFreq = this._distToFreq(dist);
        this._currentFreq = this._currentFreq + (this._targetFreq - this._currentFreq) * 0.06;

        if (this._oscA) this._oscA.frequency.setTargetAtTime(this._currentFreq, this._ctx.currentTime, 0.02);
        if (this._oscB) this._oscB.frequency.setTargetAtTime(this._currentFreq * 1.005, this._ctx.currentTime, 0.02);

        // Filter from left hand height (wrist Y)
        const leftWristY = hr.multiHandLandmarks[0][0].y;
        const filterFreq = 80 + (1 - leftWristY) * 2400;
        if (this._filter) this._filter.frequency.setTargetAtTime(filterFreq, this._ctx.currentTime, 0.04);

        // Pluck: velocity spike = distance change > 0.3
        const now = performance.now();
        if (this._prevDist >= 0) {
            const vel = Math.abs(dist - this._prevDist);
            if (vel > 0.28 && now > this._pluckCool) {
                this._pluckCool = now + 300;
                this._triggerPluck(this._currentFreq);
            }
        }
        this._prevDist = dist;

        // Bring oscillators up when hands visible
        if (!this._handVisible) {
            this._handVisible = true;
            this._oscAGain && this._oscAGain.gain.setTargetAtTime(0.22, this._ctx.currentTime, 0.2);
            this._oscBGain && this._oscBGain.gain.setTargetAtTime(0.18, this._ctx.currentTime, 0.2);
        }
    }

    _triggerPluck(freq) {
        const ctx = this._ctx, now = ctx.currentTime;
        // Short metallic pluck attack over the drone
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 2, now);
        osc.frequency.exponentialRampToValueAtTime(freq, now + 0.08);
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.5, now + 0.003);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(env); env.connect(this._filter);
        osc.start(now); osc.stop(now + 0.6);

        // Boost string brightness
        this._stringLines[0].material.opacity = 1.5;
    }

    // ── CONSTELLATION ─────────────────────────────────────────────────────────
    _buildConstellation() {
        const T = this._T;
        const maxPairs = 210;
        const pos = new Float32Array(maxPairs * 2 * 3);
        this._constGeo = new T.BufferGeometry();
        this._constGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
        this._constLines = new T.LineSegments(this._constGeo, new T.LineBasicMaterial({
            color: 0x00ffaa, transparent: true, opacity: 0.6,
            blending: T.AdditiveBlending, depthWrite: false
        }));
        this._constLines.visible = false;
        this._scene.add(this._constLines);
    }

    _updateConstellation(hr, cam) {
        if (!hr || !hr.multiHandLandmarks) return;
        const pos = this._constGeo.attributes.position.array;
        let ptr = 0;
        for (const lms of hr.multiHandLandmarks) {
            const pts = lms.map(lm => this._lm2w(lm, cam));
            for (let a = 0; a < pts.length; a++) {
                for (let b = a + 1; b < pts.length; b++) {
                    if (ptr + 6 > pos.length) break;
                    pos[ptr++]=pts[a].x; pos[ptr++]=pts[a].y; pos[ptr++]=pts[a].z;
                    pos[ptr++]=pts[b].x; pos[ptr++]=pts[b].y; pos[ptr++]=pts[b].z;
                }
            }
        }
        this._constGeo.setDrawRange(0, ptr / 3);
        this._constGeo.attributes.position.needsUpdate = true;

        // Modulate delay time from hand spread
        if (hr.multiHandLandmarks.length > 0) {
            const lms = hr.multiHandLandmarks[0];
            const spread = Math.hypot(lms[8].x - lms[20].x, lms[8].y - lms[20].y);
            if (this._delayNode) this._delayNode.delayTime.setTargetAtTime(
                Math.min(0.8, spread * 2), this._ctx.currentTime, 0.05
            );
        }
    }

    // ── FLOW theremin ─────────────────────────────────────────────────────────
    _buildFlowTrails() {
        // Two particle trails for right/left hand
        const T = this._T;
        for (let i = 0; i < 2; i++) {
            const arr = new Float32Array(60 * 3);
            const geo = new T.BufferGeometry();
            geo.setAttribute('position', new T.BufferAttribute(arr, 3));
            const pts = new T.Points(geo, new T.PointsMaterial({
                color: i === 0 ? 0x00ffcc : 0xff00cc,
                size: 0.08, transparent: true, opacity: 0.85,
                blending: T.AdditiveBlending, depthWrite: false
            }));
            pts.visible = false;
            this._scene.add(pts);
            this._flowTrails.push({ pts, geo, trail: [], lastPos: null });
        }
    }

    _updateFlow(hr, cam) {
        if (!hr || !hr.multiHandLandmarks) return;

        hr.multiHandLandmarks.forEach((lms, hi) => {
            if (hi >= 2) return;
            const fp = this._flowTrails[hi];
            const wrist = lms[0];
            if (!wrist) return;

            const wp = this._lm2w(wrist, cam);
            fp.trail.unshift(wp.clone());
            if (fp.trail.length > 60) fp.trail.pop();

            const arr = fp.geo.attributes.position.array;
            fp.trail.forEach((p, i) => {
                arr[i*3]=p.x; arr[i*3+1]=p.y; arr[i*3+2]=p.z;
            });
            fp.geo.setDrawRange(0, fp.trail.length);
            fp.geo.attributes.position.needsUpdate = true;
            fp.pts.visible = true;

            if (hi === 0) {
                // Right hand: X → pitch, Y → volume
                const pitchFreq = 55 * Math.pow(16, wrist.x);
                if (this._oscA) this._oscA.frequency.setTargetAtTime(pitchFreq, this._ctx.currentTime, 0.01);
                const vol = 1 - wrist.y;
                if (this._oscAGain) this._oscAGain.gain.setTargetAtTime(vol * 0.3, this._ctx.currentTime, 0.03);
            } else {
                // Left hand: X → filter, Y → delay
                const fc = 80 + wrist.x * 3000;
                if (this._filter) this._filter.frequency.setTargetAtTime(fc, this._ctx.currentTime, 0.04);
                const dly = wrist.y * 0.7;
                if (this._delayNode) this._delayNode.delayTime.setTargetAtTime(dly, this._ctx.currentTime, 0.05);
            }
        });
    }

    // ── Audio ─────────────────────────────────────────────────────────────────
    _buildAudio() {
        const ctx = this._ctx;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0;
        this._masterGain.connect(ctx.destination);

        // Resonant lowpass filter (LP ladder-style via Q)
        this._filter = ctx.createBiquadFilter();
        this._filter.type = 'lowpass';
        this._filter.frequency.value = 300;
        this._filter.Q.value = 6;  // resonance for cinematic sweep
        this._filter.connect(this._masterGain);

        // Oscillator A (sawtooth drone)
        const oscA = ctx.createOscillator();
        oscA.type = 'sawtooth';
        oscA.frequency.value = 110;
        const gainA = ctx.createGain();
        gainA.gain.value = 0; // silent until hands appear
        oscA.connect(gainA); gainA.connect(this._filter);
        oscA.start();
        this._oscA = oscA; this._oscAGain = gainA;

        // Oscillator B (detuned for thickness)
        const oscB = ctx.createOscillator();
        oscB.type = 'sawtooth';
        oscB.frequency.value = 110.6;
        const gainB = ctx.createGain();
        gainB.gain.value = 0;
        oscB.connect(gainB); gainB.connect(this._filter);
        oscB.start();
        this._oscB = oscB; this._oscBGain = gainB;

        // Sub oscillator (octave down)
        const oscSub = ctx.createOscillator();
        oscSub.type = 'sine';
        oscSub.frequency.value = 55;
        const gainSub = ctx.createGain();
        gainSub.gain.value = 0;
        oscSub.connect(gainSub); gainSub.connect(this._masterGain);
        oscSub.start();
        this._oscSub = oscSub; this._oscSubGain = gainSub;

        // Delay + feedback for space
        this._delayNode = ctx.createDelay(1.0);
        this._fbGain    = ctx.createGain();
        this._fbGain.gain.value = 0.35;
        this._filter.connect(this._delayNode);
        this._delayNode.connect(this._fbGain);
        this._fbGain.connect(this._delayNode);
        this._delayNode.connect(this._masterGain);
    }

    // ── Mode switching ─────────────────────────────────────────────────────────
    setMode(mode) {
        this._mode = mode;
        this._setVis();
        // Reset hand visibility state when switching
        this._handVisible = false;
        this._prevDist = -1;
        if (this._oscAGain) this._oscAGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        if (this._oscBGain) this._oscBGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
    }

    _setVis() {
        const core  = this._mode === 'CORE' && this._active;
        const cnst  = this._mode === 'CONSTELLATION' && this._active;
        this._stringLines.forEach(l => { l.visible = false; }); // shown dynamically
        if (this._constLines) this._constLines.visible = cnst;
        this._flowTrails.forEach(f => { f.pts.visible = false; f.trail = []; });
        if (!core) {
            this._stringLines.forEach(l => { l.visible = false; });
        }
    }

    activate() {
        this._active = true;
        this._setVis();
        if (this._masterGain) this._masterGain.gain.setTargetAtTime(0.75, this._ctx.currentTime, 0.2);
        if (this._oscSubGain) this._oscSubGain.gain.setTargetAtTime(0.12, this._ctx.currentTime, 0.3);
    }

    deactivate() {
        this._active = false;
        this._stringLines.forEach(l => { l.visible = false; });
        if (this._constLines) this._constLines.visible = false;
        this._flowTrails.forEach(f => { f.pts.visible = false; f.trail = []; });
        if (this._masterGain) this._masterGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.15);
        if (this._oscAGain)   this._oscAGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        if (this._oscBGain)   this._oscBGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        if (this._oscSubGain) this._oscSubGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        this._handVisible = false;
        this._prevDist = -1;
    }

    update(hr, t, cam) {
        if (!this._active) return;

        // Pulse the string opacity to the drone
        if (this._stringLines[0].visible && this._mode === 'CORE') {
            const pulse = 0.7 + Math.sin(t * this._currentFreq * 0.05) * 0.2;
            this._stringLines[0].material.opacity = Math.min(this._stringLines[0].material.opacity * 0.95 + pulse * 0.05, 1.2);
        }

        if (this._mode === 'CORE')           this._updateCore(hr, cam, t);
        else if (this._mode === 'CONSTELLATION') this._updateConstellation(hr, cam);
        else if (this._mode === 'FLOW')      this._updateFlow(hr, cam);
    }
}
