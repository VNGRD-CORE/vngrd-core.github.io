// ═══════════════════════════════════════════════════════════════
// MIXER CARD MODULE — per-card fader/mute/solo + master meter + reverb
// Extracted from main.js. Depends on: SonicSuite, window._ssAnalyser,
// window._ssReverbReturn (globals from sonic-suite.js)
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
//  VNGRD MIXER CARD — per-card fader/mute/solo + master meter + reverb
// ═══════════════════════════════════════════════════════════════
(function() {
    const TRACK_IDS = ['mpc', 'bass303', 'xypad'];
    const LS_KEY = 'vngrd.sonicsuite.mixer.v1';

    function _load() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function _save(s) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
    }

    function init() {
        SonicSuite.registerCard('mixer', {
            tag: 'M',
            label: '◈ MIXER',
            mount(body, ctx) {
                const persisted = _load();

                // Strips row
                const strips = document.createElement('div');
                strips.style.cssText = 'display:flex;gap:8px;justify-content:space-around;';
                body.appendChild(strips);

                const strip = (id, name) => {
                    const wrap = document.createElement('div');
                    wrap.dataset.stripId = id;
                    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;width:52px;';
                    wrap.innerHTML =
                        '<div style="font-size:7px;color:rgba(0,243,255,.7);letter-spacing:2px;">' + name + '</div>' +
                        '<input type="range" class="ss-mx-fade" min="0" max="120" value="100" ' +
                        'style="-webkit-appearance:slider-vertical;appearance:slider-vertical;writing-mode:vertical-lr;' +
                        'width:18px;height:86px;accent-color:#00f3ff;">' +
                        '<input type="range" class="ss-mx-rev" min="0" max="100" value="0" ' +
                        'style="width:44px;accent-color:#ff88ff;" title="Reverb send">' +
                        '<div style="display:flex;gap:3px;">' +
                          '<button class="ss-card-btn ss-mx-m" title="Mute">M</button>' +
                          '<button class="ss-card-btn ss-mx-s" title="Solo">S</button>' +
                        '</div>';
                    strips.appendChild(wrap);
                    return wrap;
                };

                TRACK_IDS.forEach(id => strip(id, id.toUpperCase()));

                // Master strip
                const master = document.createElement('div');
                master.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;width:64px;border-left:1px solid rgba(0,243,255,.2);padding-left:8px;';
                master.innerHTML =
                    '<div style="font-size:7px;color:#00f3ff;letter-spacing:2px;">MASTER</div>' +
                    '<canvas class="ss-mx-vu" width="12" height="86" style="background:rgba(0,0,0,.6);border:1px solid rgba(0,243,255,.25);"></canvas>' +
                    '<input type="range" class="ss-mx-revret" min="0" max="100" value="35" style="width:54px;accent-color:#ff88ff;" title="Reverb return">' +
                    '<div style="font-size:6px;color:rgba(0,243,255,.45);letter-spacing:1px;">REV RET</div>';
                strips.appendChild(master);

                // Wire up strips
                TRACK_IDS.forEach(id => {
                    const w = strips.querySelector('[data-strip-id="' + id + '"]');
                    const fade = w.querySelector('.ss-mx-fade');
                    const rev  = w.querySelector('.ss-mx-rev');
                    const mB   = w.querySelector('.ss-mx-m');
                    const sB   = w.querySelector('.ss-mx-s');

                    // Restore
                    const ps = persisted[id] || {};
                    if (ps.fade != null) fade.value = ps.fade;
                    if (ps.rev  != null) rev.value  = ps.rev;
                    if (ps.mute) mB.classList.add('muted');

                    function applyFade() {
                        const card = SonicSuite._state.cards[id];
                        if (!card || !card.bus) return;
                        const v = (+fade.value / 100) * (mB.classList.contains('muted') ? 0 : 1);
                        card.bus.gain.setTargetAtTime(v, ctx.audioCtx.currentTime, 0.01);
                    }
                    function applyRev() {
                        const card = SonicSuite._state.cards[id];
                        if (!card || !card.ctx || !card.ctx.reverbTap) return;
                        card.ctx.reverbTap.gain.setTargetAtTime(+rev.value / 100, ctx.audioCtx.currentTime, 0.02);
                    }

                    fade.addEventListener('input', () => { applyFade(); _persist(); });
                    rev.addEventListener('input',  () => { applyRev();  _persist(); });
                    mB.addEventListener('click', () => {
                        const on = !mB.classList.contains('muted');
                        mB.classList.toggle('muted', on);
                        SonicSuite.setMute(id, on);
                        applyFade(); _persist();
                    });
                    sB.addEventListener('click', () => {
                        const solo = !sB.classList.contains('focused');
                        // Clear other solos
                        strips.querySelectorAll('.ss-mx-s').forEach(b => b.classList.remove('focused'));
                        if (solo) sB.classList.add('focused');
                        SonicSuite.setFocus(solo ? id : null);
                    });

                    // Apply on next tick so cards are registered
                    setTimeout(() => { applyFade(); applyRev(); }, 50);
                });

                // Master reverb return
                const revret = master.querySelector('.ss-mx-revret');
                if (persisted.__master && persisted.__master.revret != null) revret.value = persisted.__master.revret;
                revret.addEventListener('input', () => {
                    _setReverbReturn(+revret.value / 100);
                    _persist();
                });
                _setReverbReturn(+revret.value / 100);

                function _persist() {
                    const s = {};
                    strips.querySelectorAll('[data-strip-id]').forEach(w => {
                        s[w.dataset.stripId] = {
                            fade: +w.querySelector('.ss-mx-fade').value,
                            rev:  +w.querySelector('.ss-mx-rev').value,
                            mute: w.querySelector('.ss-mx-m').classList.contains('muted')
                        };
                    });
                    s.__master = { revret: +revret.value };
                    _save(s);
                }

                // VU meter
                const vu = master.querySelector('.ss-mx-vu');
                const vg = vu.getContext('2d');
                const buf = new Uint8Array(256);
                (function draw() {
                    const an = _getAnalyser();
                    if (an) {
                        an.getByteTimeDomainData(buf);
                        let peak = 0;
                        for (let i = 0; i < buf.length; i++) {
                            const v = Math.abs(buf[i] - 128) / 128;
                            if (v > peak) peak = v;
                        }
                        vg.fillStyle = 'rgba(0,0,0,.5)';
                        vg.fillRect(0, 0, vu.width, vu.height);
                        const h = Math.min(vu.height, peak * vu.height * 1.4);
                        const grad = vg.createLinearGradient(0, vu.height, 0, 0);
                        grad.addColorStop(0, '#00f3ff');
                        grad.addColorStop(0.7, '#ffcc00');
                        grad.addColorStop(1, '#ff4444');
                        vg.fillStyle = grad;
                        vg.fillRect(0, vu.height - h, vu.width, h);
                    }
                    requestAnimationFrame(draw);
                })();

                this._persist = _persist;
            }
        });
    }

    function _getAnalyser() {
        return window._ssAnalyser || null;
    }

    function _setReverbReturn(v) {
        if (window._ssReverbReturn) {
            window._ssReverbReturn.gain.setTargetAtTime(v, window._ssReverbReturn.context.currentTime, 0.02);
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        const btn = document.getElementById('vt-sonic-launch-btn');
        function _once() {
            btn && btn.removeEventListener('click', _once);
            setTimeout(init, 120);
        }
        btn && btn.addEventListener('click', _once);
    });
})();


