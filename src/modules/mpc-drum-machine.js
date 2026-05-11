// ═══════════════════════════════════════════════════════════════
// MPC DRUM MACHINE — 8-voice synthesized drum machine, 16-step
// Voices pre-rendered via OfflineAudioContext → AudioBuffer.
// Playback = 1 BufferSourceNode per hit. 8 GainNodes pre-alloc.
// Per-voice: mute, volume, tune, decay. Swing, 8 patterns.
// Depends on: SonicSuite (global)
// Registers card id: 'mpc'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NUM_STEPS = 16;
    const NUM_PATS  = 8;
    const LS_KEY    = 'vngrd.mpc.v4';

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
        { tune:  0, decay: 0.55, vol: 0.85, mute: false },  // kick
        { tune:  0, decay: 0.20, vol: 0.80, mute: false },  // snare
        { tune:  0, decay: 0.16, vol: 0.72, mute: false },  // clap
        { tune:  0, decay: 0.05, vol: 0.68, mute: false },  // closed hat
        { tune:  0, decay: 0.32, vol: 0.60, mute: false },  // open hat
        { tune: -3, decay: 0.24, vol: 0.78, mute: false },  // tom
        { tune:  0, decay: 0.08, vol: 0.70, mute: false },  // rim
        { tune:  2, decay: 0.14, vol: 0.70, mute: false },  // perc
    ];

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

    const _bufs  = new Array(VOICES.length).fill(null);
    const _gains = new Array(VOICES.length).fill(null);  // per-voice output gain
    let _stepBtns = [];
    let _flashTmr = {};

    // ── Persistence ───────────────────────────────────────────
    function _load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ patterns, vp, curPat, swing })); } catch (e) {} }

    // ── Offline synthesis ─────────────────────────────────────
    function _semi(p) { return Math.pow(2, (p.tune || 0) / 12); }

    function _renderBuf(vi) {
        var def = VOICES[vi], p = vp[vi];
        var sr  = (_ctx && _ctx.sampleRate) || 44100;
        var dur = _voiceDur(def.synth, p);
        var oc  = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
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

    // KICK: 808-style sine sweep
    function _buildKick(oc, p, sr) {
        var out = oc.destination, f0 = 52 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(), g = oc.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 3.8, 0);
        osc.frequency.exponentialRampToValueAtTime(f0, 0.065);
        g.gain.setValueAtTime(0.88, 0);
        g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out); osc.start(0); osc.stop(d + 0.02);

        var sub = oc.createOscillator(), subG = oc.createGain();
        sub.type = 'sine'; sub.frequency.setValueAtTime(f0 * 0.5, 0);
        subG.gain.setValueAtTime(0.38, 0);
        subG.gain.exponentialRampToValueAtTime(0.001, d * 0.75);
        sub.connect(subG).connect(out); sub.start(0); sub.stop(d * 0.75 + 0.01);

        var cLen = Math.ceil(sr * 0.006), cBuf = oc.createBuffer(1, cLen, sr);
        var cd = cBuf.getChannelData(0);
        for (var i = 0; i < cLen; i++) cd[i] = Math.random() * 2 - 1;
        var clk = oc.createBufferSource(); clk.buffer = cBuf;
        var clkF = oc.createBiquadFilter(); clkF.type = 'bandpass'; clkF.frequency.value = 800; clkF.Q.value = 0.6;
        var clkG = oc.createGain(); clkG.gain.setValueAtTime(0.22, 0); clkG.gain.exponentialRampToValueAtTime(0.001, 0.006);
        clk.connect(clkF).connect(clkG).connect(out); clk.start(0);
    }

    // SNARE: sine body + HP+LP noise snap
    function _buildSnare(oc, p, sr) {
        var out = oc.destination, d = p.decay;
        var nLen = Math.ceil(sr * (d + 0.04)), nBuf = oc.createBuffer(1, nLen, sr);
        var nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var nSrc = oc.createBufferSource(); nSrc.buffer = nBuf;
        var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; hp.Q.value = 0.7;
        var lp = oc.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 5500; lp.Q.value = 0.5;
        var nG = oc.createGain(); nG.gain.setValueAtTime(0.65, 0); nG.gain.exponentialRampToValueAtTime(0.001, d);
        nSrc.connect(hp).connect(lp).connect(nG).connect(out); nSrc.start(0);

        var osc = oc.createOscillator(), oG = oc.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200 * _semi(p), 0);
        osc.frequency.exponentialRampToValueAtTime(120 * _semi(p), 0.045);
        oG.gain.setValueAtTime(0.48, 0); oG.gain.exponentialRampToValueAtTime(0.001, d * 0.45);
        osc.connect(oG).connect(out); osc.start(0); osc.stop(d * 0.45 + 0.01);
    }

    // CLAP: 3 staggered noise bursts, soft attack, LP-smoothed
    function _buildClap(oc, p, sr) {
        var out = oc.destination, d = p.decay, nLen = Math.ceil(sr * (d + 0.06));
        [0, 0.009, 0.021].forEach(function (off) {
            var nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
            for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
            var n = oc.createBufferSource(); n.buffer = nBuf;
            var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 * _semi(p); bp.Q.value = 0.55;
            var lp = oc.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 5000;
            var g = oc.createGain();
            g.gain.setValueAtTime(0, off);
            g.gain.linearRampToValueAtTime(0.52, off + 0.006);
            g.gain.exponentialRampToValueAtTime(0.001, off + d);
            n.connect(bp).connect(lp).connect(g).connect(out); n.start(off);
        });
    }

    // HI-HAT: TR-808 topology — 6 inharmonic square oscs, HP+BP+LP chain
    function _buildHat(oc, p, sr, open) {
        var out = oc.destination;
        var d = open ? p.decay * 3.5 : p.decay * 0.65;
        var BASE = 400 * _semi(p);
        var RATIOS = [1.000, 1.3027, 1.4337, 1.7727, 2.0122, 2.3981];
        var mix  = oc.createGain(); mix.gain.value = 1 / RATIOS.length;
        var hp   = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
        var bp   = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 9500; bp.Q.value = 0.5;
        var lp   = oc.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 13000;
        var envG = oc.createGain();
        envG.gain.setValueAtTime(open ? 0.48 : 0.60, 0);
        envG.gain.exponentialRampToValueAtTime(0.0001, d);
        RATIOS.forEach(function (r) {
            var osc = oc.createOscillator(); osc.type = 'square';
            osc.frequency.value = Math.min(BASE * r, sr * 0.45);
            osc.connect(mix); osc.start(0); osc.stop(d + 0.01);
        });
        mix.connect(hp).connect(bp).connect(lp).connect(envG).connect(out);
    }

    // TOM: pitched sine sweep
    function _buildTom(oc, p) {
        var out = oc.destination, f0 = 100 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(), g = oc.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 2.2, 0); osc.frequency.exponentialRampToValueAtTime(f0, 0.055);
        g.gain.setValueAtTime(0.82, 0); g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out); osc.start(0); osc.stop(d + 0.01);
    }

    // RIM: BP noise + square ping
    function _buildRim(oc, p, sr) {
        var out = oc.destination, d = p.decay;
        var nLen = Math.ceil(sr * (d + 0.03)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var n = oc.createBufferSource(); n.buffer = nBuf;
        var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4500 * _semi(p); bp.Q.value = 1.0;
        var nG = oc.createGain(); nG.gain.setValueAtTime(0.58, 0); nG.gain.exponentialRampToValueAtTime(0.001, d);
        n.connect(bp).connect(nG).connect(out); n.start(0);
        var osc = oc.createOscillator(), oG = oc.createGain();
        osc.type = 'square'; osc.frequency.value = 1600 * _semi(p);
        oG.gain.setValueAtTime(0.26, 0); oG.gain.exponentialRampToValueAtTime(0.001, d * 0.5);
        osc.connect(oG).connect(out); osc.start(0); osc.stop(d * 0.5 + 0.01);
    }

    // PERC: triangle + BP + noise transient
    function _buildPerc(oc, p, sr) {
        var out = oc.destination, f = 700 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(), bp = oc.createBiquadFilter(), g = oc.createGain();
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3.5;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, 0); osc.frequency.exponentialRampToValueAtTime(f * 0.25, d * 0.45);
        g.gain.setValueAtTime(0.75, 0); g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(bp).connect(g).connect(out); osc.start(0); osc.stop(d + 0.01);
        var tLen = Math.ceil(sr * 0.012), tBuf = oc.createBuffer(1, tLen, sr), td = tBuf.getChannelData(0);
        for (var i = 0; i < tLen; i++) td[i] = Math.random() * 2 - 1;
        var t = oc.createBufferSource(); t.buffer = tBuf;
        var tG = oc.createGain(); tG.gain.setValueAtTime(0.35, 0); tG.gain.exponentialRampToValueAtTime(0.001, 0.012);
        t.connect(tG).connect(out); t.start(0);
    }

    function _renderAll() {
        return Promise.all(VOICES.map(function (def, vi) { return _renderBuf(vi); }));
    }

    // ── Playback ──────────────────────────────────────────────
    function _fire(vi, t, isAccent) {
        if (!_bufs[vi] || !_gains[vi] || vp[vi].mute) return;
        var vol = Math.min(1.0, vp[vi].vol * (isAccent ? 1.32 : 1.0));
        _gains[vi].gain.setValueAtTime(vol, t);
        var src = _ctx.createBufferSource();
        src.buffer = _bufs[vi];
        src.connect(_gains[vi]);
        src.start(t);
        src.onended = function () { try { src.disconnect(); } catch (e) {} };
    }

    // ── Tick ──────────────────────────────────────────────────
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

    // ── Helpers ───────────────────────────────────────────────
    function _div(css)  { var d = document.createElement('div'); d.style.cssText = css; return d; }
    function _slider(min, max, val, color, w, title) {
        var inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val;
        inp.title = title;
        inp.style.cssText = 'width:' + w + 'px;accent-color:' + color + ';flex-shrink:0;cursor:pointer;';
        return inp;
    }

    // ── Paint step button ─────────────────────────────────────
    function _paintStep(btn, cell, def) {
        if (!cell.on) {
            btn.style.background  = 'rgba(0,0,0,.45)';
            btn.style.borderColor = 'rgba(0,243,255,.12)';
        } else if (cell.vel === 1) {
            btn.style.background  = def.color + '40';
            btn.style.borderColor = def.color + '88';
        } else {
            btn.style.background  = def.color + 'cc';
            btn.style.borderColor = def.color;
        }
    }

    function _renderPat() {
        var pat = patterns[curPat];
        _stepBtns.forEach(function (row, vi) {
            row.forEach(function (btn, si) { _paintStep(btn, pat[vi][si], VOICES[vi]); });
        });
    }

    // ── UI Mount ──────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx = ctx.audioCtx;
        _bus = ctx.bus;

        VOICES.forEach(function (def, vi) {
            var g = _ctx.createGain();
            g.gain.value = vp[vi].vol;
            g.connect(_bus);
            _gains[vi] = g;
        });

        _renderAll();

        body.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:7px 7px;user-select:none;overflow:hidden;';

        // ── Top bar: pattern + swing ──────────────────────────
        var topBar = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:6px;border-bottom:1px solid rgba(0,243,255,.1);');

        var patLbl = document.createElement('span');
        patLbl.className = 'mpc-lbl';
        patLbl.textContent = 'PATTERN';
        topBar.appendChild(patLbl);

        var ppBtn = document.createElement('button');
        ppBtn.className = 'ss-card-btn'; ppBtn.textContent = '◀';
        var pnBtn = document.createElement('button');
        pnBtn.className = 'ss-card-btn'; pnBtn.textContent = '▶';
        var pNum = document.createElement('span');
        pNum.style.cssText = 'font-size:12px;color:#00f3ff;min-width:18px;text-align:center;font-weight:bold;';
        pNum.textContent = '1';
        ppBtn.onclick = function () { curPat = (curPat - 1 + NUM_PATS) % NUM_PATS; pNum.textContent = curPat + 1; _renderPat(); };
        pnBtn.onclick = function () { curPat = (curPat + 1) % NUM_PATS; pNum.textContent = curPat + 1; _renderPat(); };
        topBar.appendChild(ppBtn); topBar.appendChild(pNum); topBar.appendChild(pnBtn);

        var swLbl = document.createElement('span');
        swLbl.className = 'mpc-lbl';
        swLbl.style.marginLeft = '10px';
        swLbl.textContent = 'SWING';
        topBar.appendChild(swLbl);

        var swInp = _slider(0, 100, 0, '#ff88ff', 72, 'Swing');
        var swVal = document.createElement('span');
        swVal.style.cssText = 'font-size:9px;color:#ff88ff;min-width:28px;';
        swVal.textContent = '0%';
        swInp.oninput = function () { swing = +this.value / 100; swVal.textContent = this.value + '%'; _save(); };
        topBar.appendChild(swInp);
        topBar.appendChild(swVal);

        var clrBtn = document.createElement('button');
        clrBtn.className = 'ss-card-btn';
        clrBtn.style.cssText += 'margin-left:auto;border-color:rgba(255,60,60,.4);color:rgba(255,100,100,.8);';
        clrBtn.textContent = 'CLR PAT';
        clrBtn.onclick = function () {
            patterns[curPat] = VOICES.map(function () {
                return Array.from({ length: NUM_STEPS }, function () { return { on: false, vel: 1 }; });
            });
            _renderPat(); _save();
        };
        topBar.appendChild(clrBtn);
        body.appendChild(topBar);

        // ── Step number header ────────────────────────────────
        var hdr = _div('display:flex;gap:2px;padding-left:82px;align-items:center;');
        for (var s = 0; s < NUM_STEPS; s++) {
            var sp = document.createElement('span');
            sp.style.cssText = 'font-size:7px;width:24px;text-align:center;flex-shrink:0;' +
                (s % 4 === 0 ? 'color:rgba(0,243,255,.8);font-weight:600;' : 'color:rgba(0,243,255,.25);');
            sp.textContent = s + 1;
            hdr.appendChild(sp);
        }
        body.appendChild(hdr);

        // ── Voice rows ────────────────────────────────────────
        var grid = _div('display:flex;flex-direction:column;gap:3px;');
        _stepBtns = [];

        VOICES.forEach(function (def, vi) {
            var row = _div('display:flex;align-items:center;gap:2px;');

            // Mute button
            var muteBtn = document.createElement('button');
            muteBtn.className = 'ss-card-btn ic-mute';
            muteBtn.title = 'Mute ' + def.name;
            muteBtn.textContent = 'M';
            muteBtn.style.borderColor = 'rgba(255,80,80,.3)';
            muteBtn.onclick = (function (vi, muteBtn) {
                return function () {
                    vp[vi].mute = !vp[vi].mute;
                    muteBtn.classList.toggle('on', vp[vi].mute);
                    if (_gains[vi]) {
                        _gains[vi].gain.setTargetAtTime(vp[vi].mute ? 0 : vp[vi].vol, _ctx.currentTime, 0.01);
                    }
                    _save();
                };
            }(vi, muteBtn));
            row.appendChild(muteBtn);

            // Voice label / audition button
            var lbl = document.createElement('button');
            lbl.className = 'ss-card-btn mpc-vlbl';
            lbl.dataset.vi = vi;
            lbl.style.cssText = 'width:46px;font-size:7.5px;letter-spacing:1px;border-color:' + def.color + '55;flex-shrink:0;';
            lbl.textContent = def.name;
            lbl.onclick = (function (vi) {
                return function () { if (_ctx) _fire(vi, _ctx.currentTime + 0.01, false); };
            }(vi));
            row.appendChild(lbl);

            // Step buttons
            var rowBtns = [];
            for (var s = 0; s < NUM_STEPS; s++) {
                var btn = document.createElement('button');
                btn.style.cssText = 'width:24px;height:20px;border:1px solid rgba(0,243,255,.12);background:rgba(0,0,0,.45);cursor:pointer;border-radius:2px;flex-shrink:0;';
                if (s > 0 && s % 4 === 0) btn.classList.add('ic-beat-sep');
                (function (vi, s, btn) {
                    btn.onclick = function () {
                        var cell = patterns[curPat][vi][s];
                        if (!cell.on)            { cell.on = true; cell.vel = 1; }
                        else if (cell.vel === 1) { cell.vel = 2; }
                        else                     { cell.on = false; cell.vel = 1; }
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
            var tune = _slider(-12, 12, vp[vi].tune, def.color, 42, 'Tune');
            tune.oninput = (function (vi) {
                return function () { vp[vi].tune = +this.value; _renderBuf(vi); _save(); };
            }(vi));
            row.appendChild(tune);

            // Decay slider
            var decay = _slider(3, 150, Math.round(vp[vi].decay * 100), def.color, 42, 'Decay');
            decay.oninput = (function (vi) {
                return function () { vp[vi].decay = +this.value / 100; _renderBuf(vi); _save(); };
            }(vi));
            row.appendChild(decay);

            // Volume slider
            var vol = _slider(0, 100, Math.round(vp[vi].vol * 100), def.color, 38, 'Volume');
            vol.oninput = (function (vi) {
                return function () {
                    vp[vi].vol = +this.value / 100;
                    if (_gains[vi] && !vp[vi].mute) _gains[vi].gain.setTargetAtTime(vp[vi].vol, _ctx.currentTime, 0.01);
                    _save();
                };
            }(vi));
            row.appendChild(vol);

            grid.appendChild(row);
        });

        // ── Slider legend ─────────────────────────────────────
        var legend = _div('display:flex;gap:2px;padding-left:82px;');
        var legPad = _div('flex:1;');
        legend.appendChild(legPad);
        [['TNE', 42], ['DCY', 42], ['VOL', 38]].forEach(function (l) {
            var s = document.createElement('span');
            s.style.cssText = 'font-size:6px;color:rgba(0,243,255,.3);letter-spacing:1px;width:' + l[1] + 'px;text-align:center;flex-shrink:0;';
            s.textContent = l[0];
            legend.appendChild(s);
        });

        body.appendChild(grid);
        body.appendChild(legend);

        _renderPat();
        _loadState();
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
        if (d.vp) d.vp.forEach(function (p, i) { if (i < VOICES.length) Object.assign(vp[i], p); });
        if (d.curPat != null) curPat = d.curPat;
        if (d.swing  != null) swing  = d.swing;
        _renderPat();
        var pn = document.querySelector('.mpc-pnum');
        if (pn) pn.textContent = curPat + 1;
        var sw = document.querySelector('.mpc-sw');
        if (sw) { sw.value = Math.round(swing * 100); var sv = document.querySelector('.mpc-swv'); if (sv) sv.textContent = sw.value + '%'; }
        // Apply mute states to gains
        VOICES.forEach(function (def, vi) {
            if (_gains[vi] && vp[vi].mute) _gains[vi].gain.value = 0;
        });
        _renderAll();
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
