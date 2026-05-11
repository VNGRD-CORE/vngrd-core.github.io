// ═══════════════════════════════════════════════════════════════
// CODE CARD MODULE — live-coding DSL for Sonic Suite
// Extracted from main.js. Depends on: SonicSuite, window.play, window.synth (globals)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  VNGRD CODE CARD — live-coding DSL
//  Exposed in the sandbox: bpm, beat, play, synth, loop, tone
//    bpm(v)          — set master BPM
//    await beat(v)   — wait v beats anchored to the master clock
//    play(n, vol?)   — fire Sampler pad (window.play passthrough)
//    synth(t, n, v)  — InternalSynth voice (window.synth passthrough)
//    tone(hz, dur, env?) — quick sine lead through the card bus
//    loop(fn)        — re-run fn forever until STOP
//  Program executes as an async function; STOP sets cancel=true and
//  the next beat()/loop iteration rejects.
// ═══════════════════════════════════════════════════════════════
(function() {
    const DEFAULT_CODE =
        "// VNGRD live-coder. Press ▶ RUN or ◎ LOOP.\n" +
        "bpm(128);\n" +
        "const notes = [55, 110, 73.4, 82.4];\n" +
        "await loop(async () => {\n" +
        "  for (const n of notes) {\n" +
        "    tone(n,      0.22, { wave:'sawtooth', peak:0.28, filter:900 });\n" +
        "    tone(n * 2,  0.18, { wave:'triangle', peak:0.18 });\n" +
        "    await beat(0.5);\n" +
        "  }\n" +
        "});\n";

    function _makeApi(ctx, cancelRef) {
        const state = SonicSuite._state;
        function _waitBeats(v) {
            return new Promise(function(resolve, reject) {
                const a = ctx.audioCtx;
                const spb = 60 / state.bpm;
                const target = a.currentTime + v * spb;
                function poll() {
                    if (cancelRef.cancel) return reject(new Error('cancel'));
                    if (a.currentTime >= target) return resolve();
                    setTimeout(poll, 8);
                }
                poll();
            });
        }
        // Richer tone: dual detuned oscs + optional LPF, ADSR-ish envelope.
        // env = { wave, peak, attack, release, filter (cutoff Hz), q, detune }
        function _tone(hz, dur, env) {
            const a = ctx.audioCtx;
            const t = a.currentTime;
            env = env || {};
            const wave    = env.wave    || 'sine';
            const peak    = env.peak    != null ? env.peak    : 0.32;
            const attack  = env.attack  != null ? env.attack  : 0.005;
            const release = env.release != null ? env.release : Math.min(0.3, dur * 0.5);
            const dt      = env.detune  != null ? env.detune  : (wave === 'sine' ? 0 : 9);
            const g = a.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(peak, t + attack);
            g.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            let tail = g;
            if (env.filter) {
                const f = a.createBiquadFilter();
                f.type = 'lowpass';
                f.frequency.value = env.filter;
                f.Q.value = env.q != null ? env.q : 1.2;
                g.connect(f); tail = f;
            }
            function _osc(detCents, level) {
                const o = a.createOscillator();
                o.type = wave;
                o.frequency.setValueAtTime(hz, t);
                if (detCents) o.detune.value = detCents;
                const og = a.createGain(); og.gain.value = level;
                o.connect(og).connect(g);
                o.start(t); o.stop(t + dur + 0.2);
            }
            _osc(0, dt ? 0.55 : 0.8);
            if (dt) _osc(+dt, 0.45);
            tail.connect(ctx.bus);
        }
        // Awaitable loop: blocks until cancelled. Inside: run fn forever.
        // Guarded so a second loop() call with the same cancelRef returns
        // the existing promise instead of stacking a parallel loop — this
        // makes LOOP mode safe even if the user forgets `await`.
        function _loop(fn) {
            if (cancelRef._loopActive) return cancelRef._loopActive;
            const p = (async function run() {
                while (!cancelRef.cancel) {
                    try { await fn(); }
                    catch (e) {
                        if (cancelRef.cancel || (e && e.message === 'cancel')) return;
                        throw e;
                    }
                    await new Promise(r => setTimeout(r, 0));
                }
            })();
            cancelRef._loopActive = p;
            return p;
        }
        return {
            bpm:   v => SonicSuite.setBPM(v),
            beat:  _waitBeats,
            play:  (n, v) => (typeof window.play === 'function' ? window.play(n, v) : null),
            synth: (...args) => (typeof window.synth === 'function' ? window.synth.apply(null, args) : null),
            tone:  _tone,
            loop:  _loop
        };
    }

    function init() {
        SonicSuite.registerCard('code', {
            tag: 'C',
            label: '◈ CODE',
            mount(body, ctx) {
                const state = { cancelRef: { cancel: false }, running: false };

                const ta = document.createElement('textarea');
                ta.className = 'ss-code-ta';
                ta.value = DEFAULT_CODE;
                ta.spellcheck = false;
                ta.style.cssText =
                    'width:100%;min-height:150px;padding:8px;' +
                    'background:#00060a;color:#9ff;border:1px solid rgba(0,243,255,.3);' +
                    'font-family:\'JetBrains Mono\',monospace;font-size:10px;line-height:1.4;' +
                    'resize:vertical;outline:none;border-radius:2px;';
                body.appendChild(ta);

                const row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:6px;align-items:center;';
                row.innerHTML =
                    '<button class="ss-card-btn ss-code-run"  style="width:auto;padding:0 10px;">▶ RUN</button>' +
                    '<button class="ss-card-btn ss-code-loop" style="width:auto;padding:0 10px;">◎ LOOP</button>' +
                    '<button class="ss-card-btn ss-code-stop" style="width:auto;padding:0 10px;color:rgba(255,120,0,.85);border-color:rgba(255,120,0,.4);">■ STOP</button>' +
                    '<span class="ss-code-status" style="flex:1;text-align:right;font-family:\'JetBrains Mono\',monospace;font-size:9px;color:rgba(0,243,255,.45);">IDLE</span>';
                body.appendChild(row);

                const status = row.querySelector('.ss-code-status');
                function _run(looped) {
                    if (state.running) _stop();
                    const cancel = { cancel: false };
                    state.cancelRef = cancel;
                    state.running = true;
                    status.textContent = looped ? 'LOOPING' : 'RUNNING';
                    status.style.color = '#00f3ff';
                    const api = _makeApi(ctx, cancel);
                    const src = ta.value;
                    const wrapped = looped
                        ? 'return (async function(){ while(!__cancel.cancel){ await (async function(){\n' + src + '\n}).call(null); } })();'
                        : 'return (async function(){\n' + src + '\n})();';
                    try {
                        const fn = new Function('bpm','beat','play','synth','loop','tone','__cancel', wrapped);
                        const p = fn(api.bpm, api.beat, api.play, api.synth, api.loop, api.tone, cancel);
                        Promise.resolve(p).then(
                            () => {
                                if (state.cancelRef !== cancel) return;
                                state.running = false;
                                status.textContent = cancel.cancel ? 'STOPPED' : 'DONE';
                                status.style.color = cancel.cancel ? 'rgba(255,120,0,.85)' : 'rgba(0,243,255,.5)';
                            },
                            err => {
                                if (state.cancelRef !== cancel) return;
                                state.running = false;
                                const msg = (err && err.message) || String(err);
                                if (msg === 'cancel') {
                                    status.textContent = 'STOPPED';
                                    status.style.color = 'rgba(255,120,0,.85)';
                                } else {
                                    status.textContent = 'ERR: ' + msg.slice(0, 40);
                                    status.style.color = '#ff4444';
                                }
                            }
                        );
                    } catch (e) {
                        state.running = false;
                        status.textContent = 'PARSE: ' + e.message.slice(0, 40);
                        status.style.color = '#ff4444';
                    }
                }
                function _stop() {
                    if (state.cancelRef) state.cancelRef.cancel = true;
                    state.running = false;
                    status.textContent = 'STOPPED';
                    status.style.color = 'rgba(255,120,0,.85)';
                }

                row.querySelector('.ss-code-run').addEventListener('click',  () => _run(false));
                row.querySelector('.ss-code-loop').addEventListener('click', () => _run(true));
                row.querySelector('.ss-code-stop').addEventListener('click', _stop);

                this._stop = _stop;
                this._runLoop = () => _run(true);
                this._isRunning = () => state.running;
            },
            onStop() { if (this._stop) this._stop(); },
            onCardPlay(btn) {
                if (this._isRunning && this._isRunning()) {
                    if (this._stop) this._stop();
                    btn.textContent = '▶';
                    btn.classList.remove('playing');
                } else if (this._runLoop) {
                    this._runLoop();
                    btn.textContent = '■';
                    btn.classList.add('playing');
                }
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function() {
        const btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(init, 90);
        }
        btn && btn.addEventListener('click', _once);
    });
})();


