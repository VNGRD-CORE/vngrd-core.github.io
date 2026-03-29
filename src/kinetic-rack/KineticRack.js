/**
 * NEURAL TETHER — KineticRack.js  v3.0
 * Single-canvas AR instrument: Three.js WebGL on #kinetic-canvas,
 * 4K camera feed on #video-preview, MediaPipe hand skeleton,
 * Verlet plasma string, granular synthesis, MIDI, recording.
 */
import * as THREE from 'three';
import { NeuralTether } from './TetherVerlet.js';

const KineticRack = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let _running    = false;
  let _renderer, _scene, _camera, _clock;
  let _tether     = null;
  let _hands      = null;
  let _handResults = null;
  let _camStream  = null;
  let _videoEl    = null;
  let _audioCtx   = null;
  let _masterComp = null;
  let _masterGain = null;
  let _recorder   = null;
  let _recording  = false;
  let _rafId      = null;
  let _frameCount = 0;

  // Skeleton meshes
  const _jointMeshes   = [];
  const _boneMeshes    = [];
  let   _skeletonBuilt = false;

  // MIDI
  let _midiLearning   = null;
  const _midiBindings = {};

  // Shared control state
  const _ctrl = { vol: 0.8, tension: 0.5 };

  // ── Hand landmark chains for liquid-chrome skeleton ──────────────────────
  const CHAINS = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
    [0, 1, 5, 9, 13, 17],
  ];
  const HAND_COLORS = [0x00f3ff, 0xff00cc];

  // ── Start / Stop ──────────────────────────────────────────────────────────
  async function _start() {
    if (_running) return;
    _running = true;
    _setStatus('STARTING…');

    _audioCtx = window.APP?.audio?.ctx ?? new AudioContext();
    if (_audioCtx.state === 'suspended') await _audioCtx.resume();

    // Master chain: NeuralTether → compressor → masterGain → destination
    _masterComp = _audioCtx.createDynamicsCompressor();
    _masterComp.threshold.value = -14;
    _masterComp.knee.value      = 8;
    _masterComp.ratio.value     = 3.5;
    _masterComp.attack.value    = 0.005;
    _masterComp.release.value   = 0.2;

    _masterGain = _audioCtx.createGain();
    _masterGain.gain.value = _ctrl.vol;

    _masterComp.connect(_masterGain);
    _masterGain.connect(_audioCtx.destination);

    _initThree();

    _videoEl = document.getElementById('video-preview');
    await _initCamera();
    await _initMediaPipe();

    _tether = new NeuralTether(_scene, _masterComp, _audioCtx, _ctrl);

    _initMIDI();

    _clock = new THREE.Clock();
    _rafId = requestAnimationFrame(_renderLoop);

    _setStatus('LIVE');
    document.getElementById('kr-status').classList.add('kr-live');
    document.getElementById('kr-stage-hud').classList.add('kr-live');
    document.getElementById('kr-rack').classList.add('kr-online');
    document.getElementById('kinetic-canvas').classList.add('kr-online');
    _videoEl.classList.add('kr-online');
    document.getElementById('kr-launch-btn').textContent = '[ STOP ]';
  }

  function _stop() {
    _running = false;
    if (_rafId)     { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_hands)     { try { _hands.close(); } catch {} _hands = null; }
    if (_camStream) { _camStream.getTracks().forEach(t => t.stop()); _camStream = null; }
    if (_recording) { _stopRecording(); }
    if (_tether)    { _tether.dispose(); _tether = null; }
    _clearSkeleton();

    _setStatus('OFFLINE');
    document.getElementById('kr-status').classList.remove('kr-live');
    document.getElementById('kr-stage-hud').classList.remove('kr-live');
    document.getElementById('kr-rack').classList.remove('kr-online');
    document.getElementById('kinetic-canvas').classList.remove('kr-online');
    if (_videoEl) _videoEl.classList.remove('kr-online');
    document.getElementById('kr-launch-btn').textContent = '[ NEURAL TETHER ]';
  }

  // ── Three.js ──────────────────────────────────────────────────────────────
  function _initThree() {
    const canvas = document.getElementById('kinetic-canvas');

    _renderer = new THREE.WebGLRenderer({
      canvas,
      alpha:           true,
      antialias:       true,
      powerPreference: 'high-performance',
    });
    _renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    _renderer.setSize(window.innerWidth, window.innerHeight);
    _renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    _renderer.toneMappingExposure = 1.45;
    _renderer.setClearColor(0x000000, 0);

    _scene  = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
    _camera.position.set(0, 0, 2);

    // Rim lighting
    _scene.add(new THREE.AmbientLight(0x111122, 0.8));
    const r1 = new THREE.DirectionalLight(0x00f3ff, 3.0); r1.position.set(-2,  2, 1); _scene.add(r1);
    const r2 = new THREE.DirectionalLight(0xff00cc, 2.5); r2.position.set( 2, -1, 1); _scene.add(r2);
    const r3 = new THREE.DirectionalLight(0xffffff, 1.2); r3.position.set( 0,  3, 2); _scene.add(r3);

    _buildResonanceChamber();

    window.addEventListener('resize', () => {
      _camera.aspect = window.innerWidth / window.innerHeight;
      _camera.updateProjectionMatrix();
      _renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  function _buildResonanceChamber() {
    const shape = new THREE.Shape();
    const R = 0.52;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
      i === 0
        ? shape.moveTo(R * Math.cos(a), R * Math.sin(a))
        : shape.lineTo(R * Math.cos(a), R * Math.sin(a));
    }
    shape.closePath();

    const ext = { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3 };
    const geo = new THREE.ExtrudeGeometry(shape, ext);

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x88aaff, metalness: 0, roughness: 0.06,
      transmission: 0.88, thickness: 0.5, ior: 1.52,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
      transparent: true, opacity: 0.72,
    });

    const hex  = new THREE.Mesh(geo, mat);
    hex.position.set(0, 0, -0.55);
    hex.rotation.z = Math.PI / 12;
    _scene.add(hex);

    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 15),
      new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.45 })
    );
    wire.position.copy(hex.position);
    wire.rotation.copy(hex.rotation);
    _scene.add(wire);
  }

  // ── Skeleton ──────────────────────────────────────────────────────────────
  function _clearSkeleton() {
    for (const m of _jointMeshes) { _scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    for (const b of _boneMeshes)  { _scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    _jointMeshes.length = 0;
    _boneMeshes.length  = 0;
    _skeletonBuilt      = false;
  }

  function _buildSkeleton(numHands) {
    if (_skeletonBuilt) return;
    _skeletonBuilt = true;

    const jointGeo = new THREE.IcosahedronGeometry(0.016, 1);

    for (let h = 0; h < numHands; h++) {
      const color = HAND_COLORS[h % HAND_COLORS.length];

      for (let j = 0; j < 21; j++) {
        const mesh = new THREE.Mesh(jointGeo, new THREE.MeshStandardMaterial({
          color,
          emissive: new THREE.Color(color),
          emissiveIntensity: 1.3,
          metalness: 0.85,
          roughness: 0.08,
        }));
        mesh.visible = false;
        _scene.add(mesh);
        _jointMeshes.push(mesh);
      }

      const chromeMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, metalness: 1.0, roughness: 0.04, envMapIntensity: 1.4,
      });

      for (const chain of CHAINS) {
        const pts  = chain.map((_, i) => new THREE.Vector3(i * 0.1, 0, 0));
        const geo  = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), chain.length * 4, 0.008, 6, false);
        const mesh = new THREE.Mesh(geo, chromeMat.clone());
        mesh.visible = false;
        _scene.add(mesh);
        _boneMeshes.push({ mesh });
      }
    }
  }

  function _updateSkeleton(landmarks3D) {
    if (!landmarks3D.length) {
      _jointMeshes.forEach(m => { m.visible = false; });
      _boneMeshes.forEach(b  => { b.mesh.visible = false; });
      return;
    }

    const numHands = Math.min(landmarks3D.length, 2);
    _buildSkeleton(numHands);

    let jOff = 0, bOff = 0;
    for (let h = 0; h < numHands; h++) {
      const lm = landmarks3D[h];
      for (let j = 0; j < 21; j++) {
        const m = _jointMeshes[jOff + j];
        if (m) { m.position.copy(lm[j]); m.visible = true; }
      }
      jOff += 21;

      for (const chain of CHAINS) {
        const b = _boneMeshes[bOff++];
        if (!b) continue;
        const pts = chain.map(idx => lm[idx].clone());
        b.mesh.geometry.dispose();
        b.mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), chain.length * 4, 0.008, 6, false);
        b.mesh.visible  = true;
      }
    }
  }

  function _allJointPositions(landmarks3D) {
    const out = [];
    for (const hand of landmarks3D) for (const v of hand) out.push(v);
    return out;
  }

  // ── Camera ────────────────────────────────────────────────────────────────
  async function _initCamera() {
    // Reuse a shared stream if the main app already has one open
    const existingStream = window.APP?.camera instanceof MediaStream ? window.APP.camera : null;
    const stream = existingStream ?? await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
    });
    _camStream = stream;
    _videoEl.srcObject = stream;
    if (_videoEl.readyState < 2) {
      await new Promise(res => { _videoEl.onloadedmetadata = res; });
    }
    await _videoEl.play().catch(() => {});
  }

  // ── MediaPipe ─────────────────────────────────────────────────────────────
  async function _initMediaPipe() {
    const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/';
    // MediaPipe hands.js is UMD — load via <script> tag, not import()
    if (!window.Hands) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${CDN}hands.js`;
        s.crossOrigin = 'anonymous';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    _hands = new window.Hands({ locateFile: f => `${CDN}${f}` });
    _hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.72, minTrackingConfidence: 0.65 });
    _hands.onResults(r => { _handResults = r; });
    await _hands.initialize();
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  async function _renderLoop() {
    if (!_running) return;
    _rafId = requestAnimationFrame(_renderLoop);
    const dt      = _clock.getDelta();
    const elapsed = _clock.getElapsedTime();

    if (_hands && _videoEl?.readyState === 4 && _frameCount % 3 === 0) {
      await _hands.send({ image: _videoEl });
    }
    _frameCount++;

    const landmarks3D = _getLandmarks3D();
    _updateSkeleton(landmarks3D);
    if (_tether) _tether.update(landmarks3D, dt, elapsed, _allJointPositions(landmarks3D));

    _renderer.render(_scene, _camera);
  }

  function _getLandmarks3D() {
    if (!_handResults?.multiHandLandmarks?.length) return [];
    return _handResults.multiHandLandmarks.map(hand =>
      hand.map(lm => new THREE.Vector3(
        (1 - lm.x) * 2 - 1,
        -(lm.y * 2 - 1),
        -lm.z * 3,
      ))
    );
  }

  // ── MIDI ──────────────────────────────────────────────────────────────────
  function _initMIDI() {
    if (!navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess().then(access => {
      access.inputs.forEach(p => { p.onmidimessage = _onMIDI; });
      access.onstatechange = e => {
        if (e.port.type === 'input' && e.port.state === 'connected') e.port.onmidimessage = _onMIDI;
      };
    }).catch(() => console.warn('GHOST> MIDI access denied'));
  }

  function _onMIDI(e) {
    const [status, cc, raw] = e.data;
    if ((status & 0xf0) !== 0xb0) return;
    const val = raw / 127;
    if (_midiLearning) {
      _midiBindings[_midiLearning] = cc;
      document.querySelector(`.kr-ctrl-learn[data-ctrl="${_midiLearning}"]`)?.classList.remove('kr-learning');
      _midiLearning = null;
      return;
    }
    for (const [ctrl, bcc] of Object.entries(_midiBindings)) {
      if (bcc === cc) {
        ctrlChange(ctrl, val);
        const s = document.querySelector(`.kr-ctrl-slider[data-ctrl="${ctrl}"]`);
        if (s) s.value = val;
      }
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  function _startRecording() {
    const vidStream = document.getElementById('kinetic-canvas').captureStream(60);
    const dest = _audioCtx.createMediaStreamDestination();
    _masterGain.connect(dest);
    dest.stream.getAudioTracks().forEach(t => vidStream.addTrack(t));

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus' : 'video/webm';
    _recorder = new MediaRecorder(vidStream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    const chunks = [];
    _recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    _recorder.onstop = () => {
      const a = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(new Blob(chunks, { type: mime })),
        download: `vngrd-${Date.now()}.webm`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
      _masterGain.disconnect(dest);
    };
    _recorder.start();
    _recording = true;
    document.getElementById('kr-rec-btn').classList.add('kr-recording');
  }

  function _stopRecording() {
    if (_recorder?.state !== 'inactive') _recorder.stop();
    _recording = false;
    document.getElementById('kr-rec-btn').classList.remove('kr-recording');
  }

  function _setStatus(txt) {
    const el = document.getElementById('kr-status');
    if (el) el.textContent = txt;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function toggle() { _running ? _stop() : _start(); }

  function ctrlChange(id, val) {
    _ctrl[id] = parseFloat(val);
    if (id === 'vol' && _masterGain)
      _masterGain.gain.setTargetAtTime(_ctrl.vol, _audioCtx.currentTime, 0.05);
    if (_tether) _tether.setCtrl(id, _ctrl[id]);
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

  function toggleRecording() { _recording ? _stopRecording() : _startRecording(); }

  function toggleHelp() {
    const modal = document.getElementById('kr-help-modal');
    document.getElementById('kr-help-body').innerHTML = `
      <div class="kr-help-line">NEURAL TETHER — AR Granular Instrument</div>
      <div class="kr-help-line">──────────────────────────────────────</div>
      <div class="kr-help-line">HOLD hand in front of camera</div>
      <div class="kr-help-line">String pins between THUMB TIP &amp; INDEX TIP</div>
      <div class="kr-help-line">STRETCH → modulate pitch + grain density</div>
      <div class="kr-help-line">WAVE hand → ripple travels the plasma string</div>
      <div class="kr-help-line">──────────────────────────────────────</div>
      <div class="kr-help-line">VOL     → master volume</div>
      <div class="kr-help-line">TENSION → grain density multiplier</div>
      <div class="kr-help-line">M       → MIDI-learn any slider</div>
    `;
    const vis = modal.style.display;
    modal.style.display = (!vis || vis === 'none') ? 'flex' : 'none';
  }

  return { toggle, ctrlChange, midiLearn, toggleRecording, toggleHelp };
})();

window.KineticRack = KineticRack;
