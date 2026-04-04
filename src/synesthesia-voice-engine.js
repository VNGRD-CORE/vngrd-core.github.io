// ─────────────────────────────────────────────────────────────────────────────
// SYNESTHESIA VOICE ENGINE  //  VNGRD-CORE  //  v1.0.0
// 100% client-side · Zero external API calls · Tone.js powered
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────
    const SVE = {
        version: '1.0.0',
        initialized: false,
        isPlaying: false,
        currentMood: 'CYBER',
        moodEffects: [],
        wordCount: 0,
        preferredVoice: null,

        // Tone.js nodes (live context)
        glitchSynth: null,
        staticBurst: null,
        baseFilter: null,
        bitCrusher: null,
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    SVE.updateStatus = function (msg) {
        const el = document.getElementById('sve-status');
        if (el) el.textContent = msg;
        if (typeof log === 'function') log('SVE: ' + msg);
    };

    SVE.updateDot = function (on) {
        const dot = document.getElementById('sve-dot');
        if (dot) { dot.classList.toggle('off', !on); }
    };

    // ── Voice discovery ───────────────────────────────────────────────────────
    SVE._findPreferredVoice = function () {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;
        SVE.preferredVoice =
            voices.find(v => v.name === 'Google UK English Male') ||
            voices.find(v => v.name === 'Daniel') ||
            voices.find(v => /uk/i.test(v.name) && /male/i.test(v.name)) ||
            voices.find(v => /daniel/i.test(v.name)) ||
            voices.find(v => v.lang === 'en-GB' && !/female/i.test(v.name)) ||
            voices.find(v => v.lang === 'en-GB') ||
            voices.find(v => v.lang.startsWith('en')) ||
            null;

        const label = SVE.preferredVoice
            ? SVE.preferredVoice.name.toUpperCase().slice(0, 24)
            : 'SYSTEM DEFAULT';
        SVE.updateStatus('VOICE // ' + label);
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    SVE.init = async function () {
        if (SVE.initialized) return;
        const Tone = window.Tone;
        if (!Tone) { SVE.updateStatus('ERR: TONE.JS NOT FOUND'); return; }

        await Tone.start();

        // Glitch chirp synth — high-frequency digital transient
        SVE.glitchSynth = new Tone.MetalSynth({
            frequency: 400,
            envelope: { attack: 0.001, decay: 0.04, release: 0.04 },
            harmonicity: 5.1,
            modulationIndex: 16,
            resonance: 3200,
            octaves: 0.5,
            volume: -18,
        });

        // Static burst noise — white noise micro-pulse
        SVE.staticBurst = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
            volume: -26,
        });

        // Default base chain (overridden per mood)
        SVE.baseFilter  = new Tone.Filter({ frequency: 4000, type: 'highpass', rolloff: -24 });
        SVE.bitCrusher  = new Tone.BitCrusher(8);

        SVE.glitchSynth.chain(SVE.baseFilter, SVE.bitCrusher, Tone.Destination);
        SVE.staticBurst.chain(SVE.baseFilter, SVE.bitCrusher, Tone.Destination);

        SVE.initialized = true;
        SVE.updateDot(true);
        SVE.updateStatus('READY');

        // Voice discovery (voices may load async)
        SVE._findPreferredVoice();
        window.speechSynthesis.onvoiceschanged = SVE._findPreferredVoice;

        // Apply default mood
        SVE.setMood(SVE.currentMood);
    };

    // ── Mood system ───────────────────────────────────────────────────────────
    SVE.setMood = function (mood) {
        const Tone = window.Tone;
        if (!Tone || !SVE.initialized) { SVE.currentMood = mood; return; }

        // Dispose previous mood effects
        SVE.moodEffects.forEach(e => { try { e.dispose(); } catch (_) {} });
        SVE.moodEffects = [];

        // Detach synths from all existing nodes
        SVE.glitchSynth.disconnect();
        SVE.staticBurst.disconnect();

        SVE.currentMood = mood;

        // Rebuild chain per mood
        switch (mood) {

            case 'MONSTER': {
                // PitchShift -12, heavy Distortion, deep LowPass BitCrusher
                const pitch = new Tone.PitchShift(-12);
                const dist  = new Tone.Distortion(0.88);
                const lpf   = new Tone.Filter({ frequency: 900, type: 'lowpass', rolloff: -24 });
                const crush = new Tone.BitCrusher(4);
                const gain  = new Tone.Gain(0.9);
                SVE.glitchSynth.chain(pitch, dist, lpf, crush, gain, Tone.Destination);
                SVE.staticBurst.chain(pitch, dist, lpf, crush, gain, Tone.Destination);
                SVE.moodEffects = [pitch, dist, lpf, crush, gain];
                break;
            }

            case 'CYBER': {
                // HighPass filter + BitCrusher + PingPong delay
                const hpf   = new Tone.Filter({ frequency: 700, type: 'highpass', rolloff: -12 });
                const crush = new Tone.BitCrusher(8);
                const ppd   = new Tone.PingPongDelay({ delayTime: '16n', feedback: 0.28, wet: 0.38 });
                const gain  = new Tone.Gain(0.85);
                SVE.glitchSynth.chain(hpf, crush, ppd, gain, Tone.Destination);
                SVE.staticBurst.chain(hpf, crush, ppd, gain, Tone.Destination);
                SVE.moodEffects = [hpf, crush, ppd, gain];
                break;
            }

            case 'GHOST': {
                // AutoWah + LowPass + BitCrusher + massive Reverb
                const wah   = new Tone.AutoWah({ baseFrequency: 100, octaves: 6, sensitivity: -30, Q: 8, gain: 10, wet: 0.8 });
                const lpf   = new Tone.Filter({ frequency: 2200, type: 'lowpass' });
                const crush = new Tone.BitCrusher(10);
                const verb  = new Tone.Reverb({ decay: 8, preDelay: 0.02, wet: 0.78 });
                const gain  = new Tone.Gain(0.7);
                SVE.glitchSynth.chain(wah, lpf, crush, verb, gain, Tone.Destination);
                SVE.staticBurst.chain(wah, lpf, crush, verb, gain, Tone.Destination);
                SVE.moodEffects = [wah, lpf, crush, verb, gain];
                break;
            }

            default: {
                const hpf   = new Tone.Filter({ frequency: 4000, type: 'highpass', rolloff: -24 });
                const crush = new Tone.BitCrusher(8);
                SVE.glitchSynth.chain(hpf, crush, Tone.Destination);
                SVE.staticBurst.chain(hpf, crush, Tone.Destination);
                SVE.moodEffects = [hpf, crush];
            }
        }

        // Highlight active mood button
        ['MONSTER', 'CYBER', 'GHOST'].forEach(m => {
            const btn = document.getElementById('sve-mood-' + m.toLowerCase());
            if (btn) btn.classList.toggle('active-mode', m === mood);
        });

        SVE.updateStatus('MOOD // ' + mood);
    };

    // ── Glitch trigger ────────────────────────────────────────────────────────
    SVE.triggerGlitch = function () {
        if (!SVE.initialized) return;
        const Tone = window.Tone;
        const now  = Tone.now();

        SVE.glitchSynth.triggerAttackRelease(now);

        // White-noise burst every 3rd word for extra texture
        SVE.wordCount++;
        if (SVE.wordCount % 3 === 0) {
            SVE.staticBurst.triggerAttackRelease('32n', now + 0.012);
        }
    };

    // ── Speak ─────────────────────────────────────────────────────────────────
    SVE.speak = function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO_SCRIPT'); return; }

        if (!SVE.initialized) {
            SVE.init().then(() => SVE.speak(text));
            return;
        }

        window.speechSynthesis.cancel();
        SVE.wordCount = 0;
        SVE.isPlaying = true;
        SVE.updateDot(true);

        const utter = new SpeechSynthesisUtterance(text);

        if (SVE.preferredVoice) utter.voice = SVE.preferredVoice;

        // Mood-specific vocal character
        switch (SVE.currentMood) {
            case 'MONSTER': utter.rate = 0.72; utter.pitch = 0.55; break;
            case 'CYBER':   utter.rate = 0.92; utter.pitch = 1.12; break;
            case 'GHOST':   utter.rate = 0.78; utter.pitch = 0.80; break;
            default:        utter.rate = 0.85; utter.pitch = 1.00;
        }

        // Word-boundary → glitch trigger (the "Synesthesia" effect)
        utter.onboundary = function (e) {
            if (e.name === 'word') SVE.triggerGlitch();
        };

        utter.onstart = function () {
            SVE.updateStatus('SPEAKING // ' + SVE.currentMood + '...');
        };

        utter.onend = function () {
            SVE.isPlaying = false;
            SVE.updateStatus('DONE // ' + SVE.currentMood);
        };

        utter.onerror = function (e) {
            SVE.isPlaying = false;
            SVE.updateStatus('ERR: ' + e.error);
        };

        window.speechSynthesis.speak(utter);
    };

    SVE.stop = function () {
        window.speechSynthesis.cancel();
        SVE.isPlaying = false;
        SVE.updateStatus('STOPPED');
    };

    // ── Render Trailer Audio (Tone.Offline → WAV → Puter.fs + Media Bank) ────
    SVE.renderTrailerAudio = async function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO_SCRIPT_TO_RENDER'); return; }
        if (!SVE.initialized) await SVE.init();

        const Tone = window.Tone;
        const words = text.trim().split(/\s+/);

        // Estimate duration based on mood speech rate
        const wps = SVE.currentMood === 'MONSTER' ? 1.6
                  : SVE.currentMood === 'GHOST'   ? 2.0
                  : 2.4;
        const speechDur = words.length / wps;
        const tail      = SVE.currentMood === 'GHOST' ? 5.0
                        : SVE.currentMood === 'MONSTER' ? 2.5 : 1.8;
        const totalDur  = speechDur + tail;

        SVE.updateStatus('RENDERING...');

        const renderBtn = document.getElementById('sve-render-btn');
        if (renderBtn) { renderBtn.disabled = true; renderBtn.textContent = 'RENDERING...'; }

        try {
            const mood = SVE.currentMood;

            const buffer = await Tone.Offline(async () => {

                // ── Glitch synth (offline instance) ──
                const oGlitch = new Tone.MetalSynth({
                    frequency: 400,
                    envelope: { attack: 0.001, decay: 0.04, release: 0.04 },
                    harmonicity: 5.1, modulationIndex: 16,
                    resonance: 3200, octaves: 0.5, volume: -18,
                });
                const oNoise = new Tone.NoiseSynth({
                    noise: { type: 'white' },
                    envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
                    volume: -26,
                });

                // ── Mood chain (offline) ──
                if (mood === 'MONSTER') {
                    const pitch = new Tone.PitchShift(-12);
                    const dist  = new Tone.Distortion(0.88);
                    const lpf   = new Tone.Filter({ frequency: 900, type: 'lowpass' });
                    const crush = new Tone.BitCrusher(4);
                    oGlitch.chain(pitch, dist, lpf, crush, Tone.Destination);
                    oNoise.chain(pitch,  dist, lpf, crush, Tone.Destination);

                } else if (mood === 'CYBER') {
                    const hpf   = new Tone.Filter({ frequency: 700, type: 'highpass' });
                    const crush = new Tone.BitCrusher(8);
                    const ppd   = new Tone.PingPongDelay({ delayTime: '16n', feedback: 0.28, wet: 0.38 });
                    oGlitch.chain(hpf, crush, ppd, Tone.Destination);
                    oNoise.chain(hpf,  crush, ppd, Tone.Destination);

                } else if (mood === 'GHOST') {
                    const wah   = new Tone.AutoWah({ baseFrequency: 100, octaves: 6, sensitivity: -30, Q: 8, gain: 10, wet: 0.8 });
                    const lpf   = new Tone.Filter({ frequency: 2200, type: 'lowpass' });
                    const crush = new Tone.BitCrusher(10);
                    const verb  = new Tone.Reverb({ decay: 8, preDelay: 0.02, wet: 0.78 });
                    oGlitch.chain(wah, lpf, crush, verb, Tone.Destination);
                    oNoise.chain(wah,  lpf, crush, verb, Tone.Destination);

                } else {
                    const hpf   = new Tone.Filter({ frequency: 4000, type: 'highpass' });
                    const crush = new Tone.BitCrusher(8);
                    oGlitch.chain(hpf, crush, Tone.Destination);
                    oNoise.chain(hpf,  crush, Tone.Destination);
                }

                // ── Schedule word-sync glitch triggers ──
                words.forEach((_, i) => {
                    const t = i / wps;
                    oGlitch.triggerAttackRelease(t);
                    if (i % 3 === 0) oNoise.triggerAttackRelease('32n', t + 0.012);
                });

                // Outro burst cascade
                const outroStart = words.length / wps;
                for (let j = 1; j <= 6; j++) {
                    oGlitch.triggerAttackRelease(outroStart + j * 0.16);
                }

            }, totalDur, 2, 44100);

            // ── AudioBuffer → WAV ──
            const wavBuffer = SVE._audioBufferToWav(buffer);
            const blob      = new Blob([wavBuffer], { type: 'audio/wav' });
            const url       = URL.createObjectURL(blob);
            const fileName  = 'SVE_' + mood + '_' + Date.now() + '.wav';

            // ── Save to Puter.fs ──
            if (window.puter && window.puter.fs) {
                try {
                    const ab = await blob.arrayBuffer();
                    await window.puter.fs.write(fileName, new Uint8Array(ab), { createMissingParents: true });
                    SVE.updateStatus('SAVED // ' + fileName.slice(0, 28));
                } catch (e) {
                    console.warn('SVE: Puter.fs write failed —', e.message);
                }
            }

            // ── Add to APP audio playlist (appears in AUDIO_ENGINE section) ──
            if (window.APP && APP.audio) {
                APP.audio.playlist.push({ url, name: fileName.replace('.wav', '') });
                const dot = document.getElementById('audio-dot');
                if (dot) dot.classList.remove('off');
                // Auto-play the rendered file
                if (typeof playTrack === 'function') {
                    playTrack(APP.audio.playlist.length - 1);
                }
            }

            // ── Browser download fallback ──
            const anchor    = document.createElement('a');
            anchor.href     = url;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);

            SVE.updateStatus('RENDERED // ' + fileName.slice(0, 26));
            return { url, fileName, blob };

        } catch (err) {
            SVE.updateStatus('RENDER_ERR: ' + err.message);
            console.error('SVE render error:', err);
        } finally {
            if (renderBtn) { renderBtn.disabled = false; renderBtn.textContent = 'RENDER TRAILER AUDIO'; }
        }
    };

    // ── AudioBuffer → WAV (16-bit PCM) ───────────────────────────────────────
    SVE._audioBufferToWav = function (buffer) {
        const numCh    = buffer.numberOfChannels;
        const sr       = buffer.sampleRate;
        const bitDepth = 16;
        const bps      = bitDepth / 8;           // bytes per sample
        const blockAl  = numCh * bps;
        const dataLen  = buffer.length * numCh * bps;
        const view     = new DataView(new ArrayBuffer(44 + dataLen));

        const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
        str(0, 'RIFF');
        view.setUint32(4,  36 + dataLen, true);
        str(8, 'WAVE');
        str(12, 'fmt ');
        view.setUint32(16, 16, true);        // PCM chunk size
        view.setUint16(20, 1,  true);        // PCM format
        view.setUint16(22, numCh, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * blockAl, true);
        view.setUint16(32, blockAl, true);
        view.setUint16(34, bitDepth, true);
        str(36, 'data');
        view.setUint32(40, dataLen, true);

        let off = 44;
        for (let i = 0; i < buffer.length; i++) {
            for (let ch = 0; ch < numCh; ch++) {
                const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
                view.setInt16(off, s < 0 ? s * 32768 : s * 32767, true);
                off += 2;
            }
        }
        return view.buffer;
    };

    // ── Expose globally ───────────────────────────────────────────────────────
    window.SVE = SVE;

})();
