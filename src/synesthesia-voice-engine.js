// ─────────────────────────────────────────────────────────────────────────────
// SYNESTHESIA VOICE ENGINE  //  VNGRD-CORE  //  v1.1.0
// 100% client-side · Zero external API calls · Tone.js powered
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────
    const SVE = {
        version: '1.1.0',
        initialized: false,
        isPlaying: false,
        currentMood: 'CYBER',
        gender: 'M',           // 'M' | 'F'
        language: 'auto',      // 'auto' | BCP-47 code e.g. 'en-GB'
        moodEffects: [],
        wordCount: 0,
        preferredVoice: null,
        voiceRate: 0.88,
        voicePitch: 1.0,

        // Tone.js nodes (live context)
        glitchSynth: null,
        staticBurst: null,
    };

    // ── UI helpers ─────────────────────────────────────────────────────────────
    SVE.updateStatus = function (msg) {
        const el = document.getElementById('sve-status');
        if (el) el.textContent = msg;
        if (typeof log === 'function') log('SVE: ' + msg);
    };

    SVE.updateDot = function (on) {
        const dot = document.getElementById('sve-dot');
        if (dot) dot.classList.toggle('off', !on);
    };

    // ── Voice discovery ───────────────────────────────────────────────────────
    SVE._findPreferredVoice = function () {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;

        const gender  = SVE.gender;    // 'M' | 'F'
        const lang    = SVE.language;  // 'auto' or BCP-47

        // Female name fragments
        const femaleHints = ['female','woman','fiona','samantha','victoria','karen',
                             'moira','tessa','veena','zira','eva','anna','alice','amelie',
                             'ioana','joana','laura','lekha','luciana','mariska','mei-jia',
                             'milena','montreal','paulina','sin-ji','ting-ting','yuna','zosia'];
        const maleHints   = ['male','man','daniel','thomas','alex','fred','jorge',
                             'diego','luca','oliver','reed','rishi','xander','yannick'];

        const isFemale = v => femaleHints.some(h => v.name.toLowerCase().includes(h));
        const isMale   = v => maleHints.some(h => v.name.toLowerCase().includes(h)) || !isFemale(v);
        const matchGender = v => gender === 'F' ? isFemale(v) : isMale(v);

        // Filter by language if not auto
        const langFilter = lang === 'auto'
            ? () => true
            : v => v.lang === lang || v.lang.startsWith(lang.split('-')[0]);

        const pool = voices.filter(v => langFilter(v) && matchGender(v));

        // Priority list for natural-sounding UK/US narrators
        const preferredNames = gender === 'M'
            ? ['Google UK English Male','Daniel','Thomas','Reed','Oliver','Alex']
            : ['Google UK English Female','Fiona','Samantha','Victoria','Karen','Moira','Alice'];

        SVE.preferredVoice =
            pool.find(v => preferredNames.some(n => v.name.includes(n))) ||
            pool[0] ||
            voices.find(v => langFilter(v)) ||
            voices.find(v => v.lang.startsWith('en')) ||
            null;

        const label = SVE.preferredVoice
            ? SVE.preferredVoice.name.slice(0, 22).toUpperCase()
            : 'SYSTEM DEFAULT';
        SVE.updateStatus('VOICE // ' + label);

        // Populate the voice picker if present
        SVE._populateVoicePicker();
    };

    SVE._populateVoicePicker = function () {
        const sel = document.getElementById('sve-voice-select');
        if (!sel) return;
        const voices = window.speechSynthesis.getVoices();
        const lang   = SVE.language;
        const filtered = lang === 'auto'
            ? voices
            : voices.filter(v => v.lang === lang || v.lang.startsWith(lang.split('-')[0]));

        sel.innerHTML = filtered.map(v =>
            `<option value="${v.name}" ${v === SVE.preferredVoice ? 'selected' : ''}>${v.name} [${v.lang}]</option>`
        ).join('');
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    SVE.init = async function () {
        if (SVE.initialized) return;
        const Tone = window.Tone;
        if (!Tone) { SVE.updateStatus('ERR: TONE.JS NOT FOUND'); return; }

        await Tone.start();

        // Glitch chirp — high-frequency digital transient on every word
        SVE.glitchSynth = new Tone.MetalSynth({
            frequency: 400,
            envelope: { attack: 0.001, decay: 0.04, release: 0.04 },
            harmonicity: 5.1,
            modulationIndex: 16,
            resonance: 3200,
            octaves: 0.5,
            volume: -18,
        });

        // Static burst — white noise micro-pulse every 3rd word
        SVE.staticBurst = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
            volume: -26,
        });

        SVE.initialized = true;
        SVE.updateDot(true);

        // Voice discovery (voices may load async in some browsers)
        SVE._findPreferredVoice();
        window.speechSynthesis.onvoiceschanged = SVE._findPreferredVoice;

        // Apply default mood
        SVE.setMood(SVE.currentMood);
    };

    // ── Mood system ───────────────────────────────────────────────────────────
    SVE.setMood = function (mood) {
        const Tone = window.Tone;
        if (!Tone || !SVE.initialized) { SVE.currentMood = mood; return; }

        SVE.moodEffects.forEach(e => { try { e.dispose(); } catch (_) {} });
        SVE.moodEffects = [];

        SVE.glitchSynth.disconnect();
        SVE.staticBurst.disconnect();
        SVE.currentMood = mood;

        switch (mood) {
            case 'MONSTER': {
                // Heavy distortion + deep LowPass + 4-bit crunch
                const dist  = new Tone.Distortion(0.88);
                const lpf   = new Tone.Filter({ frequency: 700, type: 'lowpass', rolloff: -24 });
                const crush = new Tone.BitCrusher(4);
                const gain  = new Tone.Gain(0.85);
                SVE.glitchSynth.chain(dist, lpf, crush, gain, Tone.Destination);
                SVE.staticBurst.chain(dist, lpf, crush, gain, Tone.Destination);
                SVE.moodEffects = [dist, lpf, crush, gain];
                break;
            }
            case 'CYBER': {
                // HighPass + 8-bit + PingPong delay
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
                // Filter + 10-bit crush + long feedback delay (reverb-like)
                const lpf   = new Tone.Filter({ frequency: 2000, type: 'lowpass' });
                const crush = new Tone.BitCrusher(10);
                const fbd   = new Tone.FeedbackDelay({ delayTime: 0.35, feedback: 0.72, wet: 0.7 });
                const gain  = new Tone.Gain(0.7);
                SVE.glitchSynth.chain(lpf, crush, fbd, gain, Tone.Destination);
                SVE.staticBurst.chain(lpf, crush, fbd, gain, Tone.Destination);
                SVE.moodEffects = [lpf, crush, fbd, gain];
                break;
            }
            default: {
                const hpf   = new Tone.Filter({ frequency: 4000, type: 'highpass' });
                const crush = new Tone.BitCrusher(8);
                SVE.glitchSynth.chain(hpf, crush, Tone.Destination);
                SVE.staticBurst.chain(hpf, crush, Tone.Destination);
                SVE.moodEffects = [hpf, crush];
            }
        }

        // Highlight active mood button
        ['MONSTER','CYBER','GHOST'].forEach(m => {
            const btn = document.getElementById('sve-mood-' + m.toLowerCase());
            if (btn) btn.classList.toggle('active-mode', m === mood);
        });

        SVE.updateStatus('MOOD // ' + mood);
    };

    // ── Gender ────────────────────────────────────────────────────────────────
    SVE.setGender = function (g) {
        SVE.gender = g;
        ['M','F'].forEach(id => {
            const btn = document.getElementById('sve-gender-' + id);
            if (btn) btn.classList.toggle('active-mode', id === g);
        });
        SVE._findPreferredVoice();
    };

    // ── Language ──────────────────────────────────────────────────────────────
    SVE.setLanguage = function (lang) {
        SVE.language = lang;
        SVE._findPreferredVoice();
    };

    // ── Manual voice pick ──────────────────────────────────────────────────────
    SVE.pickVoice = function (name) {
        const voices = window.speechSynthesis.getVoices();
        const found = voices.find(v => v.name === name);
        if (found) {
            SVE.preferredVoice = found;
            SVE.updateStatus('VOICE // ' + found.name.slice(0, 22).toUpperCase());
        }
    };

    // ── Glitch trigger ────────────────────────────────────────────────────────
    SVE.triggerGlitch = function () {
        if (!SVE.initialized) return;
        const now = window.Tone.now();
        SVE.glitchSynth.triggerAttackRelease(now);
        SVE.wordCount++;
        if (SVE.wordCount % 3 === 0) {
            SVE.staticBurst.triggerAttackRelease('32n', now + 0.012);
        }
    };

    // ── Speak ─────────────────────────────────────────────────────────────────
    SVE.speak = function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO_SCRIPT'); return; }
        if (!SVE.initialized) { SVE.init().then(() => SVE.speak(text)); return; }

        window.speechSynthesis.cancel();
        SVE.wordCount = 0;
        SVE.isPlaying = true;
        SVE.updateDot(true);

        const utter = new SpeechSynthesisUtterance(text);

        if (SVE.preferredVoice) {
            utter.voice = SVE.preferredVoice;
            utter.lang  = SVE.preferredVoice.lang;
        } else if (SVE.language !== 'auto') {
            utter.lang = SVE.language;
        }

        // Read rate/pitch from sliders if present, else use stored values
        const rateEl  = document.getElementById('sve-rate');
        const pitchEl = document.getElementById('sve-pitch');
        SVE.voiceRate  = rateEl  ? parseFloat(rateEl.value)  : SVE.voiceRate;
        SVE.voicePitch = pitchEl ? parseFloat(pitchEl.value) : SVE.voicePitch;

        utter.rate  = SVE.voiceRate;
        utter.pitch = SVE.voicePitch;

        // Word boundary → Synesthesia glitch trigger
        utter.onboundary = e => { if (e.name === 'word') SVE.triggerGlitch(); };

        utter.onstart = () => {
            SVE.isPlaying = true;
            SVE.updateStatus('SPEAKING // ' + SVE.currentMood + '...');
        };
        utter.onend   = () => { SVE.isPlaying = false; SVE.updateStatus('DONE // ' + SVE.currentMood); };
        utter.onerror = e  => { SVE.isPlaying = false; SVE.updateStatus('ERR: ' + e.error); };

        window.speechSynthesis.speak(utter);
    };

    SVE.stop = function () {
        window.speechSynthesis.cancel();
        SVE.isPlaying = false;
        SVE.updateStatus('STOPPED');
    };

    // ── Render Trailer Audio (Tone.Offline → WAV → Puter.fs → Audio playlist) ─
    // NOTE: Only offline-safe Tone.js primitives are used here:
    //   Filter (BiquadFilter), Distortion (WaveShaper), BitCrusher (WaveShaper),
    //   FeedbackDelay / PingPongDelay (DelayNode + Gain), Gain.
    //   Reverb (ConvolverNode IR generation) and PitchShift (GrainPlayer)
    //   are intentionally avoided — they create nodes in a separate AudioContext
    //   and cause cross-context errors inside Tone.Offline.
    SVE.renderTrailerAudio = async function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO_SCRIPT_TO_RENDER'); return; }
        if (!SVE.initialized) await SVE.init();

        const Tone  = window.Tone;
        const words = text.trim().split(/\s+/);
        const rateEl = document.getElementById('sve-rate');
        const curRate = rateEl ? parseFloat(rateEl.value) : SVE.voiceRate;

        // Estimate word-per-second based on speech rate setting
        const wps       = 2.3 * curRate;
        const speechDur = words.length / wps;
        const tail      = SVE.currentMood === 'GHOST' ? 4.5 : 2.0;
        const totalDur  = Math.max(speechDur + tail, 3.0);
        const mood      = SVE.currentMood;

        SVE.updateStatus('RENDERING...');
        const renderBtn = document.getElementById('sve-render-btn');
        if (renderBtn) { renderBtn.disabled = true; renderBtn.textContent = 'RENDERING...'; }

        try {
            const buffer = await Tone.Offline(async () => {
                // ── Offline glitch synth ──────────────────────────────────────
                const oG = new Tone.MetalSynth({
                    frequency: 400, harmonicity: 5.1, modulationIndex: 16,
                    resonance: 3200, octaves: 0.5, volume: -18,
                    envelope: { attack: 0.001, decay: 0.04, release: 0.04 },
                });
                const oN = new Tone.NoiseSynth({
                    noise: { type: 'white' }, volume: -26,
                    envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
                });

                // ── Offline-safe mood chain ────────────────────────────────────
                if (mood === 'MONSTER') {
                    const dist  = new Tone.Distortion(0.88);
                    const lpf   = new Tone.Filter({ frequency: 700, type: 'lowpass', rolloff: -24 });
                    const crush = new Tone.BitCrusher(4);
                    oG.chain(dist, lpf, crush, Tone.Destination);
                    oN.chain(dist, lpf, crush, Tone.Destination);

                } else if (mood === 'CYBER') {
                    const hpf   = new Tone.Filter({ frequency: 700, type: 'highpass' });
                    const crush = new Tone.BitCrusher(8);
                    const ppd   = new Tone.PingPongDelay({ delayTime: 0.08, feedback: 0.28, wet: 0.4 });
                    oG.chain(hpf, crush, ppd, Tone.Destination);
                    oN.chain(hpf, crush, ppd, Tone.Destination);

                } else if (mood === 'GHOST') {
                    const lpf   = new Tone.Filter({ frequency: 2000, type: 'lowpass' });
                    const crush = new Tone.BitCrusher(10);
                    const fbd   = new Tone.FeedbackDelay({ delayTime: 0.35, feedback: 0.72, wet: 0.72 });
                    oG.chain(lpf, crush, fbd, Tone.Destination);
                    oN.chain(lpf, crush, fbd, Tone.Destination);

                } else {
                    const hpf   = new Tone.Filter({ frequency: 4000, type: 'highpass' });
                    const crush = new Tone.BitCrusher(8);
                    oG.chain(hpf, crush, Tone.Destination);
                    oN.chain(hpf, crush, Tone.Destination);
                }

                // ── Schedule word-sync glitch triggers ────────────────────────
                words.forEach((_, i) => {
                    const t = i / wps;
                    oG.triggerAttackRelease(t);
                    if (i % 3 === 0) oN.triggerAttackRelease('32n', t + 0.012);
                });

                // Outro burst cascade
                const outroT = words.length / wps;
                for (let j = 1; j <= 6; j++) {
                    oG.triggerAttackRelease(outroT + j * 0.16);
                }

            }, totalDur, 2, 44100);

            // ── AudioBuffer → WAV ──────────────────────────────────────────────
            const wavBuf = SVE._audioBufferToWav(buffer);
            const blob   = new Blob([wavBuf], { type: 'audio/wav' });
            const url    = URL.createObjectURL(blob);
            const fname  = 'SVE_' + mood + '_' + Date.now() + '.wav';

            // ── Save to Puter.fs ──────────────────────────────────────────────
            if (window.puter && window.puter.fs) {
                try {
                    const ab = await blob.arrayBuffer();
                    await window.puter.fs.write(fname, new Uint8Array(ab), { createMissingParents: true });
                } catch (e) { console.warn('SVE: Puter.fs:', e.message); }
            }

            // ── Add to APP audio playlist ──────────────────────────────────────
            if (window.APP && APP.audio) {
                APP.audio.playlist.push({ url, name: fname.replace('.wav', '') });
                const dot = document.getElementById('audio-dot');
                if (dot) dot.classList.remove('off');
                if (typeof playTrack === 'function') playTrack(APP.audio.playlist.length - 1);
            }

            // ── Download ──────────────────────────────────────────────────────
            const a = document.createElement('a');
            a.href = url; a.download = fname;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);

            SVE.updateStatus('RENDERED // ' + fname.slice(0, 24));
            return { url, fname, blob };

        } catch (err) {
            SVE.updateStatus('RENDER_ERR: ' + err.message);
            console.error('SVE render:', err);
        } finally {
            if (renderBtn) { renderBtn.disabled = false; renderBtn.textContent = '▶ RENDER TRAILER AUDIO'; }
        }
    };

    // ── AudioBuffer → 16-bit PCM WAV ─────────────────────────────────────────
    SVE._audioBufferToWav = function (buf) {
        const numCh   = buf.numberOfChannels;
        const sr      = buf.sampleRate;
        const bps     = 2;  // 16-bit
        const blkAl   = numCh * bps;
        const dataLen = buf.length * numCh * bps;
        const view    = new DataView(new ArrayBuffer(44 + dataLen));
        const s = (o, v) => { for (let i = 0; i < v.length; i++) view.setUint8(o + i, v.charCodeAt(i)); };

        s(0,'RIFF'); view.setUint32(4, 36 + dataLen, true);
        s(8,'WAVE'); s(12,'fmt ');
        view.setUint32(16, 16, true);  view.setUint16(20, 1, true);
        view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
        view.setUint32(28, sr * blkAl, true); view.setUint16(32, blkAl, true);
        view.setUint16(34, 16, true); s(36,'data'); view.setUint32(40, dataLen, true);

        let off = 44;
        for (let i = 0; i < buf.length; i++) {
            for (let ch = 0; ch < numCh; ch++) {
                const samp = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i]));
                view.setInt16(off, samp < 0 ? samp * 32768 : samp * 32767, true);
                off += 2;
            }
        }
        return view.buffer;
    };

    // ── Expose ────────────────────────────────────────────────────────────────
    window.SVE = SVE;
})();
