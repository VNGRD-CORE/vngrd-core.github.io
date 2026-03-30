/**
 * KineticRack.js — Fluid Tether orchestrator
 *
 * SPLIT-HAND CONTROL
 *   Left  hand  (MediaPipe 'Right' label in mirrored view)
 *     • Rapid downward snap → triggerKick
 *     • Thumb-index pinch   → fire armed NeuralComposer block
 *   Right hand  (MediaPipe 'Left' label in mirrored view)
 *     • Y position → master volume
 *     • X position → filter cutoff
 *     • Depth (Z)  → filter resonance
 *
 * MODULES
 *   AudioEngine   — master limiter chain, drum synthesis
 *   FluidHands    — GPU particle emitter (replaces stick skeleton)
 *   TetherVerlet  — 128-pt Verlet string + 3-osc detuned synth
 *   NeuralComposer — 8-track step sequencer
 */

import * as THREE from 'three';
import { AudioEngine }    from './AudioEngine.js';
import { FluidHands }     from './FluidHands.js';
import { TetherVerlet }   from './TetherVerlet.js';
import { NeuralComposer } from './NeuralComposer.js';

const KineticRack = (() => {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────
    let _active   = false;
    let _raf      = null;
    let _renderer, _scene, _camera, _clock;

    let _ae       = null;   // AudioEngine
    let _fluid    = null;   // FluidHands
    let _tether   = null;   // TetherVerlet
    let _composer = null;   // NeuralComposer

    let _camVideo = null;
    let _hands    = null;
    let _hrLatest = null;
    let _frameN   = 0;

    // Gesture state
    let _prevLeftY   = null;
    let _strikeCool  = 0;
    let _prevPinchD  = 1;
    let _pinchCool   = 0;

    // MIDI
    let _midiLearning  = null;
    const _midiBindings = {};

    // Recording
    let _recorder  = null;
    let _recording = false;

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _status(msg, live = false) {
        const el = document.getElementById('kr-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('kr-live', live);
    }

    function _lm2w(lm, cam) {
        const ndc = new THREE.Vector3(-(lm.x * 2 - 1), -(lm.y * 2 - 1), 0.5);
        ndc.unproject(cam);
        const dir  = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    /** Convert all landmarks for one hand to world space. */
    function _handWorld(lms, cam) {
        return lms.map(lm => _lm2w(lm, cam));
    }

    /**
     * Extract left/right world-space landmark arrays from MediaPipe results.
     * In mirrored-camera view: MediaPipe 'Right' = real left, 'Left' = real right.
     */
    function _extractHands(hr, cam) {
        if (!hr?.multiHandLandmarks?.length) return [null, null];
        let leftW = null, rightW = null;
        hr.multiHandLandmarks.forEach((lms, i) => {
            const label = hr.multiHandedness?.[i]?.label;
            // 'Right' in MP = user's left hand (after mirror)
            if (label === 'Right') leftW  = _handWorld(lms, cam);
            else                   rightW = _handWorld(lms, cam);
        });
        // Fallback: if only one hand, treat it as right (modulate)
        if (!leftW && !rightW && hr.multiHandLandmarks[0]) {
            rightW = _handWorld(hr.multiHandLandmarks[0], cam);
        }
        return [leftW, rightW];
    }

    // ── Three.js setup ────────────────────────────────────────────────────────
    function _setupScene() {
        const canvas = document.getElementById('kinetic-canvas');
        _renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
        _renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        _renderer.setSize(window.innerWidth, window.innerHeight);
        _renderer.toneMapping         = THREE.ACESFilmicToneMapping;
        _renderer.toneMappingExposure = 1.5;
        _renderer.setClearColor(0x000000, 0);

        _scene  = new THREE.Scene();
        _camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 100);
        _camera.position.set(0, 0, 2);

        // Ambient + rim lights
        _scene.add(new THREE.AmbientLight(0x0a0a1a, 1.0));
        const r1 = new THREE.DirectionalLight(0x00f3ff, 2.5); r1.position.set(-2,  2, 1.5); _scene.add(r1);
        const r2 = new THREE.DirectionalLight(0xff00cc, 2.0); r2.position.set( 2, -1, 1.5); _scene.add(r2);
        const r3 = new THREE.DirectionalLight(0xffffff, 1.0); r3.position.set( 0,  3, 2.0); _scene.add(r3);

        window.addEventListener('resize', () => {
            _camera.aspect = window.innerWidth / window.innerHeight;
            _camera.updateProjectionMatrix();
            _renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    // ── Camera ────────────────────────────────────────────────────────────────
    async function _startCam() {
        _status('CAMERA...');
        _camVideo = document.getElementById('kinetic-cam-video');
        const stream = window.APP?.camera?.stream
            ?? window.APP?.camera
            ?? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false });
        _camVideo.srcObject = stream instanceof MediaStream ? stream : null;
        if (!(_camVideo.srcObject)) {
            // APP.camera might be a video element
            const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false });
            _camVideo.srcObject = s;
        }
        if (_camVideo.readyState < 2) {
            await new Promise(res => { _camVideo.onloadedmetadata = res; });
        }
        await _camVideo.play().catch(() => {});
        _camVideo.classList.add('kr-online');
    }

    // ── MediaPipe ─────────────────────────────────────────────────────────────
    async function _startHands() {
        _status('LOADING HANDS MODEL...');
        const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/';
        if (!window.Hands) {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = `${CDN}hands.js`;
                s.crossOrigin = 'anonymous';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }
        _hands = new window.Hands({ locateFile: f => `${CDN}${f}` });
        _hands.setOptions({
            maxNumHands:             2,
            modelComplexity:         1,
            minDetectionConfidence:  0.72,
            minTrackingConfidence:   0.60,
        });
        _hands.onResults(r => { _hrLatest = r; });
        await _hands.initialize();
    }

    // ── Gesture detection (left hand) ─────────────────────────────────────────
    function _processGestures(leftW) {
        if (!leftW) {
            _prevLeftY = null;
            return;
        }
        const wrist = leftW[0];
        const now   = performance.now();

        // ── Strike: rapid downward wrist velocity ──────────────────────────
        if (_prevLeftY !== null) {
            const deltaY = wrist.y - _prevLeftY; // positive = wrist moved down
            if (deltaY > 0.032 && now > _strikeCool) {
                _strikeCool = now + 260;
                _ae.triggerKick(Math.min(1, deltaY * 20));
            }
        }
        _prevLeftY = wrist.y;

        // ── Pinch: thumb-index tip distance ────────────────────────────────
        const thumb = leftW[4];
        const index = leftW[8];
        const d     = thumb.distanceTo(index);
        if (_prevPinchD > 0.12 && d < 0.07 && now > _pinchCool) {
            _pinchCool = now + 500;
            _composer?.onPinch();
        }
        _prevPinchD = d;
    }

    // ── Right-hand continuous modulation ─────────────────────────────────────
    function _processModulate(rightW) {
        if (!rightW || !_ae) return;
        const w = rightW[0]; // wrist
        // Y position (0=top, 1=bottom) → volume: high hand = loud
        _ae.setVolume(1 - w.y * 0.9);
        // X position (0=left, 1=right) → filter cutoff 200–12000 Hz
        _ae.setFilterCutoff(200 + w.x * 11800);
        // Z depth → resonance 0.5..18
        const depth = Math.abs(w.z ?? 0);
        _ae.setFilterResonance(0.5 + depth * 22);
    }

    // ── Main render loop ──────────────────────────────────────────────────────
    async function _loop() {
        if (!_active) return;
        _raf = requestAnimationFrame(_loop);

        const dt      = _clock.getDelta();
        const elapsed = _clock.getElapsedTime();

        // MediaPipe inference every 3rd frame (~20fps)
        if (_hands && _camVideo?.readyState === 4 && _frameN % 3 === 0) {
            await _hands.send({ image: _camVideo });
        }
        _frameN++;

        const [leftW, rightW] = _extractHands(_hrLatest, _camera);

        // Gesture detection
        _processGestures(leftW);
        _processModulate(rightW);

        // Update modules
        _fluid.update([leftW, rightW], dt);
        _tether.update(
            leftW  ? leftW[0]  : null,
            rightW ? rightW[0] : null,
            dt,
            elapsed
        );

        _renderer.render(_scene, _camera);
    }

    // ── MIDI ──────────────────────────────────────────────────────────────────
    function _initMidi() {
        if (!navigator.requestMIDIAccess) return;
        navigator.requestMIDIAccess().then(access => {
            access.inputs.forEach(p => { p.onmidimessage = _onMIDI; });
            access.onstatechange = e => {
                if (e.port.type === 'input' && e.port.state === 'connected') e.port.onmidimessage = _onMIDI;
            };
        }).catch(() => {});
    }

    function _onMIDI(e) {
        const [st, cc, val] = e.data;
        if ((st & 0xf0) !== 0xb0) return;
        const v = val / 127;
        if (_midiLearning) {
            _midiBindings[_midiLearning] = cc;
            document.querySelector(`.kr-ctrl-learn[data-ctrl="${_midiLearning}"]`)?.classList.remove('kr-learning');
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
        const vs  = document.getElementById('kinetic-canvas').captureStream(60);
        const dest = _ae.ctx.createMediaStreamDestination();
        _ae._limiter.connect(dest);  // tap after limiter
        dest.stream.getAudioTracks().forEach(t => vs.addTrack(t));
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus' : 'video/webm';
        _recorder = new MediaRecorder(vs, { mimeType: mime, videoBitsPerSecond: 12e6 });
        const chunks = [];
        _recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        _recorder.onstop = () => {
            const a = Object.assign(document.createElement('a'), {
                href: URL.createObjectURL(new Blob(chunks, { type: mime })),
                download: `vngrd-${Date.now()}.webm`,
            });
            a.click();
            URL.revokeObjectURL(a.href);
            _ae._limiter.disconnect(dest);
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
            if (_recording) _stopRec();
            _tether?.deactivate();
            _fluid?.clear();
            _composer?.stop();
            _hands?.close();
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
            // Audio
            _ae = new AudioEngine();
            await _ae.init(window.APP?.audio?.ctx);

            // Three.js scene
            _setupScene();

            // Camera
            await _startCam();

            // Modules
            _fluid    = new FluidHands(_scene, THREE);
            _tether   = new TetherVerlet(_scene, _ae);
            _tether.init();
            _tether.activate();

            _composer = new NeuralComposer(_ae);
            _composer.start();

            // MediaPipe
            await _startHands();

            // MIDI
            _initMidi();

            document.getElementById('kinetic-canvas')?.classList.add('kr-online');
            document.getElementById('kr-rack')?.classList.add('kr-online');
            document.getElementById('kr-stage-hud')?.classList.add('kr-live');
            _status('FLUID TETHER // LIVE', true);

            _clock = new THREE.Clock();
            _loop();
        } catch (err) {
            console.error('[KineticRack]', err);
            _status('ERROR: ' + err.message);
            _active = false;
            document.getElementById('kr-launch-btn')?.classList.remove('kr-online');
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function ctrlChange(id, val) {
        const v = parseFloat(val);
        if (id === 'vol')    _ae?.setVolume(v);
        if (id === 'reverb') _ae?.setReverbMix(v);
        if (id === 'filter') _ae?.setFilterCutoff(200 + v * 11800);
    }

    function midiLearn(ctrlId) {
        _midiLearning = ctrlId;
        document.querySelectorAll('.kr-ctrl-learn').forEach(b => b.classList.remove('kr-learning'));
        document.querySelector(`.kr-ctrl-learn[data-ctrl="${ctrlId}"]`)?.classList.add('kr-learning');
        setTimeout(() => {
            if (_midiLearning === ctrlId) {
                _midiLearning = null;
                document.querySelector(`.kr-ctrl-learn[data-ctrl="${ctrlId}"]`)?.classList.remove('kr-learning');
            }
        }, 10_000);
    }

    function toggleRecording() { _recording ? _stopRec() : _startRec(); }

    function toggleHelp() {
        const m = document.getElementById('kr-help-modal');
        if (!m) return;
        document.getElementById('kr-help-body').innerHTML = `
          <div class="kr-help-line">FLUID TETHER — AR Instrument</div>
          <div class="kr-help-line">────────────────────────────────</div>
          <div class="kr-help-line">LEFT HAND  →  triggers</div>
          <div class="kr-help-line">  Snap down   →  kick drum</div>
          <div class="kr-help-line">  Pinch ✌     →  fire composer block</div>
          <div class="kr-help-line">RIGHT HAND →  modulators</div>
          <div class="kr-help-line">  Y-axis  →  master volume</div>
          <div class="kr-help-line">  X-axis  →  filter cutoff</div>
          <div class="kr-help-line">  Depth   →  resonance</div>
          <div class="kr-help-line">TETHER     →  stretch both hands apart</div>
          <div class="kr-help-line">────────────────────────────────</div>
          <div class="kr-help-line">COMPOSER   →  click blocks to edit steps</div>
          <div class="kr-help-line">           ●  = armed  (pinch to fire)</div>
        `;
        m.style.display = (!m.style.display || m.style.display === 'none') ? 'flex' : 'none';
    }

    function toggleComposer() {
        const p = document.getElementById('nc-panel');
        if (!p) return;
        p.style.display = p.style.display === 'none' ? 'flex' : 'none';
    }

    return { toggle, ctrlChange, midiLearn, toggleRecording, toggleHelp, toggleComposer };
})();

window.KineticRack = KineticRack;
