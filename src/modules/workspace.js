// ═══════════════════════════════════════════════════════════════
// WORKSPACE / IPFS MODULE — Session persistence, IPFS export/import
// Extracted from main.js. Depends on: $, APP, log, setTheme (globals)
// ═══════════════════════════════════════════════════════════════

// Internal: build the same session snapshot that SAVE_SESSION uses
function _buildSessionSnapshot() {
    var logo64 = null;
    var logoEl = $('user-logo-layer');
    if (logoEl && logoEl.src && logoEl.src !== window.location.href && logoEl.naturalWidth > 0) {
        try {
            var tmpC = document.createElement('canvas');
            tmpC.width = logoEl.naturalWidth; tmpC.height = logoEl.naturalHeight;
            tmpC.getContext('2d').drawImage(logoEl, 0, 0);
            logo64 = tmpC.toDataURL('image/png');
        } catch(e) {}
    }
    var ltTitleEl = $('lt-title-text'), ltSubEl = $('lt-subtitle-text');
    return {
        vj: APP.vj,
        theme: APP.state.theme,
        bug: APP.bug.text,
        layers: APP.layers,
        logo2d: logo64,
        lowerThird: {
            title:   (ltTitleEl && ltTitleEl.textContent) || '',
            subtitle:(ltSubEl   && ltSubEl.textContent)   || '',
            preset:  APP.lowerThird.preset,
            visible: APP.lowerThird.visible
        },
        timestamp: Date.now()
    };
}

// Internal: apply a session snapshot (shared with VGD import logic)
function _applySessionSnapshot(s) {
    if (s.theme)  setTheme(s.theme);
    if (s.bug)    { APP.bug.text = s.bug; $('bug-text').value = s.bug; $('station-bug').textContent = s.bug; }
    if (s.vj)     { APP.vj = { ...APP.vj, ...s.vj }; }
    if (s.layers) {
        APP.layers = { ...APP.layers, ...s.layers };
        APP.trinity.logo.scale = APP.layers.logoScale || 1.0;
        APP.trinity.bug.scale  = APP.layers.bugScale  || 1.5;
    }
    if (s.logo2d) {
        var logoLayer = $('user-logo-layer');
        if (logoLayer) { logoLayer.src = s.logo2d; logoLayer.style.display = 'block'; APP.trinity.logo.visible = true; }
    }
    if (s.lowerThird) {
        if (s.lowerThird.title    && $('lt-title-text')) $('lt-title-text').textContent = s.lowerThird.title;
        if (s.lowerThird.subtitle && $('lt-subtitle-text')) $('lt-subtitle-text').textContent = s.lowerThird.subtitle;
        if (s.lowerThird.title    && $('lt-title'))     $('lt-title').value    = s.lowerThird.title;
        if (s.lowerThird.subtitle && $('lt-sub'))       $('lt-sub').value      = s.lowerThird.subtitle;
        if (s.lowerThird.preset)  APP.lowerThird.preset  = s.lowerThird.preset;
        APP.lowerThird.visible = !!s.lowerThird.visible;
    }
    if ($('sl-b')) $('sl-b').value = Math.round(APP.vj.brightness * 100);
    if ($('sl-c')) $('sl-c').value = Math.round(APP.vj.contrast  * 100);
    if ($('sl-s')) $('sl-s').value = Math.round(APP.vj.saturation * 100);
    if ($('sl-h')) $('sl-h').value = APP.vj.hue;
}

// localStorage key scoped to wallet address (Web3 identity preserved)
function _localKey(address) {
    return 'VNGRD_SESSION_' + address.toLowerCase();
}

// Convert a data URL to a Blob without fetch() — works in all browsers including Safari
function _dataURLtoBlob(dataURL) {
    var parts = dataURL.split(',');
    var mime  = parts[0].match(/:(.*?);/)[1];
    var bstr  = atob(parts[1]);
    var n     = bstr.length;
    var u8    = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
}

// ── WALLET SYNC HUD helpers ──
function _showIpfsSyncIndicator(syncing, success) {
    var hud   = document.getElementById('wallet-sync-hud');
    var label = document.getElementById('ipfs-sync-label');
    if (!hud) return;
    hud.classList.remove('syncing', 'synced', 'error', 'visible');
    if (syncing) {
        hud.classList.add('visible', 'syncing');
        if (label) label.textContent = 'IPFS SYNC…';
    } else if (success === true) {
        hud.classList.add('visible', 'synced');
        if (label) label.textContent = 'IPFS SYNCED';
    } else {
        hud.classList.add('visible', 'error');
        if (label) label.textContent = 'SYNC FAILED';
    }
}

function _showWalletSaveThumbnail(dataURL, cid) {
    var thumb = document.getElementById('wallet-sync-thumbnail');
    var img   = document.getElementById('wallet-sync-snapshot');
    var cidEl = document.getElementById('wallet-sync-cid');
    if (thumb && img && dataURL) {
        img.src = dataURL;
        thumb.classList.add('visible');
    }
    if (cidEl && cid) {
        cidEl.textContent = 'CID: ' + cid;
        cidEl.classList.add('visible');
    }
}

// ── SAVE session to IPFS via Pinata (directory-wrapped) + bind to wallet via puter.kv ──
window.saveSessionToCloud = async function() {
    if (!APP.wallet.connected || !APP.wallet.address) {
        log('WALLET_SAVE: WALLET_NOT_CONNECTED'); alert('Connect your wallet first.'); return;
    }

    var address = APP.wallet.address;
    var jwt = localStorage.getItem('pinata_jwt');
    if (!jwt) {
        var raw = prompt('PINATA JWT TOKEN (stored locally):');
        if (!raw) { log('WALLET_SAVE: NO_JWT'); return; }
        jwt = raw.trim();
        localStorage.setItem('pinata_jwt', jwt);
    }

    // Step 1 — Capture WebGL canvas snapshot SYNCHRONOUSLY before any async work
    var vjCanvas = document.getElementById('vj-canvas');
    var snapshotDataURL = null;
    try {
        if (vjCanvas) snapshotDataURL = vjCanvas.toDataURL('image/jpeg', 0.85);
    } catch(e) { log('WALLET_SAVE: SNAPSHOT_WARN ' + e.message); }

    _showIpfsSyncIndicator(true);
    log('WALLET_SAVE: ASYNC_UPLOAD_STARTED for ' + address.slice(0, 6) + '...');

    // Detach from call stack via Promise.resolve() so the render loop is never stalled
    Promise.resolve().then(async function() {
        var _step = 'INIT';
        try {
            _step = 'BUILD_FORM';
            var form = new FormData();
            var DIR  = 'VNGRD/';

            // 2a. Session state JSON manifest
            var snap = _buildSessionSnapshot();
            snap._type    = 'VNGRD_WALLET_PAYLOAD';
            snap._version = 'V35_WALLET';
            snap._wallet  = address;
            form.append('file', new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' }), DIR + 'session.json');

            // 2b. WebGL snapshot
            _step = 'SNAPSHOT_ENCODE';
            if (snapshotDataURL) {
                form.append('file', _dataURLtoBlob(snapshotDataURL), DIR + 'snapshot.jpg');
            }

            // 2c. Media queue blobs
            if (APP.media && APP.media.queue && APP.media.queue.length) {
                for (var i = 0; i < APP.media.queue.length; i++) {
                    var item = APP.media.queue[i];
                    try {
                        var mblob;
                        if (item.type === 'image' && item.element && item.element.naturalWidth) {
                            var mc = document.createElement('canvas');
                            mc.width = item.element.naturalWidth; mc.height = item.element.naturalHeight;
                            mc.getContext('2d').drawImage(item.element, 0, 0);
                            mblob = await new Promise(function(r) { mc.toBlob(r, 'image/jpeg', 0.9); });
                        } else if (item.url) {
                            mblob = await fetch(item.url).then(function(r) { return r.blob(); });
                        }
                        if (mblob) {
                            form.append('file', mblob, DIR + 'media/media_' + i + (item.name ? '_' + item.name : ''));
                            log('WALLET_SAVE: QUEUED_MEDIA ' + (item.name || i));
                        }
                    } catch(e) { log('WALLET_SAVE: MEDIA_SKIP ' + (item.name || i) + ' — ' + e.message); }
                }
            }

            // 2d. Audio playlist blobs
            if (APP.audio && APP.audio.playlist && APP.audio.playlist.length) {
                for (var i = 0; i < APP.audio.playlist.length; i++) {
                    var track = APP.audio.playlist[i];
                    try {
                        var ablob = await fetch(track.url).then(function(r) { return r.blob(); });
                        form.append('file', ablob, DIR + 'audio/audio_' + i + (track.name ? '_' + track.name : ''));
                        log('WALLET_SAVE: QUEUED_AUDIO ' + (track.name || i));
                    } catch(e) { log('WALLET_SAVE: AUDIO_SKIP ' + (track.name || i) + ' — ' + e.message); }
                }
            }

            // 2e. Time machine video recording chunks
            if (APP.timeMachine && APP.timeMachine.chunks && APP.timeMachine.chunks.length) {
                try {
                    var tmBlob = new Blob(APP.timeMachine.chunks, { type: 'video/webm' });
                    form.append('file', tmBlob, DIR + 'video/timemachine.webm');
                    log('WALLET_SAVE: QUEUED_TIMEMACHINE ' + (tmBlob.size / 1e6).toFixed(1) + 'MB');
                } catch(e) { log('WALLET_SAVE: TIMEMACHINE_SKIP — ' + e.message); }
            }

            form.append('pinataOptions',  JSON.stringify({ wrapWithDirectory: true }));
            form.append('pinataMetadata', JSON.stringify({
                name: 'VNGRD_WALLET_' + address.slice(0, 8) + '_' + Date.now()
            }));

            // Step 3 — Upload to Pinata
            _step = 'PINATA_UPLOAD';
            log('WALLET_SAVE: UPLOADING_DIRECTORY_TO_PINATA…');
            var res  = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
                method:  'POST',
                headers: { 'Authorization': 'Bearer ' + jwt },
                body:    form
            });
            var data = await res.json();
            if (!res.ok || !data.IpfsHash) throw new Error('PIN_FAIL ' + res.status + ': ' + (data.error ? JSON.stringify(data.error) : 'no IpfsHash'));

            var cid = data.IpfsHash;
            log('WALLET_SAVE: DIRECTORY_PINNED CID=' + cid);

            // Step 4 — Bind the master CID to the user's wallet address via localStorage
            try {
                localStorage.setItem('vngrd_cid_' + address.toLowerCase(), JSON.stringify({
                    payloadCID: cid,
                    address:    address,
                    timestamp:  Date.now()
                }));
                log('WALLET_SAVE: CID_BOUND ' + address.slice(0, 6) + ' → ' + cid.slice(0, 10) + '…');
            } catch(e) { log('WALLET_SAVE: CID_BIND_WARN ' + e.message); }

            _showWalletSaveThumbnail(snapshotDataURL, cid);
            _showIpfsSyncIndicator(false, true);
            if (typeof ghostLog === 'function') ghostLog('GHOST> WALLET PAYLOAD BOUND → IPFS CID=' + cid, 'ok');

        } catch(e) {
            log('WALLET_SAVE: ERR [' + _step + '] ' + e.message);
            _showIpfsSyncIndicator(false, false);
            alert('IPFS Wallet Save failed [' + _step + ']: ' + e.message);
        }
    });
};

// ── LOAD session from localStorage for the connected wallet ──
window.loadSessionFromCloud = async function(silent) {
    if (!APP.wallet.connected || !APP.wallet.address) {
        log('LOCAL_LOAD: WALLET_NOT_CONNECTED');
        if (!silent) alert('Connect your wallet first.');
        return;
    }

    var address = APP.wallet.address;
    log('LOCAL_LOAD: CHECKING_LOCALSTORAGE for ' + address.slice(0, 6) + '...');

    var raw = localStorage.getItem(_localKey(address));

    if (!raw) {
        log('LOCAL_LOAD: NO_SESSION_FOUND');
        if (!silent) alert('No saved session found for this wallet.');
        return;
    }

    var s;
    try { s = JSON.parse(raw); } catch(e) { log('LOCAL_LOAD: PARSE_ERR'); return; }

    var savedDate = s.timestamp ? new Date(s.timestamp).toLocaleString() : 'unknown date';
    var prompt = silent
        ? ('Previous session found for this wallet (' + address.slice(0,6) + '...' + address.slice(-4) + ')\nSaved: ' + savedDate + '\n\nRestore it?')
        : ('Local session for ' + address.slice(0,6) + '...' + address.slice(-4) + '\nSaved: ' + savedDate + '\n\nLoad this session?');

    if (!confirm(prompt)) { log('LOCAL_LOAD: USER_DECLINED'); return; }

    try {
        _applySessionSnapshot(s);
        log('LOCAL_LOAD: SESSION_RESTORED from ' + savedDate);
        alert('Session restored!\nSaved: ' + savedDate);
    } catch(e) {
        log('LOCAL_LOAD: APPLY_ERR ' + e.message);
        alert('Failed to apply session: ' + e.message);
    }
};

// ══════════════════════════════════════════════════════════════════════════
// AUTO-SAVE — writes to localStorage['vngrd_state'] every 60 seconds
// ══════════════════════════════════════════════════════════════════════════
function vngrdAutoSave() {
    try {
        localStorage.setItem('vngrd_state', JSON.stringify(_buildSessionSnapshot()));
    } catch(e) { return; }
    // 1s cyan pulse — CSS animation handles timing, no setTimeout needed
    var led = $('sync-led');
    if (led) {
        led.classList.remove('blink');
        void led.offsetWidth;
        led.classList.add('blink');
    }
}
APP.autoSaveInterval = setInterval(vngrdAutoSave, 60000);

// ══════════════════════════════════════════════════════════════════════════
// DEPLOY SYSTEM — SNAPSHOT + GENERATE_QR / IPFS via Pinata
// ══════════════════════════════════════════════════════════════════════════

// SNAPSHOT: compile state and trigger JSON download
function downloadWorkspaceSnapshot() {
    var snap = _buildSessionSnapshot();
    snap._type = 'VNGRD_WORKSPACE';
    var blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'VNGRD_WORKSPACE_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    log('SNAPSHOT: DOWNLOADED');
}

// Upload a single binary file to Pinata, return its IPFS CID
async function _pinFile(blob, name, jwt) {
    var form = new FormData();
    form.append('file', blob, name);
    form.append('pinataMetadata', JSON.stringify({ name: 'VNGRD_' + name }));
    var res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + jwt },
        body: form
    });
    var data = await res.json();
    if (!res.ok || !data.IpfsHash) throw new Error('PIN_FAIL: ' + (data.error ? JSON.stringify(data.error) : res.status));
    return data.IpfsHash;
}

// SHARE_QR: build portfolio (settings + media + audio) → pin to IPFS → QR code
async function executeWorkspaceExport() {
    var jwt = localStorage.getItem('pinata_jwt');
    if (!jwt) {
        var raw = prompt('PINATA JWT TOKEN (stored locally):');
        if (!raw) { log('IPFS_EXPORT: NO_JWT'); return; }
        jwt = raw.trim();
        localStorage.setItem('pinata_jwt', jwt);
    }

    log('IPFS: BUILDING_PORTFOLIO…');
    if (typeof ghostLog === 'function') ghostLog('GHOST> PORTFOLIO EXPORT STARTED', 'ai');

    var snap = _buildSessionSnapshot();
    snap._type    = 'VNGRD_WORKSPACE';
    snap._version = 'V35_PORTFOLIO';
    snap.media       = [];
    snap.audioTracks = [];

    var total = (APP.media && APP.media.queue ? APP.media.queue.length : 0)
              + (APP.audio && APP.audio.playlist ? APP.audio.playlist.length : 0);
    var done = 0;

    // ── Upload media files (images + videos) ────────────────────────
    if (APP.media && APP.media.queue && APP.media.queue.length) {
        for (var i = 0; i < APP.media.queue.length; i++) {
            var item = APP.media.queue[i];
            try {
                var blob;
                if (item.type === 'image' && item.element && item.element.naturalWidth) {
                    var c = document.createElement('canvas');
                    c.width = item.element.naturalWidth;
                    c.height = item.element.naturalHeight;
                    c.getContext('2d').drawImage(item.element, 0, 0);
                    blob = await new Promise(function(r) { c.toBlob(r, 'image/jpeg', 0.9); });
                } else if (item.url) {
                    var resp = await fetch(item.url);
                    blob = await resp.blob();
                }
                if (blob) {
                    var cid = await _pinFile(blob, item.name || ('media_' + i), jwt);
                    snap.media.push({ type: item.type, name: item.name, cid: cid });
                    log('IPFS: PINNED_MEDIA ' + (++done) + '/' + total + ' ' + (item.name || ''));
                }
            } catch(e) {
                log('IPFS: MEDIA_SKIP ' + (item.name || i) + ' — ' + e.message);
            }
        }
    }

    // ── Upload audio tracks ─────────────────────────────────────────
    if (APP.audio && APP.audio.playlist && APP.audio.playlist.length) {
        for (var i = 0; i < APP.audio.playlist.length; i++) {
            var track = APP.audio.playlist[i];
            try {
                var resp = await fetch(track.url);
                var blob = await resp.blob();
                var cid  = await _pinFile(blob, (track.name || 'track_' + i), jwt);
                snap.audioTracks.push({ name: track.name, cid: cid });
                log('IPFS: PINNED_AUDIO ' + (++done) + '/' + total + ' ' + (track.name || ''));
            } catch(e) {
                log('IPFS: AUDIO_SKIP ' + (track.name || i) + ' — ' + e.message);
            }
        }
    }

    // ── Pin the manifest JSON ───────────────────────────────────────
    log('IPFS: PINNING_MANIFEST (' + snap.media.length + ' media, ' + snap.audioTracks.length + ' tracks)');
    var res, data;
    try {
        res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwt
            },
            body: JSON.stringify({
                pinataContent: snap,
                pinataMetadata: { name: 'VNGRD_PORTFOLIO_' + Date.now() }
            })
        });
        data = await res.json();
    } catch(e) {
        log('IPFS: FETCH_ERR ' + e.message);
        alert('IPFS export failed: ' + e.message);
        return;
    }

    if (!res.ok || !data.IpfsHash) {
        log('IPFS: PIN_FAILED ' + JSON.stringify(data));
        alert('Pinata error: ' + (data.error && data.error.details ? data.error.details : JSON.stringify(data)));
        return;
    }

    var cid = data.IpfsHash;
    log('IPFS: PORTFOLIO_PINNED CID=' + cid);
    if (typeof ghostLog === 'function') ghostLog('GHOST> PORTFOLIO EXPORTED → IPFS CID=' + cid, 'ok');
    showQRModal(cid);
}

// QR MODAL
function buildWorkspaceURL(cid) {
    var origin = window.location.origin;
    if (/^https?:\/\/localhost|^https?:\/\/127\.0\.0\.1/.test(origin)) {
        return new Promise(function(resolve) {
            var resolved = false;
            function done(ip) {
                if (resolved) return;
                resolved = true;
                var port = window.location.port ? ':' + window.location.port : '';
                resolve(window.location.protocol + '//' + ip + port + '/?workspace=' + cid);
            }
            try {
                var pc = new RTCPeerConnection({ iceServers: [] });
                pc.createDataChannel('');
                pc.createOffer().then(function(offer) { pc.setLocalDescription(offer); });
                pc.onicecandidate = function(e) {
                    if (!e || !e.candidate) return;
                    var m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
                    if (m && !/^(127\.|169\.254\.)/.test(m[1])) {
                        pc.close();
                        done(m[1]);
                    }
                };
                setTimeout(function() { done('localhost'); }, 2000);
            } catch(e) {
                done('localhost');
            }
        });
    }
    return Promise.resolve(origin + '/?workspace=' + cid);
}

function showQRModal(cid) {
    buildWorkspaceURL(cid).then(function(url) { _renderQRModal(cid, url); });
}

function _renderQRModal(cid, url) {
    var modal = $('qr-modal');
    var container = $('qr-code-container');
    var cidLabel = $('qr-modal-cid-label');
    var urlDisplay = $('qr-url-display');

    cidLabel.textContent = 'CID: ' + cid;
    urlDisplay.textContent = url;
    container.innerHTML = '';

    ghostLog('SYSTEM: DYNAMIC_LINK_GENERATED_AT_' + window.location.origin, 'success');

    if (typeof QRCode !== 'undefined') {
        new QRCode(container, {
            text: url,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    } else {
        container.textContent = url;
        container.style.wordBreak = 'break-all';
        container.style.color = '#000';
        container.style.fontSize = '8px';
    }

    modal.style.display = 'flex';

    $('btn-qr-copy').onclick = function() {
        navigator.clipboard.writeText(url).then(function() {
            log('QR: URL_COPIED');
            $('btn-qr-copy').textContent = 'COPIED!';
            setTimeout(function() { $('btn-qr-copy').textContent = 'COPY_URL'; }, 1500);
        }).catch(function() {
            prompt('Copy this URL:', url);
        });
    };

    $('btn-qr-close').onclick = function() {
        modal.style.display = 'none';
    };
}

// ── IPFS PORTFOLIO IMPORT ────────────────────────────────────────────
async function importFromIPFS(cid) {
    var gateways = [
        'https://gateway.pinata.cloud/ipfs/',
        'https://ipfs.io/ipfs/',
        'https://cloudflare-ipfs.com/ipfs/'
    ];
    log('IPFS: IMPORTING_PORTFOLIO CID=' + cid);
    if (typeof ghostLog === 'function') ghostLog('GHOST> LOADING PORTFOLIO FROM IPFS…', 'ai');

    var snap = null;
    for (var g = 0; g < gateways.length; g++) {
        try {
            var res = await fetch(gateways[g] + cid);
            if (res.ok) { snap = await res.json(); break; }
        } catch(e) { continue; }
    }
    if (!snap) { log('IPFS: ALL_GATEWAYS_FAILED'); return; }
    if (snap._type !== 'VNGRD_WORKSPACE') { log('IPFS: INVALID_WORKSPACE_TYPE'); return; }

    _applySessionSnapshot(snap);
    log('IPFS: SESSION_RESTORED');

    var gateway = gateways[0];
    for (var g = 0; g < gateways.length; g++) {
        try {
            if (snap.media && snap.media[0] && snap.media[0].cid) {
                var test = await fetch(gateways[g] + snap.media[0].cid, { method: 'HEAD' });
                if (test.ok) { gateway = gateways[g]; break; }
            } else if (snap.audioTracks && snap.audioTracks[0] && snap.audioTracks[0].cid) {
                var test = await fetch(gateways[g] + snap.audioTracks[0].cid, { method: 'HEAD' });
                if (test.ok) { gateway = gateways[g]; break; }
            } else { break; }
        } catch(e) { continue; }
    }

    if (snap.media && snap.media.length) {
        for (var i = 0; i < snap.media.length; i++) {
            var m = snap.media[i];
            if (!m.cid) continue;
            try {
                var resp = await fetch(gateway + m.cid);
                var blob = await resp.blob();
                var url  = URL.createObjectURL(blob);
                var item = { type: m.type, url: url, element: null, name: m.name };

                if (m.type === 'video') {
                    var vid = document.createElement('video');
                    vid.src = url; vid.muted = true; vid.loop = true; vid.playsInline = true; vid.preload = 'auto';
                    item.element = vid;
                    if ($('media-container')) $('media-container').appendChild(vid);
                } else {
                    var img = new Image();
                    img.src = url;
                    item.element = img;
                }
                APP.media.queue.push(item);
                log('IPFS: LOADED_MEDIA ' + (i + 1) + '/' + snap.media.length + ' ' + m.name);
            } catch(e) {
                log('IPFS: MEDIA_ERR ' + m.name + ' — ' + e.message);
            }
        }
        if (APP.media.queue.length && APP.media.currentIndex === -1) {
            if (typeof rotateMedia === 'function') rotateMedia();
        }
        if (typeof updateQueueDisplay === 'function') updateQueueDisplay();
        var mediaDot = $('media-dot');
        if (mediaDot) mediaDot.classList.remove('off');
    }

    if (snap.audioTracks && snap.audioTracks.length) {
        for (var i = 0; i < snap.audioTracks.length; i++) {
            var t = snap.audioTracks[i];
            if (!t.cid) continue;
            try {
                var resp = await fetch(gateway + t.cid);
                var blob = await resp.blob();
                APP.audio.playlist.push({ url: URL.createObjectURL(blob), name: t.name });
                log('IPFS: LOADED_AUDIO ' + (i + 1) + '/' + snap.audioTracks.length + ' ' + t.name);
            } catch(e) {
                log('IPFS: AUDIO_ERR ' + t.name + ' — ' + e.message);
            }
        }
        var audioDot = $('audio-dot');
        if (audioDot) audioDot.classList.remove('off');
        if (APP.audio.playlist.length && !APP.audio.isPlaying) {
            if (typeof playTrack === 'function') playTrack();
        }
    }

    var mCount = snap.media ? snap.media.length : 0;
    var aCount = snap.audioTracks ? snap.audioTracks.length : 0;
    log('PORTFOLIO_IMPORTED: ' + mCount + ' media, ' + aCount + ' tracks');
    if (typeof ghostLog === 'function') ghostLog('GHOST> PORTFOLIO LOADED — ' + mCount + ' MEDIA, ' + aCount + ' TRACKS', 'ok');
}

function isValidDataURI(str) {
    if (!str || typeof str !== 'string') return false;
    if (!str.startsWith('data:image/')) return false;
    if (str.indexOf(';base64,') === -1) return false;
    var commaIdx = str.indexOf(',');
    if (commaIdx === -1 || str.length - commaIdx < 100) return false;
    return true;
}

function loadFromMemory() {
    const data = localStorage.getItem('VNGRD_SESSION');
    if(!data) return;
    try {
        const s = JSON.parse(data);
        if(s.theme) setTheme(s.theme);
        if(s.bug) { APP.bug.text = s.bug; if ($('bug-text')) $('bug-text').value = s.bug; var _bugEl = $('station-bug'); if (_bugEl) _bugEl.textContent = s.bug; }
        if(s.vj) { APP.vj = { ...APP.vj, ...s.vj }; }
        if(s.layers) { APP.layers = { ...APP.layers, ...s.layers }; APP.trinity.logo.scale = APP.layers.logoScale || 1.0; APP.trinity.bug.scale = APP.layers.bugScale || 1.5; }
        if (s.logo2d) {
            if (isValidDataURI(s.logo2d)) {
                var _ll = $('user-logo-layer');
                if (_ll) { _ll.src = s.logo2d; _ll.style.display = 'block'; APP.trinity.logo.visible = true; }
            } else {
                log('MEMORY: CORRUPT_LOGO_PURGED');
                s.logo2d = null;
                localStorage.setItem('VNGRD_SESSION', JSON.stringify(s));
            }
        }
        if (s.lowerThird) {
            if (s.lowerThird.title && $('lt-title-text')) $('lt-title-text').textContent = s.lowerThird.title;
            if (s.lowerThird.subtitle && $('lt-subtitle-text')) $('lt-subtitle-text').textContent = s.lowerThird.subtitle;
            if (s.lowerThird.preset) APP.lowerThird.preset = s.lowerThird.preset;
            APP.lowerThird.visible = !!s.lowerThird.visible;
        }
        log('MEMORY_RESTORED');
    } catch(e) { log('MEMORY_CORRUPT'); }
}
