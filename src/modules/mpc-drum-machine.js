// ═══════════════════════════════════════════════════════════════
// VNGRD//BEAT FORGE — 4-kit drum machine, 16-step + live pad mode
// 4 kits: IRON-808 / CHROME-909 / TRAP-X / VAPOR
// Each kit: 8 voices, synthesized offline via OfflineAudioContext.
// Live pad mode: 16 velocity-sensitive pads (mouse + MIDI notes).
// MIDI: NoteOn 36-43 → pads 0-7 (ss-midi custom event).
// Depends on: SonicSuite (global)
// Registers card id: 'mpc'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NUM_STEPS = 16;
    const NUM_PATS  = 8;
    const LS_KEY    = 'vngrd.beatforge.v1';

    // ── Kit definitions ───────────────────────────────────────
    const KITS = [
        {
            id: 'iron808', name: 'IRON-808', color: '#00f3ff',
            voices: [
                { id: 'kick',  name: 'KICK',  synth: 'kick_808',  color: '#00f3ff' },
                { id: 'snare', name: 'SNRE',  synth: 'snare_808', color: '#ff8800' },
                { id: 'clap',  name: 'CLAP',  synth: 'clap',      color: '#ff44aa' },
                { id: 'cht',   name: 'C.HT',  synth: 'hat_c_808', color: '#88ff44' },
                { id: 'oht',   name: 'O.HT',  synth: 'hat_o_808', color: '#44ffcc' },
                { id: 'tom',   name: 'TOM',   synth: 'tom',       color: '#aa44ff' },
                { id: 'rim',   name: 'RIM',   synth: 'rim',       color: '#ff5544' },
                { id: 'perc',  name: 'PERC',  synth: 'perc',      color: '#ffe044' },
            ]
        },
        {
            id: 'chrome909', name: 'CHROME-909', color: '#ff8800',
            voices: [
                { id: 'kick',  name: 'KICK',  synth: 'kick_909',  color: '#ff8800' },
                { id: 'snare', name: 'SNRE',  synth: 'snare_909', color: '#00f3ff' },
                { id: 'clap',  name: 'CLAP',  synth: 'clap_909',  color: '#ff44aa' },
                { id: 'cht',   name: 'C.HT',  synth: 'hat_c_909', color: '#88ff44' },
                { id: 'oht',   name: 'O.HT',  synth: 'hat_o_909', color: '#44ffcc' },
                { id: 'tom',   name: 'TOM',   synth: 'tom_909',   color: '#aa44ff' },
                { id: 'ride',  name: 'RIDE',  synth: 'ride_909',  color: '#ff5544' },
                { id: 'crash', name: 'CRSH',  synth: 'crash',     color: '#ffe044' },
            ]
        },
        {
            id: 'trapx', name: 'TRAP-X', color: '#ff44aa',
            voices: [
                { id: 'kick',  name: 'KICK',  synth: 'kick_trap', color: '#ff44aa' },
                { id: 'snare', name: 'SNRE',  synth: 'snare_trap',color: '#ff8800' },
                { id: 'clap',  name: 'CLAP',  synth: 'clap',      color: '#88ff44' },
                { id: 'cht1',  name: 'HT1',   synth: 'hat_c_trap',color: '#00f3ff' },
                { id: 'cht2',  name: 'HT2',   synth: 'hat_roll',  color: '#44ffcc' },
                { id: 'oht',   name: 'O.HT',  synth: 'hat_o',     color: '#aa44ff' },
                { id: 'perc',  name: 'PERC',  synth: 'perc_trap', color: '#ff5544' },
                { id: 'sub',   name: '808S',  synth: 'sub_808',   color: '#ff44aa' },
            ]
        },
        {
            id: 'vapor', name: 'VAPOR', color: '#aa44ff',
            voices: [
                { id: 'kick',  name: 'KICK',  synth: 'kick_vapor',  color: '#aa44ff' },
                { id: 'snare', name: 'SNRE',  synth: 'snare_lush',  color: '#ff88ff' },
                { id: 'clap',  name: 'CLAP',  synth: 'clap',        color: '#ff44aa' },
                { id: 'cht',   name: 'C.HT',  synth: 'hat_c',       color: '#88ff44' },
                { id: 'oht',   name: 'O.HT',  synth: 'hat_o_vapor', color: '#44ffcc' },
                { id: 'shaker',name: 'SHKR',  synth: 'shaker',      color: '#ff8800' },
                { id: 'tom',   name: 'TOM',   synth: 'tom_vapor',   color: '#00f3ff' },
                { id: 'snap',  name: 'SNAP',  synth: 'snap',        color: '#ffe044' },
            ]
        },
    ];

    const DEFAULT_VP = [
        { tune:  0, decay: 0.55, vol: 0.88, mute: false },  // kick — louder
        { tune:  0, decay: 0.20, vol: 0.80, mute: false },  // snare
        { tune:  0, decay: 0.16, vol: 0.72, mute: false },  // clap
        { tune:  0, decay: 0.05, vol: 0.68, mute: false },  // closed hat
        { tune:  0, decay: 0.32, vol: 0.60, mute: false },  // open hat
        { tune: -3, decay: 0.24, vol: 0.78, mute: false },  // tom
        { tune:  0, decay: 0.08, vol: 0.70, mute: false },  // rim/ride
        { tune:  2, decay: 0.14, vol: 0.70, mute: false },  // perc/crash
    ];

    // patterns[kit][pat][voice][step]
    const allPatterns = KITS.map(function () {
        return Array.from({ length: NUM_PATS }, function () {
            return Array.from({ length: 8 }, function () {
                return Array.from({ length: NUM_STEPS }, function () { return { on: false, vel: 1 }; });
            });
        });
    });

    // per-kit, per-voice params
    const allVP = KITS.map(function () {
        return DEFAULT_VP.map(function (p) { return Object.assign({}, p); });
    });

    let curKit  = 0;
    let curPat  = 0;
    let swing   = 0;
    let curStep = -1;
    let liveMode = false;
    let _ctx, _bus;

    // [kit][voice] buffer + gain caches
    const _bufs  = KITS.map(function () { return new Array(8).fill(null); });
    const _gains = KITS.map(function () { return new Array(8).fill(null); });

    let _stepBtns = [];
    let _flashTmr = {};
    let _padEls   = [];

    // ── Persistence ────────────────────────────────────────────
    function _load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save() {
        try { localStorage.setItem(LS_KEY, JSON.stringify({ allPatterns, allVP, curKit, curPat, swing })); } catch (e) {}
    }

    // ── Synthesis helpers ──────────────────────────────────────
    function _semi(p) { return Math.pow(2, (p.tune || 0) / 12); }

    function _satCurve(amt, n) {
        n = n || 512;
        var c = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var x = (i * 2) / n - 1;
            c[i] = amt < 0.01 ? x : Math.tanh(x * (1 + amt * 4));
        }
        return c;
    }

    function _voiceDur(synth, p) {
        switch (synth) {
            case 'kick_808':  return Math.max(0.8,  p.decay + 0.25);
            case 'kick_909':  return Math.max(0.5,  p.decay + 0.15);
            case 'kick_trap': return Math.max(1.2,  p.decay + 0.4);
            case 'kick_vapor':return Math.max(0.6,  p.decay + 0.18);
            case 'sub_808':   return Math.max(1.5,  p.decay + 0.5);
            case 'hat_o':
            case 'hat_o_808':
            case 'hat_o_909':
            case 'hat_o_vapor': return Math.max(0.35, p.decay * 3.5 + 0.06);
            case 'crash':     return Math.max(1.2,  p.decay * 4 + 0.2);
            case 'ride_909':  return Math.max(0.8,  p.decay * 3 + 0.1);
            case 'clap':
            case 'clap_909':  return Math.max(0.2,  p.decay * 2.0 + 0.08);
            default:          return Math.max(0.15, p.decay * 2.2 + 0.06);
        }
    }

    // ──────────────────────────────────────────────────────────
    //  SYNTHESIZERS
    // ──────────────────────────────────────────────────────────

    // IRON-808 KICK — heavy sub, layered body, hard click transient
    function _buildKick808(oc, p, sr) {
        var out = oc.destination, f0 = 45 * _semi(p), d = p.decay;

        // Sub layer: sine sweep, very low fundamental
        var sub = oc.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(f0 * 6.5, 0);
        sub.frequency.exponentialRampToValueAtTime(f0, 0.07);
        sub.frequency.exponentialRampToValueAtTime(f0 * 0.6, d * 0.65);
        var subG = oc.createGain();
        subG.gain.setValueAtTime(0.98, 0);
        subG.gain.exponentialRampToValueAtTime(0.001, d + 0.1);
        var sat = oc.createWaveShaper(); sat.curve = _satCurve(0.45);
        sub.connect(sat).connect(subG).connect(out); sub.start(0); sub.stop(d + 0.15);

        // Body layer: faster sweep, adds punch
        var body = oc.createOscillator(); body.type = 'sine';
        body.frequency.setValueAtTime(f0 * 9, 0);
        body.frequency.exponentialRampToValueAtTime(f0 * 1.4, 0.04);
        var bodyG = oc.createGain();
        bodyG.gain.setValueAtTime(0.55, 0);
        bodyG.gain.exponentialRampToValueAtTime(0.001, d * 0.38);
        body.connect(bodyG).connect(out); body.start(0); body.stop(d * 0.4);

        // Click transient: short bandpassed noise
        var cLen = Math.ceil(sr * 0.009);
        var cBuf = oc.createBuffer(1, cLen, sr);
        var cd = cBuf.getChannelData(0);
        for (var i = 0; i < cLen; i++) cd[i] = Math.random() * 2 - 1;
        var clk = oc.createBufferSource(); clk.buffer = cBuf;
        var clkHP = oc.createBiquadFilter(); clkHP.type = 'highpass'; clkHP.frequency.value = 1500;
        var clkBP = oc.createBiquadFilter(); clkBP.type = 'bandpass'; clkBP.frequency.value = 4500; clkBP.Q.value = 0.4;
        var clkG = oc.createGain(); clkG.gain.setValueAtTime(0.4, 0); clkG.gain.exponentialRampToValueAtTime(0.001, 0.009);
        clk.connect(clkHP).connect(clkBP).connect(clkG).connect(out); clk.start(0);
    }

    // CHROME-909 KICK — harder, more attack, punchy mid
    function _buildKick909(oc, p, sr) {
        var out = oc.destination, f0 = 55 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 5.5, 0);
        osc.frequency.exponentialRampToValueAtTime(f0, 0.05);
        var g = oc.createGain();
        g.gain.setValueAtTime(0.92, 0); g.gain.exponentialRampToValueAtTime(0.001, d);
        var sat = oc.createWaveShaper(); sat.curve = _satCurve(0.25);
        osc.connect(sat).connect(g).connect(out); osc.start(0); osc.stop(d + 0.05);

        // Punchy mid click
        var osc2 = oc.createOscillator(); osc2.type = 'sine';
        osc2.frequency.setValueAtTime(200 * _semi(p), 0);
        osc2.frequency.exponentialRampToValueAtTime(100 * _semi(p), 0.035);
        var g2 = oc.createGain(); g2.gain.setValueAtTime(0.5, 0); g2.gain.exponentialRampToValueAtTime(0.001, d * 0.35);
        osc2.connect(g2).connect(out); osc2.start(0); osc2.stop(d * 0.4);

        // Clicky top
        var cLen = Math.ceil(sr * 0.006), cBuf = oc.createBuffer(1, cLen, sr), cdx = cBuf.getChannelData(0);
        for (var i = 0; i < cLen; i++) cdx[i] = Math.random() * 2 - 1;
        var clk = oc.createBufferSource(); clk.buffer = cBuf;
        var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6500; bp.Q.value = 0.5;
        var cg = oc.createGain(); cg.gain.setValueAtTime(0.32, 0); cg.gain.exponentialRampToValueAtTime(0.001, 0.006);
        clk.connect(bp).connect(cg).connect(out); clk.start(0);
    }

    // TRAP-X KICK — massive 808 sub, extreme pitch drop, long tail, heavy distortion
    function _buildKickTrap(oc, p, sr) {
        var out = oc.destination, f0 = 38 * _semi(p), d = Math.max(p.decay, 0.7);

        var sub = oc.createOscillator(); sub.type = 'sine';
        sub.frequency.setValueAtTime(f0 * 7, 0);
        sub.frequency.exponentialRampToValueAtTime(f0, 0.09);
        sub.frequency.exponentialRampToValueAtTime(f0 * 0.45, d * 0.82); // dramatic pitch drop
        var subG = oc.createGain();
        subG.gain.setValueAtTime(1.0, 0); subG.gain.exponentialRampToValueAtTime(0.001, d + 0.2);
        var sat = oc.createWaveShaper(); sat.curve = _satCurve(0.7); sat.oversample = '4x';
        sub.connect(sat).connect(subG).connect(out); sub.start(0); sub.stop(d + 0.3);

        // Attack body
        var body = oc.createOscillator(); body.type = 'sine';
        body.frequency.setValueAtTime(f0 * 10, 0); body.frequency.exponentialRampToValueAtTime(f0 * 2, 0.04);
        var bG = oc.createGain(); bG.gain.setValueAtTime(0.55, 0); bG.gain.exponentialRampToValueAtTime(0.001, d * 0.25);
        body.connect(bG).connect(out); body.start(0); body.stop(d * 0.3);
    }

    // VAPOR KICK — soft, lo-fi, dreamy
    function _buildKickVapor(oc, p, sr) {
        var out = oc.destination, f0 = 50 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 4.5, 0);
        osc.frequency.exponentialRampToValueAtTime(f0, 0.08);
        var g = oc.createGain(); g.gain.setValueAtTime(0.75, 0); g.gain.exponentialRampToValueAtTime(0.001, d);
        // Light LP for softness
        var lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120;
        osc.connect(lp).connect(g).connect(out); osc.start(0); osc.stop(d + 0.1);

        // Sub sine layer
        var sub = oc.createOscillator(); sub.type = 'sine'; sub.frequency.value = f0 * 0.5;
        var sG = oc.createGain(); sG.gain.setValueAtTime(0.38, 0); sG.gain.exponentialRampToValueAtTime(0.001, d * 0.8);
        sub.connect(sG).connect(out); sub.start(0); sub.stop(d * 0.85);
    }

    // 808 SNARE — punchy sine + filtered noise
    function _buildSnare808(oc, p, sr) {
        var out = oc.destination, d = p.decay;
        var nLen = Math.ceil(sr * (d + 0.04)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var nSrc = oc.createBufferSource(); nSrc.buffer = nBuf;
        var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; hp.Q.value = 0.6;
        var lp = oc.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 6000; lp.Q.value = 0.4;
        var nG = oc.createGain(); nG.gain.setValueAtTime(0.7, 0); nG.gain.exponentialRampToValueAtTime(0.001, d);
        nSrc.connect(hp).connect(lp).connect(nG).connect(out); nSrc.start(0);

        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(210 * _semi(p), 0); osc.frequency.exponentialRampToValueAtTime(120 * _semi(p), 0.05);
        var oG = oc.createGain(); oG.gain.setValueAtTime(0.55, 0); oG.gain.exponentialRampToValueAtTime(0.001, d * 0.42);
        osc.connect(oG).connect(out); osc.start(0); osc.stop(d * 0.45);
    }

    // 909 SNARE — crack/snap character, brighter noise
    function _buildSnare909(oc, p, sr) {
        var out = oc.destination, d = p.decay;
        var nLen = Math.ceil(sr * (d + 0.06)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var nSrc = oc.createBufferSource(); nSrc.buffer = nBuf;
        var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500; hp.Q.value = 0.8;
        var nG = oc.createGain(); nG.gain.setValueAtTime(0.65, 0); nG.gain.exponentialRampToValueAtTime(0.001, d * 0.8);
        nSrc.connect(hp).connect(nG).connect(out); nSrc.start(0);

        // Sharp sine body
        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(250 * _semi(p), 0); osc.frequency.exponentialRampToValueAtTime(160 * _semi(p), 0.03);
        var oG = oc.createGain(); oG.gain.setValueAtTime(0.45, 0); oG.gain.exponentialRampToValueAtTime(0.001, d * 0.3);
        osc.connect(oG).connect(out); osc.start(0); osc.stop(d * 0.35);

        // Extra crack transient
        var cLen = Math.ceil(sr * 0.004), cBuf = oc.createBuffer(1, cLen, sr), cd = cBuf.getChannelData(0);
        for (var i = 0; i < cLen; i++) cd[i] = Math.random() * 2 - 1;
        var clk = oc.createBufferSource(); clk.buffer = cBuf;
        var bp2 = oc.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 8000;
        var cG = oc.createGain(); cG.gain.setValueAtTime(0.5, 0); cG.gain.exponentialRampToValueAtTime(0.001, 0.004);
        clk.connect(bp2).connect(cG).connect(out); clk.start(0);
    }

    // TRAP SNARE — punchy, gated, no long ring
    function _buildSnareTrap(oc, p, sr) {
        var out = oc.destination, d = Math.min(p.decay, 0.18);
        // Tight layered noise
        var nLen = Math.ceil(sr * (d + 0.02)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var nSrc = oc.createBufferSource(); nSrc.buffer = nBuf;
        var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
        var nG = oc.createGain(); nG.gain.setValueAtTime(0.72, 0); nG.gain.exponentialRampToValueAtTime(0.001, d);
        nSrc.connect(hp).connect(nG).connect(out); nSrc.start(0);

        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(230 * _semi(p), 0); osc.frequency.exponentialRampToValueAtTime(160 * _semi(p), 0.025);
        var oG = oc.createGain(); oG.gain.setValueAtTime(0.62, 0); oG.gain.exponentialRampToValueAtTime(0.001, d * 0.35);
        osc.connect(oG).connect(out); osc.start(0); osc.stop(d * 0.4);
    }

    // LUSH SNARE — soft velvet, vapor style
    function _buildSnareLush(oc, p, sr) {
        var out = oc.destination, d = p.decay;
        var nLen = Math.ceil(sr * (d + 0.08)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var nSrc = oc.createBufferSource(); nSrc.buffer = nBuf;
        var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.5;
        var lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000;
        var nG = oc.createGain(); nG.gain.setValueAtTime(0.48, 0); nG.gain.exponentialRampToValueAtTime(0.001, d);
        nSrc.connect(bp).connect(lp).connect(nG).connect(out); nSrc.start(0);

        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(180 * _semi(p), 0); osc.frequency.exponentialRampToValueAtTime(110 * _semi(p), 0.06);
        var oG = oc.createGain(); oG.gain.setValueAtTime(0.4, 0); oG.gain.exponentialRampToValueAtTime(0.001, d * 0.5);
        osc.connect(oG).connect(out); osc.start(0); osc.stop(d * 0.55);
    }

    // CLAP — 3 staggered noise bursts (both regular and 909 variant)
    function _buildClap(oc, p, sr) {
        var out = oc.destination, d = p.decay;
        [0, 0.009, 0.022].forEach(function (off) {
            var nLen = Math.ceil(sr * (d + 0.06)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
            for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
            var n = oc.createBufferSource(); n.buffer = nBuf;
            var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 * _semi(p); bp.Q.value = 0.55;
            var lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
            var g = oc.createGain();
            g.gain.setValueAtTime(0, off);
            g.gain.linearRampToValueAtTime(0.52, off + 0.006);
            g.gain.exponentialRampToValueAtTime(0.001, off + d);
            n.connect(bp).connect(lp).connect(g).connect(out); n.start(off);
        });
    }

    function _buildClap909(oc, p, sr) {
        var out = oc.destination, d = p.decay;
        [0, 0.007, 0.018, 0.032].forEach(function (off) {
            var nLen = Math.ceil(sr * (d + 0.04)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
            for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
            var n = oc.createBufferSource(); n.buffer = nBuf;
            var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1600; hp.Q.value = 0.7;
            var g = oc.createGain();
            g.gain.setValueAtTime(0, off);
            g.gain.linearRampToValueAtTime(0.48, off + 0.005);
            g.gain.exponentialRampToValueAtTime(0.001, off + d);
            n.connect(hp).connect(g).connect(out); n.start(off);
        });
    }

    // TR-808/909 style hi-hat — 6 inharmonic oscillators
    function _buildHat(oc, p, sr, decay, baseHz) {
        var out = oc.destination;
        var BASE = (baseHz || 400) * _semi(p);
        var RATIOS = [1.000, 1.3027, 1.4337, 1.7727, 2.0122, 2.3981];
        var mix  = oc.createGain(); mix.gain.value = 1 / RATIOS.length;
        var hp   = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
        var bp   = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 9500; bp.Q.value = 0.5;
        var lp   = oc.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 13000;
        var envG = oc.createGain();
        envG.gain.setValueAtTime(0.65, 0); envG.gain.exponentialRampToValueAtTime(0.0001, decay);
        RATIOS.forEach(function (r) {
            var osc = oc.createOscillator(); osc.type = 'square';
            osc.frequency.value = Math.min(BASE * r, sr * 0.45);
            osc.connect(mix); osc.start(0); osc.stop(decay + 0.01);
        });
        mix.connect(hp).connect(bp).connect(lp).connect(envG).connect(out);
    }

    function _buildHatClosed808(oc, p, sr) { _buildHat(oc, p, sr, p.decay * 0.65, 400); }
    function _buildHatOpen808(oc, p, sr)   { _buildHat(oc, p, sr, p.decay * 3.5, 400); }
    function _buildHatClosed909(oc, p, sr) { _buildHat(oc, p, sr, p.decay * 0.55, 450); }
    function _buildHatOpen909(oc, p, sr)   { _buildHat(oc, p, sr, p.decay * 3.8, 450); }
    function _buildHatClosedVanilla(oc, p, sr) { _buildHat(oc, p, sr, p.decay * 0.5, 380); }
    function _buildHatOpenVanilla(oc, p, sr)   { _buildHat(oc, p, sr, p.decay * 3.0, 380); }

    // TRAP hat: very short, high-frequency shimmer
    function _buildHatTrap(oc, p, sr) {
        _buildHat(oc, p, sr, p.decay * 0.35, 520);
    }

    // HAT ROLL: rapid cluster of 3 closed hats
    function _buildHatRoll(oc, p, sr) {
        var d = p.decay * 0.3;
        [0, 0.018, 0.036].forEach(function (off) {
            var BASE = 480 * _semi(p);
            var RATIOS = [1.000, 1.3027, 1.4337, 1.7727, 2.0122, 2.3981];
            var mix = oc.createGain(); mix.gain.value = 1 / RATIOS.length;
            var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
            var envG = oc.createGain();
            envG.gain.setValueAtTime(0, off);
            envG.gain.setValueAtTime(0.45, off + 0.001);
            envG.gain.exponentialRampToValueAtTime(0.0001, off + d);
            RATIOS.forEach(function (r) {
                var osc = oc.createOscillator(); osc.type = 'square';
                osc.frequency.value = Math.min(BASE * r, sr * 0.45);
                osc.connect(mix); osc.start(off); osc.stop(off + d + 0.01);
            });
            mix.connect(hp).connect(envG).connect(oc.destination);
        });
    }

    // VAPOR open hat — soft shimmer, gentle decay
    function _buildHatOpenVapor(oc, p, sr) {
        var d = p.decay * 2.8;
        var BASE = 360 * _semi(p);
        var RATIOS = [1.000, 1.3027, 1.4337, 1.7727, 2.0122, 2.3981];
        var mix = oc.createGain(); mix.gain.value = 1 / RATIOS.length;
        var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5500;
        var lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 10000;
        var envG = oc.createGain(); envG.gain.setValueAtTime(0.4, 0); envG.gain.exponentialRampToValueAtTime(0.0001, d);
        RATIOS.forEach(function (r) {
            var osc = oc.createOscillator(); osc.type = 'square';
            osc.frequency.value = Math.min(BASE * r, sr * 0.45);
            osc.connect(mix); osc.start(0); osc.stop(d + 0.01);
        });
        mix.connect(hp).connect(lp).connect(envG).connect(oc.destination);
    }

    // TOM (standard)
    function _buildTom(oc, p) {
        var out = oc.destination, f0 = 100 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 2.2, 0); osc.frequency.exponentialRampToValueAtTime(f0, 0.055);
        var g = oc.createGain(); g.gain.setValueAtTime(0.82, 0); g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out); osc.start(0); osc.stop(d + 0.01);
    }

    // 909 TOM — brighter, more attack
    function _buildTom909(oc, p) {
        var out = oc.destination, f0 = 130 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 3, 0); osc.frequency.exponentialRampToValueAtTime(f0, 0.04);
        var g = oc.createGain(); g.gain.setValueAtTime(0.88, 0); g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out); osc.start(0); osc.stop(d + 0.01);
    }

    // VAPOR TOM — pitched down, soft, reverby
    function _buildTomVapor(oc, p) {
        var out = oc.destination, f0 = 75 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 2.5, 0); osc.frequency.exponentialRampToValueAtTime(f0, 0.08);
        var g = oc.createGain(); g.gain.setValueAtTime(0.65, 0); g.gain.exponentialRampToValueAtTime(0.001, d + 0.05);
        osc.connect(g).connect(out); osc.start(0); osc.stop(d + 0.06);
    }

    // RIM
    function _buildRim(oc, p, sr) {
        var out = oc.destination, d = p.decay;
        var nLen = Math.ceil(sr * (d + 0.03)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var n = oc.createBufferSource(); n.buffer = nBuf;
        var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4500 * _semi(p); bp.Q.value = 1.0;
        var nG = oc.createGain(); nG.gain.setValueAtTime(0.58, 0); nG.gain.exponentialRampToValueAtTime(0.001, d);
        n.connect(bp).connect(nG).connect(out); n.start(0);
        var osc = oc.createOscillator(); osc.type = 'square'; osc.frequency.value = 1600 * _semi(p);
        var oG = oc.createGain(); oG.gain.setValueAtTime(0.26, 0); oG.gain.exponentialRampToValueAtTime(0.001, d * 0.5);
        osc.connect(oG).connect(out); osc.start(0); osc.stop(d * 0.5 + 0.01);
    }

    // PERC
    function _buildPerc(oc, p, sr) {
        var out = oc.destination, f = 700 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(); osc.type = 'triangle';
        var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3.5;
        osc.frequency.setValueAtTime(f, 0); osc.frequency.exponentialRampToValueAtTime(f * 0.25, d * 0.45);
        var g = oc.createGain(); g.gain.setValueAtTime(0.75, 0); g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(bp).connect(g).connect(out); osc.start(0); osc.stop(d + 0.01);
        var tLen = Math.ceil(sr * 0.012), tBuf = oc.createBuffer(1, tLen, sr), td = tBuf.getChannelData(0);
        for (var i = 0; i < tLen; i++) td[i] = Math.random() * 2 - 1;
        var t = oc.createBufferSource(); t.buffer = tBuf;
        var tG = oc.createGain(); tG.gain.setValueAtTime(0.35, 0); tG.gain.exponentialRampToValueAtTime(0.001, 0.012);
        t.connect(tG).connect(out); t.start(0);
    }

    // TRAP PERC — tonal 808-style tonal percussion
    function _buildPercTrap(oc, p, sr) {
        var out = oc.destination, f0 = 180 * _semi(p), d = p.decay;
        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 2.5, 0); osc.frequency.exponentialRampToValueAtTime(f0, 0.04);
        var g = oc.createGain(); g.gain.setValueAtTime(0.72, 0); g.gain.exponentialRampToValueAtTime(0.001, d);
        osc.connect(g).connect(out); osc.start(0); osc.stop(d + 0.01);
    }

    // 808 SUB — pure sub tone, long pitch-dropper for trap
    function _buildSub808(oc, p, sr) {
        var out = oc.destination, f0 = 40 * _semi(p), d = Math.max(p.decay, 0.9);
        var osc = oc.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(f0 * 5, 0);
        osc.frequency.exponentialRampToValueAtTime(f0, 0.12);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.3, d * 0.85);
        var sat = oc.createWaveShaper(); sat.curve = _satCurve(0.6); sat.oversample = '4x';
        var g = oc.createGain(); g.gain.setValueAtTime(0.95, 0); g.gain.exponentialRampToValueAtTime(0.001, d + 0.15);
        osc.connect(sat).connect(g).connect(out); osc.start(0); osc.stop(d + 0.2);
    }

    // 909 RIDE — longer metallic ring
    function _buildRide909(oc, p, sr) {
        var d = p.decay * 3.0, BASE = 420 * _semi(p);
        var RATIOS = [1.000, 1.3027, 1.4337, 1.7727, 2.5122, 3.1981];
        var mix = oc.createGain(); mix.gain.value = 1 / RATIOS.length;
        var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5500;
        var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 8000; bp.Q.value = 0.3;
        var envG = oc.createGain(); envG.gain.setValueAtTime(0.5, 0); envG.gain.exponentialRampToValueAtTime(0.0001, d);
        RATIOS.forEach(function (r) {
            var osc = oc.createOscillator(); osc.type = 'square';
            osc.frequency.value = Math.min(BASE * r, sr * 0.45);
            osc.connect(mix); osc.start(0); osc.stop(d + 0.01);
        });
        mix.connect(hp).connect(bp).connect(envG).connect(oc.destination);
    }

    // CRASH — long metallic wash
    function _buildCrash(oc, p, sr) {
        var d = p.decay * 4.0, BASE = 300 * _semi(p);
        var RATIOS = [1.000, 1.3027, 1.4337, 1.7727, 2.0122, 2.3981, 3.1, 3.7];
        var mix = oc.createGain(); mix.gain.value = 0.5 / RATIOS.length;
        var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
        var envG = oc.createGain(); envG.gain.setValueAtTime(0.7, 0); envG.gain.exponentialRampToValueAtTime(0.0001, d);
        RATIOS.forEach(function (r) {
            var osc = oc.createOscillator(); osc.type = 'sawtooth';
            osc.frequency.value = Math.min(BASE * r, sr * 0.45);
            osc.connect(mix); osc.start(0); osc.stop(d + 0.01);
        });
        mix.connect(hp).connect(envG).connect(oc.destination);
    }

    // SHAKER
    function _buildShaker(oc, p, sr) {
        var d = p.decay, nLen = Math.ceil(sr * (d + 0.02)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var n = oc.createBufferSource(); n.buffer = nBuf;
        var hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
        var lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 11000;
        var envG = oc.createGain(); envG.gain.setValueAtTime(0.55, 0); envG.gain.exponentialRampToValueAtTime(0.001, d);
        n.connect(hp).connect(lp).connect(envG).connect(oc.destination); n.start(0);
    }

    // SNAP — finger snap
    function _buildSnap(oc, p, sr) {
        var d = p.decay, nLen = Math.ceil(sr * (d + 0.01)), nBuf = oc.createBuffer(1, nLen, sr), nd = nBuf.getChannelData(0);
        for (var i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
        var n = oc.createBufferSource(); n.buffer = nBuf;
        var bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2800 * _semi(p); bp.Q.value = 2.0;
        var envG = oc.createGain(); envG.gain.setValueAtTime(0.65, 0); envG.gain.exponentialRampToValueAtTime(0.001, d);
        n.connect(bp).connect(envG).connect(oc.destination); n.start(0);
    }

    // ── Render dispatcher ──────────────────────────────────────
    function _buildVoice(oc, synth, p, sr) {
        switch (synth) {
            case 'kick_808':   _buildKick808(oc, p, sr);   break;
            case 'kick_909':   _buildKick909(oc, p, sr);   break;
            case 'kick_trap':  _buildKickTrap(oc, p, sr);  break;
            case 'kick_vapor': _buildKickVapor(oc, p, sr); break;
            case 'snare_808':  _buildSnare808(oc, p, sr);  break;
            case 'snare_909':  _buildSnare909(oc, p, sr);  break;
            case 'snare_trap': _buildSnareTrap(oc, p, sr); break;
            case 'snare_lush': _buildSnareLush(oc, p, sr); break;
            case 'clap':       _buildClap(oc, p, sr);      break;
            case 'clap_909':   _buildClap909(oc, p, sr);   break;
            case 'hat_c_808':  _buildHatClosed808(oc, p, sr); break;
            case 'hat_o_808':  _buildHatOpen808(oc, p, sr);   break;
            case 'hat_c_909':  _buildHatClosed909(oc, p, sr); break;
            case 'hat_o_909':  _buildHatOpen909(oc, p, sr);   break;
            case 'hat_c':      _buildHatClosedVanilla(oc, p, sr); break;
            case 'hat_o':      _buildHatOpenVanilla(oc, p, sr);   break;
            case 'hat_c_trap': _buildHatTrap(oc, p, sr);    break;
            case 'hat_roll':   _buildHatRoll(oc, p, sr);    break;
            case 'hat_o_vapor':_buildHatOpenVapor(oc, p, sr); break;
            case 'tom':        _buildTom(oc, p);            break;
            case 'tom_909':    _buildTom909(oc, p);         break;
            case 'tom_vapor':  _buildTomVapor(oc, p);       break;
            case 'rim':        _buildRim(oc, p, sr);        break;
            case 'perc':       _buildPerc(oc, p, sr);       break;
            case 'perc_trap':  _buildPercTrap(oc, p, sr);   break;
            case 'sub_808':    _buildSub808(oc, p, sr);     break;
            case 'ride_909':   _buildRide909(oc, p, sr);    break;
            case 'crash':      _buildCrash(oc, p, sr);      break;
            case 'shaker':     _buildShaker(oc, p, sr);     break;
            case 'snap':       _buildSnap(oc, p, sr);       break;
        }
    }

    function _renderBuf(ki, vi) {
        var kit = KITS[ki], def = kit.voices[vi], vp = allVP[ki][vi];
        var sr  = (_ctx && _ctx.sampleRate) || 44100;
        var dur = _voiceDur(def.synth, vp);
        var oc  = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
        _buildVoice(oc, def.synth, vp, sr);
        return oc.startRendering().then(function (buf) { _bufs[ki][vi] = buf; });
    }

    function _renderKit(ki) {
        return Promise.all(KITS[ki].voices.map(function (def, vi) { return _renderBuf(ki, vi); }));
    }

    function _renderAll() {
        return Promise.all(KITS.map(function (kit, ki) { return _renderKit(ki); }));
    }

    // ── Playback ───────────────────────────────────────────────
    function _fire(ki, vi, t, isAccent) {
        if (!_bufs[ki][vi] || !_gains[ki][vi]) return;
        var vp = allVP[ki][vi];
        if (vp.mute) return;
        var vol = Math.min(1.0, vp.vol * (isAccent ? 1.28 : 1.0));
        _gains[ki][vi].gain.setValueAtTime(vol, t);
        var src = _ctx.createBufferSource();
        src.buffer = _bufs[ki][vi];
        src.connect(_gains[ki][vi]);
        src.start(t);
        src.onended = function () { try { src.disconnect(); } catch (e) {} };
    }

    // ── Tick ──────────────────────────────────────────────────
    function _onTick(time, step16) {
        var bpm = window.currentBPM || 120;
        var stepDur = 60 / bpm / 4;
        var swOff = (step16 % 2 === 1) ? swing * stepDur * 0.33 : 0;
        var t = time + swOff;
        var pat = allPatterns[curKit][curPat];
        KITS[curKit].voices.forEach(function (def, vi) {
            var s = pat[vi][step16];
            if (s.on) { _fire(curKit, vi, t, s.vel === 2); _flashPad(vi); }
        });
        curStep = step16;
        _highlightStep(step16);
    }

    function _flashPad(vi) {
        // Flash both the row label and the live pad
        var lbl = document.querySelector('.bf-vlbl[data-vi="' + vi + '"]');
        if (lbl) { lbl.style.color = KITS[curKit].voices[vi].color; clearTimeout(_flashTmr[vi]); _flashTmr[vi] = setTimeout(function () { lbl.style.color = ''; }, 65); }
        var pad = _padEls[vi];
        if (pad) { pad.classList.add('bf-pad-flash'); setTimeout(function () { pad.classList.remove('bf-pad-flash'); }, 80); }
    }

    function _highlightStep(s) {
        if (liveMode) return;
        _stepBtns.forEach(function (row) {
            row.forEach(function (btn, si) { btn.classList.toggle('mpc-active', si === s); });
        });
    }

    // ── DOM helpers ────────────────────────────────────────────
    function _div(css)  { var d = document.createElement('div'); d.style.cssText = css; return d; }
    function _slider(min, max, val, color, w, title) {
        var inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val; inp.title = title;
        inp.style.cssText = 'width:' + w + 'px;accent-color:' + color + ';flex-shrink:0;cursor:pointer;';
        return inp;
    }

    function _paintStep(btn, cell, def) {
        if (!cell.on) { btn.style.background = 'rgba(0,0,0,.45)'; btn.style.borderColor = 'rgba(0,243,255,.12)'; }
        else if (cell.vel === 1) { btn.style.background = def.color + '40'; btn.style.borderColor = def.color + '88'; }
        else { btn.style.background = def.color + 'cc'; btn.style.borderColor = def.color; }
    }

    function _renderPat() {
        var pat = allPatterns[curKit][curPat];
        _stepBtns.forEach(function (row, vi) {
            row.forEach(function (btn, si) { _paintStep(btn, pat[vi][si], KITS[curKit].voices[vi]); });
        });
    }

    // ── UI Mount ───────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx = ctx.audioCtx;
        _bus = ctx.bus;

        // Init gain nodes for all kits
        KITS.forEach(function (kit, ki) {
            kit.voices.forEach(function (def, vi) {
                var g = _ctx.createGain();
                g.gain.value = allVP[ki][vi].vol;
                g.connect(_bus);
                _gains[ki][vi] = g;
            });
        });

        _renderAll();

        body.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:7px;user-select:none;overflow:hidden;';

        // ── Kit selector ──────────────────────────────────────
        var kitBar = _div('display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-bottom:6px;border-bottom:1px solid rgba(0,243,255,.12);');
        var kitLbl = document.createElement('span'); kitLbl.className = 'mpc-lbl'; kitLbl.textContent = 'KIT';
        kitBar.appendChild(kitLbl);

        var kitBtns = [];
        KITS.forEach(function (kit, ki) {
            var btn = document.createElement('button');
            btn.className = 'ss-card-btn';
            btn.textContent = kit.name;
            btn.style.cssText = 'font-size:9px;letter-spacing:1px;border-color:' + kit.color + '55;color:' + kit.color + '88;';
            btn.onclick = function () {
                curKit = ki;
                kitBtns.forEach(function (b, i) {
                    b.classList.toggle('playing', i === ki);
                    b.style.color = i === ki ? KITS[i].color : KITS[i].color + '88';
                });
                _rebuildVoiceRows(grid, vp);
                _renderPat();
            };
            kitBar.appendChild(btn);
            kitBtns.push(btn);
        });
        kitBtns[0].classList.add('playing');

        // Mode toggle: GRID vs PADS
        var modeLbl = document.createElement('span'); modeLbl.className = 'mpc-lbl'; modeLbl.style.marginLeft = '6px'; modeLbl.textContent = 'MODE';
        kitBar.appendChild(modeLbl);
        var modeBtn = document.createElement('button');
        modeBtn.className = 'ss-card-btn';
        modeBtn.textContent = '▦ GRID';
        modeBtn.onclick = function () {
            liveMode = !liveMode;
            modeBtn.textContent = liveMode ? '◈ PADS' : '▦ GRID';
            modeBtn.classList.toggle('playing', liveMode);
            gridWrap.style.display = liveMode ? 'none' : '';
            padsWrap.style.display = liveMode ? '' : 'none';
        };
        kitBar.appendChild(modeBtn);

        // Pattern nav
        var pLbl = document.createElement('span'); pLbl.className = 'mpc-lbl'; pLbl.style.marginLeft = '6px'; pLbl.textContent = 'PAT';
        kitBar.appendChild(pLbl);
        var ppBtn = document.createElement('button'); ppBtn.className = 'ss-card-btn'; ppBtn.textContent = '◀';
        var pnBtn = document.createElement('button'); pnBtn.className = 'ss-card-btn'; pnBtn.textContent = '▶';
        var pNum = document.createElement('span'); pNum.style.cssText = 'font-size:12px;color:#00f3ff;min-width:18px;text-align:center;font-weight:bold;';
        pNum.textContent = '1';
        ppBtn.onclick = function () { curPat = (curPat - 1 + NUM_PATS) % NUM_PATS; pNum.textContent = curPat + 1; _renderPat(); };
        pnBtn.onclick = function () { curPat = (curPat + 1) % NUM_PATS; pNum.textContent = curPat + 1; _renderPat(); };
        kitBar.appendChild(ppBtn); kitBar.appendChild(pNum); kitBar.appendChild(pnBtn);

        // Swing
        var swLbl = document.createElement('span'); swLbl.className = 'mpc-lbl'; swLbl.style.marginLeft = '6px'; swLbl.textContent = 'SWG';
        kitBar.appendChild(swLbl);
        var swInp = _slider(0, 100, 0, '#ff88ff', 60, 'Swing');
        var swVal = document.createElement('span'); swVal.style.cssText = 'font-size:9px;color:#ff88ff;min-width:22px;'; swVal.textContent = '0%';
        swInp.oninput = function () { swing = +this.value / 100; swVal.textContent = this.value + '%'; _save(); };
        kitBar.appendChild(swInp); kitBar.appendChild(swVal);

        // CLR pattern
        var clrBtn = document.createElement('button');
        clrBtn.className = 'ss-card-btn';
        clrBtn.style.cssText += 'margin-left:auto;border-color:rgba(255,60,60,.4);color:rgba(255,100,100,.8);';
        clrBtn.textContent = 'CLR PAT';
        clrBtn.onclick = function () {
            allPatterns[curKit][curPat] = KITS[curKit].voices.map(function () {
                return Array.from({ length: NUM_STEPS }, function () { return { on: false, vel: 1 }; });
            });
            _renderPat(); _save();
        };
        kitBar.appendChild(clrBtn);
        body.appendChild(kitBar);

        // ── Step number header ────────────────────────────────
        var hdr = _div('display:flex;gap:2px;padding-left:82px;');
        for (var s = 0; s < NUM_STEPS; s++) {
            var sp = document.createElement('span');
            sp.style.cssText = 'font-size:7px;width:24px;text-align:center;flex-shrink:0;' +
                (s % 4 === 0 ? 'color:rgba(0,243,255,.8);font-weight:600;' : 'color:rgba(0,243,255,.25);');
            sp.textContent = s + 1;
            hdr.appendChild(sp);
        }

        // ── GRID wrapper ──────────────────────────────────────
        var gridWrap = _div('display:flex;flex-direction:column;gap:0;');
        gridWrap.appendChild(hdr);

        var grid = _div('display:flex;flex-direction:column;gap:3px;');
        var vp = _div(''); // voice-params container (rebuilt on kit change)
        _stepBtns = [];
        _buildVoiceRows(grid, vp);

        var legend = _div('display:flex;gap:2px;padding-left:82px;margin-top:2px;');
        var legPad = _div('flex:1;'); legend.appendChild(legPad);
        [['TNE', 42], ['DCY', 42], ['VOL', 38]].forEach(function (l) {
            var s = document.createElement('span');
            s.style.cssText = 'font-size:6px;color:rgba(0,243,255,.3);letter-spacing:1px;width:' + l[1] + 'px;text-align:center;flex-shrink:0;';
            s.textContent = l[0]; legend.appendChild(s);
        });
        gridWrap.appendChild(grid);
        gridWrap.appendChild(legend);
        body.appendChild(gridWrap);

        // ── PADS wrapper ──────────────────────────────────────
        var padsWrap = _div('display:none;flex-direction:column;gap:8px;');
        var padGrid = _div('display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:4px;');
        _buildPads(padGrid);
        var padHint = document.createElement('span');
        padHint.style.cssText = 'font-size:8px;color:rgba(0,243,255,.35);letter-spacing:1px;text-align:center;';
        padHint.textContent = 'CLICK TO PLAY • MIDI NOTES 36–43';
        padsWrap.appendChild(padGrid); padsWrap.appendChild(padHint);
        body.appendChild(padsWrap);

        _renderPat();
        _loadSaved();

        // MIDI
        document.addEventListener('ss-midi', function (e) {
            var d = e.detail;
            var cmd = d.status >> 4;
            if ((cmd === 9 && d.vel > 0) || cmd === 8) {
                var vi = d.note - 36;
                if (vi >= 0 && vi < 8) {
                    if (cmd === 9) {
                        var t = _ctx ? _ctx.currentTime + 0.01 : 0;
                        _fire(curKit, vi, t, false);
                        _flashPad(vi);
                    }
                }
            }
        });
    }

    function _buildVoiceRows(grid, vpContainer) {
        grid.innerHTML = '';
        _stepBtns = [];
        _padEls = [];
        var kit = KITS[curKit];
        kit.voices.forEach(function (def, vi) {
            var vp = allVP[curKit][vi];
            var row = _div('display:flex;align-items:center;gap:2px;');

            var muteBtn = document.createElement('button');
            muteBtn.className = 'ss-card-btn ic-mute'; muteBtn.textContent = 'M'; muteBtn.title = 'Mute';
            muteBtn.style.borderColor = 'rgba(255,80,80,.3)';
            muteBtn.classList.toggle('on', !!vp.mute);
            muteBtn.onclick = (function (vi, muteBtn) { return function () {
                vp = allVP[curKit][vi];
                vp.mute = !vp.mute;
                muteBtn.classList.toggle('on', vp.mute);
                if (_gains[curKit][vi]) _gains[curKit][vi].gain.setTargetAtTime(vp.mute ? 0 : vp.vol, _ctx.currentTime, 0.01);
                _save();
            }; }(vi, muteBtn));
            row.appendChild(muteBtn);

            var lbl = document.createElement('button');
            lbl.className = 'ss-card-btn bf-vlbl mpc-vlbl'; lbl.dataset.vi = vi;
            lbl.style.cssText = 'width:46px;font-size:7.5px;letter-spacing:1px;border-color:' + def.color + '55;flex-shrink:0;';
            lbl.textContent = def.name;
            lbl.onclick = (function (vi) { return function () { if (_ctx) _fire(curKit, vi, _ctx.currentTime + 0.01, false); }; }(vi));
            row.appendChild(lbl);
            _padEls[vi] = lbl;

            var rowBtns = [];
            for (var s = 0; s < NUM_STEPS; s++) {
                var btn = document.createElement('button');
                btn.style.cssText = 'width:24px;height:20px;border:1px solid rgba(0,243,255,.12);background:rgba(0,0,0,.45);cursor:pointer;border-radius:2px;flex-shrink:0;';
                if (s > 0 && s % 4 === 0) btn.classList.add('ic-beat-sep');
                (function (vi, s, btn, def) {
                    btn.onclick = function () {
                        var cell = allPatterns[curKit][curPat][vi][s];
                        if (!cell.on) { cell.on = true; cell.vel = 1; }
                        else if (cell.vel === 1) { cell.vel = 2; }
                        else { cell.on = false; cell.vel = 1; }
                        _paintStep(btn, cell, def);
                        _save();
                        if (_ctx && cell.on) _fire(curKit, vi, _ctx.currentTime + 0.01, cell.vel === 2);
                    };
                }(vi, s, btn, def));
                row.appendChild(btn);
                rowBtns.push(btn);
            }
            _stepBtns.push(rowBtns);

            var tune = _slider(-12, 12, vp.tune, def.color, 42, 'Tune');
            tune.oninput = (function (vi) { return function () { allVP[curKit][vi].tune = +this.value; _renderBuf(curKit, vi); _save(); }; }(vi));
            row.appendChild(tune);

            var decay = _slider(3, 150, Math.round(vp.decay * 100), def.color, 42, 'Decay');
            decay.oninput = (function (vi) { return function () { allVP[curKit][vi].decay = +this.value / 100; _renderBuf(curKit, vi); _save(); }; }(vi));
            row.appendChild(decay);

            var vol = _slider(0, 100, Math.round(vp.vol * 100), def.color, 38, 'Volume');
            vol.oninput = (function (vi) { return function () {
                var v = +this.value / 100;
                allVP[curKit][vi].vol = v;
                if (_gains[curKit][vi] && !allVP[curKit][vi].mute) _gains[curKit][vi].gain.setTargetAtTime(v, _ctx.currentTime, 0.01);
                _save();
            }; }(vi));
            row.appendChild(vol);

            grid.appendChild(row);
        });
    }

    function _rebuildVoiceRows(grid, vpContainer) {
        _buildVoiceRows(grid, vpContainer);
        _renderPat();
    }

    // ── Live pads ──────────────────────────────────────────────
    function _buildPads(padGrid) {
        padGrid.innerHTML = '';
        var kit = KITS[curKit];
        kit.voices.forEach(function (def, vi) {
            var pad = document.createElement('button');
            pad.className = 'bf-live-pad';
            pad.style.cssText =
                'height:68px;border:1px solid ' + def.color + '55;background:rgba(0,0,0,.5);' +
                'cursor:pointer;border-radius:4px;display:flex;flex-direction:column;' +
                'align-items:center;justify-content:center;gap:3px;' +
                'font-size:10px;letter-spacing:1px;color:' + def.color + ';transition:background .06s;';
            pad.innerHTML =
                '<span style="font-size:18px;line-height:1;">' + _padIcon(def.synth) + '</span>' +
                '<span>' + def.name + '</span>' +
                '<span style="font-size:7px;opacity:.4;">MIDI ' + (36 + vi) + '</span>';
            pad.onmousedown = function () {
                pad.style.background = def.color + '40';
                if (_ctx) _fire(curKit, vi, _ctx.currentTime + 0.005, false);
                _flashPad(vi);
            };
            pad.onmouseup = pad.onmouseleave = function () { pad.style.background = 'rgba(0,0,0,.5)'; };
            padGrid.appendChild(pad);
            _padEls[vi] = pad;
        });
    }

    function _padIcon(synth) {
        if (synth.startsWith('kick'))  return '●';
        if (synth.startsWith('snare')) return '◼';
        if (synth === 'clap' || synth === 'clap_909') return '◈';
        if (synth.startsWith('hat'))   return '—';
        if (synth.startsWith('tom'))   return '◉';
        if (synth === 'rim')           return '◌';
        if (synth === 'ride_909' || synth === 'crash') return '⌀';
        if (synth === 'sub_808')       return '▽';
        if (synth === 'shaker')        return '~';
        if (synth === 'snap')          return '✦';
        return '◆';
    }

    // ── Persistence ────────────────────────────────────────────
    function _loadSaved() {
        var d = _load();
        if (d.allPatterns) {
            d.allPatterns.forEach(function (kitPats, ki) {
                if (ki >= KITS.length) return;
                kitPats.forEach(function (pp, pi) {
                    if (pi >= NUM_PATS) return;
                    pp.forEach(function (pv, vi) {
                        if (vi >= 8) return;
                        pv.forEach(function (step, si) { if (si < NUM_STEPS) allPatterns[ki][pi][vi][si] = step; });
                    });
                });
            });
        }
        if (d.allVP) {
            d.allVP.forEach(function (kvp, ki) {
                if (ki >= KITS.length) return;
                kvp.forEach(function (p, vi) { if (vi < 8) Object.assign(allVP[ki][vi], p); });
            });
        }
        if (d.curKit != null) curKit = d.curKit;
        if (d.curPat != null) curPat = d.curPat;
        if (d.swing  != null) swing  = d.swing;
        _renderPat();
        KITS.forEach(function (kit, ki) {
            kit.voices.forEach(function (def, vi) {
                if (_gains[ki][vi] && allVP[ki][vi].mute) _gains[ki][vi].gain.value = 0;
            });
        });
        _renderAll();
    }

    // ── Boot ──────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(function () {
                SonicSuite.registerCard('mpc', {
                    tag:    'D',
                    label:  'VNGRD//BEAT FORGE',
                    onTick: _onTick,
                    onStop: function () { curStep = -1; _highlightStep(-1); },
                    mount:  _mount,
                });
            }, 180);
        }
        btn ? btn.addEventListener('click', _once) : setTimeout(_once, 600);
    });
})();
