// ═══════════════════════════════════════════════════════════════
// TRINITY INPUT MODULE — unified mouse + touch bridge for Trinity actors
// Extracted from main.js. Depends on: $, APP (globals from main.js)
// IIFE executes at parse time — must load after main.js.
// ═══════════════════════════════════════════════════════════════

// ═══ TOUCH-BRIDGE — Unified Mouse + Touch for Trinity ═══
// One-finger drag + two-finger pinch (mobile) / mouse drag + ctrl+wheel pinch (desktop)
(function initTouchBridge() {
    var activeActor = null, offsetX = 0, offsetY = 0;
    var pinchActor = null, lastPinchDist = 0;

    // --- Shared utilities ---
    function getCanvas() { return APP.render.canvas || null; }

    function canvasNorm(clientX, clientY) {
        var c = getCanvas(); if (!c) return null;
        var r = c.getBoundingClientRect();
        return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
    }

    function hitTest(pos) {
        var T = APP.trinity, w = APP.render.width, h = APP.render.height;
        if (T.logo3d && T.logo3d.visible) {
            var tw3 = (200 * T.logo3d.scale * (1 / 1920));
            var th3 = (200 * T.logo3d.scale * (1 / 1080));
            if (pos.x >= T.logo3d.x && pos.x <= T.logo3d.x + tw3 && pos.y >= T.logo3d.y && pos.y <= T.logo3d.y + th3) return 'logo3d';
        }
        if (T.logo.visible) {
            var li = $('user-logo-layer');
            if (li && li.naturalWidth > 0) {
                var lw = (li.naturalWidth * T.logo.scale * (w / 1920)) / w;
                var lh = (li.naturalHeight * T.logo.scale * (h / 1080)) / h;
                if (pos.x >= T.logo.x && pos.x <= T.logo.x + lw && pos.y >= T.logo.y && pos.y <= T.logo.y + lh) return 'logo';
            }
        }
        if (T.bug.visible) {
            var bw = Math.max(0.08, 0.08 * T.bug.scale);
            var bh = Math.max(0.03, 0.03 * T.bug.scale);
            if (pos.x >= T.bug.x && pos.x <= T.bug.x + bw && pos.y >= T.bug.y && pos.y <= T.bug.y + bh) return 'bug';
        }
        return null;
    }

    function isUIElement(target) {
        return target.closest && (target.closest('.sidebar') || target.closest('#ghost-bar') || target.closest('button') || target.closest('input') || target.closest('#portrait-lock'));
    }

    function clampPos(v) { return Math.max(0, Math.min(0.95, v)); }

    function applyScale(actor, delta) {
        APP.trinity[actor].scale = Math.max(0.1, Math.min(10, APP.trinity[actor].scale + delta));
    }

    // ─── MOUSE: drag ───
    document.addEventListener('mousedown', function(e) {
        if (isUIElement(e.target)) return;
        var pos = canvasNorm(e.clientX, e.clientY);
        if (!pos) return;
        var actor = hitTest(pos);
        if (!actor) return;
        activeActor = actor;
        offsetX = pos.x - APP.trinity[actor].x;
        offsetY = pos.y - APP.trinity[actor].y;
        e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
        if (!activeActor) return;
        var pos = canvasNorm(e.clientX, e.clientY);
        if (!pos) return;
        APP.trinity[activeActor].x = clampPos(pos.x - offsetX);
        APP.trinity[activeActor].y = clampPos(pos.y - offsetY);
        e.preventDefault();
    });
    document.addEventListener('mouseup', function() { activeActor = null; });

    // ─── MOUSE: ctrl+wheel pinch (Mac trackpad) ───
    document.addEventListener('wheel', function(e) {
        if (!e.ctrlKey) return;
        var pos = canvasNorm(e.clientX, e.clientY);
        if (!pos) return;
        var actor = hitTest(pos);
        if (!actor) return;
        e.preventDefault();
        applyScale(actor, e.deltaY > 0 ? -0.05 : 0.05);
    }, { passive: false });

    // ─── TOUCH: one-finger drag + two-finger pinch ───
    var touchDragActor = null, touchOffX = 0, touchOffY = 0;

    document.addEventListener('touchstart', function(e) {
        if (isUIElement(e.target)) return;

        if (e.touches.length === 1) {
            // ONE FINGER — drag
            var t = e.touches[0];
            var pos = canvasNorm(t.clientX, t.clientY);
            if (!pos) return;
            var actor = hitTest(pos);
            if (!actor) return;
            touchDragActor = actor;
            touchOffX = pos.x - APP.trinity[actor].x;
            touchOffY = pos.y - APP.trinity[actor].y;
            e.preventDefault();
        } else if (e.touches.length === 2) {
            // TWO FINGERS — pinch-to-zoom
            touchDragActor = null;
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            lastPinchDist = Math.sqrt(dx * dx + dy * dy);
            var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            var pos = canvasNorm(mx, my);
            if (pos) pinchActor = hitTest(pos);
        }
    }, { passive: false });

    document.addEventListener('touchmove', function(e) {
        if (e.touches.length === 1 && touchDragActor) {
            // ONE FINGER — drag
            var t = e.touches[0];
            var pos = canvasNorm(t.clientX, t.clientY);
            if (!pos) return;
            APP.trinity[touchDragActor].x = clampPos(pos.x - touchOffX);
            APP.trinity[touchDragActor].y = clampPos(pos.y - touchOffY);
            e.preventDefault();
        } else if (e.touches.length === 2 && pinchActor) {
            // TWO FINGERS — pinch-to-zoom
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var delta = (dist - lastPinchDist) * 0.005;
            applyScale(pinchActor, delta);
            lastPinchDist = dist;
            e.preventDefault();
        }
    }, { passive: false });

    document.addEventListener('touchend', function(e) {
        if (e.touches.length === 0) {
            touchDragActor = null; pinchActor = null; activeActor = null;
            lastPinchDist = 0;
        } else if (e.touches.length === 1) {
            pinchActor = null; lastPinchDist = 0;
            var t = e.touches[0];
            var pos = canvasNorm(t.clientX, t.clientY);
            if (pos) {
                var actor = hitTest(pos);
                if (actor) {
                    touchDragActor = actor;
                    touchOffX = pos.x - APP.trinity[actor].x;
                    touchOffY = pos.y - APP.trinity[actor].y;
                }
            }
        }
    });

    document.addEventListener('touchcancel', function() {
        touchDragActor = null; pinchActor = null; activeActor = null; lastPinchDist = 0;
    });
})();


