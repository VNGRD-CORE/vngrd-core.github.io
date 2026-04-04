// ─────────────────────────────────────────────────────────────────────────────
// SYNESTHESIA VOICE ENGINE  //  VNGRD-CORE  //  v2.0.0
// Client-side cinematic narration. Auto-selects best OS/browser voice.
// RECORD taps Tone.js output via MediaRecorder (FX stems). No Tone.Offline.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const SVE = {
        version: '2.0.0',
        initialized: false,
        isPlaying: false,
        isRecording: false,
        currentMood: 'CYBER',
        preferredVoice: null,
        wordCount: 0,

        // Tone.js live nodes
        glitchSynth: null,
        moodEffects: [],

        // MediaRecorder session
        _recorder: null,
        _recChunks: [],
        _captureDest: null,
    };

    // ── UI ────────────────────────────────────────────────────────────────────
    SVE.updateStatus = function (msg) {
        const el = document.getElementById('sve-status');
        if (el) el.textContent = msg;
        if (typeof log === 'function') log('SVE: ' + msg);
    };
    SVE.updateDot = function (on) {
        const d = document.getElementById('sve-dot');
        if (d) d.classList.toggle('off', !on);
    };

    // ── Voice selection: silent auto-pick, no user controls needed ───────────
    SVE._findBestVoice = function () {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;

        // Tier 1: Google Cloud TTS (best quality in Chrome/Edge)
        // Tier 2: Microsoft Neural (Edge)
        // Tier 3: Apple premium (Safari: Samantha, Daniel)
        // Tier 4: Any en-GB / en-US voice
        const priority = [
            v => v.name === 'Google UK English Male',
            v => v.name === 'Google UK English Female',
            v => v.name === 'Google US English',
            v => v.name.startsWith('Google') && v.lang.startsWith('en'),
            v => /Microsoft.*Neural/i.test(v.name) && v.lang.startsWith('en'),
            v => v.name === 'Daniel'  && v.lang === 'en-GB',
            v => v.name === 'Samantha'&& v.lang === 'en-US',
            v => v.name === 'Karen'   && v.lang.startsWith('en'),
            v => v.name === 'Victoria'&& v.lang.startsWith('en'),
            v => v.name.startsWith('Microsoft') && v.lang.startsWith('en'),
            v => v.lang === 'en-GB',
            v => v.lang === 'en-US',
            v => v.lang.startsWith('en'),
        ];

        for (const test of priority) {
            const match = voices.find(test);
            if (match) { SVE.preferredVoice = match; break; }
        }

        const lbl = SVE.preferredVoice
            ? SVE.preferredVoice.name.slice(0, 26).toUpperCase()
            : 'SYSTEM DEFAULT';
        SVE.updateStatus('VOICE // ' + lbl);
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    SVE.init = async function () {
        if (SVE.initialized) return;
        const Tone = window.Tone;
        if (!Tone) { SVE.updateStatus('ERR: TONE.JS NOT LOADED'); return; }

        await Tone.start();

        // ── Glitch synth: subtle sine ping (NOT square wave bleeps) ──
        // Filtered sine = "digital tick", not alien bleep
        SVE.glitchSynth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.018, sustain: 0, release: 0.015 },
            volume: -34,
        });

        SVE.initialized = true;
        SVE.updateDot(true);

        SVE._findBestVoice();
        window.speechSynthesis.onvoiceschanged = SVE._findBestVoice;

        SVE.setMood(SVE.currentMood);
    };

    // ── Mood system ───────────────────────────────────────────────────────────
    // Each mood shapes the subtle atmospheric glitch ticks differently.
    // All are QUIET and atmospheric — not bleeps.
    SVE.setMood = function (mood) {
        const Tone = window.Tone;
        if (!Tone || !SVE.initialized) { SVE.currentMood = mood; return; }

        SVE.moodEffects.forEach(e => { try { e.dispose(); } catch (_) {} });
        SVE.moodEffects = [];
        SVE.glitchSynth.disconnect();
        SVE.currentMood = mood;

        switch (mood) {
            case 'CLEAN': {
                // No effects. Zero overhead. Pure voice.
                // Glitch synth silenced.
                const silence = new Tone.Gain(0);
                SVE.glitchSynth.connect(silence);
                silence.connect(Tone.Destination);
                SVE.moodEffects = [silence];
                break;
            }
            case 'CYBER': {
                // Narrow bandpass → crisp digital tick → stereo ping-pong
                const bpf  = new Tone.Filter({ frequency: 4200, type: 'bandpass', Q: 6 });
                const ppd  = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.18, wet: 0.45 });
                const gain = new Tone.Gain(0.7);
                SVE.glitchSynth.chain(bpf, ppd, gain, Tone.Destination);
                SVE.moodEffects = [bpf, ppd, gain];
                break;
            }
            case 'GHOST': {
                // Low-pass warmth → long feedback tail → subtle presence
                const lpf  = new Tone.Filter({ frequency: 1200, type: 'lowpass', Q: 0.5 });
                const fbd  = new Tone.FeedbackDelay({ delayTime: 0.42, feedback: 0.65, wet: 0.6 });
                const gain = new Tone.Gain(0.6);
                SVE.glitchSynth.chain(lpf, fbd, gain, Tone.Destination);
                SVE.moodEffects = [lpf, fbd, gain];
                break;
            }
            case 'MONSTER': {
                // Sub-frequency distortion → heavy low-pass → visceral thump
                const dist = new Tone.Distortion(0.72);
                const lpf  = new Tone.Filter({ frequency: 450, type: 'lowpass', Q: 1.8 });
                const gain = new Tone.Gain(0.9);
                SVE.glitchSynth.chain(dist, lpf, gain, Tone.Destination);
                SVE.moodEffects = [dist, lpf, gain];
                break;
            }
        }

        // Highlight active mode button
        ['CLEAN','CYBER','GHOST','MONSTER'].forEach(m => {
            const btn = document.getElementById('sve-mood-' + m.toLowerCase());
            if (btn) btn.classList.toggle('active-mode', m === mood);
        });

        SVE.updateStatus('MODE // ' + mood);
    };

    // ── Glitch trigger (word boundary → atmospheric tick) ─────────────────────
    SVE.triggerGlitch = function () {
        if (!SVE.initialized || SVE.currentMood === 'CLEAN') return;
        const Tone = window.Tone;

        // Frequency varies subtly per word to avoid machine-gun monotony
        const freqs = { CYBER: [3800,4200,5000,4600], GHOST: [320,280,360,300], MONSTER: [90,110,80,120] };
        const pool = freqs[SVE.currentMood] || [4000];
        const freq = pool[SVE.wordCount % pool.length];

        SVE.glitchSynth.triggerAttackRelease(freq, '32n', Tone.now());
        SVE.wordCount++;
    };

    // ── Speak (live preview) ──────────────────────────────────────────────────
    SVE.speak = function (text, onEnd) {
        if (!text || !text.trim()) { SVE.updateStatus('NO_SCRIPT'); return; }
        if (!SVE.initialized) { SVE.init().then(() => SVE.speak(text, onEnd)); return; }

        window.speechSynthesis.cancel();
        SVE.wordCount = 0;
        SVE.isPlaying = true;

        const utter = new SpeechSynthesisUtterance(text);

        if (SVE.preferredVoice) {
            utter.voice = SVE.preferredVoice;
            utter.lang  = SVE.preferredVoice.lang;
        }

        // Cinematic defaults. Not touching pitch — browser default sounds most natural.
        utter.rate  = 0.84;
        utter.pitch = 1.0;

        utter.onboundary = e => { if (e.name === 'word') SVE.triggerGlitch(); };
        utter.onstart    = () => { SVE.isPlaying = true;  };
        utter.onend      = () => { SVE.isPlaying = false; if (onEnd) onEnd(); };
        utter.onerror    = e  => { SVE.isPlaying = false; SVE.updateStatus('ERR: ' + e.error); };

        window.speechSynthesis.speak(utter);
    };

    SVE.stop = function () {
        window.speechSynthesis.cancel();
        SVE.isPlaying = false;
        if (SVE._recorder && SVE._recorder.state === 'recording') SVE._recorder.stop();
        SVE.updateStatus('STOPPED');
    };

    // ── RECORD SESSION ────────────────────────────────────────────────────────
    // Taps the Tone.js output via MediaRecorder while speech plays live.
    // Result: an FX-stems WebM file (Opus, 256kbps) ready for DAW mixing.
    // Speech is heard live through speakers — not captured in this file
    // (speechSynthesis routes directly to OS audio, bypassing Web Audio).
    SVE.record = async function (text) {
        if (!text || !text.trim()) { SVE.updateStatus('NO_SCRIPT'); return; }
        if (SVE.isRecording) { SVE.updateStatus('ALREADY RECORDING'); return; }
        if (!SVE.initialized) await SVE.init();

        const Tone = window.Tone;

        // ── Tap Tone.js master output → MediaStreamDestination ──
        const rawCtx = Tone.getContext().rawContext;
        const capDest = rawCtx.createMediaStreamDestination();
        SVE._captureDest = capDest;

        // Connect the last node in the mood effects chain to the capture dest
        // (it's already connected to Tone.Destination; we add a parallel tap)
        const tapNode = SVE.moodEffects.length > 0
            ? SVE.moodEffects[SVE.moodEffects.length - 1]
            : SVE.glitchSynth;
        try { tapNode.connect(capDest); } catch (_) {}

        // ── Set up MediaRecorder ──
        const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus']
            .find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';
        SVE._recChunks = [];
        SVE._recorder  = new MediaRecorder(capDest.stream, { mimeType: mime, audioBitsPerSecond: 256000 });

        SVE._recorder.ondataavailable = e => { if (e.data.size > 0) SVE._recChunks.push(e.data); };

        SVE._recorder.onstop = async () => {
            SVE.isRecording = false;
            const recordBtn = document.getElementById('sve-record-btn');
            if (recordBtn) { recordBtn.textContent = '⏺ RECORD'; recordBtn.style.color = ''; }
            SVE.updateDot(false);

            const blob  = new Blob(SVE._recChunks, { type: mime });
            const url   = URL.createObjectURL(blob);
            const ext   = mime.includes('ogg') ? 'ogg' : 'webm';
            const fname = 'SVE_' + SVE.currentMood + '_' + Date.now() + '.' + ext;

            // Save to Puter.fs
            if (window.puter && puter.fs) {
                try {
                    const ab = await blob.arrayBuffer();
                    await puter.fs.write(fname, new Uint8Array(ab), { createMissingParents: true });
                } catch (e) { console.warn('SVE puter.fs:', e.message); }
            }

            // Queue in audio player
            if (window.APP && APP.audio) {
                APP.audio.playlist.push({ url, name: fname.replace(/\.\w+$/, '') });
                const dot = document.getElementById('audio-dot');
                if (dot) dot.classList.remove('off');
                if (typeof playTrack === 'function') playTrack(APP.audio.playlist.length - 1);
            }

            // Download
            const a = document.createElement('a');
            a.href = url; a.download = fname;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);

            SVE.updateStatus('SAVED // ' + fname.slice(0, 26));

            // Disconnect the capture tap
            try { tapNode.disconnect(capDest); } catch (_) {}
        };

        // ── Start recording then speak ──
        SVE.isRecording = true;
        SVE._recorder.start(80);
        const recordBtn = document.getElementById('sve-record-btn');
        if (recordBtn) { recordBtn.textContent = '■ STOP REC'; recordBtn.style.color = '#ff4444'; }
        SVE.updateDot(true);
        SVE.updateStatus('⏺ REC // ' + SVE.currentMood + ' — speak now');

        // Speak; stop recorder when speech + tail ends
        SVE.speak(text, () => {
            const tail = SVE.currentMood === 'GHOST' ? 3200 : SVE.currentMood === 'MONSTER' ? 1800 : 800;
            setTimeout(() => {
                if (SVE._recorder && SVE._recorder.state === 'recording') SVE._recorder.stop();
            }, tail);
        });
    };

    // ── Expose ────────────────────────────────────────────────────────────────
    window.SVE = SVE;
})();
