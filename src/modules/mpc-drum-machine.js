// ═══════════════════════════════════════════════════════════════
// MPC DRUM MACHINE — 8-voice synthesized drum machine, 16-step
// Voices pre-rendered via OfflineAudioContext → AudioBuffer.
// Playback = 1 BufferSourceNode per hit.  8 GainNodes total (pre-alloc).
// Depends on: SonicSuite (global)
// Registers card id: 'mpc'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NUM_STEPS = 16;
    const NUM_PATS  = 8;
    const LS_KEY    = 'vngrd.mpc.v3';

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

    // Default params: tune (semitones), decay (s), vol (0–1)
    const DEFAULT_VP = [
        { tune:  0, decay: 0.55, vol: 0.85 },   // kick  — long decay
        { tune:  0, decay: 0.20, vol: 0.80 },   // snare
        { tune:  0, decay: 0.16, vol: 0.72 },   // clap
        { tune:  0, decay: 0.05, vol: 0.68 },   // closed hat — very short
        { tune:  0, decay: 0.32, vol: 0.60 },   // open hat
        { tune: -3, decay: 0.24, vol: 0.78 },   // tom
        { tune:  0, decay: 0.08, vol: 0.70 },   // rim
        { tune:  2, decay: 0.14, vol: 0.70 },   // perc
    ];

    // patterns[pat][voice][step] = { on, vel }  vel: 1=normal 2=accent
    const patterns = Array.from({ length: NUM_PATS }, function () {
        return VOICES.map(function () {
            return Array.from({ length: NUM_STEPS }, function () { return { on: false, vel: 1 }; });
        });
    });
    const vp = DEFAULT_VP.map(function (p) { return Object.assign({}, p); });

    let curPat  = 0;
    let swing   = 0;
    let curStep = -1;
    let _ctx, _bus;

    // Pre-rendered AudioBuffers — one per voice
    const _bufs = new Array(VOICES.length).fill(null);

    // Pre-allocated per-voice GainNodes — zero per-hit allocations
    const _gains = new Array(VOICES.length).fill(null);

    let _stepBtns = [];
    let _flashTmr = {};

    // ── Persistence ───────────────────────────────────────────
    function _load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ patterns, vp, curPat, swing })); } catch (e) {} }

    // ── Offline synthesis: pre-render voice → AudioBuffer ─────
    function _semi(p) { return Math.pow(2, (p.tune || 0) / 12); }

    function _renderBuf(vi) {
        var def  = VOICES[vi];
        var p    = vp[vi];
        var sr   = (_ctx && _ctx.sampleRate) || 44100;
        var dur  = _voiceDur(def.synth, p);
        var oc   = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);

        switch (def.synth) {
            case 'kick':  _buildKick (oc, p, sr); break;
            case 'snare': _buildSnare(oc, p, sr); break;
            case 'clap':  _buildClap (oc, p, sr); break;
            case 'hat_c': _buildHat  (oc, p, sr, false); break;
            case 'hat_o': _buildHat  (oc, p, sr, true);  break;
            case 'tom':   _buildTom  (oc, p);     break;
            case 'rim':   _buildRim  (oc, p, sr); break;
            case 'perc':  _buildPerc (oc, p, sr); break;
        }

        return oc.startRendering().then(function (buf) { _bufs[vi] = buf; });
    }

    function _voiceDur(synth, p) {
        switch (synth) {
            case 'kick':  return Math.max(0.6,  p.decay + 0.12);
            case 'hat_o': return Math.max(0.35, p.decay * 3.5 + 0.06);
            case 'clap':  return Math.max(0.2,  p.decay * 2.0 + 0.08);
            default:      return Math.max(0.15, p.decay * 2.2 + 0.06);
        }
    }

    // ── 808-style drum synthesis ──────────────────────────────

    // KICK: classic pitch sweep — starts high, falls to fundamental
    function _buildKick(oc, p, sr) {
        var out = oc.destination;
        var f0  = 52 * _semi(p);       // fundamental ~52 Hz
        var d   = p.decay;

        // Main body — sine sweep
        var osc = oc.createOscillator();
        var g   = oc.createGain();
        osc.type = 'sine';
        // Exponential sweep: attack freq → fundamental over ~65ms
        osc.frequency.setValueAtTime(f0 * 3.8, 0);
        osc.frequency.exponentialRampToValueAtTime(f0, 0.065);
        // Amp envelope: instant on, exponential off
        g.gain.setValueAtTime(0.88, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out);
        osc.start(0); osc.stop(d + 0.02);

        // Sub sine for low end
        var sub  = oc.createOscillator();
        var subG = oc.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(f0 * 0.5, 0);
        subG.gain.setValueAtTime(0.38, 0);
        subG.gain.exponentialRampToValueAtTime(0.001, d * 0.75);
        sub.connect(subG).connect(out);
        sub.start(0); sub.stop(d * 0.75 + 0.01);

        // Transient click (very short noise burst) — the "punch"
        var cLen = Math.ceil(sr * 0.006);
        var cBuf = oc.createBuffer(1, cLen, sr);
        var cd   = cBuf.getChannelData(0);
        for (var i = 0; i < cLen; i++) cd[i] = Math.random() * 2 - 1;
        var clk  = oc.createBufferSource(); clk.buffer = cBuf;
        var clkF = oc.createBiquadFilter(); clkF.type = 'bandpass'; clkF.frequency.value = 800; clkF.Q.value = 0.6;
        var clkG = oc.createGain();
        clkG.gain.setValueAtTime(0.22, 0);
        clkG.gain.exponentialRampToValueAtTime(0.001, 0.006);
        clk.connect(clkF).connect(clkG).connect(out);
        clk.start(0);
    }

    // SNARE: noise body + short pitched crack
    function _buildSnare(oc, p, sr) {
        var out = oc.destination;
        var d   = p.decay;

        // Noise component — the "snap"
        var nLen = Math.ceil(sr * (d + 0.04));
        var nBuf = oc.createBuffer(1, nLen, sr);
        var nd   = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var nSrc = oc.createBufferSource(); nSrc.buffer = nBuf;
        var hp   = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1600; hp.Q.value = 0.7;
        var nG   = oc.createGain();
        nG.gain.setValueAtTime(0.72, 0);
        nG.gain.exponentialRampToValueAtTime(0.001, d);
        nSrc.connect(hp).connect(nG).connect(out);
        nSrc.start(0);

        // Body tone — short pitched thud
        var osc  = oc.createOscillator();
        var oG   = oc.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200 * _semi(p), 0);
        osc.frequency.exponentialRampToValueAtTime(120 * _semi(p), 0.045);
        oG.gain.setValueAtTime(0.5, 0);
        oG.gain.exponentialRampToValueAtTime(0.001, d * 0.45);
        osc.connect(oG).connect(out);
        osc.start(0); osc.stop(d * 0.45 + 0.01);
    }

    // CLAP: 3 staggered noise bursts → reverb-like spread
    function _buildClap(oc, p, sr) {
        var out = oc.destination;
        var d   = p.decay;
        var nLen = Math.ceil(sr * (d + 0.06));

        [0, 0.009, 0.020].forEach(function (off) {
            var nBuf = oc.createBuffer(1, nLen, sr);
            var nd   = nBuf.getChannelData(0);
            for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
            var n    = oc.createBufferSource(); n.buffer = nBuf;
            var bp   = oc.createBiquadFilter(); bp.type = 'bandpass';
            bp.frequency.value = 1100 * _semi(p); bp.Q.value = 0.65;
            var g    = oc.createGain();
            g.gain.setValueAtTime(0, off);
            g.gain.linearRampToValueAtTime(0.70, off + 0.003);
            g.gain.exponentialRampToValueAtTime(0.001, off + d);
            n.connect(bp).connect(g).connect(out);
            n.start(off);
        });
    }

    // HI-HAT: 6 inharmonic square oscillators (TR-808 topology) + HP filter
    // All rendering is offline so CPU cost is zero at runtime.
    function _buildHat(oc, p, sr, open) {
        var out  = oc.destination;
        var d    = open ? p.decay * 3.5 : p.decay * 0.65;
        // TR-808 hi-hat frequency ratios (inharmonic = metallic)
        var BASE = 400 * _semi(p);
        var RATIOS = [1.000, 1.3027, 1.4337, 1.7727, 2.0122, 2.3981];

        var mix  = oc.createGain(); mix.gain.value = 1 / RATIOS.length;
        var hp   = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
        var bp   = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 9500; bp.Q.value = 0.5;
        var envG = oc.createGain();
        envG.gain.setValueAtTime(open ? 0.55 : 0.68, 0);
        envG.gain.exponentialRampToValueAtTime(0.0001, d);

        RATIOS.forEach(function (r) {
            var osc = oc.createOscillator();
            osc.type = 'square';
            osc.frequency.value = Math.min(BASE * r, sr * 0.45);
            osc.connect(mix);
            osc.start(0); osc.stop(d + 0.01);
        });

        mix.connect(hp).connect(bp).connect(envG).connect(out);
    }

    // TOM: pitched sine sweep, fuller low end
    function _buildTom(oc, p) {
        var out = oc.destination;
        var f0  = 100 * _semi(p);
        var d   = p.decay;
        var osc = oc.createOscillator();
        var g   = oc.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 2.2, 0);
        osc.frequency.exponentialRampToValueAtTime(f0, 0.055);
        g.gain.setValueAtTime(0.82, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out);
        osc.start(0); osc.stop(d + 0.01);
    }

    // RIM: bandpass noise crack + short square ping
    function _buildRim(oc, p, sr) {
        var out  = oc.destination;
        var d    = p.decay;
        var nLen = Math.ceil(sr * (d + 0.03));
        var nBuf = oc.createBuffer(1, nLen, sr);
        var nd   = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var n    = oc.createBufferSource(); n.buffer = nBuf;
        var bp   = oc.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = 4500 * _semi(p); bp.Q.value = 1.0;
        var nG   = oc.createGain();
        nG.gain.setValueAtTime(0.60, 0);
        nG.gain.exponentialRampToValueAtTime(0.001, d);
        n.connect(bp).connect(nG).connect(out);
        n.start(0);

        var osc  = oc.createOscillator();
        var oG   = oc.createGain();
        osc.type = 'square'; osc.frequency.value = 1600 * _semi(p);
        oG.gain.setValueAtTime(0.28, 0);
        oG.gain.exponentialRampToValueAtTime(0.001, d * 0.5);
        osc.connect(oG).connect(out);
        osc.start(0); osc.stop(d * 0.5 + 0.01);
    }

    // PERC: triangle with pitch drop, narrow bandpass
    function _buildPerc(oc, p, sr) {
        var out  = oc.destination;
        var f    = 700 * _semi(p);
        var d    = p.decay;

        var osc  = oc.createOscillator();
        var bp   = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3.5;
        var g    = oc.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, 0);
        osc.frequency.exponentialRampToValueAtTime(f * 0.25, d * 0.45);
        g.gain.setValueAtTime(0.75, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(bp).connect(g).connect(out);
        osc.start(0); osc.stop(d + 0.01);

        // Noise transient
        var tLen = Math.ceil((oc.sampleRate || sr) * 0.012);
        var tBuf = oc.createBuffer(1, tLen, oc.sampleRate || sr);
        var td   = tBuf.getChannelData(0);
        for (var i = 0; i < tLen; i++) td[i] = Math.random() * 2 - 1;
        var t    = oc.createBufferSource(); t.buffer = tBuf;
        var tG   = oc.createGain();
        tG.gain.setValueAtTime(0.38, 0);
        tG.gain.exponentialRampToValueAtTime(0.001, 0.012);
        t.connect(tG).connect(out);
        t.start(0);
    }

    function _renderAll() {
        return Promise.all(VOICES.map(function (def, vi) { return _renderBuf(vi); }));
    }

    // ── Playback — only 1 BufferSourceNode per hit ────────────
    function _fire(vi, t, isAccent) {
        if (!_bufs[vi] || !_gains[vi]) return;
        var vol = Math.min(1.0, vp[vi].vol * (isAccent ? 1.32 : 1.0));
        _gains[vi].gain.setValueAtTime(vol, t);   // instant ramp (scheduled)
        var src = _ctx.createBufferSource();
        src.buffer = _bufs[vi];
        src.connect(_gains[vi]);
        src.start(t);
        src.onended = function () { try { src.disconnect(); } catch (e) {} };
    }

    // ── Tick ─────────────────────────────────────────────────
    function _onTick(time, step16) {
        var bpm     = window.currentBPM || 120;
        var stepDur = 60 / bpm / 4;
        var swOff   = (step16 % 2 === 1) ? swing * stepDur * 0.33 : 0;
        var t       = time + swOff;
        var pat     = patterns[curPat];
        VOICES.forEach(function (def, vi) {
            var s = pat[vi][step16];
            if (s.on) { _fire(vi, t, s.vel === 2); _flashVoice(vi); }
        });
        curStep = step16;
        _highlightStep(step16);
    }

    function _flashVoice(vi) {
        var lbl = document.querySelector('.mpc-vlbl[data-vi="' + vi + '"]');
        if (!lbl) return;
        lbl.style.color = VOICES[vi].color;
        clearTimeout(_flashTmr[vi]);
        _flashTmr[vi] = setTimeout(function () { lbl.style.color = ''; }, 65);
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

        // Pre-allocate one GainNode per voice — never created at hit time
        VOICES.forEach(function (def, vi) {
            var g = _ctx.createGain();
            g.gain.value = vp[vi].vol;
            g.connect(_bus);
            _gains[vi] = g;
        });

        // Kick off all renders (async, off main thread)
        _renderAll();

        body.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 6px;user-select:none;';

        // — Top controls —
        var ctrl = _div('display:flex;align-items:center;gap:10px;flex-wrap:wrap;');
        ctrl.innerHTML =
            '<span class="mpc-lbl">PAT</span>' +
            '<button class="ss-card-btn mpc-pp">◀</button>' +
            '<span class="mpc-pnum" style="min-width:16px;text-align:center;color:#00f3ff;font-size:11px;">1</span>' +
            '<button class="ss-card-btn mpc-pn">▶</button>' +
            '<span class="mpc-lbl" style="margin-left:10px;">SWING</span>' +
            '<input type="range" class="mpc-sw" min="0" max="100" value="0" style="width:68px;accent-color:#ff88ff;">' +
            '<span class="mpc-swv" style="font-size:10px;color:#ff88ff;min-width:26px;">0%</span>' +
            '<button class="ss-card-btn mpc-clr" style="margin-left:auto;border-color:rgba(255,60,60,.4);color:rgba(255,100,100,.8);">CLR</button>';
        body.appendChild(ctrl);

        var pNum = ctrl.querySelector('.mpc-pnum');
        ctrl.querySelector('.mpc-pp').onclick = function () { curPat = (curPat - 1 + NUM_PATS) % NUM_PATS; pNum.textContent = curPat + 1; _renderPat(); };
        ctrl.querySelector('.mpc-pn').onclick = function () { curPat = (curPat + 1) % NUM_PATS; pNum.textContent = curPat + 1; _renderPat(); };
        ctrl.querySelector('.mpc-sw').oninput = function () {
            swing = +this.value / 100;
            ctrl.querySelector('.mpc-swv').textContent = this.value + '%';
            _save();
        };
        ctrl.querySelector('.mpc-clr').onclick = function () {
            patterns[curPat] = VOICES.map(function () {
                return Array.from({ length: NUM_STEPS }, function () { return { on: false, vel: 1 }; });
            });
            _renderPat(); _save();
        };

        // — Step number header —
        var hdr = _div('display:flex;gap:2px;padding-left:56px;');
        for (var s = 0; s < NUM_STEPS; s++) {
            var sp = document.createElement('span');
            sp.style.cssText = 'font-size:7px;width:26px;text-align:center;flex-shrink:0;color:' + (s % 4 === 0 ? 'rgba(0,243,255,.65)' : 'rgba(0,243,255,.28)') + ';';
            sp.textContent = s + 1;
            hdr.appendChild(sp);
        }
        body.appendChild(hdr);

        // — Voice rows —
        var grid = _div('display:flex;flex-direction:column;gap:3px;');
        _stepBtns = [];

        VOICES.forEach(function (def, vi) {
            var row = _div('display:flex;align-items:center;gap:2px;');

            var lbl = document.createElement('button');
            lbl.className = 'ss-card-btn mpc-vlbl';
            lbl.dataset.vi = vi;
            lbl.style.cssText = 'width:50px;font-size:8px;letter-spacing:1px;border-color:' + def.color + '55;flex-shrink:0;';
            lbl.textContent = def.name;
            lbl.onclick = (function (vi) { return function () { if (_ctx) _fire(vi, _ctx.currentTime + 0.01, false); }; }(vi));
            row.appendChild(lbl);

            var rowBtns = [];
            for (var s = 0; s < NUM_STEPS; s++) {
                var btn = document.createElement('button');
                btn.style.cssText = 'width:26px;height:22px;border:1px solid rgba(0,243,255,.15);background:rgba(0,0,0,.4);cursor:pointer;border-radius:2px;flex-shrink:0;';
                (function (vi, s, btn) {
                    btn.onclick = function () {
                        var cell = patterns[curPat][vi][s];
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

            // Tune slider
            var tune = _slider(-12, 12, vp[vi].tune, def.color, 46, 'Tune');
            tune.oninput = (function (vi) { return function () { vp[vi].tune = +this.value; _renderBuf(vi); _save(); }; }(vi));
            row.appendChild(tune);

            // Decay slider
            var decay = _slider(3, 150, Math.round(vp[vi].decay * 100), def.color, 50, 'Decay');
            decay.oninput = (function (vi) { return function () { vp[vi].decay = +this.value / 100; _renderBuf(vi); _save(); }; }(vi));
            row.appendChild(decay);

            grid.appendChild(row);
        });
        body.appendChild(grid);

        _renderPat();
        _loadState();
    }

    function _paintStep(btn, cell, def) {
        if (!cell.on)          { btn.style.background = 'rgba(0,0,0,.4)';    btn.style.borderColor = 'rgba(0,243,255,.15)'; }
        else if (cell.vel === 1) { btn.style.background = def.color + '44'; btn.style.borderColor = def.color + '88'; }
        else                   { btn.style.background = def.color + 'cc'; btn.style.borderColor = def.color; }
    }

    function _renderPat() {
        var pat = patterns[curPat];
        _stepBtns.forEach(function (row, vi) {
            row.forEach(function (btn, si) { _paintStep(btn, pat[vi][si], VOICES[vi]); });
        });
    }

    function _loadState() {
        var d = _load();
        if (d.patterns) {
            d.patterns.forEach(function (pp, pi) {
                if (pi >= NUM_PATS) return;
                pp.forEach(function (pv, vi) {
                    if (vi >= VOICES.length) return;
                    pv.forEach(function (step, si) { if (si < NUM_STEPS) patterns[pi][vi][si] = step; });
                });
            });
        }
        if (d.vp)    d.vp.forEach(function (p, i) { if (i < VOICES.length) Object.assign(vp[i], p); });
        if (d.curPat != null) curPat = d.curPat;
        if (d.swing  != null) swing  = d.swing;
        _renderPat();
        var pn = document.querySelector('.mpc-pnum');
        if (pn) pn.textContent = curPat + 1;
        var sw = document.querySelector('.mpc-sw');
        if (sw) { sw.value = Math.round(swing * 100); var sv = document.querySelector('.mpc-swv'); if (sv) sv.textContent = sw.value + '%'; }
        // Re-render with restored params
        _renderAll();
    }

    function _div(css) { var d = document.createElement('div'); d.style.cssText = css; return d; }
    function _slider(min, max, val, color, w, title) {
        var inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val;
        inp.title = title;
        inp.style.cssText = 'width:' + w + 'px;accent-color:' + color + ';flex-shrink:0;';
        return inp;
    }

    // ── Boot ─────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('vt-sonic-launch-btn');
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
