// ═══════════════════════════════════════════════════════════════
// UI UTILS MODULE — Themes, FX toggles, clock, fullscreen, reset
// Extracted from main.js. Depends on: $, APP, log (globals from main.js)
// ═══════════════════════════════════════════════════════════════

function setTheme(theme) { const structClass = ['theme-broadcast','theme-ethereal'].find(c => document.body.classList.contains(c)) || null; document.body.className = document.body.className.replace(/theme-\w+/g, '').replace('system-failure', ''); if (theme !== 'cyan') document.body.classList.add(`theme-${theme}`); if (structClass) document.body.classList.add(structClass); APP.state.theme = theme; document.querySelectorAll('.pal').forEach(p => p.classList.toggle('on', p.dataset.t === theme)); log(`THEME: ${theme}`); }

(function() {
  const STRUCT_THEMES = ['', 'theme-broadcast', 'theme-ethereal'];
  let _structIdx = 0;
  window.cycleStructuralTheme = function() {
    document.body.classList.remove('theme-broadcast', 'theme-ethereal');
    _structIdx = (_structIdx + 1) % STRUCT_THEMES.length;
    if (STRUCT_THEMES[_structIdx]) {
      document.body.classList.add(STRUCT_THEMES[_structIdx]);
    }
    const names = ['CYBER_CORE', 'BROADCAST_PRO', 'ETHEREAL_MINIMAL'];
    if (window.ghostLog) window.ghostLog('THEME > ' + names[_structIdx], 'ai');
    if (typeof updateTickerCycle === 'function') updateTickerCycle();
  };
})();


function toggleVHS() { if (APP.peer && APP.peer.call) { log('FX_BLOCKED: P2P active'); return; } document.body.classList.toggle('vhs'); $('btn-vhs').classList.toggle('on'); log('VHS'); }
function toggleCRT() { document.body.classList.toggle('crt'); $('btn-crt').classList.toggle('on'); log('CRT'); }
function toggleFullscreen() {
    APP.state.isFullscreen = !APP.state.isFullscreen;
    document.body.classList.toggle('fullscreen', APP.state.isFullscreen);
    var hint = document.getElementById('fs-hint');
    if (hint && APP.state.isFullscreen) {
        hint.style.opacity = '0.55';
    }
    log('FULLSCREEN');
}

function toggleSystemSlide() {
    var isSlid = document.body.classList.toggle('system-slide');
    APP.state.systemSlide = isSlid;
    var tabHint = document.querySelector('.kb-hint');
    if (tabHint) { tabHint.style.opacity = '0.85'; setTimeout(() => { tabHint.style.opacity = '0.38'; }, 1800); }
    if (typeof resizeCanvas === 'function') {
        setTimeout(function() {
            APP.render.width = APP.render.canvas.parentElement.clientWidth;
            APP.render.height = APP.render.canvas.parentElement.clientHeight;
            resizeCanvas();
        }, 520);
    }
    log(isSlid ? 'SYSTEM_SLIDE: PANELS_OUT' : 'SYSTEM_SLIDE: PANELS_IN');
}

function morphLogo() {
    const logo = $('main-logo'); APP.ui.morphs.forEach(m => logo.classList.remove(m)); APP.ui.logoMorph = (APP.ui.logoMorph + 1) % APP.ui.morphs.length; logo.classList.add(APP.ui.morphs[APP.ui.logoMorph]);
}

function updateClock() { $('clock').textContent = new Date().toTimeString().split(' ')[0]; const s = Math.floor((Date.now() - APP.state.startTime) / 1000); $('uptime').textContent = `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

// EMERGENCY
$('btn-panic').onclick = panicReset;
$('btn-clear-deck').onclick = clearDeck;
$('btn-eject').onclick = ejectCurrent;

// SYSTEM FAILURE MODE - Timed chaos sequence that auto-stops (5 seconds)
$('btn-psychosis').onclick = () => {
    if (APP.state.psychosis) return;

    APP.state.psychosis = true;
    document.body.classList.add('system-failure');
    $('btn-psychosis').classList.add('active-mode');
    log('CRITICAL: SYSTEM FAILURE DETECTED');

    const origRGB = APP.vj.rgbEnabled;
    const origRGBIntensity = APP.vj.rgbIntensity;
    const origPixelate = APP.vj.pixelateEnabled;
    const origPixelSize = APP.vj.pixelSize;
    const origHue = APP.vj.hue;
    const origTrails = APP.vj.trailsEnabled;
    const origTrailAlpha = APP.vj.trailAlpha;

    let tick = 0;
    const totalTicks = 100;

    const chaos = setInterval(() => {
        tick++;

        if (tick <= 35) {
            APP.vj.hue = (tick * 10) % 360;
            APP.vj.rgbEnabled = true;
            APP.vj.rgbIntensity = 5 + Math.floor(Math.random() * 12);
        }
        else if (tick <= 70) {
            APP.vj.pixelateEnabled = tick % 3 !== 0;
            APP.vj.pixelSize = 2 + Math.floor(Math.random() * 8);
            APP.vj.trailsEnabled = true;
            APP.vj.trailAlpha = 0.65 + Math.random() * 0.25;
            const wobbleX = Math.sin(tick * 0.4) * 10;
            const wobbleY = Math.cos(tick * 0.5) * 8;
            document.body.style.transform = `translate(${wobbleX}px, ${wobbleY}px)`;
        }
        else {
            APP.vj.rgbIntensity = Math.max(0, APP.vj.rgbIntensity - 0.8);
            APP.vj.pixelSize = Math.max(1, APP.vj.pixelSize - 0.3);
            if (tick % 5 === 0) APP.vj.invert = !APP.vj.invert;
            if (tick > 85) document.body.style.transform = '';
        }

        if (tick >= totalTicks) {
            clearInterval(chaos);

            APP.vj.rgbEnabled = origRGB;
            APP.vj.rgbIntensity = origRGBIntensity;
            APP.vj.pixelateEnabled = origPixelate;
            APP.vj.pixelSize = origPixelSize;
            APP.vj.hue = origHue;
            APP.vj.trailsEnabled = origTrails;
            APP.vj.trailAlpha = origTrailAlpha;
            APP.vj.invert = false;
            document.body.style.transform = '';

            APP.state.psychosis = false;
            document.body.classList.remove('system-failure');
            $('btn-psychosis').classList.remove('active-mode');
            log('SYSTEM RESTORED');
        }
    }, 50);
};

// RESET ALL FX — clears IMPACT_RACK flags + restores VJ defaults
function resetAllFX() {
    APP.fx.stutter = false; APP.fx.crush = false; APP.fx.invert = false;
    APP.fx.echo = false; APP.fx.rgbSplit = 0; APP.fx.freezeFrame = null;
    APP.vj.brightness = 1.0; APP.vj.contrast = 1.0; APP.vj.saturation = 1.0; APP.vj.hue = 0;
    APP.vj.trailsEnabled = false; APP.vj.trailAlpha = 0.92;
    APP.vj.rgbEnabled = false; APP.vj.rgbIntensity = 0;
    APP.vj.pixelateEnabled = false; APP.vj.pixelSize = 1;
    APP.vj.invert = false; APP.vj.maskMode = false;
    document.querySelectorAll('.btn.on').forEach(el => el.classList.remove('on'));
    document.body.classList.remove('vhs', 'crt', 'system-failure');
    log('FX_RESET: ALL_CLEAR');
}

// PRO_FX: btn-reset delegates to resetAllFX (safe — no slider refs)
if ($('btn-reset')) $('btn-reset').onclick = resetAllFX;
