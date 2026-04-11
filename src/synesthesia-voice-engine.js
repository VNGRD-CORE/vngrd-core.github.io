// ─────────────────────────────────────────────────────────────────────────────
// SYNESTHESIA VOICE ENGINE  //  VNGRD-CORE  //  v3.0.0
//
// DIRECT-INJECTED BUFFER ENGINE
// All speechSynthesis removed. OS audio bypass eliminated.
//
// Cascade:
//   1. ElevenLabs v1/text-to-speech  (key rotation via VNGRD_EL_KEYS)
//   2. OpenAI tts-1-hd               (key via VNGRD_OAI_KEY)
//
// All responses decoded via audioContext.decodeAudioData() → AudioBuffer.
//
// Signal path:
//   AudioBufferSourceNode
//     → Vocal_EQ (HPF 150 Hz + Mid-boost 2.8 kHz)
//     → APP.audio.masterGain  (master FX chain)
//     → APP.audio.recorderDest (Iron-Clad Recorder tap)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // ── Key helpers ───────────────────────────────────────────────────────────
    function _getELKeys() {
        try {
            const raw = localStorage.getItem('VNGRD_EL_KEYS');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : (parsed ? [parsed] : []);
        } catch (_) { return []; }
    }

    function _getOpenAIKey() {
        try { return localStorage.getItem('VNGRD_OAI_KEY') || ''; }
        catch (_) { return ''; }
    }

    // ── ENGINE OFFLINE banner ─────────────────────────────────────────────────
    function _showOffline(detail) {
        const el = document.getElementById('sve-status');
        if (!el) return;
        el.textContent = '[ ENGINE OFFLINE ] ' + (detail || '');
        el.style.color      = '#FF0000';
        el.style.textShadow = '0 0 10px #FF0000, 0 0 20px #FF0000';
        // Also echo to ghost terminal if available
        if (typeof ghostLog === 'function') {
            ghostLog('SVE_ENGINE_OFFLINE: ' + (detail || 'API_UNAVAILABLE'), 'crit');
        }
    }

    function _clearOffline() {
        const el = document.getElementById('sve-status');
        if (!el) return;
        el.style.color      = '';
        el.style.textShadow = '';
    }

    // ── ElevenLabs fetch (key rotation) ───────────────────────────────────────
    // Keys stored as JSON array: localStorage.setItem('VNGRD_EL_KEYS', '["key1","key2"]')
    async function _fetchElevenLabs(text, voiceId) {
        const keys = _getELKeys();
        if (!keys.length) return null;

        voiceId = voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel
        let lastErr = null;

        for (const key of keys) {
            try {
                const resp = await fetch(
                    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                    {
                        method:  'POST',
                        headers: {
                            'xi-api-key':   key,
                            'Content-Type': 'application/json',
                            'Accept':       'audio/mpeg',
                        },
                        body: JSON.stringify({
                            text,
                            model_id:       'eleven_multilingual_v2',
                            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
                        }),
                    }
                );
                if (!resp.ok) { lastErr = `EL_HTTP_${resp.status}`; continue; }
                return await resp.arrayBuffer();
            } catch (e) {
                lastErr = e.message;
            }
        }

        console.warn('[SVE] ElevenLabs all keys exhausted:', lastErr);
        return null;
    }

    // ── OpenAI TTS fallback ───────────────────────────────────────────────────
    async function _fetchOpenAI(text) {
        const key = _getOpenAIKey();
        if (!key) return null;

        try {
            const resp = await fetch('https://api.openai.com/v1/audio/speech', {
                method:  'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type':  'application/json',
                },
                body: JSON.stringify({
                    model:           'tts-1-hd',
                    input:           text,
                    voice:           'alloy',
                    response_format: 'mp3',
                }),
            });
            if (!resp.ok) throw new Error(`OAI_HTTP_${resp.status}`);
            return await resp.arrayBuffer();
        } catch (e) {
            console.warn('[SVE] OpenAI TTS failed:', e.message);
            return null;
        }
    }

    // ── Vocal EQ factory ──────────────────────────────────────────────────────
    // Returns { input: AudioNode, output: AudioNode }
    function _buildVocalEQ(ctx) {
        // Stage 1: High-pass 150 Hz — cut low-end rumble
        const hpf = ctx.createBiquadFilter();
        hpf.type            = 'highpass';
        hpf.frequency.value = 150;
        hpf.Q.value         = 0.7;

        // Stage 2: Mid-boost 2.8 kHz — presence / intelligibility
        const mid = ctx.createBiquadFilter();
        mid.type            = 'peaking';
        mid.frequency.value = 2800;
        mid.gain.value      = 5;
        mid.Q.value         = 1.2;

        hpf.connect(mid);
        return { input: hpf, output: mid };
    }

    // ── Core cascade: ElevenLabs → OpenAI → decoded AudioBuffer ──────────────
    async function generateVocalBuffer(text) {
        const audio = window.APP?.audio;
        let ctx = audio?.ctx;

        if (!ctx) {
            _showOffline('NO_AUDIO_CTX');
            return null;
        }
        if (ctx.state === 'suspended') {
            try { await ctx.resume(); } catch (_) {}
        }

        // Primary: ElevenLabs
        let arrayBuf = await _fetchElevenLabs(text);

        // Secondary: OpenAI
        if (!arrayBuf) arrayBuf = await _fetchOpenAI(text);

        if (!arrayBuf) {
            _showOffline('API_UNAVAILABLE');
            return null;
        }

        try {
            // Must clone before decoding — decodeAudioData detaches the buffer
            const decoded = await ctx.decodeAudioData(arrayBuf);
            _clearOffline();
            return decoded;
        } catch (e) {
            _showOffline('DECODE_ERR: ' + e.message);
            return null;
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  SVE — Synesthesia Voice Engine
    // ═════════════════════════════════════════════════════════════════════════
    const SVE = {
        version:      '3.0.0',
        initialized:  false,
        isPlaying:    false,
        currentMood:  'CYBER',
        _wordCount:   0,
        glitchSynth:  null,
        moodEffects:  [],
        _currentSrc:  null,   // AudioBufferSourceNode currently playing
        _eq:          null,   // { input, output } — Vocal EQ nodes
        _eqCtx:       null,   // AudioContext the EQ was built for
        _glitchTimer: null,
    };

    // ── UI helpers ────────────────────────────────────────────────────────────
    SVE.updateStatus = function (msg) {
        const el = document.getElementById('sve-status');
        if (el) { el.textContent = msg; el.style.color = ''; el.style.textShadow = ''; }
    };
    SVE.updateDot = function (on) {
        const d = document.getElementById('sve-dot');
        if (d) d.classList.toggle('off', !on);
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    SVE.init = async function () {
        if (SVE.initialized) return;
        const Tone = window.Tone;
        if (!Tone) { SVE.updateStatus('ERR: TONE.JS MISSING'); return; }

        await Tone.start();

        SVE.glitchSynth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope:   { attack: 0.001, decay: 0.022, sustain: 0, release: 0.018 },
            volume:     -20,
        });

        SVE.initialized = true;
        SVE.updateDot(true);
        SVE.setMood(SVE.currentMood);
        SVE.updateStatus('READY // BUFFER_ENGINE_v3');
    };

    // ── Mood ──────────────────────────────────────────────────────────────────
    SVE.setMood = function (mood) {
        const Tone = window.Tone;
        if (!Tone || !SVE.initialized) { SVE.currentMood = mood; return; }

        SVE.moodEffects.forEach(e => { try { e.dispose(); } catch (_) {} });
        SVE.moodEffects = [];
        if (SVE.glitchSynth) SVE.glitchSynth.disconnect();
        SVE.currentMood = mood;

        switch (mood) {
            case 'CLEAN': {
                const mute = new Tone.Gain(0);
                if (SVE.glitchSynth) SVE.glitchSynth.connect(mute);
                mute.toDestination();
                SVE.moodEffects = [mute];
                break;
            }
            case 'CYBER': {
                const bpf  = new Tone.Filter({ frequency: 4400, type: 'bandpass', Q: 5 });
                const ppd  = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.22, wet: 0.5 });
                const gain = new Tone.Gain(0.9);
                if (SVE.glitchSynth) SVE.glitchSynth.chain(bpf, ppd, gain, Tone.Destination);
                SVE.moodEffects = [bpf, ppd, gain];
                if (SVE.glitchSynth) SVE.glitchSynth.volume.value = -14;
                break;
            }
            case 'GHOST': {
                const lpf  = new Tone.Filter({ frequency: 900, type: 'lowpass', Q: 0.6 });
                const fbd  = new Tone.FeedbackDelay({ delayTime: 0.44, feedback: 0.68, wet: 0.65 });
                const gain = new Tone.Gain(0.85);
                if (SVE.glitchSynth) SVE.glitchSynth.chain(lpf, fbd, gain, Tone.Destination);
                SVE.moodEffects = [lpf, fbd, gain];
                if (SVE.glitchSynth) SVE.glitchSynth.volume.value = -16;
                break;
            }
            case 'MONSTER': {
                const dist = new Tone.Distortion(0.75);
                const lpf  = new Tone.Filter({ frequency: 380, type: 'lowpass', Q: 2.2 });
                const gain = new Tone.Gain(1.0);
                if (SVE.glitchSynth) SVE.glitchSynth.chain(dist, lpf, gain, Tone.Destination);
                SVE.moodEffects = [dist, lpf, gain];
                if (SVE.glitchSynth) SVE.glitchSynth.volume.value = -10;
                break;
            }
        }

        ['CLEAN','CYBER','GHOST','MONSTER'].forEach(m => {
            const btn = document.getElementById('sve-mood-' + m.toLowerCase());
            if (btn) btn.classList.toggle('active-mode', m === mood);
        });
        SVE.updateStatus('MODE // ' + mood);
    };

    // ── Glitch trigger ────────────────────────────────────────────────────────
    SVE.triggerGlitch = function (forceTest) {
        if (!SVE.initialized || !SVE.glitchSynth) return;
        if (SVE.currentMood === 'CLEAN' && !forceTest) return;

        const freqs = {
            CYBER:   [4400, 5200, 3800, 6000],
            GHOST:   [260,  310,  220,  340],
            MONSTER: [80,   100,  65,   120],
            CLEAN:   [1000, 1200, 800,  1400],
        };
        const pool = freqs[SVE.currentMood] || [1000];
        const freq = pool[SVE._wordCount % pool.length];
        SVE._wordCount++;

        const origVol = SVE.glitchSynth.volume.value;
        if (forceTest && SVE.currentMood === 'CLEAN') SVE.glitchSynth.volume.value = -18;
        SVE.glitchSynth.triggerAttackRelease(freq, '16n', window.Tone.now());
        if (forceTest && SVE.currentMood === 'CLEAN') {
            setTimeout(() => { if (SVE.glitchSynth) SVE.glitchSynth.volume.value = origVol; }, 200);
        }
    };

    // ── Speak — Buffer Engine ─────────────────────────────────────────────────
    SVE.speak = async function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO SCRIPT'); return; }
        if (!SVE.initialized) { await SVE.init(); }

        SVE.stop(); // cancel any in-flight playback
        SVE._wordCount = 0;
        SVE.isPlaying  = true;
        SVE.updateDot(true);

        const btn = document.getElementById('sve-speak-btn');
        if (btn) btn.textContent = '■ STOP';
        SVE.updateStatus('▶ FETCHING VOCAL BUFFER...');

        // ── Fetch & decode ────────────────────────────────────────────────────
        const audioBuf = await generateVocalBuffer(text);
        if (!audioBuf) {
            SVE.isPlaying = false;
            SVE.updateDot(false);
            if (btn) btn.textContent = '▶ SYNTH VOICE';
            return;
        }

        const audio = window.APP?.audio;
        const ctx   = audio?.ctx;
        if (!ctx) {
            SVE.isPlaying = false;
            SVE.updateDot(false);
            if (btn) btn.textContent = '▶ SYNTH VOICE';
            _showOffline('NO_AUDIO_CTX');
            return;
        }

        // ── Ensure Vocal EQ is built for this context ─────────────────────────
        if (!SVE._eq || SVE._eqCtx !== ctx) {
            SVE._eq    = _buildVocalEQ(ctx);
            SVE._eqCtx = ctx;
        }

        // ── Ensure recorderDest exists ────────────────────────────────────────
        // (ensureAudioChain() creates it; this is a safety fallback)
        if (audio && !audio.recorderDest) {
            audio.recorderDest = ctx.createMediaStreamDestination();
            audio.masterGain?.connect(audio.recorderDest);
        }

        // ── Wire signal path ──────────────────────────────────────────────────
        //  source → EQ_HPF → EQ_Mid → masterGain   (master FX + output)
        //                           → recorderDest  (Iron-Clad Recorder tap)
        //                           → ctx.destination (direct monitor)
        const eqOut = SVE._eq.output;
        if (audio?.masterGain)    eqOut.connect(audio.masterGain);
        if (audio?.recorderDest)  eqOut.connect(audio.recorderDest);

        // ── Create & start source ─────────────────────────────────────────────
        const source = ctx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(SVE._eq.input);
        SVE._currentSrc = source;

        SVE.updateStatus('▶ ' + SVE.currentMood + ' // BUFFER_PLAYBACK');

        // Glitch bursts approximate word boundaries (~0.5 s cadence)
        SVE._glitchTimer = setInterval(() => {
            if (!SVE.isPlaying) { clearInterval(SVE._glitchTimer); return; }
            SVE.triggerGlitch();
        }, 500);

        source.onended = () => {
            clearInterval(SVE._glitchTimer);
            SVE.isPlaying   = false;
            SVE._currentSrc = null;
            SVE.updateDot(false);
            if (btn) btn.textContent = '▶ SYNTH VOICE';
            SVE.updateStatus('DONE // ' + SVE.currentMood);
            // Detach EQ output to avoid accumulating connections
            try { eqOut.disconnect(audio.masterGain);   } catch (_) {}
            try { eqOut.disconnect(audio.recorderDest); } catch (_) {}
        };

        source.start(ctx.currentTime);
    };

    // ── Stop ──────────────────────────────────────────────────────────────────
    SVE.stop = function () {
        clearInterval(SVE._glitchTimer);
        if (SVE._currentSrc) {
            try { SVE._currentSrc.stop(); } catch (_) {}
            SVE._currentSrc = null;
        }
        SVE.isPlaying = false;
        const btn = document.getElementById('sve-speak-btn');
        if (btn) btn.textContent = '▶ SYNTH VOICE';
        SVE.updateStatus('STOPPED');
        SVE.updateDot(false);
    };

    // ── Trailer render (async buffer export) ─────────────────────────────────
    SVE.renderTrailerAudio = async function (text) {
        SVE.updateStatus('RENDERING TRAILER BUFFER...');
        const buf = await generateVocalBuffer(text);
        if (!buf) return;
        SVE.updateStatus('TRAILER_BUFFER_READY // ' + buf.duration.toFixed(2) + 's');
    };

    // ── Expose ────────────────────────────────────────────────────────────────
    window.SVE                 = SVE;
    window.generateVocalBuffer = generateVocalBuffer;

})();
