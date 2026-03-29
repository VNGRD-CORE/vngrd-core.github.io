// KineticRack — Three.js ONLY. Zero 2D canvas context. 60fps.
// Architecture:
//   z:3499 — #kinetic-cam-video (CSS, brightness(0.35) dark cinema)
//   z:3500 — #kinetic-canvas (Three.js alpha:true, 3D skeleton INSIDE scene)
// 3D hand skeleton as LineSegments inside Three.js — NO 2D drawing, NO lag

const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
];

const HELP_TEXT = {
    CYBER_HANGDRUM: [
        'RAYCAST triggers — fingertip enters 3D hex prism',
        'Center pad (D3) — deep bass Ding',
        '8 ring pads — D Kurd scale notes',
        'All 5 fingertips active simultaneously',
        'Pads sit lower screen — natural hand position',
    ],
    NEURAL_GLITCH: [
        'PINCH (index+thumb) → Bitcrush depth',
        '  Harder pinch = more bit-destruction',
        'FIST (close all fingers) → Sub-bass hit + filter close',
        'OPEN PALM → Reverb wash flood',
        'Right wrist height → Master filter cutoff',
    ],
    TETHER_VERLET: [
        'CORE: stretch plasma string between both wrists',
        '  Distance → Pitch (55Hz–880Hz log)',
        '  Left wrist height → Filter sweep',
        '  Sharp pull-apart → Pluck trigger',
        'CONSTELLATION: landmark neural web',
        'FLOW: theremin — Right X/Y = Pitch/Vol',
    ],
};

const KineticRack = (() => {
    let T;
    let _renderer, _scene, _camera, _clock;
    let _camVideo;
    let _hands, _handsResults;
    let _raf, _active = false;
    let _instruments = {}, _currentInstr = null, _instrName = 'CYBER_HANGDRUM';

    // 3D skeleton — LineSegments per hand (max 2)
    const MAX_HANDS = 2;
    const N_CONN    = HAND_CONNECTIONS.length;
    let _skelLines  = [];
    let _skelGeos   = [];

    // MIDI
    let _midi = null;
    let _midiLearnTarget = null;
    let _ctrlBindings = {};

    // Recording
    let _recorder  = null;
    let _recChunks = [];
    let _recDest   = null;

    function _status(msg, live) {
        const el = document.getElementById('kr-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('kr-live', !!live);
    }

    async function _loadDeps() {
        _status('LOADING THREE.JS...');
        T = await import('three');
    }

    function _stageSize() {
        return { W: window.innerWidth - 400, H: window.innerHeight - 100 };
    }

    // ── Renderer (alpha:true, no bloom, no background plane) ──────────────────
    function _setup() {
        const canvas = document.getElementById('kinetic-canvas');
        const { W, H } = _stageSize();
        _renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _renderer.setSize(W, H);
        _renderer.setClearColor(0x000000, 0);
        _renderer.outputColorSpace = T.SRGBColorSpace;
        _renderer.toneMapping = T.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.2;

        _camera = new T.PerspectiveCamera(60, W / H, 0.1, 200);
        _camera.position.set(0, 0, 5);
        _scene = new T.Scene();
        _scene.background = null;
        _clock = new T.Clock();

        window.addEventListener('resize', () => {
            const { W: w, H: h } = _stageSize();
            _renderer.setSize(w, h);
            _camera.aspect = w / h;
            _camera.updateProjectionMatrix();
        });
    }

    // ── 3D Hand Skeleton (inside Three.js, NOT 2D canvas) ─────────────────────
    function _buildSkeleton3D() {
        const HAND_COLORS = [0x00f3ff, 0xff00cc];
        for (let h = 0; h < MAX_HANDS; h++) {
            const pos = new Float32Array(N_CONN * 2 * 3);
            const geo = new T.BufferGeometry();
            geo.setAttribute('position', new T.BufferAttribute(pos, 3));
            const mat = new T.LineBasicMaterial({
                color:       HAND_COLORS[h],
                transparent: true,
                opacity:     0.88,
                blending:    T.AdditiveBlending,
                depthWrite:  false,
                depthTest:   false   // always visible through any geometry
            });
            const lines = new T.LineSegments(geo, mat);
            lines.renderOrder = 999;
            lines.visible = false;
            _scene.add(lines);
            _skelLines.push(lines);
            _skelGeos.push(geo);
        }
    }

    // MediaPipe [0,1] + depth → Three.js world coordinates (camera-space unproject)
    function _lm2world(lm) {
        const ndcX  = -(lm.x * 2 - 1);   // mirror X for webcam
        const ndcY  = -(lm.y * 2 - 1);
        const depthZ = (lm.z || 0) * -4;  // MediaPipe z → world depth

        const ndc = new T.Vector3(ndcX, ndcY, 0.5);
        ndc.unproject(_camera);
        const dir = ndc.sub(_camera.position).normalize();
        const t   = (depthZ - _camera.position.z) / dir.z;
        return _camera.position.clone().add(dir.multiplyScalar(t));
    }

    function _updateSkeleton3D(hr) {
        if (!hr || !hr.multiHandLandmarks) {
            _skelLines.forEach(l => { l.visible = false; });
            return;
        }
        const hands = hr.multiHandLandmarks;
        for (let h = 0; h < MAX_HANDS; h++) {
            if (h >= hands.length) { _skelLines[h].visible = false; continue; }
            const lms = hands[h];
            const pos = _skelGeos[h].attributes.position.array;
            let ptr = 0;
            HAND_CONNECTIONS.forEach(([a, b]) => {
                const wa = _lm2world(lms[a]);
                const wb = _lm2world(lms[b]);
                pos[ptr++] = wa.x; pos[ptr++] = wa.y; pos[ptr++] = wa.z;
                pos[ptr++] = wb.x; pos[ptr++] = wb.y; pos[ptr++] = wb.z;
            });
            _skelGeos[h].attributes.position.needsUpdate = true;
            _skelLines[h].visible = true;
        }
        for (let h = hands.length; h < MAX_HANDS; h++) _skelLines[h].visible = false;
    }

    // ── Camera (reuse APP.camera stream to prevent double-capture lag) ────────
    async function _startCam() {
        _status('CAMERA...');
        _camVideo = document.getElementById('kinetic-cam-video');
        if (window.APP && APP.camera) {
            const src = APP.camera.stream || (APP.camera.videoEl && APP.camera.videoEl.srcObject);
            if (src) {
                _camVideo.srcObject = src;
                await _camVideo.play().catch(() => {});
                _camVideo.classList.add('kr-online');
                return;
            }
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: 'user' }, audio: false
        });
        _camVideo.srcObject = stream;
        await _camVideo.play();
        _camVideo.classList.add('kr-online');
    }

    // ── MediaPipe (throttled to ~20fps) ───────────────────────────────────────
    async function _startHands() {
        _status('LOADING MEDIAPIPE...');
        if (!window.Hands) {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
                s.crossOrigin = 'anonymous';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }
        _hands = new window.Hands({
            locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
        });
        _hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.75, minTrackingConfidence: 0.55 });
        _hands.onResults(r => { _handsResults = r; });
        let fc = 0;
        const feed = async () => {
            if (!_active) return;
            if (++fc % 3 === 0 && _camVideo && _camVideo.readyState >= 2) {
                await _hands.send({ image: _camVideo }).catch(() => {});
            }
            requestAnimationFrame(feed);
        };
        feed();
    }

    // ── MIDI ──────────────────────────────────────────────────────────────────
    async function _initMidi() {
        if (!navigator.requestMIDIAccess) return;
        try {
            _midi = await navigator.requestMIDIAccess();
            const bind = () => _midi.inputs.forEach(i => { i.onmidimessage = _handleMidi; });
            bind();
            _midi.onstatechange = bind;
        } catch (e) {}
    }

    function _handleMidi(msg) {
        if (!msg.data || msg.data.length < 3) return;
        const [status, cc, val] = msg.data;
        if ((status & 0xf0) !== 0xb0) return;
        if (_midiLearnTarget) {
            _ctrlBindings[cc] = _midiLearnTarget;
            document.querySelectorAll('.kr-ctrl-learn').forEach(b => b.classList.remove('kr-learning'));
            _midiLearnTarget = null;
            _status('CC' + cc + ' → ' + _ctrlBindings[cc].toUpperCase(), true);
            setTimeout(() => { if (_active) _status(_instrName + ' // ONLINE', true); }, 2000);
            return;
        }
        const ctrlId = _ctrlBindings[cc];
        if (!ctrlId) return;
        const norm = val / 127;
        document.querySelector(`.kr-ctrl-slider[data-ctrl="${ctrlId}"]`)?.setAttribute('value', norm);
        _applyCtrl(ctrlId, norm);
    }

    function _applyCtrl(id, val) {
        const instr = _currentInstr;
        if (!instr) return;
        switch (id) {
            case 'vol': {
                const g = instr._masterGain || instr._mGain;
                if (g) g.gain.setTargetAtTime(val * 0.9 + 0.05, instr._ctx.currentTime, 0.05);
                break;
            }
            case 'reverb':
                if (instr._reverbGain) instr._reverbGain.gain.setTargetAtTime(val, instr._ctx.currentTime, 0.05);
                break;
            case 'filter':
                if (instr._filter) instr._filter.frequency.setTargetAtTime(80 + val * 3400, instr._ctx.currentTime, 0.03);
                break;
        }
    }

    // ── Recording engine ──────────────────────────────────────────────────────
    function _setupRecording(audioCtx) {
        _recDest = audioCtx.createMediaStreamDestination();
    }

    function toggleRecording() {
        if (_recorder && _recorder.state === 'recording') {
            _recorder.stop();
            _status(_instrName + ' // ONLINE', true);
            document.getElementById('kr-rec-btn')?.classList.remove('kr-recording');
            return;
        }
        const canvas = document.getElementById('kinetic-canvas');
        const tracks = [...canvas.captureStream(30).getVideoTracks()];
        if (_recDest) tracks.push(..._recDest.stream.getAudioTracks());
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus' : 'video/webm';
        _recChunks = [];
        _recorder = new MediaRecorder(new MediaStream(tracks), {
            mimeType: mime, videoBitsPerSecond: 8_000_000
        });
        _recorder.ondataavailable = e => { if (e.data.size > 0) _recChunks.push(e.data); };
        _recorder.onstop = () => {
            const url = URL.createObjectURL(new Blob(_recChunks, { type: mime }));
            Object.assign(document.createElement('a'), { href: url, download: `vngrd-${Date.now()}.webm` }).click();
            URL.revokeObjectURL(url);
        };
        _recorder.start(1000);
        _status('● REC', true);
        document.getElementById('kr-rec-btn')?.classList.add('kr-recording');
    }

    // ── Instruments ───────────────────────────────────────────────────────────
    async function _buildInstruments() {
        _status('LOADING INSTRUMENTS...');
        const { CyberHangdrum } = await import('./instruments/CyberHangdrum.js');
        const { NeuralGlitch }  = await import('./instruments/NeuralGlitch.js');
        const { TetherVerlet }  = await import('./instruments/TetherVerlet.js');
        const ctx = (window.APP && APP.audio && APP.audio.ctx) ? APP.audio.ctx
            : new (window.AudioContext || window.webkitAudioContext)();
        _setupRecording(ctx);
        _instruments = {
            CYBER_HANGDRUM: new CyberHangdrum(_scene, ctx, T, _camera, _recDest),
            NEURAL_GLITCH:  new NeuralGlitch(_scene, ctx, T, _recDest),
            TETHER_VERLET:  new TetherVerlet(_scene, ctx, T, _recDest)
        };
        await Promise.all(Object.values(_instruments).map(i => i.init()));
        _currentInstr = _instruments[_instrName];
        _currentInstr.activate();
    }

    // ── Render loop ───────────────────────────────────────────────────────────
    function _loop() {
        if (!_active) return;
        _raf = requestAnimationFrame(_loop);
        const t = _clock.getElapsedTime();
        _updateSkeleton3D(_handsResults);
        if (_currentInstr) _currentInstr.update(_handsResults, t, _camera);
        _renderer.render(_scene, _camera);
    }

    // ── Toggle ────────────────────────────────────────────────────────────────
    async function toggle() {
        if (_active) {
            _active = false;
            cancelAnimationFrame(_raf);
            if (_recorder && _recorder.state === 'recording') _recorder.stop();
            Object.values(_instruments).forEach(i => i.deactivate && i.deactivate());
            _skelLines.forEach(l => { l.visible = false; });
            ['kinetic-canvas','kr-launch-btn','kr-rack','kinetic-cam-video'].forEach(id => {
                document.getElementById(id)?.classList.remove('kr-online');
            });
            document.getElementById('kr-help-modal')?.classList.remove('kr-visible');
            _status('OFFLINE');
            return;
        }
        _active = true;
        document.getElementById('kr-launch-btn').classList.add('kr-online');
        try {
            await _loadDeps();
            await _startCam();
            _status('BUILDING 3D PIPELINE...');
            _setup();
            _buildSkeleton3D();
            await _buildInstruments();
            await _startHands();
            _initMidi();
            document.getElementById('kinetic-canvas').classList.add('kr-online');
            document.getElementById('kr-rack').classList.add('kr-online');
            _status(_instrName + ' // ONLINE', true);
            _updateHelp(_instrName);
            _loop();
        } catch (e) {
            console.error('[KineticRack]', e);
            _status('ERR: ' + e.message.slice(0, 40));
            _active = false;
            document.getElementById('kr-launch-btn').classList.remove('kr-online');
            document.getElementById('kinetic-cam-video').classList.remove('kr-online');
        }
    }

    function setInstrument(name) {
        if (!_instruments[name]) return;
        if (_currentInstr) _currentInstr.deactivate && _currentInstr.deactivate();
        _instrName = name;
        _currentInstr = _instruments[name];
        _currentInstr.activate();
        document.querySelectorAll('.kr-btn').forEach(b => b.classList.remove('kr-sel'));
        const ids = { CYBER_HANGDRUM:'kr-btn-cyber-hangdrum', NEURAL_GLITCH:'kr-btn-neural-glitch', TETHER_VERLET:'kr-btn-tether-verlet' };
        document.getElementById(ids[name])?.classList.add('kr-sel');
        const tm = document.getElementById('kr-tether-modes');
        if (tm) tm.style.display = name === 'TETHER_VERLET' ? 'flex' : 'none';
        const hudTitle = document.getElementById('kr-hud-title');
        if (hudTitle) hudTitle.textContent = name.replace('_', ' ');
        if (_active) _status(name + ' // ONLINE', true);
        _updateHelp(name);
    }

    function setTetherMode(mode) {
        if (_instruments.TETHER_VERLET) _instruments.TETHER_VERLET.setMode(mode);
        document.querySelectorAll('.kr-sub-btn').forEach(b =>
            b.classList.toggle('kr-sel', b.dataset.mode === mode)
        );
    }

    function toggleHelp() {
        const m = document.getElementById('kr-help-modal');
        if (!m) return;
        m.classList.toggle('kr-visible');
        _updateHelp(_instrName);
    }

    function _updateHelp(name) {
        const body = document.getElementById('kr-help-body');
        if (!body) return;
        body.innerHTML = (HELP_TEXT[name] || []).map(l => `<div class="kr-help-line">${l}</div>`).join('');
    }

    function ctrlChange(id, val)  { _applyCtrl(id, parseFloat(val)); }
    function midiLearn(ctrlId) {
        _midiLearnTarget = ctrlId;
        document.querySelectorAll('.kr-ctrl-learn').forEach(b => b.classList.remove('kr-learning'));
        document.querySelector(`.kr-ctrl-learn[data-ctrl="${ctrlId}"]`)?.classList.add('kr-learning');
        _status('MIDI LEARN: TURN KNOB FOR ' + ctrlId.toUpperCase(), true);
    }

    return { toggle, setInstrument, setTetherMode, toggleHelp, ctrlChange, midiLearn, toggleRecording };
})();

window.KineticRack = KineticRack;
