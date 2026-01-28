

// ═══════════════════════════════════════════════════════════════════════════
// DRIS//core VNGRD v22.1 — HYBRID BROADCAST MONSTER
// ═══════════════════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════════
// MASTER APP OBJECT
// ═══════════════════════════════════════════════════════════════════════════
const APP = {
    state: {
        isLive: false,
        isRecording: false,
        isFullscreen: false,
        isCycle: false,
        cycleTimer: null,
        isMobile: false,
        theme: 'cyan',
        startTime: Date.now(),
        lastPrices: { btc: 0, eth: 0, sol: 0 }
    },

    vj: {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        hue: 0,
        trailsEnabled: false,
        trailAlpha: 0.92,
        rgbEnabled: false,
        rgbIntensity: 0,
        rgbBassLink: false,
        pixelateEnabled: false,
        pixelSize: 1,
        rumbleEnabled: false,
        invert: false,
        uiReactivity: false,
        seismicTimer: null,
        shakeIntensity: 0,
        lastBassLevel: 0
    },

    // Stored VJ state for impact recovery
    vjSnapshot: null,

    media: {
        queue: [],
        currentIndex: -1,
        currentElement: null,
        isTransitioning: false
    },

    audio: {
        ctx: null,
        analyzer: null,
        source: null,
        element: null,
        playlist: [],
        currentTrack: -1,
        currentTrackName: '',
        bassLevel: 0,
        vuData: new Uint8Array(32),
        isPlaying: false,
        isConnected: false,
        // Spatial Audio & Broadcast Chain
        spatialMode: 'stereo', // 'stereo', '3d', 'dolby'
        spatialEnabled: false,
        panner: null,
        compressor: null,
        masterGain: null,
        listener: null
    },

    // Projector (Clean Feed)
    projector: {
        window: null,
        stream: null,
        isOpen: false
    },

    // Time Machine (Rolling Buffer)
    timeMachine: {
        recorder: null,
        chunks: [],
        stream: null,
        audioDest: null,
        isRecording: false,
        maxDuration: 30000 // 30 seconds
    },

    // WebXR
    xr: {
        supported: false,
        checked: false,
        session: null,
        refSpace: null,
        gl: null,
        vjTexture: null,
        shaderProgram: null,
        quadBuffer: null,
        // Shader locations
        aPosition: null,
        aTexCoord: null,
        uProjection: null,
        uView: null,
        uTexture: null
    },

    // WebRTC Guest Module (PeerJS)
    guest: {
        peer: null,
        connection: null,
        stream: null,
        videoElement: null,
        audioSource: null,
        isActive: false,
        peerId: null
    },

    // Sovereign Security Module
    security: {
        purge: null // Function assigned at runtime
    },

    camera: {
        stream: null,
        recorder: null,
        chunks: [],
        mode: 'off',
        isRecording: false,
        isClipping: false
    },

    render: {
        canvas: null,
        ctx: null,
        width: 1920,
        height: 1080,
        fps: 0,
        frameCount: 0,
        lastTime: 0,
        lastFpsUpdate: 0,
        rafId: null,
        scale: 1.0
    },

    bug: {
        visible: true,
        text: 'DRIS//core',
        image: null
    },

    lowerThird: {
        visible: false,
        preset: 'guest',
        title: 'GUEST NAME',
        subtitle: 'TITLE / ROLE'
    },

    ui: {
        logoMorph: 0,
        morphs: ['m1','m2','m3','m4','m5','m6','m7','m8','m9','m10','m11','m12','m13','m14','m15']
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function log(msg) {
    const box = $('sys-log');
    const ts = new Date().toTimeString().split(' ')[0];
    const el = document.createElement('div');
    el.className = 'log-line';
    el.innerHTML = `<span class="ts">${ts}</span>${msg}`;
    box.insertBefore(el, box.firstChild);
    if (box.children.length > 30) box.lastChild.remove();
}

function checkMobile() {
    APP.state.isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry/i.test(navigator.userAgent);
    if (APP.state.isMobile) {
        APP.render.width = 960;
        APP.render.height = 540;
        log('MOBILE_MODE');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════
function initCanvas() {
    APP.render.canvas = $('vj-canvas');
    
    // desynchronized: true is critical for low-latency VJing
    APP.render.ctx = APP.render.canvas.getContext('2d', { 
        alpha: false, 
        desynchronized: true,
        willReadFrequently: false 
    });
    
    // Tell the browser this is a high-performance layer
    APP.render.canvas.style.transform = 'translateZ(0)';
    APP.render.canvas.style.backfaceVisibility = 'hidden';
    
    resizeCanvas();
    window.addEventListener('resize', () => {
        resizeCanvas();
        checkMobile();
    });
    log('CANVAS_INIT: GPU_LOCKED');
}

function resizeCanvas() {
    APP.render.canvas.width = APP.render.width;
    APP.render.canvas.height = APP.render.height;
    $('res').textContent = `${APP.render.width}x${APP.render.height}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 60FPS RENDER LOOP
// ═══════════════════════════════════════════════════════════════════════════
function renderLoop(timestamp) {
    APP.render.rafId = requestAnimationFrame(renderLoop);
    
    // FPS
    APP.render.frameCount++;
    if (timestamp - APP.render.lastFpsUpdate >= 1000) {
        APP.render.fps = APP.render.frameCount;
        APP.render.frameCount = 0;
        APP.render.lastFpsUpdate = timestamp;
        $('fps-val').textContent = APP.render.fps;
    }
    
    const ctx = APP.render.ctx;
    const w = APP.render.width;
    const h = APP.render.height;
    
    // Precision Rendering - crisp pixels, no blur
    ctx.imageSmoothingEnabled = false;
    
    // RUMBLE SCALE (Bass-linked)
    if (APP.vj.rumbleEnabled && APP.audio.bassLevel > 100) {
        APP.render.scale = 1.0 + (APP.audio.bassLevel / 255) * 0.06;
    } else {
        APP.render.scale = 1.0;
    }
    
    // TRAILS
    if (APP.vj.trailsEnabled) {
        ctx.globalAlpha = APP.vj.trailAlpha;
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.scale(1.008, 1.008);
        ctx.translate(-w / 2, -h / 2);
        ctx.drawImage(APP.render.canvas, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
    } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
    }
    
    // DRAW SOURCE (Priority: Guest > Live Camera > Media Queue)
    let source = null;
    let forceFullBleed = false;
    
    if (APP.guest.stream && APP.guest.isActive) {
        // Guest stream takes priority - create video element if needed
        if (!APP.guest.videoElement) {
            APP.guest.videoElement = document.createElement('video');
            APP.guest.videoElement.srcObject = APP.guest.stream;
            APP.guest.videoElement.muted = true;
            APP.guest.videoElement.playsInline = true;
            APP.guest.videoElement.play().catch(() => {});
        }
        source = APP.guest.videoElement;
        forceFullBleed = true; // Guest always full-bleed
    } else if (APP.state.isLive && APP.camera.stream) {
        source = $('preview-vid');
    } else if (APP.media.currentElement) {
        source = APP.media.currentElement;
    }
    
    if (source) {
        const ready = source.tagName === 'VIDEO' ? source.readyState >= 2 : source.complete;
        if (ready) {
            // VJ filter
            ctx.filter = `brightness(${APP.vj.brightness}) contrast(${APP.vj.contrast}) saturate(${APP.vj.saturation}) hue-rotate(${APP.vj.hue}deg)${APP.vj.invert ? ' invert(1)' : ''}`;
            
            // ADAPTIVE SCALING: Full-bleed in fullscreen or guest, safe area in windowed
            const srcW = source.videoWidth || source.naturalWidth || source.width;
            const srcH = source.videoHeight || source.naturalHeight || source.height;
            
            let scale, drawW, drawH, drawX, drawY;
            
            if (APP.state.isFullscreen || forceFullBleed) {
                // FULL-BLEED: Cover entire screen (may crop)
                scale = Math.max(w / srcW, h / srcH) * APP.render.scale;
                drawW = srcW * scale;
                drawH = srcH * scale;
                drawX = (w - drawW) / 2;
                drawY = (h - drawH) / 2;
            } else {
                // SOVEREIGN SAFE AREA: Contain with 5% margin
                const safeW = w * 0.9;
                const safeH = h * 0.9;
                scale = Math.min(safeW / srcW, safeH / srcH) * APP.render.scale;
                drawW = srcW * scale;
                drawH = srcH * scale;
                drawX = (w - drawW) / 2;
                drawY = (h - drawH) / 2;
            }
            
            ctx.drawImage(source, drawX, drawY, drawW, drawH);
            ctx.filter = 'none';
        }
    }
    
    // GPU PIXELATE ENGINE (Fixed-size offscreen canvas)
    if (APP.vj.pixelateEnabled && APP.vj.pixelSize > 1) {
        // Create fixed 64x36 downscale canvas once (16:9 @ 64px wide)
        if (!APP.render.pixelCanvas) {
            APP.render.pixelCanvas = document.createElement('canvas');
            APP.render.pixelCanvas.width = 64;
            APP.render.pixelCanvas.height = 36;
            APP.render.pixelCtx = APP.render.pixelCanvas.getContext('2d');
            APP.render.pixelCtx.imageSmoothingEnabled = false;
        }
        
        // Stage 1: Downsample to tiny canvas (GPU accelerated)
        const downScale = Math.max(1, Math.floor(APP.vj.pixelSize / 2));
        const tW = Math.floor(64 / downScale);
        const tH = Math.floor(36 / downScale);
        APP.render.pixelCtx.drawImage(APP.render.canvas, 0, 0, tW, tH);
        
        // Stage 2: Upsample back to full size (no smoothing = blocky pixels)
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(APP.render.pixelCanvas, 0, 0, tW, tH, 0, 0, w, h);
    }
    
    // RGB Shift: Apply via CSS filter (GPU-accelerated)
    if (APP.vj.rgbEnabled && APP.vj.rgbIntensity > 0) {
        let offset = APP.vj.rgbIntensity;
        if (APP.vj.rgbBassLink) offset = Math.floor((APP.audio.bassLevel / 255) * APP.vj.rgbIntensity * 2);
        if (offset > 0) {
            APP.render.canvas.style.filter = `url(#chromatic-ghost)`;
            APP.render.rgbActive = true;
        }
    } else if (APP.render.rgbActive) {
        APP.render.canvas.style.filter = 'none';
        APP.render.rgbActive = false;
    }
    
    APP.render.lastTime = timestamp;
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPACT FX (Musical Performance)
// ═══════════════════════════════════════════════════════════════════════════
function triggerImpact() {
    // Remove and force reflow for rapid-fire triggers
    document.body.classList.remove('impact-flash');
    void document.body.offsetWidth; // Force reflow
    document.body.classList.add('impact-flash');
    setTimeout(() => document.body.classList.remove('impact-flash'), 200);
}

function triggerChromaticAberration() {
    // GPU-accelerated chromatic aberration via SVG filter
    const canvas = APP.render.canvas;
    canvas.style.filter = 'url(#chromatic-ghost)';
    
    setTimeout(() => {
        canvas.style.filter = 'none';
    }, 200);
}

function impactStutter() {
    // Snapshot current state
    const originalTrails = APP.vj.trailsEnabled;
    const originalAlpha = APP.vj.trailAlpha;
    
    APP.vj.trailsEnabled = true;
    APP.vj.trailAlpha = 0.98;
    
    // FX ISOLATION: Canvas-only effects
    triggerChromaticAberration();
    log('IMPACT: STUTTER');
    
    setTimeout(() => {
        APP.vj.trailsEnabled = originalTrails;
        APP.vj.trailAlpha = originalAlpha;
    }, 500);
}

function impactInvert() {
    APP.vj.invert = true;
    
    // FX ISOLATION: Canvas-only effects
    triggerChromaticAberration();
    log('IMPACT: INVERT');
    
    setTimeout(() => {
        APP.vj.invert = false;
    }, 500);
}

function impactCrush() {
    const originalRGB = APP.vj.rgbIntensity;
    const originalPix = APP.vj.pixelSize;
    const originalRGBEnabled = APP.vj.rgbEnabled;
    const originalPixEnabled = APP.vj.pixelateEnabled;
    
    APP.vj.rgbEnabled = true;
    APP.vj.pixelateEnabled = true;
    APP.vj.rgbIntensity = 25;
    APP.vj.pixelSize = 16;
    
    // FX ISOLATION: Canvas-only effects (RGB + Pixelate already on canvas)
    log('IMPACT: CRUSH');
    
    setTimeout(() => {
        APP.vj.rgbEnabled = originalRGBEnabled;
        APP.vj.pixelateEnabled = originalPixEnabled;
        APP.vj.rgbIntensity = originalRGB;
        APP.vj.pixelSize = originalPix;
    }, 500);
}

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
function loadMediaFiles(input) {
    const isFirstLoad = APP.media.currentIndex === -1;
    
    Array.from(input.files).forEach((file, idx) => {
        const url = URL.createObjectURL(file);
        const type = file.type.startsWith('video') ? 'video' : 'image';
        const item = { type, url, element: null, name: file.name };
        
        if (type === 'video') {
            const vid = document.createElement('video');
            vid.src = url;
            vid.muted = true;
            vid.loop = !APP.state.isCycle; // Loop unless cycle active
            vid.playsInline = true;
            vid.preload = 'auto';
            item.element = vid;
            $('media-container').appendChild(vid);
        } else {
            const img = new Image();
            img.src = url;
            item.element = img;
        }
        
        APP.media.queue.push(item);
        
        // Immediately rotate on FIRST file added (no waiting)
        if (isFirstLoad && idx === 0) {
            rotateMedia();
        }
    });
    
    updateQueueDisplay();
    $('media-dot').classList.remove('off');
    
    log(`MEDIA: +${input.files.length}`);
    
    // Start cycle if active
    checkCycleLogic();
}

function rotateMedia() {
    if (APP.media.queue.length === 0) return;

    // 1. THE SIGNATURE SHIELD (Heavier than normal VJing)
    // We force the RGB split to its maximum for a split second
    APP.vj.rgbIntensity = 25; 
    triggerChromaticAberration();

    // 2. STOP CURRENT MEDIA
    if (APP.media.currentElement?.tagName === 'VIDEO') {
        APP.media.currentElement.pause();
    }

    // 3. THE DATA SWAP
    APP.media.currentIndex = (APP.media.currentIndex + 1) % APP.media.queue.length;
    const item = APP.media.queue[APP.media.currentIndex];

    // 4. PRE-BOOT NEXT ELEMENT
    if (item.type === 'video') {
        item.element.loop = !APP.state.isCycle;
        item.element.currentTime = 0;
        item.element.play().catch(() => {});
    }

    // 5. THE SEAMLESS HANDOFF
    APP.media.currentElement = item.element;

    // 6. THE COOL-DOWN (Returns to normal VJ settings)
    // This makes the glitch feel like a mechanical "clunk"
    setTimeout(() => {
        APP.vj.rgbIntensity = document.getElementById('sl-rgb').value;
    }, 150);

    log(`ENGINE: SNAP_OK [${APP.media.currentIndex + 1}]`);
}

function previousMedia() {
    if (APP.media.queue.length === 0) return;
    
    // INVERT SHIELD: Mask loading 'pop'
    APP.vj.invert = true;
    setTimeout(() => { APP.vj.invert = false; }, 50);
    
    // TRANSITION GLITCH: Chromatic aberration before swap
    triggerChromaticAberration();
    
    // TRANSITION FLASH: 100ms white flash
    const ctx = APP.render.ctx;
    const w = APP.render.width;
    const h = APP.render.height;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    
    // Stop current
    if (APP.media.currentElement?.tagName === 'VIDEO') {
        APP.media.currentElement.pause();
    }
    
    // Go back (Index - 1), wrap around
    APP.media.currentIndex = (APP.media.currentIndex - 1 + APP.media.queue.length) % APP.media.queue.length;
    const item = APP.media.queue[APP.media.currentIndex];
    APP.media.currentElement = item.element;
    
    if (item.type === 'video') {
        item.element.loop = !APP.state.isCycle;
        item.element.currentTime = 0;
        item.element.play().catch(() => {});
    }
    
    triggerImpact();
    log(`MEDIA: ${APP.media.currentIndex + 1}/${APP.media.queue.length}`);
    
    // Continue cycle if active
    checkCycleLogic();
}

function ejectCurrent() {
    if (APP.media.queue.length === 0) return;
    
    const current = APP.media.queue[APP.media.currentIndex];
    
    // Stop and cleanup current media
    if (current.element?.tagName === 'VIDEO') {
        current.element.pause();
        current.element.src = '';
        current.element.remove();
    }
    URL.revokeObjectURL(current.url);
    
    // Splice out of queue
    APP.media.queue.splice(APP.media.currentIndex, 1);
    
    if (APP.media.queue.length === 0) {
        // Queue empty - reset to black stage
        APP.media.currentIndex = -1;
        APP.media.currentElement = null;
        $('media-dot').classList.add('off');
        
        // Clear canvas to black
        const ctx = APP.render.ctx;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, APP.render.width, APP.render.height);
        log('QUEUE_EMPTY');
    } else {
        // Adjust index and play next
        if (APP.media.currentIndex >= APP.media.queue.length) {
            APP.media.currentIndex = 0;
        }
        const next = APP.media.queue[APP.media.currentIndex];
        APP.media.currentElement = next.element;
        
        if (next.type === 'video') {
            next.element.currentTime = 0;
            next.element.play().catch(() => {});
        }
        log(`PLAYING: ${APP.media.currentIndex + 1}/${APP.media.queue.length}`);
    }
    
    updateQueueDisplay();
    log('EJECTED');
}

function purgeAll() {
    // Delegate to Sovereign Security module for comprehensive wipe
    if (APP.security.purge) {
        APP.security.purge();
    } else {
        // Fallback: basic cleanup
        APP.media.queue.forEach(item => {
            if (item.element?.tagName === 'VIDEO') {
                item.element.pause();
                item.element.src = '';
                item.element.remove();
            }
            URL.revokeObjectURL(item.url);
        });
        APP.media.queue = [];
        APP.media.currentIndex = -1;
        APP.media.currentElement = null;
        $('media-dot').classList.add('off');
        
        APP.audio.playlist = [];
        APP.audio.currentTrack = -1;
        APP.audio.element.pause();
        APP.audio.element.src = '';
        APP.audio.isPlaying = false;
        $('audio-dot').classList.add('off');
        $('track-info').textContent = 'NO TRACK';
        
        updateQueueDisplay();
        log('PURGE_ALL');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART CYCLE ENGINE (Unified Media Rotation)
// ═══════════════════════════════════════════════════════════════════════════
function toggleCycle() {
    APP.state.isCycle = !APP.state.isCycle;
    const btn = $('btn-cycle');
    
    if (APP.state.isCycle) {
        btn.textContent = 'ON';
        btn.classList.add('on');
        btn.style.borderColor = 'var(--y)';
        $('cycle-badge').classList.add('on');
        checkCycleLogic(); // Start immediately
    } else {
        btn.textContent = 'CYCLE: OFF';
        btn.classList.remove('on');
        btn.style.borderColor = 'var(--border)';
        $('cycle-badge').classList.remove('on');
        clearTimeout(APP.state.cycleTimer);
        // Reset video looping
        if (APP.media.currentElement?.tagName === 'VIDEO') {
            APP.media.currentElement.loop = true;
        }
    }
    log(APP.state.isCycle ? 'CYCLE_ACTIVE' : 'CYCLE_STOP');
}

// ROUTER (Handles Video vs Image logic)
function checkCycleLogic() {
    clearTimeout(APP.state.cycleTimer);
    if (!APP.state.isCycle || APP.media.currentIndex === -1) return;

    const current = APP.media.queue[APP.media.currentIndex];
    if (!current) return;

    if (current.type === 'video') {
        // VIDEO: Play full length, then auto-next
        if (current.element) {
            current.element.loop = false;
            current.element.onended = () => {
                if (APP.state.isCycle) rotateMedia();
            };
        }
    } else {
        // IMAGE: Use the input value for duration
        const secs = parseInt($('cycle-time').value) || 8;
        APP.state.cycleTimer = setTimeout(() => {
            if (APP.state.isCycle) rotateMedia();
        }, secs * 1000);
    }
}

function updateQueueDisplay() {
    $('q-count').textContent = APP.media.queue.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOWER THIRDS
// ═══════════════════════════════════════════════════════════════════════════
function showLowerThird(preset) {
    const lt = $('lower-third');
    const container = lt.querySelector('.lt-container');
    
    container.classList.remove('lt-guest', 'lt-track', 'lt-breaking');
    container.classList.add(`lt-${preset}`);
    
    APP.lowerThird.preset = preset;
    APP.lowerThird.visible = true;
    
    // Update content based on preset
    if (preset === 'track' && APP.audio.currentTrackName) {
        $('lt-title-text').textContent = APP.audio.currentTrackName;
        $('lt-subtitle-text').textContent = 'NOW PLAYING';
    } else if (preset === 'breaking') {
        $('lt-title-text').textContent = $('lt-title').value || 'BREAKING NEWS';
        $('lt-subtitle-text').textContent = $('lt-sub').value || 'LIVE UPDATE';
    } else {
        $('lt-title-text').textContent = $('lt-title').value || 'GUEST NAME';
        $('lt-subtitle-text').textContent = $('lt-sub').value || 'TITLE / ROLE';
    }
    
    lt.classList.add('visible');
    
    // Update button states
    ['guest', 'track', 'breaking', 'off'].forEach(p => {
        $(`btn-lt-${p}`).classList.toggle('on', p === preset);
    });
    
    log(`LT: ${preset.toUpperCase()}`);
}

function hideLowerThird() {
    $('lower-third').classList.remove('visible');
    APP.lowerThird.visible = false;
    ['guest', 'track', 'breaking', 'off'].forEach(p => {
        $(`btn-lt-${p}`).classList.remove('on');
    });
    $('btn-lt-off').classList.add('on');
    log('LT: OFF');
}

// ═══════════════════════════════════════════════════════════════════════════
// STATION BUG
// ═══════════════════════════════════════════════════════════════════════════
function updateBug() {
    const bug = $('station-bug');
    if (APP.bug.image) {
        bug.innerHTML = `<img src="${APP.bug.image}" alt="Logo">`;
    } else {
        // Use input value if available, else stored text, else default
        const inputVal = $('bug-text')?.value;
        bug.textContent = inputVal || APP.bug.text || 'DRIS//core';
    }
}

function toggleBug() {
    APP.bug.visible = !APP.bug.visible;
    $('station-bug').classList.toggle('hidden', !APP.bug.visible);
    $('btn-bug-toggle').classList.toggle('on', APP.bug.visible);
    log(APP.bug.visible ? 'BUG_ON' : 'BUG_OFF');
}

function loadLogoFile(input) {
    if (!input.files.length) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        // This converts the image to a permanent Base64 string
        APP.bug.image = e.target.result; 
        updateBug();
        saveSession(); // Force an auto-save so it remembers the logo
        log('LOGO_PERMANENT_SAVED');
    };
    reader.readAsDataURL(input.files[0]);
}
// Bug drag variables (initialized in DOMContentLoaded)
let bugDragging = false, bugOffsetX = 0, bugOffsetY = 0;

// ═══════════════════════════════════════════════════════════════════════════
// CAMERA SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
async function initCamera() {
    try {
        APP.camera.stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1920, min: 1280 }, 
                height: { ideal: 1080, min: 720 },
                frameRate: { ideal: 60, min: 30 }
            },
            audio: false // Silent init - no mic popup
        });
        $('preview-vid').srcObject = APP.camera.stream;
        APP.camera.mode = 'preview';
        $('cam-preview').style.display = 'block';
        $('btn-init-cam').style.display = 'none';
        $('cam-ctrls').style.display = 'block';
        $('btn-kill').style.display = 'block';
        $('cam-dot').classList.remove('off');
        log('CAM_READY');
        
        // UNLOCK AUDIO: Initialize AudioContext on user gesture
        if (!APP.audio.ctx) {
            APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
            log('AUDIO_CTX_UNLOCKED');
        }
        
        // ARM TIME MACHINE: User gesture required for MediaRecorder
        initTimeMachine();
        
        // Now enumerate audio outputs (permission already granted)
        enumerateAudioOutputs();
    } catch (e) {
        log('CAM_ERROR');
    }
}

function goLive() {
    if (!APP.camera.stream) return;
    const overlay = $('countdown');
    const num = $('countdown-num');
    overlay.style.display = 'flex';
    let count = 3;
    num.textContent = count;
    sovereignStrobe(); // Strobe on 3
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            num.textContent = count;
            sovereignStrobe(); // Strobe on 2, 1
        } else {
            clearInterval(interval);
            overlay.style.display = 'none';
            APP.state.isLive = true;
            APP.camera.mode = 'live';
            $('cam-ctrls').style.display = 'none';
            $('live-ctrls').style.display = 'block';
            $('tally').style.display = 'block';
            $('status-text').textContent = 'LIVE';
            $('main-dot').classList.add('live');
            document.querySelector('.preview-label').textContent = 'LIVE';
            sovereignStrobe(); // Final strobe on LIVE
            log('LIVE');
            if (APP.state.isCycle) toggleCycle(); // <--- ADD THIS AT THE VERY END
        }
    }, 1000);
}

function endLive() {
    if (APP.camera.isRecording) toggleRec();
    APP.state.isLive = false;
    APP.camera.mode = 'preview';
    $('live-ctrls').style.display = 'none';
    $('cam-ctrls').style.display = 'block';
    $('tally').style.display = 'none';
    $('status-text').textContent = 'STANDBY';
    $('main-dot').classList.remove('live');
    document.querySelector('.preview-label').textContent = 'PREVIEW';
    log('END_LIVE');
}

function toggleRec() {
    if (APP.camera.isRecording) {
        APP.camera.recorder.stop();
        $('tally').textContent = 'ON AIR';
        $('status-text').textContent = 'LIVE';
        document.querySelector('.preview-label').textContent = 'LIVE';
    } else {
        APP.camera.chunks = [];
        APP.camera.recorder = new MediaRecorder(APP.camera.stream);
        APP.camera.recorder.ondataavailable = e => APP.camera.chunks.push(e.data);
        APP.camera.recorder.onstop = () => {
            const blob = new Blob(APP.camera.chunks, { type: 'video/webm' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `DRIS_${Date.now()}.webm`;
            a.click();
            APP.camera.isRecording = false;
            $('btn-rec').textContent = '● REC';
            $('btn-rec').classList.remove('on');
            $('rec-dot').classList.remove('on');
            document.querySelector('.preview-label').textContent = 'LIVE';
            log('REC_SAVED');
        };
        APP.camera.recorder.start();
        APP.camera.isRecording = true;
        $('btn-rec').textContent = '■ STOP';
        $('btn-rec').classList.add('on');
        $('rec-dot').classList.add('on');
        $('tally').textContent = 'REC LIVE';
        $('status-text').textContent = 'RECORDING';
        document.querySelector('.preview-label').textContent = 'REC';
        log('REC_START');
    }
}

function toggleMic() {
    if (!APP.camera.stream) return;
    const track = APP.camera.stream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        $('btn-mic').classList.toggle('on', track.enabled);
        log(`MIC_${track.enabled ? 'ON' : 'OFF'}`);
    }
}

function clip10s() {
    if (!APP.camera.stream || APP.camera.isClipping) return;
    APP.camera.isClipping = true;
    let remaining = 10;
    $('btn-clip').textContent = `${remaining}s`;
    $('btn-clip').classList.add('on');
    
    const chunks = [];
    const rec = new MediaRecorder(APP.camera.stream);
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
        const vid = document.createElement('video');
        vid.src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
        vid.muted = true;
        vid.playsInline = true;
        APP.media.queue.push({ type: 'video', url: vid.src, element: vid });
        $('media-container').appendChild(vid);
        updateQueueDisplay();
        $('btn-clip').textContent = 'CLIP 10s';
        $('btn-clip').classList.remove('on');
        APP.camera.isClipping = false;
        log('CLIP_OK');
    };
    rec.start();
    const countdown = setInterval(() => {
        remaining--;
        if (remaining > 0) $('btn-clip').textContent = `${remaining}s`;
        else { clearInterval(countdown); rec.stop(); }
    }, 1000);
}

function killCamera() {
    if (APP.camera.stream) APP.camera.stream.getTracks().forEach(t => t.stop());
    APP.camera.mode = 'off';
    APP.state.isLive = false;
    $('cam-preview').style.display = 'none';
    $('live-ctrls').style.display = 'none';
    $('cam-ctrls').style.display = 'none';
    $('btn-init-cam').style.display = 'block';
    $('btn-kill').style.display = 'none';
    $('cam-dot').classList.add('off');
    $('tally').style.display = 'none';
    $('status-text').textContent = 'STANDBY';
    $('main-dot').classList.remove('live');
    log('CAM_OFF');
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
APP.audio.element = $('audio-el');

function loadAudioFiles(input) {
    Array.from(input.files).forEach(file => {
        APP.audio.playlist.push({
            url: URL.createObjectURL(file),
            name: file.name.replace(/\.[^.]+$/, '')
        });
    });
    $('audio-dot').classList.remove('off');
    if (!APP.audio.isPlaying && APP.audio.playlist.length) playTrack();
    log(`AUDIO: +${input.files.length}`);
}

function playTrack() {
    if (!APP.audio.playlist.length) return;
    if (!APP.audio.ctx) APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    APP.audio.currentTrack = (APP.audio.currentTrack + 1) % APP.audio.playlist.length;
    const track = APP.audio.playlist[APP.audio.currentTrack];
    APP.audio.currentTrackName = track.name;
    
    APP.audio.element.src = track.url;
    APP.audio.element.play().then(() => {
        APP.audio.isPlaying = true;
        $('track-info').textContent = track.name.toUpperCase();
        
        // Auto-update lower third if showing track
        if (APP.lowerThird.visible && APP.lowerThird.preset === 'track') {
            $('lt-title-text').textContent = track.name;
        }
        
        log(`PLAY: ${track.name}`);
    });
    
    if (!APP.audio.isConnected) setupAudioAnalyzer();
}

// ═══════════════════════════════════════════════════════════════════════════
// PRO-GRADE SPATIAL AUDIO ENGINE (DOLBY SIMULATION)
// ═══════════════════════════════════════════════════════════════════════════
function setupAudioAnalyzer() {
    try {
        if (!APP.audio.ctx) APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // 1. Create the Nodes
        APP.audio.source = APP.audio.ctx.createMediaElementSource(APP.audio.element);
        APP.audio.analyzer = APP.audio.ctx.createAnalyser();
        APP.audio.panner = APP.audio.ctx.createPanner();
        APP.audio.compressor = APP.audio.ctx.createDynamicsCompressor();
        APP.audio.masterGain = APP.audio.ctx.createGain();
        
        // 2. Configure the Panner (HRTF is the Pro Standard)
        APP.audio.panner.panningModel = 'HRTF';
        APP.audio.panner.distanceModel = 'inverse';
        APP.audio.panner.refDistance = 1;
        
        // 3. Configure the Broadcast Limiter (The "Dolby" Glue)
        APP.audio.compressor.threshold.setValueAtTime(-18, APP.audio.ctx.currentTime);
        APP.audio.compressor.knee.setValueAtTime(30, APP.audio.ctx.currentTime);
        APP.audio.compressor.ratio.setValueAtTime(12, APP.audio.ctx.currentTime);
        APP.audio.compressor.attack.setValueAtTime(0.003, APP.audio.ctx.currentTime);
        APP.audio.compressor.release.setValueAtTime(0.25, APP.audio.ctx.currentTime);
        
        // 4. Configure Visuals & Headroom
        APP.audio.analyzer.fftSize = 64;
        APP.audio.masterGain.gain.setValueAtTime(0.9, APP.audio.ctx.currentTime);
        
        // 5. THE SERIAL CHAIN (Top-Tier Routing)
        // Source -> Panner -> Compressor -> Gain -> Analyzer -> Destination
        APP.audio.source
            .connect(APP.audio.panner)
            .connect(APP.audio.compressor)
            .connect(APP.audio.masterGain)
            .connect(APP.audio.analyzer)
            .connect(APP.audio.ctx.destination);
        
        APP.audio.vuData = new Uint8Array(APP.audio.analyzer.frequencyBinCount);
        APP.audio.isConnected = true;
        
        // Default position: in front of listener (stereo feel)
        positionAudio(0, 0, -1);
        
        // UI Update
        const vu = $('vu');
        vu.innerHTML = '';
        for (let i = 0; i < 16; i++) {
            const bar = document.createElement('div');
            bar.className = 'vu-bar';
            vu.appendChild(bar);
        }
        
        updateVU();
        log('DAW_ENGINE_ACTIVE');
    } catch (e) { log('AUDIO_CHAIN_ERR: ' + e.message); }
}

function updateVU() {
    requestAnimationFrame(updateVU);
    if (!APP.audio.analyzer || !APP.audio.isPlaying) return;
    
    APP.audio.analyzer.getByteFrequencyData(APP.audio.vuData);
    const bars = $('vu').children;
    
    // Performance: Only update VU bars if they actually exist
    if (bars.length > 0) {
        for (let i = 0; i < bars.length; i++) {
            bars[i].style.height = Math.max(2, (APP.audio.vuData[i * 2] / 255) * 28) + 'px';
        }
    }
    
    const currentBass = (APP.audio.vuData[0] + APP.audio.vuData[1] + APP.audio.vuData[2]) / 3;
    const bassDelta = currentBass - APP.vj.lastBassLevel;
    APP.audio.bassLevel = currentBass;
    
    // SEISMIC ENGINE: Target ONLY the #stage, not the whole body
    if (APP.vj.rumbleEnabled) {
        if (bassDelta > 40 && currentBass > 150) {
            APP.vj.shakeIntensity = Math.min(1, currentBass / 200);
        }
        
        if (APP.vj.shakeIntensity > 0.05) {
            const x = (Math.random() - 0.5) * 20 * APP.vj.shakeIntensity;
            const y = (Math.random() - 0.5) * 15 * APP.vj.shakeIntensity;
            const r = (Math.random() - 0.5) * 4 * APP.vj.shakeIntensity;
            
            // FIX: translate3d triggers the GPU; targeting 'stage' keeps UI stable
            $('stage').style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${r}deg)`;
            APP.vj.shakeIntensity *= 0.88;
        } else {
            APP.vj.shakeIntensity = 0;
            $('stage').style.transform = '';
        }
    }
    
    // PARTY MODE: Optimized skin swapping
    if (APP.vj.uiReactivity) {
        if (bassDelta > 45 && currentBass > 160) {
            // Flash logo without forcing whole-page reflow where possible
            const logo = $('main-logo');
            logo.style.filter = 'brightness(2)';
            setTimeout(() => logo.style.filter = '', 150);
            
            if (bassDelta > 65 && Math.random() > 0.7) {
                const themes = ['cyan', 'magenta', 'gold', 'purple', 'green'];
                const next = themes[Math.floor(Math.random() * themes.length)];
                if (next !== APP.state.theme) setTheme(next);
            }
        }
    }
    
    APP.vj.lastBassLevel = currentBass;
}

function stopAudio() {
    APP.audio.element.pause();
    APP.audio.element.currentTime = 0;
    APP.audio.isPlaying = false;
    $('track-info').textContent = 'NO TRACK';
    log('STOP');
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO OUTPUT DEVICE SELECTION
// ═══════════════════════════════════════════════════════════════════════════
async function enumerateAudioOutputs() {
    try {
        // Silent enumeration - only show full labels if camera already initialized
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        
        const select = $('audio-output');
        select.innerHTML = '<option value="">Default</option>';
        
        outputs.forEach((device, i) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Output ${i + 1}`;
            select.appendChild(option);
        });
        
        log(`OUTPUTS: ${outputs.length}`);
    } catch (e) {
        log('OUTPUT_ENUM_ERR');
    }
}

async function setAudioOutput(deviceId) {
    if (!APP.audio.element.setSinkId) {
        log('SINKID_NOT_SUPPORTED');
        return;
    }
    
    try {
        await APP.audio.element.setSinkId(deviceId || '');
        
        // If we have an AudioContext with destination, we need to inform the user
        // that setSinkId only affects the HTMLAudioElement, not the Web Audio API destination
        // The entire chain (including spatial) flows through the element via MediaElementSource
        
        const label = deviceId ? 
            $('audio-output').options[$('audio-output').selectedIndex].text : 
            'Default';
        log(`OUTPUT: ${label}`);
    } catch (e) {
        log('OUTPUT_ERR: ' + e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTOR MODE (Clean Feed)
// ═══════════════════════════════════════════════════════════════════════════
function openProjector() {
    if (APP.projector.isOpen && APP.projector.window && !APP.projector.window.closed) {
        APP.projector.window.focus();
        return;
    }
    
    // Capture canvas stream at 60fps
    APP.projector.stream = APP.render.canvas.captureStream(60);
    
    // Open clean window
    APP.projector.window = window.open('', 'DRIS_Projector', 
        'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
    
    if (!APP.projector.window) {
        log('PROJECTOR_BLOCKED');
        return;
    }
    
    APP.projector.window.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>DRIS//core PROJECTOR</title>
            <style>
                * { margin: 0; padding: 0; }
                body { background: #000; overflow: hidden; }
                video { width: 100vw; height: 100vh; object-fit: contain; }
            </style>
        </head>
        <body>
            <video id="projector-feed" autoplay muted playsinline></video>
            <script>
                document.getElementById('projector-feed').srcObject = window.opener.APP.projector.stream;
            <\/script>
        </body>
        </html>
    `);
    
    APP.projector.isOpen = true;
    $('btn-projector').classList.add('on');
    
    // Monitor for close
    const checkClosed = setInterval(() => {
        if (APP.projector.window.closed) {
            clearInterval(checkClosed);
            APP.projector.isOpen = false;
            $('btn-projector').classList.remove('on');
            log('PROJECTOR_CLOSED');
        }
    }, 1000);
    
    log('PROJECTOR_OPEN');
}

// ═══════════════════════════════════════════════════════════════════════════
// SPATIAL AUDIO (3D HRTF)
// ═══════════════════════════════════════════════════════════════════════════
function setSpatialMode(mode) {
    if (!APP.audio.ctx || !APP.audio.panner) {
        log('LOAD_AUDIO_FIRST');
        return;
    }
    
    APP.audio.spatialMode = mode;
    
    // Update button states
    $('btn-stereo').classList.toggle('on', mode === 'stereo');
    $('btn-spatial').classList.toggle('on', mode === '3d');
    $('btn-dolby').classList.toggle('on', mode === 'dolby');
    
    const listener = APP.audio.ctx.listener;
    
    switch(mode) {
        case 'stereo':
            // Standard stereo - sound directly in front
            APP.audio.panner.panningModel = 'equalpower';
            positionAudio(0, 0, -1);
            log('MODE: STEREO');
            break;
            
        case '3d':
            // HRTF binaural 3D positioning
            APP.audio.panner.panningModel = 'HRTF';
            APP.audio.panner.distanceModel = 'inverse';
            APP.audio.panner.refDistance = 1;
            APP.audio.panner.maxDistance = 10000;
            APP.audio.panner.rolloffFactor = 1;
            
            // Position listener facing forward
            if (listener.forwardZ) {
                listener.positionX.value = 0;
                listener.positionY.value = 0;
                listener.positionZ.value = 0;
                listener.forwardX.value = 0;
                listener.forwardY.value = 0;
                listener.forwardZ.value = -1;
                listener.upX.value = 0;
                listener.upY.value = 1;
                listener.upZ.value = 0;
            }
            
            positionAudio(0, 0, -2);
            log('MODE: 3D_HRTF');
            break;
            
        case 'dolby':
            // Dolby Atmos simulation - wider soundstage, height cues
            APP.audio.panner.panningModel = 'HRTF';
            APP.audio.panner.distanceModel = 'linear';
            APP.audio.panner.refDistance = 1;
            APP.audio.panner.maxDistance = 100;
            APP.audio.panner.rolloffFactor = 0.5;
            
            // Dolby-style: wider cone for immersive feel
            APP.audio.panner.coneInnerAngle = 360;
            APP.audio.panner.coneOuterAngle = 360;
            APP.audio.panner.coneOuterGain = 1;
            
            // Simulate Atmos "dome" - sound from above and around
            if (listener.forwardZ) {
                listener.positionX.value = 0;
                listener.positionY.value = 0;
                listener.positionZ.value = 0;
                listener.forwardX.value = 0;
                listener.forwardY.value = 0;
                listener.forwardZ.value = -1;
                listener.upX.value = 0;
                listener.upY.value = 1;
                listener.upZ.value = 0;
            }
            
            // Position slightly above and in front (Atmos height channel feel)
            positionAudio(0, 1, -3);
            
            // Boost compressor for Dolby loudness profile
            if (APP.audio.compressor) {
                APP.audio.compressor.threshold.setValueAtTime(-18, APP.audio.ctx.currentTime);
                APP.audio.compressor.ratio.setValueAtTime(8, APP.audio.ctx.currentTime);
            }
            
            log('MODE: DOLBY_ATMOS');
            break;
    }
}

// Legacy toggle function for backward compat
function toggleSpatialAudio() {
    if (APP.audio.spatialMode === '3d') {
        setSpatialMode('stereo');
    } else {
        setSpatialMode('3d');
    }
}

// Position audio in 3D space (x: left/right, y: up/down, z: front/back)
function positionAudio(x, y, z) {
    if (!APP.audio.panner || !APP.audio.spatialEnabled) return;
    
    if (APP.audio.panner.positionX) {
        APP.audio.panner.positionX.setValueAtTime(x, APP.audio.ctx.currentTime);
        APP.audio.panner.positionY.setValueAtTime(y, APP.audio.ctx.currentTime);
        APP.audio.panner.positionZ.setValueAtTime(z, APP.audio.ctx.currentTime);
    } else {
        APP.audio.panner.setPosition(x, y, z);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TIME MACHINE (Rolling 30s Buffer - Pro-Audio Tap)
// ═══════════════════════════════════════════════════════════════════════════
function initTimeMachine() {
    // Create canvas stream at 60fps
    const canvasStream = APP.render.canvas.captureStream(60);
    
    // PRO-AUDIO TAP: Connect directly from masterGain (post Spatial/Dolby/Compressor)
    if (APP.audio.ctx && APP.audio.masterGain) {
        try {
            APP.timeMachine.audioDest = APP.audio.ctx.createMediaStreamDestination();
            APP.audio.masterGain.connect(APP.timeMachine.audioDest);
            
            // Add the processed audio track to canvas stream
            const audioTrack = APP.timeMachine.audioDest.stream.getAudioTracks()[0];
            if (audioTrack) {
                canvasStream.addTrack(audioTrack);
                log('TIMEMACHINE: SPATIAL_AUDIO_LINKED');
            }
        } catch (e) {
            log('TIMEMACHINE: VIDEO_ONLY');
        }
    }
    
    APP.timeMachine.stream = canvasStream;
    
    // CODEC ENFORCEMENT: VP9 video + Opus audio at 8Mbps
    const options = { 
        mimeType: 'video/webm;codecs=vp9,opus', 
        videoBitsPerSecond: 8000000,
        audioBitsPerSecond: 128000
    };
    
    try {
        APP.timeMachine.recorder = new MediaRecorder(canvasStream, options);
    } catch (e) {
        // Fallback if opus not supported
        try {
            APP.timeMachine.recorder = new MediaRecorder(canvasStream, { 
                mimeType: 'video/webm;codecs=vp9',
                videoBitsPerSecond: 8000000 
            });
        } catch (e2) {
            APP.timeMachine.recorder = new MediaRecorder(canvasStream);
        }
    }
    
    APP.timeMachine.chunks = [];
    
    APP.timeMachine.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            APP.timeMachine.chunks.push({ data: e.data, time: Date.now() });
            
            // Prune chunks older than 30s
            const cutoff = Date.now() - APP.timeMachine.maxDuration;
            APP.timeMachine.chunks = APP.timeMachine.chunks.filter(c => c.time > cutoff);
        }
    };
    
    // Record in 1-second intervals for granular buffer
    APP.timeMachine.recorder.start(1000);
    APP.timeMachine.isRecording = true;
    
    log('TIMEMACHINE: ARMED_60FPS');
}

function capture30s() {
    if (!APP.timeMachine.isRecording || APP.timeMachine.chunks.length === 0) {
        // Initialize if not running
        initTimeMachine();
        $('btn-capture30').textContent = 'BUFFERING...';
        setTimeout(() => {
            $('btn-capture30').textContent = 'CAPTURE 30s';
            if (APP.timeMachine.chunks.length > 0) {
                downloadTimeMachine();
            } else {
                log('TIMEMACHINE: NO_DATA');
            }
        }, 2000);
        return;
    }
    
    downloadTimeMachine();
}

function downloadTimeMachine() {
    // VISUAL CONFIRMATION: 200ms white strobe
    sovereignStrobe();
    
    // Combine all chunks
    const blobs = APP.timeMachine.chunks.map(c => c.data);
    const finalBlob = new Blob(blobs, { type: 'video/webm' });
    
    // Download
    const a = document.createElement('a');
    a.href = URL.createObjectURL(finalBlob);
    a.download = `DRIS_TimeMachine_${Date.now()}.webm`;
    a.click();
    
    const duration = Math.round(APP.timeMachine.chunks.length);
    log(`TIMEMACHINE: CAPTURED_${duration}s`);
}

function sovereignStrobe() {
    // Quick white flash on canvas for visual confirmation
    const ctx = APP.render.ctx;
    const w = APP.render.width;
    const h = APP.render.height;
    
    // Store current composite operation
    const prevOp = ctx.globalCompositeOperation;
    
    // Flash white
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(0, 0, w, h);
    
    // Restore after 200ms (render loop will naturally overwrite)
    setTimeout(() => {
        ctx.globalCompositeOperation = prevOp;
    }, 200);
    
    triggerImpact();
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBXR (VR/AR Support)
// ═══════════════════════════════════════════════════════════════════════════
async function initXR() {
    if (!navigator.xr) {
        APP.xr.supported = false;
        return;
    }
    
    try {
        APP.xr.supported = await navigator.xr.isSessionSupported('immersive-vr');
        if (APP.xr.supported) {
            $('btn-enter-vr').style.display = 'block';
            log('VR_AVAILABLE');
        }
    } catch (e) {
        APP.xr.supported = false;
    }
}

async function enterVR() {
    // Init XR on first click (avoids permission prompt at startup)
    if (!APP.xr.checked) {
        await initXR();
        APP.xr.checked = true;
    }
    
    if (!APP.xr.supported) {
        log('VR_NOT_SUPPORTED');
        return;
    }
    
    try {
        APP.xr.session = await navigator.xr.requestSession('immersive-vr', {
            requiredFeatures: ['local-floor']
        });
        
        APP.xr.session.addEventListener('end', () => {
            APP.xr.session = null;
            $('btn-enter-vr').classList.remove('on');
            log('VR_EXIT');
        });
        
        $('btn-enter-vr').classList.add('on');
        
        // Get reference space
        APP.xr.refSpace = await APP.xr.session.requestReferenceSpace('local-floor');
        
        // Create XR-compatible WebGL2 context
        const gl = APP.render.canvas.getContext('webgl2', { xrCompatible: true });
        APP.xr.gl = gl;
        
        if (gl) {
            const baseLayer = new XRWebGLLayer(APP.xr.session, gl);
            APP.xr.session.updateRenderState({ baseLayer });
            
            // Initialize VJ Texture for streaming canvas
            APP.xr.vjTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, APP.xr.vjTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            
            // Create 16:9 quad vertices (3m back, eye level 1.6m)
            // Screen size: ~5.33m x 3m (cinema scale)
            const quadVerts = new Float32Array([
                // Position (x,y,z), TexCoord (u,v)
                -2.67, 3.1, -3,   0, 0,  // Top-left
                 2.67, 3.1, -3,   1, 0,  // Top-right
                -2.67, 0.1, -3,   0, 1,  // Bottom-left
                 2.67, 0.1, -3,   1, 1   // Bottom-right
            ]);
            
            APP.xr.quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, APP.xr.quadBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
            
            // SOVEREIGN SHADER: Vertex shader
            const vsSource = `
                attribute vec3 aPosition;
                attribute vec2 aTexCoord;
                uniform mat4 uProjection;
                uniform mat4 uView;
                varying vec2 vTexCoord;
                void main() {
                    gl_Position = uProjection * uView * vec4(aPosition, 1.0);
                    vTexCoord = aTexCoord;
                }
            `;
            
            // SOVEREIGN SHADER: Fragment shader
            const fsSource = `
                precision mediump float;
                uniform sampler2D uTexture;
                varying vec2 vTexCoord;
                void main() {
                    gl_FragColor = texture2D(uTexture, vTexCoord);
                }
            `;
            
            // Compile shaders
            const vs = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vs, vsSource);
            gl.compileShader(vs);
            
            const fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, fsSource);
            gl.compileShader(fs);
            
            // Link program
            APP.xr.shaderProgram = gl.createProgram();
            gl.attachShader(APP.xr.shaderProgram, vs);
            gl.attachShader(APP.xr.shaderProgram, fs);
            gl.linkProgram(APP.xr.shaderProgram);
            
            // Get attribute/uniform locations
            APP.xr.aPosition = gl.getAttribLocation(APP.xr.shaderProgram, 'aPosition');
            APP.xr.aTexCoord = gl.getAttribLocation(APP.xr.shaderProgram, 'aTexCoord');
            APP.xr.uProjection = gl.getUniformLocation(APP.xr.shaderProgram, 'uProjection');
            APP.xr.uView = gl.getUniformLocation(APP.xr.shaderProgram, 'uView');
            APP.xr.uTexture = gl.getUniformLocation(APP.xr.shaderProgram, 'uTexture');
            
            // Lock broadcast compressor for visor density
            if (APP.audio.compressor) {
                APP.audio.compressor.threshold.setValueAtTime(-18, APP.audio.ctx.currentTime);
            }
            
            // Position Dolby audio listener at eye level
            if (APP.audio.ctx && APP.audio.ctx.listener) {
                const listener = APP.audio.ctx.listener;
                if (listener.positionX) {
                    listener.positionX.value = 0;
                    listener.positionY.value = 1.6;
                    listener.positionZ.value = 0;
                }
            }
            
            // Start XR render loop
            APP.xr.session.requestAnimationFrame(xrRenderLoop);
            log('VR_WEBGL_BRIDGE_ACTIVE');
        }
        
        log('VR_ENTER');
    } catch (e) {
        log('VR_ERROR: ' + e.message);
    }
}

function xrRenderLoop(time, frame) {
    if (!APP.xr.session) return;
    
    APP.xr.session.requestAnimationFrame(xrRenderLoop);
    
    const pose = frame.getViewerPose(APP.xr.refSpace);
    if (!pose) return;
    
    const glLayer = APP.xr.session.renderState.baseLayer;
    const gl = APP.xr.gl;
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Stream VJ canvas to texture
    if (APP.xr.vjTexture) {
        gl.bindTexture(gl.TEXTURE_2D, APP.xr.vjTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, APP.render.canvas);
    }
    
    // Use Sovereign Shader
    gl.useProgram(APP.xr.shaderProgram);
    
    // Bind VJ texture to unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, APP.xr.vjTexture);
    gl.uniform1i(APP.xr.uTexture, 0);
    
    // Setup vertex attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, APP.xr.quadBuffer);
    
    // Position attribute (3 floats, stride 20 bytes, offset 0)
    gl.enableVertexAttribArray(APP.xr.aPosition);
    gl.vertexAttribPointer(APP.xr.aPosition, 3, gl.FLOAT, false, 20, 0);
    
    // TexCoord attribute (2 floats, stride 20 bytes, offset 12)
    gl.enableVertexAttribArray(APP.xr.aTexCoord);
    gl.vertexAttribPointer(APP.xr.aTexCoord, 2, gl.FLOAT, false, 20, 12);
    
    // Render floating cinema screen for each eye
    for (const view of pose.views) {
        const viewport = glLayer.getViewport(view);
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        
        // Set projection and view matrices from XR pose
        gl.uniformMatrix4fv(APP.xr.uProjection, false, view.projectionMatrix);
        gl.uniformMatrix4fv(APP.xr.uView, false, view.transform.inverse.matrix);
        
        // DRAW THE QUAD: 4 vertices as triangle strip
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    // Cleanup
    gl.disableVertexAttribArray(APP.xr.aPosition);
    gl.disableVertexAttribArray(APP.xr.aTexCoord);
}

// ═══════════════════════════════════════════════════════════════════════════
// MASTER RESET
// ═══════════════════════════════════════════════════════════════════════════
function masterReset() {
    document.body.classList.remove('vhs', 'crt');
    $('btn-vhs').classList.remove('on');
    $('btn-crt').classList.remove('on');
    
    APP.vj = {
        brightness: 1.0, contrast: 1.0, saturation: 1.0, hue: 0,
        trailsEnabled: false, trailAlpha: 0.92,
        rgbEnabled: false, rgbIntensity: 0, rgbBassLink: false,
        pixelateEnabled: false, pixelSize: 1,
        rumbleEnabled: false, invert: false, uiReactivity: true
    };
    
    $('sl-b').value = 100; $('val-b').textContent = '100%';
    $('sl-c').value = 100; $('val-c').textContent = '100%';
    $('sl-s').value = 100; $('val-s').textContent = '100%';
    $('sl-h').value = 0; $('val-h').textContent = '0°';
    $('sl-trail').value = 92; $('val-trail').textContent = '0.92';
    $('sl-rgb').value = 0; $('val-rgb').textContent = '0';
    $('sl-pix').value = 1; $('val-pix').textContent = '1';
    
    ['btn-trails', 'btn-rgb', 'btn-pixelate', 'btn-bass-link', 'btn-rumble', 'btn-ui-react'].forEach(id => $(id).classList.remove('on'));
    
    triggerImpact();
    log('MASTER_RESET');
}

// ═══════════════════════════════════════════════════════════════════════════
// UI CONTROLS
// ═══════════════════════════════════════════════════════════════════════════
function setTheme(theme) {
    document.body.className = document.body.className.replace(/theme-\w+/g, '');
    if (theme !== 'cyan') document.body.classList.add(`theme-${theme}`);
    APP.state.theme = theme;
    document.querySelectorAll('.pal').forEach(p => p.classList.toggle('on', p.dataset.t === theme));
    log(`THEME: ${theme}`);
}

function toggleVHS() { document.body.classList.toggle('vhs'); $('btn-vhs').classList.toggle('on'); log('VHS'); }
function toggleCRT() { document.body.classList.toggle('crt'); $('btn-crt').classList.toggle('on'); log('CRT'); }

function toggleFullscreen() {
    APP.state.isFullscreen = !APP.state.isFullscreen;
    document.body.classList.toggle('fullscreen', APP.state.isFullscreen);
    $('btn-fs').classList.toggle('on', APP.state.isFullscreen);
    log('FULLSCREEN');
}

function morphLogo() {
    const logo = $('main-logo');
    APP.ui.morphs.forEach(m => logo.classList.remove(m));
    APP.ui.logoMorph = (APP.ui.logoMorph + 1) % APP.ui.morphs.length;
    logo.classList.add(APP.ui.morphs[APP.ui.logoMorph]);
    setTimeout(morphLogo, 4000);
}

function updateClock() {
    $('clock').textContent = new Date().toTimeString().split(' ')[0];
    const s = Math.floor((Date.now() - APP.state.startTime) / 1000);
    $('uptime').textContent = `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

async function fetchCrypto() {
    try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd');
        const data = await res.json();
        const fmt = n => n >= 1000 ? (n/1000).toFixed(1) + 'K' : n.toFixed(0);
        
        // Track price direction
        const btc = data.bitcoin.usd;
        const eth = data.ethereum.usd;
        const sol = data.solana.usd;
        
        const btcDir = btc > APP.state.lastPrices.btc ? '▲' : btc < APP.state.lastPrices.btc ? '▼' : '';
        const ethDir = eth > APP.state.lastPrices.eth ? '▲' : eth < APP.state.lastPrices.eth ? '▼' : '';
        const solDir = sol > APP.state.lastPrices.sol ? '▲' : sol < APP.state.lastPrices.sol ? '▼' : '';
        
        const btcColor = btc >= APP.state.lastPrices.btc ? 'var(--g)' : 'var(--r)';
        const ethColor = eth >= APP.state.lastPrices.eth ? 'var(--g)' : 'var(--r)';
        const solColor = sol >= APP.state.lastPrices.sol ? 'var(--g)' : 'var(--r)';
        
        // Store for next comparison
        APP.state.lastPrices = { btc, eth, sol };
        
        // Build HTML with colored prices
        $('ticker-crypto').innerHTML = 
            `<span style="color:${btcColor}">BTC $${fmt(btc)}${btcDir}</span> | ` +
            `<span style="color:${ethColor}">ETH $${fmt(eth)}${ethDir}</span> | ` +
            `<span style="color:${solColor}">SOL $${fmt(sol)}${solDir}</span>`;
    } catch(e) {}
}

function saveSession() {
    localStorage.setItem('dris_v22', JSON.stringify({ 
        theme: APP.state.theme, 
        vj: APP.vj, 
        bug: APP.bug 
    }));
    log('SESSION_SAVED');
}

function loadSession() {
    const rawData = localStorage.getItem('dris_v22');
    if (!rawData) return;

    try {
        const data = JSON.parse(rawData);
        
        // 1. Apply Logic Data
        if (data.theme) setTheme(data.theme);
        if (data.vj) Object.assign(APP.vj, data.vj);
        if (data.bug) Object.assign(APP.bug, data.bug);

        // 2. Sync UI Sliders & Text
        const sliders = { 'sl-b': 'brightness', 'sl-c': 'contrast', 'sl-s': 'saturation' };
        Object.entries(sliders).forEach(([id, prop]) => {
            if ($(id)) {
                $(id).value = APP.vj[prop] * 100;
                $(`val-${id.split('-')[1]}`).textContent = Math.round(APP.vj[prop] * 100) + '%';
            }
        });
        
        $('sl-h').value = APP.vj.hue;
        $('val-h').textContent = APP.vj.hue + '°';

        // 3. Sync UI Buttons
        $('btn-trails')?.classList.toggle('on', APP.vj.trailsEnabled);
        $('btn-rgb')?.classList.toggle('on', APP.vj.rgbEnabled);
        $('btn-pixelate')?.classList.toggle('on', APP.vj.pixelateEnabled);
        $('btn-rumble')?.classList.toggle('on', APP.vj.rumbleEnabled);
        $('btn-ui-react')?.classList.toggle('on', APP.vj.uiReactivity);

        updateBug();
        log('SESSION_LOAD_OK');
        triggerImpact(); // Visual confirmation
    } catch (e) {
        log('LOAD_ERR: DATA_CORRUPT');
    }
}

// Add this so you can actually use the .vgd files you export
function importVGD(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            // Save to localStorage so loadSession can pick it up
            localStorage.setItem('dris_v22', JSON.stringify(data));
            loadSession(); 
            log('VGD_DNA_INJECTED');
        } catch (err) {
            log('VGD_IMPORT_ERR');
        }
    };
    reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════════════════════════
// VGD DNA SERIALIZATION (.vgd Session Export)
// ═══════════════════════════════════════════════════════════════════════════
function exportDNA() {
    const dna = {
        version: 'VNGRD_22.1',
        timestamp: Date.now(),
        theme: APP.state.theme,
        vj: { ...APP.vj },
        bug: { ...APP.bug },
        media: APP.media.queue.map(item => ({
            name: item.name,
            type: item.type
        })),
        audio: {
            spatialMode: APP.audio.spatialMode,
            playlist: APP.audio.playlist.map(item => item.name || 'Unknown')
        },
        state: {
            isCycle: APP.state.isCycle
        }
    };
    
    const blob = new Blob([JSON.stringify(dna, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `SESSION_${Date.now()}.vgd`;
    a.click();
    URL.revokeObjectURL(a.href);
    
    log('DNA_EXPORTED');
    return dna;
}

// Assign to APP.state for API access
APP.state.exportDNA = exportDNA;

// ═══════════════════════════════════════════════════════════════════════════
// WEBRTC GUEST MODULE (PeerJS Bridge)
// ═══════════════════════════════════════════════════════════════════════════
function initGuest(peerId) {
    if (!window.Peer) {
        log('PEERJS_NOT_LOADED');
        $('peer-id-display').value = 'PeerJS not loaded';
        return;
    }
    
    APP.guest.peer = new Peer(peerId);
    
    APP.guest.peer.on('open', id => {
        APP.guest.peerId = id;
        $('peer-id-display').value = id;
        $('guest-dot').classList.add('on');
        log(`GUEST_PEER_ID: ${id}`);
    });
    
    APP.guest.peer.on('call', call => {
        // Answer incoming call with empty stream (receive-only)
        call.answer();
        
        call.on('stream', remoteStream => {
            APP.guest.stream = remoteStream;
            APP.guest.isActive = true;
            
            // Pipe remote audio into -18dB compressor chain
            if (APP.audio.ctx && APP.audio.compressor) {
                APP.guest.audioSource = APP.audio.ctx.createMediaStreamSource(remoteStream);
                APP.guest.audioSource.connect(APP.audio.compressor);
                log('GUEST_AUDIO_LINKED_18dB');
            }
            
            log('GUEST_STREAM_ACTIVE');
        });
        
        call.on('close', () => {
            disconnectGuest();
        });
    });
    
    APP.guest.peer.on('error', err => {
        $('peer-id-display').value = 'Error: ' + err.type;
        $('guest-dot').classList.remove('on');
        log('GUEST_ERROR: ' + err.type);
    });
}

function connectToGuest(remotePeerId) {
    if (!APP.guest.peer) {
        log('INIT_PEER_FIRST');
        return;
    }
    
    // Request remote stream
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(localStream => {
            const call = APP.guest.peer.call(remotePeerId, localStream);
            
            call.on('stream', remoteStream => {
                APP.guest.stream = remoteStream;
                APP.guest.isActive = true;
                
                // Pipe remote audio into -18dB compressor chain
                if (APP.audio.ctx && APP.audio.compressor) {
                    APP.guest.audioSource = APP.audio.ctx.createMediaStreamSource(remoteStream);
                    APP.guest.audioSource.connect(APP.audio.compressor);
                    log('GUEST_AUDIO_LINKED_18dB');
                }
                
                log('GUEST_CONNECTED');
            });
        })
        .catch(err => log('GUEST_MEDIA_ERR'));
}

function disconnectGuest() {
    if (APP.guest.stream) {
        APP.guest.stream.getTracks().forEach(t => t.stop());
        APP.guest.stream = null;
    }
    if (APP.guest.videoElement) {
        APP.guest.videoElement.srcObject = null;
        APP.guest.videoElement = null;
    }
    if (APP.guest.audioSource) {
        APP.guest.audioSource.disconnect();
        APP.guest.audioSource = null;
    }
    if (APP.guest.connection) {
        APP.guest.connection.close();
        APP.guest.connection = null;
    }
    APP.guest.isActive = false;
    log('GUEST_DISCONNECTED');
}

// Assign to APP.guest for API access
APP.guest.init = initGuest;
APP.guest.connect = connectToGuest;
APP.guest.disconnect = disconnectGuest;

// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN SECURITY (The Wipe)
// ═══════════════════════════════════════════════════════════════════════════
function sovereignPurge() {
    // 1. Revoke all media URLs
    APP.media.queue.forEach(item => {
        if (item.url) URL.revokeObjectURL(item.url);
        if (item.element?.tagName === 'VIDEO') {
            item.element.pause();
            item.element.src = '';
            item.element.remove();
        }
    });
    APP.media.queue = [];
    APP.media.currentIndex = -1;
    APP.media.currentElement = null;
    
    // 2. Revoke audio playlist URLs
    APP.audio.playlist.forEach(item => {
        if (item.url) URL.revokeObjectURL(item.url);
    });
    APP.audio.playlist = [];
    if (APP.audio.element) {
        APP.audio.element.pause();
        APP.audio.element.src = '';
    }
    
    // 3. Stop guest stream
    disconnectGuest();
    if (APP.guest.peer) {
        APP.guest.peer.destroy();
        APP.guest.peer = null;
    }
    
    // 4. Stop camera
    if (APP.camera.stream) {
        APP.camera.stream.getTracks().forEach(t => t.stop());
        APP.camera.stream = null;
    }
    
    // 5. Stop time machine
    if (APP.timeMachine.recorder && APP.timeMachine.isRecording) {
        APP.timeMachine.recorder.stop();
        APP.timeMachine.isRecording = false;
    }
    APP.timeMachine.chunks = [];
    
    // 6. Delete IndexedDB databases
    if (indexedDB.databases) {
        indexedDB.databases().then(dbs => {
            dbs.forEach(db => indexedDB.deleteDatabase(db.name));
        });
    }
    
    // 7. Clear localStorage
    localStorage.removeItem('dris_v22');
    
    // 8. Reset UI
    updateQueueDisplay();
    $('media-dot').classList.add('off');
    $('track-info').textContent = 'NO TRACK';
    
    // Visual confirmation
    sovereignStrobe();
    log('SOVEREIGN_PURGE_COMPLETE');
}

// Assign to APP.security
APP.security.purge = sovereignPurge;

// ═══════════════════════════════════════════════════════════════════════════
// HARDWARE LOCK (Sovereign App Behavior)
// ═══════════════════════════════════════════════════════════════════════════
window.oncontextmenu = (e) => e.preventDefault();

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    log('DRIS//core_VNGRD_v22.1');
    log('HYBRID_BROADCAST_MONSTER');
    
    checkMobile();
    initCanvas();
    
    APP.render.lastFpsUpdate = performance.now();
    requestAnimationFrame(renderLoop);
    
    updateClock();
    setInterval(updateClock, 1000);
    morphLogo();
    updateBug();
    
    // Logo click
    $('main-logo').onclick = () => {
        // ALWAYS trigger shock flash on logo click
        document.body.classList.remove('logo-flash');
        void document.body.offsetWidth; // Force reflow for rapid clicks
        document.body.classList.add('logo-flash');
        setTimeout(() => document.body.classList.remove('logo-flash'), 400);
        
        // Cycle logo morph style
        const logo = $('main-logo');
        APP.ui.morphs.forEach(m => logo.classList.remove(m));
        logo.classList.add(APP.ui.morphs[Math.floor(Math.random() * APP.ui.morphs.length)]);
    };
    
    // Camera
    $('btn-init-cam').onclick = initCamera;
    $('btn-go-live').onclick = goLive;
    $('btn-end').onclick = endLive;
    $('btn-rec').onclick = toggleRec;
    $('btn-mic').onclick = toggleMic;
    $('btn-clip').onclick = clip10s;
    $('btn-kill').onclick = killCamera;
    
    // Media
    $('btn-media').onclick = () => $('file-media').click();
    $('file-media').onchange = e => loadMediaFiles(e.target);
    $('btn-rotate').onclick = rotateMedia;
    $('btn-prev').onclick = previousMedia;
    $('btn-cycle').onclick = toggleCycle;
    
    // Command Center
    $('btn-eject').onclick = ejectCurrent;
    $('btn-master-reset').onclick = masterReset;
    $('btn-purge').onclick = () => { if (confirm('PURGE ALL media and audio?')) purgeAll(); };
    
    // Lower Thirds
    $('btn-lt-guest').onclick = () => showLowerThird('guest');
    $('btn-lt-track').onclick = () => showLowerThird('track');
    $('btn-lt-breaking').onclick = () => showLowerThird('breaking');
    $('btn-lt-off').onclick = hideLowerThird;
    $('lt-title').oninput = e => { if (APP.lowerThird.visible) $('lt-title-text').textContent = e.target.value; };
    $('lt-sub').oninput = e => { if (APP.lowerThird.visible) $('lt-subtitle-text').textContent = e.target.value; };
    
    // Station Bug
    $('btn-upload-logo').onclick = () => $('file-logo').click();
    $('btn-clear-logo').onclick = () => { 
        APP.bug.image = null; 
        APP.bug.text = 'DRIS//core';
        $('bug-text').value = 'DRIS//core';
        updateBug(); 
        log('LOGO_RESET'); 
    };
    $('file-logo').onchange = e => loadLogoFile(e.target);
    $('bug-text').oninput = e => { APP.bug.text = e.target.value; APP.bug.image = null; updateBug(); };
    $('btn-bug-toggle').onclick = toggleBug;
    
    // Station bug drag
    $('station-bug').addEventListener('mousedown', e => {
        bugDragging = true;
        bugOffsetX = e.offsetX;
        bugOffsetY = e.offsetY;
        $('station-bug').style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', e => {
        if (!bugDragging) return;
        const stage = $('stage').getBoundingClientRect();
        const x = e.clientX - stage.left - bugOffsetX;
        const y = e.clientY - stage.top - bugOffsetY;
        $('station-bug').style.left = Math.max(0, x) + 'px';
        $('station-bug').style.top = Math.max(0, y) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (bugDragging) {
            bugDragging = false;
            $('station-bug').style.cursor = 'move';
        }
    });
    
    // Audio
    $('btn-audio').onclick = () => { $('file-audio').click(); };
    $('file-audio').onchange = e => loadAudioFiles(e.target);
    $('btn-next-track').onclick = playTrack;
    $('btn-stop').onclick = stopAudio;
    
    // Impact FX
    $('btn-stutter').onclick = impactStutter;
    $('btn-invert').onclick = impactInvert;
    $('btn-crush').onclick = impactCrush;
    $('btn-rumble').onclick = () => { APP.vj.rumbleEnabled = !APP.vj.rumbleEnabled; $('btn-rumble').classList.toggle('on'); log('SEISMIC_' + (APP.vj.rumbleEnabled ? 'ON' : 'OFF')); };
    $('btn-ui-react').onclick = () => { APP.vj.uiReactivity = !APP.vj.uiReactivity; $('btn-ui-react').classList.toggle('on'); log('PARTY_MODE_' + (APP.vj.uiReactivity ? 'ON' : 'OFF')); };
    
    // VJ sliders
    $('sl-b').oninput = e => { APP.vj.brightness = e.target.value / 100; $('val-b').textContent = e.target.value + '%'; };
    $('sl-c').oninput = e => { APP.vj.contrast = e.target.value / 100; $('val-c').textContent = e.target.value + '%'; };
    $('sl-s').oninput = e => { APP.vj.saturation = e.target.value / 100; $('val-s').textContent = e.target.value + '%'; };
    $('sl-h').oninput = e => { APP.vj.hue = parseInt(e.target.value); $('val-h').textContent = e.target.value + '°'; };
    
    // Canvas FX
    $('btn-trails').onclick = () => { APP.vj.trailsEnabled = !APP.vj.trailsEnabled; $('btn-trails').classList.toggle('on'); };
    $('btn-rgb').onclick = () => { APP.vj.rgbEnabled = !APP.vj.rgbEnabled; $('btn-rgb').classList.toggle('on'); };
    $('btn-pixelate').onclick = () => { APP.vj.pixelateEnabled = !APP.vj.pixelateEnabled; $('btn-pixelate').classList.toggle('on'); };
    $('btn-bass-link').onclick = () => { APP.vj.rgbBassLink = !APP.vj.rgbBassLink; $('btn-bass-link').classList.toggle('on'); };
    $('sl-trail').oninput = e => { APP.vj.trailAlpha = parseInt(e.target.value) / 100; $('val-trail').textContent = (e.target.value / 100).toFixed(2); };
    $('sl-rgb').oninput = e => { APP.vj.rgbIntensity = parseInt(e.target.value); $('val-rgb').textContent = e.target.value; };
    $('sl-pix').oninput = e => { APP.vj.pixelSize = parseInt(e.target.value); $('val-pix').textContent = e.target.value; };
    
    // Overlays
    $('btn-vhs').onclick = toggleVHS;
    $('btn-crt').onclick = toggleCRT;
    $('btn-reset').onclick = masterReset;
    $('btn-fs').onclick = toggleFullscreen;
    
    // Theme
    document.querySelectorAll('.pal').forEach(p => p.onclick = () => setTheme(p.dataset.t));
    
    // --- STEP 1: SESSION WIRING (CLEANED) ---
    $('btn-save').onclick = saveSession;
    
    // Create the hidden VGD file input
    const vgdInput = document.createElement('input');
    vgdInput.type = 'file';
    vgdInput.accept = '.vgd';
    vgdInput.style.display = 'none';
    vgdInput.onchange = e => importVGD(e.target);
    document.body.appendChild(vgdInput);

    // LEFT CLICK: Open File Browser (Sovereign Portability)
    $('btn-load').onclick = () => vgdInput.click(); 
    
    // RIGHT CLICK: Load from Browser Memory (Internal Persistence)
    $('btn-load').oncontextmenu = (e) => { 
        e.preventDefault(); 
        loadSession(); 
    };

    $('btn-export-dna').onclick = exportDNA;
    $('btn-projector').onclick = openProjector;
    $('btn-capture30').onclick = capture30s;
    $('btn-enter-vr').onclick = enterVR;
    
    // P2P Guest Module Bindings
    $('btn-init-peer').onclick = () => {
        const peerId = 'DRIS_' + Math.random().toString(36).substr(2, 8).toUpperCase();
        initGuest(peerId);
        $('peer-id-display').value = 'Connecting...';
    };
    
    $('btn-connect-guest').onclick = () => {
        const remoteId = $('remote-peer-id').value.trim();
        if (remoteId) {
            APP.guest.connect(remoteId);
            $('guest-dot').classList.add('on');
        } else {
            log('ENTER_REMOTE_ID');
        }
    };
    
    $('btn-disconnect-guest').onclick = () => {
        disconnectGuest();
        $('guest-dot').classList.remove('on');
        $('peer-id-display').value = '';
    };
    $('btn-stereo').onclick = () => setSpatialMode('stereo');
    $('btn-spatial').onclick = () => setSpatialMode('3d');
    $('btn-dolby').onclick = () => setSpatialMode('dolby');
    $('audio-output').onchange = e => setAudioOutput(e.target.value);
    
    // Keyboard
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT') return;
        switch (e.key) {
            case ' ': e.preventDefault(); rotateMedia(); break;
            case 'Escape': masterReset(); break;
            case 'h': case 'H': toggleFullscreen(); break;
            case 'b': case 'B': toggleBug(); break;
            case 'v': case 'V': toggleVHS(); break;
            case 'c': case 'C': toggleCRT(); break;
            case 't': case 'T': APP.vj.trailsEnabled = !APP.vj.trailsEnabled; $('btn-trails').classList.toggle('on'); break;
            case 'r': case 'R': APP.vj.rgbEnabled = !APP.vj.rgbEnabled; $('btn-rgb').classList.toggle('on'); break;
            case 'p': case 'P': previousMedia(); break;
            case '1': impactStutter(); break;
            case '2': impactInvert(); break;
            case '3': impactCrush(); break;
        }
    });
    
    fetchCrypto();
    setInterval(fetchCrypto, 60000);
    loadSession();
    
    // Initialize XR (check for VR support)
    // XR, Audio outputs, and TimeMachine init on-demand (no permission prompts at startup)
    
    log('INIT_OK');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // MATERIAL BLUR REVEAL
    // ═══════════════════════════════════════════════════════════════════════════
    const blurReveal = $('blur-reveal');
    if (blurReveal) {
        setTimeout(() => blurReveal.remove(), 600);
    }
    log('SOVEREIGN_CORE_ONLINE');
});
