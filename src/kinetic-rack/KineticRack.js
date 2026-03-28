import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass }       from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';
import { CyberHangdrum } from './instruments/CyberHangdrum.js';
import { NeuralGlitch }  from './instruments/NeuralGlitch.js';
import { TetherVerlet }  from './instruments/TetherVerlet.js';

// ─────────────────────────────────────────────────────────────────────────────
// AR VOID SHADERS — webcam background with black-crush + phantom colorgrade
// ─────────────────────────────────────────────────────────────────────────────
const VOID_VERT = `
varying vec2 vUv;
void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;

const VOID_FRAG = `
uniform sampler2D uCam;
uniform float uTime;
varying vec2 vUv;

vec3 phantomGrade(vec3 c){
    // Crush blacks — anything below 0.18 threshold goes near-black
    float lum = dot(c, vec3(0.299,0.587,0.114));
    float crush = smoothstep(0.0, 0.22, lum);
    // Desaturate
    vec3 grey = vec3(lum);
    c = mix(grey, c, 0.25);
    // Phantom tint: highlights → cyan, low-mids → magenta
    vec3 cyan    = vec3(0.0, 0.9, 0.85);
    vec3 magenta = vec3(0.85, 0.0, 0.75);
    float t = smoothstep(0.35, 0.75, lum);
    c = mix(c * magenta, c * cyan, t);
    // Apply crush
    c *= crush;
    return c;
}

void main(){
    // Mirror X for natural AR feel
    vec2 uv = vec2(1.0 - vUv.x, vUv.y);
    vec4 cam = texture2D(uCam, uv);
    vec3 col = phantomGrade(cam.rgb);
    gl_FragColor = vec4(col, 1.0);
}`;

// ─────────────────────────────────────────────────────────────────────────────
// KINETIC RACK — Singleton orchestrator
// ─────────────────────────────────────────────────────────────────────────────
const KineticRack = (() => {
    let _renderer, _scene, _camera, _composer, _clock;
    let _bgMesh, _bgUniforms;
    let _camVideo, _videoTex;
    let _hands = null;
    let _handsResults = null;
    let _raf = null;
    let _active = false;
    let _currentInstr = null;
    let _instruments = {};
    let _instrName = 'CYBER_HANGDRUM';
    let _tetherMode = 'CORE';
    let _statusEl, _launchBtn;

    // ── DOM refs ──────────────────────────────────────────────────────────────
    function _getDOM() {
        _statusEl  = document.getElementById('kr-status');
        _launchBtn = document.getElementById('kr-launch-btn');
    }

    // ── Three.js setup ────────────────────────────────────────────────────────
    function _setup() {
        const canvas = document.getElementById('kinetic-canvas');
        const W = canvas.clientWidth  || (window.innerWidth  - 400);
        const H = canvas.clientHeight || (window.innerHeight - 100);
        canvas.width  = W;
        canvas.height = H;

        _renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        _renderer.setSize(W, H);
        _renderer.outputColorSpace = THREE.SRGBColorSpace;
        _renderer.toneMapping = THREE.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.1;

        _camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
        _camera.position.set(0, 0, 5);

        _scene = new THREE.Scene();
        _scene.background = new THREE.Color(0x000000);

        _clock = new THREE.Clock();

        // Effect Composer
        _composer = new EffectComposer(_renderer);
        _composer.addPass(new RenderPass(_scene, _camera));

        const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 2.2, 0.65, 0.12);
        _composer.addPass(bloom);

        const smaa = new SMAAPass(W, H);
        _composer.addPass(smaa);

        _composer.addPass(new OutputPass());

        // Resize handler
        window.addEventListener('resize', _onResize);
    }

    function _onResize() {
        if (!_renderer) return;
        const canvas = document.getElementById('kinetic-canvas');
        const W = canvas.clientWidth  || (window.innerWidth  - 400);
        const H = canvas.clientHeight || (window.innerHeight - 100);
        canvas.width  = W;
        canvas.height = H;
        _renderer.setSize(W, H);
        _camera.aspect = W / H;
        _camera.updateProjectionMatrix();
        _composer.setSize(W, H);
        _buildBg(W, H);
    }

    // ── AR Void background plane ──────────────────────────────────────────────
    function _buildBg(W, H) {
        if (_bgMesh) {
            _scene.remove(_bgMesh);
            _bgMesh.geometry.dispose();
            _bgMesh.material.dispose();
        }
        const dist   = _camera.position.z - (-5); // camera at 5, plane at -5
        const halfH  = Math.tan(THREE.MathUtils.degToRad(30)) * dist;
        const halfW  = halfH * (W / H);
        const geo    = new THREE.PlaneGeometry(halfW * 2 + 2, halfH * 2 + 2);

        _bgUniforms = {
            uCam:  { value: _videoTex },
            uTime: { value: 0 }
        };

        const mat = new THREE.ShaderMaterial({
            uniforms:       _bgUniforms,
            vertexShader:   VOID_VERT,
            fragmentShader: VOID_FRAG,
            depthWrite: false
        });

        _bgMesh = new THREE.Mesh(geo, mat);
        _bgMesh.position.z = -5;
        _bgMesh.renderOrder = -1;
        _scene.add(_bgMesh);
    }

    // ── Webcam ────────────────────────────────────────────────────────────────
    async function _startCam() {
        _camVideo = document.getElementById('kinetic-cam-video');
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: 'user' },
            audio: false
        });
        _camVideo.srcObject = stream;
        await _camVideo.play();
        _videoTex = new THREE.VideoTexture(_camVideo);
        _videoTex.colorSpace = THREE.SRGBColorSpace;
    }

    // ── MediaPipe Hands ───────────────────────────────────────────────────────
    async function _startHands() {
        // Dynamically import MediaPipe
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
        script.crossOrigin = 'anonymous';
        await new Promise(r => { script.onload = r; document.head.appendChild(script); });

        _hands = new window.Hands({
            locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
        });
        _hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5
        });
        _hands.onResults(r => { _handsResults = r; });

        // Feed camera frames to MediaPipe
        const sendFrames = async () => {
            if (!_active) return;
            if (_camVideo && _camVideo.readyState >= 2) {
                await _hands.send({ image: _camVideo });
            }
            requestAnimationFrame(sendFrames);
        };
        sendFrames();
    }

    // ── Instruments ───────────────────────────────────────────────────────────
    async function _buildInstruments() {
        const audioCtx = (window.APP && APP.audio && APP.audio.ctx)
            ? APP.audio.ctx
            : new (window.AudioContext || window.webkitAudioContext)();

        _instruments.CYBER_HANGDRUM = new CyberHangdrum(_scene, audioCtx);
        _instruments.NEURAL_GLITCH  = new NeuralGlitch(_scene, audioCtx);
        _instruments.TETHER_VERLET  = new TetherVerlet(_scene, audioCtx);

        await Promise.all(Object.values(_instruments).map(i => i.init()));

        // Activate default
        _currentInstr = _instruments[_instrName];
        _currentInstr.activate();
    }

    // ── RAF loop ──────────────────────────────────────────────────────────────
    function _loop() {
        if (!_active) return;
        _raf = requestAnimationFrame(_loop);

        const t = _clock.getElapsedTime();

        // Update BG texture time
        if (_bgUniforms) _bgUniforms.uTime.value = t;

        // Update active instrument
        if (_currentInstr) _currentInstr.update(_handsResults, t, _camera);

        _composer.render();
    }

    // ── Public API ────────────────────────────────────────────────────────────
    async function toggle() {
        _getDOM();
        if (_active) {
            _active = false;
            cancelAnimationFrame(_raf);
            _raf = null;
            Object.values(_instruments).forEach(i => i.deactivate && i.deactivate());
            document.getElementById('kinetic-canvas').classList.remove('kr-online');
            _launchBtn && _launchBtn.classList.remove('kr-online');
            if (_statusEl) _statusEl.textContent = 'OFFLINE';
            return;
        }

        _active = true;
        if (_statusEl) _statusEl.textContent = 'INITIALIZING...';

        try {
            await _startCam();
            _setup();
            const W = _renderer.domElement.width;
            const H = _renderer.domElement.height;
            _buildBg(W, H);
            await _buildInstruments();
            await _startHands();

            document.getElementById('kinetic-canvas').classList.add('kr-online');
            _launchBtn && _launchBtn.classList.add('kr-online');
            if (_statusEl) _statusEl.textContent = _instrName + ' // ONLINE';

            _loop();
        } catch(e) {
            console.error('[KineticRack] init failed:', e);
            if (_statusEl) _statusEl.textContent = 'ERROR: ' + e.message;
            _active = false;
        }
    }

    function setInstrument(name) {
        if (!_instruments[name]) return;
        if (_currentInstr) _currentInstr.deactivate && _currentInstr.deactivate();
        _instrName    = name;
        _currentInstr = _instruments[name];
        _currentInstr.activate();

        // Update button states
        document.querySelectorAll('.kr-btn').forEach(b => b.classList.remove('kr-sel'));
        const btnMap = {
            CYBER_HANGDRUM: 'kr-btn-cyber-hangdrum',
            NEURAL_GLITCH:  'kr-btn-neural-glitch',
            TETHER_VERLET:  'kr-btn-tether-verlet'
        };
        const btn = document.getElementById(btnMap[name]);
        if (btn) btn.classList.add('kr-sel');

        // Show/hide tether sub-modes
        const tetherModes = document.getElementById('kr-tether-modes');
        if (tetherModes) tetherModes.style.display = name === 'TETHER_VERLET' ? 'flex' : 'none';

        if (_statusEl && _active) _statusEl.textContent = name + ' // ONLINE';
    }

    function setTetherMode(mode) {
        _tetherMode = mode;
        if (_instruments.TETHER_VERLET) _instruments.TETHER_VERLET.setMode(mode);
        document.querySelectorAll('.kr-sub-btn').forEach(b => {
            b.classList.toggle('kr-sel', b.dataset.mode === mode);
        });
    }

    return { toggle, setInstrument, setTetherMode };
})();

window.KineticRack = KineticRack;
