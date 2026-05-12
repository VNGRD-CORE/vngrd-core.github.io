// ═══════════════════════════════════════════════════════════════
// TOKEN-GATE MODULE — NFT-based premium feature access
// Depends on: APP, log, window.ethereum (globals from main.js)
// ═══════════════════════════════════════════════════════════════

// ── 1. STATE ─────────────────────────────────────────────────
var isPremium = false;

// Premium contract on ETH mainnet — replace before deploy
var PREMIUM_CONTRACT = '0xYOUR_CONTRACT_ADDRESS_HERE';

// IDs of DOM elements that are premium-gated.
// fx-bank-b-panel  = advanced GLSL shaders panel
// sonic-suite-slicer-wrap = Slicer card inside Sonic Suite
var PREMIUM_ELEMENT_IDS = ['fx-bank-b-panel'];

var PREMIUM_SESSION_KEY = 'vngrd_premium_addr';

// ── 2. VALIDATOR ─────────────────────────────────────────────
// walletNFTs — array produced by scanETHNfts / scanTezosNfts
// Returns true if any ETH NFT belongs to PREMIUM_CONTRACT.
function checkPremiumStatus(walletNFTs) {
    if (!Array.isArray(walletNFTs) || walletNFTs.length === 0) return false;
    var target = PREMIUM_CONTRACT.toLowerCase();
    return walletNFTs.some(function(nft) {
        return nft.chain === 'ETH'
            && typeof nft.contractAddress === 'string'
            && nft.contractAddress.toLowerCase() === target;
    });
}

// ── 3. UI TOGGLE ─────────────────────────────────────────────
function unlockPremiumUI() {
    isPremium = true;
    PREMIUM_ELEMENT_IDS.forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.style.display = '';
        el.removeAttribute('data-premium-locked');
        el.classList.remove('premium-locked');
    });
    log('PREMIUM: ACCESS_GRANTED — ADVANCED_FEATURES_UNLOCKED');
    _cachePremiumSession();
}

// ── 4. FALLBACK ───────────────────────────────────────────────
function showUpgradeModal() {
    isPremium = false;
    var existing = document.getElementById('vngrd-upgrade-modal');
    if (existing) { existing.style.display = 'flex'; return; }

    var overlay = document.createElement('div');
    overlay.id = 'vngrd-upgrade-modal';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.88)', 'font-family:"JetBrains Mono",monospace'
    ].join(';');

    overlay.innerHTML = [
        '<div style="border:1px solid var(--c);padding:28px 32px;max-width:320px;text-align:center;background:var(--panel);">',
        '  <div style="color:var(--c);font-size:11px;letter-spacing:2px;margin-bottom:12px;">VNGRD//CORE</div>',
        '  <div style="color:var(--o);font-size:9px;letter-spacing:1px;margin-bottom:16px;">',
        '    PREMIUM_PASS_REQUIRED<br>',
        '    <span style="color:var(--text-dim);font-size:8px;">Advanced Slicer + GLSL Shaders</span>',
        '  </div>',
        '  <button id="vngrd-upgrade-btn" style="',
        '    background:none;border:1px solid var(--c);color:var(--c);',
        '    font-family:inherit;font-size:9px;letter-spacing:1px;',
        '    padding:8px 20px;cursor:pointer;margin-bottom:8px;width:100%;">',
        '    GET_PASS →',
        '  </button>',
        '  <button id="vngrd-upgrade-close" style="',
        '    background:none;border:none;color:var(--text-dim);',
        '    font-family:inherit;font-size:8px;cursor:pointer;letter-spacing:1px;">',
        '    DISMISS',
        '  </button>',
        '</div>'
    ].join('');

    document.body.appendChild(overlay);

    document.getElementById('vngrd-upgrade-btn').onclick = function() {
        // Replace with your mint/marketplace URL before deploy
        window.open('https://YOUR_MARKETPLACE_URL_HERE', '_blank');
    };
    document.getElementById('vngrd-upgrade-close').onclick = function() {
        overlay.style.display = 'none';
    };
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.style.display = 'none';
    });

    log('PREMIUM: ACCESS_DENIED — UPGRADE_MODAL_SHOWN');
}

// ── SESSION CACHE ─────────────────────────────────────────────
// Avoids re-scanning Alchemy on every page load for wallets that
// already proved ownership. Invalidated if wallet address changes.
function _cachePremiumSession() {
    try {
        sessionStorage.setItem(PREMIUM_SESSION_KEY, APP.web3.address || '');
    } catch (_) {}
}

function _loadPremiumFromCache() {
    if (!APP.web3.address) return false;
    try {
        var cached = sessionStorage.getItem(PREMIUM_SESSION_KEY);
        return cached && cached.toLowerCase() === APP.web3.address.toLowerCase();
    } catch (_) { return false; }
}

// ── SIGNATURE VERIFICATION ────────────────────────────────────
// Signs a deterministic challenge with the connected wallet so we
// prove control of the address, not just knowledge of it.
async function verifyWalletOwnership() {
    if (!window.ethereum || !APP.web3.address) return false;
    try {
        var msg = 'VNGRD_PREMIUM_AUTH:' + APP.web3.address.toLowerCase();
        await window.ethereum.request({
            method: 'personal_sign',
            params: [msg, APP.web3.address]
        });
        log('PREMIUM: SIGNATURE_OK');
        return true;
    } catch (e) {
        log('PREMIUM: SIGNATURE_REJECTED — ' + (e.message || e));
        return false;
    }
}

// ── PUBLIC ENTRY POINT ────────────────────────────────────────
// Call this after scanETHNfts / scanTezosNfts resolves.
// walletNFTs — the combined allNfts array from the scan callback.
window.runTokenGate = async function(walletNFTs) {
    // Fast path: restore from session cache (same wallet, already signed)
    if (_loadPremiumFromCache()) {
        log('PREMIUM: SESSION_CACHE_HIT — SKIPPING_RESCAN');
        unlockPremiumUI();
        return;
    }

    var hasPremiumNFT = checkPremiumStatus(walletNFTs);

    if (!hasPremiumNFT) {
        showUpgradeModal();
        return;
    }

    // Prove wallet ownership via signature before granting access
    var verified = await verifyWalletOwnership();
    if (verified) {
        unlockPremiumUI();
    } else {
        showUpgradeModal();
    }
};
