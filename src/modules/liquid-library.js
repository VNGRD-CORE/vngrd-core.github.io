// ═══════════════════════════════════════════════════════════════
// VJ HEAVY SYNC + VANGUARD LIQUID LIBRARY — cinematic synth pads
// Extracted from main.js. Depends on: APP, log, igniteAudio, ensureAudioChain,
// _getPadBus, _padCoupling, _fireCoupledFX (globals)
// ═══════════════════════════════════════════════════════════════


//  VJ HEAVY SYNC — seismic + elastic punch on every pad trigger
//  Scaled by live bassLevel so louder hits = more shake.
// ═══════════════════════════════════════════════════════════════
function _vjHeavySync() {
    if (typeof APP === 'undefined' || !APP.vj) return;
    var scale = (APP.audio && APP.audio.bassLevel) ? APP.audio.bassLevel / 255 : 0.65;
    var vel = 0.45 + scale * 0.9;
    APP.vj._seismicVel = (APP.vj._seismicVel || 0) + vel;
    APP.vj._seismicDemoUntil = performance.now() + 1800;
    APP.vj._punchSpring = Math.min(1.0, (APP.vj._punchSpring || 0) + 0.55 * scale);
    APP.vj._punchDemoUntil = performance.now() + 1800;
    APP.vj._punchDemoBeat = performance.now();
}

// ═══════════════════════════════════════════════════════════════
//  VANGUARD LIQUID LIBRARY — 4 cinematic kits × 4 pads
//  Heavy, dissonant, cinematic FX. All synthesized client-side.
// ═══════════════════════════════════════════════════════════════
var VANGUARD_LIQUID_LIB = [
    // Kit 0: VOID DRIFT — long ethereal drones, deep slow evolving textures
    { name: 'VOID DRIFT', rate: 1.0, pads: [
        { label: 'ABYSS',    p: { mode:'noise',   filter:'lowpass',   filterFreq:85,   filterQ:6.5,            atk:2.50,  dec:9.0,  sus:0.42,  dur:15.0 } },
        { label: 'PULSE',    p: { mode:'am',      freq:28,  lfoRate:0.18,                                      atk:1.80,  dec:8.0,  sus:0.38,  dur:13.0 } },
        { label: 'RIFT',     p: { mode:'resonant',freq:52,  freqEnd:18, res:26,                                atk:1.20,  dec:9.5,  sus:0.22,  dur:14.0 } },
        { label: 'SIGNAL',   p: { mode:'sweep',   oscType:'sine',     freq:48, freqEnd:38, sub:32,             atk:1.50,  dec:7.0,  sus:0.28,  dur:12.0 } }
    ]},
    // Kit 1: DARK ETHER — cinematic tension drones, weighted with sub pressure
    { name: 'DARK ETHER', rate: 1.0, pads: [
        { label: 'IMPACT',   p: { mode:'boom',    sub:38,  filter:'lowpass', filterFreq:190, filterQ:0.9,      atk:0.005, dec:4.0,  sus:0.10,  dur: 7.0 } },
        { label: 'TENSION',  p: { mode:'noise',   filter:'lowpass',   filterFreq:240,  filterQ:8.5,            atk:2.20,  dec:7.0,  sus:0.28,  dur:11.0 } },
        { label: 'PRESSURE', p: { mode:'resonant',freq:58,  freqEnd:26, res:20,                                atk:0.20,  dec:5.5,  sus:0.20,  dur: 9.0 } },
        { label: 'DRONE',    p: { mode:'chord',   oscType:'sawtooth', freqs:[38,57,76], det:14,                atk:1.20,  dec:6.0,  sus:0.32,  dur:10.0 } }
    ]},
    // Kit 2: SPECTRAL — crystalline shimmer, bright atmospheric pads
    { name: 'SPECTRAL', rate: 1.0, pads: [
        { label: 'CRYSTAL',  p: { mode:'resonant',freq:290, freqEnd:185, res:48,                               atk:0.60,  dec:6.0,  sus:0.18,  dur: 9.0 } },
        { label: 'SHIMMER',  p: { mode:'chord',   oscType:'sine',     freqs:[220,277,330,440], det:8,          atk:1.40,  dec:6.5,  sus:0.22,  dur:10.0 } },
        { label: 'PRISM',    p: { mode:'am',      freq:185, lfoRate:3.8,                                       atk:0.80,  dec:5.0,  sus:0.26,  dur: 8.0 } },
        { label: 'GHOST',    p: { mode:'noise',   filter:'bandpass',  filterFreq:2900, filterQ:14,             atk:1.20,  dec:5.5,  sus:0.12,  dur: 9.0 } }
    ]},
    // Kit 3: GLITCH OPS — modern glitch with sustained digital texture
    { name: 'GLITCH OPS', rate: 1.0, pads: [
        { label: 'STUTTER',  p: { mode:'noise',   filter:'bandpass',  filterFreq:3600, filterQ:9,  dist:0.28,  atk:0.001, dec:0.55, sus:0.06,  dur: 1.80 } },
        { label: 'DATABEND', p: { mode:'sweep',   oscType:'sawtooth', freq:1400, freqEnd:55, dist:0.38,        atk:0.001, dec:1.20, sus:0.008, dur: 2.20 } },
        { label: 'BYTE',     p: { mode:'chord',   oscType:'square',   freqs:[880,1100,1320], det:25, dist:0.30, atk:0.002, dec:1.00, sus:0.02, dur: 2.00 } },
        { label: 'REWIND',   p: { mode:'sweep',   oscType:'sawtooth', freq:40,  freqEnd:1200, dist:0.22,       atk:0.001, dec:0.80, sus:0.003, dur: 1.60 } }
    ]},
    // Kit 4: CASSETTE NOIR — lo-fi warped atmospheric pads, tape-saturated
    { name: 'CASSETTE NOIR', rate: 1.0, pads: [
        { label: 'DRIFT',    p: { mode:'am',      freq:62,  lfoRate:0.22, dist:0.04,                           atk:2.20,  dec:7.0,  sus:0.30,  dur:11.0 } },
        { label: 'GHOST',    p: { mode:'noise',   filter:'lowpass',   filterFreq:420,  filterQ:3.5, dist:0.07, atk:1.80,  dec:6.0,  sus:0.26,  dur: 9.5 } },
        { label: 'WARP',     p: { mode:'chord',   oscType:'sine',     freqs:[55,82,110], det:20,               atk:1.00,  dec:5.5,  sus:0.24,  dur: 8.5 } },
        { label: 'TAPE',     p: { mode:'resonant',freq:80,  freqEnd:52, res:14, dist:0.04,                     atk:1.20,  dec:6.0,  sus:0.22,  dur: 9.0 } }
    ]},
    // Kit 5: NEURAL STATIC — evolving digital ambience, long textural tails
    { name: 'NEURAL STATIC', rate: 1.0, pads: [
        { label: 'CORRUPT',  p: { mode:'noise',   filter:'lowpass',   filterFreq:680,  filterQ:4.5, dist:0.08, atk:1.20,  dec:6.0,  sus:0.28,  dur:10.0 } },
        { label: 'ENCODE',   p: { mode:'resonant',freq:220, freqEnd:95, res:22,                                atk:0.80,  dec:6.5,  sus:0.20,  dur: 9.5 } },
        { label: 'PHASE',    p: { mode:'am',      freq:110, lfoRate:1.4, dist:0.04,                            atk:1.50,  dec:6.0,  sus:0.25,  dur:10.0 } },
        { label: 'MASK',     p: { mode:'chord',   oscType:'sine',     freqs:[110,165,220], det:18, dist:0.05,  atk:1.80,  dec:7.0,  sus:0.28,  dur:11.0 } }
    ]},
    // Kit 6: DEEP FIELD — sub-bass cosmic, massive low-end evolving pressure
    { name: 'DEEP FIELD', rate: 1.0, pads: [
        { label: 'EVENT',    p: { mode:'boom',    sub:32,  filter:'lowpass', filterFreq:80,  filterQ:0.6,      atk:0.008, dec:5.0,  sus:0.14,  dur: 9.0 } },
        { label: 'HORIZON',  p: { mode:'resonant',freq:55,  freqEnd:22, res:28,                                atk:0.50,  dec:6.5,  sus:0.18,  dur:10.0 } },
        { label: 'GRAVITY',  p: { mode:'sweep',   oscType:'sine',     freq:42, freqEnd:22, sub:28,             atk:0.80,  dec:6.0,  sus:0.22,  dur:10.0 } },
        { label: 'MATTER',   p: { mode:'am',      freq:38,  lfoRate:0.12,                                      atk:2.20,  dec:7.5,  sus:0.32,  dur:11.0 } }
    ]}
];

// ── CINEMATIC SYNTHESIS ENGINE ─────────────────────────────────
function _synthCinematicBuf(p) {
    var sr = 44100;
    var dur = Math.max(p.dur || 1.0, 0.05);
    var frames = Math.ceil(sr * dur);
    try {
        var oct = new OfflineAudioContext(1, frames, sr);
        var atk = p.atk || 0.005;
        var dec = p.dec || 0.3;
        var sus = Math.max(p.sus || 0.0001, 0.0001);

        // Master amplitude envelope
        var master = oct.createGain();
        master.gain.setValueAtTime(0.0001, 0);
        master.gain.linearRampToValueAtTime(1.0, atk);
        master.gain.exponentialRampToValueAtTime(sus, atk + dec);
        master.gain.exponentialRampToValueAtTime(0.0001, Math.max(dur - 0.025, atk + dec + 0.01));
        master.connect(oct.destination);

        // Optional waveshaper distortion (inserted between source and master)
        var out = master;
        if (p.dist && p.dist > 0) {
            var ws = oct.createWaveShaper();
            var n = 512; var k = p.dist * 280;
            var cv = new Float32Array(n);
            for (var i = 0; i < n; i++) {
                var x = (i * 2 / (n - 1)) - 1;
                cv[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
            }
            ws.curve = cv; ws.oversample = '2x';
            ws.connect(master); out = ws;
        }

        var mode = p.mode || 'sweep';

        // ── SWEEP / KICK: pitch-drop oscillator ──────────────────
        if (mode === 'sweep') {
            var osc = oct.createOscillator();
            osc.type = p.oscType || 'sine';
            osc.frequency.setValueAtTime(p.freq || 100, 0);
            osc.frequency.exponentialRampToValueAtTime(Math.max(p.freqEnd || 30, 0.5), atk + dec * 0.85);
            osc.connect(out); osc.start(0); osc.stop(dur);
            if (p.sub) { // optional sub layer
                var sO = oct.createOscillator(); sO.type = 'sine'; sO.frequency.value = p.sub;
                var sG = oct.createGain();
                sG.gain.setValueAtTime(0.0001,0); sG.gain.linearRampToValueAtTime(0.72, 0.003);
                sG.gain.exponentialRampToValueAtTime(0.0001, dur * 0.72);
                sO.connect(sG); sG.connect(master); sO.start(0); sO.stop(dur);
            }
        }

        // ── NOISE: filtered white noise ──────────────────────────
        if (mode === 'noise') {
            var nBuf = oct.createBuffer(1, frames, sr);
            var nd = nBuf.getChannelData(0);
            for (var i = 0; i < frames; i++) nd[i] = Math.random() * 2 - 1;
            var nSrc = oct.createBufferSource(); nSrc.buffer = nBuf;
            if (p.filter) {
                var flt = oct.createBiquadFilter();
                flt.type = p.filter; flt.frequency.value = p.filterFreq || 800; flt.Q.value = p.filterQ || 1;
                nSrc.connect(flt); flt.connect(out);
            } else { nSrc.connect(out); }
            nSrc.start(0); nSrc.stop(dur);
        }

        // ── BOOM: sub oscillator + noise explosion ───────────────
        if (mode === 'boom') {
            var bBuf = oct.createBuffer(1, frames, sr);
            var bd = bBuf.getChannelData(0);
            for (var i = 0; i < frames; i++) bd[i] = Math.random() * 2 - 1;
            var bSrc = oct.createBufferSource(); bSrc.buffer = bBuf;
            if (p.filter) {
                var bFlt = oct.createBiquadFilter();
                bFlt.type = p.filter; bFlt.frequency.value = p.filterFreq || 300; bFlt.Q.value = p.filterQ || 0.7;
                bSrc.connect(bFlt); bFlt.connect(out);
            } else { bSrc.connect(out); }
            bSrc.start(0); bSrc.stop(dur);
            if (p.sub) {
                var bSubO = oct.createOscillator(); bSubO.type = 'sine';
                bSubO.frequency.setValueAtTime(p.sub * 2.2, 0);
                bSubO.frequency.exponentialRampToValueAtTime(p.sub, 0.08);
                var bSubG = oct.createGain();
                bSubG.gain.setValueAtTime(0.0001,0); bSubG.gain.linearRampToValueAtTime(0.85, 0.003);
                bSubG.gain.exponentialRampToValueAtTime(0.0001, dur * 0.78);
                bSubO.connect(bSubG); bSubG.connect(master); bSubO.start(0); bSubO.stop(dur);
            }
        }

        // ── CLUSTER: dissonant multi-oscillator ──────────────────
        if (mode === 'cluster') {
            var freqs = p.freqs || [p.freq || 60];
            freqs.forEach(function(f, fi) {
                var cO = oct.createOscillator(); cO.type = p.oscType || 'sawtooth'; cO.frequency.value = f;
                if (p.det) cO.detune.value = (fi % 2 === 0 ? 1 : -1) * p.det * 0.4;
                var cG = oct.createGain(); cG.gain.value = 0.9 / freqs.length;
                cO.connect(cG); cG.connect(out); cO.start(0); cO.stop(dur);
            });
        }

        // ── CHORD: 3-voice detuned pad for lush harmonic textures ─
        if (mode === 'chord') {
            var chFreqs = p.freqs || [p.freq || 80];
            var chDet = p.det || 8;
            chFreqs.forEach(function(f) {
                [-1, 0, 1].forEach(function(d) {
                    var chO = oct.createOscillator();
                    chO.type = p.oscType || 'sine';
                    chO.frequency.value = f;
                    chO.detune.value = d * chDet;
                    var chG = oct.createGain();
                    chG.gain.value = 0.28 / chFreqs.length;
                    chO.connect(chG); chG.connect(out);
                    chO.start(0); chO.stop(dur);
                });
            });
        }

        // ── METAL: thud + metallic ring + noise burst ────────────
        if (mode === 'metal') {
            var mO = oct.createOscillator(); mO.type = 'triangle';
            mO.frequency.setValueAtTime(p.freq || 200, 0);
            mO.frequency.exponentialRampToValueAtTime(Math.max(p.freqEnd || 50, 1), 0.18);
            mO.connect(out); mO.start(0); mO.stop(dur);
            if (p.ring) {
                var rO = oct.createOscillator(); rO.type = 'sine'; rO.frequency.value = p.ring;
                var rG = oct.createGain();
                rG.gain.setValueAtTime(0.0001,0); rG.gain.linearRampToValueAtTime(0.38, 0.001);
                rG.gain.exponentialRampToValueAtTime(0.0001, dur * 0.55);
                rO.connect(rG); rG.connect(master); rO.start(0); rO.stop(dur);
            }
            // Transient noise burst
            var tFrames = Math.ceil(sr * 0.08);
            var tBuf = oct.createBuffer(1, tFrames, sr); var tD = tBuf.getChannelData(0);
            for (var i = 0; i < tFrames; i++) tD[i] = Math.random() * 2 - 1;
            var tSrc = oct.createBufferSource(); tSrc.buffer = tBuf;
            var tFlt = oct.createBiquadFilter(); tFlt.type = 'highpass'; tFlt.frequency.value = 2200;
            var tG = oct.createGain(); tG.gain.value = 0.5;
            tSrc.connect(tFlt); tFlt.connect(tG); tG.connect(master); tSrc.start(0);
        }

        // ── RESONANT: very high-Q bandpass sweep on noise ────────
        if (mode === 'resonant') {
            var rBuf = oct.createBuffer(1, frames, sr); var rDat = rBuf.getChannelData(0);
            for (var i = 0; i < frames; i++) rDat[i] = Math.random() * 2 - 1;
            var rSrc = oct.createBufferSource(); rSrc.buffer = rBuf;
            var rF = oct.createBiquadFilter(); rF.type = 'bandpass';
            rF.frequency.setValueAtTime(p.freq || 80, 0);
            rF.frequency.exponentialRampToValueAtTime(Math.max(p.freqEnd || 18, 1), dur * 0.88);
            rF.Q.value = p.res || 14;
            rSrc.connect(rF); rF.connect(out); rSrc.start(0); rSrc.stop(dur);
        }

        // ── AM: amplitude-modulated sub pulse ────────────────────
        if (mode === 'am') {
            var amCar = oct.createOscillator(); amCar.type = 'sine'; amCar.frequency.value = p.freq || 35;
            var amGain = oct.createGain(); amGain.gain.value = 0.5;
            var amLfo = oct.createOscillator(); amLfo.type = 'sine'; amLfo.frequency.value = p.lfoRate || 6;
            var amMod = oct.createGain(); amMod.gain.value = 0.5;
            amLfo.connect(amMod); amMod.connect(amGain.gain);
            amCar.connect(amGain); amGain.connect(out);
            amCar.start(0); amCar.stop(dur); amLfo.start(0); amLfo.stop(dur);
        }

        return oct.startRendering();
    } catch(e) { return Promise.reject(e); }
}

// Buffer cache: 'packIdx_padIdx' → AudioBuffer
var _liqBufCache = {};
var _liqCurrentPack = 0;

function _getLiqBuf(packIdx, padIdx) {
    var key = packIdx + '_' + padIdx;
    if (_liqBufCache[key]) return Promise.resolve(_liqBufCache[key]);
    var pack = VANGUARD_LIQUID_LIB[packIdx];
    if (!pack || !pack.pads[padIdx]) return Promise.reject('no-pack');
    return _synthCinematicBuf(pack.pads[padIdx].p).then(function(buf) {
        _liqBufCache[key] = buf; return buf;
    });
}

// Fire a liquid pad (padIdx 0-3, schedTime = audioCtx time or null for immediate)
function _fireLiqPad(padIdx, schedTime, sfxName) {
    if (!APP.audio.ctx) igniteAudio();
    if (!APP.audio.masterGain) ensureAudioChain();
    var ctx = APP.audio.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var packIdx = _liqCurrentPack;
    _getLiqBuf(packIdx, padIdx).then(function(buf) {
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = (VANGUARD_LIQUID_LIB[packIdx] && VANGUARD_LIQUID_LIB[packIdx].rate) || 1.0;
        var gain = ctx.createGain();
        gain.gain.value = 0.88;
        src.connect(gain);
        var bus = _getPadBus(ctx);
        gain.connect(bus || APP.audio.duckingGain);
        var when = (schedTime != null) ? schedTime : ctx.currentTime;
        src.start(when);
        APP.audio.sfxPlaying = true;
        src.onended = function() { APP.audio.sfxPlaying = false; };
        // Visual pulse
        var padEl = document.getElementById('sfx-liq' + (padIdx + 1));
        if (padEl) {
            padEl.classList.add('sfx-pulse', 'sfx-playing');
            setTimeout(function() { padEl.classList.remove('sfx-pulse', 'sfx-playing'); }, 320);
        }
        // Coupled FX
        var nm = sfxName || ('liq' + (padIdx + 1));
        if (typeof _padCoupling !== 'undefined' && _padCoupling[nm] && typeof _fireCoupledFX === 'function') {
            _fireCoupledFX(nm);
        }
    }).catch(function() {});
}

// Update liquid pad labels when pack changes
function _updateLiqPadLabels(packIdx) {
    var pack = VANGUARD_LIQUID_LIB[packIdx];
    if (!pack) return;
    pack.pads.forEach(function(pad, i) {
        var el = document.getElementById('sfx-liq' + (i + 1));
        if (el) {
            var nameEl = el.querySelector('.pad-name');
            if (nameEl) nameEl.textContent = pad.label;
        }
    });
}

