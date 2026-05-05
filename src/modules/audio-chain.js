// ═══════════════════════════════════════════════════════════════
// AUDIO CHAIN MODULE — File loading, playback controls, DAW chain,
// spatial audio modes, VU meter
// Extracted from main.js. Depends on: $, APP, log (globals)
// ═══════════════════════════════════════════════════════════════

// AUDIO ENGINEER IMPLEMENTATION
APP.audio.element = $('audio-el');

function loadAudioFiles(input) { Array.from(input.files).forEach(file => { APP.audio.playlist.push({ url: URL.createObjectURL(file), name: file.name.replace(/\.[^.]+$/, '') }); }); $('audio-dot').classList.remove('off'); if (APP.audio.element.paused && APP.audio.playlist.length) { playTrack(APP.audio.currentTrack >= 0 ? APP.audio.currentTrack : 0); } log(`AUDIO: +${input.files.length}`); }

function playTrack(idx) {
    if (!APP.audio.playlist.length) return;
    if (idx !== undefined) APP.audio.currentTrack = idx;
    else if (APP.audio.currentTrack === -1) APP.audio.currentTrack = 0;
    const track = APP.audio.playlist[APP.audio.currentTrack];
    APP.audio.currentTrackName = track.name;
    APP.audio.element.src = track.url;
    if (!APP.audio.ctx) APP.audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    APP.audio.element.play().then(() => {
        APP.audio.isPlaying = true;
        $('track-info').textContent = track.name.toUpperCase();
        if (APP.lowerThird.visible && APP.lowerThird.mode === 'track') $('lt-title-text').textContent = track.name;
        log(`PLAY: ${track.name}`);
        updatePlayIcon();
    });
    if (!APP.audio.isConnected) setupAudioChain();
}

function nextTrack() {
    if (!APP.audio.playlist.length) return;
    APP.audio.currentTrack = (APP.audio.currentTrack + 1) % APP.audio.playlist.length;
    playTrack(APP.audio.currentTrack);
}

function prevTrack() {
    if (!APP.audio.playlist.length) return;
    APP.audio.currentTrack = (APP.audio.currentTrack - 1 + APP.audio.playlist.length) % APP.audio.playlist.length;
    playTrack(APP.audio.currentTrack);
}

function togglePlayPause() {
    if (!APP.audio.playlist.length) return;
    if (APP.audio.element.paused) {
        if (APP.audio.element.src) APP.audio.element.play();
        else playTrack();
    } else {
        APP.audio.element.pause();
    }
    APP.audio.isPlaying = !APP.audio.element.paused;
    updatePlayIcon();
}

function updatePlayIcon() {
    const icon = $('icon-play-state');
    if(APP.audio.isPlaying) {
        icon.innerHTML = '<path fill="currentColor" d="M3 2h2v8H3zm4 0h2v8H7z"/>';
    } else {
        icon.innerHTML = '<path fill="currentColor" d="M3 2v8l7-4z"/>';
    }
}

function setupAudioChain() {
    const ctx = APP.audio.ctx;
    if (APP.audio.outputLimiter) {
        try { APP.audio.outputLimiter.disconnect(); } catch(_) {}
    }
    if (APP.audio.source) APP.audio.source.disconnect();
    APP.audio.source = ctx.createMediaElementSource(APP.audio.element);
    APP.audio.analyzer = ctx.createAnalyser();
    APP.audio.analyzer.fftSize = 64;
    APP.audio.analyzer.smoothingTimeConstant = 0.6;
    APP.audio.masterGain = ctx.createGain();
    APP.audio.masterGain.gain.value = 0.9;
    APP.audio.panner = ctx.createPanner();
    APP.audio.panner.panningModel = 'HRTF';
    APP.audio.panner.distanceModel = 'inverse';
    APP.audio.lowShelf = ctx.createBiquadFilter();
    APP.audio.lowShelf.type = "lowshelf";
    APP.audio.lowShelf.frequency.value = 60;
    APP.audio.lowShelf.gain.value = 0;
    APP.audio.highShelf = ctx.createBiquadFilter();
    APP.audio.highShelf.type = "highshelf";
    APP.audio.highShelf.frequency.value = 12000;
    APP.audio.highShelf.gain.value = 0;
    APP.audio.compressor = ctx.createDynamicsCompressor();
    APP.audio.compressor.threshold.value = -24;
    APP.audio.compressor.knee.value = 30;
    APP.audio.compressor.ratio.value = 1;
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
    APP.audio.dolbyPanner.panningModel = 'HRTF';
    APP.audio.dolbyPanner.distanceModel = 'inverse';
    APP.audio.dolbyPanner.refDistance = 1;
    if (APP.audio.dolbyPanner.positionX) {
        APP.audio.dolbyPanner.positionX.setValueAtTime(0, ctx.currentTime);
        APP.audio.dolbyPanner.positionY.setValueAtTime(5, ctx.currentTime);
        APP.audio.dolbyPanner.positionZ.setValueAtTime(-2, ctx.currentTime);
    }
    try {
        APP.audio.surroundSplitter = ctx.createChannelSplitter(6);
        APP.audio.surroundMerger = ctx.createChannelMerger(6);
    } catch(e) {}
    APP.audio.micAnalyzer = ctx.createAnalyser();
    APP.audio.micAnalyzer.fftSize = 256;
    _padBusNode = null;
    APP.audio.source
        .connect(APP.audio.panner)
        .connect(APP.audio.lowShelf)
        .connect(APP.audio.highShelf)
        .connect(APP.audio.compressor)
        .connect(APP.audio.duckingGain)
        .connect(APP.audio.analyzer)
        .connect(APP.audio.masterGain)
        .connect(APP.audio.outputLimiter)
        .connect(ctx.destination);
    APP.audio.masterGain.connect(APP.audio.stereoGain);
    APP.audio.source.connect(APP.audio.dolbyPanner);
    APP.audio.dolbyPanner.connect(APP.audio.outputLimiter);
    APP.audio.videoGain = ctx.createGain();
    APP.audio.videoGain.gain.value = APP.audio.videoMuted ? 0 : 1;
    APP.audio.videoGain.connect(APP.audio.panner);
    APP.audio.videoGain.connect(APP.audio.dolbyPanner);
    APP.audio.recorderDest = ctx.createMediaStreamDestination();
    APP.audio.masterGain.connect(APP.audio.recorderDest);
    if (APP.audio.micGainNode) {
        try { APP.audio.micGainNode.connect(APP.audio.recorderDest); } catch(e) {}
    }
    APP.audio.vuData = new Uint8Array(APP.audio.analyzer.frequencyBinCount);
    APP.audio.isConnected = true;
    if (APP.audio.livePreAmp) {
        try { APP.audio.livePreAmp.disconnect(); } catch(_) {}
        APP.audio.livePreAmp.connect(APP.audio.panner);
        if (APP.inputDevices && APP.inputDevices.analyzer) {
            APP.audio.livePreAmp.connect(APP.inputDevices.analyzer);
        }
    }
    log('DAW_ENGINE: TRIPLE_PATH + LIMITER + DUCKING');
    updateVU();
}

function setAudioMode(mode) {
    if(!APP.audio.ctx) return;
    const now = APP.audio.ctx.currentTime;
    clearInterval(APP.audio.spatialInterval);
    APP.audio.panner.positionX.value = 0;
    APP.audio.panner.positionZ.value = 0;
    APP.audio.lowShelf.gain.setTargetAtTime(0, now, 0.1);
    APP.audio.highShelf.gain.setTargetAtTime(0, now, 0.1);
    APP.audio.compressor.ratio.setTargetAtTime(1, now, 0.1);
    if (mode === 'stereo') { log('AUDIO: PURE STEREO'); }
    else if (mode === 'spatial') {
        log('AUDIO: 3D ROTATION');
        let angle = 0;
        APP.audio.spatialInterval = setInterval(() => {
            angle += 0.02;
            APP.audio.panner.positionX.value = Math.sin(angle);
            APP.audio.panner.positionZ.value = Math.cos(angle);
        }, 16);
    }
    else if (mode === 'dolby') {
        log('AUDIO: DOLBY CINEMA DSP');
        APP.audio.lowShelf.gain.setTargetAtTime(4, now, 0.1);
        APP.audio.highShelf.gain.setTargetAtTime(4, now, 0.1);
        APP.audio.compressor.ratio.setTargetAtTime(12, now, 0.1);
        APP.audio.compressor.threshold.setTargetAtTime(-30, now, 0.1);
        APP.audio.compressor.attack.setTargetAtTime(0.003, now, 0.1);
    }
    APP.audio.spatialMode = mode;
    ['stereo', 'spatial', 'dolby'].forEach(m => {
        const btn = $(`btn-${m}`);
        if(m === mode) btn.classList.add('active-mode');
        else btn.classList.remove('active-mode');
    });
}

// Called from mainLoop every frame
function updateVU() {
    if (!APP.audio.analyzer || (!APP.audio.isPlaying && !APP.audio.videoSource && !APP.audio.sfxPlaying)) return;
    APP.audio.analyzer.getByteFrequencyData(APP.audio.vuData);
    const bars = $('vu').children;
    if(bars.length === 0) { const vu = $('vu'); for (let i = 0; i < 16; i++) { const bar = document.createElement('div'); bar.className = 'vu-bar'; vu.appendChild(bar); } }
    for (let i = 0; i < bars.length; i++) bars[i].style.height = Math.max(2, (APP.audio.vuData[i * 2] / 255) * 28) + 'px';
    const bass = (APP.audio.vuData[0] + APP.audio.vuData[1]) / 2;
    APP.audio.bassLevel = bass;
    if(APP.vj.uiReactivity && bass > 200) {
        document.body.style.boxShadow = `inset 0 0 ${bass/2}px var(--accent)`;
    } else if (APP.vj.uiReactivity) {
        document.body.style.boxShadow = 'none';
    }
}
