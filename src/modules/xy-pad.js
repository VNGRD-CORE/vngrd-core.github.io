// ═══════════════════════════════════════════════════════════════
// XY SYNTH PAD — mouse / touch 2D synthesizer controller
// X axis = pitch (pentatonic, 2 octaves)
// Y axis = filter cutoff (top = open, bottom = closed)
// Full ADSR envelope, detune, reverb send, portamento
// Depends on: SonicSuite (global)
// Registers card id: 'xypad'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const LS_KEY = 'vngrd.xypad.v2';

    // ── Config ────────────────────────────────────────────────
    const P = {
        voice:      'sawtooth',  // 'sawtooth' | 'square' | 'triangle' | 'sine'
        octave:     3,           // 1–6
        detune:     8,           // cents — osc2 offset for width/chorus feel
        resonance:  8,           // filter Q
        reverbAmt:  0.20,        // 0–1 reverb send
        portamento: 0.04,        // freq glide time constant (s)
        filterMin:  90,          // Hz
        filterMax:  11000,       // Hz
        // ADSR
        attack:     0.015,       // s
        decay:      0.12,        // s
        sustain:    0.72,        // 0–1
        release:    0.14,        // s (time constant)
    };

    // Pentatonic scale across 2 octaves
    const PENTA = [0, 2, 4, 7, 9];
    const ROOT  = 48;   // C3

    function _midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
    function _xToMidi(x) {
        const notes  = PENTA.length * 2;
        const idx    = Math.min(notes - 1, Math.floor(x * notes));
        const octOff = Math.floor(idx / PENTA.length);
        const semi   = PENTA[idx % PENTA.length];
        return ROOT + (P.octave - 3) * 12 + octOff * 12 + semi;
    }
    function _yToCutoff(y) {
        const t = 1 - y;
        return P.filterMin + (P.filterMax - P.filterMin) * t * t;
    }

    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    function _midiName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

    // ── Web Audio state ───────────────────────────────────────
    let _ctx, _bus, _reverbTap;
    let _osc1 = null, _osc2 = null, _filter = null, _ampGain = null, _revGain = null;
    let _playing = false;
    let _mx = 0.5, _my = 0.5;

    function _startVoice() {
        if (_playing || !_ctx) return;
        _playing = true;

        _osc1    = _ctx.createOscillator();
        _osc2    = _ctx.createOscillator();
        _filter  = _ctx.createBiquadFilter();
        _ampGain = _ctx.createGain();

        _osc1.type          = P.voice;
        _osc2.type          = P.voice;
        _osc1.detune.value  = 0;
        _osc2.detune.value  = P.detune;
        _filter.type        = 'lowpass';
        _filter.Q.value     = P.resonance;
        _ampGain.gain.value = 0;

        const freq   = _midiToHz(_xToMidi(_mx));
        const cutoff = _yToCutoff(_my);
        _osc1.frequency.value   = freq;
        _osc2.frequency.value   = freq;
        _filter.frequency.value = cutoff;

        _osc1.connect(_filter);
        _osc2.connect(_filter);
        _filter.connect(_ampGain).connect(_bus);

        if (_reverbTap) {
            _revGain = _ctx.createGain();
            _revGain.gain.value = P.reverbAmt;
            _ampGain.connect(_revGain).connect(_reverbTap);
        }

        _osc1.start(); _osc2.start();

        // ADSR — Attack → Decay → Sustain hold
        const now = _ctx.currentTime;
        _ampGain.gain.cancelScheduledValues(now);
        _ampGain.gain.setValueAtTime(0, now);
        _ampGain.gain.linearRampToValueAtTime(0.6, now + Math.max(0.001, P.attack));
        // Decay to sustain level
        _ampGain.gain.setTargetAtTime(0.6 * P.sustain, now + P.attack, P.decay * 0.35 + 0.01);
    }

    function _stopVoice() {
        if (!_playing) return;
        _playing = false;
        if (!_ampGain) return;
        const now = _ctx.currentTime;
        const cur = _ampGain.gain.value;
        _ampGain.gain.cancelScheduledValues(now);
        _ampGain.gain.setValueAtTime(cur, now);
        // Release
        _ampGain.gain.setTargetAtTime(0, now, P.release * 0.4 + 0.005);

        const nodes = [_osc1, _osc2];
        const releaseMs = Math.max(300, (P.release * 4 + 0.1) * 1000);
        setTimeout(function () {
            nodes.forEach(function (o) { try { if (o) { o.stop(); o.disconnect(); } } catch (e) {} });
        }, releaseMs);
        _osc1 = _osc2 = _filter = _ampGain = _revGain = null;
    }

    function _updateVoice() {
        if (!_playing || !_osc1 || !_filter) return;
        const freq   = _midiToHz(_xToMidi(_mx));
        const cutoff = _yToCutoff(_my);
        _osc1.frequency.setTargetAtTime(freq, _ctx.currentTime, P.portamento);
        _osc2.frequency.setTargetAtTime(freq, _ctx.currentTime, P.portamento);
        _filter.frequency.setTargetAtTime(cutoff, _ctx.currentTime, 0.018);
        if (_revGain) _revGain.gain.setTargetAtTime(P.reverbAmt, _ctx.currentTime, 0.04);
    }

    // ── Canvas drawing ────────────────────────────────────────
    let _canvas = null, _ctx2d = null, _animId = null;
    const _ripples = [];

    function _draw() {
        if (!_canvas || !_ctx2d) return;
        const W = _canvas.width  || 560;
        const H = _canvas.height || 220;
        const c = _ctx2d;
        c.clearRect(0, 0, W, H);

        // Background
        const bg = c.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#020510');
        bg.addColorStop(1, '#060014');
        c.fillStyle = bg;
        c.fillRect(0, 0, W, H);

        // Pentatonic column grid
        const COLS = PENTA.length * 2;
        for (let i = 0; i <= COLS; i++) {
            const x = (i / COLS) * W;
            const atOct = (i % PENTA.length === 0);
            c.strokeStyle = atOct ? 'rgba(255,180,0,.2)' : 'rgba(255,180,0,.06)';
            c.lineWidth   = atOct ? 1 : 0.5;
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        }
        // Horizontal filter guide lines
        for (let i = 0; i <= 4; i++) {
            const y = (i / 4) * H;
            c.strokeStyle = 'rgba(255,180,0,.05)';
            c.lineWidth   = 0.5;
            c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
        }

        // Note labels bottom
        for (let i = 0; i < COLS; i++) {
            const midi = _xToMidi((i + 0.5) / COLS);
            const lbl  = NOTE_NAMES[((midi % 12) + 12) % 12];
            const x    = ((i + 0.5) / COLS) * W;
            c.fillStyle   = 'rgba(255,180,0,.16)';
            c.font        = '7px "JetBrains Mono", monospace';
            c.textAlign   = 'center';
            c.fillText(lbl, x, H - 4);
        }
        c.textAlign = 'left';

        // Ripples
        for (let i = _ripples.length - 1; i >= 0; i--) {
            const r = _ripples[i];
            r.age++;
            if (r.age > r.life) { _ripples.splice(i, 1); continue; }
            const p = r.age / r.life;
            c.strokeStyle = 'rgba(255,180,0,' + ((1 - p) * 0.55) + ')';
            c.lineWidth   = 1.2 * (1 - p * 0.6);
            c.beginPath();
            c.arc(r.x, r.y, r.maxR * p, 0, Math.PI * 2);
            c.stroke();
        }

        // Active cursor
        if (_playing) {
            const cx = _mx * W;
            const cy = _my * H;

            c.setLineDash([3, 5]);
            c.strokeStyle = 'rgba(255,180,0,.55)';
            c.lineWidth   = 1;
            c.beginPath(); c.moveTo(cx, 0);  c.lineTo(cx, H);  c.stroke();
            c.beginPath(); c.moveTo(0,  cy); c.lineTo(W,  cy); c.stroke();
            c.setLineDash([]);

            const grd = c.createRadialGradient(cx, cy, 0, cx, cy, 20);
            grd.addColorStop(0, 'rgba(255,200,0,.9)');
            grd.addColorStop(0.4, 'rgba(255,150,0,.4)');
            grd.addColorStop(1, 'rgba(255,150,0,0)');
            c.fillStyle = grd;
            c.beginPath(); c.arc(cx, cy, 20, 0, Math.PI * 2); c.fill();

            const midi   = _xToMidi(_mx);
            const noteLbl= _midiName(midi);
            const cutLbl = Math.round(_yToCutoff(_my)) + ' Hz';
            const lx = cx + 12 < W - 72 ? cx + 12 : cx - 74;
            const ly = cy - 10 > 18 ? cy - 10 : cy + 22;
            c.fillStyle = '#ffb400';
            c.font      = 'bold 11px "JetBrains Mono", monospace';
            c.fillText(noteLbl, lx, ly);
            c.fillStyle = 'rgba(255,180,0,.65)';
            c.font      = '8px "JetBrains Mono", monospace';
            c.fillText(cutLbl, lx, ly + 14);

            // Filter bar (right edge)
            const fNorm = 1 - _my;
            const barH  = H * 0.82;
            c.fillStyle = 'rgba(255,180,0,.12)';
            c.fillRect(W - 7, H * 0.09, 4, barH);
            c.fillStyle = 'rgba(255,180,0,.55)';
            c.fillRect(W - 7, H * 0.09 + barH * (1 - fNorm), 4, barH * fNorm);
        } else {
            c.fillStyle   = 'rgba(255,180,0,.12)';
            c.font        = '9px "JetBrains Mono", monospace';
            c.textAlign   = 'center';
            c.fillText('▸ CLICK OR TOUCH TO PLAY', W / 2, H / 2 - 8);
            c.fillStyle   = 'rgba(255,180,0,.07)';
            c.font        = '7px "JetBrains Mono", monospace';
            c.fillText('X → PITCH (PENTATONIC)   Y → FILTER CUTOFF', W / 2, H / 2 + 8);
            c.textAlign   = 'left';
        }
    }

    function _addRipple(x, y) {
        _ripples.push({ x, y, age: 0, life: 30, maxR: 50 });
    }

    // ── Helpers ───────────────────────────────────────────────
    function _div(css) { const d = document.createElement('div'); d.style.cssText = css; return d; }
    function _lbl(txt, col) {
        const s = document.createElement('span');
        s.className = 'ic-group-lbl';
        s.style.color = col || 'rgba(255,180,0,.45)';
        s.textContent = txt;
        return s;
    }
    function _knob(label, min, max, val, unit, onInput, color) {
        color = color || '#ffb400';
        const w = _div('display:flex;flex-direction:column;align-items:center;gap:2px;');
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:7px;letter-spacing:1px;color:rgba(255,180,0,.5);white-space:nowrap;';
        lbl.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val;
        inp.style.cssText = 'width:60px;accent-color:' + color + ';cursor:pointer;';
        const disp = document.createElement('span');
        disp.style.cssText = 'font-size:8px;color:' + color + ';min-width:36px;text-align:center;';
        disp.textContent = val + unit;
        inp.oninput = function () { disp.textContent = +this.value + unit; onInput(+this.value); _save(); };
        w.appendChild(lbl); w.appendChild(inp); w.appendChild(disp);
        return w;
    }

    // ── UI ────────────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx      = ctx.audioCtx;
        _bus      = ctx.bus;
        _reverbTap= ctx.reverbTap;

        body.style.cssText = 'display:flex;flex-direction:column;gap:7px;padding:8px 8px;user-select:none;overflow:hidden;';

        // ── ROW 1: Voice + Octave ──────────────────────────────
        const row1 = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
        row1.appendChild(_lbl('VOICE'));

        const voices = [['SAW','sawtooth'],['SQ','square'],['TRI','triangle'],['SINE','sine']];
        const vBtns = [];
        voices.forEach(function (v) {
            const b = document.createElement('button');
            b.className = 'ss-card-btn xy-vb';
            b.dataset.v = v[1];
            b.textContent = v[0];
            b.onclick = function () {
                P.voice = v[1];
                vBtns.forEach(function (x) { x.classList.remove('playing'); });
                b.classList.add('playing');
                if (_osc1) _osc1.type = P.voice;
                if (_osc2) _osc2.type = P.voice;
                _save();
            };
            row1.appendChild(b);
            vBtns.push(b);
        });

        const octLbl = document.createElement('span');
        octLbl.style.cssText = 'font-size:11px;color:#ffb400;min-width:16px;text-align:center;';
        octLbl.textContent = P.octave;
        const odBtn = document.createElement('button');
        odBtn.className = 'ss-card-btn';
        odBtn.textContent = '▼';
        odBtn.onclick = function () { P.octave = Math.max(1, P.octave - 1); octLbl.textContent = P.octave; _save(); };
        const ouBtn = document.createElement('button');
        ouBtn.className = 'ss-card-btn';
        ouBtn.textContent = '▲';
        ouBtn.onclick = function () { P.octave = Math.min(6, P.octave + 1); octLbl.textContent = P.octave; _save(); };

        const octSep = _div('width:1px;height:16px;background:rgba(255,180,0,.15);margin:0 4px;');
        row1.appendChild(octSep);
        row1.appendChild(_lbl('OCT'));
        row1.appendChild(odBtn);
        row1.appendChild(octLbl);
        row1.appendChild(ouBtn);
        body.appendChild(row1);

        // ── CANVAS ─────────────────────────────────────────────
        _canvas = document.createElement('canvas');
        _canvas.width  = 556;
        _canvas.height = 200;
        _canvas.style.cssText = 'width:100%;height:200px;cursor:crosshair;border:1px solid rgba(255,180,0,.18);border-radius:3px;touch-action:none;display:block;';
        body.appendChild(_canvas);
        _ctx2d = _canvas.getContext('2d');

        cancelAnimationFrame(_animId);
        (function loop() {
            _animId = requestAnimationFrame(loop);
            if (document.hidden) return;
            _draw();
        })();

        // Pointer events
        function _getXY(e) {
            const r  = _canvas.getBoundingClientRect();
            const pt = e.touches ? e.touches[0] : e;
            return {
                x:  Math.max(0, Math.min(1, (pt.clientX - r.left)  / r.width)),
                y:  Math.max(0, Math.min(1, (pt.clientY - r.top)   / r.height)),
                px: pt.clientX - r.left,
                py: pt.clientY - r.top,
            };
        }
        _canvas.addEventListener('mousedown', function (e) {
            const p = _getXY(e); _mx = p.x; _my = p.y;
            _addRipple(p.px, p.py); _startVoice();
        });
        _canvas.addEventListener('mousemove', function (e) {
            if (!_playing) return;
            const p = _getXY(e); _mx = p.x; _my = p.y; _updateVoice();
        });
        _canvas.addEventListener('mouseup',    _stopVoice);
        _canvas.addEventListener('mouseleave', function () { if (_playing) _stopVoice(); });
        _canvas.addEventListener('touchstart', function (e) {
            e.preventDefault();
            const p = _getXY(e); _mx = p.x; _my = p.y;
            _addRipple(p.px, p.py); _startVoice();
        }, { passive: false });
        _canvas.addEventListener('touchmove', function (e) {
            e.preventDefault();
            if (!_playing) return;
            const p = _getXY(e); _mx = p.x; _my = p.y; _updateVoice();
        }, { passive: false });
        _canvas.addEventListener('touchend',    _stopVoice);
        _canvas.addEventListener('touchcancel', _stopVoice);

        // ── ROW 2: Filter + Reverb ─────────────────────────────
        const row2 = _div('display:flex;align-items:center;gap:12px;flex-wrap:wrap;');
        row2.classList.add('ic-section');

        row2.appendChild(_knob('RES', 1, 22, P.resonance, '', function (v) {
            P.resonance = v;
            if (_filter) _filter.Q.setTargetAtTime(v, _ctx.currentTime, 0.03);
        }));
        row2.appendChild(_knob('DETUNE', 0, 50, P.detune, 'c', function (v) {
            P.detune = v;
            if (_osc2) _osc2.detune.setTargetAtTime(v, _ctx.currentTime, 0.03);
        }));
        row2.appendChild(_knob('PORT', 1, 200, Math.round(P.portamento * 1000), 'ms', function (v) {
            P.portamento = v / 1000;
        }));
        row2.appendChild(_knob('REV', 0, 100, Math.round(P.reverbAmt * 100), '%', function (v) {
            P.reverbAmt = v / 100;
        }));

        body.appendChild(row2);

        // ── ROW 3: ADSR ────────────────────────────────────────
        const row3 = _div('display:flex;align-items:center;gap:12px;flex-wrap:wrap;');
        row3.classList.add('ic-section');
        const adsrLbl = _lbl('ADSR ENVELOPE');
        adsrLbl.style.width = '100%';
        row3.appendChild(adsrLbl);

        row3.appendChild(_knob('ATK', 1, 500, Math.round(P.attack * 1000), 'ms', function (v) {
            P.attack = v / 1000;
        }));
        row3.appendChild(_knob('DCY', 10, 800, Math.round(P.decay * 1000), 'ms', function (v) {
            P.decay = v / 1000;
        }));
        row3.appendChild(_knob('SUS', 0, 100, Math.round(P.sustain * 100), '%', function (v) {
            P.sustain = v / 100;
            // Update amp if currently held
            if (_playing && _ampGain) {
                _ampGain.gain.setTargetAtTime(0.6 * P.sustain, _ctx.currentTime, 0.05);
            }
        }));
        row3.appendChild(_knob('REL', 10, 2000, Math.round(P.release * 1000), 'ms', function (v) {
            P.release = v / 1000;
        }));

        body.appendChild(row3);

        _loadState();
    }

    // ── Persistence ───────────────────────────────────────────
    function _save() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(P)); } catch (e) {}
    }
    function _loadState() {
        try { Object.assign(P, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) {}
        // Sync voice buttons
        document.querySelectorAll('.xy-vb').forEach(function (b) {
            b.classList.toggle('playing', b.dataset.v === P.voice);
        });
        const octEl = document.querySelector('.xy-on');
        if (octEl) octEl.textContent = P.octave;
    }

    // ── Boot ─────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(function () {
                SonicSuite.registerCard('xypad', {
                    tag:   'X',
                    label: '◈ XY SYNTH',
                    mount: _mount,
                });
            }, 340);
        }
        btn ? btn.addEventListener('click', _once) : setTimeout(_once, 800);
    });
})();
