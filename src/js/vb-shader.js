(function() {
'use strict';

// ── State ─────────────────────────────────────────────────────────────
var _vbActive    = false;
var _vbShader    = null;
var _vbLocked    = {};
var _vbMouseLocks= {}; // {shaderName: [x,y]} — per-shader locked mouse positions
var _vbBurstTimer= null;
var _dblTapTimer = {};
var _vbTime      = 0;
var _vbRAF       = null;
var _vbGl        = null;
var _vbProgs     = {};
var _vbTex       = null;
var _vbPrevTex   = null;
var _vbPrevCvs   = null;
var _vbPrevCtx2d = null;
var _vbInited    = false;
var _vbW         = 0;
var _vbH         = 0;
var _vbMouse     = [0.5, 0.5]; // normalised [0-1] mouse position over #stage

// ── GLSL Shaders (GLSL ES 3.00) ───────────────────────────────────────
var VS = '#version 300 es\nin vec2 a;out vec2 v;void main(){v=a*0.5+0.5;v.y=1.0-v.y;gl_Position=vec4(a,0,1);}';

var FS = {
    SLIT_SCAN: [
        '#version 300 es',
        'precision mediump float;',
        'in vec2 v; uniform sampler2D t; uniform sampler2D tPrev;',
        'uniform float time; uniform float uAudio; uniform vec2 uMouse; out vec4 o;',
        'void main(){',
        // Mouse Y = focal band: rows near cursor get max distortion, falls off above/below
        '  float focal=exp(-abs(v.y-uMouse.y)*5.5);',
        '  float amp=(0.012+uMouse.x*0.11+uAudio*0.055)*(0.18+focal*0.82);',
        // 4-harmonic X-wave stack: fundamental + 3 overtones at different speeds
        '  float wx=sin(v.y*17.0+time*3.4)*amp',
        '          +sin(v.y*41.0+time*5.7)*amp*0.35',
        '          +sin(v.y*8.0+time*1.3)*amp*0.55',
        '          +sin(v.y*97.0+time*9.1)*amp*0.12;',
        // Subtle Y-axis bowing for 2D depth (not just horizontal strips)
        '  float wy=cos(v.x*11.0+time*2.3)*amp*0.28+cos(v.x*26.0+time*4.1)*amp*0.14;',
        // Per-channel chromatic separation: R leads, B lags
        '  float rX=clamp(v.x+wx*1.35,0.0,1.0);',
        '  float gX=clamp(v.x+wx,0.0,1.0);',
        '  float bX=clamp(v.x+wx*0.62,0.0,1.0);',
        '  float yW=clamp(v.y+wy,0.0,1.0);',
        '  float r=texture(t,vec2(rX,yW)).r;',
        '  float g=texture(t,vec2(gX,yW)).g;',
        '  float b=texture(t,vec2(bX,yW)).b;',
        '  vec4 cur=vec4(r,g,b,1.0);',
        // Temporal smear: out-of-focus rows blend with prev frame for depth/streaking
        '  vec4 prev=texture(tPrev,vec2(gX,yW));',
        '  float smear=(1.0-focal)*(0.52+uAudio*0.18);',
        '  o=mix(cur,prev,smear);',
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
        'in vec2 v; uniform sampler2D t; uniform float time; uniform float uAudio; uniform vec2 uMouse; out vec4 o;',
        'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'float n(vec2 p){',
        '  vec2 i=floor(p),f=fract(p);',
        '  float a=h(i),b=h(i+vec2(1,0)),c=h(i+vec2(0,1)),d=h(i+vec2(1,1));',
        '  vec2 u=f*f*(3.0-2.0*f);',
        '  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;',
        '}',
        'void main(){',
        // Mouse pulls the water surface origin — moves where the caustic pattern is centred
        '  vec2 pull=(uMouse-0.5)*0.22;',
        // Audio drives choppiness and displacement intensity
        '  float chop=1.0+uAudio*1.8;',
        '  float intensity=0.028+uAudio*0.055;',
        '  vec2 p=v+pull;',
        '  float n1=n(p*5.0*chop+time*0.4);',
        '  float n2=n(p*11.0*chop-time*0.25);',
        '  float n3=n(p*17.0+time*0.15);',
        '  vec2 off=vec2(n1-0.5,n2-0.5)*intensity+vec2(n3-0.5)*intensity*0.38;',
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

    // ── ACID ─────────────────────────────────────────────────────────────
    // LSD trip: image melts and breathes via UV warp. Phase driven purely by
    // X/Y/diagonal spatial sines — NO polar coords, so zero circular ring
    // artifacts. Edge-fade on warp prevents left-edge clamp line. tPrev trails
    // smear with the warp. Mouse creates a local speed-up zone.
    ACID: [
        '#version 300 es',
        'precision mediump float;',
        'in vec2 v; uniform sampler2D t; uniform sampler2D tPrev;',
        'uniform float time; uniform float uAudio; uniform vec2 uMouse; out vec4 o;',
        'void main(){',
        // Edge-fade: ramps warp to 0 near all 4 edges → no clamp artifact lines
        '  float ef=smoothstep(0.0,0.05,min(min(v.x,1.0-v.x),min(v.y,1.0-v.y)));',
        '  float wamp=(0.018+uAudio*0.028)*ef;',
        '  float wx=sin(v.y*3.8+time*1.2)*sin(v.x*2.3+time*0.65)*wamp;',
        '  float wy=cos(v.x*4.1+time*0.85)*cos(v.y*2.7+time*1.35)*wamp;',
        '  vec2 wUV=clamp(v+vec2(wx,wy),0.0,1.0);',
        '  vec4 wrp=texture(t,wUV);',
        '  float luma=dot(wrp.rgb,vec3(0.2126,0.7152,0.0722));',
        // Spatial phase: linear position gradient breaks luma-ring artifacts without atan
        '  vec2 c=v-0.5;',
        '  float ang=c.x*3.5-c.y*2.8;',
        '  float rad=length(c);',
        '  float mBoost=(1.0-smoothstep(0.0,0.38,length(v-uMouse)))*3.5;',
        '  float cycle=time*(0.4+uAudio*2.2+mBoost);',
        '  float phase=luma*1.6+ang*1.1+rad*4.0+sin(v.x*6.2+time*0.6)*0.5+cos(v.y*5.8+time*0.45)*0.4+cycle;',
        '  vec3 acid=vec3(sin(phase*1.00)*0.5+0.5,sin(phase*0.79+2.09)*0.5+0.5,sin(phase*1.13+4.19)*0.5+0.5);',
        // tPrev trails sampled at warped UV — trails warp with the image
        '  vec4 prev=texture(tPrev,wUV);',
        '  float trails=0.30+uAudio*0.18;',
        '  float str=0.65+uAudio*0.28;',
        '  o=vec4(mix(mix(wrp.rgb,acid,str),prev.rgb*0.96,trails),1.0);',
        '}'
    ].join('\n'),

    // ── THERMAL ──────────────────────────────────────────────────────────
    // FLIR iron palette. Heat haze uses upward-scrolling cross-product noise —
    // completely distinct from SLIT_SCAN's horizontal sine bands.
    // Mouse creates a hotspot that amplifies shimmer amplitude, not just color.
    THERMAL: [
        '#version 300 es',
        'precision mediump float;',
        'in vec2 v; uniform sampler2D t; uniform float time; uniform float uAudio; uniform vec2 uMouse; out vec4 o;',
        'vec3 iron(float x){',
        '  float s=clamp(x,0.0,1.0)*4.0;',
        '  vec3 c0=vec3(0.0,0.0,0.13);',
        '  vec3 c1=vec3(0.25,0.0,0.52);',
        '  vec3 c2=vec3(0.88,0.0,0.10);',
        '  vec3 c3=vec3(1.0,0.58,0.0);',
        '  vec3 c4=vec3(1.0,1.0,1.0);',
        '  if(s<1.0)return mix(c0,c1,s);',
        '  if(s<2.0)return mix(c1,c2,s-1.0);',
        '  if(s<3.0)return mix(c2,c3,s-2.0);',
        '  return mix(c3,c4,s-3.0);',
        '}',
        'void main(){',
        // Rising heat haze: noise scrolls UPWARD (v.y space - time) not left-right
        // Cross-product sines create turbulent 2D field, not banded horizontal strips
        '  vec2 up=vec2(v.x*3.8,v.y*5.5-time*0.48);',
        '  float n1=sin(up.x*2.73+sin(up.y*1.91+time*0.19))*0.5+0.5;',
        '  float n2=sin(up.y*3.14+sin(up.x*2.27+time*0.15))*0.5+0.5;',
        // Mouse hotspot: amplifies shimmer (hand over heat source = more haze above it)
        '  float mDist=length(v-uMouse);',
        '  float mZone=(1.0-smoothstep(0.0,0.28,mDist))*1.8;',
        '  float amp=(0.010+uAudio*0.020)*(1.0+mZone);',
        // Distortion: both axes present, upward-bias (rising air bends light vertically)
        '  vec2 shimmer=vec2((n1-0.5)*amp,(n2-0.5)*amp*0.55);',
        '  vec2 uv=clamp(v+shimmer,0.0,1.0);',
        '  float luma=dot(texture(t,uv).rgb,vec3(0.2126,0.7152,0.0722));',
        // FLIR sensor noise (characteristic per-pixel thermal grain)
        '  float grain=(fract(sin(dot(v,vec2(731.2,537.8))*47.3+time*31.7)*43758.5)-0.5)*0.032;',
        '  float mHeat=(1.0-smoothstep(0.0,0.26,mDist))*0.52;',
        '  float heat=clamp(luma+mHeat+uAudio*0.36+grain,0.0,1.0);',
        '  o=vec4(iron(heat),1.0);',
        '}'
    ].join('\n'),

    // ── DATAMOSH ─────────────────────────────────────────────────────────
    // Two modes via uMode (0=CORRUPT, 1=CENSOR).
    // CENSOR: distance is computed from BLOCK CENTER not per-pixel — every pixel
    //   in the same block gets the same zone value → zero ring artifacts.
    //   mix(clean, pixelated, zone²) with bDist > radius returns pure clean.
    // CORRUPT: global matrix scramble, cursor is hotspot, no circle boundary.
    DATAMOSH: [
        '#version 300 es',
        'precision highp float;',
        'in vec2 v; uniform sampler2D t; uniform sampler2D tPrev;',
        'uniform float time; uniform float uAudio; uniform vec2 res; uniform vec2 uMouse; uniform float uMode; out vec4 o;',
        'float h1(float p){return fract(sin(p*127.1)*43758.5453);}',
        'void main(){',
        '  float dist=length(v-uMouse);',

        // ── CENSOR: block-center distance → no per-pixel ring variation ──
        '  if(uMode>0.5){',
        '    float GRID=12.0+uAudio*8.0;',
        // All pixels in the same block share this center → same bDist → same zone
        '    vec2 bCtr=(floor(v*res/GRID)*GRID+GRID*0.5)/res;',
        '    float bDist=length(bCtr-uMouse);',
        '    float zone=1.0-smoothstep(0.0,0.25,bDist);',
        '    o=mix(texture(t,v),texture(t,bCtr),zone*zone);',

        // ── CORRUPT: global matrix scramble, no circle boundary ──
        '  }else{',
        '    float proximity=1.0-smoothstep(0.0,0.44,dist);',
        '    float str=0.06+proximity*0.90;',
        '    float csz=9.0;',
        '    vec2 cCoord=floor(v*res/csz);',
        '    vec2 cUV=fract(v*res/csz);',
        '    float freq=4.0+proximity*(6.0+uAudio*26.0);',
        '    float t2=floor(time*freq+cCoord.y*0.7);',
        '    float cv=h1(cCoord.x*93.7+cCoord.y*41.3+t2);',
        '    float digit=step(0.45,fract(cv*5.3+cUV.y*2.0))',
        '              *step(0.1,cUV.x)*step(cUV.x,0.9)',
        '              *step(0.08,cUV.y)*step(cUV.y,0.92);',
        '    float hShift=(h1(cCoord.x*17.1+t2*0.1)-0.5)*str*0.09;',
        '    vec3 vid=texture(t,clamp(v+vec2(hShift,0.0),0.0,1.0)).rgb;',
        '    float headBright=1.0-smoothstep(0.0,0.35,cUV.y);',
        '    vec3 digitColor=vec3(0.0,0.75+headBright*0.25,0.18)*digit;',
        '    vec3 corrupted=vid*(1.0-str*0.5)+digitColor*str;',
        '    vec3 final=mix(corrupted,texture(tPrev,v).rgb*0.97,0.22*proximity);',
        '    o=vec4(final,1.0);',
        '  }',
        '}'
    ].join('\n'),

    // ── CHROMAFLOW ───────────────────────────────────────────────────────
    // RGB channels orbit independently. Base sep=0.025 always visible.
    // Mouse directly displaces each channel in a different direction.
    // Asymmetric decay rates create rainbow trails — R lingers, B fades fast.
    CHROMAFLOW: [
        '#version 300 es',
        'precision highp float;',
        'in vec2 v; uniform sampler2D t; uniform sampler2D tPrev;',
        'uniform float time; uniform float uAudio; uniform vec2 uMouse; out vec4 o;',
        'void main(){',
        '  float sep=0.025+uAudio*0.09;',
        '  float t1=time*0.45;',
        // Mouse offsets all three channels in different directions
        '  vec2 mc=(uMouse-0.5)*(0.07+uAudio*0.13);',
        '  vec2 vR=vec2(cos(t1),         sin(t1*0.71))       *sep+mc;',
        '  vec2 vG=vec2(cos(t1*0.78+2.1),sin(t1*1.10+0.9))   *sep-mc*0.7;',
        '  vec2 vB=vec2(-cos(t1*1.2+1.4),-sin(t1*0.88+2.7)) *sep+vec2(mc.y,-mc.x);',
        '  float r=texture(t,clamp(v+vR,0.0,1.0)).r;',
        '  float g=texture(t,clamp(v+vG,0.0,1.0)).g;',
        '  float b=texture(t,clamp(v+vB,0.0,1.0)).b;',
        '  vec4 cur=vec4(r,g,b,1.0);',
        '  vec4 prev=texture(tPrev,v);',
        // R trails longest (warm), B fades fastest (cold) → warm→cool smear
        '  vec3 trail=vec3(',
        '    prev.r*(0.92+uAudio*0.06),',
        '    prev.g*(0.87+uAudio*0.06),',
        '    prev.b*(0.82+uAudio*0.06)',
        '  );',
        // 40% current at silence (immediately visible); 15% at loud (long trails)
        '  float blend=0.40-uAudio*0.25;',
        '  o=vec4(mix(trail,cur.rgb,blend),1.0);',
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
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            var err = gl.getShaderInfoLog(s);
            console.error('[VB] Shader compile error:', err);
            if (typeof log === 'function') log('GLSL_ERR: ' + (err || '').split('\n')[0].substring(0, 80));
        }
        return s;
    }
    function makeProgram(fs) {
        var prog = gl.createProgram();
        var vs = compileShader(gl.VERTEX_SHADER, VS);
        var fsh = compileShader(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fsh);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            var lerr = gl.getProgramInfoLog(prog);
            console.error('[VB] Program link error:', lerr);
            if (typeof log === 'function') log('GLSL_LINK_ERR: ' + (lerr || '').substring(0, 80));
        }
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
            audioLoc:  gl.getUniformLocation(prog, 'uAudio'),
            prevLoc:   gl.getUniformLocation(prog, 'tPrev'),
            mouseLoc:  gl.getUniformLocation(prog, 'uMouse'),
            modeLoc:   gl.getUniformLocation(prog, 'uMode')
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

    // Uniforms
    var _audio = (typeof APP !== 'undefined' && APP.audio && APP.audio.bassLevel) ? APP.audio.bassLevel / 255 : 0;
    if (p.audioLoc) gl.uniform1f(p.audioLoc, _audio);
    if (p.timeLoc)  gl.uniform1f(p.timeLoc, _vbTime);
    if (p.resLoc)   gl.uniform2f(p.resLoc, w, h);
    if (p.dirLoc)   gl.uniform2f(p.dirLoc, 1.0, 0.5);
    var _ml = _vbMouseLocks[shader] || _vbMouse;
    if (p.mouseLoc) gl.uniform2f(p.mouseLoc, _ml[0], _ml[1]);
    if (p.modeLoc)  gl.uniform1f(p.modeLoc, window._vbDatamoshMode !== undefined ? window._vbDatamoshMode : 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Save rendered output as previous frame for all feedback shaders
    if ((shader === 'GHOST_ECHO' || shader === 'DATAMOSH' || shader === 'CHROMAFLOW' || shader === 'SLIT_SCAN' || shader === 'ACID') && _vbPrevCvs && _vbPrevCtx2d) {
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
    // Prime tPrev with current vj-canvas so feedback shaders start with content
    if (shaderName === 'DATAMOSH' || shaderName === 'CHROMAFLOW' || shaderName === 'GHOST_ECHO' || shaderName === 'SLIT_SCAN' || shaderName === 'ACID') {
        var _vjC = document.getElementById('vj-canvas');
        if (_vjC && _vbPrevCvs && _vbPrevCtx2d) {
            var _pw = _vjC.width || _vjC.offsetWidth, _ph = _vjC.height || _vjC.offsetHeight;
            if (_pw > 2 && _ph > 2) {
                _vbPrevCvs.width = _pw; _vbPrevCvs.height = _ph;
                try { _vbPrevCtx2d.drawImage(_vjC, 0, 0, _pw, _ph); } catch(e) {}
            }
        }
    }
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
// Toggle per-shader mouse position lock (double-click from stage handler)
window._vbToggleMouseLock = function() {
    if (!_vbShader) return;
    if (_vbMouseLocks[_vbShader]) {
        delete _vbMouseLocks[_vbShader];
        typeof ghostLog === 'function' && ghostLog('FX ' + _vbShader + ' TRACKING', 'sys');
    } else {
        _vbMouseLocks[_vbShader] = [_vbMouse[0], _vbMouse[1]];
        typeof ghostLog === 'function' && ghostLog('FX ' + _vbShader + ' LOCKED', 'sys');
    }
};
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

// ── Cached dimensions: update on resize ──
window.addEventListener('resize', function() {
    var vbCanvas = document.getElementById('vb-canvas');
    if (vbCanvas) { _vbW = vbCanvas.offsetWidth; _vbH = vbCanvas.offsetHeight; }
});

// ── Mouse tracking over #stage for CAUSTICS uMouse uniform ──
document.addEventListener('DOMContentLoaded', function() {
    var _stageEl = document.getElementById('stage');
    if (!_stageEl) return;
    _stageEl.addEventListener('mousemove', function(e) {
        var r = _stageEl.getBoundingClientRect();
        _vbMouse[0] = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        _vbMouse[1] = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
    });
});

})();
