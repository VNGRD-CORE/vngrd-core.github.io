// ═══════════════════════════════════════════════════════════════
// MPC DRUM MACHINE — 8-voice synth drum machine, 16-step sequencer
// Each voice is pre-rendered once via OfflineAudioContext → AudioBuffer.
// Playback = 1 BufferSourceNode per hit (no GC pressure, zero lag).
// Depends on: SonicSuite (global)
// Registers card id: 'mpc'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NUM_VOICES = 8;
    const NUM_STEPS  = 16;
    const NUM_PATS   = 8;
    const LS_KEY     = 'vngrd.mpc.v2';

    const VOICES = [
        { id: 'kick',  name: 'KICK',  color: '#00f3ff', synth: 'kick'  },
        { id: 'snare', name: 'SNRE',  color: '#ff8800', synth: 'snare' },
        { id: 'clap',  name: 'CLAP',  color: '#ff44aa', synth: 'clap'  },
        { id: 'cht',   name: 'C.HT',  color: '#88ff44', synth: 'hat_c' },
        { id: 'oht',   name: 'O.HT',  color: '#44ffcc', synth: 'hat_o' },
        { id: 'tom',   name: 'TOM',   color: '#aa44ff', synth: 'tom'   },
        { id: 'rim',   name: 'RIM',   color: '#ff5544', synth: 'rim'   },
        { id: 'perc',  name: 'PERC',  color: '#ffe044', synth: 'perc'  },
    ];

    const DEFAULT_VP = [
        { tune:  0, decay: 0.42, vol: 0.82 },
        { tune:  0, decay: 0.18, vol: 0.78 },
        { tune:  0, decay: 0.14, vol: 0.72 },
        { tune:  0, decay: 0.06, vol: 0.65 },
        { tune:  0, decay: 0.30, vol: 0.60 },
        { tune: -4, decay: 0.22, vol: 0.75 },
        { tune:  0, decay: 0.09, vol: 0.70 },
        { tune:  3, decay: 0.15, vol: 0.70 },
    ];

    // patterns[pat][voice][step] = { on, vel }  vel: 1=normal 2=accent
    const patterns = Array.from({ length: NUM_PATS }, () =>
        VOICES.map(() => Array.from({ length: NUM_STEPS }, () => ({ on: false, vel: 1 })))
    );
    const vp = DEFAULT_VP.map(p => ({ ...p }));

    let curPat  = 0;
    let swing   = 0;
    let curStep = -1;
    let _ctx, _bus;

    // Pre-rendered buffers — one per voice
    const _bufs = new Array(NUM_VOICES).fill(null);

    // DOM refs
    let _stepBtns = [];
    let _flashTmr = {};

    // ── Persistence ───────────────────────────────────────────
    function _load()  { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save()  { try { localStorage.setItem(LS_KEY, JSON.stringify({ patterns, vp, curPat, swing })); } catch (e) {} }

    // ── Pre-render a single voice into an AudioBuffer ─────────
    // Uses OfflineAudioContext so rendering is instant + off main thread.
    function _renderBuf(vi) {
        const def = VOICES[vi];
        const p   = vp[vi];
        const sr  = _ctx ? _ctx.sampleRate : 44100;
        const dur = _voiceDur(def.synth, p);
        const oc  = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);

        switch (def.synth) {
            case 'kick':  _buildKick (oc, p); break;
            case 'snare': _buildSnare(oc, p); break;
            case 'clap':  _buildClap (oc, p); break;
            case 'hat_c': _buildHat  (oc, p, false); break;
            case 'hat_o': _buildHat  (oc, p, true);  break;
            case 'tom':   _buildTom  (oc, p); break;
            case 'rim':   _buildRim  (oc, p); break;
            case 'perc':  _buildPerc (oc, p); break;
        }

        return oc.startRendering().then(function (buf) {
            _bufs[vi] = buf;
        }).catch(function (e) { log && log('MPC render err ' + vi + ': ' + e); });
    }

    function _voiceDur(synth, p) {
        switch (synth) {
            case 'hat_o': return p.decay * 3.0 + 0.08;
            case 'kick':  return p.decay + 0.12;
            default:      return p.decay * 1.8 + 0.08;
        }
    }

    function _semi(p) { return Math.pow(2, (p.tune || 0) / 12); }

    // ── Offline synthesis builders ────────────────────────────
    function _buildKick(oc, p) {
        const d   = p.decay;
        const f0  = 72 * _semi(p);
        const out = oc.destination;

        const osc = oc.createOscillator();
        const g   = oc.createGain();
        osc.type  = 'sine';
        osc.frequency.setValueAtTime(f0 * 4.2, 0);
        osc.frequency.exponentialRampToValueAtTime(f0, 0.04);
        g.gain.setValueAtTime(0.9, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out);
        osc.start(0); osc.stop(d + 0.01);

        // Sub harmonic body
        const sub = oc.createOscillator();
        const sg  = oc.createGain();
        sub.type  = 'sine';
        sub.frequency.setValueAtTime(f0 * 0.5, 0);
        sg.gain.setValueAtTime(0.45, 0);
        sg.gain.exponentialRampToValueAtTime(0.001, d * 0.7);
        sub.connect(sg).connect(out);
        sub.start(0); sub.stop(d * 0.7 + 0.01);

        // Transient click
        const ck  = oc.createOscillator();
        const ckg = oc.createGain();
        ck.type   = 'square'; ck.frequency.value = f0 * 2.8;
        ckg.gain.setValueAtTime(0.22, 0);
        ckg.gain.exponentialRampToValueAtTime(0.001, 0.018);
        ck.connect(ckg).connect(out);
        ck.start(0); ck.stop(0.02);
    }

    function _buildSnare(oc, p) {
        const d   = p.decay;
        const sr  = oc.sampleRate;
        const out = oc.destination;

        // Noise body
        const len  = Math.ceil(sr * (d + 0.05));
        const nb   = oc.createBuffer(1, len, sr);
        const nd   = nb.getChannelData(0);
        for (let i = 0; i < len; i++) nd[i] = (Math.random() * 2 - 1);
        const n    = oc.createBufferSource(); n.buffer = nb;
        const hp   = oc.createBiquadFilter(); hp.type = 'highpass';  hp.frequency.value = 1800;
        const bp   = oc.createBiquadFilter(); bp.type = 'bandpass';  bp.frequency.value = 3800; bp.Q.value = 0.7;
        const ng   = oc.createGain();
        ng.gain.setValueAtTime(0.7, 0);
        ng.gain.exponentialRampToValueAtTime(0.001, d * 0.9);
        n.connect(hp).connect(bp).connect(ng).connect(out);
        n.start(0);

        // Tonal body
        const osc  = oc.createOscillator();
        const og   = oc.createGain();
        const f    = 185 * _semi(p);
        osc.type   = 'triangle';
        osc.frequency.setValueAtTime(f, 0);
        osc.frequency.exponentialRampToValueAtTime(f * 0.55, 0.07);
        og.gain.setValueAtTime(0.55, 0);
        og.gain.exponentialRampToValueAtTime(0.001, d * 0.5);
        osc.connect(og).connect(out);
        osc.start(0); osc.stop(d + 0.01);
    }

    function _buildClap(oc, p) {
        const d   = p.decay;
        const sr  = oc.sampleRate;
        const out = oc.destination;
        const len = Math.ceil(sr * (d + 0.06));

        // 3 noise bursts staggered = clap character
        [0, 0.009, 0.019].forEach(function (off) {
            const nb = oc.createBuffer(1, len, sr);
            const nd = nb.getChannelData(0);
            for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
            const n  = oc.createBufferSource(); n.buffer = nb;
            const bp = oc.createBiquadFilter(); bp.type = 'bandpass';
            bp.frequency.value = 1000 * _semi(p); bp.Q.value = 0.6;
            const g  = oc.createGain();
            g.gain.setValueAtTime(0, off);
            g.gain.linearRampToValueAtTime(0.75, off + 0.003);
            g.gain.exponentialRampToValueAtTime(0.001, off + d);
            n.connect(bp).connect(g).connect(out);
            n.start(off);
        });
    }

    function _buildHat(oc, p, open) {
        // White noise → HP → BP — much cheaper than 6 oscillators, sounds better
        const d   = open ? p.decay * 2.8 : p.decay * 0.5;
        const sr  = oc.sampleRate;
        const out = oc.destination;
        const len = Math.ceil(sr * (d + 0.04));
        const nb  = oc.createBuffer(1, len, sr);
        const nd  = nb.getChannelData(0);
        for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
        const n   = oc.createBufferSource(); n.buffer = nb;
        const hp  = oc.createBiquadFilter(); hp.type = 'highpass';  hp.frequency.value = 8000 * _semi(p);
        const bp  = oc.createBiquadFilter(); bp.type = 'bandpass';  bp.frequency.value = 10000; bp.Q.value = 0.4;
        const g   = oc.createGain();
        g.gain.setValueAtTime(open ? 0.5 : 0.6, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        n.connect(hp).connect(bp).connect(g).connect(out);
        n.start(0);
    }

    function _buildTom(oc, p) {
        const d   = p.decay;
        const f   = 105 * _semi(p);
        const out = oc.destination;
        const osc = oc.createOscillator();
        const g   = oc.createGain();
        osc.type  = 'sine';
        osc.frequency.setValueAtTime(f * 2.1, 0);
        osc.frequency.exponentialRampToValueAtTime(f, 0.05);
        g.gain.setValueAtTime(0.85, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out);
        osc.start(0); osc.stop(d + 0.01);
    }

    function _buildRim(oc, p) {
        const d   = p.decay;
        const sr  = oc.sampleRate;
        const out = oc.destination;
        // Thin noise crack
        const len = Math.ceil(sr * (d + 0.04));
        const nb  = oc.createBuffer(1, len, sr);
        const nd  = nb.getChannelData(0);
        for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
        const n   = oc.createBufferSource(); n.buffer = nb;
        const bp  = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5000 * _semi(p); bp.Q.value = 1.2;
        const g   = oc.createGain();
        g.gain.setValueAtTime(0.65, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        n.connect(bp).connect(g).connect(out);
        n.start(0);
        // Tonal ping
        const osc = oc.createOscillator();
        const og  = oc.createGain();
        osc.type  = 'square'; osc.frequency.value = 1200 * _semi(p);
        og.gain.setValueAtTime(0.35, 0);
        og.gain.exponentialRampToValueAtTime(0.001, d * 0.6);
        osc.connect(og).connect(out);
        osc.start(0); osc.stop(d * 0.6 + 0.01);
    }

    function _buildPerc(oc, p) {
        const d   = p.decay;
        const f   = 650 * _semi(p);
        const out = oc.destination;
        const osc = oc.createOscillator();
        const bp  = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4;
        const g   = oc.createGain();
        osc.type  = 'triangle';
        osc.frequency.setValueAtTime(f, 0);
        osc.frequency.exponentialRampToValueAtTime(f * 0.28, d * 0.4);
        g.gain.setValueAtTime(0.8, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(bp).connect(g).connect(out);
        osc.start(0); osc.stop(d + 0.01);
    }

    // ── Playback (1 node per hit) ─────────────────────────────
    function _fire(vi, t, isAccent) {
        if (!_bufs[vi] || !_ctx) return;
        const src = _ctx.createBufferSource();
        const g   = _ctx.createGain();
        src.buffer = _bufs[vi];
        g.gain.value = vp[vi].vol * (isAccent ? 1.35 : 1.0);
        g.gain.value = Math.min(1.0, g.gain.value);
        src.connect(g).connect(_bus);
        src.start(t);
        src.onended = function () { try { src.disconnect(); g.disconnect(); } catch (e) {} };
    }

    function _renderAllBufs() {
        return Promise.all(VOICES.map((_, vi) => _renderBuf(vi)));
    }

    // ── Tick handler ─────────────────────────────────────────
    function _onTick(time, step16) {
        const bpm     = window.currentBPM || 120;
        const stepDur = 60 / bpm / 4;
        const swingOff= (step16 % 2 === 1) ? swing * stepDur * 0.33 : 0;
        const t       = time + swingOff;
        const pat     = patterns[curPat];
        VOICES.forEach(function (def, vi) {
            const s = pat[vi][step16];
            if (s.on) { _fire(vi, t, s.vel === 2); _flashVoice(vi); }
        });
        curStep = step16;
        _highlightStep(step16);
    }

    function _flashVoice(vi) {
        const lbl = document.querySelector('.mpc-vlbl[data-vi="' + vi + '"]');
        if (!lbl) return;
        lbl.style.color = VOICES[vi].color;
        clearTimeout(_flashTmr[vi]);
        _flashTmr[vi] = setTimeout(function () { lbl.style.color = ''; }, 70);
    }

    function _highlightStep(s) {
        _stepBtns.forEach(function (row) {
            row.forEach(function (btn, si) { btn.classList.toggle('mpc-active', si === s); });
        });
    }

    // ── UI ────────────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx = ctx.audioCtx;
        _bus = ctx.bus;
        body.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 4px;min-width:660px;user-select:none;';

        // Render all buffers (async, happens fast in background)
        _renderAllBufs();

        // — Top controls —
        const ctrl = _div('display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 2px;');
        ctrl.innerHTML =
            '<span class="mpc-lbl">PAT</span>' +
            '<button class="ss-card-btn mpc-pp">◀</button>' +
            '<span class="mpc-patnum" style="min-width:16px;text-align:center;color:#00f3ff;font-size:11px;">1</span>' +
            '<button class="ss-card-btn mpc-pn">▶</button>' +
            '<span class="mpc-lbl" style="margin-left:10px;">SWING</span>' +
            '<input type="range" class="mpc-sw" min="0" max="100" value="0" style="width:72px;accent-color:#ff88ff;">' +
            '<span class="mpc-swv" style="font-size:10px;color:#ff88ff;min-width:26px;">0%</span>' +
            '<button class="ss-card-btn mpc-clr" style="margin-left:auto;border-color:rgba(255,60,60,.4);color:rgba(255,100,100,.8);">CLR</button>';
        body.appendChild(ctrl);

        const patNum = ctrl.querySelector('.mpc-patnum');
        ctrl.querySelector('.mpc-pp').onclick = function () { curPat = (curPat - 1 + NUM_PATS) % NUM_PATS; patNum.textContent = curPat + 1; _renderPat(); };
        ctrl.querySelector('.mpc-pn').onclick = function () { curPat = (curPat + 1) % NUM_PATS; patNum.textContent = curPat + 1; _renderPat(); };
        ctrl.querySelector('.mpc-sw').oninput = function () { swing = +this.value / 100; ctrl.querySelector('.mpc-swv').textContent = this.value + '%'; _save(); };
        ctrl.querySelector('.mpc-clr').onclick = function () {
            patterns[curPat] = VOICES.map(function () { return Array.from({ length: NUM_STEPS }, function () { return { on: false, vel: 1 }; }); });
            _renderPat(); _save();
        };

        // — Step number header —
        const hdr = _div('display:flex;gap:2px;padding-left:56px;');
        for (let s = 0; s < NUM_STEPS; s++) {
            const sp = document.createElement('span');
            sp.style.cssText = 'font-size:7px;width:26px;text-align:center;flex-shrink:0;color:' + (s % 4 === 0 ? 'rgba(0,243,255,.65)' : 'rgba(0,243,255,.28)') + ';';
            sp.textContent = s + 1;
            hdr.appendChild(sp);
        }
        body.appendChild(hdr);

        // — Voice rows —
        const grid = _div('display:flex;flex-direction:column;gap:3px;');
        _stepBtns = [];

        VOICES.forEach(function (def, vi) {
            const row = _div('display:flex;align-items:center;gap:2px;');

            // Voice label — click to audition
            const lbl = document.createElement('button');
            lbl.className = 'ss-card-btn mpc-vlbl';
            lbl.dataset.vi = vi;
            lbl.style.cssText = 'width:50px;font-size:8px;letter-spacing:1px;border-color:' + def.color + '55;flex-shrink:0;';
            lbl.textContent = def.name;
            lbl.onclick = function () { if (_ctx) _fire(vi, _ctx.currentTime + 0.01, false); };
            row.appendChild(lbl);

            // Step buttons
            const rowBtns = [];
            for (let s = 0; s < NUM_STEPS; s++) {
                const btn = document.createElement('button');
                btn.style.cssText = 'width:26px;height:22px;border:1px solid rgba(0,243,255,.15);background:rgba(0,0,0,.4);cursor:pointer;border-radius:2px;flex-shrink:0;';
                btn.dataset.vi = vi; btn.dataset.step = s;
                (function (vi, s, btn) {
                    btn.onclick = function () {
                        const cell = patterns[curPat][vi][s];
                        if (!cell.on)        { cell.on = true; cell.vel = 1; }
                        else if (cell.vel === 1) { cell.vel = 2; }
                        else                 { cell.on = false; cell.vel = 1; }
                        _paintStep(btn, cell, def);
                        _save();
                        if (_ctx && cell.on) _fire(vi, _ctx.currentTime + 0.01, cell.vel === 2);
                    };
                }(vi, s, btn));
                row.appendChild(btn);
                rowBtns.push(btn);
            }
            _stepBtns.push(rowBtns);

            // Tune
            const tune = _slider(-12, 12, vp[vi].tune, def.color, 48);
            tune.title = 'Tune';
            tune.oninput = function () { vp[vi].tune = +this.value; _renderBuf(vi); _save(); };
            row.appendChild(tune);

            // Decay
            const decay = _slider(3, 120, Math.round(vp[vi].decay * 100), def.color, 52);
            decay.title = 'Decay';
            decay.oninput = function () { vp[vi].decay = +this.value / 100; _renderBuf(vi); _save(); };
            row.appendChild(decay);

            grid.appendChild(row);
        });
        body.appendChild(grid);

        _renderPat();
        _loadState();
    }

    function _paintStep(btn, cell, def) {
        if (!cell.on)      { btn.style.background = 'rgba(0,0,0,.4)';    btn.style.borderColor = 'rgba(0,243,255,.15)'; }
        else if (cell.vel === 1) { btn.style.background = def.color + '44'; btn.style.borderColor = def.color + '88'; }
        else               { btn.style.background = def.color + 'bb'; btn.style.borderColor = def.color; }
    }

    function _renderPat() {
        const pat = patterns[curPat];
        _stepBtns.forEach(function (row, vi) {
            row.forEach(function (btn, si) { _paintStep(btn, pat[vi][si], VOICES[vi]); });
        });
    }

    function _loadState() {
        const d = _load();
        if (d.patterns) {
            d.patterns.forEach(function (pp, pi) {
                if (pi >= NUM_PATS) return;
                pp.forEach(function (pv, vi) {
                    if (vi >= NUM_VOICES) return;
                    pv.forEach(function (step, si) { if (si < NUM_STEPS) patterns[pi][vi][si] = step; });
                });
            });
        }
        if (d.vp)     d.vp.forEach(function (p, i) { if (i < NUM_VOICES) Object.assign(vp[i], p); });
        if (d.curPat != null) curPat = d.curPat;
        if (d.swing  != null) swing  = d.swing;
        _renderPat();
        const pn = document.querySelector('.mpc-patnum');
        if (pn) pn.textContent = curPat + 1;
        const sw = document.querySelector('.mpc-sw');
        if (sw) { sw.value = Math.round(swing * 100); const sv = document.querySelector('.mpc-swv'); if (sv) sv.textContent = sw.value + '%'; }
        // Re-render buffers with restored params
        _renderAllBufs();
    }

    function _div(css) { const d = document.createElement('div'); d.style.cssText = css; return d; }
    function _slider(min, max, val, color, w) {
        const inp = document.createElement('input');
        inp.type  = 'range'; inp.min = min; inp.max = max; inp.value = val;
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
