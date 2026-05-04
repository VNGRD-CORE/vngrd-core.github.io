// ═══════════════════════════════════════════════════════════════
// TICKER MODULE — Crypto, Broadcast, Ethereal ticker engines
// Extracted from main.js. Depends on: $, APP (main.js)
// ═══════════════════════════════════════════════════════════════

// CRYPTO — Binance API (reliable browser-side fetch)
async function fetchCrypto() {
    try {
        const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT'];
        const labels = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', DOGEUSDT: 'DOGE' };

        const prices = await Promise.all(symbols.map(s =>
            fetch('https://api.binance.com/api/v3/ticker/price?symbol=' + s).then(r => r.json())
        ));

        APP.crypto.tickerHTML = prices.map(p => {
            const sym = labels[p.symbol] || p.symbol;
            const price = parseFloat(p.price);
            return `<span>${sym}: $${price < 1 ? price.toFixed(6) : price.toFixed(2)}</span>`;
        }).join('&nbsp;&nbsp;//&nbsp;&nbsp;');

        updateTickerCycle();

    } catch(e) {
        APP.crypto.tickerHTML = '<span style="color:var(--r)">CRYPTO_FEED_OFFLINE</span>';
        updateTickerCycle();
        console.warn("Binance data sync paused.");
    }
}

// TICKER CYCLE ENGINE — [WEATHER] > [CRYPTO] > [IDENTITY]
// NOTE: Cyber/default theme only — Broadcast theme has its own engine below.
APP.crypto.tickerHTML = '';
APP.ticker = { phase: 0, interval: null };

function updateTickerCycle() {
    // ── Each structural theme has its own dedicated ticker engine ─────────
    if (document.body.classList.contains('theme-broadcast')) { updateBroadcastTicker(); return; }
    if (document.body.classList.contains('theme-ethereal'))  { updateEtherealTicker();  return; }
    // ── Cyber (default): original weather + crypto + identity cycle ───────
    const ticker = $('ticker-text');
    if (!ticker) return;
    const weatherBlock = APP.atmosphere.city !== 'UNKNOWN'
        ? `<span style="color:var(--accent)">[LOC: ${APP.atmosphere.city}]</span>&nbsp;//&nbsp;<span>[TEMP: ${APP.atmosphere.temperature || '—'}°C]</span>&nbsp;//&nbsp;<span>[${APP.atmosphere.isRaining ? 'PRECIPITATION_DETECTED' : 'ATMOS_STABLE'}]</span>`
        : '<span style="color:var(--text-dim)">WEATHER: ACQUIRING...</span>';
    const cryptoBlock = APP.crypto.tickerHTML || '<span style="color:var(--text-dim)">CRYPTO: LOADING...</span>';
    const identityBlock = '<span style="color:var(--accent)">WHAT HAPPENS IN THE NODES STAYS IN THE NODES</span>&nbsp;&nbsp;//&nbsp;&nbsp;<span style="color:var(--v)">SIGNAL_RESTORED</span>';
    const full = weatherBlock + '&nbsp;&nbsp;//&nbsp;&nbsp;' + cryptoBlock + '&nbsp;&nbsp;//&nbsp;&nbsp;' + identityBlock;
    ticker.innerHTML = full + '&nbsp;&nbsp;//&nbsp;&nbsp;' + full;
}

// ─── BROADCAST TICKER ENGINE ─────────────────────────────────────────────────
// Global clocks helper — returns [ LOCAL: HH:MM ] [ NY: HH:MM ] ...
function getGlobalClocks() {
    function fmt(tz) {
        return new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz
        }).format(new Date());
    }
    var localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return '[ LOCAL: ' + fmt(localTz) + ' ] [ NY: ' + fmt('America/New_York') +
           ' ] [ LDN: ' + fmt('Europe/London') + ' ] [ TYO: ' + fmt('Asia/Tokyo') + ' ]';
}

APP.broadcast = APP.broadcast || {};
APP.broadcast.newsCache  = [];
APP.broadcast.lastFetch  = 0;
APP.broadcast.newsCity   = '';

// Fetch top-3 geo-targeted headlines; falls back to Hacker News on failure
function fetchBroadcastNews() {
    var city = APP.atmosphere.city;
    var now  = Date.now();
    // 5-minute cache — don't hammer the proxy
    if (APP.broadcast.newsCache.length && now - APP.broadcast.lastFetch < 300000) {
        return Promise.resolve(APP.broadcast.newsCache);
    }
    if (city && city !== 'UNKNOWN') {
        var rssUrl = 'https://news.google.com/rss/headlines/section/geo/' + encodeURIComponent(city);
        var apiUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl);
        return fetch(apiUrl)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.status === 'ok' && data.items && data.items.length) {
                    APP.broadcast.newsCache = data.items.slice(0, 3).map(function(i) {
                        return i.title.replace(/\s+/g, ' ').trim().toUpperCase();
                    });
                    APP.broadcast.lastFetch = now;
                    APP.broadcast.newsCity  = city;
                    return APP.broadcast.newsCache;
                }
                throw new Error('RSS_EMPTY');
            })
            .catch(function() { return _broadcastHNFallback(now); });
    }
    return _broadcastHNFallback(now);
}

function _broadcastHNFallback(now) {
    return fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
        .then(function(r) { return r.json(); })
        .then(function(ids) {
            return Promise.all(ids.slice(0, 3).map(function(id) {
                return fetch('https://hacker-news.firebaseio.com/v0/item/' + id + '.json')
                    .then(function(r) { return r.json(); })
                    .then(function(d) { return (d.title || 'INTEL UNAVAILABLE').toUpperCase(); });
            }));
        })
        .then(function(titles) {
            APP.broadcast.newsCache = titles;
            APP.broadcast.lastFetch = now;
            APP.broadcast.newsCity  = 'GLOBAL';
            return titles;
        })
        .catch(function() {
            return ['SIGNAL ACQUIRING…', 'FEED STANDBY…', 'INTEL PENDING…'];
        });
}

function updateBroadcastTicker() {
    var ticker = $('ticker-text');
    if (!ticker) return;
    var clocks = getGlobalClocks();
    fetchBroadcastNews().then(function(headlines) {
        var city = (APP.broadcast.newsCity && APP.broadcast.newsCity !== 'UNKNOWN')
                   ? APP.broadcast.newsCity : 'GLOBAL';
        var bullets = headlines.map(function(h) { return '● ' + h; }).join('&nbsp;&nbsp;&nbsp;');
        var content = clocks
                    + '&nbsp;&nbsp;//&nbsp;&nbsp;'
                    + '[ ' + city + ' LOCAL INTEL ]'
                    + '&nbsp;&nbsp;' + bullets;
        var full = '<span style="font-family:\'Space Mono\',monospace!important;font-size:9px!important;'
                 + 'letter-spacing:0.05em!important;color:#1a2030!important;font-weight:600!important;">'
                 + content + '</span>';
        ticker.innerHTML = full + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' + full;
    });
}

// Refresh clocks every 60 s while Broadcast is active (news stays cached 5 min)
setInterval(function() {
    if (document.body.classList.contains('theme-broadcast')) updateBroadcastTicker();
}, 60000);
// ─── END BROADCAST TICKER ENGINE ─────────────────────────────────────────────

// ─── ETHEREAL TICKER ENGINE — Global Culture + Local Art ─────────────────────
APP.ethereal = APP.ethereal || {};
APP.ethereal.newsCache = null;  // { global:[], local:[], city:'' }
APP.ethereal.lastFetch = 0;

// Strip " - Publisher Name" suffix that Google News appends to every headline
function _stripPublisher(title) {
    return title.replace(/\s+[-–]\s+[^-–]{2,60}$/, '').trim();
}

function fetchEtherealNews() {
    var city = APP.atmosphere && APP.atmosphere.city;
    var now  = Date.now();
    if (APP.ethereal.newsCache && now - APP.ethereal.lastFetch < 300000) {
        return Promise.resolve(APP.ethereal.newsCache);
    }
    var proxy      = 'https://api.rss2json.com/v1/api.json?rss_url=';
    var globalRss  = 'https://news.google.com/rss/search?q=%22Art+News%22+OR+%22Contemporary+Art%22+OR+%22Design+Culture%22';
    var localQ     = (city && city !== 'UNKNOWN')
                   ? '%22Art+Exhibition%22+OR+%22Gallery%22+location%3A' + encodeURIComponent(city)
                   : '%22Art+Exhibition%22+OR+%22Contemporary+Gallery%22';
    var localRss   = 'https://news.google.com/rss/search?q=' + localQ;

    function fetchFeed(url, count) {
        return fetch(proxy + encodeURIComponent(url))
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.status === 'ok' && d.items && d.items.length) {
                    return d.items.slice(0, count).map(function(i) {
                        return _stripPublisher(i.title).toUpperCase();
                    });
                }
                return [];
            })
            .catch(function() { return []; });
    }

    return Promise.all([fetchFeed(globalRss, 2), fetchFeed(localRss, 2)])
        .then(function(res) {
            var cache = {
                global: res[0].length ? res[0] : ['— ACQUIRING —', '—'],
                local:  res[1].length ? res[1] : ['— ACQUIRING —', '—'],
                city:   (city && city !== 'UNKNOWN') ? city : 'GLOBAL'
            };
            APP.ethereal.newsCache = cache;
            APP.ethereal.lastFetch = now;
            return cache;
        });
}

function updateEtherealTicker() {
    var ticker = $('ticker-text');
    if (!ticker) return;
    fetchEtherealNews().then(function(data) {
        var accent  = '#a78bfa';  // Ethereal violet accent
        var gbullets = data.global.map(function(h) { return '● “' + h + '”'; }).join('&nbsp;&nbsp;');
        var lbullets = data.local.map(function(h)  { return '● “' + h + '”'; }).join('&nbsp;&nbsp;');
        var gBlock  = '<span style="color:' + accent + '!important;font-weight:700;">[ GLOBAL CULTURE ]</span>&nbsp;&nbsp;' + gbullets;
        var lBlock  = '<span style="color:' + accent + '!important;font-weight:700;">[ ' + data.city + ' // LOCAL ART ]</span>&nbsp;&nbsp;' + lbullets;
        var content = gBlock + '&nbsp;&nbsp;//&nbsp;&nbsp;' + lBlock;
        var full = '<span style="font-family:\'Inter\',sans-serif!important;font-size:9px!important;'
                 + 'letter-spacing:0.04em!important;color:#e5e5ea!important;">' + content + '</span>';
        ticker.innerHTML = full + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' + full;
    });
}

// Refresh every 60 s while Ethereal is active (news cached 5 min)
setInterval(function() {
    if (document.body.classList.contains('theme-ethereal')) updateEtherealTicker();
}, 60000);
// ─── END ETHEREAL TICKER ENGINE ──────────────────────────────────────────────
