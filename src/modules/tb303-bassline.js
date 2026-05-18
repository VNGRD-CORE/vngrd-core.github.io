// ═══════════════════════════════════════════════════════════════
// VNGRD//ACID LINE — acid bass synth, monophonic
// STEP mode: 16-step sequencer (8 patterns), slide + accent
// LIVE mode: real-time playable keyboard (mouse + MIDI NoteOn/Off)
// MIDI: NoteOn/Off in LIVE mode plays notes; CC learn on sliders.
// BPM always reads window.currentBPM from master clock.
// Depends on: SonicSuite (global)
// Registers card id: 'bass303'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NUM_STEPS = 16;
    const NUM_PATS  = 8;
    const LS_KEY    = 'vngrd.acidline.v1';

    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    function _noteName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
    function _midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

    // patterns[pat][step] = { on, note, slide, accent }
    const patterns = Array.from({ length: NUM_PATS }, function () {
        return Array.from({ length: NUM_STEPS }, function () {
            return { on: false, note: 36, slide: false, accent: false };
        });
    });

    const P = {
        waveform:   'sawtooth',
        cutoff:     380,
        resonance:  7,
        envMod:     0.42,
        decay:      0.28,
        accentVol:  0.25,
        distortion: 0,
        glide:      0.055,
        volume:     0.65,
    };

    let curPat      = 0;
    let selectedStp = -1;
    let curStep     = -1;
    let liveMode    = false;
    let _ctx, _bus;

    let _osc    = null;
    let _filter = null;
    let _amp    = null;
    let _dist   = null;
    let _voiceOn = false;

    // MIDI live play state
    let _midiHeld = {};   // note → true while held

    let _noteEls   = [];
    let _slideEls  = [];
    let _accentEls = [];
    let _stepNumEls = [];

    function _load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ patterns, curPat, P })); } catch (e) {} }

    // ── Build shared voice ────────────────────────────────────
    function _buildVoice() {
        if (_osc || !_ctx) return;
        _osc    = _ctx.createOscillator();
        _filter = _ctx.createBiquadFilter();
        _amp    = _ctx.createGain();
        _dist   = _ctx.createWaveShaper();

        _osc.type             = P.waveform;
        _osc.frequency.value  = _midiToHz(36);
        _filter.type          = 'lowpass';
        _filter.frequency.value = P.cutoff;
        _filter.Q.value       = P.resonance;
        _amp.gain.value       = 0;
        _dist.curve           = _distCurve(P.distortion);
        _dist.oversample      = '4x';

        _osc.connect(_filter).connect(_amp).connect(_dist).connect(_bus);
        _osc.start();
    }

    function _distCurve(amt) {
        // Asymmetric soft-clip (odd + even harmonics, valve character)
        var n = 2048, c = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var x = (i * 2) / n - 1;
            if (amt < 0.01) { c[i] = x; continue; }
            var drive = 1 + amt * 5;
            c[i] = x > 0
                ? Math.tanh(x * drive) / Math.tanh(drive)
                : Math.tanh(x * drive * 0.7) / Math.tanh(drive * 0.7);
        }
        return c;
    }

    // ── Note trigger ──────────────────────────────────────────
    function _trigNote(time, midi, isSlide, isAccent) {
        if (!_osc) return;
        var freq    = _midiToHz(midi);
        var baseVol = 0.65 + (isAccent ? P.accentVol : 0);
        var cutOpen = P.cutoff + P.envMod * (10000 - P.cutoff);

        if (isSlide) {
            _osc.frequency.setTargetAtTime(freq, time, P.glide * 0.4);
            _filter.frequency.cancelScheduledValues(time);
            _filter.frequency.setTargetAtTime(Math.min(cutOpen * 0.7, 8000), time, 0.015);
            _filter.frequency.setTargetAtTime(P.cutoff, time + 0.04, P.decay);
        } else {
            _osc.frequency.cancelScheduledValues(time);
            _osc.frequency.setValueAtTime(freq, time);
            _amp.gain.cancelScheduledValues(time);
            _amp.gain.setValueAtTime(baseVol, time);
            _filter.frequency.cancelScheduledValues(time);
            _filter.frequency.setValueAtTime(cutOpen, time);
            _filter.frequency.setTargetAtTime(P.cutoff, time + 0.008, P.decay);
        }
        _voiceOn = true;
    }

    function _noteOff(time) {
        if (!_amp) return;
        _amp.gain.cancelScheduledValues(time);
        _amp.gain.setTargetAtTime(0, time, 0.016);
        _voiceOn = false;
    }

    // ── Live note-on / note-off (immediate, for keyboard + MIDI) ─
    function _liveNoteOn(midi) {
        if (!_osc || !_ctx) return;
        var freq    = _midiToHz(midi);
        var cutOpen = P.cutoff + P.envMod * (10000 - P.cutoff);
        var now = _ctx.currentTime;

        _osc.frequency.cancelScheduledValues(now);
        _osc.frequency.setTargetAtTime(freq, now, _voiceOn ? P.glide * 0.5 : 0.002);
        _amp.gain.cancelScheduledValues(now);
        _amp.gain.setValueAtTime(0.65, now);
        _filter.frequency.cancelScheduledValues(now);
        _filter.frequency.setValueAtTime(cutOpen, now);
        _filter.frequency.setTargetAtTime(P.cutoff, now + 0.008, P.decay);
        _voiceOn = true;

        // Highlight live key
        _highlightLiveKey(midi, true);
    }

    function _liveNoteOff(midi) {
        // Only silence if no other MIDI notes still held
        var anyHeld = Object.keys(_midiHeld).some(function (k) { return _midiHeld[k]; });
        if (!anyHeld && !_mouseHeldNote) {
            if (_amp && _ctx) _noteOff(_ctx.currentTime);
            _voiceOn = false;
        }
        _highlightLiveKey(midi, false);
    }

    var _mouseHeldNote = null;

    // ── Step sequencer tick ────────────────────────────────────
    function _onTick(time, step16) {
        curStep = step16;
        if (!liveMode) _highlightSeqStep(step16);
        var pat  = patterns[curPat];
        var s    = pat[step16];
        var bpm  = window.currentBPM || 120;
        var sDur = 60 / bpm / 4;

        if (s.on) {
            var nxt     = pat[(step16 + 1) % NUM_STEPS];
            var holdTime = (nxt.on && nxt.slide) ? sDur * 1.02 : sDur * 0.82;
            _trigNote(time, s.note, s.slide, s.accent);
            _noteOff(time + holdTime);
        } else {
            _noteOff(time);
        }
    }

    function _onStop() {
        curStep = -1;
        _highlightSeqStep(-1);
        if (_amp) _amp.gain.setTargetAtTime(0, _ctx.currentTime, 0.02);
    }

    function _highlightSeqStep(s) {
        _noteEls.forEach(function (el, i) { if (el) el.classList.toggle('mpc-active', i === s); });
    }

    // ── UI ────────────────────────────────────────────────────
    function _mount(body, ctx) {
        _ctx = ctx.audioCtx;
        _bus = ctx.bus;
        _buildVoice();
        body.style.cssText = 'display:flex;flex-direction:column;gap:7px;padding:7px 8px;user-select:none;overflow:hidden;';

        // ── Top bar ────────────────────────────────────────────
        var top = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
        top.innerHTML =
            '<span class="mpc-lbl">PAT</span>' +
            '<button class="ss-card-btn al-pp">◀</button>' +
            '<span class="al-pnum" style="min-width:16px;text-align:center;color:#ff88ff;font-size:11px;">1</span>' +
            '<button class="ss-card-btn al-pn">▶</button>' +
            '<span class="mpc-lbl" style="margin-left:10px;">WAVE</span>' +
            '<button class="ss-card-btn al-wv playing" data-w="sawtooth">SAW</button>' +
            '<button class="ss-card-btn al-wv" data-w="square">SQ</button>' +
            '<button class="ss-card-btn al-wv" data-w="triangle">TRI</button>';
        body.appendChild(top);

        var pNum = top.querySelector('.al-pnum');
        top.querySelector('.al-pp').onclick = function () { curPat = (curPat - 1 + NUM_PATS) % NUM_PATS; pNum.textContent = curPat + 1; selectedStp = -1; _renderPat(); };
        top.querySelector('.al-pn').onclick = function () { curPat = (curPat + 1) % NUM_PATS; pNum.textContent = curPat + 1; selectedStp = -1; _renderPat(); };
        top.querySelectorAll('.al-wv').forEach(function (b) {
            b.onclick = function () {
                P.waveform = this.dataset.w;
                top.querySelectorAll('.al-wv').forEach(function (x) { x.classList.remove('playing'); });
                this.classList.add('playing');
                if (_osc) _osc.type = P.waveform;
                _save();
            };
        });

        // Mode toggle
        var modeBtn = document.createElement('button');
        modeBtn.className = 'ss-card-btn'; modeBtn.style.marginLeft = '8px'; modeBtn.textContent = '▦ STEP';
        modeBtn.onclick = function () {
            liveMode = !liveMode;
            modeBtn.textContent = liveMode ? '◈ LIVE' : '▦ STEP';
            modeBtn.classList.toggle('playing', liveMode);
            stepWrap.style.display = liveMode ? 'none' : '';
            liveWrap.style.display = liveMode ? '' : 'none';
        };
        top.appendChild(modeBtn);

        // CLR
        var clrBtn = document.createElement('button');
        clrBtn.className = 'ss-card-btn';
        clrBtn.style.cssText += 'margin-left:auto;border-color:rgba(255,60,60,.4);color:rgba(255,100,100,.8);';
        clrBtn.textContent = 'CLR';
        clrBtn.onclick = function () {
            patterns[curPat] = Array.from({ length: NUM_STEPS }, function () {
                return { on: false, note: 36, slide: false, accent: false };
            });
            selectedStp = -1; _renderPat(); _save();
        };
        top.appendChild(clrBtn);

        // ── STEP sequencer wrapper ─────────────────────────────
        var stepWrap = _div('display:flex;flex-direction:column;gap:3px;');

        // Step numbers
        var nums = _div('display:flex;gap:3px;align-items:center;');
        for (var s = 0; s < NUM_STEPS; s++) {
            var sp = document.createElement('span');
            sp.style.cssText = 'font-size:7px;width:37px;text-align:center;flex-shrink:0;' +
                (s % 4 === 0 ? 'color:rgba(255,136,255,.75);font-weight:600;' : 'color:rgba(255,136,255,.28);');
            sp.textContent = s + 1;
            nums.appendChild(sp);
        }
        stepWrap.appendChild(nums);

        // Note buttons
        var noteRow = _div('display:flex;gap:3px;');
        _noteEls = [];
        for (var s = 0; s < NUM_STEPS; s++) {
            var btn = document.createElement('button');
            btn.style.cssText = 'width:37px;height:34px;border:1px solid rgba(255,136,255,.15);background:rgba(0,0,0,.4);cursor:pointer;border-radius:3px;font-size:8px;color:rgba(255,136,255,.4);flex-shrink:0;line-height:1.2;';
            if (s > 0 && s % 4 === 0) btn.classList.add('ic-beat-sep-b3');
            (function (s, btn) {
                btn.onclick = function () {
                    var cell = patterns[curPat][s];
                    if (!cell.on) cell.on = true;
                    selectedStp = (selectedStp === s) ? -1 : s;
                    _renderPat(); _save();
                };
            }(s, btn));
            noteRow.appendChild(btn);
            _noteEls.push(btn);
        }
        stepWrap.appendChild(noteRow);

        // Slide row
        var slideRow = _div('display:flex;gap:3px;');
        _slideEls = [];
        for (var s = 0; s < NUM_STEPS; s++) {
            var btn2 = document.createElement('button');
            btn2.style.cssText = 'width:37px;height:15px;border:1px solid rgba(0,243,255,.1);background:rgba(0,0,0,.3);cursor:pointer;border-radius:2px;font-size:7px;color:rgba(0,243,255,.35);flex-shrink:0;';
            btn2.textContent = 'SLD';
            if (s > 0 && s % 4 === 0) btn2.classList.add('ic-beat-sep-b3');
            (function (s) {
                btn2.onclick = function () { patterns[curPat][s].slide = !patterns[curPat][s].slide; _renderPat(); _save(); };
            }(s));
            slideRow.appendChild(btn2);
            _slideEls.push(btn2);
        }
        stepWrap.appendChild(slideRow);

        // Accent row
        var accRow = _div('display:flex;gap:3px;');
        _accentEls = [];
        for (var s = 0; s < NUM_STEPS; s++) {
            var btn3 = document.createElement('button');
            btn3.style.cssText = 'width:37px;height:15px;border:1px solid rgba(255,80,80,.1);background:rgba(0,0,0,.3);cursor:pointer;border-radius:2px;font-size:7px;color:rgba(255,80,80,.35);flex-shrink:0;';
            btn3.textContent = 'ACC';
            if (s > 0 && s % 4 === 0) btn3.classList.add('ic-beat-sep-b3');
            (function (s) {
                btn3.onclick = function () { patterns[curPat][s].accent = !patterns[curPat][s].accent; _renderPat(); _save(); };
            }(s));
            accRow.appendChild(btn3);
            _accentEls.push(btn3);
        }
        stepWrap.appendChild(accRow);

        // Mini keyboard for note entry (step mode)
        var kb = _div('display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:2px;');
        var kbl = document.createElement('span');
        kbl.style.cssText = 'font-size:9px;color:rgba(255,136,255,.6);letter-spacing:2px;';
        kbl.textContent = 'NOTE';
        kb.appendChild(kbl);
        var octSel = document.createElement('select');
        octSel.className = 'ss-card-btn'; octSel.style.cssText = 'font-size:9px;padding:1px 3px;';
        [1,2,3,4].forEach(function (o) {
            var opt = document.createElement('option'); opt.value = o; opt.textContent = 'Oct ' + o;
            if (o === 2) opt.selected = true;
            octSel.appendChild(opt);
        });
        kb.appendChild(octSel);
        var pianoDiv = _div('display:flex;gap:2px;align-items:flex-end;');
        ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].forEach(function (n, i) {
            var black = n.includes('#');
            var btn4 = document.createElement('button');
            btn4.style.cssText =
                'width:' + (black ? 19 : 23) + 'px;height:' + (black ? 20 : 28) + 'px;' +
                'border:1px solid rgba(255,136,255,.28);cursor:pointer;border-radius:2px;font-size:7px;' +
                'color:rgba(255,136,255,.7);background:' + (black ? 'rgba(255,136,255,.18)' : 'rgba(255,136,255,.06)') + ';';
            btn4.textContent = n.replace('#', '♯');
            btn4.onclick = function () {
                var midi = (+octSel.value + 1) * 12 + i;
                if (selectedStp >= 0) {
                    var cell = patterns[curPat][selectedStp];
                    cell.note = midi; cell.on = true;
                    _renderPat(); _save();
                    if (_amp) { _amp.gain.setValueAtTime(0.55, _ctx.currentTime); _noteOff(_ctx.currentTime + 0.4); }
                    if (_osc) _osc.frequency.setValueAtTime(_midiToHz(midi), _ctx.currentTime);
                    if (_filter) { _filter.frequency.setValueAtTime(P.cutoff + P.envMod * (10000 - P.cutoff), _ctx.currentTime); _filter.frequency.setTargetAtTime(P.cutoff, _ctx.currentTime + 0.01, P.decay); }
                    selectedStp = (selectedStp + 1) % NUM_STEPS;
                    _renderPat();
                }
            };
            pianoDiv.appendChild(btn4);
        });
        kb.appendChild(pianoDiv);
        stepWrap.appendChild(kb);
        body.appendChild(stepWrap);

        // ── LIVE mode wrapper ──────────────────────────────────
        var liveWrap = _div('display:none;flex-direction:column;gap:6px;');

        // Live octave selector + hint
        var liveTopRow = _div('display:flex;align-items:center;gap:10px;flex-wrap:wrap;');
        var liveOctLbl = document.createElement('span'); liveOctLbl.className = 'mpc-lbl'; liveOctLbl.textContent = 'OCT';
        liveWrap.appendChild(liveTopRow);
        var liveOctVal = document.createElement('span'); liveOctVal.style.cssText = 'font-size:11px;color:#ff88ff;min-width:16px;text-align:center;';
        liveOctVal.textContent = '2';
        var liveOctDown = document.createElement('button'); liveOctDown.className = 'ss-card-btn'; liveOctDown.textContent = '▼';
        var liveOctUp   = document.createElement('button'); liveOctUp.className   = 'ss-card-btn'; liveOctUp.textContent   = '▲';
        var _liveOct = 2;
        liveOctDown.onclick = function () { _liveOct = Math.max(0, _liveOct - 1); liveOctVal.textContent = _liveOct; };
        liveOctUp.onclick   = function () { _liveOct = Math.min(6, _liveOct + 1); liveOctVal.textContent = _liveOct; };
        liveTopRow.appendChild(liveOctLbl); liveTopRow.appendChild(liveOctDown); liveTopRow.appendChild(liveOctVal); liveTopRow.appendChild(liveOctUp);
        var liveHint = document.createElement('span'); liveHint.style.cssText = 'font-size:8px;color:rgba(255,136,255,.4);letter-spacing:1px;'; liveHint.textContent = 'MIDI NOTES IN • HOLD TO SUSTAIN';
        liveTopRow.appendChild(liveHint);

        // Large playable keyboard
        var livePianoWrap = _div('overflow-x:auto;padding-bottom:4px;');
        var livePiano = _div('display:flex;gap:2px;align-items:flex-end;min-width:max-content;');
        var _liveKeyEls = {};
        var liveOctaves = [1, 2, 3, 4];
        liveOctaves.forEach(function (oct) {
            ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].forEach(function (n, i) {
                var black = n.includes('#');
                var midi = (oct + 1) * 12 + i;
                var key = document.createElement('button');
                key.dataset.midi = midi;
                key.style.cssText =
                    'width:' + (black ? 24 : 34) + 'px;height:' + (black ? 42 : 64) + 'px;' +
                    'border:1px solid rgba(255,136,255,' + (black ? '.4' : '.2') + ');' +
                    'cursor:pointer;border-radius:0 0 4px 4px;font-size:7px;' +
                    'color:rgba(255,136,255,.5);' +
                    'background:' + (black ? 'rgba(60,0,80,.9)' : 'rgba(20,0,30,.85)') + ';' +
                    'flex-shrink:0;transition:background .04s;';
                if (!black && i === 0) {
                    key.style.borderLeft = '1px solid rgba(255,136,255,.35)';
                    var noteLbl = document.createElement('span');
                    noteLbl.style.cssText = 'font-size:6px;color:rgba(255,136,255,.4);display:block;margin-top:auto;';
                    noteLbl.textContent = n + oct;
                    key.appendChild(noteLbl);
                }
                key.onmousedown = function (e) {
                    e.preventDefault();
                    _mouseHeldNote = midi;
                    _liveNoteOn(midi);
                    key.style.background = black ? 'rgba(255,136,255,.5)' : 'rgba(255,136,255,.22)';
                };
                key.onmouseup = key.onmouseleave = function () {
                    if (_mouseHeldNote === midi) {
                        _mouseHeldNote = null;
                        _liveNoteOff(midi);
                        key.style.background = black ? 'rgba(60,0,80,.9)' : 'rgba(20,0,30,.85)';
                    }
                };
                key.addEventListener('touchstart', function (e) {
                    e.preventDefault();
                    _mouseHeldNote = midi;
                    _liveNoteOn(midi);
                    key.style.background = black ? 'rgba(255,136,255,.5)' : 'rgba(255,136,255,.22)';
                }, { passive: false });
                key.addEventListener('touchend', function () {
                    if (_mouseHeldNote === midi) { _mouseHeldNote = null; _liveNoteOff(midi); }
                    key.style.background = black ? 'rgba(60,0,80,.9)' : 'rgba(20,0,30,.85)';
                });
                livePiano.appendChild(key);
                _liveKeyEls[midi] = key;
            });
        });
        livePianoWrap.appendChild(livePiano);
        liveWrap.appendChild(livePianoWrap);

        var liveHint2 = document.createElement('span');
        liveHint2.style.cssText = 'font-size:7px;color:rgba(255,136,255,.3);letter-spacing:1px;text-align:center;';
        liveHint2.textContent = 'MIDI NOTES 24–71 → LIVE BASS';
        liveWrap.appendChild(liveHint2);
        body.appendChild(liveWrap);

        _highlightLiveKey = function (midi, on) {
            var el = _liveKeyEls[midi];
            if (!el) return;
            var black = [1,3,6,8,10].includes(((midi % 12) + 12) % 12);
            el.style.background = on ? (black ? 'rgba(255,136,255,.5)' : 'rgba(255,136,255,.22)') : (black ? 'rgba(60,0,80,.9)' : 'rgba(20,0,30,.85)');
        };

        // ── Synth knobs ────────────────────────────────────────
        var knobs = _div('display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding-top:6px;border-top:1px solid rgba(255,136,255,.1);');
        [
            ['CUTOFF', 60, 4000, P.cutoff,                    'Hz', function (v) { P.cutoff = v; if (_filter) _filter.frequency.setTargetAtTime(v, _ctx.currentTime, 0.05); }],
            ['RES',    1,   18, P.resonance,                   '',  function (v) { P.resonance = v; if (_filter) _filter.Q.setTargetAtTime(v, _ctx.currentTime, 0.05); }],
            ['ENV',    0,  100, Math.round(P.envMod * 100),    '%', function (v) { P.envMod = v / 100; }],
            ['DECAY',  5,  100, Math.round(P.decay * 100),     '%', function (v) { P.decay = v / 100; }],
            ['ACCENT', 0,  100, Math.round(P.accentVol * 100), '%', function (v) { P.accentVol = v / 100; }],
            ['DIST',   0,  100, Math.round(P.distortion * 100),'%', function (v) { P.distortion = v / 100; if (_dist) _dist.curve = _distCurve(P.distortion); }],
            ['GLIDE',  10, 400, Math.round(P.glide * 1000),    'ms',function (v) { P.glide = v / 1000; }],
            ['VOL',    0,  100, Math.round(P.volume * 100),    '%', function (v) { P.volume = v / 100; if (_bus) _bus.gain.setTargetAtTime(P.volume * 0.95, _ctx.currentTime, 0.03); }],
        ].forEach(function (args) {
            var lbl = args[0], min = args[1], max = args[2], val = args[3], unit = args[4], fn = args[5];
            var wrap = _div('display:flex;flex-direction:column;align-items:center;gap:2px;');
            wrap.innerHTML =
                '<span style="font-size:7px;color:rgba(255,136,255,.55);letter-spacing:1px;">' + lbl + '</span>' +
                '<input type="range" min="' + min + '" max="' + max + '" value="' + val + '" style="width:62px;accent-color:#ff88ff;">' +
                '<span style="font-size:8px;color:#ff88ff;">' + val + unit + '</span>';
            var inp  = wrap.querySelector('input');
            var disp = wrap.querySelector('span:last-child');
            inp.oninput = function () { var v = +this.value; disp.textContent = v + unit; fn(v); _save(); };
            knobs.appendChild(wrap);
        });
        body.appendChild(knobs);

        _renderPat();
        _loadState();

        // ── MIDI ──────────────────────────────────────────────
        document.addEventListener('ss-midi', function (e) {
            var d = e.detail;
            var cmd = d.status >> 4;
            if (!liveMode) return;
            if (cmd === 9 && d.vel > 0) {
                // NoteOn
                _midiHeld[d.note] = true;
                _liveNoteOn(d.note);
            } else if (cmd === 8 || (cmd === 9 && d.vel === 0)) {
                // NoteOff
                delete _midiHeld[d.note];
                _liveNoteOff(d.note);
            }
        });
    }

    function _renderPat() {
        var pat = patterns[curPat];
        pat.forEach(function (step, i) {
            var ne = _noteEls[i], se = _slideEls[i], ae = _accentEls[i];
            if (!ne) return;
            var sel = (selectedStp === i);
            if (step.on) {
                ne.style.background  = sel ? 'rgba(255,136,255,.5)' : 'rgba(255,136,255,.18)';
                ne.style.borderColor = sel ? '#ff88ff' : 'rgba(255,136,255,.45)';
                ne.style.color       = '#ff88ff';
                ne.textContent       = _noteName(step.note);
            } else {
                ne.style.background  = sel ? 'rgba(255,136,255,.1)' : 'rgba(0,0,0,.4)';
                ne.style.borderColor = sel ? 'rgba(255,136,255,.6)' : 'rgba(255,136,255,.12)';
                ne.style.color       = sel ? 'rgba(255,136,255,.8)' : 'rgba(255,136,255,.32)';
                ne.textContent       = '—';
            }
            if (se) {
                se.style.background  = step.slide ? 'rgba(0,243,255,.25)' : 'rgba(0,0,0,.3)';
                se.style.borderColor = step.slide ? 'rgba(0,243,255,.65)' : 'rgba(0,243,255,.1)';
                se.style.color       = step.slide ? '#00f3ff' : 'rgba(0,243,255,.35)';
            }
            if (ae) {
                ae.style.background  = step.accent ? 'rgba(255,60,60,.25)' : 'rgba(0,0,0,.3)';
                ae.style.borderColor = step.accent ? 'rgba(255,60,60,.65)' : 'rgba(255,80,80,.1)';
                ae.style.color       = step.accent ? '#ff5050' : 'rgba(255,80,80,.35)';
            }
        });
    }

    function _loadState() {
        var d = _load();
        if (d.patterns) {
            d.patterns.forEach(function (pp, pi) {
                if (pi < NUM_PATS) pp.forEach(function (s, si) { if (si < NUM_STEPS) patterns[pi][si] = s; });
            });
        }
        if (d.curPat != null) curPat = d.curPat;
        if (d.P) Object.assign(P, d.P);
        _renderPat();
        var pn = document.querySelector('.al-pnum');
        if (pn) pn.textContent = curPat + 1;
        document.querySelectorAll('.al-wv').forEach(function (b) { b.classList.toggle('playing', b.dataset.w === P.waveform); });
        if (_osc) _osc.type = P.waveform;
        if (_filter) { _filter.frequency.value = P.cutoff; _filter.Q.value = P.resonance; }
        if (_dist)   _dist.curve = _distCurve(P.distortion);
    }

    function _div(css) { var d = document.createElement('div'); d.style.cssText = css; return d; }

    // Stub replaced by real implementation once _mount runs
    var _highlightLiveKey = function () {};

    // ── Boot ──────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(function () {
                SonicSuite.registerCard('bass303', {
                    tag:    'B',
                    label:  'VNGRD//ACID LINE',
                    onTick: _onTick,
                    onStop: _onStop,
                    mount:  _mount,
                });
            }, 260);
        }
        btn ? btn.addEventListener('click', _once) : setTimeout(_once, 700);
    });
})();
