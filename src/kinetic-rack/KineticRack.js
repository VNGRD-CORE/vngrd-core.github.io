// KineticRack — 4K Optimized AR Engine (v2.0 - 2026)
// No static deps, sets window.KineticRack immediately

const KineticRack = (() => {
    let T; // THREE namespace
    let _renderer, _scene, _camera, _composer, _clock;
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
        const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
        const { RenderPass }     = await import('three/addons/postprocessing/RenderPass.js');
        const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
        const { ShaderPass }      = await import('three/addons/postprocessing/ShaderPass.js');
        
        const GammaShader = {
            uniforms: { tDiffuse: { value: null } },
            vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
            fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
                void main(){ vec4 c=texture2D(tDiffuse,vUv); gl_FragColor=vec4(pow(max(c.rgb,vec3(0.0)),vec3(1.0/2.2)),c.a); }`
        };
        return { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, GammaShader };
    }

    function _stageSize() {
        // Full screen minus sidebar width
        return { W: window.innerWidth - 400, H: window.innerHeight - 100 };
    }

    function _setup({ EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, GammaShader }) {
        const canvas = document.getElementById('kinetic-canvas');
        const { W, H } = _stageSize();
        
        // Anti-alias: true (Removes jagged edges)
        // Alpha: true (Allows 4K camera to show through)
        _renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
        _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        _renderer.setSize(W, H);
        _renderer.outputColorSpace = T.SRGBColorSpace;
        _renderer.toneMapping = T.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.25; // Professional cinematic glow

        _camera = new T.PerspectiveCamera(60, W / H, 0.1, 200);
        _camera.position.set(0, 0, 5);
        
        _scene = new T.Scene();
        _scene.background = null; // Fixes the "Red Line" crash and enables AR
        
        _clock = new T.Clock();

        _composer = new EffectComposer(_renderer);
        _composer.addPass(new RenderPass(_scene, _camera));
        
        // High-end Unreal Bloom for floating neon look
        _composer.addPass(new UnrealBloomPass(new T.Vector2(W, H), 1.6, 0.4, 0.88));
        _composer.addPass(new ShaderPass(GammaShader));

        window.addEventListener('resize', () => {
            const { W: w, H: h } = _stageSize();
            _renderer.setSize(w, h);
            _camera.aspect = w / h;
            _camera.updateProjectionMatrix();
            _composer.setSize(w, h);
        });
    }

    async function _initInstruments() {
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
        
        for (const i in _instruments) await _instruments[i].init();
    }

    function _loop() {
        if (!_active) return;
        _raf = requestAnimationFrame(_loop);
        const t = _clock.getElapsedTime();
        
        if (_currentInstr) {
            // Passes MediaPipe hand data directly to the instrument for precision tracking
            _currentInstr.update(_handsResults, t, _camera);
        }
        _composer.render();
    }

    return {
        async launch() {
            if (_active) return;
            _status('INITIALIZING AR...');
            const deps = await _loadDeps();
            _setup(deps);
            await _initInstruments();
            _active = true;
            this.setInstrument(_instrName);
            _loop();
            _status('KINETIC // ONLINE', true);
        },
        setInstrument(name) {
            if (_currentInstr) _currentInstr.deactivate();
            _instrName = name;
            _currentInstr = _instruments[name];
            if (_currentInstr) _currentInstr.activate();
            _status(`MODE: ${name}`, true);
        },
        updateHands(results) {
            _handsResults = results;
        }
    };
})();

window.KineticRack = KineticRack;