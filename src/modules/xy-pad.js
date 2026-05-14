// ═══════════════════════════════════════════════════════════════
// VNGRD//VOID PAD — 2D synthesizer controller
// X axis = pitch (pentatonic, 2 octaves)
// Y axis = filter cutoff (top = open, bottom = closed)
// LOOP REC: record what you play → loop in sync with master BPM
//   Records up to 4 bars; playback fires quantized via onTick.
// Full ADSR, detune, reverb send, portamento.
// MIDI CC learn: bind any range slider to a CC knob.
// Depends on: SonicSuite (global)
// Registers card id: 'xypad'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const LS_KEY = 'vngrd.voidpad.v1';

    const P = {
        voice:      'sawtooth',
        octave:     3,
        detune:     8,
        resonance:  8,
        reverbAmt:  0.20,
        portamento: 0.04,
        filterMin:  90,
        filterMax:  11000,
        volume:     0.80,
        attack:     0.015,
        decay:      0.12,
        sustain:    0.72,
        release:    0.14,
        loopBars:   2,    // 1, 2, or 4 bars
    };

    const PENTA = [0, 2, 4, 7, 9];
    const ROOT  = 48;

    function _midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
    function _xToMidi(x) {
        var notes = PENTA.length * 2;
        var idx   = Math.min(notes - 1, Math.floor(x * notes));
        var octOff = Math.floor(idx / PENTA.length);
        var semi   = PENTA[idx % PENTA.length];
        return ROOT + (P.octave - 3) * 12 + octOff * 12 + semi;
    }
    function _yToCutoff(y) {
        var t = 1 - y;
        return P.filterMin + (P.filterMax - P.filterMin) * t * t;
    }

    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    function _midiName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

    // ── Web Audio state ───────────────────────────────────────
    var _ctx, _bus, _reverbTap;
    var _osc1 = null, _osc2 = null, _filter = null, _ampGain = null, _revGain = null;
    var _volGain = null;
    var _playing = false;
    var _mx = 0.5, _my = 0.5;

    // ── Loop recording state ──────────────────────────────────
    // Each event: { step16: int, x: float, y: float, type: 'on'|'off' }
    var _loopEvents  = [];    // recorded events
    var _recActive   = false; // currently recording
    var _loopActive  = false; // loop playback on
    var _recStart16  = 0;     // transport step when rec started
    var _loopLen16   = 32;    // steps = P.loopBars * 16
    var _loopBtnEl   = null;
    var _recBtnEl    = null;
    var _loopLenSel  = null;

    function _startVoice() {
        if (_playing || !_ctx) return;
        _playing = true;

        _osc1    = _ctx.createOscillator();
        _osc2    = _ctx.createOscillator();
        _filter  = _ctx.createBiquadFilter();
        _ampGain = _ctx.createGain();

        _osc1.type = P.voice; _osc2.type = P.voice;
        _osc1.detune.value = 0; _osc2.detune.value = P.detune;
        _filter.type = 'lowpass'; _filter.Q.value = P.resonance;
        _ampGain.gain.value = 0;

        var freq   = _midiToHz(_xToMidi(_mx));
        var cutoff = _yToCutoff(_my);
        _osc1.frequency.value = freq; _osc2.frequency.value = freq;
        _filter.frequency.value = cutoff;

        _osc1.connect(_filter); _osc2.connect(_filter);
        _filter.connect(_ampGain).connect(_volGain);

        if (_reverbTap) {
            _revGain = _ctx.createGain(); _revGain.gain.value = P.reverbAmt;
            _ampGain.connect(_revGain).connect(_reverbTap);
        }
        _osc1.start(); _osc2.start();

        var now = _ctx.currentTime;
        _ampGain.gain.cancelScheduledValues(now);
        _ampGain.gain.setValueAtTime(0, now);
        _ampGain.gain.linearRampToValueAtTime(0.6, now + Math.max(0.001, P.attack));
        _ampGain.gain.setTargetAtTime(0.6 * P.sustain, now + P.attack, P.decay * 0.35 + 0.01);
    }

    function _stopVoice() {
        if (!_playing) return;
        _playing = false;
        if (!_ampGain) return;
        var now = _ctx.currentTime;
        var cur = _ampGain.gain.value;
        _ampGain.gain.cancelScheduledValues(now);
        _ampGain.gain.setValueAtTime(cur, now);
        _ampGain.gain.setTargetAtTime(0, now, P.release * 0.4 + 0.005);

        var nodes = [_osc1, _osc2];
        var releaseMs = Math.max(300, (P.release * 4 + 0.1) * 1000);
        setTimeout(function () {
            nodes.forEach(function (o) { try { if (o) { o.stop(); o.disconnect(); } } catch (e) {} });
        }, releaseMs);
        _osc1 = _osc2 = _filter = _ampGain = _revGain = null;
    }

    function _updateVoice() {
        if (!_playing || !_osc1 || !_filter) return;
        var freq   = _midiToHz(_xToMidi(_mx));
        var cutoff = _yToCutoff(_my);
        _osc1.frequency.setTargetAtTime(freq, _ctx.currentTime, P.portamento);
        _osc2.frequency.setTargetAtTime(freq, _ctx.currentTime, P.portamento);
        _filter.frequency.setTargetAtTime(cutoff, _ctx.currentTime, 0.018);
        if (_revGain) _revGain.gain.setTargetAtTime(P.reverbAmt, _ctx.currentTime, 0.04);
    }

    // Plays a loop event with the correct pitch/filter at a scheduled audio time
    function _playLoopEvent(ev, time) {
        if (ev.type === 'on') {
            if (!_ctx) return;
            // Use a one-shot voice so loop doesn't conflict with live play
            var osc1 = _ctx.createOscillator();
            var osc2 = _ctx.createOscillator();
            var filt = _ctx.createBiquadFilter();
            var amp  = _ctx.createGain();
            osc1.type = P.voice; osc2.type = P.voice;
            osc1.detune.value = 0; osc2.detune.value = P.detune;
            filt.type = 'lowpass'; filt.Q.value = P.resonance;
            var freq   = _midiToHz(_xToMidi(ev.x));
            var cutoff = _yToCutoff(ev.y);
            osc1.frequency.value = freq; osc2.frequency.value = freq;
            filt.frequency.value = cutoff;
            amp.gain.value = 0;
            osc1.connect(filt); osc2.connect(filt); filt.connect(amp).connect(_volGain);
            osc1.start(time); osc2.start(time);
            amp.gain.setValueAtTime(0, time);
            amp.gain.linearRampToValueAtTime(0.45, time + Math.max(0.001, P.attack));
            amp.gain.setTargetAtTime(0.45 * P.sustain, time + P.attack, P.decay * 0.35 + 0.01);

            // Hold for one 16th note + release
            var bpm = window.currentBPM || 120;
            var stepDur = 60 / bpm / 4;
            var holdT = time + stepDur * 0.8;
            amp.gain.setTargetAtTime(0, holdT, P.release * 0.4 + 0.005);
            var stopT = holdT + P.release * 2 + 0.2;
            osc1.stop(stopT); osc2.stop(stopT);
            setTimeout(function () {
                try { osc1.disconnect(); osc2.disconnect(); filt.disconnect(); amp.disconnect(); } catch (e) {}
            }, (stopT - _ctx.currentTime + 0.1) * 1000);
        }
    }

    // ── onTick — loop playback ────────────────────────────────
    function _onTick(time, step16, totalStep) {
        if (!_loopActive || _loopEvents.length === 0) return;
        var pos = totalStep % _loopLen16;
        _loopEvents.forEach(function (ev) {
            if (ev.loopStep === pos) _playLoopEvent(ev, time);
        });
        // Flash loop indicator
        if (_loopBtnEl && pos === 0) {
            _loopBtnEl.classList.add('playing');
            setTimeout(function () { if (_loopBtnEl && !_loopActive) _loopBtnEl.classList.remove('playing'); }, 80);
        }
    }

    // ── Canvas drawing ────────────────────────────────────────
    var _canvas = null, _ctx2d = null, _animId = null;
    var _ripples = [];

    function _draw() {
        if (!_canvas || !_ctx2d) return;
        var W = _canvas.width || 560;
        var H = _canvas.height || 200;
        var c = _ctx2d;
        c.clearRect(0, 0, W, H);

        var bg = c.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#020510'); bg.addColorStop(1, '#060014');
        c.fillStyle = bg; c.fillRect(0, 0, W, H);

        var COLS = PENTA.length * 2;
        for (var i = 0; i <= COLS; i++) {
            var x = (i / COLS) * W;
            var atOct = (i % PENTA.length === 0);
            c.strokeStyle = atOct ? 'rgba(255,180,0,.2)' : 'rgba(255,180,0,.06)';
            c.lineWidth = atOct ? 1 : 0.5;
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        }
        for (var i = 0; i <= 4; i++) {
            var y = (i / 4) * H;
            c.strokeStyle = 'rgba(255,180,0,.05)'; c.lineWidth = 0.5;
            c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
        }
        for (var i = 0; i < COLS; i++) {
            var midi = _xToMidi((i + 0.5) / COLS);
            var lbl  = NOTE_NAMES[((midi % 12) + 12) % 12];
            var xp   = ((i + 0.5) / COLS) * W;
            c.fillStyle = 'rgba(255,180,0,.16)'; c.font = '7px "JetBrains Mono",monospace'; c.textAlign = 'center';
            c.fillText(lbl, xp, H - 4);
        }
        c.textAlign = 'left';

        // Recorded loop dots
        if (_loopActive && _loopEvents.length > 0) {
            _loopEvents.forEach(function (ev) {
                if (ev.type !== 'on') return;
                var ex = ev.x * W, ey = ev.y * H;
                c.fillStyle = 'rgba(255,180,0,.3)';
                c.beginPath(); c.arc(ex, ey, 3, 0, Math.PI * 2); c.fill();
            });
        }
        // Recording line
        if (_recActive) {
            c.strokeStyle = 'rgba(255,60,60,.5)'; c.lineWidth = 1; c.setLineDash([4, 4]);
            c.strokeRect(2, 2, W - 4, H - 4); c.setLineDash([]);
        }

        for (var i = _ripples.length - 1; i >= 0; i--) {
            var r = _ripples[i]; r.age++;
            if (r.age > r.life) { _ripples.splice(i, 1); continue; }
            var p = r.age / r.life;
            c.strokeStyle = 'rgba(255,180,0,' + ((1 - p) * 0.55) + ')';
            c.lineWidth = 1.2 * (1 - p * 0.6);
            c.beginPath(); c.arc(r.x, r.y, r.maxR * p, 0, Math.PI * 2); c.stroke();
        }

        if (_playing) {
            var cx = _mx * W, cy = _my * H;
            c.setLineDash([3, 5]); c.strokeStyle = 'rgba(255,180,0,.55)'; c.lineWidth = 1;
            c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, H); c.stroke();
            c.beginPath(); c.moveTo(0, cy); c.lineTo(W, cy); c.stroke();
            c.setLineDash([]);
            var grd = c.createRadialGradient(cx, cy, 0, cx, cy, 20);
            grd.addColorStop(0, 'rgba(255,200,0,.9)'); grd.addColorStop(0.4, 'rgba(255,150,0,.4)'); grd.addColorStop(1, 'rgba(255,150,0,0)');
            c.fillStyle = grd; c.beginPath(); c.arc(cx, cy, 20, 0, Math.PI * 2); c.fill();
            var noteLbl = _midiName(_xToMidi(_mx));
            var cutLbl  = Math.round(_yToCutoff(_my)) + ' Hz';
            var lx = cx + 12 < W - 72 ? cx + 12 : cx - 74;
            var ly = cy - 10 > 18 ? cy - 10 : cy + 22;
            c.fillStyle = '#ffb400'; c.font = 'bold 11px "JetBrains Mono",monospace'; c.fillText(noteLbl, lx, ly);
            c.fillStyle = 'rgba(255,180,0,.65)'; c.font = '8px "JetBrains Mono",monospace'; c.fillText(cutLbl, lx, ly + 14);
            var fNorm = 1 - _my, barH = H * 0.82;
            c.fillStyle = 'rgba(255,180,0,.12)'; c.fillRect(W - 7, H * 0.09, 4, barH);
            c.fillStyle = 'rgba(255,180,0,.55)'; c.fillRect(W - 7, H * 0.09 + barH * (1 - fNorm), 4, barH * fNorm);
        } else {
            c.fillStyle = 'rgba(255,180,0,.12)'; c.font = '9px "JetBrains Mono",monospace'; c.textAlign = 'center';
            c.fillText('▸ CLICK OR TOUCH TO PLAY', W / 2, H / 2 - 8);
            c.fillStyle = 'rgba(255,180,0,.07)'; c.font = '7px "JetBrains Mono",monospace';
            c.fillText('X → PITCH (PENTATONIC)   Y → FILTER', W / 2, H / 2 + 8);
            c.textAlign = 'left';
        }
    }

    function _addRipple(x, y) { _ripples.push({ x: x, y: y, age: 0, life: 30, maxR: 50 }); }

    function _div(css) { var d = document.createElement('div'); d.style.cssText = css; return d; }
    function _lbl(txt, col) {
        var s = document.createElement('span'); s.className = 'ic-group-lbl';
        s.style.color = col || 'rgba(255,180,0,.45)'; s.textContent = txt; return s;
    }
    function _knob(label, min, max, val, unit, onInput, color) {
        color = color || '#ffb400';
        var w = _div('display:flex;flex-direction:column;align-items:center;gap:2px;');
        var lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:7px;letter-spacing:1px;color:rgba(255,180,0,.5);white-space:nowrap;';
        lbl.textContent = label;
        var inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val;
        inp.style.cssText = 'width:60px;accent-color:' + color + ';cursor:pointer;';
        var disp = document.createElement('span');
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

        _volGain = _ctx.createGain();
        _volGain.gain.value = P.volume !== undefined ? P.volume : 0.8;
        _volGain.connect(_bus);

        body.style.cssText = 'display:flex;flex-direction:column;gap:7px;padding:8px 8px;user-select:none;overflow:hidden;';

        // ── ROW 1: Voice + Octave + Loop controls ──────────────
        var row1 = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
        row1.appendChild(_lbl('VOICE'));

        var voices = [['SAW','sawtooth'],['SQ','square'],['TRI','triangle'],['SINE','sine']];
        var vBtns = [];
        voices.forEach(function (v) {
            var b = document.createElement('button');
            b.className = 'ss-card-btn xy-vb'; b.dataset.v = v[1]; b.textContent = v[0];
            b.onclick = function () {
                P.voice = v[1];
                vBtns.forEach(function (x) { x.classList.remove('playing'); });
                b.classList.add('playing');
                if (_osc1) _osc1.type = P.voice;
                if (_osc2) _osc2.type = P.voice;
                _save();
            };
            row1.appendChild(b); vBtns.push(b);
        });

        var octLbl = document.createElement('span'); octLbl.style.cssText = 'font-size:11px;color:#ffb400;min-width:16px;text-align:center;'; octLbl.textContent = P.octave;
        var odBtn = document.createElement('button'); odBtn.className = 'ss-card-btn'; odBtn.textContent = '▼';
        odBtn.onclick = function () { P.octave = Math.max(1, P.octave - 1); octLbl.textContent = P.octave; _save(); };
        var ouBtn = document.createElement('button'); ouBtn.className = 'ss-card-btn'; ouBtn.textContent = '▲';
        ouBtn.onclick = function () { P.octave = Math.min(6, P.octave + 1); octLbl.textContent = P.octave; _save(); };
        var octSep = _div('width:1px;height:16px;background:rgba(255,180,0,.15);margin:0 4px;');
        row1.appendChild(octSep); row1.appendChild(_lbl('OCT')); row1.appendChild(odBtn); row1.appendChild(octLbl); row1.appendChild(ouBtn);
        body.appendChild(row1);

        // ── CANVAS ─────────────────────────────────────────────
        _canvas = document.createElement('canvas');
        _canvas.width = 556; _canvas.height = 200;
        _canvas.style.cssText = 'width:100%;height:200px;cursor:crosshair;border:1px solid rgba(255,180,0,.18);border-radius:3px;touch-action:none;display:block;';
        body.appendChild(_canvas);
        _ctx2d = _canvas.getContext('2d');

        cancelAnimationFrame(_animId);
        (function loop() { _animId = requestAnimationFrame(loop); if (!document.hidden) _draw(); })();

        function _getXY(e) {
            var r  = _canvas.getBoundingClientRect();
            var pt = e.touches ? e.touches[0] : e;
            return {
                x:  Math.max(0, Math.min(1, (pt.clientX - r.left) / r.width)),
                y:  Math.max(0, Math.min(1, (pt.clientY - r.top)  / r.height)),
                px: pt.clientX - r.left, py: pt.clientY - r.top,
            };
        }

        function _handleDown(p) {
            _mx = p.x; _my = p.y;
            _addRipple(p.px, p.py);
            _startVoice();
            if (_recActive) _recordEvent('on', p.x, p.y);
        }
        function _handleMove(p) {
            if (!_playing) return;
            _mx = p.x; _my = p.y; _updateVoice();
        }
        function _handleUp() {
            if (_recActive && _playing) _recordEvent('off', _mx, _my);
            _stopVoice();
        }

        _canvas.addEventListener('mousedown', function (e) { _handleDown(_getXY(e)); });
        _canvas.addEventListener('mousemove', function (e) { _handleMove(_getXY(e)); });
        _canvas.addEventListener('mouseup',    _handleUp);
        _canvas.addEventListener('mouseleave', function () { if (_playing) _handleUp(); });
        _canvas.addEventListener('touchstart', function (e) { e.preventDefault(); _handleDown(_getXY(e)); }, { passive: false });
        _canvas.addEventListener('touchmove',  function (e) { e.preventDefault(); _handleMove(_getXY(e)); }, { passive: false });
        _canvas.addEventListener('touchend',   _handleUp);
        _canvas.addEventListener('touchcancel',_handleUp);

        // ── LOOP CONTROLS row ──────────────────────────────────
        var loopRow = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0;border-top:1px solid rgba(255,180,0,.1);border-bottom:1px solid rgba(255,180,0,.1);');
        loopRow.appendChild(_lbl('LOOP'));

        // REC button
        _recBtnEl = document.createElement('button');
        _recBtnEl.className = 'ss-card-btn';
        _recBtnEl.style.cssText += 'border-color:rgba(255,60,60,.5);color:rgba(255,100,100,.9);min-width:52px;';
        _recBtnEl.textContent = '● REC';
        _recBtnEl.onclick = function () {
            if (_recActive) {
                _stopRec();
            } else {
                // Transport must be running for onTick to fire — start it if needed
                if (!SonicSuite._state.playing) SonicSuite.start();
                _startRec();
            }
        };
        loopRow.appendChild(_recBtnEl);

        // LOOP play button
        _loopBtnEl = document.createElement('button');
        _loopBtnEl.className = 'ss-card-btn';
        _loopBtnEl.style.cssText += 'border-color:rgba(255,180,0,.4);color:rgba(255,180,0,.8);min-width:52px;';
        _loopBtnEl.textContent = '▶ LOOP';
        _loopBtnEl.onclick = function () {
            _loopActive = !_loopActive;
            _loopBtnEl.classList.toggle('playing', _loopActive);
            _loopBtnEl.textContent = _loopActive ? '■ LOOP' : '▶ LOOP';
            if (_loopActive && !SonicSuite._state.playing) SonicSuite.start();
        };
        loopRow.appendChild(_loopBtnEl);

        // CLR loop
        var loopClrBtn = document.createElement('button');
        loopClrBtn.className = 'ss-card-btn';
        loopClrBtn.style.cssText += 'border-color:rgba(255,60,60,.3);color:rgba(255,100,100,.65);';
        loopClrBtn.textContent = 'CLR';
        loopClrBtn.onclick = function () {
            _loopEvents = []; _loopActive = false;
            _loopBtnEl.classList.remove('playing'); _loopBtnEl.textContent = '▶ LOOP';
        };
        loopRow.appendChild(loopClrBtn);

        // Loop length selector
        var loopLenLbl = document.createElement('span'); loopLenLbl.className = 'mpc-lbl'; loopLenLbl.style.marginLeft = '4px'; loopLenLbl.textContent = 'LEN';
        loopRow.appendChild(loopLenLbl);
        _loopLenSel = document.createElement('select');
        _loopLenSel.className = 'ss-card-btn';
        _loopLenSel.style.cssText = 'font-size:9px;padding:1px 4px;';
        [['1 BAR', 16], ['2 BARS', 32], ['4 BARS', 64]].forEach(function (opt) {
            var o = document.createElement('option'); o.value = opt[1]; o.textContent = opt[0];
            if (opt[1] === 32) o.selected = true;
            _loopLenSel.appendChild(o);
        });
        _loopLenSel.onchange = function () { _loopLen16 = +this.value; P.loopBars = _loopLen16 / 16; _save(); };
        loopRow.appendChild(_loopLenSel);

        // Event count indicator
        var evCountEl = document.createElement('span');
        evCountEl.style.cssText = 'font-size:8px;color:rgba(255,180,0,.5);margin-left:auto;';
        evCountEl.textContent = '0 events';
        loopRow.appendChild(evCountEl);
        window._xyEvCount = evCountEl;

        body.appendChild(loopRow);

        // ── ROW 2: Filter + Reverb ─────────────────────────────
        var row2 = _div('display:flex;align-items:center;gap:12px;flex-wrap:wrap;');
        row2.classList.add('ic-section');
        row2.appendChild(_knob('RES', 1, 22, P.resonance, '', function (v) { P.resonance = v; if (_filter) _filter.Q.setTargetAtTime(v, _ctx.currentTime, 0.03); }));
        row2.appendChild(_knob('DETUNE', 0, 50, P.detune, 'c', function (v) { P.detune = v; if (_osc2) _osc2.detune.setTargetAtTime(v, _ctx.currentTime, 0.03); }));
        row2.appendChild(_knob('PORT', 1, 200, Math.round(P.portamento * 1000), 'ms', function (v) { P.portamento = v / 1000; }));
        row2.appendChild(_knob('REV', 0, 100, Math.round(P.reverbAmt * 100), '%', function (v) { P.reverbAmt = v / 100; }));
        row2.appendChild(_knob('VOL', 0, 100, Math.round(P.volume * 100), '%', function (v) { P.volume = v / 100; if (_volGain) _volGain.gain.setTargetAtTime(P.volume, _ctx.currentTime, 0.02); }));
        body.appendChild(row2);

        // ── ROW 3: ADSR ────────────────────────────────────────
        var row3 = _div('display:flex;align-items:center;gap:12px;flex-wrap:wrap;');
        row3.classList.add('ic-section');
        var adsrLbl = _lbl('ADSR ENVELOPE'); adsrLbl.style.width = '100%'; row3.appendChild(adsrLbl);
        row3.appendChild(_knob('ATK', 1, 500, Math.round(P.attack * 1000), 'ms', function (v) { P.attack = v / 1000; }));
        row3.appendChild(_knob('DCY', 10, 800, Math.round(P.decay * 1000), 'ms', function (v) { P.decay = v / 1000; }));
        row3.appendChild(_knob('SUS', 0, 100, Math.round(P.sustain * 100), '%', function (v) { P.sustain = v / 100; if (_playing && _ampGain) _ampGain.gain.setTargetAtTime(0.6 * P.sustain, _ctx.currentTime, 0.05); }));
        row3.appendChild(_knob('REL', 10, 2000, Math.round(P.release * 1000), 'ms', function (v) { P.release = v / 1000; }));
        body.appendChild(row3);

        _loadState();
    }

    // ── Recording logic ───────────────────────────────────────
    function _startRec() {
        _loopEvents = [];
        _recActive = true;
        _loopActive = false;
        _recStart16 = SonicSuite._state.step;
        _loopLen16 = +(_loopLenSel ? _loopLenSel.value : 32);
        if (_recBtnEl) { _recBtnEl.textContent = '■ STOP REC'; _recBtnEl.classList.add('playing'); }
        if (_loopBtnEl) { _loopBtnEl.classList.remove('playing'); _loopBtnEl.textContent = '▶ LOOP'; }
        if (window._xyEvCount) window._xyEvCount.textContent = '● REC';
    }

    function _stopRec() {
        _recActive = false;
        if (_recBtnEl) { _recBtnEl.textContent = '● REC'; _recBtnEl.classList.remove('playing'); }
        var n = _loopEvents.filter(function (e) { return e.type === 'on'; }).length;
        if (window._xyEvCount) window._xyEvCount.textContent = n + ' events';
        if (n > 0) {
            _loopActive = true;
            if (_loopBtnEl) { _loopBtnEl.classList.add('playing'); _loopBtnEl.textContent = '■ LOOP'; }
        }
    }

    function _recordEvent(type, x, y) {
        var cur16 = SonicSuite._state.step;
        var offset = (cur16 - _recStart16 + 999999) % _loopLen16;
        _loopEvents.push({ type: type, x: x, y: y, loopStep: offset });
        if (window._xyEvCount) window._xyEvCount.textContent = '● ' + _loopEvents.filter(function (e) { return e.type === 'on'; }).length;
    }

    // ── Persistence ───────────────────────────────────────────
    function _save() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(P)); } catch (e) {}
    }
    function _loadState() {
        try { Object.assign(P, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) {}
        document.querySelectorAll('.xy-vb').forEach(function (b) { b.classList.toggle('playing', b.dataset.v === P.voice); });
        _loopLen16 = (P.loopBars || 2) * 16;
        if (_loopLenSel) _loopLenSel.value = _loopLen16;
    }

    // ── Boot ──────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(function () {
                SonicSuite.registerCard('xypad', {
                    tag:    'X',
                    label:  'VNGRD//VOID PAD',
                    onTick: _onTick,
                    mount:  _mount,
                });
            }, 340);
        }
        btn ? btn.addEventListener('click', _once) : setTimeout(_once, 800);
    });
})();
