// ═══════════════════════════════════════════════════════════════
// TB-303 BASSLINE — acid bass synthesizer, 16-step sequencer
// Monophonic: shared osc+filter; slide = glide, accent = boost
// Depends on: SonicSuite (global)
// Registers card id: 'bass303'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NUM_STEPS = 16;
    const NUM_PATS  = 8;
    const LS_KEY    = 'vngrd.bass303.v1';

    // ── Scale / note helpers ──────────────────────────────────
    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    function _noteName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
    function _midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

    // ── Pattern storage ───────────────────────────────────────
    // step: { on, note (MIDI), slide, accent }
    const patterns = Array.from({ length: NUM_PATS }, () =>
        Array.from({ length: NUM_STEPS }, () => ({ on: false, note: 36, slide: false, accent: false }))
    );

    // ── Synth params ──────────────────────────────────────────
    const P = {
        waveform:   'sawtooth',
        cutoff:     900,    // Hz (base)
        resonance:  12,     // Q
        envMod:     0.6,    // 0–1: how far cutoff opens on retrigger
        decay:      0.32,   // filter env decay time (s)
        accentVol:  0.28,   // extra gain on accent
        distortion: 0,      // 0–1 waveshaper drive
        glide:      0.06,   // portamento time (s)
    };

    let curPat      = 0;
    let selectedStp = -1;   // step selected for note editing
    let curStep     = -1;
    let _ctx, _bus;

    // Shared voice nodes (created once per card mount)
    let _osc     = null;
    let _filter  = null;
    let _ampGain = null;
    let _dist    = null;
    let _booted  = false;

    // DOM refs
    let _noteEls   = [];
    let _slideEls  = [];
    let _accentEls = [];

    // ── Persistence ───────────────────────────────────────────
    function _load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save() {
        try { localStorage.setItem(LS_KEY, JSON.stringify({ patterns, curPat, P })); } catch (e) {}
    }

    // ── Voice initialisation (lazy, on first note) ────────────
    function _boot() {
        if (_booted || !_ctx) return;
        _booted = true;

        _osc    = _ctx.createOscillator();
        _filter = _ctx.createBiquadFilter();
        _ampGain= _ctx.createGain();
        _dist   = _ctx.createWaveShaper();

        _osc.type            = P.waveform;
        _osc.frequency.value = _midiToHz(36);
        _filter.type         = 'lowpass';
        _filter.frequency.value = P.cutoff;
        _filter.Q.value      = P.resonance;
        _ampGain.gain.value  = 0;
        _dist.curve          = _distCurve(P.distortion);
        _dist.oversample     = '2x';

        _osc.connect(_filter).connect(_ampGain).connect(_dist).connect(_bus);
        _osc.start();
    }

    function _distCurve(amt) {
        const n = 256, k = amt * 180;
        const c = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            c[i] = k === 0 ? x : (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
        }
        return c;
    }

    // ── Note trigger ──────────────────────────────────────────
    function _trigNote(time, midi, isSlide, isAccent) {
        _boot();
        if (!_osc) return;
        const freq     = _midiToHz(midi);
        const vol      = isAccent ? Math.min(1, 0.82 + P.accentVol * 0.5) : 0.72;
        const cutHigh  = Math.min(P.cutoff * (1 + P.envMod * 14), 18000);

        if (isSlide) {
            // Glide: no retrigger of amp, just frequency + gentle filter bump
            _osc.frequency.setTargetAtTime(freq, time, P.glide * 0.5);
            _filter.frequency.setValueAtTime(_filter.frequency.value, time);
            _filter.frequency.setTargetAtTime(cutHigh * 0.65, time, 0.012);
            _filter.frequency.setTargetAtTime(P.cutoff, time + 0.02, P.decay);
        } else {
            // Hard retrigger
            _osc.frequency.cancelScheduledValues(time);
            _osc.frequency.setValueAtTime(freq, time);
            _ampGain.gain.cancelScheduledValues(time);
            _ampGain.gain.setValueAtTime(vol, time);
            _filter.frequency.cancelScheduledValues(time);
            _filter.frequency.setValueAtTime(cutHigh, time);
            _filter.frequency.exponentialRampToValueAtTime(Math.max(P.cutoff * 0.45, 60), time + P.decay);
        }
    }

    function _noteOff(time) {
        if (!_ampGain) return;
        _ampGain.gain.setTargetAtTime(0, time, 0.018);
    }

    // ── Tick handler ─────────────────────────────────────────
    function _onTick(time, step16) {
        curStep = step16;
        _highlightStep(step16);
        const pat  = patterns[curPat];
        const s    = pat[step16];
        const bpm  = window.currentBPM || 120;
        const sDur = 60 / bpm / 4;

        if (s.on) {
            const nextS    = pat[(step16 + 1) % NUM_STEPS];
            const holdTime = (nextS.on && nextS.slide) ? sDur : sDur * 0.88;
            _trigNote(time, s.note, s.slide, s.accent);
            _noteOff(time + holdTime);
        } else {
            _noteOff(time);
        }
    }

    function _onStop() {
        curStep = -1;
        _highlightStep(-1);
        if (_ampGain) _ampGain.gain.setTargetAtTime(0, _ctx.currentTime, 0.02);
    }

    function _highlightStep(s) {
        _noteEls.forEach((el, i) => el && el.classList.toggle('mpc-active', i === s));
    }

    // ── UI ────────────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx = ctx.audioCtx;
        _bus = ctx.bus;
        body.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px 4px;min-width:660px;user-select:none;';

        // — Top row: pattern + waveform —
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
        top.querySelector('.b3-pp').onclick = () => { curPat = (curPat - 1 + NUM_PATS) % NUM_PATS; pNum.textContent = curPat + 1; selectedStp = -1; _renderPat(); };
        top.querySelector('.b3-pn').onclick = () => { curPat = (curPat + 1) % NUM_PATS; pNum.textContent = curPat + 1; selectedStp = -1; _renderPat(); };
        top.querySelectorAll('.b3-wv').forEach(b => b.onclick = function () {
            P.waveform = this.dataset.w;
            top.querySelectorAll('.b3-wv').forEach(x => x.classList.remove('playing'));
            this.classList.add('playing');
            if (_osc) _osc.type = P.waveform;
            _save();
        });
        top.querySelector('.b3-clr').onclick = () => {
            patterns[curPat] = Array.from({ length: NUM_STEPS }, () => ({ on: false, note: 36, slide: false, accent: false }));
            selectedStp = -1; _renderPat(); _save();
        };

        // — Step number row —
        const numRow = _div('display:flex;gap:3px;');
        for (let s = 0; s < NUM_STEPS; s++) {
            const sp = document.createElement('span');
            sp.style.cssText = 'font-size:7px;width:37px;text-align:center;flex-shrink:0;color:' + (s % 4 === 0 ? 'rgba(255,136,255,.65)' : 'rgba(255,136,255,.28)') + ';';
            sp.textContent = s + 1;
            numRow.appendChild(sp);
        }
        body.appendChild(numRow);

        // — Note row —
        const noteRow = _div('display:flex;gap:3px;');
        _noteEls = [];
        for (let s = 0; s < NUM_STEPS; s++) {
            const btn = document.createElement('button');
            btn.style.cssText = 'width:37px;height:34px;border:1px solid rgba(255,136,255,.18);background:rgba(0,0,0,.4);cursor:pointer;border-radius:3px;font-size:8px;color:rgba(255,136,255,.45);flex-shrink:0;line-height:1.2;';
            btn.dataset.step = s;
            btn.onclick = function () {
                const cell = patterns[curPat][s];
                if (!cell.on) { cell.on = true; }
                selectedStp = (selectedStp === s) ? -1 : s;
                _renderPat(); _save();
            };
            noteRow.appendChild(btn);
            _noteEls.push(btn);
        }
        body.appendChild(noteRow);

        // — Slide row —
        const slideRow = _div('display:flex;gap:3px;');
        _slideEls = [];
        for (let s = 0; s < NUM_STEPS; s++) {
            const btn = document.createElement('button');
            btn.style.cssText = 'width:37px;height:15px;border:1px solid rgba(0,243,255,.12);background:rgba(0,0,0,.3);cursor:pointer;border-radius:2px;font-size:7px;color:rgba(0,243,255,.38);flex-shrink:0;';
            btn.textContent = 'SLD';
            btn.onclick = () => { patterns[curPat][s].slide = !patterns[curPat][s].slide; _renderPat(); _save(); };
            slideRow.appendChild(btn);
            _slideEls.push(btn);
        }
        body.appendChild(slideRow);

        // — Accent row —
        const accRow = _div('display:flex;gap:3px;');
        _accentEls = [];
        for (let s = 0; s < NUM_STEPS; s++) {
            const btn = document.createElement('button');
            btn.style.cssText = 'width:37px;height:15px;border:1px solid rgba(255,80,80,.12);background:rgba(0,0,0,.3);cursor:pointer;border-radius:2px;font-size:7px;color:rgba(255,80,80,.38);flex-shrink:0;';
            btn.textContent = 'ACC';
            btn.onclick = () => { patterns[curPat][s].accent = !patterns[curPat][s].accent; _renderPat(); _save(); };
            accRow.appendChild(btn);
            _accentEls.push(btn);
        }
        body.appendChild(accRow);

        // — Note keyboard —
        const kb = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:2px;');
        const kbLbl = document.createElement('span');
        kbLbl.style.cssText = 'font-size:9px;color:rgba(255,136,255,.6);letter-spacing:2px;';
        kbLbl.textContent = 'NOTE';
        kb.appendChild(kbLbl);

        // Octave picker
        const octSel = document.createElement('select');
        octSel.className = 'ss-card-btn';
        octSel.style.cssText = 'font-size:9px;padding:1px 3px;';
        [1, 2, 3, 4].forEach(o => {
            const opt = document.createElement('option');
            opt.value = o; opt.textContent = 'Oct ' + o;
            if (o === 2) opt.selected = true;
            octSel.appendChild(opt);
        });
        kb.appendChild(octSel);

        // Piano keys (one octave)
        const pianoNotes  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
        const pianoDiv    = _div('display:flex;gap:2px;align-items:flex-end;');
        pianoNotes.forEach((n, i) => {
            const black = n.includes('#');
            const btn   = document.createElement('button');
            btn.style.cssText =
                'width:' + (black ? 19 : 23) + 'px;height:' + (black ? 20 : 28) + 'px;' +
                'border:1px solid rgba(255,136,255,.3);cursor:pointer;border-radius:2px;font-size:7px;' +
                'color:rgba(255,136,255,.75);' +
                'background:' + (black ? 'rgba(255,136,255,.2)' : 'rgba(255,136,255,.07)') + ';';
            btn.textContent = n.replace('#', '♯');
            btn.onclick = () => {
                const midi = (+octSel.value + 1) * 12 + i;  // Oct1 C = MIDI 24
                if (selectedStp >= 0) {
                    const cell   = patterns[curPat][selectedStp];
                    cell.note    = midi;
                    cell.on      = true;
                    _renderPat(); _save();
                    // Audition
                    _boot();
                    if (_ampGain) { _ampGain.gain.setValueAtTime(0.65, _ctx.currentTime); _noteOff(_ctx.currentTime + 0.45); }
                    if (_osc)     _osc.frequency.setValueAtTime(_midiToHz(midi), _ctx.currentTime);
                    if (_filter)  { _filter.frequency.setValueAtTime(Math.min(P.cutoff * 9, 18000), _ctx.currentTime); _filter.frequency.setTargetAtTime(P.cutoff, _ctx.currentTime + 0.01, P.decay); }
                    // Advance selection
                    selectedStp = (selectedStp + 1) % NUM_STEPS;
                    _renderPat();
                }
            };
            pianoDiv.appendChild(btn);
        });
        kb.appendChild(pianoDiv);
        body.appendChild(kb);

        // — Filter / synth knobs —
        const knobs = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px solid rgba(255,136,255,.1);');
        [
            ['CUTOFF', 80, 8000, P.cutoff,                    'Hz', v => { P.cutoff = v; if (_filter) _filter.frequency.setTargetAtTime(v, _ctx.currentTime, 0.02); }],
            ['RES',    1,   25, P.resonance,                   '',  v => { P.resonance = v; if (_filter) _filter.Q.setTargetAtTime(v, _ctx.currentTime, 0.02); }],
            ['ENV',    0,  100, Math.round(P.envMod * 100),    '%', v => { P.envMod = v / 100; }],
            ['DECAY',  5,  100, Math.round(P.decay * 100),     '%', v => { P.decay = v / 100; }],
            ['ACCENT', 0,  100, Math.round(P.accentVol * 100), '%', v => { P.accentVol = v / 100; }],
            ['DIST',   0,  100, Math.round(P.distortion * 100),'%', v => { P.distortion = v / 100; if (_dist) _dist.curve = _distCurve(P.distortion); }],
            ['GLIDE',  5,  500, Math.round(P.glide * 1000),    'ms',v => { P.glide = v / 1000; }],
        ].forEach(([lbl, min, max, val, unit, fn]) => {
            const wrap = _div('display:flex;flex-direction:column;align-items:center;gap:2px;');
            wrap.innerHTML =
                '<span style="font-size:7px;color:rgba(255,136,255,.55);letter-spacing:1px;">' + lbl + '</span>' +
                '<input type="range" min="' + min + '" max="' + max + '" value="' + val + '" style="width:62px;accent-color:#ff88ff;">' +
                '<span style="font-size:8px;color:#ff88ff;">' + val + unit + '</span>';
            const inp  = wrap.querySelector('input');
            const disp = wrap.querySelector('span:last-child');
            inp.oninput = function () { const v = +this.value; disp.textContent = v + unit; fn(v); _save(); };
            knobs.appendChild(wrap);
        });
        body.appendChild(knobs);

        _renderPat();
        _loadState();
    }

    function _renderPat() {
        const pat = patterns[curPat];
        pat.forEach((step, i) => {
            const ne = _noteEls[i];
            const se = _slideEls[i];
            const ae = _accentEls[i];
            if (!ne) return;
            const sel = (selectedStp === i);

            if (step.on) {
                ne.style.background  = sel ? 'rgba(255,136,255,.55)' : 'rgba(255,136,255,.2)';
                ne.style.borderColor = sel ? '#ff88ff' : 'rgba(255,136,255,.5)';
                ne.style.color       = '#ff88ff';
                ne.textContent       = _noteName(step.note);
            } else {
                ne.style.background  = sel ? 'rgba(255,136,255,.12)' : 'rgba(0,0,0,.4)';
                ne.style.borderColor = sel ? 'rgba(255,136,255,.65)' : 'rgba(255,136,255,.15)';
                ne.style.color       = sel ? 'rgba(255,136,255,.8)' : 'rgba(255,136,255,.32)';
                ne.textContent       = '—';
            }
            if (se) {
                se.style.background  = step.slide ? 'rgba(0,243,255,.28)' : 'rgba(0,0,0,.3)';
                se.style.borderColor = step.slide ? 'rgba(0,243,255,.7)' : 'rgba(0,243,255,.12)';
                se.style.color       = step.slide ? '#00f3ff' : 'rgba(0,243,255,.38)';
            }
            if (ae) {
                ae.style.background  = step.accent ? 'rgba(255,70,70,.28)' : 'rgba(0,0,0,.3)';
                ae.style.borderColor = step.accent ? 'rgba(255,70,70,.7)' : 'rgba(255,80,80,.12)';
                ae.style.color       = step.accent ? '#ff6060' : 'rgba(255,80,80,.38)';
            }
        });
    }

    function _loadState() {
        const d = _load();
        if (d.patterns) d.patterns.forEach((pp, pi) => { if (pi < NUM_PATS) pp.forEach((s, si) => { if (si < NUM_STEPS) patterns[pi][si] = s; }); });
        if (d.curPat != null) curPat = d.curPat;
        if (d.P) Object.assign(P, d.P);
        _renderPat();
        const pn = document.querySelector('.b3-pnum');
        if (pn) pn.textContent = curPat + 1;
        // Re-apply waveform buttons
        document.querySelectorAll('.b3-wv').forEach(b => b.classList.toggle('playing', b.dataset.w === P.waveform));
    }

    function _div(style) {
        const d = document.createElement('div');
        d.style.cssText = style;
        return d;
    }

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
