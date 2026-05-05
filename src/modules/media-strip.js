// ═══════════════════════════════════════════════════════════════
// MEDIA STRIP MODULE — canvas drawing for media toggle, NFT vault, queue
// Extracted from main.js. Depends on: $, APP (globals from main.js)
// Called from renderLoop each frame — loaded before DOMContentLoaded fires.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA STRIP TOGGLE TAB — always-visible collapse handle at canvas bottom
// ═══════════════════════════════════════════════════════════════════════════
function drawMediaStripToggle(ctx, w, h) {
    var hasContent = (APP.media.queue.length > 0 || (APP.user.assets && APP.user.assets.length > 0));
    if (!hasContent) return 0;

    var tabH = Math.max(22, Math.round(h * 0.016));
    var tabW = Math.max(80, Math.round(h * 0.075));
    var tabX = (w - tabW) / 2;
    var tabY = h - tabH;

    // Always store hit zone so click interaction works even during recording
    if (!APP.state.mediaStripToggleZone) APP.state.mediaStripToggleZone = {};
    APP.state.mediaStripToggleZone.x = tabX;
    APP.state.mediaStripToggleZone.y = tabY;
    APP.state.mediaStripToggleZone.w = tabW;
    APP.state.mediaStripToggleZone.h = tabH;

    // During recording: skip drawing the arrow so it doesn't appear in the output
    if (APP.broadcast && APP.broadcast.isRecording) return tabH;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    // Background pill — slightly more opaque
    ctx.fillStyle = 'rgba(4,4,10,0.94)';
    ctx.fillRect(tabX, tabY, tabW, tabH);

    // Top accent line — cyan, fully visible
    ctx.fillStyle = 'rgba(0,243,255,0.7)';
    ctx.fillRect(tabX, tabY, tabW, 2);

    // Glow behind the tab
    ctx.shadowColor = 'rgba(0,243,255,0.55)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(0,243,255,0.0)';
    ctx.fillRect(tabX, tabY, tabW, tabH);
    ctx.shadowBlur = 0;

    // Arrow — bright cyan, larger
    var fs = Math.max(11, Math.round(tabH * 0.62));
    ctx.font = '700 ' + fs + 'px monospace';
    ctx.fillStyle = 'rgba(0,243,255,0.92)';
    ctx.shadowColor = 'rgba(0,243,255,0.8)';
    ctx.shadowBlur = 8;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var arrow = APP.state.showMediaStrips ? '▼' : '▲';
    ctx.fillText(arrow, tabX + tabW / 2, tabY + tabH / 2);
    ctx.shadowBlur = 0;

    ctx.restore();

    return tabH;
}

// ═══════════════════════════════════════════════════════════════════════════
// NFT_VAULT — Horizontal Gallery (burned into canvas bottom)
// ═══════════════════════════════════════════════════════════════════════════
function drawNFTVault(ctx, w, h, bottomY) {
    var assets = APP.user.assets;
    if (!assets || assets.length === 0) return 0;
    if (!APP.state.showMediaStrips) return 0;

    var thumbSize = Math.round(h * 0.08);
    var padding = Math.round(thumbSize * 0.15);
    var barH = thumbSize + padding * 2;
    var barY = (bottomY != null ? bottomY : h) - barH;

    // Gallery bar background — dark glass
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4, 4, 8, 0.85)';
    ctx.fillRect(0, barY, w, barH);

    // Top accent line
    ctx.fillStyle = 'rgba(0, 243, 255, 0.4)';
    ctx.fillRect(0, barY, w, 1);

    // Clear thumbnail hit areas for this frame
    APP.nftVault.thumbnails = [];
    APP.nftVault.durationZones = [];

    // Calculate total gallery width for centering
    var totalW = assets.length * (thumbSize + padding) - padding;
    var startX = Math.max(padding, (w - totalW) / 2);

    for (var i = 0; i < assets.length; i++) {
        var asset = assets[i];
        if (!asset.image || !asset.image.complete || asset.image.naturalWidth === 0) continue;

        var tx = startX + i * (thumbSize + padding);
        var ty = barY + padding;

        // Draw thumbnail with border
        ctx.drawImage(asset.image, tx, ty, thumbSize, thumbSize);

        // Accent border
        var isActive = (APP.media.currentElement === asset.image);
        ctx.strokeStyle = isActive ? '#ff3333' : 'rgba(0, 243, 255, 0.6)';
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.strokeRect(tx, ty, thumbSize, thumbSize);

        // Label
        var labelFS = Math.max(8, Math.round(thumbSize * 0.14));
        ctx.font = '700 ' + labelFS + 'px Orbitron, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        var label = (asset.name || 'NFT').substring(0, 10);
        ctx.fillText(label, tx + thumbSize / 2, ty + thumbSize + 2);

        // Store hit area for click detection
        APP.nftVault.thumbnails.push({
            x: tx, y: ty, w: thumbSize, h: thumbSize,
            index: i
        });

        // Duration badge — images only (videos play their full length)
        if (!asset.isVideo) {
            var dur = asset.duration != null ? asset.duration : 8;
            var badgeFS = Math.max(9, Math.round(thumbSize * 0.13));
            var badgeW = Math.max(22, Math.round(thumbSize * 0.3));
            var badgeH = Math.round(thumbSize * 0.19);
            var badgeX = tx + thumbSize - badgeW - 2;
            var badgeY = ty + 2;
            // Dark pill
            ctx.fillStyle = 'rgba(0,0,0,0.78)';
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
            // Cyan text
            ctx.fillStyle = 'rgba(0,243,255,0.95)';
            ctx.font = '600 ' + badgeFS + 'px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(dur + 's', badgeX + badgeW / 2, badgeY + badgeH / 2);
            // Store hit zone — click cycles duration
            APP.nftVault.durationZones.push({ x: badgeX, y: badgeY, w: badgeW, h: badgeH, index: i });
        }
    }

    ctx.restore();
    return barH;
}

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA_QUEUE STRIP — Uploaded files carousel (violet accent, above vault)
// ═══════════════════════════════════════════════════════════════════════════
function drawMediaQueue(ctx, w, h, bottomY) {
    var queue = APP.media.queue;
    if (!queue || queue.length === 0) return;
    if (!APP.state.showMediaStrips) return;

    var thumbSize = Math.round(h * 0.065);
    var padding   = Math.round(thumbSize * 0.15);
    var barH      = thumbSize + padding * 2;

    // ── Animated expansion (spring toward target) ──
    var _TARGET_H  = 58;
    var _targetExp = (APP.media._activeSeam >= 0) ? _TARGET_H : 0;
    APP.media._seamExpandH += (_targetExp - APP.media._seamExpandH) * 0.2;
    if (Math.abs(APP.media._seamExpandH - _targetExp) < 0.4) APP.media._seamExpandH = _targetExp;
    var _eH = Math.round(APP.media._seamExpandH); // current expansion px

    // Thumbnail bar sits above the expansion track
    var barY  = bottomY - barH - _eH;
    var thumbY = barY + padding; // top of thumbnails

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    // ── Bar background (thumbnails region) ──
    ctx.fillStyle = 'rgba(4,4,8,0.82)';
    ctx.fillRect(0, barY, w, barH);
    ctx.fillStyle = 'rgba(160,80,255,0.45)';
    ctx.fillRect(0, barY, w, 1); // top accent

    // ── Expansion track background ──
    if (_eH > 0) {
        var _tY = barY + barH; // top of expansion track
        ctx.fillStyle = 'rgba(3,3,14,0.97)';
        ctx.fillRect(0, _tY, w, _eH);
        // Top border of expansion track
        ctx.fillStyle = 'rgba(130,55,255,0.35)';
        ctx.fillRect(0, _tY, w, 1);
        // Violet left rail (NLE track marker)
        ctx.fillStyle = 'rgba(140,60,255,0.7)';
        ctx.fillRect(0, _tY, 3, _eH);
    }

    // Init hit areas
    if (!APP.media.queueStrip) APP.media.queueStrip = {};
    APP.media.queueStrip.thumbnails = [];
    APP.media.queueStrip.seams      = [];
    APP.media.queueStrip.ctrlZones  = [];
    APP.media.queueStrip.audioSyncZone = null;
    APP.media.queueStrip.barZone = { x: 0, y: barY, w: w, h: barH };

    var totalW = queue.length * (thumbSize + padding) - padding;
    var startX = Math.max(padding, (w - totalW) / 2);

    for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        var el   = item.element;
        if (!el) continue;
        var isVid = el.tagName === 'VIDEO';
        if (el.tagName === 'IMG' && (!el.complete || el.naturalWidth === 0)) continue;
        if (isVid && el.readyState < 2) continue;

        var tx = startX + i * (thumbSize + padding);
        var ty = thumbY;

        try { ctx.drawImage(el, tx, ty, thumbSize, thumbSize); } catch(e) { continue; }

        // Border
        var isActive = (APP.media.currentIndex === i);
        ctx.strokeStyle = isActive ? '#ff3333' : 'rgba(160,80,255,0.6)';
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.strokeRect(tx, ty, thumbSize, thumbSize);

        // Name label (below thumb)
        var labelFS = Math.max(7, Math.round(thumbSize * 0.13));
        ctx.font = '600 ' + labelFS + 'px "Orbitron", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText((item.name || 'FILE').substring(0, 10), tx + thumbSize / 2, ty + thumbSize + 2);

        // Duration label — bottom-left corner of thumbnail (clean, no badge)
        if (!isVid) {
            var durTxt = item.duration === null ? '\u221e' : (item.duration || 8) + 's';
            var durFS  = Math.max(7, Math.round(thumbSize * 0.135));
            ctx.font = '700 ' + durFS + 'px monospace';
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle    = 'rgba(160,80,255,0.82)';
            ctx.fillText(durTxt, tx + 3, ty + thumbSize - 2);
        }

        // Beat-sync micro-dot (bottom-right, gold, only when active)
        if (item.beatSync) {
            var _bsR = Math.max(3, Math.round(thumbSize * 0.07));
            ctx.beginPath();
            ctx.arc(tx + thumbSize - _bsR - 2, ty + thumbSize - _bsR - 2, _bsR, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,200,0,0.82)';
            ctx.fill();
        }

        // Thumbnail hit zone
        APP.media.queueStrip.thumbnails.push({ x: tx, y: ty, w: thumbSize, h: thumbSize, index: i });

        // ── Seam between this clip and next ──
        if (i < queue.length - 1) {
            var _scx      = tx + thumbSize + Math.round(padding / 2);
            var _sIdx     = APP.media.queueStrip.seams.length;
            var _sHovered = (APP.media._hoveredSeam === _sIdx);
            var _sActive  = (APP.media._activeSeam  === _sIdx);

            ctx.save();
            if (_sActive) {
                ctx.strokeStyle = 'rgba(200,140,255,1.0)';
                ctx.lineWidth   = 2;
                ctx.shadowColor = 'rgba(180,100,255,0.9)';
                ctx.shadowBlur  = 10;
            } else if (_sHovered) {
                ctx.strokeStyle = 'rgba(180,110,255,0.9)';
                ctx.lineWidth   = 2;
                ctx.shadowColor = 'rgba(160,80,255,0.7)';
                ctx.shadowBlur  = 6;
            } else {
                ctx.strokeStyle = 'rgba(120,50,220,0.25)';
                ctx.lineWidth   = 1;
            }
            ctx.beginPath();
            ctx.moveTo(_scx, barY + 4);
            ctx.lineTo(_scx, barY + barH - 4);
            ctx.stroke();

            // Active seam: small downward-pointing node marker at bottom of seam line
            if (_sActive && _eH > 2) {
                ctx.fillStyle = 'rgba(200,140,255,1.0)';
                ctx.beginPath();
                ctx.moveTo(_scx,     barY + barH - 4);
                ctx.lineTo(_scx - 5, barY + barH + 4);
                ctx.lineTo(_scx + 5, barY + barH + 4);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();

            var _sHitW = Math.max(10, padding);
            APP.media.queueStrip.seams.push({
                cx: _scx, barY: barY,
                hitX: tx + thumbSize, hitY: barY,
                hitW: _sHitW, hitH: barH,
                fromIndex: i, toIndex: i + 1
            });
        }
    }

    // ── AUDIO_SYNC pill — right edge of thumbnail bar ──
    var asPW = Math.max(46, Math.round(thumbSize * 0.62));
    var asPH = Math.round(thumbSize * 0.27);
    var asPX = w - asPW - Math.round(padding * 1.5);
    var asPY = barY + Math.round((barH - asPH) / 2);
    var asOn = !!APP.media.audioSync;
    ctx.fillStyle   = asOn ? 'rgba(255,180,0,0.9)'  : 'rgba(28,28,40,0.85)';
    ctx.strokeStyle = asOn ? 'rgba(255,220,0,0.85)' : 'rgba(120,80,200,0.5)';
    ctx.lineWidth   = 1;
    var _aR = Math.round(asPH / 2);
    ctx.beginPath();
    ctx.moveTo(asPX + _aR, asPY);
    ctx.lineTo(asPX + asPW - _aR, asPY);
    ctx.arcTo(asPX + asPW, asPY, asPX + asPW, asPY + asPH, _aR);
    ctx.lineTo(asPX + asPW, asPY + asPH - _aR);
    ctx.arcTo(asPX + asPW, asPY + asPH, asPX + asPW - _aR, asPY + asPH, _aR);
    ctx.lineTo(asPX + _aR, asPY + asPH);
    ctx.arcTo(asPX, asPY + asPH, asPX, asPY + asPH - _aR, _aR);
    ctx.lineTo(asPX, asPY + _aR);
    ctx.arcTo(asPX, asPY, asPX + _aR, asPY, _aR);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    var aPFS = Math.max(7, Math.round(asPH * 0.54));
    ctx.fillStyle    = asOn ? '#000' : 'rgba(180,140,255,0.85)';
    ctx.font         = '700 ' + aPFS + 'px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u266b SYNC', asPX + asPW / 2, asPY + asPH / 2);
    APP.media.queueStrip.audioSyncZone = { x: asPX, y: asPY, w: asPW, h: asPH };

    // ── EXPANSION TRACK CONTROLS ──
    if (_eH >= 8 && APP.media._activeSeam >= 0) {
        var _seam = APP.media.queueStrip.seams[APP.media._activeSeam];
        var _toItem = _seam ? APP.media.queue[_seam.toIndex] : null;
        if (_toItem) {
            var _tY   = barY + barH; // top of expansion track
            var _fade = Math.min(1, (_eH - 8) / 18);
            ctx.globalAlpha = _fade;

            var _lpad = 18, _rpad = 18 + asPW + 10;
            var _midY = _tY + _eH / 2;
            var _fs9  = Math.max(9,  Math.round(h * 0.0085));  // main control font
            var _fs8  = Math.max(8,  Math.round(_fs9 * 0.88)); // label font

            // ── SEAM label ──
            ctx.font = '600 ' + _fs8 + 'px monospace';
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(160,100,255,0.72)';
            ctx.fillText('S' + APP.media._activeSeam, _lpad + 3, _midY);
            var _seamLblW = ctx.measureText('S' + APP.media._activeSeam).width;

            // section divider helper
            var _div = function(x) {
                ctx.save();
                ctx.strokeStyle = 'rgba(130,55,255,0.22)';
                ctx.lineWidth   = 1;
                ctx.beginPath(); ctx.moveTo(x, _tY + 10); ctx.lineTo(x, _tY + _eH - 10); ctx.stroke();
                ctx.restore();
            };

            // ── TYPE section ──
            var _types = [
                { id: 'optical-fade', label: 'FADE'    },
                { id: 'glitch',       label: 'GLITCH'  },
                { id: 'dip-black',    label: 'DIP BLK' },
                { id: 'snap',         label: 'SNAP'    }
            ];
            var _typeW = 70, _typeGap = 14;
            var _typeSectW = _types.length * _typeW + (_types.length - 1) * _typeGap;
            var _typeX0 = _lpad + _seamLblW + 18;

            _div(_typeX0 - 9);

            for (var _ti = 0; _ti < _types.length; _ti++) {
                var _t      = _types[_ti];
                var _tX     = _typeX0 + _ti * (_typeW + _typeGap);
                var _tActive = (_toItem.transitionType === _t.id);
                ctx.font         = '700 ' + _fs9 + 'px monospace';
                ctx.textAlign    = 'left';
                ctx.textBaseline = 'middle';
                // Active: bright white with a subtle bg; inactive: dim violet
                if (_tActive) {
                    var _tlW = ctx.measureText(_t.label).width;
                    ctx.fillStyle = 'rgba(160,80,255,0.18)';
                    ctx.fillRect(_tX - 4, _midY - _fs9 * 0.72, _tlW + 8, _fs9 * 1.44);
                    ctx.fillStyle = 'rgba(230,200,255,1.0)';
                } else {
                    ctx.fillStyle = 'rgba(185,155,220,0.5)';
                }
                ctx.fillText(_t.label, _tX, _midY);
                APP.media.queueStrip.ctrlZones.push({
                    type: 'tx-type', value: _t.id,
                    x: _tX - 4, y: _tY, w: _typeW, h: _eH
                });
            }

            _div(_typeX0 + _typeSectW + 9);

            // ── DURATION scrubber (center) ──
            var _durLblX = _typeX0 + _typeSectW + 18;
            var _durMin = 0.1, _durMax = 3.0;
            var _durVal = _toItem.transitionDuration != null ? _toItem.transitionDuration : 0.8;
            var _durPct = (_durVal - _durMin) / (_durMax - _durMin);

            // ── DUR label ──
            ctx.font         = '600 ' + _fs8 + 'px monospace';
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle    = 'rgba(160,100,255,0.72)';
            ctx.fillText('DUR', _durLblX, _midY);
            var _durLblW2 = ctx.measureText('DUR').width;

            // Scrubber
            var _scrX = _durLblX + _durLblW2 + 9;
            var _scrW = Math.round(w * 0.17);
            var _scrY = _midY;
            ctx.fillStyle = 'rgba(60,35,100,0.8)';
            ctx.fillRect(_scrX, _scrY - 1, _scrW, 2);
            ctx.fillStyle = 'rgba(150,80,255,0.75)';
            ctx.fillRect(_scrX, _scrY - 1, Math.round(_durPct * _scrW), 2);
            var _hX = _scrX + Math.round(_durPct * _scrW);
            ctx.beginPath(); ctx.arc(_hX, _scrY, 5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(200,145,255,0.97)';
            ctx.shadowColor = 'rgba(160,80,255,0.6)'; ctx.shadowBlur = 7;
            ctx.fill(); ctx.shadowBlur = 0;

            // Value label
            var _durValStr = _durVal.toFixed(1) + 's';
            ctx.font         = '700 ' + _fs9 + 'px monospace';
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle    = 'rgba(210,185,255,0.85)';
            ctx.fillText(_durValStr, _scrX + _scrW + 9, _midY);

            APP.media.queueStrip.ctrlZones.push({
                type: 'dur-track', min: _durMin, max: _durMax,
                x: _scrX - 4, y: _tY, w: _scrW + 8, h: _eH
            });

            // ── EASING selector ──
            var _easeX0 = _scrX + _scrW + 9 + ctx.measureText(_durValStr).width + 18;
            _div(_easeX0 - 9);
            var _easings = [
                { id: 'linear',   label: 'LINEAR'   },
                { id: 'ease-in',  label: 'EASE IN'  },
                { id: 'ease-out', label: 'EASE OUT' }
            ];
            for (var _ei = 0; _ei < _easings.length; _ei++) {
                var _ea     = _easings[_ei];
                var _eX     = _easeX0 + _ei * 72;
                var _eActive = (_toItem.easing === _ea.id);
                ctx.font         = '700 ' + _fs9 + 'px monospace';
                ctx.textAlign    = 'left';
                ctx.textBaseline = 'middle';
                if (_eActive) {
                    var _eW2 = ctx.measureText(_ea.label).width;
                    ctx.fillStyle = 'rgba(160,80,255,0.18)';
                    ctx.fillRect(_eX - 4, _midY - _fs9 * 0.72, _eW2 + 8, _fs9 * 1.44);
                    ctx.fillStyle = 'rgba(230,200,255,1.0)';
                } else {
                    ctx.fillStyle = 'rgba(185,155,220,0.5)';
                }
                ctx.fillText(_ea.label, _eX, _midY);
                APP.media.queueStrip.ctrlZones.push({
                    type: 'easing', value: _ea.id,
                    x: _eX - 4, y: _tY, w: 70, h: _eH
                });
            }

            // ── Glitch effect during open/close animation ──
            var _glitchAge = performance.now() - (APP.media._seamGlitchT || 0);
            if (_glitchAge < 320 && APP.media._seamGlitchT > 0) {
                var _gi2 = Math.max(0, 1 - _glitchAge / 320);
                ctx.save();
                ctx.globalAlpha = _gi2 * 0.85;
                for (var _gk = 0; _gk < 5; _gk++) {
                    if (Math.random() > _gi2 * 0.8) continue;
                    var _gy2 = _tY + Math.random() * _eH;
                    var _gw2 = w * (0.2 + Math.random() * 0.6);
                    var _gx2 = Math.random() * (w - _gw2);
                    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.7)' : 'rgba(140,60,255,0.3)';
                    ctx.fillRect(_gx2, _gy2, _gw2, 1 + Math.random() * 2);
                }
                // Bright violet sweep line
                if (Math.random() < _gi2 * 0.5) {
                    ctx.fillStyle = 'rgba(160,80,255,0.4)';
                    ctx.fillRect(0, _tY + Math.random() * _eH, w * (0.5 + Math.random() * 0.5), 1);
                }
                ctx.restore();
            }

            ctx.globalAlpha = 1;
        }
    }

    ctx.restore();
}

