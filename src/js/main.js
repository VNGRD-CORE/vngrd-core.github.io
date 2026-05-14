const $ = id => document.getElementById(id);

function takeScreenshot() {
    if (!APP.render || !APP.render.canvas) {
        typeof ghostLog === 'function' && ghostLog('SNAP_ERR: canvas not ready', 'crit');
        return;
    }
    try {
        var dataUrl = APP.render.canvas.toDataURL('image/png');
        APP.nft.dnaSnapshot = dataUrl;
        var a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'VNGRD_SNAP_' + Date.now() + '.png';
        a.click();
        var snapBtn = document.getElementById('btn-snapshot');
        if (snapBtn) { snapBtn.classList.add('snap-flash'); setTimeout(() => snapBtn.classList.remove('snap-flash'), 600); }
        typeof ghostLog === 'function' && ghostLog('SNAPSHOT_SAVED // ' + (dataUrl.length / 1024).toFixed(0) + 'KB PNG', 'success');
    } catch (err) {
        typeof ghostLog === 'function' && ghostLog('SNAPSHOT_ERROR: ' + err.message, 'crit');
    }
}

// --- KILL SWITCH ---
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (e.shiftKey) { takeScreenshot(); } else { log('SYS: SAVE_DISABLED'); }
    }
});
document.ondragstart = function() { return false; };

// ══════════════════════════════════════════════════
// CACHE BUSTER — forces browser to load new logic
// ══════════════════════════════════════════════════
window.VANGUARD_VERSION = '1.0.1';
window.VANGUARD_BUILD = '2026-02-09T' + Date.now();
console.log('[VNGRD] Version ' + window.VANGUARD_VERSION + ' build ' + window.VANGUARD_BUILD);

const APP = {
    state: { isLive: false, isRecording: false, isFullscreen: false, isCycle: false, cycleTimer: null, isMobile: false, theme: 'cyan', startTime: Date.now(), psychosis: false, showMediaStrips: true, activeSource: 'local' },
    vj: { 
        brightness: 1.0, contrast: 1.0, saturation: 1.0, hue: 0, trailsEnabled: false, trailAlpha: 0.92, rgbEnabled: false, rgbIntensity: 0, rgbBassLink: false, pixelateEnabled: false, pixelSize: 1, rumbleEnabled: false, invert: false, uiReactivity: false, shakeIntensity: 0, shockwave: 0, lastBassLevel: 0, avgVol: 0, maskMode: false, glitchSnap: 0,
        seismicVelocity: 0, seismicPosition: 0, springConstant: 0.8, damping: 0.9
    },
    media: { queue: [], currentIndex: -1, currentElement: null, _tx: null, audioSync: false, _activeSeam: -1, _seamOpen: false, _seamExpandH: 0, _seamGlitchT: 0, _durDragging: false, _durDragZone: null },
    fx: { stutter: false, crush: false, invert: false, echo: false, rgbSplit: 0, freezeFrame: null },
    audio: { ctx: null, analyzer: null, source: null, element: null, playlist: [], currentTrack: -1, currentTrackName: '', bassLevel: 0, vuData: new Uint8Array(32), isPlaying: false, isConnected: false, videoSource: null, videoMuted: false, videoGain: null, spatialMode: 'stereo', panner: null, compressor: null, masterGain: null, lowShelf: null, highShelf: null, spatialInterval: null, recorderDest: null },

    nft: { recorder: null, chunks: [], isRecording: false, startTime: 0, duration: 30000, dnaSnapshot: null, audioDest: null },
    broadcast: { recorder: null, chunks: [], isRecording: false },
    loop: { recorder: null, chunks: [], activeUrl: null, timer: null, counter: 10 },
    guest: { peer: null, connection: null, stream: null, videoElement: null, audioSource: null, isActive: false, peerId: null },
    peer: { peer: null, call: null, localStream: null, isSyncing: false },
    wallet: { connected: false, address: null, chainId: null, nfts: [] },
    user: { assets: [] },
    nftVault: { thumbnails: [], scrollOffset: 0 },
    camera: { stream: null, recorder: null, chunks: [], mode: 'off', isRecording: false, videoEl: null, previewEl: null, micStream: null },
    render: { canvas: null, ctx: null, width: 3840, height: 2160, fps: 0, frameCount: 0, lastTime: 0, lastFpsUpdate: 0, rafId: null, scale: 1.0, pixelCanvas: null, pixelCtx: null, rgbActive: false, source: null },
    bug: { visible: true, text: 'VNGRD', style: 'plain', color: '#ffffff', mode: 'solid', image: null, textMode: 0, textVisible: true, imageVisible: false, p2pText: '', p2pVisible: false },
    layers: { logoScale: 1.0, logoSrc: null, bugScale: 1.0 },
    // IDENTITY TRINITY — three independent broadcast actors
    trinity: {
        bug:  { x: 0.015, y: 0.015, scale: 1.5, visible: true },
        logo: { x: 0.85,  y: 0.015, scale: 1.0, visible: false },
        logo3d: { x: 0.40, y: 0.015, scale: 2.0, visible: false },
    },
    lowerThird: { visible: false, preset: 'guest', mode: 'guest', ltStyle: 'default', ltColor: null, _showTime: 0, _hiding: false, _hideStart: 0 },
    ui: { logoMorph: 0, morphs: ['m1','m2','m3','m4','m5','m6'] },
    ghost: { seismicEnergy: 0, nodesSecured: 0, directoryHandle: null },
    crypto: { ids: 'bitcoin,ethereum,solana,dogecoin' },
    // WEAPON_STATE_ISOLATION + STRUCTURAL_INTEGRITY
    shooting: { 
        active: false, bullets: [], audioCtx: null, 
        machineGunInterval: null, fractures: [], dents: [],
        lastX: 0, lastY: 0, tinkBuffer: null,
        lastFireTime: 0, fireThrottle: 100,
        repairTimer: null
    },
    glassIntegrity: 100,
    lensShattered: false,
    // MIDI_HOST + LEARN MODE + INSTRUMENT PASSTHROUGH
    midi: {
        access: null, inputs: [], outputs: [],
        learnMode: false, learnTarget: null,
        bindings: {}, // { noteOrCC: { element, target, type } }
        passthrough: false,
        synthCtx: null, synthOsc: null, synthGain: null
    },
    // Phase 1: Compositor (Iron-Clad Recorder Engine)
    compositor: null,
    // Phase 3: Web3 Sovereign DNA
    web3: { provider: null, signer: null, address: null, isConnected: false, mode: 'guest' },
    // Phase 5: Layer Saver
    layerSaver: { textureReady: false, fontReady: false, audioReady: false, allReady: false },
    vr: null,
    // PRO-AUDIO: 48kHz RAW
    inputDevices: { 
        list: [], selectedId: null, stream: null, analyzer: null,
        sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false
    },
    // TRANSUDATE_ATMOSPHERE_ENGINE
    atmosphere: { 
        voiceReact: false, intensity: 50, heatIntensity: 0,
        rainDrops: [], rainInterval: null,
        canvas: null, ctx: null, temperature: null,
        latitude: null, longitude: null, city: 'UNKNOWN', country: '',
        weatherCode: null, metar: '', isRaining: false,
        refractionCanvas: null, refractionCtx: null,
        midiOverride: false
    },


    // LEXICA_NANO

    // JIT STATE TRACKER — prevents double-boot of subsystems
    status: { is3DActive: false, isMidiActive: false, isAudioActive: false, booted: false }
};

// ═══════════════════════════════════════════════════════════════════
// JIT BOOT SEQUENCE — cascading sysLog on load
// ═══════════════════════════════════════════════════════════════════
function bootSequence() {
    if (APP.status.booted) return;
    APP.status.booted = true;
    var msgs = [
        'SYS: CORE ONLINE',
        'SYS: CANVAS COMPOSITOR [STANDBY]',
        'SYS: 3D ENGINE [STANDBY]',
        'SYS: MIDI INTERFACE [STANDBY]',
        'SYS: AI GENERATOR [STANDBY]',
        'SYS: P2P NETWORK [STANDBY]'
    ];
    msgs.forEach(function(m, i) { setTimeout(function() { log(m); }, i * 180); });
}

// ── igniteMIDI: lazy MIDI activation (user-gesture gated) ──
async function igniteMIDI() {
    if (APP.status.isMidiActive) return APP.midi.access;
    if (!navigator.requestMIDIAccess) {
        log('MIDI: NOT_SUPPORTED');
        return null;
    }
    try {
        var access = await navigator.requestMIDIAccess({ sysex: false });
        APP.midi.access = access;
        APP.status.isMidiActive = true;
        log('MIDI: HARDWARE CONNECTED');
        return access;
    } catch (err) {
        log('MIDI: ACCESS_DENIED (' + err.message + ')');
        return null;
    }
}

// ── igniteAudio: lazy AudioContext creation (user-gesture gated) ──
function igniteAudio() {
    if (APP.status.isAudioActive && APP.audio.ctx) return APP.audio.ctx;
    try {
        APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        APP.status.isAudioActive = true;
        log('AUDIO: CONTEXT ACTIVE [' + APP.audio.ctx.sampleRate + 'Hz]');
        return APP.audio.ctx;
    } catch (err) {
        log('AUDIO: CONTEXT_FAIL');
        return null;
    }
}



// UTILS
function log(msg) {
    var body = document.getElementById('sys-log-body');
    if (!body) { console.log('[SYS]', msg); return; }
    var ts = new Date().toTimeString().split(' ')[0];
    var el = document.createElement('div');
    el.className = 'log-line';
    el.innerHTML = '<span class="ts">' + ts + '</span>' + msg;
    body.appendChild(el);
    if (body.children.length > 30) body.removeChild(body.firstChild);
    body.scrollTop = body.scrollHeight;
    // Determine alert level from message content
    var m = msg.toUpperCase();
    var level = 'info';
    if (/ERR|FAIL|DENIED|BLOCKED|FATAL|CRASH/.test(m))      level = 'err';
    else if (/WARN|MISS|TIMEOUT|RETRY|ABORT/.test(m))        level = 'warn';
    else if (/DONE|READY|ACTIVE|INJECTED|LOADED|OK/.test(m)) level = 'ok';
    if (typeof window._sysLogWake === 'function') window._sysLogWake(level);
}
function checkMobile() { APP.state.isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry/i.test(navigator.userAgent); if (APP.state.isMobile) { APP.render.width = 1920; APP.render.height = 1080; log('MOBILE_MODE'); } }

// RENDER
function initCanvas() {
    APP.render.canvas = $('vj-canvas');
    APP.render.ctx = APP.render.canvas.getContext('2d', { alpha: false });
    // ── RESOLUTION CAP: 1080p max — 4K canvas chokes the render loop ──
    APP.render.width  = Math.min(APP.render.width,  1920);
    APP.render.height = Math.min(APP.render.height, 1080);
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); checkMobile(); });
    // Off-screen canvas for proper pixelation
    APP.render.pixelCanvas = document.createElement('canvas');
    APP.render.pixelCanvas.width = 384; APP.render.pixelCanvas.height = 216; // Start small
    APP.render.pixelCtx = APP.render.pixelCanvas.getContext('2d', { alpha: false });
    APP.render.pixelCtx.imageSmoothingEnabled = false;
}
function resizeCanvas() { APP.render.canvas.width = APP.render.width; APP.render.canvas.height = APP.render.height; $('res').textContent = `${APP.render.width}x${APP.render.height}`; }


// ========================================
// V34 IDENTITY HANDLERS
// ========================================

// STATION BUG - Set text
if ($('btn-set-station')) {
    $('btn-set-station').onclick = () => {
        const text = $('bug-text').value || 'VNGRD';
        APP.bug.text = text;
        // Update preview overlay so host sees their own identity during a call
        var _pov2 = $('p2p-bug-overlay');
        if (_pov2) _pov2.textContent = text;
        if (APP.peer && APP.peer.call) {
            // P2P active: send to remote peer; local canvas handled by render loop
            sendUISync('STATION_LOGO', { text: text });
        } else {
            const bug = $('station-bug');
            if (bug) { bug.textContent = text; bug.style.display = 'block'; bug.style.background = 'transparent'; }
            sendUISync('STATION_LOGO', { text: text });
        }
        log('STATION: ' + text.toUpperCase());
    };
}

// Station Bug text — update local identity and sync to remote peer in real-time
if ($('bug-text')) {
    $('bug-text').oninput = function() {
        var val = this.value.trim() || 'VNGRD';
        APP.bug.text = val;
        // Always keep preview overlay current (visible during P2P calls)
        var _pov3 = $('p2p-bug-overlay');
        if (_pov3) _pov3.textContent = val;
        sendUISync('STATION_LOGO', { text: val });
        if (!APP.peer || !APP.peer.call) {
            var _bug = $('station-bug');
            if (_bug && APP.trinity.bug.visible) { _bug.textContent = val; }
        }
    };
}

// STATION BUG - Toggle [X] (visible -> hidden via Trinity state)
if ($('btn-bug-toggle')) {
    $('btn-bug-toggle').onclick = () => {
        APP.trinity.bug.visible = !APP.trinity.bug.visible;
        var bug = $('station-bug');
        if (bug) bug.classList.toggle('hidden', !APP.trinity.bug.visible);
        // Update preview overlay visibility
        var _pov4 = $('p2p-bug-overlay');
        if (_pov4) _pov4.style.opacity = APP.trinity.bug.visible ? '1' : '0.2';
        sendUISync('STATION_LOGO', { text: APP.bug.text || 'VNGRD', visible: APP.trinity.bug.visible });
        log(APP.trinity.bug.visible ? 'BUG: VISIBLE' : 'BUG: HIDDEN');
    };
}

// STATION BUG - style + colour
if ($('bug-style-select')) $('bug-style-select').onchange = function() { APP.bug.style = this.value; };
if ($('bug-mode-select'))  $('bug-mode-select').onchange  = function() { APP.bug.mode  = this.value; log('BUG_MODE: ' + this.value.toUpperCase()); };

// 2D LOGO - Upload
if ($('btn-upload-2d')) {
    $('btn-upload-2d').onclick = () => $('file-2d-logo').click();
}

APP.layers.logo2dIsGif = false;
if ($('file-2d-logo')) {
    $('file-2d-logo').onchange = e => {
        if (e.target.files.length) {
            const file = e.target.files[0];
            const url = URL.createObjectURL(file);
            const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
            APP.layers.logo2dIsGif = isGif;
            const logoLayer = $('user-logo-layer');
            const gifOverlay = $('logo-gif-overlay');

            // P2P Mix-Minus: during a call only send to guest, don't render locally.
            // Compress the image to fit within WebRTC data-channel limits (~64KB/msg).
            if (APP.peer && APP.peer.call) {
                const _r = new FileReader();
                _r.onload = function(ev) {
                    var _img = new Image();
                    _img.onload = function() {
                        // Scale to max 200px on longest side → JPEG ~15-25KB as base64
                        var _maxDim = 200;
                        var _s = Math.min(1, _maxDim / Math.max(_img.width || 1, _img.height || 1));
                        var _c = document.createElement('canvas');
                        _c.width  = Math.max(1, Math.round(_img.width  * _s));
                        _c.height = Math.max(1, Math.round(_img.height * _s));
                        _c.getContext('2d').drawImage(_img, 0, 0, _c.width, _c.height);
                        var _uri = _c.toDataURL('image/jpeg', 0.82);
                        sendUISync('2D_LOGO', { action: 'show', dataURI: _uri });
                        log('2D_LOGO: P2P_SEND ' + Math.round(_uri.length / 1024) + 'KB');
                    };
                    _img.src = ev.target.result;
                };
                _r.readAsDataURL(file);
                return;
            }

            if (isGif && gifOverlay) {
                // GIF: render as DOM element to keep Chrome's GIF decoder alive
                gifOverlay.onload = () => {
                    if (typeof APP.trinity.logo.scale === 'undefined') APP.trinity.logo.scale = 1.0;
                    if (typeof APP.trinity.logo.x === 'undefined') APP.trinity.logo.x = 0.05;
                    if (typeof APP.trinity.logo.y === 'undefined') APP.trinity.logo.y = 0.05;
                    APP.trinity.logo.visible = true;
                    // DOM overlay stays hidden — render loop canvas drawImage handles display
                    log('2D_LOGO_GIF_READY: ' + file.name.toUpperCase());
                };
                gifOverlay.src = url;
                // Also load into logoLayer so naturalWidth is available for position math
                if (logoLayer) { logoLayer.removeAttribute('crossOrigin'); logoLayer.src = url; }
                // Decode all GIF frames for canvas recording (captureStream-compatible)
                APP.layers._gifFrames = null; APP.layers._gifBitmap = null;
                APP.layers._gifFrameStart = performance.now();
                const gifReader = new FileReader();
                gifReader.onload = function(ev) {
                    try {
                        const dec = _decodeGIF(ev.target.result);
                        if (dec.frames.length > 0) {
                            APP.layers._gifFrames = dec.frames;
                            APP.layers._gifTotalDelay = dec.frames.reduce((s,f)=>s+f.delay, 0);
                            APP.layers._gifFrameStart = performance.now();
                            log('GIF_DECODED: ' + dec.frames.length + ' frames');
                        }
                    } catch(e) { log('GIF_DECODE_ERR: ' + e.message); }
                };
                gifReader.readAsArrayBuffer(file);
            } else if (logoLayer) {
                // Static image: canvas drawImage path
                gifOverlay.style.display = 'none';
                logoLayer.removeAttribute('crossOrigin');
                logoLayer.removeAttribute('crossorigin');
                logoLayer.style.display = 'block';
                logoLayer.style.filter = 'none';
                logoLayer.style.willChange = 'auto';
                logoLayer.onload = () => {
                    if (typeof APP.trinity.logo.scale === 'undefined') APP.trinity.logo.scale = 1.0;
                    if (typeof APP.trinity.logo.x === 'undefined') APP.trinity.logo.x = 0.05;
                    if (typeof APP.trinity.logo.y === 'undefined') APP.trinity.logo.y = 0.05;
                    APP.trinity.logo.visible = true;
                    log('2D_LOGO_READY: ' + file.name.toUpperCase());
                };
                logoLayer.src = url;
            }

            // Send logo to peer via data channel as base64
            const reader = new FileReader();
            reader.onload = () => { sendUISync('2D_LOGO', { action: 'show', dataURI: reader.result }); };
            reader.readAsDataURL(file);
        }
    };
}

// 2D LOGO - Toggle [X] (visible -> hidden -> cleared)
APP.layers.logo2dState = 'empty';

if ($('btn-2d-x')) {
    $('btn-2d-x').onclick = () => {
        const logoLayer = $('user-logo-layer');
        if (!logoLayer) return;

        const gifOvEl = $('logo-gif-overlay');
        if (APP.trinity.logo.visible) {
            APP.trinity.logo.visible = false;
            if (gifOvEl) gifOvEl.style.display = 'none';
            sendUISync('2D_LOGO', { action: 'hide' });
            log('2D_LOGO: HIDDEN');
        } else if (logoLayer.src && logoLayer.src !== window.location.href) {
            APP.trinity.logo.visible = false;
            APP.layers.logo2dIsGif = false;
            if (gifOvEl) { gifOvEl.style.display = 'none'; if (gifOvEl.src && gifOvEl.src.startsWith('blob:')) URL.revokeObjectURL(gifOvEl.src); gifOvEl.removeAttribute('src'); }
            if (logoLayer.src.startsWith('blob:')) URL.revokeObjectURL(logoLayer.src);
            logoLayer.removeAttribute('src');
            sendUISync('2D_LOGO', { action: 'clear' });
            log('2D_LOGO: CLEARED');
        }
    };
}

// 3D LOGO handled by module script at end of file (Three.js r128 global + lazy loaders)



function ensureAudioChain() {
    if (APP.audio.analyzer) return;
    _padBusNode = null; // force reconnect to new duckingGain
    if (!APP.audio.ctx) APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = APP.audio.ctx;
    APP.audio.analyzer = ctx.createAnalyser();
    APP.audio.analyzer.fftSize = 64;
    APP.audio.analyzer.smoothingTimeConstant = 0.6; // snappy enough for kick detection
    APP.audio.panner = ctx.createPanner();
    APP.audio.panner.panningModel = 'HRTF';
    APP.audio.panner.distanceModel = 'inverse';
    APP.audio.masterGain = ctx.createGain();
    APP.audio.masterGain.gain.value = 0.9;
    APP.audio.lowShelf = ctx.createBiquadFilter();
    APP.audio.lowShelf.type = 'lowshelf'; APP.audio.lowShelf.frequency.value = 60; APP.audio.lowShelf.gain.value = 0;
    APP.audio.highShelf = ctx.createBiquadFilter();
    APP.audio.highShelf.type = 'highshelf'; APP.audio.highShelf.frequency.value = 12000; APP.audio.highShelf.gain.value = 0;
    APP.audio.compressor = ctx.createDynamicsCompressor();
    APP.audio.compressor.threshold.value = -24; APP.audio.compressor.knee.value = 30; APP.audio.compressor.ratio.value = 1;
    APP.audio.outputLimiter = ctx.createDynamicsCompressor();
    APP.audio.outputLimiter.threshold.setValueAtTime(-12, ctx.currentTime);
    APP.audio.outputLimiter.knee.setValueAtTime(30, ctx.currentTime);
    APP.audio.outputLimiter.ratio.setValueAtTime(2.5, ctx.currentTime);
    APP.audio.outputLimiter.attack.setValueAtTime(0.005, ctx.currentTime);
    APP.audio.outputLimiter.release.setValueAtTime(0.15, ctx.currentTime);
    APP.audio.duckingGain = ctx.createGain();
    APP.audio.duckingGain.gain.setValueAtTime(1.0, ctx.currentTime);
    APP.audio.stereoGain = ctx.createGain();
    APP.audio.stereoGain.gain.setValueAtTime(1.0, ctx.currentTime);
    APP.audio.dolbyPanner = ctx.createPanner();
    APP.audio.dolbyPanner.panningModel = 'HRTF'; APP.audio.dolbyPanner.distanceModel = 'inverse'; APP.audio.dolbyPanner.refDistance = 1;
    if (APP.audio.dolbyPanner.positionX) { APP.audio.dolbyPanner.positionX.setValueAtTime(0, ctx.currentTime); APP.audio.dolbyPanner.positionY.setValueAtTime(5, ctx.currentTime); APP.audio.dolbyPanner.positionZ.setValueAtTime(-2, ctx.currentTime); }
    try { APP.audio.surroundSplitter = ctx.createChannelSplitter(6); APP.audio.surroundMerger = ctx.createChannelMerger(6); } catch(e) {}
    APP.audio.micAnalyzer = ctx.createAnalyser(); APP.audio.micAnalyzer.fftSize = 256;
    // Dedicated gain node for video audio — allows independent mute without touching vid.muted
    APP.audio.videoGain = ctx.createGain();
    APP.audio.videoGain.gain.setValueAtTime(1.0, ctx.currentTime);
    APP.audio.panner.connect(APP.audio.lowShelf).connect(APP.audio.highShelf).connect(APP.audio.compressor).connect(APP.audio.duckingGain).connect(APP.audio.analyzer).connect(APP.audio.masterGain).connect(APP.audio.outputLimiter).connect(ctx.destination);
    APP.audio.masterGain.connect(APP.audio.stereoGain);
    APP.audio.recorderDest = ctx.createMediaStreamDestination();
    APP.audio.masterGain.connect(APP.audio.recorderDest);
    APP.audio.dolbyPanner.connect(APP.audio.outputLimiter);
    // videoGain feeds both panner paths
    APP.audio.videoGain.connect(APP.audio.panner);
    APP.audio.videoGain.connect(APP.audio.dolbyPanner);
    APP.audio.vuData = new Uint8Array(APP.audio.analyzer.frequencyBinCount);
    updateVU();
    log('DAW_CHAIN_READY');
}
// ═══════════════════════════════════════════════════════════════════════════
// Phase 4: PODCASTER PORTAL UI + MIDI Visual/Audio Mapping
// ═══════════════════════════════════════════════════════════════════════════
function portalCamPreview() {
    // Preview is now inline in the CAMERA_4K sidebar section — no repositioning needed
    const cam = $('cam-preview-float');
    if (!cam) return;
}

function triggerVisualEffect(note, velocity) {
    const i = velocity / 127;
    if (note >= 36 && note <= 39) { [impactStutter, impactInvert, impactCrush, triggerSeismic][(note - 36)]?.(); }
    else if (note >= 40 && note <= 47) { setTheme(['cyan','magenta','gold','purple','green'][(note - 40) % 5]); }
    else if (note >= 48 && note <= 59) { APP.vj.rgbIntensity = Math.round(i * 30); APP.vj.rgbEnabled = i > 0.1; }
    else if (note >= 60 && i > 0.5) { rotateMedia(); }
}

function setMidiAudioFilter(cc, value) {
    const n = value / 127;
    if (cc === 1) APP.vj.brightness = 0.2 + n * 1.8;
    else if (cc === 7 && APP.audio.masterGain) APP.audio.masterGain.gain.setValueAtTime(n, APP.audio.ctx.currentTime);
    else if (cc === 71) APP.vj.contrast = 0.2 + n * 1.8;
    else if (cc === 74) APP.vj.hue = Math.round(n * 360);
    else if (cc === 91) { APP.vj.trailAlpha = 0.8 + n * 0.19; APP.vj.trailsEnabled = n > 0.05; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5: LAYER SAVER (yPodcaster Protection)
// ═══════════════════════════════════════════════════════════════════════════
async function checkLayerReadiness() {
    try {
        const [tex, font] = await Promise.all([
            Promise.resolve(!!(APP.render.canvas && APP.render.ctx)),
            document.fonts ? document.fonts.ready.then(() => true).catch(() => true) : Promise.resolve(true)
        ]);
        // Audio check: pass if ctx exists OR if wallet is connected (studio unlocked)
        const audio = !!(APP.audio.ctx && APP.audio.ctx.state !== 'closed') || (APP.wallet && APP.wallet.connected);
        APP.layerSaver.textureReady = tex;
        APP.layerSaver.fontReady = font;
        APP.layerSaver.audioReady = audio;
        APP.layerSaver.allReady = tex && font;
        if (APP.layerSaver.allReady) {
            enableRecordButtons(true);
        } else {
            const missing = [];
            if (!tex) missing.push('TEXTURE');
            if (!font) missing.push('FONT');
            log('LAYER_SAVER: MISSING [' + missing.join(', ') + ']');
            enableRecordButtons(false);
        }
        return APP.layerSaver.allReady;
    } catch (e) { enableRecordButtons(false); return false; }
}

function enableRecordButtons(enabled) {
    ['btn-nft-30', 'btn-broadcast'].forEach(id => {
        const btn = $(id);
        if (btn) { btn.disabled = !enabled; btn.style.opacity = enabled ? '1' : '0.3'; }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1: COMPOSITOR INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════
function initCompositor() {
    if (!window.Compositor) { log('COMPOSITOR: NOT_LOADED'); return; }
    APP.compositor = new Compositor({
        width: APP.render.width,
        height: APP.render.height,
        fps: 60,
        bitrate: 15000000,
        audioBitrate: 128000
    });
    APP.compositor.setLayer('overlay', APP.render.canvas);
    if (APP.camera.stream) {
        const vid = $('preview-vid') || APP.camera.videoEl;
        if (vid) APP.compositor.setLayer('camera', vid);
    }
    APP.compositor.initRecorder(APP.audio.ctx, APP.audio.outputLimiter || APP.audio.masterGain, APP.audio.micRecGain || APP.audio.micGainNode);
    APP.compositor.onWorkerMessage((type, payload) => {
        if (type === 'STATUS') log('COMPOSITOR: ' + payload);
    });
    APP.compositor.startRecording(1000);
}

document.addEventListener('DOMContentLoaded', () => {
    // ── FX CLEANUP: purge stale effect classes from prior session ──
    document.body.classList.remove('fx-void', 'fx-lucy', 'fx-scan', 'fx-tear', 'fx-punch');

    // Pre-fetch SFX audio files so they decode instantly on first play
    SFX_ENGINE.init();

    bootSequence();

    // ── PHASE 0: CRITICAL — UI frame must render immediately ──
    checkMobile(); initCanvas(); ghostInit(); loadFromMemory();

    // ── IPFS PORTFOLIO IMPORT: auto-load if ?workspace=CID is in URL ──
    var _urlParams = new URLSearchParams(window.location.search);
    var _workspaceCID = _urlParams.get('workspace');
    if (_workspaceCID && _workspaceCID.length > 10) {
        log('BOOT: WORKSPACE_CID_DETECTED \u2192 ' + _workspaceCID);
        // Delay import until compositor + audio chain are ready
        setTimeout(function() { importFromIPFS(_workspaceCID); }, 2500);
    }
    // ── CRYPTO: one-shot chain — next poll only after current fetch resolves ──
    (function scheduleCrypto() { fetchCrypto().finally(() => setTimeout(scheduleCrypto, 600000)); })();

    // Hide DOM overlays — Trinity actors are drawn directly on canvas
    var _sb = $('station-bug'); if (_sb) _sb.style.opacity = '0';
    // user-logo-layer lives in #gif-host (direct child of body, position:fixed, opacity:0.01)
    // No extra styling needed — gif-host CSS handles compositing.

    // ═══════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
    // CINEMA_ENGINE — ElevenLabs Voiceover Director
    // API key stored in localStorage as 'elevenlabs_api_key'
    // Ducks APP.audio.duckingGain during playback; restores on end.
    // ═══════════════════════════════════════════════════════════════════
    APP.ui = APP.ui || {};
    APP.ui.sveSync = false;
    APP.ui.svePlaying = false;

    window._toggleSveSync = function(btn) {
        APP.ui.sveSync = !APP.ui.sveSync;
        if (btn) {
            btn.textContent = 'SYNC_CAROUSEL: ' + (APP.ui.sveSync ? 'ON' : 'OFF');
            btn.style.color = APP.ui.sveSync ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderColor = APP.ui.sveSync ? 'var(--accent)' : 'var(--border-light)';
        }
    };

    window._runSVE = async function() {
        var scriptEl = document.getElementById('sve-script');
        var statusEl = document.getElementById('sve-status');
        var btn = document.getElementById('sve-voiceover-btn');
        var script = scriptEl ? scriptEl.value.trim() : '';

        if (!script) { if (statusEl) statusEl.textContent = 'ERR: EMPTY_SCRIPT'; return; }
        if (APP.ui.svePlaying) { if (statusEl) statusEl.textContent = 'BUSY: PLAYBACK_ACTIVE'; return; }

        // THE 401 FIX: Trim spaces off the key
        var rawKey = localStorage.getItem('elevenlabs_api_key') || localStorage.getItem('ELEVENLABS_API_KEY') || '';
        var apiKey = rawKey.trim();

        if (!apiKey) {
            if (statusEl) statusEl.textContent = 'ERR: SET elevenlabs_api_key IN localStorage';
            return;
        }

        APP.ui.svePlaying = true;
        if (btn) btn.textContent = '[ TRANSMITTING... ]';
        if (statusEl) statusEl.textContent = 'ELEVENLABS: REQUESTING...';

        try {
            ensureAudioChain();
            var _ctx = APP.audio.ctx;
            if (_ctx.state === 'suspended') await _ctx.resume();

            var voiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel
            
            // THE SMART FIX: Multilingual V2 model
            var res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'audio/mpeg'
                },
                body: JSON.stringify({
                    text: script,
                    model_id: 'eleven_multilingual_v2',
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                })
            });

            if (!res.ok) throw new Error('API_ERR: HTTP_' + res.status);

            var arrayBuf = await res.arrayBuffer();
            var audioBuf = await _ctx.decodeAudioData(arrayBuf);

            // DUCKING: ramp ambient down before playback
            if (APP.audio.duckingGain) {
                var _dg = APP.audio.duckingGain.gain;
                _dg.cancelScheduledValues(_ctx.currentTime);
                _dg.setValueAtTime(_dg.value, _ctx.currentTime);
                _dg.linearRampToValueAtTime(0.15, _ctx.currentTime + 0.3);
            }

            var voSrc = _ctx.createBufferSource();
            voSrc.buffer = audioBuf;
            voSrc.connect(APP.audio.masterGain || _ctx.destination);

            if (statusEl) statusEl.textContent = 'PLAYING: ' + audioBuf.duration.toFixed(1) + 's';
            if (btn) btn.textContent = '[ PLAYING... ]';

            voSrc.onended = function() {
                APP.ui.svePlaying = false;
                // Ramp ambient back up
                if (APP.audio.duckingGain) {
                    var _dg2 = APP.audio.duckingGain.gain;
                    _dg2.cancelScheduledValues(_ctx.currentTime);
                    _dg2.setValueAtTime(_dg2.value, _ctx.currentTime);
                    _dg2.linearRampToValueAtTime(1.0, _ctx.currentTime + 0.5);
                }
                // SYNC_CAROUSEL: advance media on voice end
                if (APP.ui.sveSync && typeof carouselNext === 'function') carouselNext();
                if (statusEl) statusEl.textContent = 'COMPLETE';
                if (btn) btn.textContent = '[ VOICEOVER ]';
            };

            voSrc.start();

        } catch(e) {
            // speechSynthesis routes to the OS directly — it bypasses Web Audio and
            // is never captured by the Iron-Clad Recorder.  Delegate to SVE.speak()
            // instead: it fetches audio via ElevenLabs key rotation or OpenAI, decodes
            // to AudioBuffer, and routes through masterGain → outputLimiter → Compositor.
            APP.ui.svePlaying = false;
            if (btn) btn.textContent = '[ VOICEOVER ]';
            if (window.SVE && typeof window.SVE.speak === 'function') {
                log('SVE: FALLBACK→SVE_MODULE');
                if (statusEl) statusEl.textContent = 'FALLBACK: SVE_MODULE';
                window.SVE.speak(script);
            } else {
                log('SVE: API_ERR ' + e.message);
                if (statusEl) statusEl.textContent = 'ERR: ' + e.message;
            }
        }
    };

    requestAnimationFrame(renderLoop);
    startMainLoop(); // ── PHASE A: boot central loop once
    updateClock(); setInterval(updateClock, 1000); morphLogo(); setTimeout(morphLogo, 4000);
    // ── PHASE 1 (1s): COMPOSITOR + LAYERS — let UI settle first ──
    setTimeout(() => {
        log('BOOT: COMPOSITOR');
        initCompositor();
        portalCamPreview();
        checkLayerReadiness();
        initSummonerLogic();
        initSeamControls();
    }, 1000);

    // ── PHASE 2: MIDI/AUDIO deferred to user gesture (JIT) ──
    
    // Wire UI
    $('btn-init-cam').onclick = initCamera; $('btn-go-live').onclick = goLive; $('btn-end').onclick = endLive; $('btn-kill').onclick = killCamera;
    
    // MIC TOGGLE — routes mic into recording chain + ducking (NOT to speakers = no feedback)
    async function toggleMic() {
        const btnCam = $('btn-mic');
        const btnEng = $('btn-mic-engine');
        if (APP.camera.micStream) {
            // Turn OFF mic
            APP.camera.micStream.getTracks().forEach(t => t.stop());
            APP.camera.micStream = null;
            APP.audio.duckingActive = false;
            if (APP.audio.micRecGain) { APP.audio.micRecGain.disconnect(); APP.audio.micRecGain = null; }
            if (APP.audio.micGainNode) { APP.audio.micGainNode.disconnect(); APP.audio.micGainNode = null; }
            btnCam.classList.remove('on'); btnCam.textContent = 'MIC';
            btnEng.classList.remove('on'); btnEng.title = 'Mic on/off';
            log('MIC: OFF');
            return;
        }
        try {
            ensureAudioChain();
            APP.camera.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 } });
            const micSource = APP.audio.ctx.createMediaStreamSource(APP.camera.micStream);
            APP.audio.micGainNode = APP.audio.ctx.createGain();
            APP.audio.micGainNode.gain.value = 1.0;
            micSource.connect(APP.audio.micGainNode);
            // Gate node: muted during sampler playback to prevent phase-doubled recordings
            APP.audio.micRecGain = APP.audio.ctx.createGain();
            APP.audio.micRecGain.gain.setValueAtTime(1.0, APP.audio.ctx.currentTime);
            APP.audio.micGainNode.connect(APP.audio.micRecGain);
            // Route mic → micRecGain → recorderDest (recording) — NOT ctx.destination (prevents feedback)
            if (APP.audio.recorderDest) APP.audio.micRecGain.connect(APP.audio.recorderDest);
            // Arm ducking (connects micSource → micAnalyzer for side-chain detection)
            initMicDucking(APP.camera.micStream);
            btnCam.classList.add('on'); btnCam.textContent = 'MIC [ON]';
            btnEng.classList.add('on'); btnEng.title = 'Mic ON — click to mute';
            log('MIC: ARMED_48kHz (REC_ONLY)');
            checkLayerReadiness();
        } catch(e) { log('MIC_ERR: ' + e.message); }
    }
    $('btn-mic').onclick = toggleMic;
    $('btn-mic-engine').onclick = toggleMic;
    
    // --- COMPACT MEDIA DECK WIRING ---
    $('btn-load-media').onclick = () => $('file-media').click();
    $('btn-cycle-toggle').onclick = toggleCycle;

    // Image zoom/lightbox
    $('btn-zoom-img').onclick = openLightbox;

    // Keep Navigation
    $('btn-rotate').onclick = rotateMedia;
    $('btn-prev').onclick = previousMedia;
    $('file-media').onchange = e => loadMediaFiles(e.target);
    
    // Live Time Update
    // Cycle slider handler
    $('sl-cycle').oninput = e => {
        $('val-cycle').textContent = e.target.value + 's';
        if(APP.state.isCycle) {
            checkCycleLogic();
        }
    };
    
    // Show slider when cycle is on
    const origToggleCycle = toggleCycle;
    toggleCycle = function() {
        origToggleCycle();
        $('cycle-slider-wrap').style.display = APP.state.isCycle ? 'block' : 'none';
    };

    ['guest','track','breaking'].forEach(function(m) {
        var el = $('btn-lt-' + m); if (!el) return;
        el.onclick = function() {
            // Mix-Minus: guard on APP.peer.call (media call active), NOT dataConn.open.
            // dataConn may not be open yet at the moment the LT button is pressed —
            // sendUISync queues the message and flushes it when the channel opens.
            if (APP.peer && APP.peer.call) {
                var _ltTitle = $('lt-title').value || 'GUEST NAME';
                var _ltSub   = $('lt-sub').value   || 'TITLE / ROLE';
                sendUISync('LOWER_THIRD', { action:'show', preset: m, title: _ltTitle, subtitle: _ltSub });
                drawLTToPreview(m, _ltTitle, _ltSub);
            } else {
                showLowerThird(m);
                sendUISync('LOWER_THIRD', { action:'show', preset: APP.lowerThird.preset, title: $('lt-title-text').textContent, subtitle: $('lt-subtitle-text').textContent });
            }
        };
    });
    $('btn-lt-off').onclick = () => {
        hideLowerThird();
        sendUISync('LOWER_THIRD', { action: 'hide' });
        // Clear the 4K preview canvas so host's float goes dark too
        var _ltPrev = $('lt-preview-canvas');
        if (_ltPrev) { if (_ltPrev._ltClear) clearTimeout(_ltPrev._ltClear); var _lpc = _ltPrev.getContext('2d'); if (_lpc) _lpc.clearRect(0, 0, _ltPrev.width, _ltPrev.height); }
    };
    if ($('lt-style-select')) $('lt-style-select').onchange = function() {
        APP.lowerThird.ltStyle = this.value;
        if (APP.lowerThird.visible) {
            // Mix-Minus intercept for style changes during P2P call
            if (APP.peer && APP.peer.call) {
                sendUISync('LOWER_THIRD', { action:'show', preset: this.value, title: $('lt-title').value || '', subtitle: $('lt-sub').value || '' });
            } else {
                showLowerThird(APP.lowerThird.mode || 'guest');
                sendUISync('LOWER_THIRD', { action:'show', preset: APP.lowerThird.preset, title: $('lt-title-text').textContent, subtitle: $('lt-subtitle-text').textContent });
            }
        }
    };
    if ($('lt-color')) $('lt-color').oninput = function() { APP.lowerThird.ltColor = this.value; var d=$('lt-color-dot'); if(d){d.style.background=this.value;d.style.boxShadow='0 0 5px '+this.value;} };
    if ($('bug-color')) $('bug-color').oninput = function() { APP.bug.color=this.value; var d=$('bug-color-dot'); if(d){d.style.background=this.value;d.style.boxShadow='0 0 5px '+this.value;} };
    $('lt-title').oninput = e => { if (APP.lowerThird.visible) { $('lt-title-text').textContent = e.target.value; sendUISync('LOWER_THIRD', { action: 'show', preset: APP.lowerThird.preset, title: $('lt-title-text').textContent, subtitle: $('lt-subtitle-text').textContent }); } };
    $('lt-sub').oninput = e => { if (APP.lowerThird.visible) { $('lt-subtitle-text').textContent = e.target.value; sendUISync('LOWER_THIRD', { action: 'show', preset: APP.lowerThird.preset, title: $('lt-title-text').textContent, subtitle: $('lt-subtitle-text').textContent }); } };
    $('btn-audio').onclick = () => { igniteAudio(); $('file-audio').click(); }; $('file-audio').onchange = e => loadAudioFiles(e.target);

    $('btn-mute-vid').onclick = () => {
        APP.audio.videoMuted = !APP.audio.videoMuted;
        // Control volume via gain node — vid.muted stays true to prevent native double-output
        if (APP.audio.videoGain && APP.audio.ctx) {
            APP.audio.videoGain.gain.setValueAtTime(APP.audio.videoMuted ? 0 : 1, APP.audio.ctx.currentTime);
        }
        $('btn-mute-vid').textContent = APP.audio.videoMuted ? '\u{1F507}' : '\u{1F50A}';
        $('btn-mute-vid').classList.toggle('on', APP.audio.videoMuted);
        log('VIDEO_MUTE: ' + (APP.audio.videoMuted ? 'ON' : 'OFF'));
    };
    
    // NEW COMPACT AUDIO
    $('btn-next-track').onclick = nextTrack; 
    $('btn-prev-track').onclick = prevTrack;
    $('btn-play-pause').onclick = togglePlayPause;
    
    // PRO_FX wiring (faders removed — buttons only)
    if ($('btn-stutter')) $('btn-stutter').onclick = impactStutter;
    if ($('btn-invert')) $('btn-invert').onclick = impactInvert;
    if ($('btn-crush')) $('btn-crush').onclick = impactCrush;
    if ($('btn-trails')) $('btn-trails').onclick = () => { APP.vj.trailsEnabled = !APP.vj.trailsEnabled; $('btn-trails').classList.toggle('on'); };
    if ($('btn-rgb')) $('btn-rgb').onclick = () => { APP.vj.rgbEnabled = !APP.vj.rgbEnabled; APP.vj.rgbIntensity = APP.vj.rgbEnabled ? 12 : 0; $('btn-rgb').classList.toggle('on'); };
    if ($('btn-pixelate')) $('btn-pixelate').onclick = () => { APP.vj.pixelateEnabled = !APP.vj.pixelateEnabled; APP.vj.pixelSize = APP.vj.pixelateEnabled ? 8 : 1; $('btn-pixelate').classList.toggle('on'); };
    if ($('btn-vhs')) $('btn-vhs').onclick = toggleVHS;
    if ($('btn-crt')) $('btn-crt').onclick = toggleCRT;
    document.querySelectorAll('.pal').forEach(p => p.onclick = () => setTheme(p.dataset.t));

    
    // PARTY MODE TRIGGER - Rapid morphs + light effects
    $('btn-ui-react').onclick = () => {
        APP.vj.uiReactivity = !APP.vj.uiReactivity;
        $('btn-ui-react').classList.toggle('on');
        document.body.classList.toggle('party-active', APP.vj.uiReactivity);

        if (APP.vj.uiReactivity) {
            log('PARTY_MODE: ACTIVATED');

            // Canvas strobe: 8-frame RGB flash (captured by captureStream)
            APP.vj._partyFlash = 8;
            // DOM flash: bright white spike on the UI shell
            document.body.style.filter = 'brightness(2.5) contrast(1.3)';
            document.querySelectorAll('.sidebar').forEach(s => s.style.boxShadow = '0 0 40px var(--accent)');
            setTimeout(() => {
                document.body.style.filter = '';
                document.querySelectorAll('.sidebar').forEach(s => s.style.boxShadow = '');
            }, 80);

            // Rapid logo morph cycle
            let count = 0;
            const rapidMorph = setInterval(() => {
                morphLogo();
                count++;
                if (count >= 15) clearInterval(rapidMorph);
            }, 60);

            // Continuous light play: fires every 300ms but only flashes when bass is hitting
            APP.partyInterval = setInterval(() => {
                if (!APP.vj.uiReactivity) {
                    clearInterval(APP.partyInterval);
                    return;
                }
                // Only act when music is actually beating
                var _pb = APP.audio.bassLevel || 0;
                // Theme flash on strong beat
                if (_pb > 185 && Math.random() > 0.55) {
                    const themes = ['cyan', 'magenta', 'green', 'purple', 'gold'];
                    setTheme(themes[Math.floor(Math.random() * themes.length)]);
                }
                // Logo morph on beat
                if (_pb > 170 && Math.random() > 0.45) morphLogo();
                // Canvas strobe on strong beat (1-2 frame flash via _partyFlash)
                if (_pb > 195 && Math.random() > 0.4) APP.vj._partyFlash = Math.max(APP.vj._partyFlash || 0, 3);
                // DOM brightness pulse — subtler than before
                if (_pb > 175 && Math.random() > 0.6) {
                    document.body.style.filter = 'brightness(1.4)';
                    setTimeout(() => { document.body.style.filter = ''; }, 40);
                }
            }, 300);
        } else {
            log('PARTY_MODE: DEACTIVATED');
            if (APP.partyInterval) clearInterval(APP.partyInterval);
            APP.vj._partyFlash = 0;
            document.body.style.filter = '';
        }
    };

    // SEISMIC TOGGLE — single-click = 3s one-shot demo, double-click = toggle persistent mode
    APP.vj.seismicConsoleMode = false;
    (function() {
        var btn = $('btn-rumble');
        var _dct = 0;
        var _seismicDemoTimer = null;
        btn.addEventListener('click', function() {
            var now = Date.now();
            if (now - _dct < 320) {
                // Double-click: toggle persistent canvas + console shake
                _dct = 0;
                APP.vj.rumbleEnabled = !APP.vj.rumbleEnabled;
                APP.vj.seismicConsoleMode = APP.vj.rumbleEnabled;
                btn.classList.toggle('on', APP.vj.rumbleEnabled);
                btn.classList.toggle('console-mode', APP.vj.rumbleEnabled);
                if (!APP.vj.rumbleEnabled) document.body.style.transform = '';
                btn.title = APP.vj.rumbleEnabled ? 'SEISMIC: PERSISTENT\nClick: one-shot' : 'SEISMIC';
                log(APP.vj.rumbleEnabled ? 'SEISMIC: PERSISTENT [CONSOLE+CANVAS]' : 'SEISMIC: OFF');
                return;
            }
            _dct = now;
            // Single click: 3-second one-shot demo (canvas shake)
            if (_seismicDemoTimer) clearTimeout(_seismicDemoTimer);
            APP.vj._seismicDemoUntil = performance.now() + 3000;
            APP.vj._seismicVel = 1.0;
            document.body.classList.add('seismic-active');
            btn.classList.add('on');
            log('SEISMIC: ONE-SHOT_3S');
            _seismicDemoTimer = setTimeout(function() {
                APP.vj._seismicDemoUntil = 0;
                APP.vj._seismicVel = 0;
                document.body.classList.remove('seismic-active');
                if (!APP.vj.rumbleEnabled) btn.classList.remove('on');
                _seismicDemoTimer = null;
            }, 3000);
        });
    })();

    // PUNCH TOGGLE — single-click = 3s one-shot elastic, double-click = toggle punchLocked
    APP.vj.punchLocked = false;
    APP.vj.punchConsoleMode = false;
    (function() {
        var btn = $('btn-punch');
        var _dct = 0;
        var _punchDemoTimer = null;
        btn.addEventListener('click', function() {
            var now = Date.now();
            if (now - _dct < 320) {
                // Double-click: toggle punchLocked — persistent bass-synced elastic mode
                _dct = 0;
                APP.vj.punchLocked = !APP.vj.punchLocked;
                if (_punchDemoTimer) { clearTimeout(_punchDemoTimer); _punchDemoTimer = null; }
                APP.vj._punchDemoUntil = 0;
                if (APP.vj.punchLocked) {
                    document.body.classList.add('fx-punch');
                    btn.classList.add('on', 'punch-locked');
                    btn.classList.remove('console-mode');
                    btn.title = 'PUNCH: LOCKED\nDouble-click: release';
                    log('PUNCH: LOCKED [BASS-SYNCED ELASTIC]');
                } else {
                    document.body.classList.remove('fx-punch');
                    btn.classList.remove('on', 'punch-locked', 'console-mode');
                    btn.title = 'Click: arm PUNCH\nDouble-click: toggle LOCK';
                    log('PUNCH: UNLOCKED');
                }
                return;
            }
            _dct = now;
            // Single click: 3-second one-shot elastic punch
            if (APP.vj.punchLocked) return; // locked mode ignores single-click
            if (_punchDemoTimer) clearTimeout(_punchDemoTimer);
            APP.vj.punchConsoleMode = false;
            APP.vj._punchDemoUntil = performance.now() + 3000;
            document.body.classList.add('fx-punch');
            btn.classList.add('on');
            log('PUNCH: ONE-SHOT_3S');
            _punchDemoTimer = setTimeout(function() {
                APP.vj._punchDemoUntil = 0;
                if (!APP.vj.punchLocked) {
                    document.body.classList.remove('fx-punch');
                    btn.classList.remove('on');
                }
                btn.classList.remove('console-mode');
                _punchDemoTimer = null;
            }, 3000);
        });
    })();

    // WALLET — badge delegates entirely to requestManualConnect()
    $('wallet-badge').onclick = async () => {
        if (APP.wallet && APP.wallet.connected) {
            if (confirm('Disconnect wallet?')) disconnectWalletUI();
            return;
        }
        await requestManualConnect();
        // requestManualConnect() fully resolves before this line — APP.wallet.address
        // is the signer-derived freshAddress set by connectWalletUI(freshAddress, ...).
        // The cloud KV key is derived from this address, never a stale cached value.
        if (APP.wallet && APP.wallet.connected) {
            setTimeout(() => loadSessionFromCloud(true), 500);
        }
    };


    $('btn-stereo').onclick = () => setAudioMode('stereo');
    $('btn-spatial').onclick = () => setAudioMode('spatial');
    $('btn-dolby').onclick = () => setAudioMode('dolby');

    // LOGO CLICK INTERACTION - Light flash + morph (like reference site)
    $('main-logo').onmousedown = () => {
        // Light flash effect
        document.body.style.filter = 'brightness(2) contrast(1.2)';
        document.querySelectorAll('.sidebar').forEach(s => s.style.boxShadow = '0 0 30px var(--accent)');
        setTimeout(() => {
            document.body.style.filter = '';
            document.querySelectorAll('.sidebar').forEach(s => s.style.boxShadow = '');
        }, 100);
        
        // Morph logo
        morphLogo();
    };

    // Final UI and Input Handlers
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT') return;
        if (e.key === 'g' || e.key === 'G') toggleGhost();
        if (e.key === 'h' || e.key === 'H') toggleFullscreen();
        if (e.key === 'Tab') { e.preventDefault(); toggleSystemSlide(); }
        if (e.key === 'Escape') {
            if ($('img-lightbox').style.display !== 'none') {
                closeLightbox();
            } else {
                // ESC WARNING — require double-tap within 2s before panic reset
                const warn = $('esc-warn');
                if (window._escPrimed) {
                    window._escPrimed = false;
                    clearTimeout(window._escTimer);
                    if (warn) { warn.classList.remove('visible'); }
                    $('btn-panic').click();
                } else {
                    window._escPrimed = true;
                    if (warn) { warn.classList.add('visible'); }
                    window._escTimer = setTimeout(function() {
                        window._escPrimed = false;
                        if (warn) { warn.classList.remove('visible'); }
                    }, 2000);
                    if (typeof ghostLog === 'function') ghostLog('⚠ ESC ARMED — press again within 2s to PANIC RESET', 'warn');
                    if (typeof log === 'function') log('ESC_PRIMED');
                }
            }
        }
        if (e.key === ' ' && !['TEXTAREA','INPUT','SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); rotateMedia(); }
        // S key — toggle Compositor source between local camera and P2P guest feed
        if (e.key === 's' || e.key === 'S') {
            APP.state.activeSource = APP.state.activeSource === 'guest' ? 'local' : 'guest';
            log('SOURCE_SWITCH: ' + APP.state.activeSource.toUpperCase());
        }
    });

    // ── TRIPLE-ALPHA HUD — single global toggle (footer button) ──
    // Same pattern as Tracker ghost mode: cycles SOLID → GLASS → GHOST → SOLID
    (function() {
        var HUD_STATES = [
            { name: 'SOLID', cls: null },
            { name: 'GLASS', cls: 'hud-glass' },
            { name: 'GHOST', cls: 'hud-ghost' }
        ];
        var _idx = 0;
        window.toggleHudAlpha = function() {
            var lp  = document.getElementById('left-panel');
            var rp  = document.getElementById('right-panel');
            var lbl = document.getElementById('hud-alpha-label');
            var btn = document.getElementById('btn-hud-alpha');
            HUD_STATES.forEach(function(s) {
                if (s.cls) {
                    if (lp) lp.classList.remove(s.cls);
                    if (rp) rp.classList.remove(s.cls);
                }
            });
            _idx = (_idx + 1) % HUD_STATES.length;
            var st = HUD_STATES[_idx];
            if (st.cls) {
                if (lp) lp.classList.add(st.cls);
                if (rp) rp.classList.add(st.cls);
            }
            if (lbl) lbl.textContent = st.name;
            // Dim the button itself when panels are ghosted so it fits the aesthetic
            if (btn) btn.style.opacity = st.name === 'GHOST' ? '0.55' : '1';
        };
    })();

    // Ensure uploaded logos are interactable
    $('file-layer-logo').onchange = e => {
        if (e.target.files.length) {
            const url = URL.createObjectURL(e.target.files[0]);
            const img = $('user-logo-layer');
            img.src = url;
            img.style.display = 'block'; // gif-host CSS handles size + compositing
            APP.trinity.logo.visible = true;
            log('IDENTITY_LAYER_LOADED');
        }
    };

    // ========================================
    // MIDI_HOST WITH LEARN MODE & PASSTHROUGH
    // ========================================

    // Shared MIDI message handler — used by both btn-midi init and auto-init
    function handleMidiMessage(msg) {
        const [status, note, velocity] = msg.data;
        const cmd = status >> 4;

        // MIDI LEARN — capture next input for armed target
        if (APP.midi.learnMode && APP.midi.learnTarget && velocity > 0) {
            const key = (cmd === 11) ? 'cc' + note : 'note' + note;
            APP.midi.bindings[key] = {
                element: APP.midi.learnTarget.element,
                target: APP.midi.learnTarget.target,
                type: (cmd === 11) ? 'cc' : 'note'
            };
            APP.midi.learnTarget.element.classList.add('midi-bound');
            APP.midi.learnTarget.element.style.outline = '';
            updateMidiBindingsDisplay();
            log('MIDI_BOUND: ' + key + ' \u2192 ' + APP.midi.learnTarget.target.toUpperCase());
            APP.midi.learnTarget = null;
            $('sfx-midi-arm') && ($('sfx-midi-arm').textContent = 'BOUND \u2014 ARM NEXT OR EXIT LEARN');
            return;
        }

        // Note On (cmd 9) with velocity > 0
        if (cmd === 9 && velocity > 0) {
            if (APP.midi.passthrough) playSynthNote(note, velocity);
            const binding = APP.midi.bindings['note' + note];
            if (binding) triggerMidiBinding(binding, velocity);
            const intensity = velocity / 127;
            if (note < 48) {
                if (APP.shooting.active && typeof fireWeaponAt === 'function') {
                    fireWeaponAt(Math.random() * window.innerWidth, Math.random() * window.innerHeight, intensity);
                }
                const shake = intensity * 30;
                document.body.style.transform = `translate(${(Math.random()-0.5)*shake}px, ${(Math.random()-0.5)*shake}px)`;
                setTimeout(() => document.body.style.transform = '', 50);
            }
            if (velocity > 80) {
                if (note >= 60 && note < 64) impactStutter();
                else if (note >= 64 && note < 68) impactInvert();
                else if (note >= 68 && note < 72) impactCrush();
                else if (note >= 72) { rotateMedia(); triggerImpact(); }
            }
            if (note === 36) setTheme('cyan');
            if (note === 37) setTheme('magenta');
            if (note === 38) setTheme('green');
            if (note === 39) setTheme('purple');
            if (note === 40) setTheme('gold');
        }

        // Note Off — stop synth if needed
        if (cmd === 8 || (cmd === 9 && velocity === 0)) { /* reserved */ }

        // Control Change (cmd 11) — sliders/knobs
        if (cmd === 11) {
            const val = velocity / 127;
            const binding = APP.midi.bindings['cc' + note];
            if (binding) triggerMidiCCBinding(binding, val);
            if (note === 1 || note === 74) { APP.vj.brightness = 0.5 + val; if ($('sl-b')) $('sl-b').value = APP.vj.brightness * 100; }
            if (note === 2 || note === 71) { APP.vj.contrast = 0.5 + val; if ($('sl-c')) $('sl-c').value = APP.vj.contrast * 100; }
            if (note === 3 || note === 76) { APP.vj.saturation = val * 2; if ($('sl-s')) $('sl-s').value = APP.vj.saturation * 100; }
            if (note === 4 || note === 77) { APP.vj.hue = val * 360; if ($('sl-h')) $('sl-h').value = APP.vj.hue; }
        }

        // Pitch Bend — control hue
        if (cmd === 14) {
            const bend = ((velocity << 7) | note) - 8192;
            APP.vj.hue = (bend / 8192) * 180 + 180;
        }

        // Forward to Sonic Suite instruments
        document.dispatchEvent(new CustomEvent('ss-midi', { detail: { status, note, vel: velocity } }));
    }

    // Attach message handlers to all current inputs + listen for hot-plug
    function setupMidiHandlers(midiAccess) {
        APP.midi.inputs = [];
        APP.midi.outputs = [];
        const inputs = Array.from(midiAccess.inputs.values());
        const outputs = Array.from(midiAccess.outputs.values());

        if (inputs.length === 0) {
            log('MIDI: NO_DEVICES_FOUND');
            $('midi-status').textContent = 'NO DEVICE';
            $('midi-status').style.color = 'var(--r)';
            return false;
        }

        inputs.forEach(input => {
            APP.midi.inputs.push(input);
            input.onmidimessage = handleMidiMessage;
        });
        outputs.forEach(o => APP.midi.outputs.push(o));

        $('btn-midi').classList.add('on');
        $('btn-midi').textContent = 'MIDI ACTIVE';
        $('midi-status').textContent = inputs[0].name;
        $('midi-status').style.color = 'var(--g)';
        if ($('midi-dot')) $('midi-dot').classList.remove('off');
        log('MIDI: ' + inputs.length + ' INPUT(S) \u2014 ' + inputs[0].name);

        // Hot-plug: re-scan when devices connect/disconnect
        midiAccess.onstatechange = (e) => {
            log('MIDI_STATE: ' + e.port.name + ' ' + e.port.state.toUpperCase());
            setupMidiHandlers(midiAccess);
        };
        return true;
    }

    // MIDI LEARN MODE - Click element + hit MIDI to bind
    if ($('btn-midi-learn')) {
        $('btn-midi-learn').onclick = async () => {
            // Auto-init MIDI when activating learn mode for the first time
            if (!APP.midi.learnMode && !APP.status.isMidiActive) {
                log('MIDI_LEARN: AUTO_INIT_MIDI...');
                const midiAccess = await igniteMIDI();
                if (midiAccess) {
                    setupMidiHandlers(midiAccess);
                } else {
                    log('MIDI_LEARN: INIT_FAILED — connect a MIDI device first');
                    return;
                }
            }

            APP.midi.learnMode = !APP.midi.learnMode;
            document.body.classList.toggle('midi-learn-active', APP.midi.learnMode);
            $('btn-midi-learn').textContent = APP.midi.learnMode ? 'LEARN: ON' : 'LEARN: OFF';
            $('btn-midi-learn').classList.toggle('on', APP.midi.learnMode);
            log('MIDI_LEARN: ' + (APP.midi.learnMode ? 'ACTIVE \u2014 SELECT A TARGET' : 'OFF'));

            const sfxArmEl = $('sfx-midi-arm');
            if (APP.midi.learnMode) {
                if (sfxArmEl) sfxArmEl.textContent = 'ARM: CLICK A BUTTON BELOW';
                document.querySelectorAll('[data-midi-target]').forEach(el => {
                    el.addEventListener('click', midiLearnClick, true); // capture phase
                });
            } else {
                if (sfxArmEl) sfxArmEl.textContent = '';
                document.querySelectorAll('[data-midi-target]').forEach(el => {
                    el.removeEventListener('click', midiLearnClick, true);
                });
                APP.midi.learnTarget = null;
                // Clear arm outlines
                document.querySelectorAll('[data-midi-target]').forEach(el => el.style.outline = '');
            }
        };
    }

    function midiLearnClick(e) {
        if (!APP.midi.learnMode) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // prevent SFX from firing while arming

        // Clear previous arm highlight
        document.querySelectorAll('[data-midi-target]').forEach(el => el.style.outline = '');

        const target = e.currentTarget.dataset.midiTarget;
        APP.midi.learnTarget = { element: e.currentTarget, target: target };
        log('MIDI_LEARN: ARMED \u2014 press a MIDI key/pad for ' + target.toUpperCase());
        e.currentTarget.style.outline = '2px solid var(--v)';
        const sfxArmEl = $('sfx-midi-arm');
        if (sfxArmEl) sfxArmEl.textContent = '\u25CF ARMED: ' + target.toUpperCase() + ' \u2014 hit MIDI';
    }
    
    // INSTRUMENT PASSTHROUGH - Synthesizer
    if ($('btn-midi-passthru')) {
        $('btn-midi-passthru').onclick = () => {
            APP.midi.passthrough = !APP.midi.passthrough;
            $('btn-midi-passthru').textContent = APP.midi.passthrough ? 'INSTRUMENT: ON' : 'INSTRUMENT: OFF';
            $('btn-midi-passthru').classList.toggle('on', APP.midi.passthrough);
            log('MIDI_INSTRUMENT: ' + (APP.midi.passthrough ? 'ACTIVE' : 'OFF'));
            
            // Initialize synth context
            if (APP.midi.passthrough && !APP.midi.synthCtx) {
                APP.midi.synthCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
                APP.midi.synthGain = APP.midi.synthCtx.createGain();
                APP.midi.synthGain.connect(APP.midi.synthCtx.destination);
            }
        };
    }
    
    // Play synthesized note
    function playSynthNote(note, velocity) {
        if (!APP.midi.passthrough || !APP.midi.synthCtx) return;
        
        const freq = 440 * Math.pow(2, (note - 69) / 12); // MIDI to frequency
        const osc = APP.midi.synthCtx.createOscillator();
        const gain = APP.midi.synthCtx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        
        const vol = (velocity / 127) * 0.3;
        gain.gain.setValueAtTime(vol, APP.midi.synthCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, APP.midi.synthCtx.currentTime + 0.5);
        
        osc.connect(gain);
        gain.connect(APP.midi.synthGain);
        osc.start();
        osc.stop(APP.midi.synthCtx.currentTime + 0.5);
    }
    
    // --- 8-PAD HYBRID SAMPLER BUTTONS ---
    // Signature pads (1-4): play immediately on click.
    // Custom pads (5-8):
    //   • Left-click (empty)  → open file picker
    //   • Left-click (loaded) → play
    //   • Left-click (armed)  → start recording
    //   • Right-click         → toggle record-arm
    //   • Recording           → click to stop early (max 10s)
    // MIDI Learn: arm button individually via data-midi-target.
    (function() {
        var _recState = {}; // slot → { recorder, chunks, timerInterval, stream }

        function _pulsePad(btn) {
            btn.classList.remove('sfx-pulse');
            void btn.offsetWidth;
            btn.classList.add('sfx-pulse');
            setTimeout(() => btn.classList.remove('sfx-pulse'), 350);
        }

        function _setHint(btn, text) {
            var hint = btn.querySelector('.pad-hint');
            if (hint) hint.textContent = text;
        }

        function _setName(btn, text) {
            var nm = btn.querySelector('.pad-name');
            if (nm) nm.textContent = text;
        }

        function _setTimer(btn, secs) {
            var t = btn.querySelector('.pad-timer');
            if (t) t.textContent = secs;
        }

        function _stopRecording(slot) {
            var st = _recState[slot];
            if (!st) return;
            clearInterval(st.timerInterval);
            if (st.recorder && st.recorder.state !== 'inactive') st.recorder.stop();
        }

        function _startRecording(slot, btn) {
            if (_recState[slot] && _recState[slot].recorder) return; // already recording
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
                var chunks = [];
                var recorder = new MediaRecorder(stream);
                var elapsed = 0;
                var MAX_SECS = 10;

                recorder.ondataavailable = function(e) {
                    if (e.data.size > 0) chunks.push(e.data);
                };
                recorder.onstop = function() {
                    stream.getTracks().forEach(t => t.stop());
                    btn.classList.remove('recording');
                    btn.classList.remove('armed');
                    clearInterval(_recState[slot] && _recState[slot].timerInterval);
                    _recState[slot] = null;

                    if (!chunks.length) {
                        _setName(btn, 'C-0' + slot);
                        _setHint(btn, 'EMPTY');
                        log('SFX_REC: CANCELLED — custom' + slot);
                        return;
                    }
                    var blob = new Blob(chunks, { type: recorder.mimeType });
                    var reader = new FileReader();
                    reader.onload = function(ev) {
                        if (!APP.audio.ctx) igniteAudio();
                        if (!APP.audio.masterGain) ensureAudioChain();
                        var ctx = APP.audio.ctx;
                        if (!ctx) return;
                        ctx.decodeAudioData(ev.target.result).then(function(buf) {
                            SFX_ENGINE._buffers()['custom' + slot] = buf;
                            btn.classList.add('loaded');
                            _setName(btn, 'REC-0' + slot);
                            _setHint(btn, 'LIVE');
                            var lcd = btn.querySelector('.pad-lcd');
                            if (lcd) lcd.textContent = 'rec-0' + slot + '.live (' + elapsed + 's)';
                            log('SFX_REC: CAPTURED — custom' + slot + ' (' + elapsed + 's)');
                        }).catch(function(e) {
                            _setName(btn, 'C-0' + slot);
                            _setHint(btn, 'ERR');
                            log('SFX_REC: DECODE_FAIL — ' + e.message);
                        });
                    };
                    reader.readAsArrayBuffer(blob);
                };

                _recState[slot] = {
                    recorder: recorder,
                    chunks: chunks,
                    stream: stream,
                    timerInterval: setInterval(function() {
                        elapsed++;
                        _setTimer(btn, MAX_SECS - elapsed);
                        if (elapsed >= MAX_SECS) _stopRecording(slot);
                    }, 1000)
                };

                btn.classList.remove('armed');
                btn.classList.add('recording');
                _setTimer(btn, MAX_SECS);
                recorder.start();
                log('SFX_REC: START — custom' + slot + ' (max 10s)');
            }).catch(function(e) {
                btn.classList.remove('armed');
                _setHint(btn, 'NO MIC');
                log('SFX_REC: MIC_DENIED — ' + e.message);
                setTimeout(() => _setHint(btn, btn.classList.contains('loaded') ? 'PLAY' : 'EMPTY'), 2000);
            });
        }

        // Wire up custom file inputs
        [1, 2, 3, 4].forEach(function(slot) {
            var fileInput = document.getElementById('sfx-file-' + slot);
            if (!fileInput) return;
            fileInput.addEventListener('change', function() {
                var file = fileInput.files && fileInput.files[0];
                if (file) {
                    SFX_ENGINE.loadCustom(slot, file);
                    var btn = document.getElementById('sfx-custom' + slot);
                    if (btn) {
                        var short = file.name.replace(/\.[^.]+$/, '').toUpperCase().substring(0, 6);
                        _setName(btn, short);
                        _setHint(btn, 'PLAY');
                        // Update LCD filename strip
                        var lcd = btn.querySelector('.pad-lcd');
                        if (lcd) lcd.textContent = file.name.substring(0, 20);
                    }
                }
                fileInput.value = '';
            });
        });

        document.querySelectorAll('.sfx-btn').forEach(btn => {
            // Right-click → toggle arm for custom pads
            btn.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                if (APP.midi.learnMode) return;
                const sfxName = btn.dataset.sfx;
                if (!sfxName || !sfxName.startsWith('custom')) return;
                const slot = parseInt(sfxName.replace('custom', ''), 10);
                if (_recState[slot] && _recState[slot].recorder) {
                    // already recording — stop
                    _stopRecording(slot);
                    return;
                }
                const isArmed = btn.classList.contains('armed');
                if (isArmed) {
                    btn.classList.remove('armed');
                    _setHint(btn, btn.classList.contains('loaded') ? 'PLAY' : 'EMPTY');
                    log('SFX_REC: DISARMED — custom' + slot);
                } else {
                    // Disarm any other armed pad first
                    document.querySelectorAll('.sfx-cust.armed').forEach(b => {
                        b.classList.remove('armed');
                        var s = parseInt(b.dataset.sfx.replace('custom',''), 10);
                        _setHint(b, b.classList.contains('loaded') ? 'PLAY' : 'EMPTY');
                    });
                    btn.classList.add('armed');
                    _setHint(btn, '● ARM');
                    log('SFX_REC: ARMED — custom' + slot);
                }
            });

            // Left-click
            btn.addEventListener('click', () => {
                if (APP.midi.learnMode) return;
                const sfxName = btn.dataset.sfx;
                const isCustom = sfxName && sfxName.startsWith('custom');

                if (isCustom) {
                    const slot = parseInt(sfxName.replace('custom', ''), 10);
                    const fileInput = document.getElementById('sfx-file-' + slot);

                    // If currently recording → stop early
                    if (btn.classList.contains('recording')) {
                        _stopRecording(slot);
                        return;
                    }
                    // If armed → start recording
                    if (btn.classList.contains('armed')) {
                        _startRecording(slot, btn);
                        return;
                    }
                    // If not loaded → open file picker
                    if (!btn.classList.contains('loaded')) {
                        if (fileInput) fileInput.click();
                        return;
                    }
                }

                if (!btn.classList.contains('pad-muted')) SFX_ENGINE.play(sfxName);
                _pulsePad(btn);
                // liq pads fire coupling inside _fireLiqPad — avoid double-trigger
                if (typeof _fireCoupledFX === 'function' && !sfxName.startsWith('liq')) _fireCoupledFX(sfxName);
                log('SFX: ' + sfxName.toUpperCase() + (btn.classList.contains('pad-muted') ? ' [MUTED]' : ''));
            });
        });

        // Also trigger pulse on MIDI-driven pads
        window._sfxMidiPulse = function(sfxName) {
            var id = 'sfx-' + sfxName;
            var btn = document.getElementById(id);
            if (btn) _pulsePad(btn);
            _fireCoupledFX(sfxName);
        };

        // ── LIQUID LIBRARY / KIT SELECTOR ────────────────────
        (function() {
            function _switchKit(packIdx) {
                _liqCurrentPack = packIdx;
                // Invalidate buffer cache for old kit so new synth fires fresh
                Object.keys(_liqBufCache).forEach(function(k) {
                    if (k.startsWith(packIdx + '_')) delete _liqBufCache[k];
                });
                _updateLiqPadLabels(packIdx);
                var ls = document.getElementById('liq-lib-select');
                if (ls) ls.value = packIdx;
                log('KIT: ' + (VANGUARD_LIQUID_LIB[packIdx] ? VANGUARD_LIQUID_LIB[packIdx].name : packIdx));
            }
            var liqSel = document.getElementById('liq-lib-select');
            if (liqSel) liqSel.addEventListener('change', function() { _switchKit(parseInt(this.value, 10) || 0); });
            if (typeof _updateLiqPadLabels === 'function') _updateLiqPadLabels(0);
        })();

        // ── COUPLING ENGINE ─────────────────────────────────────────────
        // Gear dropdown per pad: NONE → NVG / SHOOT / RESET / VOID / FAILURE / LUCY / SEISMIC / PUNCH / PARTY
        // When coupled, hitting the pad also pulses the linked visual FX for 1s.
        var _padCoupling = {};
        var ALL_COUPLING_CLASSES = [
            'coupled-nvg','coupled-shoot','coupled-reset',
            'coupled-void','coupled-failure','coupled-lucy',
            'coupled-seismic','coupled-punch','coupled-party','coupled-glitch',
            // Bank B GPU shaders
            'coupled-vb-slit-scan','coupled-vb-luma-bloom','coupled-vb-dither-luxe',
            'coupled-vb-caustics','coupled-vb-ghost-echo','coupled-vb-acid'
        ];
        var COUPLING_LABELS = {
            none:'', nvg:'NVG', shoot:'SHOOT', reset:'RESET',
            void:'VOID', failure:'FAILURE', lucy:'LUCY',
            seismic:'SEISMIC', punch:'PUNCH', party:'PARTY', glitch:'GLITCH',
            'vb-slit-scan':'SLIT_SCN', 'vb-luma-bloom':'LUM_BLM',
            'vb-dither-luxe':'DITHER', 'vb-caustics':'CAUSTIC',
            'vb-ghost-echo':'GHO_ECH', 'vb-acid':'ACID'
        };

        function _setCouplingByName(btn, sfxName, fx) {
            fx = fx || 'none';
            _padCoupling[sfxName] = fx;
            btn.classList.remove('coupled', ...ALL_COUPLING_CLASSES);
            var fxLabel = btn.querySelector('.pad-fx-label');
            // Update active state in gear menu — works even when menu is portaled to <body>
            var _gearMenu = btn.querySelector('.pad-gear-menu') ||
                (btn.id ? document.querySelector('.pad-gear-menu[data-gear-home="#' + btn.id + ' > .pad-gear"]') : null);
            if (_gearMenu) {
                _gearMenu.querySelectorAll('[data-fx]').forEach(function(o) {
                    o.classList.toggle('active-fx-opt', o.dataset.fx === fx);
                });
            }
            if (fx !== 'none') {
                btn.classList.add('coupled', 'coupled-' + fx);
                if (fxLabel) fxLabel.textContent = COUPLING_LABELS[fx] || fx.toUpperCase();
                log('PAD_COUPLE: ' + sfxName.toUpperCase() + ' → ' + fx.toUpperCase());
            } else {
                if (fxLabel) fxLabel.textContent = '';
                log('PAD_COUPLE: ' + sfxName.toUpperCase() + ' → SOUND_ONLY');
            }
        }

        // Flash an FX button with active-fx for a given duration
        function _flashFXBtn(btnId, durationMs) {
            var b = document.getElementById(btnId);
            if (!b) return;
            b.classList.add('active-fx');
            setTimeout(function() { b.classList.remove('active-fx'); }, durationMs || 3000);
        }

        function _fireCoupledFX(sfxName) {
            var fx = _padCoupling[sfxName];
            if (!fx || fx === 'none') return;

            // SEISMIC — velocity burst
            if (fx === 'seismic') {
                if (typeof APP !== 'undefined' && APP.vj) {
                    APP.vj._seismicVel = (APP.vj._seismicVel || 0) + 0.85;
                    APP.vj._seismicDemoUntil = performance.now() + 3000;
                    document.body.classList.add('seismic-active');
                    setTimeout(function() { APP.vj._seismicVel = 0; APP.vj._seismicDemoUntil = 0; document.body.classList.remove('seismic-active'); }, 3000);
                }
                _flashFXBtn('btn-rumble', 3000);
                return;
            }
            // GLITCH — canvas glitch burst (legacy compat)
            if (fx === 'glitch') {
                if (typeof APP !== 'undefined' && APP.vj) {
                    var prevSnap = APP.vj.glitchSnap || 0;
                    APP.vj.glitchSnap = 10;
                    setTimeout(function() { if (APP.vj.glitchSnap === 10) APP.vj.glitchSnap = prevSnap; }, 1000);
                }
                return;
            }
            // PUNCH — direct spring injection + 3s demo (bypass click() to avoid double-click conflicts)
            if (fx === 'punch') {
                if (typeof APP !== 'undefined' && APP.vj) {
                    APP.vj._punchSpring = 1.0;
                    APP.vj._punchDemoUntil = performance.now() + 3000;
                    APP.vj._punchDemoBeat = performance.now(); // fire first beat immediately
                }
                document.body.classList.add('fx-punch');
                _flashFXBtn('btn-punch', 3000);
                setTimeout(function() {
                    APP.vj._punchDemoUntil = 0;
                    APP.vj._punchDemoBeat = 0;
                    // Only remove fx-punch if not in persistent console mode
                    if (!APP.vj.punchConsoleMode) {
                        document.body.classList.remove('fx-punch');
                        var pb = document.getElementById('btn-punch');
                        if (pb && !pb.classList.contains('console-mode')) pb.classList.remove('on');
                    }
                }, 3000);
                return;
            }
            // PARTY — toggle on for 3s
            if (fx === 'party') {
                var partyBtn = document.getElementById('btn-ui-react');
                if (partyBtn && !partyBtn.classList.contains('on')) {
                    partyBtn.click();
                    setTimeout(function() { if (partyBtn.classList.contains('on')) partyBtn.click(); }, 3000);
                } else {
                    _flashFXBtn('btn-ui-react', 3000);
                }
                return;
            }
            // FAILURE — trigger chaos sequence (self-timed 5s)
            if (fx === 'failure') {
                var failBtn = document.getElementById('btn-psychosis');
                if (failBtn) failBtn.click();
                _flashFXBtn('btn-psychosis', 5000);
                return;
            }
            // SHOOT — enable shooting mode for 3s
            if (fx === 'shoot') {
                var shootBtn = document.getElementById('btn-shooting');
                if (shootBtn && !shootBtn.classList.contains('on')) {
                    shootBtn.click();
                    setTimeout(function() { if (shootBtn.classList.contains('on')) shootBtn.click(); }, 3000);
                } else {
                    _flashFXBtn('btn-shooting', 3000);
                }
                return;
            }
            // RESET — hard reset (one-shot)
            if (fx === 'reset') {
                if (typeof triggerHardReset === 'function') triggerHardReset();
                _flashFXBtn('btn-reset', 1000);
                return;
            }
            // BANK B — VNGRD_B GPU shader burst (3s one-shot via coupling)
            if (fx.indexOf('vb-') === 0) {
                var shaderMap = {
                    'vb-slit-scan':'SLIT_SCAN','vb-luma-bloom':'LUMA_BLOOM',
                    'vb-dither-luxe':'DITHER_LUXE','vb-caustics':'CAUSTICS',
                    'vb-ghost-echo':'GHOST_ECHO','vb-acid':'ACID'
                };
                var sn = shaderMap[fx];
                if (sn) {
                    if (typeof _setFXBank === 'function') _setFXBank('B');
                    if (typeof window._vbCoupleActivate === 'function') {
                        window._vbCoupleActivate(sn);
                    } else if (typeof window._vbActivate === 'function') {
                        window._vbActivate(sn, false);
                    }
                }
                return;
            }
            // CSS class-based FX: nvg, void, lucy, scan, tear, etc. — 3s one-shot
            var cls = 'fx-' + fx;
            var wasOn = document.body.classList.contains(cls);
            if (typeof toggleFX === 'function' && !wasOn) {
                toggleFX(fx);
                setTimeout(function() {
                    if (document.body.classList.contains(cls)) toggleFX(fx);
                }, 3000);
            } else {
                document.body.classList.add(cls);
                setTimeout(function() { if (!wasOn) document.body.classList.remove(cls); }, 3000);
            }
        }

        // ── GEAR DROPDOWN — global toggle (closes others) ────────────────
        // Menu is portaled to <body> on open because .sidebar has
        // transform+overflow, which makes position:fixed inside it scope
        // to the sidebar instead of the viewport.
        function _closeAllGearMenus() {
            document.querySelectorAll('.pad-gear.open').forEach(function(g) {
                g.classList.remove('open');
                var pad = g.closest('.sfx-pad');
                if (pad) pad.classList.remove('z-elevated');
            });
            // Restore any portaled menus to their original parent
            document.querySelectorAll('.pad-gear-menu[data-portaled="1"]').forEach(function(m) {
                m.removeAttribute('style');
                m.removeAttribute('data-portaled');
                var homeSel = m.getAttribute('data-gear-home');
                var home = homeSel && document.querySelector(homeSel);
                if (home) home.appendChild(m);
            });
            var padBody = document.getElementById('sfx-pad-body');
            if (padBody) padBody.classList.remove('gear-open');
        }
        window._padGearToggle = function(iconEl) {
            var gearEl = iconEl.parentElement;
            var isOpen = gearEl.classList.contains('open');
            _closeAllGearMenus();
            if (!isOpen) {
                gearEl.classList.add('open');
                var pad = gearEl.closest('.sfx-pad');
                if (pad) pad.classList.add('z-elevated');
                var padBody = document.getElementById('sfx-pad-body');
                if (padBody) padBody.classList.add('gear-open');

                // VIEWPORT-AWARE POSITIONING — portal to <body> so that
                // ancestor transforms/overflow don't clip or re-scope us.
                var menu = gearEl.querySelector('.pad-gear-menu');
                if (menu) {
                    var ir = iconEl.getBoundingClientRect();
                    var mW = 110;   // menu min-width
                    var mH = 300;   // approximate max menu height

                    // Default: open upward, right-aligned to icon
                    var top  = ir.top - mH - 4;
                    var left = ir.right - mW;

                    // Flip downward if not enough room above
                    if (top < 8) top = ir.bottom + 4;
                    // Clamp horizontally to viewport
                    if (left < 8) left = 8;
                    if (left + mW > window.innerWidth - 8) left = window.innerWidth - mW - 8;
                    // Clamp vertically
                    if (top + mH > window.innerHeight - 8) top = window.innerHeight - mH - 8;
                    if (top < 8) top = 8;

                    // Remember original home so we can restore on close.
                    // Identify the gear by the pad's sfx id (unique).
                    if (pad && pad.id) {
                        menu.setAttribute('data-gear-home', '#' + pad.id + ' > .pad-gear');
                    }
                    menu.setAttribute('data-portaled', '1');
                    document.body.appendChild(menu);

                    menu.style.cssText = [
                        'display:block',
                        'position:fixed',
                        'top:' + top + 'px',
                        'left:' + left + 'px',
                        'bottom:auto',
                        'right:auto',
                        'z-index:99999',
                        'max-height:' + (window.innerHeight - top - 12) + 'px',
                        'overflow-y:auto'
                    ].join(';');
                    // Sync active-fx-opt to reflect current coupling
                    if (typeof window._syncPadGearActive === 'function' && pad && pad.id) {
                        window._syncPadGearActive(pad.id);
                    }
                }
            }
        };
        // Close on outside click
        document.addEventListener('click', function() { _closeAllGearMenus(); });

        // ── SAMPLER COLLAPSE TOGGLE ───────────────────────────────────────
        window._toggleSamplerBody = function() {
            var body = document.getElementById('sfx-pad-body');
            var arrow = document.getElementById('sfx-collapse-arrow');
            if (!body) return;
            var isOpen = !body.classList.contains('collapsed');
            body.classList.toggle('collapsed', isOpen);
            if (arrow) arrow.textContent = isOpen ? '\u25B8' : '\u25BE';
        };

        // ── SAMPLER HELP MODAL (legacy — kept for compat) ────────────────
        window._toggleSamplerHelp = function() {
            var modal = document.getElementById('sampler-help-modal');
            if (modal) modal.classList.toggle('visible');
        };

        // ═══════════════════════════════════════════════════════════════
        // SECTION HELP OVERLAY — unified HUD "How to Use" for all panels
        // ═══════════════════════════════════════════════════════════════
        var _SECTION_HELP = {
            'camera': {
                title: 'CAMERA_4K',
                rows: [
                    ['CAM CAPTURE', 'Requests camera access and starts the live 4K preview feed.'],
                    ['GO LIVE',     '3-2-1 countdown, then broadcasts the live camera to the canvas.'],
                    ['INJECT LOOP', 'Records a 10-second loop from the camera and injects it as media.'],
                    ['MIC',         'Arms microphone input alongside the camera capture.'],
                    ['REC BCAST',   'Records the live canvas output. Tap again to stop and save.']
                ],
                footer: 'VNGRD // CAMERA_4K · LIVE CAPTURE'
            },
            'ai': {
                title: 'AI_INJECTION',
                rows: [
                    ['MODEL',    'Choose a generation engine: FLUX (free), GPT IMAGE, SEEDREAM, and more.'],
                    ['⚙',        'Gear icon reveals an optional API key field for premium model access.'],
                    ['PROMPT',   'Type your scene description, then press GENERATE.'],
                    ['GENERATE', 'Sends the prompt. Result composites live over the canvas automatically.'],
                    ['STATUS',   'Shows READY or PROCESSING — wait for READY before re-generating.']
                ],
                footer: 'VNGRD // AI_INJECTION · GENERATIVE LAYER'
            },
            'identity': {
                title: 'IDENTITY',
                rows: [
                    ['● COLOR',  'Colour picker on the text row sets the bug tint in real-time.'],
                    ['SET BUG',  'Commits the station name as a live watermark overlay on the canvas.'],
                    ['PL/PU/GL', 'Style — PLAIN: solid fill. PULSE: animated alpha. GLITCH: RGB split.'],
                    ['SLD/K/O/INV', 'Render mode — SLD: solid fill. K/O: knockout (stroke outline, video shows through). INV: difference blend, auto-contrasts on any background.'],
                    ['[X]',      'Toggle the station name bug visible or hidden on the canvas.'],
                    ['2D LOGO',  'Load a PNG/JPG/GIF as a corner logo overlay on the canvas.'],
                    ['3D LOGO',  'Load a .OBJ/.FBX model — renders and spins live on the canvas.']
                ],
                footer: 'VNGRD // IDENTITY · STATION BRAND'
            },
            'lower-third': {
                title: 'LOWER_THIRD',
                rows: [
                    ['NAME',   'Enter the subject name — renders as the primary lower-third line.'],
                    ['ROLE',   'Enter the title or role — renders as the secondary subtitle line.'],
                    ['GUEST',  'Fires the lower-third in name/role format. Stays on canvas.'],
                    ['TRACK',  'Swaps to track-title mode (green tint). Updates live.'],
                    ['BREAK',  'Fires a BREAKING NEWS style lower-third (red tint).'],
                    ['×',      'Fades the lower-third out with an exit animation, then removes it.'],
                    ['STYLE',  'Graphic preset — DEFAULT: clean bar. NEON: glowing border. SPLIT: two-column. GLITCH: rounded pill, electric violet, chromatic aberration + glitch bars.'],
                    ['ENTER/EXIT', 'All styles animate in (slide + fade). × triggers a smooth exit before clearing.']
                ],
                footer: 'VNGRD // LOWER_THIRD · BROADCAST GRAPHIC'
            },
            'midi': {
                title: 'MIDI_HOST',
                rows: [
                    ['MIDI INIT',  'Request browser MIDI access — allow the popup when prompted.'],
                    ['LEARN: OFF', 'Click to arm learn mode — the next button you click waits for MIDI.'],
                    ['BIND',       'Press a key on your controller to bind it to the armed button.'],
                    ['STATUS',     'Shows connected device name or NO DEVICE if none detected.'],
                    ['BINDINGS',   'Cyan list of active MIDI → button mappings. Auto-saved on bind.']
                ],
                footer: 'VNGRD // MIDI_HOST · CONTROLLER BRIDGE'
            },
            'reactivity': {
                title: 'REACTIVITY',
                rows: [
                    ['X-RAY',   'Toggles a luminance-invert scan effect on the canvas.'],
                    ['TEAR',    'Horizontal tear glitch — slices the canvas frame on beat.'],
                    ['FAILURE', 'System-failure cascade: flicker, RGB split, screen chaos.'],
                    ['SHOOT',   'Arms a crosshair — each canvas click shatters the glass.'],
                    ['VOID',    'Full grayscale crunch and color collapse. Extreme mode.'],
                    ['LUCY',    'Chromatic hallucination — trails and hue drift on bass.'],
                    ['VHS_OVR', 'Overlays a VHS scanline and tape-degradation effect.'],
                    ['NVG',     'Night-vision green filter. Click to toggle on or off.'],
                    ['RESET',   'Hard reset — clears all active FX and restores canvas.']
                ],
                footer: 'VNGRD // REACTIVITY · VISUAL FX ENGINE'
            },
            'audio-engine': {
                title: 'AUDIO_ENGINE',
                rows: [
                    ['LOAD AUDIO',  'Load an audio or video file to play through the engine.'],
                    ['▶ / ❚❚',      'Play or pause the loaded track or video source.'],
                    ['SCAN INPUTS', 'Detect and list available audio input devices.'],
                    ['STEREO',      'Flat stereo playback — direct, unprocessed output.'],
                    ['3D_SPATIAL',  'HRTF spatial mode — positions audio in a virtual 3D room.'],
                    ['DOLBY_DSP',   'Enhanced DSP with expanded stereo width and depth.']
                ],
                footer: 'VNGRD // AUDIO_ENGINE · DAW CORE'
            },
            'audio-reactive': {
                title: 'AUDIO_REACTIVE',
                rows: [
                    ['PARTY',   'Beat-reactive mode — UI themes and canvas morph on bass hits.'],
                    ['SEISMIC', 'Arms viewport shake on kick. Single tap = 3s demo. Dbl-click = lock.'],
                    ['PUNCH',   'Spring-elastic canvas punch on beats. Dbl-click to lock permanently.'],
                    ['SAMPLER', 'Tap the (?) on Sampler SFX header for pad-specific controls.']
                ],
                footer: 'VNGRD // AUDIO_REACTIVE · BEAT ENGINE'
            },
            'polytranslator': {
                title: 'POLYTRANSLATOR',
                rows: [
                    ['OFF-AIR',    'Click to toggle ON-AIR and start live subtitle translation.'],
                    ['SLOTS',      'Expand to configure up to 4 output language channels.'],
                    ['LANG 1–4',   'Each slot outputs live subtitles in the selected language.'],
                    ['SUB_BG',     'Cycles subtitle background opacity: 0% → 33% → 67%.'],
                    ['STT',        'Switch speech-to-text source between local mic and P2P guest.'],
                    ['INPUT LANG', 'Set the language you will speak into the microphone.']
                ],
                footer: 'VNGRD // POLYTRANSLATOR · V3.0_MODULAR'
            },
            'session-lab': {
                title: 'SESSION_LAB',
                rows: [
                    ['CAPTURE CLIP', 'Records and saves a VNGRD-branded clip from the canvas output.'],
                    ['SAVE',         'Saves all current settings and state to browser local storage.'],
                    ['IMPORT',       'Load a saved session from a .VGD or .JSON file from disk.'],
                    ['SHARE_QR',     'Exports the session and generates a shareable QR code link.'],
                    ['ENTER_VR',     'Launches the spatial WebXR gateway — requires a VR headset.']
                ],
                footer: 'VNGRD // SESSION_LAB · STATE PERSISTENCE'
            },
            'nft-vault': {
                title: 'NFT_VAULT',
                rows: [
                    ['ETH ADDR',     'Enter an ETH address or ENS name (e.g. vitalik.eth) to scan.'],
                    ['TEZ ADDR',     'Enter a Tezos address or TezDomains name (e.g. alice.tez).'],
                    ['SCAN WALLET',  'Fetches and displays all NFTs linked to the entered addresses.'],
                    ['NFT GRID',     'Click any NFT thumbnail to load it as live canvas media.'],
                    ['ASSETS: N',    'Shows the total count of discovered assets across all wallets.']
                ],
                footer: 'VNGRD // NFT_VAULT · ON-CHAIN MEDIA'
            },
            'sampler': {
                title: 'SAMPLER SFX',
                rows: [
                    ['TAP',       'Fire any pad immediately. Works with mouse, touch, or MIDI.'],
                    ['ZONE 1',    'SIG BANK — 3 sig pads + BOOM wide-pad. Core Vanguard sounds.'],
                    ['ZONE 2',    'CUSTOM — tap C-01–C-03 to load audio. C-04 wide-pad. R-click: arm mic REC.'],
                    ['ZONE 3',    'LIQUID LIB — 4 synthesized bass pads at 0.75× speed. Select pack below.'],
                    ['⚙ FX',     'Gear icon on any pad couples a visual effect that fires with the sound.'],
                    ['TAP',       'Every tap fires sound zero-latency.'],
                    ['MIDI',      'Use MIDI LEARN in the MIDI_HOST section to bind any pad to your controller.']
                ],
                footer: 'VNGRD // SAMPLER SFX · 12-PAD'
            }
        };

        // Shared helper — hide SHOOT when any overlay is open, restore when all are closed
        function _syncShootBtn() {
            var shoot = document.getElementById('btn-shooting');
            if (!shoot) return;
            shoot.style.visibility = document.querySelector('.section-help-overlay.visible') ? 'hidden' : '';
        }

        window._toggleSectionHelp = function(btn, sectionId) {
            var section = btn.closest('.section');
            if (!section) return;

            var overlay = section.querySelector('.section-help-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'section-help-overlay';
                section.appendChild(overlay);
            }

            // Toggle off if already showing this section's content
            if (overlay.classList.contains('visible') && overlay.dataset.shoId === sectionId) {
                overlay.classList.remove('visible');
                _syncShootBtn();
                return;
            }

            // Auto-expand collapsed sections so the overlay has room to render
            var colHead = section.querySelector('.sec-head.collapsible');
            if (colHead && !colHead.classList.contains('open')) {
                colHead.classList.add('open');
                var colBody = colHead.nextElementSibling;
                if (colBody) {
                    colBody.style.maxHeight = '500px';
                    colBody.style.padding = '10px 12px';
                }
                var colArrow = colHead.querySelector('.sec-arrow');
                if (colArrow) colArrow.textContent = '\u25BE';
            }

            // CAMERA: force-expand to the post-capture state so the overlay fills a
            // properly-sized section (preview 16:9 box + cam-ctrls buttons visible)
            if (sectionId === 'camera') {
                var prevFloat = document.getElementById('cam-preview-float');
                var camCtrls  = document.getElementById('cam-ctrls');
                if (prevFloat && !prevFloat.classList.contains('active')) {
                    prevFloat.classList.add('active');
                }
                if (camCtrls && camCtrls.style.display === 'none') {
                    camCtrls.style.display = 'block';
                }
            }

            var d = _SECTION_HELP[sectionId];
            if (!d) { overlay.classList.remove('visible'); return; }
            overlay.dataset.shoId = sectionId;
            overlay.innerHTML =
                '<div class="sho-header">' +
                    '<span>HOW TO USE</span>' +
                    '<button class="sho-close" onclick="event.stopPropagation();_closeSectionHelp(this)">&#x2715;</button>' +
                '</div>' +
                '<div class="sho-rows">' +
                d.rows.map(function(r) {
                    return '<div class="sho-row">' +
                        '<span class="sho-key">' + r[0] + '</span>' +
                        '<span class="sho-desc">' + r[1] + '</span>' +
                    '</div>';
                }).join('') +
                '</div>' +
                '<div class="sho-footer">' + d.footer + '</div>';

            overlay.classList.add('visible');
            _syncShootBtn();   // hide SHOOT while any overlay is open
        };

        window._closeSectionHelp = function(closeBtn) {
            var overlay = closeBtn.closest('.section-help-overlay');
            if (overlay) overlay.classList.remove('visible');
            _syncShootBtn();   // restore SHOOT once all overlays are closed
        };

        // Wire up gear menu items for every pad
        document.querySelectorAll('.sfx-btn').forEach(function(btn) {
            var sfxName = btn.dataset.sfx;
            if (!sfxName) return;
            _padCoupling[sfxName] = 'none';

            btn.querySelectorAll('.pad-gear-menu [data-fx]').forEach(function(opt) {
                opt.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var gearEl = opt.closest('.pad-gear');
                    if (gearEl) gearEl.classList.remove('open');

                    // CLEAR — only for custom pads; wipes audio buffer and resets UI
                    if (opt.dataset.fx === 'clear' && sfxName.startsWith('custom')) {
                        var bufs = SFX_ENGINE._buffers();
                        if (bufs[sfxName]) delete bufs[sfxName];
                        btn.classList.remove('loaded', 'coupled', ...ALL_COUPLING_CLASSES, 'armed', 'recording');
                        _padCoupling[sfxName] = 'none';
                        var slotNum = sfxName.replace('custom', '');
                        var nm = btn.querySelector('.pad-name');
                        var hint = btn.querySelector('.pad-hint');
                        var lcd = btn.querySelector('.pad-lcd');
                        var fxLbl = btn.querySelector('.pad-fx-label');
                        if (nm) nm.textContent = 'C-0' + slotNum;
                        if (hint) hint.textContent = 'LOAD SAMPLE';
                        if (lcd) lcd.textContent = '— empty —';
                        if (fxLbl) fxLbl.textContent = '';
                        log('SFX: CLEARED ' + sfxName.toUpperCase());
                        return;
                    }

                    _setCouplingByName(btn, sfxName, opt.dataset.fx);
                });
            });

            // Single click → fire coupled FX only if this pad has an explicit coupling
            btn.addEventListener('click', function() {
                if (_padCoupling[sfxName] && _padCoupling[sfxName] !== 'none') {
                    _fireCoupledFX(sfxName);
                }
            });
        });

        // Sync gear menu active-fx-opt after portaling (called by _padGearToggle)
        window._syncPadGearActive = function(padId) {
            var btn = document.getElementById(padId);
            if (!btn) return;
            var sn = btn.dataset.sfx;
            var fx = sn && _padCoupling[sn];
            if (!fx || fx === 'none') return;
            var menu = document.querySelector('.pad-gear-menu[data-gear-home="#' + padId + ' > .pad-gear"]')
                    || btn.querySelector('.pad-gear-menu');
            if (!menu) return;
            menu.querySelectorAll('[data-fx]').forEach(function(o) {
                o.classList.toggle('active-fx-opt', o.dataset.fx === fx);
            });
        };
    })();

    // --- MIDI CONTROLLER (JIT — user gesture gated) ---
    $('btn-midi').onclick = async () => {
        // Allow re-scan even if already active (catches newly plugged devices)
        APP.status.isMidiActive = false;
        const midiAccess = await igniteMIDI();
        if (!midiAccess) return;
        try {
            setupMidiHandlers(midiAccess);
        } catch (e) {
            log('MIDI_ERROR: ' + e.message);
        }
    };
    
    function triggerMidiBinding(binding, velocity) {
        const el = binding.element;
        const target = binding.target;
        const intensity = velocity / 127;
        
        switch(target) {
            case 'stutter': impactStutter(); break;
            case 'invert': impactInvert(); break;
            case 'crush': impactCrush(); break;
            case 'shatter': if (typeof createGlassFracture === 'function') createGlassFracture(window.innerWidth/2, window.innerHeight/2); break;
            case 'lens-drip': el.click(); break;
            case 'heat-haze': el.click(); break;
            // VNGRD_VST — drum/bass layers
            case 'vst:808_kick':   if (typeof VNGRD_VST !== 'undefined') VNGRD_VST.playDrumSound('808', 'kick',  velocity); break;
            case 'vst:808_snare':  if (typeof VNGRD_VST !== 'undefined') VNGRD_VST.playDrumSound('808', 'snare', velocity); break;
            case 'vst:909_kick':   if (typeof VNGRD_VST !== 'undefined') VNGRD_VST.playDrumSound('909', 'kick',  velocity); break;
            case 'vst:909_snare':  if (typeof VNGRD_VST !== 'undefined') VNGRD_VST.playDrumSound('909', 'snare', velocity); break;
            case 'vst:808_hihat':  if (typeof VNGRD_VST !== 'undefined') VNGRD_VST.playDrumSound('808', 'hihat_closed', velocity); break;
            case 'vst:909_hihat':  if (typeof VNGRD_VST !== 'undefined') VNGRD_VST.playDrumSound('909', 'hihat_closed', velocity); break;
            // SFX_ENGINE — 8-pad hybrid sampler
            case 'sfx:applause':   SFX_ENGINE.play('applause'); if(window._sfxMidiPulse) _sfxMidiPulse('applause'); break;
            case 'sfx:cheer':      SFX_ENGINE.play('cheer');    if(window._sfxMidiPulse) _sfxMidiPulse('cheer');    break;
            case 'sfx:horn':       SFX_ENGINE.play('horn');     if(window._sfxMidiPulse) _sfxMidiPulse('horn');     break;
            case 'sfx:boom':       SFX_ENGINE.play('boom');     if(window._sfxMidiPulse) _sfxMidiPulse('boom');     break;
            case 'sfx:custom1':    SFX_ENGINE.play('custom1');  if(window._sfxMidiPulse) _sfxMidiPulse('custom1'); break;
            case 'sfx:custom2':    SFX_ENGINE.play('custom2');  if(window._sfxMidiPulse) _sfxMidiPulse('custom2'); break;
            case 'sfx:custom3':    SFX_ENGINE.play('custom3');  if(window._sfxMidiPulse) _sfxMidiPulse('custom3'); break;
            case 'sfx:custom4':    SFX_ENGINE.play('custom4');  if(window._sfxMidiPulse) _sfxMidiPulse('custom4'); break;
            default: if (el && el.click) el.click();
        }
    }
    
    function triggerMidiCCBinding(binding, val) {
        const el = binding.element;
        const target = binding.target;
        
        if (el.tagName === 'INPUT' && el.type === 'range') {
            const min = parseFloat(el.min);
            const max = parseFloat(el.max);
            el.value = min + (max - min) * val;
            el.dispatchEvent(new Event('input'));
        }
    }
    
    function updateMidiBindingsDisplay() {
        const container = $('midi-bindings');
        if (!container) return;
        
        const bindings = Object.entries(APP.midi.bindings);
        if (bindings.length === 0) {
            container.textContent = '';
            return;
        }
        
        container.innerHTML = bindings.map(([key, val]) => `${key}:${val.target}`).join(' | ');
    }

    // --- AUTO-MIDI INIT: Probe on load if device already connected ---
    async function autoInitMIDI() {
        if (!navigator.requestMIDIAccess) return;
        try {
            const midiAccess = await navigator.requestMIDIAccess({ sysex: false });
            const inputs = Array.from(midiAccess.inputs.values());
            if (inputs.length === 0) return;
            APP.midi.access = midiAccess;
            APP.status.isMidiActive = true;
            setupMidiHandlers(midiAccess);
            log('MIDI_AUTO: SIGNAL_RESTORED');
        } catch (e) {
            log('MIDI_PROBE_FAIL: ' + e.message);
        }
    }

    // --- WebXR VR MODE ---
    $('btn-vr').onclick = async () => {
        // Toggle off if already in VR
        if (APP.vr && APP.vr.active && APP.vr.session) {
            APP.vr.session.end();
            return;
        }

        if (!navigator.xr) {
            log('WEBXR_NOT_SUPPORTED');
            alert('WebXR not supported. Try a VR-capable browser like Oculus Browser, Firefox Reality, or Chrome with a VR headset.');
            return;
        }

        try {
            const supported = await navigator.xr.isSessionSupported('immersive-vr');
            if (!supported) {
                const inlineSupported = await navigator.xr.isSessionSupported('inline');
                if (inlineSupported) {
                    log('VR: Inline mode available');
                    alert('Full VR not available. For phone VR, open in a WebXR-compatible browser.');
                } else {
                    log('NO_VR_SUPPORT');
                    alert('No VR headset detected. Connect a VR device and try again.');
                }
                return;
            }

            log('VR: Starting immersive session');
            $('btn-vr').classList.add('on');
            $('btn-vr').textContent = 'EXIT_VR';

            const session = await navigator.xr.requestSession('immersive-vr', {
                requiredFeatures: ['local-floor'],
                optionalFeatures: ['bounded-floor', 'hand-tracking']
            });

            APP.vr = { session: session, active: true };

            // Create WebGL2 context for VR
            const vrCanvas = document.createElement('canvas');
            const gl = vrCanvas.getContext('webgl2', { xrCompatible: true });
            if (!gl) { log('VR: WebGL2 not available'); session.end(); return; }

            await gl.makeXRCompatible();
            const baseLayer = new XRWebGLLayer(session, gl);
            session.updateRenderState({ baseLayer: baseLayer });
            const refSpace = await session.requestReferenceSpace('local-floor');

            // Build fullscreen-quad shader to blit VJ canvas into VR
            var vsrc = 'attribute vec2 a;varying vec2 v;void main(){v=a*0.5+0.5;v.y=1.0-v.y;gl_Position=vec4(a,0,1);}';
            var fsrc = 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,v);}';
            function makeShader(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
            var prog = gl.createProgram();
            gl.attachShader(prog, makeShader(gl.VERTEX_SHADER, vsrc));
            gl.attachShader(prog, makeShader(gl.FRAGMENT_SHADER, fsrc));
            gl.linkProgram(prog);
            gl.useProgram(prog);
            var buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
            var aLoc = gl.getAttribLocation(prog, 'a');
            gl.enableVertexAttribArray(aLoc);
            gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
            var tex = gl.createTexture();

            // VR render loop — blit APP.render.canvas into each eye
            session.requestAnimationFrame(function vrLoop(time, frame) {
                if (!APP.vr.active) return;
                session.requestAnimationFrame(vrLoop);
                var pose = frame.getViewerPose(refSpace);
                if (!pose) return;
                gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
                for (var i = 0; i < pose.views.length; i++) {
                    var view = pose.views[i];
                    var vp = baseLayer.getViewport(view);
                    gl.viewport(vp.x, vp.y, vp.width, vp.height);
                    gl.bindTexture(gl.TEXTURE_2D, tex);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, APP.render.canvas);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                }
            });

            session.addEventListener('end', () => {
                APP.vr.active = false;
                $('btn-vr').classList.remove('on');
                $('btn-vr').textContent = 'ENTER_VR';
                log('VR: Session ended');
            });

        } catch (e) {
            log('VR_ERROR: ' + e.message);
            $('btn-vr').classList.remove('on');
            $('btn-vr').textContent = 'ENTER_VR';
        }
    };

    $('btn-nft-30').onclick = startNFTRecording;

    // ── SESSION LAB BUTTONS ──
    $('btn-save').onclick = function() { $('save-modal').style.display = 'flex'; };
    $('btn-save-modal-close').onclick = function() { $('save-modal').style.display = 'none'; };
    $('btn-save-local').onclick = function() {
        downloadWorkspaceSnapshot();
        $('save-modal').style.display = 'none';
    };
    $('btn-save-wallet').onclick = function() {
        $('save-modal').style.display = 'none';
        saveSessionToCloud();
    };

    $('btn-import-dna').onclick = function() { $('file-vgd').click(); };
    $('file-vgd').onchange = function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
            try {
                var s = JSON.parse(ev.target.result);
                if (s.theme) setTheme(s.theme);
                if (s.bug) { APP.bug.text = s.bug; $('bug-text').value = s.bug; $('station-bug').textContent = s.bug; }
                if (s.vj) APP.vj = Object.assign({}, APP.vj, s.vj);
                if (s.layers) {
                    APP.layers = Object.assign({}, APP.layers, s.layers);
                    APP.trinity.logo.scale = APP.layers.logoScale || 1.0;
                    APP.trinity.bug.scale = APP.layers.bugScale || 1.5;
                }
                if (s.logo2d && isValidDataURI(s.logo2d)) {
                    var ll = $('user-logo-layer');
                    if (ll) { ll.src = s.logo2d; ll.style.display = 'block'; APP.trinity.logo.visible = true; }
                }
                if (s.lowerThird) {
                    if (s.lowerThird.title) { if ($('lt-title-text')) $('lt-title-text').textContent = s.lowerThird.title; if ($('lt-title')) $('lt-title').value = s.lowerThird.title; }
                    if (s.lowerThird.subtitle) { if ($('lt-subtitle-text')) $('lt-subtitle-text').textContent = s.lowerThird.subtitle; if ($('lt-sub')) $('lt-sub').value = s.lowerThird.subtitle; }
                    if (s.lowerThird.preset) APP.lowerThird.preset = s.lowerThird.preset;
                    APP.lowerThird.visible = !!s.lowerThird.visible;
                }
                if ($('sl-b')) $('sl-b').value = Math.round(APP.vj.brightness * 100);
                if ($('sl-c')) $('sl-c').value = Math.round(APP.vj.contrast * 100);
                if ($('sl-s')) $('sl-s').value = Math.round(APP.vj.saturation * 100);
                if ($('sl-h')) $('sl-h').value = APP.vj.hue;
                log('VGD: ' + file.name.toUpperCase());
            } catch(err) { log('VGD_ERR: ' + err.message); }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    $('btn-share-qr').onclick = executeWorkspaceExport;

    // ========================================
    // ========================================
    // KINETIC_MATERIAL_IMPACTS + WEAPON_STATE_ISOLATION
    // STRUCTURAL_INTEGRITY + ACOUSTIC_SYNTHESIS
    // ========================================
    
    // ACOUSTIC SYNTHESIS - NO EXTERNAL FILES
    function getAudioCtx() {
        if (!APP.shooting.audioCtx) {
            APP.shooting.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return APP.shooting.audioCtx;
    }
    
    // GLASS BREAK: HPF crack snap + high shimmer tines + sine thud + BPF noise tail
    function playGlassShatter() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        const out = ctx.destination;
        // L1: 8ms shaped noise HPF @4200Hz
        const crackBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.008), ctx.sampleRate);
        const cd = crackBuf.getChannelData(0);
        for (let i = 0; i < cd.length; i++) cd[i] = (Math.random()*2-1) * Math.pow(1 - i/cd.length, 2.5);
        const crack = ctx.createBufferSource(); crack.buffer = crackBuf;
        const crackHpf = ctx.createBiquadFilter(); crackHpf.type='highpass'; crackHpf.frequency.value=4200;
        const crackGain = ctx.createGain();
        crackGain.gain.setValueAtTime(1.3, now); crackGain.gain.exponentialRampToValueAtTime(0.001, now+0.01);
        crack.connect(crackHpf); crackHpf.connect(crackGain); crackGain.connect(out);
        crack.start(now); crack.stop(now+0.012);
        // L2: 5 inharmonic sine tines staggered
        [2900, 3700, 4600, 5400, 7100].forEach((f, i) => {
            const freq = f * (0.92 + Math.random()*0.16);
            const t0 = now + i*0.007; const dur = 0.13 + Math.random()*0.11;
            const osc = ctx.createOscillator(); osc.type='sine'; osc.frequency.value=freq;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.14, t0+0.003);
            g.gain.exponentialRampToValueAtTime(0.001, t0+dur);
            osc.connect(g); g.connect(out); osc.start(t0); osc.stop(t0+dur+0.01);
        });
        // L3: 160→50Hz sine thud
        const thud = ctx.createOscillator(); thud.type='sine';
        thud.frequency.setValueAtTime(160, now); thud.frequency.exponentialRampToValueAtTime(50, now+0.12);
        const thudG = ctx.createGain();
        thudG.gain.setValueAtTime(0.38, now); thudG.gain.exponentialRampToValueAtTime(0.001, now+0.16);
        thud.connect(thudG); thudG.connect(out); thud.start(now); thud.stop(now+0.18);
        // L4: BPF noise tail @3200Hz
        const tailBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate*0.28), ctx.sampleRate);
        const td = tailBuf.getChannelData(0); for (let i=0;i<td.length;i++) td[i]=Math.random()*2-1;
        const tail = ctx.createBufferSource(); tail.buffer=tailBuf;
        const tailBpf = ctx.createBiquadFilter(); tailBpf.type='bandpass'; tailBpf.frequency.value=3200; tailBpf.Q.value=0.7;
        const tailG = ctx.createGain();
        tailG.gain.setValueAtTime(0.07, now+0.012); tailG.gain.exponentialRampToValueAtTime(0.001, now+0.32);
        tail.connect(tailBpf); tailBpf.connect(tailG); tailG.connect(out);
        tail.start(now+0.008); tail.stop(now+0.33);
    }
    
    // METAL CONSOLE HIT: heavy noise thump, no tones
    function playMetalTink() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        const out = ctx.destination;

        // L1: impact transient — short full-spectrum noise burst, very fast decay
        const transBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate*0.025), ctx.sampleRate);
        const tr = transBuf.getChannelData(0);
        for (let i=0;i<tr.length;i++) tr[i]=(Math.random()*2-1)*Math.pow(1-i/tr.length, 1.5);
        const trans = ctx.createBufferSource(); trans.buffer=transBuf;
        const tG = ctx.createGain();
        tG.gain.setValueAtTime(1.2, now); tG.gain.exponentialRampToValueAtTime(0.001, now+0.028);
        trans.connect(tG); tG.connect(out);
        trans.start(now); trans.stop(now+0.03);

        // L2: heavy body thud — LPF noise ~120Hz, dull and low, 200ms decay
        const thudBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate*0.22), ctx.sampleRate);
        const tb = thudBuf.getChannelData(0); for (let i=0;i<tb.length;i++) tb[i]=Math.random()*2-1;
        const thudSrc = ctx.createBufferSource(); thudSrc.buffer=thudBuf;
        const lpf = ctx.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=120; lpf.Q.value=0.5;
        const thudG = ctx.createGain();
        thudG.gain.setValueAtTime(1.4, now); thudG.gain.exponentialRampToValueAtTime(0.001, now+0.21);
        thudSrc.connect(lpf); lpf.connect(thudG); thudG.connect(out);
        thudSrc.start(now); thudSrc.stop(now+0.23);
    }
    
    // TERMINAL SMASH: electrical crack + chassis thud + screen fracture + CRT discharge hum
    function playTerminalSmash() {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        const out = ctx.destination;

        // Layer 1 — broadband impact crack (20ms, full spectrum, shaped envelope)
        const crackBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate*0.02), ctx.sampleRate);
        const cd = crackBuf.getChannelData(0);
        for (let i=0;i<cd.length;i++) cd[i]=(Math.random()*2-1)*Math.pow(1-i/cd.length, 1.8);
        const crack = ctx.createBufferSource(); crack.buffer=crackBuf;
        const ckG = ctx.createGain();
        ckG.gain.setValueAtTime(1.5, now); ckG.gain.exponentialRampToValueAtTime(0.001, now+0.022);
        crack.connect(ckG); ckG.connect(out); crack.start(now); crack.stop(now+0.025);

        // Layer 2 — deep chassis thud (heavy object, long decay)
        const thud = ctx.createOscillator(); thud.type='sine';
        thud.frequency.setValueAtTime(85, now); thud.frequency.exponentialRampToValueAtTime(24, now+0.28);
        const thudG = ctx.createGain();
        thudG.gain.setValueAtTime(0.75, now); thudG.gain.exponentialRampToValueAtTime(0.001, now+0.32);
        thud.connect(thudG); thudG.connect(out); thud.start(now); thud.stop(now+0.35);

        // Layer 3 — screen/plastic fracture (BPF noise, mid-range, 250ms tail)
        const fracBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate*0.26), ctx.sampleRate);
        const fd = fracBuf.getChannelData(0); for (let i=0;i<fd.length;i++) fd[i]=Math.random()*2-1;
        const frac = ctx.createBufferSource(); frac.buffer=fracBuf;
        const fracBpf = ctx.createBiquadFilter(); fracBpf.type='bandpass'; fracBpf.frequency.value=2100; fracBpf.Q.value=1.1;
        const fracG = ctx.createGain();
        fracG.gain.setValueAtTime(0.32, now+0.006); fracG.gain.exponentialRampToValueAtTime(0.001, now+0.27);
        frac.connect(fracBpf); fracBpf.connect(fracG); fracG.connect(out);
        frac.start(now+0.004); frac.stop(now+0.28);

        // Layer 4 — electrical discharge (HPF noise burst, simulates capacitor pop)
        const elecBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate*0.035), ctx.sampleRate);
        const ed = elecBuf.getChannelData(0); for (let i=0;i<ed.length;i++) ed[i]=Math.random()*2-1;
        const elec = ctx.createBufferSource(); elec.buffer=elecBuf;
        const elecHpf = ctx.createBiquadFilter(); elecHpf.type='highpass'; elecHpf.frequency.value=7000;
        const elecG = ctx.createGain();
        elecG.gain.setValueAtTime(0.6, now); elecG.gain.exponentialRampToValueAtTime(0.001, now+0.038);
        elec.connect(elecHpf); elecHpf.connect(elecG); elecG.connect(out);
        elec.start(now); elec.stop(now+0.04);

        // Layer 5 — CRT/screen resonance dying (sawtooth pitch sweep, 400Hz→55Hz)
        const hum = ctx.createOscillator(); hum.type='sawtooth';
        hum.frequency.setValueAtTime(380, now+0.008); hum.frequency.exponentialRampToValueAtTime(55, now+0.42);
        const humG = ctx.createGain();
        humG.gain.setValueAtTime(0.12, now+0.008); humG.gain.exponentialRampToValueAtTime(0.001, now+0.44);
        hum.connect(humG); humG.connect(out); hum.start(now+0.008); hum.stop(now+0.46);
    }
    
   
    
    // STRUCTURAL INTEGRITY SYSTEM
    function updateIntegrityBar() {
        const bar = $('integrity-bar');
        const fill = $('integrity-fill');
        const text = $('integrity-text');
        
        if (!bar || !fill || !text) return;
        
        bar.classList.add('active');
        fill.style.width = APP.glassIntegrity + '%';
        text.textContent = 'INTEGRITY: ' + APP.glassIntegrity + '%';
        
        // Color based on integrity
        if (APP.glassIntegrity > 60) {
            fill.style.background = 'linear-gradient(90deg, var(--g) 0%, var(--g) 100%)';
        } else if (APP.glassIntegrity > 30) {
            fill.style.background = 'linear-gradient(90deg, var(--y) 0%, var(--y) 100%)';
        } else {
            fill.style.background = 'linear-gradient(90deg, var(--r) 0%, var(--r) 100%)';
        }
    }
    
    function triggerTerminalShatter() {
        APP.lensShattered = true;
        document.body.classList.add('lens-shattered');
        playTerminalSmash();
        
        log('TERMINAL_SHATTER: LENS_FAILURE');

        $('glass-fracture-layer').innerHTML = '';
        APP.shooting.fractures = [];
    }
    
    function repairLens() {
        if (!APP.lensShattered && APP.glassIntegrity >= 100) return;
        
        playHydraulicHiss();
        APP.glassIntegrity = 100;
        APP.lensShattered = false;
        document.body.classList.remove('lens-shattered');
        updateIntegrityBar();
        
        // Clear all damage
        APP.shooting.bullets.forEach(b => b.remove());
        APP.shooting.bullets = [];
        APP.shooting.fractures.forEach(f => f.remove());
        APP.shooting.fractures = [];
        APP.shooting.dents.forEach(d => d.classList.remove('dented'));
        APP.shooting.dents = [];
        $('glass-fracture-layer').innerHTML = '';
        
        log('LENS_REPAIR: INTEGRITY_RESTORED');
        
        setTimeout(() => {
            if (!APP.shooting.active) {
                $('integrity-bar').classList.remove('active');
            }
        }, 2000);
    }
    
    function startRepairTimer() {
        if (APP.shooting.repairTimer) {
            clearTimeout(APP.shooting.repairTimer);
        }
        APP.shooting.repairTimer = setTimeout(() => {
            if (APP.glassIntegrity < 100 || APP.lensShattered) {
                repairLens();
            }
        }, 15000); // 15 second auto-repair
    }
    
    // GLASS FRACTURE WITH 20S PURGE
    function createGlassFracture(x, y) {
        const stage = $('stage');
        const rect = stage.getBoundingClientRect();
        const localX = x - rect.left;
        const localY = y - rect.top;
        
        const fracture = document.createElement('div');
        fracture.className = 'glass-fracture';
        fracture.style.left = localX + 'px';
        fracture.style.top = localY + 'px';
        
        const numCracks = 5 + Math.floor(Math.random() * 6);
        let svg = '<svg width="100" height="100" style="position:absolute;left:-50px;top:-50px;mix-blend-mode:lighter;">';
        
        for (let i = 0; i < numCracks; i++) {
            const angle = (i / numCracks) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const len = 20 + Math.random() * 35;
            let path = `M50,50 `;
            let cx = 50, cy = 50;
            const segments = 3 + Math.floor(Math.random() * 3);
            
            for (let s = 0; s < segments; s++) {
                const segLen = len / segments;
                const jitter = (Math.random() - 0.5) * 12;
                cx += Math.cos(angle + jitter * 0.1) * segLen;
                cy += Math.sin(angle + jitter * 0.1) * segLen;
                path += `L${cx.toFixed(1)},${cy.toFixed(1)} `;
            }
            
            svg += `<path d="${path}" class="fracture-glow" fill="none"/>`;
            svg += `<path d="${path}" class="fracture-line" fill="none"/>`;
        }
        
        svg += '<circle cx="50" cy="50" r="4" fill="rgba(255,255,255,0.9)" filter="blur(2px)"/>';
        svg += '<circle cx="50" cy="50" r="2" fill="#fff"/>';
        svg += '</svg>';
        
        fracture.innerHTML = svg;
        $('glass-fracture-layer').appendChild(fracture);
        APP.shooting.fractures.push(fracture);
        
        playGlassShatter();
        
        // 20S MEMORY PURGE
        setTimeout(() => {
            fracture.style.opacity = '0';
            fracture.style.transition = 'opacity 0.5s';
            setTimeout(() => {
                fracture.remove();
                const idx = APP.shooting.fractures.indexOf(fracture);
                if (idx > -1) APP.shooting.fractures.splice(idx, 1);
            }, 500);
        }, 20000);
    }
    
    // METAL DENT
    function createMetalDent(el) {
        if (!el.classList.contains('dented')) {
            el.classList.add('dented');
            APP.shooting.dents.push(el);
        }
        playMetalTink();
    }
    
    // BULLET HOLE WITH 20S PURGE
    function createBulletHole(x, y) {
        const hole = document.createElement('div');
        hole.className = 'bullet-hole';
        hole.style.left = (x - 10) + 'px';
        hole.style.top = (y - 10) + 'px';
        document.body.appendChild(hole);
        APP.shooting.bullets.push(hole);
        
        const smoke = document.createElement('div');
        smoke.className = 'smoke-puff';
        smoke.style.left = (x - 20) + 'px';
        smoke.style.top = (y - 20) + 'px';
        document.body.appendChild(smoke);
        setTimeout(() => smoke.remove(), 1500);
        
        // 20S PURGE
        setTimeout(() => {
            hole.style.opacity = '0';
            hole.style.transition = 'opacity 0.5s';
            setTimeout(() => {
                hole.remove();
                const idx = APP.shooting.bullets.indexOf(hole);
                if (idx > -1) APP.shooting.bullets.splice(idx, 1);
            }, 500);
        }, 20000);
    }
    
    // FIRE WEAPON - CORE FUNCTION WITH THROTTLE AND INTEGRITY
    function fireWeapon(x, y) {
        // 100MS THROTTLE
        const now = Date.now();
        if (now - APP.shooting.lastFireTime < APP.shooting.fireThrottle) return;
        APP.shooting.lastFireTime = now;
        
        // INTEGRITY DAMAGE
        APP.glassIntegrity = Math.max(0, APP.glassIntegrity - 2);
        updateIntegrityBar();
        startRepairTimer();
        
        // Check for terminal shatter
        if (APP.glassIntegrity <= 0 && !APP.lensShattered) {
            triggerTerminalShatter();
            return;
        }
        
        const stage = $('stage');
        const stageRect = stage.getBoundingClientRect();
        const target = document.elementFromPoint(x, y);
        
        // Material detection
        const isGlass = x >= stageRect.left && x <= stageRect.right &&
                        y >= stageRect.top && y <= stageRect.bottom;
        
        const isMetal = target && (
            target.classList.contains('btn') ||
            target.closest('.sidebar') ||
            target.closest('#top-bar') ||
            target.closest('#bottom-bar')
        );
        
        if (isGlass && !isMetal) {
            createGlassFracture(x, y);
        } else if (isMetal) {
            const metalEl = target.classList.contains('btn') ? target : 
                           (target.closest('.sidebar') || target.closest('#top-bar') || target.closest('#bottom-bar'));
            if (metalEl) createMetalDent(metalEl);
            createBulletHole(x, y);
        } else {
            createBulletHole(x, y);
            playMetalTink();
        }
        
        // Screen shake
        document.body.style.transform = `translate(${(Math.random()-0.5)*8}px, ${(Math.random()-0.5)*8}px)`;
        setTimeout(() => document.body.style.transform = '', 40);
    }
    
    // WEAPON STATE ISOLATION - GLOBAL CAPTURE PHASE LISTENER
    function weaponGlobalInterceptor(e) {
        if (!APP.shooting.active) return;
        
        // Allow clicking the weapon toggle button
        const target = e.target;
        if (target.id === 'btn-shooting' || target.closest('#btn-shooting')) {
            return; // Let the click through
        }
        
        // PREVENT ALL OTHER CLICKS - Complete input safety
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Fire weapon at click location
        fireWeapon(e.clientX, e.clientY);
    }
    
    // MACHINE GUN - 100MS RAPID FIRE ON MOUSEDOWN
    let machineGunActive = false;
    
    function startMachineGun(e) {
        if (!APP.shooting.active) return;
        
        const target = e.target;
        if (target.id === 'btn-shooting' || target.closest('#btn-shooting')) {
            return;
        }
        
        e.preventDefault();
        machineGunActive = true;
        APP.shooting.lastX = e.clientX;
        APP.shooting.lastY = e.clientY;
        
        fireWeapon(e.clientX, e.clientY);
        
        APP.shooting.machineGunInterval = setInterval(() => {
            if (machineGunActive && APP.shooting.active) {
                const jitterX = APP.shooting.lastX + (Math.random() - 0.5) * 20;
                const jitterY = APP.shooting.lastY + (Math.random() - 0.5) * 20;
                fireWeapon(jitterX, jitterY);
            }
        }, 100);
    }
    
    function stopMachineGun() {
        machineGunActive = false;
        if (APP.shooting.machineGunInterval) {
            clearInterval(APP.shooting.machineGunInterval);
            APP.shooting.machineGunInterval = null;
        }
    }
    
    function trackMouse(e) {
        APP.shooting.lastX = e.clientX;
        APP.shooting.lastY = e.clientY;
    }
    
    $('btn-shooting').onclick = () => {
        APP.shooting.active = !APP.shooting.active;
        $('btn-shooting').classList.toggle('on', APP.shooting.active);
        document.body.classList.toggle('shooting-mode', APP.shooting.active);
        
        if (APP.shooting.active) {
            log('MACHINE_GUN: ARMED');
            updateIntegrityBar();
            
            // WEAPON STATE ISOLATION - Capture phase for complete input safety
            window.addEventListener('click', weaponGlobalInterceptor, true);
            document.addEventListener('mousemove', trackMouse);
            document.addEventListener('mousedown', startMachineGun);
            document.addEventListener('mouseup', stopMachineGun);
            
        } else {
            stopMachineGun();
            window.removeEventListener('click', weaponGlobalInterceptor, true);
            document.removeEventListener('mousemove', trackMouse);
            document.removeEventListener('mousedown', startMachineGun);
            document.removeEventListener('mouseup', stopMachineGun);
            
            // Clear repair timer but keep damage visible
            if (APP.shooting.repairTimer) {
                clearTimeout(APP.shooting.repairTimer);
                APP.shooting.repairTimer = null;
            }
            
            // Hide integrity bar after delay
            setTimeout(() => {
                if (!APP.shooting.active) {
                    $('integrity-bar').classList.remove('active');
                }
            }, 3000);
            
            log('MACHINE_GUN: OFF');
        }
    };

    // --- P2P / E2E CALL (FIXED) ---

// Helper to reset buttons to default state
const resetP2PButtons = () => {
    var _btn = $('btn-call-guest');
    _btn.textContent = 'CALL';
    _btn.style.borderColor = 'var(--text-main)';
    _btn.style.color = 'var(--text-main)';
    _btn.classList.remove('accepting', 'call-active');

    $('btn-init-peer').textContent = 'INIT';
    $('btn-init-peer').style.display = 'inline-block';
    
    // Clear the temp incoming call object
    if (APP.peer) APP.peer.incomingCall = null;
};

// ═══ P2P RING TONE (Web Audio API) — Uplifting ascending arpeggio ═══
var _p2pRing = { ctx: null, oscs: [], gain: null, timeout: null, active: false };
function startP2PRing() {
    stopP2PRing();
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        _p2pRing.ctx = ctx;
        _p2pRing.gain = gain;
        _p2pRing.active = true;
        // Ascending arpeggio: C5 E5 G5 C6 — bright major chord
        var notes = [523.25, 659.25, 783.99, 1046.50];
        var noteLen = 0.15, gap = 0.05, vol = 0.12;
        function playArpeggio() {
            if (!_p2pRing.active) return;
            var t = ctx.currentTime;
            for (var i = 0; i < notes.length; i++) {
                var osc = ctx.createOscillator();
                var noteGain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = notes[i];
                osc.connect(noteGain);
                noteGain.connect(gain);
                var start = t + i * (noteLen + gap);
                noteGain.gain.setValueAtTime(0, start);
                noteGain.gain.linearRampToValueAtTime(vol, start + 0.02);
                noteGain.gain.setValueAtTime(vol, start + noteLen - 0.03);
                noteGain.gain.linearRampToValueAtTime(0, start + noteLen);
                osc.start(start);
                osc.stop(start + noteLen + 0.01);
                _p2pRing.oscs.push(osc);
            }
            gain.gain.setValueAtTime(1, t);
            // Repeat after pause (arpeggio ~0.8s + 1.2s silence = 2s cycle)
            _p2pRing.timeout = setTimeout(playArpeggio, 2000);
        }
        playArpeggio();
    } catch (e) { /* silent fail */ }
}
function stopP2PRing() {
    _p2pRing.active = false;
    if (_p2pRing.timeout) { clearTimeout(_p2pRing.timeout); _p2pRing.timeout = null; }
    _p2pRing.oscs.forEach(function(o) { try { o.stop(); } catch(e){} });
    _p2pRing.oscs = [];
    if (_p2pRing.ctx) { try { _p2pRing.ctx.close(); } catch(e){} _p2pRing.ctx = null; }
    _p2pRing.gain = null;
}

// ═══ P2P FLOATING PANEL: TOGGLE / MINIMIZE / DRAG (mouse + touch) ═══
$('btn-open-p2p-modal').onclick = () => {
    var p = $('p2p-modal');
    if (p.style.display === 'none' || p.style.display === '') {
        // Always open expanded with body visible
        $('p2p-body').style.display = '';
        p.style.display = 'block';
    } else {
        p.style.display = 'none';
    }
};
$('btn-close-p2p-modal').onclick = () => {
    // If there's an active call, end it fully for both sides
    if (APP.peer && (APP.peer.call || APP.peer.incomingCall)) {
        if (APP.peer.call) APP.peer.call.close();
        if (APP.peer.incomingCall) { APP.peer.incomingCall.close(); }
        endCallCleanup();
    }
    $('p2p-modal').style.display = 'none';
};
$('btn-min-p2p').onclick = () => {
    // Snap back to the P2P button — hide the floating HUD.
    // Pressing the top-bar button re-expands it.
    $('p2p-modal').style.display = 'none';
};
// Drag logic (mouse + touch)
(function() {
    var bar = $('p2p-titlebar'), panel = $('p2p-modal'), dx = 0, dy = 0, dragging = false;
    function startDrag(cx, cy, e) {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true;
        dx = cx - panel.offsetLeft;
        dy = cy - panel.offsetTop;
        bar.style.cursor = 'grabbing';
        e.preventDefault();
    }
    function moveDrag(cx, cy) {
        if (!dragging) return;
        panel.style.left = Math.max(0, Math.min(window.innerWidth - 60, cx - dx)) + 'px';
        panel.style.top = Math.max(0, Math.min(window.innerHeight - 30, cy - dy)) + 'px';
        panel.style.right = 'auto';
    }
    function endDrag() { dragging = false; bar.style.cursor = 'grab'; }
    // Mouse
    bar.addEventListener('mousedown', function(e) { startDrag(e.clientX, e.clientY, e); });
    document.addEventListener('mousemove', function(e) { moveDrag(e.clientX, e.clientY); });
    document.addEventListener('mouseup', endDrag);
    // Touch
    bar.addEventListener('touchstart', function(e) {
        var t = e.touches[0];
        startDrag(t.clientX, t.clientY, e);
    }, { passive: false });
    document.addEventListener('touchmove', function(e) {
        if (!dragging) return;
        var t = e.touches[0];
        moveDrag(t.clientX, t.clientY);
        e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', endDrag);
})();

// Resize logic (mouse + touch)
(function() {
    var handle = $('p2p-resize'), panel = $('p2p-modal'), resizing = false, startW, startH, startX, startY;
    function startResize(cx, cy, e) {
        resizing = true; startW = panel.offsetWidth; startH = panel.offsetHeight; startX = cx; startY = cy;
        e.preventDefault(); e.stopPropagation();
    }
    function moveResize(cx, cy) {
        if (!resizing) return;
        panel.style.width = Math.max(200, startW + (cx - startX)) + 'px';
    }
    function endResize() { resizing = false; }
    handle.addEventListener('mousedown', function(e) { startResize(e.clientX, e.clientY, e); });
    document.addEventListener('mousemove', function(e) { if (resizing) { moveResize(e.clientX, e.clientY); e.preventDefault(); } });
    document.addEventListener('mouseup', endResize);
    handle.addEventListener('touchstart', function(e) { var t = e.touches[0]; startResize(t.clientX, t.clientY, e); }, { passive: false });
    document.addEventListener('touchmove', function(e) { if (resizing) { var t = e.touches[0]; moveResize(t.clientX, t.clientY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('touchend', endResize);
})();

$('btn-init-peer').onclick = () => {
    if (APP.peer && APP.peer.peer) {
        log('PEER: Already initialized');
        return;
    }

    try {
        // Use custom callsign from field → localStorage → generated fallback
        var _typed = ($('peer-id-display').value || '').trim().toUpperCase().replace(/[^A-Z0-9\-_]/g,'').slice(0, 24);
        var _saved = localStorage.getItem('vngrd_station_id') || '';
        var peerId = _typed || _saved || ('VNGRD-' + Math.random().toString(36).substr(2, 8).toUpperCase());
        APP.peer = {
            peer: new Peer(peerId, {
                host: '0.peerjs.com',
                secure: true,
                port: 443,
                path: '/',
                config: {
                    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                },
                debug: 0
            }),
            call: null,
            incomingCall: null,
            localStream: null,
            dataConn: null
        };
        
        APP.peer.peer.on('open', (id) => {
            $('peer-id-display').value = id;
            localStorage.setItem('vngrd_station_id', id);
            if ($('guest-dot')) $('guest-dot').classList.remove('off');
            $('call-status').textContent = 'READY TO CALL';
            $('call-status').style.color = 'var(--g)';
            log('PEER: ' + id);
        });
        
        APP.peer.peer.on('error', (err) => {
            log('PEER ERROR: ' + err.type);
            $('call-status').textContent = 'ERR: ' + err.type;
            $('call-status').style.color = 'var(--r)';
        });
        
        // --- INCOMING CALL HANDLER ---
        // Store the call object. btn-call-guest FORK A reads it to answer.
        APP.peer.peer.on('call', (call) => {
            log('INCOMING_CALL FROM ' + call.peer);

            APP.peer.incomingCall = call;   // ← MUST be set before the button is clicked

            $('call-status').textContent = 'IN LOBBY: ' + call.peer;
            $('call-status').style.color = '#ffcc00';
            $('p2p-modal').style.display = 'block';
            $('p2p-modal').classList.add('incoming');
            $('p2p-body').style.display = '';
            $('btn-open-p2p-modal').classList.add('lobby');
            startP2PRing();

            var btnCall = $('btn-call-guest');
            btnCall.textContent = 'INCOMING: ACCEPT?';
            btnCall.style.borderColor = '';
            btnCall.style.color = '';
            btnCall.classList.add('accepting');
        });

        // --- INCOMING DATA CONNECTION (Guest Side) ---
        APP.peer.peer.on('connection', (conn) => {
            log('DATA_CHANNEL: INCOMING FROM ' + conn.peer);
            conn.on('open', () => {
                APP.peer.dataConn = conn;
                log('DATA_CHANNEL: OPEN');
                _flushSyncQueue();
                _pushCurrentState();
            });
            conn.on('data', (data) => {
                try {
                    const msg = typeof data === 'string' ? JSON.parse(data) : data;
                    // Debug: confirm packet arrival before any DOM work
                    log('DATA_CHANNEL: RECV ' + (msg.target || 'UNKNOWN'));
                    if (msg.type === 'UI_SYNC') handleUISync(msg);
                } catch (e) {
                    console.error('DATA_CHANNEL PARSE ERROR:', e, data);
                    log('DATA_CHANNEL: PARSE_ERR');
                }
            });
            conn.on('close', () => {
                log('DATA_CHANNEL: CLOSED');
                if (APP.peer.dataConn === conn) APP.peer.dataConn = null;
                // FORK A (answerer) does not initiate reconnect — the caller (FORK B) will
                // re-connect via peer.connect() and this peer.on('connection', ...) will handle it.
                // Log so we can diagnose if reconnect never arrives.
                if (APP.peer.call) log('DATA_CHANNEL: AWAITING_RECONNECT_FROM_CALLER');
            });
        });

    } catch (e) {
        log('PEER INIT ERROR: ' + e.message);
    }
};

// Pre-fill callsign from last session
(function() {
    var _savedId = localStorage.getItem('vngrd_station_id');
    if (_savedId && $('peer-id-display')) $('peer-id-display').value = _savedId;
})();

$('btn-copy-id').onclick = () => {
    const idField = $('peer-id-display');
    if (idField && idField.value) {
        navigator.clipboard.writeText(idField.value);
        const originalText = $('btn-copy-id').textContent;
        $('btn-copy-id').textContent = '✓ COPIED';
        setTimeout(() => $('btn-copy-id').textContent = originalText, 2000);
    }
};

// ─── CONTACT BOOK ────────────────────────────────────────────────────────────
function saveP2PContact(id) {
    if (!id) return;
    var contacts = JSON.parse(localStorage.getItem('vngrd_contacts') || '[]');
    contacts = contacts.filter(function(c) { return c !== id; });
    contacts.unshift(id);
    contacts = contacts.slice(0, 3);
    localStorage.setItem('vngrd_contacts', JSON.stringify(contacts));
}

function renderP2PContacts() {
    var overlay = $('p2p-contacts-overlay');
    var empty   = $('p2p-contacts-empty');
    if (!overlay) return;
    // Remove old dynamic items
    overlay.querySelectorAll('.contact-item').forEach(function(el) { el.remove(); });
    var contacts = JSON.parse(localStorage.getItem('vngrd_contacts') || '[]');
    if (contacts.length === 0) {
        if (empty) empty.style.display = '';
    } else {
        if (empty) empty.style.display = 'none';
        contacts.forEach(function(id) {
            var div = document.createElement('div');
            div.className = 'contact-item';
            div.textContent = id;
            div.onclick = function() {
                $('remote-peer-id').value = id;
                overlay.style.display = 'none';
            };
            overlay.appendChild(div);
        });
    }
}

$('btn-contacts').onclick = function(e) {
    e.stopPropagation();
    var overlay = $('p2p-contacts-overlay');
    if (!overlay) return;
    renderP2PContacts();
    overlay.style.display = overlay.style.display === 'block' ? 'none' : 'block';
};

// Close contacts overlay when clicking outside it
document.addEventListener('click', function(e) {
    var overlay = $('p2p-contacts-overlay');
    if (overlay && overlay.style.display === 'block') {
        if (!overlay.contains(e.target) && e.target.id !== 'btn-contacts') {
            overlay.style.display = 'none';
        }
    }
});
// ─────────────────────────────────────────────────────────────────────────────

// --- UNIFIED CALL / ANSWER BUTTON ---
// Strict fork: incoming call → answer only. No active call → dial out.
// Using localStream directly (no composite canvas stream) eliminates the
// spurious peer.on('call') re-fire caused by captureStream() side-effects.
$('btn-call-guest').onclick = async () => {
    if (!APP.peer || !APP.peer.peer) { alert('CLICK_INIT_FIRST'); return; }

    // ── Shared media acquisition ──────────────────────────────────────────
    // CRITICAL: echoCancellation + noiseSuppression MUST be true for any WebRTC voice call.
    // The remote peer's audio plays through the host's speakers; with AEC off the mic picks
    // that up and ships it back to the guest — instant echo / runaway feedback loop.
    // These flags do NOT affect the recording path (which taps outputLimiter + micGainNode
    // separately via their own getUserMedia capture in switchAudioInput).
    const audioConstraints = APP.inputDevices && APP.inputDevices.selectedId
        ? { deviceId: { exact: APP.inputDevices.selectedId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 2 }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 2 };

    let localStream;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
            audio: audioConstraints
        });
    } catch (e) {
        log('MEDIA_ERR: ' + e.message);
        $('call-status').textContent = 'MEDIA_ERR: ' + e.message;
        $('call-status').style.color = 'var(--r)';
        return;
    }

    APP.peer.localStream = localStream;

    // Wake up hardware — ensures no track starts in a disabled/black state
    localStream.getTracks().forEach(function(t) { t.enabled = true; });

    // Feed the local camera into the 4K monitor float so the host can see themselves
    var previewVid = $('preview-vid-float');
    if (previewVid) {
        previewVid.srcObject = localStream;
        previewVid.play().catch(function() {});
        APP.camera.previewEl = previewVid;
    }
    var floatEl = $('cam-preview-float');
    if (floatEl) { floatEl.style.display = ''; floatEl.classList.add('active'); }

    // ── FORK A: answer an incoming call ───────────────────────────────────
    if (APP.peer.incomingCall) {
        try {
            log('ANSWERING CALL FROM ' + APP.peer.incomingCall.peer);
            $('call-status').textContent = 'CONNECTING...';
            $('call-status').style.color = 'var(--y)';

            APP.peer.incomingCall.answer(localStream);
            handleCallStream(APP.peer.incomingCall);
            saveP2PContact(APP.peer.incomingCall.peer);

            // Clean up lobby state
            APP.peer.incomingCall = null;
            $('p2p-modal').classList.remove('incoming');
            $('btn-open-p2p-modal').classList.remove('lobby');
            $('btn-call-guest').classList.remove('accepting');
            $('btn-call-guest').textContent = 'CALL (ACTIVE)';
            $('btn-call-guest').classList.add('call-active');
            stopP2PRing();
        } catch (e) {
            log('ANSWER_ERR: ' + e.message);
            resetP2PButtons();
        }
        return;
    }

    // ── FORK B: dial out to a remote peer ────────────────────────────────
    const remoteId = $('remote-peer-id') ? $('remote-peer-id').value.trim() : '';
    if (!remoteId) { alert('ENTER_GUEST_ID_TO_CALL'); return; }

    try {
        $('call-status').textContent = 'CALLING ' + remoteId + '...';
        $('call-status').style.color = 'var(--y)';
        startP2PRing();

        const call = APP.peer.peer.call(remoteId, localStream);
        handleCallStream(call);

        // Parallel data channel for UI sync (LT, logo, bug)
        const dataConn = APP.peer.peer.connect(remoteId);
        dataConn.on('open', function() {
            APP.peer.dataConn = dataConn;
            log('DATA_CHANNEL: OPEN TO ' + remoteId);
            _flushSyncQueue();
            _pushCurrentState();
        });
        dataConn.on('data', function(data) {
            try {
                const msg = typeof data === 'string' ? JSON.parse(data) : data;
                if (msg.type === 'UI_SYNC') handleUISync(msg);
            } catch (e) { log('DATA_CHANNEL: PARSE_ERR'); }
        });
        dataConn.on('close', function() {
            log('DATA_CHANNEL: CLOSED');
            if (APP.peer.dataConn === dataConn) APP.peer.dataConn = null;
            // Auto-reconnect: caller side re-initiates the data channel if the media call is still alive.
            // Receiver side accepts the reconnect via peer.on('connection', ...) automatically.
            if (APP.peer.call && APP.peer.peer) {
                setTimeout(function() {
                    if (APP.peer.dataConn && APP.peer.dataConn.open) return; // already reconnected
                    if (!APP.peer.call) return; // call ended in the meantime
                    log('DATA_CHANNEL: RECONNECTING TO ' + remoteId);
                    var _dc = APP.peer.peer.connect(remoteId);
                    _dc.on('open', function() {
                        APP.peer.dataConn = _dc;
                        log('DATA_CHANNEL: RECONNECTED');
                        _flushSyncQueue();
                        // Re-send current state so the remote peer has the latest identity bug
                        sendUISync('STATION_LOGO', { text: APP.bug.text, visible: APP.trinity.bug.visible });
                    });
                    _dc.on('data', function(data) {
                        try {
                            var msg = typeof data === 'string' ? JSON.parse(data) : data;
                            if (msg.type === 'UI_SYNC') handleUISync(msg);
                        } catch(e) {}
                    });
                    _dc.on('close', function() {
                        if (APP.peer.dataConn === _dc) APP.peer.dataConn = null;
                    });
                }, 2000);
            }
        });

    } catch (e) {
        log('CALL_ERR: ' + e.message);
        stopP2PRing();
        $('call-status').textContent = 'FAILED: ' + e.message;
        $('call-status').style.color = 'var(--r)';
    }
};

// Shared Logic for both Incoming and Outgoing calls
function handleCallStream(call) {
    call.on('stream', (remoteStream) => {
        // Guard: PeerJS fires 'stream' multiple times on ICE renegotiation / track additions.
        // Skip if this is the exact same stream object we already set up.
        if (APP.guest.stream === remoteStream) { log('STREAM_DUP_SKIPPED'); return; }
        // Ensure video element exists — must be in DOM for iOS Safari to play
        if (!APP.guest.videoElement) {
            APP.guest.videoElement = document.createElement('video');
            APP.guest.videoElement.id = 'p2p-remote-feed';
            APP.guest.videoElement.setAttribute('autoplay', '');
            APP.guest.videoElement.setAttribute('playsinline', '');
            APP.guest.videoElement.muted = false;
            // Off-screen but large enough for browser to actually decode
            // opacity:0 keeps the video pipeline alive for drawImage(); display:none stops frame delivery
            APP.guest.videoElement.style.cssText = 'opacity:0;position:fixed;bottom:0;right:0;width:320px;height:240px;pointer-events:none;z-index:-1;';
            document.body.appendChild(APP.guest.videoElement);
        }

        // Remote stream plays via HTML5 video element.
        // DO NOT route into APP.audio.ctx or masterGain — creates echo.
        APP.guest.videoElement.srcObject = remoteStream;
        APP.guest.stream = remoteStream;
        APP.guest.isActive = true;

        // iOS Safari requires explicit play() after srcObject assignment
        APP.guest.videoElement.play().catch(function(e) { log('GUEST_PLAY_ERR: ' + e.message); });

        stopP2PRing();
        saveP2PContact(call.peer);
        $('call-status').textContent = 'CONNECTED';
        $('call-status').style.color = 'var(--g)';
        $('btn-call-guest').textContent = 'CALL (ACTIVE)';
        $('btn-call-guest').classList.add('call-active');
        $('btn-open-p2p-modal').classList.add('call-active');

        // Show local identity bug in the preview float (host sees their own brand).
        // The main canvas will show the remote peer's bug via APP.bug.p2pText.
        var _pov = $('p2p-bug-overlay');
        if (_pov) {
            _pov.textContent = APP.bug.text || 'VNGRD';
            _pov.style.display = 'block';
        }

        log('CALL_ESTABLISHED_WITH: ' + call.peer);
    });

    call.on('close', () => {
        // Delay cleanup slightly — PeerJS fires 'close' on transient ICE restarts
        setTimeout(() => {
            // Only clean up if the call is truly dead (no new call replaced it)
            if (APP.peer && APP.peer.call === call) {
                endCallCleanup();
            }
        }, 1500);
    });

    call.on('error', (err) => {
        log('CALL_ERROR: ' + err);
        endCallCleanup();
    });

    APP.peer.call = call;
}

// ═══ P2P ORIENTATION / VISIBILITY RESILIENCE ═══
// Prevent call from dying when user rotates phone or switches apps briefly
(function() {
    // On orientation change, iOS Safari may tear down getUserMedia tracks.
    // Re-acquire media and replace tracks in the existing peer connection.
    var _orientationTimer = null;
    function handleOrientationChange() {
        if (!APP.peer || !APP.peer.call) return;
        clearTimeout(_orientationTimer);
        _orientationTimer = setTimeout(async () => {
            try {
                if (!APP.peer || !APP.peer.call || !APP.peer.call.peerConnection) return;
                var pc = APP.peer.call.peerConnection;
                // Re-acquire camera with same constraints
                var newStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
                    audio: APP.inputDevices && APP.inputDevices.selectedId
                        ? { deviceId: { exact: APP.inputDevices.selectedId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                });
                // Replace tracks in the live RTCPeerConnection (no renegotiation needed)
                var senders = pc.getSenders();
                newStream.getTracks().forEach(function(newTrack) {
                    var sender = senders.find(function(s) { return s.track && s.track.kind === newTrack.kind; });
                    if (sender) sender.replaceTrack(newTrack);
                });
                // Stop old tracks, store new stream
                if (APP.peer.localStream) {
                    APP.peer.localStream.getTracks().forEach(function(t) { t.stop(); });
                }
                APP.peer.localStream = newStream;
                log('P2P: TRACKS_REPLACED_AFTER_ROTATE');
            } catch (e) {
                log('P2P: TRACK_REPLACE_ERR: ' + e.message);
            }
        }, 500); // Wait for orientation to settle
    }

    window.addEventListener('orientationchange', handleOrientationChange);
    // Some browsers fire resize instead of orientationchange
    var _lastW = window.innerWidth, _lastH = window.innerHeight;
    window.addEventListener('resize', function() {
        // Detect actual orientation flip (width/height swap)
        var w = window.innerWidth, h = window.innerHeight;
        var wasLandscape = _lastW > _lastH, isLandscape = w > h;
        if (wasLandscape !== isLandscape) handleOrientationChange();
        _lastW = w; _lastH = h;
    });

    // On visibility change (app switch, lock screen), keep peer alive
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible' && APP.peer && APP.peer.call) {
            // Re-play remote video (iOS pauses media when backgrounded)
            if (APP.guest.videoElement && APP.guest.videoElement.paused) {
                APP.guest.videoElement.play().catch(function() {});
            }
            // Check if local tracks are still alive; re-acquire if dead
            if (APP.peer.localStream) {
                var dead = APP.peer.localStream.getTracks().some(function(t) { return t.readyState === 'ended'; });
                if (dead) handleOrientationChange(); // reuse the track-replace logic
            }
        }
    });
})();

$('btn-hangup').onclick = () => {
    if (APP.peer && APP.peer.call) {
        APP.peer.call.close();
    }
    // Also reject if it was just ringing
    if (APP.peer && APP.peer.incomingCall) {
        APP.peer.incomingCall.close();
        log('INCOMING CALL REJECTED');
    }
    endCallCleanup();
};

// --- P2P DATA SYNC: Send & Receive UI State ---
function sendUISync(target, payload) {
    // Sync-loop guard: if we are currently inside handleUISync bail to prevent echo-back.
    if (APP.peer && APP.peer.isSyncing) return;
    if (APP.peer && APP.peer.dataConn && APP.peer.dataConn.open) {
        APP.peer.dataConn.send(JSON.stringify({
            type: 'UI_SYNC',
            target: target,
            payload: payload
        }));
        log('DATA_SYNC_SENT: ' + target);
    } else if (APP.peer && APP.peer.call) {
        // Call is active but data channel not open yet (timing race on answerer side).
        // Queue the message — flushed automatically when the channel opens.
        if (!APP.peer._syncQueue) APP.peer._syncQueue = [];
        // Keep only the latest message per target to avoid stale queued data
        APP.peer._syncQueue = APP.peer._syncQueue.filter(function(q) { return q.target !== target; });
        APP.peer._syncQueue.push({ target: target, payload: payload });
        log('DATA_SYNC_QUEUED: ' + target);
    }
}

// Push host's current graphics state to peer the moment the data channel opens.
// This ensures logos / bug / LT set BEFORE the call are still received by the guest.
function _pushCurrentState() {
    // Station bug — always send local identity if text is set so the remote peer
    // can display it on their canvas over our video stream immediately at call start.
    if (APP.bug.text) {
        sendUISync('STATION_LOGO', { text: APP.bug.text, visible: true });
    }
    // 2D logo — compress to JPEG before sending (stays within ~64KB data channel limit)
    var _ll = $('user-logo-layer');
    if (APP.trinity.logo.visible && _ll && _ll.naturalWidth > 0 &&
            _ll.src && !_ll.src.startsWith(window.location.href)) {
        var _maxDim = 200;
        var _s = Math.min(1, _maxDim / Math.max(_ll.naturalWidth, _ll.naturalHeight));
        var _tc = document.createElement('canvas');
        _tc.width  = Math.max(1, Math.round(_ll.naturalWidth  * _s));
        _tc.height = Math.max(1, Math.round(_ll.naturalHeight * _s));
        _tc.getContext('2d').drawImage(_ll, 0, 0, _tc.width, _tc.height);
        var _tUri = _tc.toDataURL('image/jpeg', 0.82);
        sendUISync('2D_LOGO', { action: 'show', dataURI: _tUri });
        log('STATE_PUSH: 2D_LOGO ' + Math.round(_tUri.length / 1024) + 'KB');
    }
    // Lower third
    if (APP.lowerThird && APP.lowerThird.visible) {
        sendUISync('LOWER_THIRD', {
            action: 'show',
            title:    APP.lowerThird.title    || '',
            subtitle: APP.lowerThird.subtitle || '',
            preset:   APP.lowerThird.preset   || 'guest'
        });
    }
}

function _flushSyncQueue() {
    if (!APP.peer || !APP.peer.dataConn || !APP.peer.dataConn.open) return;
    if (!APP.peer._syncQueue || APP.peer._syncQueue.length === 0) return;
    APP.peer._syncQueue.forEach(function(q) {
        APP.peer.dataConn.send(JSON.stringify({ type: 'UI_SYNC', target: q.target, payload: q.payload }));
        log('DATA_SYNC_QUEUE_FLUSH: ' + q.target);
    });
    APP.peer._syncQueue = [];
}

function handleUISync(msg) {
    // RECEIVER PATH — NO Mix-Minus check here, ever.
    // The "skip local render" rule applies ONLY to the person clicking the button (sender).
    // This function always renders what it receives so the guest's canvas shows the graphics.
    //
    // Sync-loop guard: raise isSyncing flag so sendUISync() is a no-op for any
    // side-effect calls (e.g. oninput handlers) triggered while we process this packet.
    if (APP.peer) APP.peer.isSyncing = true;
    try {
    if (msg.target === 'LOWER_THIRD') {
        if (msg.payload.action === 'show') {
            // Render the peer's LT directly in the DOM.
            // NEVER touch lt-title/lt-sub input fields — setting those causes
            // oninput to treat received text as local input and echo it back,
            // creating an infinite edit loop where both users modify the same LT.
            // NEVER call showLowerThird() — that sets APP.lowerThird.visible which
            // enables the oninput sendUISync path on the receiver side.
            var _lt  = $('lower-third');
            var _ltc = _lt ? _lt.querySelector('.lt-container') : null;
            if (_ltc) {
                var _p = msg.payload.preset || 'guest';
                _ltc.classList.remove('lt-guest','lt-track','lt-breaking','lt-neon','lt-split','lt-scan');
                _ltc.classList.add('lt-' + _p);
            }
            if (msg.payload.title    !== undefined && $('lt-title-text'))    $('lt-title-text').textContent    = msg.payload.title;
            if (msg.payload.subtitle !== undefined && $('lt-subtitle-text')) $('lt-subtitle-text').textContent = msg.payload.subtitle;
            if (_lt) _lt.classList.add('visible');
            log('DATA_SYNC_RECV: LT/' + (msg.payload.preset || '?') + ' "' + msg.payload.title + '"');
        } else if (msg.payload.action === 'hide') {
            // Remove visible class directly — do NOT call hideLowerThird() which
            // would reset APP.lowerThird.visible and break local LT state.
            var _lt2 = $('lower-third');
            if (_lt2) _lt2.classList.remove('visible');
            log('DATA_SYNC_RECV: LT/HIDE');
        }
    } else if (msg.target === '2D_LOGO') {
        const logoLayer = $('user-logo-layer');
        if (!logoLayer) { log('[ERROR] SYNC: #user-logo-layer NOT FOUND'); return; }
        if (msg.payload.action === 'show') {
            // Receive image as base64 data URI from peer
            if (msg.payload.dataURI) {
                // Always treat received logo as static (compressed JPEG, not animated GIF)
                APP.layers.logo2dIsGif = false;
                APP.layers._gifFrames = null;
                logoLayer.removeAttribute('crossOrigin');
                logoLayer.removeAttribute('crossorigin');
                logoLayer.style.filter = 'none';
                logoLayer.style.willChange = 'auto';
                // Wait for image decode before making visible to compositor
                logoLayer.onload = () => {
                    APP.trinity.logo.visible = true;
                    if (!APP.trinity.logo.scale) APP.trinity.logo.scale = 1.0;
                    if (!APP.trinity.logo.x) APP.trinity.logo.x = 0.05;
                    if (!APP.trinity.logo.y) APP.trinity.logo.y = 0.05;
                    log('DATA_SYNC_RECV: 2D_LOGO/LOADED');
                };
                logoLayer.src = msg.payload.dataURI;
            } else {
                // No image data, just toggle visibility on
                APP.trinity.logo.visible = true;
            }
            log('DATA_SYNC_RECV: 2D_LOGO/SHOW');
        } else if (msg.payload.action === 'hide') {
            APP.trinity.logo.visible = false;
            log('DATA_SYNC_RECV: 2D_LOGO/HIDE');
        } else if (msg.payload.action === 'clear') {
            APP.trinity.logo.visible = false;
            logoLayer.removeAttribute('src');
            log('DATA_SYNC_RECV: 2D_LOGO/CLEAR');
        }
    } else if (msg.target === 'STATION_LOGO') {
        // Store as REMOTE identity — never overwrite APP.bug.text (local identity).
        // The render loop reads APP.bug.p2pText when APP.guest.isActive so the
        // remote peer's brand appears on top of their video stream on our canvas.
        APP.bug.p2pText = msg.payload.text || '';
        APP.bug.p2pVisible = msg.payload.visible !== false;
        // Ensure the trinity block in the render loop is active
        APP.trinity.bug.visible = true;
        log('DATA_SYNC_RECV: STATION_LOGO "' + msg.payload.text + '"');
    }
    } finally {
        // Always lower the flag, even if a handler throws, so the next legitimate
        // sendUISync (from a real user action) is not silently blocked.
        if (APP.peer) APP.peer.isSyncing = false;
    }
}

function endCallCleanup() {
    stopP2PRing();
    if (APP.peer && APP.peer.localStream) {
        APP.peer.localStream.getTracks().forEach(t => t.stop());
    }
    if (APP.peer && APP.peer.dataConn) {
        APP.peer.dataConn.close();
        APP.peer.dataConn = null;
    }

    // Remove hidden video element from DOM (cleanup for iOS)
    if (APP.guest.videoElement) {
        APP.guest.videoElement.srcObject = null;
        if (APP.guest.videoElement.parentNode) APP.guest.videoElement.parentNode.removeChild(APP.guest.videoElement);
        APP.guest.videoElement = null;
    }

    APP.guest.isActive = false;
    APP.guest.stream = null;
    if (APP.peer) {
        APP.peer.call = null;
        APP.peer.incomingCall = null;
    }

    $('call-status').textContent = 'DISCONNECTED';
    $('call-status').style.color = 'var(--text-dim)';
    $('p2p-modal').classList.remove('incoming');

    // Clear remote identity — back to local bug rendering
    APP.bug.p2pText = '';
    APP.bug.p2pVisible = false;

    // Restore host's own station bug text + visibility from APP state
    var _rb = $('station-bug');
    if (_rb) {
        _rb.textContent = APP.bug.text || 'VNGRD';
        _rb.classList.toggle('hidden', !APP.trinity.bug.visible);
    }

    // Hide preview bug overlay
    var _pov = $('p2p-bug-overlay');
    if (_pov) _pov.style.display = 'none';

    // Close the preview float and the HUD panel
    var _pf = $('cam-preview-float');
    if (_pf) { _pf.classList.remove('active'); _pf.style.display = 'none'; }
    $('p2p-modal').style.display = 'none';
    $('btn-open-p2p-modal').classList.remove('call-active', 'lobby');

    resetP2PButtons();
    log('CALL_ENDED_CLEANUP');
}
    // ========================================
    // ========================================
    // PRO-AUDIO: 48KHZ RAW DIRECT PATH
    // NO ECHO/NOISE PROCESSING
    // ========================================
    async function scanAudioInputDevices() {
        try {
            // Request permission, then immediately release — we only need the label list.
            const _permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            _permStream.getTracks().forEach(t => t.stop());
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            
            APP.inputDevices.list = audioInputs;
            
            const select = $('audio-input-select');
            select.innerHTML = '<option value="">SELECT_DEVICE...</option>';
            
            audioInputs.forEach((device, idx) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `INPUT_${idx + 1}`;
                select.appendChild(option);
            });

            select.style.display = audioInputs.length ? 'block' : 'none';
            log('SCAN: ' + audioInputs.length + ' AUDIO_INPUTS');
            return audioInputs;
        } catch (e) {
            log('SCAN_ERROR: ' + e.message);
            return [];
        }
    }
    
    // 48KHZ RAW DIRECT PATH - DISABLE ALL BROWSER PROCESSING
    async function switchAudioInput(deviceId) {
        // ── PHASE C: reset guard so monitorInputLevel() re-initialises buffers for the new analyzer ──
        _inputLevelActive = false;
        // 1. HARDWARE RELEASE (MEMORY CLEAR)
        // Stop the active input-device stream so the OS releases the hardware lock.
        if (APP.inputDevices.stream) {
            APP.inputDevices.stream.getTracks().forEach(t => t.stop());
        }
        // Also stop any stream tracked directly on the audio object (e.g. internal mic).
        if (APP.audio.currentStream) {
            APP.audio.currentStream.getTracks().forEach(t => t.stop());
        }
        // CLEANUP: disconnect old pre-amp to prevent audio doubling on re-selection.
        if (APP.audio.livePreAmp) {
            try { APP.audio.livePreAmp.disconnect(); } catch (_) {}
            APP.audio.livePreAmp = null;
        }

        try {
            // 2. RAW AUDIO CONSTRAINTS (THE CONDENSER FIX)
            // PRO-AUDIO CONSTRAINTS: 48kHz, NO PROCESSING
            // channelCount: 1 forces Input 1 mono — maps condenser to centre,
            // preventing signal loss when stuck in the left channel only.
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: deviceId },
                    sampleRate: { ideal: 48000 },
                    sampleSize: { ideal: 24 },
                    channelCount: 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            APP.inputDevices.stream = stream;
            APP.audio.currentStream = stream;
            APP.inputDevices.selectedId = deviceId;

            // CRITICAL: reuse the MAIN audio chain context, never create a new one.
            // Creating a separate AudioContext causes "different AudioContext" error
            // when startNFTRecording() tries to connect nodes across contexts.
            ensureAudioChain();
            var _ctx = APP.audio.ctx;

            // 3. THE DIGITAL GRAPH CONNECTION (METERS + REC)
            // Disconnect the previous MediaStreamSource before building the new graph.
            if (APP.audio.micSource) {
                try { APP.audio.micSource.disconnect(); } catch (_) {}
            }
            // Race-condition guard: a concurrent call may have connected a new livePreAmp
            // while we were awaiting getUserMedia. Disconnect it before creating ours.
            if (APP.audio.livePreAmp) {
                try { APP.audio.livePreAmp.disconnect(); } catch (_) {}
                APP.audio.livePreAmp = null;
            }

            // Create new source node and store it for future teardown.
            APP.audio.micSource = _ctx.createMediaStreamSource(stream);

            // VINYL PRE-AMP: +8dB boost so quiet analog signals hit visual thresholds.
            APP.audio.livePreAmp = _ctx.createGain();
            APP.audio.livePreAmp.gain.value = 2.5;
            APP.audio.micSource.connect(APP.audio.livePreAmp);

            // Level monitoring analyser (drives the input-level-bar) — post-boost.
            APP.inputDevices.analyzer = _ctx.createAnalyser();
            APP.inputDevices.analyzer.fftSize = 512;
            APP.inputDevices.analyzer.smoothingTimeConstant = 0.3;
            APP.audio.livePreAmp.connect(APP.inputDevices.analyzer);

            // livePreAmp feeds level meter only — NOT routed to speakers (prevents feedback).

            // 4. UI CONFIRMATION: display the real hardware label from the stream.
            var _trackLabel = (stream.getAudioTracks()[0] && stream.getAudioTracks()[0].label)
                ? stream.getAudioTracks()[0].label.toUpperCase()
                : 'HARDWARE';
            var _ti = document.getElementById('track-info');
            if (_ti) _ti.textContent = 'LIVE: ' + _trackLabel;

            monitorInputLevel();
            log('PRO_AUDIO: MIC_READY // ' + deviceId.substring(0, 8));
        } catch (e) {
            // Fallback without sampleRate/sampleSize constraints (wider device compatibility).
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: { exact: deviceId },
                        channelCount: 1,
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });

                APP.inputDevices.stream = stream;
                APP.audio.currentStream = stream;
                APP.inputDevices.selectedId = deviceId;

                ensureAudioChain();
                var _ctx2 = APP.audio.ctx;

                // Disconnect previous source before rewiring.
                if (APP.audio.micSource) {
                    try { APP.audio.micSource.disconnect(); } catch (_) {}
                }
                // Race-condition guard: same as primary path.
                if (APP.audio.livePreAmp) {
                    try { APP.audio.livePreAmp.disconnect(); } catch (_) {}
                    APP.audio.livePreAmp = null;
                }

                APP.audio.micSource = _ctx2.createMediaStreamSource(stream);

                // VINYL PRE-AMP (fallback path): same +8dB boost.
                APP.audio.livePreAmp = _ctx2.createGain();
                APP.audio.livePreAmp.gain.value = 2.5;
                APP.audio.micSource.connect(APP.audio.livePreAmp);

                APP.inputDevices.analyzer = _ctx2.createAnalyser();
                APP.inputDevices.analyzer.fftSize = 512;
                APP.inputDevices.analyzer.smoothingTimeConstant = 0.3;
                APP.audio.livePreAmp.connect(APP.inputDevices.analyzer);

                // livePreAmp feeds level meter only — NOT routed to speakers (prevents feedback).

                var _trackLabel2 = (stream.getAudioTracks()[0] && stream.getAudioTracks()[0].label)
                    ? stream.getAudioTracks()[0].label.toUpperCase()
                    : 'HARDWARE';
                var _ti2 = document.getElementById('track-info');
                if (_ti2) _ti2.textContent = 'LIVE: ' + _trackLabel2;

                monitorInputLevel();
                log('INPUT_SWITCHED: ' + deviceId.substring(0, 8));
            } catch (e2) {
                log('INPUT_ERROR: ' + e2.message);
            }
        }
    }
    
    // SEISMIC SHAKE TRIGGER THRESHOLD
    let seismicTimeout = null;
    // ── PHASE C: loop-stack guard + pre-allocated buffers ──
    let _inputLevelActive = false;
    let _inputLevelData   = null;
    let _inputLevelBass   = null;

    // Pure tick — called from mainLoop every frame; replaces the old inner update() rAF loop.
    // Exposed via window._inputLevelTick so mainLoop (outside this closure) can call it.
    function updateInputLevel() {
        if (!_inputLevelActive || !APP.inputDevices.analyzer) return;

        APP.inputDevices.analyzer.getByteFrequencyData(_inputLevelData);

        // Overall level
        const avg = _inputLevelData.reduce((a, b) => a + b, 0) / _inputLevelData.length;
        const level = Math.min(100, (avg / 128) * 100);

        // Bass level (first 16 bins = low frequencies)
        for (let i = 0; i < 16; i++) _inputLevelBass[i] = _inputLevelData[i];
        const bassAvg = _inputLevelBass.reduce((a, b) => a + b, 0) / _inputLevelBass.length;
        const bassLevel = Math.min(100, (bassAvg / 128) * 100);

        $('input-level-bar').style.width = level + '%';

        // KINETIC RACK LOGIC GATES — visual effects fire only when the matching
        // UI control is explicitly armed; audio threshold alone is never enough.
        if (bassLevel > 70 || level > 80) {
            if (!seismicTimeout) {
                // SEISMIC GATE: vb-seismic (+ body shake) only when Rumble is armed
                if (APP.vj.rumbleEnabled) {
                    document.body.classList.add('seismic-active', 'vb-seismic');
                }
                // PUNCH GATE: vb-punch only when Punch FX is explicitly armed
                if (document.body.classList.contains('fx-punch')) {
                    document.body.classList.add('vb-punch');
                }
                // Schedule cleanup only if at least one gate was triggered
                if (APP.vj.rumbleEnabled || document.body.classList.contains('fx-punch')) {
                    seismicTimeout = setTimeout(() => {
                        document.body.classList.remove('seismic-active', 'vb-seismic', 'vb-punch');
                        seismicTimeout = null;
                    }, 150);
                }
            }
        }

        // Voice reactivity - WHITE_FLASH
        if (APP.atmosphere.voiceReact && level > 60) {
            document.body.classList.add('voice-flash');
            setTimeout(() => document.body.classList.remove('voice-flash'), 80);
        }
    }
    window._inputLevelTick = updateInputLevel;

    // ── PHASE C: guard prevents a new rAF loop stacking on every input switch ──
    function monitorInputLevel() {
        if (!APP.inputDevices.analyzer) return;
        if (_inputLevelActive) return;
        // Allocate typed buffers once per activation; updateInputLevel() reuses them every frame
        _inputLevelData = new Uint8Array(APP.inputDevices.analyzer.frequencyBinCount);
        _inputLevelBass = new Uint8Array(16);
        _inputLevelActive = true;
    }
    
    $('btn-scan-inputs').onclick = scanAudioInputDevices;
    $('audio-input-select').onchange = (e) => {
        if (e.target.value) {
            switchAudioInput(e.target.value);
        }
    };


    // ========================================
    // NFT_VAULT: SCAN WALLET ASSETS (ETH + TEZOS)
    // ========================================

    // Helper: resolve IPFS URLs to gateway
    function resolveNFTUrl(url) {
        if (!url) return '';
        if (url.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + url.slice(7);
        if (url.startsWith('https://ipfs.io/')) return url;
        return url;
    }

   // Helper: build vault HTML + populate APP.user.assets from a flat array
    function renderVaultList(allNfts) {
        APP.user.assets = [];
        APP.wallet.nfts = allNfts;
        var html = '';
        var assetIdx = 0;
        
        allNfts.forEach(function(nft) {
            var imageUrl = resolveNFTUrl(nft.imageUrl);
            if (imageUrl) {
                // 1. Detect if the URL is a video file
var isVideo = nft.forceVideo || (imageUrl.toLowerCase().match(/\.(mp4|webm|mov|ogg)(\?|$)/) !== null);                var mediaEl;

                if (isVideo) {
                    // --- THE GHOST VIDEO FIX ---
                    mediaEl = document.createElement('video');
                    mediaEl.crossOrigin = 'anonymous';
                    mediaEl.src = imageUrl;
                    mediaEl.muted = true;
                    mediaEl.loop = true;
                    mediaEl.playsInline = true;

                    // Force browser to render frames in the background
                    mediaEl.style.position = 'absolute';
                    mediaEl.style.opacity = '0';
                    mediaEl.style.pointerEvents = 'none';
                    mediaEl.style.width = '1px';
                    mediaEl.style.height = '1px';
                    mediaEl.style.zIndex = '-9999';

                    document.body.appendChild(mediaEl);

                    // Start playback so the canvas can scrape the live frames
                    mediaEl.play().catch(e => console.warn('NFT Video Auto-Play Blocked:', e));

                } else {
                    // --- STANDARD IMAGE / GIF ---
                    mediaEl = new Image();
                    mediaEl.crossOrigin = 'anonymous';
                    mediaEl.src = imageUrl;
                    var _gh = document.getElementById('gif-host');
                    if (_gh) _gh.appendChild(mediaEl);
                }

                // 2. Save the media element to your app state
                APP.user.assets.push({
                    name: nft.name,
                    imageUrl: imageUrl,
                    image: mediaEl, // Now this holds EITHER an <img> or a playing <video>!
                    isVideo: isVideo,
                    duration: isVideo ? null : 8  // seconds on-screen; null = play full length
                });

                // 3. Build the sidebar UI
                html += '<div class="nft-vault-item" data-nft-index="' + assetIdx + '" style="margin:2px 0;padding:3px 4px;color:var(--accent);cursor:pointer;border:1px solid transparent;transition:border-color 0.15s;" onmouseenter="this.style.borderColor=\'var(--accent)\'" onmouseleave="this.style.borderColor=\'transparent\'">' + nft.name.substring(0, 20) + ' <span style="color:var(--text-dim);font-size:7px;">[' + nft.chain + ']</span></div>';
                assetIdx++;
            } else {
                html += '<div style="margin:2px 0;color:var(--text-dim);">' + nft.name.substring(0, 20) + ' [' + nft.chain + ']</div>';
            }
        });
        
        return html;
    }

    // Scan ETH via Alchemy
    async function scanETHNfts(address) {
        var alchemyKey = (window.VNGRD_CONFIG && window.VNGRD_CONFIG.ALCHEMY_KEY)
            || (document.querySelector('meta[name="alchemy-key"]') ? document.querySelector('meta[name="alchemy-key"]').content : null)
            || 'demo';
        var results = [];
        var resp = await fetch('https://eth-mainnet.g.alchemy.com/nft/v2/' + alchemyKey + '/getNFTs?owner=' + address + '&pageSize=20');
        var data = await resp.json();
        if (data.ownedNfts) {
            data.ownedNfts.forEach(function(nft) {
                var name = nft.title || (nft.contract && nft.contract.name) || 'UNKNOWN';
                var imageUrl = (nft.media && nft.media[0] && nft.media[0].gateway)
                    || (nft.metadata && nft.metadata.image)
                    || '';
                results.push({ name: name, imageUrl: imageUrl, chain: 'ETH', contractAddress: (nft.contract && nft.contract.address) || null });
            });
        }
        return results;
    }

  // Scan Tezos via TzKT (free, no key needed, CORS-enabled)
   // Scan Tezos via TzKT (free, no key needed, CORS-enabled)
    async function scanTezosNfts(tezAddr) {
        var results = [];
        var resp = await fetch('https://api.tzkt.io/v1/tokens/balances?account=' + tezAddr + '&token.standard=fa2&balance.gt=0&limit=20&select=token');
        if (!resp.ok) throw new Error('TZKT_' + resp.status);
        var tokens = await resp.json();
        
        tokens.forEach(function(tok) {
            var meta = tok.metadata || {};
            var name = meta.name || tok.contract?.alias || ('TEZ#' + (tok.tokenId || '?'));

            var isVid = false;
            var isGif = false;
            
            // 1. Check Tezos metadata formats for Video OR GIF
            if (meta.formats && meta.formats.length > 0) {
                var mime = meta.formats[0].mimeType || '';
                if (mime.startsWith('video/')) isVid = true;
                if (mime === 'image/gif') isGif = true;
            }

            // 2. Fallback: check the actual artifact string just in case
            var artifact = meta.artifactUri || '';
            if (artifact.toLowerCase().match(/\.(mp4|webm|mov|ogg)(\?|$)/)) isVid = true;
            if (artifact.toLowerCase().match(/\.(gif)(\?|$)/)) isGif = true;

            // 3. If animated (Video or GIF), grab the raw artifact. If static, grab the display thumbnail.
            var imageUrl = '';
            if ((isVid || isGif) && artifact) {
                imageUrl = artifact;
            } else {
                imageUrl = meta.displayUri || artifact || meta.thumbnailUri || '';
            }

            // Pass forceVideo ONLY for true videos. GIFs will naturally fall into your <img> logic!
            results.push({ name: name, imageUrl: imageUrl, chain: 'TEZ', forceVideo: isVid });
        });
        return results;
    }

    // ── ENS resolution: name.eth → 0x address ──
    async function resolveEnsName(name) {
        if (typeof ethers === 'undefined') throw new Error('ETHERS_NOT_LOADED');
        var provider;
        if (window.ethereum) {
            provider = new ethers.providers.Web3Provider(window.ethereum);
        } else {
            // Fallback: ethers default provider (uses public Infura/ALCHEMY endpoints)
            provider = ethers.getDefaultProvider('homestead');
        }
        var addr = await provider.resolveName(name);
        if (!addr) throw new Error('ENS_NOT_FOUND: ' + name);
        return addr;
    }

    // ── TezDomains resolution: name.tez → tz1/tz2 address ──
    async function resolveTezDomain(name) {
        // TzDomains public GraphQL endpoint (no API key needed)
        var query = JSON.stringify({
            query: '{ domain(name: "' + name + '") { address } }'
        });
        var resp = await fetch('https://api.tezos.domains/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: query
        });
        if (!resp.ok) throw new Error('TEZDOMAIN_HTTP_' + resp.status);
        var data = await resp.json();
        var addr = data && data.data && data.data.domain && data.data.domain.address;
        if (!addr) throw new Error('TEZDOMAIN_NOT_FOUND: ' + name);
        return addr;
    }

    $('btn-scan-nfts').onclick = async () => {
        var ethManual    = $('eth-addr-manual') ? $('eth-addr-manual').value.trim() : '';
        var tezInput     = $('tezos-addr')      ? $('tezos-addr').value.trim()      : '';
        var resolvedLabel = $('vault-resolved-label');

        // Hide the resolved-name strip until we need it
        if (resolvedLabel) { resolvedLabel.style.display = 'none'; resolvedLabel.textContent = ''; }

        // ── ETH address resolution ──
        // Priority: manual input field > connected wallet address
        var ethDisplayName = null; // tracks the human-readable name for the label
        var ethAddr = null;

        if (ethManual) {
            if (ethManual.toLowerCase().endsWith('.eth')) {
                $('nft-vault-list').innerHTML = 'RESOLVING ENS...';
                log('NFT_VAULT: RESOLVING ' + ethManual);
                try {
                    ethAddr = await resolveEnsName(ethManual);
                    ethDisplayName = ethManual; // keep the pretty name
                    log('NFT_VAULT: ENS_OK ' + ethManual + ' → ' + ethAddr);
                } catch (e) {
                    log('NFT_VAULT: ENS_ERR ' + e.message);
                    $('nft-vault-list').innerHTML = 'ENS_ERR: ' + e.message;
                    return;
                }
            } else if (ethManual.startsWith('0x')) {
                ethAddr = ethManual;
            } else {
                $('nft-vault-list').innerHTML = 'INVALID_ETH_INPUT (need 0x... or name.eth)';
                return;
            }
        } else if (APP.wallet.connected && APP.wallet.address) {
            ethAddr = APP.wallet.address;
        }

        // ── TEZOS address resolution ──
        var tezDisplayName = null;
        var tezAddr = null;

        if (tezInput) {
            if (tezInput.toLowerCase().endsWith('.tez')) {
                $('nft-vault-list').innerHTML = 'RESOLVING TEZDOMAIN...';
                log('NFT_VAULT: RESOLVING ' + tezInput);
                try {
                    tezAddr = await resolveTezDomain(tezInput);
                    tezDisplayName = tezInput;
                    log('NFT_VAULT: TEZDOMAIN_OK ' + tezInput + ' → ' + tezAddr);
                } catch (e) {
                    log('NFT_VAULT: TEZDOMAIN_ERR ' + e.message);
                    $('nft-vault-list').innerHTML = 'TEZDOMAIN_ERR: ' + e.message;
                    return;
                }
            } else if (tezInput.startsWith('tz')) {
                tezAddr = tezInput;
            } else {
                $('nft-vault-list').innerHTML = 'INVALID_TEZ_INPUT (need tz1... or name.tez)';
                return;
            }
        }

        var hasEth = !!ethAddr;
        var hasTez = !!tezAddr;

        if (!hasEth && !hasTez) {
            $('nft-vault-list').innerHTML = 'CONNECT_WALLET_OR_ENTER_ADDRESS';
            return;
        }

        // Show resolved-name privacy label (display the friendly name, not the raw hex)
        var labelParts = [];
        if (ethDisplayName) labelParts.push('ETH: ' + ethDisplayName);
        if (tezDisplayName) labelParts.push('TEZ: ' + tezDisplayName);
        if (labelParts.length && resolvedLabel) {
            resolvedLabel.textContent = labelParts.join('  |  ');
            resolvedLabel.style.display = 'block';
        }

        $('nft-vault-list').innerHTML = 'SCANNING...';
        log('NFT_VAULT: SCANNING...');

        var allNfts = [];
        var errors = [];

        var promises = [];
        if (hasEth) promises.push(
            scanETHNfts(ethAddr)
                .then(function(r) { allNfts = allNfts.concat(r); log('NFT_VAULT: ETH_FOUND ' + r.length); })
                .catch(function(e) { errors.push('ETH:' + e.message); log('NFT_VAULT: ETH_FAIL ' + e.message); })
        );
        if (hasTez) promises.push(
            scanTezosNfts(tezAddr)
                .then(function(r) { allNfts = allNfts.concat(r); log('NFT_VAULT: TEZ_FOUND ' + r.length); })
                .catch(function(e) { errors.push('TEZ:' + e.message); log('NFT_VAULT: TEZ_FAIL ' + e.message); })
        );

        await Promise.all(promises);

        if (allNfts.length > 0) {
            var html = renderVaultList(allNfts);
            $('nft-vault-list').innerHTML = html;
            $('nft-count').textContent = 'ASSETS: ' + allNfts.length;
            $('vault-dot').classList.remove('off');
            log('NFT_VAULT: ' + allNfts.length + ' TOTAL ASSETS LOADED');
            if (typeof window.runTokenGate === 'function') window.runTokenGate(allNfts);
        } else {
            var msg = '';
            if (errors.length > 0) {
                msg = 'SCAN_ERR: ' + errors.join(', ');
            } else if (hasEth && !hasTez) {
                msg = 'NO_ETH_NFTS — ADD TEZ ADDR ABOVE FOR TEZOS';
            } else {
                msg = 'NO_NFTS_FOUND';
            }
            $('nft-vault-list').innerHTML = msg;
            $('nft-count').textContent = 'ASSETS: 0';
        }
    };

    // NFT_VAULT — Event delegation: clicking a sidebar NFT item summons it to canvas
    $('nft-vault-list').addEventListener('click', function(e) {
        var item = e.target.closest('.nft-vault-item');
        if (!item) return;
        var idx = parseInt(item.getAttribute('data-nft-index'), 10);
        if (!isNaN(idx) && typeof summonNFTByIndex === 'function') {
            summonNFTByIndex(idx);
        }
    });

    // ========================================
    // v19 FEATURE PACK: TRANSITIONS + AI
    // ========================================

    // v19 SMOOTH TRANSITIONS — crossfade layers for AI/media swap
    const v19_Transitions = {
        init: () => {
            const style = document.createElement('style');
            style.innerHTML = `
                .vngrd-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background-size: cover; background-position: center;
                    transition: opacity 1.5s cubic-bezier(0.4, 0, 0.2, 1);
                    opacity: 0; z-index: 1; pointer-events: none; }
                .vngrd-layer.active { opacity: 1; z-index: 2; }
            `;
            document.head.appendChild(style);
        },
        swap: (imgUrl) => {
            const stage = $('stage');
            if (!stage) return;
            const active = stage.querySelector('.vngrd-layer.active');
            const next = document.createElement('div');
            next.className = 'vngrd-layer';
            next.style.backgroundImage = `url('${imgUrl}')`;
            stage.appendChild(next);
            void next.offsetWidth;
            next.classList.add('active');
            if (active) {
                active.classList.remove('active');
                setTimeout(() => active.remove(), 1600);
            }
        }
    };


    // ── Per-pad controls: kill × (custom only) + mute M (all pads) ──────────
    (function() {
        document.querySelectorAll('.sfx-pad').forEach(function(pad) {
            var name = pad.dataset && pad.dataset.sfx;
            if (!name) return;

            // Kill × — only on custom pads (sfx-cust), bottom-right corner
            if (pad.classList.contains('sfx-cust')) {
                var xBtn = document.createElement('button');
                xBtn.className = 'pad-xclear';
                xBtn.textContent = '×';
                xBtn.title = 'Clear sample';
                xBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    Sampler.purgePad(name);
                });
                pad.appendChild(xBtn);
            }

            // Mute M — all pads, bottom-left corner
            var mBtn = document.createElement('button');
            mBtn.className = 'pad-mute';
            mBtn.textContent = 'M';
            mBtn.title = 'Mute pad';
            mBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var muted = pad.classList.toggle('pad-muted');
                mBtn.title = muted ? 'Unmute pad' : 'Mute pad';
            });
            pad.appendChild(mBtn);
        });
    })();

    // Wire button + Enter key
    if ($('btn-generate-ai')) {
        $('btn-generate-ai').onclick = function() {
            var p = $('ai-prompt') ? $('ai-prompt').value.trim() : '';
            aiGenerate(p);
        };
    }
    if ($('ai-prompt')) {
        $('ai-prompt').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var p = e.target.value.trim();
                if (p) aiGenerate(p);
            }
        });
    }

    // API key gear toggle — hidden by default, persists to localStorage
    (function() {
        var toggle = $('ai-key-toggle');
        var wrap = $('ai-key-wrap');
        var input = $('ai-api-key');
        if (!toggle || !wrap || !input) return;
        try { var saved = localStorage.getItem('vngrd_ai_key'); if (saved) input.value = saved; } catch(e) {}
        toggle.onclick = function() {
            var open = wrap.style.display !== 'none';
            wrap.style.display = open ? 'none' : 'flex';
            toggle.style.opacity = open ? '0.35' : '0.8';
        };
        input.addEventListener('change', function() {
            try { localStorage.setItem('vngrd_ai_key', input.value.trim()); } catch(e) {}
        });
    })();

    // Collapsible sections with arrow indicators
    ['session-lab-body', 'p2p-call-body', 'midi-host-body', 'nft-vault-body', 'lexica-nano-body'].forEach(function(id) {
        var el = $(id);
        if (!el) return;
        var head = el.previousElementSibling;
        if (!head) return;
        var arrow = head.querySelector('.sec-arrow');
        head.onclick = function() {
            var isOpen = head.classList.toggle('open');
            el.style.maxHeight = isOpen ? '500px' : '0';
            el.style.padding = isOpen ? '10px 12px' : '0 12px';
            if (arrow) arrow.textContent = isOpen ? '\u25BE' : '\u25B8';
        };
    });
    // CINEMA_ENGINE collapsible — starts closed, max-height toggle
    (function() {
        var _sveBody = $('sve-body');
        var _sveHead = _sveBody && _sveBody.previousElementSibling;
        if (!_sveHead) return;
        var _sveArrow = _sveHead.querySelector('.sec-arrow');
        _sveHead.onclick = function(e) {
            if (e.target.closest('.section-help-overlay') || e.target.closest('.sampler-help-btn')) return;
            var isOpen = _sveHead.classList.toggle('open');
            _sveBody.style.maxHeight = isOpen ? '400px' : '0';
            _sveBody.style.padding = isOpen ? '6px 8px' : '0 8px';
            if (_sveArrow) _sveArrow.textContent = isOpen ? '\u25BE' : '\u25B8';
        };
    })();

    // Init v19 transitions
    v19_Transitions.init();


    // ── SYS-LOG v2: smart dim/alert + handle drag + pin ──────────────────
    (function() {
        var sl    = document.getElementById('sys-log');
        var handle= document.getElementById('sys-log-handle');
        var badge = document.getElementById('sys-log-badge');
        if (!sl || !handle) return;

        var _pinned      = false;
        var _unread      = 0;
        var _dimTimer    = null;
        var _alertTimer  = null;

        var STATES = ['sl-dim','sl-idle','sl-active','sl-alert','sl-pinned'];
        function _setState(cls) {
            sl.classList.remove('sl-dim','sl-idle','sl-active','sl-alert','sl-pinned');
            if (cls) sl.classList.add(cls);
        }

        // Dim after inactivity
        function _scheduleDim(ms) {
            clearTimeout(_dimTimer);
            _dimTimer = setTimeout(function() {
                if (!_pinned) _setState('');  // back to base (opacity 0.12)
            }, ms || 8000);
        }

        // Expose to log()
        window._sysLogWake = function(level) {
            clearTimeout(_alertTimer);
            if (_pinned) return; // pinned: no state override
            if (level === 'err') {
                _setState('sl-alert');
                _unread++;
                if (badge) { badge.textContent = _unread; badge.style.display = 'inline-block'; }
                _alertTimer = setTimeout(function() { _setState('sl-idle'); _scheduleDim(10000); }, 7000);
            } else if (level === 'warn') {
                _setState('sl-active');
                _scheduleDim(6000);
            } else if (level === 'ok') {
                if (!sl.classList.contains('sl-alert')) _setState('sl-idle');
                _scheduleDim(4000);
            } else {
                // 'info' — only show if already visible; never wake from deep dim
                if (sl.classList.contains('sl-active') || sl.classList.contains('sl-alert') || sl.classList.contains('sl-idle')) {
                    _scheduleDim(4000); // just reset timer, no state change
                }
                // otherwise stay dimmed
            }
        };

        // Pin toggle
        window._sysLogTogglePin = function() {
            _pinned = !_pinned;
            var btn = document.getElementById('sys-log-pin-btn');
            if (_pinned) {
                _setState('sl-pinned');
                clearTimeout(_dimTimer);
                if (btn) btn.classList.add('pinned');
            } else {
                if (btn) btn.classList.remove('pinned');
                _setState('sl-idle');
                _scheduleDim(8000);
            }
        };

        // Clear
        window._sysLogClear = function() {
            var body = document.getElementById('sys-log-body');
            if (body) body.innerHTML = '';
            _unread = 0;
            if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }
        };

        // Hover: briefly show
        sl.addEventListener('mouseenter', function() {
            clearTimeout(_dimTimer);
            if (!_pinned && !sl.classList.contains('sl-alert')) _setState('sl-active');
        });
        sl.addEventListener('mouseleave', function() {
            if (!_pinned) _scheduleDim(5000);
        });
        // Click badge: clear unread
        if (badge) badge.addEventListener('click', function(e) {
            e.stopPropagation();
            _unread = 0; badge.style.display = 'none';
        });

        // ── HANDLE DRAG ───────────────────────────────────────────────
        var _drag = { on: false, ox: 0, oy: 0, px: 0, py: 0 };

        handle.addEventListener('mousedown', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            var r = sl.getBoundingClientRect();
            _drag.ox = e.clientX; _drag.oy = e.clientY;
            _drag.px = r.left;   _drag.py = r.top;
            _drag.on = true;
            sl.style.transition = 'opacity 0.5s ease, border-color 0.4s, box-shadow 0.4s';
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!_drag.on) return;
            var nx = _drag.px + (e.clientX - _drag.ox);
            var ny = _drag.py + (e.clientY - _drag.oy);
            nx = Math.max(0, Math.min(nx, window.innerWidth  - sl.offsetWidth));
            ny = Math.max(0, Math.min(ny, window.innerHeight - sl.offsetHeight));
            sl.style.left   = nx + 'px';
            sl.style.top    = ny + 'px';
            sl.style.right  = 'auto';
            sl.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function() { _drag.on = false; });

        // Double-click handle: snap back to default corner
        handle.addEventListener('dblclick', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            sl.style.left = ''; sl.style.top = '';
            sl.style.right = '200px'; sl.style.bottom = '55px';
        });

        // Start dimmed
        _setState('');
    })();


    
    
    
    

    

    
    // Shatter all button
    if ($('btn-shatter-all')) {
        $('btn-shatter-all').onclick = () => {
            for (let i = 0; i < 5; i++) {
                const x = Math.random() * window.innerWidth;
                const y = Math.random() * window.innerHeight;
                if (typeof createGlassFracture === 'function') createGlassFracture(x, y);
            }
            log('SHATTER_ALL: TRIGGERED');
        };
    }
    
    // ========================================
    // CAMERA PREVIEW - FLOATING BOX
    // ========================================
    function updateCameraPreview() {
        const preview = $('cam-preview-float');
        const previewVid = $('preview-vid-float');
        
        if (APP.camera.stream && preview && previewVid) {
            previewVid.srcObject = APP.camera.stream;
            previewVid.muted = true;
            preview.classList.add('active');
            APP.camera.previewEl = previewVid;
        }
    }
    
    // Hook into camera init
    const originalInitCamera = window.initCamera;
    window.initCamera = async function() {
        if (typeof originalInitCamera === 'function') {
            await originalInitCamera();
        }
        setTimeout(updateCameraPreview, 500);
    };
    
    // ========================================
    // GEODATA TICKER INJECTION
    // ========================================
    function injectGeoToTicker() {
        const ticker = $('ticker-text');
        if (!ticker || !APP.atmosphere.city) return;
        
        const geoData = `[LOC: ${APP.atmosphere.city.toUpperCase()}] // [LAT: ${APP.atmosphere.latitude?.toFixed(2) || '?'}] // [LON: ${APP.atmosphere.longitude?.toFixed(2) || '?'}]`;
        
        // Prepend geo data to ticker
        if (!ticker.textContent.includes('[LOC:')) {
            ticker.textContent = geoData + ' // ' + ticker.textContent;
        }
    }
    
    // ========================================
    // PRO-AUDIO: SPATIAL PANNING + PITCH RANDOMIZATION
    // ========================================
    // Per-bullet spatial impact: transient tick + metal ring + micro-thud, panned to hit position
    function playImpactSoundWithSpatial(x, y) {
        if (!APP.shooting.audioCtx) return;
        const ctx = APP.shooting.audioCtx;
        const now = ctx.currentTime;
        const pm = 0.7 + Math.random()*0.6; // wide pitch variance — no two shots alike

        // Stereo panner (hit X position → left/right)
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, (x / window.innerWidth)*2 - 1));
        panner.connect(ctx.destination);

        // Layer 1 — sharp transient tick (HPF noise, 5ms)
        const tickBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate*0.005), ctx.sampleRate);
        const tkd = tickBuf.getChannelData(0);
        for (let i=0;i<tkd.length;i++) tkd[i]=(Math.random()*2-1)*(1-i/tkd.length);
        const tick = ctx.createBufferSource(); tick.buffer=tickBuf;
        const tickHpf = ctx.createBiquadFilter(); tickHpf.type='highpass'; tickHpf.frequency.value=3500;
        const tkG = ctx.createGain();
        tkG.gain.setValueAtTime(0.8, now); tkG.gain.exponentialRampToValueAtTime(0.001, now+0.006);
        tick.connect(tickHpf); tickHpf.connect(tkG); tkG.connect(panner);
        tick.start(now); tick.stop(now+0.007);

        // Layer 2 — metal ring with pitch droop
        const rf = 920 * pm;
        const ring = ctx.createOscillator(); ring.type='sine';
        ring.frequency.setValueAtTime(rf*1.02, now); ring.frequency.exponentialRampToValueAtTime(rf, now+0.02);
        const rG = ctx.createGain();
        rG.gain.setValueAtTime(0.2, now); rG.gain.exponentialRampToValueAtTime(0.001, now+0.14);
        ring.connect(rG); rG.connect(panner); ring.start(now); ring.stop(now+0.16);

        // Layer 3 — micro body thud
        const body = ctx.createOscillator(); body.type='sine';
        body.frequency.setValueAtTime(75, now); body.frequency.exponentialRampToValueAtTime(28, now+0.055);
        const bG = ctx.createGain();
        bG.gain.setValueAtTime(0.28, now); bG.gain.exponentialRampToValueAtTime(0.001, now+0.065);
        body.connect(bG); bG.connect(panner); body.start(now); body.stop(now+0.07);
    }
    
    // Override playMetalTink to use spatial panning
    const originalPlayMetalTink = window.playMetalTink;
    window.playMetalTink = function(x, y) {
        playImpactSoundWithSpatial(x || window.innerWidth/2, y || window.innerHeight/2);
    };

    // Trinity drag is now canvas-space (initTrinityDrag) — no DOM drag needed

    // Initialize geo ticker injection
    setTimeout(injectGeoToTicker, 3000);

    // ── PRESENCE MONITOR ──────────────────────────────────────────────────────
    // Lightweight cross-tab heartbeat via BroadcastChannel API (no server needed).
    // Puter.js removed — presence tracking is now 100% local / offline-capable.
    (function() {
        var _nodeId    = Math.random().toString(36).substr(2, 10);
        var _peers     = new Set([_nodeId]);
        var _pingTimer = null;

        function _updateCount() {
            var el = document.getElementById('presence-count');
            if (el) el.textContent = _peers.size;
        }

        try {
            var bc = new BroadcastChannel('vngrd_presence');

            bc.onmessage = function(ev) {
                var d = ev.data || {};
                if (d.type === 'ping') {
                    _peers.add(d.id);
                    bc.postMessage({ type: 'pong', id: _nodeId });
                } else if (d.type === 'pong') {
                    _peers.add(d.id);
                } else if (d.type === 'bye') {
                    _peers.delete(d.id);
                }
                _updateCount();
            };

            // Broadcast a ping every 30 s; clear stale peers first
            _pingTimer = setInterval(function() {
                _peers.clear();
                _peers.add(_nodeId);
                bc.postMessage({ type: 'ping', id: _nodeId });
                setTimeout(_updateCount, 1200);
            }, 30000);

            window.addEventListener('beforeunload', function() {
                clearInterval(_pingTimer);
                bc.postMessage({ type: 'bye', id: _nodeId });
                bc.close();
            });

            // Initial ping so other open tabs register this one
            bc.postMessage({ type: 'ping', id: _nodeId });
            setTimeout(_updateCount, 1200);

        } catch (e) {
            // BroadcastChannel not supported (e.g. file:// in Safari) — degrade silently
        }
    })();
    // ── END PRESENCE MONITOR ──────────────────────────────────────────────────

}); // THIS IS THE END of the startup block. Do not put code after this line.

