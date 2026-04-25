/**
 * hand-tracker.js — MediaPipe HandLandmarker offloaded to a Web Worker.
 *
 *   - No internal rAF or requestVideoFrameCallback loop.
 *   - Detection is driven exclusively by KineticRack._loop() via
 *     window._detectHandsOnce(video, now), throttled to ~20 FPS.
 *   - Each call: createImageBitmap(video) → transfer to worker → worker runs
 *     detectForVideo → posts {right,left} back → _pushLandmarks updates state.
 *   - Main thread never calls detectForVideo. No getImageData. No pixel reads.
 *   - Single source of truth: window._latestHandsLm; _handTrackFeed only on
 *     significant landmark change.
 */

(function () {
    'use strict';

    const TASKS_CDN  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const WASM_BASE  = TASKS_CDN + '/wasm';
    const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

    let _started        = false;
    let _worker         = null;
    let _workerReady    = false;
    let _detectInFlight = false;
    let _lastDetectAt   = 0;

    window._latestHandsLm = { right: null, left: null };

    // Minimum per-landmark movement (normalised 0-1 coords) to trigger a feed update.
    const _CHANGE_THRESH = 0.008;

    function _landmarksDiffer(a, b) {
        if (!a && !b) return false;
        if (!a || !b) return true;
        for (const idx of [0, 8, 12]) {
            const dx = a[idx].x - b[idx].x;
            const dy = a[idx].y - b[idx].y;
            if (dx * dx + dy * dy > _CHANGE_THRESH * _CHANGE_THRESH) return true;
        }
        return false;
    }

    function _pushLandmarks(right, left) {
        const prev = window._latestHandsLm;
        if (!_landmarksDiffer(right, prev.right) && !_landmarksDiffer(left, prev.left)) return;
        window._latestHandsLm.right = right;
        window._latestHandsLm.left  = left;
        if (typeof window._handTrackFeed === 'function') {
            try { window._handTrackFeed(right, left); }
            catch (e) { /* never let UI feed kill the tracker */ }
        }
    }

    function _initWorker() {
        _worker = new Worker('./src/mediapipe-worker.js', { type: 'module' });

        _worker.onmessage = function (e) {
            const { type, right, left } = e.data;
            if (type === 'READY') {
                _workerReady = true;
                console.log('[HandSynth] MediaPipe worker ready (CPU delegate, off-thread)');
                return;
            }
            if (type === 'RESULT') {
                _detectInFlight = false;
                _pushLandmarks(right, left);
                return;
            }
            if (type === 'ERROR') {
                console.warn('[HandSynth] Worker error:', e.data.message);
            }
        };

        _worker.onerror = function (e) {
            console.warn('[HandSynth] Worker crashed:', e);
            _workerReady    = false;
            _detectInFlight = false;
        };
    }

    // Called by KineticRack._loop() — fire-and-forget, no awaiting in mainLoop.
    async function _detectOnce(video, now) {
        if (!_worker || !_workerReady || _detectInFlight) return;
        if (!video || video.readyState < 2) return;
        if (document.hidden) return;
        // ~20 FPS throttle
        if (now - _lastDetectAt < 50) return;
        _lastDetectAt   = now;
        _detectInFlight = true;  // held until worker posts RESULT

        let bitmap;
        try {
            bitmap = await createImageBitmap(video);
        } catch (e) {
            _detectInFlight = false;
            return;
        }
        // Transfer bitmap — zero-copy; neutered on main thread after this line.
        _worker.postMessage({ type: 'DETECT', imageBitmap: bitmap, now }, [bitmap]);
    }

    window._detectHandsOnce = _detectOnce;

    window._startHandTracker = function () {
        if (_started) return;
        const vid = document.getElementById('kr-ai-video');
        if (!vid) {
            console.warn('[HandSynth] #kr-ai-video missing — will retry');
            setTimeout(window._startHandTracker, 500);
            return;
        }
        _started = true;
        // Spin up the worker; it posts READY when the model is loaded.
        // _detectOnce is gated on _workerReady so no frames fly before then.
        _initWorker();
    };

    // Auto-start once #kr-ai-video has a MediaStream.
    function _watch() {
        const vid = document.getElementById('kr-ai-video');
        if (vid && vid.srcObject) {
            window._startHandTracker();
            return;
        }
        setTimeout(_watch, 500);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _watch);
    } else {
        _watch();
    }
})();
