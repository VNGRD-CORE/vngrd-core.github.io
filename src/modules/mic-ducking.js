// ═══════════════════════════════════════════════════════════════
// MIC DUCKING MODULE — side-chain ducking engine for mic input
// Extracted from main.js. Depends on: APP (globals from main.js)
// updateDucking() is called from mainLoop every frame.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: SIDE-CHAIN DUCKING ENGINE
// ═══════════════════════════════════════════════════════════════════════════
function initMicDucking(micStream) {
    if (!APP.audio.ctx || !micStream) return;
    try {
        APP.audio.micSource = APP.audio.ctx.createMediaStreamSource(micStream);
        APP.audio.micSource.connect(APP.audio.micAnalyzer);
        APP.audio.duckingActive = true;
        // ── PHASE F: mainLoop drives updateDucking() — no explicit boot needed ──
        log('DUCKING: ARMED_-20dB');
    } catch (e) { log('DUCKING_ERR: ' + e.message); }
}

// ── PHASE F Task 3: own rAF removed — called from mainLoop every frame ──
var _duckingBuf = null;

function updateDucking() {
    if (!APP.audio.duckingActive || !APP.audio.micAnalyzer) return;
    // Reallocate only if analyzer size changed (e.g. after mic reinit); normally reuses same buffer
    var _needed = APP.audio.micAnalyzer.frequencyBinCount;
    if (!_duckingBuf || _duckingBuf.length !== _needed) _duckingBuf = new Float32Array(_needed);
    APP.audio.micAnalyzer.getFloatTimeDomainData(_duckingBuf);
    let sum = 0;
    for (let i = 0; i < _duckingBuf.length; i++) sum += _duckingBuf[i] * _duckingBuf[i];
    const db = 20 * Math.log10(Math.max(Math.sqrt(sum / _duckingBuf.length), 1e-10));
    const now = APP.audio.ctx.currentTime;
    // setTargetAtTime: exponential approach = zero pops/clicks in 15Mbps recording
    if (db > -20) {
        // APP.audio.duckingGain.gain.setTargetAtTime(0.25, now, 0.05);
    } else {
        // APP.audio.duckingGain.gain.setTargetAtTime(1.0, now, 0.15);
    }
}

