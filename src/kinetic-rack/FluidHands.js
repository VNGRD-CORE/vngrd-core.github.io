/**
 * FluidHands.js — GPU particle emitter replacing the stick-figure skeleton.
 *
 * Each hand emits a viscous plasma trail from the palm and all 5 fingertips.
 * Particles use AdditiveBlending → natural HDR glow without post-processing.
 *
 *  Left  hand → magenta (#ff00cc) particles
 *  Right hand → cyan    (#00f3ff) particles
 */

const MAX_P      = 400;    // max particles per hand
const EMIT_IDX   = [0, 4, 8, 12, 16, 20]; // palm + fingertip landmarks
const EMIT_BURST = 6;      // new particles per emit-point per frame
const MAX_LIFE   = 0.42;   // particle lifetime (seconds)
const DRAG       = 3.5;    // velocity damping per second

// HSL base colours per hand [hue-deg, saturation, lightness] for THREE.Color.setHSL
const HAND_HSL = [
    [0.88, 1.0, 0.6],   // hand-0 → magenta (LEFT trigger hand)
    [0.54, 1.0, 0.6],   // hand-1 → cyan    (RIGHT modulate hand)
];

export class FluidHands {
    constructor(scene, THREE) {
        this._scene  = scene;
        this._T      = THREE;
        this._built  = false;

        // Per-hand particle pools
        this._pools = [];  // [{pos:Float32Array, vel:[], life:Float32Array}]
        this._geos  = [];  // [BufferGeometry]
        this._mats  = [];  // [PointsMaterial]
        this._pts   = [];  // [Points mesh]
    }

    _build() {
        if (this._built) return;
        this._built = true;
        const T = this._T;

        for (let h = 0; h < 2; h++) {
            const pos  = new Float32Array(MAX_P * 3);
            const life = new Float32Array(MAX_P);       // 0 = dead
            const vel  = Array.from({ length: MAX_P }, () => [0, 0, 0]);

            // Hide all particles initially below the scene
            for (let i = 0; i < MAX_P; i++) pos[i * 3 + 1] = -1e4;

            const geo  = new T.BufferGeometry();
            geo.setAttribute('position', new T.BufferAttribute(pos, 3));

            const [hue, sat, lit] = HAND_HSL[h];
            const col = new T.Color().setHSL(hue, sat, lit);

            const mat = new T.PointsMaterial({
                color:           col,
                size:            0.13,
                sizeAttenuation: true,
                transparent:     true,
                opacity:         0.92,
                blending:        T.AdditiveBlending,
                depthWrite:      false,
            });

            const mesh = new T.Points(geo, mat);
            mesh.renderOrder = 4;
            mesh.visible     = false;
            this._scene.add(mesh);

            this._pools.push({ pos, vel, life });
            this._geos.push(geo);
            this._mats.push(mat);
            this._pts.push(mesh);
        }
    }

    /**
     * Update every frame.
     * @param {Array<Array<THREE.Vector3>|null>} handsW  [leftWorldPts, rightWorldPts]
     *        Each element is an array of 21 Vector3 in world-space, or null if hand absent.
     * @param {number} dt  delta time in seconds
     */
    update(handsW, dt) {
        this._build();

        for (let h = 0; h < 2; h++) {
            const pool = this._pools[h];
            const lm   = handsW[h];
            const mesh = this._pts[h];

            if (lm) {
                mesh.visible = true;

                // ── Emit new particles from palm + fingertips ─────────────────
                for (const idx of EMIT_IDX) {
                    const src = lm[idx];
                    for (let e = 0; e < EMIT_BURST; e++) {
                        const slot = this._deadSlot(pool);
                        const j    = 0.055;
                        pool.pos[slot * 3]     = src.x + (Math.random() - 0.5) * j;
                        pool.pos[slot * 3 + 1] = src.y + (Math.random() - 0.5) * j;
                        pool.pos[slot * 3 + 2] = src.z + (Math.random() - 0.5) * j * 0.35;
                        // Random outward drift
                        const spd = 0.55 + Math.random() * 0.55;
                        const ang = Math.random() * Math.PI * 2;
                        pool.vel[slot][0] = Math.cos(ang) * spd;
                        pool.vel[slot][1] = Math.sin(ang) * spd + 0.18; // slight upward bias
                        pool.vel[slot][2] = (Math.random() - 0.5) * 0.3;
                        pool.life[slot]   = MAX_LIFE * (0.4 + Math.random() * 0.6);
                    }
                }
            }

            // ── Integrate all particles ───────────────────────────────────────
            let anyAlive = false;
            for (let i = 0; i < MAX_P; i++) {
                if (pool.life[i] <= 0) {
                    pool.pos[i * 3 + 1] = -1e4; // park off-screen
                    continue;
                }
                anyAlive = true;
                pool.life[i] -= dt;

                const v = pool.vel[i];
                pool.pos[i * 3]     += v[0] * dt;
                pool.pos[i * 3 + 1] += v[1] * dt;
                pool.pos[i * 3 + 2] += v[2] * dt;

                // Velocity drag
                const drag = 1 - DRAG * dt;
                v[0] *= drag; v[1] *= drag; v[2] *= drag;

                // Fade opacity toward end of life (achieved by parking dead particles;
                // alive particles use full opacity — AdditiveBlending fades naturally
                // as density drops)
            }

            if (!lm && !anyAlive) mesh.visible = false;

            this._geos[h].attributes.position.needsUpdate = true;
        }
    }

    /** Find a dead (life ≤ 0) particle slot; recycles oldest if all alive. */
    _deadSlot(pool) {
        for (let i = 0; i < MAX_P; i++) {
            if (pool.life[i] <= 0) return i;
        }
        // All alive: find minimum life (oldest)
        let minL = Infinity, minI = 0;
        for (let i = 0; i < MAX_P; i++) {
            if (pool.life[i] < minL) { minL = pool.life[i]; minI = i; }
        }
        return minI;
    }

    clear() {
        for (const pool of this._pools) pool.life.fill(0);
        for (const m of this._pts) m.visible = false;
    }

    dispose() {
        for (let i = 0; i < this._pts.length; i++) {
            this._scene.remove(this._pts[i]);
            this._geos[i].dispose();
            this._mats[i].dispose();
        }
    }
}
