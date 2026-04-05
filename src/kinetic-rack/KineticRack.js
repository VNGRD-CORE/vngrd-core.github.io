/**
 * KineticRack.js — Spatial Synth Orchestrator
 *
 * TRACKING:  MediaPipe HandLandmarker (GPU delegate, 2 hands, 21 landmarks)
 * LERP:      All raw hand data smoothed at factor 0.15 before hitting audio/visuals
 *
 * GESTURE → AUDIO mapping:
 *   Left hand snap (fast downward)  → 808 kick trigger
 *   Left hand pinch (thumb↔index)   → toggle armed step in NeuralComposer
 *   Left hand visible               → SpatialSynth volume gate open
 *   Right hand palm X               → SpatialSynth pitch (granular position)
 *   Right hand palm Y               → SpatialSynth filter cutoff
 *
 * MODULES:
 *   AudioEngine    — Master audio graph + hard limiter
 *   NeuralComposer — 8-track 16-step sequencer
 *   SpatialSynth   — 3D DSP field instrument (replaces TetherVerlet)
 *   GravityParticles — GPU particle trails
 */

import * as THREE from 'three';
import { GravityParticles } from './FluidHands.js';
import { SpatialSynth }     from './SpatialSynth.js';
import { AudioEngine }      from './AudioEngine.js';
import { NeuralComposer }   from './NeuralComposer.js';
import { GestureLooper }    from './GestureLooper.js';

const KineticRack = (() => {
    'use strict';

    // ── MediaPipe CDN ─────────────────────────────────────────────────────────
    const TASKS_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
    const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
    const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

    // ── LERP factor — all hand data passes through this ──────────────────────
    const LERP = 0.15;

    // ── State ─────────────────────────────────────────────────────────────────
    let _active  = false;
    let _raf     = null;
    let _renderer, _scene, _camera, _clock;

    let _ae         = null;   // AudioEngine
    let _nc         = null;   // NeuralComposer
    let _spatial    = null;   // SpatialSynth
    let _particles  = null;   // GravityParticles
    let _looper     = null;   // GestureLooper

    let _camVideo   = null;
    let _aiVideo    = null;
    let _handLandmarker = null;
    let _lastTs     = -1;

    // Smoothed landmark state (after LERP)
    const _smooth = {
        leftWrist:  new THREE.Vector3(),
        rightWrist: new THREE.Vector3(),
        rightPalmX: 0.5,
        rightPalmY: 0.5,
        leftVisible:  false,
        rightVisible: false,
    };

    // Raw previous-frame values for velocity calculation
    let _prevLeftWrist  = null;
    let _prevRightWrist = null;

    // Gesture cooldowns
    let _kickCool  = 0;
    let _pinchCool = 0;
    let _prevPinchD = 1;

    // MIDI
    let _midiLearning   = null;
    const _midiBindings = {};

    // Recording
    let _recorder  = null;
    let _recording = false;

    // ── Status helper ─────────────────────────────────────────────────────────
    function _status(msg, live = false) {
        const el = document.getElementById('kr-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('kr-live', live);
    }

    // ── Coordinate helpers ────────────────────────────────────────────────────
    function _lm2w(lm, cam) {
        const ndc = new THREE.Vector3(-(lm.x * 2 - 1), -(lm.y * 2 - 1), 0.5);
        ndc.unproject(cam);
        const dir  = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    function _extractHands(result) {
        if (!result?.landmarks?.length) return [null, null];
        let leftLms = null, rightLms = null;
        result.landmarks.forEach((lms, i) => {
            const label = result.handedness?.[i]?.[0]?.categoryName;
            if (label === 'Right') leftLms  = lms;   // mirrored → user left
            else                   rightLms = lms;
        });
        if (!leftLms && !rightLms && result.landmarks[0]) {
            rightLms = result.landmarks[0];
        }
        return [leftLms, rightLms];
    }

    // ── LERP-smoothed hand state update ───────────────────────────────────────
    /**
     * Applies LERP (factor 0.15) to all raw landmark data before any
     * audio or visual system receives it. This prevents clicks/scratches.
     */
    function _applyLerp(leftLms, rightLms) {
        _smooth.leftVisible  = !!leftLms;
        _smooth.rightVisible = !!rightLms;

        if (leftLms) {
            const wrist = _lm2w(leftLms[0], _camera);
            _smooth.leftWrist.lerp(wrist, LERP);
        }

        if (rightLms) {
            const wrist = _lm2w(rightLms[0], _camera);
            _smooth.rightWrist.lerp(wrist, LERP);

            // Palm X/Y: use wrist landmark normalised coords (already 0..1)
            const rawX = THREE.MathUtils.clamp((rightLms[0].x), 0, 1);
            const rawY = THREE.MathUtils.clamp(1 - rightLms[0].y, 0, 1);
            _smooth.rightPalmX += (rawX - _smooth.rightPalmX) * LERP;
            _smooth.rightPalmY += (rawY - _smooth.rightPalmY) * LERP;
        }
    }

    // ── Gesture processing (uses smoothed state) ──────────────────────────────
    function _processGestures(leftLms, rightLms) {
        const now = performance.now();

        // ── Left hand: snap → kick; pinch → NeuralComposer ───────────────────
        if (leftLms) {
            const wrist = _lm2w(leftLms[0], _camera);

            // Snap detection: fast downward movement of the wrist
            if (_prevLeftWrist) {
                const dy    = wrist.y - _prevLeftWrist.y;   // negative = moving down
                const speed = Math.abs(dy);
                if (dy < -0.032 && speed > 0.032 && now > _kickCool) {
                    _kickCool = now + 200;
                    _ae?.triggerKick(Math.min(1, speed * 18));
                }
            }
            _prevLeftWrist = wrist.clone();

            // Pinch: thumb tip (4) ↔ index tip (8)
            const thumbW = _lm2w(leftLms[4], _camera);
            const indexW = _lm2w(leftLms[8], _camera);
            const d = thumbW.distanceTo(indexW);
            if (_prevPinchD > 0.10 && d < 0.065 && now > _pinchCool) {
                _pinchCool = now + 600;
                _nc?.toggleArmedStep();
            }
            _prevPinchD = d;

        } else {
            _prevLeftWrist = null;
            _prevPinchD    = 1;
        }
    }

    // ── Three.js setup ────────────────────────────────────────────────────────
    function _setupScene() {
        const canvas = document.getElementById('kinetic-canvas');
        _renderer = new THREE.WebGLRenderer({
            canvas,
            alpha:           true,
            antialias:       false,
            powerPreference: 'high-performance',
        });
        _renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        _renderer.setSize(window.innerWidth, window.innerHeight);
        _renderer.toneMapping         = THREE.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.4;
        _renderer.setClearColor(0x000000, 0);   // alpha:true → transparent over camera

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

        _camVideo.srcObject = stream;
        _aiVideo.srcObject  = stream;

        await Promise.all([
            new Promise(r => { _camVideo.onloadedmetadata = r; }),
            new Promise(r => { _aiVideo.onloadedmetadata  = r; }),
        ]);
        await Promise.all([
            _camVideo.play().catch(() => {}),
            _aiVideo.play().catch(() => {}),
        ]);

        _camVideo.classList.add('kr-online');
    }

    // ── HandLandmarker ────────────────────────────────────────────────────────
    async function _startHandLandmarker() {
        _status('LOADING HAND MODEL...');
        const { HandLandmarker, FilesetResolver } = await import(TASKS_CDN);

        const fsr = await FilesetResolver.forVisionTasks(WASM_PATH);
        _handLandmarker = await HandLandmarker.createFromOptions(fsr, {
            baseOptions:                  { modelAssetPath: MODEL_URL, delegate: 'GPU' },
            runningMode:                  'VIDEO',
            numHands:                     2,
            minHandDetectionConfidence:   0.6,
            minHandPresenceConfidence:    0.5,
            minTrackingConfidence:        0.5,
        });
    }

    // ── Render loop ───────────────────────────────────────────────────────────
    async function _loop() {
        if (!_active) return;
        _raf = requestAnimationFrame(_loop);

        const dt      = _clock.getDelta();
        const elapsed = _clock.getElapsedTime();
        const now     = performance.now();

        // ── Hand inference ─────────────────────────────────────────────────
        let result = null;
        if (_handLandmarker && _aiVideo?.readyState >= 2 && now > _lastTs) {
            try {
                result  = _handLandmarker.detectForVideo(_aiVideo, now);
                _lastTs = now;
            } catch (_) {}
        }

        const [leftLms, rightLms] = result
            ? _extractHands(result)
            : [null, null];

        // ── LERP smoothing (MUST happen before any audio/visual use) ───────
        _applyLerp(leftLms, rightLms);

        // ── Gesture processing (uses raw lms for velocity, but reads _smooth) ─
        _processGestures(leftLms, rightLms);

        // ── GestureLooper: right hand index pinch → record/replay loops ────
        _looper?.update(rightLms, _camera);

        // ── SpatialSynth: smoothed right palm XY + left gate ───────────────
        _spatial?.update(
            _smooth.rightVisible ? _smooth.rightPalmX : null,
            _smooth.rightVisible ? _smooth.rightPalmY : null,
            _smooth.leftVisible,
            elapsed
        );

        // ── Particle trails: emit at palm positions ────────────────────────
        const wells = [];
        if (_smooth.leftVisible) {
            wells.push({ pos: _smooth.leftWrist.clone(),  hand: 'left'  });
        }
        if (_smooth.rightVisible) {
            wells.push({ pos: _smooth.rightWrist.clone(), hand: 'right' });
        }
        _particles?.update(wells, dt, elapsed);

        // ── Render ─────────────────────────────────────────────────────────
        _renderer.render(_scene, _camera);
    }

    // ── MIDI ──────────────────────────────────────────────────────────────────
    function _initMidi() {
        if (!navigator.requestMIDIAccess) {
            const el = document.getElementById('kr-status');
            if (el) el.title = 'MIDI not available in this browser';
            return;
        }
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
        const dest = _ae?.getRecordingDest?.();
        if (dest) dest.stream.getAudioTracks().forEach(t => vs.addTrack(t));
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus' : 'video/webm';
        _recorder = new MediaRecorder(vs, { mimeType: mime, videoBitsPerSecond: 12e6 });
        const chunks = [];
        _recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        _recorder.onstop = () => {
            const a = Object.assign(document.createElement('a'), {
                href:     URL.createObjectURL(new Blob(chunks, { type: mime })),
                download: `vngrd-spatial-${Date.now()}.webm`,
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

            _looper?.dispose();    _looper   = null;
            _nc?.dispose();        _nc       = null;
            _spatial?.dispose();   _spatial  = null;
            _particles?.dispose(); _particles = null;
            _ae?.dispose();        _ae       = null;
            _handLandmarker?.close();
            _handLandmarker = null;
            window._GestureLooper = null;

            _prevLeftWrist  = null;
            _prevRightWrist = null;

            // Hide NC panel
            document.getElementById('nc-panel')?.classList.remove('nc-visible');

            ['kinetic-canvas','kr-launch-btn','kr-rack','kinetic-cam-video'].forEach(id =>
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
            _setupScene();
            await _startCam();

            // Audio (inside user gesture — toggle is a click handler)
            _ae = new AudioEngine();
            await _ae.init();

            // NeuralComposer
            _nc = new NeuralComposer();
            _nc.init(_ae);
            window._NC = _nc;   // expose for grid button callbacks

            // SpatialSynth (replaces TetherVerlet)
            _spatial = new SpatialSynth(_scene, _ae);
            _spatial.init();

            // Particle trails
            _particles = new GravityParticles(_scene, THREE);

            // Gesture Looper — isolated so a failure here cannot abort the rest of startup
            try {
                _looper = new GestureLooper(_scene, _ae.getLoopBus());
                window._GestureLooper = _looper;
            } catch (e) {
                console.warn('[KineticRack] GestureLooper init failed:', e);
                _looper = null;
            }

            // Hand tracking
            await _startHandLandmarker();

            // MIDI
            _initMidi();

            document.getElementById('kinetic-canvas')?.classList.add('kr-online');
            document.getElementById('kr-rack')?.classList.add('kr-online');
            document.getElementById('kr-stage-hud')?.classList.add('kr-live');
            document.getElementById('kr-hud-title').textContent = 'SPATIAL SYNTH';

            // Show Sonic Suite NC panel if already open
            const ncPanel = document.getElementById('nc-panel');
            if (ncPanel?.classList.contains('nc-visible')) {
                // Re-render grid (in case DOM was rebuilt)
                _nc._renderGrid();
            }

            _status('SPATIAL SYNTH // LIVE', true);

            _clock = new THREE.Clock();
            _loop();
        } catch (err) {
            console.error('[KineticRack]', err);
            _status('ERROR: ' + (err?.message ?? String(err)));
            _active = false;
            document.getElementById('kr-launch-btn')?.classList.remove('kr-online');
        }
    }

    // ── Sonic Suite toggle ────────────────────────────────────────────────────
    function toggleSonicSuite() {
        const panel = document.getElementById('nc-panel');
        if (!panel) return;
        const visible = panel.classList.toggle('nc-visible');
        if (visible && _nc) _nc._renderGrid();
        const btn = document.getElementById('nc-launch-btn');
        if (btn) btn.classList.toggle('kr-online', visible);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function ctrlChange(id, val) {
        const v = parseFloat(val);
        if (id === 'vol')        _ae?.setVolume(v);
        if (id === 'reverb')     _ae?.setReverbMix(v);
        if (id === 'filter')     _ae?.setManualFilter(v);
        if (id === 'loopDelay')  _ae?.setLoopDelayWet(v);
        if (id === 'loopWave')   _looper?.setWaveform(val);
    }

    function clearLoops() {
        _looper?.clearAll();
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
          <div class="kr-help-line">SPATIAL SYNTH — GPU AR Instrument</div>
          <div class="kr-help-line">────────────────────────────────────</div>
          <div class="kr-help-line">RIGHT HAND  →  DSP field control</div>
          <div class="kr-help-line">  X-axis  →  pitch / granular pos</div>
          <div class="kr-help-line">  Y-axis  →  filter cutoff</div>
          <div class="kr-help-line">LEFT HAND   →  volume gate</div>
          <div class="kr-help-line">  Visible →  synth opens</div>
          <div class="kr-help-line">  Hidden  →  synth fades out</div>
          <div class="kr-help-line">  Snap ↓  →  808 kick drum</div>
          <div class="kr-help-line">  Pinch ✌ →  toggle armed step</div>
          <div class="kr-help-line">────────────────────────────────────</div>
          <div class="kr-help-line">SONIC SUITE →  8-track sequencer</div>
          <div class="kr-help-line">  Left pinch arms the next step</div>
          <div class="kr-help-line">TRAILS  →  GPU particle streams</div>
        `;
        m.style.display = (!m.style.display || m.style.display === 'none') ? 'flex' : 'none';
    }

    return { toggle, ctrlChange, midiLearn, toggleRecording, toggleHelp, toggleSonicSuite, clearLoops };
})();

window.KineticRack = KineticRack;
