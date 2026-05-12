// ═══════════════════════════════════════════════════════════════
// CAMERA MODULE — Live capture, loop inject, broadcast recording,
// lower thirds display, P2P mix-minus preview
// Extracted from main.js. Depends on: $, APP, log (globals)
// ═══════════════════════════════════════════════════════════════

// CAMERA
async function initCamera() {
    try {
        var constraints = { video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false };
        try {
            APP.camera.stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (_) {
            APP.camera.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        }
        APP.camera.videoEl = document.createElement('video');
        APP.camera.videoEl.srcObject = APP.camera.stream;
        APP.camera.videoEl.setAttribute('playsinline', '');
        APP.camera.videoEl.muted = true; APP.camera.videoEl.playsInline = true; APP.camera.videoEl.play().catch(() => {});
        APP.camera.mode = 'preview';
        APP.camera.facingMode = 'user';
        $('btn-init-cam').style.display = 'none';
        $('cam-ctrls').style.display = 'block';
        $('btn-kill').style.display = 'block';
        $('cam-dot').classList.remove('off');
        var _fco = $('btn-flip-cam-overlay'); if (_fco) _fco.style.display = 'block';
        log('CAM_ONLINE');
        if (!APP.audio.ctx) { APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        const preview = $('cam-preview-float');
        const previewVid = $('preview-vid-float');
        if (preview && previewVid) {
            previewVid.srcObject = APP.camera.stream;
            previewVid.muted = true;
            preview.classList.add('active');
            APP.camera.previewEl = previewVid;
        }
    } catch (e) { log('CAM_DENIED'); }
}

async function flipCamera() {
    if (!APP.camera.stream) return;
    var overlayBtn = $('btn-flip-cam-overlay');
    if (overlayBtn) { overlayBtn.disabled = true; overlayBtn.textContent = '⟳'; }
    var next = (APP.camera.facingMode === 'user') ? 'environment' : 'user';
    APP.camera.stream.getTracks().forEach(t => t.stop());
    try {
        try {
            APP.camera.stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: next },
                audio: false
            });
        } catch (_) {
            APP.camera.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false });
        }
        APP.camera.facingMode = next;
        var previewVid = $('preview-vid-float');
        if (previewVid) { previewVid.srcObject = APP.camera.stream; APP.camera.previewEl = previewVid; }
        if (APP.camera.videoEl) APP.camera.videoEl.srcObject = APP.camera.stream;
        if (overlayBtn) { overlayBtn.textContent = '↻'; overlayBtn.disabled = false; }
        log('CAM_FLIP_' + next.toUpperCase());
    } catch (e) {
        try {
            APP.camera.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: APP.camera.facingMode }, audio: false });
            var pv = $('preview-vid-float'); if (pv) { pv.srcObject = APP.camera.stream; APP.camera.previewEl = pv; }
        } catch (_) {}
        if (overlayBtn) { overlayBtn.textContent = '↻'; overlayBtn.disabled = false; }
        log('CAM_FLIP_FAIL');
    }
}

$('btn-inject').onclick = () => {
    if(!APP.camera.stream) return;
    const btn = $('btn-inject');
    if (APP.loop.recorder && APP.loop.recorder.state === 'recording') { APP.loop.recorder.stop(); return; }
    APP.loop.chunks = [];
    var loopMime = 'video/webm';
    if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) loopMime = 'video/webm;codecs=vp9';
        else if (MediaRecorder.isTypeSupported('video/webm')) loopMime = 'video/webm';
        else if (MediaRecorder.isTypeSupported('video/mp4')) loopMime = 'video/mp4';
    }
    APP.loop.recorder = new MediaRecorder(APP.camera.stream, { mimeType: loopMime });
    APP.loop.recorder.ondataavailable = e => APP.loop.chunks.push(e.data);
    APP.loop.recorder.onstop = () => {
        clearInterval(APP.loop.timer);
        const blob = new Blob(APP.loop.chunks, { type: loopMime });
        if(APP.loop.activeUrl) URL.revokeObjectURL(APP.loop.activeUrl);
        APP.loop.activeUrl = URL.createObjectURL(blob);
        const vid = document.createElement('video');
        vid.src = APP.loop.activeUrl;
        vid.setAttribute('playsinline', '');
        vid.muted = true; vid.loop = true; vid.playsInline = true;
        vid.play().catch(function() {});
        const item = { type: 'video', url: APP.loop.activeUrl, element: vid, name: 'LOOP_SAMPLE' };
        APP.media.queue.push(item);
        APP.media.currentIndex = APP.media.queue.length - 1;
        APP.media.currentElement = vid;
        APP.state.isLive = false;
        btn.innerText = 'INJECT LOOP (10s)'; btn.classList.remove('on'); updateQueueDisplay(); log('LOOP_INJECTED');
    };
    APP.loop.recorder.start(); btn.classList.add('on'); APP.loop.counter = 10; btn.innerText = `SAMPLING... ${APP.loop.counter}`;
    APP.loop.timer = setInterval(() => { APP.loop.counter--; btn.innerText = `SAMPLING... ${APP.loop.counter}`; if(APP.loop.counter <= 0) APP.loop.recorder.stop(); }, 1000);
};

function goLive() {
    if (!APP.camera.stream) return;
    const overlay = $('countdown'); const num = $('countdown-num'); const btn = $('btn-go-live');
    overlay.style.display = 'flex'; let count = 3; num.textContent = count; btn.textContent = `LIVE IN ${count}...`;
    if (window.applyAudioDuck) window.applyAudioDuck(true);
    const interval = setInterval(() => {
        count--;
        if (count > 0) { num.textContent = count; btn.textContent = `LIVE IN ${count}...`; }
        else {
            clearInterval(interval); overlay.style.display = 'none';
            APP.render.source = null;
            APP.state.isLive = true;
            APP.camera.mode = 'live';
            if (APP.camera.videoEl && APP.camera.videoEl.paused) {
                APP.camera.videoEl.play().catch(function() {});
            }
            var _pf = $('cam-preview-float'); if (_pf) { _pf.classList.remove('active'); _pf.style.display = 'none'; }
            $('cam-ctrls').style.display = 'none'; $('live-ctrls').style.display = 'block'; $('tally').style.display = 'block'; $('status-text').textContent = 'LIVE'; $('main-dot').classList.add('live');
            document.querySelector('.preview-label').textContent = 'LIVE'; log('LIVE_PODCAST_MODE');
        }
    }, 1000);
}

$('btn-rec').onclick = () => {
    const btn = $('btn-rec');
    if (APP.broadcast.isRecording) {
        APP.broadcast.recorder.stop();
        APP.broadcast.isRecording = false;
        btn.innerText = 'SAVING...';
        btn.classList.remove('active');
        $('rec-status').style.display = 'none';
    } else {
        try {
            ensureAudioChain();
            if (APP.audio.ctx && APP.audio.ctx.state === 'suspended') APP.audio.ctx.resume();
            var _bcastCanvas = (APP.render && APP.render.recordCanvas) ? APP.render.recordCanvas : APP.render.canvas;
            var bcastStream = new MediaStream(_bcastCanvas.captureStream(30).getVideoTracks());
            if (APP.audio.ctx && APP.audio.outputLimiter) {
                var bcastDest = APP.audio.ctx.createMediaStreamDestination();
                APP.audio.outputLimiter.connect(bcastDest);
                if (APP.audio.micGainNode) {
                    try { APP.audio.micGainNode.connect(bcastDest); } catch(e) {}
                }
                bcastDest.stream.getAudioTracks().forEach(t => bcastStream.addTrack(t));
            }
            APP.broadcast.chunks = [];
            var bcastOpts = { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 50000000, audioBitsPerSecond: 128000 };
            try { APP.broadcast.recorder = new MediaRecorder(bcastStream, bcastOpts); }
            catch(e) {
                try { APP.broadcast.recorder = new MediaRecorder(bcastStream, { mimeType: 'video/webm;codecs=vp8,opus' }); }
                catch(e2) { APP.broadcast.recorder = new MediaRecorder(bcastStream, { mimeType: 'video/webm' }); }
            }
            APP.broadcast.recorder.ondataavailable = e => { if (e.data && e.data.size > 0) APP.broadcast.chunks.push(e.data); };
            APP.broadcast.recorder.onstop = () => {
                const blob = new Blob(APP.broadcast.chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `VNGRD_BROADCAST_${Date.now()}.webm`; a.click();
                setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
                btn.innerText = 'REC_BROADCAST'; log('BROADCAST_SAVED');
            };
            APP.broadcast.recorder.start(1000);
            APP.broadcast.isRecording = true;
            btn.innerText = '■ STOP & SAVE';
            btn.classList.add('active');
            $('rec-status').style.display = 'block';
            log('BROADCAST_REC_START');
        } catch(e) { log('BROADCAST_ERR: ' + e.message); }
    }
};

function endLive() {
    APP.state.isLive = false; APP.camera.mode = 'preview';
    if (window.applyAudioDuck) window.applyAudioDuck(false);
    $('live-ctrls').style.display = 'none'; $('cam-ctrls').style.display = 'block'; $('tally').style.display = 'none'; $('status-text').textContent = 'STANDBY'; $('main-dot').classList.remove('live'); $('btn-go-live').textContent = 'GO LIVE [3-2-1]'; var _pf3 = $('cam-preview-float'); if (_pf3 && APP.camera.stream) { _pf3.style.display = ''; _pf3.classList.add('active'); }
    log('END_LIVE');
    $('rec-status').style.display = 'none';
}

function killCamera() {
    if (window.applyAudioDuck) window.applyAudioDuck(false);
    if (APP.camera.stream) { try { APP.camera.stream.getTracks().forEach(t => t.stop()); } catch(e){} }
    APP.camera.stream = null;
    if (APP.camera.videoEl) { APP.camera.videoEl.srcObject = null; APP.camera.videoEl = null; }
    APP.camera.mode = 'off';
    APP.state.isLive = false;
    APP.render.source = null;
    $('live-ctrls').style.display = 'none';
    $('cam-ctrls').style.display = 'none';
    $('btn-init-cam').style.display = 'block';
    $('btn-kill').style.display = 'none';
    $('cam-dot').classList.add('off');
    var _fco2 = $('btn-flip-cam-overlay'); if (_fco2) { _fco2.style.display = 'none'; _fco2.textContent = '↻'; _fco2.disabled = false; }
    $('tally').style.display = 'none';
    $('status-text').textContent = 'STANDBY';
    $('main-dot').classList.remove('live');
    var _pf2 = $('cam-preview-float');
    if (_pf2) { _pf2.classList.remove('active'); _pf2.style.display = 'none'; }
    if (APP.camera.previewEl) { APP.camera.previewEl.srcObject = null; APP.camera.previewEl = null; }
    $('rec-status').style.display = 'none';
    if (APP.broadcast && APP.broadcast.isRecording && APP.broadcast.recorder) {
        try { APP.broadcast.recorder.stop(); } catch(e){}
        APP.broadcast.isRecording = false;
    }
    log('CAM_OFF');
}

function showLowerThird(preset) {
    const lt = $('lower-third'); const container = lt.querySelector('.lt-container');
    const modePresets = ['guest', 'track', 'breaking'];
    if (modePresets.includes(preset)) APP.lowerThird.mode = preset;
    if (['neon','split','glitch'].includes(preset)) {
        APP.lowerThird.ltStyle = preset;
        if ($('lt-style-select')) $('lt-style-select').value = preset;
    }
    const mode  = APP.lowerThird.mode  || 'guest';
    const style = ($('lt-style-select') ? $('lt-style-select').value : null) || APP.lowerThird.ltStyle || 'default';
    const visualPreset = (style !== 'default') ? style : mode;
    container.classList.remove('lt-guest','lt-track','lt-breaking','lt-neon','lt-split','lt-glitch');
    container.classList.add(`lt-${visualPreset}`);
    APP.lowerThird.preset = visualPreset; APP.lowerThird.visible = true; APP.lowerThird._lastShimmer = null;
    APP.lowerThird._showTime = performance.now(); APP.lowerThird._hiding = false;
    if (mode === 'track') { $('lt-title-text').textContent = APP.audio.currentTrackName || $('lt-title').value || 'TRACK TITLE'; $('lt-subtitle-text').textContent = 'NOW PLAYING'; }
    else if (mode === 'breaking') { $('lt-title-text').textContent = $('lt-title').value || 'BREAKING NEWS'; $('lt-subtitle-text').textContent = $('lt-sub').value || 'LIVE UPDATE'; }
    else { $('lt-title-text').textContent = $('lt-title').value || 'GUEST NAME'; $('lt-subtitle-text').textContent = $('lt-sub').value || 'TITLE / ROLE'; }
    ['guest','track','breaking'].forEach(m => { const el = $(`btn-lt-${m}`); if (el) el.classList.toggle('active-mode', m === mode); });
}

function hideLowerThird() {
    if (APP.lowerThird.visible && !APP.lowerThird._hiding) {
        APP.lowerThird._hiding = true;
        APP.lowerThird._hideStart = performance.now();
        setTimeout(function() {
            $('lower-third').classList.remove('visible');
            APP.lowerThird.visible = false;
            APP.lowerThird._hiding = false;
        }, 420);
    } else if (!APP.lowerThird.visible) {
        $('lower-third').classList.remove('visible');
    }
    ['guest','track','breaking'].forEach(m => { const el = $(`btn-lt-${m}`); if (el) el.classList.remove('active-mode'); });
}

// ─────────────────────────────────────────────────────────────────────────────
// P2P MIX-MINUS LOCAL PREVIEW
// Draws a miniature LT graphic to #lt-preview-canvas inside #cam-preview-float
// ─────────────────────────────────────────────────────────────────────────────
function drawLTToPreview(preset, title, subtitle) {
    var canvas = $('lt-preview-canvas');
    if (!canvas) return;
    var pf = $('cam-preview-float');
    var pw = pf ? pf.offsetWidth : 200;
    canvas.width = pw;
    canvas.height = Math.round(pw * 0.16);
    var c = canvas.getContext('2d');
    if (!c) return;
    var accent = '#00f3ff';
    if (preset === 'track')    accent = '#00ff88';
    if (preset === 'breaking') accent = '#ff3333';
    var W = canvas.width, H = canvas.height;
    var pad = Math.round(H * 0.12);
    var bar = 3;
    c.fillStyle = 'rgba(8,10,18,0.94)';
    c.fillRect(0, 0, W, H);
    c.fillStyle = accent;
    c.fillRect(0, 0, bar, H);
    c.fillRect(0, H - 1, W, 1);
    var titleFS = Math.max(7, Math.round(H * 0.36));
    c.font = '800 ' + titleFS + 'px Orbitron, sans-serif';
    c.fillStyle = '#ffffff';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(title || 'GUEST NAME', bar + pad, pad);
    if (subtitle) {
        var subFS = Math.max(5, Math.round(H * 0.24));
        c.font = '500 ' + subFS + 'px "JetBrains Mono", monospace';
        c.fillStyle = accent;
        c.fillText(subtitle, bar + pad, pad + titleFS + 2);
    }
    var badgeFS = Math.max(5, Math.round(H * 0.2));
    c.font = '700 ' + badgeFS + 'px Orbitron, sans-serif';
    c.fillStyle = accent;
    c.textAlign = 'right';
    c.fillText('► P2P', W - pad, pad);
    if (canvas._ltClear) clearTimeout(canvas._ltClear);
}
