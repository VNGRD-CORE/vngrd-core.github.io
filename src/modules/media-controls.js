// ═══════════════════════════════════════════════════════════════
// MEDIA CONTROLS MODULE — video/audio wiring, rotation, queue management
// Extracted from main.js. Depends on: $, APP, log, ensureAudioChain,
// triggerChromaticAberration, triggerImpact (globals from main.js)
// ═══════════════════════════════════════════════════════════════

function connectVideoAudio(vid) {
    if (!vid || vid.tagName !== 'VIDEO') return;
    try {
        if (!APP.audio.ctx) APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (APP.audio.ctx.state === 'suspended') APP.audio.ctx.resume();
        ensureAudioChain();
        disconnectVideoAudio();
        if (!vid._audioSrc) vid._audioSrc = APP.audio.ctx.createMediaElementSource(vid);
        // Ensure videoGain exists — may be null if setupAudioChain() rebuilt nodes
        if (!APP.audio.videoGain) {
            APP.audio.videoGain = APP.audio.ctx.createGain();
            APP.audio.videoGain.gain.value = APP.audio.videoMuted ? 0 : 1;
            if (APP.audio.panner) APP.audio.videoGain.connect(APP.audio.panner);
            if (APP.audio.dolbyPanner) APP.audio.videoGain.connect(APP.audio.dolbyPanner);
        }
        // vid.muted must be FALSE — Chrome silences MediaElementAudioSourceNode when muted=true
        // Volume is controlled exclusively via videoGain (0=muted, 1=on), not via .muted
        vid.muted = false;
        vid._audioSrc.connect(APP.audio.videoGain);
        // Apply current mute state via gain (0 = muted, 1 = audible)
        APP.audio.videoGain.gain.setValueAtTime(APP.audio.videoMuted ? 0 : 1, APP.audio.ctx.currentTime);
        APP.audio.videoSource = vid;
        const muteBtn = $('btn-mute-vid');
        if (muteBtn) {
            muteBtn.textContent = APP.audio.videoMuted ? '\u{1F507}' : '\u{1F50A}';
            muteBtn.classList.toggle('on', APP.audio.videoMuted);
        }
        log('VIDEO_AUDIO: ' + (APP.audio.videoMuted ? 'MUTED' : 'ON'));
    } catch (e) { log('VIDEO_AUDIO_ERR: ' + e.message); }
}

function disconnectVideoAudio() {
    var vid = APP.audio.videoSource;
    if (!vid) return;
    try {
        if (vid._audioSrc) vid._audioSrc.disconnect();
        vid.muted = true; // silence native output while not connected to Web Audio
    } catch(e) {}
    APP.audio.videoSource = null;
}


function rotateMedia() {
    if (APP.media.queue.length === 0) return;
    APP.render.source = null; // Clear override so queue takes priority
    APP.vj.glitchSnap = 3;
    // Capture outgoing element before advancing index
    var _outgoingEl = APP.media.currentElement;
    if (APP.media.currentElement?.tagName === 'VIDEO') APP.media.currentElement.pause(); disconnectVideoAudio();
    APP.media.currentIndex = (APP.media.currentIndex + 1) % APP.media.queue.length;
    const item = APP.media.queue[APP.media.currentIndex];
    const gifOverlay = document.getElementById('gif-overlay');
    // GIF: bypass canvas entirely — render as DOM overlay so animation plays
    if (item.type === 'gif') {
        if (gifOverlay) gifOverlay.innerHTML = '';
        const img = document.createElement('img');
        img.src = item.url;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        if (gifOverlay) gifOverlay.appendChild(img);
        item.element = img;
        APP.media.currentElement = null; // GIFs do not render to vj-canvas
        APP.media._tx = null;
        ghostLog('GIF: ' + item.name + ' — DOM render only, not captured by captureStream. Convert to .webm for recording.', 'sys');
        updateMediaControls();
        checkCycleLogic();
        return;
    }
    // Non-GIF: clear any previous GIF overlay
    if (gifOverlay) gifOverlay.innerHTML = '';
    // Guard: skip items still loading (async FileReader not done yet)
    if (!item.element) { APP.media.currentElement = null; return; }
    APP.media.currentElement = item.element;
    if (item.type === 'video') { item.element.loop = !APP.state.isCycle; item.element.currentTime = 0; item.element.play().catch(() => {});  connectVideoAudio(item.element); }
    // Set up A/B transition — snap/glitch = instant cut (glitch fires system FX), no A/B animation
    var _txDurSec = item.transitionDuration != null ? item.transitionDuration : 0.8;
    if (item.transitionType === 'glitch' && _outgoingEl && _outgoingEl !== item.element) {
        // Chromatic aberration CSS filter + impact flash — same as NFT carousel launcher
        // but WITHOUT rgbIntensity canvas rendering which destroys the thumbnail strip
        try { triggerChromaticAberration(); triggerImpact(); APP.vj.glitchSnap = 5; setTimeout(function(){ APP.vj.glitchSnap = 0; }, 300); } catch(e) {}
    }
    if (_outgoingEl && _outgoingEl !== item.element && item.transitionType !== 'snap' && item.transitionType !== 'glitch') {
        APP.media._tx = {
            active: true,
            type:   item.transitionType   || 'optical-fade',
            easing: item.easing           || 'linear',
            out:    _outgoingEl,
            in:     item.element,
            start:  performance.now(),
            dur:    _txDurSec * 1000
        };
    } else {
        APP.media._tx = null;
    }
    updateMediaControls();
    checkCycleLogic();
}

function previousMedia() {
    if (APP.media.queue.length === 0) return;
    APP.vj.glitchSnap = 3;
    if (APP.media.currentElement?.tagName === 'VIDEO') APP.media.currentElement.pause(); disconnectVideoAudio();
    APP.media.currentIndex = (APP.media.currentIndex - 1 + APP.media.queue.length) % APP.media.queue.length;
    const item = APP.media.queue[APP.media.currentIndex];
    const gifOverlay = document.getElementById('gif-overlay');
    if (item.type === 'gif') {
        if (gifOverlay) gifOverlay.innerHTML = '';
        const img = document.createElement('img');
        img.src = item.url;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        if (gifOverlay) gifOverlay.appendChild(img);
        item.element = img;
        APP.media.currentElement = null;
        ghostLog('GIF: ' + item.name + ' — DOM render only, not captured by captureStream. Convert to .webm for recording.', 'sys');
        updateMediaControls();
        checkCycleLogic();
        return;
    }
    if (gifOverlay) gifOverlay.innerHTML = '';
    if (!item.element) { APP.media.currentElement = null; return; }
    APP.media.currentElement = item.element;
    if (item.type === 'video') { item.element.loop = !APP.state.isCycle; item.element.currentTime = 0; item.element.play().catch(() => {});  connectVideoAudio(item.element); }
    updateMediaControls();
    checkCycleLogic();
}

function ejectCurrent() {
    if (APP.media.queue.length === 0) return;
    APP.render.source = null; // Clear any override
    const current = APP.media.queue[APP.media.currentIndex];
    if (current.element?.tagName === 'VIDEO') { disconnectVideoAudio(); current.element.pause(); current.element.src = ''; current.element.remove(); }
    if (current.element?.tagName === 'IMG' && current.element.parentNode) { current.element.remove(); }
    if (current.url) URL.revokeObjectURL(current.url);
    APP.media.queue.splice(APP.media.currentIndex, 1);
    if (APP.media.queue.length === 0) { APP.media.currentIndex = -1; APP.media.currentElement = null; $('media-dot').classList.add('off'); APP.render.ctx.fillStyle = '#000'; APP.render.ctx.fillRect(0, 0, APP.render.width, APP.render.height); }
    else { if (APP.media.currentIndex >= APP.media.queue.length) APP.media.currentIndex = 0; const next = APP.media.queue[APP.media.currentIndex]; APP.media.currentElement = next.element; if (next.type === 'video') { next.element.currentTime = 0; next.element.play().catch(() => {}); } }
    updateQueueDisplay();
}

function clearDeck() {
    if(APP.state.isCycle) toggleCycle();
    APP.render.source = null; // Clear any override
    APP.media.queue.forEach(item => {
        if (item.element?.tagName === 'VIDEO') { item.element.pause(); item.element.src = ''; item.element.remove(); }
        if (item.element?.tagName === 'IMG' && item.element.parentNode) { item.element.remove(); }
        if (item.url) URL.revokeObjectURL(item.url);
    });
    APP.media.queue = []; APP.media.currentIndex = -1; APP.media.currentElement = null; $('media-dot').classList.add('off');
    updateQueueDisplay();
    log('DECK_CLEARED');
}

function panicReset() {
    location.reload(); // Hard Reset for Panic
}

function toggleCycle() {
    if (APP.media.queue.length === 0) return; 

    APP.state.isCycle = !APP.state.isCycle;
    const btn = $('btn-cycle-toggle');
    const header = $('media-header');
    
    if (APP.state.isCycle) {
        btn.innerHTML = 'CYCLE: ON';
        btn.classList.add('cycle-active'); 
        header.classList.add('scanning');
        $('cycle-badge').classList.add('on');
        checkCycleLogic();
    } else {
        btn.innerHTML = 'CYCLE: OFF';
        btn.classList.remove('cycle-active');
        header.classList.remove('scanning');
        $('cycle-badge').classList.remove('on');
        clearTimeout(APP.state.cycleTimer);
        if (APP.media.currentElement?.tagName === 'VIDEO') APP.media.currentElement.loop = true;
    }
}

function checkCycleLogic() {
    clearTimeout(APP.state.cycleTimer);
    if (!APP.state.isCycle || APP.media.currentIndex === -1) return;
    const current = APP.media.queue[APP.media.currentIndex];
    if (!current) return;
    if (current.type === 'video') { if (current.element) { current.element.loop = false; current.element.onended = () => { if (APP.state.isCycle) rotateMedia(); }; } }
    else {
        var _qi = APP.media.queue[APP.media.currentIndex];
        if (_qi && _qi.duration === null) return; // null = infinite hold, no timer
        var secs = (_qi && _qi.duration != null) ? _qi.duration : (parseInt($('sl-cycle').value) || 8);
        APP.state.cycleTimer = setTimeout(function() { if (APP.state.isCycle) rotateMedia(); }, secs * 1000);
    }
}

function updateQueueDisplay() {
    const count = APP.media.queue.length;
    if($('q-info')) $('q-info').textContent = count;
    const btn = $('btn-load-media');
    if (count > 0) {
        btn.innerHTML = `MEDIA LOADED [ ${count} ]`;
        btn.classList.add('active-mode');
        $('media-dot').classList.remove('off');
    } else {
        btn.innerHTML = 'LOAD MEDIA';
        btn.classList.remove('active-mode');
        $('media-dot').classList.add('off');
    }
    updateMediaControls();
}

function updateMediaControls() {
    const zoomBtn = $('btn-zoom-img');
    if (!zoomBtn) return;
    const item = APP.media.queue[APP.media.currentIndex];
    zoomBtn.style.display = (item && (item.type === 'image' || item.type === 'gif')) ? 'block' : 'none';
}

function openLightbox() {
    const item = APP.media.queue[APP.media.currentIndex];
    if (!item || (item.type !== 'image' && item.type !== 'gif')) return;
    const lb = $('img-lightbox');
    const lbImg = $('img-lightbox-src');
    lbImg.src = item.url;
    lb.style.display = 'flex';
}

function closeLightbox() {
    var lb = $('img-lightbox');
    if (lb) lb.style.display = 'none';
}



