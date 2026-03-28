/* ═══════════════════════════════════════════════════════════════════
   TETHER — Multi-Mode Verlet Hand Instrument
   Three exclusive modes operated via the KI sidebar sub-menu.

   [ TETHER_CORE ]    Elastic tension lines thumb → fingertips
                      Tension opens a Biquad LPF drone.
                      Line snap triggers IDM Sub-Kick.

   [ CONSTELLATION ]  Full 21-landmark distance mesh.
                      Mesh density → WaveShaper distortion.
                      Closed fist = maximum destruction.

   [ FLOW ]           5 fingertip motion-blur trails.
                      X/Y velocity → Granular Delay parameters.

   Registers with SonicSuite as 'TETHER'.
═══════════════════════════════════════════════════════════════════ */
(function(global) {
'use strict';

var FINGERTIPS = [4, 8, 12, 16, 20];

function Tether() {
    this._audioCtx  = null;
    this._masterGain = null;

    // TETHER_CORE
    this._tcFilter   = null;
    this._tcOsc      = null;
    this._tcOscGain  = null;
    this._snapCooldown = 0;
    this._prevDist   = {};

    // CONSTELLATION
    this._wsNode   = null;
    this._wsGain   = null;
    this._wsOsc    = null;
    this._wsDensity = 0;

    // FLOW
    this._delayNode      = null;
    this._delayFeedback  = null;
    this._delayGain      = null;
    this._flowOsc        = null;
    this._flowOscGain    = null;
    this._trails         = {};
    this._prevPos        = {};

    this._mode = 'TETHER_CORE';
    this._latestResults = null;
}

// ── Lifecycle ─────────────────────────────────────────────────────
Tether.prototype.activate = function(audioCtx) {
    this._audioCtx = audioCtx;
    this._buildAudioGraph();
    this._syncModeButtons();
};

Tether.prototype.deactivate = function() {
    var stop = function(n) { if (n) { try { n.stop(); } catch(e) {} } };
    stop(this._tcOsc); stop(this._wsOsc); stop(this._flowOsc);
    this._trails = {};
    this._prevPos = {};
    this._prevDist = {};
};

Tether.prototype.setMode = function(mode) {
    this._mode = mode;
    this._syncModeButtons();
};

Tether.prototype._syncModeButtons = function() {
    var mode = this._mode;
    document.querySelectorAll('.ki-tether-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
};

// ── Audio Graph ───────────────────────────────────────────────────
Tether.prototype._buildAudioGraph = function() {
    var ctx = this._audioCtx;

    this._masterGain = ctx.createGain();
    this._masterGain.gain.value = 0.58;
    this._masterGain.connect(ctx.destination);

    // ── TETHER_CORE: resonant LPF drone ──────────────────────────
    this._tcFilter = ctx.createBiquadFilter();
    this._tcFilter.type = 'lowpass';
    this._tcFilter.frequency.value = 160;
    this._tcFilter.Q.value = 4.0;

    var tcOsc = ctx.createOscillator();
    tcOsc.type = 'sawtooth'; tcOsc.frequency.value = 82;
    this._tcOscGain = ctx.createGain(); this._tcOscGain.gain.value = 0;
    tcOsc.connect(this._tcOscGain);
    this._tcOscGain.connect(this._tcFilter);
    this._tcFilter.connect(this._masterGain);
    tcOsc.start(); this._tcOsc = tcOsc;

    // ── CONSTELLATION: WaveShaper distortion ─────────────────────
    this._wsNode = ctx.createWaveShaper();
    this._wsNode.curve = _makeCurve(0);
    this._wsNode.oversample = '2x';

    var wsOsc = ctx.createOscillator();
    wsOsc.type = 'sawtooth'; wsOsc.frequency.value = 55;
    this._wsGain = ctx.createGain(); this._wsGain.gain.value = 0;
    wsOsc.connect(this._wsGain);
    this._wsGain.connect(this._wsNode);
    this._wsNode.connect(this._masterGain);
    wsOsc.start(); this._wsOsc = wsOsc;

    // ── FLOW: granular delay ──────────────────────────────────────
    this._delayNode = ctx.createDelay(2.0);
    this._delayNode.delayTime.value = 0.3;
    this._delayFeedback = ctx.createGain(); this._delayFeedback.gain.value = 0.52;
    this._delayGain = ctx.createGain(); this._delayGain.gain.value = 0;

    var flowOsc = ctx.createOscillator();
    flowOsc.type = 'sine'; flowOsc.frequency.value = 110;
    this._flowOscGain = ctx.createGain(); this._flowOscGain.gain.value = 0;
    flowOsc.connect(this._flowOscGain);
    this._flowOscGain.connect(this._delayGain);
    this._delayGain.connect(this._delayNode);
    this._delayNode.connect(this._delayFeedback);
    this._delayFeedback.connect(this._delayNode);
    this._delayNode.connect(this._masterGain);
    flowOsc.start(); this._flowOsc = flowOsc;
};

// ── Kick transient (snap / tether break) ─────────────────────────
Tether.prototype._triggerKick = function() {
    var ctx = this._audioCtx;
    var t   = ctx.currentTime + 0.005;
    var osc = ctx.createOscillator();
    var g   = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(82, t);
    osc.frequency.exponentialRampToValueAtTime(26, t + 0.08);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
    osc.connect(g); g.connect(this._masterGain);
    osc.start(t); osc.stop(t + 0.52);
};

// ── Hand Results ──────────────────────────────────────────────────
Tether.prototype.onHandResults = function(results) {
    this._latestResults = results;
    if (!results || !results.multiHandLandmarks) return;

    var ctx = this._audioCtx;
    var now = performance.now();
    var self = this;

    results.multiHandLandmarks.forEach(function(lm, hIdx) {
        // ── TETHER_CORE ─────────────────────────────────────────
        if (self._mode === 'TETHER_CORE') {
            var thumb = lm[4];
            var totalTension = 0;
            FINGERTIPS.slice(1).forEach(function(tipIdx) {
                var tip  = lm[tipIdx];
                var dist = Math.hypot(tip.x - thumb.x, tip.y - thumb.y);
                totalTension += dist;
                var key  = hIdx + '_' + tipIdx;
                var prev = self._prevDist[key] !== undefined ? self._prevDist[key] : dist;
                // Snap: was close, now snapped open
                if (prev < 0.115 && dist > 0.215 && now - self._snapCooldown > 240) {
                    self._triggerKick();
                    self._snapCooldown = now;
                }
                self._prevDist[key] = dist;
            });
            var avg    = totalTension / 4;
            var cutoff = 80 + avg * 3200;
            self._tcFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.05);
            self._tcOscGain.gain.setTargetAtTime(0.3, ctx.currentTime, 0.08);
        }

        // ── CONSTELLATION ───────────────────────────────────────
        else if (self._mode === 'CONSTELLATION') {
            var close = 0, total = 0;
            for (var a = 0; a < 21; a++) {
                for (var b = a + 1; b < 21; b++) {
                    var d = Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
                    total++;
                    if (d < 0.14) close++;
                }
            }
            self._wsDensity = close / total;
            self._wsNode.curve = _makeCurve(self._wsDensity);
            self._wsGain.gain.setTargetAtTime(self._wsDensity * 0.48, ctx.currentTime, 0.1);
        }

        // ── FLOW ────────────────────────────────────────────────
        else if (self._mode === 'FLOW') {
            FINGERTIPS.forEach(function(tipIdx) {
                var tip = lm[tipIdx];
                var key = hIdx + '_' + tipIdx;
                var prev = self._prevPos[key];
                self._prevPos[key] = { x: tip.x, y: tip.y, t: now };

                if (!self._trails[key]) self._trails[key] = [];
                self._trails[key].push({ x: tip.x, y: tip.y, t: now });
                if (self._trails[key].length > 42) self._trails[key].shift();

                if (!prev || now - prev.t < 2) return;
                var dt = now - prev.t;
                var vx = (tip.x - prev.x) / dt * 1000;
                var vy = (tip.y - prev.y) / dt * 1000;

                var delayT   = Math.min(1.9, 0.04 + Math.abs(vx) * 0.55);
                var feedback = Math.min(0.84, 0.28 + Math.abs(vy) * 0.45);
                self._delayNode.delayTime.setTargetAtTime(delayT, ctx.currentTime, 0.1);
                self._delayFeedback.gain.setTargetAtTime(feedback, ctx.currentTime, 0.1);

                var speed = Math.hypot(vx, vy);
                if (speed > 0.08) {
                    var freq = Math.min(880, 110 + Math.abs(vx) * 220);
                    self._flowOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
                    self._flowOscGain.gain.setTargetAtTime(Math.min(0.38, speed * 0.1), ctx.currentTime, 0.05);
                    self._delayGain.gain.setTargetAtTime(0.58, ctx.currentTime, 0.05);
                }
            });
            // Gentle fade when hand is still
            self._flowOscGain.gain.setTargetAtTime(0,   ctx.currentTime + 0.12, 0.28);
            self._delayGain.gain.setTargetAtTime(0.18,  ctx.currentTime + 0.12, 0.28);
        }
    });

    // Silence inactive paths
    if (this._mode !== 'TETHER_CORE' && this._tcOscGain) {
        this._tcOscGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
    if (this._mode !== 'CONSTELLATION' && this._wsGain) {
        this._wsGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
    if (this._mode !== 'FLOW' && this._delayGain) {
        this._delayGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        this._flowOscGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
};

// ── Draw ──────────────────────────────────────────────────────────
Tether.prototype.draw = function(canvas, ctx, results) {
    var W   = canvas.width;
    var H   = canvas.height;
    var now = performance.now();

    ctx.fillStyle = 'rgba(0, 2, 8, 0.22)';
    ctx.fillRect(0, 0, W, H);

    var lm = results && results.multiHandLandmarks;
    if (!lm || !lm.length) {
        this._drawIdle(canvas, ctx);
        return;
    }

    var self = this;
    lm.forEach(function(landmarks, hIdx) {
        if (self._mode === 'TETHER_CORE')    self._drawTetherCore(ctx, landmarks, W, H, now);
        else if (self._mode === 'CONSTELLATION') self._drawConstellation(ctx, landmarks, W, H, now);
        else if (self._mode === 'FLOW')          self._drawFlow(ctx, landmarks, W, H, hIdx, now);
    });

    // Mode badge
    ctx.save();
    ctx.fillStyle   = 'rgba(176,0,255,0.42)';
    ctx.font        = "bold 9px 'Orbitron'";
    ctx.textAlign   = 'right';
    ctx.fillText('[ ' + this._mode + ' ]', W - 12, 18);
    ctx.restore();
};

// ── Mode Draw Routines ────────────────────────────────────────────
Tether.prototype._drawTetherCore = function(ctx, lm, W, H) {
    var thumb = lm[4];
    var tx = thumb.x * W, ty = thumb.y * H;
    var self = this;

    FINGERTIPS.slice(1).forEach(function(tipIdx) {
        var tip  = lm[tipIdx];
        var px   = tip.x * W, py = tip.y * H;
        var dist = Math.hypot(tip.x - thumb.x, tip.y - thumb.y);
        var tens = Math.min(1, dist / 0.35);
        var alp  = 0.28 + tens * 0.62;
        var lw   = 1 + tens * 3.2;
        var r    = Math.round(tens * 255);
        var b    = Math.round((1 - tens) * 240);

        ctx.save();
        ctx.strokeStyle = 'rgba(' + r + ',0,' + b + ',' + alp + ')';
        ctx.lineWidth   = lw;
        ctx.shadowBlur  = 6 + tens * 14;
        ctx.shadowColor = 'rgba(' + r + ',0,' + b + ',0.6)';

        // Elastic catenary arc
        var cpx = (tx + px) / 2 + (py - ty) * 0.14;
        var cpy = (ty + py) / 2 + tens * 22;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(cpx, cpy, px, py);
        ctx.stroke();
        ctx.restore();

        // Fingertip node
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + r + ',0,' + b + ',0.82)';
        ctx.fill();
    });

    // Thumb anchor
    ctx.beginPath();
    ctx.arc(tx, ty, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.shadowBlur = 12; ctx.shadowColor = '#fff';
    ctx.fill();

    // LPF readout
    if (this._tcFilter) {
        ctx.fillStyle = 'rgba(176,0,255,0.48)';
        ctx.font = "7.5px 'JetBrains Mono'";
        ctx.fillText('LPF ' + Math.round(this._tcFilter.frequency.value) + 'Hz', tx + 14, ty - 16);
    }
};

Tether.prototype._drawConstellation = function(ctx, lm, W, H, now) {
    var THRESH  = 0.14;
    var density = this._wsDensity;

    for (var a = 0; a < 21; a++) {
        for (var b = a + 1; b < 21; b++) {
            var d = Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
            if (d < THRESH) {
                var alp     = (1 - d / THRESH) * (0.28 + density * 0.52);
                var flicker = 0.7 + Math.sin(now * 0.009 + a + b) * 0.3;
                var lw      = (1 - d / THRESH) * (1 + density * 2.2);
                ctx.save();
                ctx.strokeStyle = 'rgba(176,0,255,' + (alp * flicker) + ')';
                ctx.lineWidth   = lw;
                ctx.shadowBlur  = density * 14;
                ctx.shadowColor = 'rgba(176,0,255,0.5)';
                ctx.beginPath();
                ctx.moveTo(lm[a].x * W, lm[a].y * H);
                ctx.lineTo(lm[b].x * W, lm[b].y * H);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    for (var i = 0; i < 21; i++) {
        var nr = 3 + density * 5;
        ctx.save();
        ctx.beginPath();
        ctx.arc(lm[i].x * W, lm[i].y * H, nr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(176,0,255,' + (0.38 + density * 0.55) + ')';
        if (density > 0.45) { ctx.shadowBlur = 14; ctx.shadowColor = '#b000ff'; }
        ctx.fill();
        ctx.restore();
    }

    ctx.fillStyle = 'rgba(176,0,255,0.45)';
    ctx.font      = "7.5px 'JetBrains Mono'";
    ctx.textAlign = 'left';
    ctx.fillText('DISTORT ' + Math.round(density * 100) + '%', 12, H - 18);
};

Tether.prototype._drawFlow = function(ctx, lm, W, H, hIdx, now) {
    var self = this;
    FINGERTIPS.forEach(function(tipIdx) {
        var key   = hIdx + '_' + tipIdx;
        var trail = self._trails[key];
        if (!trail || trail.length < 2) return;

        for (var i = 1; i < trail.length; i++) {
            var age  = now - trail[i].t;
            var prog = i / trail.length;
            var alp  = prog * Math.max(0, 1 - age / 1800) * 0.88;
            if (alp <= 0.01) continue;

            var hue = (tipIdx * 28 + now * 0.018) % 360;
            ctx.save();
            ctx.strokeStyle = 'hsla(' + hue + ',100%,65%,' + alp + ')';
            ctx.lineWidth   = prog * 5.5;
            ctx.shadowBlur  = prog * 14;
            ctx.shadowColor = 'hsla(' + hue + ',100%,65%,0.38)';
            ctx.beginPath();
            ctx.moveTo(trail[i-1].x * W, trail[i-1].y * H);
            ctx.lineTo(trail[i].x   * W, trail[i].y   * H);
            ctx.stroke();
            ctx.restore();
        }

        // Leading tip dot
        var tip = lm[tipIdx];
        ctx.save();
        ctx.beginPath();
        ctx.arc(tip.x * W, tip.y * H, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 16; ctx.shadowColor = '#ffffff';
        ctx.fill();
        ctx.restore();
    });

    // Prune stale trail points
    Object.keys(this._trails).forEach(function(k) {
        self._trails[k] = self._trails[k].filter(function(p) { return now - p.t < 1800; });
    });
};

Tether.prototype._drawIdle = function(canvas, ctx) {
    var W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.fillStyle   = 'rgba(176,0,255,0.14)';
    ctx.font        = "bold 10px 'Orbitron'";
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('[ TETHER — AWAITING HAND DATA ]', W / 2, H / 2);
    ctx.restore();
};

// ── WaveShaper curve ──────────────────────────────────────────────
function _makeCurve(amount) {
    var n   = 256;
    var cur = new Float32Array(n);
    var k   = amount * 420;
    for (var i = 0; i < n; i++) {
        var x = (i * 2) / n - 1;
        cur[i] = k > 0
            ? (Math.PI + k) * x / (Math.PI + k * Math.abs(x))
            : x;
    }
    return cur;
}

global.Tether = Tether;

})(window);
