/* ═══════════════════════════════════════════════════════════════════
   NEURAL_GLITCH — IDM Synthesizer + Cyber Radar Grid
   100% native Web Audio API synthesis — no external files.
   Sub-Kick · Noise-Snare · Metallic Glitch-Hat
   Right Hand X/Y → Beat Repeat / Bitcrusher
   Left Hand Pinch → Manual Sub-Kick
   Registers with SonicSuite as 'NEURAL_GLITCH'.
═══════════════════════════════════════════════════════════════════ */
(function(global) {
'use strict';

var STEPS    = 16;
var BASE_BPM = 140;

// ── 16-step patterns ─────────────────────────────────────────────
var PATTERNS = {
    kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,1,0,0],
    snare: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1],
    hat:   [1,1,0,1, 1,0,1,1, 1,1,0,1, 1,0,1,1],
};

function NeuralGlitch() {
    this._audioCtx   = null;
    this._masterGain = null;
    this._compressor = null;
    this._crushInput = null;
    this._scriptProc = null;

    // Scheduler state
    this._schedId      = null;
    this._currentStep  = 0;
    this._nextStepTime = 0;
    this._bpm          = BASE_BPM;
    this._ratchet      = 1;  // 1, 2, 4
    this._crush        = 0;  // 0=clean → 1=8-bit destroy

    // Visual state
    this._beatFlash  = 0;
    this._warpAmount = 0;
    this._warpPhase  = 0;

    // Hand state
    this._rHandX      = 0.5;
    this._rHandY      = 0.5;
    this._lPinch      = false;
    this._lPinchPrev  = false;
}

// ── Lifecycle ─────────────────────────────────────────────────────
NeuralGlitch.prototype.activate = function(audioCtx) {
    this._audioCtx = audioCtx;
    this._buildAudioGraph();
    this._startScheduler();
};

NeuralGlitch.prototype.deactivate = function() {
    this._stopScheduler();
    if (this._masterGain) { try { this._masterGain.disconnect(); } catch(e) {} }
    if (this._scriptProc) { try { this._scriptProc.disconnect(); } catch(e) {} this._scriptProc = null; }
    this._beatFlash = 0; this._warpAmount = 0;
};

// ── Audio Graph ───────────────────────────────────────────────────
NeuralGlitch.prototype._buildAudioGraph = function() {
    var ctx = this._audioCtx;

    this._compressor = ctx.createDynamicsCompressor();
    this._compressor.threshold.value = -14;
    this._compressor.ratio.value     = 8;
    this._compressor.attack.value    = 0.003;
    this._compressor.release.value   = 0.25;
    this._compressor.connect(ctx.destination);

    this._masterGain = ctx.createGain();
    this._masterGain.gain.value = 0.78;
    this._masterGain.connect(this._compressor);

    // Bitcrusher via ScriptProcessorNode
    // Reduces bit-depth from 16 down to ~2 at full crush
    var sp = ctx.createScriptProcessor(256, 1, 1);
    var self = this;
    sp.onaudioprocess = function(e) {
        var inp  = e.inputBuffer.getChannelData(0);
        var out  = e.outputBuffer.getChannelData(0);
        var bits = Math.max(1, Math.round(16 - self._crush * 14));
        var step = Math.pow(2, bits);
        for (var i = 0; i < inp.length; i++) {
            out[i] = Math.round(inp[i] * step) / step;
        }
    };
    this._scriptProc = sp;

    this._crushInput = ctx.createGain();
    this._crushInput.connect(sp);
    sp.connect(this._masterGain);
};

// ── Drum Synthesis ────────────────────────────────────────────────
NeuralGlitch.prototype._synthKick = function(vel, when) {
    var ctx = this._audioCtx;
    var t   = when;

    // Sub body: sine sweep 80 → 28 Hz
    var sub = ctx.createOscillator();
    var gSub = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.075);
    gSub.gain.setValueAtTime(vel * 1.35, t);
    gSub.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);

    // Transient click: triangle sweep
    var click  = ctx.createOscillator();
    var gClick = ctx.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(210, t);
    click.frequency.exponentialRampToValueAtTime(30, t + 0.012);
    gClick.gain.setValueAtTime(vel * 0.55, t);
    gClick.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);

    sub.connect(gSub);     gSub.connect(this._crushInput);
    click.connect(gClick); gClick.connect(this._crushInput);
    sub.start(t);   sub.stop(t + 0.56);
    click.start(t); click.stop(t + 0.06);
};

NeuralGlitch.prototype._synthSnare = function(vel, when) {
    var ctx = this._audioCtx;
    var t   = when;
    var sr  = ctx.sampleRate;

    // Noise body
    var nBuf = ctx.createBuffer(1, Math.floor(sr * 0.18), sr);
    var nd   = nBuf.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    var nSrc  = ctx.createBufferSource(); nSrc.buffer = nBuf;
    var nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass'; nFilt.frequency.value = 3400; nFilt.Q.value = 0.65;
    var gNoise = ctx.createGain();
    gNoise.gain.setValueAtTime(vel * 0.88, t);
    gNoise.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

    // Tonal snap
    var snap  = ctx.createOscillator();
    var gSnap = ctx.createGain();
    snap.type = 'triangle'; snap.frequency.value = 225;
    gSnap.gain.setValueAtTime(vel * 0.42, t);
    gSnap.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

    nSrc.connect(nFilt); nFilt.connect(gNoise); gNoise.connect(this._crushInput);
    snap.connect(gSnap); gSnap.connect(this._crushInput);
    nSrc.start(t);
    snap.start(t); snap.stop(t + 0.08);
};

NeuralGlitch.prototype._synthHat = function(vel, when) {
    var ctx = this._audioCtx;
    var t   = when;

    // 6 detuned square oscillators in metallic ratio stack, gated through HPF
    var freqs = [200, 271, 400, 542, 800, 1084].map(function(f) { return f * 5.5; });
    var gHat  = ctx.createGain();
    var hFilt = ctx.createBiquadFilter();
    hFilt.type = 'highpass'; hFilt.frequency.value = 6800;
    gHat.gain.setValueAtTime(vel * 0.32, t);
    gHat.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);

    freqs.forEach(function(f) {
        var osc = ctx.createOscillator();
        osc.type = 'square'; osc.frequency.value = f;
        osc.connect(hFilt);
        osc.start(t); osc.stop(t + 0.09);
    });
    hFilt.connect(gHat); gHat.connect(this._crushInput);
};

// ── Lookahead Scheduler ───────────────────────────────────────────
NeuralGlitch.prototype._startScheduler = function() {
    var LOOKAHEAD = 0.055;
    var INTERVAL  = 22;
    this._nextStepTime = this._audioCtx.currentTime + 0.12;
    var self = this;
    this._schedId = setInterval(function() { self._scheduleTick(LOOKAHEAD); }, INTERVAL);
};

NeuralGlitch.prototype._stopScheduler = function() {
    if (this._schedId) { clearInterval(this._schedId); this._schedId = null; }
};

NeuralGlitch.prototype._scheduleTick = function(lookahead) {
    var ctx = this._audioCtx;
    while (this._nextStepTime < ctx.currentTime + lookahead) {
        this._fireStep(this._currentStep, this._nextStepTime);
        var stepDur = (60 / this._bpm) / 4 / this._ratchet;
        this._nextStepTime  += stepDur;
        this._currentStep    = (this._currentStep + 1) % (STEPS * this._ratchet);
    }
};

NeuralGlitch.prototype._fireStep = function(step, when) {
    var base = step % STEPS;
    var vel  = 0.68 + Math.random() * 0.32;
    var hit  = false;

    if (PATTERNS.kick[base])  { this._synthKick(vel, when); hit = true; }
    if (PATTERNS.snare[base]) { this._synthSnare(vel * 0.8, when); hit = true; }
    if (PATTERNS.hat[base])   { this._synthHat(vel * 0.55, when); hit = true; }

    if (hit) {
        this._beatFlash  = 1;
        this._warpAmount = Math.max(this._warpAmount, PATTERNS.kick[base] ? 1.0 : 0.45);
    }
};

// ── Hand Results ──────────────────────────────────────────────────
NeuralGlitch.prototype.onHandResults = function(results) {
    if (!results || !results.multiHandLandmarks) return;
    var self = this;

    results.multiHandLandmarks.forEach(function(lm, hIdx) {
        var hand  = (results.multiHandedness[hIdx] || {}).label || 'Right';
        var wrist = lm[0];

        if (hand === 'Right') {
            self._rHandX = wrist.x;
            self._rHandY = wrist.y;
            // X: left third → ×1, middle → ×2, right third → ×4
            if      (self._rHandX < 0.33) self._ratchet = 1;
            else if (self._rHandX < 0.66) self._ratchet = 2;
            else                          self._ratchet = 4;
            // Y: top = max crush, bottom = clean
            self._crush = Math.max(0, Math.min(1, 1 - self._rHandY));
        }

        if (hand === 'Left') {
            var thumb = lm[4], index = lm[8];
            var dist  = Math.hypot(thumb.x - index.x, thumb.y - index.y);
            self._lPinch = dist < 0.062;
            if (self._lPinch && !self._lPinchPrev) {
                self._synthKick(1.0, self._audioCtx.currentTime + 0.005);
                self._beatFlash  = 1;
                self._warpAmount = 1.5;
            }
            self._lPinchPrev = self._lPinch;
        }
    });
};

// ── Draw ──────────────────────────────────────────────────────────
NeuralGlitch.prototype.draw = function(canvas, ctx, results) {
    var W = canvas.width;
    var H = canvas.height;

    // Decay visual state
    this._beatFlash  = Math.max(0, this._beatFlash  - 0.042);
    this._warpAmount = Math.max(0, this._warpAmount - 0.028);
    this._warpPhase += 0.048 + this._warpAmount * 0.14;

    var bf = this._beatFlash;
    var wa = this._warpAmount;

    // Dark wash
    ctx.fillStyle = 'rgba(0, 2, 6,' + (0.28 + bf * 0.22) + ')';
    ctx.fillRect(0, 0, W, H);

    var cx = W / 2;
    var cy = H / 2;
    var maxR = Math.min(W, H) * 0.44;

    ctx.save();
    ctx.translate(cx, cy);

    var crush = this._crush;

    // ── Concentric rings ─────────────────────────────────────────
    for (var ring = 1; ring <= 8; ring++) {
        var baseR = (ring / 8) * maxR;
        var wR    = baseR + Math.sin(this._warpPhase + ring * 0.75) * wa * 16;
        var alpha = 0.09 + (ring === 8 ? 0.1 : 0) + bf * 0.18;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,243,255,' + alpha + ')';
        ctx.lineWidth   = ring === 8 ? 1.6 : 0.75;

        if (crush > 0.08) {
            // Distort ring outline proportional to bitcrusher amount
            var pts = 64;
            for (var p = 0; p <= pts; p++) {
                var a = (p / pts) * Math.PI * 2;
                var dr = wR + Math.sin(a * 6 + this._warpPhase) * crush * 16;
                var px = Math.cos(a) * dr;
                var py = Math.sin(a) * dr;
                p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
        } else {
            ctx.arc(0, 0, wR, 0, Math.PI * 2);
        }
        ctx.stroke();
    }

    // ── Radial spokes ────────────────────────────────────────────
    for (var s = 0; s < 24; s++) {
        var sa     = (s / 24) * Math.PI * 2;
        var wEnd   = maxR + Math.sin(this._warpPhase * 1.25 + s * 0.48) * wa * 18;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,243,255,' + (0.055 + bf * 0.09) + ')';
        ctx.lineWidth   = 0.55;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(sa) * wEnd, Math.sin(sa) * wEnd);
        ctx.stroke();
    }

    // ── Center pulse ─────────────────────────────────────────────
    var dotR = 4 + bf * 15 + wa * 9;
    var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, dotR * 2.2);
    grad.addColorStop(0, 'rgba(0,243,255,' + (0.82 + bf * 0.18) + ')');
    grad.addColorStop(1, 'rgba(0,243,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, dotR * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // ── Step indicator strip ─────────────────────────────────────
    var stepW = W / STEPS;
    var curStep = this._currentStep % STEPS;
    ctx.save();
    ctx.fillStyle = 'rgba(0,243,255,' + (0.12 + bf * 0.25) + ')';
    ctx.fillRect(curStep * stepW, H - 6, stepW - 1, 4);
    ctx.restore();

    // ── Hand overlays ────────────────────────────────────────────
    if (results && results.multiHandLandmarks) {
        var self = this;
        results.multiHandLandmarks.forEach(function(lm, hIdx) {
            var hand  = (results.multiHandedness[hIdx] || {}).label || 'Right';
            var wrist = lm[0];
            var hx    = wrist.x * W;
            var hy    = wrist.y * H;

            ctx.save();
            if (hand === 'Right') {
                ctx.strokeStyle = 'rgba(0,243,255,0.35)';
                ctx.lineWidth   = 1.2;
                ctx.beginPath(); ctx.arc(hx, hy, 16, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = 'rgba(0,243,255,0.55)';
                ctx.font = "8px 'JetBrains Mono'";
                ctx.fillText('×' + self._ratchet, hx - 6, hy - 22);
                ctx.fillText('CRUSH ' + Math.round(crush * 100) + '%', hx - 22, hy - 10);
            } else {
                var pinchColor = self._lPinch ? '#ff3333' : 'rgba(255,50,50,0.3)';
                ctx.strokeStyle = pinchColor;
                ctx.lineWidth   = self._lPinch ? 2.8 : 1;
                if (self._lPinch) { ctx.shadowBlur = 22; ctx.shadowColor = '#ff3333'; }
                ctx.beginPath(); ctx.arc(hx, hy, 18, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = 'rgba(255,60,60,0.55)';
                ctx.font = "8px 'JetBrains Mono'";
                ctx.fillText('KICK', hx - 10, hy + 30);
            }
            ctx.restore();
        });
    }

    // ── Bottom HUD ───────────────────────────────────────────────
    ctx.save();
    ctx.fillStyle = 'rgba(0,243,255,' + (0.28 + bf * 0.35) + ')';
    ctx.font      = "bold 10px 'Orbitron'";
    ctx.textAlign = 'center';
    ctx.fillText(
        'RATCHET ×' + this._ratchet + '   ·   CRUSH ' + Math.round(this._crush * 100) + '%',
        W / 2, H - 16
    );
    ctx.restore();
};

global.NeuralGlitch = NeuralGlitch;

})(window);
