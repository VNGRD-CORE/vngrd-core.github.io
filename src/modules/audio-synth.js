// ═══════════════════════════════════════════════════════════════
// AUDIO SYNTHESIS MODULE — VST drums, SFX engine, InternalSynth,
// Sampler, KitManager, GlobalClock, window.play / window.synth
// Extracted from main.js. Depends on: APP, log, igniteAudio,
// ensureAudioChain (globals from main.js)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// VNGRD_VST — AUDIO_STUDIO: Virtual Drum / Bass Synthesizer
// Kits: 808, 909  |  Routes → APP.audio.masterGain (rec + monitor)
// ═══════════════════════════════════════════════════════════════
const VNGRD_VST = (() => {
    function _ctx() {
        if (!APP.audio.ctx) igniteAudio();
        if (!APP.audio.masterGain) ensureAudioChain();
        return APP.audio.ctx;
    }
    function _dest() {
        return APP.audio.masterGain || (APP.audio.ctx && APP.audio.ctx.destination);
    }

    const kits = {
        '808': {
            kick:         { freq: 55,  pitchMult: 3,   pitchDrop: 0.05, decay: 0.80, vol: 1.2 },
            snare:        { freq: 200, noiseDecay: 0.15, bodyDecay: 0.08, vol: 0.9 },
            hihat_closed: { freq: 8000, decay: 0.04, vol: 0.6 },
            hihat_open:   { freq: 7000, decay: 0.30, vol: 0.7 },
            clap:         { freq: 1200, decay: 0.12, vol: 0.8 }
        },
        '909': {
            kick:         { freq: 60,  pitchMult: 3,   pitchDrop: 0.04, decay: 0.50, vol: 1.0 },
            snare:        { freq: 250, noiseDecay: 0.10, bodyDecay: 0.06, vol: 0.85 },
            hihat_closed: { freq: 9000, decay: 0.03, vol: 0.55 },
            hihat_open:   { freq: 8500, decay: 0.25, vol: 0.65 },
            clap:         { freq: 1400, decay: 0.10, vol: 0.75 }
        }
    };

    function playDrumSound(kit, type, velocity) {
        kit = kit || '808';
        const velNorm = (velocity !== undefined) ? velocity / 127 : 1.0;
        const ctx = _ctx(); if (!ctx) return;
        const dest = _dest(); if (!dest) return;
        if (ctx.state === 'suspended') ctx.resume();
        const p = (kits[kit] || kits['808'])[type];
        if (!p) return;
        const now = ctx.currentTime;
        const v = p.vol * velNorm;

        if (type === 'kick') {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(p.freq * p.pitchMult, now);
            osc.frequency.exponentialRampToValueAtTime(p.freq, now + p.pitchDrop);
            g.gain.setValueAtTime(v, now + 0.001);
            g.gain.exponentialRampToValueAtTime(0.001, now + p.decay);
            osc.connect(g); g.connect(dest);
            osc.start(now); osc.stop(now + p.decay + 0.05);

        } else if (type === 'snare') {
            const bufN = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
            const dN = bufN.getChannelData(0);
            for (let i = 0; i < dN.length; i++) dN[i] = Math.random() * 2 - 1;
            const nSrc = ctx.createBufferSource(); nSrc.buffer = bufN;
            const nFilt = ctx.createBiquadFilter(); nFilt.type = 'highpass'; nFilt.frequency.value = 2000;
            const nGain = ctx.createGain();
            nGain.gain.setValueAtTime(v * 0.8, now);
            nGain.gain.exponentialRampToValueAtTime(0.001, now + p.noiseDecay);
            nSrc.connect(nFilt); nFilt.connect(nGain); nGain.connect(dest);
            nSrc.start(now);
            const body = ctx.createOscillator(), bGain = ctx.createGain();
            body.type = 'triangle'; body.frequency.value = p.freq;
            bGain.gain.setValueAtTime(v * 0.5, now);
            bGain.gain.exponentialRampToValueAtTime(0.001, now + p.bodyDecay);
            body.connect(bGain); bGain.connect(dest);
            body.start(now); body.stop(now + p.bodyDecay + 0.02);

        } else if (type === 'hihat_closed' || type === 'hihat_open') {
            const bufH = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
            const dH = bufH.getChannelData(0);
            for (let i = 0; i < dH.length; i++) dH[i] = Math.random() * 2 - 1;
            const hSrc = ctx.createBufferSource(); hSrc.buffer = bufH;
            const hFilt = ctx.createBiquadFilter(); hFilt.type = 'bandpass'; hFilt.frequency.value = p.freq; hFilt.Q.value = 0.8;
            const hGain = ctx.createGain();
            hGain.gain.setValueAtTime(v * 0.6, now);
            hGain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);
            hSrc.connect(hFilt); hFilt.connect(hGain); hGain.connect(dest);
            hSrc.start(now);

        } else if (type === 'clap') {
            for (let c = 0; c < 3; c++) {
                const off = c * 0.012;
                const bufC = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
                const dC = bufC.getChannelData(0);
                for (let i = 0; i < dC.length; i++) dC[i] = Math.random() * 2 - 1;
                const cSrc = ctx.createBufferSource(); cSrc.buffer = bufC;
                const cFilt = ctx.createBiquadFilter(); cFilt.type = 'bandpass'; cFilt.frequency.value = p.freq; cFilt.Q.value = 1.2;
                const cGain = ctx.createGain();
                cGain.gain.setValueAtTime(v * 0.7, now + off);
                cGain.gain.exponentialRampToValueAtTime(0.001, now + off + p.decay);
                cSrc.connect(cFilt); cFilt.connect(cGain); cGain.connect(dest);
                cSrc.start(now + off);
            }
        }
    }

    function playBassNote(midiNote, velocity) {
        const velNorm = (velocity !== undefined) ? velocity / 127 : 1.0;
        const ctx = _ctx(); if (!ctx) return;
        const dest = _dest(); if (!dest) return;
        if (ctx.state === 'suspended') ctx.resume();
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        const now = ctx.currentTime;
        const osc = ctx.createOscillator(), filt = ctx.createBiquadFilter(), g = ctx.createGain();
        osc.type = 'sawtooth'; osc.frequency.value = freq;
        filt.type = 'lowpass'; filt.frequency.value = 800; filt.Q.value = 2;
        g.gain.setValueAtTime(velNorm * 0.9, now + 0.001);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.connect(filt); filt.connect(g); g.connect(dest);
        osc.start(now); osc.stop(now + 0.65);
    }

    function play(target, velocity) {
        const parts = target.split('_');
        const kit = parts[0];
        const type = parts.slice(1).join('_');
        if (type) playDrumSound(kit, type, velocity || 100);
        else playBassNote(parseInt(kit) || 60, velocity || 100);
    }

    return { play, playDrumSound, playBassNote, kits };
})();

// ═══════════════════════════════════════════════════════════════
// SFX_ENGINE — 8-Pad Hybrid Sampler (Broadcast-ready)
// Signature Bank (1-4): pre-fetched local files
// Custom Bank (5-8):    user-uploaded via FileReader + decodeAudioData
// All pads route → duckingGain → analyzer → masterGain (u_audioImpact reactive)
// ═══════════════════════════════════════════════════════════════
const SFX_ENGINE = (() => {
    const URLS = {
        applause: './108512__buginthesys__applause_3.wav',
        cheer:    './67182__robinhood76__00897-massive-800-men-laugh.wav',
        horn:     './577697__cmudd14__airhorn.mp3',
        boom:     './BOOM.wav'
    };
    const _raw = {};
    const buffers = {};
    const GAIN = 0.6;
    const GAINS = { horn: 0.92, boom: 0.92 };

    function init() {
        Object.entries(URLS).forEach(([name, url]) => {
            log('SFX: ' + name);
            fetch(url)
                .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
                .then(ab => { _raw[name] = ab; log('SFX_ENGINE: FETCHED ' + name.toUpperCase()); })
                .catch(e => log('SFX_ENGINE: FETCH_FAIL ' + name.toUpperCase() + ' — ' + e.message));
        });
    }

    function _decode(name, ctx) {
        if (buffers[name]) return Promise.resolve(buffers[name]);
        if (!_raw[name])   return Promise.reject(new Error('not fetched yet'));
        return ctx.decodeAudioData(_raw[name].slice(0)).then(buf => {
            buffers[name] = buf;
            log('SFX_ENGINE: DECODED ' + name.toUpperCase());
            return buf;
        });
    }

    function loadCustom(slot, file) {
        if (!file) return;
        const name = 'custom' + slot;
        if (!APP.audio.ctx) igniteAudio();
        if (!APP.audio.masterGain) ensureAudioChain();
        const ctx = APP.audio.ctx;
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        const reader = new FileReader();
        reader.onload = function(e) {
            ctx.decodeAudioData(e.target.result).then(buf => {
                buffers[name] = buf;
                const btn = document.getElementById('sfx-' + name);
                if (btn) {
                    const short = file.name.replace(/\.[^.]+$/, '').toUpperCase().substring(0, 6);
                    const nm = btn.querySelector('.pad-name');
                    const hint = btn.querySelector('.pad-hint');
                    if (nm) nm.textContent = short;
                    if (hint) hint.textContent = 'PLAY';
                    btn.classList.add('loaded');
                }
                log('SFX_ENGINE: CUSTOM_LOADED ' + name.toUpperCase() + ' — ' + file.name);
            }).catch(e => log('SFX_ENGINE: DECODE_FAIL ' + name + ' — ' + e.message));
        };
        reader.readAsArrayBuffer(file);
    }

    function play(name) {
        if (name && name.startsWith('liq')) {
            if (typeof _fireLiqPad === 'function') _fireLiqPad(parseInt(name.replace('liq',''),10) - 1, null, name);
            return;
        }
        if (!APP.audio.ctx) igniteAudio();
        if (!APP.audio.masterGain) ensureAudioChain();
        const ctx = APP.audio.ctx;
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();

        _decode(name, ctx).then(buf => {
            const src  = ctx.createBufferSource();
            src.buffer = buf;
            const gain = ctx.createGain();
            gain.gain.value = GAINS[name] !== undefined ? GAINS[name] : GAIN;
            src.connect(gain);
            var bus = (typeof _getPadBus === 'function') ? _getPadBus(ctx) : null;
            gain.connect(bus || APP.audio.duckingGain);
            const padBtn = document.getElementById('sfx-' + name);
            if (padBtn) padBtn.classList.add('sfx-playing');
            src.start();
            APP.audio.sfxPlaying = true;
            if (APP.audio.micRecGain) {
                APP.audio.micRecGain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
            }
            src.onended = function() {
                APP.audio.sfxPlaying = false;
                if (padBtn) padBtn.classList.remove('sfx-playing');
                if (APP.audio.micRecGain) {
                    APP.audio.micRecGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.05);
                }
            };
            log('SFX_ENGINE: PLAY ' + name.toUpperCase());
        }).catch(() => log('SFX_ENGINE: NOT_READY — ' + name.toUpperCase()));
    }

    function _buffers() { return buffers; }
    return { init, play, loadCustom, _buffers };
})();

// ═══════════════════════════════════════════════════════════════
//  INTERNAL SYNTH v3 — Cinematic Multi-Layer Oscillator Engine
//  SUB / NOISE / SWEEP / METAL / AM / BOOM
// ═══════════════════════════════════════════════════════════════
const InternalSynth = (() => {
    function _ctx() {
        if (!APP.audio.ctx) igniteAudio();
        if (!APP.audio.masterGain) ensureAudioChain();
        var c = APP.audio.ctx;
        if (c && c.state === 'suspended') c.resume();
        return c;
    }
    function _outNode() { return APP.audio.panner || APP.audio.duckingGain || APP.audio.masterGain; }

    function _applyPan(gainNode, panVal, ctx) {
        if (panVal === undefined || panVal === null) return gainNode;
        var pan = (panVal / 127.5) - 1.0;
        try {
            var panNode = ctx.createStereoPanner();
            panNode.pan.setValueAtTime(Math.max(-1,Math.min(1,pan)), ctx.currentTime);
            gainNode.connect(panNode);
            panNode.connect(_outNode());
            return null;
        } catch(e) { return gainNode; }
    }

    function _seismicKick(vol, freq) {
        if (typeof APP === 'undefined') return;
        if (!window.audioReactiveData) window.audioReactiveData = {};
        window.audioReactiveData.lastSynthFreq  = freq;
        window.audioReactiveData.lastSynthVol   = vol;
        window.audioReactiveData.lastTriggerTs  = performance.now();
        var isBass = freq < 200;
        var isLoud  = vol > 0.65;
        if (APP.vj && (isBass || isLoud)) {
            var scale = vol * (isBass ? 1.4 : 0.8);
            APP.vj._seismicVel      = (APP.vj._seismicVel || 0) + scale * 0.7;
            APP.vj._seismicDemoUntil = performance.now() + (isBass ? 1200 : 600);
            APP.vj._punchSpring    = Math.min(1.0, (APP.vj._punchSpring || 0) + scale * 0.5);
            APP.vj._punchDemoUntil = performance.now() + 700;
            APP.vj._punchDemoBeat  = performance.now();
        }
        if (APP.audio) APP.audio.bassLevel = Math.max(APP.audio.bassLevel || 0, Math.floor(vol * 240));
    }

    function _satCurve(ctx, drive) {
        var ws = ctx.createWaveShaper();
        var n = 256, curve = new Float32Array(n);
        drive = drive || 2.0;
        for (var i = 0; i < n; i++) {
            var x = (i * 2) / n - 1;
            curve[i] = (Math.PI + drive) * x / (Math.PI + drive * Math.abs(x));
        }
        ws.curve = curve; ws.oversample = '2x';
        return ws;
    }

    function _noiseBuf(ctx, dur) {
        var frames = Math.ceil(ctx.sampleRate * dur);
        var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    function triggerSub(freq, vol, panVal) {
        var ctx = _ctx(); if (!ctx) return;
        freq = Math.max(20, parseFloat(freq) || 80);
        vol  = Math.min(0.6, parseFloat(vol) || 0.48);
        var now = ctx.currentTime, dur = 1.5;
        var master = ctx.createGain();
        master.gain.setValueAtTime(0, now);
        master.gain.linearRampToValueAtTime(vol, now + 0.003);
        master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        var osc = ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 3.5, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(16, freq * 0.22), now + dur * 0.8);
        var sat = _satCurve(ctx, 4.0);
        osc.connect(sat); sat.connect(master);
        var sub = ctx.createOscillator(); sub.type = 'sine';
        sub.frequency.setValueAtTime(freq * 0.5, now);
        var subG = ctx.createGain(); subG.gain.value = 0.55;
        sub.connect(subG); subG.connect(master);
        var clickBuf = _noiseBuf(ctx, 0.015);
        var clickSrc = ctx.createBufferSource(); clickSrc.buffer = clickBuf;
        var clickHP = ctx.createBiquadFilter(); clickHP.type = 'highpass';
        clickHP.frequency.value = 1200;
        var clickG = ctx.createGain();
        clickG.gain.setValueAtTime(vol * 0.6, now);
        clickG.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
        clickSrc.connect(clickHP); clickHP.connect(clickG); clickG.connect(master);
        var out = _applyPan(master, panVal, ctx);
        if (out) out.connect(_outNode());
        osc.start(now); sub.start(now); clickSrc.start(now);
        osc.stop(now + dur + 0.05); sub.stop(now + dur + 0.05);
        _seismicKick(vol, freq);
    }

    function triggerNoise(cutoff, vol, resonance, panVal) {
        var ctx = _ctx(); if (!ctx) return;
        cutoff    = Math.max(80, parseFloat(cutoff) || 600);
        vol       = Math.min(0.6, parseFloat(vol) || 0.42);
        resonance = parseFloat(resonance) || 6;
        var now = ctx.currentTime, dur = 2.0;
        var master = ctx.createGain();
        master.gain.setValueAtTime(vol, now);
        master.gain.setTargetAtTime(0.0001, now + 0.04, 0.28);
        var bodyBuf = _noiseBuf(ctx, dur + 0.1);
        var bodySrc = ctx.createBufferSource(); bodySrc.buffer = bodyBuf;
        var bodyLP = ctx.createBiquadFilter(); bodyLP.type = 'lowpass';
        bodyLP.frequency.setValueAtTime(cutoff * 1.8, now);
        bodyLP.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.15), now + dur * 0.7);
        bodyLP.Q.value = resonance;
        var bodyG = ctx.createGain(); bodyG.gain.value = 0.7;
        bodySrc.connect(bodyLP); bodyLP.connect(bodyG); bodyG.connect(master);
        var airBuf = _noiseBuf(ctx, 0.12);
        var airSrc = ctx.createBufferSource(); airSrc.buffer = airBuf;
        var airHP = ctx.createBiquadFilter(); airHP.type = 'highpass';
        airHP.frequency.value = cutoff * 3;
        var airG = ctx.createGain();
        airG.gain.setValueAtTime(vol * 0.5, now);
        airG.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
        airSrc.connect(airHP); airHP.connect(airG); airG.connect(master);
        var out = _applyPan(master, panVal, ctx);
        if (out) out.connect(_outNode());
        bodySrc.start(now); airSrc.start(now);
        bodySrc.stop(now + dur + 0.1);
        _seismicKick(vol, cutoff);
    }

    function triggerSweep(freq, vol, panVal) {
        var ctx = _ctx(); if (!ctx) return;
        freq = Math.max(20, parseFloat(freq) || 120);
        vol  = Math.min(0.6, parseFloat(vol) || 0.39);
        var now = ctx.currentTime, dur = 2.5;
        var master = ctx.createGain();
        master.gain.setValueAtTime(vol * 0.9, now);
        master.gain.setTargetAtTime(0.0001, now + 0.08, 0.5);
        var nBuf = _noiseBuf(ctx, dur + 0.1);
        var nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf;
        var nLP = ctx.createBiquadFilter(); nLP.type = 'lowpass';
        nLP.frequency.setValueAtTime(freq * 12, now);
        nLP.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.4), now + dur * 0.6);
        nLP.Q.value = 14;
        nSrc.connect(nLP); nLP.connect(master);
        var sine = ctx.createOscillator(); sine.type = 'sine';
        sine.frequency.setValueAtTime(freq * 2.0, now + dur * 0.3);
        sine.frequency.exponentialRampToValueAtTime(Math.max(16, freq * 0.5), now + dur * 0.9);
        var sineG = ctx.createGain();
        sineG.gain.setValueAtTime(0, now + dur * 0.2);
        sineG.gain.linearRampToValueAtTime(vol * 0.4, now + dur * 0.5);
        sineG.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        sine.connect(sineG); sineG.connect(master);
        var out = _applyPan(master, panVal, ctx);
        if (out) out.connect(_outNode());
        nSrc.start(now); sine.start(now); nSrc.stop(now + dur + 0.1); sine.stop(now + dur + 0.1);
        _seismicKick(vol, freq);
    }

    function triggerMetal(freq, vol, ringFreq, panVal) {
        var ctx = _ctx(); if (!ctx) return;
        freq    = Math.max(40, parseFloat(freq) || 220);
        vol     = Math.min(0.6, parseFloat(vol) || 0.33);
        var now = ctx.currentTime, dur = 1.8;
        var master = ctx.createGain();
        master.gain.setValueAtTime(vol, now);
        master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        var ratios = [1.0, 2.756, 5.404, 8.933, 13.42, 18.01];
        ratios.forEach(function(r, idx) {
            var o = ctx.createOscillator(); o.type = 'sine';
            o.frequency.value = freq * r;
            var g = ctx.createGain();
            var amp = vol * Math.pow(0.55, idx);
            g.gain.setValueAtTime(amp, now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur * (0.3 + idx * 0.12));
            o.connect(g); g.connect(master);
            o.start(now); o.stop(now + dur + 0.05);
        });
        var clkBuf = _noiseBuf(ctx, 0.025);
        var clkSrc = ctx.createBufferSource(); clkSrc.buffer = clkBuf;
        var clkHP = ctx.createBiquadFilter(); clkHP.type = 'highpass';
        clkHP.frequency.value = freq * 3;
        var clkG = ctx.createGain();
        clkG.gain.setValueAtTime(vol * 0.45, now);
        clkG.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
        clkSrc.connect(clkHP); clkHP.connect(clkG); clkG.connect(master);
        var out = _applyPan(master, panVal, ctx);
        if (out) out.connect(_outNode());
        clkSrc.start(now);
        _seismicKick(vol * 0.7, freq);
    }

    function triggerAM(freq, vol, lfoRate, panVal) {
        var ctx = _ctx(); if (!ctx) return;
        freq    = Math.max(20, parseFloat(freq) || 110);
        vol     = Math.min(0.6, parseFloat(vol) || 0.30);
        lfoRate = parseFloat(lfoRate) || 0.8;
        var now = ctx.currentTime, dur = 3.5;
        var master = ctx.createGain();
        master.gain.setValueAtTime(0, now);
        master.gain.linearRampToValueAtTime(vol, now + 0.35);
        master.gain.setTargetAtTime(0.0001, now + 0.6, 0.7);
        [-7, 0, 7].forEach(function(detCents) {
            var carr = ctx.createOscillator(); carr.type = 'sine';
            carr.frequency.value = freq;
            carr.detune.value = detCents;
            var cg = ctx.createGain(); cg.gain.value = 0.35;
            carr.connect(cg); cg.connect(master);
            carr.start(now); carr.stop(now + dur + 0.1);
        });
        var lfo = ctx.createOscillator(); lfo.type = 'sine';
        lfo.frequency.value = lfoRate;
        var lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
        lfo.connect(lfoG); lfoG.connect(master.gain);
        lfo.start(now); lfo.stop(now + dur + 0.1);
        var subO = ctx.createOscillator(); subO.type = 'sine';
        subO.frequency.value = freq * 0.5;
        var subG = ctx.createGain(); subG.gain.value = 0.25;
        subO.connect(subG); subG.connect(master);
        subO.start(now); subO.stop(now + dur + 0.1);
        var out = _applyPan(master, panVal, ctx);
        if (out) out.connect(_outNode());
        _seismicKick(vol * 0.5, freq);
    }

    function triggerBoom(freq, vol, panVal) {
        var ctx = _ctx(); if (!ctx) return;
        freq = Math.max(15, parseFloat(freq) || 45);
        vol  = Math.min(0.6, parseFloat(vol) || 0.54);
        var now = ctx.currentTime, dur = 3.0;
        var master = ctx.createGain();
        master.gain.setValueAtTime(vol, now);
        master.gain.setTargetAtTime(0.0001, now + 0.06, 0.55);
        [[1.0, 0.85], [1.5, 0.5], [2.0, 0.35]].forEach(function(p) {
            var o = ctx.createOscillator(); o.type = 'sine';
            o.frequency.setValueAtTime(freq * p[0] * 2.8, now);
            o.frequency.exponentialRampToValueAtTime(Math.max(10, freq * p[0] * 0.18), now + dur * 0.75);
            var g = ctx.createGain(); g.gain.value = p[1];
            o.connect(g); g.connect(master);
            o.start(now); o.stop(now + dur + 0.1);
        });
        var nBuf = _noiseBuf(ctx, 0.08);
        var nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf;
        var nLP = ctx.createBiquadFilter(); nLP.type = 'lowpass';
        nLP.frequency.value = freq * 8;
        var nG = ctx.createGain();
        nG.gain.setValueAtTime(vol * 0.7, now);
        nG.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        nSrc.connect(nLP); nLP.connect(nG); nG.connect(master);
        nSrc.start(now);
        var out = _applyPan(master, panVal, ctx);
        if (out) out.connect(_outNode());
        _seismicKick(vol, freq);
    }

    function trigger(padNum, freq, vol, panVal, rtg) {
        padNum = parseInt(padNum) || 0;
        var mode;
        if      (padNum <= 0x01) mode = 'SUB';
        else if (padNum <= 0x03) mode = 'NOISE';
        else if (padNum <= 0x05) mode = 'SWEEP';
        else if (padNum <= 0x07) mode = 'METAL';
        else if (padNum <= 0x09) mode = 'AM';
        else                     mode = 'BOOM';
        var count = Math.max(1, Math.min(16, parseInt(rtg) || 1));
        var ctx   = _ctx(); if (!ctx) return;
        for (var n = 0; n < count; n++) {
            (function(offset){
                setTimeout(function() {
                    switch(mode) {
                        case 'SUB':   triggerSub(freq, vol, panVal);   break;
                        case 'NOISE': triggerNoise(freq, vol, 8, panVal); break;
                        case 'SWEEP': triggerSweep(freq, vol, panVal);  break;
                        case 'METAL': triggerMetal(freq, vol, null, panVal); break;
                        case 'AM':    triggerAM(freq, vol, null, panVal); break;
                        case 'BOOM':  triggerBoom(freq, vol, panVal);  break;
                    }
                }, offset);
            })(n * (60000 / ((window.currentBPM || 120) * 4) / count));
        }
    }

    function getWaveShape(mode, samples) {
        samples = samples || 64;
        var out = new Float32Array(samples);
        if (mode === 'SUB' || mode === 'BOOM') {
            for (var i = 0; i < samples; i++) out[i] = Math.sin(i / samples * Math.PI * 2) * Math.exp(-i / samples * 3);
        } else if (mode === 'NOISE') {
            for (var i = 0; i < samples; i++) out[i] = (Math.random() * 2 - 1) * Math.exp(-i / samples * 4);
        } else if (mode === 'SWEEP') {
            for (var i = 0; i < samples; i++) out[i] = Math.sin(i / samples * Math.PI * 3) * (1 - i/samples);
        } else if (mode === 'METAL') {
            for (var i = 0; i < samples; i++) out[i] = Math.sin(i / samples * Math.PI * 2) * Math.sin(i / samples * Math.PI * 5.5) * Math.exp(-i / samples * 2);
        } else {
            for (var i = 0; i < samples; i++) out[i] = Math.sin(i / samples * Math.PI * 4) * 0.5;
        }
        return out;
    }

    return { triggerSub, triggerNoise, triggerSweep, triggerMetal, triggerAM, triggerBoom, trigger, getWaveShape };
})();



// ═══════════════════════════════════════════════════════════════
//  SAMPLER — Unified trigger handshake + PURGE
// ═══════════════════════════════════════════════════════════════
const Sampler = (() => {
    function trigger(sfxName, vol, offset) {
        if (!sfxName) return;
        SFX_ENGINE.play(sfxName);
        if (typeof _fireCoupledFX === 'function') _fireCoupledFX(sfxName);
        var id = 'sfx-' + sfxName;
        var btn = document.getElementById(id);
        if (btn && typeof _pulsePad === 'function') _pulsePad(btn);
    }

    function purgePad(name) {
        if (!name) return;
        var bufs = SFX_ENGINE._buffers();
        if (bufs[name]) {
            delete bufs[name];
            var btn = document.getElementById('sfx-' + name);
            if (btn) {
                var nm   = btn.querySelector('.pad-name');
                var hint = btn.querySelector('.pad-hint');
                if (nm)   nm.textContent   = name.replace('custom','C-0').replace('liq','L-0');
                if (hint) hint.textContent  = 'LOAD';
                btn.classList.remove('loaded','sfx-playing');
            }
        }
        log('SAMPLER: PURGE:' + name.toUpperCase());
    }

    function purge() {
        ['custom1','custom2','custom3','custom4'].forEach(purgePad);
        log('SAMPLER: PURGE_COMPLETE');
    }

    return { trigger, purgePad, purge };
})();

// ═══════════════════════════════════════════════════════════════
//  KIT MANAGER v2 — 5 Fully Synthetic Atmospheric/Cinematic Kits
// ═══════════════════════════════════════════════════════════════
const KitManager = (() => {
    const KITS = [
        { name: 'DARK_MATTER', pads: [
            { label: 'SUB KICK',   synth:'SUB',   freq:55,   vol:0.92 },
            { label: 'HVY IMPACT', synth:'NOISE', freq:280,  vol:0.8,  p:{res:10} },
            { label: 'METAL SCR',  synth:'METAL', freq:180,  vol:0.65 },
            { label: 'CRUNCH',     synth:'NOISE', freq:900,  vol:0.7,  p:{res:4} }
        ]},
        { name: 'CINEMATIC', pads: [
            { label: 'SEISMIC',    synth:'BOOM',  freq:38,   vol:0.95 },
            { label: 'ATMOS SWP',  synth:'SWEEP', freq:90,   vol:0.75 },
            { label: 'BIG IMPACT', synth:'NOISE', freq:180,  vol:0.85, p:{res:8} },
            { label: 'DEEP STING', synth:'AM',    freq:65,   vol:0.6,  p:{lfo:0.4} }
        ]},
        { name: 'BREAKCORE', pads: [
            { label: 'TIGHT KICK', synth:'SUB',   freq:65,   vol:0.88 },
            { label: 'SNARE CRCK', synth:'NOISE', freq:500,  vol:0.82, p:{res:12} },
            { label: 'GLITCH HIT', synth:'METAL', freq:440,  vol:0.6 },
            { label: 'BLAST',      synth:'BOOM',  freq:60,   vol:0.78 }
        ]},
        { name: 'IDM_ACID', pads: [
            { label: 'ACID BASS',  synth:'SWEEP', freq:55,   vol:0.8 },
            { label: 'TB ZAPP',    synth:'METAL', freq:110,  vol:0.65 },
            { label: 'CLATTER',    synth:'NOISE', freq:2200, vol:0.55, p:{res:6} },
            { label: 'D-ZAP',      synth:'AM',    freq:220,  vol:0.6,  p:{lfo:7.5} }
        ]},
        { name: 'ETHER_VOID', pads: [
            { label: 'DEEP DRONE', synth:'AM',    freq:41,   vol:0.7,  p:{lfo:0.25} },
            { label: 'PAD SWIRL',  synth:'SWEEP', freq:65,   vol:0.65 },
            { label: 'TEXTURE',    synth:'NOISE', freq:120,  vol:0.55, p:{res:3} },
            { label: 'DEEP BELL',  synth:'METAL', freq:82,   vol:0.5 }
        ]}
    ];

    var _activeKit = 0;

    function playBuffer(kitIdx, padIdx, schedTime, vol) {
        var kit = KITS[kitIdx]; if (!kit) return;
        var pad = kit.pads[padIdx]; if (!pad) return;
        var v = (typeof vol === 'number') ? vol : pad.vol;
        var f = pad.freq;
        var p = pad.p || {};
        var delay = schedTime && APP.audio && APP.audio.ctx
            ? Math.max(0, (schedTime - APP.audio.ctx.currentTime) * 1000) : 0;
        setTimeout(function() {
            switch (pad.synth) {
                case 'SUB':   InternalSynth.triggerSub(f, v); break;
                case 'NOISE': InternalSynth.triggerNoise(f, v, p.res || 6); break;
                case 'SWEEP': InternalSynth.triggerSweep(f, v); break;
                case 'METAL': InternalSynth.triggerMetal(f, v); break;
                case 'AM':    InternalSynth.triggerAM(f, v, p.lfo || 0.8); break;
                case 'BOOM':  InternalSynth.triggerBoom(f, v); break;
            }
        }, delay);
        if (!window.audioReactiveData) window.audioReactiveData = {};
        window.audioReactiveData.padName       = kit.name + ':' + pad.label;
        window.audioReactiveData.padVol        = v;
        window.audioReactiveData.lastTriggerTs = performance.now();
    }

    function preload(kitIdx) { /* No-op: pure synthesis */ }

    function setKit(idx) {
        _activeKit = Math.max(0, Math.min(KITS.length - 1, idx | 0));
        log('KITMAN: active=' + KITS[_activeKit].name);
    }

    function getActiveKit()        { return _activeKit; }
    function getKitName(idx)       { return KITS[idx != null ? idx : _activeKit].name; }
    function getPadLabel(kit, pad) { return (KITS[kit] && KITS[kit].pads[pad]) ? KITS[kit].pads[pad].label : '---'; }
    function getKitCount()         { return KITS.length; }

    return { preload, playBuffer, setKit, getActiveKit, getKitName, getPadLabel, getKitCount, KITS };
})();



// ═══════════════════════════════════════════════════════════════
//  VNGRD GLOBAL AUDIO API
//  window.play(n, vol)    — Sampler pad by name or index
//  window.synth(t, n, v)  — InternalSynth
//  window.currentBPM      — live BPM
// ═══════════════════════════════════════════════════════════════

window.nextNoteTime   = 0;
window.currentBPM     = 120;

// GlobalClock — single AudioContext-anchored master clock
window.GlobalClock = (function() {
    var _origin = 0;
    var _beatsAtOrigin = 0;
    var _running = true;

    function _ctx() { return (typeof APP !== 'undefined' && APP.audio && APP.audio.ctx) ? APP.audio.ctx : null; }

    function bpm()  { return Math.max(20, Math.min(400, window.currentBPM || 120)); }
    function spb()  { return 60 / bpm(); }

    function now() {
        var c = _ctx();
        return c ? c.currentTime : (performance.now() / 1000);
    }

    function rebase() {
        _beatsAtOrigin = elapsedBeats();
        _origin = now();
    }

    function elapsedBeats() {
        return _beatsAtOrigin + (now() - _origin) / spb();
    }

    function timeAtBeat(beatN) {
        return _origin + (beatN - _beatsAtOrigin) * spb();
    }

    function reset() {
        _beatsAtOrigin = 0;
        _origin = now();
        window.nextNoteTime = _origin;
    }

    return {
        bpm: bpm, spb: spb, now: now, rebase: rebase,
        elapsedBeats: elapsedBeats, timeAtBeat: timeAtBeat, reset: reset,
        setRunning: function(v) { _running = !!v; }
    };
})();

window.synth = function(type, noteOrMidi, vol) {
    if (!APP.audio.ctx) igniteAudio();
    if (APP.audio.ctx && APP.audio.ctx.state === 'suspended') APP.audio.ctx.resume();
    var freq;
    if (typeof noteOrMidi === 'number') {
        freq = 440 * Math.pow(2, (noteOrMidi - 69) / 12);
    } else {
        var n = String(noteOrMidi || 'C-3').replace(/^([A-G]#?)(\d)$/, '$1-$2');
        var NF = {'C-2':65.4,'C#-2':69.3,'D-2':73.4,'D#-2':77.8,'E-2':82.4,'F-2':87.3,
            'F#-2':92.5,'G-2':98,'G#-2':103.8,'A-2':110,'A#-2':116.5,'B-2':123.5,
            'C-3':130.8,'C#-3':138.6,'D-3':146.8,'D#-3':155.6,'E-3':164.8,'F-3':174.6,
            'F#-3':185,'G-3':196,'G#-3':207.7,'A-3':220,'A#-3':233.1,'B-3':246.9,
            'C-4':261.6,'C#-4':277.2,'D-4':293.7,'D#-4':311.1,'E-4':329.6,'F-4':349.2,
            'F#-4':370,'G-4':392,'G#-4':415.3,'A-4':440,'A#-4':466.2,'B-4':493.9,
            'C-5':523.3,'C#-5':554.4,'D-5':587.3,'D#-5':622.3,'E-5':659.3,'F-5':698.5,
            'F#-5':740,'G-5':784,'G#-5':830.6,'A-5':880,'A#-5':932.3,'B-5':987.8,
            'C-6':1046.5,'D-6':1174.7,'E-6':1318.5};
        freq = NF[n] || 220;
    }
    var v = typeof vol === 'number' ? vol : 0.8;
    var t = (type || 'sub').toLowerCase();
    if      (t === 'pluck' || t === 'sweep') InternalSynth.triggerSweep(freq, v, 0x80);
    else if (t === 'sub')                    InternalSynth.triggerSub(freq, v, 0x80);
    else if (t === 'noise')                  InternalSynth.triggerNoise(freq, v, 8, 0x80);
    else if (t === 'metal')                  InternalSynth.triggerMetal(freq, v, freq * 3.1, 0x80);
    else if (t === 'am')                     InternalSynth.triggerAM(freq, v, 8, 0x80);
    else if (t === 'boom')                   InternalSynth.triggerBoom(freq, v, 0x80);
    else                                     InternalSynth.triggerSub(freq, v, 0x80);
    if (!window.audioReactiveData) window.audioReactiveData = {};
    window.audioReactiveData.synthFreq    = freq;
    window.audioReactiveData.synthType    = t;
    window.audioReactiveData.synthVol     = v;
    window.audioReactiveData.lastTriggerTs = performance.now();
    if (freq < 200) {
        if (APP && APP.vj) {
            APP.vj._seismicVel = (APP.vj._seismicVel || 0) + v * 1.2;
            APP.vj._seismicDemoUntil = performance.now() + 1500;
        }
    } else if (freq > 800 && typeof _vbActivate === 'function') {
        if (typeof _setFXBank === 'function') _setFXBank('B');
        _vbActivate('LUMA_BLOOM', false);
    }
};

window.play = function(sample, vol) {
    if (!APP.audio.ctx) igniteAudio();
    if (APP.audio.ctx && APP.audio.ctx.state === 'suspended') APP.audio.ctx.resume();
    var _PADS = ['liq1','liq2','liq3','liq4','liq5','liq6','liq7','liq8',
                 'custom1','custom2','custom3','custom4',
                 'applause','cheer','horn','boom'];
    var name = typeof sample === 'number' ? (_PADS[sample] || null) : String(sample);
    if (!name) return;
    var v = typeof vol === 'number' ? vol : 0.8;
    Sampler.trigger(name, v);
    if (!window.audioReactiveData) window.audioReactiveData = {};
    window.audioReactiveData.padName      = name;
    window.audioReactiveData.padVol       = v;
    window.audioReactiveData.lastTriggerTs = performance.now();
    var isKick = /liq[135]|boom/i.test(name);
    if (isKick && APP && APP.vj) {
        APP.vj._seismicVel = (APP.vj._seismicVel || 0) + v * 1.4;
        APP.vj._seismicDemoUntil = performance.now() + 1800;
        APP.vj._punchSpring = Math.min(1, (APP.vj._punchSpring || 0) + 0.7 * v);
        APP.vj._punchDemoUntil = performance.now() + 1800;
    } else {
        _vjHeavySync();
    }
};

// ═══════════════════════════════════════════════════════════════
//  PAD BUS — BiquadFilter lowshelf 180 Hz +10 dB
// ═══════════════════════════════════════════════════════════════
var _padBusNode = null;
function _getPadBus(ctx) {
    if (!ctx) return null;
    if (_padBusNode && _padBusNode.context === ctx && _padBusNode.context.state !== 'closed') return _padBusNode;
    try {
        var f = ctx.createBiquadFilter();
        f.type = 'lowshelf';
        f.frequency.value = 180;
        f.gain.value = 10;
        f.connect(APP.audio.duckingGain);
        _padBusNode = f;
        return f;
    } catch(e) { return null; }
}
