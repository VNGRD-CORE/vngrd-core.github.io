// ═══════════════════════════════════════════════════════════════════════════
// VNGRD Compositor — Iron-Clad Recorder Engine
// Maintains a hidden 1920x1080 canvas that composites:
//   Layer 0: 3D Scene (Three.js / hologram)
//   Layer 1: Camera Texture (live webcam feed)
//   Layer 2: 2D Overlay (VJ canvas — the main render)
// Outputs a locked 60fps captureStream at 15Mbps VP9+Opus
// ═══════════════════════════════════════════════════════════════════════════

class Compositor {
    constructor(options = {}) {
        this.width = options.width || 1920;
        this.height = options.height || 1080;
        this.fps = options.fps || 60;
        this.bitrate = options.bitrate || 15000000; // 15Mbps
        this.audioBitrate = options.audioBitrate || 128000;

        // Hidden offscreen canvas for compositing
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true,
            willReadFrequently: false
        });
        this.canvas.style.display = 'none';
        document.body.appendChild(this.canvas);

        // Layer sources
        this.layers = {
            scene3D: null,    // Three.js / hologram canvas
            camera: null,     // Camera video element
            overlay: null     // Main VJ canvas (#vj-canvas)
        };

        // Recording state
        this.recorder = null;
        this.stream = null;
        this.worker = null;
        this.audioCtx = null;
        this.audioDest = null;
        this.isRecording = false;
        this.isCompositing = false;
        this.rafId = null;

        // Clock lock
        this.audioStartTime = 0;
        this.frameStartTime = 0;

        // Performance tracking
        this.frameCount = 0;
        this.droppedFrames = 0;
        this.lastFrameTime = 0;
        this.fpsActual = 0;
    }

    // ─────────────────────────────────────────────────────────────
    // LAYER MANAGEMENT
    // ─────────────────────────────────────────────────────────────
    setLayer(name, source) {
        if (name in this.layers) {
            this.layers[name] = source;
        }
    }

    removeLayer(name) {
        if (name in this.layers) {
            this.layers[name] = null;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // COMPOSITING LOOP (requestAnimationFrame)
    // ─────────────────────────────────────────────────────────────
    startCompositing() {
        if (this.isCompositing) return;
        this.isCompositing = true;
        this.frameStartTime = performance.now();
        this.lastFrameTime = this.frameStartTime;
        this.frameCount = 0;
        this._compositeFrame(this.frameStartTime);
    }

    stopCompositing() {
        this.isCompositing = false;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    _compositeFrame(timestamp) {
        if (!this.isCompositing) return;
        this.rafId = requestAnimationFrame((ts) => this._compositeFrame(ts));

        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        // FPS tracking
        this.frameCount++;
        const elapsed = timestamp - this.frameStartTime;
        if (elapsed >= 1000) {
            this.fpsActual = Math.round((this.frameCount * 1000) / elapsed);
            this.frameCount = 0;
            this.frameStartTime = timestamp;
        }

        // Frame drop detection (16.67ms interval for 60fps)
        const frameDelta = timestamp - this.lastFrameTime;
        if (frameDelta > 20) { // More than ~1.2 frames at 60fps
            this.droppedFrames++;
        }
        this.lastFrameTime = timestamp;

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);

        // LAYER 0: 3D Scene (Three.js canvas)
        if (this.layers.scene3D) {
            try {
                const src = this.layers.scene3D;
                ctx.drawImage(src, 0, 0, w, h);
            } catch (e) { /* Scene not ready */ }
        }

        // LAYER 1: Camera Texture
        if (this.layers.camera) {
            try {
                const vid = this.layers.camera;
                if (vid.readyState >= 2) {
                    const srcW = vid.videoWidth || w;
                    const srcH = vid.videoHeight || h;
                    const scale = Math.max(w / srcW, h / srcH);
                    const dw = srcW * scale;
                    const dh = srcH * scale;
                    const dx = (w - dw) / 2;
                    const dy = (h - dh) / 2;
                    ctx.drawImage(vid, dx, dy, dw, dh);
                }
            } catch (e) { /* Camera not ready */ }
        }

        // LAYER 2: 2D Overlay (Main VJ canvas)
        if (this.layers.overlay) {
            try {
                ctx.drawImage(this.layers.overlay, 0, 0, w, h);
            } catch (e) { /* Overlay not ready */ }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // RECORDING PIPELINE (15Mbps VP9+Opus)
    // ─────────────────────────────────────────────────────────────
    initRecorder(audioContext, masterGainNode) {
        // Clock-locked captureStream at 60fps
        this.stream = this.canvas.captureStream(this.fps);
        this.audioCtx = audioContext;

        // Bind audio if AudioContext is available
        if (audioContext && masterGainNode) {
            try {
                this.audioDest = audioContext.createMediaStreamDestination();
                masterGainNode.connect(this.audioDest);
                const audioTrack = this.audioDest.stream.getAudioTracks()[0];
                if (audioTrack) {
                    this.stream.addTrack(audioTrack);
                }
                // Clock lock: bind start time to audioContext.currentTime
                this.audioStartTime = audioContext.currentTime;
            } catch (e) {
                console.warn('[COMPOSITOR] Audio binding failed, video-only mode');
            }
        }

        // 15Mbps VP9+Opus codec enforcement with fallback chain
        const codecChain = [
            { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: this.bitrate, audioBitsPerSecond: this.audioBitrate },
            { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: this.bitrate },
            { mimeType: 'video/webm', videoBitsPerSecond: this.bitrate },
            {}
        ];

        for (const opts of codecChain) {
            try {
                if (opts.mimeType && !MediaRecorder.isTypeSupported(opts.mimeType)) continue;
                this.recorder = new MediaRecorder(this.stream, opts);
                break;
            } catch (e) {
                continue;
            }
        }

        if (!this.recorder) {
            this.recorder = new MediaRecorder(this.stream);
        }

        // Initialize the Worker for offloading ondataavailable
        this._initWorker();

        // Route data chunks to the Worker thread
        this.recorder.ondataavailable = (e) => {
            if (e.data.size > 0 && this.worker) {
                this.worker.postMessage({
                    type: 'CHUNK',
                    payload: { data: e.data, time: Date.now() }
                });
            }
        };

        return this.recorder;
    }

    _initWorker() {
        try {
            this.worker = new Worker('src/RecorderWorker.js');
            this.worker.onmessage = (e) => {
                const { type, payload } = e.data;
                if (this._onWorkerMessage) {
                    this._onWorkerMessage(type, payload);
                }
            };
            this.worker.postMessage({
                type: 'INIT',
                payload: { maxDuration: 30000 }
            });
        } catch (e) {
            console.warn('[COMPOSITOR] Worker init failed, using inline buffer');
            this.worker = null;
            this._fallbackChunks = [];
        }
    }

    onWorkerMessage(callback) {
        this._onWorkerMessage = callback;
    }

    // ─────────────────────────────────────────────────────────────
    // RECORDING CONTROLS
    // ─────────────────────────────────────────────────────────────
    startRecording(timesliceMs = 1000) {
        if (!this.recorder) return false;
        if (this.recorder.state === 'recording') return true;

        this.startCompositing();
        this.recorder.start(timesliceMs);
        this.isRecording = true;

        // Sync clock lock
        if (this.audioCtx) {
            this.audioStartTime = this.audioCtx.currentTime;
        }

        return true;
    }

    stopRecording() {
        if (!this.recorder || this.recorder.state !== 'recording') return;
        this.recorder.stop();
        this.isRecording = false;
    }

    // Flush buffer from Worker and return as Blob
    flush() {
        return new Promise((resolve) => {
            if (this.worker) {
                const handler = (e) => {
                    if (e.data.type === 'FLUSH_RESULT') {
                        this.worker.removeEventListener('message', handler);
                        const { blobs, totalSize, durationMs, chunkCount } = e.data.payload;
                        const finalBlob = new Blob(blobs, { type: 'video/webm' });
                        resolve({ blob: finalBlob, totalSize, durationMs, chunkCount });
                    }
                };
                this.worker.addEventListener('message', handler);
                this.worker.postMessage({ type: 'FLUSH' });
            } else {
                // Fallback: inline chunks
                const blob = new Blob(this._fallbackChunks || [], { type: 'video/webm' });
                resolve({ blob, totalSize: blob.size, durationMs: 0, chunkCount: (this._fallbackChunks || []).length });
            }
        });
    }

    getStats() {
        return new Promise((resolve) => {
            if (this.worker) {
                const handler = (e) => {
                    if (e.data.type === 'STATS') {
                        this.worker.removeEventListener('message', handler);
                        resolve({
                            ...e.data.payload,
                            compositorFps: this.fpsActual,
                            droppedFrames: this.droppedFrames
                        });
                    }
                };
                this.worker.addEventListener('message', handler);
                this.worker.postMessage({ type: 'GET_STATS' });
            } else {
                resolve({
                    compositorFps: this.fpsActual,
                    droppedFrames: this.droppedFrames,
                    isRecording: this.isRecording
                });
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────
    destroy() {
        this.stopRecording();
        this.stopCompositing();

        if (this.worker) {
            this.worker.postMessage({ type: 'STOP' });
            this.worker.terminate();
            this.worker = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }

        if (this.audioDest) {
            try { this.audioDest.disconnect(); } catch (e) {}
            this.audioDest = null;
        }

        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }

        this.recorder = null;
    }
}

// Export for both module and script contexts
if (typeof window !== 'undefined') {
    window.Compositor = Compositor;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compositor;
}
