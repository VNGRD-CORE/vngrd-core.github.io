// ─────────────────────────────────────────────────────────────────────────────
// SYNESTHESIA VOICE ENGINE  //  VNGRD-CORE  //  v2.2.0
//
// Minimal, self-contained. Web Speech API + Tone.js glitch synth.
// Language auto-detected → best available OS voice selected silently.
// Four modes with distinct pitch / rate / glitch character.
// No external APIs. No recording integration. No side-effects.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const SVE = {
        version: '2.2.0',
        initialized: false,
        isPlaying: false,
        currentMood: 'CYBER',
        preferredVoice: null,
        _wordCount: 0,
        glitchSynth: null,
        moodEffects: [],
        _lastDetectedLang: null,
    };

    // ── UI helpers ────────────────────────────────────────────────────────────
    SVE.updateStatus = function (msg) {
        const el = document.getElementById('sve-status');
        if (el) el.textContent = msg;
    };
    SVE.updateDot = function (on) {
        const d = document.getElementById('sve-dot');
        if (d) d.classList.toggle('off', !on);
    };

    // ── Language detection ────────────────────────────────────────────────────
    // Returns BCP-47 tag (e.g. 'it-IT') or null.
    SVE._detectLanguage = function (text) {
        if (!text || text.trim().length < 6) return null;

        // Non-Latin: unambiguous via character range
        if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN';
        if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP';
        if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR';
        if (/[\u0600-\u06ff]/.test(text)) return 'ar-SA';
        if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU';
        if (/[\u0590-\u05ff]/.test(text)) return 'he-IL';
        if (/[\u0900-\u097f]/.test(text)) return 'hi-IN';

        // Latin diacritics — quick wins
        if (/[äöüÄÖÜß]/.test(text))           return 'de-DE';
        if (/ñ/.test(text))                    return 'es-ES';
        if (/[ãõÃÕ]/.test(text))              return 'pt-BR';
        if (/[ąćęłńśźżĄĆĘŁŃŚŹŻ]/.test(text)) return 'pl-PL';

        // Function-word frequency scoring
        const t = text.toLowerCase();
        const words = t.match(/\b[a-zàáâäçèéêëìíîïòóôöùúûü]+\b/g) || [];
        if (words.length < 3) return null;

        const freq = list => words.filter(w => list.includes(w)).length / words.length;
        const scores = {
            'it-IT': freq(['il','la','le','gli','di','e','un','una','per','non','che','sono','come','ho','è']),
            'fr-FR': freq(['le','la','les','de','du','des','je','tu','il','est','que','et','pas','une','dans']),
            'es-ES': freq(['el','la','los','de','en','que','no','es','por','con','del','una','se','su','al']),
            'pt-BR': freq(['o','a','os','as','um','de','do','da','que','não','em','por','com','para','é']),
            'nl-NL': freq(['de','het','een','van','in','is','op','en','dat','die','te','zijn','ook','voor']),
        };
        const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        return (best && best[1] >= 0.03) ? best[0] : null;
    };

    // ── Voice selection ───────────────────────────────────────────────────────
    SVE._findBestVoice = function (lang) {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;

        const target = lang || SVE._lastDetectedLang;
        const pool = target
            ? voices.filter(v => v.lang === target || v.lang.startsWith(target.split('-')[0]))
            : voices;

        const tiers = [
            v => /^Google\s/.test(v.name),
            v => /Microsoft.*Natural|Microsoft.*Neural/i.test(v.name),
            v => ['Daniel','Samantha','Karen','Victoria','Thomas','Reed',
                  'Oliver','Moira','Rishi','Fiona'].some(n => v.name.includes(n)),
            v => /Microsoft/.test(v.name),
            v => true,
        ];

        let found = null;
        for (const tier of tiers) { found = pool.find(tier); if (found) break; }

        // Fallback to English if target language has no voices
        if (!found && target) {
            const eng = voices.filter(v => v.lang.startsWith('en'));
            for (const tier of tiers) { found = eng.find(tier); if (found) break; }
        }

        if (found) {
            SVE.preferredVoice = found;
            SVE.updateStatus('VOICE // ' + found.name.slice(0, 28).toUpperCase());
        }
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    SVE.init = async function () {
        if (SVE.initialized) return;
        const Tone = window.Tone;
        if (!Tone) { SVE.updateStatus('ERR: TONE.JS MISSING'); return; }

        await Tone.start();

        SVE.glitchSynth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.022, sustain: 0, release: 0.018 },
            volume: -20,
        });

        SVE.initialized = true;
        SVE.updateDot(true);

        SVE._findBestVoice();
        window.speechSynthesis.onvoiceschanged = () => SVE._findBestVoice(SVE._lastDetectedLang);

        SVE.setMood(SVE.currentMood);
        SVE.updateStatus('READY');
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

    // ── Speak ─────────────────────────────────────────────────────────────────
    SVE.speak = function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO SCRIPT'); return; }
        if (!SVE.initialized) { SVE.init().then(() => SVE.speak(text)); return; }

        window.speechSynthesis.cancel();
        SVE._wordCount = 0;
        SVE.isPlaying = true;

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

        switch (SVE.currentMood) {
            case 'CLEAN':   utter.rate = 0.86; utter.pitch = 1.00; break;
            case 'CYBER':   utter.rate = 0.91; utter.pitch = 1.18; break;
            case 'GHOST':   utter.rate = 0.72; utter.pitch = 0.72; break;
            case 'MONSTER': utter.rate = 0.65; utter.pitch = 0.45; break;
        }

        utter.onboundary = e => { if (e.name === 'word') SVE.triggerGlitch(); };

        utter.onstart = () => {
            SVE.isPlaying = true;
            const btn = document.getElementById('sve-speak-btn');
            if (btn) btn.textContent = '■ STOP';
            SVE.updateStatus('▶ ' + SVE.currentMood
                + (detectedLang ? ' · ' + detectedLang.split('-')[0].toUpperCase() : '') + '…');
            SVE.updateDot(true);
        };

        utter.onend = () => {
            SVE.isPlaying = false;
            const btn = document.getElementById('sve-speak-btn');
            if (btn) btn.textContent = '▶ SPEAK';
            SVE.updateStatus('DONE // ' + SVE.currentMood);
            SVE.updateDot(false);
        };

        utter.onerror = e => {
            SVE.isPlaying = false;
            const btn = document.getElementById('sve-speak-btn');
            if (btn) btn.textContent = '▶ SPEAK';
            SVE.updateStatus('ERR: ' + (e.error || 'SPEECH'));
            SVE.updateDot(false);
        };

        window.speechSynthesis.speak(utter);
    };

    SVE.stop = function () {
        window.speechSynthesis.cancel();
        SVE.isPlaying = false;
        const btn = document.getElementById('sve-speak-btn');
        if (btn) btn.textContent = '▶ SPEAK';
        SVE.updateStatus('STOPPED');
        SVE.updateDot(false);
    };

    window.SVE = SVE;
})();
