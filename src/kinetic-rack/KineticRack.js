// KineticRack — sets window.KineticRack immediately (IIFE, no T.* at top level)
// ALL Three.js usage is deferred inside functions called AFTER _loadDeps()

const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
];

const FINGERTIP_IDX = [4, 8, 12, 16, 20];
const N_CONN        = HAND_CONNECTIONS.length;
const N_JOINTS      = 21;
const MAX_HANDS     = 2;
const HAND_COLORS   = [0x00f3ff, 0xff00cc];

const HELP_TEXT = {
    CYBER_HANGDRUM: [
        'FINGERTIP → 3D frosted-glass hex triggers sound',
        'Center pad — D3 deep bass Ding',
        '8 ring pads — D Kurd scale (A3→A4)',
        'Pad dips + ripple on every hit',
    ],
    NEURAL_GLITCH: [
        'PINCH index+thumb → Granular bitcrush depth',
        'FIST all fingers closed → Sub-grain hit + filter',
        'OPEN PALM → Granular reverb shimmer',
        'Wrist height → Filter cutoff (always live)',
    ],
    TETHER_VERLET: [
        'CORE: plasma string between both wrists',
        '  Distance → Pitch  |  Left wrist → Filter',
        '  Sharp pull → Pluck trigger',
        'CONSTELLATION / FLOW — sub-modes below',
    ],
};

const KineticRack = (() => {
    // ── State ─────────────────────────────────────────────────────────────────
    let T = null;                    // ← only set AFTER _loadDeps(). NEVER use T at IIFE init.
    let _renderer, _scene, _camera, _clock;
    let _camVideo;
    let _hands, _handsResults;
    let _raf, _active = false;
    let _instruments = {}, _currentInstr = null, _instrName = 'CYBER_HANGDRUM';

    // Skeleton — arrays populated in _buildSkeleton3D() (after T is loaded)
    let _skelBones  = [];   // [h][c] = Mesh
    let _skelJoints = [];   // [h][j] = Mesh
    let _skelLights = [];   // [h][i] = PointLight

    // Audio master chain
    let _masterChainIn = null;
    let _masterGainOut = null;
    let _recDest       = null;
    let _recorder = null, _recChunks = [];

    // MIDI
    let _midi = null, _midiLearnTarget = null, _ctrlBindings = {};

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _status(msg, live) {
        const el = document.getElementById('kr-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('kr-live', !!live);
    }

    function _stageSize() {
        return { W: window.innerWidth - 400, H: window.innerHeight - 100 };
    }

    // ── Deps (Three.js dynamic import) ────────────────────────────────────────
    async function _loadDeps() {
        _status('LOADING...');
        T = await import('three');
    }

    // ── Renderer ──────────────────────────────────────────────────────────────
    function _setup() {
        const { W, H } = _stageSize();
        const canvas = document.getElementById('kinetic-canvas');

        _renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _renderer.setSize(W, H);
        _renderer.setClearColor(0x000000, 0);
        _renderer.outputColorSpace  = T.SRGBColorSpace;
        _renderer.toneMapping       = T.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.1;
        _renderer.useLegacyLights   = false;

        _camera = new T.PerspectiveCamera(60, W / H, 0.1, 200);
        _camera.position.set(0, 0, 5);

        _scene = new T.Scene();
        _scene.background = null;
        _clock = new T.Clock();

        // Scene lights — drive MeshPhysicalMaterial reflections + chrome skeleton
        const _rim1 = new T.DirectionalLight(0x00f3ff, 0.55); _rim1.position.set( 3,  4, 5);
        const _rim2 = new T.DirectionalLight(0xff00cc, 0.35); _rim2.position.set(-4,  2, 3);
        const _top  = new T.DirectionalLight(0x4488ff, 0.25); _top.position.set(  0,  8, 2);
        _scene.add(new T.AmbientLight(0x0a0f22, 1.2), _rim1, _rim2, _top);

        window.addEventListener('resize', () => {
            const { W: w, H: h } = _stageSize();
            _renderer.setSize(w, h);
            _camera.aspect = w / h;
            _camera.updateProjectionMatrix();
        });
    }

    // ── 3D Skeleton ──────────────────────────────────────────────────────────
    // Called AFTER _setup() so T is defined
    function _buildSkeleton3D() {
        for (let h = 0; h < MAX_HANDS; h++) {
            const col = new T.Color(HAND_COLORS[h]);

            const boneMat = new T.MeshStandardMaterial({
                color: new T.Color(0xb8d4ff), emissive: col,
                emissiveIntensity: 0.38, metalness: 1.0, roughness: 0.04,
            });
            const jointMat = new T.MeshStandardMaterial({
                color: new T.Color(0xffffff), emissive: col,
                emissiveIntensity: 1.1, metalness: 1.0, roughness: 0.02,
            });

            // Shared cylinder geometry — scale.y = bone length each frame
            const boneGeo = new T.CylinderGeometry(0.01, 0.01, 1, 7);
            const bones = [];
            for (let c = 0; c < N_CONN; c++) {
                const b = new T.Mesh(boneGeo, boneMat);
                b.renderOrder = 998; b.visible = false;
                _scene.add(b); bones.push(b);
            }
            _skelBones.push(bones);

            const joints = [];
            for (let j = 0; j < N_JOINTS; j++) {
                const tip = FINGERTIP_IDX.includes(j);
                const jm  = jointMat.clone();
                jm.emissiveIntensity = tip ? 1.6 : 0.7;
                const mesh = new T.Mesh(new T.IcosahedronGeometry(tip ? 0.052 : 0.032, 1), jm);
                mesh.renderOrder = 999; mesh.visible = false;
                _scene.add(mesh); joints.push(mesh);
            }
            _skelJoints.push(joints);

            // Fingertip lights illuminate pads
            const lights = [];
            FINGERTIP_IDX.forEach(() => {
                const l = new T.PointLight(HAND_COLORS[h], 0, 2.8, 2);
                _scene.add(l); lights.push(l);
            });
            _skelLights.push(lights);
        }
    }

    // MediaPipe lm → Three.js world (with depth)
    function _lm2world(lm) {
        const ndcX = -(lm.x * 2 - 1);
        const ndcY = -(lm.y * 2 - 1);
        const depZ = (lm.z || 0) * -4;
        const v    = new T.Vector3(ndcX, ndcY, 0.5).unproject(_camera);
        const dir  = v.sub(_camera.position).normalize();
        const t    = (depZ - _camera.position.z) / dir.z;
        return _camera.position.clone().add(dir.multiplyScalar(t));
    }

    // Orient a unit-cylinder bone between two world points
    function _alignBone(bone, pA, pB) {
        const dir = new T.Vector3().subVectors(pB, pA);
        const len = dir.length();
        if (len < 1e-4) { bone.visible = false; return; }
        bone.position.addVectors(pA, pB).multiplyScalar(0.5);
        bone.scale.y = len;
        bone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
        bone.visible = true;
    }

    function _updateSkeleton3D(hr) {
        for (let h = 0; h < MAX_HANDS; h++) {
            const lms = hr?.multiHandLandmarks?.[h];
            if (!lms) {
                _skelBones[h]?.forEach(b => { b.visible = false; });
                _skelJoints[h]?.forEach(j => { j.visible = false; });
                _skelLights[h]?.forEach(l => { l.intensity = 0; });
                continue;
            }
            const pts = lms.map(lm => _lm2world(lm));
            pts.forEach((wp, j) => {
                _skelJoints[h][j].position.copy(wp);
                _skelJoints[h][j].visible = true;
            });
            HAND_CONNECTIONS.forEach(([a, b], ci) => _alignBone(_skelBones[h][ci], pts[a], pts[b]));
            FINGERTIP_IDX.forEach((ti, li) => {
                _skelLights[h][li].position.copy(pts[ti]);
                _skelLights[h][li].intensity = 0.28;
            });
        }
    }

    // ── Camera ────────────────────────────────────────────────────────────────
    async function _startCam() {
        _status('CAMERA...');
        _camVideo = document.getElementById('kinetic-cam-video');
        // Prefer reusing existing APP.camera stream — no second capture device
        if (window.APP?.camera) {
            const src = APP.camera.stream ?? APP.camera.videoEl?.srcObject;
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

    // ── MediaPipe (~20fps throttle) ───────────────────────────────────────────
    async function _startHands() {
        _status('LOADING MEDIAPIPE...');
        if (!window.Hands) {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
                s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }
        _hands = new window.Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
        _hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.72, minTrackingConfidence: 0.52 });
        _hands.onResults(r => { _handsResults = r; });
        let fc = 0;
        const feed = async () => {
            if (!_active) return;
            if (++fc % 3 === 0 && _camVideo?.readyState >= 2)
                await _hands.send({ image: _camVideo }).catch(() => {});
            requestAnimationFrame(feed);
        };
        feed();
    }

    // ── Master audio chain ────────────────────────────────────────────────────
    function _buildMasterChain(ctx) {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.ratio.value = 3.5;
        comp.attack.value = 0.005;  comp.release.value = 0.15; comp.knee.value = 8;

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -2;  limiter.ratio.value = 20;
        limiter.attack.value = 0.001;  limiter.release.value = 0.05; limiter.knee.value = 2;

        _masterGainOut = ctx.createGain();
        _masterGainOut.gain.value = 0.9;

        comp.connect(limiter);
        limiter.connect(_masterGainOut);
        _masterGainOut.connect(ctx.destination);
        _masterChainIn = comp;
        return comp;
    }

    function _setupRecording(ctx) {
        _recDest = ctx.createMediaStreamDestination();
        _masterGainOut?.connect(_recDest);
    }

    // ── MIDI ──────────────────────────────────────────────────────────────────
    async function _initMidi() {
        if (!navigator.requestMIDIAccess) return;
        try {
            _midi = await navigator.requestMIDIAccess();
            const bind = () => _midi.inputs.forEach(i => { i.onmidimessage = _onMidi; });
            bind(); _midi.onstatechange = bind;
        } catch (_) {}
    }

    function _onMidi(msg) {
        if (!msg.data || msg.data.length < 3) return;
        const [st, cc, val] = msg.data;
        if ((st & 0xf0) !== 0xb0) return;
        if (_midiLearnTarget) {
            _ctrlBindings[cc] = _midiLearnTarget;
            document.querySelectorAll('.kr-ctrl-learn').forEach(b => b.classList.remove('kr-learning'));
            _midiLearnTarget = null;
            _status('CC' + cc + ' → ' + _ctrlBindings[cc].toUpperCase(), true);
            setTimeout(() => { if (_active) _status(_instrName + ' // LIVE', true); }, 2000);
            return;
        }
        const id = _ctrlBindings[cc]; if (!id) return;
        const n  = val / 127;
        document.querySelector(`.kr-ctrl-slider[data-ctrl="${id}"]`)?.setAttribute('value', n);
        _applyCtrl(id, n);
    }

    function _applyCtrl(id, val) {
        const instr = _currentInstr; if (!instr) return;
        if (id === 'vol') {
            const g = instr._masterGain ?? instr._mGain;
            g?.gain.setTargetAtTime(val * 0.9 + 0.05, instr._ctx.currentTime, 0.05);
        } else if (id === 'reverb') {
            instr._reverbGain?.gain.setTargetAtTime(val, instr._ctx.currentTime, 0.05);
        } else if (id === 'filter') {
            instr._filter?.frequency.setTargetAtTime(80 + val * 3400, instr._ctx.currentTime, 0.03);
        }
    }

    // ── Recording ─────────────────────────────────────────────────────────────
    function toggleRecording() {
        if (_recorder?.state === 'recording') {
            _recorder.stop();
            _status(_instrName + ' // LIVE', true);
            document.getElementById('kr-rec-btn')?.classList.remove('kr-recording');
            return;
        }
        const tracks = [...document.getElementById('kinetic-canvas').captureStream(30).getVideoTracks()];
        if (_recDest) tracks.push(..._recDest.stream.getAudioTracks());
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
        _recChunks = [];
        _recorder  = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
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
        const [{ CyberHangdrum }, { NeuralGlitch }, { TetherVerlet }] = await Promise.all([
            import('./instruments/CyberHangdrum.js'),
            import('./instruments/NeuralGlitch.js'),
            import('./instruments/TetherVerlet.js'),
        ]);
        let ctx;
        if (window.APP?.audio?.ctx) {
            ctx = APP.audio.ctx;
        } else {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        await ctx.resume().catch(() => {}); // ensure AudioContext is running

        const masterNode = _buildMasterChain(ctx);
        _setupRecording(ctx);

        _instruments = {
            CYBER_HANGDRUM: new CyberHangdrum(_scene, ctx, T, _camera, masterNode),
            NEURAL_GLITCH:  new NeuralGlitch(_scene, ctx, T, masterNode),
            TETHER_VERLET:  new TetherVerlet(_scene, ctx, T, masterNode),
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
        _currentInstr?.update(_handsResults, t, _camera);
        _renderer.render(_scene, _camera);
    }

    // ── Toggle (main entry point) ─────────────────────────────────────────────
    async function toggle() {
        if (_active) {
            // Shut down
            _active = false;
            cancelAnimationFrame(_raf);
            if (_recorder?.state === 'recording') _recorder.stop();
            Object.values(_instruments).forEach(i => i.deactivate?.());
            _skelBones.forEach(h  => h.forEach(b => { b.visible = false; }));
            _skelJoints.forEach(h => h.forEach(j => { j.visible = false; }));
            _skelLights.forEach(h => h.forEach(l => { l.intensity = 0; }));
            ['kinetic-canvas','kr-launch-btn','kr-rack','kinetic-cam-video'].forEach(id =>
                document.getElementById(id)?.classList.remove('kr-online')
            );
            document.getElementById('kr-help-modal')?.classList.remove('kr-visible');
            _status('OFFLINE');
            return;
        }

        // Launch
        _active = true;
        document.getElementById('kr-launch-btn')?.classList.add('kr-online');
        _status('STARTING...');

        try {
            await _loadDeps();                    // T is now loaded
            await _startCam();                    // camera feed visible
            _setup();                             // renderer + scene + lights
            _buildSkeleton3D();                   // skeleton meshes (T now safe)
            await _buildInstruments();            // audio chain + instruments
            await _startHands();                  // MediaPipe
            _initMidi();                          // non-blocking

            document.getElementById('kinetic-canvas')?.classList.add('kr-online');
            document.getElementById('kr-rack')?.classList.add('kr-online');
            _status(_instrName + ' // LIVE', true);
            _updateHelp(_instrName);
            _loop();
        } catch (err) {
            console.error('[KineticRack]', err);
            _status('ERR: ' + String(err.message).slice(0, 44));
            _active = false;
            document.getElementById('kr-launch-btn')?.classList.remove('kr-online');
            document.getElementById('kinetic-cam-video')?.classList.remove('kr-online');
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function setInstrument(name) {
        if (!_instruments[name]) return;
        _currentInstr?.deactivate?.();
        _instrName    = name;
        _currentInstr = _instruments[name];
        _currentInstr.activate();
        document.querySelectorAll('.kr-btn').forEach(b => b.classList.remove('kr-sel'));
        const ids = { CYBER_HANGDRUM:'kr-btn-cyber-hangdrum', NEURAL_GLITCH:'kr-btn-neural-glitch', TETHER_VERLET:'kr-btn-tether-verlet' };
        document.getElementById(ids[name])?.classList.add('kr-sel');
        document.getElementById('kr-tether-modes').style.display = name === 'TETHER_VERLET' ? 'flex' : 'none';
        const ht = document.getElementById('kr-hud-title');
        if (ht) ht.textContent = name.replace(/_/g, ' ');
        if (_active) _status(name + ' // LIVE', true);
        _updateHelp(name);
    }

    function setTetherMode(mode) {
        _instruments.TETHER_VERLET?.setMode(mode);
        document.querySelectorAll('.kr-sub-btn').forEach(b =>
            b.classList.toggle('kr-sel', b.dataset.mode === mode)
        );
    }

    function toggleHelp() {
        document.getElementById('kr-help-modal')?.classList.toggle('kr-visible');
        _updateHelp(_instrName);
    }

    function _updateHelp(name) {
        const body = document.getElementById('kr-help-body');
        if (!body) return;
        body.innerHTML = (HELP_TEXT[name] || []).map(l => `<div class="kr-help-line">${l}</div>`).join('');
    }

    function ctrlChange(id, val) { _applyCtrl(id, parseFloat(val)); }

    function midiLearn(ctrlId) {
        _midiLearnTarget = ctrlId;
        document.querySelectorAll('.kr-ctrl-learn').forEach(b => b.classList.remove('kr-learning'));
        document.querySelector(`.kr-ctrl-learn[data-ctrl="${ctrlId}"]`)?.classList.add('kr-learning');
        _status('MIDI: TURN KNOB FOR ' + ctrlId.toUpperCase(), true);
    }

    return { toggle, setInstrument, setTetherMode, toggleHelp, ctrlChange, midiLearn, toggleRecording };
})();

window.KineticRack = KineticRack;
