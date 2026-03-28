/* ═══════════════════════════════════════════════════════════════════
   CYBER HANGDRUM v2 — HQ Sample Loader + Geometric Hit-Zones
   D Celtic Minor · Granular Reverb Pad · Hand Tracking Integration
   Registers with SonicSuite as 'CYBER_HANGDRUM'.

   Sample URLs: populate HANGDRUM_SAMPLES below with your WAV URLs.
   Falls back to inharmonic partial synthesis if a file is missing.
═══════════════════════════════════════════════════════════════════ */
(function(global) {
'use strict';

// ── WAV URL Map ───────────────────────────────────────────────────
// Replace values with actual hosted WAV URLs (relative or absolute).
// Instrument auto-falls back to synthesis for any missing file.
var HANGDRUM_SAMPLES = {
    'D3':  './assets/hangdrum/d3.wav',
    'A3':  './assets/hangdrum/a3.wav',
    'Bb3': './assets/hangdrum/bb3.wav',
    'C4':  './assets/hangdrum/c4.wav',
    'D4':  './assets/hangdrum/d4.wav',
    'E4':  './assets/hangdrum/e4.wav',
    'F4':  './assets/hangdrum/f4.wav',
    'A4':  './assets/hangdrum/a4.wav',
    'C5':  './assets/hangdrum/c5.wav',
};

// ── Pad Layout: D Celtic Minor ────────────────────────────────────
// cx/cy: 0-1 normalised canvas coords · r: hit radius · sides: polygon
var PADS = [
    { note:'D3',  freq:146.83, cx:0.50, cy:0.50, r:0.130, sides:6, color:'#00f3ff' },
    { note:'A3',  freq:220.00, cx:0.73, cy:0.50, r:0.108, sides:7, color:'#00ff88' },
    { note:'Bb3', freq:233.08, cx:0.635,cy:0.285,r:0.108, sides:5, color:'#00ff88' },
    { note:'C4',  freq:261.63, cx:0.50, cy:0.215,r:0.108, sides:5, color:'#00ff88' },
    { note:'D4',  freq:293.66, cx:0.365,cy:0.285,r:0.108, sides:5, color:'#00ff88' },
    { note:'E4',  freq:329.63, cx:0.27, cy:0.50, r:0.108, sides:5, color:'#00ff88' },
    { note:'F4',  freq:349.23, cx:0.365,cy:0.715,r:0.108, sides:5, color:'#00ff88' },
    { note:'A4',  freq:440.00, cx:0.50, cy:0.785,r:0.108, sides:5, color:'#00ff88' },
    { note:'C5',  freq:523.25, cx:0.635,cy:0.715,r:0.108, sides:5, color:'#00ff88' },
];

// Inharmonic partial ratios for metal-plate timbre
var PARTIALS = [
    { m:1.000, g:0.68, d:4.2 },
    { m:2.756, g:0.18, d:2.6 },
    { m:5.404, g:0.08, d:1.5 },
    { m:8.933, g:0.03, d:0.8 },
];

// Fingertip landmark indices (MediaPipe Hands)
var TIPS = [4, 8, 12, 16, 20];

function CyberHangdrum() {
    this._audioCtx      = null;
    this._masterGain    = null;
    this._dryGain       = null;
    this._wetGain       = null;
    this._convolver     = null;
    this._reverbPadOscs = null;
    this._reverbPadGain = null;
    this._buffers       = {};     // decoded WAV buffers keyed by note
    this._cooldown      = {};
    this._hitFlash      = {};     // padIdx → { t, vel }
    this._ripples       = [];
    this._leftHandY     = 0.5;
    this._prevTips      = {};
}

CyberHangdrum.prototype.activate = function(audioCtx) {
    this._audioCtx = audioCtx;
    this._buildAudioGraph();
    this._loadSamples();
};

CyberHangdrum.prototype.deactivate = function() {
    if (this._reverbPadOscs) {
        this._reverbPadOscs.forEach(function(o) { try { o.stop(); } catch(e) {} });
        this._reverbPadOscs = null;
    }
    this._cooldown  = {};
    this._hitFlash  = {};
    this._ripples   = [];
    this._prevTips  = {};
};

// ── Audio Graph ───────────────────────────────────────────────────
CyberHangdrum.prototype._buildAudioGraph = function() {
    var ctx = this._audioCtx;
    var sr  = ctx.sampleRate;

    this._masterGain = ctx.createGain(); this._masterGain.gain.value = 0.85;
    this._dryGain    = ctx.createGain(); this._dryGain.gain.value    = 0.65;
    this._wetGain    = ctx.createGain(); this._wetGain.gain.value    = 0.35;
    this._convolver  = ctx.createConvolver();

    // Plate-reverb impulse response (3.2 s decaying stereo noise)
    var len = Math.floor(sr * 3.2);
    var ir  = ctx.createBuffer(2, len, sr);
    for (var c = 0; c < 2; c++) {
        var ch = ir.getChannelData(c);
        for (var i = 0; i < len; i++) {
            ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
        }
    }
    this._convolver.buffer = ir;

    this._dryGain.connect(this._masterGain);
    this._convolver.connect(this._wetGain);
    this._wetGain.connect(this._masterGain);
    this._masterGain.connect(ctx.destination);

    // Granular reverb pad: two low drones that swell with left-hand Y elevation
    this._reverbPadGain = ctx.createGain();
    this._reverbPadGain.gain.value = 0;
    var padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass'; padFilter.frequency.value = 320;

    var osc1 = ctx.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = 73.4; // D2
    var osc2 = ctx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = 110;  // A2
    osc1.connect(padFilter); osc2.connect(padFilter);
    padFilter.connect(this._reverbPadGain);
    this._reverbPadGain.connect(this._convolver);
    this._reverbPadGain.connect(this._masterGain);
    osc1.start(); osc2.start();
    this._reverbPadOscs = [osc1, osc2];
};

// ── Sample Loader ─────────────────────────────────────────────────
CyberHangdrum.prototype._loadSamples = function() {
    var self = this;
    var ctx  = this._audioCtx;
    Object.keys(HANGDRUM_SAMPLES).forEach(function(note) {
        fetch(HANGDRUM_SAMPLES[note])
            .then(function(r) {
                if (!r.ok) throw new Error(r.status);
                return r.arrayBuffer();
            })
            .then(function(ab) { return ctx.decodeAudioData(ab); })
            .then(function(buf) { self._buffers[note] = buf; })
            .catch(function() { /* synthesis fallback — no-op */ });
    });
};

// ── Note Strike ───────────────────────────────────────────────────
CyberHangdrum.prototype._strike = function(pad, vel) {
    var ctx  = this._audioCtx;
    var now  = ctx.currentTime + 0.005; // 5 ms lookahead
    vel = Math.min(1, Math.max(0.25, vel));

    if (this._buffers[pad.note]) {
        // Sampler path
        var src = ctx.createBufferSource();
        src.buffer = this._buffers[pad.note];
        var g = ctx.createGain(); g.gain.value = vel;
        src.connect(g);
        g.connect(this._dryGain);
        g.connect(this._convolver);
        src.start(now);
    } else {
        // Synthesis fallback: inharmonic metal-plate partials
        PARTIALS.forEach(function(p) {
            var osc = ctx.createOscillator();
            var g2  = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(pad.freq * p.m, now);
            g2.gain.setValueAtTime(vel * p.g, now);
            g2.gain.exponentialRampToValueAtTime(0.0001, now + p.d);
            osc.connect(g2);
            g2.connect(this._dryGain);
            g2.connect(this._convolver);
            osc.start(now); osc.stop(now + p.d);
        }, this);
    }
};

// ── Hand Results ──────────────────────────────────────────────────
CyberHangdrum.prototype.onHandResults = function(results) {
    if (!results || !results.multiHandLandmarks) return;
    var now  = performance.now();
    var self = this;

    results.multiHandLandmarks.forEach(function(landmarks, hIdx) {
        var hand = (results.multiHandedness[hIdx] || {}).label || 'Right';

        // Left hand elevation → granular reverb pad swell
        if (hand === 'Left') {
            self._leftHandY = 1 - landmarks[0].y; // invert: up = elevation up
            var targetGain  = self._leftHandY * 0.45;
            if (self._reverbPadGain) {
                self._reverbPadGain.gain.setTargetAtTime(targetGain, self._audioCtx.currentTime, 0.12);
            }
        }

        TIPS.forEach(function(tipIdx) {
            var tip = landmarks[tipIdx];
            var key = hIdx + '_' + tipIdx;
            var prev = self._prevTips[key];
            self._prevTips[key] = { x: tip.x, y: tip.y, t: now };
            if (!prev) return;

            var dt = now - prev.t;
            if (dt < 2) return;
            var vel = Math.min(1, Math.abs(tip.y - prev.y) / dt * 130);

            PADS.forEach(function(pad, pIdx) {
                var dx   = tip.x - pad.cx;
                var dy   = tip.y - pad.cy;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < pad.r && vel > 0.05) {
                    var ck = pIdx + '_' + hIdx + '_' + tipIdx;
                    if (!self._cooldown[ck] || now - self._cooldown[ck] > 175) {
                        self._cooldown[ck] = now;
                        self._strike(pad, vel);
                        self._hitFlash[pIdx] = { t: now, vel: vel };
                        self._ripples.push({ cx: pad.cx, cy: pad.cy, t: now, color: pad.color });
                    }
                }
            });
        });
    });
};

// ── Draw ──────────────────────────────────────────────────────────
CyberHangdrum.prototype.draw = function(canvas, ctx, results) {
    var W   = canvas.width;
    var H   = canvas.height;
    var now = performance.now();

    // Subtle haze trail
    ctx.fillStyle = 'rgba(0, 4, 10, 0.18)';
    ctx.fillRect(0, 0, W, H);

    // Draw instrument pads
    var self = this;
    PADS.forEach(function(pad, pIdx) {
        var x  = pad.cx * W;
        var y  = pad.cy * H;
        var r  = pad.r * Math.min(W, H);
        var fl = self._hitFlash[pIdx];
        var age = fl ? (now - fl.t) : 9999;
        var lit = age < 280;
        var alpha = lit
            ? 0.92 - age / 280 * 0.68
            : 0.22 + Math.sin(now * 0.0008 + pIdx * 0.9) * 0.06;

        self._drawPolygon(ctx, x, y, r, pad.sides, pad.color, alpha, lit);

        // Note label
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = lit ? '#ffffff' : pad.color;
        ctx.font        = Math.round(r * 0.3) + "px 'JetBrains Mono',monospace";
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        if (lit) { ctx.shadowBlur = 12; ctx.shadowColor = '#ffffff'; }
        ctx.fillText(pad.note, x, y);
        ctx.restore();
    });

    // Ripple animations
    this._ripples = this._ripples.filter(function(rip) {
        var age  = now - rip.t;
        if (age > 750) return false;
        var prog = age / 750;
        var rr   = prog * 0.20 * Math.min(W, H);
        ctx.save();
        ctx.globalAlpha  = (1 - prog) * 0.55;
        ctx.strokeStyle  = rip.color;
        ctx.lineWidth    = 1.8 * (1 - prog);
        ctx.shadowBlur   = 12;
        ctx.shadowColor  = rip.color;
        ctx.beginPath();
        ctx.arc(rip.cx * W, rip.cy * H, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return true;
    });

    // Hand skeleton overlay
    if (results && results.multiHandLandmarks) {
        results.multiHandLandmarks.forEach(function(lm, hIdx) {
            self._drawHandSkeleton(ctx, lm, W, H, hIdx);
        });
    }

    // Left-hand reverb pad ambient glow
    var glow = this._leftHandY;
    if (glow > 0.05) {
        var grad = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.min(W, H) * 0.55);
        grad.addColorStop(0, 'rgba(0, 243, 255,' + (glow * 0.09) + ')');
        grad.addColorStop(1, 'rgba(0, 243, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    // Reverb level label
    ctx.save();
    ctx.fillStyle   = 'rgba(0,243,255,0.3)';
    ctx.font        = "7px 'JetBrains Mono'";
    ctx.textAlign   = 'left';
    ctx.fillText('PAD REV: ' + Math.round(this._leftHandY * 100) + '%', 10, H - 14);
    ctx.restore();
};

// ── Helpers ───────────────────────────────────────────────────────
CyberHangdrum.prototype._drawPolygon = function(ctx, x, y, r, sides, color, alpha, glow) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth   = glow ? 2.8 : 1.3;
    if (glow) { ctx.shadowBlur = 22; ctx.shadowColor = color; }
    var rgb = _hexToRgb(color);
    ctx.fillStyle = 'rgba(' + rgb + ',' + (glow ? 0.28 : 0.06) + ')';
    ctx.beginPath();
    for (var i = 0; i <= sides; i++) {
        var angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
        var px = x + r * Math.cos(angle);
        var py = y + r * Math.sin(angle);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
};

CyberHangdrum.prototype._drawHandSkeleton = function(ctx, lm, W, H, hIdx) {
    var CONN = [
        [0,1],[1,2],[2,3],[3,4],
        [0,5],[5,6],[6,7],[7,8],
        [5,9],[9,10],[10,11],[11,12],
        [9,13],[13,14],[14,15],[15,16],
        [13,17],[17,18],[18,19],[19,20],[0,17]
    ];
    var color = hIdx === 0 ? 'rgba(0,243,255,0.35)' : 'rgba(0,255,136,0.35)';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    CONN.forEach(function(c) {
        ctx.beginPath();
        ctx.moveTo(lm[c[0]].x * W, lm[c[0]].y * H);
        ctx.lineTo(lm[c[1]].x * W, lm[c[1]].y * H);
        ctx.stroke();
    });
    TIPS.forEach(function(i) {
        ctx.beginPath();
        ctx.arc(lm[i].x * W, lm[i].y * H, 4, 0, Math.PI * 2);
        ctx.fillStyle = hIdx === 0 ? '#00f3ff' : '#00ff88';
        ctx.fill();
    });
    ctx.restore();
};

function _hexToRgb(hex) {
    return parseInt(hex.slice(1,3),16) + ',' +
           parseInt(hex.slice(3,5),16) + ',' +
           parseInt(hex.slice(5,7),16);
}

global.CyberHangdrum = CyberHangdrum;

})(window);
