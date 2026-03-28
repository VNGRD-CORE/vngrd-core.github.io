import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { CyberHangdrum }   from './instruments/CyberHangdrum.js';
import { NeuralGlitch }    from './instruments/NeuralGlitch.js';
import { TetherVerlet }    from './instruments/TetherVerlet.js';

// ── AR Void shaders ────────────────────────────────────────────────────────────
const VOID_VERT = `varying vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

const VOID_FRAG = `uniform sampler2D uCam; uniform float uTime; varying vec2 vUv;
vec3 phantomGrade(vec3 c){
    float lum=dot(c,vec3(0.299,0.587,0.114));
    float crush=smoothstep(0.0,0.22,lum);
    c=mix(vec3(lum),c,0.25);
    vec3 cyan=vec3(0.0,0.9,0.85); vec3 mag=vec3(0.85,0.0,0.75);
    c=mix(c*mag,c*cyan,smoothstep(0.35,0.75,lum));
    return c*crush;
}
void main(){
    vec4 cam=texture2D(uCam,vec2(1.0-vUv.x,vUv.y));
    gl_FragColor=vec4(phantomGrade(cam.rgb),1.0);
}`;

// ── Singleton ──────────────────────────────────────────────────────────────────
const KineticRack = (() => {
    let _renderer, _scene, _camera, _composer, _clock;
    let _bgMesh, _bgUniforms, _videoTex;
    let _camVideo, _hands, _handsResults;
    let _raf, _active = false;
    let _instruments = {}, _currentInstr = null, _instrName = 'CYBER_HANGDRUM';

    function _status(msg, live) {
        const el = document.getElementById('kr-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('kr-live', !!live);
    }

    function _getStageSize() {
        return {
            W: window.innerWidth  - 400,   // left:200 + right:200
            H: window.innerHeight - 100    // top:45  + bottom:55
        };
    }

    function _setup() {
        const canvas = document.getElementById('kinetic-canvas');
        const { W, H } = _getStageSize();

        _renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        _renderer.setSize(W, H);
        _renderer.outputColorSpace = THREE.SRGBColorSpace;
        _renderer.toneMapping = THREE.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.1;

        _camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 200);
        _camera.position.set(0, 0, 5);

        _scene = new THREE.Scene();
        _scene.background = new THREE.Color(0x000000);
        _clock = new THREE.Clock();

        _composer = new EffectComposer(_renderer);
        _composer.addPass(new RenderPass(_scene, _camera));
        const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 1.8, 0.5, 0.15);
        _composer.addPass(bloom);
        _composer.addPass(new ShaderPass(GammaCorrectionShader));

        window.addEventListener('resize', () => {
            if (!_renderer) return;
            const { W: w, H: h } = _getStageSize();
            _renderer.setSize(w, h);
            _camera.aspect = w / h;
            _camera.updateProjectionMatrix();
            _composer.setSize(w, h);
            _buildBg(w, h);
        });
    }

    function _buildBg(W, H) {
        if (_bgMesh) { _scene.remove(_bgMesh); _bgMesh.geometry.dispose(); _bgMesh.material.dispose(); }
        const dist  = _camera.position.z + 5; // camera z=5, plane z=-5
        const halfH = Math.tan(THREE.MathUtils.degToRad(30)) * dist;
        const halfW = halfH * (W / H);
        _bgUniforms = { uCam: { value: _videoTex }, uTime: { value: 0 } };
        _bgMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(halfW * 2 + 2, halfH * 2 + 2),
            new THREE.ShaderMaterial({ uniforms: _bgUniforms, vertexShader: VOID_VERT, fragmentShader: VOID_FRAG, depthWrite: false })
        );
        _bgMesh.position.z = -5;
        _bgMesh.renderOrder = -1;
        _scene.add(_bgMesh);
    }

    async function _startCam() {
        _camVideo = document.getElementById('kinetic-cam-video');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false });
        _camVideo.srcObject = stream;
        await _camVideo.play();
        _videoTex = new THREE.VideoTexture(_camVideo);
        _videoTex.colorSpace = THREE.SRGBColorSpace;
    }

    async function _startHands() {
        await new Promise((res, rej) => {
            if (window.Hands) return res();
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
            s.crossOrigin = 'anonymous';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        _hands = new window.Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
        _hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
        _hands.onResults(r => { _handsResults = r; });
        const feed = async () => {
            if (!_active) return;
            if (_camVideo && _camVideo.readyState >= 2) await _hands.send({ image: _camVideo }).catch(() => {});
            requestAnimationFrame(feed);
        };
        feed();
    }

    async function _buildInstruments() {
        const ctx = (window.APP && APP.audio && APP.audio.ctx) ? APP.audio.ctx : new (window.AudioContext || window.webkitAudioContext)();
        _instruments = {
            CYBER_HANGDRUM: new CyberHangdrum(_scene, ctx),
            NEURAL_GLITCH:  new NeuralGlitch(_scene, ctx),
            TETHER_VERLET:  new TetherVerlet(_scene, ctx)
        };
        await Promise.all(Object.values(_instruments).map(i => i.init()));
        _currentInstr = _instruments[_instrName];
        _currentInstr.activate();
    }

    function _loop() {
        if (!_active) return;
        _raf = requestAnimationFrame(_loop);
        const t = _clock.getElapsedTime();
        if (_bgUniforms) _bgUniforms.uTime.value = t;
        if (_currentInstr) _currentInstr.update(_handsResults, t, _camera);
        _composer.render();
    }

    // ── Public ─────────────────────────────────────────────────────────────────
    async function toggle() {
        if (_active) {
            _active = false;
            cancelAnimationFrame(_raf);
            Object.values(_instruments).forEach(i => i.deactivate && i.deactivate());
            document.getElementById('kinetic-canvas').classList.remove('kr-online');
            document.getElementById('kr-launch-btn').classList.remove('kr-online');
            document.getElementById('kr-rack').classList.remove('kr-online');
            _status('OFFLINE');
            return;
        }
        _active = true;
        _status('INIT CAMERA...');
        try {
            await _startCam();
            _status('BUILDING PIPELINE...');
            _setup();
            const { W, H } = _getStageSize();
            _buildBg(W, H);
            _status('LOADING INSTRUMENTS...');
            await _buildInstruments();
            _status('LOADING HANDS...');
            await _startHands();
            document.getElementById('kinetic-canvas').classList.add('kr-online');
            document.getElementById('kr-launch-btn').classList.add('kr-online');
            document.getElementById('kr-rack').classList.add('kr-online');
            _status(_instrName + ' // ONLINE', true);
            _loop();
        } catch (e) {
            console.error('[KineticRack]', e);
            _status('ERROR: ' + e.message);
            _active = false;
        }
    }

    function setInstrument(name) {
        if (!_instruments[name]) return;
        if (_currentInstr) _currentInstr.deactivate && _currentInstr.deactivate();
        _instrName = name;
        _currentInstr = _instruments[name];
        _currentInstr.activate();
        document.querySelectorAll('.kr-btn').forEach(b => b.classList.remove('kr-sel'));
        const ids = { CYBER_HANGDRUM: 'kr-btn-cyber-hangdrum', NEURAL_GLITCH: 'kr-btn-neural-glitch', TETHER_VERLET: 'kr-btn-tether-verlet' };
        document.getElementById(ids[name])?.classList.add('kr-sel');
        document.getElementById('kr-tether-modes').style.display = name === 'TETHER_VERLET' ? 'flex' : 'none';
        if (_active) _status(name + ' // ONLINE', true);
    }

    function setTetherMode(mode) {
        if (_instruments.TETHER_VERLET) _instruments.TETHER_VERLET.setMode(mode);
        document.querySelectorAll('.kr-sub-btn').forEach(b => b.classList.toggle('kr-sel', b.dataset.mode === mode));
    }

    return { toggle, setInstrument, setTetherMode };
})();

window.KineticRack = KineticRack;
