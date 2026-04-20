/**
 * hand-tracker.js — MediaPipe Tasks HandLandmarker (GPU-accelerated).
 *
 * Upgraded from the legacy @mediapipe/hands graph-runtime CDN build:
 *
 *   - Uses the new @mediapipe/tasks-vision HandLandmarker, which runs via a
 *     WebGL/GPU delegate (2-3x faster detect on most laptops).
 *   - Driven by video.requestVideoFrameCallback(): detection fires exactly
 *     when the camera produces a new frame, not on rAF phase. Eliminates
 *     the 1-frame jitter you got when render and detect were out of sync.
 *   - Single source of truth: writes window._latestHandsLm and calls
 *     window._handTrackFeed(right, left) after every successful detect.
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

    let _started       = false;
    let _landmarker    = null;
    let _detectInFlight = false;
    let _lastDetectAt  = 0;

    window._latestHandsLm = { right: null, left: null };

    function _pushLandmarks(right, left) {
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

    function _startDetectLoop(video) {
        // Prefer requestVideoFrameCallback — fires exactly when a new camera
        // frame is decoded. Falls back to rAF where unavailable (Firefox <132).
        const hasVFC = typeof video.requestVideoFrameCallback === 'function';

        function _pumpVFC(_now, _meta) {
            _detectOnce(video);
            video.requestVideoFrameCallback(_pumpVFC);
        }
        function _pumpRAF() {
            _detectOnce(video);
            requestAnimationFrame(_pumpRAF);
        }

        if (hasVFC) {
            video.requestVideoFrameCallback(_pumpVFC);
            console.log('[HandSynth] Detect loop: requestVideoFrameCallback');
        } else {
            requestAnimationFrame(_pumpRAF);
            console.log('[HandSynth] Detect loop: rAF (fallback)');
        }
    }

    function _detectOnce(video) {
        if (!_landmarker || _detectInFlight) return;
        if (!video || video.readyState < 2) return;
        // De-dupe on the same video frame (rVFC can fire multiple times per
        // frame with fast cameras; Tasks needs monotonically-increasing ts).
        const now = performance.now();
        if (now - _lastDetectAt < 4) return;
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
        _startDetectLoop(vid);
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
