// CyberHangdrum — Frosted Glass Extruded Hexagons + 3D Raycasting + Haptic Ripple
// MeshPhysicalMaterial: transmission=0.62, clearcoat=0.9 → premium frosted-glass look
// On hit: pad physically dips in Z + ripple wave radiates across the surface
// D Kurd scale, inharmonic FM bell synthesis

const R  = 0.35;
const CX = 0.5, CY = 0.72;

// ── Ripple surface shader ──────────────────────────────────────────────────
const RIPPLE_VERT = `
uniform float uRippleT;
varying vec2 vUv;
void main(){
    vUv = uv;
    vec3 pos = position;
    float dist = length(uv - vec2(0.5)) * 2.0;
    float wave = sin(dist * 14.0 - (1.0 - uRippleT) * 22.0)
               * uRippleT * 0.055 * max(0.0, 1.1 - dist * 1.15);
    pos.z += wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const RIPPLE_FRAG = `
uniform float uRippleT;
uniform vec3  uColor;
varying vec2 vUv;
void main(){
    float dist = length(vUv - vec2(0.5)) * 2.0;
    float ring = abs(sin(dist * 14.0 - (1.0 - uRippleT) * 22.0));
    float fade = max(0.0, 1.0 - dist) * uRippleT;
    gl_FragColor = vec4(uColor, ring * fade * 0.72);
}`;

function ringPad(angle, note, freq, color) {
    return { normX: CX + R * Math.cos(angle), normY: CY + R * Math.sin(angle), freq, note, color };
}

const PAD_DEFS = [
    { normX: CX, normY: CY, freq: 146.83, note: 'D3', color: 0x00ffcc, isCenter: true },
    ringPad(-Math.PI/2,              'A3',  220.00, 0x00d4ff),
    ringPad(-Math.PI/2 + Math.PI/4, 'Bb3', 233.08, 0x4488ff),
    ringPad(0,                       'C4',  261.63, 0x8844ff),
    ringPad(Math.PI/4,               'D4',  293.66, 0xff44cc),
    ringPad(Math.PI/2,               'E4',  329.63, 0xff6600),
    ringPad(Math.PI/2 + Math.PI/4,  'F4',  349.23, 0xffcc00),
    ringPad(Math.PI,                 'G4',  392.00, 0x00ff88),
    ringPad(Math.PI + Math.PI/4,    'A4',  440.00, 0x00e8ff),
];

const ALL_TIPS = [4, 8, 12, 16, 20];

// Build a hexagon Shape for ExtrudeGeometry
function _hexShape(r) {
    const s = new THREE_placeholder.Shape();
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6; // flat-top hex
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        i === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
    }
    s.closePath();
    return s;
}

export class CyberHangdrum {
    constructor(scene, audioCtx, THREE, camera, masterDest) {
        this._scene      = scene;
        this._ctx        = audioCtx;
        this._T          = THREE;
        this._cam        = camera;
        this._masterDest = masterDest;

        this._pads   = [];  // { body, cage, ripple, rippleUni, pulseT, dipT }
        this._active = false;
        this._cool   = new Array(PAD_DEFS.length).fill(0);
        this._ray    = null;

        // Audio nodes
        this._masterGain = null;
        this._reverbGain = null;
        this._dryGain    = null;
        this._reverb     = null;
    }

    async init() {
        this._ray = new this._T.Raycaster();
        this._buildMeshes();
        this._buildAudio();
    }

    _hexShape(r) {
        const T = this._T;
        const s = new T.Shape();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const x = Math.cos(a) * r, y = Math.sin(a) * r;
            i === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
        }
        s.closePath();
        return s;
    }

    _buildMeshes() {
        const T = this._T;

        PAD_DEFS.forEach(p => {
            const baseR  = p.isCenter ? 0.52 : 0.26;
            const col    = new T.Color(p.color);
            const colArr = [col.r, col.g, col.b];

            // ── Extruded hexagonal body (frosted glass) ──────────────────────
            const shape = this._hexShape(baseR);
            const extrudeSettings = {
                depth:         0.05,
                bevelEnabled:  true,
                bevelThickness: 0.008,
                bevelSize:      0.006,
                bevelSegments:  3,
            };
            const geo = new T.ExtrudeGeometry(shape, extrudeSettings);
            // Center geometry at Z midpoint so dip animation looks symmetric
            geo.translate(0, 0, -0.025);

            const mat = new T.MeshPhysicalMaterial({
                color:              col,
                emissive:           col,
                emissiveIntensity:  0.10,
                metalness:          0.0,
                roughness:          0.22,
                transmission:       0.62,   // frosted glass
                thickness:          0.28,
                ior:                1.52,
                clearcoat:          0.90,
                clearcoatRoughness: 0.08,
                transparent:        true,
                opacity:            0.88,
            });
            const body = new T.Mesh(geo, mat);
            body.visible = false;
            this._scene.add(body);

            // ── Wireframe cage (EdgesGeometry of extrusion) ──────────────────
            const edgeGeo = new T.EdgesGeometry(geo, 18); // 18° threshold = hex edges only
            const cage = new T.LineSegments(edgeGeo,
                new T.LineBasicMaterial({
                    color: col, transparent: true, opacity: 0.9,
                    blending: T.AdditiveBlending, depthWrite: false,
                })
            );
            cage.visible = false;
            this._scene.add(cage);

            // ── Ripple disc (custom shader, sits in front of pad) ────────────
            const rippleUni = {
                uRippleT: { value: 0 },
                uColor:   { value: new T.Vector3(col.r, col.g, col.b) },
            };
            const rippleMat = new T.ShaderMaterial({
                uniforms:       rippleUni,
                vertexShader:   RIPPLE_VERT,
                fragmentShader: RIPPLE_FRAG,
                transparent:    true,
                depthWrite:     false,
                blending:       T.AdditiveBlending,
                side:           T.DoubleSide,
            });
            const rippleDisc = new T.Mesh(
                new T.CircleGeometry(baseR * 1.05, 48),
                rippleMat
            );
            rippleDisc.visible = false;
            this._scene.add(rippleDisc);

            this._pads.push({ body, cage, rippleDisc, rippleUni, pulseT: 0, dipT: 0 });
        });
    }

    _buildAudio() {
        const ctx = this._ctx;
        const dest = this._masterDest || ctx.destination;

        // Plate reverb IR
        const len = Math.floor(ctx.sampleRate * 3.4);
        const ir  = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++)
                d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 1.6) * (0.5 + 0.5*Math.sin(i*0.003));
        }
        this._reverb = ctx.createConvolver();
        this._reverb.buffer = ir;

        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0.82;
        this._masterGain.connect(dest);

        this._reverbGain = ctx.createGain();
        this._reverbGain.gain.value = 0.55;

        this._dryGain = ctx.createGain();
        this._dryGain.gain.value = 0.58;

        const eq = ctx.createBiquadFilter();
        eq.type = 'peaking'; eq.frequency.value = 1200; eq.gain.value = 3.5; eq.Q.value = 1.2;

        this._reverb.connect(eq); eq.connect(this._masterGain);
        this._dryGain.connect(this._masterGain);
    }

    _playPad(i) {
        const ctx  = this._ctx, freq = PAD_DEFS[i].freq, now = ctx.currentTime;

        const carrier = ctx.createOscillator();
        carrier.type = 'sine'; carrier.frequency.value = freq;

        const ampEnv = ctx.createGain();
        ampEnv.gain.setValueAtTime(0, now);
        ampEnv.gain.linearRampToValueAtTime(0.72, now + 0.003);
        ampEnv.gain.exponentialRampToValueAtTime(0.18, now + 0.28);
        ampEnv.gain.exponentialRampToValueAtTime(0.001, now + 4.2);

        [[2.756,freq*5.5,0.6],[5.404,freq*2.8,0.35],[8.1,freq*1.1,0.15]].forEach(([r,d,dec]) => {
            const m = ctx.createOscillator(), g = ctx.createGain();
            m.type = 'sine'; m.frequency.value = freq * r;
            g.gain.setValueAtTime(d, now); g.gain.exponentialRampToValueAtTime(d*0.02, now+dec);
            m.connect(g); g.connect(carrier.frequency);
            m.start(now); m.stop(now+4.5);
        });

        if (PAD_DEFS[i].isCenter) {
            const sub = ctx.createOscillator(), sg = ctx.createGain();
            sub.type = 'sine'; sub.frequency.value = freq * 0.5;
            sg.gain.setValueAtTime(0.38, now); sg.gain.exponentialRampToValueAtTime(0.001, now+3.0);
            sub.connect(sg); sg.connect(ampEnv);
            sub.start(now); sub.stop(now+3.5);
        }

        carrier.connect(ampEnv);
        ampEnv.connect(this._reverb);
        ampEnv.connect(this._dryGain);
        carrier.start(now); carrier.stop(now+4.5);

        // Haptic: dip backward + ripple wave
        this._pads[i].pulseT = 1.0;
        this._pads[i].dipT   = 1.0;
        this._pads[i].rippleUni.uRippleT.value = 1.0;
    }

    _lm2ndc(lm) {
        return new this._T.Vector2(-(lm.x*2-1), -(lm.y*2-1));
    }

    // World pos for pad center (screen-space → 3D, z=0 plane)
    _s2w(nx, ny) {
        const T = this._T;
        const ndc = new T.Vector3(-(nx*2-1), -(ny*2-1), 0.5);
        ndc.unproject(this._cam);
        const dir = ndc.sub(this._cam.position).normalize();
        const t   = -this._cam.position.z / dir.z;
        return this._cam.position.clone().add(dir.multiplyScalar(t));
    }

    _processHands(hr) {
        if (!hr || !hr.multiHandLandmarks) return;
        const now       = performance.now();
        const padBodies = this._pads.map(p => p.body);

        for (const lms of hr.multiHandLandmarks) {
            for (const tipIdx of ALL_TIPS) {
                const lm = lms[tipIdx]; if (!lm) continue;
                this._ray.setFromCamera(this._lm2ndc(lm), this._cam);
                const hits = this._ray.intersectObjects(padBodies);
                if (!hits.length) continue;
                const pi = padBodies.indexOf(hits[0].object);
                if (pi >= 0 && now > this._cool[pi]) {
                    this._cool[pi] = now + 265;
                    this._playPad(pi);
                }
            }
        }
    }

    activate() {
        this._active = true;
        this._pads.forEach(p => {
            p.body.visible = true;
            p.cage.visible = true;
            p.rippleDisc.visible = true;
        });
    }

    deactivate() {
        this._active = false;
        this._pads.forEach(p => {
            p.body.visible = false;
            p.cage.visible = false;
            p.rippleDisc.visible = false;
        });
    }

    update(hr, t, cam) {
        if (!this._active) return;
        this._cam = cam;
        const T = this._T;

        PAD_DEFS.forEach((def, i) => {
            const pad = this._pads[i];
            const wp  = this._s2w(def.normX, def.normY);
            const s   = 1 + pad.pulseT * 0.28;

            // ── Z-dip animation: pad physically moves backward on hit ────────
            const dipZ = -pad.dipT * 0.22;

            pad.body.position.set(wp.x, wp.y, dipZ);
            pad.body.scale.set(s, s, 1);
            pad.cage.position.set(wp.x, wp.y, dipZ);
            pad.cage.scale.set(s, s, 1);
            pad.rippleDisc.position.set(wp.x, wp.y, dipZ + 0.04);

            // Slow hex rotation for ambient life
            const rot = t * 0.045 + i * 0.35;
            pad.body.rotation.z = rot;
            pad.cage.rotation.z = rot;

            // Decay curves — dip springs back quickly, pulse slower
            if (pad.dipT > 0)   pad.dipT   = Math.max(0, pad.dipT   - 0.08);
            if (pad.pulseT > 0) pad.pulseT = Math.max(0, pad.pulseT - 0.05);

            // Ripple decays — shader reads this uniform
            if (pad.rippleUni.uRippleT.value > 0)
                pad.rippleUni.uRippleT.value = Math.max(0, pad.rippleUni.uRippleT.value - 0.025);

            // Emissive flash on hit
            pad.body.material.emissiveIntensity = 0.10 + pad.pulseT * 4.2;
            pad.cage.material.opacity = 0.55 + pad.pulseT * 0.44;
        });

        this._processHands(hr);
    }
}
