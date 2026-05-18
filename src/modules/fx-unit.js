// ═══════════════════════════════════════════════════════════════
// VNGRD//FX UNIT — master insert effects rack
// Inserts between master bus glue compressor and limiter.
// 4 effects: BPM-sync DELAY / CHORUS / OVERDRIVE / LO-FI
// Each has an independent wet/dry mix and bypass.
// MIDI CC: any range slider is MIDI-learnable via existing system.
// Depends on: SonicSuite (global), window._ssGlue, window._ssLimiter
// Registers card id: 'fxunit'
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const LS_KEY = 'vngrd.fxunit.v2';   // bumped: all FX default to OFF

    const P = {
        // Delay — starts BYPASSED
        delayBypass: true,
        delayTime:   0.25,
        delaySync:   '1/4',
        delayFB:     0.35,
        delayWet:    0.28,
        // Chorus — starts BYPASSED
        chorBypass:  true,
        chorRate:    1.8,
        chorDepth:   0.003,
        chorWet:     0.30,
        // Overdrive — starts BYPASSED
        driveBypass: true,
        driveGain:   0.35,
        driveTone:   0.55,
        driveWet:    0.40,
        // Lo-Fi — starts BYPASSED
        lofiBypass:  true,
        lofiBits:    16,
        lofiSrDiv:   1,
        lofiWet:     0.25,
    };

    let _ctx, _inserted = false;
    let _delayIn, _delayNode, _delayFB, _delayDry, _delayWetG;
    let _chorLFO, _chorDelay, _chorDry, _chorWetG;
    let _driveSat, _driveToneF, _driveDry, _driveWetG;
    let _lofiIn, _lofiOut, _lofiBuf, _lofiPhase, _lofiProcNode;
    let _chainIn, _chainOut;

    function _load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
    function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify(P)); } catch (e) {} }

    // ── Distortion curve ──────────────────────────────────────
    function _driveCurve(gain, tone) {
        var n = 512, c = new Float32Array(n);
        var k = gain * 80 + 1;
        for (var i = 0; i < n; i++) {
            var x = (i * 2) / n - 1;
            c[i] = Math.tanh(x * k) / Math.tanh(k);
        }
        return c;
    }

    // ── Build FX chain and insert ─────────────────────────────
    function _buildChain() {
        if (_inserted || !_ctx) return;
        var glue    = window._ssGlue;
        var limiter = window._ssLimiter;
        if (!glue || !limiter) {
            // Retry — audio may not be initialised yet
            setTimeout(_buildChain, 300);
            return;
        }
        _inserted = true;

        // Create chain I/O
        _chainIn  = _ctx.createGain(); _chainIn.gain.value  = 1;
        _chainOut = _ctx.createGain(); _chainOut.gain.value = 1;

        // ── DELAY ─────────────────────────────────────────────
        _delayIn   = _ctx.createGain(); _delayIn.gain.value = 1;
        _delayNode = _ctx.createDelay(4.0);
        _delayNode.delayTime.value = P.delayTime;
        _delayFB   = _ctx.createGain(); _delayFB.gain.value = P.delayFB;
        _delayDry  = _ctx.createGain(); _delayDry.gain.value = 1 - P.delayWet;
        _delayWetG = _ctx.createGain(); _delayWetG.gain.value = P.delayWet;
        var delayLP = _ctx.createBiquadFilter(); delayLP.type = 'lowpass'; delayLP.frequency.value = 6000;
        _delayIn.connect(_delayDry);
        _delayIn.connect(_delayNode);
        _delayNode.connect(delayLP).connect(_delayFB).connect(_delayNode); // feedback
        _delayNode.connect(_delayWetG);
        var delayOut = _ctx.createGain(); delayOut.gain.value = 1;
        _delayDry.connect(delayOut); _delayWetG.connect(delayOut);

        // ── CHORUS ────────────────────────────────────────────
        var chorIn  = _ctx.createGain(); chorIn.gain.value = 1;
        var chorDelay1 = _ctx.createDelay(0.1); chorDelay1.delayTime.value = 0.02;
        var chorDelay2 = _ctx.createDelay(0.1); chorDelay2.delayTime.value = 0.025;
        _chorLFO = _ctx.createOscillator(); _chorLFO.type = 'sine'; _chorLFO.frequency.value = P.chorRate;
        var lfoGain  = _ctx.createGain(); lfoGain.gain.value = P.chorDepth;
        var lfoGain2 = _ctx.createGain(); lfoGain2.gain.value = -P.chorDepth;
        _chorDry  = _ctx.createGain(); _chorDry.gain.value = 1 - P.chorWet;
        _chorWetG = _ctx.createGain(); _chorWetG.gain.value = P.chorWet;
        var chorMix = _ctx.createGain(); chorMix.gain.value = 0.5;
        _chorLFO.connect(lfoGain).connect(chorDelay1.delayTime);
        _chorLFO.connect(lfoGain2).connect(chorDelay2.delayTime);
        _chorLFO.start();
        chorIn.connect(_chorDry);
        chorIn.connect(chorDelay1).connect(chorMix);
        chorIn.connect(chorDelay2).connect(chorMix);
        chorMix.connect(_chorWetG);
        var chorOut = _ctx.createGain(); chorOut.gain.value = 1;
        _chorDry.connect(chorOut); _chorWetG.connect(chorOut);

        // ── OVERDRIVE ─────────────────────────────────────────
        var driveIn = _ctx.createGain(); driveIn.gain.value = 1;
        _driveSat = _ctx.createWaveShaper();
        _driveSat.curve = _driveCurve(P.driveGain, P.driveTone);
        _driveSat.oversample = '4x';
        _driveToneF = _ctx.createBiquadFilter(); _driveToneF.type = 'highshelf';
        _driveToneF.frequency.value = 3000;
        _driveToneF.gain.value = (P.driveTone - 0.5) * 12;
        _driveDry  = _ctx.createGain(); _driveDry.gain.value = 1 - P.driveWet;
        _driveWetG = _ctx.createGain(); _driveWetG.gain.value = P.driveWet;
        driveIn.connect(_driveDry);
        driveIn.connect(_driveSat).connect(_driveToneF).connect(_driveWetG);
        var driveOut = _ctx.createGain(); driveOut.gain.value = 1;
        _driveDry.connect(driveOut); _driveWetG.connect(driveOut);

        // ── LO-FI (ScriptProcessor for bit crush) ─────────────
        var lofiIn  = _ctx.createGain(); lofiIn.gain.value = 1;
        var lofiOut = _ctx.createGain(); lofiOut.gain.value = 1;
        var lofiDry = _ctx.createGain(); lofiDry.gain.value = 1 - P.lofiWet;
        var lofiWet = _ctx.createGain(); lofiWet.gain.value = P.lofiWet;
        // Use a ScriptProcessorNode for bit-crush + sample-rate reduction
        var bufSize = 512;
        var lofiProc = _ctx.createScriptProcessor(bufSize, 1, 1);
        var _phase = 0, _lastSample = 0;
        lofiProc.onaudioprocess = function (e) {
            var inp = e.inputBuffer.getChannelData(0);
            var out = e.outputBuffer.getChannelData(0);
            var bits = Math.max(1, Math.floor(P.lofiBits));
            var step = Math.pow(2, bits - 1);
            var srDiv = Math.max(1, Math.floor(P.lofiSrDiv));
            for (var i = 0; i < bufSize; i++) {
                _phase += 1;
                if (_phase >= srDiv) {
                    _phase = 0;
                    _lastSample = Math.floor(inp[i] * step) / step;
                }
                out[i] = _lastSample;
            }
        };
        lofiIn.connect(lofiDry); lofiIn.connect(lofiProc); lofiProc.connect(lofiWet);
        var lofiMix = _ctx.createGain(); lofiMix.gain.value = 1;
        lofiDry.connect(lofiMix); lofiWet.connect(lofiMix);
        // Keep refs for wet/dry updates
        _lofiWetGRef = lofiWet; _lofiDryGRef = lofiDry;

        // ── Chain wiring ──────────────────────────────────────
        _chainIn.connect(_delayIn);
        delayOut.connect(chorIn);
        chorOut.connect(driveIn);
        driveOut.connect(lofiIn);
        lofiMix.connect(_chainOut);

        // Insert: glue → chainIn  (disconnect glue from limiter first)
        try { glue.disconnect(limiter); } catch (e) {}
        glue.connect(_chainIn);
        _chainOut.connect(limiter);
    }

    // ── Knob sync helpers ──────────────────────────────────────
    function _setDelayTime() {
        var bpm = window.currentBPM || 120;
        var beat = 60 / bpm;
        var t;
        switch (P.delaySync) {
            case '1/16': t = beat / 4;       break;
            case '1/8':  t = beat / 2;       break;
            case '3/8':  t = beat * 3 / 4;   break;
            case '1/2':  t = beat;            break;
            default:     t = beat / 2;        // 1/4 note = half a beat at 1/4 sync is beat/2? no: 1/4 note = 1 beat
                         t = beat;            break; // 1/4 note = 1 beat
        }
        // Remap: '1/4' means quarter-note = 1 beat
        switch (P.delaySync) {
            case '1/16': t = beat * 0.25; break;
            case '1/8':  t = beat * 0.5;  break;
            case '1/4':  t = beat;        break;
            case '3/8':  t = beat * 1.5;  break;
            case '1/2':  t = beat * 2;    break;
            default:     t = beat;
        }
        P.delayTime = Math.min(3.9, Math.max(0.01, t));
        if (_delayNode) _delayNode.delayTime.setTargetAtTime(P.delayTime, _ctx.currentTime, 0.05);
    }

    var _lofiWetGRef = null, _lofiDryGRef = null;

    // ── UI — compact single-row per effect ────────────────────
    function _mount(body, ctx) {
        _ctx = ctx.audioCtx;

        body.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:6px 8px;user-select:none;overflow-y:auto;';

        setTimeout(_buildChain, 200);

        // One compact row per effect: [LABEL] [ON/BYPSS] [slider…val] [slider…val]
        function _fxRow(label, color, getBypass, setBypass, sliders) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;' +
                'border:1px solid ' + color + '28;border-radius:3px;' +
                'background:rgba(0,0,0,.28);';

            // Label
            var lbl = document.createElement('span');
            lbl.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:1.5px;color:' + color + ';min-width:44px;';
            lbl.textContent = label;
            row.appendChild(lbl);

            // ON / BYPSS toggle
            var btn = document.createElement('button');
            btn.className = 'ss-card-btn';
            btn.style.cssText = 'border-color:' + color + '55;color:' + color + ';min-width:42px;padding:0 5px;height:20px;font-size:7px;';
            var _paint = function () {
                var off = getBypass();
                btn.textContent = off ? 'OFF' : 'ON';
                btn.classList.toggle('playing', !off);
                btn.style.opacity = off ? '.45' : '1';
            };
            _paint();
            btn.onclick = function () { setBypass(!getBypass()); _paint(); _save(); };
            row.appendChild(btn);

            // Inline sliders
            sliders.forEach(function (s) {
                var lbl2 = document.createElement('span');
                lbl2.style.cssText = 'font-size:7px;color:' + color + '88;letter-spacing:1px;white-space:nowrap;';
                lbl2.textContent = s[0];
                var inp = document.createElement('input');
                inp.type = 'range'; inp.min = s[1]; inp.max = s[2]; inp.value = s[3]; inp.step = s[6] || 1;
                inp.style.cssText = 'width:54px;accent-color:' + color + ';cursor:pointer;';
                var val = document.createElement('span');
                val.style.cssText = 'font-size:7px;color:' + color + ';min-width:26px;text-align:right;';
                val.textContent = s[3] + s[4];
                inp.oninput = function () { var v = +this.value; val.textContent = v + s[4]; s[5](v); _save(); };
                row.appendChild(lbl2); row.appendChild(inp); row.appendChild(val);
            });

            return row;
        }

        // ── DELAY ─────────────────────────────────────────────
        var syncSel = document.createElement('select');
        syncSel.className = 'ss-card-btn';
        syncSel.style.cssText = 'font-size:8px;padding:1px 2px;height:20px;';
        ['1/16','1/8','1/4','3/8','1/2'].forEach(function (v) {
            var o = document.createElement('option'); o.value = v; o.textContent = v;
            if (v === P.delaySync) o.selected = true;
            syncSel.appendChild(o);
        });
        syncSel.onchange = function () { P.delaySync = this.value; _setDelayTime(); _save(); };

        var delRow = _fxRow('DELAY', '#00f3ff',
            function () { return P.delayBypass; },
            function (v) { P.delayBypass = v; if (_delayWetG) _delayWetG.gain.setTargetAtTime(v ? 0 : P.delayWet, _ctx.currentTime, 0.05); },
            [
                ['FB',  0, 90,  Math.round(P.delayFB * 100),  '%', function (v) { P.delayFB = v/100; if (_delayFB) _delayFB.gain.setTargetAtTime(P.delayFB, _ctx.currentTime, 0.05); }],
                ['WET', 0, 100, Math.round(P.delayWet * 100), '%', function (v) { P.delayWet = v/100; if (_delayWetG && !P.delayBypass) _delayWetG.gain.setTargetAtTime(P.delayWet, _ctx.currentTime, 0.05); if (_delayDry) _delayDry.gain.setTargetAtTime(1-P.delayWet, _ctx.currentTime, 0.05); }],
            ]
        );
        delRow.appendChild(syncSel);
        body.appendChild(delRow);

        // ── CHORUS ────────────────────────────────────────────
        body.appendChild(_fxRow('CHORUS', '#88ff44',
            function () { return P.chorBypass; },
            function (v) { P.chorBypass = v; if (_chorWetG) _chorWetG.gain.setTargetAtTime(v ? 0 : P.chorWet, _ctx.currentTime, 0.05); },
            [
                ['RATE',  1, 80,  Math.round(P.chorRate * 10),    '', function (v) { P.chorRate = v/10; if (_chorLFO) _chorLFO.frequency.setTargetAtTime(P.chorRate, _ctx.currentTime, 0.1); }],
                ['WET',   0, 100, Math.round(P.chorWet * 100),   '%', function (v) { P.chorWet = v/100; if (_chorWetG && !P.chorBypass) _chorWetG.gain.setTargetAtTime(P.chorWet, _ctx.currentTime, 0.05); if (_chorDry) _chorDry.gain.setTargetAtTime(1-P.chorWet, _ctx.currentTime, 0.05); }],
            ]
        ));

        // ── OVERDRIVE ─────────────────────────────────────────
        body.appendChild(_fxRow('DRIVE', '#ff8800',
            function () { return P.driveBypass; },
            function (v) { P.driveBypass = v; if (_driveWetG) _driveWetG.gain.setTargetAtTime(v ? 0 : P.driveWet, _ctx.currentTime, 0.05); },
            [
                ['DRIVE', 0, 100, Math.round(P.driveGain * 100), '%', function (v) { P.driveGain = v/100; if (_driveSat) _driveSat.curve = _driveCurve(P.driveGain, P.driveTone); }],
                ['TONE',  0, 100, Math.round(P.driveTone * 100), '%', function (v) { P.driveTone = v/100; if (_driveToneF) _driveToneF.gain.value = (P.driveTone-0.5)*12; if (_driveSat) _driveSat.curve = _driveCurve(P.driveGain, P.driveTone); }],
                ['WET',   0, 100, Math.round(P.driveWet * 100),  '%', function (v) { P.driveWet = v/100; if (_driveWetG && !P.driveBypass) _driveWetG.gain.setTargetAtTime(P.driveWet, _ctx.currentTime, 0.05); if (_driveDry) _driveDry.gain.setTargetAtTime(1-P.driveWet, _ctx.currentTime, 0.05); }],
            ]
        ));

        // ── LO-FI ─────────────────────────────────────────────
        body.appendChild(_fxRow('LO-FI', '#aa44ff',
            function () { return P.lofiBypass; },
            function (v) { P.lofiBypass = v; if (_lofiWetGRef) _lofiWetGRef.gain.setTargetAtTime(v ? 0 : P.lofiWet, _ctx.currentTime, 0.05); },
            [
                ['BITS', 1, 16, P.lofiBits,  'b', function (v) { P.lofiBits = v; }],
                ['SR÷',  1, 16, P.lofiSrDiv, 'x', function (v) { P.lofiSrDiv = v; }],
                ['WET',  0, 100, Math.round(P.lofiWet * 100), '%', function (v) { P.lofiWet = v/100; if (_lofiWetGRef && !P.lofiBypass) _lofiWetGRef.gain.setTargetAtTime(P.lofiWet, _ctx.currentTime, 0.05); if (_lofiDryGRef) _lofiDryGRef.gain.setTargetAtTime(1-P.lofiWet, _ctx.currentTime, 0.05); }],
            ]
        ));

        _loadSaved();
        _onBpmChange = function () { _setDelayTime(); };
    }

    var _onBpmChange = null;

    function _onTick() {
        // Update delay time on every tick in case BPM changed
        if (_onBpmChange) _onBpmChange();
    }

    function _loadSaved() {
        var d = _load();
        Object.assign(P, d);
        if (_delayNode  && P.delayTime) _delayNode.delayTime.value  = P.delayTime;
        if (_delayFB    && P.delayFB)   _delayFB.gain.value         = P.delayFB;
        if (_delayWetG)  _delayWetG.gain.value  = P.delayBypass ? 0 : P.delayWet;
        if (_delayDry)   _delayDry.gain.value   = 1 - P.delayWet;
        if (_chorLFO    && P.chorRate)  _chorLFO.frequency.value    = P.chorRate;
        if (_chorWetG)   _chorWetG.gain.value   = P.chorBypass ? 0 : P.chorWet;
        if (_chorDry)    _chorDry.gain.value    = 1 - P.chorWet;
        if (_driveSat)   _driveSat.curve = _driveCurve(P.driveGain, P.driveTone);
        if (_driveWetG)  _driveWetG.gain.value  = P.driveBypass ? 0 : P.driveWet;
        if (_driveDry)   _driveDry.gain.value   = 1 - P.driveWet;
        if (_lofiWetGRef) _lofiWetGRef.gain.value = P.lofiBypass ? 0 : P.lofiWet;
        if (_lofiDryGRef) _lofiDryGRef.gain.value = 1 - P.lofiWet;
    }

    // ── Boot ──────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(function () {
                SonicSuite.registerCard('fxunit', {
                    tag:    'F',
                    label:  'VNGRD//FX UNIT',
                    onTick: _onTick,
                    mount:  _mount,
                });
            }, 420);
        }
        btn ? btn.addEventListener('click', _once) : setTimeout(_once, 900);
    });
})();
