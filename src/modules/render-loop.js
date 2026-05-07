// ═══════════════════════════════════════════════════════════════
// RENDER LOOP MODULE — 60FPS canvas engine, FX overlays, impact FX,
// seismic/punch physics, lower third burn-in, draggable helper
// Extracted from main.js. Depends on: $, APP, log, rotateMedia,
// drawMediaStripToggle, drawNFTVault, drawMediaQueue, morphLogo,
// ghostLog (globals)
// ═══════════════════════════════════════════════════════════════

let _lastFrameTime = 0;
function renderLoop(timestamp) {
    APP.render.rafId = requestAnimationFrame(renderLoop);
    // ── 60 FPS TARGET: skip only if <16ms since last frame ──
    if (timestamp - _lastFrameTime < 16) return;
    _lastFrameTime = timestamp;
    // ── VISIBILITY GATE: skip render if canvas container is hidden/collapsed ──
    var _cvs = APP.render && APP.render.canvas;
    if (_cvs && _cvs.parentElement) {
        var _pEl = _cvs.parentElement;
        var _pDisp = _pEl.style.display;
        var _pMH = _pEl.style.maxHeight;
        if (_pDisp === 'none' || _pMH === '0' || _pMH === '0px') return;
    }
    APP.render.frameCount++;
    if (timestamp - APP.render.lastFpsUpdate >= 1000) { APP.render.fps = APP.render.frameCount; APP.render.frameCount = 0; APP.render.lastFpsUpdate = timestamp; $('fps-val').textContent = APP.render.fps; }

    const ctx = APP.render.ctx; const w = APP.render.width; const h = APP.render.height;
    ctx.imageSmoothingEnabled = false;

    // --- SEISMIC ENGINE (Random shake on bass - OFF by default) ---
    // _fxActive gates expensive ops (RGB shift) — seismic runs independently
    const _fxActive = window.audioReactorActive ||
        document.body.classList.contains('fx-void') ||
        document.body.classList.contains('fx-lucy');

    // --- SEISMIC: canvas-level translate (captured by captureStream) ---
    // Velocity accumulator gives organic build-up & natural decay instead of hard on/off.
    // Threshold 130 (was 140): responds earlier — feels like the room vibrates at first bass hit.
    // Max amplitude 12px (was 14px): keeps all content safely on-screen even at 4K.
    let finalShakeX = 0, finalShakeY = 0;
    var _seismicDemoActive = performance.now() < (APP.vj._seismicDemoUntil || 0);
    if ((APP.vj.rumbleEnabled && (APP.audio.isPlaying || APP.audio.videoSource)) || _seismicDemoActive) {
        var _rawBassForSei = APP.audio.bassLevel;
        // Smooth velocity: builds with bass, decays naturally when bass drops
        if (typeof APP.vj._seismicVel === 'undefined') APP.vj._seismicVel = 0;
        var _seismicTarget = Math.max(0, (_rawBassForSei - 130) / 125); // 0-1 normalised
        // During one-shot demo: inject sustained shake velocity
        if (_seismicDemoActive) {
            var _demoProgress = 1 - (APP.vj._seismicDemoUntil - performance.now()) / 3000;
            _seismicTarget = Math.max(_seismicTarget, 0.7 * (1 - _demoProgress * _demoProgress));
        }
        APP.vj._seismicVel = APP.vj._seismicVel * 0.82 + _seismicTarget * 0.18;
        if (APP.vj._seismicVel > 0.005) {
            var _sei = APP.vj._seismicVel * 12; // max 12px
            finalShakeX = (Math.random() - 0.5) * _sei;
            finalShakeY = (Math.random() - 0.5) * _sei * 0.5; // Y is half X — feels more realistic
        }
    } else {
        APP.vj._seismicVel = 0;
    }
    APP.vj._canvasShakeX = finalShakeX;
    APP.vj._canvasShakeY = finalShakeY;
    // Console shake: only if console mode is enabled
    if (APP.vj.rumbleEnabled && APP.vj.seismicConsoleMode && (Math.abs(finalShakeX) > 0.5 || Math.abs(finalShakeY) > 0.5)) {
        document.body.style.transform = 'translate3d(' + finalShakeX.toFixed(1) + 'px,' + finalShakeY.toFixed(1) + 'px,0)';
    } else {
        if (document.body.style.transform) document.body.style.transform = '';
    }

    // --- PUNCH: BPM-linked beat pulser — TWEETER SPRING PHYSICS ---
    // Underdamped spring oscillator: canvas punches FORWARD then snaps BACK past rest
    // like a speaker tweeter cone — scale > 1 on push, < 1 on pull-back, decays to rest.
    if (typeof APP.vj._punchSpring === 'undefined')    APP.vj._punchSpring = 0;
    if (typeof APP.vj._punchVel === 'undefined')       APP.vj._punchVel = 0;
    if (typeof APP.vj._punchPrevBass === 'undefined')  APP.vj._punchPrevBass = 0;
    if (typeof APP.vj._bpm === 'undefined')            APP.vj._bpm = { interval: 0, lastBeat: 0, nextBeat: 0, history: [] };
    var _bassNow  = APP.audio.bassLevel;
    var _bassRise = _bassNow - APP.vj._punchPrevBass;
    APP.vj._punchPrevBass = _bassNow;
    var _nowMs = performance.now();
    var _bpmModel = APP.vj._bpm;
    var _punchIsOn = document.body.classList.contains('fx-punch');

    // Bass multiplier: drives punch intensity — zero when silent, violent on kick drop
    var _bassMultiplier = APP.audio.bassLevel / 255;

    // Beat-sync auto-edit: rotate media on kick if current item has beatSync enabled
    if (_bassRise > 12 && _bassNow > 40 && !window._beatSyncCooldown && APP.media.audioSync) {
        var _bsCurrent = APP.media.queue[APP.media.currentIndex];
        if (_bsCurrent && _bsCurrent.beatSync && !APP.media._tx) {
            window._beatSyncCooldown = true;
            setTimeout(function() { window._beatSyncCooldown = false; }, 500);
            rotateMedia();
        }
    }

    // Kick onset: update BPM model on every rising-edge detection
    if (_bassRise > 12 && _bassNow > 40 && !window._punchCooldown) {
        window._punchCooldown = true;
        setTimeout(function() { window._punchCooldown = false; }, 100);
        if (_bpmModel.lastBeat > 0) {
            var _dt = _nowMs - _bpmModel.lastBeat;
            if (_dt > 230 && _dt < 2000) {          // valid: 30–260 BPM
                _bpmModel.history.push(_dt);
                if (_bpmModel.history.length > 8) _bpmModel.history.shift();
                var _s = 0; for (var _bi = 0; _bi < _bpmModel.history.length; _bi++) _s += _bpmModel.history[_bi];
                _bpmModel.interval = _s / _bpmModel.history.length;
            }
        }
        _bpmModel.lastBeat = _nowMs;
        _bpmModel.nextBeat = _nowMs + (_bpmModel.interval > 0 ? _bpmModel.interval : 500);
        // Impulse: scaled by (bassLevel/255) — screen punches violently on kick, stays still in silence
        if (_punchIsOn) APP.vj._punchVel += Math.min(0.85, _bassRise / 22) * _bassMultiplier;
    }

    // BPM-scheduled pulse — locked to tempo; magnitude driven by current bass level
    if (_punchIsOn && _bpmModel.interval > 230 && _nowMs >= _bpmModel.nextBeat) {
        _bpmModel.nextBeat += _bpmModel.interval;
        if (APP.vj._punchSpring < 0.18) APP.vj._punchVel += 0.55 * _bassMultiplier;
    }

    // Punch demo: inject rhythmic spring impulses every 400ms when one-shot active
    if (_nowMs < (APP.vj._punchDemoUntil || 0)) {
        if (!APP.vj._punchDemoBeat || _nowMs >= APP.vj._punchDemoBeat) {
            APP.vj._punchVel += 0.72;
            APP.vj._punchDemoBeat = _nowMs + 400;
        }
    }

    // Underdamped spring: stiffness=0.28 (oscil ~4Hz), damping=0.16 (bounces ~3x)
    // This makes the canvas push forward on kick, then snap back past rest (< 1.0 scale),
    // then oscillate to a stop — exactly like a tweeter cone.
    var _pk = 0.28, _pc = 0.16;
    var _pf = -_pk * APP.vj._punchSpring - _pc * APP.vj._punchVel;
    APP.vj._punchVel += _pf;
    APP.vj._punchSpring += APP.vj._punchVel;
    // Settle to exact zero when nearly at rest (prevents FP drift)
    if (Math.abs(APP.vj._punchSpring) < 0.0008 && Math.abs(APP.vj._punchVel) < 0.0008) {
        APP.vj._punchSpring = 0; APP.vj._punchVel = 0;
    }

    // Trigger body-level punch-hit flash on the POSITIVE peak (visible without canvas media)
    if (APP.vj._punchSpring > 0.35 && APP.vj._punchVel < 0 && !window._punchHitFired) {
        window._punchHitFired = true;
        document.body.classList.add('punch-hit');
        setTimeout(function() { document.body.classList.remove('punch-hit'); window._punchHitFired = false; }, 220);
    }

    // --- AUTONOMOUS PARTY MODE (audio-reactive via analyser) ---
    if (APP.vj.uiReactivity && APP.audio.bassLevel > 220 && Math.random() > 0.9) {
        if (typeof morphLogo === 'function') morphLogo();
    }

    // --- CLEAR FRAME (kill ghosting on logos) ---
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // --- PUNCH / SEISMIC: frame-level transform — wraps ALL drawing (canvas only) ---
    var _punch = APP.vj._punchSpring || 0;
    var _sX = APP.vj._canvasShakeX || 0, _sY = APP.vj._canvasShakeY || 0;
    var _hasFX = Math.abs(_punch) > 0.003 || Math.abs(_sX) > 0.1 || Math.abs(_sY) > 0.1;
    if (_hasFX) {
        ctx.save();
        var _ps = 1 + _punch * 0.14; // tweeter: +14% push on kick, -14% pull-back on snap
        ctx.translate(w * 0.5 + _sX, h * 0.5 + _sY);
        ctx.scale(_ps, _ps);
        ctx.translate(-w * 0.5, -h * 0.5);
    }

    // FILTER STACK — user corrections + active FX equivalent, applied at draw time.
    // Drawing the source WITH the FX filter writes filtered pixels directly into the canvas,
    // which captureStream() then captures correctly in recordings.
    // The previous approach used ctx.filter on an off-screen bake context which silently
    // fails in some browser/GPU environments, leaving canvas pixels unfiltered.
    // Draw-time application on the main ctx is the primary intended use of ctx.filter.
    var _fxCls = document.body.classList;
    var _fxDrawFilter = '';
    var _voidTiltAngle = 0, _voidTiltScale = 1;
    if      (_fxCls.contains('fx-scan'))  _fxDrawFilter = 'invert(1) contrast(1.5) grayscale(0.2) sepia(1) hue-rotate(135deg) saturate(2)';
    else if (_fxCls.contains('fx-void'))  {
        // Replicate console-warp CSS animation: ±1.5° rotation + 1.03↔0.97 scale at 600ms period
        var _voidT = performance.now() / 600 * Math.PI;
        _voidTiltAngle = Math.sin(_voidT) * 1.5 * (Math.PI / 180);
        _voidTiltScale = 1.0 - Math.sin(_voidT) * 0.03;
        _fxDrawFilter = 'grayscale(1) contrast(3) brightness(1.1)';
    }
    else if (_fxCls.contains('fx-lucy'))  {
        // Replicate lucy-full-hue CSS animation: 360° hue cycle over 3 seconds
        var _lucyHue = Math.round((performance.now() / 3000 * 360) % 360);
        _fxDrawFilter = 'hue-rotate(' + _lucyHue + 'deg) saturate(4) brightness(1.1)';
    }
    else if (_fxCls.contains('fx-nvg'))   _fxDrawFilter = 'grayscale(1) brightness(1.6) contrast(2.2) sepia(0.9) hue-rotate(78deg) saturate(5)';
    else if (_fxCls.contains('fx-tear'))  _fxDrawFilter = 'hue-rotate(90deg) contrast(1.2)';
    else if (_fxCls.contains('vhs'))      _fxDrawFilter = 'contrast(1.4) brightness(0.88) saturate(0.72) sepia(0.28)';
    var _punchBright = (_punch > 0.05) ? (1 + _punch * 0.9) : 1.0;
    const filterStr = 'brightness(' + (APP.vj.brightness * _punchBright) + ') contrast(' + APP.vj.contrast + ') saturate(' + APP.vj.saturation + ') hue-rotate(' + APP.vj.hue + 'deg)' + (APP.vj.invert ? ' invert(1)' : '') + (_fxDrawFilter ? ' ' + _fxDrawFilter : '');
    const isIdentityFilter = _punchBright <= 1.001 && !_fxDrawFilter && APP.vj.brightness === 1.0 && APP.vj.contrast === 1.0 && APP.vj.saturation === 1.0 && APP.vj.hue === 0 && !APP.vj.invert;
    ctx.filter = isIdentityFilter ? 'none' : filterStr;

    let source = null;
    if (APP.render.source) source = APP.render.source;
    else if (APP.guest && APP.guest.isActive && APP.guest.videoElement) source = APP.guest.videoElement;
    else if (APP.state.isLive && APP.camera.stream && APP.camera.videoEl) source = APP.camera.videoEl;
    else if (APP.media.currentElement) source = APP.media.currentElement;

    // --- A/B TRANSITION ENGINE ---
    try {
        var _mediaTx = APP.media._tx;
        if (_mediaTx && _mediaTx.active) {
            var _txNow = performance.now();
            var _txProgRaw = Math.min(1.0, (_txNow - _mediaTx.start) / _mediaTx.dur);
            var _ease = _mediaTx.easing || 'linear';
            var _txProg = _ease === 'ease-in'  ? _txProgRaw * _txProgRaw :
                          _ease === 'ease-out' ? 1 - Math.pow(1 - _txProgRaw, 2) :
                          _txProgRaw; // linear
            var _txCoverRect = function(el) {
                var sw = el.videoWidth || el._effectiveWidth || el.naturalWidth || w;
                var sh = el.videoHeight || el._effectiveHeight || el.naturalHeight || h;
                var ar = sw / sh, car = w / h;
                if (ar > car) return { x: (w - h*ar)/2, y: 0, w: h*ar, h: h };
                return { x: 0, y: (h - w/ar)/2, w: w, h: w/ar };
            };
            var _txElReady = function(el) {
                return el && (el.tagName === 'VIDEO' ? el.readyState >= 2 : (el.complete && el.naturalWidth > 0));
            };
            var _ro = _txElReady(_mediaTx.out) ? _txCoverRect(_mediaTx.out) : null;
            var _ri = _txElReady(_mediaTx.in)  ? _txCoverRect(_mediaTx.in)  : null;
            var _txType = _mediaTx.type || 'optical-fade';

            if (_txType === 'dip-black') {
                // Fade outgoing to black (0→0.5), fade incoming from black (0.5→1)
                if (_txProg < 0.5) {
                    if (_ro) { ctx.globalAlpha = 1 - _txProg * 2; ctx.drawImage(_mediaTx.out, _ro.x, _ro.y, _ro.w, _ro.h); ctx.globalAlpha = 1; }
                } else {
                    if (_ri) { ctx.globalAlpha = (_txProg - 0.5) * 2; ctx.drawImage(_mediaTx.in, _ri.x, _ri.y, _ri.w, _ri.h); ctx.globalAlpha = 1; }
                }
            } else {
                // optical-fade (default) + snap both render as cross-dissolve here
                // (snap never reaches this code because _tx is null for snap)
                if (_ro) { ctx.globalAlpha = 1; ctx.drawImage(_mediaTx.out, _ro.x, _ro.y, _ro.w, _ro.h); }
                if (_ri) {
                    ctx.globalAlpha = _txProg;
                    ctx.drawImage(_mediaTx.in, _ri.x, _ri.y, _ri.w, _ri.h);
                    ctx.globalAlpha = 1;
                }
            }
            if (_txProg >= 1.0) APP.media._tx = null;
            source = null; // skip normal source draw during transition
        }
    } catch(_txErr) {}

    if (source) {
        const ready = source.tagName === 'VIDEO' ? source.readyState >= 2 : (source.complete && source.naturalWidth > 0);
        if (ready) {

            // --- VIEWPORT-FIT: object-fit:cover for canvas ---
            // Fills the canvas completely — crops edges to maintain aspect ratio.
            // No letterbox, no pillarbox. Standard for live VJ performance.
            // _effectiveWidth/_effectiveHeight = EXIF-corrected (mobile photo orientation)
            var srcW = source.videoWidth || source._effectiveWidth || source.naturalWidth || w;
            var srcH = source.videoHeight || source._effectiveHeight || source.naturalHeight || h;
            var srcAR = srcW / srcH;
            var canvasAR = w / h;
            var drawW, drawH, drawX, drawY;
            if (srcAR > canvasAR) {
                // Source is wider than canvas — fit height, crop left/right equally
                drawH = h; drawW = h * srcAR;
                drawX = (w - drawW) / 2; drawY = 0;
            } else {
                // Source is taller than canvas — fit width, crop top/bottom equally
                drawW = w; drawH = w / srcAR;
                drawX = 0; drawY = (h - drawH) / 2;
            }

            if (_voidTiltAngle !== 0) {
                ctx.save();
                ctx.translate(w / 2, h / 2);
                ctx.rotate(_voidTiltAngle);
                ctx.scale(_voidTiltScale, _voidTiltScale);
                ctx.translate(-w / 2, -h / 2);
            }
            if (APP.vj.pixelateEnabled && APP.vj.pixelSize > 1) {
                // OFF-SCREEN BUFFER RENDER
                const size = APP.vj.pixelSize;
                const sw = Math.ceil(drawW / size);
                const sh = Math.ceil(drawH / size);

                if(APP.render.pixelCanvas.width !== sw) { APP.render.pixelCanvas.width = sw; APP.render.pixelCanvas.height = sh; }

                APP.render.pixelCtx.drawImage(source, 0, 0, sw, sh);
                ctx.drawImage(APP.render.pixelCanvas, 0, 0, sw, sh, drawX, drawY, drawW, drawH);
            } else {
                ctx.drawImage(source, drawX, drawY, drawW, drawH);
            }
            if (_voidTiltAngle !== 0) { ctx.restore(); }

            if (APP.vj.maskMode) {
                const pulse = 1 + (APP.audio.bassLevel / 255) * 0.5;
                ctx.globalCompositeOperation = 'destination-in';
                ctx.beginPath(); ctx.arc(w/2, h/2, (h/3) * pulse, 0, Math.PI * 2); ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
            }
        }
    }

    // --- RGB SHIFT (only when reactor/FX active — expensive canvas read-back) ---
    if (_fxActive && APP.vj.rgbEnabled && APP.vj.rgbIntensity > 0) {
        const shift = APP.vj.rgbIntensity;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(APP.render.canvas, shift, 0);
        ctx.drawImage(APP.render.canvas, -shift, 0);
        ctx.restore();
    }

    // ═══ IDENTITY TRINITY — three independent actors burned into canvas ═══
    // Punch/seismic transform MUST be closed here so logos, bug, and lower thirds
    // are always drawn at identity scale — they must never zoom or shift with the beat.
    if (_hasFX) { ctx.filter = 'none'; ctx.restore(); }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    var T = APP.trinity;

    // ACTOR 1: STATION BUG (text or uploaded image)
    // P2P: when a call is active, show the REMOTE peer's identity bug (received via
    // data-channel) on the main canvas — which is showing the remote's video stream.
    // Local identity is shown in the cam-preview-float overlay instead.
    var _bugDrawText = (APP.guest && APP.guest.isActive && APP.bug.p2pText && APP.bug.p2pVisible !== false)
        ? APP.bug.p2pText : APP.bug.text;
    if (T.bug.visible) {
        var bugEl = $('station-bug');
        var bx = T.bug.x * w, by = T.bug.y * h, bScale = T.bug.scale;
        if (bugEl) {
            var bugImg = bugEl.querySelector('img');
            if (bugImg && bugImg.complete && bugImg.naturalWidth > 0) {
                ctx.save();
                var bw = bugImg.naturalWidth * bScale * (w / 1920);
                var bh = bugImg.naturalHeight * bScale * (h / 1080);
                ctx.drawImage(bugImg, bx, by, bw, bh);
                ctx.restore();
            } else if (_bugDrawText) {
                // Canvas is sole renderer for all styles — keep DOM element invisible
                if (!bugEl.classList.contains('hidden')) bugEl.style.opacity = '0';
                ctx.save();
                var bugFS = Math.max(14, 28 * bScale * (h / 1080));
                ctx.font = '800 ' + bugFS + 'px Orbitron, sans-serif';
                ctx.textAlign = 'left'; ctx.textBaseline = 'top';
                var _bc = APP.bug.color || '#ffffff';
                var _bugMode = APP.bug.mode || 'solid';
                // ── RENDER MODE ──────────────────────────────────────────────────
                if (_bugMode === 'knockout') {
                    ctx.strokeStyle = _bc;
                    ctx.lineWidth = Math.max(1, bugFS * 0.06);
                    ctx.shadowColor = _bc; ctx.shadowBlur = 8;
                    var _kp = (Math.sin(timestamp * 0.0018) + 1) / 2;
                    ctx.lineWidth = Math.max(1, bugFS * (0.04 + 0.04 * _kp));
                    ctx.strokeText(_bugDrawText, bx, by);
                } else if (_bugMode === 'inverted') {
                    ctx.globalCompositeOperation = 'difference';
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
                    var _ip = (Math.sin(timestamp * 0.0012) + 1) / 2;
                    ctx.globalAlpha = 0.88 + 0.12 * _ip;
                    ctx.fillText(_bugDrawText, bx, by);
                } else {
                    // SOLID — standard fill with style variants
                    if (APP.bug.style === 'pulse') {
                        var _p = (Math.sin(timestamp * 0.002) + 1) / 2;
                        var _pr = parseInt(_bc.slice(1,3),16), _pg = parseInt(_bc.slice(3,5),16), _pb = parseInt(_bc.slice(5,7),16);
                        ctx.fillStyle = 'rgba('+_pr+','+_pg+','+_pb+','+(0.65+0.35*_p)+')';
                        ctx.shadowColor = _bc; ctx.shadowBlur = 4 + 20 * _p;
                        ctx.fillText(_bugDrawText, bx, by);
                    } else if (APP.bug.style === 'glitch') {
                        var _gt = timestamp % 200;
                        var _gx = _gt < 66 ? -3 : _gt < 133 ? 3 : 0;
                        var _gy = _gt < 100 ? 1 : -1;
                        ctx.globalAlpha = 0.8;
                        ctx.fillStyle = '#ff0055'; ctx.fillText(_bugDrawText, bx + 3, by + _gy);
                        ctx.fillStyle = '#00f3ff'; ctx.fillText(_bugDrawText, bx - 3, by - _gy);
                        ctx.globalAlpha = 1;
                        ctx.fillStyle = _bc; ctx.fillText(_bugDrawText, bx + _gx, by);
                    } else {
                        ctx.fillStyle = _bc;
                        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 4;
                        ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
                        ctx.fillText(_bugDrawText, bx, by);
                    }
                }
                ctx.restore();
            }
        }
    }

   // --- OPTIMIZED ACTOR 2: 2D LOGO (NO THRASHING) ---
if (T.logo.visible) {
    var logoImg = $('user-logo-layer');
    var gifOvEl = $('logo-gif-overlay');

    if (APP.layers.logo2dIsGif) {
        var _lsc2 = T.logo.scale || 1;
        if (gifOvEl && logoImg && logoImg.naturalWidth > 0) {
            // Only calculate layout once to prevent lag
            if (!APP.render._cachedRect) {
                var _cnv = APP.render.canvas;
                APP.render._cachedRect = _cnv ? _cnv.getBoundingClientRect() : null;
            }
            var _cr = APP.render._cachedRect;
            if (_cr) {
                var _sx = _cr.width / w, _sy = _cr.height / h;
                var _lw = logoImg.naturalWidth * _lsc2 * (w / 1920) * _sx;
                var _lh = logoImg.naturalHeight * _lsc2 * (h / 1080) * _sy;

                // Use transform for hardware acceleration
                gifOvEl.style.transform = `translate(${((T.logo.x || 0) * _cr.width)}px, ${((T.logo.y || 0) * _cr.height)}px)`;
                gifOvEl.style.width  = _lw + 'px';
                gifOvEl.style.height = _lh + 'px';
                // DOM overlay kept hidden — canvas drawImage is the sole visual source
            }

            // Draw to canvas for recording
            ctx.save();
            var _clw = logoImg.naturalWidth * _lsc2 * (w / 1920);
            var _clh = logoImg.naturalHeight * _lsc2 * (h / 1080);
            if (APP.layers._gifFrames && APP.layers._gifFrames.length > 0) {
                var _tot = APP.layers._gifTotalDelay || 1000;
                var _el = (performance.now() - APP.layers._gifFrameStart) % _tot;
                var _cum = 0, _fi = 0;
                for (; _fi < APP.layers._gifFrames.length - 1; _fi++) {
                    _cum += APP.layers._gifFrames[_fi].delay;
                    if (_el < _cum) break;
                }
                ctx.drawImage(APP.layers._gifFrames[_fi].canvas, (T.logo.x||0)*w, (T.logo.y||0)*h, _clw, _clh);
            } else {
                ctx.drawImage(logoImg, (T.logo.x || 0) * w, (T.logo.y || 0) * h, _clw, _clh);
            }
            ctx.restore();
        }
    } else {
        if (gifOvEl) gifOvEl.style.display = 'none';
        if (logoImg && logoImg.naturalWidth > 0) {
            ctx.save();
            var lw = logoImg.naturalWidth * (T.logo.scale || 1) * (w / 1920);
            var lh = logoImg.naturalHeight * (T.logo.scale || 1) * (h / 1080);
            ctx.drawImage(logoImg, (T.logo.x || 0) * w, (T.logo.y || 0) * h, lw, lh);
            ctx.restore();
        }
    }
} else {
    var _go = $('logo-gif-overlay');
    if (_go) _go.style.display = 'none';
}

    // ACTOR 3: 3D LOGO (offscreen WebGL canvas → drawImage composite)
    if (T.logo3d && T.logo3d.visible && window._three && window._three.ready && window._three.model) {
        var _t = window._three;
        try {
            _t.model.rotation.y += 0.008;
            _t.model.rotation.x = Math.sin(timestamp * 0.0005) * 0.1;
            _t.camera.lookAt(0, 0, 0);
            _t.renderer.render(_t.scene, _t.camera);
            // Composite the full WebGL canvas onto vj-canvas so captureStream() sees it
            ctx.drawImage(_t.renderer.domElement, 0, 0, w, h);
            // Also draw the scaled/positioned logo overlay on top
            var tc = _t.renderer.domElement;
            if (tc && tc.width > 0 && tc.height > 0) {
                ctx.save();
                var s3d = T.logo3d.scale;
                var tw = 200 * s3d * (w / 1920);
                var th = 200 * s3d * (h / 1080);
                var tx = T.logo3d.x * w, ty = T.logo3d.y * h;
                ctx.drawImage(tc, 0, 0, tc.width, tc.height, tx, ty, tw, th);
                ctx.restore();
            }
        } catch(e3d) {}
    }



    // ══════════════════════════════════════════════════
    // BURN-IN LOWER THIRD — Premium Broadcast Canvas Render
    // Draws directly to captureStream canvas = ALWAYS in recording
    // ══════════════════════════════════════════════════
    if (APP.lowerThird && (APP.lowerThird.visible || APP.lowerThird._hiding)) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';

        // ── Entrance / Exit animation ──────────────────────────────────────
        var _ltEnterDur = 420, _ltExitDur = 420;
        var _ltAge = timestamp - (APP.lowerThird._showTime || timestamp);
        var _ltEnterT = Math.min(1, _ltAge / _ltEnterDur);
        // easeOutQuart
        var _ltEnter = 1 - Math.pow(1 - _ltEnterT, 4);
        var _ltExitT = APP.lowerThird._hiding
            ? Math.min(1, (timestamp - APP.lowerThird._hideStart) / _ltExitDur)
            : 0;
        // easeInQuart
        var _ltExit = _ltExitT * _ltExitT * _ltExitT * _ltExitT;
        var _ltAlpha = _ltEnter * (1 - _ltExit);
        var _ltDX = (1 - _ltEnter) * -28 + _ltExit * 22;
        ctx.globalAlpha = Math.max(0, _ltAlpha);
        ctx.translate(_ltDX, 0);

        // A. Preset accent color per style
        var ltPreset = APP.lowerThird.preset || 'guest';
        var ltAccent = '#00f3ff';
        var ltGlow = 'rgba(0,243,255,';
        if (ltPreset === 'track')   { ltAccent = '#00ff88'; ltGlow = 'rgba(0,255,136,'; }
        else if (ltPreset === 'breaking') { ltAccent = '#ff3333'; ltGlow = 'rgba(255,51,51,'; }
        else if (ltPreset === 'neon')    { ltAccent = '#ff00cc'; ltGlow = 'rgba(255,0,204,'; }
        else if (ltPreset === 'split')   { ltAccent = '#ffaa00'; ltGlow = 'rgba(255,170,0,'; }
        else if (ltPreset === 'glitch')  { ltAccent = '#bf00ff'; ltGlow = 'rgba(191,0,255,'; }
        // User colour override
        if (APP.lowerThird.ltColor) { ltAccent = APP.lowerThird.ltColor; var _lcr=parseInt(ltAccent.slice(1,3),16),_lcg=parseInt(ltAccent.slice(3,5),16),_lcb=parseInt(ltAccent.slice(5,7),16); ltGlow='rgba('+_lcr+','+_lcg+','+_lcb+','; }

        // B. Read text
        var ltTitle = document.getElementById('lt-title-text');
        var ltSub = document.getElementById('lt-subtitle-text');
        var titleText = (ltTitle && ltTitle.textContent && ltTitle.textContent.trim()) ? ltTitle.textContent.trim() : 'LIVE BROADCAST';
        var subText = (ltSub && ltSub.textContent && ltSub.textContent.trim()) ? ltSub.textContent.trim() : '';

        // C. Responsive sizing
        var ltMargin = Math.round(w * 0.025);
        var ltBottom = Math.round(h * 0.065);
        var ltPad = Math.round(h * 0.015);
        var titleFS = Math.max(20, Math.round(h * 0.03));
        var subFS = Math.max(12, Math.round(h * 0.016));
        var accentW = Math.max(4, Math.round(h * 0.004));

        // D. Measure text
        ctx.font = '800 ' + titleFS + 'px Orbitron, sans-serif';
        var titleW = ctx.measureText(titleText).width;
        ctx.font = '500 ' + subFS + 'px "JetBrains Mono", monospace';
        var subW = subText ? ctx.measureText(subText.toUpperCase()).width : 0;
        var contentW = Math.max(titleW, subW);
        var boxW = contentW + ltPad * 4 + accentW;
        var minW = w * 0.25;
        if (boxW < minW) boxW = minW;
        var boxH = ltPad + titleFS + (subText ? 6 + subFS : 0) + ltPad;
        var boxX = ltMargin;
        var boxY = h - ltBottom - boxH;

        // ─── SHIMMER every ~10 seconds ─────────────────────────────
        if (!APP.lowerThird._lastShimmer) APP.lowerThird._lastShimmer = timestamp;
        var shimmerPeriod = 10000;
        var shimmerDur   = 1200;
        if (timestamp - APP.lowerThird._lastShimmer > shimmerPeriod) {
            APP.lowerThird._lastShimmer = timestamp;
        }
        var shimmerT = (timestamp - APP.lowerThird._lastShimmer) / shimmerDur; // 0→1 during anim, >1 idle
        var doShimmer = shimmerT < 1;

        // ─── STYLE: SPLIT ──────────────────────────────────────────
        if (ltPreset === 'split') {
            var splitW = Math.max(w * 0.50, contentW * 2 + ltPad * 8);
            var splitH = ltPad + titleFS + ltPad;
            var splitX = ltMargin;
            var splitY = h - ltBottom - splitH;
            var midX   = splitX + splitW * 0.5;

            // Dark background
            var spBg = ctx.createLinearGradient(splitX, 0, splitX + splitW, 0);
            spBg.addColorStop(0, 'rgba(18,10,0,0.95)');
            spBg.addColorStop(1, 'rgba(12,8,0,0.80)');
            ctx.fillStyle = spBg;
            ctx.fillRect(splitX, splitY, splitW, splitH);

            // Bottom accent line
            ctx.fillStyle = ltAccent;
            ctx.shadowColor = ltAccent; ctx.shadowBlur = 8;
            ctx.fillRect(splitX, splitY + splitH, splitW, 2);
            ctx.shadowBlur = 0;

            // Left stripe
            ctx.fillStyle = ltAccent;
            ctx.fillRect(splitX, splitY, accentW, splitH);

            // Vertical divider
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = ltAccent;
            ctx.fillRect(midX - 1, splitY + ltPad * 0.5, 2, splitH - ltPad);
            ctx.globalAlpha = 1;

            // Title (left half)
            ctx.font = '800 ' + titleFS + 'px Orbitron, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
            ctx.fillText(titleText, splitX + accentW + ltPad, splitY + splitH * 0.5);
            ctx.shadowBlur = 0;

            // Subtitle (right half)
            if (subText) {
                ctx.font = '500 ' + subFS + 'px "JetBrains Mono", monospace';
                ctx.fillStyle = ltAccent;
                ctx.globalAlpha = 0.9;
                ctx.textAlign = 'left';
                ctx.fillText(subText.toUpperCase(), midX + ltPad, splitY + splitH * 0.5);
                ctx.globalAlpha = 1;
                ctx.textAlign = 'left';
            }

            // Shimmer scan over whole bar
            if (doShimmer) {
                var scanPos = splitX + shimmerT * (splitW + 80) - 80;
                var shimGrad = ctx.createLinearGradient(scanPos, 0, scanPos + 80, 0);
                shimGrad.addColorStop(0, 'rgba(255,255,255,0)');
                shimGrad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
                shimGrad.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = shimGrad;
                ctx.fillRect(splitX, splitY, splitW, splitH);
            }

            ctx.restore();
        }
        // ─── STYLE: NEON ───────────────────────────────────────────
        else if (ltPreset === 'neon') {
            var neonPulse = 0.5 + 0.5 * Math.sin(timestamp * 0.003);
            var neonGlowA = 0.35 + neonPulse * 0.25;

            // Dark background with neon tint
            ctx.fillStyle = 'rgba(14,0,14,0.92)';
            ctx.fillRect(boxX, boxY, boxW, boxH);

            // Four-sided neon border
            ctx.strokeStyle = ltAccent;
            ctx.lineWidth = 2;
            ctx.shadowColor = ltAccent;
            ctx.shadowBlur = 12 + neonPulse * 10;
            ctx.strokeRect(boxX + 1, boxY + 1, boxW - 2, boxH - 2);
            ctx.shadowBlur = 0;

            // Inner glow fill
            ctx.globalAlpha = neonGlowA * 0.12;
            ctx.fillStyle = ltAccent;
            ctx.fillRect(boxX + 2, boxY + 2, boxW - 4, boxH - 4);
            ctx.globalAlpha = 1;

            // Title — magenta glow
            ctx.font = '800 ' + titleFS + 'px Orbitron, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.shadowColor = ltAccent;
            ctx.shadowBlur = 8 + neonPulse * 6;
            ctx.fillText(titleText, boxX + ltPad, boxY + ltPad);
            ctx.shadowBlur = 0;

            // Subtitle
            if (subText) {
                ctx.font = '500 ' + subFS + 'px "JetBrains Mono", monospace';
                ctx.fillStyle = ltAccent;
                ctx.globalAlpha = 0.9;
                ctx.fillText(subText.toUpperCase(), boxX + ltPad, boxY + ltPad + titleFS + 6);
                ctx.globalAlpha = 1;
            }

            // Corner accent squares
            var cSz = 6;
            ctx.fillStyle = ltAccent;
            ctx.shadowColor = ltAccent; ctx.shadowBlur = 6;
            [[boxX, boxY], [boxX+boxW-cSz, boxY], [boxX, boxY+boxH-cSz], [boxX+boxW-cSz, boxY+boxH-cSz]].forEach(function(c) {
                ctx.fillRect(c[0], c[1], cSz, cSz);
            });
            ctx.shadowBlur = 0;

            // Shimmer: brief bright flash on the border
            if (doShimmer) {
                ctx.globalAlpha = (1 - shimmerT) * 0.5;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.strokeRect(boxX + 1, boxY + 1, boxW - 2, boxH - 2);
                ctx.globalAlpha = 1;
            }

            ctx.restore();
        }
        // ─── STYLE: GLITCH — rounded pill, electric violet, chromatic aberration ──
        else if (ltPreset === 'glitch') {
            var glRadius = Math.round(boxH * 0.42);
            var gPulse   = 0.5 + 0.5 * Math.sin(timestamp * 0.004);

            // Rounded pill background
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, glRadius);
            ctx.fillStyle = 'rgba(10,0,18,0.93)';
            ctx.fill();

            // Electric border with breathing glow
            ctx.strokeStyle = ltAccent;
            ctx.lineWidth = 2;
            ctx.shadowColor = ltAccent;
            ctx.shadowBlur = 12 + gPulse * 14;
            ctx.beginPath();
            ctx.roundRect(boxX + 1, boxY + 1, boxW - 2, boxH - 2, glRadius - 1);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Inner glow tint
            ctx.beginPath();
            ctx.roundRect(boxX + 2, boxY + 2, boxW - 4, boxH - 4, glRadius - 2);
            ctx.fillStyle = ltGlow + (0.04 + gPulse * 0.05) + ')';
            ctx.fill();

            // Glitch bars — seed changes every 80ms, sparse random triggers
            var glSeed = Math.floor(timestamp / 80);
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, glRadius);
            ctx.clip();
            for (var gi = 0; gi < 4; gi++) {
                var grng = Math.abs(Math.sin(glSeed * 127.3 + gi * 43.7));
                if (grng > 0.62) {
                    var gbarFrac = Math.abs(Math.sin(glSeed * 91.1 + gi * 17.3));
                    var gbarY2   = boxY + gbarFrac * boxH;
                    var gbarH2   = 1.5 + Math.abs(Math.sin(glSeed * 61 + gi)) * 3.5;
                    var gbarOff  = (Math.sin(glSeed * 173 + gi * 31) * 0.5 + 0.5) * boxW * 0.35;
                    ctx.globalAlpha = 0.22 * _ltAlpha;
                    ctx.fillStyle = gi % 2 === 0 ? '#ff0040' : ltAccent;
                    ctx.fillRect(boxX + gbarOff, gbarY2, boxW - gbarOff, gbarH2);
                }
            }
            ctx.globalAlpha = _ltAlpha;
            ctx.restore();

            // Chromatic aberration on title — magnitude reduces once settled
            var glTextX = boxX + glRadius * 0.55 + ltPad;
            var glTextY = boxY + ltPad + (subText ? 0 : (boxH - ltPad * 2 - titleFS) * 0.5);
            var chrMax = Math.max(2, titleFS * 0.055);
            // Extra chroma during entrance, then settles to a persistent subtle split
            var chrOff2 = chrMax * (1 + 2.5 * Math.max(0, 1 - _ltEnterT * 2.5));
            var chrPersist = 1.5 + Math.sin(timestamp * 0.0025) * 0.5; // subtle living offset

            ctx.font = '800 ' + titleFS + 'px Orbitron, sans-serif';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';

            // Red channel — offset right
            ctx.globalAlpha = 0.50 * _ltAlpha;
            ctx.fillStyle = '#ff0040';
            ctx.fillText(titleText, glTextX + chrOff2, glTextY);
            // Cyan channel — offset left
            ctx.fillStyle = '#00f3ff';
            ctx.fillText(titleText, glTextX - chrOff2, glTextY);
            // White base — sharp, with faint violet glow
            ctx.globalAlpha = _ltAlpha;
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = ltAccent; ctx.shadowBlur = 5 + gPulse * 4;
            // Persistent micro chroma even when settled
            ctx.globalAlpha = 0.35 * _ltAlpha;
            ctx.fillStyle = '#ff0040'; ctx.fillText(titleText, glTextX + chrPersist, glTextY);
            ctx.fillStyle = '#00f3ff'; ctx.fillText(titleText, glTextX - chrPersist, glTextY);
            ctx.globalAlpha = _ltAlpha;
            ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 5 + gPulse * 4;
            ctx.fillText(titleText, glTextX, glTextY);
            ctx.shadowBlur = 0;

            // Subtitle — violet, spaced, JetBrains Mono
            if (subText) {
                ctx.font = '500 ' + subFS + 'px "JetBrains Mono", monospace';
                ctx.fillStyle = ltAccent;
                ctx.globalAlpha = 0.82 * _ltAlpha;
                ctx.shadowColor = ltAccent; ctx.shadowBlur = 4 + gPulse * 3;
                ctx.fillText(subText.toUpperCase(), glTextX, glTextY + titleFS + 6);
                ctx.shadowBlur = 0;
                ctx.globalAlpha = _ltAlpha;
            }

            ctx.restore();
        }
        // ─── STYLE: CLASSIC (guest / track / breaking) ─────────────
        else {
            // E. Background — dark glass panel
            var bgGrad = ctx.createLinearGradient(boxX, 0, boxX + boxW, 0);
            bgGrad.addColorStop(0, 'rgba(8,8,12,0.95)');
            bgGrad.addColorStop(0.7, 'rgba(8,8,12,0.85)');
            bgGrad.addColorStop(1, 'rgba(8,8,12,0)');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(boxX, boxY, boxW, boxH);

            // F. Bottom accent line
            ctx.fillStyle = ltAccent;
            ctx.fillRect(boxX, boxY + boxH, boxW * 0.6, 2);
            var tailGrad = ctx.createLinearGradient(boxX + boxW * 0.6, 0, boxX + boxW, 0);
            tailGrad.addColorStop(0, ltAccent);
            tailGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = tailGrad;
            ctx.fillRect(boxX + boxW * 0.6, boxY + boxH, boxW * 0.4, 2);

            // G. Left accent stripe
            ctx.shadowColor = ltAccent;
            ctx.shadowBlur = 16;
            ctx.fillStyle = ltAccent;
            ctx.fillRect(boxX, boxY, accentW, boxH);
            ctx.shadowBlur = 0;

            // H. Top hairline
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(boxX + accentW, boxY, boxW - accentW, 1);

            // I. Title
            ctx.font = '800 ' + titleFS + 'px Orbitron, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
            ctx.fillText(titleText, boxX + accentW + ltPad, boxY + ltPad);
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // J. Subtitle
            if (subText) {
                ctx.font = '500 ' + subFS + 'px "JetBrains Mono", monospace';
                ctx.fillStyle = ltAccent;
                ctx.globalAlpha = 0.9;
                ctx.fillText(subText.toUpperCase(), boxX + accentW + ltPad, boxY + ltPad + titleFS + 6);
                ctx.globalAlpha = 1;
            }

            // K. Live dot (breaking only)
            if (ltPreset === 'breaking') {
                var dotR = Math.max(4, titleFS * 0.18);
                var dotX = boxX + accentW + ltPad + contentW + ltPad;
                var dotY = boxY + ltPad + titleFS * 0.5;
                var pulse = 0.5 + 0.5 * Math.sin(timestamp * 0.005);
                ctx.beginPath();
                ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
                ctx.fillStyle = ltGlow + (0.6 + pulse * 0.4) + ')';
                ctx.fill();
                ctx.shadowColor = ltAccent;
                ctx.shadowBlur = 8 + pulse * 8;
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            // Shimmer: scan line sweeps across the box
            if (doShimmer) {
                var shimX = boxX + shimmerT * (boxW + 60) - 60;
                var shimG = ctx.createLinearGradient(shimX, 0, shimX + 60, 0);
                shimG.addColorStop(0, 'rgba(255,255,255,0)');
                shimG.addColorStop(0.5, 'rgba(255,255,255,0.20)');
                shimG.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = shimG;
                ctx.fillRect(boxX, boxY, boxW, boxH);
            }

            ctx.restore();
        }
    }

    // ═══ STRIP TOGGLE TAB — always visible, collapses/expands both strips ═══
    var _tabH = drawMediaStripToggle(ctx, w, h) || 0;
    // ═══ NFT_VAULT — Gallery at bottom (above toggle tab) ═══
    var _vaultH = drawNFTVault(ctx, w, h, h - _tabH) || 0;
    // ═══ MEDIA_QUEUE — Uploaded files strip (above vault) ═══
    drawMediaQueue(ctx, w, h, h - _tabH - _vaultH);

    // ═══ PERMANENT SIGNATURE — untouchable, not part of Trinity ═══
    ctx.save();
    var sigFS = Math.max(14, h * 0.012);
    ctx.font = '900 ' + sigFS + 'px Orbitron';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = sigFS / 8;
    ctx.fillText('VNGRD', w - (w * 0.01), h - (h * 0.01));
    ctx.restore();

    // --- PARTY MODE: canvas beat flash (captured by captureStream) ---
    // Screen-blend rainbow overlay that pulses proportionally to bassLevel.
    // This is the LED strobe effect — completely canvas-native so it appears in recordings.
    if (APP.vj.uiReactivity) {
        // Sustained beat glow: kicks in at bass 155, maxes at 250 (α 0 → 0.45)
        var _pBass = APP.audio.bassLevel;
        if (_pBass > 155) {
            var _pAlpha = Math.min(0.45, (_pBass - 155) / 95 * 0.45);
            var _pHue   = (timestamp * 0.14) % 360; // slow rainbow cycle
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = _pAlpha;
            ctx.fillStyle = 'hsl(' + _pHue + ', 100%, 68%)';
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }
        // Activation strobe: 8-frame RGB flash fired when party is turned ON
        if (APP.vj._partyFlash > 0) {
            APP.vj._partyFlash--;
            var _pf = APP.vj._partyFlash;
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = (_pf / 8) * 0.75;
            ctx.fillStyle = ['#ff0088','#00ffff','#ffff00','#ff00ff','#00ff88','#ff4400','#00aaff','#aaff00'][_pf % 8];
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }
    }

    // --- CANVAS-NATIVE FX OVERLAYS (geometric primitives, captureStream-visible in all browsers) ---
    // The FX colour-grade (invert, grayscale, hue-rotate etc.) is applied at draw time above via
    // _fxDrawFilter incorporated into filterStr. These overlays add the animated geometry that
    // can't be expressed as a CSS filter: NVG vignette + scan lines, VHS roll, SCAN sweep bar, TEAR bands.
    // Drawn at identity transform (after punch restore) so they sit on top of all content.
    if (!(APP.peer && APP.peer.call)) {
        var _ow = APP.render.canvas.width, _oh = APP.render.canvas.height;
        // NVG: tube vignette + phosphor scanlines + GPNVG-18 tactical reticle
        if (_fxCls.contains('fx-nvg')) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

            // Binocular center (mouse-tracked, double-click to lock)
            if (!window._nvgPos) window._nvgPos = {x: 0.5, y: 0.5, locked: false};
            var _ncx = window._nvgPos.x * _ow, _ncy = window._nvgPos.y * _oh;

            // Tube vignette — use min dimension so circle is always circular
            var _vr = Math.min(_ow, _oh);
            var _nvgV = ctx.createRadialGradient(_ncx, _ncy, _vr*0.42, _ncx, _ncy, _vr*0.58);
            _nvgV.addColorStop(0, 'rgba(0,0,0,0)'); _nvgV.addColorStop(1, 'rgba(0,0,0,0.94)');
            ctx.fillStyle = _nvgV; ctx.fillRect(0, 0, _ow, _oh);

            // CRT phosphor scanlines (cached 1×3 pattern — single fillRect)
            if (!window._nvgScanPat || window._nvgScanPatCtx !== ctx) {
                var _np = document.createElement('canvas'); _np.width = 1; _np.height = 3;
                var _npx = _np.getContext('2d');
                _npx.fillStyle = 'rgba(0,0,0,0.18)';   _npx.fillRect(0, 0, 1, 1);
                _npx.fillStyle = 'rgba(0,30,0,0.08)';  _npx.fillRect(0, 1, 1, 1);
                _npx.fillStyle = 'rgba(0,0,0,0.14)';   _npx.fillRect(0, 2, 1, 1);
                window._nvgScanPat = ctx.createPattern(_np, 'repeat');
                window._nvgScanPatCtx = ctx;
            }
            ctx.globalAlpha = 0.75;
            ctx.fillStyle = window._nvgScanPat;
            ctx.fillRect(0, 0, _ow, _oh);
            ctx.globalAlpha = 1;

            // ── GPNVG-18 tactical reticle ──
            var _cx = _ncx, _cy = _ncy;
            var _rr = Math.min(_ow, _oh) * 0.32;
            var _g = 'rgba(0,255,65,';

            // Outer scope ring
            ctx.beginPath(); ctx.arc(_cx, _cy, _rr, 0, Math.PI * 2);
            ctx.strokeStyle = _g + '0.5)'; ctx.lineWidth = 1; ctx.stroke();

            // Inner boundary ring (dual-tube gap indicator)
            ctx.beginPath(); ctx.arc(_cx, _cy, _rr * 0.84, 0, Math.PI * 2);
            ctx.strokeStyle = _g + '0.2)'; ctx.lineWidth = 0.5; ctx.stroke();

            // Cardinal tick marks (N/E/S/W, pointing inward)
            ctx.strokeStyle = _g + '0.7)'; ctx.lineWidth = 1;
            var _dirs = [[0,-1],[1,0],[0,1],[-1,0]];
            for (var _ti = 0; _ti < 4; _ti++) {
                var _tdx = _dirs[_ti][0], _tdy = _dirs[_ti][1];
                ctx.beginPath();
                ctx.moveTo(_cx + _tdx * _rr, _cy + _tdy * _rr);
                ctx.lineTo(_cx + _tdx * _rr * 0.87, _cy + _tdy * _rr * 0.87);
                ctx.stroke();
            }

            // 45° minor ticks
            ctx.strokeStyle = _g + '0.28)'; ctx.lineWidth = 0.5;
            var _d45 = 0.7071;
            var _diag45 = [[_d45,-_d45],[_d45,_d45],[-_d45,_d45],[-_d45,-_d45]];
            for (var _di = 0; _di < 4; _di++) {
                ctx.beginPath();
                ctx.moveTo(_cx + _diag45[_di][0]*_rr, _cy + _diag45[_di][1]*_rr);
                ctx.lineTo(_cx + _diag45[_di][0]*_rr*0.91, _cy + _diag45[_di][1]*_rr*0.91);
                ctx.stroke();
            }

            // Center crosshair (gapped)
            var _arm = _rr * 0.09, _gap = _rr * 0.025;
            ctx.strokeStyle = _g + '0.65)'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(_cx - _arm, _cy); ctx.lineTo(_cx - _gap, _cy);
            ctx.moveTo(_cx + _gap, _cy); ctx.lineTo(_cx + _arm, _cy);
            ctx.moveTo(_cx, _cy - _arm); ctx.lineTo(_cx, _cy - _gap);
            ctx.moveTo(_cx, _cy + _gap); ctx.lineTo(_cx, _cy + _arm);
            ctx.stroke();

            // IR illuminator bloom at center
            var _bl = ctx.createRadialGradient(_cx, _cy, 0, _cx, _cy, _rr * 0.14);
            _bl.addColorStop(0, 'rgba(0,255,65,0.14)');
            _bl.addColorStop(0.5, 'rgba(0,255,65,0.04)');
            _bl.addColorStop(1, 'rgba(0,255,65,0)');
            ctx.fillStyle = _bl;
            ctx.fillRect(_cx - _rr*0.14, _cy - _rr*0.14, _rr*0.28, _rr*0.28);

            ctx.restore();
        }
        // VHS: real tape sim — full-frame chroma bleed, per-scanline jitter, dropout, head-switch
        if (_fxCls.contains('vhs')) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

            // Snapshot current frame
            if (!window._vhsSnap) window._vhsSnap = document.createElement('canvas');
            if (window._vhsSnap.width !== _ow || window._vhsSnap.height !== _oh) { window._vhsSnap.width = _ow; window._vhsSnap.height = _oh; }
            window._vhsSnap.getContext('2d').drawImage(APP.render.canvas, 0, 0, _ow, _oh);

            // ── Full-frame luma/chroma separation (flat offset) ──
            ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.30;
            ctx.filter = 'sepia(1) saturate(18) hue-rotate(320deg)';
            ctx.drawImage(window._vhsSnap, 3.5, 0, _ow, _oh);  // red right
            ctx.filter = 'sepia(1) saturate(18) hue-rotate(160deg)';
            ctx.drawImage(window._vhsSnap, -3.5, 0, _ow, _oh); // cyan left
            ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

            // ── Per-scanline jitter (~20 random rows per frame, tracking instability) ──
            var _tBkt = Math.floor(timestamp / 55); // ~18 buckets/sec
            var _prng = (_tBkt * 1664525 + 1013904223) >>> 0;
            for (var _ji = 0; _ji < 20; _ji++) {
                _prng = ((_prng * 1664525 + 1013904223) >>> 0);
                var _jy  = (_prng >> 8) % _oh;
                var _jx  = (((_prng & 0xFF) - 128) * 0.18); // ±23px
                ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.45;
                ctx.filter = 'sepia(1) saturate(18) hue-rotate(320deg)';
                ctx.drawImage(window._vhsSnap, _jx + 3.5, 0, _ow, _oh, 0, _jy, _ow, 1);
                ctx.filter = 'sepia(1) saturate(18) hue-rotate(160deg)';
                ctx.drawImage(window._vhsSnap, -_jx - 3.5, 0, _ow, _oh, 0, _jy, _ow, 1);
                ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
            }

            // ── CRT phosphor scanlines (cached pattern, single fillRect) ──
            if (!window._vhsScanPat || window._vhsScanPatCtx !== ctx) {
                var _vp = document.createElement('canvas'); _vp.width = 1; _vp.height = 3;
                var _vpx = _vp.getContext('2d');
                _vpx.fillStyle = 'rgba(255,10,0,0.055)';  _vpx.fillRect(0, 0, 1, 1);
                _vpx.fillStyle = 'rgba(0,255,10,0.045)';  _vpx.fillRect(0, 1, 1, 1);
                _vpx.fillStyle = 'rgba(0,10,255,0.07)';   _vpx.fillRect(0, 2, 1, 1);
                window._vhsScanPat = ctx.createPattern(_vp, 'repeat');
                window._vhsScanPatCtx = ctx;
            }
            ctx.fillStyle = window._vhsScanPat;
            ctx.fillRect(0, 0, _ow, _oh);

            // ── Random dropout flickers (4 white single-row bursts) ──
            for (var _di = 0; _di < 4; _di++) {
                _prng = ((_prng * 1664525 + 1013904223) >>> 0);
                var _dy = (_prng >> 8) % _oh;
                var _da = ((_prng & 0xFF) / 255) * 0.72;
                ctx.fillStyle = 'rgba(255,255,255,' + _da.toFixed(2) + ')';
                ctx.fillRect(0, _dy, _ow, 1);
            }

            // ── Head-switch artifact: bottom 3.5% — heavy jitter + luminance wash ──
            var _hsY = Math.floor(_oh * 0.965);
            for (var _hy = _hsY; _hy < _oh; _hy++) {
                _prng = ((_prng * 1664525 + 1013904223) >>> 0);
                var _hx2 = ((_prng & 0xFF) - 128) * 0.45;
                ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.55;
                ctx.filter = 'sepia(1) saturate(18) hue-rotate(320deg)';
                ctx.drawImage(window._vhsSnap, _hx2 + 3.5, 0, _ow, _oh, 0, _hy, _ow, 1);
                ctx.filter = 'sepia(1) saturate(18) hue-rotate(160deg)';
                ctx.drawImage(window._vhsSnap, -_hx2 - 3.5, 0, _ow, _oh, 0, _hy, _ow, 1);
                ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
            }
            var _hsg = ctx.createLinearGradient(0, _oh * 0.965, 0, _oh);
            _hsg.addColorStop(0, 'rgba(255,255,255,0)');
            _hsg.addColorStop(0.35, 'rgba(200,165,110,0.20)');
            _hsg.addColorStop(1, 'rgba(0,0,0,0.45)');
            ctx.fillStyle = _hsg;
            ctx.fillRect(0, _oh * 0.965, _ow, _oh * 0.035);

            ctx.restore();
        }
        // SCAN / X-RAY: animated cyan laser sweep bar
        if (_fxCls.contains('fx-scan')) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
            var _sx = ((timestamp * 0.00035) % 1) * _ow;
            var _sg = ctx.createLinearGradient(_sx - 50, 0, _sx + 50, 0);
            _sg.addColorStop(0, 'rgba(0,255,255,0)'); _sg.addColorStop(0.5, 'rgba(0,255,255,0.30)'); _sg.addColorStop(1, 'rgba(0,255,255,0)');
            ctx.fillStyle = _sg; ctx.fillRect(0, 0, _ow, _oh);
            ctx.restore();
        }
        // TEAR / Glitch: geometric horizontal slice displacement (baked into canvas pixels)
        if (_fxCls.contains('fx-tear')) {
            // Snapshot current canvas into off-screen buffer
            if (!window._tearSnap || window._tearSnap.width !== _ow || window._tearSnap.height !== _oh) {
                window._tearSnap = document.createElement('canvas');
                window._tearSnap.width = _ow; window._tearSnap.height = _oh;
                window._tearSnapCtx = window._tearSnap.getContext('2d');
            }
            window._tearSnapCtx.drawImage(ctx.canvas, 0, 0);
            // Draw displaced slices from snapshot back onto main canvas
            var _sliceCount = 14;
            var _sliceH = Math.ceil(_oh / _sliceCount);
            var _tPhase = timestamp * 0.0014;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
            for (var _si = 0; _si < _sliceCount; _si++) {
                var _sy = _si * _sliceH;
                var _sAmt = Math.sin(_tPhase + _si * 1.17) * 22;
                // Every ~3rd slice gets a larger glitch jolt
                if ((_si + Math.floor(_tPhase * 0.5)) % 3 === 0) _sAmt *= 2.4;
                if (Math.abs(_sAmt) < 1) continue; // skip slices with negligible offset
                ctx.drawImage(window._tearSnap, 0, _sy, _ow, _sliceH, _sAmt, _sy, _ow, _sliceH);
            }
            ctx.restore();
        }
    }

    // ── SUBTITLE BURN-IN: disabled — pending redesign ──
}

function triggerImpact() { document.body.classList.remove('impact-flash'); void document.body.offsetWidth; document.body.classList.add('impact-flash'); setTimeout(() => document.body.classList.remove('impact-flash'), 200); }
function triggerChromaticAberration() { const c = APP.render.canvas; c.style.filter = 'url(#chromatic-ghost)'; setTimeout(() => { c.style.filter = 'none'; }, 200); }
function impactStutter() { const oT = APP.vj.trailsEnabled, oA = APP.vj.trailAlpha; APP.vj.trailsEnabled = true; APP.vj.trailAlpha = 0.98; triggerChromaticAberration(); setTimeout(() => { APP.vj.trailsEnabled = oT; APP.vj.trailAlpha = oA; }, 500); }
function impactInvert() { APP.vj.invert = true; triggerChromaticAberration(); setTimeout(() => { APP.vj.invert = false; }, 500); }
function impactCrush() { const oRGB = APP.vj.rgbIntensity, oPix = APP.vj.pixelSize, oRE = APP.vj.rgbEnabled, oPE = APP.vj.pixelateEnabled; APP.vj.rgbEnabled = true; APP.vj.pixelateEnabled = true; APP.vj.rgbIntensity = 25; APP.vj.pixelSize = 16; setTimeout(() => { APP.vj.rgbEnabled = oRE; APP.vj.pixelateEnabled = oPE; APP.vj.rgbIntensity = oRGB; APP.vj.pixelSize = oPix; }, 500); }

// SIMPLE DRAGGABLE - DIRECT LEFT/TOP POSITIONING (for non-Trinity DOM elements)
function makeDraggable(el) {
    let isDown = false, iX, iY, cX = 0, cY = 0;
    el.addEventListener('mousedown', e => {
        isDown = true; iX = e.clientX - cX; iY = e.clientY - cY;
        el.style.cursor = 'grabbing'; e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
        if (!isDown) return; e.preventDefault();
        cX = e.clientX - iX; cY = e.clientY - iY;
        el.style.transform = 'translate3d(' + cX + 'px, ' + cY + 'px, 0)';
    });
    document.addEventListener('mouseup', () => { isDown = false; el.style.cursor = 'grab'; });
}
