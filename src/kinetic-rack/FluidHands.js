/**
 * FluidHands.js — Gravity-Well Particle System
 *
 * 3 000 particles fill a 3D volume and behave like magnetised dust.
 * Each hand landmark acts as a GRAVITY WELL attracting nearby particles.
 * The result: hands "shape space" rather than drawing literal fingers.
 *
 * Visual signature:
 *   • Resting field   → cold indigo/deep-blue, gently drifting
 *   • Near left hand  → warm magenta (#ff00cc) burst
 *   • Near right hand → cool cyan (#00f3ff) burst
 *   • Overlap zone    → white hot core
 *
 * Rendered with a custom GLSL ShaderMaterial + AdditiveBlending so
 * particle density builds naturally into HDR bloom.
 */

const N          = 3_000;   // total particle count
const SPREAD_X   = 2.2;
const SPREAD_Y   = 1.4;
const SPREAD_Z   = 0.5;

const SPRING     = 0.55;    // restoring force toward home position
const GRAVITY    = 0.18;    // gravity-well strength
const WELL_RANGE = 1.0;     // max influence radius
const DAMPING    = 0.88;
const MAX_SPEED  = 2.2;

// ── GLSL ─────────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */`
attribute float aLife;
attribute float aSize;
attribute vec3  aColor;

varying float vLife;
varying vec3  vColor;

void main() {
    vLife  = aLife;
    vColor = aColor;

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);

    // Perspective-correct point size; max 64 px to avoid GPU caps issues
    float sz = aSize * (280.0 / -mvPos.z) * aLife;
    gl_PointSize = clamp(sz, 0.5, 64.0);
    gl_Position  = projectionMatrix * mvPos;
}
`;

const fragmentShader = /* glsl */`
varying float vLife;
varying vec3  vColor;

void main() {
    // Radial soft circle from point centre
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float alpha = pow(1.0 - dist * 2.0, 1.8) * vLife;
    // Additive blend: multiply colour so bright = white core
    gl_FragColor = vec4(vColor * alpha * 2.4, alpha);
}
`;

// ── GravityParticles class ────────────────────────────────────────────────────

export class GravityParticles {
    constructor(scene, THREE) {
        this._scene = scene;
        this._T     = THREE;

        // Typed-array particle state
        this._pos   = new Float32Array(N * 3);   // current world positions
        this._vel   = new Float32Array(N * 3);   // velocities
        this._home  = new Float32Array(N * 3);   // resting / equilibrium positions
        this._life  = new Float32Array(N);       // 0..1 brightness life flicker
        this._size  = new Float32Array(N);       // per-particle base size
        this._color = new Float32Array(N * 3);   // RGB live color

        // BufferGeometry attributes (set after _build)
        this._geo   = null;
        this._mat   = null;
        this._mesh  = null;

        this._build();
    }

    _build() {
        const T = this._T;

        // Initialise particle home positions + defaults
        for (let i = 0; i < N; i++) {
            const x = (Math.random() - 0.5) * SPREAD_X * 2;
            const y = (Math.random() - 0.5) * SPREAD_Y * 2;
            const z = (Math.random() - 0.5) * SPREAD_Z * 2;

            const p = i * 3;
            this._pos[p]     = x;
            this._pos[p + 1] = y;
            this._pos[p + 2] = z;
            this._home[p]    = x;
            this._home[p + 1]= y;
            this._home[p + 2]= z;

            this._life[i] = 0.3 + Math.random() * 0.7;
            this._size[i] = 0.003 + Math.random() * 0.009;

            // Cold blue-indigo base colour
            const t = Math.random();
            this._color[p]     = 0.04 + t * 0.10;   // R
            this._color[p + 1] = 0.06 + t * 0.14;   // G
            this._color[p + 2] = 0.30 + t * 0.30;   // B
        }

        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(this._pos,   3));
        geo.setAttribute('aLife',    new T.BufferAttribute(this._life,   1));
        geo.setAttribute('aSize',    new T.BufferAttribute(this._size,   1));
        geo.setAttribute('aColor',   new T.BufferAttribute(this._color,  3));

        const mat = new T.ShaderMaterial({
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite:  false,
            blending:    T.AdditiveBlending,
        });

        this._geo  = geo;
        this._mat  = mat;
        this._mesh = new T.Points(geo, mat);
        this._mesh.renderOrder = 5;
        this._scene.add(this._mesh);
    }

    /**
     * Called every frame.
     *
     * @param {Array<{pos: THREE.Vector3, hand: 'left'|'right'}>} wells
     *        Gravity-well positions and their hand side.
     * @param {number} dt       Delta time in seconds.
     * @param {number} elapsed  Total elapsed time (for ambient flicker).
     */
    update(wells, dt, elapsed) {
        for (let i = 0; i < N; i++) {
            const p  = i * 3;
            let px = this._pos[p],     py = this._pos[p + 1], pz = this._pos[p + 2];
            let vx = this._vel[p],     vy = this._vel[p + 1], vz = this._vel[p + 2];
            const hx = this._home[p], hy = this._home[p + 1], hz = this._home[p + 2];

            // Spring: pull toward resting position
            vx += (hx - px) * SPRING * dt;
            vy += (hy - py) * SPRING * dt;
            vz += (hz - pz) * SPRING * dt;

            // Gravity wells from hand positions
            let pullL = 0, pullR = 0;
            for (const { pos: w, hand } of wells) {
                const dx = w.x - px;
                const dy = w.y - py;
                const dz = w.z - pz;
                const d2  = dx * dx + dy * dy + dz * dz;
                const d   = Math.sqrt(d2) + 1e-4;
                if (d < WELL_RANGE) {
                    const strength = GRAVITY / (d2 + 0.06);
                    vx += (dx / d) * strength * dt;
                    vy += (dy / d) * strength * dt;
                    vz += (dz / d) * strength * dt;
                    const pull = Math.min(1, strength * 0.6);
                    if (hand === 'left')  pullL = Math.max(pullL, pull);
                    else                  pullR = Math.max(pullR, pull);
                }
            }

            // Velocity damping
            vx *= DAMPING;
            vy *= DAMPING;
            vz *= DAMPING;

            // Speed clamp
            const spd = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (spd > MAX_SPEED) {
                const s = MAX_SPEED / spd;
                vx *= s; vy *= s; vz *= s;
            }

            // Integrate position
            px += vx * dt;
            py += vy * dt;
            pz += vz * dt;

            // Store
            this._pos[p]     = px;
            this._pos[p + 1] = py;
            this._pos[p + 2] = pz;
            this._vel[p]     = vx;
            this._vel[p + 1] = vy;
            this._vel[p + 2] = vz;

            // Colour blend:
            //  cold indigo ──(left pull)──► magenta  (#ff00cc → 1.0, 0.0, 0.8)
            //               ──(right pull)─► cyan    (#00f3ff → 0.0, 0.95, 1.0)
            //  both hands  ──────────────── white hot
            const energy  = Math.min(1, spd / MAX_SPEED * 2);
            const cold    = 1 - Math.max(pullL, pullR);
            const hotMix  = Math.min(pullL, pullR);             // overlap → white

            let cr = 0.04 * cold + 1.0  * pullL + 0.0  * pullR + hotMix;
            let cg = 0.06 * cold + 0.0  * pullL + 0.95 * pullR + hotMix;
            let cb = 0.30 * cold + 0.80 * pullL + 1.0  * pullR + hotMix;

            // Boost by kinetic energy
            cr = Math.min(1, cr + energy * 0.3);
            cg = Math.min(1, cg + energy * 0.15);
            cb = Math.min(1, cb + energy * 0.2);

            // Smooth toward target (avoid hard popping)
            const c = this._color;
            c[p]     = c[p]     * 0.92 + cr * 0.08;
            c[p + 1] = c[p + 1] * 0.92 + cg * 0.08;
            c[p + 2] = c[p + 2] * 0.92 + cb * 0.08;

            // Ambient life flicker (slow sine per particle)
            this._life[i] = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(elapsed * 1.1 + i * 0.073));
        }

        this._geo.attributes.position.needsUpdate = true;
        this._geo.attributes.aLife.needsUpdate    = true;
        this._geo.attributes.aColor.needsUpdate   = true;
    }

    /** Stop all particle motion (keep mesh visible). */
    clear() {
        this._vel.fill(0);
    }

    dispose() {
        this._scene.remove(this._mesh);
        this._geo.dispose();
        this._mat.dispose();
    }
}
