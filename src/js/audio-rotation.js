// Auto-advance when song ends — delegate to audio-chain.js nextTrack()
document.getElementById('audio-el').addEventListener('ended', () => {
    if (typeof nextTrack === 'function') nextTrack();
});


// --- AUDIO DUCKING & UI CONTROLS ---

// MASTER DUCKING FUNCTION
const applyAudioDuck = (isActive) => {
    // Priority: Ducking Gain Node -> Master Gain Node
    const gainNode = (APP.audio && APP.audio.duckingGain) ? APP.audio.duckingGain : (APP.audio && APP.audio.masterGain ? APP.audio.masterGain : null);

    if (gainNode) {
        const now = APP.audio.ctx ? APP.audio.ctx.currentTime : 0;
        const targetValue = isActive ? 0.25 : 1.0; // -12dB dip for broadcast

        // Professional fade (50ms) to avoid "pops" in the 15Mbps recording
        gainNode.gain.setTargetAtTime(targetValue, now, 0.05);
        console.log(isActive ? "CORE: BROADCAST_DUCKING_ON" : "CORE: BROADCAST_DUCKING_OFF");
    }
    if (typeof log === 'function') log(isActive ? 'DUCKING: ACTIVE [-12dB]' : 'DUCKING: RESTORED [0dB]');
};
// Expose globally so goLive/endLive/killCamera in the main script can call it
window.applyAudioDuck = applyAudioDuck;

// 1. FORCE INJECT COLORS
const style = document.createElement('style');
style.innerHTML = `
  .tick-up { color: #00ff00 !important; font-weight: bold; text-shadow: 0 0 5px #00ff00; }
  .tick-down { color: #ff0000 !important; font-weight: bold; text-shadow: 0 0 5px #ff0000; }
`;
document.head.appendChild(style);

// 2. FORCE REFRESH TICKER WITH COLORS
async function updateTickerLive() {
    try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
        const data = await res.json();
        const price = parseFloat(data.lastPrice).toFixed(2);
        const change = parseFloat(data.priceChangePercent);
        const colorClass = change >= 0 ? 'tick-up' : 'tick-down';
        const arrow = change >= 0 ? '▲' : '▼';

        const ticker = document.getElementById('ticker-text');
        if (ticker) {
            ticker.innerHTML = `BTC: $${price} <span class="${colorClass}">(${arrow}${change}%)</span> // [SIGNAL_STABLE]`;
        }
    } catch (e) {
        console.error("Ticker update failed", e);
    }
}

// Initial triggers
updateTickerLive();
setInterval(updateTickerLive, 600000); // 10 minute poll to save CPU

// Ducking is called via window.applyAudioDuck() from goLive/endLive/killCamera in main script

// --- TACTICAL FX GLOBAL BRIDGE ---
// --- CANVAS FX FILTER MAP (mirrors CSS FX for captureStream baking) ---
function _getBakedFXFilter() {
    var cl = document.body.classList;
    if (cl.contains('fx-scan'))  return 'invert(1) contrast(1.5)';
    if (cl.contains('fx-nvg'))   return 'grayscale(1) brightness(0.7)';
    if (cl.contains('fx-void'))  return 'grayscale(1) contrast(3) brightness(1.1)';
    if (cl.contains('fx-lucy'))  return 'hue-rotate(180deg) saturate(2.5)';
    if (cl.contains('fx-tear'))  return 'hue-rotate(90deg) contrast(1.2)';
    if (cl.contains('fx-punch')) return 'contrast(1.4) brightness(1.2)';
    if (cl.contains('vhs'))      return 'contrast(1.1) brightness(0.95) saturate(1.2)';
    return '';
}

// --- TACTICAL FX MASTER BRIDGE (v4.1 VOID/LUCY) ---
window.toggleFX = function(fxName) {
    // Auto-disable during P2P: FX shaders stress the GPU and inflate WebRTC bandwidth
    if (APP.peer && APP.peer.call) { log('FX_BLOCKED: P2P active'); return; }
    const target = document.body;
    const className = `fx-${fxName}`;
    const allFX = ['fx-scan', 'fx-tear', 'fx-punch', 'fx-void', 'fx-lucy', 'fx-nvg'];

    // One-shot durations (ms); 0 = persistent toggle
    const autoOff = { void: 2500, lucy: 5000 };

    // Find the specific button to "light it up" (by id first, then onclick attr)
    const btn = document.getElementById('btn-' + fxName) ||
        Array.from(document.querySelectorAll('.btn')).find(b =>
            b.getAttribute('onclick')?.includes(`'${fxName}'`)
        );

    if (target.classList.contains(className)) {
        // TURN OFF
        target.classList.remove(className);
        if (btn) btn.classList.remove('active-fx');
        // NVG: restore button to base inline style so it doesn't look broken
        if (fxName === 'nvg' && btn) { btn.style.background = ''; btn.style.filter = ''; btn.style.textShadow = '0 0 5px #00ff41'; }
        log(`FX_OFF: ${fxName.toUpperCase()}`);
    } else {
        // TURN ON (Clears existing tactical FX first for a clean state)
        target.classList.remove(...allFX);
        document.querySelectorAll('.btn').forEach(b => { b.classList.remove('active-fx'); if (b.id === 'btn-nvg') { b.style.background = ''; b.style.filter = ''; } });

        target.classList.add(className);
        if (btn) btn.classList.add('active-fx');
        // NVG: direct inline glow — belt-and-suspenders on top of CSS rule
        if (fxName === 'nvg' && btn) { btn.style.background = 'rgba(0,255,65,0.30)'; btn.style.filter = 'drop-shadow(0 0 8px #00ff41) drop-shadow(0 0 18px rgba(0,255,65,0.5))'; btn.style.textShadow = '0 0 8px #00ff41, 0 0 18px #00ff41'; }
        log(`FX_ON: ${fxName.toUpperCase()}`);

        // Auto-off for one-shot effects
        if (autoOff[fxName]) {
            setTimeout(() => {
                target.classList.remove(className);
                if (btn) btn.classList.remove('active-fx');
                log(`FX_AUTO_OFF: ${fxName.toUpperCase()}`);
            }, autoOff[fxName]);
        }
    }
};

window.triggerHardReset = function() {
    const target = document.body;

    // 1. Kill every FX class — CSS tactical + animated
    target.classList.remove(
        'fx-scan', 'fx-tear', 'fx-punch', 'fx-void', 'fx-lucy', 'fx-nvg',
        'fx-signal-loss', 'fx-thermal', 'fx-cyber-rot', 'fx-neural', 'fx-failure',
        'vhs', 'crt', 'system-failure', 'seismic-active', 'punch-hit'
    );

    // 2. Wipe all button lit states (both naming conventions)
    document.querySelectorAll('.btn').forEach(b => b.classList.remove('active-fx', 'on'));

    // 3. Reset APP flags — IMPACT_RACK + VJ defaults + autonomous modes
    if (typeof resetAllFX === 'function') resetAllFX();
    APP.vj.rumbleEnabled = false;
    APP.vj.uiReactivity = false;
    window._punchCooldown = false;

    // 4. Clear inline styles written by the engine (seismic + party mode)
    target.style.transform = '';
    target.style.boxShadow = '';

    // 5. Smooth flash — bright spike → black → restore (no scale/split)
    target.classList.remove('anim-hard-reset');
    void target.offsetWidth;
    target.classList.add('anim-hard-reset');
    setTimeout(() => target.classList.remove('anim-hard-reset'), 600);

    if (typeof ghostLog === 'function') ghostLog('SYSTEM_HARD_RESET_EXECUTED', 'crit');
};
