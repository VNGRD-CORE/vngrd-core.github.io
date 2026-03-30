/**
 * KineticRack.js — 4-Pad Hand-Tracking Sampler
 *
 * TRACKING:  @mediapipe/tasks-vision HandLandmarker, delegate: GPU
 *            Hidden 256×256 <video id="kr-ai-video"> for AI inference
 *
 * AUDIO:     Howler.js (window.Howl via CDN script tag)
 *            4 Howl instances: kick / snare / hat / bass
 *
 * INTERACTION:
 *   Index-fingertip normalised X/Y maps to a 2×2 screen quadrant.
 *   Entering a new quadrant fires the pad (audio + neon flash).
 *   500 ms per-pad cooldown prevents machine-gun retrigger.
 *   Pads also respond to mouse/touch clicks for testing.
 *
 * Quadrant layout (mirrored X):
 *   [ 0:KICK  | 1:SNARE ]
 *   [ 2:HAT   | 3:BASS  ]
 */

const KineticRack = (() => {
    'use strict';

    // ── MediaPipe CDN ─────────────────────────────────────────────────────────
    const TASKS_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
    const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
    const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

    // ── Pad config ────────────────────────────────────────────────────────────
    const PADS = [
        { id: 'kr-pad-0', label: 'KICK',  src: './assets/audio/kick.wav'  },
        { id: 'kr-pad-1', label: 'SNARE', src: './assets/audio/snare.wav' },
        { id: 'kr-pad-2', label: 'HAT',   src: './assets/audio/hat.wav'   },
        { id: 'kr-pad-3', label: 'BASS',  src: './assets/audio/bass.wav'  },
    ];
    const COOLDOWN_MS = 500;   // ms between re-triggers for the same pad

    // ── State ─────────────────────────────────────────────────────────────────
    let _active         = false;
    let _handLandmarker = null;
    let _aiVideo        = null;
    let _lastTs         = -1;
    let _sounds         = null;
    const _prevPad      = [-1, -1];         // last quadrant per hand (max 2)
    const _cooldown     = [0, 0, 0, 0];     // cooldown timestamp per pad
    const _cursors      = [];               // finger-position indicator dots

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _status(msg, live = false) {
        const el = document.getElementById('kr-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('kr-live', live);
    }

    /**
     * Map normalised (0-1) mirrored X and Y to pad index 0-3.
     * Returns -1 if out of range.
     */
    function _padFrom(nx, ny) {
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return -1;
        return (nx >= 0.5 ? 1 : 0) + (ny >= 0.5 ? 2 : 0);
    }

    // ── Pad trigger ───────────────────────────────────────────────────────────
    function _triggerPad(idx) {
        const now = performance.now();
        if (now < _cooldown[idx]) return;
        _cooldown[idx] = now + COOLDOWN_MS;

        // Play sound (Howler)
        _sounds?.[idx]?.play();

        // Flash the pad
        const el = document.getElementById(PADS[idx].id);
        if (!el) return;
        el.classList.add('kr-pad-hit');
        clearTimeout(el._hitTimer);
        el._hitTimer = setTimeout(() => el.classList.remove('kr-pad-hit'), 220);
    }

    // ── Finger cursors ────────────────────────────────────────────────────────
    function _buildCursors() {
        if (_cursors.length) return;
        const colors = ['rgba(255,0,204,0.9)', 'rgba(0,243,255,0.9)'];
        colors.forEach((color, i) => {
            const c        = document.createElement('div');
            c.className    = 'kr-finger-cursor';
            c.id           = `kr-cursor-${i}`;
            c.style.cssText = [
                'position:fixed',
                'width:20px', 'height:20px',
                'border-radius:50%',
                `border:2px solid ${color}`,
                `box-shadow:0 0 12px ${color}`,
                'pointer-events:none',
                'transform:translate(-50%,-50%)',
                'z-index:9500',
                'display:none',
                'transition:left 0.04s linear,top 0.04s linear',
            ].join(';');
            document.body.appendChild(c);
            _cursors.push(c);
        });
    }

    function _moveCursor(hi, nx, ny) {
        const c = _cursors[hi];
        if (!c) return;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
            c.style.display = 'none';
        } else {
            c.style.display = 'block';
            c.style.left    = (nx * 100) + 'vw';
            c.style.top     = (ny * 100) + 'vh';
        }
    }

    // ── Render / inference loop ───────────────────────────────────────────────
    function _loop() {
        if (!_active) return;
        requestAnimationFrame(_loop);

        const now = performance.now();
        if (!_handLandmarker || (_aiVideo?.readyState ?? 0) < 2 || now <= _lastTs) return;

        let result;
        try {
            result  = _handLandmarker.detectForVideo(_aiVideo, now);
            _lastTs = now;
        } catch { return; }

        const nHands = result?.landmarks?.length ?? 0;

        result?.landmarks?.forEach((lms, hi) => {
            if (hi > 1) return;

            const tip = lms[8];          // index-fingertip landmark
            const nx  = 1 - tip.x;      // mirror X to match display
            const ny  = tip.y;

            _moveCursor(hi, nx, ny);

            const pad = _padFrom(nx, ny);
            if (pad !== -1 && pad !== _prevPad[hi]) {
                _triggerPad(pad);
            }
            _prevPad[hi] = pad;
        });

        // Hide cursors for hands no longer detected
        for (let h = nHands; h < 2; h++) {
            _moveCursor(h, -1, -1);
            _prevPad[h] = -1;
        }
    }

    // ── Boot ──────────────────────────────────────────────────────────────────
    async function toggle() {
        if (_active) {
            // ── Shutdown ─────────────────────────────────────────────────────
            _active = false;
            _handLandmarker?.close();
            _handLandmarker = null;
            _sounds?.forEach(s => { try { s.unload(); } catch {} });
            _sounds = null;
            _cursors.forEach(c => (c.style.display = 'none'));

            ['kr-sampler-grid', 'kr-launch-btn', 'kr-rack'].forEach(id =>
                document.getElementById(id)?.classList.remove('kr-online')
            );
            document.getElementById('kr-stage-hud')?.classList.remove('kr-live');
            _status('OFFLINE');
            return;
        }

        // ── Startup ───────────────────────────────────────────────────────────
        _active = true;
        document.getElementById('kr-launch-btn')?.classList.add('kr-online');
        _status('STARTING...');

        try {
            // Camera → inference video (hidden 256×256)
            _aiVideo = document.getElementById('kr-ai-video');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
                audio: false,
            });
            _aiVideo.srcObject = stream;
            await new Promise(res => { _aiVideo.onloadedmetadata = res; });
            await _aiVideo.play().catch(() => {});

            // Howler audio instances
            if (typeof Howl !== 'undefined') {
                _sounds = PADS.map(p => new Howl({ src: [p.src], preload: true, html5: false }));
            } else {
                console.warn('[KineticRack] Howler.js not loaded — audio disabled');
            }

            // HandLandmarker (GPU delegate)
            _status('LOADING MODEL...');
            const { HandLandmarker, FilesetResolver } = await import(TASKS_CDN);
            const fsr = await FilesetResolver.forVisionTasks(WASM_PATH);
            _handLandmarker = await HandLandmarker.createFromOptions(fsr, {
                baseOptions: {
                    modelAssetPath: MODEL_URL,
                    delegate: 'GPU',
                },
                runningMode:                'VIDEO',
                numHands:                   2,
                minHandDetectionConfidence: 0.6,
                minHandPresenceConfidence:  0.5,
                minTrackingConfidence:      0.5,
            });

            // Finger cursors
            _buildCursors();

            document.getElementById('kr-sampler-grid')?.classList.add('kr-online');
            document.getElementById('kr-rack')?.classList.add('kr-online');
            document.getElementById('kr-stage-hud')?.classList.add('kr-live');
            _status('4-PAD SAMPLER // LIVE', true);

            _loop();
        } catch (err) {
            console.error('[KineticRack]', err);
            _status('ERROR: ' + (err?.message ?? String(err)));
            _active = false;
            document.getElementById('kr-launch-btn')?.classList.remove('kr-online');
        }
    }

    // ── Public API stubs (expected by index.html inline handlers) ─────────────
    function ctrlChange() {}
    function midiLearn() {}
    function toggleRecording() {}
    function toggleHelp() {
        const m = document.getElementById('kr-help-modal');
        if (!m) return;
        const body = document.getElementById('kr-help-body');
        if (body) body.innerHTML = `
          <div class="kr-help-line">4-PAD SAMPLER — Hand-Tracking</div>
          <div class="kr-help-line">────────────────────────────────────</div>
          <div class="kr-help-line">Point your index finger at a pad.</div>
          <div class="kr-help-line">  Top-left     →  KICK</div>
          <div class="kr-help-line">  Top-right    →  SNARE</div>
          <div class="kr-help-line">  Bottom-left  →  HAT</div>
          <div class="kr-help-line">  Bottom-right →  BASS</div>
          <div class="kr-help-line">────────────────────────────────────</div>
          <div class="kr-help-line">Pads also fire on click / tap.</div>
          <div class="kr-help-line">500 ms cooldown prevents re-trigger.</div>
        `;
        m.style.display = (!m.style.display || m.style.display === 'none') ? 'flex' : 'none';
    }

    /** Called by inline onclick handlers on each pad element. */
    function triggerPad(idx) {
        _triggerPad(idx);
    }

    return { toggle, triggerPad, ctrlChange, midiLearn, toggleRecording, toggleHelp };
})();

window.KineticRack = KineticRack;
