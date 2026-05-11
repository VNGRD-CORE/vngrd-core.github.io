// ═══════════════════════════════════════════════════════════════
// WEB3 WALLET MODULE — MetaMask connect, DNA signing, NFT vault
// Extracted from main.js. Depends on: $, APP, log,
// enableRecordButtons, checkLayerReadiness (globals from main.js)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Phase 3: WEB3 SOVEREIGN DNA
// ═══════════════════════════════════════════════════════════════
var _walletChainNames = {
    '0x1': 'ETH', '0x89': 'MATIC', '0xa86a': 'AVAX', '0x38': 'BSC',
    '0xa4b1': 'ARB', '0xa': 'OP', '0x2105': 'BASE', '0xaa36a7': 'SEP'
};

function walletNetworkName(chainId) {
    return _walletChainNames[chainId] || 'NET:' + parseInt(chainId, 16);
}

function connectWalletUI(address, chainId) {
    var network = walletNetworkName(chainId);
    var short = address.slice(0, 6) + '...' + address.slice(-4);
    APP.wallet = { connected: true, address: address, chainId: chainId, nfts: APP.wallet.nfts || [] };
    APP.web3.address = address;
    APP.web3.isConnected = true;
    APP.web3.mode = 'sovereign';
    APP.layerSaver.allReady = true;
    enableRecordButtons(true);
    $('wallet-badge').style.borderColor = 'var(--g)';
    $('wallet-badge').style.color = 'var(--g)';
    $('wallet-badge').innerHTML = '<span class="dot" style="background:var(--g);box-shadow:0 0 6px var(--g)"></span>' + network + ':' + short;
    return { network: network, short: short };
}

async function disconnectWalletUI() {
    if (APP.web3.provider && APP.web3.provider.close) {
        try { await APP.web3.provider.close(); } catch(_) {}
    }

    APP.wallet = { connected: false, address: null, chainId: null, nfts: [] };
    APP.web3.address = null;
    APP.web3.isConnected = false;
    APP.web3.mode = 'guest';
    APP.web3.provider = null;
    APP.web3.signer = null;
    APP.user.assets = [];
    APP.nftVault.thumbnails = [];

    var _providerKeys = [
        'WEB3_CONNECT_CACHED_PROVIDER',
        'walletconnect',
        'WALLETCONNECT_DEEPLINK_CHOICE',
        'wc@2:core:0.3//session',
        'wc@2:ethereum_provider:/chainId'
    ];
    _providerKeys.forEach(function(k) { try { localStorage.removeItem(k); } catch(_) {} });

    Object.keys(localStorage).forEach(function(k) {
        if (k.startsWith('-walletlink') || k.startsWith('walletconnect') || k.startsWith('loglevel')) {
            try { localStorage.removeItem(k); } catch(_) {}
        }
    });

    $('wallet-badge').style.borderColor = 'var(--o)';
    $('wallet-badge').style.color = 'var(--o)';
    $('wallet-badge').innerHTML = '<span class="dot off"></span>WALLET';
    $('vault-dot').classList.add('off');
    $('nft-vault-list').innerHTML = 'CONNECT_WALLET_FIRST';
    $('nft-count').textContent = 'ASSETS: 0';
    checkLayerReadiness();
    log('WALLET: DISCONNECTED + CACHE_CLEARED');
}

function autoScanNFTs() {
    var btn = $('btn-scan-nfts');
    if (btn) setTimeout(function() { btn.click(); }, 300);
}

// WALLET: MANUAL CONNECT ONLY
// requestManualConnect() is the SINGLE entry point for all wallet access.
// Only ever called by an explicit user gesture (wallet-badge click).
window.requestManualConnect = async function() {
    if (typeof window.ethereum === 'undefined') {
        log('WALLET: NO_METAMASK_DETECTED');
        alert('MetaMask not detected. Please install the MetaMask browser extension from metamask.io');
        window.open('https://metamask.io/download/', '_blank');
        return;
    }
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (!accounts || accounts.length === 0) { log('WALLET: NO_ACCOUNTS'); return; }
        const _provider = new ethers.providers.Web3Provider(window.ethereum);
        const _signer = _provider.getSigner();
        const freshAddress = await _signer.getAddress();
        APP.web3.provider = _provider;
        APP.web3.signer = _signer;
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const info = connectWalletUI(freshAddress, chainId);
        log('WALLET: ' + info.network + ' ' + info.short);
        try {
            const bal = await window.ethereum.request({ method: 'eth_getBalance', params: [freshAddress, 'latest'] });
            log('BALANCE: ' + (parseInt(bal, 16) / 1e18).toFixed(4) + ' ETH');
        } catch (_) {}
        autoScanNFTs();
    } catch (e) {
        log(e.code === 4001 ? 'WALLET: USER_REJECTED' : 'WALLET_ERR: ' + e.message);
    }
};

async function signVideoDNA(videoBlob) {
    const result = { hash: null, signature: null, timestamp: Date.now(), address: APP.web3.address || 'guest', mode: APP.web3.mode };
    try {
        const ab = await videoBlob.arrayBuffer();
        const hashBuf = await window.crypto.subtle.digest('SHA-256', ab);
        result.hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (APP.web3.mode === 'sovereign' && APP.web3.isConnected && window.ethereum) {
            const msg = 'VNGRD_DNA_SEAL:' + result.hash + ':' + result.timestamp;
            result.signature = await window.ethereum.request({ method: 'personal_sign', params: [msg, APP.web3.address] });
            log('DNA: SEALED + ETH_SIG');
        } else {
            localStorage.setItem('vngrd_last_hash', result.hash);
            log('DNA: SEALED_SHA256 (GUEST)');
        }
    } catch (e) {
        log('DNA_SEAL_ERR: ' + (e.message || e));
    }
    return result;
}

function injectDNAHeader(dna, seal) {
    if (!dna || !seal) return dna;
    dna.sovereign = {
        hash: seal.hash, signature: seal.signature, timestamp: seal.timestamp,
        address: seal.address, mode: seal.mode,
        traits: { resolution: APP.render.width + 'x' + APP.render.height, codec: 'vp9+opus', bitrate: '15Mbps', spatialMode: APP.audio.spatialMode, theme: APP.state.theme, version: 'VNGRD_23.5_SERVERLESS' }
    };
    return dna;
}
