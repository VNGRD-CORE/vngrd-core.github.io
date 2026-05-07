// ═══════════════════════════════════════════════════════════════
// VFX LAYER MODULE — WebGL chromatic aberration + displacement
// Extracted from main.js. Depends on: no external globals at parse time.
// Exports: window.VFXLayer, window._vfxFrameTick
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  VFX LAYER — TouchDesigner-style GLSL Webcam Displacement
//
//  Canvas:   #vfx-layer (z-index 1002, pointer-events:none)
//  Shader:   Chromatic aberration + displacement noise field
//  Webcam:   Texture updated every rAF frame when CAM is online
//  Trigger:  VFXLayer.pulse(delaySec) — called by playSample()
//            every time a ratchet > 1 event fires.
//  u_pulse:  Drives chromatic aberration magnitude in the shader.
//            Accumulated on ratchet fire, decays exponentially.
// ═══════════════════════════════════════════════════════════════
var VFXLayer = (function() {
    var _canvas, _gl;
    var _prog;
    var _unifTime, _unifRes, _unifPulse, _unifCam, _unifHasCam;
    var _camTexture = null;
    var _camSource  = null;  // live <video> element (webcam feed)
    var _pulse      = 0.0;   // accumulated pulse value [0..1]
    var _ready      = false;
    var _frameT0    = 0;     // ── PHASE F Task 2: start time for u_time uniform ──

    /* ── Vertex shader: full-screen clip-space quad ── */
    var VS = [
        'attribute vec2 a_pos;',
        'void main(){gl_Position=vec4(a_pos,0.0,1.0);}'
    ].join('\n');

    /* ── Fragment shader ──
       u_pulse drives chromatic aberration split on the webcam feed.
       Without webcam: renders a cyan noise/pulse procedural field.
    ── */
    var FS = [
        'precision mediump float;',
        'uniform float u_time;',
        'uniform vec2  u_res;',
        'uniform float u_pulse;',       // ratchet energy accumulator
        'uniform sampler2D u_cam;',
        'uniform int   u_hasCam;',

        // Pseudo-random hash (fast, no texture needed)
        'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        // 2D value noise
        'float noise(vec2 p){',
        '  vec2 i=floor(p),f=fract(p);',
        '  f=f*f*(3.0-2.0*f);',
        '  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),',
        '             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);',
        '}',

        'void main(){',
        '  vec2 uv=gl_FragCoord.xy/u_res;',
        '  // Chromatic aberration split magnitude scales with u_pulse',
        '  float abr=u_pulse*0.024+0.001;',

        '  if(u_hasCam==1){',
        '    // Displacement noise jitter (amplitude driven by pulse)',
        '    float n=noise(uv*7.0+u_time*0.5)*u_pulse;',
        '    vec2 disp=vec2(n*0.009,-n*0.005)*u_pulse;',
        '    // RGB channel split — chromatic aberration on webcam',
        '    float r=texture2D(u_cam,uv+disp+vec2( abr,0.0)).r;',
        '    float g=texture2D(u_cam,uv+disp            ).g;',
        '    float b=texture2D(u_cam,uv+disp-vec2( abr,0.0)).b;',
        '    gl_FragColor=vec4(r,g,b,0.55+u_pulse*0.3);',
        '  } else {',
        '    // Procedural fallback: pulsing noise rings (cyan tint)',
        '    float n=noise(uv*5.5+u_time*0.3);',
        '    float ring=abs(sin(n*14.0+u_time*2.2))*u_pulse;',
        '    gl_FragColor=vec4(0.0,ring*0.85,ring*1.0,ring*0.65);',
        '  }',
        '}'
    ].join('\n');

    function _compileShader(gl, type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            console.warn('[VFXLayer] Shader:', gl.getShaderInfoLog(sh));
            gl.deleteShader(sh); return null;
        }
        return sh;
    }

    function _init() {
        _canvas = document.getElementById('vfx-layer');
        if (!_canvas) return false;
        _gl = _canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        if (!_gl) return false;
        var gl = _gl;

        var vs = _compileShader(gl, gl.VERTEX_SHADER,   VS);
        var fs = _compileShader(gl, gl.FRAGMENT_SHADER, FS);
        if (!vs || !fs) return false;
        _prog = gl.createProgram();
        gl.attachShader(_prog, vs); gl.attachShader(_prog, fs);
        gl.linkProgram(_prog);
        if (!gl.getProgramParameter(_prog, gl.LINK_STATUS)) return false;

        // Full-screen triangle strip
        var quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

        gl.useProgram(_prog);
        var posAttr = gl.getAttribLocation(_prog, 'a_pos');
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

        _unifTime   = gl.getUniformLocation(_prog, 'u_time');
        _unifRes    = gl.getUniformLocation(_prog, 'u_res');
        _unifPulse  = gl.getUniformLocation(_prog, 'u_pulse');
        _unifCam    = gl.getUniformLocation(_prog, 'u_cam');
        _unifHasCam = gl.getUniformLocation(_prog, 'u_hasCam');

        // Webcam texture slot (starts with 1×1 black placeholder)
        _camTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, _camTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        _ready = true;
        _startLoop();
        return true;
    }

    // ── PHASE F Task 2: pure tick — called from mainLoop with rAF timestamp ──
    function _frameTick(now) {
        if (!_ready || !_gl) return;
        var gl = _gl;

        // Resize to CSS display size
        var w = _canvas.clientWidth  | 0;
        var h = _canvas.clientHeight | 0;
        if (_canvas.width !== w || _canvas.height !== h) {
            _canvas.width = w; _canvas.height = h;
            gl.viewport(0, 0, w, h);
        }

        // Exponential pulse decay (~8 frames at 60fps)
        _pulse *= 0.88;
        if (_pulse < 0.001) _pulse = 0.0;

        // Show layer opacity proportional to pulse
        _canvas.style.opacity = _pulse > 0.01
            ? String(Math.min(0.78, _pulse * 1.3)) : '0';

        // Upload live webcam frame
        var hasCam = 0;
        if (_camSource && _camSource.readyState >= 2) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, _camTexture);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
                    gl.RGBA, gl.UNSIGNED_BYTE, _camSource);
                hasCam = 1;
            } catch(e) {}
        }

        gl.useProgram(_prog);
        gl.uniform1f(_unifTime,   (now - _frameT0) * 0.001);
        gl.uniform2f(_unifRes,    w, h);
        gl.uniform1f(_unifPulse,  _pulse);
        gl.uniform1i(_unifCam,    0);
        gl.uniform1i(_unifHasCam, hasCam);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function _startLoop() {
        _frameT0 = performance.now();
        // Expose tick to mainLoop (which lives outside this IIFE)
        window._vfxFrameTick = _frameTick;
    }

    // ── Public API ────────────────────────────────────────────
    // pulse(delaySec): add energy after delay (called on ratchet fire)
    function pulse(delaySec) {
        setTimeout(function() {
            _pulse = Math.min(1.0, _pulse + 0.38);
        }, Math.max(0, (delaySec || 0) * 1000));
    }

    // attachCam(videoEl): set the live <video> source for the shader
    function attachCam(videoEl) { _camSource = videoEl || null; }

    // init(): boot once on DOMContentLoaded
    function init() {
        if (!_init()) return;
        // Auto-grab webcam video when CAM_CAPTURE goes online
        setTimeout(function() {
            var vid = document.getElementById('preview-vid-float');
            if (vid && vid.srcObject) attachCam(vid);
        }, 2000);
    }

    return { init: init, pulse: pulse, attachCam: attachCam };
})();

document.addEventListener('DOMContentLoaded', function() { VFXLayer.init(); });


