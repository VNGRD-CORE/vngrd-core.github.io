// ═══════════════════════════════════════════════════════════════
// SONIC SUITE MODULE — studio shell, master clock, card registry
// Extracted from main.js. Depends on: APP, igniteAudio (globals)
// Exports: window.SonicSuite, window._ssAnalyser, window._ssReverbReturn
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  VNGRD SONIC SUITE — studio shell, master clock, card registry
//  ───────────────────────────────────────────────────────────────
//  SonicSuite.registerCard(id, { label, tag, mount(body, ctx), onTick(time, step), defaults })
//    • body     — DOM node cards render into
//    • ctx.bus  — per-card GainNode (→ master)
//    • ctx.audioCtx / ctx.master / ctx.reverbSend
//    • onTick(time, step16)  — called just-in-time for each 16th note
//  Single lookahead scheduler anchored to audioCtx.currentTime,
//  25 ms tick, 120 ms lookahead. Cards share a mute matrix driven
//  by the master bar's [D][B][C][M] toggles and a focus flag.
// ═══════════════════════════════════════════════════════════════
window.SonicSuite = (function() {
    const LS_KEY = 'vngrd.sonicsuite.v2';
    const LOOK  = 0.12;   // 120 ms lookahead
    const TICK  = 25;     // 25 ms scheduler interval

    const state = {
        open:     false,
        playing:  false,
        bpm:      120,
        step:     0,         // 16th-note counter since start
        barLen:   16,        // steps per bar (4/4)
        startT:   0,         // audioCtx time when transport started
        nextTime: 0,
        mutes:    {},      // id → bool
        focused:  null,    // id of focused card, or null
        cards:    {},      // id → { spec, dom, bus }
        order:    [],
    };
    let _schedId = null;
    let _audio   = null;  // { ctx, master, reverb, reverbSend }

    function _ensureAudio() {
        if (_audio) return _audio;
        if (typeof igniteAudio === 'function' && !APP.audio.ctx) igniteAudio();
        const ctx = APP.audio.ctx;
        if (!ctx) return null;
        const masterOut = APP.audio.masterGain || ctx.destination;

        // Master bus — cards sum here, then glue-compression, then a soft
        // limiter, then straight out. No post-limiter makeup (it would only
        // drive the next stage back into clipping). Slightly lower master
        // gain leaves headroom for three or four cards playing at once.
        const master = ctx.createGain();
        master.gain.value = 0.72;

        const glue = ctx.createDynamicsCompressor();
        glue.threshold.value = -14;
        glue.knee.value      = 18;
        glue.ratio.value     = 3.2;
        glue.attack.value    = 0.005;
        glue.release.value   = 0.12;

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value      = 0;
        limiter.ratio.value     = 20;
        limiter.attack.value    = 0.001;
        limiter.release.value   = 0.05;

        master.connect(glue).connect(limiter).connect(masterOut);

        // Shared reverb send (short plate IR). reverbSend is the input bus;
        // reverbReturn controls how much wet signal the master hears.
        const reverb = ctx.createConvolver();
        reverb.buffer = _buildIR(ctx, 1.0, 2.4);
        const reverbSend   = ctx.createGain();
        const reverbReturn = ctx.createGain();
        reverbSend.gain.value   = 1.0;
        reverbReturn.gain.value = 0.22;
        reverbSend.connect(reverb).connect(reverbReturn).connect(master);

        // Master analyser for VU meter (taps the post-limiter signal)
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        limiter.connect(analyser);

        // Public handles for the mixer card
        window._ssAnalyser     = analyser;
        window._ssReverbReturn = reverbReturn;

        _audio = { ctx, master, reverb, reverbSend, reverbReturn, analyser, glue, limiter };
        return _audio;
    }

    function _buildIR(ctx, seconds, decay) {
        // Short plate-style IR: zero-padded pre-delay, per-channel decorrelated noise,
        // exponential decay, gentle low-pass colouring so the tail sits behind the dry mix.
        const rate    = ctx.sampleRate;
        const len     = Math.floor(rate * seconds);
        const pre     = Math.floor(rate * 0.012);
        const ir      = ctx.createBuffer(2, len, rate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            let lp = 0;
            for (let i = 0; i < len; i++) {
                if (i < pre) { d[i] = 0; continue; }
                const env = Math.pow(1 - (i - pre) / (len - pre), decay);
                const n   = (Math.random() * 2 - 1) * env;
                lp += (n - lp) * 0.35; // one-pole LP for warmth
                d[i] = lp;
            }
        }
        return ir;
    }

    function _stepDur() { return 60 / state.bpm / 4; }   // 16th note

    function _scheduler() {
        if (!_audio) return;
        const now = _audio.ctx.currentTime;
        while (state.nextTime < now + LOOK) {
            const t    = state.nextTime;
            const s    = state.step;
            const s16  = s % 16;
            // Fire each registered card if not muted / masked by focus
            state.order.forEach(function(id) {
                if (state.mutes[id]) return;
                if (state.focused && state.focused !== id) return;
                const card = state.cards[id];
                if (card && typeof card.spec.onTick === 'function') {
                    try { card.spec.onTick(t, s16, s); }
                    catch (e) { log('SS: TICK_ERR ' + id); }
                }
            });
            state.nextTime += _stepDur();
            state.step = s + 1;
        }
        _paintTransport(now);
    }

    function _paintTransport(now) {
        if (!state.playing) return;
        const elapsed = Math.max(0, now - state.startT);
        const spb     = 60 / state.bpm;
        const beatF   = elapsed / spb;                // fractional beats since start
        const bar     = Math.floor(beatF / 4) + 1;
        const beat    = Math.floor(beatF) % 4 + 1;
        const sixt    = Math.floor(beatF * 4) % 4 + 1;
        // Metronome dots — dot `beat-1` lit for the duration of that beat.
        const dots = document.querySelectorAll('#ss-metro .ss-mb-dot');
        const bi = beat - 1;
        dots.forEach(function(d, i) { d.classList.toggle('on', i === bi); });
        // BAR.BEAT.16TH readout
        const barEl  = document.getElementById('ss-clock-bar');
        const timeEl = document.getElementById('ss-clock-time');
        if (barEl)  barEl.textContent = String(bar).padStart(3,'0') + '.' + beat + '.' + String(sixt).padStart(2,'0');
        if (timeEl) {
            const m  = Math.floor(elapsed / 60);
            const sS = elapsed - m * 60;
            const s  = Math.floor(sS);
            const cs = Math.floor((sS - s) * 100);
            timeEl.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + '.' + String(cs).padStart(2,'0');
        }
    }

    function start() {
        const a = _ensureAudio();
        if (!a) return;
        if (a.ctx.state === 'suspended') a.ctx.resume();
        if (state.playing) return;
        state.playing  = true;
        state.step     = 0;
        state.startT   = a.ctx.currentTime + 0.05;
        state.nextTime = state.startT;
        _schedId = setInterval(_scheduler, TICK);
        const btn = document.getElementById('ss-play');
        if (btn) { btn.textContent = '▶ PLAYING'; btn.classList.add('playing'); }
        state.order.forEach(_paintCardPlay);
    }

    function stop() {
        state.playing = false;
        if (_schedId) { clearInterval(_schedId); _schedId = null; }
        const btn = document.getElementById('ss-play');
        if (btn) { btn.textContent = '▶ PLAY ALL'; btn.classList.remove('playing'); }
        document.querySelectorAll('#ss-metro .ss-mb-dot').forEach(function(d) { d.classList.remove('on'); });
        const barEl  = document.getElementById('ss-clock-bar');
        const timeEl = document.getElementById('ss-clock-time');
        if (barEl)  barEl.textContent  = '001.1.01';
        if (timeEl) timeEl.textContent = '00:00.00';
        // Let cards release their tails
        state.order.forEach(function(id) {
            const c = state.cards[id];
            if (c && typeof c.spec.onStop === 'function') { try { c.spec.onStop(); } catch (e) {} }
        });
        state.order.forEach(_paintCardPlay);
    }

    function setBPM(v) {
        v = Math.max(40, Math.min(300, +v || 120));
        state.bpm = v;
        const inp = document.getElementById('ss-bpm');
        if (inp && +inp.value !== v) inp.value = v;
        window.currentBPM = v;
    }

    function registerCard(id, spec) {
        if (state.cards[id]) return state.cards[id];
        const a = _ensureAudio();
        const bus = a ? a.ctx.createGain() : null;
        const reverbTap = a ? a.ctx.createGain() : null;
        if (bus && a) {
            bus.gain.value = 0.62;        // per-card headroom so summed mix doesn't slam the limiter
            bus.connect(a.master);
            reverbTap.gain.value = 0.0;
            bus.connect(reverbTap).connect(a.reverbSend);
        }
        const ctx = a ? { audioCtx: a.ctx, master: a.master, bus, reverbSend: a.reverbSend, reverbTap } : null;

        const dom = _buildCardDom(id, spec);
        document.getElementById('ss-workspace').appendChild(dom.root);
        _restoreCardPos(id, dom.root);

        const card = { spec, dom, bus, ctx };
        state.cards[id] = card;
        state.order.push(id);
        _addMbToggle(id, spec);

        try { spec.mount && spec.mount(dom.body, ctx); }
        catch (e) { log('SS: MOUNT_ERR ' + id); }
        return card;
    }

    function _buildCardDom(id, spec) {
        const root = document.createElement('div');
        root.className = 'ss-card';
        root.dataset.cardId = id;
        root.innerHTML =
            '<div class="ss-card-head">' +
              '<span class="ss-card-tag">' + (spec.tag || '') + '</span>' +
              '<span class="ss-card-title">' + (spec.label || id) + '</span>' +
              '<button class="ss-card-btn ss-card-play" data-act="play" title="Play / Pause">▶</button>' +
              '<button class="ss-card-btn" data-act="min" title="Minimise">_</button>' +
              '<button class="ss-card-btn" data-act="focus" title="Solo focus">◉</button>' +
            '</div>' +
            '<div class="ss-card-body"></div>';
        const body = root.querySelector('.ss-card-body');

        // Drag
        const head = root.querySelector('.ss-card-head');
        head.addEventListener('mousedown', function(e) {
            if (e.target.classList.contains('ss-card-btn')) return;
            _startDrag(root, id, e);
        });
        // Per-card play/stop
        const playBtn = root.querySelector('[data-act=play]');
        playBtn.addEventListener('click', function() {
            const card = state.cards[id];
            if (card && typeof card.spec.onCardPlay === 'function') {
                // Card handles its own transport (e.g. CODE)
                card.spec.onCardPlay(playBtn);
                return;
            }
            // Default: master transport + mute toggle for this card
            const muted = !!state.mutes[id];
            if (!state.playing) start();
            if (muted) setMute(id, false);
            else if (state.playing) setMute(id, true);
            _paintCardPlay(id);
        });
        // Minimise + focus
        root.querySelector('[data-act=min]').addEventListener('click', function() {
            root.classList.toggle('minimised');
            _saveCardPos(id, root);
        });
        root.querySelector('[data-act=focus]').addEventListener('click', function() {
            setFocus(state.focused === id ? null : id);
        });
        return { root, head, body };
    }

    function _paintCardPlay(id) {
        const root = state.cards[id] && state.cards[id].dom.root;
        if (!root) return;
        const btn = root.querySelector('.ss-card-play');
        if (!btn) return;
        const active = state.playing && !state.mutes[id];
        btn.textContent = active ? '■' : '▶';
        btn.classList.toggle('playing', active);
    }

    function _startDrag(el, id, e) {
        const r = el.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        function mv(ev) {
            el.style.left = Math.max(0, ev.clientX - ox) + 'px';
            el.style.top  = Math.max(60, ev.clientY - oy) + 'px';
        }
        function up() {
            window.removeEventListener('mousemove', mv);
            window.removeEventListener('mouseup', up);
            _saveCardPos(id, el);
        }
        window.addEventListener('mousemove', mv);
        window.addEventListener('mouseup', up);
    }

    function _addMbToggle(id, spec) {
        const wrap = document.getElementById('ss-cardtoggles');
        if (!wrap) return;
        const btn = document.createElement('button');
        btn.className = 'ss-mb-ct';
        btn.dataset.cardId = id;
        btn.textContent = (spec.tag || id[0] || '?').slice(0, 1).toUpperCase();
        btn.title = spec.label || id;
        btn.addEventListener('click', function(e) {
            if (e.shiftKey) { setFocus(state.focused === id ? null : id); return; }
            setMute(id, !state.mutes[id]);
        });
        wrap.appendChild(btn);
    }

    function setMute(id, muted) {
        state.mutes[id] = !!muted;
        const c = state.cards[id];
        if (c && c.bus) c.bus.gain.setTargetAtTime(muted ? 0 : 1, _audio.ctx.currentTime, 0.01);
        const btn = document.querySelector('.ss-mb-ct[data-card-id="' + id + '"]');
        if (btn) btn.classList.toggle('muted', !!muted);
        if (c) c.dom.root.classList.toggle('muted', !!muted);
        _paintCardPlay(id);
    }

    function setFocus(id) {
        state.focused = id;
        state.order.forEach(function(cid) {
            const c = state.cards[cid];
            if (!c) return;
            c.dom.root.classList.toggle('focused', cid === id);
        });
        document.querySelectorAll('.ss-mb-ct').forEach(function(b) {
            b.classList.toggle('focused', b.dataset.cardId === id);
        });
    }

    function _loadState() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
        catch (e) { return {}; }
    }
    function _saveState(s) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
    }
    function _saveCardPos(id, el) {
        const s = _loadState();
        s.cards = s.cards || {};
        s.cards[id] = {
            left: parseInt(el.style.left, 10) || null,
            top:  parseInt(el.style.top, 10)  || null,
            min:  el.classList.contains('minimised')
        };
        _saveState(s);
    }
    function _restoreCardPos(id, el) {
        const s = _loadState();
        const cp = (s.cards || {})[id];
        if (cp) {
            if (cp.left != null) el.style.left = cp.left + 'px';
            if (cp.top  != null) el.style.top  = cp.top  + 'px';
            if (cp.min) el.classList.add('minimised');
        } else {
            // Default dock: cards land along the bottom edge so the centre
            // canvas (images / video / VJ rig) stays visible while playing.
            const n  = state.order.length;
            const W  = 600, GAP = 16;
            const vw = window.innerWidth  || 1920;
            const vh = window.innerHeight || 1080;
            const totalRow = 3 * W + 2 * GAP;
            const startX   = Math.max(20, (vw - totalRow) / 2);
            el.style.left = (startX + n * (W + GAP)) + 'px';
            el.style.top  = (vh - 440) + 'px';
        }
    }

    function open() {
        const bd = document.getElementById('ss-backdrop');
        if (!bd) return;
        bd.classList.add('visible');
        // Default to stealth (canvas visible) unless user explicitly turned it off
        const pref = localStorage.getItem('vngrd.sonicsuite.stealth');
        if (pref !== '0') bd.classList.add('stealth');
        _syncCanvasBtn();
        state.open = true;
        const btn = document.getElementById('vt-sonic-launch-btn');
        if (btn) btn.classList.add('active');
        const status = document.getElementById('vt-sonic-status');
        if (status) { status.textContent = 'STUDIO LIVE'; status.classList.add('live'); }
        _ensureAudio();
    }
    function _syncCanvasBtn() {
        const bd = document.getElementById('ss-backdrop');
        const b  = document.getElementById('ss-canvas-btn');
        if (!bd || !b) return;
        const on = bd.classList.contains('stealth');
        b.style.borderColor = on ? '#00f3ff' : '';
        b.style.color       = on ? '#00f3ff' : '';
        b.style.background  = on ? 'rgba(0,243,255,.14)' : '';
        b.textContent       = on ? '◈ CANVAS ON' : '◈ CANVAS';
    }
    function close() {
        stop();
        const bd = document.getElementById('ss-backdrop');
        if (bd) bd.classList.remove('visible');
        state.open = false;
        const btn = document.getElementById('vt-sonic-launch-btn');
        if (btn) btn.classList.remove('active');
        const status = document.getElementById('vt-sonic-status');
        if (status) { status.textContent = 'MPC · 303 · XY PAD · MIXER'; status.classList.remove('live'); }
    }
    function toggle() { state.open ? close() : open(); }

    document.addEventListener('DOMContentLoaded', function() {
        const bpm = document.getElementById('ss-bpm');
        if (bpm) bpm.addEventListener('input', function() { setBPM(bpm.value); });
        const play = document.getElementById('ss-play');
        if (play) play.addEventListener('click', start);
        const stopB = document.getElementById('ss-stop');
        if (stopB) stopB.addEventListener('click', stop);
        const hide = document.getElementById('ss-hide');
        if (hide) hide.addEventListener('click', close);
        const canvasBtn = document.getElementById('ss-canvas-btn');
        if (canvasBtn) canvasBtn.addEventListener('click', function() {
            const bd = document.getElementById('ss-backdrop');
            if (!bd) return;
            bd.classList.toggle('stealth');
            localStorage.setItem('vngrd.sonicsuite.stealth', bd.classList.contains('stealth') ? '1' : '0');
            _syncCanvasBtn();
        });

        // ── REC: MediaRecorder tap off the limiter, downloads .webm on stop ──
        const recBtn = document.getElementById('ss-rec');
        let _rec = null, _recChunks = [], _recDest = null;
        if (recBtn) recBtn.addEventListener('click', function() {
            const a = _ensureAudio(); if (!a) return;
            if (_rec && _rec.state === 'recording') {
                _rec.stop();
                recBtn.textContent = '● REC';
                recBtn.style.background = '';
                recBtn.classList.remove('playing');
                return;
            }
            if (!_recDest) {
                _recDest = a.ctx.createMediaStreamDestination();
                a.limiter.connect(_recDest);
            }
            _recChunks = [];
            try {
                _rec = new MediaRecorder(_recDest.stream, { mimeType: 'audio/webm;codecs=opus' });
            } catch (e) { _rec = new MediaRecorder(_recDest.stream); }
            _rec.ondataavailable = e => { if (e.data && e.data.size) _recChunks.push(e.data); };
            _rec.onstop = () => {
                const blob = new Blob(_recChunks, { type: _rec.mimeType || 'audio/webm' });
                const url  = URL.createObjectURL(blob);
                const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const link = document.createElement('a');
                link.href = url; link.download = 'vngrd-' + ts + '.webm';
                document.body.appendChild(link); link.click();
                setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 400);
            };
            _rec.start();
            recBtn.textContent = '■ STOP REC';
            recBtn.style.background = 'rgba(255,60,60,.25)';
            recBtn.classList.add('playing');
        });

        // Esc closes
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && state.open) close();
        });
    });

    return {
        open, close, toggle,
        start, stop, setBPM,
        registerCard, setMute, setFocus,
        _state: state,
    };
})();


