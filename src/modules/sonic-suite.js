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
    const LS_KEY = 'vngrd.sonicsuite.v7';   // bumped: ID-based default positions, clear stale layout
    const LOOK  = 0.18;   // 180 ms lookahead — more headroom against jank
    const TICK  = 25;     // 25 ms scheduler interval

    // ── Worker-based timer ────────────────────────────────────
    // setInterval inside a Web Worker is isolated from main-thread
    // jank (canvas rendering, GC, layout).  This eliminates audio
    // dropouts caused by the browser throttling main-thread timers.
    const _TIMER_SRC = 'var t;onmessage=function(e){if(e.data==="start"){t=setInterval(function(){postMessage(null)},25)}else{clearInterval(t);}};';
    let _timerWorker = null;
    function _getTimer() {
        if (_timerWorker) return _timerWorker;
        try {
            var blob = new Blob([_TIMER_SRC], { type: 'text/javascript' });
            _timerWorker = new Worker(URL.createObjectURL(blob));
            _timerWorker.onmessage = function () { _scheduler(); };
        } catch (e) { _timerWorker = null; }
        return _timerWorker;
    }

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

        // Public handles for the mixer card and FX unit
        window._ssAnalyser     = analyser;
        window._ssReverbReturn = reverbReturn;
        window._ssGlue         = glue;
        window._ssLimiter      = limiter;
        window._ssMaster       = master;

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
        const wt = _getTimer();
        if (wt) { wt.postMessage('start'); }
        else { _schedId = setInterval(_scheduler, TICK); }
        const btn = document.getElementById('ss-play');
        if (btn) { btn.textContent = '▶ PLAYING'; btn.classList.add('playing'); }
        state.order.forEach(_paintCardPlay);
    }

    function stop() {
        state.playing = false;
        const wt = _getTimer(); if (wt) wt.postMessage('stop');
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
                card.spec.onCardPlay(playBtn);
                return;
            }
            const muted = !!state.mutes[id];
            if (!state.playing) {
                // Transport was stopped: start it. Only unmute if this card was muted; leave others alone.
                start();
                if (muted) setMute(id, false);
                // Do NOT mute — starting transport plays whatever is currently unmuted.
            } else {
                // Transport running: toggle this card's mute only.
                setMute(id, !muted);
            }
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
    // Default positions designed for ~1440px wide viewport.
    // Left col (x=14): Beat Forge top, Void Pad below.
    // Right col (x=50%+6px): Acid Line top, FX Unit below, Mixer below that.
    const _POS = {
        mpc:     { left: '14px',            top: '14px'  },
        xypad:   { left: '14px',            top: '400px' },
        bass303: { left: 'calc(50% + 6px)', top: '14px'  },
        fxunit:  { left: 'calc(50% + 6px)', top: '275px' },
        mixer:   { left: 'calc(50% + 6px)', top: '630px' },
    };

    function _restoreCardPos(id, el) {
        const s = _loadState();
        const cp = (s.cards || {})[id];
        if (cp) {
            if (cp.left != null) el.style.left = cp.left + 'px';
            if (cp.top  != null) el.style.top  = cp.top  + 'px';
            if (cp.min) el.classList.add('minimised');
        } else {
            const def = _POS[id];
            if (def) {
                el.style.left = def.left;
                el.style.top  = def.top;
            } else {
                const n = state.order.length;
                el.style.left = (16 + (n % 2) * 614) + 'px';
                el.style.top  = (16 + Math.floor(n / 2) * 496) + 'px';
            }
        }
    }

    function open() {
        const bd = document.getElementById('ss-backdrop');
        if (!bd) return;
        bd.classList.add('visible');
        // Restore saved opacity (default 88% opaque)
        const savedOp = localStorage.getItem('vngrd.sonicsuite.opacity');
        const op = document.getElementById('ss-opacity');
        const opVal = savedOp != null ? +savedOp : 88;
        if (op) op.value = opVal;
        _applyOpacity(opVal);
        // Restore master volume
        const savedVol = localStorage.getItem('vngrd.sonicsuite.mastervol');
        const mv = document.getElementById('ss-master-vol');
        const mvv = document.getElementById('ss-master-vol-val');
        if (mv && savedVol != null) { mv.value = +savedVol; if (mvv) mvv.textContent = +savedVol + '%'; }
        _syncCanvasBtn();
        state.open = true;
        const btn = document.getElementById('vt-sonic-launch-btn');
        if (btn) btn.classList.add('active');
        const status = document.getElementById('vt-sonic-status');
        if (status) { status.textContent = 'STUDIO LIVE'; status.classList.add('live'); }
        _ensureAudio();
        // Start VU meter
        setTimeout(_startVU, 400);
    }
    function _syncCanvasBtn() {
        const bd = document.getElementById('ss-backdrop');
        const b  = document.getElementById('ss-canvas-btn');
        if (!bd || !b) return;
        const transparent = bd.classList.contains('stealth');
        b.classList.toggle('active', transparent);
        b.title = transparent ? 'Canvas passthrough ON — click to restore opacity' : 'Click to toggle full canvas passthrough';
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

    // ── Tap tempo ─────────────────────────────────────────────
    let _tapTimes = [];
    function _tap() {
        const now = performance.now();
        _tapTimes = _tapTimes.filter(function (t) { return now - t < 3500; });
        _tapTimes.push(now);
        if (_tapTimes.length >= 2) {
            var sum = 0;
            for (var i = 1; i < _tapTimes.length; i++) sum += _tapTimes[i] - _tapTimes[i - 1];
            var bpm = Math.round(60000 / (sum / (_tapTimes.length - 1)));
            setBPM(bpm);
        }
    }

    // ── Layout snap ───────────────────────────────────────────
    // Two columns: left (mpc, xypad) and right (bass303, fxunit, mixer).
    // Heights are measured live so nothing overlaps regardless of content.
    function snapLayout() {
        const GAP  = 12;
        const M    = 14;
        const WW   = window.innerWidth;
        const half = Math.max(320, Math.floor((WW - M * 2 - GAP) / 2));
        const COL  = { mpc: 0, xypad: 0, bass303: 1, fxunit: 1, mixer: 1 };
        const ORDER = ['mpc', 'bass303', 'xypad', 'fxunit', 'mixer'];
        const byCol = [[], []];
        ORDER.forEach(function(id) {
            if (!state.cards[id]) return;
            byCol[(COL[id] !== undefined ? COL[id] : 0)].push(id);
        });
        // Extra registered cards go right
        state.order.forEach(function(id) {
            if (!state.cards[id]) return;
            if (ORDER.indexOf(id) === -1) byCol[1].push(id);
        });
        const tops = [M, M];
        [0, 1].forEach(function(ci) {
            byCol[ci].forEach(function(id) {
                const card = state.cards[id];
                if (!card) return;
                const el = card.dom.root;
                el.classList.remove('minimised');
                el.style.width = half + 'px';
                el.style.left  = (M + ci * (half + GAP)) + 'px';
                el.style.top   = tops[ci] + 'px';
                tops[ci] += el.offsetHeight + GAP;
            });
        });
        // Save new positions
        const s = _loadState();
        s.cards = {};
        state.order.forEach(function(id) {
            const card = state.cards[id];
            if (!card) return;
            const el = card.dom.root;
            s.cards[id] = { left: parseInt(el.style.left, 10), top: parseInt(el.style.top, 10) };
        });
        _saveState(s);
    }

    // ── VU meter ──────────────────────────────────────────────
    let _vuBuf = null, _vuAnimId = null, _vuPeak = 0, _vuPeakAge = 0;
    function _startVU() {
        if (_vuAnimId) return;
        const canvas = document.getElementById('ss-vu');
        if (!canvas) return;
        const c = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;

        function _draw() {
            _vuAnimId = requestAnimationFrame(_draw);
            if (!_audio || !_audio.analyser) return;
            if (!_vuBuf || _vuBuf.length !== _audio.analyser.fftSize) {
                _vuBuf = new Float32Array(_audio.analyser.fftSize);
            }
            _audio.analyser.getFloatTimeDomainData(_vuBuf);
            var rms = 0;
            for (var i = 0; i < _vuBuf.length; i++) rms += _vuBuf[i] * _vuBuf[i];
            rms = Math.sqrt(rms / _vuBuf.length);
            var norm = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-7) + 60) / 60));

            if (norm > _vuPeak) { _vuPeak = norm; _vuPeakAge = 0; }
            else { _vuPeakAge++; if (_vuPeakAge > 50) _vuPeak = Math.max(0, _vuPeak - 0.005); }

            c.clearRect(0, 0, W, H);
            c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, 0, W, H);

            if (norm > 0.002) {
                var grd = c.createLinearGradient(0, 0, W, 0);
                grd.addColorStop(0,    '#00f3ff');
                grd.addColorStop(0.6,  '#00ff88');
                grd.addColorStop(0.82, '#ffcc00');
                grd.addColorStop(1,    '#ff4444');
                c.fillStyle = grd;
                c.fillRect(1, 2, (W - 2) * norm, H - 4);
            }
            // Peak hold
            if (_vuPeak > 0.02) {
                c.fillStyle = _vuPeak > 0.9 ? '#ff4444' : 'rgba(0,243,255,.9)';
                c.fillRect(Math.floor((W - 2) * _vuPeak), 1, 2, H - 2);
            }
            // Scale ticks: -24, -12, -6, -3, 0 dBFS
            [-24, -12, -6, -3].forEach(function (db) {
                var x = Math.floor((W - 2) * Math.max(0, (db + 60) / 60));
                c.fillStyle = 'rgba(0,243,255,.2)';
                c.fillRect(x, H - 3, 1, 3);
            });
        }
        _draw();
    }

    // ── Opacity slider ────────────────────────────────────────
    function _applyOpacity(v) {
        const bd = document.getElementById('ss-backdrop');
        if (!bd) return;
        const t = v / 100;
        if (t < 0.02) {
            bd.classList.add('stealth');
            bd.style.background    = '';
            bd.style.backdropFilter = '';
        } else {
            bd.classList.remove('stealth');
            bd.style.background    = 'rgba(1,5,11,' + (t * 0.96) + ')';
            bd.style.backdropFilter = 'blur(' + Math.round(t * 18) + 'px) saturate(1.1)';
        }
        localStorage.setItem('vngrd.sonicsuite.opacity', v);
        _syncCanvasBtn();
    }

    document.addEventListener('DOMContentLoaded', function() {
        const bpm = document.getElementById('ss-bpm');
        if (bpm) bpm.addEventListener('input', function() { setBPM(bpm.value); });
        const play = document.getElementById('ss-play');
        if (play) play.addEventListener('click', start);
        const stopB = document.getElementById('ss-stop');
        if (stopB) stopB.addEventListener('click', stop);
        const hide = document.getElementById('ss-hide');
        if (hide) hide.addEventListener('click', close);

        // Tap tempo
        const tapBtn = document.getElementById('ss-tap');
        if (tapBtn) tapBtn.addEventListener('click', _tap);

        // Master volume
        const masterVol = document.getElementById('ss-master-vol');
        const masterVolVal = document.getElementById('ss-master-vol-val');
        if (masterVol) masterVol.addEventListener('input', function () {
            const v = +this.value;
            if (masterVolVal) masterVolVal.textContent = v + '%';
            if (_audio && _audio.master) _audio.master.gain.setTargetAtTime(v / 100 * 0.82, _audio.ctx.currentTime, 0.04);
            localStorage.setItem('vngrd.sonicsuite.mastervol', v);
        });

        // Snap layout
        const snapBtn = document.getElementById('ss-snap-btn');
        if (snapBtn) snapBtn.addEventListener('click', snapLayout);

        // Opacity slider (replaces toggle)
        const opSlider = document.getElementById('ss-opacity');
        if (opSlider) {
            const saved = localStorage.getItem('vngrd.sonicsuite.opacity');
            if (saved != null) { opSlider.value = +saved; }
            opSlider.addEventListener('input', function () { _applyOpacity(+this.value); });
        }

        const canvasBtn = document.getElementById('ss-canvas-btn');
        if (canvasBtn) canvasBtn.addEventListener('click', function() {
            const op = document.getElementById('ss-opacity');
            if (op) {
                const newVal = +op.value < 10 ? 88 : 0;  // toggle between transparent and opaque
                op.value = newVal;
                _applyOpacity(newVal);
            }
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
        snapLayout,
        _state: state,
    };
})();


