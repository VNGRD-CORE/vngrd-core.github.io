// KineticRack — dynamic imports, no static deps, sets window.KineticRack immediately
// Architecture: CSS video layer (z:3499) → Three.js alpha canvas (z:3500) → 2D skel canvas (z:3501)
// NO bloom — direct renderer.render(), NO background plane, NO VOID shader

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
        'INDEX / MIDDLE / THUMB TIPS touch pads',
        'Center pad (D3) — deep bass Ding',
        '8 ring pads — D Kurd scale notes',
        'Touch = trigger, hold = sustain, release to re-trigger',
        'Pads sit in lower screen — rest hands naturally',
    ],
    NEURAL_GLITCH: [
        'LEFT HAND fingers trigger sounds:',
        '  Index → Industrial Kick',
        '  Middle → Metallic Snare',
        '  Ring → Hi-Hat burst',
        '  Pinky → Glitch crush',
        '  Fist (all closed) → Sub rumble',
        'RIGHT HAND — wrist height → Filter sweep',
        'RIGHT HAND — pinch index+thumb → Crush depth',
    ],
    TETHER_VERLET: [
        'CORE: stretch plasma string between both wrists',
        '  Distance → Pitch (close=low, far=high)',
        '  Left wrist height → Filter sweep',
        '  Sharp pull-apart → Pluck trigger',
        'CONSTELLATION: landmark neural web overlay',
        '  Hand spread → Delay time modulation',
        'FLOW: theremin-style continuous control',
        '  Right X/Y → Pitch / Volume',
        '  Left X/Y → Filter / Delay',
    ],
};

const KineticRack = (() => {
    let T;
    let _renderer, _scene, _camera, _clock;
    let _skelCanvas, _skelCtx;
    let _camVideo;
    let _hands, _handsResults;
    let _raf, _active = false;
    let _frameCount = 0;
    let _instruments = {}, _currentInstr = null, _instrName = 'CYBER_HANGDRUM';

    // MIDI
    let _midi = null;
    let _midiLearnTarget = null;
    let _ctrlBindings = {};  // cc number → ctrl id

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

    function _setup() {
        const canvas = document.getElementById('kinetic-canvas');
        const { W, H } = _stageSize();
        _renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: true });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        _renderer.setSize(W, H);
        _renderer.setClearColor(0x000000, 0);  // fully transparent — video shows through CSS
        _renderer.outputColorSpace = T.SRGBColorSpace;
        _renderer.toneMapping = T.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.1;

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
            _resizeSkel(w, h);
        });
    }

    // ── Skeleton 2D canvas ────────────────────────────────────────────────────
    function _setupSkel() {
        _skelCanvas = document.getElementById('kinetic-skel');
        if (!_skelCanvas) return;
        const { W, H } = _stageSize();
        _resizeSkel(W, H);
        _skelCtx = _skelCanvas.getContext('2d');
    }

    function _resizeSkel(W, H) {
        if (!_skelCanvas) return;
        _skelCanvas.width  = W;
        _skelCanvas.height = H;
    }

    function _drawSkeleton() {
        if (!_skelCtx || !_skelCanvas) return;
        const W = _skelCanvas.width;
        const H = _skelCanvas.height;
        _skelCtx.clearRect(0, 0, W, H);
        if (!_handsResults || !_handsResults.multiHandLandmarks) return;

        const COLORS = ['#00f3ff', '#ff00cc'];

        _handsResults.multiHandLandmarks.forEach((lms, hi) => {
            const col = COLORS[hi] || '#00ffaa';
            _skelCtx.strokeStyle = col;
            _skelCtx.lineWidth = 1.8;
            _skelCtx.shadowBlur = 8;
            _skelCtx.shadowColor = col;
            _skelCtx.globalAlpha = 0.82;

            // Connections
            HAND_CONNECTIONS.forEach(([a, b]) => {
                if (!lms[a] || !lms[b]) return;
                // Mirror X — camera feed is mirrored with scaleX(-1)
                const ax = (1 - lms[a].x) * W, ay = lms[a].y * H;
                const bx = (1 - lms[b].x) * W, by = lms[b].y * H;
                _skelCtx.beginPath();
                _skelCtx.moveTo(ax, ay);
                _skelCtx.lineTo(bx, by);
                _skelCtx.stroke();
            });

            // Landmark dots
            _skelCtx.shadowBlur = 4;
            lms.forEach((lm, i) => {
                const x = (1 - lm.x) * W, y = lm.y * H;
                const r = [4,8,12,16,20].includes(i) ? 5 : 3; // fingertips larger
                _skelCtx.beginPath();
                _skelCtx.arc(x, y, r, 0, Math.PI * 2);
                _skelCtx.fillStyle = col;
                _skelCtx.fill();
            });
        });

        _skelCtx.globalAlpha = 1;
        _skelCtx.shadowBlur = 0;
    }

    // ── Camera ────────────────────────────────────────────────────────────────
    async function _startCam() {
        _status('CAMERA...');
        _camVideo = document.getElementById('kinetic-cam-video');

        // Reuse existing APP.camera stream — prevents double-capture lag
        if (window.APP && APP.camera) {
            const existingStream = APP.camera.stream
                || (APP.camera.videoEl && APP.camera.videoEl.srcObject);
            if (existingStream) {
                _camVideo.srcObject = existingStream;
                await _camVideo.play().catch(() => {});
                _camVideo.classList.add('kr-online');
                return;
            }
        }

        // Fallback: request own stream
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: 'user' },
            audio: false
        });
        _camVideo.srcObject = stream;
        await _camVideo.play();
        _camVideo.classList.add('kr-online');
    }

    // ── MediaPipe hands ───────────────────────────────────────────────────────
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
        _hands = new window.Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
        _hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
        _hands.onResults(r => { _handsResults = r; });

        let fc = 0;
        const feed = async () => {
            if (!_active) return;
            // Throttle to ~20fps: only send every 3rd animation frame
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
            _midi.inputs.forEach(input => { input.onmidimessage = _handleMidi; });
            _midi.onstatechange = () => {
                _midi.inputs.forEach(input => { input.onmidimessage = _handleMidi; });
            };
        } catch (e) { /* MIDI unavailable — silent */ }
    }

    function _handleMidi(msg) {
        if (!msg.data || msg.data.length < 3) return;
        const [status, cc, val] = msg.data;
        if ((status & 0xf0) !== 0xb0) return;  // only CC messages

        if (_midiLearnTarget) {
            _ctrlBindings[cc] = _midiLearnTarget;
            document.querySelectorAll('.kr-ctrl-learn').forEach(b => b.classList.remove('kr-learning'));
            _midiLearnTarget = null;
            _status('MIDI CC' + cc + ' → ' + _ctrlBindings[cc].toUpperCase(), true);
            setTimeout(() => { if (_active) _status(_instrName + ' // ONLINE', true); }, 2000);
            return;
        }

        const ctrlId = _ctrlBindings[cc];
        if (!ctrlId) return;
        const norm = val / 127;
        const slider = document.querySelector(`.kr-ctrl-slider[data-ctrl="${ctrlId}"]`);
        if (slider) slider.value = norm;
        _applyCtrl(ctrlId, norm);
    }

    function _applyCtrl(id, val) {
        const instr = _currentInstr;
        if (!instr) return;
        switch (id) {
            case 'vol':
                const gainNode = instr._masterGain || instr._mGain;
                if (gainNode) gainNode.gain.setTargetAtTime(val * 0.9 + 0.05, instr._ctx.currentTime, 0.05);
                break;
            case 'reverb':
                if (instr._reverb && instr._reverbGain) {
                    instr._reverbGain.gain.setTargetAtTime(val, instr._ctx.currentTime, 0.05);
                }
                break;
            case 'filter':
                if (instr._filter) {
                    instr._filter.frequency.setTargetAtTime(80 + val * 3400, instr._ctx.currentTime, 0.03);
                }
                break;
        }
    }

    // ── Instruments ───────────────────────────────────────────────────────────
    async function _buildInstruments() {
        _status('LOADING INSTRUMENTS...');
        const { CyberHangdrum } = await import('./instruments/CyberHangdrum.js');
        const { NeuralGlitch }  = await import('./instruments/NeuralGlitch.js');
        const { TetherVerlet }  = await import('./instruments/TetherVerlet.js');
        const ctx = (window.APP && APP.audio && APP.audio.ctx) ? APP.audio.ctx
            : new (window.AudioContext || window.webkitAudioContext)();
        _instruments = {
            CYBER_HANGDRUM: new CyberHangdrum(_scene, ctx, T),
            NEURAL_GLITCH:  new NeuralGlitch(_scene, ctx, T),
            TETHER_VERLET:  new TetherVerlet(_scene, ctx, T)
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
        if (_currentInstr) _currentInstr.update(_handsResults, t, _camera);
        _drawSkeleton();
        _renderer.render(_scene, _camera);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    async function toggle() {
        if (_active) {
            _active = false;
            cancelAnimationFrame(_raf);
            Object.values(_instruments).forEach(i => i.deactivate && i.deactivate());
            document.getElementById('kinetic-canvas').classList.remove('kr-online');
            document.getElementById('kr-launch-btn').classList.remove('kr-online');
            document.getElementById('kr-rack').classList.remove('kr-online');
            document.getElementById('kinetic-cam-video').classList.remove('kr-online');
            const sk = document.getElementById('kinetic-skel');
            if (sk) sk.classList.remove('kr-online');
            const hm = document.getElementById('kr-help-modal');
            if (hm) hm.classList.remove('kr-visible');
            _status('OFFLINE');
            return;
        }
        _active = true;
        document.getElementById('kr-launch-btn').classList.add('kr-online');
        try {
            await _loadDeps();
            await _startCam();
            _status('BUILDING PIPELINE...');
            _setup();
            _setupSkel();
            await _buildInstruments();
            await _startHands();
            _initMidi();  // non-blocking
            const sk = document.getElementById('kinetic-skel');
            if (sk) sk.classList.add('kr-online');
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
        const ids = {
            CYBER_HANGDRUM: 'kr-btn-cyber-hangdrum',
            NEURAL_GLITCH:  'kr-btn-neural-glitch',
            TETHER_VERLET:  'kr-btn-tether-verlet'
        };
        document.getElementById(ids[name])?.classList.add('kr-sel');
        const tm = document.getElementById('kr-tether-modes');
        if (tm) tm.style.display = name === 'TETHER_VERLET' ? 'flex' : 'none';
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
        const lines = HELP_TEXT[name] || [];
        body.innerHTML = lines.map(l =>
            `<div class="kr-help-line">${l}</div>`
        ).join('');
    }

    function ctrlChange(id, val) {
        _applyCtrl(id, parseFloat(val));
    }

    function midiLearn(ctrlId) {
        _midiLearnTarget = ctrlId;
        document.querySelectorAll('.kr-ctrl-learn').forEach(b => b.classList.remove('kr-learning'));
        const btn = document.querySelector(`.kr-ctrl-learn[data-ctrl="${ctrlId}"]`);
        if (btn) btn.classList.add('kr-learning');
        _status('MIDI LEARN: TURN KNOB FOR ' + ctrlId.toUpperCase(), true);
    }

    return { toggle, setInstrument, setTetherMode, toggleHelp, ctrlChange, midiLearn };
})();

window.KineticRack = KineticRack;
