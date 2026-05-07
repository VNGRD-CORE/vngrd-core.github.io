// ═══════════════════════════════════════════════════════════════
// SLICER CARD MODULE — 16-pad sampler + step sequencer for Sonic Suite
// Extracted from main.js. Depends on: SonicSuite, window._ssAnalyser (globals)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  VNGRD SLICER / SAMPLER CARD
//  File upload OR live SNAP from master output → 16 pads + sequencer.
//  Sound engine: anti-click exponential envelope, optional LP/HP filter,
//  global TUNE transpose, per-pad loop mode (hold pad), peak normalize.
//  Rolling 10-s circular buffer records master continuously; SNAP freezes
//  it into slices instantly while the live track keeps playing.
// ═══════════════════════════════════════════════════════════════
(function() {
    const MAX_SLICES = 16;
    const STEPS      = 16;
    const VEL_LEVELS = [1.0, 0.66, 0.33];
    const DIR_NAMES  = ['FWD', 'REV', 'PP', 'RND'];

    // ── Equal-division fallback (always works, immediately musical) ──
    function _equalOnsets(buffer, count) {
        const onsets = [];
        for (let i = 0; i < count; i++)
            onsets.push(Math.floor(i * buffer.length / count));
        return onsets;
    }

    // ── Spectral-flux onset detection — sens > 1 = more sensitive ──
    function _detectOnsets(buffer, sens) {
        const ch     = buffer.getChannelData(0);
        const hop    = 512;
        const win    = 2048;
        const minGap = Math.floor(buffer.sampleRate * 0.07);
        const thresh = 0.018 / Math.max(0.1, sens || 1.0);
        const onsets = [0];
        let prevRMS  = 0;
        for (let i = 0; i + win < ch.length; i += hop) {
            let s = 0;
            for (let j = 0; j < win; j++) s += ch[i + j] * ch[i + j];
            const rms  = Math.sqrt(s / win);
            const flux = Math.max(0, rms - prevRMS);
            prevRMS = rms;
            if (flux > thresh && (i - onsets[onsets.length - 1]) >= minGap)
                onsets.push(i);
        }
        return onsets.slice(0, MAX_SLICES);
    }

    // ── Build slice AudioBuffers from onset sample positions ─────────
    function _buildSlices(actx, buffer, onsets) {
        const sr = buffer.sampleRate;
        const ch = buffer.numberOfChannels;
        return onsets.map((start, idx) => {
            const end  = onsets[idx + 1] || buffer.length;
            const size = Math.max(1, end - start);
            const sb   = actx.createBuffer(ch, size, sr);
            for (let c = 0; c < ch; c++) {
                const src = buffer.getChannelData(c);
                const dst = sb.getChannelData(c);
                for (let j = 0; j < size; j++) dst[j] = src[start + j] || 0;
            }
            return sb;
        });
    }

    // ── Pre-compute reversed copies so reverse is free at play-time ──
    function _buildRevSlices(actx, slices) {
        return slices.map(sb => {
            const rb = actx.createBuffer(sb.numberOfChannels, sb.length, sb.sampleRate);
            for (let c = 0; c < sb.numberOfChannels; c++) {
                rb.copyToChannel(sb.getChannelData(c).slice().reverse(), c);
            }
            return rb;
        });
    }

    // ── In-place peak normalization — each slice → –1.5 dBFS ────────
    function _normalizeSlices(slices) {
        slices.forEach(sb => {
            let peak = 0;
            for (let c = 0; c < sb.numberOfChannels; c++) {
                const d = sb.getChannelData(c);
                for (let i = 0; i < d.length; i++)
                    if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
            }
            if (peak < 0.002) return;
            const gain = 0.84 / peak;
            for (let c = 0; c < sb.numberOfChannels; c++) {
                const d = sb.getChannelData(c);
                for (let i = 0; i < d.length; i++) d[i] *= gain;
            }
        });
    }

    // ── Professional fire: exponential envelope + optional biquad ───
    //    totalSemi = (chromatic offset) + (global tune)
    function _fire(actx, dest, buf, t, pitch, gate, vel, totalSemi, atk, rel, filt, ftype) {
        if (!buf) return;
        const bsn  = actx.createBufferSource();
        bsn.buffer = buf;
        const rate    = pitch * Math.pow(2, (totalSemi || 0) / 12);
        bsn.playbackRate.value = rate;
        const dur     = Math.max(0.015, (buf.duration / rate) * (gate || 0.92));
        const atkTime = Math.min(atk || 0.004, dur * 0.4);
        const relTime = Math.min(rel || 0.08,  dur - atkTime);
        // Exponential velocity curve — more musical under fingers
        const peak    = 0.88 * Math.pow(vel == null ? 1 : Math.max(0.001, vel), 1.4);

        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + atkTime);
        if (dur - atkTime - relTime > 0.001)
            g.gain.setValueAtTime(peak, t + dur - relTime);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        bsn.connect(g);
        if (ftype && ftype !== 'off' && filt < 0.999) {
            const fnode = actx.createBiquadFilter();
            fnode.type  = ftype;
            // Exponential Hz map: 200 Hz at filt=0, 20 kHz at filt=1
            fnode.frequency.value = Math.min(20000, 200 * Math.pow(100, filt));
            fnode.Q.value = 1.2;
            g.connect(fnode);
            fnode.connect(dest);
        } else {
            g.connect(dest);
        }
        bsn.start(t);
        bsn.stop(t + dur + 0.05);
    }

    // ── Loop fire — caller stops via returned {bsn, g} handle ───────
    function _fireLoop(actx, dest, buf, t, pitch, vel, totalSemi) {
        if (!buf) return null;
        const bsn  = actx.createBufferSource();
        bsn.buffer = buf;
        bsn.loop   = true;
        const rate = pitch * Math.pow(2, (totalSemi || 0) / 12);
        bsn.playbackRate.value = rate;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.88 * Math.max(0.001, vel || 1), t + 0.012);
        bsn.connect(g).connect(dest);
        bsn.start(t);
        return { bsn, g };
    }

    // ── Resolve pattern index for current tick / direction ──────────
    function _resolveIdx(tick, len, dir, ppRef) {
        if (len <= 1) return 0;
        switch (dir) {
            case 1: return (len - 1 - (tick % len));          // REV
            case 2: {                                         // PP
                const period = 2 * (len - 1);
                const phase  = tick % period;
                return phase < len ? phase : period - phase;
            }
            case 3: return Math.floor(Math.random() * len);   // RND
            default: return tick % len;                       // FWD
        }
    }

    // ── Waveform: RMS energy envelope (amber) + min/max (cyan) ─────
    function _drawWave(canvas, buffer, onsets) {
        const W   = canvas.width, H = canvas.height;
        const c2  = canvas.getContext('2d');
        const ch  = buffer.getChannelData(0);
        const mid = H * 0.5;
        c2.clearRect(0, 0, W, H);
        c2.fillStyle = '#000c14';
        c2.fillRect(0, 0, W, H);
        const step = Math.max(1, Math.floor(ch.length / W));

        // RMS envelope — amber layer, gives energy shape at a glance
        c2.beginPath();
        c2.strokeStyle = 'rgba(255,170,0,.38)';
        c2.lineWidth   = 1.5;
        for (let x = 0; x < W; x++) {
            let sum = 0;
            for (let j = 0; j < step; j++) { const v = ch[x * step + j] || 0; sum += v * v; }
            const y = mid - Math.sqrt(sum / step) * mid * 0.94;
            x === 0 ? c2.moveTo(0, y) : c2.lineTo(x, y);
        }
        c2.stroke();

        // Min/max waveform — cyan
        c2.beginPath();
        c2.strokeStyle = 'rgba(0,243,255,.7)';
        c2.lineWidth   = 1;
        for (let x = 0; x < W; x++) {
            let lo = 1, hi = -1;
            for (let j = 0; j < step; j++) {
                const v = ch[x * step + j] || 0;
                if (v < lo) lo = v; if (v > hi) hi = v;
            }
            const y0 = (0.5 - hi * 0.47) * H;
            const y1 = (0.5 - lo * 0.47) * H;
            x === 0 ? c2.moveTo(0, y0) : c2.lineTo(x, y0);
            c2.lineTo(x, y1);
        }
        c2.stroke();

        // Slice boundary markers
        onsets.forEach((s, i) => {
            const x = Math.floor(s / buffer.length * W);
            c2.strokeStyle = i === 0 ? 'rgba(255,200,0,.82)' : 'rgba(255,80,80,.65)';
            c2.lineWidth   = 1;
            c2.beginPath(); c2.moveTo(x, 0); c2.lineTo(x, H); c2.stroke();
            c2.fillStyle = i === 0 ? 'rgba(255,200,0,.9)' : 'rgba(255,80,80,.85)';
            c2.font = '6.5px monospace';
            c2.fillText(i + 1, x + 2, 9);
        });
    }

    function init() {
        SonicSuite.registerCard('slicer', {
            tag:   'S',
            label: '◈ SLICER',
            mount(body, ctx) {
                const st = {
                    slices:     [],
                    revSlices:  [],
                    onsets:     [],
                    sequence:   new Array(STEPS).fill(-1),
                    velocity:   new Array(STEPS).fill(0),
                    pitch:      1.0,
                    gate:       0.92,
                    tune:       0,      // global semitone transpose −12..+12
                    atk:        0.004,  // per-voice attack  (seconds)
                    rel:        0.08,   // per-voice release (seconds)
                    filt:       1.0,    // filter cutoff 0..1 (exp Hz map)
                    ftype:      'off',  // 'off' | 'lowpass' | 'highpass'
                    sens:       1.0,    // onset detection sensitivity
                    reverse:    false,
                    chromatic:  false,
                    record:     false,
                    swing:      0.0,
                    len:        16,
                    dir:        0,
                    tick:       0,
                    activeStep: -1,
                };

                // ── Scoped CSS (injected once) ─────────────────────
                if (!document.getElementById('sl-style')) {
                    const sEl = document.createElement('style'); sEl.id = 'sl-style';
                    sEl.textContent =
                        '.ss-slicer-step .sl-vb{position:absolute;left:0;right:0;bottom:0;' +
                        'background:linear-gradient(to top,rgba(0,243,255,.35),rgba(0,243,255,.05));' +
                        'pointer-events:none;transition:height .08s;height:0;}' +
                        '.ss-slicer-step .sl-sl{position:relative;z-index:1;}' +
                        '.sl-lbl{font-size:6.5px;color:rgba(0,243,255,.38);letter-spacing:1.5px;}' +
                        '.sl-val{font:8px/1 \'JetBrains Mono\',monospace;color:#00f3ff;min-width:26px;display:inline-block;}' +
                        '.ss-slicer-pad{transition:background .06s,box-shadow .06s;}' +
                        '.ss-slicer-pad.hit{background:rgba(0,243,255,.25)!important;box-shadow:0 0 8px rgba(0,243,255,.55);}' +
                        '.ss-slicer-pad.looping{background:rgba(255,200,0,.15)!important;box-shadow:0 0 10px 2px rgba(255,200,0,.55);}' +
                        '@keyframes sl-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,200,0,0)}50%{box-shadow:0 0 7px 2px rgba(255,200,0,.55)}}' +
                        '.sl-snap-armed{animation:sl-pulse 1.4s ease-in-out infinite;}';
                    document.head.appendChild(sEl);
                }

                // ── SNAP recording indicator (fills over 10 s) ────
                const snapBar = document.createElement('div');
                snapBar.style.cssText = 'height:2px;background:rgba(0,243,255,.08);margin-bottom:3px;border-radius:1px;overflow:hidden;';
                snapBar.innerHTML = '<div style="height:100%;width:0%;background:rgba(255,200,0,.7);transition:width 10s linear;"></div>';
                body.appendChild(snapBar);

                // ── Drop zone ─────────────────────────────────────
                const drop = document.createElement('div');
                drop.style.cssText =
                    'border:2px dashed rgba(0,243,255,.28);border-radius:3px;' +
                    'padding:8px;text-align:center;cursor:pointer;' +
                    'font-size:8px;letter-spacing:2px;color:rgba(0,243,255,.4);' +
                    'margin-bottom:5px;transition:all .15s;';
                drop.textContent = '▼ DROP AUDIO  OR  CLICK TO BROWSE';
                body.appendChild(drop);

                const fileIn = document.createElement('input');
                fileIn.type = 'file'; fileIn.accept = 'audio/*';
                fileIn.style.display = 'none';
                body.appendChild(fileIn);

                // ── Waveform (canvas + flash overlay in relative wrapper) ──
                const waveWrap = document.createElement('div');
                waveWrap.style.cssText = 'position:relative;margin-bottom:5px;';
                body.appendChild(waveWrap);

                const waveCanvas = document.createElement('canvas');
                waveCanvas.width = 336; waveCanvas.height = 48;
                waveCanvas.style.cssText =
                    'width:100%;height:48px;display:block;border-radius:2px;' +
                    'border:1px solid rgba(0,243,255,.15);';
                waveWrap.appendChild(waveCanvas);

                // Translucent overlay highlights the active slice on each trigger
                const waveFlash = document.createElement('div');
                waveFlash.style.cssText =
                    'position:absolute;top:0;bottom:0;left:0;width:0;' +
                    'background:rgba(255,200,0,.28);pointer-events:none;' +
                    'border-radius:2px;opacity:0;transition:opacity .1s;';
                waveWrap.appendChild(waveFlash);

                // ── 16 pads — click fires, hold ≥200 ms loops, SHIFT = chromatic ──
                const padGrid = document.createElement('div');
                padGrid.style.cssText = 'display:grid;grid-template-columns:repeat(16,1fr);gap:2px;margin-bottom:4px;';
                let activeLoop = null; // { bsn, g, padEl }
                const padEls = Array.from({ length: MAX_SLICES }, (_, i) => {
                    const b = document.createElement('button');
                    b.className = 'ss-slicer-pad';
                    b.textContent = String(i + 1).padStart(2, '0');
                    b.style.cssText =
                        'opacity:.22;border:1px solid rgba(0,243,255,.12);background:transparent;' +
                        'color:rgba(0,243,255,.3);border-radius:2px;cursor:pointer;' +
                        'font-size:7px;padding:2px 0;line-height:1.4;';

                    let holdTimer = null;

                    b.addEventListener('pointerdown', ev => {
                        if (!st.slices.length) return;
                        b.setPointerCapture(ev.pointerId);
                        const chroma    = st.chromatic || ev.shiftKey;
                        const idx       = chroma ? 0 : i;
                        const semiOff   = chroma ? (i - 8) : 0;
                        const totalSemi = semiOff + st.tune;
                        if (!st.slices[idx]) return;
                        const buf = st.reverse ? st.revSlices[idx] : st.slices[idx];

                        // Immediate one-shot
                        _fire(ctx.audioCtx, ctx.bus, buf, ctx.audioCtx.currentTime,
                              st.pitch, st.gate, 1.0, totalSemi, st.atk, st.rel, st.filt, st.ftype);
                        _flashSlice(idx);

                        if (st.record && st.activeStep >= 0) {
                            st.sequence[st.activeStep] = idx;
                            st.velocity[st.activeStep] = 0;
                            _paintSeq();
                        }
                        b.classList.add('hit');
                        setTimeout(() => b.classList.remove('hit'), 140);

                        // Hold ≥ 200 ms → engage loop mode
                        holdTimer = setTimeout(() => {
                            holdTimer = null;
                            if (activeLoop) {
                                activeLoop.g.gain.setTargetAtTime(0, ctx.audioCtx.currentTime, 0.05);
                                activeLoop.bsn.stop(ctx.audioCtx.currentTime + 0.3);
                                activeLoop.padEl && activeLoop.padEl.classList.remove('looping');
                            }
                            activeLoop = _fireLoop(ctx.audioCtx, ctx.bus, buf,
                                ctx.audioCtx.currentTime, st.pitch, 1.0, totalSemi);
                            if (activeLoop) { activeLoop.padEl = b; b.classList.add('looping'); }
                        }, 200);
                    });

                    b.addEventListener('pointerup', () => {
                        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                        if (activeLoop && activeLoop.padEl === b) {
                            activeLoop.g.gain.setTargetAtTime(0, ctx.audioCtx.currentTime, 0.06);
                            activeLoop.bsn.stop(ctx.audioCtx.currentTime + 0.35);
                            b.classList.remove('looping');
                            activeLoop = null;
                        }
                    });

                    padGrid.appendChild(b);
                    return b;
                });
                body.appendChild(padGrid);

                // ── Step sequencer (click cycles slice, ALT cycles velocity, right = clear) ─
                const seqGrid = document.createElement('div');
                seqGrid.style.cssText = 'display:grid;grid-template-columns:repeat(16,1fr);gap:2px;margin-bottom:7px;';
                const seqEls = Array.from({ length: STEPS }, (_, i) => {
                    const b = document.createElement('button');
                    b.className = 'ss-slicer-step';
                    b.dataset.idx = i;
                    b.innerHTML = '<span class="sl-vb"></span><span class="sl-sl">—</span>';
                    b.style.cssText = 'position:relative;overflow:hidden;background:transparent;' +
                        'border:1px solid rgba(0,243,255,' + (i % 4 === 0 ? '.28' : '.12') + ');' +
                        'color:rgba(0,243,255,.28);border-radius:1px;cursor:pointer;padding:0;';
                    b.addEventListener('click', e => {
                        if (!st.slices.length) return;
                        if (e.altKey) {
                            // cycle velocity
                            if (st.sequence[i] < 0) return;
                            st.velocity[i] = (st.velocity[i] + 1) % VEL_LEVELS.length;
                        } else {
                            // cycle slice idx
                            const cur = st.sequence[i];
                            st.sequence[i] = (cur < st.slices.length - 1) ? cur + 1 : -1;
                            if (st.sequence[i] === 0) st.velocity[i] = 0; // reset vel on fresh assignment
                        }
                        _paintSeq();
                    });
                    b.addEventListener('contextmenu', e => {
                        e.preventDefault();
                        st.sequence[i] = -1;
                        st.velocity[i] = 0;
                        _paintSeq();
                    });
                    seqGrid.appendChild(b);
                    return b;
                });
                body.appendChild(seqGrid);

                // ── Row 1: PITCH / GATE / TUNE / [REV] [DETECT] [NORM] [CLR] ──
                const ctrl = document.createElement('div');
                ctrl.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-bottom:4px;';
                ctrl.innerHTML =
                    '<span class="sl-lbl">PITCH</span>' +
                    '<input type="range" class="sl-pitch" min="0.25" max="4" step="0.01" value="1" style="width:44px;">' +
                    '<span class="sl-pv sl-val">×1.00</span>' +
                    '<span class="sl-lbl">GATE</span>' +
                    '<input type="range" class="sl-gate" min="0.05" max="1" step="0.01" value="0.92" style="width:44px;">' +
                    '<span class="sl-gv sl-val">0.92</span>' +
                    '<span class="sl-lbl">TUNE</span>' +
                    '<input type="range" class="sl-tune" min="-12" max="12" step="1" value="0" style="width:40px;">' +
                    '<span class="sl-tv sl-val" style="min-width:24px;">0st</span>' +
                    '<button class="ss-card-btn sl-rev"  style="width:auto;padding:0 5px;font-size:7px;">REV</button>' +
                    '<button class="ss-card-btn sl-det"  style="width:auto;padding:0 5px;font-size:7px;">DETECT</button>' +
                    '<button class="ss-card-btn sl-norm" style="width:auto;padding:0 5px;font-size:7px;" title="Peak-normalize all slices to -1.5 dBFS">NORM</button>' +
                    '<button class="ss-card-btn sl-clr"  style="width:auto;padding:0 5px;font-size:7px;">CLR</button>';
                body.appendChild(ctrl);

                // ── Row 2: SWG / LEN / SENS / [DIR] [CHR] [REC] [[SNAP]] ──
                const ctrl2 = document.createElement('div');
                ctrl2.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-bottom:4px;';
                ctrl2.innerHTML =
                    '<span class="sl-lbl">SWG</span>' +
                    '<input type="range" class="sl-swing" min="0" max="0.7" step="0.01" value="0" style="width:36px;">' +
                    '<span class="sl-sv sl-val">0%</span>' +
                    '<span class="sl-lbl">LEN</span>' +
                    '<input type="range" class="sl-len" min="1" max="16" step="1" value="16" style="width:36px;">' +
                    '<span class="sl-lv sl-val">16</span>' +
                    '<span class="sl-lbl">SENS</span>' +
                    '<input type="range" class="sl-sens" min="0.3" max="3" step="0.1" value="1" style="width:34px;">' +
                    '<span class="sl-snv sl-val">×1.0</span>' +
                    '<button class="ss-card-btn sl-dir"  style="width:auto;padding:0 5px;font-size:7px;">FWD</button>' +
                    '<button class="ss-card-btn sl-chr"  style="width:auto;padding:0 5px;font-size:7px;" title="Chromatic: 16 pads = ±8 semitones around root">CHR</button>' +
                    '<button class="ss-card-btn sl-rec"  style="width:auto;padding:0 5px;font-size:7px;" title="Record pad hits into sequencer">REC</button>' +
                    '<button class="ss-card-btn sl-snap" style="width:auto;padding:0 5px;font-size:7px;color:#ffc800;border-color:rgba(255,200,0,.5);" title="Freeze 10s of master output into pads">[ SNAP ]</button>';
                body.appendChild(ctrl2);

                // ── Row 3: ATK / REL / FILT / [FTYPE] ─────────────
                const ctrl3 = document.createElement('div');
                ctrl3.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap;';
                ctrl3.innerHTML =
                    '<span class="sl-lbl">ATK</span>' +
                    '<input type="range" class="sl-atk" min="0.001" max="0.12" step="0.001" value="0.004" style="width:38px;">' +
                    '<span class="sl-av sl-val" style="min-width:28px;">4ms</span>' +
                    '<span class="sl-lbl">REL</span>' +
                    '<input type="range" class="sl-rel" min="0.01" max="0.5" step="0.005" value="0.08" style="width:38px;">' +
                    '<span class="sl-rv sl-val" style="min-width:32px;">80ms</span>' +
                    '<span class="sl-lbl">FILT</span>' +
                    '<input type="range" class="sl-filt" min="0" max="1" step="0.01" value="1" style="width:44px;">' +
                    '<span class="sl-fv sl-val" style="min-width:32px;">OPEN</span>' +
                    '<button class="ss-card-btn sl-ftype" style="width:auto;padding:0 5px;font-size:7px;" title="Filter type">OFF</button>';
                body.appendChild(ctrl3);

                // ── Paint helpers ─────────────────────────────────
                function _paintPads() {
                    padEls.forEach((b, i) => {
                        const has = !!st.slices[i];
                        b.style.opacity     = has ? '1'   : '.22';
                        b.style.color       = has ? '#00f3ff' : 'rgba(0,243,255,.3)';
                        b.style.borderColor = has ? 'rgba(0,243,255,.45)' : 'rgba(0,243,255,.12)';
                        // Chromatic mode: show semitone offset from root; else slice number
                        if (has && st.chromatic) {
                            const dispSemi = (i - 8) + st.tune;
                            b.textContent = (dispSemi >= 0 ? '+' : '') + dispSemi;
                        } else {
                            b.textContent = String(i + 1).padStart(2, '0');
                        }
                    });
                }

                // Flash the slice region on the waveform overlay (single CSS transition)
                function _flashSlice(idx) {
                    if (!waveCanvas._rawBuf || st.onsets[idx] == null) return;
                    const bufLen = waveCanvas._rawBuf.length;
                    const x0 = (st.onsets[idx] / bufLen * 100).toFixed(2);
                    const x1 = ((st.onsets[idx + 1] || bufLen) / bufLen * 100).toFixed(2);
                    waveFlash.style.left    = x0 + '%';
                    waveFlash.style.width   = (x1 - x0) + '%';
                    waveFlash.style.opacity = '1';
                    clearTimeout(waveFlash._t);
                    waveFlash._t = setTimeout(() => { waveFlash.style.opacity = '0'; }, 70);
                }

                function _paintSeq() {
                    seqEls.forEach((b, i) => {
                        const v    = st.sequence[i];
                        const vv   = VEL_LEVELS[st.velocity[i] || 0];
                        const cur  = i === st.activeStep;
                        const past = i >= st.len;
                        const lbl  = b.firstElementChild.nextElementSibling;
                        const bar  = b.firstElementChild;
                        lbl.textContent      = v >= 0 ? String(v + 1).padStart(2, '0') : '—';
                        bar.style.height     = v >= 0 ? Math.round(vv * 100) + '%' : '0';
                        b.style.background   = cur ? 'rgba(0,243,255,.22)' : '';
                        b.style.opacity      = past ? '.35' : '1';
                        b.style.color        = cur ? '#eafeff' : (v >= 0 ? '#00f3ff' : 'rgba(0,243,255,.28)');
                        b.style.borderColor  = cur ? '#00f3ff' :
                            (v >= 0 ? 'rgba(0,243,255,.4)' :
                             'rgba(0,243,255,' + (i % 4 === 0 ? '.28' : '.12') + ')');
                        b.style.boxShadow    = cur ? '0 0 6px rgba(0,243,255,.35)' : '';
                    });
                }

                // ── Shared buffer processor (file upload + snap share this path) ─
                function _processNewBuffer(buf) {
                    waveCanvas._rawBuf  = buf;
                    st.onsets    = _equalOnsets(buf, MAX_SLICES);
                    st.slices    = _buildSlices(ctx.audioCtx, buf, st.onsets);
                    st.revSlices = _buildRevSlices(ctx.audioCtx, st.slices);
                    for (let i = 0; i < STEPS; i++)
                        st.sequence[i] = i < st.slices.length ? i : -1;
                    _drawWave(waveCanvas, buf, st.onsets);
                    _paintPads();
                    _paintSeq();
                }

                // ── Rolling 10-second circular buffer (pre-allocated, never reallocated) ──
                const _snapSR   = ctx.audioCtx.sampleRate;
                const _snapLen  = Math.floor(_snapSR * 10);
                const _snapCirc = new Float32Array(_snapLen); // mono, pre-alloc'd
                let   _snapWP   = 0;   // circular write pointer (samples)
                let   _snapSpn  = null;

                function _startRollingCapture() {
                    if (_snapSpn || !window._ssAnalyser) return;
                    // ScriptProcessorNode records into pre-allocated _snapCirc.
                    // No object allocation inside onaudioprocess — zero GC pressure.
                    const spn = ctx.audioCtx.createScriptProcessor(4096, 1, 1);
                    spn.onaudioprocess = function(e) {
                        const inp   = e.inputBuffer.getChannelData(0);
                        const circ  = _snapCirc;
                        const total = _snapLen;
                        let   wp    = _snapWP;
                        for (let i = 0, n = inp.length; i < n; i++) {
                            circ[wp] = inp[i];
                            if (++wp === total) wp = 0;
                        }
                        _snapWP = wp;
                        // Output buffer starts zeroed — no signal added to mix.
                    };
                    window._ssAnalyser.connect(spn);
                    // Must connect SPN output to keep the node alive in Chrome.
                    // Gain=0 so nothing audible reaches destination.
                    const sink = ctx.audioCtx.createGain();
                    sink.gain.value = 0;
                    spn.connect(sink);
                    sink.connect(ctx.audioCtx.destination);
                    _snapSpn = spn;
                    // Visual: pulse the SNAP button + animate fill bar (10 s warmup)
                    const _sb = ctrl2.querySelector('.sl-snap');
                    if (_sb) _sb.classList.add('sl-snap-armed');
                    const fillEl = snapBar.firstElementChild;
                    fillEl.style.transition = 'width 10s linear';
                    fillEl.style.width = '100%';
                }
                // _ssAnalyser is set by _ensureAudio() which runs before mount(),
                // but audio context may not be started yet — poll until available.
                if (window._ssAnalyser) {
                    _startRollingCapture();
                } else {
                    const _snapPoll = setInterval(function() {
                        if (window._ssAnalyser) { clearInterval(_snapPoll); _startRollingCapture(); }
                    }, 500);
                }

                // ── SNAP: freeze current 10-s window → slicer pads (instantaneous) ──
                function snapToSlicer() {
                    const wp  = _snapWP; // capture write-head before any further writes
                    const cap = ctx.audioCtx.createBuffer(1, _snapLen, _snapSR);
                    const dst = cap.getChannelData(0);
                    // Unroll circular buffer into chronological order.
                    dst.set(_snapCirc.subarray(wp), 0);
                    dst.set(_snapCirc.subarray(0, wp), _snapLen - wp);
                    _processNewBuffer(cap);
                    drop.textContent       = '✓ SNAPPED — ' + st.slices.length + ' SLICES';
                    drop.style.color       = 'rgba(0,243,255,.7)';
                    drop.style.borderColor = 'rgba(0,243,255,.5)';
                }

                // ── Load & process (file upload path) ────────────────────────────
                function _loadBuffer(arrayBuf) {
                    drop.textContent = '⟳ DECODING…';
                    ctx.audioCtx.decodeAudioData(arrayBuf,
                        buf => {
                            _processNewBuffer(buf);
                            drop.textContent       = '✓ ' + st.slices.length + ' SLICES  —  DROP TO REPLACE';
                            drop.style.color       = 'rgba(0,243,255,.7)';
                            drop.style.borderColor = 'rgba(0,243,255,.5)';
                        },
                        () => {
                            drop.textContent       = '✗ DECODE FAILED — try another file';
                            drop.style.color       = '#ff4444';
                            drop.style.borderColor = '#ff4444';
                        }
                    );
                }

                // ── File input ────────────────────────────────────
                drop.addEventListener('click', () => fileIn.click());
                fileIn.addEventListener('change', e => {
                    const f = e.target.files[0];
                    if (f) { const r = new FileReader(); r.onload = ev => _loadBuffer(ev.target.result); r.readAsArrayBuffer(f); }
                    fileIn.value = '';
                });
                ['dragover','dragenter'].forEach(ev =>
                    drop.addEventListener(ev, e => { e.preventDefault(); drop.style.borderColor = '#00f3ff'; drop.style.color = '#00f3ff'; })
                );
                drop.addEventListener('dragleave', () => {
                    drop.style.borderColor = 'rgba(0,243,255,.28)';
                    drop.style.color = 'rgba(0,243,255,.4)';
                });
                drop.addEventListener('drop', e => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f && f.type.startsWith('audio/')) {
                        const r = new FileReader(); r.onload = ev => _loadBuffer(ev.target.result); r.readAsArrayBuffer(f);
                    }
                });

                // ── Row 1 wiring ──────────────────────────────────
                ctrl.querySelector('.sl-pitch').addEventListener('input', e => {
                    st.pitch = +e.target.value;
                    ctrl.querySelector('.sl-pv').textContent = '×' + st.pitch.toFixed(2);
                });
                ctrl.querySelector('.sl-gate').addEventListener('input', e => {
                    st.gate = +e.target.value;
                    ctrl.querySelector('.sl-gv').textContent = st.gate.toFixed(2);
                });
                ctrl.querySelector('.sl-tune').addEventListener('input', e => {
                    st.tune = +e.target.value;
                    ctrl.querySelector('.sl-tv').textContent = (st.tune >= 0 ? '+' : '') + st.tune + 'st';
                    _paintPads();
                });
                ctrl.querySelector('.sl-rev').addEventListener('click', e => {
                    st.reverse = !st.reverse;
                    e.target.style.color       = st.reverse ? '#ff4444' : '';
                    e.target.style.borderColor = st.reverse ? '#ff4444' : '';
                });
                ctrl.querySelector('.sl-det').addEventListener('click', () => {
                    if (!waveCanvas._rawBuf) return;
                    const raw    = waveCanvas._rawBuf;
                    st.onsets    = _detectOnsets(raw, st.sens);
                    st.slices    = _buildSlices(ctx.audioCtx, raw, st.onsets);
                    st.revSlices = _buildRevSlices(ctx.audioCtx, st.slices);
                    _drawWave(waveCanvas, raw, st.onsets);
                    _paintPads(); _paintSeq();
                });
                ctrl.querySelector('.sl-norm').addEventListener('click', e => {
                    if (!st.slices.length) return;
                    _normalizeSlices(st.slices);
                    st.revSlices = _buildRevSlices(ctx.audioCtx, st.slices);
                    e.target.style.color       = '#00f3ff';
                    e.target.style.borderColor = '#00f3ff';
                    setTimeout(() => { e.target.style.color = ''; e.target.style.borderColor = ''; }, 500);
                });
                ctrl.querySelector('.sl-clr').addEventListener('click', () => {
                    st.sequence.fill(-1); st.velocity.fill(0); _paintSeq();
                });

                // ── Row 2 wiring ──────────────────────────────────
                ctrl2.querySelector('.sl-swing').addEventListener('input', e => {
                    st.swing = +e.target.value;
                    ctrl2.querySelector('.sl-sv').textContent = Math.round(st.swing * 100) + '%';
                });
                ctrl2.querySelector('.sl-len').addEventListener('input', e => {
                    st.len = Math.max(1, Math.min(16, +e.target.value));
                    ctrl2.querySelector('.sl-lv').textContent = st.len;
                    _paintSeq();
                });
                ctrl2.querySelector('.sl-sens').addEventListener('input', e => {
                    st.sens = +e.target.value;
                    ctrl2.querySelector('.sl-snv').textContent = '×' + st.sens.toFixed(1);
                });
                const dirBtn = ctrl2.querySelector('.sl-dir');
                dirBtn.addEventListener('click', () => {
                    st.dir = (st.dir + 1) % 4;
                    dirBtn.textContent       = DIR_NAMES[st.dir];
                    dirBtn.style.color       = st.dir ? '#ffc800' : '';
                    dirBtn.style.borderColor = st.dir ? '#ffc800' : '';
                    st.tick = 0;
                });
                const chrBtn = ctrl2.querySelector('.sl-chr');
                chrBtn.addEventListener('click', () => {
                    st.chromatic = !st.chromatic;
                    chrBtn.style.color       = st.chromatic ? '#ffc800' : '';
                    chrBtn.style.borderColor = st.chromatic ? '#ffc800' : '';
                    _paintPads();
                });
                const recBtn = ctrl2.querySelector('.sl-rec');
                recBtn.addEventListener('click', () => {
                    st.record = !st.record;
                    recBtn.style.color       = st.record ? '#ff4444' : '';
                    recBtn.style.borderColor = st.record ? '#ff4444' : '';
                });
                const snapBtn = ctrl2.querySelector('.sl-snap');
                snapBtn.addEventListener('click', () => {
                    _startRollingCapture();
                    snapToSlicer();
                    snapBtn.style.background = 'rgba(255,200,0,.18)';
                    setTimeout(() => { snapBtn.style.background = ''; }, 300);
                });

                // ── Row 3 wiring ──────────────────────────────────
                ctrl3.querySelector('.sl-atk').addEventListener('input', e => {
                    st.atk = +e.target.value;
                    ctrl3.querySelector('.sl-av').textContent = Math.round(st.atk * 1000) + 'ms';
                });
                ctrl3.querySelector('.sl-rel').addEventListener('input', e => {
                    st.rel = +e.target.value;
                    ctrl3.querySelector('.sl-rv').textContent = Math.round(st.rel * 1000) + 'ms';
                });
                ctrl3.querySelector('.sl-filt').addEventListener('input', e => {
                    st.filt = +e.target.value;
                    const fv = ctrl3.querySelector('.sl-fv');
                    if (st.filt >= 0.999) {
                        fv.textContent = 'OPEN';
                    } else {
                        const hz = 200 * Math.pow(100, st.filt);
                        fv.textContent = hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : Math.round(hz) + 'Hz';
                    }
                });
                const FTYPES = ['off', 'lowpass', 'highpass'];
                const ftypeBtn = ctrl3.querySelector('.sl-ftype');
                ftypeBtn.addEventListener('click', () => {
                    st.ftype = FTYPES[(FTYPES.indexOf(st.ftype) + 1) % FTYPES.length];
                    const labels = { off: 'OFF', lowpass: 'LP ▼', highpass: 'HP ▲' };
                    ftypeBtn.textContent       = labels[st.ftype];
                    ftypeBtn.style.color       = st.ftype !== 'off' ? '#ff88ff' : '';
                    ftypeBtn.style.borderColor = st.ftype !== 'off' ? '#ff88ff' : '';
                });

                // ── Store refs for onTick / onStop ────────────────
                this._st        = st;
                this._ctx       = ctx;
                this._seqEls    = seqEls;
                this._flashSlice = _flashSlice;
            },

            onTick(t, _step16) {
                const st = this._st;
                if (!st || !st.slices.length) return;

                const patIdx = _resolveIdx(st.tick, st.len, st.dir);
                st.tick++;
                st.activeStep = patIdx;

                const slot = st.sequence[patIdx];
                if (slot >= 0 && st.slices[slot]) {
                    const bpm     = Math.max(20, Math.min(400, window.currentBPM || 120));
                    const stepDur = 60 / bpm / 4;
                    const swing   = patIdx % 2 === 1 ? st.swing * stepDur * 0.5 : 0;
                    const vel     = VEL_LEVELS[st.velocity[patIdx] || 0];
                    const buf     = st.reverse ? st.revSlices[slot] : st.slices[slot];
                    _fire(this._ctx.audioCtx, this._ctx.bus, buf, t + swing,
                          st.pitch, st.gate, vel, st.tune, st.atk, st.rel, st.filt, st.ftype);
                    // Waveform flash — off the audio scheduling hot path
                    const flash = this._flashSlice;
                    if (flash) setTimeout(() => flash(slot), 0);
                }

                // Sequencer highlight
                const seqEls = this._seqEls;
                if (seqEls) setTimeout(() => {
                    seqEls.forEach((b, i) => {
                        const cur  = i === patIdx;
                        const v    = st.sequence[i];
                        const past = i >= st.len;
                        b.style.background  = cur ? 'rgba(0,243,255,.22)' : '';
                        b.style.opacity     = past ? '.35' : '1';
                        b.style.color       = cur ? '#eafeff' : (v >= 0 ? '#00f3ff' : 'rgba(0,243,255,.28)');
                        b.style.borderColor = cur ? '#00f3ff' : (v >= 0 ? 'rgba(0,243,255,.4)' : 'rgba(0,243,255,' + (i % 4 === 0 ? '.28' : '.12') + ')');
                        b.style.boxShadow   = cur ? '0 0 6px rgba(0,243,255,.35)' : '';
                    });
                }, 0);
            },

            onStop() {
                if (this._st) { this._st.activeStep = -1; this._st.tick = 0; }
                if (this._seqEls) this._seqEls.forEach(b => {
                    b.style.background = b.style.boxShadow = '';
                });
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function() {
        const btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(init, 110);
        }
        btn && btn.addEventListener('click', _once);
    });
})();

