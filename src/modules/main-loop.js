// ═══════════════════════════════════════════════════════════════
// MAIN LOOP MODULE — Central animation hub
// Migrated functions tick here instead of running their own rAF loops.
// startMainLoop() is guarded — boots exactly once from DOMContentLoaded.
// Extracted from main.js. Depends on: updateNFTTimer, updateVU,
// updateDucking (globals), window._inputLevelTick, window._audioReactorTick,
// window._vbRenderTick, window._vfxFrameTick (optional window hooks)
// ═══════════════════════════════════════════════════════════════

var _mainLoopRunning = false;

function mainLoop(timestamp) {
    requestAnimationFrame(mainLoop);

    // Phase B: NFT recording timer (was an unbounded rAF loop — now a pure tick)
    updateNFTTimer();

    // Phase C: audio input level meter (was an rAF loop that stacked on every input switch)
    if (window._inputLevelTick) window._inputLevelTick();

    // Phase E Task 1: VU meter (was its own rAF loop)
    updateVU();

    // Phase E Task 2: audio reactor (was its own rAF loop in a separate script block)
    if (window._audioReactorTick) window._audioReactorTick();

    // Phase F Task 1: WebGL VU bar shader (was _vbRender own rAF)
    if (window._vbRenderTick) window._vbRenderTick();

    // Phase F Task 2: VFXLayer chromatic aberration shader (was _frame IIFE rAF)
    if (window._vfxFrameTick) window._vfxFrameTick(timestamp);

    // Phase F Task 3: mic ducking monitor (was monitorDucking own rAF)
    updateDucking();
}

function startMainLoop() {
    if (_mainLoopRunning) return; // single-boot guard
    _mainLoopRunning = true;
    requestAnimationFrame(mainLoop);
}
