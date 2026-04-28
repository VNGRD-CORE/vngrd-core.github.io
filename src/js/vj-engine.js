// --- BASS REACTIVE VJ ENGINE ---
// ── PHASE E Task 2: state lifted out of initAudioReactor so the tick runs via mainLoop ──
var _arAnalyzer      = null;
var _arData          = null;
var _arLastPunchTime = 0;
var _arCooldown      = 300;   // ms — minimum gap between punch triggers
var _arBassThreshold = 210;   // 0-255 threshold for a kick hit

// Pure tick — called from mainLoop every frame.
// initAudioReactor() must have run first to populate _arAnalyzer/_arData.
function updateAudioReactor() {
    if (!window.audioReactorActive || !_arAnalyzer || !_arData) return;

    _arAnalyzer.getByteFrequencyData(_arData);

    // Average the lowest 8 bins (sub-bass / kick drum)
    let bassSum = 0;
    for (let i = 0; i < 8; i++) bassSum += _arData[i];
    const bassAvg = bassSum / 8;

    const now = Date.now();
    if (bassAvg > _arBassThreshold && (now - _arLastPunchTime > _arCooldown)) {
        const stage = document.getElementById('stage');
        if (stage) {
            stage.style.animation = 'none';
            void stage.offsetWidth; // force reflow to restart animation
            stage.style.animation = 'kinetic-punch 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
        }
        _arLastPunchTime = now;
    }
}
// Expose so mainLoop (in the main script block) can call it
window._audioReactorTick = updateAudioReactor;

window.initAudioReactor = function() {
    if (window.audioReactorActive) {
        console.log("[SYS] REACTOR: ALREADY RUNNING");
        return;
    }

    // Ensure we have an active audio analyzer
    if (!window.APP || !window.APP.audio || !window.APP.audio.analyzer) {
        console.warn("[SYS] REACTOR: WAITING FOR AUDIO ENGINE...");
        setTimeout(window.initAudioReactor, 2000);
        return;
    }

    console.log("[SYS] REACTOR: BASS SYNC ONLINE");
    window.audioReactorActive = true;

    // Store references so updateAudioReactor() can reach them each frame
    _arAnalyzer = window.APP.audio.analyzer;
    _arData     = new Uint8Array(_arAnalyzer.frequencyBinCount);
    // Tick is already registered as window._audioReactorTick — mainLoop drives it
};

// Auto-init the bass reactor engine when audio is ready
setTimeout(() => { if (!window.audioReactorActive) window.initAudioReactor(); }, 3000);
