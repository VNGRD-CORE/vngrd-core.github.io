(function(){
    var VB_ALL = ['SLIT_SCAN','LUMA_BLOOM','DITHER_LUXE','CAUSTICS','GHOST_ECHO','SPECTRAL_MOSH'];
    var _vbTimers = {};

    window._setFXBank = function(bank) {
        var pA = document.getElementById('fx-bank-a-panel');
        var pB = document.getElementById('fx-bank-b-panel');
        var bA = document.getElementById('fx-bank-a-btn');
        var bB = document.getElementById('fx-bank-b-btn');
        if (pA) pA.style.display = bank === 'A' ? '' : 'none';
        if (pB) pB.style.display = bank === 'B' ? '' : 'none';
        if (bA) bA.classList.toggle('bank-active', bank === 'A');
        if (bB) bB.classList.toggle('bank-active', bank === 'B');
    };

    window._vbActivate = function(sn, persistent) {
        if (!VB_ALL.includes(sn)) return;
        clearTimeout(_vbTimers[sn]);
        document.body.classList.add('vb-' + sn);
        var btn = document.getElementById('vb-' + sn);
        if (btn) { btn.classList.add('on'); btn.classList.toggle('vb-locked', !!persistent); }
        var st = document.getElementById('vb-sys-status');
        if (st) st.textContent = 'ACTIVE: ' + VB_ALL.filter(function(s){ return document.body.classList.contains('vb-'+s); }).join(' · ');
        if (!persistent) {
            _vbTimers[sn] = setTimeout(function(){ window._vbDeactivate(sn); }, 3000);
        }
    };

    window._vbDeactivate = function(sn) {
        clearTimeout(_vbTimers[sn]);
        document.body.classList.remove('vb-' + sn);
        var btn = document.getElementById('vb-' + sn);
        if (btn) { btn.classList.remove('on', 'vb-locked'); }
        var active = VB_ALL.filter(function(s){ return document.body.classList.contains('vb-'+s); });
        var st = document.getElementById('vb-sys-status');
        if (st) st.textContent = active.length ? 'ACTIVE: ' + active.join(' · ') : 'SYSTEM_STATUS: STANDBY';
    };

    window._vbClearAll = function() {
        VB_ALL.forEach(function(sn){ window._vbDeactivate(sn); });
    };

    /* Wire .vb-btn clicks: single tap = 3s burst, double-tap = persistent lock */
    var _lastTap = {};
    document.addEventListener('DOMContentLoaded', function(){
        _setFXBank('A');
        document.querySelectorAll('.vb-btn').forEach(function(btn){
            var sn = btn.dataset.shader;
            if (!sn) return;
            btn.addEventListener('click', function(){
                var now = Date.now();
                var dbl = (now - (_lastTap[sn]||0)) < 380;
                _lastTap[sn] = now;
                if (dbl) {
                    if (document.body.classList.contains('vb-'+sn)) {
                        clearTimeout(_vbTimers[sn]);
                        btn.classList.add('vb-locked');
                        if (typeof APP !== 'undefined') {} // keep active indefinitely
                    } else { _vbActivate(sn, true); }
                } else {
                    document.body.classList.contains('vb-'+sn) ? _vbDeactivate(sn) : _vbActivate(sn, false);
                }
            });
        });
    });
})();
