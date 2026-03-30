/**
 * KineticRack.js — Zero-latency hand-tracking audio-visual instrument
 *
 * TRACKING:  @mediapipe/tasks-vision HandLandmarker, delegate: GPU
 *   - Hidden 256×256 video (kr-ai-video) for AI inference at 60+ FPS
 *
 * AUDIO:     Tone.js (window.Tone via CDN script tag)
 *   - MembraneSynth  → kick (right-hand index-finger velocity)
 *   - FMSynth        → deep drone (left-hand X/Y → pitch + AutoFilter)
 *   - AutoFilter LFO → on drone path
 *   - Kit synths     → glitch / hi-hat (left-hand pinch → cycle kits)
 *
 * VISUAL:    THREE.Points + custom GLSL ShaderMaterial
 *   - 3 000 particle field; hand landmarks = gravity wells
 *   - Particles are attracted to hands, not literal hand shapes
 */

import * as THREE from 'three';
import { GravityParticles } from './FluidHands.js';
import { TetherVerlet }     from './TetherVerlet.js';
import { AudioEngine }      from './AudioEngine.js';

const KineticRack = (() => {
    'use strict';

    // ── MediaPipe CDN ─────────────────────────────────────────────────────────
    const TASKS_CDN  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
    const WASM_PATH  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
    const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

    // ── State ─────────────────────────────────────────────────────────────────
    let _active   = false;
    let _raf      = null;
    let _renderer, _scene, _camera, _clock;

    let _ae         = null;    // AudioEngine
    let _particles  = null;    // GravityParticles
    let _tether     = null;    // TetherVerlet

    let _camVideo   = null;    // display video
    let _aiVideo    = null;    // hidden 256×256 inference video
    let _handLandmarker = null;
    let _lastTs     = -1;

    // Gesture state
    let _prevIndexPos = null;
    let _kickCool     = 0;
    let _prevPinchD   = 1;
    let _pinchCool    = 0;

    // MIDI
    let _midiLearning  = null;
    const _midiBindings = {};

    // Recording
    let _recorder  = null;
    let _recording = false;

    // ── Status ────────────────────────────────────────────────────────────────
    function _status(msg, live = false) {
        const el = document.getElementById('kr-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('kr-live', live);
    }

    // ── Coordinate helpers ────────────────────────────────────────────────────
    /**
     * Convert a normalised MediaPipe landmark {x,y} to Three.js world-space.
     * x is negated to mirror the camera image.
     */
    function _lm2w(lm, cam) {
        const ndc = new THREE.Vector3(-(lm.x * 2 - 1), -(lm.y * 2 - 1), 0.5);
        ndc.unproject(cam);
        const dir  = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    function _handWorld(lms, cam) {
        return lms.map(lm => _lm2w(lm, cam));
    }

    /**
     * Extract [leftWorldPts, rightWorldPts] from HandLandmarker result.
     * MediaPipe labels 'Right' in mirrored view = user's actual left hand.
     */
    function _extractHands(result, cam) {
        if (!result?.landmarks?.length) return [null, null];
        let leftW = null, rightW = null;
        result.landmarks.forEach((lms, i) => {
            const label = result.handedness?.[i]?.[0]?.categoryName;
            const world = _handWorld(lms, cam);
            if (label === 'Right') leftW  = world;   // mirrored → user left
            else                   rightW = world;
        });
        // If only one hand detected, assign as right (modulate hand)
        if (!leftW && !rightW && result.landmarks[0]) {
            rightW = _handWorld(result.landmarks[0], cam);
        }
        return [leftW, rightW];
    }

    // ── Three.js setup ────────────────────────────────────────────────────────
    function _setupScene() {
        const canvas = document.getElementById('kinetic-canvas');
        _renderer = new THREE.WebGLRenderer({
            canvas,
            alpha:            true,
            antialias:        false,
            powerPreference:  'high-performance',
        });
        _renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        _renderer.setSize(window.innerWidth, window.innerHeight);
        _renderer.toneMapping         = THREE.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.4;
        _renderer.setClearColor(0x000000, 0);

        _scene  = new THREE.Scene();
        _camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 100);
        _camera.position.set(0, 0, 2.5);

        _scene.add(new THREE.AmbientLight(0x050515, 1.0));

        window.addEventListener('resize', _onResize);
    }

    function _onResize() {
        if (!_renderer) return;
        _camera.aspect = window.innerWidth / window.innerHeight;
        _camera.updateProjectionMatrix();
        _renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ── Camera ────────────────────────────────────────────────────────────────
    async function _startCam() {
        _status('CAMERA...');
        _camVideo = document.getElementById('kinetic-cam-video');
        _aiVideo  = document.getElementById('kr-ai-video');

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: 'user' },
            audio: false,
        });

        // Both videos share the same stream; ai-video is capped to 256×256 in CSS/HTML
        _camVideo.srcObject = stream;
        _aiVideo.srcObject  = stream;

        await Promise.all([
            new Promise(res => { _camVideo.onloadedmetadata = res; }),
            new Promise(res => { _aiVideo.onloadedmetadata  = res; }),
        ]);
        await Promise.all([
            _camVideo.play().catch(() => {}),
            _aiVideo.play().catch(() => {}),
        ]);

        _camVideo.classList.add('kr-online');
    }

    // ── HandLandmarker (tasks-vision GPU) ─────────────────────────────────────
    async function _startHandLandmarker() {
        _status('LOADING HAND MODEL...');
        const { HandLandmarker, FilesetResolver } = await import(TASKS_CDN);

        const filesetResolver = await FilesetResolver.forVisionTasks(WASM_PATH);

        _handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: MODEL_URL,
                delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence:  0.5,
            minTrackingConfidence:      0.5,
        });
    }

    // ── Gesture processing ────────────────────────────────────────────────────
    function _processGestures(leftW, rightW) {
        const now = performance.now();

        // ── Right hand: index-finger velocity → kick ──────────────────────────
        if (rightW) {
            const index = rightW[8];   // index fingertip
            if (_prevIndexPos) {
                const dx    = index.x - _prevIndexPos.x;
                const dy    = index.y - _prevIndexPos.y;
                const speed = Math.sqrt(dx * dx + dy * dy);
                if (speed > 0.038 && now > _kickCool) {
                    _kickCool = now + 180;
                    _ae?.triggerKick(Math.min(1, speed * 14));
                }
            }
            _prevIndexPos = index.clone();
        } else {
            _prevIndexPos = null;
        }

        // ── Left hand: X/Y → drone + filter; pinch → switch kit ──────────────
        if (leftW) {
            const wrist = leftW[0];

            // Map wrist world-space X (≈ -1.5..1.5) → 0..1
            const nx = THREE.MathUtils.clamp((wrist.x + 1.5) / 3,    0, 1);
            // Map wrist world-space Y (≈ 1.2..-1.2) → 0..1 (hand up = 1)
            const ny = THREE.MathUtils.clamp(1 - (wrist.y + 1.2) / 2.4, 0, 1);

            _ae?.setDronePitch(nx);
            _ae?.setAutoFilterFreq(ny);

            // Pinch: thumb tip (4) ↔ index tip (8)
            const thumb = leftW[4];
            const index = leftW[8];
            const d     = thumb.distanceTo(index);
            if (_prevPinchD > 0.12 && d < 0.07 && now > _pinchCool) {
                _pinchCool = now + 600;
                _ae?.switchKit();
                _ae?.triggerKit(0.7);
            }
            _prevPinchD = d;
        } else {
            _prevPinchD = 1;
        }
    }

    // ── Render loop ───────────────────────────────────────────────────────────
    async function _loop() {
        if (!_active) return;
        _raf = requestAnimationFrame(_loop);

        const dt      = _clock.getDelta();
        const elapsed = _clock.getElapsedTime();
        const now     = performance.now();

        // HandLandmarker: synchronous inference on the hidden AI video
        let result = null;
        if (_handLandmarker && _aiVideo?.readyState >= 2 && now > _lastTs) {
            try {
                result   = _handLandmarker.detectForVideo(_aiVideo, now);
                _lastTs  = now;
            } catch (_e) { /* GPU not ready on first frames */ }
        }

        const [leftW, rightW] = result
            ? _extractHands(result, _camera)
            : [null, null];

        // Gesture → audio
        _processGestures(leftW, rightW);

        // Build gravity-well positions: palm + fingertips of each hand
        const wells = [];
        if (leftW) {
            [0, 4, 8, 12, 16, 20].forEach(idx => wells.push({ pos: leftW[idx], hand: 'left' }));
        }
        if (rightW) {
            [0, 4, 8, 12, 16, 20].forEach(idx => wells.push({ pos: rightW[idx], hand: 'right' }));
        }

        _particles?.update(wells, dt, elapsed);

        _tether?.update(
            leftW  ? leftW[0]  : null,
            rightW ? rightW[0] : null,
            dt, elapsed
        );

        _renderer.render(_scene, _camera);
    }

    // ── MIDI ──────────────────────────────────────────────────────────────────
    function _initMidi() {
        if (!navigator.requestMIDIAccess) return;
        navigator.requestMIDIAccess().then(access => {
            access.inputs.forEach(p => { p.onmidimessage = _onMIDI; });
            access.onstatechange = e => {
                if (e.port.type === 'input' && e.port.state === 'connected') {
                    e.port.onmidimessage = _onMIDI;
                }
            };
        }).catch(() => {});
    }

    function _onMIDI(e) {
        const [st, cc, val] = e.data;
        if ((st & 0xf0) !== 0xb0) return;
        const v = val / 127;
        if (_midiLearning) {
            _midiBindings[_midiLearning] = cc;
            document.querySelector(`.kr-ctrl-learn[data-ctrl="${_midiLearning}"]`)
                ?.classList.remove('kr-learning');
            _midiLearning = null;
            return;
        }
        for (const [ctrl, bcc] of Object.entries(_midiBindings)) {
            if (bcc === cc) {
                ctrlChange(ctrl, v);
                const s = document.querySelector(`.kr-ctrl-slider[data-ctrl="${ctrl}"]`);
                if (s) s.value = v;
            }
        }
    }

    // ── Recording ─────────────────────────────────────────────────────────────
    function _startRec() {
        const vs   = document.getElementById('kinetic-canvas').captureStream(60);
        const dest  = _ae?.getRecordingDest?.();
        if (dest) dest.stream.getAudioTracks().forEach(t => vs.addTrack(t));
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus' : 'video/webm';
        _recorder = new MediaRecorder(vs, { mimeType: mime, videoBitsPerSecond: 12e6 });
        const chunks = [];
        _recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        _recorder.onstop = () => {
            const a = Object.assign(document.createElement('a'), {
                href:     URL.createObjectURL(new Blob(chunks, { type: mime })),
                download: `vngrd-${Date.now()}.webm`,
            });
            a.click();
            _ae?.releaseRecordingDest?.(dest);
        };
        _recorder.start();
        _recording = true;
        document.getElementById('kr-rec-btn')?.classList.add('kr-recording');
    }

    function _stopRec() {
        if (_recorder?.state !== 'inactive') _recorder.stop();
        _recording = false;
        document.getElementById('kr-rec-btn')?.classList.remove('kr-recording');
    }

    // ── Toggle ────────────────────────────────────────────────────────────────
    async function toggle() {
        if (_active) {
            _active = false;
            cancelAnimationFrame(_raf);
            window.removeEventListener('resize', _onResize);
            if (_recording) _stopRec();
            _tether?.deactivate();
            _particles?.dispose();
            _ae?.dispose();
            _handLandmarker?.close();
            _handLandmarker = null;
            _prevIndexPos   = null;

            ['kinetic-canvas', 'kr-launch-btn', 'kr-rack', 'kinetic-cam-video'].forEach(id =>
                document.getElementById(id)?.classList.remove('kr-online')
            );
            document.getElementById('kr-stage-hud')?.classList.remove('kr-live');
            _status('OFFLINE');
            return;
        }

        _active = true;
        document.getElementById('kr-launch-btn')?.classList.add('kr-online');
        _status('STARTING...');

        try {
            // Scene first
            _setupScene();

            // Camera
            await _startCam();

            // Audio (requires user gesture — already inside click handler)
            _ae = new AudioEngine();
            await _ae.init();

            // Particles + Tether
            _particles = new GravityParticles(_scene, THREE);
            _tether    = new TetherVerlet(_scene, _ae);
            _tether.init();
            _tether.activate();

            // HandLandmarker
            await _startHandLandmarker();

            // MIDI
            _initMidi();

            document.getElementById('kinetic-canvas')?.classList.add('kr-online');
            document.getElementById('kr-rack')?.classList.add('kr-online');
            document.getElementById('kr-stage-hud')?.classList.add('kr-live');
            _status('GRAVITY TETHER // LIVE', true);

            _clock = new THREE.Clock();
            _loop();
        } catch (err) {
            console.error('[KineticRack]', err);
            _status('ERROR: ' + (err?.message ?? String(err)));
            _active = false;
            document.getElementById('kr-launch-btn')?.classList.remove('kr-online');
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function ctrlChange(id, val) {
        const v = parseFloat(val);
        if (id === 'vol')    _ae?.setVolume(v);
        if (id === 'reverb') _ae?.setReverbMix(v);
        if (id === 'filter') _ae?.setManualFilter(v);
    }

    function midiLearn(ctrlId) {
        _midiLearning = ctrlId;
        document.querySelectorAll('.kr-ctrl-learn').forEach(b => b.classList.remove('kr-learning'));
        document.querySelector(`.kr-ctrl-learn[data-ctrl="${ctrlId}"]`)?.classList.add('kr-learning');
        setTimeout(() => {
            if (_midiLearning === ctrlId) {
                _midiLearning = null;
                document.querySelector(`.kr-ctrl-learn[data-ctrl="${ctrlId}"]`)
                    ?.classList.remove('kr-learning');
            }
        }, 10_000);
    }

    function toggleRecording() { _recording ? _stopRec() : _startRec(); }

    function toggleHelp() {
        const m = document.getElementById('kr-help-modal');
        if (!m) return;
        document.getElementById('kr-help-body').innerHTML = `
          <div class="kr-help-line">GRAVITY TETHER — GPU AR Instrument</div>
          <div class="kr-help-line">────────────────────────────────────</div>
          <div class="kr-help-line">LEFT HAND  →  drone + filter</div>
          <div class="kr-help-line">  X-axis  →  drone pitch (A1…A3)</div>
          <div class="kr-help-line">  Y-axis  →  auto-filter cutoff</div>
          <div class="kr-help-line">  Pinch ✌ →  cycle kit + trigger</div>
          <div class="kr-help-line">RIGHT HAND →  kick trigger</div>
          <div class="kr-help-line">  Snap / flick index → kick drum</div>
          <div class="kr-help-line">────────────────────────────────────</div>
          <div class="kr-help-line">TETHER     →  stretch both wrists</div>
          <div class="kr-help-line">PARTICLES  →  gravity wells follow</div>
          <div class="kr-help-line">  your hands, shaping space itself</div>
        `;
        m.style.display = (!m.style.display || m.style.display === 'none') ? 'flex' : 'none';
    }

    return { toggle, ctrlChange, midiLearn, toggleRecording, toggleHelp };
})();

window.KineticRack = KineticRack;
