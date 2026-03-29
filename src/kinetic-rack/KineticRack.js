// KineticRack — Three.js ONLY. Zero 2D canvas. 60fps.
// Skeleton: TubeGeometry-style cylinder bones + IcosahedronGeometry joints (Liquid Chrome)
//           Fingertip PointLights illuminate instrument pads
// Architecture: z:3499 camera (CSS dark-cinema) → z:3500 Three.js alpha canvas

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
        'RAYCAST — fingertip enters 3D frosted-glass hex',
        'Center pad (D3) — deep bass Ding',
        '8 ring pads — D Kurd scale',
        'Pad physically dips + ripple on hit',
    ],
    NEURAL_GLITCH: [
        'PINCH (index+thumb) → Granular bitcrush depth',
        'FIST (all closed) → Sub-grain cloud + filter close',
        'OPEN PALM → Granular reverb shimmer',
        'Right wrist height → Master filter cutoff',
    ],
    TETHER_VERLET: [
        'CORE: plasma string between both wrists',
        '  Distance → Pitch (55–880 Hz log)',
        '  Left wrist → Filter sweep',
        '  Sharp pull → Pluck trigger',
        'CONSTELLATION / FLOW modes',
    ],
};

const KineticRack = (() => {
    let T;
    let _renderer, _scene, _camera, _clock;
    let _camVideo;
    let _hands, _handsResults;
    let _raf, _active = false;
    let _instruments = {}, _currentInstr = null, _instrName = 'CYBER_HANGDRUM';

    // 3D skeleton structures
    let _skelBones  = [];   // [hand][conn] = Mesh (cylinder)
    let _skelJoints = [];   // [hand][joint] = Mesh (icosahedron)
    let _skelLights = [];   // [hand][tip] = PointLight (fingertips only)

    // Master audio chain
    let _masterChainIn = null;
    let _masterGainOut = null;
    let _recDest = null;
    let _recorder = null, _recChunks = [];

    // MIDI
    let _midi = null, _midiLearnTarget = null, _ctrlBindings = {};

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

    // ── Renderer + Scene Setup ────────────────────────────────────────────────
    function _setup() {
        const canvas = document.getElementById('kinetic-canvas');
        const { W, H } = _stageSize();

        _renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _renderer.setSize(W, H);
        _renderer.setClearColor(0x000000, 0);
        _renderer.outputColorSpace  = T.SRGBColorSpace;
        _renderer.toneMapping       = T.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.1;
        _renderer.useLegacyLights   = false; // physically correct for MeshPhysicalMaterial

        _camera = new T.PerspectiveCamera(60, W / H, 0.1, 200);
        _camera.position.set(0, 0, 5);

        _scene = new T.Scene();
        _scene.background = null;
        _clock = new T.Clock();

        // Scene lighting — drives frosted glass reflections + skeleton chrome
        const ambient = new T.AmbientLight(0x0a0f22, 1.2);
        const rim1    = new T.DirectionalLight(0x00f3ff, 0.55);
        rim1.position.set(3, 4, 5);
        const rim2    = new T.DirectionalLight(0xff00cc, 0.35);
        rim2.position.set(-4, 2, 3);
        const top     = new T.DirectionalLight(0x4488ff, 0.25);
        top.position.set(0, 8, 2);
        _scene.add(ambient, rim1, rim2, top);

        window.addEventListener('resize', () => {
            const { W: w, H: h } = _stageSize();
            _renderer.setSize(w, h);
            _camera.aspect = w / h;
            _camera.updateProjectionMatrix();
        });
    }

    // ── 3D Hand Skeleton (cylinder bones + icosahedron joints) ───────────────
    function _buildSkeleton3D() {
        for (let h = 0; h < MAX_HANDS; h++) {
            const col = new T.Color(HAND_COLORS[h]);

            // Liquid Chrome bone material
            const boneMat = new T.MeshStandardMaterial({
                color:             new T.Color(0xb8d4ff),
                emissive:          col,
                emissiveIntensity: 0.38,
                metalness:         1.0,
                roughness:         0.04,
            });

            // Brighter chrome for joint icosahedra
            const jointMat = new T.MeshStandardMaterial({
                color:             new T.Color(0xffffff),
                emissive:          col,
                emissiveIntensity: 1.1,
                metalness:         1.0,
                roughness:         0.02,
            });

            // Bone cylinders — unit height (scaled per frame to match bone length)
            const boneGeo = new T.CylinderGeometry(0.01, 0.01, 1, 7);
            const bones = [];
            for (let c = 0; c < N_CONN; c++) {
                const bone = new T.Mesh(boneGeo, boneMat);
                bone.renderOrder = 998;
                bone.visible = false;
                _scene.add(bone);
                bones.push(bone);
            }
            _skelBones.push(bones);

            // Icosahedron joints
            const joints = [];
            for (let j = 0; j < N_JOINTS; j++) {
                const isTip = FINGERTIP_IDX.includes(j);
                const r = isTip ? 0.052 : 0.032;
                const jGeo = new T.IcosahedronGeometry(r, 1);
                const jMat = jointMat.clone();
                jMat.emissiveIntensity = isTip ? 1.6 : 0.7;
                const jMesh = new T.Mesh(jGeo, jMat);
                jMesh.renderOrder = 999;
                jMesh.visible = false;
                _scene.add(jMesh);
                joints.push(jMesh);
            }
            _skelJoints.push(joints);

            // Fingertip PointLights — cast faint glow on instrument pads
            const lights = [];
            FINGERTIP_IDX.forEach(() => {
                const light = new T.PointLight(HAND_COLORS[h], 0, 2.8, 2);
                _scene.add(light);
                lights.push(light);
            });
            _skelLights.push(lights);
        }
    }

    // MediaPipe [0,1] + z-depth → Three.js world coords
    function _lm2world(lm) {
        const ndcX  = -(lm.x * 2 - 1);
        const ndcY  = -(lm.y * 2 - 1);
        const depthZ = (lm.z || 0) * -4;
        const ndc = new T.Vector3(ndcX, ndcY, 0.5);
        ndc.unproject(_camera);
        const dir = ndc.sub(_camera.position).normalize();
        const t   = (depthZ - _camera.position.z) / dir.z;
        return _camera.position.clone().add(dir.multiplyScalar(t));
    }

    // Align a cylinder bone between world points pA and pB
    const _boneUp = new T.Vector3(0, 1, 0);
    function _alignBone(bone, pA, pB) {
        const dir = new T.Vector3().subVectors(pB, pA);
        const len = dir.length();
        if (len < 1e-4) { bone.visible = false; return; }
        bone.position.addVectors(pA, pB).multiplyScalar(0.5);
        bone.scale.y = len;
        bone.quaternion.setFromUnitVectors(_boneUp, dir.normalize());
        bone.visible = true;
    }

    function _updateSkeleton3D(hr) {
        const noHands = !hr || !hr.multiHandLandmarks || !hr.multiHandLandmarks.length;
        for (let h = 0; h < MAX_HANDS; h++) {
            const hasHand = !noHands && h < hr.multiHandLandmarks.length;
            if (!hasHand) {
                _skelBones[h].forEach(b => { b.visible = false; });
                _skelJoints[h].forEach(j => { j.visible = false; });
                _skelLights[h].forEach(l => { l.intensity = 0; });
                continue;
            }

            const lms = hr.multiHandLandmarks[h];
            // Compute world positions for all 21 landmarks
            const pts = lms.map(lm => _lm2world(lm));

            // Update joints
            pts.forEach((wp, j) => {
                _skelJoints[h][j].position.copy(wp);
                _skelJoints[h][j].visible = true;
            });

            // Update bones (cylinder between two joints)
            HAND_CONNECTIONS.forEach(([a, b], ci) => {
                _alignBone(_skelBones[h][ci], pts[a], pts[b]);
            });

            // Update fingertip lights
            FINGERTIP_IDX.forEach((tipIdx, li) => {
                _skelLights[h][li].position.copy(pts[tipIdx]);
                _skelLights[h][li].intensity = 0.28;
            });
        }
    }

    // ── Camera ────────────────────────────────────────────────────────────────
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

    // ── MediaPipe (~20fps throttle) ───────────────────────────────────────────
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
            if (++fc % 3 === 0 && _camVideo && _camVideo.readyState >= 2)
                await _hands.send({ image: _camVideo }).catch(() => {});
            requestAnimationFrame(feed);
        };
        feed();
    }

    // ── Master Audio Chain ────────────────────────────────────────────────────
    function _buildMasterChain(ctx) {
        // Glue compressor
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.ratio.value = 3.5;
        comp.attack.value = 0.005;  comp.release.value = 0.15;
        comp.knee.value = 8;

        // Brickwall limiter
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -2; limiter.ratio.value = 20;
        limiter.attack.value = 0.001; limiter.release.value = 0.05;
        limiter.knee.value = 2;

        // Master output gain
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
        if (_masterGainOut) _masterGainOut.connect(_recDest); // record after master processing
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

    // ── Recording ─────────────────────────────────────────────────────────────
    function toggleRecording() {
        if (_recorder && _recorder.state === 'recording') {
            _recorder.stop();
            _status(_instrName + ' // ONLINE', true);
            document.getElementById('kr-rec-btn')?.classList.remove('kr-recording');
            return;
        }
        const canvas  = document.getElementById('kinetic-canvas');
        const tracks  = [...canvas.captureStream(30).getVideoTracks()];
        if (_recDest) tracks.push(..._recDest.stream.getAudioTracks());
        const mime    = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus' : 'video/webm';
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
        const { CyberHangdrum } = await import('./instruments/CyberHangdrum.js');
        const { NeuralGlitch }  = await import('./instruments/NeuralGlitch.js');
        const { TetherVerlet }  = await import('./instruments/TetherVerlet.js');
        const ctx = (window.APP && APP.audio && APP.audio.ctx) ? APP.audio.ctx
            : new (window.AudioContext || window.webkitAudioContext)();

        const masterNode = _buildMasterChain(ctx);
        _setupRecording(ctx);

        _instruments = {
            CYBER_HANGDRUM: new CyberHangdrum(_scene, ctx, T, _camera, masterNode),
            NEURAL_GLITCH:  new NeuralGlitch(_scene, ctx, T, masterNode),
            TETHER_VERLET:  new TetherVerlet(_scene, ctx, T, masterNode)
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
            _skelBones.forEach(h => h.forEach(b => { b.visible = false; }));
            _skelJoints.forEach(h => h.forEach(j => { j.visible = false; }));
            _skelLights.forEach(h => h.forEach(l => { l.intensity = 0; }));
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
        const ht = document.getElementById('kr-hud-title');
        if (ht) ht.textContent = name.replace(/_/g, ' ');
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
