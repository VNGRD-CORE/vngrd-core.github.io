// ─────────────────────────────────────────────────────────────────────────────
// SYNESTHESIA VOICE ENGINE  //  VNGRD-CORE  //  v1.2.0
// 100% client-side · Zero external API calls · Tone.js powered
// Offline render uses native OfflineAudioContext (no Tone.Offline cross-context issues)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // ── State ─────────────────────────────────────────────────────────────────
    const SVE = {
        version: '1.2.0',
        initialized: false,
        isPlaying: false,
        currentMood: 'CYBER',
        gender: 'M',
        language: 'auto',
        moodEffects: [],
        wordCount: 0,
        preferredVoice: null,
        voiceRate: 0.82,
        voicePitch: 1.0,
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

    // ── Voice discovery ────────────────────────────────────────────────────────
    // Priority: Google cloud TTS (most natural) → premium named voices → OS fallbacks
    SVE._findPreferredVoice = function () {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;

        const gender = SVE.gender;
        const lang   = SVE.language;

        // Heuristic female name fragments
        const femaleNames = ['female','woman','fiona','samantha','victoria','karen',
            'moira','tessa','veena','zira','eva','anna','alice','amelie','ioana',
            'joana','laura','lekha','luciana','mariska','mei-jia','milena','paulina',
            'sin-ji','ting-ting','yuna','zosia','helen','hazel','claire','emily',
            'grace','jenny','aria','nova','sonia','natasha'];
        const maleNames   = ['male','man','daniel','thomas','alex','fred','jorge',
            'diego','luca','oliver','reed','rishi','xander','yannick','george','ryan',
            'guy','eric','mark','james','david','brian','mike','chris','kevin'];

        const isFemale = v => femaleNames.some(h => v.name.toLowerCase().includes(h));
        const isMale   = v => maleNames.some(h => v.name.toLowerCase().includes(h)) || !isFemale(v);
        const matchGender = v => gender === 'F' ? isFemale(v) : isMale(v);

        const langFilter = lang === 'auto'
            ? () => true
            : v => v.lang === lang || v.lang.startsWith(lang.split('-')[0]);

        const pool = voices.filter(v => langFilter(v) && matchGender(v));

        // Tiered priority: Google TTS → named naturals → local OS voices
        const googlePriorityM = ['Google UK English Male','Google US English'];
        const googlePriorityF = ['Google UK English Female','Google US English'];
        const naturalM = ['Daniel','Thomas','Oliver','Reed','Rishi','Guy','Eric','George'];
        const naturalF = ['Samantha','Karen','Victoria','Moira','Fiona','Alice','Emily','Helena'];

        const googleNames = gender === 'F' ? googlePriorityF : googlePriorityM;
        const naturalNames = gender === 'F' ? naturalF : naturalM;

        SVE.preferredVoice =
            // 1. Exact Google TTS match (highest quality)
            pool.find(v => googleNames.some(n => v.name === n)) ||
            // 2. Any Google voice in the pool
            pool.find(v => v.name.startsWith('Google')) ||
            // 3. Known natural-sounding named voices
            pool.find(v => naturalNames.some(n => v.name.includes(n))) ||
            // 4. Any pool voice
            pool[0] ||
            // 5. Language match ignoring gender
            voices.find(v => langFilter(v)) ||
            // 6. Any English voice as absolute fallback
            voices.find(v => v.lang.startsWith('en')) ||
            null;

        const label = SVE.preferredVoice
            ? SVE.preferredVoice.name.slice(0, 24).toUpperCase()
            : 'SYSTEM DEFAULT';
        SVE.updateStatus('VOICE // ' + label);
        SVE._populateVoicePicker();
    };

    SVE._populateVoicePicker = function () {
        const sel = document.getElementById('sve-voice-select');
        if (!sel) return;
        const voices = window.speechSynthesis.getVoices();
        const lang = SVE.language;
        const filtered = lang === 'auto'
            ? voices
            : voices.filter(v => v.lang === lang || v.lang.startsWith(lang.split('-')[0]));
        sel.innerHTML = filtered.length
            ? filtered.map(v =>
                `<option value="${v.name}"${v === SVE.preferredVoice ? ' selected' : ''}>${v.name} [${v.lang}]</option>`
              ).join('')
            : '<option>— no voices for this lang —</option>';
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    SVE.init = async function () {
        if (SVE.initialized) return;
        const Tone = window.Tone;
        if (!Tone) { SVE.updateStatus('ERR: TONE.JS NOT FOUND'); return; }

        await Tone.start();

        SVE.glitchSynth = new Tone.MetalSynth({
            frequency: 400,
            envelope: { attack: 0.001, decay: 0.04, release: 0.04 },
            harmonicity: 5.1, modulationIndex: 16,
            resonance: 3200, octaves: 0.5, volume: -18,
        });
        SVE.staticBurst = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
            volume: -26,
        });

        SVE.initialized = true;
        SVE.updateDot(true);

        SVE._findPreferredVoice();
        window.speechSynthesis.onvoiceschanged = SVE._findPreferredVoice;

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

        ['MONSTER','CYBER','GHOST'].forEach(m => {
            const btn = document.getElementById('sve-mood-' + m.toLowerCase());
            if (btn) btn.classList.toggle('active-mode', m === mood);
        });
        SVE.updateStatus('MOOD // ' + mood);
    };

    // ── Gender / Language ──────────────────────────────────────────────────────
    SVE.setGender = function (g) {
        SVE.gender = g;
        ['M','F'].forEach(id => {
            const btn = document.getElementById('sve-gender-' + id);
            if (btn) btn.classList.toggle('active-mode', id === g);
        });
        SVE._findPreferredVoice();
    };

    SVE.setLanguage = function (lang) {
        SVE.language = lang;
        SVE._findPreferredVoice();
    };

    SVE.pickVoice = function (name) {
        const found = window.speechSynthesis.getVoices().find(v => v.name === name);
        if (found) {
            SVE.preferredVoice = found;
            SVE.updateStatus('VOICE // ' + found.name.slice(0, 24).toUpperCase());
        }
    };

    // ── Glitch trigger ────────────────────────────────────────────────────────
    SVE.triggerGlitch = function () {
        if (!SVE.initialized) return;
        const now = window.Tone.now();
        SVE.glitchSynth.triggerAttackRelease(now);
        SVE.wordCount++;
        if (SVE.wordCount % 3 === 0) SVE.staticBurst.triggerAttackRelease('32n', now + 0.012);
    };

    // ── Speak ─────────────────────────────────────────────────────────────────
    SVE.speak = function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO_SCRIPT'); return; }
        if (!SVE.initialized) { SVE.init().then(() => SVE.speak(text)); return; }

        window.speechSynthesis.cancel();
        SVE.wordCount = 0;
        SVE.isPlaying = true;

        const utter = new SpeechSynthesisUtterance(text);

        if (SVE.preferredVoice) {
            utter.voice = SVE.preferredVoice;
            utter.lang  = SVE.preferredVoice.lang;
        } else if (SVE.language !== 'auto') {
            utter.lang = SVE.language;
        }

        // Read live slider values
        const rateEl  = document.getElementById('sve-rate');
        const pitchEl = document.getElementById('sve-pitch');
        SVE.voiceRate  = rateEl  ? parseFloat(rateEl.value)  : SVE.voiceRate;
        SVE.voicePitch = pitchEl ? parseFloat(pitchEl.value) : SVE.voicePitch;

        utter.rate  = SVE.voiceRate;
        utter.pitch = SVE.voicePitch;

        // Word boundary → Synesthesia glitch trigger
        utter.onboundary = e => { if (e.name === 'word') SVE.triggerGlitch(); };
        utter.onstart    = () => { SVE.isPlaying = true;  SVE.updateStatus('SPEAKING // ' + SVE.currentMood + '...'); };
        utter.onend      = () => { SVE.isPlaying = false; SVE.updateStatus('DONE // ' + SVE.currentMood); };
        utter.onerror    = e  => { SVE.isPlaying = false; SVE.updateStatus('ERR: ' + e.error); };

        window.speechSynthesis.speak(utter);
    };

    SVE.stop = function () {
        window.speechSynthesis.cancel();
        SVE.isPlaying = false;
        SVE.updateStatus('STOPPED');
    };

    // ── Render Trailer Audio ────────────────────────────────────────────────────
    // Uses native OfflineAudioContext (NO Tone.Offline) to guarantee no
    // cross-context errors. All nodes are created inside the same offlineCtx.
    SVE.renderTrailerAudio = async function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO_SCRIPT_TO_RENDER'); return; }
        if (!SVE.initialized) await SVE.init();

        const words = text.trim().split(/\s+/);
        const rateEl = document.getElementById('sve-rate');
        const curRate = rateEl ? parseFloat(rateEl.value) : SVE.voiceRate;
        const wps   = 2.3 * curRate;
        const tail  = SVE.currentMood === 'GHOST' ? 4.5 : 2.0;
        const totalDur = Math.max(words.length / wps + tail, 3.0);
        const SR = 44100;
        const mood = SVE.currentMood;

        SVE.updateStatus('RENDERING...');
        const renderBtn = document.getElementById('sve-render-btn');
        if (renderBtn) { renderBtn.disabled = true; renderBtn.textContent = 'RENDERING...'; }

        try {
            // ── Native OfflineAudioContext — guaranteed no cross-context issues ──
            const oCtx = new OfflineAudioContext(2, Math.ceil(totalDur * SR), SR);

            // ── Master gain ──
            const master = oCtx.createGain();
            master.gain.value = 0.82;
            master.connect(oCtx.destination);

            // ── Build mood-specific effect chain (pure Web Audio primitives) ──
            let chainEntry; // first node in chain (synth sources connect here)

            if (mood === 'MONSTER') {
                const dist = oCtx.createWaveShaper();
                dist.curve = SVE._makeDistortionCurve(oCtx, 380);
                dist.oversample = '4x';
                const lpf = oCtx.createBiquadFilter();
                lpf.type = 'lowpass'; lpf.frequency.value = 700; lpf.Q.value = 1.2;
                const lpf2 = oCtx.createBiquadFilter(); // extra low-end warmth
                lpf2.type = 'lowpass'; lpf2.frequency.value = 1800;
                dist.connect(lpf); lpf.connect(lpf2); lpf2.connect(master);
                chainEntry = dist;

            } else if (mood === 'CYBER') {
                const hpf = oCtx.createBiquadFilter();
                hpf.type = 'highpass'; hpf.frequency.value = 700; hpf.Q.value = 0.8;
                // Ping-pong delay: two delay nodes panned L/R
                const delL = oCtx.createDelay(2.0);
                const delR = oCtx.createDelay(2.0);
                delL.delayTime.value = 0.095;
                delR.delayTime.value = 0.19;
                const fbGainL = oCtx.createGain(); fbGainL.gain.value = 0.28;
                const fbGainR = oCtx.createGain(); fbGainR.gain.value = 0.28;
                const merger = oCtx.createChannelMerger(2);
                // feedback loop
                delL.connect(fbGainL); fbGainL.connect(delR);
                delR.connect(fbGainR); fbGainR.connect(delL);
                delL.connect(merger, 0, 0);
                delR.connect(merger, 0, 1);
                hpf.connect(delL); hpf.connect(merger, 0, 0); // dry signal
                merger.connect(master);
                chainEntry = hpf;

            } else if (mood === 'GHOST') {
                const lpf = oCtx.createBiquadFilter();
                lpf.type = 'lowpass'; lpf.frequency.value = 2000; lpf.Q.value = 0.5;
                // Long feedback delay
                const del1 = oCtx.createDelay(4.0); del1.delayTime.value = 0.35;
                const del2 = oCtx.createDelay(4.0); del2.delayTime.value = 0.52;
                const fb1  = oCtx.createGain(); fb1.gain.value = 0.68;
                const fb2  = oCtx.createGain(); fb2.gain.value = 0.55;
                const wetGain = oCtx.createGain(); wetGain.gain.value = 0.72;
                lpf.connect(del1); del1.connect(fb1); fb1.connect(del2);
                del2.connect(fb2); fb2.connect(del1); // feedback loop
                del1.connect(wetGain); del2.connect(wetGain);
                lpf.connect(master); // dry
                wetGain.connect(master); // wet
                chainEntry = lpf;

            } else {
                // Fallback: simple highpass
                const hpf = oCtx.createBiquadFilter();
                hpf.type = 'highpass'; hpf.frequency.value = 4000;
                hpf.connect(master);
                chainEntry = hpf;
            }

            // ── Schedule word-sync glitch oscillators ──
            words.forEach((_, i) => {
                const t = i / wps;

                // Glitch chirp: short square oscillator burst
                const osc = oCtx.createOscillator();
                const env = oCtx.createGain();
                osc.type = 'square';
                // Frequency pattern: varies to feel less repetitive
                const freqOptions = [800, 1200, 2000, 3200, 5000, 8000];
                osc.frequency.value = freqOptions[i % freqOptions.length];
                env.gain.setValueAtTime(0.35, t);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.038);
                osc.connect(env);
                env.connect(chainEntry);
                osc.start(t);
                osc.stop(t + 0.04);

                // White noise burst every 3rd word
                if (i % 3 === 0) {
                    const nFrames = Math.ceil(0.028 * SR);
                    const nBuf = oCtx.createBuffer(1, nFrames, SR);
                    const nd = nBuf.getChannelData(0);
                    for (let j = 0; j < nFrames; j++) nd[j] = (Math.random() * 2 - 1) * 0.5;
                    const nSrc = oCtx.createBufferSource();
                    nSrc.buffer = nBuf;
                    const nEnv = oCtx.createGain();
                    const nt = t + 0.012;
                    nEnv.gain.setValueAtTime(0.22, nt);
                    nEnv.gain.exponentialRampToValueAtTime(0.001, nt + 0.025);
                    nSrc.connect(nEnv);
                    nEnv.connect(chainEntry);
                    nSrc.start(nt);
                }
            });

            // Outro cascade
            const outroT = words.length / wps;
            [0.16, 0.32, 0.50, 0.70, 0.92, 1.16].forEach((offset, idx) => {
                const t = outroT + offset;
                const osc = oCtx.createOscillator();
                const env = oCtx.createGain();
                osc.type = 'square';
                osc.frequency.value = [6000, 4000, 2500, 1500, 900, 500][idx];
                env.gain.setValueAtTime(0.3 * (1 - idx * 0.12), t);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
                osc.connect(env);
                env.connect(chainEntry);
                osc.start(t);
                osc.stop(t + 0.06);
            });

            // ── Render ──
            const renderedBuf = await oCtx.startRendering();

            // ── AudioBuffer → WAV ──
            const wavBuf = SVE._audioBufferToWav(renderedBuf);
            const blob   = new Blob([wavBuf], { type: 'audio/wav' });
            const url    = URL.createObjectURL(blob);
            const fname  = 'SVE_' + mood + '_' + Date.now() + '.wav';

            // ── Save to Puter.fs ──
            if (window.puter && window.puter.fs) {
                try {
                    const ab = await blob.arrayBuffer();
                    await window.puter.fs.write(fname, new Uint8Array(ab), { createMissingParents: true });
                } catch (e) { console.warn('SVE: Puter.fs:', e.message); }
            }

            // ── Add to APP audio playlist ──
            if (window.APP && APP.audio) {
                APP.audio.playlist.push({ url, name: fname.replace('.wav', '') });
                const dot = document.getElementById('audio-dot');
                if (dot) dot.classList.remove('off');
                if (typeof playTrack === 'function') playTrack(APP.audio.playlist.length - 1);
            }

            // ── Download ──
            const a = document.createElement('a');
            a.href = url; a.download = fname;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);

            SVE.updateStatus('RENDERED // ' + fname.slice(0, 26));
            return { url, fname, blob };

        } catch (err) {
            SVE.updateStatus('RENDER_ERR: ' + err.message);
            console.error('SVE render:', err);
        } finally {
            if (renderBtn) { renderBtn.disabled = false; renderBtn.textContent = '▶ RENDER TRAILER AUDIO'; }
        }
    };

    // ── Distortion WaveShaper curve ────────────────────────────────────────────
    SVE._makeDistortionCurve = function (ctx, amount) {
        const n = 256;
        const curve = new Float32Array(n);
        const deg = Math.PI / 180;
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    };

    // ── AudioBuffer → 16-bit PCM WAV ─────────────────────────────────────────
    SVE._audioBufferToWav = function (buf) {
        const numCh   = buf.numberOfChannels;
        const sr      = buf.sampleRate;
        const blkAl   = numCh * 2;
        const dataLen = buf.length * numCh * 2;
        const view    = new DataView(new ArrayBuffer(44 + dataLen));
        const s = (o, v) => { for (let i = 0; i < v.length; i++) view.setUint8(o + i, v.charCodeAt(i)); };

        s(0,'RIFF'); view.setUint32(4, 36 + dataLen, true);
        s(8,'WAVE'); s(12,'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true);
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
