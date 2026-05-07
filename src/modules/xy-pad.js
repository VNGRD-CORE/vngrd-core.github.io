// ═══════════════════════════════════════════════════════════════
// XY SYNTH PAD — mouse / touch 2D synthesizer controller
// X axis = pitch (pentatonic, 2 octaves)
// Y axis = filter cutoff (top = open, bottom = closed)
// Depends on: SonicSuite (global)
// Registers card id: 'xypad'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const LS_KEY = 'vngrd.xypad.v1';

    // ── Config ────────────────────────────────────────────────
    const P = {
        voice:     'sawtooth',   // 'sawtooth' | 'square' | 'triangle' | 'sine'
        octave:    3,            // 1–6
        detune:    0,            // cents osc2 offset for width
        resonance: 10,           // filter Q
        reverbAmt: 0.20,         // 0–1 reverb send
        portamento:0.055,        // freq glide time (s)
        filterMin: 90,           // Hz
        filterMax: 12000,        // Hz
    };

    // Pentatonic scale intervals within one octave
    const PENTA = [0, 2, 4, 7, 9];   // semitones from root
    const ROOT  = 48;                  // C3 (MIDI)

    function _midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
    function _xToMidi(x) {
        const notes  = PENTA.length * 2;             // 10 columns across 2 octaves
        const idx    = Math.min(notes - 1, Math.floor(x * notes));
        const octOff = Math.floor(idx / PENTA.length);
        const semi   = PENTA[idx % PENTA.length];
        return ROOT + (P.octave - 3) * 12 + octOff * 12 + semi;
    }
    function _yToCutoff(y) {
        // y = 0 (top of canvas) → open filter; y = 1 (bottom) → closed
        const t = 1 - y;
        return P.filterMin + (P.filterMax - P.filterMin) * t * t;  // quadratic feel
    }

    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    function _midiName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }

    // ── Web Audio state ───────────────────────────────────────
    let _ctx, _bus, _reverbTap;
    let _osc1 = null, _osc2 = null, _filter = null, _ampGain = null, _revGain = null;
    let _playing = false;
    let _mx = 0.5, _my = 0.5;   // normalised cursor 0–1

    function _startVoice() {
        if (_playing || !_ctx) return;
        _playing = true;

        _osc1    = _ctx.createOscillator();
        _osc2    = _ctx.createOscillator();
        _filter  = _ctx.createBiquadFilter();
        _ampGain = _ctx.createGain();

        _osc1.type            = P.voice;
        _osc2.type            = P.voice;
        _osc1.detune.value    = 0;
        _osc2.detune.value    = P.detune + 8;   // slight spread for stereo width feel
        _filter.type          = 'lowpass';
        _filter.Q.value       = P.resonance;
        _ampGain.gain.value   = 0;

        const freq   = _midiToHz(_xToMidi(_mx));
        const cutoff = _yToCutoff(_my);
        _osc1.frequency.value   = freq;
        _osc2.frequency.value   = freq;
        _filter.frequency.value = cutoff;

        _osc1.connect(_filter);
        _osc2.connect(_filter);
        _filter.connect(_ampGain).connect(_bus);

        // Reverb send
        if (_reverbTap) {
            _revGain = _ctx.createGain();
            _revGain.gain.value = P.reverbAmt;
            _ampGain.connect(_revGain).connect(_reverbTap);
        }

        _osc1.start(); _osc2.start();
        _ampGain.gain.setTargetAtTime(0.55, _ctx.currentTime, 0.012);
    }

    function _stopVoice() {
        if (!_playing) return;
        _playing = false;
        if (_ampGain) _ampGain.gain.setTargetAtTime(0, _ctx.currentTime, 0.035);
        const nodes = [_osc1, _osc2];
        setTimeout(function () {
            nodes.forEach(function (o) { try { if (o) o.stop(); } catch (e) {} });
        }, 250);
        _osc1 = _osc2 = _filter = _ampGain = _revGain = null;
    }

    function _updateVoice() {
        if (!_playing || !_osc1 || !_filter) return;
        const freq   = _midiToHz(_xToMidi(_mx));
        const cutoff = _yToCutoff(_my);
        _osc1.frequency.setTargetAtTime(freq, _ctx.currentTime, P.portamento);
        _osc2.frequency.setTargetAtTime(freq, _ctx.currentTime, P.portamento);
        _filter.frequency.setTargetAtTime(cutoff, _ctx.currentTime, 0.02);
        if (_revGain) _revGain.gain.setTargetAtTime(P.reverbAmt, _ctx.currentTime, 0.04);
    }

    // ── Canvas drawing ────────────────────────────────────────
    let _canvas = null, _ctx2d = null, _animId = null;
    const _ripples = [];

    function _draw() {
        if (!_canvas || !_ctx2d) return;
        const W = _canvas.offsetWidth  || 580;
        const H = _canvas.offsetHeight || 240;
        if (_canvas.width  !== W) _canvas.width  = W;
        if (_canvas.height !== H) _canvas.height = H;

        const c = _ctx2d;
        c.clearRect(0, 0, W, H);

        // Background
        const bg = c.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#02030f');
        bg.addColorStop(1, '#07001a');
        c.fillStyle = bg;
        c.fillRect(0, 0, W, H);

        // Pentatonic column grid
        const COLS = PENTA.length * 2;
        for (let i = 0; i <= COLS; i++) {
            const x = (i / COLS) * W;
            const atOct = (i % PENTA.length === 0);
            c.strokeStyle = atOct ? 'rgba(255,136,255,.22)' : 'rgba(255,136,255,.07)';
            c.lineWidth   = atOct ? 1 : 0.5;
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        }
        // Horizontal filter guide lines
        for (let i = 0; i <= 4; i++) {
            const y = (i / 4) * H;
            c.strokeStyle = 'rgba(0,243,255,.06)';
            c.lineWidth   = 0.5;
            c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
        }

        // Note name labels across bottom
        for (let i = 0; i < COLS; i++) {
            const midi = _xToMidi((i + 0.5) / COLS);
            const lbl  = NOTE_NAMES[((midi % 12) + 12) % 12];
            const x    = ((i + 0.5) / COLS) * W;
            c.fillStyle   = 'rgba(255,136,255,.18)';
            c.font        = '8px "JetBrains Mono", monospace';
            c.textAlign   = 'center';
            c.fillText(lbl, x, H - 4);
        }
        c.textAlign = 'left';

        // Ripple FX
        for (let i = _ripples.length - 1; i >= 0; i--) {
            const r = _ripples[i];
            r.age++;
            if (r.age > r.life) { _ripples.splice(i, 1); continue; }
            const p = r.age / r.life;
            c.strokeStyle = 'rgba(255,136,255,' + ((1 - p) * 0.65) + ')';
            c.lineWidth   = 1.5 * (1 - p * 0.6);
            c.beginPath();
            c.arc(r.x, r.y, r.maxR * p, 0, Math.PI * 2);
            c.stroke();
        }

        // Active cursor
        if (_playing) {
            const cx = _mx * W;
            const cy = _my * H;

            // Crosshair dashes
            c.setLineDash([4, 5]);
            c.strokeStyle = 'rgba(255,136,255,.6)';
            c.lineWidth   = 1;
            c.beginPath(); c.moveTo(cx, 0);  c.lineTo(cx, H);  c.stroke();
            c.beginPath(); c.moveTo(0,  cy); c.lineTo(W,  cy); c.stroke();
            c.setLineDash([]);

            // Glow dot
            const grd = c.createRadialGradient(cx, cy, 0, cx, cy, 18);
            grd.addColorStop(0, 'rgba(255,136,255,1)');
            grd.addColorStop(1, 'rgba(255,136,255,0)');
            c.fillStyle = grd;
            c.beginPath(); c.arc(cx, cy, 18, 0, Math.PI * 2); c.fill();

            // Note + cutoff labels
            const midi   = _xToMidi(_mx);
            const noteLbl= _midiName(midi);
            const cutLbl = Math.round(_yToCutoff(_my)) + 'Hz';
            c.fillStyle = '#ff88ff';
            c.font      = 'bold 11px "JetBrains Mono", monospace';
            const lx = cx + 10 < W - 60 ? cx + 10 : cx - 68;
            const ly = cy - 10 > 14 ? cy - 10 : cy + 20;
            c.fillText(noteLbl, lx, ly);
            c.fillStyle = 'rgba(0,243,255,.8)';
            c.font      = '9px "JetBrains Mono", monospace';
            c.fillText(cutLbl, lx, ly + 13);

            // Filter level bar (right edge)
            const fNorm = 1 - _my;
            const barH  = H * 0.85;
            c.fillStyle = 'rgba(0,243,255,.15)';
            c.fillRect(W - 7, H * 0.075, 4, barH);
            c.fillStyle = 'rgba(0,243,255,.65)';
            c.fillRect(W - 7, H * 0.075 + barH * (1 - fNorm), 4, barH * fNorm);
        } else {
            // Idle hint
            c.fillStyle   = 'rgba(255,136,255,.12)';
            c.font        = '10px "JetBrains Mono", monospace';
            c.textAlign   = 'center';
            c.fillText('▸ CLICK OR TOUCH TO PLAY', W / 2, H / 2 - 7);
            c.fillStyle   = 'rgba(0,243,255,.08)';
            c.font        = '8px "JetBrains Mono", monospace';
            c.fillText('X → PITCH (PENTATONIC)   Y → FILTER CUTOFF', W / 2, H / 2 + 9);
            c.textAlign   = 'left';
        }
    }

    function _addRipple(x, y) {
        _ripples.push({ x, y, age: 0, life: 32, maxR: 55 });
    }

    // ── UI ────────────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx      = ctx.audioCtx;
        _bus      = ctx.bus;
        _reverbTap= ctx.reverbTap;

        body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px 4px;min-width:520px;user-select:none;';

        // — Controls —
        const ctrl = document.createElement('div');
        ctrl.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
        ctrl.innerHTML =
            '<span class="mpc-lbl">VOICE</span>' +
            '<button class="ss-card-btn xy-vb playing" data-v="sawtooth">SAW</button>' +
            '<button class="ss-card-btn xy-vb" data-v="square">SQ</button>' +
            '<button class="ss-card-btn xy-vb" data-v="triangle">TRI</button>' +
            '<button class="ss-card-btn xy-vb" data-v="sine">SINE</button>' +
            '<span class="mpc-lbl" style="margin-left:12px;">OCT</span>' +
            '<button class="ss-card-btn xy-od">▼</button>' +
            '<span class="xy-on" style="min-width:14px;text-align:center;font-size:11px;color:#ff88ff;">3</span>' +
            '<button class="ss-card-btn xy-ou">▲</button>' +
            '<span class="mpc-lbl" style="margin-left:12px;">RES</span>' +
            '<input type="range" class="xy-res" min="1" max="25" value="' + P.resonance + '" style="width:64px;accent-color:#00f3ff;">' +
            '<span class="mpc-lbl" style="margin-left:8px;">REV</span>' +
            '<input type="range" class="xy-rev" min="0" max="100" value="' + Math.round(P.reverbAmt * 100) + '" style="width:64px;accent-color:#ff88ff;">';
        body.appendChild(ctrl);

        const octEl = ctrl.querySelector('.xy-on');
        ctrl.querySelectorAll('.xy-vb').forEach(b => b.onclick = function () {
            P.voice = this.dataset.v;
            ctrl.querySelectorAll('.xy-vb').forEach(x => x.classList.remove('playing'));
            this.classList.add('playing');
            if (_osc1) _osc1.type = P.voice;
            if (_osc2) _osc2.type = P.voice;
            _save();
        });
        ctrl.querySelector('.xy-od').onclick = () => { P.octave = Math.max(1, P.octave - 1); octEl.textContent = P.octave; _save(); };
        ctrl.querySelector('.xy-ou').onclick = () => { P.octave = Math.min(6, P.octave + 1); octEl.textContent = P.octave; _save(); };
        ctrl.querySelector('.xy-res').oninput = function () { P.resonance = +this.value; if (_filter) _filter.Q.setTargetAtTime(P.resonance, _ctx.currentTime, 0.02); _save(); };
        ctrl.querySelector('.xy-rev').oninput = function () { P.reverbAmt = +this.value / 100; _save(); };

        // — Canvas —
        _canvas = document.createElement('canvas');
        _canvas.style.cssText = 'width:100%;height:240px;cursor:crosshair;border:1px solid rgba(255,136,255,.18);border-radius:4px;touch-action:none;display:block;box-sizing:border-box;';
        body.appendChild(_canvas);
        _ctx2d  = _canvas.getContext('2d');

        // Draw loop
        cancelAnimationFrame(_animId);
        (function loop() { _animId = requestAnimationFrame(loop); _draw(); })();

        // ── Pointer events (unified mouse + touch) ──
        function _getXY(e) {
            const r  = _canvas.getBoundingClientRect();
            const pt = e.touches ? e.touches[0] : e;
            return {
                x: Math.max(0, Math.min(1, (pt.clientX - r.left)  / r.width)),
                y: Math.max(0, Math.min(1, (pt.clientY - r.top)   / r.height)),
                px: pt.clientX - r.left,
                py: pt.clientY - r.top,
            };
        }

        _canvas.addEventListener('mousedown', function (e) {
            const p = _getXY(e);
            _mx = p.x; _my = p.y;
            _addRipple(p.px, p.py);
            _startVoice();
        });
        _canvas.addEventListener('mousemove', function (e) {
            if (!_playing) return;
            const p = _getXY(e);
            _mx = p.x; _my = p.y;
            _updateVoice();
        });
        _canvas.addEventListener('mouseup',    _stopVoice);
        _canvas.addEventListener('mouseleave', function () { if (_playing) _stopVoice(); });

        _canvas.addEventListener('touchstart', function (e) {
            e.preventDefault();
            const p = _getXY(e);
            _mx = p.x; _my = p.y;
            _addRipple(p.px, p.py);
            _startVoice();
        }, { passive: false });
        _canvas.addEventListener('touchmove', function (e) {
            e.preventDefault();
            if (!_playing) return;
            const p = _getXY(e);
            _mx = p.x; _my = p.y;
            _updateVoice();
        }, { passive: false });
        _canvas.addEventListener('touchend',   _stopVoice);
        _canvas.addEventListener('touchcancel',_stopVoice);

        _loadState();
    }

    // ── Persistence ───────────────────────────────────────────
    function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify(P)); } catch (e) {} }
    function _loadState() {
        try {
            const d = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
            Object.assign(P, d);
        } catch (e) {}
        // Sync controls
        const octEl = document.querySelector('.xy-on');
        if (octEl) octEl.textContent = P.octave;
        document.querySelectorAll('.xy-vb').forEach(b => b.classList.toggle('playing', b.dataset.v === P.voice));
        const res = document.querySelector('.xy-res');
        if (res) res.value = P.resonance;
        const rev = document.querySelector('.xy-rev');
        if (rev) rev.value = Math.round(P.reverbAmt * 100);
    }

    // ── Boot ─────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(function () {
                SonicSuite.registerCard('xypad', {
                    tag:   'X',
                    label: '◈ XY PAD',
                    mount: _mount,
                    // No onTick — this card is always free-running via mouse/touch
                });
            }, 340);
        }
        btn ? btn.addEventListener('click', _once) : setTimeout(_once, 800);
    });
})();
