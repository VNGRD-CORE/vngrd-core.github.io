// ─────────────────────────────────────────────────────────────────────────────
// SYNESTHESIA VOICE ENGINE  //  VNGRD-CORE  //  v3.0.0
//
// PROVIDER CASCADE:  ElevenLabs  →  OpenAI TTS  →  Web Speech API (fallback)
//
// API audio is decoded in the VNGRD AudioContext and routed through a
// broadcast-quality EQ chain → APP.audio.masterGain → Iron-Clad Recorder.
// Keys stored in localStorage: vngrd_el_key  (comma-sep for rotation)
//                               vngrd_oai_key
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // ── ElevenLabs voice IDs (pre-built free-tier voices) ─────────────────────
    const EL_VOICES = {
        CLEAN:   '21m00Tcm4TlvDq8ikWAM',  // Rachel  – warm, clear female
        CYBER:   'TxGEqnHWrfWFTfGW9XjX',  // Josh    – articulate, crisp male
        GHOST:   'ErXwobaYiN019PkySvjV',  // Antoni  – warm, intimate
        MONSTER: 'VR6AewLTigWG4xSOukaG',  // Arnold  – deep, authoritative
    };

    // ── OpenAI TTS voices ─────────────────────────────────────────────────────
    const OAI_VOICES = {
        CLEAN:   'nova',    // warm, clear female
        CYBER:   'echo',    // crisp, forward male
        GHOST:   'shimmer', // light, ethereal female
        MONSTER: 'onyx',    // deep, powerful male
    };

    const SVE = {
        version: '3.0.0',
        initialized: false,
        isPlaying: false,
        currentMood: 'CYBER',
        glitchSynth: null,
        moodEffects: [],
        _lastDetectedLang: null,
        _currentSources: [],
        _glitchInterval: null,
        _elKeyIndex: 0,
    };

    // ── Status / dot ──────────────────────────────────────────────────────────
    SVE.updateStatus = function (msg) {
        const el = document.getElementById('sve-status');
        if (el) el.textContent = msg;
        if (typeof log === 'function') log('SVE: ' + msg);
    };
    SVE.updateDot = function (on) {
        const d = document.getElementById('sve-dot');
        if (d) d.classList.toggle('off', !on);
    };

    // ── Key storage ───────────────────────────────────────────────────────────
    SVE._getELKeys = function () {
        return (localStorage.getItem('vngrd_el_key') || '')
            .split(',').map(k => k.trim()).filter(Boolean);
    };
    SVE._getOAIKey = function () {
        return (localStorage.getItem('vngrd_oai_key') || '').trim();
    };
    SVE._saveKeys = function () {
        const el  = document.getElementById('sve-el-key');
        const oai = document.getElementById('sve-oai-key');
        if (el  && el.value.trim())  localStorage.setItem('vngrd_el_key',  el.value.trim());
        if (oai && oai.value.trim()) localStorage.setItem('vngrd_oai_key', oai.value.trim());
        SVE.updateStatus('KEYS SAVED');
        setTimeout(() => SVE.updateStatus('STANDBY'), 1500);
    };
    SVE._loadKeyUI = function () {
        const el  = document.getElementById('sve-el-key');
        const oai = document.getElementById('sve-oai-key');
        if (el)  el.value  = localStorage.getItem('vngrd_el_key')  || '';
        if (oai) oai.value = localStorage.getItem('vngrd_oai_key') || '';
    };

    // ── Language detection ────────────────────────────────────────────────────
    SVE._detectLanguage = function (text) {
        if (!text || text.trim().length < 6) return null;
        if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
        if (/[\u3040-\u30ff]/.test(text)) return 'ja';
        if (/[\uac00-\ud7af]/.test(text)) return 'ko';
        if (/[\u0600-\u06ff]/.test(text)) return 'ar';
        if (/[\u0400-\u04ff]/.test(text)) return 'ru';
        if (/[\u0900-\u097f]/.test(text)) return 'hi';
        if (/[äöüÄÖÜß]/.test(text)) return 'de';
        if (/ñ/.test(text))          return 'es';
        if (/[ãõÃÕ]/.test(text))     return 'pt';
        if (/[ąćęłńśźż]/i.test(text)) return 'pl';

        const t = text.toLowerCase();
        const words = t.match(/\b[a-zàáâãäåæçèéêëìíîïòóôöùúûü]+\b/g) || [];
        if (words.length < 3) return null;
        const freq = list => words.filter(w => list.includes(w)).length / words.length;
        const scores = {
            'it': freq(['il','la','le','gli','di','e','un','per','non','che','sono','come']),
            'fr': freq(['le','la','les','de','du','je','il','est','que','et','pas','dans']),
            'es': freq(['el','la','los','de','en','que','no','es','por','con','una','se']),
            'pt': freq(['o','a','os','as','um','de','do','que','não','em','por','com','é']),
            'nl': freq(['de','het','een','van','in','is','op','en','dat','die','zijn']),
        };
        const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        return (best && best[1] >= 0.03) ? best[0] : 'en';
    };

    // ── Text chunking ─────────────────────────────────────────────────────────
    SVE._chunkText = function (text, maxLen) {
        if (text.length <= maxLen) return [text];
        const chunks = [];
        // Split on sentence-ending punctuation
        const sentences = text.match(/[^.!?…]+[.!?…]+['"]?\s*|[^.!?…]+$/g) || [text];
        let cur = '';
        for (const s of sentences) {
            if (cur.length + s.length > maxLen && cur.length > 0) {
                chunks.push(cur.trim());
                cur = s;
            } else {
                cur += s;
            }
        }
        if (cur.trim()) chunks.push(cur.trim());
        return chunks.length ? chunks : [text];
    };

    // ── Broadcast EQ builder (pure Web Audio, per mood) ──────────────────────
    // Returns { input: AudioNode, output: AudioNode }
    SVE._buildMoodEQ = function (ctx, mood, playbackRate) {
        const nodes = [];
        const mk = (type, freq, gain, Q) => {
            const f = ctx.createBiquadFilter();
            f.type = type;
            if (freq !== undefined) f.frequency.value = freq;
            if (gain  !== undefined) f.gain.value = gain;
            if (Q     !== undefined) f.Q.value = Q;
            nodes.push(f);
            return f;
        };

        let input, output;

        if (mood === 'CLEAN') {
            // Near-flat broadcast: HPF rumble removal + gentle de-ess
            const hpf  = mk('highpass', 60, 0, 0.7);
            const deess = mk('peaking', 7500, -1.5, 3.5);
            hpf.connect(deess);
            input = hpf; output = deess;

        } else if (mood === 'CYBER') {
            // HPF + presence boost (3kHz) + air shelf (10kHz)
            const hpf      = mk('highpass', 80,   0,    0.7);
            const presence = mk('peaking',  3000, 3.0,  2.0);
            const air      = mk('highshelf',10000, 2.0);
            hpf.connect(presence); presence.connect(air);
            input = hpf; output = air;

        } else if (mood === 'GHOST') {
            // Low-mid scoop + parallel pre-delays (45ms + 82ms) for ghostly space
            const hpf   = mk('highpass', 60,  0,   0.7);
            const scoop = mk('peaking',  500, -4,  1.5);
            hpf.connect(scoop);

            // Parallel delay lines
            const wet1 = ctx.createGain(); wet1.gain.value = 0.13; nodes.push(wet1);
            const wet2 = ctx.createGain(); wet2.gain.value = 0.09; nodes.push(wet2);
            const dry  = ctx.createGain(); dry.gain.value  = 0.85; nodes.push(dry);
            const del1 = ctx.createDelay(1.0); del1.delayTime.value = 0.045; nodes.push(del1);
            const del2 = ctx.createDelay(1.0); del2.delayTime.value = 0.082; nodes.push(del2);
            const mix  = ctx.createGain(); mix.gain.value = 1.0; nodes.push(mix);

            scoop.connect(dry);    dry.connect(mix);
            scoop.connect(del1);   del1.connect(wet1); wet1.connect(mix);
            scoop.connect(del2);   del2.connect(wet2); wet2.connect(mix);
            input = hpf; output = mix;

        } else if (mood === 'MONSTER') {
            // Bass boost (120Hz) + mild tanh saturation + high roll-off
            const hpf  = mk('highpass', 40,   0,   0.7);
            const bass = mk('peaking',  120,  5.5, 1.5);
            const lpf  = mk('lowpass',  6000, 0,   0.7);

            // Tanh soft-saturation shaper
            const sat = ctx.createWaveShaper();
            const SZ = 512, curve = new Float32Array(SZ);
            for (let i = 0; i < SZ; i++) {
                const x = (2 * i / SZ - 1);
                curve[i] = Math.tanh(x * 2.8) / Math.tanh(2.8);
            }
            sat.curve = curve;
            sat.oversample = '4x';
            nodes.push(sat);

            hpf.connect(bass); bass.connect(sat); sat.connect(lpf);
            input = hpf; output = lpf;
        }

        return { input, output, nodes };
    };

    // ── Core: decode ArrayBuffer → EQ chain → VNGRD capture ─────────────────
    SVE._playDecodedAudio = function (arrayBuffer, mood, onEnded) {
        const rawCtx = SVE._getRawCtx();
        if (!rawCtx) { if (onEnded) onEnded(); return; }

        rawCtx.decodeAudioData(arrayBuffer.slice(0), function (audioBuffer) {
            const source = rawCtx.createBufferSource();
            source.buffer = audioBuffer;

            // playbackRate shift per mood (for Web Speech parity)
            if (mood === 'GHOST')   source.playbackRate.value = 0.96;
            if (mood === 'MONSTER') source.playbackRate.value = 0.88;

            const eq = SVE._buildMoodEQ(rawCtx, mood, source.playbackRate.value);
            const masterGain = rawCtx.createGain();
            masterGain.gain.value = 0.92;

            source.connect(eq.input);
            eq.output.connect(masterGain);

            // Route into VNGRD chain (Iron-Clad Recorder will capture this)
            const dest = SVE._getVNGRDDest() || rawCtx.destination;
            masterGain.connect(dest);

            source.onended = function () {
                try { masterGain.disconnect(); eq.nodes.forEach(n => { try { n.disconnect(); } catch(_){} }); } catch(_){}
                SVE._currentSources = SVE._currentSources.filter(s => s !== source);
                if (onEnded) onEnded();
            };

            SVE._currentSources.push(source);
            source.start(0);

            // Simulate word boundaries for glitch synth
            const wordCount = (audioBuffer.duration > 0)
                ? Math.max(1, Math.round(audioBuffer.duration / 0.45))
                : 1;
            const interval = (audioBuffer.duration * 1000) / wordCount;
            const iv = setInterval(() => SVE.triggerGlitch(), interval);
            setTimeout(() => clearInterval(iv), audioBuffer.duration * 1000 + 200);

        }, function (err) {
            SVE.updateStatus('DECODE ERR');
            if (onEnded) onEnded();
        });
    };

    SVE._getRawCtx = function () {
        if (window.APP && APP.audio && APP.audio.ctx) return APP.audio.ctx;
        if (window.Tone) return Tone.getContext().rawContext;
        return null;
    };
    SVE._getVNGRDDest = function () {
        if (!window.APP || !APP.audio) return null;
        return APP.audio.duckingGain || APP.audio.masterGain || APP.audio.compressor || null;
    };

    // ── ElevenLabs provider ───────────────────────────────────────────────────
    SVE._fetchElevenLabs = async function (text, key) {
        const voiceId = EL_VOICES[SVE.currentMood] || EL_VOICES.CLEAN;
        const resp = await fetch(
            'https://api.elevenlabs.io/v1/text-to-speech/' + voiceId + '/stream',
            {
                method: 'POST',
                headers: {
                    'xi-api-key': key,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg',
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: 0.45,
                        similarity_boost: 0.82,
                        style: 0.38,
                        use_speaker_boost: true,
                    },
                }),
            }
        );
        if (!resp.ok) throw new Error('EL ' + resp.status);
        return resp.arrayBuffer();
    };

    // ── OpenAI TTS provider ───────────────────────────────────────────────────
    SVE._fetchOpenAI = async function (text, key) {
        const voice = OAI_VOICES[SVE.currentMood] || 'nova';
        const resp = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + key,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'tts-1-hd',
                input: text,
                voice: voice,
                response_format: 'mp3',
                speed: SVE.currentMood === 'MONSTER' ? 0.85
                     : SVE.currentMood === 'GHOST'   ? 0.92
                     : 1.0,
            }),
        });
        if (!resp.ok) throw new Error('OAI ' + resp.status);
        return resp.arrayBuffer();
    };

    // ── Web Speech fallback ───────────────────────────────────────────────────
    SVE._speakBrowser = function (text, onEnded) {
        const voices = window.speechSynthesis.getVoices();
        const utter  = new SpeechSynthesisUtterance(text);

        // Pick best available voice
        const tiers = [
            v => /^Google\s/.test(v.name),
            v => /Neural|Natural/i.test(v.name),
            v => ['Daniel','Samantha','Karen','Moira','Oliver','Fiona'].some(n => v.name.includes(n)),
            v => true,
        ];
        let voice = null;
        for (const t of tiers) { voice = voices.find(t); if (voice) break; }
        if (voice) { utter.voice = voice; utter.lang = voice.lang; }

        switch (SVE.currentMood) {
            case 'CLEAN':   utter.rate = 0.88; utter.pitch = 1.00; break;
            case 'CYBER':   utter.rate = 0.92; utter.pitch = 1.15; break;
            case 'GHOST':   utter.rate = 0.74; utter.pitch = 0.75; break;
            case 'MONSTER': utter.rate = 0.67; utter.pitch = 0.45; break;
        }

        utter.onboundary = e => { if (e.name === 'word') SVE.triggerGlitch(); };
        utter.onend   = () => { if (onEnded) onEnded(); };
        utter.onerror = () => { if (onEnded) onEnded(); };
        window.speechSynthesis.speak(utter);
    };

    // ── Main cascade: speak one chunk ─────────────────────────────────────────
    SVE._speakChunk = async function (text, onEnded) {
        const elKeys = SVE._getELKeys();
        const oaiKey = SVE._getOAIKey();

        // 1 — ElevenLabs (rotate through keys)
        for (let i = 0; i < elKeys.length; i++) {
            const keyIdx = (SVE._elKeyIndex + i) % elKeys.length;
            try {
                SVE.updateStatus('EL // ' + SVE.currentMood + '…');
                const buf = await SVE._fetchElevenLabs(text, elKeys[keyIdx]);
                SVE._elKeyIndex = (keyIdx + 1) % elKeys.length;
                SVE._playDecodedAudio(buf, SVE.currentMood, onEnded);
                return;
            } catch (e) {
                const msg = e.message || '';
                if (msg.includes('401') || msg.includes('403')) continue; // bad key, try next
                // 429 / network errors — fall through to next provider
                break;
            }
        }

        // 2 — OpenAI TTS
        if (oaiKey) {
            try {
                SVE.updateStatus('OAI // ' + SVE.currentMood + '…');
                const buf = await SVE._fetchOpenAI(text, oaiKey);
                SVE._playDecodedAudio(buf, SVE.currentMood, onEnded);
                return;
            } catch (e) { /* fall through */ }
        }

        // 3 — Browser Web Speech fallback
        SVE.updateStatus('BROWSER // ' + SVE.currentMood + '…');
        SVE._speakBrowser(text, onEnded);
    };

    // ── Public speak (handles chunking + sequential playback) ─────────────────
    SVE.speak = async function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO SCRIPT'); return; }
        if (!SVE.initialized) { await SVE.init(); }

        SVE.stop(true); // stop previous, silent
        SVE.isPlaying = true;
        SVE.updateDot(true);

        const lang = SVE._detectLanguage(text);
        if (lang) SVE._lastDetectedLang = lang;

        const chunks = SVE._chunkText(text.trim(), 900);
        let chunkIdx = 0;

        const btn = document.getElementById('sve-speak-btn');
        if (btn) btn.textContent = '■ STOP';
        SVE.updateStatus('▶ ' + SVE.currentMood
            + (lang ? ' · ' + lang.toUpperCase() : '')
            + (chunks.length > 1 ? ' [1/' + chunks.length + ']' : '') + '…');

        const playNext = async () => {
            if (!SVE.isPlaying || chunkIdx >= chunks.length) {
                SVE._onFinished();
                return;
            }
            const ci = chunkIdx++;
            if (chunks.length > 1) {
                SVE.updateStatus('▶ ' + SVE.currentMood + ' [' + (ci+1) + '/' + chunks.length + ']…');
            }
            await SVE._speakChunk(chunks[ci], playNext);
        };

        await playNext();
    };

    SVE._onFinished = function () {
        SVE.isPlaying = false;
        const btn = document.getElementById('sve-speak-btn');
        if (btn) btn.textContent = '▶ SPEAK';
        SVE.updateStatus('DONE // ' + SVE.currentMood);
        SVE.updateDot(false);
    };

    SVE.stop = function (silent) {
        window.speechSynthesis.cancel();
        SVE._currentSources.forEach(s => { try { s.stop(); } catch (_) {} });
        SVE._currentSources = [];
        if (SVE._glitchInterval) { clearInterval(SVE._glitchInterval); SVE._glitchInterval = null; }
        SVE.isPlaying = false;
        if (!silent) {
            const btn = document.getElementById('sve-speak-btn');
            if (btn) btn.textContent = '▶ SPEAK';
            SVE.updateStatus('STOPPED');
            SVE.updateDot(false);
        }
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    SVE.init = async function () {
        if (SVE.initialized) return;
        const Tone = window.Tone;
        if (!Tone) { SVE.updateStatus('ERR: TONE.JS NOT LOADED'); return; }

        if (window.APP && APP.audio) {
            if (typeof ensureAudioChain === 'function') ensureAudioChain();
            const vngrdCtx = APP.audio.ctx;
            if (vngrdCtx && vngrdCtx.state !== 'closed') {
                try { Tone.setContext(new Tone.Context({ context: vngrdCtx, lookAhead: 0.1 })); }
                catch (_) {}
            }
        }

        await Tone.start();

        SVE.glitchSynth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.022, sustain: 0, release: 0.018 },
            volume: -20,
        });

        SVE._bridgeToVNGRD();
        SVE.initialized = true;
        SVE.setMood(SVE.currentMood);
        SVE._loadKeyUI();
        SVE.updateStatus('READY // v3');
    };

    SVE._bridgeToVNGRD = function () {
        if (!window.APP || !APP.audio || !window.Tone) return;
        const dest = SVE._getVNGRDDest();
        if (!dest) return;
        try {
            Tone.getDestination().disconnect();
            Tone.getDestination().connect(dest);
        } catch (_) {}
    };

    // ── Mood (Tone.js glitch synth character per mode) ────────────────────────
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
                mute.connect(Tone.Destination);
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
    SVE._wordCount = 0;
    SVE.triggerGlitch = function (forceTest) {
        if (!SVE.initialized) return;
        const Tone = window.Tone;
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

        const origVol = SVE.glitchSynth ? SVE.glitchSynth.volume.value : -20;
        if (forceTest && SVE.currentMood === 'CLEAN' && SVE.glitchSynth) {
            SVE.glitchSynth.volume.value = -18;
        }
        if (SVE.glitchSynth) SVE.glitchSynth.triggerAttackRelease(freq, '16n', Tone.now());
        if (forceTest && SVE.currentMood === 'CLEAN') {
            setTimeout(() => { if (SVE.glitchSynth) SVE.glitchSynth.volume.value = origVol; }, 200);
        }
    };

    window.SVE = SVE;
})();
