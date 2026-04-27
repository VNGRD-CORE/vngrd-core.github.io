(function() {
'use strict';

// ── State ─────────────────────────────────────────────────────────────
var _vbActive    = false;   // Bank B currently selected
var _vbShader    = null;    // Currently active shader name
var _vbLocked    = {};      // { shaderName: true } — persistent/locked
var _vbBurstTimer= null;    // One-shot timer handle
var _dblTapTimer = {};      // Per-button double-tap detection
var _vbTime      = 0;       // Shader uniform time
var _vbRAF       = null;    // requestAnimationFrame handle
var _vbGl        = null;    // WebGL2 context
var _vbProgs     = {};      // Compiled shader programs
var _vbTex       = null;    // Input texture (from vj-canvas)
var _vbPrevTex   = null;    // Previous-frame texture for GHOST_ECHO feedback
var _vbPrevCvs   = null;    // Off-screen 2D canvas storing last rendered frame
var _vbPrevCtx2d = null;    // 2D context for _vbPrevCvs
var _vbInited    = false;
// ── PHASE E Task 3: cached canvas dimensions — avoids offsetWidth/offsetHeight inside the loop ──
var _vbW         = 0;
var _vbH         = 0;

// ── GLSL Shaders (GLSL ES 3.00) ───────────────────────────────────────
var VS = '#version 300 es\nin vec2 a;out vec2 v;void main(){v=a*0.5+0.5;v.y=1.0-v.y;gl_Position=vec4(a,0,1);}';

var FS = {
    SLIT_SCAN: [
        '#version 300 es',
        'precision mediump float;',
        'in vec2 v; uniform sampler2D t; uniform float time; out vec4 o;',
        'void main(){',
        '  float a=sin(v.y*20.0+time*3.0)*0.045+sin(v.y*7.0+time*1.2)*0.018;',
        '  vec4 r=texture(t,vec2(clamp(v.x+a,0.0,1.0),v.y));',
        '  vec4 g=texture(t,vec2(clamp(v.x+a*0.8,0.0,1.0),v.y));',
        '  vec4 b=texture(t,vec2(clamp(v.x+a*1.2,0.0,1.0),v.y));',
        '  o=vec4(r.r,g.g,b.b,1.0);',
        '}'
    ].join('\n'),

    LUMA_BLOOM: [
        '#version 300 es',
        'precision mediump float;',
        'in vec2 v; uniform sampler2D t; uniform vec2 res; out vec4 o;',
        'void main(){',
        '  vec4 c=texture(t,v);',
        '  float luma=dot(c.rgb,vec3(0.2126,0.7152,0.0722));',
        '  vec3 bloom=vec3(0.0);',
        '  if(luma>0.55){',
        '    vec2 px=2.2/res;',
        '    for(int x=-3;x<=3;x++)for(int y=-3;y<=3;y++)',
        '      bloom+=texture(t,v+vec2(float(x),float(y))*px).rgb;',
        '    bloom/=49.0; bloom*=luma*2.0;',
        '  }',
        '  o=vec4(min(c.rgb+bloom,1.0),1.0);',
        '}'
    ].join('\n'),

    DITHER_LUXE: [
        '#version 300 es',
        'precision mediump float;',
        'in vec2 v; uniform sampler2D t; uniform vec2 res; out vec4 o;',
        'float bayer(ivec2 p){',
        '  int x=p.x&3,y=p.y&3,i=y*4+x;',
        '  if(i==0)return 0.0/16.0; if(i==1)return 8.0/16.0;',
        '  if(i==2)return 2.0/16.0; if(i==3)return 10.0/16.0;',
        '  if(i==4)return 12.0/16.0;if(i==5)return 4.0/16.0;',
        '  if(i==6)return 14.0/16.0;if(i==7)return 6.0/16.0;',
        '  if(i==8)return 3.0/16.0; if(i==9)return 11.0/16.0;',
        '  if(i==10)return 1.0/16.0;if(i==11)return 9.0/16.0;',
        '  if(i==12)return 15.0/16.0;if(i==13)return 7.0/16.0;',
        '  if(i==14)return 13.0/16.0;return 5.0/16.0;',
        '}',
        'void main(){',
        '  vec4 c=texture(t,v);',
        '  float luma=dot(c.rgb,vec3(0.2126,0.7152,0.0722));',
        '  float thr=bayer(ivec2(v*res));',
        '  float d=step(thr,luma);',
        '  o=vec4(mix(vec3(0.02),c.rgb,d),1.0);',
        '}'
    ].join('\n'),

    CAUSTICS: [
        '#version 300 es',
        'precision mediump float;',
        'in vec2 v; uniform sampler2D t; uniform float time; out vec4 o;',
        'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'float n(vec2 p){',
        '  vec2 i=floor(p),f=fract(p);',
        '  float a=h(i),b=h(i+vec2(1,0)),c=h(i+vec2(0,1)),d=h(i+vec2(1,1));',
        '  vec2 u=f*f*(3.0-2.0*f);',
        '  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;',
        '}',
        'void main(){',
        '  float n1=n(v*5.0+time*0.4);',
        '  float n2=n(v*11.0-time*0.25);',
        '  float n3=n(v*17.0+time*0.15);',
        '  vec2 off=vec2(n1-0.5,n2-0.5)*0.03+vec2(n3-0.5)*0.01;',
        '  o=texture(t,clamp(v+off,0.0,1.0));',
        '}'
    ].join('\n'),

    GHOST_ECHO: [
        '#version 300 es',
        'precision highp float;',
        'in vec2 v;',
        'uniform sampler2D t;',
        'uniform sampler2D tPrev;',
        'uniform float time;',
        'uniform float uAudio;',
        'out vec4 o;',
        'void main(){',
        '  vec4 cur=texture(t,v);',
        // Subtle UV drift so ghost trails shift rather than stack perfectly
        '  vec2 drift=vec2(sin(time*0.31+v.y*3.8)*0.0009,cos(time*0.19+v.x*2.7)*0.0006);',
        '  vec4 ghost=texture(tPrev,clamp(v+drift,0.0,1.0));',
        // decay: 0.80 at silence → 0.95 at full bass — longer trails on kicks
        '  float decay=0.80+uAudio*0.15;',
        '  o=vec4(cur.rgb+ghost.rgb*decay,1.0);',
        '}'
    ].join('\n'),

    SPECTRAL_MOSH: [
        '#version 300 es',
        'precision highp float;',
        'in vec2 v;',
        'uniform sampler2D t;',
        'uniform float time;',
        'uniform float uAudio;',
        'uniform vec2 res;',
        'out vec4 o;',
        'void main(){',
        '  vec2 px=1.0/max(res,vec2(1.0));',
        // Luminance gradient → per-pixel velocity estimate
        '  vec3 c0=texture(t,v).rgb;',
        '  float lumC=dot(c0,vec3(0.299,0.587,0.114));',
        '  float lumR=dot(texture(t,v+vec2(px.x,0.0)).rgb,vec3(0.299,0.587,0.114));',
        '  float lumU=dot(texture(t,v+vec2(0.0,px.y)).rgb,vec3(0.299,0.587,0.114));',
        // Displacement magnitude grows with bass
        '  float mag=(0.006+uAudio*0.022)*26.0;',
        '  vec2 shift=vec2(lumR-lumC,lumU-lumC)*mag;',
        // Time-modulated channel separation — each channel bleeds differently
        '  float tmod=time*0.38;',
        '  float r=texture(t,clamp(v+shift*1.9,0.0,1.0)).r;',
        '  float g=texture(t,clamp(v+shift*0.55+vec2(sin(tmod)*0.0025,0.0),0.0,1.0)).g;',
        '  float b=texture(t,clamp(v-shift*1.4+vec2(0.0,cos(tmod)*0.002),0.0,1.0)).b;',
        // Blend: only apply mosh where gradient is strong enough
        '  float edge=clamp(length(shift)*35.0,0.0,1.0);',
        '  o=vec4(mix(c0,vec3(r,g,b),edge),1.0);',
        '}'
    ].join('\n')
};

// ── WebGL init ────────────────────────────────────────────────────────
function _initVB() {
    if (_vbInited) return;
    var canvas = document.getElementById('vb-canvas');
    if (!canvas) return;
    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
    if (!gl) { console.warn('[VB] WebGL2 not supported'); return; }
    _vbGl = gl;

    function compileShader(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            console.error('[VB] Shader compile error:', gl.getShaderInfoLog(s));
        return s;
    }
    function makeProgram(fs) {
        var prog = gl.createProgram();
        gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
            console.error('[VB] Program link error:', gl.getProgramInfoLog(prog));
        return prog;
    }

    Object.keys(FS).forEach(function(name) {
        var prog = makeProgram(FS[name]);
        _vbProgs[name] = {
            prog:      prog,
            aLoc:      gl.getAttribLocation(prog, 'a'),
            tLoc:      gl.getUniformLocation(prog, 't'),
            timeLoc:   gl.getUniformLocation(prog, 'time'),
            resLoc:    gl.getUniformLocation(prog, 'res'),
            dirLoc:    gl.getUniformLocation(prog, 'dir'),
            audioLoc:  gl.getUniformLocation(prog, 'uAudio'),  // bass 0-1
            prevLoc:   gl.getUniformLocation(prog, 'tPrev')    // feedback frame
        };
    });

    // Off-screen canvas for GHOST_ECHO frame feedback
    _vbPrevCvs = document.createElement('canvas');
    _vbPrevCvs.width = 2; _vbPrevCvs.height = 2;
    _vbPrevCtx2d = _vbPrevCvs.getContext('2d');
    _vbPrevTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, _vbPrevTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Seed with opaque black
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));

    // Fullscreen quad
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    _vbGl._quadBuf = buf;

    // Input texture
    _vbTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, _vbTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    _vbInited = true;
}

// ── Render tick — PHASE F Task 1: own rAF removed, called from mainLoop every frame ──
function _vbRender() {
    var shader = _vbShader;
    if (!shader || !_vbInited) return;

    var vjCanvas = document.getElementById('vj-canvas');
    var vbCanvas = document.getElementById('vb-canvas');
    var gl = _vbGl;
    if (!vjCanvas || !vbCanvas || !gl) return;

    // ── PHASE E Task 3: use cached dimensions; offsetWidth/offsetHeight only as first-run fallback ──
    var w = _vbW, h = _vbH;
    if (w === 0 || h === 0) { w = vbCanvas.offsetWidth; h = vbCanvas.offsetHeight; _vbW = w; _vbH = h; }
    if (vbCanvas.width !== w || vbCanvas.height !== h) {
        vbCanvas.width = w; vbCanvas.height = h;
        gl.viewport(0, 0, w, h);
    }

    _vbTime += 0.016;
    var p = _vbProgs[shader];
    if (!p) return;

    // Upload VJ canvas as texture
    gl.bindTexture(gl.TEXTURE_2D, _vbTex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vjCanvas); }
    catch(e) { return; }

    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl._quadBuf);
    gl.enableVertexAttribArray(p.aLoc);
    gl.vertexAttribPointer(p.aLoc, 2, gl.FLOAT, false, 0, 0);

    // Texture unit 0 — current frame from vj-canvas
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, _vbTex);
    gl.uniform1i(p.tLoc, 0);

    // Texture unit 1 — previous frame (GHOST_ECHO feedback)
    if (p.prevLoc && _vbPrevTex) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, _vbPrevTex);
        if (_vbPrevCvs && _vbPrevCvs.width > 2) {
            try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, _vbPrevCvs); } catch(e) {}
        }
        gl.uniform1i(p.prevLoc, 1);
        gl.activeTexture(gl.TEXTURE0);
    }

    // Audio uniform — bass level normalised 0-1
    var _audio = (typeof APP !== 'undefined' && APP.audio && APP.audio.bassLevel) ? APP.audio.bassLevel / 255 : 0;
    if (p.audioLoc) gl.uniform1f(p.audioLoc, _audio);
    if (p.timeLoc)  gl.uniform1f(p.timeLoc, _vbTime);
    if (p.resLoc)   gl.uniform2f(p.resLoc, w, h);
    if (p.dirLoc)   gl.uniform2f(p.dirLoc, 1.0, 0.5);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Save rendered output as previous frame for GHOST_ECHO feedback
    if (shader === 'GHOST_ECHO' && _vbPrevCvs && _vbPrevCtx2d) {
        if (_vbPrevCvs.width !== w || _vbPrevCvs.height !== h) {
            _vbPrevCvs.width = w; _vbPrevCvs.height = h;
        }
        try { _vbPrevCtx2d.drawImage(vbCanvas, 0, 0, w, h); } catch(e) {}
    }

    // ── UNIFIED RECORDER BLIT ─────────────────────────────────────────
    // Composite Bank B output onto vj-canvas so captureStream captures it.
    // renderLoop always runs before _vbRender (registered first), so this
    // blit lands after the full 2D frame is drawn — clean composition.
    try {
        var _mainCtx = vjCanvas.getContext('2d');
        if (_mainCtx) _mainCtx.drawImage(vbCanvas, 0, 0, vjCanvas.width, vjCanvas.height);
    } catch(e) {}
}

// ── Activate / deactivate shader ──────────────────────────────────────
function _vbActivate(shaderName, persistent) {
    if (!_vbInited) _initVB();
    var vbCanvas = document.getElementById('vb-canvas');
    _vbShader = shaderName;
    if (vbCanvas) vbCanvas.style.display = 'block';
    // ── PHASE F: rAF boot removed — mainLoop drives _vbRender via window._vbRenderTick ──
    if (persistent) {
        _vbLocked[shaderName] = true;
    }
    _vbUpdateUI(shaderName, persistent);
    var hasLocked = Object.keys(_vbLocked).length > 0;
    var statusEl = document.getElementById('vb-sys-status');
    if (statusEl) statusEl.textContent = hasLocked ? 'SYSTEM_STATUS: GPU_FX_ACTIVE' : 'SYSTEM_STATUS: STANDBY';
    var dot = document.getElementById('vb-status-dot');
    if (dot) dot.classList.toggle('on', hasLocked);
}

function _vbDeactivate(shaderName) {
    delete _vbLocked[shaderName];
    var hasLocked = Object.keys(_vbLocked).length > 0;
    if (!hasLocked) {
        _vbShader = null;
        var vbCanvas = document.getElementById('vb-canvas');
        if (vbCanvas) vbCanvas.style.display = 'none';
    } else {
        // Switch to another locked shader
        _vbShader = Object.keys(_vbLocked)[0];
    }
    _vbUpdateUI(shaderName, false);
    var statusEl = document.getElementById('vb-sys-status');
    if (statusEl) statusEl.textContent = hasLocked ? 'SYSTEM_STATUS: GPU_FX_ACTIVE' : 'SYSTEM_STATUS: STANDBY';
    var dot = document.getElementById('vb-status-dot');
    if (dot) dot.classList.toggle('on', hasLocked);
}

function _vbUpdateUI(shaderName, locked) {
    var btn = document.getElementById('vb-' + shaderName);
    if (!btn) return;
    // CSS handles all color/glow via .va-btn.active-fx + --va-color
    btn.classList.toggle('active-fx', locked);
    btn.style.borderColor = '';
    btn.style.boxShadow = '';
    btn.style.color = '';
}

// Expose internals for coupling and ghost voice commands
window._vbActivate   = function(sn, p) { _vbActivate(sn, p); };
window._vbDeactivate = function(sn)    { _vbDeactivate(sn); };
// ── PHASE F Task 1: expose tick so mainLoop (outside this IIFE) can drive rendering ──
window._vbRenderTick = _vbRender;

// ── Coupling-system activate: GPU render + CSS body class + 3s auto-off ──
// Used by _fireCoupledFX so all 6 shaders (incl. GHOST_ECHO, SPECTRAL_MOSH) fire correctly.
window._vbCoupleActivate = function(sn) {
    _vbActivate(sn, false);                    // GPU: sets _vbShader, shows vb-canvas
    document.body.classList.add('vb-' + sn);   // CSS: activates CSS-filter shaders
    var btn = document.getElementById('vb-' + sn);
    if (btn) btn.classList.add('on');
    setTimeout(function() {
        _vbDeactivate(sn);                         // GPU: clears _vbShader if no locks
        document.body.classList.remove('vb-' + sn);
        if (btn) btn.classList.remove('on', 'vb-locked');
    }, 3000);
};

window._setFXBank = function(bank) {
    _vbActive = (bank === 'B');
    var panA = document.getElementById('fx-bank-a-panel');
    var panB = document.getElementById('fx-bank-b-panel');
    var bA   = document.getElementById('fx-bank-a-btn');
    var bB   = document.getElementById('fx-bank-b-btn');
    if (panA) panA.style.display = _vbActive ? 'none' : '';
    if (panB) panB.style.display = _vbActive ? '' : 'none';
    if (bA)  bA.classList.toggle('bank-active', !_vbActive);
    if (bB)  bB.classList.toggle('bank-active', _vbActive);
    if (_vbActive && !_vbInited) _initVB();
};

window._vbClearAll = function() {
    Object.keys(_vbLocked).forEach(_vbDeactivate);
    _vbShader = null;
    var vbCanvas = document.getElementById('vb-canvas');
    if (vbCanvas) vbCanvas.style.display = 'none';
    document.querySelectorAll('.vb-btn').forEach(function(b) {
        b.classList.remove('active-fx');
        b.style.borderColor = '';
        b.style.boxShadow = '';
        b.style.color = '';
    });
    var statusEl = document.getElementById('vb-sys-status');
    if (statusEl) statusEl.textContent = 'SYSTEM_STATUS: STANDBY';
    var dot = document.getElementById('vb-status-dot');
    if (dot) dot.classList.remove('on');
};

// ── Single/double-click handler for VB buttons ────────────────────────
function _vbHandleClick(btn) {
    var shaderName = btn.dataset.shader;
    if (!shaderName) return;

    var now = Date.now();
    var lastTap = _dblTapTimer[shaderName] || 0;
    var isDouble = (now - lastTap) < 350;
    _dblTapTimer[shaderName] = now;

    if (_vbLocked[shaderName]) {
        // Already locked — deactivate
        _vbDeactivate(shaderName);
        return;
    }

    if (isDouble) {
        // Double-click: PERSISTENT LOCK
        if (_vbBurstTimer) { clearTimeout(_vbBurstTimer); _vbBurstTimer = null; }
        _vbActivate(shaderName, true);
        log('VB_LOCK: ' + shaderName);
    } else {
        // Single-click: 3-second burst — show active-fx while running
        if (_vbBurstTimer) clearTimeout(_vbBurstTimer);
        _vbActivate(shaderName, false);
        var burstBtn = document.getElementById('vb-' + shaderName);
        if (burstBtn) burstBtn.classList.add('active-fx');
        _vbBurstTimer = setTimeout(function() {
            if (!_vbLocked[shaderName]) {
                _vbDeactivate(shaderName);
                if (burstBtn) burstBtn.classList.remove('active-fx');
            }
            _vbBurstTimer = null;
        }, 3000);
        log('VB_BURST: ' + shaderName);
    }
}

// ── Wire up VB buttons + init Bank A active state ─────────────────────
function _vbWireButtons() {
    document.querySelectorAll('.vb-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { _vbHandleClick(btn); });
    });
    // Set Bank A as active on load
    window._setFXBank('A');
}
document.addEventListener('DOMContentLoaded', _vbWireButtons);
if (document.readyState !== 'loading') { _vbWireButtons(); }

// ── PHASE E Task 3: update cached dimensions whenever the window resizes ──
window.addEventListener('resize', function() {
    var vbCanvas = document.getElementById('vb-canvas');
    if (vbCanvas) { _vbW = vbCanvas.offsetWidth; _vbH = vbCanvas.offsetHeight; }
});

})();
