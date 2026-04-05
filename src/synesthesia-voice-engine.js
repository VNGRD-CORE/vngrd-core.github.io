// ─────────────────────────────────────────────────────────────────────────────
// SYNESTHESIA VOICE ENGINE  //  VNGRD-CORE  //  v2.1.0
//
// KEY ARCHITECTURE:
// - Tone.js is initialized on VNGRD's APP.audio.ctx so effects are captured
//   by the VNGRD Iron-Clad Recorder automatically
// - Tone output is routed into APP.audio.masterGain (same chain as music bus)
// - speechSynthesis voice goes to OS audio (browser limitation — unavoidable)
//   but pitch/rate are set per-mode so each mode sounds distinctly different
// - Language of the typed script is auto-detected on each SPEAK press
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const SVE = {
        version: '2.1.0',
        initialized: false,
        isPlaying: false,
        currentMood: 'CYBER',
        preferredVoice: null,
        wordCount: 0,
        glitchSynth: null,
        moodEffects: [],
        _lastDetectedLang: null,
    };

    // ── UI ─────────────────────────────────────────────────────────────────────
    SVE.updateStatus = function (msg) {
        const el = document.getElementById('sve-status');
        if (el) el.textContent = msg;
        if (typeof log === 'function') log('SVE: ' + msg);
    };
    SVE.updateDot = function (on) {
        const d = document.getElementById('sve-dot');
        if (d) d.classList.toggle('off', !on);
    };

    // ── Language detection (no external API) ──────────────────────────────────
    // Uses character-set fingerprints + function-word frequency scoring.
    SVE._detectLanguage = function (text) {
        if (!text || text.trim().length < 6) return null;

        // Non-Latin scripts — character range is unambiguous
        if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
        if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP';
        if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR';
        if (/[\u0600-\u06ff]/.test(text)) return 'ar-SA';
        if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU';
        if (/[\u0590-\u05ff]/.test(text)) return 'he-IL';
        if (/[\u0900-\u097f]/.test(text)) return 'hi-IN';

        // Latin diacritics — quick wins
        if (/[äöüÄÖÜß]/.test(text)) return 'de-DE';
        if (/ñ/.test(text))           return 'es-ES';
        if (/[ãõÃÕ]/.test(text))      return 'pt-BR';
        if (/[ąćęłńśźżĄĆĘŁŃŚŹŻ]/.test(text)) return 'pl-PL';
        if (/[åøÅØ]/.test(text))      return 'da-DK';
        if (/[åÅ]/.test(text))        return 'sv-SE';

        // Function-word scoring for similar Latin languages
        const t = text.toLowerCase();
        const words = t.match(/\b[a-zàáâãäåæçèéêëìíîïðñòóôõöùúûüý]+\b/g) || [];
        if (words.length < 3) return null;

        const freq = (list) => words.filter(w => list.includes(w)).length / words.length;

        const scores = {
            'it-IT': freq(['il','la','le','gli','di','e','un','una','per','non','che','sono','come','ho','nei','delle']),
            'fr-FR': freq(['le','la','les','de','du','des','je','tu','il','est','que','et','pas','une','dans','avec']),
            'es-ES': freq(['el','la','los','de','en','que','no','es','por','con','del','una','se','su','al','yo']),
            'pt-BR': freq(['o','a','os','as','um','de','do','da','que','não','em','por','com','para','é','ao']),
            'nl-NL': freq(['de','het','een','van','in','is','op','en','dat','die','te','zijn','ook','voor','aan']),
        };

        const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        // Only commit if score is meaningful (≥3% of words matched)
        return (best && best[1] >= 0.03) ? best[0] : null;
    };

    // ── Voice selection ────────────────────────────────────────────────────────
    SVE._findBestVoice = function (lang) {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;

        const target = lang || SVE._lastDetectedLang;

        // If a specific language is requested, filter to that language first
        const pool = target
            ? voices.filter(v => v.lang === target || v.lang.startsWith(target.split('-')[0]))
            : voices;

        // Tier priority within pool
        const tiers = [
            v => /^Google\s/.test(v.name),                            // Google TTS (best in Chrome)
            v => /Microsoft.*Natural|Microsoft.*Neural/i.test(v.name), // MS Neural (Edge)
            v => ['Daniel','Samantha','Karen','Victoria','Thomas',
                  'Reed','Oliver','Moira','Rishi','Fiona'].some(n => v.name.includes(n)),
            v => /Microsoft/.test(v.name),
            v => true,                                                  // any in pool
        ];

        let found = null;
        for (const tier of tiers) {
            found = pool.find(tier);
            if (found) break;
        }

        // Fallback to English if nothing found for the detected language
        if (!found && target) {
            const engPool = voices.filter(v => v.lang.startsWith('en'));
            for (const tier of tiers) { found = engPool.find(tier); if (found) break; }
        }

        if (found) {
            SVE.preferredVoice = found;
            SVE.updateStatus('VOICE // ' + found.name.slice(0, 24).toUpperCase());
        }
    };

    // ── Init — bridges Tone.js into VNGRD's AudioContext ─────────────────────
    SVE.init = async function () {
        if (SVE.initialized) return;
        const Tone = window.Tone;
        if (!Tone) { SVE.updateStatus('ERR: TONE.JS NOT LOADED'); return; }

        // ── Share VNGRD's AudioContext so effects are captured by Iron-Clad Recorder
        if (window.APP && APP.audio) {
            if (typeof ensureAudioChain === 'function') ensureAudioChain();
            const vngrdCtx = APP.audio.ctx;
            if (vngrdCtx && vngrdCtx.state !== 'closed') {
                try {
                    Tone.setContext(new Tone.Context({ context: vngrdCtx, lookAhead: 0.1 }));
                } catch (_) { /* already set or unsupported */ }
            }
        }

        await Tone.start();

        // ── Glitch synth: short sine pulse ────────────────────────────────────
        // Sine = "digital tick", not alien bleep. Volume set per mode in setMood.
        SVE.glitchSynth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.022, sustain: 0, release: 0.018 },
            volume: -20,
        });

        SVE.initialized = true;
        SVE.updateDot(true);

        // ── Route Tone.js output into VNGRD master gain (captured by recorder) ─
        SVE._bridgeToVNGRD();

        SVE._findBestVoice();
        window.speechSynthesis.onvoiceschanged = () => SVE._findBestVoice(SVE._lastDetectedLang);

        SVE.setMood(SVE.currentMood);
    };

    SVE._bridgeToVNGRD = function () {
        if (!window.APP || !APP.audio) return;
        const Tone = window.Tone;
        // Prefer the node deepest in the chain before the recorder tap
        const node = APP.audio.duckingGain || APP.audio.masterGain || APP.audio.compressor || APP.audio.analyzer;
        if (!node) return;
        try {
            Tone.getDestination().disconnect();
            Tone.getDestination().connect(node);
            if (typeof log === 'function') log('SVE: bridged → VNGRD audio chain');
        } catch (e) { /* will still play through Tone's own ctx.destination fallback */ }
    };

    // ── Mood system ───────────────────────────────────────────────────────────
    // Each mode sets:
    //  • Tone.js effects chain (shapes the glitch character)
    //  • glitchSynth volume (so modes are clearly audible)
    //  • speechSynthesis pitch + rate (dramatic differences per mode)
    SVE.setMood = function (mood) {
        const Tone = window.Tone;
        if (!Tone || !SVE.initialized) { SVE.currentMood = mood; return; }

        SVE.moodEffects.forEach(e => { try { e.dispose(); } catch (_) {} });
        SVE.moodEffects = [];
        SVE.glitchSynth.disconnect();
        SVE.currentMood = mood;

        switch (mood) {
            case 'CLEAN': {
                // Absolute silence from Tone.js — zero overhead
                const mute = new Tone.Gain(0);
                SVE.glitchSynth.connect(mute);
                mute.connect(Tone.Destination);
                SVE.moodEffects = [mute];
                SVE.glitchSynth.volume.value = -Infinity;
                break;
            }
            case 'CYBER': {
                // Sharp digital tick: narrow bandpass → stereo shimmer
                const bpf  = new Tone.Filter({ frequency: 4400, type: 'bandpass', Q: 5 });
                const ppd  = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.22, wet: 0.5 });
                const gain = new Tone.Gain(0.9);
                SVE.glitchSynth.chain(bpf, ppd, gain, Tone.Destination);
                SVE.moodEffects = [bpf, ppd, gain];
                SVE.glitchSynth.volume.value = -14; // clearly audible
                break;
            }
            case 'GHOST': {
                // Low atmospheric whoosh: lowpass → long echo tail
                const lpf  = new Tone.Filter({ frequency: 900, type: 'lowpass', Q: 0.6 });
                const fbd  = new Tone.FeedbackDelay({ delayTime: 0.44, feedback: 0.68, wet: 0.65 });
                const gain = new Tone.Gain(0.85);
                SVE.glitchSynth.chain(lpf, fbd, gain, Tone.Destination);
                SVE.moodEffects = [lpf, fbd, gain];
                SVE.glitchSynth.volume.value = -16;
                break;
            }
            case 'MONSTER': {
                // Sub-bass thump: heavy distortion → deep lowpass
                const dist = new Tone.Distortion(0.75);
                const lpf  = new Tone.Filter({ frequency: 380, type: 'lowpass', Q: 2.2 });
                const gain = new Tone.Gain(1.0);
                SVE.glitchSynth.chain(dist, lpf, gain, Tone.Destination);
                SVE.moodEffects = [dist, lpf, gain];
                SVE.glitchSynth.volume.value = -10; // prominent thump
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
        if (!SVE.initialized) return;
        const Tone = window.Tone;

        if (SVE.currentMood === 'CLEAN' && !forceTest) return;

        // Frequency palette per mood — rotates to avoid machine-gun repetition
        const freqs = {
            CYBER:   [4400, 5200, 3800, 6000],
            GHOST:   [260,  310,  220,  340 ],
            MONSTER: [80,   100,  65,   120  ],
            CLEAN:   [1000, 1200, 800,  1400 ], // test only
        };
        const pool = freqs[SVE.currentMood] || [1000];
        const freq = pool[SVE.wordCount % pool.length];

        // Temporarily boost volume for test button press
        const origVol = SVE.glitchSynth.volume.value;
        if (forceTest && SVE.currentMood === 'CLEAN') {
            SVE.glitchSynth.volume.value = -18;
        }

        SVE.glitchSynth.triggerAttackRelease(freq, '16n', Tone.now());
        SVE.wordCount++;

        if (forceTest && SVE.currentMood === 'CLEAN') {
            // Restore silence after the test note decays
            setTimeout(() => { if (SVE.glitchSynth) SVE.glitchSynth.volume.value = origVol; }, 200);
        }
    };

    // ── Speak ─────────────────────────────────────────────────────────────────
    SVE.speak = function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO SCRIPT'); return; }
        if (!SVE.initialized) { SVE.init().then(() => SVE.speak(text)); return; }

        window.speechSynthesis.cancel();
        SVE.wordCount = 0;
        SVE.isPlaying = true;

        // ── Auto-detect language and pick matching voice ──────────────────────
        const detectedLang = SVE._detectLanguage(text);
        if (detectedLang && detectedLang !== SVE._lastDetectedLang) {
            SVE._lastDetectedLang = detectedLang;
            SVE._findBestVoice(detectedLang);
        }

        const utter = new SpeechSynthesisUtterance(text);

        if (SVE.preferredVoice) {
            utter.voice = SVE.preferredVoice;
            utter.lang  = SVE.preferredVoice.lang;
        } else if (detectedLang) {
            utter.lang = detectedLang;
        }

        // ── Mode-specific voice character ─────────────────────────────────────
        // These are dramatic enough that each mode sounds unmistakably different.
        switch (SVE.currentMood) {
            case 'CLEAN':
                utter.rate  = 0.84; utter.pitch = 1.00; break;  // natural, cinematic
            case 'CYBER':
                utter.rate  = 0.90; utter.pitch = 1.20; break;  // crisp, slightly robotic
            case 'GHOST':
                utter.rate  = 0.72; utter.pitch = 0.72; break;  // slow, ethereal
            case 'MONSTER':
                utter.rate  = 0.65; utter.pitch = 0.45; break;  // very slow, very deep
        }

        utter.onboundary = e => { if (e.name === 'word') SVE.triggerGlitch(); };

        utter.onstart = () => {
            SVE.isPlaying = true;
            const btn = document.getElementById('sve-speak-btn');
            if (btn) btn.textContent = '■ STOP';
            SVE.updateStatus('▶ ' + SVE.currentMood
                + (detectedLang ? ' · ' + detectedLang.split('-')[0].toUpperCase() : '')
                + '...');
        };

        utter.onend = () => {
            SVE.isPlaying = false;
            const btn = document.getElementById('sve-speak-btn');
            if (btn) btn.textContent = '▶ SPEAK';
            SVE.updateStatus('DONE // ' + SVE.currentMood);
        };

        utter.onerror = e => {
            SVE.isPlaying = false;
            const btn = document.getElementById('sve-speak-btn');
            if (btn) btn.textContent = '▶ SPEAK';
            SVE.updateStatus('ERR: ' + e.error);
        };

        window.speechSynthesis.speak(utter);
    };

    SVE.stop = function () {
        window.speechSynthesis.cancel();
        SVE.isPlaying = false;
        const btn = document.getElementById('sve-speak-btn');
        if (btn) btn.textContent = '▶ SPEAK';
        SVE.updateStatus('STOPPED');
    };

    // ── Expose ────────────────────────────────────────────────────────────────
    window.SVE = SVE;
})();
