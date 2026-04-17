/**
 * hand-tracker.js — Main-thread MediaPipe Hands → _handTrackFeed driver.
 *
 * Loads the pinned @mediapipe/hands CDN bundle (injected via index.html),
 * runs detection on the existing #kr-ai-video element via rAF, and pushes
 * 21-point right/left landmarks to window._handTrackFeed. KineticRack's
 * worker-based pipeline can still drive _handTrackFeed independently — both
 * paths converge on the same slider/HUD state (last-write-wins).
 */

(function () {
    'use strict';

    var _started = false;
    var _hands   = null;

    // Shared landmark cache — lets KineticRack.js reuse landmarks for its 3D
    // hand meshes without double-running MediaPipe.
    window._latestHandsLm = { right: null, left: null };

    function _pickLandmarks(results) {
        var right = null, left = null;
        if (!results || !results.multiHandLandmarks || !results.multiHandedness) {
            return { right: right, left: left };
        }
        for (var i = 0; i < results.multiHandLandmarks.length; i++) {
            var label = results.multiHandedness[i] && results.multiHandedness[i].label;
            var lms   = results.multiHandLandmarks[i];
            // MediaPipe labels from the camera POV (un-mirrored). _handTrackFeed
            // mirrors X via (1 - x), so label 'Right' here is the user's right.
            if (label === 'Right') right = lms;
            else if (label === 'Left') left = lms;
        }
        return { right: right, left: left };
    }

    function _onResults(results) {
        var picked = _pickLandmarks(results);
        window._latestHandsLm.right = picked.right;
        window._latestHandsLm.left  = picked.left;
        if (typeof window._handTrackFeed === 'function') {
            try { window._handTrackFeed(picked.right, picked.left); }
            catch (e) { /* never let UI feed kill the tracker */ }
        }
    }

    window._startHandTracker = function () {
        if (_started) return;
        if (typeof Hands === 'undefined') {
            console.warn('[HandSynth] MediaPipe Hands CDN not ready — retrying');
            setTimeout(window._startHandTracker, 500);
            return;
        }
        var vid = document.getElementById('kr-ai-video');
        if (!vid) {
            console.warn('[HandSynth] #kr-ai-video missing');
            return;
        }
        _started = true;

        _hands = new Hands({
            locateFile: function (f) {
                return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/' + f;
            },
        });
        _hands.setOptions({
            maxNumHands:              2,
            // complexity 0 = fast lite model (~2× faster than 1). For an XY
            // pad where we mainly need lm[8], the accuracy hit is negligible
            // and the latency win is huge.
            modelComplexity:          0,
            minDetectionConfidence:   0.5,
            minTrackingConfidence:    0.5,
            selfieMode:               false,
        });
        _hands.onResults(_onResults);

        // Drive Hands off the existing video element via rAF — we don't use
        // the camera_utils Camera helper because it would call getUserMedia
        // again and clobber the stream KineticRack already assigned.
        var _busy = false;
        function _pump() {
            if (!_started) return;
            requestAnimationFrame(_pump);
            if (_busy) return;
            if (vid.readyState < 2) return;
            _busy = true;
            _hands.send({ image: vid }).then(function () {
                _busy = false;
            }).catch(function () {
                _busy = false;
            });
        }
        _pump();
        console.log('[HandSynth] MediaPipe Hands tracker LIVE');
    };

    // Auto-start once #kr-ai-video has a MediaStream. KineticRack.init Phase 3
    // also calls _startHandTracker() directly after attaching the stream, so
    // this poll is a belt-and-suspenders fallback.
    function _watch() {
        var vid = document.getElementById('kr-ai-video');
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
