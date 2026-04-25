/**
 * hand-tracker.js — MediaPipe Tasks HandLandmarker (GPU-accelerated).
 *
 *   - No internal rAF or requestVideoFrameCallback loop.
 *   - Detection is driven exclusively by KineticRack._loop() via
 *     window._detectHandsOnce(video, now), throttled to ~20 FPS.
 *   - Single source of truth: writes window._latestHandsLm and calls
 *     window._handTrackFeed(right, left) only when landmarks change
 *     significantly.
 *
 * KineticRack's _detectHands reads window._latestHandsLm each render frame;
 * the one-euro filter in index.html smooths the raw landmarks before they
 * ever hit audio or draw. No main-thread MP graph, no worker, no
 * getImageData per frame.
 */

(function () {
    'use strict';

    const TASKS_CDN  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const WASM_BASE  = TASKS_CDN + '/wasm';
    const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

    let _started        = false;
    let _landmarker     = null;
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

    function _pickFromTasksResult(res) {
        let right = null, left = null;
        if (!res || !res.landmarks || !res.handednesses) return { right, left };
        for (let i = 0; i < res.landmarks.length; i++) {
            const hand  = res.handednesses[i];
            const label = hand && hand[0] && hand[0].categoryName;
            const lms   = res.landmarks[i];
            // MediaPipe Tasks reports handedness from the camera POV; we mirror
            // X in the UI feed (1 - x) so the camera's 'Right' is the user's
            // right hand in the frame.
            if (label === 'Right') right = lms;
            else if (label === 'Left') left = lms;
        }
        return { right, left };
    }

    async function _initLandmarker() {
        const mod  = await import(TASKS_CDN + '/vision_bundle.mjs');
        const fs   = await mod.FilesetResolver.forVisionTasks(WASM_BASE);
        _landmarker = await mod.HandLandmarker.createFromOptions(fs, {
            baseOptions: {
                modelAssetPath: MODEL_URL,
                delegate:       'GPU',
            },
            runningMode:                'VIDEO',
            numHands:                   2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence:  0.5,
            minTrackingConfidence:      0.5,
        });
        console.log('[HandSynth] MediaPipe Tasks HandLandmarker (GPU) ready');
    }

    // Called by KineticRack._loop() — no internal rAF/rVFC loop needed.
    function _detectOnce(video, now) {
        if (!_landmarker || _detectInFlight) return;
        if (!video || video.readyState < 2) return;
        if (document.hidden) return;
        // ~20 FPS throttle — MediaPipe needs ~50 ms between calls to be useful.
        if (now - _lastDetectAt < 50) return;
        _lastDetectAt = now;

        _detectInFlight = true;
        try {
            const res = _landmarker.detectForVideo(video, now);
            const picked = _pickFromTasksResult(res);
            _pushLandmarks(picked.right, picked.left);
        } catch (e) {
            // swallow — don't let a detect blip kill the loop
        }
        _detectInFlight = false;
    }

    window._detectHandsOnce = _detectOnce;

    window._startHandTracker = async function () {
        if (_started) return;
        const vid = document.getElementById('kr-ai-video');
        if (!vid) {
            console.warn('[HandSynth] #kr-ai-video missing — will retry');
            setTimeout(window._startHandTracker, 500);
            return;
        }
        _started = true;

        try {
            await _initLandmarker();
        } catch (e) {
            console.warn('[HandSynth] HandLandmarker init failed:', e);
            _started = false;
            return;
        }
        // Detection is driven by KineticRack._loop() via window._detectHandsOnce.
        console.log('[HandSynth] Ready — awaiting mainLoop-driven detection');
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
