/* ═══════════════════════════════════════════════════════════════════
   VNGRD SONIC SUITE v2 — Unified Canvas Orchestrator
   Kinetic Workstation 2300s
   Drop-in module — does NOT touch wallet sync, P2P, MIDI, or clock.
   Attaches to window.SonicSuite.
═══════════════════════════════════════════════════════════════════ */
(function(global) {
'use strict';

const SonicSuite = (function() {

    // ── Private State ─────────────────────────────────────────────
    var _canvas     = null;
    var _ctx        = null;
    var _camVideo   = null;
    var _camPreview = null;
    var _audioCtx   = null;
    var _active     = false;
    var _rafId      = null;
    var _hands      = null;
    var _camera     = null;
    var _latestResults = null;
    var _currentInstrument = null;
    var _currentName       = '';
    var _instruments = {};

    // ── Audio Context ─────────────────────────────────────────────
    // Reuses APP.audio.ctx when available to stay within one context
    // and avoid conflicts with existing recording chain.
    function _getAudioCtx() {
        if (_audioCtx && _audioCtx.state !== 'closed') return _audioCtx;
        if (global.APP && global.APP.audio && global.APP.audio.ctx
            && global.APP.audio.ctx.state !== 'closed') {
            _audioCtx = global.APP.audio.ctx;
        } else {
            _audioCtx = new (global.AudioContext || global.webkitAudioContext)();
        }
        return _audioCtx;
    }

    // ── DOM Bootstrap ─────────────────────────────────────────────
    function _ensureDOM() {
        _canvas = document.getElementById('sonic-canvas');
        if (!_canvas) {
            _canvas = document.createElement('canvas');
            _canvas.id = 'sonic-canvas';
            document.body.appendChild(_canvas);
        }
        _ctx = _canvas.getContext('2d');

        _camPreview = document.getElementById('sonic-cam-preview');
        _camVideo   = document.getElementById('sonic-cam-video');

        _resizeCanvas();
        // Re-measure on window resize
        if (!_canvas._ssResizeBound) {
            _canvas._ssResizeBound = true;
            global.addEventListener('resize', _resizeCanvas);
        }
    }

    function _resizeCanvas() {
        if (!_canvas) return;
        var rect = _canvas.getBoundingClientRect();
        _canvas.width  = rect.width  || (global.innerWidth  - 400);
        _canvas.height = rect.height || (global.innerHeight - 100);
    }

    // ── MediaPipe Hands Loader ────────────────────────────────────
    function _loadScript(src, cb) {
        var s = document.createElement('script');
        s.src = src;
        s.crossOrigin = 'anonymous';
        s.onload  = cb;
        s.onerror = function() { console.warn('[SonicSuite] Failed to load: ' + src); };
        document.head.appendChild(s);
    }

    function _loadHands(cb) {
        if (global.Hands) { cb(); return; }
        _loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js', cb);
    }

    function _initTracking() {
        _setStatus('LOADING HANDS MODEL…');
        _loadHands(function() {
            _hands = new global.Hands({
                locateFile: function(f) {
                    return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f;
                }
            });
            _hands.setOptions({
                maxNumHands: 2,
                modelComplexity: 1,
                minDetectionConfidence: 0.65,
                minTrackingConfidence: 0.60
            });
            _hands.onResults(_onHandResults);

            // global.Camera is loaded via camera_utils in index.html <head>
            _camera = new global.Camera(_camVideo, {
                onFrame: function() {
                    if (_hands && _active) return _hands.send({ image: _camVideo });
                    return Promise.resolve();
                },
                width: 640, height: 480
            });
            _camera.start().then(function() {
                _camPreview && _camPreview.classList.add('active');
                _setStatus('TRACKING ONLINE');
                var statusEl = document.getElementById('ki-status');
                if (statusEl) statusEl.classList.add('online');
            }).catch(function(e) {
                _setStatus('CAM ERROR: ' + e.message);
            });
        });
    }

    function _onHandResults(results) {
        _latestResults = results;
        if (_currentInstrument && _currentInstrument.onHandResults) {
            _currentInstrument.onHandResults(results);
        }
        // Update hand info HUD
        var count = results && results.multiHandLandmarks
            ? results.multiHandLandmarks.length : 0;
        var el = document.getElementById('ki-hand-info');
        if (el) el.textContent = count ? ('HANDS: ' + count + ' DETECTED') : '';
    }

    // ── Unified RAF Loop ──────────────────────────────────────────
    function _startRAF() {
        if (_rafId) return;
        function _frame() {
            _rafId = requestAnimationFrame(_frame);
            if (!_ctx || !_active) return;
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            if (_currentInstrument && _currentInstrument.draw) {
                _currentInstrument.draw(_canvas, _ctx, _latestResults);
            }
        }
        _rafId = requestAnimationFrame(_frame);
    }

    function _stopRAF() {
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    }

    // ── Activate / Deactivate ─────────────────────────────────────
    function _activate() {
        _active = true;
        _ensureDOM();
        _canvas.classList.add('active');

        var ctx = _getAudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        // Activate currently selected instrument
        if (_currentInstrument && _currentInstrument.activate) {
            _currentInstrument.activate(ctx);
        }

        _startRAF();
        _initTracking();

        var btn = document.getElementById('ki-launch-btn');
        if (btn) { btn.classList.add('active'); btn.textContent = '[ SUITE: ONLINE ]'; }

        var dot = document.getElementById('ki-dot');
        if (dot) { dot.classList.remove('off'); dot.style.background = 'var(--g, #00ff88)'; }
    }

    function _deactivate() {
        _active = false;
        if (_camera) { try { _camera.stop(); } catch(e) {} _camera = null; }
        if (_hands)  { try { _hands.close(); } catch(e) {} _hands  = null; }
        _latestResults = null;

        if (_camPreview) _camPreview.classList.remove('active');
        if (_canvas)     _canvas.classList.remove('active');
        _stopRAF();

        if (_currentInstrument && _currentInstrument.deactivate) {
            _currentInstrument.deactivate();
        }

        var btn = document.getElementById('ki-launch-btn');
        if (btn) { btn.classList.remove('active'); btn.textContent = '[ LAUNCH SUITE ]'; }

        var dot = document.getElementById('ki-dot');
        if (dot) { dot.classList.add('off'); dot.style.background = ''; }

        var statusEl = document.getElementById('ki-status');
        if (statusEl) { statusEl.textContent = 'OFFLINE'; statusEl.classList.remove('online'); }

        var infoEl = document.getElementById('ki-hand-info');
        if (infoEl) infoEl.textContent = '';
    }

    // ── Public API ────────────────────────────────────────────────
    function toggle() {
        if (_active) _deactivate(); else _activate();
    }

    function setInstrument(name) {
        // Deactivate old instrument if suite is live
        if (_active && _currentInstrument && _currentInstrument.deactivate) {
            _currentInstrument.deactivate();
        }

        _currentName       = name;
        _currentInstrument = _instruments[name] || null;

        // Activate new instrument if suite is already live
        if (_active && _currentInstrument && _currentInstrument.activate) {
            _currentInstrument.activate(_getAudioCtx());
        }

        // Sync UI
        document.querySelectorAll('.ki-btn').forEach(function(b) {
            b.classList.remove('active');
        });
        var id = 'ki-btn-' + name.toLowerCase().replace(/_/g, '-');
        var activeBtn = document.getElementById(id);
        if (activeBtn) activeBtn.classList.add('active');

        // Toggle tether sub-modes panel
        var tetherPanel = document.getElementById('ki-tether-modes');
        if (tetherPanel) tetherPanel.classList.toggle('visible', name === 'TETHER');

        _setStatus('INSTRUMENT: ' + name);
    }

    function registerInstrument(name, instance) {
        _instruments[name] = instance;
    }

    function getAudioCtx() { return _getAudioCtx(); }
    function getCanvas()   { return _canvas; }
    function isActive()    { return _active; }

    function _setStatus(msg) {
        var el = document.getElementById('ki-status');
        if (el) el.textContent = msg;
    }

    return {
        toggle: toggle,
        setInstrument: setInstrument,
        registerInstrument: registerInstrument,
        getAudioCtx: getAudioCtx,
        getCanvas: getCanvas,
        isActive: isActive
    };

})();

global.SonicSuite = SonicSuite;

})(window);
