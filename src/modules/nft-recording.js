// ═══════════════════════════════════════════════════════════════
// NFT RECORDING MODULE — VGD clip capture, timer HUD, finalize
// Extracted from main.js. Depends on: $, APP, log, ensureAudioChain (globals)
// ═══════════════════════════════════════════════════════════════

async function startNFTRecording() {
    if (APP.nft.isRecording) { stopNFTRecording(); return; }

    var btn = $('btn-nft-30');
    btn.disabled = false; btn.style.opacity = '1';

    try {
        if (!APP.audio.ctx) APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        ensureAudioChain();

        if (APP.audio.ctx && APP.audio.ctx.state === 'suspended') {
            await APP.audio.ctx.resume();
        }

        var canvasStream = APP.render.canvas.captureStream(30);
        var combinedStream = new MediaStream(canvasStream.getVideoTracks());

        if (APP.audio.ctx) {
            var freshDest = APP.audio.ctx.createMediaStreamDestination();
            var tapNode = APP.audio.outputLimiter || APP.audio.masterGain;
            if (tapNode) tapNode.connect(freshDest);
            if (APP.audio.micRecGain) {
                try { APP.audio.micRecGain.connect(freshDest); } catch(e) {}
            }
            freshDest.stream.getAudioTracks().forEach(function(t) { combinedStream.addTrack(t); });
        }

        try { APP.nft.recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 50000000, audioBitsPerSecond: 128000 }); }
        catch(e) {
            try { APP.nft.recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp8,opus' }); }
            catch(e2) { APP.nft.recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' }); }
        }

        APP.nft.chunks = [];
        APP.nft.recorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) APP.nft.chunks.push(e.data); };
        APP.nft.recorder.onstop = finalizeNFT;

        APP.nft.recorder.start(1000);
        APP.nft.isRecording = true;
        APP.nft.startTime = Date.now();

        btn.textContent = '[ STOP_RECORDING ]';
        btn.classList.add('on');
        btn.style.color = '#ff3333';
        $('nft-hud').classList.add('active');
        updateNFTTimer();

        log('CAPTURE_VNGRD: START (' + combinedStream.getAudioTracks().length + ' audio_trk)');
    } catch (e) { log('CAPTURE_VNGRD_ERR: ' + e.message); btn.textContent = 'CAPTURE_VNGRD_CLIP'; }
}

function stopNFTRecording() {
    if (!APP.nft.isRecording) return;
    APP.nft.recorder.stop();
    APP.nft.isRecording = false;
    var btn = $('btn-nft-30');
    btn.textContent = 'CAPTURE_VNGRD_CLIP';
    btn.classList.remove('on');
    btn.style.color = '';
    $('nft-hud').classList.remove('active');
    log('VGD_REC_STOP');
}

// Called from mainLoop every frame
function updateNFTTimer() {
    if (!APP.nft.isRecording) return;
    const elapsed = Date.now() - APP.nft.startTime;
    const totalSeconds = Math.floor(elapsed / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    $('nft-timer').textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    $('nft-fill').style.width = `100%`;
}

// NFT HUD: draggable + dimmable
(function() {
    var hud, isDragging = false, ox = 0, oy = 0, pinned = false;
    var _dims = [1, 0.55, 0.25, 0.08]; var _dimIdx = 0;

    function _init() {
        hud = document.getElementById('nft-hud');
        if (!hud) return;
        hud.addEventListener('mousedown', function(e) {
            if (e.target.id === 'nft-dim-btn') return;
            isDragging = true;
            var r = hud.getBoundingClientRect();
            ox = e.clientX - r.left; oy = e.clientY - r.top;
            hud.classList.add('dragging');
        });
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            pinned = true;
            hud.style.left   = (e.clientX - ox) + 'px';
            hud.style.top    = (e.clientY - oy) + 'px';
            hud.style.bottom = 'auto';
            hud.style.transform = 'none';
        });
        document.addEventListener('mouseup', function() {
            isDragging = false;
            hud.classList.remove('dragging');
        });
        hud.addEventListener('touchstart', function(e) {
            if (e.target.id === 'nft-dim-btn') return;
            var t = e.touches[0]; var r = hud.getBoundingClientRect();
            ox = t.clientX - r.left; oy = t.clientY - r.top; isDragging = true;
        }, { passive: true });
        document.addEventListener('touchmove', function(e) {
            if (!isDragging) return;
            var t = e.touches[0]; pinned = true;
            hud.style.left = (t.clientX - ox) + 'px';
            hud.style.top  = (t.clientY - oy) + 'px';
            hud.style.bottom = 'auto'; hud.style.transform = 'none';
        }, { passive: true });
        document.addEventListener('touchend', function() { isDragging = false; });
    }

    window._nftHudDim = function() {
        _dimIdx = (_dimIdx + 1) % _dims.length;
        if (!hud) hud = document.getElementById('nft-hud');
        if (hud) hud.style.opacity = _dims[_dimIdx];
    };

    document.addEventListener('DOMContentLoaded', function() {
        _init();
        if (!hud) hud = document.getElementById('nft-hud');
        if (hud) {
            var observer = new MutationObserver(function(muts) {
                muts.forEach(function(m) {
                    if (m.attributeName === 'class' && hud.classList.contains('active') && !pinned) {
                        hud.style.opacity = '1'; _dimIdx = 0;
                    }
                });
            });
            observer.observe(hud, { attributes: true });
        }
    });
})();

function finalizeNFT() {
    const blob = new Blob(APP.nft.chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CAPTURE_VNGRD_${Date.now()}.webm`;
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
    APP.nft.chunks = [];
    log('VGD_EXPORTED');
}

function triggerIndustrialSnap(nextImageUrl) {
    const stage = document.getElementById('main-stage-img');
    if (!stage) return;
    stage.classList.remove('kinetic-shutter');
    void stage.offsetWidth;
    stage.classList.add('kinetic-shutter');
    setTimeout(() => {
        stage.src = nextImageUrl;
        log('SYSTEM: FRAME_CAPTURED');
    }, 200);
}
