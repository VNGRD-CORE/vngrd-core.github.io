// ═══════════════════════════════════════════════════════════════
// AI IMAGE GENERATOR MODULE — Pollinations.AI cascade
// Extracted from main.js (was inside DOMContentLoaded).
// Depends on: $, APP, log, updateQueueDisplay (globals from main.js)
// ═══════════════════════════════════════════════════════════════

var _aiGenerating = false;

function _aiStatus(msg, color) {
    var el = $('ai-status');
    if (el) { el.textContent = msg; el.style.color = color || 'var(--text-dim)'; }
}

function _aiDone(btn) {
    _aiGenerating = false;
    if (btn) { btn.classList.remove('on'); btn.textContent = 'GENERATE'; }
}

function _aiInject(img, prompt) {
    var label = 'AI_' + prompt.substring(0, 20).replace(/\s+/g, '_');
    var preview = $('ai-preview');
    var previewImg = $('ai-preview-img');
    if (preview && previewImg) { previewImg.src = img.src; preview.style.display = 'block'; }
    var host = document.getElementById('gif-host');
    if (host && !img.parentNode) host.appendChild(img);
    APP.render.source = null;
    APP.media.queue.push({ type: 'image', url: img.src, element: img, name: label });
    APP.media.currentIndex = APP.media.queue.length - 1;
    APP.media.currentElement = img;
    if (typeof updateQueueDisplay === 'function') updateQueueDisplay();
    if ($('media-dot')) $('media-dot').classList.remove('off');
    var stage = $('stage');
    if (stage) {
        stage.style.transition = 'none';
        stage.style.filter = 'brightness(3) saturate(2)';
        setTimeout(function() { stage.style.transition = 'filter 0.5s'; stage.style.filter = ''; }, 100);
    }
    log('AI: INJECTED >> ' + label);
}

// fetch URL → blob URL → loaded HTMLImageElement
// Blob URL is same-origin, so drawImage() on canvas never taints it.
async function _aiLoadUrl(url, timeoutMs) {
    var controller = new AbortController();
    var tid = setTimeout(function() { controller.abort(); }, timeoutMs || 90000);
    try {
        var resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var blob = await resp.blob();
        var blobUrl = URL.createObjectURL(blob);
        return await new Promise(function(res, rej) {
            var img = new Image();
            img.onload = function() { res(img); };
            img.onerror = function() { URL.revokeObjectURL(blobUrl); rej(new Error('BLOB_DECODE_FAILED')); };
            img.src = blobUrl;
        });
    } finally {
        clearTimeout(tid);
    }
}

// Pollinations model map (real model names)
var _pollinationsModels = {
    'flux':           { model: 'flux',            extra: '' },
    'flux-anime':     { model: 'flux-anime',      extra: '' },
    'flux-3d':        { model: 'flux-3d',         extra: '' },
    'flux-cinematic': { model: 'flux-cinematic',  extra: '' },
    'gptimage':       { model: 'flux',            extra: ', fast, vivid' },
    'seedream':       { model: 'flux',            extra: ', dreamy, painterly, soft light' },
    'dirtberry':      { model: 'flux-realism',    extra: '' },
    'nanobanana':     { model: 'flux',            extra: ', vivid surreal colors' }
};

// Build Pollinations URL — minimal params, no invalid flags
function _polUrl(promptText, modelName) {
    var seed = Math.floor(Math.random() * 2147483647);
    return 'https://image.pollinations.ai/prompt/' +
        encodeURIComponent(promptText) +
        '?model=' + encodeURIComponent(modelName) +
        '&width=1024&height=1024&seed=' + seed +
        '&nologo=true';
}

// MAIN: try selected model → flux-realism → flux (bare)
async function aiGenerate(prompt) {
    if (!prompt) { _aiStatus('TYPE A PROMPT', 'var(--y)'); return; }
    if (_aiGenerating) return;
    _aiGenerating = true;

    var btn = document.getElementById('btn-generate-ai');
    if (btn) { btn.classList.add('on'); btn.textContent = 'GENERATING...'; }
    var neuralDot = document.getElementById('neural-dot');
    if (neuralDot) neuralDot.classList.remove('off');

    var modelSel = document.getElementById('ai-model-select');
    var key = (modelSel ? modelSel.value : 'flux') || 'flux';
    var mp = _pollinationsModels[key] || _pollinationsModels['flux'];
    var fullPrompt = prompt + (mp.extra ? ' ' + mp.extra : '');

    // Build fallback chain: chosen model → flux-realism → plain flux
    var tryCandidates = [
        { label: mp.model.toUpperCase(), url: _polUrl(fullPrompt, mp.model) },
        { label: 'FLUX-REALISM',         url: _polUrl(prompt, 'flux-realism') },
        { label: 'FLUX',                 url: _polUrl(prompt, 'flux') }
    ];
    // Deduplicate by model name
    var seenModels = {};
    var tries = tryCandidates.filter(function(t) {
        var m = t.label;
        if (seenModels[m]) return false;
        seenModels[m] = true; return true;
    });

    var lastErr = null;
    for (var i = 0; i < tries.length; i++) {
        try {
            _aiStatus('GENERATING [' + tries[i].label + ']...', 'var(--v)');
            log('AI: [POLLINATIONS/' + tries[i].label + '] >> ' + fullPrompt);
            var img = await _aiLoadUrl(tries[i].url, 90000);
            _aiInject(img, prompt);
            _aiDone(btn);
            _aiStatus('DONE [' + tries[i].label + ']', 'var(--g)');
            return;
        } catch(e) {
            lastErr = e;
            log('AI: ' + tries[i].label + ' FAIL: ' + e.message);
            if (i < tries.length - 1) _aiStatus('RETRYING...', 'var(--y)');
        }
    }

    _aiDone(btn);
    _aiStatus('FAIL: ' + (lastErr ? lastErr.message : 'unknown'), 'var(--r)');
    log('AI: ALL ATTEMPTS EXHAUSTED');
}

window.aiGenerate = aiGenerate;
