// ═══════════════════════════════════════════════════════════════
// MPC DRUM MACHINE — 8-voice synthesized percussion, 16-step seq
// Depends on: SonicSuite (global)
// Registers card id: 'mpc'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NUM_VOICES  = 8;
    const NUM_STEPS   = 16;
    const NUM_PATS    = 8;
    const LS_KEY      = 'vngrd.mpc.v1';

    // ── Voice definitions ─────────────────────────────────────
    const VOICES = [
        { id: 'kick',  name: 'KICK',  color: '#00f3ff', synth: 'kick'   },
        { id: 'snare', name: 'SNRE',  color: '#ff8800', synth: 'snare'  },
        { id: 'clap',  name: 'CLAP',  color: '#ff44aa', synth: 'clap'   },
        { id: 'cht',   name: 'C.HT',  color: '#88ff44', synth: 'hat_c'  },
        { id: 'oht',   name: 'O.HT',  color: '#44ffcc', synth: 'hat_o'  },
        { id: 'tom',   name: 'TOM',   color: '#aa44ff', synth: 'tom'    },
        { id: 'rim',   name: 'RIM',   color: '#ff5544', synth: 'rim'    },
        { id: 'perc',  name: 'PERC',  color: '#ffe044', synth: 'perc'   },
    ];

    // Default params per voice: tune (semitones), decay (sec), vol (0-1)
    const DEFAULT_PARAMS = [
        { tune:  0, decay: 0.45, vol: 0.90 },
        { tune:  0, decay: 0.18, vol: 0.85 },
        { tune:  0, decay: 0.14, vol: 0.80 },
        { tune:  0, decay: 0.06, vol: 0.70 },
        { tune:  0, decay: 0.28, vol: 0.68 },
        { tune: -4, decay: 0.22, vol: 0.80 },
        { tune:  0, decay: 0.09, vol: 0.75 },
        { tune:  3, decay: 0.15, vol: 0.75 },
    ];

    // ── Runtime state ─────────────────────────────────────────
    // patterns[pat][voice][step] = { on, vel }  vel: 0=off 1=normal 2=accent
    const patterns = Array.from({ length: NUM_PATS }, () =>
        VOICES.map(() => Array.from({ length: NUM_STEPS }, () => ({ on: false, vel: 1 })))
    );
    const vp = DEFAULT_PARAMS.map(p => ({ ...p }));  // voice params (live)

    let curPat   = 0;
    let swing    = 0;   // 0–1
    let curStep  = -1;
    let _ctx, _bus;

    // DOM handle arrays
    let _stepBtns = []; // [vi][si] → <button>
    let _flashTmr = {};

    // ── Persistence ──────────────────────────────────────────
    function _load()  { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save()  {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({ patterns, vp, curPat, swing }));
        } catch (e) {}
    }

    // ── Synthesis ─────────────────────────────────────────────
    function _fire(vi, t) {
        const def = VOICES[vi];
        const p   = vp[vi];
        const out = _ctx.createGain();
        out.gain.value = p.vol;
        out.connect(_bus);
        switch (def.synth) {
            case 'kick':  _kick(out, p, t);  break;
            case 'snare': _snare(out, p, t); break;
            case 'clap':  _clap(out, p, t);  break;
            case 'hat_c': _hat(out, p, t, false); break;
            case 'hat_o': _hat(out, p, t, true);  break;
            case 'tom':   _tom(out, p, t);   break;
            case 'rim':   _rim(out, p, t);   break;
            case 'perc':  _perc(out, p, t);  break;
        }
    }

    function _semi(p) { return Math.pow(2, p.tune / 12); }

    function _kick(out, p, t) {
        const d  = p.decay;
        const f0 = 80 * _semi(p);
        // Pitched sweep
        const osc = _ctx.createOscillator();
        const g   = _ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 5, t);
        osc.frequency.exponentialRampToValueAtTime(f0, t + 0.045);
        g.gain.setValueAtTime(1.1, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        osc.connect(g).connect(out);
        osc.start(t); osc.stop(t + d + 0.02);
        // Click transient
        const ck = _ctx.createOscillator();
        const cg = _ctx.createGain();
        ck.type = 'square'; ck.frequency.value = f0 * 3.5;
        cg.gain.setValueAtTime(0.5, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
        ck.connect(cg).connect(out);
        ck.start(t); ck.stop(t + 0.025);
    }

    function _snare(out, p, t) {
        const d   = p.decay;
        const buf = _noiseBuffer(0.3);
        // Noise body
        const n   = _ctx.createBufferSource();
        n.buffer  = buf;
        const hp  = _ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
        const bp  = _ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4000; bp.Q.value = 0.8;
        const ng  = _ctx.createGain();
        ng.gain.setValueAtTime(0.85, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + d * 0.9);
        n.connect(hp).connect(bp).connect(ng).connect(out);
        n.start(t); n.stop(t + d + 0.05);
        // Tonal body
        const osc = _ctx.createOscillator();
        const og  = _ctx.createGain();
        const f   = 195 * _semi(p);
        osc.type  = 'triangle';
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.08);
        og.gain.setValueAtTime(0.65, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + d * 0.55);
        osc.connect(og).connect(out);
        osc.start(t); osc.stop(t + d);
    }

    function _clap(out, p, t) {
        const d   = p.decay;
        const buf = _noiseBuffer(0.5);
        [0, 0.011, 0.023].forEach(off => {
            const n  = _ctx.createBufferSource(); n.buffer = buf;
            const bp = _ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 * _semi(p); bp.Q.value = 0.7;
            const g  = _ctx.createGain();
            g.gain.setValueAtTime(0, t + off);
            g.gain.linearRampToValueAtTime(0.9, t + off + 0.003);
            g.gain.exponentialRampToValueAtTime(0.001, t + off + d);
            n.connect(bp).connect(g).connect(out);
            n.start(t + off); n.stop(t + off + d + 0.04);
        });
    }

    function _hat(out, p, t, open) {
        // Six-oscillator metallic hat model
        const RATIOS = [40, 55, 74, 98, 125, 165];
        const d   = open ? p.decay * 2.5 : p.decay * 0.55;
        const hp  = _ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
        const bp  = _ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 11000; bp.Q.value = 0.5;
        const g   = _ctx.createGain();
        g.gain.setValueAtTime(0.6, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        RATIOS.forEach(r => {
            const osc = _ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = r * 110 * _semi(p);
            osc.connect(hp);
            osc.start(t); osc.stop(t + d + 0.02);
        });
        hp.connect(bp).connect(g).connect(out);
    }

    function _tom(out, p, t) {
        const d   = p.decay;
        const f   = 110 * _semi(p);
        const osc = _ctx.createOscillator();
        const g   = _ctx.createGain();
        osc.type  = 'sine';
        osc.frequency.setValueAtTime(f * 2, t);
        osc.frequency.exponentialRampToValueAtTime(f, t + 0.055);
        g.gain.setValueAtTime(1.0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        osc.connect(g).connect(out);
        osc.start(t); osc.stop(t + d + 0.02);
    }

    function _rim(out, p, t) {
        const d   = p.decay;
        const f   = 1400 * _semi(p);
        const osc = _ctx.createOscillator();
        const g   = _ctx.createGain();
        osc.type  = 'square'; osc.frequency.value = f;
        g.gain.setValueAtTime(0.8, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        osc.connect(g).connect(out);
        osc.start(t); osc.stop(t + d + 0.01);
        // Short noise crack
        const n  = _ctx.createBufferSource(); n.buffer = _noiseBuffer(0.05);
        const bf = _ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 6000;
        const ng = _ctx.createGain();
        ng.gain.setValueAtTime(0.55, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + d * 0.4);
        n.connect(bf).connect(ng).connect(out);
        n.start(t); n.stop(t + 0.06);
    }

    function _perc(out, p, t) {
        const d   = p.decay;
        const f   = 700 * _semi(p);
        const osc = _ctx.createOscillator();
        const bp  = _ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 5;
        const g   = _ctx.createGain();
        osc.type  = 'triangle';
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.exponentialRampToValueAtTime(f * 0.3, t + d * 0.35);
        g.gain.setValueAtTime(1.0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        osc.connect(bp).connect(g).connect(out);
        osc.start(t); osc.stop(t + d + 0.02);
        // Transient click
        const n  = _ctx.createBufferSource(); n.buffer = _noiseBuffer(0.025);
        const ng = _ctx.createGain();
        ng.gain.setValueAtTime(0.5, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
        n.connect(ng).connect(out);
        n.start(t); n.stop(t + 0.03);
    }

    function _noiseBuffer(dur) {
        const len = Math.ceil(_ctx.sampleRate * dur);
        const buf = _ctx.createBuffer(1, len, _ctx.sampleRate);
        const d   = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    // ── Tick handler ─────────────────────────────────────────
    function _onTick(time, step16) {
        const bpm     = window.currentBPM || 120;
        const stepDur = 60 / bpm / 4;
        // Swing: delay odd 16ths
        const swingOff = (step16 % 2 === 1) ? swing * stepDur * 0.36 : 0;
        const t        = time + swingOff;

        const pat = patterns[curPat];
        VOICES.forEach((def, vi) => {
            const s = pat[vi][step16];
            if (!s.on) return;
            const p = { ...vp[vi] };
            if (s.vel === 2) p.vol = Math.min(1.0, p.vol * 1.35); // accent
            _fire(vi, t);
            _flashVoice(vi);
        });
        curStep = step16;
        _highlightStep(step16);
    }

    function _flashVoice(vi) {
        const lbl = document.querySelector('.mpc-vlbl[data-vi="' + vi + '"]');
        if (!lbl) return;
        lbl.style.color = VOICES[vi].color;
        clearTimeout(_flashTmr[vi]);
        _flashTmr[vi] = setTimeout(() => { lbl.style.color = ''; }, 70);
    }

    function _highlightStep(s) {
        _stepBtns.forEach(row => {
            row.forEach((btn, si) => btn.classList.toggle('mpc-active', si === s));
        });
    }

    // ── UI ────────────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx = ctx.audioCtx;
        _bus = ctx.bus;
        body.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 4px;min-width:660px;user-select:none;';

        // — Top controls row —
        const ctrl = _el('div', 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 2px;');
        ctrl.innerHTML =
            '<span class="mpc-lbl">PAT</span>' +
            '<button class="ss-card-btn mpc-pp">◀</button>' +
            '<span class="mpc-patnum" style="min-width:16px;text-align:center;color:#00f3ff;font-size:11px;">1</span>' +
            '<button class="ss-card-btn mpc-pn">▶</button>' +
            '<span class="mpc-lbl" style="margin-left:10px;">SWING</span>' +
            '<input type="range" class="mpc-sw" min="0" max="100" value="0" style="width:72px;accent-color:#ff88ff;">' +
            '<span class="mpc-swv" style="font-size:10px;color:#ff88ff;min-width:24px;">0%</span>' +
            '<button class="ss-card-btn mpc-clr" style="margin-left:auto;border-color:rgba(255,60,60,.4);color:rgba(255,100,100,.8);">CLR</button>';
        body.appendChild(ctrl);

        const patNum = ctrl.querySelector('.mpc-patnum');
        ctrl.querySelector('.mpc-pp').onclick = () => { curPat = (curPat - 1 + NUM_PATS) % NUM_PATS; patNum.textContent = curPat + 1; _renderPat(); };
        ctrl.querySelector('.mpc-pn').onclick = () => { curPat = (curPat + 1) % NUM_PATS; patNum.textContent = curPat + 1; _renderPat(); };
        ctrl.querySelector('.mpc-sw').oninput = function () { swing = +this.value / 100; ctrl.querySelector('.mpc-swv').textContent = this.value + '%'; _save(); };
        ctrl.querySelector('.mpc-clr').onclick = () => {
            patterns[curPat] = VOICES.map(() => Array.from({ length: NUM_STEPS }, () => ({ on: false, vel: 1 })));
            _renderPat(); _save();
        };

        // — Step number header —
        const hdr = _el('div', 'display:flex;gap:2px;padding-left:54px;');
        for (let s = 0; s < NUM_STEPS; s++) {
            const sp = _el('span', 'font-size:7px;width:26px;text-align:center;color:' + (s % 4 === 0 ? 'rgba(0,243,255,.65)' : 'rgba(0,243,255,.28)') + ';flex-shrink:0;');
            sp.textContent = s + 1;
            hdr.appendChild(sp);
        }
        body.appendChild(hdr);

        // — Voice rows —
        const grid = _el('div', 'display:flex;flex-direction:column;gap:3px;');
        _stepBtns = [];

        VOICES.forEach((def, vi) => {
            const row  = _el('div', 'display:flex;align-items:center;gap:2px;');
            // Voice trigger button
            const lbl  = _el('button', 'ss-card-btn mpc-vlbl', 'width:48px;font-size:8px;letter-spacing:1px;border-color:' + def.color + '55;flex-shrink:0;');
            lbl.dataset.vi   = vi;
            lbl.textContent  = def.name;
            lbl.onclick = () => { if (_ctx) _fire(vi, _ctx.currentTime + 0.01); };
            row.appendChild(lbl);

            const rowBtns = [];
            for (let s = 0; s < NUM_STEPS; s++) {
                const btn = _el('button', '', 'width:26px;height:22px;border:1px solid rgba(0,243,255,.15);background:rgba(0,0,0,.4);cursor:pointer;border-radius:2px;flex-shrink:0;transition:background .06s;');
                btn.dataset.vi   = vi;
                btn.dataset.step = s;
                btn.onclick = function () {
                    const cell = patterns[curPat][vi][s];
                    if (!cell.on)      { cell.on = true; cell.vel = 1; }
                    else if (cell.vel === 1) { cell.vel = 2; }
                    else               { cell.on = false; cell.vel = 1; }
                    _paintStep(btn, cell, def);
                    _save();
                    if (_ctx && cell.on) _fire(vi, _ctx.currentTime + 0.01);
                };
                row.appendChild(btn);
                rowBtns.push(btn);
            }
            _stepBtns.push(rowBtns);

            // Tune slider
            const tune = _sliderMini(-12, 12, vp[vi].tune, def.color, 48, 'T');
            tune.oninput = function () { vp[vi].tune = +this.value; _save(); };
            row.appendChild(tune);

            // Decay slider
            const decay = _sliderMini(2, 120, Math.round(vp[vi].decay * 100), def.color, 52, 'D');
            decay.oninput = function () { vp[vi].decay = +this.value / 100; _save(); };
            row.appendChild(decay);

            grid.appendChild(row);
        });
        body.appendChild(grid);

        _renderPat();
        _loadState();
    }

    function _paintStep(btn, cell, def) {
        if (!cell.on) {
            btn.style.background   = 'rgba(0,0,0,.4)';
            btn.style.borderColor  = 'rgba(0,243,255,.15)';
        } else if (cell.vel === 1) {
            btn.style.background   = def.color + '44';
            btn.style.borderColor  = def.color + '88';
        } else {
            btn.style.background   = def.color + 'bb';
            btn.style.borderColor  = def.color;
        }
    }

    function _renderPat() {
        const pat = patterns[curPat];
        _stepBtns.forEach((row, vi) => {
            row.forEach((btn, si) => _paintStep(btn, pat[vi][si], VOICES[vi]));
        });
    }

    function _loadState() {
        const d = _load();
        if (d.patterns) {
            d.patterns.forEach((pp, pi) => {
                if (pi >= NUM_PATS) return;
                pp.forEach((pv, vi) => {
                    if (vi >= NUM_VOICES) return;
                    pv.forEach((step, si) => { if (si < NUM_STEPS) patterns[pi][vi][si] = step; });
                });
            });
        }
        if (d.vp) d.vp.forEach((p, i) => { if (i < NUM_VOICES) Object.assign(vp[i], p); });
        if (d.curPat != null) curPat = d.curPat;
        if (d.swing  != null) swing  = d.swing;
        _renderPat();
        const pn = document.querySelector('.mpc-patnum');
        if (pn) pn.textContent = curPat + 1;
        const sw = document.querySelector('.mpc-sw');
        if (sw) { sw.value = Math.round(swing * 100); document.querySelector('.mpc-swv').textContent = sw.value + '%'; }
    }

    // ── Helpers ───────────────────────────────────────────────
    function _el(tag, cls, style) {
        const el = document.createElement(tag);
        if (cls && !style) { el.className = cls; }
        else if (cls)      { el.className = cls; el.style.cssText = style || ''; }
        else if (style)    { el.style.cssText = style; }
        return el;
    }
    function _sliderMini(min, max, val, color, w, title) {
        const inp = document.createElement('input');
        inp.type  = 'range'; inp.min = min; inp.max = max; inp.value = val;
        inp.title = title;
        inp.style.cssText = 'width:' + w + 'px;accent-color:' + color + ';flex-shrink:0;';
        return inp;
    }

    // ── Boot ─────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(function () {
                SonicSuite.registerCard('mpc', {
                    tag:    'D',
                    label:  '◈ MPC DRUMS',
                    onTick: _onTick,
                    onStop: function () { curStep = -1; _highlightStep(-1); },
                    mount:  _mount,
                });
            }, 180);
        }
        btn ? btn.addEventListener('click', _once) : setTimeout(_once, 600);
    });
})();
