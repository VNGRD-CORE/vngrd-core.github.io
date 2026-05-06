// ═══════════════════════════════════════════════════════════════
// SUMMONER MODULE — NFT vault click, seam controls, media queue nav
// Extracted from main.js. Depends on: $, APP, log, triggerImpact,
// triggerChromaticAberration, updateQueueDisplay (globals)
// ═══════════════════════════════════════════════════════════════

var _durSteps = [null, 4, 8, 16, 30, 60];

// ═══════════════════════════════════════════════════════════════════════════
// SUMMONER LOGIC — NFT click triggers source swap + System Summoning glitch
// ═══════════════════════════════════════════════════════════════════════════
function initSummonerLogic() {
    // Canvas has pointer-events:none so clicks pass through to UI.
    // Listen on #stage (the canvas parent) which DOES receive clicks,
    // then translate clientX/Y to canvas pixel coordinates.
    var stage = $('stage');
    var canvas = APP.render.canvas;
    if (!stage || !canvas) return;

    stage.addEventListener('click', function(e) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = APP.render.width / rect.width;
        var scaleY = APP.render.height / rect.height;
        var cx = (e.clientX - rect.left) * scaleX;
        var cy = (e.clientY - rect.top) * scaleY;

        // ── TOGGLE TAB — collapse / expand both strips ──
        var tz = APP.state.mediaStripToggleZone;
        if (tz && cx >= tz.x && cx <= tz.x + tz.w && cy >= tz.y && cy <= tz.y + tz.h) {
            APP.state.showMediaStrips = !APP.state.showMediaStrips;
            return;
        }

        // ── AUDIO SYNC PILL ──
        var asZone = APP.media.queueStrip && APP.media.queueStrip.audioSyncZone;
        if (asZone && cx >= asZone.x && cx <= asZone.x + asZone.w && cy >= asZone.y && cy <= asZone.y + asZone.h) {
            APP.media.audioSync = !APP.media.audioSync;
            return;
        }

        // ── MEDIA QUEUE STRIP — thumbnail click (navigate to item) ──
        var mqTh = (APP.media.queueStrip && APP.media.queueStrip.thumbnails) || [];
        for (var mt = 0; mt < mqTh.length; mt++) {
            var mthumb = mqTh[mt];
            if (cx >= mthumb.x && cx <= mthumb.x + mthumb.w && cy >= mthumb.y && cy <= mthumb.y + mthumb.h) {
                var qi = APP.media.queue[mthumb.index];
                if (qi) {
                    if (APP.media.currentElement && APP.media.currentElement.tagName === 'VIDEO') APP.media.currentElement.pause();
                    APP.media.currentIndex = mthumb.index;
                    APP.media.currentElement = qi.element;
                    if (qi.element && qi.element.tagName === 'VIDEO') {
                        qi.element.currentTime = 0;
                        qi.element.play().catch(function(){});
                    }
                }
                return;
            }
        }

        // ── CAROUSEL BAR — tap anywhere on bar (outside thumbnails) to collapse ──
        var barZ = APP.media.queueStrip && APP.media.queueStrip.barZone;
        if (barZ && APP.state.showMediaStrips && cy >= barZ.y && cy <= barZ.y + barZ.h) {
            APP.state.showMediaStrips = false;
            return;
        }

        // ── NFT VAULT STRIP — duration badge (cyan, bottom) ──
        if (APP.user.assets && APP.user.assets.length > 0) {
            var dz = APP.nftVault.durationZones || [];
            for (var d = 0; d < dz.length; d++) {
                var zone = dz[d];
                if (cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h) {
                    var asset = APP.user.assets[zone.index];
                    if (asset && !asset.isVideo) {
                        var cur = _durSteps.indexOf(asset.duration);
                        asset.duration = _durSteps[(cur + 1) % _durSteps.length];
                        for (var q = 0; q < APP.media.queue.length; q++) {
                            if (APP.media.queue[q].element === asset.image) {
                                APP.media.queue[q].duration = asset.duration;
                            }
                        }
                    }
                    return;
                }
            }

            // ── NFT VAULT STRIP — thumbnail click (summon) ──
            for (var i = 0; i < APP.nftVault.thumbnails.length; i++) {
                var t = APP.nftVault.thumbnails[i];
                if (cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h) {
                    summonNFTByIndex(t.index);
                    return;
                }
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// SEAM CONTROLS — NLE-style floating panel on hover/click between clips
// ═══════════════════════════════════════════════════════════════════════════
function initSeamControls() {
    var stage  = $('stage');
    var canvas = APP.render.canvas;
    if (!stage || !canvas) return;

    function _cc(e) { // canvas coords
        var r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (APP.render.width / r.width),
                 y: (e.clientY - r.top)  * (APP.render.height / r.height) };
    }

    function _hitSeam(cx, cy) {
        var seams = (APP.media.queueStrip && APP.media.queueStrip.seams) || [];
        for (var i = 0; i < seams.length; i++) {
            var s = seams[i];
            if (cx >= s.hitX && cx <= s.hitX + s.hitW && cy >= s.hitY && cy <= s.hitY + s.hitH) return i;
        }
        return -1;
    }

    function _hitCtrl(cx, cy) {
        var zones = (APP.media.queueStrip && APP.media.queueStrip.ctrlZones) || [];
        for (var i = 0; i < zones.length; i++) {
            var z = zones[i];
            if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
        }
        return null;
    }

    function _openSeam(idx) {
        APP.media._activeSeam  = idx;
        APP.media._seamOpen    = true;
        APP.media._seamGlitchT = performance.now();
    }

    function _closeSeam() {
        APP.media._activeSeam  = -1;
        APP.media._seamOpen    = false;
        APP.media._seamGlitchT = performance.now();
    }

    function _applyDur(cx) {
        var zones = (APP.media.queueStrip && APP.media.queueStrip.ctrlZones) || [];
        var dz    = APP.media._durDragZone;
        if (!dz) return;
        var seams = APP.media.queueStrip && APP.media.queueStrip.seams;
        if (!seams || APP.media._activeSeam < 0) return;
        var toItem = APP.media.queue[seams[APP.media._activeSeam].toIndex];
        if (!toItem) return;
        var pct = Math.max(0, Math.min(1, (cx - dz.x) / dz.w));
        toItem.transitionDuration = Math.round((dz.min + pct * (dz.max - dz.min)) * 10) / 10;
    }

    // ── mousemove: hover + drag + NVG binocular tracking ──
    stage.addEventListener('mousemove', function(e) {
        var c   = _cc(e);
        var idx = _hitSeam(c.x, c.y);
        APP.media._hoveredSeam = idx;

        // Update cursor
        var onCtrl = APP.media._activeSeam >= 0 && _hitCtrl(c.x, c.y);
        if (idx >= 0) {
            canvas.style.cursor = 'col-resize';
        } else if (onCtrl && onCtrl.type === 'dur-track') {
            canvas.style.cursor = 'ew-resize';
        } else if (onCtrl) {
            canvas.style.cursor = 'pointer';
        } else {
            canvas.style.cursor = '';
        }

        // Drag duration
        if (APP.media._durDragging) _applyDur(c.x);

        // NVG binocular tracking
        if (!window._nvgPos) window._nvgPos = {x: 0.5, y: 0.5, locked: false};
        if (!window._nvgPos.locked && document.body.classList.contains('fx-nvg')) {
            var sr = stage.getBoundingClientRect();
            window._nvgPos.x = (e.clientX - sr.left) / sr.width;
            window._nvgPos.y = (e.clientY - sr.top)  / sr.height;
        }
    });

    stage.addEventListener('mouseleave', function() {
        APP.media._hoveredSeam = -1;
        if (!APP.media._durDragging) canvas.style.cursor = '';
    });

    // ── dblclick: lock / unlock NVG binocular position ──
    stage.addEventListener('dblclick', function() {
        if (!document.body.classList.contains('fx-nvg')) return;
        if (!window._nvgPos) window._nvgPos = {x: 0.5, y: 0.5, locked: false};
        window._nvgPos.locked = !window._nvgPos.locked;
        typeof ghostLog === 'function' && ghostLog('NVG SCOPE ' + (window._nvgPos.locked ? 'LOCKED' : 'TRACKING'), 'sys');
    });

    // ── mousedown: start duration drag ──
    stage.addEventListener('mousedown', function(e) {
        if (APP.media._activeSeam < 0) return;
        var c  = _cc(e);
        var hz = _hitCtrl(c.x, c.y);
        if (hz && hz.type === 'dur-track') {
            APP.media._durDragging = true;
            APP.media._durDragZone = hz;
            _applyDur(c.x);
            e.preventDefault();
        }
    });

    document.addEventListener('mouseup', function() {
        APP.media._durDragging = false;
        APP.media._durDragZone = null;
    });

    // ── click: seam toggle + ctrl zone dispatch ──
    stage.addEventListener('click', function(e) {
        var c   = _cc(e);
        var sIdx = _hitSeam(c.x, c.y);
        if (sIdx >= 0) {
            if (APP.media._activeSeam === sIdx) _closeSeam();
            else _openSeam(sIdx);
            return;
        }
        // Control zones (only when expansion is visible)
        if (APP.media._activeSeam >= 0 && APP.media._seamExpandH > 20) {
            var hz = _hitCtrl(c.x, c.y);
            if (hz) {
                var seams  = APP.media.queueStrip && APP.media.queueStrip.seams;
                var toItem = seams ? APP.media.queue[seams[APP.media._activeSeam].toIndex] : null;
                if (toItem) {
                    if (hz.type === 'tx-type') { toItem.transitionType = hz.value; return; }
                    if (hz.type === 'easing')  { toItem.easing = hz.value; return; }
                    if (hz.type === 'dur-track') { _applyDur(c.x); return; }
                }
                return;
            }
        }
        // Click outside track area: close
        var qs = APP.media.queueStrip;
        var inBar = qs && qs.seams && qs.seams.length > 0 && qs.seams[0] &&
                    c.y >= qs.seams[0].hitY && c.y <= qs.seams[0].hitY + qs.seams[0].hitH + APP.media._seamExpandH;
        if (!inBar) _closeSeam();
    });
}

// Shared summoner — injects NFT into media queue (eject/cycle compatible)
function summonNFTByIndex(index) {
    var asset = APP.user.assets[index];
    if (!asset || !asset.image) return;

    // Clear any lingering render.source override so media queue takes priority
    APP.render.source = null;

    // Check if this NFT is already in the queue — if so, just switch to it
    for (var q = 0; q < APP.media.queue.length; q++) {
        if (APP.media.queue[q].element === asset.image) {
            if (APP.media.currentElement?.tagName === 'VIDEO') APP.media.currentElement.pause();

            APP.media.currentIndex = q;
            APP.media.currentElement = asset.image;

            // --- THE AUDIO & PLAYBACK INJECTION ---
            if (asset.isVideo && asset.image.tagName === 'VIDEO') {
                var vid = asset.image;

                // User interacted, so we can safely unmute and play!
                vid.muted = false;
                vid.currentTime = 0;
                vid.play().catch(e => console.warn('NFT Autoplay blocked:', e));

                // Plug into the Workstation Mixer
                if (!vid.audioRouted && APP.audio && APP.audio.ctx) {
                    try {
                        if (APP.audio.ctx.state === 'suspended') APP.audio.ctx.resume();
                        var trackSource = APP.audio.ctx.createMediaElementSource(vid);
                        var destination = APP.audio.masterGain || APP.audio.ctx.destination;
                        trackSource.connect(destination);
                        vid.audioRouted = true;
                        console.log('NFT_AUDIO: ROUTED TO MASTER MIX');
                    } catch (e) {
                        console.warn('NFT_AUDIO: ROUTING FAILED', e);
                    }
                }
            }
            // --------------------------------------

            log('SUMMONER: ' + (asset.name || 'NFT_' + index) + ' FOCUSED');
            _summonGlitch();
            return;
        }
    }

    // ... (The rest of your code that adds a NEW NFT to the queue goes here) ...

    // Inject into media queue as a new item
    var item = { type: 'image', url: asset.imageUrl || '', element: asset.image, name: 'NFT_' + (asset.name || index), duration: asset.duration != null ? asset.duration : 8 };
    // Append to gif-host at natural size (off-screen) for GIF animation
    var host = $('gif-host');
    if (host && !asset.image.parentNode) host.appendChild(asset.image);

    APP.media.queue.push(item);
    if (APP.media.currentElement?.tagName === 'VIDEO') APP.media.currentElement.pause();
    APP.media.currentIndex = APP.media.queue.length - 1;
    APP.media.currentElement = asset.image;
    updateQueueDisplay();
    if ($('media-dot')) $('media-dot').classList.remove('off');

    log('SUMMONER: ' + (asset.name || 'NFT_' + index) + ' → MEDIA_DECK');
    _summonGlitch();
}

function _summonGlitch() {
    var prevGlitch = APP.vj.glitchSnap;
    var prevRGB = APP.vj.rgbIntensity;
    var prevRGBEnabled = APP.vj.rgbEnabled;
    APP.vj.glitchSnap = 5;
    APP.vj.rgbIntensity = 30;
    APP.vj.rgbEnabled = true;
    triggerChromaticAberration();
    triggerImpact();
    setTimeout(function() {
        APP.vj.glitchSnap = prevGlitch;
        APP.vj.rgbIntensity = prevRGB;
        APP.vj.rgbEnabled = prevRGBEnabled;
    }, 500);
}
