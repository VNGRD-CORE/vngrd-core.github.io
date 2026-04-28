// Gesture values written by _handTrackFeed, consumed by KineticRack._loop().
window._gestureState = {
    pitch: 0.5, macro: 0.5, fm: 0, lfoRate: 0, lfoDepth: 0,
    vol: 0, preset: null, pluck: false, pluckX: 0.5, pluckVel: 0.8,
    handPresent: false,
};

// ── _handTrackFeed — X/Y Synth Pad Engine ─────────────────────────────────────
// Called by the main-thread MediaPipe Hands tracker (_startHandTracker above)
// with live 21-point hand landmarks.
// Right Hand lm[8] (index fingertip): X → Pitch 100-1200Hz, Y → Filter 200-8000Hz.
// Performance gate: vol=0.7 when hand detected, vol=0 when lost.
(function(){
    // Per-finger neon palette (thumb, index, middle, ring, pinky)
    var FINGER_COLORS = ['#FF4FD8','#00F3FF','#7CFF4F','#FFD24F','#C77DFF'];
    // Landmark index → finger group (0=palm,1=thumb,2=index,3=middle,4=ring,5=pinky)
    var LM_FINGER = [0, 1,1,1,1, 2,2,2,2, 3,3,3,3, 4,4,4,4, 5,5,5,5];
    var BONES = [
        [0,1],[1,2],[2,3],[3,4],           // thumb
        [0,5],[5,6],[6,7],[7,8],           // index
        [5,9],[9,10],[10,11],[11,12],      // middle
        [9,13],[13,14],[14,15],[15,16],    // ring
        [13,17],[17,18],[18,19],[19,20],   // pinky
        [0,17]                             // palm close
    ];

    // MediaPipe lm.z is negative (closer to camera) / positive (farther).
    // Map it to a 0.55–1.35 depth scalar: near joints bigger + brighter.
    function _depthScale(z) {
        if (z == null) return 1;
        // Typical range ≈ -0.12 … 0.08 in practice
        var t = Math.max(-0.15, Math.min(0.15, z));
        return 1 - t * 2.7; // near → ~1.4, far → ~0.6
    }

    function _drawHand(ctx, lms, W, H, isPrimary) {
        var dimmer   = isPrimary ? 1 : 0.55;
        var tNow     = performance.now() * 0.004;
        var pulse    = 0.5 + 0.5 * Math.sin(tNow);

        // Pass 1 — outer glow strokes (additive), depth-weighted line width
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';
        for (var c = 0; c < BONES.length; c++) {
            var ia = BONES[c][0], ib = BONES[c][1];
            var a = lms[ia], b = lms[ib];
            if (!a || !b) continue;
            var fgrp = LM_FINGER[ib] || LM_FINGER[ia] || 0;
            var color = FINGER_COLORS[Math.max(0, fgrp - 1)] || '#00F3FF';
            var ds    = (_depthScale(a.z) + _depthScale(b.z)) * 0.5;
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.22 * dimmer * ds;
            ctx.lineWidth   = 11 * ds;
            ctx.shadowColor = color;
            ctx.shadowBlur  = 22 * ds;
            ctx.beginPath();
            ctx.moveTo((1 - a.x) * W, a.y * H);
            ctx.lineTo((1 - b.x) * W, b.y * H);
            ctx.stroke();
        }

        // Pass 2 — crisp core strokes
        ctx.shadowBlur = 0;
        for (var c2 = 0; c2 < BONES.length; c2++) {
            var ia2 = BONES[c2][0], ib2 = BONES[c2][1];
            var a2 = lms[ia2], b2 = lms[ib2];
            if (!a2 || !b2) continue;
            var fgrp2 = LM_FINGER[ib2] || LM_FINGER[ia2] || 0;
            var color2 = FINGER_COLORS[Math.max(0, fgrp2 - 1)] || '#00F3FF';
            var ds2    = (_depthScale(a2.z) + _depthScale(b2.z)) * 0.5;
            ctx.strokeStyle = color2;
            ctx.globalAlpha = 0.95 * dimmer;
            ctx.lineWidth   = 2.6 * ds2;
            ctx.beginPath();
            ctx.moveTo((1 - a2.x) * W, a2.y * H);
            ctx.lineTo((1 - b2.x) * W, b2.y * H);
            ctx.stroke();
        }

        // Pass 3 — joints, depth-scaled
        for (var i = 0; i < 21; i++) {
            var lm = lms[i];
            if (!lm) continue;
            var fg = LM_FINGER[i];
            var col = fg === 0 ? '#FFFFFF' : FINGER_COLORS[fg - 1];
            var isTip = (i === 4 || i === 8 || i === 12 || i === 16 || i === 20);
            var isTarget = isPrimary && i === 8;
            var dsJ = _depthScale(lm.z);
            var r = isTarget ? (9 + pulse * 5) * dsJ
                             : (isTip ? 5 : 2.8) * dsJ;
            ctx.globalAlpha = (isTarget ? 1 : 0.9) * dimmer;
            ctx.fillStyle   = col;
            ctx.shadowColor = col;
            ctx.shadowBlur  = (isTarget ? 28 : (isTip ? 12 : 5)) * dsJ;
            ctx.beginPath();
            ctx.arc((1 - lm.x) * W, lm.y * H, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Pass 4 — target reticle on index fingertip (primary hand only)
        if (isPrimary && lms[8]) {
            var tx = (1 - lms[8].x) * W, ty = lms[8].y * H;
            var rr = 16 + pulse * 6;
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = '#00FFCC';
            ctx.shadowColor = '#00FFCC';
            ctx.shadowBlur  = 14;
            ctx.lineWidth   = 1.5;
            ctx.beginPath();
            ctx.arc(tx, ty, rr, 0, Math.PI * 2);
            ctx.stroke();
            // crosshair ticks
            ctx.beginPath();
            ctx.moveTo(tx - rr - 4, ty); ctx.lineTo(tx - rr + 2, ty);
            ctx.moveTo(tx + rr - 2, ty); ctx.lineTo(tx + rr + 4, ty);
            ctx.moveTo(tx, ty - rr - 4); ctx.lineTo(tx, ty - rr + 2);
            ctx.moveTo(tx, ty + rr - 2); ctx.lineTo(tx, ty + rr + 4);
            ctx.stroke();
        }
    }

    // ── ONE-EURO FILTER per landmark/axis ────────────────────────────────
    // Industry-standard adaptive smoother for gesture input: heavy smoothing
    // when the hand is still (kills MediaPipe jitter), light smoothing when
    // it moves fast (preserves intent). Cuts visible lag AND the stray-wrist
    // spikes in one shot. Tuned for MP Hands at ~25 Hz.
    var OE_MIN_CUTOFF = 1.2;  // base smoothing — lower = smoother still-hand
    var OE_BETA       = 0.06; // how quickly cutoff follows velocity
    var OE_DCUTOFF    = 1.0;  // smoothing on the derivative itself

    function _oeMakeHand() {
        var h = new Array(21);
        for (var i = 0; i < 21; i++) {
            h[i] = { x: null, y: null, z: null,
                     dx: 0, dy: 0, dz: 0, t: 0 };
        }
        return h;
    }
    var _oeR = _oeMakeHand();
    var _oeL = _oeMakeHand();

    function _oeAlpha(cutoff, dt) {
        var r = 2 * Math.PI * cutoff * dt;
        return r / (r + 1);
    }

    function _oeAxis(st, axis, dAxis, raw, t) {
        var prev = st[axis];
        if (prev === null) { st[axis] = raw; st.t = t; return raw; }
        var dt = Math.max(0.001, (t - st.t) / 1000);
        var aD = _oeAlpha(OE_DCUTOFF, dt);
        var dRaw = (raw - prev) / dt;
        st[dAxis] = st[dAxis] + aD * (dRaw - st[dAxis]);
        var cutoff = OE_MIN_CUTOFF + OE_BETA * Math.abs(st[dAxis]);
        var a = _oeAlpha(cutoff, dt);
        st[axis] = prev + a * (raw - prev);
        return st[axis];
    }

    function _oeFilter(hand, lm, t) {
        if (!lm) return null;
        var out = new Array(21);
        for (var i = 0; i < 21; i++) {
            var a = lm[i]; if (!a) { out[i] = null; continue; }
            var s = hand[i];
            s.t = s.t || t;
            out[i] = {
                x: _oeAxis(s, 'x', 'dx', a.x, t),
                y: _oeAxis(s, 'y', 'dy', a.y, t),
                z: _oeAxis(s, 'z', 'dz', a.z || 0, t)
            };
            s.t = t;
        }
        return out;
    }

    function _dist3(a, b) {
        if (!a || !b) return 0;
        var dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // Pinch rising-edge latch (with hysteresis) → triggers a pluck note.
    var _prevPinchHigh = false;
    var NOTE_LABELS = ['A1','C2','D2','E2','G2','A2','C3','D3','E3','G3'];

    window._handTrackFeed = function(rightLm, leftLm) {
        var rack = window.KineticRack;
        if (!rack || !rack.active) return;

        var canvas = document.getElementById('kr-skeleton-canvas');
        var ctx    = canvas ? canvas.getContext('2d') : null;

        // ── 1. RESIZE + CLEAR HUD ────────────────────────────────────────────
        if (canvas && ctx) {
            var rect = canvas.getBoundingClientRect();
            if (canvas.width !== rect.width || canvas.height !== rect.height) {
                canvas.width  = rect.width;
                canvas.height = rect.height;
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // ── 2. ONE-EURO SMOOTH ──────────────────────────────────────────────
        var tNow  = performance.now();
        var rDraw = _oeFilter(_oeR, rightLm, tNow);
        var lDraw = _oeFilter(_oeL, leftLm,  tNow);

        // ── 3. PERFORMANCE GATE (no right hand = silence) ───────────────────
        window._gestureState.handPresent = !!rDraw;
        window._gestureState.vol         = rDraw ? 0.6 : 0;
        if (!rDraw) {
            window._gestureState.fm       = 0;
            window._gestureState.lfoDepth = 0;
            _prevPinchHigh = false;
            var vs = document.querySelector('[data-ctrl="vol"]');
            if (vs) vs.value = 0;
            if (lDraw && ctx) {
                ctx.save();
                _drawHand(ctx, lDraw, canvas.width, canvas.height, false);
                ctx.restore();
            }
            return;
        }

        var lm8 = rDraw[8];

        // ── 4. X → PITCH, Y → MACRO (opens filter + body + sub together) ───
        var xNorm = Math.max(0, Math.min(1, 1 - lm8.x));
        var yNorm = Math.max(0, Math.min(1, 1 - lm8.y));
        window._gestureState.pitch = xNorm;
        window._gestureState.macro = yNorm;

        // ── 4b. LEFT HAND Y → preset bank (ambient / techno / dubstep) ─────
        var presetName = null;
        if (lDraw && lDraw[0]) {
            var lY = lDraw[0].y;
            if (lY < 0.33)      presetName = 'dubstep';
            else if (lY < 0.66) presetName = 'techno';
            else                presetName = 'ambient';
            window._gestureState.preset = presetName;
        }

        // ── 5. GESTURES ─────────────────────────────────────────────────────
        var handSize = Math.max(0.03, _dist3(rDraw[0], rDraw[9]));
        var pinchRaw = _dist3(rDraw[4], rDraw[8]) / handSize;
        var pinch    = Math.max(0, Math.min(1, 1 - (pinchRaw - 0.35) / 1.25));
        var tips = [4, 8, 12, 16, 20];
        var sum  = 0;
        for (var t = 0; t < 5; t++) sum += _dist3(rDraw[0], rDraw[tips[t]]);
        var spreadRaw = (sum / 5) / handSize;
        var spread    = Math.max(0, Math.min(1, (spreadRaw - 1.8) / 1.6));

        window._gestureState.fm       = pinch;
        window._gestureState.lfoRate  = spread;
        window._gestureState.lfoDepth = spread * 0.9;

        // Pinch rising edge — store as one-shot; _loop() fires with cooldown.
        var isPinchHigh = _prevPinchHigh ? (pinch > 0.45) : (pinch > 0.7);
        if (isPinchHigh && !_prevPinchHigh) {
            window._gestureState.pluck    = true;
            window._gestureState.pluckX   = xNorm;
            window._gestureState.pluckVel = Math.min(1, 0.6 + pinch * 0.5);
        }
        _prevPinchHigh = isPinchHigh;

        // ── 6. GATE ON (vol + handPresent set at top of function) ───────────

        // Slider sync
        var volSlider  = document.querySelector('[data-ctrl="vol"]');
        var filtSlider = document.querySelector('[data-ctrl="filter"]');
        if (volSlider)  volSlider.value  = 0.6;
        if (filtSlider) filtSlider.value = yNorm.toFixed(3);

        // ── 7. DRAW SKELETON + MODULATOR HUD ────────────────────────────────
        if (!ctx) return;
        var W = canvas.width, H = canvas.height;
        ctx.save();
        if (lDraw) _drawHand(ctx, lDraw, W, H, false);
        _drawHand(ctx, rDraw, W, H, true);

        // Pinch glow line — thumb ↔ index, magenta, scales with pinch amount
        if (pinch > 0.15) {
            var ax = (1 - rDraw[4].x) * W, ay = rDraw[4].y * H;
            var bx = (1 - rDraw[8].x) * W, by = rDraw[8].y * H;
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = '#FF4FD8';
            ctx.shadowColor = '#FF4FD8';
            ctx.shadowBlur  = 18 * pinch;
            ctx.lineWidth   = 2 + pinch * 5;
            ctx.globalAlpha = 0.35 + pinch * 0.6;
            ctx.beginPath();
            ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
            ctx.stroke();
        }

        // LFO wobble ring around the index-fingertip target reticle — its
        // radius pulses at the current LFO rate * spread depth.
        var tx = (1 - lm8.x) * W, ty = lm8.y * H;
        if (spread > 0.05) {
            var lfoPhase = (tNow * 0.001) * (0.3 + spread * 11) * 2 * Math.PI;
            var ringR = 26 + Math.sin(lfoPhase) * (8 + spread * 22);
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = '#7CFF4F';
            ctx.shadowColor = '#7CFF4F';
            ctx.shadowBlur  = 12;
            ctx.lineWidth   = 2;
            ctx.globalAlpha = 0.4 + spread * 0.4;
            ctx.beginPath();
            ctx.arc(tx, ty, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Current note label — shows which scale note the arp/pluck will hit
        var noteIdx = Math.max(0, Math.min(9, Math.floor(xNorm * 10)));
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.95;
        ctx.shadowBlur  = 0;
        ctx.font        = '600 14px "JetBrains Mono", monospace';
        ctx.fillStyle   = '#00F3FF';
        ctx.fillText(NOTE_LABELS[noteIdx], tx + 22, ty - 22);

        // Pinch meter — thin bar top-left
        ctx.globalAlpha  = 0.8;
        ctx.fillStyle    = 'rgba(255,79,216,0.15)';
        ctx.fillRect(16, 16, 160, 6);
        ctx.fillStyle    = '#FF4FD8';
        ctx.shadowColor  = '#FF4FD8';
        ctx.shadowBlur   = 8;
        ctx.fillRect(16, 16, 160 * pinch, 6);
        ctx.shadowBlur   = 0;
        ctx.font         = '500 10px "JetBrains Mono", monospace';
        ctx.fillStyle    = 'rgba(255,79,216,0.9)';
        ctx.fillText('PINCH', 16, 12);

        // Macro meter — below pinch
        ctx.fillStyle    = 'rgba(124,255,79,0.15)';
        ctx.fillRect(16, 38, 160, 6);
        ctx.fillStyle    = '#7CFF4F';
        ctx.shadowColor  = '#7CFF4F';
        ctx.shadowBlur   = 8;
        ctx.fillRect(16, 38, 160 * yNorm, 6);
        ctx.shadowBlur   = 0;
        ctx.fillStyle    = 'rgba(124,255,79,0.9)';
        ctx.fillText('MACRO', 16, 34);

        // Spread meter
        ctx.fillStyle    = 'rgba(0,243,255,0.15)';
        ctx.fillRect(16, 60, 160, 6);
        ctx.fillStyle    = '#00F3FF';
        ctx.shadowColor  = '#00F3FF';
        ctx.shadowBlur   = 8;
        ctx.fillRect(16, 60, 160 * spread, 6);
        ctx.shadowBlur   = 0;
        ctx.fillStyle    = 'rgba(0,243,255,0.9)';
        ctx.fillText('SPREAD / WOBBLE', 16, 56);

        // Preset badge — mirrors the active bank. Colour-coded per preset so
        // the player gets instant feedback on which mode the left hand set.
        var activeName = presetName || (rack._presetName || 'techno');
        var PRESET_COLOR = { ambient: '#7CFF4F', techno: '#00F3FF', dubstep: '#FF4FD8' };
        var badgeCol = PRESET_COLOR[activeName] || '#00F3FF';
        ctx.font          = '700 12px "JetBrains Mono", monospace';
        ctx.globalAlpha   = 0.95;
        ctx.strokeStyle   = badgeCol;
        ctx.shadowColor   = badgeCol;
        ctx.shadowBlur    = 10;
        ctx.lineWidth     = 1.5;
        var bw = ctx.measureText(activeName.toUpperCase()).width + 20;
        ctx.strokeRect(16, 82, bw, 22);
        ctx.fillStyle     = badgeCol;
        ctx.fillText(activeName.toUpperCase(), 26, 98);
        ctx.shadowBlur    = 0;

        ctx.restore();
    };
})();
