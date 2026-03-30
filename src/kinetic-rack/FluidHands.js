/**
 * FluidHands.js — GPU Particle Trail System
 *
 * Each active hand emits a continuous stream of particles that fade out
 * over their lifetime, leaving luminous trails.
 *
 * NO stick-figure skeletons. NO 2D canvas. WebGL only.
 *
 * Architecture:
 *   - Fixed pool of POOL_SIZE particles (ring-buffer allocation)
 *   - Each particle has: position, velocity, life (0→1→0), color, size
 *   - On every frame, N_EMIT new particles spawn at each palm center
 *   - Gravity-well attraction: palms pull nearby living particles
 *   - Custom GLSL: soft radial circles, additive blend
 *
 * Visual signature:
 *   Right hand → cyan trails  (#00f3ff)
 *   Left hand  → magenta/violet trails  (#cc00ff)
 *   Overlap    → white-hot core
 */

import * as THREE from 'three';

const POOL_SIZE  = 4_000;   // total particle pool
const N_EMIT     = 6;       // particles spawned per hand per frame
const LIFE_MAX   = 1.2;     // seconds before full fade
const EMIT_SPEED = 0.4;     // initial scatter speed
const GRAVITY    = 0.08;    // palm attraction strength
const WELL_RANGE = 1.2;
const DAMPING    = 0.94;

const vertexShader = /* glsl */`
attribute float aLife;
attribute float aMaxLife;
attribute float aSize;
attribute vec3  aColor;

varying float vAlpha;
varying vec3  vColor;

void main() {
    vColor = aColor;

    // Life curve: ramp in quickly, fade out slowly
    float t     = aLife / aMaxLife;          // 0..1 normalized age
    float fade  = t < 0.1
                    ? t * 10.0               // fast ramp-in
                    : 1.0 - (t - 0.1) / 0.9; // slow fade-out
    vAlpha = clamp(fade, 0.0, 1.0);

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float sz   = aSize * (300.0 / -mvPos.z) * vAlpha;
    gl_PointSize = clamp(sz, 0.5, 72.0);
    gl_Position  = projectionMatrix * mvPos;
}
`;

const fragmentShader = /* glsl */`
varying float vAlpha;
varying vec3  vColor;

void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    // Soft core glow
    float core  = pow(1.0 - dist * 2.0, 2.5);
    float halo  = pow(1.0 - dist * 1.6, 1.2) * 0.35;
    float alpha = (core + halo) * vAlpha;

    gl_FragColor = vec4(vColor * (core * 2.2 + halo), alpha);
}
`;

export class GravityParticles {
    constructor(scene, THREE_) {
        this._scene = scene;
        this._T     = THREE_ || THREE;

        // Per-particle typed arrays (ring buffer)
        this._pos     = new Float32Array(POOL_SIZE * 3);  // world XYZ
        this._vel     = new Float32Array(POOL_SIZE * 3);  // velocity XYZ
        this._life    = new Float32Array(POOL_SIZE);      // current life (counts up)
        this._maxLife = new Float32Array(POOL_SIZE);      // max life for this particle
        this._size    = new Float32Array(POOL_SIZE);      // point size factor
        this._color   = new Float32Array(POOL_SIZE * 3);  // RGB

        this._head    = 0;   // ring-buffer write head

        this._geo  = null;
        this._mat  = null;
        this._mesh = null;

        this._build();
    }

    _build() {
        const T = this._T;

        // All particles start dead (life = maxLife → fully faded)
        for (let i = 0; i < POOL_SIZE; i++) {
            this._life[i]    = 1.0;
            this._maxLife[i] = 1.0;
            this._size[i]    = 0.006;
        }

        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(this._pos,     3));
        geo.setAttribute('aLife',    new T.BufferAttribute(this._life,    1));
        geo.setAttribute('aMaxLife', new T.BufferAttribute(this._maxLife, 1));
        geo.setAttribute('aSize',    new T.BufferAttribute(this._size,    1));
        geo.setAttribute('aColor',   new T.BufferAttribute(this._color,   3));

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

    // ── Emit ──────────────────────────────────────────────────────────────────

    /**
     * Spawn N particles at a given world position.
     * @param {THREE.Vector3} origin
     * @param {'left'|'right'} hand
     */
    _emit(origin, hand) {
        for (let k = 0; k < N_EMIT; k++) {
            const i  = this._head % POOL_SIZE;
            this._head++;

            const p = i * 3;

            // Scatter from origin with random velocity
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.random() * Math.PI;
            const spd   = (0.3 + Math.random() * 0.7) * EMIT_SPEED;

            this._pos[p]     = origin.x + (Math.random() - 0.5) * 0.04;
            this._pos[p + 1] = origin.y + (Math.random() - 0.5) * 0.04;
            this._pos[p + 2] = origin.z + (Math.random() - 0.5) * 0.02;

            this._vel[p]     = Math.sin(phi) * Math.cos(theta) * spd;
            this._vel[p + 1] = Math.sin(phi) * Math.sin(theta) * spd;
            this._vel[p + 2] = Math.cos(phi) * spd * 0.3;

            this._life[i]    = 0;
            this._maxLife[i] = 0.6 + Math.random() * LIFE_MAX;
            this._size[i]    = 0.004 + Math.random() * 0.010;

            // Color: left=magenta-violet, right=cyan
            if (hand === 'left') {
                this._color[p]     = 0.6 + Math.random() * 0.4;
                this._color[p + 1] = 0.0 + Math.random() * 0.1;
                this._color[p + 2] = 0.9 + Math.random() * 0.1;
            } else {
                this._color[p]     = 0.0 + Math.random() * 0.1;
                this._color[p + 1] = 0.85 + Math.random() * 0.15;
                this._color[p + 2] = 0.95 + Math.random() * 0.05;
            }
        }
    }

    // ── Update ────────────────────────────────────────────────────────────────

    /**
     * @param {Array<{pos: THREE.Vector3, hand: 'left'|'right'}>} wells
     * @param {number} dt       Delta time in seconds
     * @param {number} elapsed  Total elapsed time
     */
    update(wells, dt, elapsed) {
        // Emit new particles at each palm (index 0 = wrist/palm)
        for (const { pos, hand } of wells) {
            this._emit(pos, hand);
        }

        // Update all particles
        for (let i = 0; i < POOL_SIZE; i++) {
            if (this._life[i] >= this._maxLife[i]) continue;  // dead

            this._life[i] += dt;

            const p = i * 3;
            let vx = this._vel[p], vy = this._vel[p + 1], vz = this._vel[p + 2];
            let px = this._pos[p], py = this._pos[p + 1], pz = this._pos[p + 2];

            // Gravity well attraction toward active hands
            for (const { pos: w } of wells) {
                const dx = w.x - px;
                const dy = w.y - py;
                const dz = w.z - pz;
                const d2 = dx * dx + dy * dy + dz * dz;
                const d  = Math.sqrt(d2) + 1e-4;
                if (d < WELL_RANGE) {
                    const str = GRAVITY / (d2 + 0.05);
                    vx += (dx / d) * str * dt;
                    vy += (dy / d) * str * dt;
                    vz += (dz / d) * str * dt;
                }
            }

            // Damping
            vx *= DAMPING;
            vy *= DAMPING;
            vz *= DAMPING;

            this._vel[p]     = vx;
            this._vel[p + 1] = vy;
            this._vel[p + 2] = vz;

            this._pos[p]     = px + vx * dt;
            this._pos[p + 1] = py + vy * dt;
            this._pos[p + 2] = pz + vz * dt;
        }

        this._geo.attributes.position.needsUpdate = true;
        this._geo.attributes.aLife.needsUpdate    = true;
        this._geo.attributes.aColor.needsUpdate   = true;
    }

    clear() {
        this._vel.fill(0);
        // Kill all particles
        for (let i = 0; i < POOL_SIZE; i++) {
            this._life[i] = this._maxLife[i];
        }
        this._geo.attributes.aLife.needsUpdate = true;
    }

    dispose() {
        this._scene.remove(this._mesh);
        this._geo.dispose();
        this._mat.dispose();
    }
}
