// TetherVerlet — Plasma String Synthesizer  (visual & audio upgrade)
//
// CORE        — stretch between BOTH WRISTS → cinematic drone
//               Distance → pitch (log 55–880 Hz)
//               Left wrist height → filter sweep
//               Sharp pull → metallic pluck
//
// CONSTELLATION — neural web: ALL finger landmarks interconnected
//               Hand spread → delay time
//
// FLOW        — single-hand theremin
//               Right X → pitch  |  Right Y → volume
//               Left  X → filter |  Left  Y → delay
//
// Visuals: layered additive-blend Lines for neon-glow plasma effect
// Audio  : detuned sawtooth drone + sub + resonant filter + delay/reverb

export class TetherVerlet {
    constructor(scene, audioCtx, THREE, masterDest) {
        this._scene      = scene;
        this._ctx        = audioCtx;
        this._T          = THREE;
        this._masterDest = masterDest;
        this._mode       = 'CORE';
        this._active     = false;

        // string geometry
        this._STRING_PTS = 120;
        this._coreLines  = [];   // [{line, geo}]  — layered plasma
        this._midLight   = null; // PointLight at string midpoint
        this._anchorLights = []; // PointLights at wrist anchors

        // constellation
        this._constGeo   = null;
        this._constLines = null;
        this._constTips  = null;  // Points — finger tips highlight

        // flow trails
        this._flowTrails = [];

        // audio
        this._oscA = null; this._oscAGain = null;
        this._oscB = null; this._oscBGain = null;
        this._oscSub = null; this._oscSubGain = null;
        this._filter     = null;
        this._delayNode  = null;
        this._fbGain     = null;
        this._masterGain = null;

        // state
        this._prevDist    = -1;
        this._pluckCool   = 0;
        this._targetFreq  = 110;
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

    // ── coordinate helper ────────────────────────────────────────────────────
    _lm2w(lm, cam) {
        const T   = this._T;
        const ndc = new T.Vector3(-(lm.x * 2 - 1), -(lm.y * 2 - 1), 0.5);
        ndc.unproject(cam);
        const dir  = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    _distToFreq(d) {
        return 55 * Math.pow(16, Math.max(0, Math.min(1, d / 6.0)));
    }

    // ── CORE plasma string ───────────────────────────────────────────────────
    _buildCoreLines() {
        const T = this._T;

        // Layer definitions: [color, opacity, yOffset, waveAmp, waveFreqMult]
        const layers = [
            { c: 0xffffff, o: 0.95, yo: 0.00, wa: 0.022, wf: 1.0 },  // core white
            { c: 0x00f3ff, o: 0.70, yo: 0.00, wa: 0.035, wf: 1.5 },  // cyan glow
            { c: 0xff00cc, o: 0.55, yo: 0.00, wa: 0.048, wf: 2.0 },  // magenta glow
            { c: 0x00f3ff, o: 0.30, yo: 0.08, wa: 0.018, wf: 0.8 },  // cyan offset top
            { c: 0xff00cc, o: 0.30, yo:-0.08, wa: 0.018, wf: 0.8 },  // magenta offset bot
            { c: 0xffffff, o: 0.12, yo: 0.00, wa: 0.065, wf: 3.0 },  // outer haze
        ];

        for (const layer of layers) {
            const arr = new Float32Array(this._STRING_PTS * 3);
            const geo = new T.BufferGeometry();
            geo.setAttribute('position', new T.BufferAttribute(arr, 3));
            const mat = new T.LineBasicMaterial({
                color:       new T.Color(layer.c),
                transparent: true,
                opacity:     layer.o,
                blending:    T.AdditiveBlending,
                depthWrite:  false,
            });
            const line = new T.Line(geo, mat);
            line.visible = false;
            line.renderOrder = 2;
            this._scene.add(line);
            this._coreLines.push({ line, geo, ...layer });
        }

        // Mid-point tension light
        this._midLight = new T.PointLight(0x00f3ff, 0, 8);
        this._midLight.renderOrder = 1;
        this._scene.add(this._midLight);

        // Anchor lights (one per wrist)
        for (let i = 0; i < 2; i++) {
            const l = new T.PointLight(i === 0 ? 0x00f3ff : 0xff00cc, 0, 3);
            this._scene.add(l);
            this._anchorLights.push(l);
        }
    }

    _updateCoreLines(from, to, sag, freq, t) {
        const n = this._STRING_PTS;
        // Map freq 55-880 → hue 0.6 (cyan) to 0.85 (magenta)
        const fNorm   = Math.log2(freq / 55) / Math.log2(16);
        const hue     = 0.60 - fNorm * 0.25;

        this._coreLines.forEach(layer => {
            const pos = layer.geo.attributes.position.array;
            for (let i = 0; i < n; i++) {
                const u    = i / (n - 1);
                const sagY = Math.sin(u * Math.PI) * sag;
                const wave = Math.sin(u * Math.PI * 4 * layer.wf + t * 4) * layer.wa;
                pos[i*3]   = from.x + (to.x - from.x) * u + wave * 0.3;
                pos[i*3+1] = from.y + (to.y - from.y) * u - sagY + layer.yo + wave;
                pos[i*3+2] = from.z + (to.z - from.z) * u;
            }
            layer.geo.attributes.position.needsUpdate = true;
            layer.line.visible = true;

            // Shift inner layers' colour toward frequency hue
            if (layer.o > 0.4) {
                layer.line.material.color.setHSL(hue, 1.0, 0.75);
            }
        });

        // Midpoint light pulses with frequency
        const mid = new this._T.Vector3(
            (from.x + to.x) / 2,
            (from.y + to.y) / 2,
            (from.z + to.z) / 2,
        );
        this._midLight.position.copy(mid);
        this._midLight.color.setHSL(hue, 1.0, 0.6);
        this._midLight.intensity = 1.5 + Math.sin(t * freq * 0.04) * 0.8;
        this._midLight.distance  = 4 + fNorm * 4;

        // Anchor lights
        this._anchorLights[0].position.copy(from);
        this._anchorLights[0].intensity = 1.2 + fNorm * 2;
        this._anchorLights[1].position.copy(to);
        this._anchorLights[1].intensity = 1.2 + fNorm * 2;
    }

    _updateCore(hr, cam, t) {
        if (!hr?.multiHandLandmarks || hr.multiHandLandmarks.length < 2) {
            this._coreLines.forEach(l => { l.line.visible = false; });
            this._midLight.intensity = 0;
            this._anchorLights.forEach(l => { l.intensity = 0; });
            if (this._handVisible) {
                this._handVisible = false;
                this._oscAGain?.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
                this._oscBGain?.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
            }
            return;
        }

        const from = this._lm2w(hr.multiHandLandmarks[0][0], cam);
        const to   = this._lm2w(hr.multiHandLandmarks[1][0], cam);
        const dist = from.distanceTo(to);
        const sag  = Math.max(0.04, 0.55 - dist * 0.08);

        this._targetFreq  = this._distToFreq(dist);
        this._currentFreq = this._currentFreq + (this._targetFreq - this._currentFreq) * 0.06;

        this._updateCoreLines(from, to, sag, this._currentFreq, t);

        // Audio
        this._oscA?.frequency.setTargetAtTime(this._currentFreq, this._ctx.currentTime, 0.02);
        this._oscB?.frequency.setTargetAtTime(this._currentFreq * 1.005, this._ctx.currentTime, 0.02);

        // Filter from left wrist height
        const filterFreq = 80 + (1 - hr.multiHandLandmarks[0][0].y) * 2400;
        this._filter?.frequency.setTargetAtTime(filterFreq, this._ctx.currentTime, 0.04);

        // Pluck on sharp movement
        const now = performance.now();
        if (this._prevDist >= 0 && Math.abs(dist - this._prevDist) > 0.28 && now > this._pluckCool) {
            this._pluckCool = now + 300;
            this._triggerPluck(this._currentFreq);
        }
        this._prevDist = dist;

        if (!this._handVisible) {
            this._handVisible = true;
            this._oscAGain?.gain.setTargetAtTime(0.22, this._ctx.currentTime, 0.2);
            this._oscBGain?.gain.setTargetAtTime(0.18, this._ctx.currentTime, 0.2);
        }
    }

    _triggerPluck(freq) {
        const ctx = this._ctx, now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 2, now);
        osc.frequency.exponentialRampToValueAtTime(freq, now + 0.08);
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.5, now + 0.003);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(env);
        env.connect(this._filter);
        osc.start(now);
        osc.stop(now + 0.6);
        // Flash the core line
        this._coreLines[0]?.line.material && (this._coreLines[0].line.material.opacity = 1.5);
    }

    // ── CONSTELLATION ─────────────────────────────────────────────────────────
    _buildConstellation() {
        const T = this._T;

        // Connection lines (all landmark pairs)
        const maxPairs = 210 * 2;  // 2 hands
        const pos = new Float32Array(maxPairs * 2 * 3);
        this._constGeo = new T.BufferGeometry();
        this._constGeo.setAttribute('position', new T.BufferAttribute(pos, 3));

        // Two layers: cyan tight + magenta haze
        const layerDefs = [
            { c: 0x00ffcc, o: 0.55 },
            { c: 0xff00cc, o: 0.22 },
        ];
        this._constLayerGeos = [this._constGeo];
        this._constLayerLines = [];
        for (const def of layerDefs) {
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.BufferAttribute(new Float32Array(maxPairs * 2 * 3), 3));
            const l = new T.LineSegments(g, new T.LineBasicMaterial({
                color: new T.Color(def.c), transparent: true, opacity: def.o,
                blending: T.AdditiveBlending, depthWrite: false,
            }));
            l.visible = false;
            l.renderOrder = 2;
            this._scene.add(l);
            this._constLayerLines.push({ line: l, geo: g });
        }

        // Fingertip glow points
        const tipPts = new Float32Array(10 * 3);
        const tipGeo = new T.BufferGeometry();
        tipGeo.setAttribute('position', new T.BufferAttribute(tipPts, 3));
        this._constTips = new T.Points(tipGeo, new T.PointsMaterial({
            color: 0xffffff, size: 0.18,
            transparent: true, opacity: 0.9,
            blending: T.AdditiveBlending, depthWrite: false,
        }));
        this._constTips.visible = false;
        this._constTips.renderOrder = 3;
        this._scene.add(this._constTips);
        this._constTipsGeo = tipGeo;
    }

    _updateConstellation(hr, cam, t) {
        if (!hr?.multiHandLandmarks) return;

        const FINGERTIPS = [4, 8, 12, 16, 20];
        const allPts = [];
        const tipPts = [];

        for (const lms of hr.multiHandLandmarks) {
            const pts = lms.map(lm => this._lm2w(lm, cam));
            allPts.push(pts);
            FINGERTIPS.forEach(fi => tipPts.push(pts[fi]));
        }

        // Build segment pairs
        const pairs = [];
        for (const pts of allPts) {
            for (let a = 0; a < pts.length; a++) {
                for (let b = a + 1; b < pts.length; b++) {
                    pairs.push([pts[a], pts[b]]);
                }
            }
        }

        // Write both layers (same topology, different colours)
        for (const { line, geo } of this._constLayerLines) {
            const pos = geo.attributes.position.array;
            let ptr = 0;
            for (const [A, B] of pairs) {
                if (ptr + 6 > pos.length) break;
                pos[ptr++]=A.x; pos[ptr++]=A.y; pos[ptr++]=A.z;
                pos[ptr++]=B.x; pos[ptr++]=B.y; pos[ptr++]=B.z;
            }
            geo.setDrawRange(0, ptr / 3);
            geo.attributes.position.needsUpdate = true;
            line.visible = true;

            // Pulse opacity
            line.material.opacity = line.material.opacity * 0.9 + (0.3 + Math.sin(t * 2) * 0.15) * 0.1;
        }

        // Update fingertip points
        const ta = this._constTipsGeo.attributes.position.array;
        tipPts.slice(0, 10).forEach((p, i) => {
            ta[i*3]=p.x; ta[i*3+1]=p.y; ta[i*3+2]=p.z;
        });
        this._constTipsGeo.setDrawRange(0, tipPts.length);
        this._constTipsGeo.attributes.position.needsUpdate = true;
        this._constTips.visible = true;

        // Delay from hand spread
        if (hr.multiHandLandmarks[0]) {
            const lms    = hr.multiHandLandmarks[0];
            const spread = Math.hypot(lms[8].x - lms[20].x, lms[8].y - lms[20].y);
            this._delayNode?.delayTime.setTargetAtTime(Math.min(0.8, spread * 2), this._ctx.currentTime, 0.05);
        }
    }

    // ── FLOW theremin ─────────────────────────────────────────────────────────
    _buildFlowTrails() {
        const T = this._T;
        const TRAIL = 80;
        const colors = [0x00f3ff, 0xff00cc];
        for (let i = 0; i < 2; i++) {
            // Two trail layers per hand
            const layers = [];
            for (let li = 0; li < 2; li++) {
                const arr = new Float32Array(TRAIL * 3);
                const geo = new T.BufferGeometry();
                geo.setAttribute('position', new T.BufferAttribute(arr, 3));
                const pts = new T.Points(geo, new T.PointsMaterial({
                    color: new T.Color(colors[i]),
                    size: li === 0 ? 0.10 : 0.04,
                    transparent: true, opacity: li === 0 ? 0.85 : 0.4,
                    blending: T.AdditiveBlending, depthWrite: false,
                }));
                pts.visible = false;
                pts.renderOrder = 2;
                this._scene.add(pts);
                layers.push({ pts, geo });
            }
            this._flowTrails.push({ layers, trail: [] });
        }
    }

    _updateFlow(hr, cam) {
        if (!hr?.multiHandLandmarks) return;
        const TRAIL = 80;

        hr.multiHandLandmarks.forEach((lms, hi) => {
            if (hi >= 2) return;
            const ft    = this._flowTrails[hi];
            const wrist = lms[0];
            if (!wrist) return;

            const wp = this._lm2w(wrist, cam);
            ft.trail.unshift(wp.clone());
            if (ft.trail.length > TRAIL) ft.trail.pop();

            for (const { pts, geo } of ft.layers) {
                const arr = geo.attributes.position.array;
                ft.trail.forEach((p, i) => { arr[i*3]=p.x; arr[i*3+1]=p.y; arr[i*3+2]=p.z; });
                geo.setDrawRange(0, ft.trail.length);
                geo.attributes.position.needsUpdate = true;
                pts.visible = true;
            }

            if (hi === 0) {
                const pitchFreq = 55 * Math.pow(16, wrist.x);
                this._oscA?.frequency.setTargetAtTime(pitchFreq, this._ctx.currentTime, 0.01);
                this._oscAGain?.gain.setTargetAtTime((1 - wrist.y) * 0.3, this._ctx.currentTime, 0.03);
            } else {
                this._filter?.frequency.setTargetAtTime(80 + wrist.x * 3000, this._ctx.currentTime, 0.04);
                this._delayNode?.delayTime.setTargetAtTime(wrist.y * 0.7, this._ctx.currentTime, 0.05);
            }
        });
    }

    // ── Audio ─────────────────────────────────────────────────────────────────
    _buildAudio() {
        const ctx = this._ctx;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0;
        this._masterGain.connect(this._masterDest || ctx.destination);

        // Resonant LP filter
        this._filter = ctx.createBiquadFilter();
        this._filter.type = 'lowpass';
        this._filter.frequency.value = 300;
        this._filter.Q.value = 6;
        this._filter.connect(this._masterGain);

        // Sawtooth drone A
        this._oscA = ctx.createOscillator(); this._oscA.type = 'sawtooth'; this._oscA.frequency.value = 110;
        this._oscAGain = ctx.createGain(); this._oscAGain.gain.value = 0;
        this._oscA.connect(this._oscAGain); this._oscAGain.connect(this._filter);
        this._oscA.start();

        // Sawtooth drone B (detuned)
        this._oscB = ctx.createOscillator(); this._oscB.type = 'sawtooth'; this._oscB.frequency.value = 110.6;
        this._oscBGain = ctx.createGain(); this._oscBGain.gain.value = 0;
        this._oscB.connect(this._oscBGain); this._oscBGain.connect(this._filter);
        this._oscB.start();

        // Sub oscillator
        this._oscSub = ctx.createOscillator(); this._oscSub.type = 'sine'; this._oscSub.frequency.value = 55;
        this._oscSubGain = ctx.createGain(); this._oscSubGain.gain.value = 0;
        this._oscSub.connect(this._oscSubGain); this._oscSubGain.connect(this._masterGain);
        this._oscSub.start();

        // Delay + feedback
        this._delayNode = ctx.createDelay(1.0);
        this._fbGain    = ctx.createGain(); this._fbGain.gain.value = 0.35;
        this._filter.connect(this._delayNode);
        this._delayNode.connect(this._fbGain);
        this._fbGain.connect(this._delayNode);
        this._delayNode.connect(this._masterGain);
    }

    // ── Mode switching ─────────────────────────────────────────────────────────
    setMode(mode) {
        this._mode = mode;
        this._handVisible = false;
        this._prevDist = -1;
        this._oscAGain?.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        this._oscBGain?.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        this._setVis();
    }

    _setVis() {
        const core = this._mode === 'CORE'          && this._active;
        const cnst = this._mode === 'CONSTELLATION' && this._active;

        this._coreLines.forEach(l => { l.line.visible = false; });
        if (this._midLight) this._midLight.intensity = 0;
        this._anchorLights.forEach(l => { l.intensity = 0; });

        this._constLayerLines?.forEach(({ line }) => { line.visible = cnst; });
        if (this._constTips) this._constTips.visible = cnst;

        this._flowTrails.forEach(ft => {
            ft.layers.forEach(({ pts }) => { pts.visible = false; });
            ft.trail = [];
        });
    }

    activate() {
        this._active = true;
        this._setVis();
        this._masterGain?.gain.setTargetAtTime(0.75, this._ctx.currentTime, 0.2);
        this._oscSubGain?.gain.setTargetAtTime(0.12, this._ctx.currentTime, 0.3);
    }

    deactivate() {
        this._active = false;
        this._setVis();
        this._midLight && (this._midLight.intensity = 0);
        this._anchorLights.forEach(l => { l.intensity = 0; });
        this._masterGain?.gain.setTargetAtTime(0, this._ctx.currentTime, 0.15);
        this._oscAGain?.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        this._oscBGain?.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        this._oscSubGain?.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
        this._handVisible = false;
        this._prevDist = -1;
    }

    update(hr, t, cam) {
        if (!this._active) return;
        if (this._mode === 'CORE')           this._updateCore(hr, cam, t);
        else if (this._mode === 'CONSTELLATION') this._updateConstellation(hr, cam, t);
        else if (this._mode === 'FLOW')      this._updateFlow(hr, cam);
    }
}
