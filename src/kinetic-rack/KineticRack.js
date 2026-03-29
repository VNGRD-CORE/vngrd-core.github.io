// KineticRack — dynamic imports, no static deps, sets window.KineticRack immediately

const VOID_VERT = `varying vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

// AR Void: subtle processing — user stays clearly visible, instruments glow against it
const VOID_FRAG = `uniform sampler2D uCam; uniform float uTime; varying vec2 vUv;
void main(){
    vec4 cam = texture2D(uCam, vec2(1.0 - vUv.x, vUv.y));
    vec3 c = cam.rgb;
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    // 70% saturation — user looks like they're in the scene
    c = mix(vec3(lum), c, 0.7);
    // Very subtle cold tint (barely noticeable)
    c *= vec3(0.88, 0.94, 1.0);
    // Slight darken so instrument glows pop
    c *= 0.78;
    gl_FragColor = vec4(c, 1.0);
}`;

const KineticRack = (() => {
    let T;
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

    async function _loadDeps() {
        _status('LOADING THREE.JS...');
        T = await import('three');
        const { EffectComposer }  = await import('three/addons/postprocessing/EffectComposer.js');
        const { RenderPass }      = await import('three/addons/postprocessing/RenderPass.js');
        const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
        const { ShaderPass }      = await import('three/addons/postprocessing/ShaderPass.js');
        const GammaShader = {
            uniforms: { tDiffuse: { value: null } },
            vertexShader:   `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
            fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
                void main(){ vec4 c=texture2D(tDiffuse,vUv); gl_FragColor=vec4(pow(max(c.rgb,vec3(0.0)),vec3(1.0/2.2)),c.a); }`
        };
        return { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, GammaShader };
    }

    function _stageSize() {
        return { W: window.innerWidth - 400, H: window.innerHeight - 100 };
    }

    function _setup({ EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, GammaShader }) {
        const canvas = document.getElementById('kinetic-canvas');
        const { W, H } = _stageSize();
        _renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        _renderer.setSize(W, H);
        _renderer.outputColorSpace = T.SRGBColorSpace;
        _renderer.toneMapping = T.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 0.95;

        _camera = new T.PerspectiveCamera(60, W / H, 0.1, 200);
        _camera.position.set(0, 0, 5);
        _scene = new T.Scene();
        _scene.background = new T.Color(0x000000);
        _clock = new T.Clock();

        _composer = new EffectComposer(_renderer);
        _composer.addPass(new RenderPass(_scene, _camera));
        // Bloom: LOW strength, HIGH threshold — only super-bright instrument hits bloom
        // Camera feed stays at ~0.78 brightness so it never crosses threshold
        _composer.addPass(new UnrealBloomPass(new T.Vector2(W, H), 0.7, 0.4, 0.55));
        _composer.addPass(new ShaderPass(GammaShader));

        window.addEventListener('resize', () => {
            const { W: w, H: h } = _stageSize();
            _renderer.setSize(w, h);
            _camera.aspect = w / h;
            _camera.updateProjectionMatrix();
            _composer.setSize(w, h);
            _buildBg(w, h);
        });
    }

    function _buildBg(W, H) {
        if (_bgMesh) { _scene.remove(_bgMesh); _bgMesh.geometry.dispose(); _bgMesh.material.dispose(); }
        const dist  = 10;
        const halfH = Math.tan(T.MathUtils.degToRad(30)) * dist;
        const halfW = halfH * (W / H);
        _bgUniforms = { uCam: { value: _videoTex }, uTime: { value: 0 } };
        _bgMesh = new T.Mesh(
            new T.PlaneGeometry(halfW * 2 + 2, halfH * 2 + 2),
            new T.ShaderMaterial({ uniforms: _bgUniforms, vertexShader: VOID_VERT, fragmentShader: VOID_FRAG, depthWrite: false })
        );
        _bgMesh.position.z = -5;
        _bgMesh.renderOrder = -1;
        _scene.add(_bgMesh);
    }

    async function _startCam() {
        _status('CAMERA...');
        _camVideo = document.getElementById('kinetic-cam-video');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
        _camVideo.srcObject = stream;
        await _camVideo.play();
        _videoTex = new T.VideoTexture(_camVideo);
        _videoTex.colorSpace = T.SRGBColorSpace;
    }

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
        const feed = async () => {
            if (!_active) return;
            if (_camVideo && _camVideo.readyState >= 2) await _hands.send({ image: _camVideo }).catch(() => {});
            requestAnimationFrame(feed);
        };
        feed();
    }

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

    function _loop() {
        if (!_active) return;
        _raf = requestAnimationFrame(_loop);
        const t = _clock.getElapsedTime();
        if (_bgUniforms) _bgUniforms.uTime.value = t;
        if (_currentInstr) _currentInstr.update(_handsResults, t, _camera);
        _composer.render();
    }

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
        document.getElementById('kr-launch-btn').classList.add('kr-online');
        try {
            const deps = await _loadDeps();
            await _startCam();
            _status('BUILDING PIPELINE...');
            _setup(deps);
            const { W, H } = _stageSize();
            _buildBg(W, H);
            await _buildInstruments();
            await _startHands();
            document.getElementById('kinetic-canvas').classList.add('kr-online');
            document.getElementById('kr-rack').classList.add('kr-online');
            _status(_instrName + ' // ONLINE', true);
            _loop();
        } catch (e) {
            console.error('[KineticRack]', e);
            _status('ERR: ' + e.message.slice(0, 40));
            _active = false;
            document.getElementById('kr-launch-btn').classList.remove('kr-online');
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
        if (_active) _status(name + ' // ONLINE', true);
    }

    function setTetherMode(mode) {
        if (_instruments.TETHER_VERLET) _instruments.TETHER_VERLET.setMode(mode);
        document.querySelectorAll('.kr-sub-btn').forEach(b => b.classList.toggle('kr-sel', b.dataset.mode === mode));
    }

    return { toggle, setInstrument, setTetherMode };
})();

window.KineticRack = KineticRack;
