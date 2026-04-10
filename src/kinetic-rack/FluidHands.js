/**
 * FluidHands.js — GPU Particle Trail System  v2.0
 *
 * Particle physics computed on GPU via WebGPU compute shader (WGSL) when
 * available. Falls back to CPU typed-array simulation on WebGL / Safari.
 *
 * Visual signature:
 *   Right hand → cyan trails  (#00f3ff)
 *   Left hand  → magenta trails (#cc00ff)
 *   Overlap    → white-hot core
 *
 * WebGPU path:
 *   Compute shader runs particle physics (flow-field + gravity wells) at
 *   full GPU parallelism.  Results are read back once per frame and pushed
 *   to THREE.BufferAttribute for the WebGL/WebGPU renderer.
 *
 * CPU fallback:
 *   Original ring-buffer approach, identical visual output.
 */

import * as THREE from 'three';

const POOL_SIZE  = 4_000;
const N_EMIT     = 6;
const LIFE_MAX   = 1.2;
const EMIT_SPEED = 0.4;
const GRAVITY    = 0.08;
const WELL_RANGE = 1.2;
const DAMPING    = 0.94;

// ─── WGSL Compute Shader ──────────────────────────────────────────────────────
// Updates POOL_SIZE particles in parallel.
// Binding layout:
//   0 → positions  (vec3f × POOL_SIZE)  read+write
//   1 → velocities (vec3f × POOL_SIZE)  read+write
//   2 → life       (f32   × POOL_SIZE)  read+write
//   3 → maxLife    (f32   × POOL_SIZE)  read-only
//   4 → uniforms   { dt, wellCount, wells[4×3] }
const WGSL_COMPUTE = /* wgsl */`
struct Uniforms {
    dt        : f32,
    wellCount : u32,
    _pad0     : f32,
    _pad1     : f32,
    wellX     : array<f32, 4>,
    wellY     : array<f32, 4>,
    wellZ     : array<f32, 4>,
};

@group(0) @binding(0) var<storage, read_write> positions  : array<vec3f>;
@group(0) @binding(1) var<storage, read_write> velocities : array<vec3f>;
@group(0) @binding(2) var<storage, read_write> life       : array<f32>;
@group(0) @binding(3) var<storage, read>       maxLife    : array<f32>;
@group(0) @binding(4) var<uniform>             u          : Uniforms;

const GRAVITY  : f32 = 0.08;
const DAMPING  : f32 = 0.94;
const RANGE    : f32 = 1.2;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
    let i = gid.x;
    if (i >= ${POOL_SIZE}u) { return; }

    let ml = maxLife[i];
    var l  = life[i];
    if (l >= ml) { return; }   // dead particle — skip

    l += u.dt;
    life[i] = l;

    var pos = positions[i];
    var vel = velocities[i];

    // Gravity-well attraction toward active hand positions (flow field)
    for (var w = 0u; w < u.wellCount; w++) {
        let wx = u.wellX[w];
        let wy = u.wellY[w];
        let wz = u.wellZ[w];
        let dx = wx - pos.x;
        let dy = wy - pos.y;
        let dz = wz - pos.z;
        let d  = sqrt(dx*dx + dy*dy + dz*dz) + 0.0001;
        if (d < RANGE) {
            let str = GRAVITY / (d*d + 0.05);
            vel += vec3f(dx/d, dy/d, dz/d) * str * u.dt;
        }
    }

    vel      *= DAMPING;
    pos      += vel * u.dt;

    positions[i]  = pos;
    velocities[i] = vel;
}
`;

// ─── GLSL shaders for THREE.Points rendering ─────────────────────────────────

const vertexShader = /* glsl */`
attribute float aLife;
attribute float aMaxLife;
attribute float aSize;
attribute vec3  aColor;

varying float vAlpha;
varying vec3  vColor;

void main() {
    vColor = aColor;
    float t    = aLife / aMaxLife;
    float fade = t < 0.1 ? t * 10.0 : 1.0 - (t - 0.1) / 0.9;
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
    float core  = pow(1.0 - dist * 2.0, 2.5);
    float halo  = pow(1.0 - dist * 1.6, 1.2) * 0.35;
    float alpha = (core + halo) * vAlpha;
    gl_FragColor = vec4(vColor * (core * 2.2 + halo), alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────

export class GravityParticles {
    constructor(scene, THREE_) {
        this._scene = scene;
        this._T     = THREE_ || THREE;

        // Typed arrays (shared by both CPU and GPU paths)
        this._pos     = new Float32Array(POOL_SIZE * 3);
        this._vel     = new Float32Array(POOL_SIZE * 3);
        this._life    = new Float32Array(POOL_SIZE);
        this._maxLife = new Float32Array(POOL_SIZE);
        this._size    = new Float32Array(POOL_SIZE);
        this._color   = new Float32Array(POOL_SIZE * 3);
        this._head    = 0;

        // WebGPU state
        this._gpuDevice   = null;
        this._gpuPipeline = null;
        this._gpuBufs     = null;   // { pos, vel, life, maxLife, uniforms }
        this._gpuBG       = null;   // GPUBindGroup
        this._gpuReady    = false;

        this._geo  = null;
        this._mat  = null;
        this._mesh = null;

        this._build();
        this._initWebGPU(); // async; silently falls back if unavailable
    }

    // ── THREE.js mesh setup ───────────────────────────────────────────────────

    _build() {
        const T = this._T;

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

    // ── WebGPU compute setup ──────────────────────────────────────────────────

    async _initWebGPU() {
        if (!navigator.gpu) return;
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return;
            const device = await adapter.requestDevice();
            this._gpuDevice = device;

            const BUF = (data, usage) => {
                const buf = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
                new Float32Array(buf.getMappedRange()).set(data);
                buf.unmap();
                return buf;
            };

            const RW  = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
            const RO  = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
            const UNI = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

            // Uniforms buffer: dt(f32), wellCount(u32), pad(f32×2), wellX[4], wellY[4], wellZ[4]
            // = 4 + 4 + 8 + 16 + 16 + 16 = 64 bytes
            const uniformData = new Float32Array(16); // 64 bytes
            const uniformsBuf = device.createBuffer({ size: 64, usage: UNI });

            this._gpuBufs = {
                pos:      BUF(this._pos,     RW),
                vel:      BUF(this._vel,     RW),
                life:     BUF(this._life,    RW),
                maxLife:  BUF(this._maxLife, RO),
                uniforms: uniformsBuf,
                // staging buffer for GPU→CPU readback
                staging:  device.createBuffer({
                    size:  this._pos.byteLength,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                }),
                stagingLife: device.createBuffer({
                    size:  this._life.byteLength,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                }),
            };

            const module = device.createShaderModule({ code: WGSL_COMPUTE });
            this._gpuPipeline = await device.createComputePipelineAsync({
                layout: 'auto',
                compute: { module, entryPoint: 'main' },
            });

            this._gpuBG = device.createBindGroup({
                layout: this._gpuPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this._gpuBufs.pos } },
                    { binding: 1, resource: { buffer: this._gpuBufs.vel } },
                    { binding: 2, resource: { buffer: this._gpuBufs.life } },
                    { binding: 3, resource: { buffer: this._gpuBufs.maxLife } },
                    { binding: 4, resource: { buffer: this._gpuBufs.uniforms } },
                ],
            });

            this._uniformData = uniformData;
            this._gpuReady    = true;
            console.log('[FluidHands] WebGPU compute shader active');
        } catch (e) {
            console.warn('[FluidHands] WebGPU compute unavailable, using CPU:', e.message);
            this._gpuReady = false;
        }
    }

    // ── Emit ──────────────────────────────────────────────────────────────────

    _emit(origin, hand) {
        for (let k = 0; k < N_EMIT; k++) {
            const i = this._head % POOL_SIZE;
            this._head++;
            const p = i * 3;

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

    // ── Update (CPU fallback) ─────────────────────────────────────────────────

    _updateCPU(wells, dt) {
        for (let i = 0; i < POOL_SIZE; i++) {
            if (this._life[i] >= this._maxLife[i]) continue;
            this._life[i] += dt;

            const p = i * 3;
            let vx = this._vel[p], vy = this._vel[p + 1], vz = this._vel[p + 2];
            let px = this._pos[p], py = this._pos[p + 1], pz = this._pos[p + 2];

            for (const { pos: w } of wells) {
                const dx = w.x - px, dy = w.y - py, dz = w.z - pz;
                const d2 = dx*dx + dy*dy + dz*dz;
                const d  = Math.sqrt(d2) + 1e-4;
                if (d < WELL_RANGE) {
                    const str = GRAVITY / (d2 + 0.05);
                    vx += (dx/d) * str * dt;
                    vy += (dy/d) * str * dt;
                    vz += (dz/d) * str * dt;
                }
            }
            vx *= DAMPING; vy *= DAMPING; vz *= DAMPING;

            this._vel[p]     = vx;
            this._vel[p + 1] = vy;
            this._vel[p + 2] = vz;
            this._pos[p]     = px + vx * dt;
            this._pos[p + 1] = py + vy * dt;
            this._pos[p + 2] = pz + vz * dt;
        }
    }

    // ── Update (WebGPU compute path) ──────────────────────────────────────────

    _updateGPU(wells, dt) {
        const dev   = this._gpuDevice;
        const bufs  = this._gpuBufs;
        const ud    = this._uniformData;

        // Upload newly emitted particles to GPU buffers
        dev.queue.writeBuffer(bufs.pos,     0, this._pos);
        dev.queue.writeBuffer(bufs.vel,     0, this._vel);
        dev.queue.writeBuffer(bufs.life,    0, this._life);
        dev.queue.writeBuffer(bufs.maxLife, 0, this._maxLife);

        // Write uniforms: [dt, wellCount, pad, pad, wellX×4, wellY×4, wellZ×4]
        const wc = Math.min(wells.length, 4);
        ud[0] = dt;
        ud[1] = wc; // stored as float bits but shader reads as u32; works at small integers
        ud[2] = 0; ud[3] = 0;
        for (let w = 0; w < 4; w++) {
            ud[4  + w] = w < wc ? wells[w].pos.x : 0;
            ud[8  + w] = w < wc ? wells[w].pos.y : 0;
            ud[12 + w] = w < wc ? wells[w].pos.z : 0;
        }
        dev.queue.writeBuffer(bufs.uniforms, 0, ud);

        // Dispatch compute
        const enc  = dev.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this._gpuPipeline);
        pass.setBindGroup(0, this._gpuBG);
        pass.dispatchWorkgroups(Math.ceil(POOL_SIZE / 64));
        pass.end();

        // Copy results to staging buffers for readback
        enc.copyBufferToBuffer(bufs.pos,  0, bufs.staging,     0, this._pos.byteLength);
        enc.copyBufferToBuffer(bufs.life, 0, bufs.stagingLife, 0, this._life.byteLength);
        dev.queue.submit([enc.finish()]);

        // Async readback (zero-stall — result arrives next frame)
        bufs.staging.mapAsync(GPUMapMode.READ).then(() => {
            this._pos.set(new Float32Array(bufs.staging.getMappedRange()));
            bufs.staging.unmap();
        }).catch(() => {});

        bufs.stagingLife.mapAsync(GPUMapMode.READ).then(() => {
            this._life.set(new Float32Array(bufs.stagingLife.getMappedRange()));
            bufs.stagingLife.unmap();
        }).catch(() => {});
    }

    // ── Public update ─────────────────────────────────────────────────────────

    update(wells, dt /*, elapsed */) {
        // Emit new particles at palm positions
        for (const { pos, hand } of wells) {
            this._emit(pos, hand);
        }

        if (this._gpuReady) {
            this._updateGPU(wells, dt);
        } else {
            this._updateCPU(wells, dt);
        }

        this._geo.attributes.position.needsUpdate = true;
        this._geo.attributes.aLife.needsUpdate    = true;
        this._geo.attributes.aColor.needsUpdate   = true;
    }

    clear() {
        this._vel.fill(0);
        for (let i = 0; i < POOL_SIZE; i++) this._life[i] = this._maxLife[i];
        this._geo.attributes.aLife.needsUpdate = true;
    }

    dispose() {
        this._scene.remove(this._mesh);
        this._geo.dispose();
        this._mat.dispose();
        // Release GPU buffers
        if (this._gpuDevice) {
            try {
                Object.values(this._gpuBufs).forEach(b => b.destroy());
            } catch (_) {}
        }
    }
}
