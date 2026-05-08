// ═══════════════════════════════════════════════════════════════
// TB-303 BASSLINE — acid bass, monophonic, 16-step sequencer
// Shared oscillator (started once). Slide = portamento (no retrigger).
// Filter envelope: cutoff → decay exponential ramp.
// Depends on: SonicSuite (global)
// Registers card id: 'bass303'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NUM_STEPS = 16;
    const NUM_PATS  = 8;
    const LS_KEY    = 'vngrd.bass303.v2';

    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    function _noteName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
    function _midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

    // patterns[pat][step] = { on, note, slide, accent }
    const patterns = Array.from({ length: NUM_PATS }, function () {
        return Array.from({ length: NUM_STEPS }, function () { return { on: false, note: 36, slide: false, accent: false }; });
    });

    // Synth params — tuned for musical 303 sound
    const P = {
        waveform:   'sawtooth',
        cutoff:     500,      // base cutoff Hz
        resonance:  9,        // Q (lower = less harsh)
        envMod:     0.55,     // 0-1: scales how far cutoff opens
        decay:      0.28,     // filter env decay (s)
        accentVol:  0.25,     // extra gain for accents (added to base)
        distortion: 0,        // 0-1
        glide:      0.055,    // portamento time constant (s)
    };

    let curPat      = 0;
    let selectedStp = -1;
    let curStep     = -1;
    let _ctx, _bus;

    // Shared voice nodes — created once at mount
    let _osc    = null;
    let _filter = null;
    let _amp    = null;
    let _dist   = null;
    let _voiceOn = false;

    // DOM refs
    let _noteEls   = [];
    let _slideEls  = [];
    let _accentEls = [];

    function _load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ patterns, curPat, P })); } catch (e) {} }

    // ── Build shared voice (called once at mount) ─────────────
    function _buildVoice() {
        if (_osc || !_ctx) return;

        _osc    = _ctx.createOscillator();
        _filter = _ctx.createBiquadFilter();
        _amp    = _ctx.createGain();
        _dist   = _ctx.createWaveShaper();

        _osc.type             = P.waveform;
        _osc.frequency.value  = _midiToHz(36);
        _filter.type          = 'lowpass';
        _filter.frequency.value = P.cutoff;
        _filter.Q.value       = P.resonance;
        _amp.gain.value       = 0;
        _dist.curve           = _distCurve(P.distortion);
        _dist.oversample      = '2x';

        _osc.connect(_filter).connect(_amp).connect(_dist).connect(_bus);
        _osc.start();
    }

    function _distCurve(amt) {
        const n = 512;
        const k = amt * 100;
        const c = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            c[i] = k === 0 ? x : (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
        }
        return c;
    }

    // ── Note trigger ──────────────────────────────────────────
    function _trigNote(time, midi, isSlide, isAccent) {
        if (!_osc) return;
        const freq    = _midiToHz(midi);
        const baseVol = 0.65 + (isAccent ? P.accentVol : 0);
        // Open cutoff: base + envMod fraction of range up to 12kHz
        const cutOpen = P.cutoff + P.envMod * (10000 - P.cutoff);

        if (isSlide) {
            // Glide only — no amp retrigger, gentle filter open
            _osc.frequency.setTargetAtTime(freq, time, P.glide * 0.4);
            _filter.frequency.cancelScheduledValues(time);
            _filter.frequency.setTargetAtTime(Math.min(cutOpen * 0.7, 8000), time, 0.015);
            _filter.frequency.setTargetAtTime(P.cutoff, time + 0.04, P.decay);
        } else {
            // Hard retrigger
            _osc.frequency.cancelScheduledValues(time);
            _osc.frequency.setValueAtTime(freq, time);

            // Amp: gate on
            _amp.gain.cancelScheduledValues(time);
            _amp.gain.setValueAtTime(baseVol, time);

            // Filter envelope: snap open, decay to base
            _filter.frequency.cancelScheduledValues(time);
            _filter.frequency.setValueAtTime(cutOpen, time);
            _filter.frequency.setTargetAtTime(P.cutoff, time + 0.008, P.decay);
        }
        _voiceOn = true;
    }

    function _noteOff(time) {
        if (!_amp) return;
        _amp.gain.cancelScheduledValues(time);
        _amp.gain.setTargetAtTime(0, time, 0.016);
        _voiceOn = false;
    }

    // ── Tick ─────────────────────────────────────────────────
    function _onTick(time, step16) {
        curStep = step16;
        _highlightStep(step16);
        const pat  = patterns[curPat];
        const s    = pat[step16];
        const bpm  = window.currentBPM || 120;
        const sDur = 60 / bpm / 4;

        if (s.on) {
            const nxt      = pat[(step16 + 1) % NUM_STEPS];
            const holdTime = (nxt.on && nxt.slide) ? sDur * 1.02 : sDur * 0.82;
            _trigNote(time, s.note, s.slide, s.accent);
            _noteOff(time + holdTime);
        } else {
            _noteOff(time);
        }
    }

    function _onStop() {
        curStep = -1;
        _highlightStep(-1);
        if (_amp) _amp.gain.setTargetAtTime(0, _ctx.currentTime, 0.02);
    }

    function _highlightStep(s) {
        _noteEls.forEach(function (el, i) { if (el) el.classList.toggle('mpc-active', i === s); });
    }

    // ── UI ────────────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx = ctx.audioCtx;
        _bus = ctx.bus;
        _buildVoice();
        body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px 4px;min-width:660px;user-select:none;';

        // — Top row —
        const top = _div('display:flex;align-items:center;gap:10px;flex-wrap:wrap;');
        top.innerHTML =
            '<span class="mpc-lbl">PAT</span>' +
            '<button class="ss-card-btn b3-pp">◀</button>' +
            '<span class="b3-pnum" style="min-width:16px;text-align:center;color:#ff88ff;font-size:11px;">1</span>' +
            '<button class="ss-card-btn b3-pn">▶</button>' +
            '<span class="mpc-lbl" style="margin-left:12px;">WAVE</span>' +
            '<button class="ss-card-btn b3-wv playing" data-w="sawtooth">SAW</button>' +
            '<button class="ss-card-btn b3-wv" data-w="square">SQ</button>' +
            '<button class="ss-card-btn b3-clr" style="margin-left:auto;border-color:rgba(255,60,60,.4);color:rgba(255,100,100,.8);">CLR</button>';
        body.appendChild(top);

        const pNum = top.querySelector('.b3-pnum');
        top.querySelector('.b3-pp').onclick = function () { curPat = (curPat - 1 + NUM_PATS) % NUM_PATS; pNum.textContent = curPat + 1; selectedStp = -1; _renderPat(); };
        top.querySelector('.b3-pn').onclick = function () { curPat = (curPat + 1) % NUM_PATS; pNum.textContent = curPat + 1; selectedStp = -1; _renderPat(); };
        top.querySelectorAll('.b3-wv').forEach(function (b) {
            b.onclick = function () {
                P.waveform = this.dataset.w;
                top.querySelectorAll('.b3-wv').forEach(function (x) { x.classList.remove('playing'); });
                this.classList.add('playing');
                if (_osc) _osc.type = P.waveform;
                _save();
            };
        });
        top.querySelector('.b3-clr').onclick = function () {
            patterns[curPat] = Array.from({ length: NUM_STEPS }, function () { return { on: false, note: 36, slide: false, accent: false }; });
            selectedStp = -1; _renderPat(); _save();
        };

        // — Step numbers —
        const nums = _div('display:flex;gap:3px;');
        for (let s = 0; s < NUM_STEPS; s++) {
            const sp = document.createElement('span');
            sp.style.cssText = 'font-size:7px;width:37px;text-align:center;flex-shrink:0;color:' + (s % 4 === 0 ? 'rgba(255,136,255,.65)' : 'rgba(255,136,255,.28)') + ';';
            sp.textContent = s + 1;
            nums.appendChild(sp);
        }
        body.appendChild(nums);

        // — Note buttons —
        const noteRow = _div('display:flex;gap:3px;');
        _noteEls = [];
        for (let s = 0; s < NUM_STEPS; s++) {
            const btn = document.createElement('button');
            btn.style.cssText = 'width:37px;height:34px;border:1px solid rgba(255,136,255,.15);background:rgba(0,0,0,.4);cursor:pointer;border-radius:3px;font-size:8px;color:rgba(255,136,255,.4);flex-shrink:0;line-height:1.2;';
            (function (s, btn) {
                btn.onclick = function () {
                    const cell = patterns[curPat][s];
                    if (!cell.on) cell.on = true;
                    selectedStp = (selectedStp === s) ? -1 : s;
                    _renderPat(); _save();
                };
            }(s, btn));
            noteRow.appendChild(btn);
            _noteEls.push(btn);
        }
        body.appendChild(noteRow);

        // — Slide row —
        const slideRow = _div('display:flex;gap:3px;');
        _slideEls = [];
        for (let s = 0; s < NUM_STEPS; s++) {
            const btn = document.createElement('button');
            btn.style.cssText = 'width:37px;height:15px;border:1px solid rgba(0,243,255,.1);background:rgba(0,0,0,.3);cursor:pointer;border-radius:2px;font-size:7px;color:rgba(0,243,255,.35);flex-shrink:0;';
            btn.textContent = 'SLD';
            (function (s) {
                btn.onclick = function () { patterns[curPat][s].slide = !patterns[curPat][s].slide; _renderPat(); _save(); };
            }(s));
            slideRow.appendChild(btn);
            _slideEls.push(btn);
        }
        body.appendChild(slideRow);

        // — Accent row —
        const accRow = _div('display:flex;gap:3px;');
        _accentEls = [];
        for (let s = 0; s < NUM_STEPS; s++) {
            const btn = document.createElement('button');
            btn.style.cssText = 'width:37px;height:15px;border:1px solid rgba(255,80,80,.1);background:rgba(0,0,0,.3);cursor:pointer;border-radius:2px;font-size:7px;color:rgba(255,80,80,.35);flex-shrink:0;';
            btn.textContent = 'ACC';
            (function (s) {
                btn.onclick = function () { patterns[curPat][s].accent = !patterns[curPat][s].accent; _renderPat(); _save(); };
            }(s));
            accRow.appendChild(btn);
            _accentEls.push(btn);
        }
        body.appendChild(accRow);

        // — Mini keyboard for note entry —
        const kb = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:2px;');
        const kbl = document.createElement('span');
        kbl.style.cssText = 'font-size:9px;color:rgba(255,136,255,.6);letter-spacing:2px;';
        kbl.textContent = 'NOTE';
        kb.appendChild(kbl);

        const octSel = document.createElement('select');
        octSel.className = 'ss-card-btn';
        octSel.style.cssText = 'font-size:9px;padding:1px 3px;';
        [1, 2, 3, 4].forEach(function (o) {
            const opt = document.createElement('option');
            opt.value = o; opt.textContent = 'Oct ' + o;
            if (o === 2) opt.selected = true;
            octSel.appendChild(opt);
        });
        kb.appendChild(octSel);

        const pianoDiv = _div('display:flex;gap:2px;align-items:flex-end;');
        ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].forEach(function (n, i) {
            const black = n.includes('#');
            const btn   = document.createElement('button');
            btn.style.cssText =
                'width:' + (black ? 19 : 23) + 'px;height:' + (black ? 20 : 28) + 'px;' +
                'border:1px solid rgba(255,136,255,.28);cursor:pointer;border-radius:2px;font-size:7px;' +
                'color:rgba(255,136,255,.7);background:' + (black ? 'rgba(255,136,255,.18)' : 'rgba(255,136,255,.06)') + ';';
            btn.textContent = n.replace('#', '♯');
            btn.onclick = function () {
                const midi = (+octSel.value + 1) * 12 + i;
                if (selectedStp >= 0) {
                    const cell = patterns[curPat][selectedStp];
                    cell.note = midi; cell.on = true;
                    _renderPat(); _save();
                    // Audition
                    if (_amp) { _amp.gain.setValueAtTime(0.55, _ctx.currentTime); _noteOff(_ctx.currentTime + 0.4); }
                    if (_osc) _osc.frequency.setValueAtTime(_midiToHz(midi), _ctx.currentTime);
                    if (_filter) { _filter.frequency.setValueAtTime(P.cutoff + P.envMod * (10000 - P.cutoff), _ctx.currentTime); _filter.frequency.setTargetAtTime(P.cutoff, _ctx.currentTime + 0.01, P.decay); }
                    selectedStp = (selectedStp + 1) % NUM_STEPS;
                    _renderPat();
                }
            };
            pianoDiv.appendChild(btn);
        });
        kb.appendChild(pianoDiv);
        body.appendChild(kb);

        // — Synth knobs —
        const knobs = _div('display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px solid rgba(255,136,255,.1);');
        [
            ['CUTOFF', 80, 5000, P.cutoff,                    'Hz', function (v) { P.cutoff = v; if (_filter) _filter.frequency.setTargetAtTime(v, _ctx.currentTime, 0.05); }],
            ['RES',    1,   18, P.resonance,                   '',  function (v) { P.resonance = v; if (_filter) _filter.Q.setTargetAtTime(v, _ctx.currentTime, 0.05); }],
            ['ENV',    0,  100, Math.round(P.envMod * 100),    '%', function (v) { P.envMod = v / 100; }],
            ['DECAY',  5,  100, Math.round(P.decay * 100),     '%', function (v) { P.decay = v / 100; }],
            ['ACCENT', 0,  100, Math.round(P.accentVol * 100), '%', function (v) { P.accentVol = v / 100; }],
            ['DIST',   0,  100, Math.round(P.distortion * 100),'%', function (v) { P.distortion = v / 100; if (_dist) _dist.curve = _distCurve(P.distortion); }],
            ['GLIDE',  10, 400, Math.round(P.glide * 1000),    'ms',function (v) { P.glide = v / 1000; }],
        ].forEach(function (args) {
            var lbl = args[0], min = args[1], max = args[2], val = args[3], unit = args[4], fn = args[5];
            const wrap = _div('display:flex;flex-direction:column;align-items:center;gap:2px;');
            wrap.innerHTML =
                '<span style="font-size:7px;color:rgba(255,136,255,.55);letter-spacing:1px;">' + lbl + '</span>' +
                '<input type="range" min="' + min + '" max="' + max + '" value="' + val + '" style="width:62px;accent-color:#ff88ff;">' +
                '<span style="font-size:8px;color:#ff88ff;">' + val + unit + '</span>';
            const inp  = wrap.querySelector('input');
            const disp = wrap.querySelector('span:last-child');
            inp.oninput = function () { var v = +this.value; disp.textContent = v + unit; fn(v); _save(); };
            knobs.appendChild(wrap);
        });
        body.appendChild(knobs);

        _renderPat();
        _loadState();
    }

    function _renderPat() {
        const pat = patterns[curPat];
        pat.forEach(function (step, i) {
            const ne = _noteEls[i];
            const se = _slideEls[i];
            const ae = _accentEls[i];
            if (!ne) return;
            const sel = (selectedStp === i);
            if (step.on) {
                ne.style.background  = sel ? 'rgba(255,136,255,.5)' : 'rgba(255,136,255,.18)';
                ne.style.borderColor = sel ? '#ff88ff' : 'rgba(255,136,255,.45)';
                ne.style.color       = '#ff88ff';
                ne.textContent       = _noteName(step.note);
            } else {
                ne.style.background  = sel ? 'rgba(255,136,255,.1)' : 'rgba(0,0,0,.4)';
                ne.style.borderColor = sel ? 'rgba(255,136,255,.6)' : 'rgba(255,136,255,.12)';
                ne.style.color       = sel ? 'rgba(255,136,255,.8)' : 'rgba(255,136,255,.32)';
                ne.textContent       = '—';
            }
            if (se) {
                se.style.background  = step.slide ? 'rgba(0,243,255,.25)' : 'rgba(0,0,0,.3)';
                se.style.borderColor = step.slide ? 'rgba(0,243,255,.65)' : 'rgba(0,243,255,.1)';
                se.style.color       = step.slide ? '#00f3ff' : 'rgba(0,243,255,.35)';
            }
            if (ae) {
                ae.style.background  = step.accent ? 'rgba(255,60,60,.25)' : 'rgba(0,0,0,.3)';
                ae.style.borderColor = step.accent ? 'rgba(255,60,60,.65)' : 'rgba(255,80,80,.1)';
                ae.style.color       = step.accent ? '#ff5050' : 'rgba(255,80,80,.35)';
            }
        });
    }

    function _loadState() {
        const d = _load();
        if (d.patterns) {
            d.patterns.forEach(function (pp, pi) {
                if (pi < NUM_PATS) pp.forEach(function (s, si) { if (si < NUM_STEPS) patterns[pi][si] = s; });
            });
        }
        if (d.curPat != null) curPat = d.curPat;
        if (d.P) Object.assign(P, d.P);
        _renderPat();
        const pn = document.querySelector('.b3-pnum');
        if (pn) pn.textContent = curPat + 1;
        document.querySelectorAll('.b3-wv').forEach(function (b) { b.classList.toggle('playing', b.dataset.w === P.waveform); });
        // Sync voice nodes
        if (_osc)    _osc.type = P.waveform;
        if (_filter) { _filter.frequency.value = P.cutoff; _filter.Q.value = P.resonance; }
        if (_dist)   _dist.curve = _distCurve(P.distortion);
    }

    function _div(css) { const d = document.createElement('div'); d.style.cssText = css; return d; }

    // ── Boot ─────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(function () {
                SonicSuite.registerCard('bass303', {
                    tag:    'B',
                    label:  '◈ BASS 303',
                    onTick: _onTick,
                    onStop: _onStop,
                    mount:  _mount,
                });
            }, 260);
        }
        btn ? btn.addEventListener('click', _once) : setTimeout(_once, 700);
    });
})();
