/**
 * mediapipe-worker.js — Isolated MediaPipe Hand Landmarker
 *
 * Runs entirely off the main thread. Receives raw RGBA pixel buffers from
 * the main thread via Transferable ArrayBuffers, runs detection, and posts
 * back packed landmark Float32Arrays — also as Transferables — at 60 FPS.
 *
 * Protocol:
 *   Main → Worker:
 *     { type: 'INIT' }
 *     { type: 'DETECT', buffer: ArrayBuffer, width: number, height: number, timestamp: number }
 *
 *   Worker → Main:
 *     { type: 'READY' }
 *     { type: 'ERROR', message: string }
 *     { type: 'LANDMARKS', data: ArrayBuffer, handedness: ArrayBuffer, count: number }
 *       data      — Float32Array: [hand0_lm0_x, hand0_lm0_y, hand0_lm0_z, …, hand1_lm20_z]
 *                   2 hands × 21 landmarks × 3 floats = 126 floats
 *       handedness — Uint8Array[2]:  0=unknown, 1=Left, 2=Right
 *       count      — number of hands detected (0–2)
 */

'use strict';

const LMS_PER_HAND  = 21;
const FLOATS_PER_LM = 3;
const LM_FLOATS     = LMS_PER_HAND * FLOATS_PER_LM; // 63
const MAX_HANDS     = 2;

let handLandmarker = null;
let ready          = false;

// ── Initialise MediaPipe inside the Worker context ────────────────────────────

async function initWorker() {
    try {
        // Dynamic import works in module workers
        const { HandLandmarker, FilesetResolver } = await import(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.js'
        );

        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                // GPU delegate is not available in Worker context; CPU is reliable
                delegate: 'CPU',
            },
            runningMode:                'IMAGE', // VIDEO mode requires DOM video element
            numHands:                   MAX_HANDS,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence:  0.6,
            minTrackingConfidence:      0.5,
        });

        ready = true;
        self.postMessage({ type: 'READY' });

    } catch (err) {
        self.postMessage({ type: 'ERROR', message: err.message });
    }
}

// ── Detection & packing ───────────────────────────────────────────────────────

function detect(buffer, width, height, timestamp) {
    if (!ready || !handLandmarker) return;

    // Reconstruct ImageData from the transferred pixel buffer
    let imageData;
    try {
        imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    } catch (e) {
        return; // invalid frame dimensions
    }

    let results;
    try {
        // detectForVideo requires timestamp; detect() works with ImageData in IMAGE mode
        results = handLandmarker.detect(imageData);
    } catch (_) { return; }

    const hands      = results?.landmarks  ?? [];
    const handedness = results?.handedness ?? [];
    const count      = Math.min(hands.length, MAX_HANDS);

    // Allocate output Transferables
    const landmarkBuf  = new Float32Array(MAX_HANDS * LM_FLOATS);
    const handednessBuf = new Uint8Array(MAX_HANDS);

    for (let h = 0; h < count; h++) {
        const lms   = hands[h];
        const label = handedness[h]?.[0]?.categoryName;
        handednessBuf[h] = label === 'Left' ? 1 : label === 'Right' ? 2 : 0;

        const base = h * LM_FLOATS;
        for (let l = 0; l < LMS_PER_HAND; l++) {
            landmarkBuf[base + l * FLOATS_PER_LM]     = lms[l]?.x ?? 0;
            landmarkBuf[base + l * FLOATS_PER_LM + 1] = lms[l]?.y ?? 0;
            landmarkBuf[base + l * FLOATS_PER_LM + 2] = lms[l]?.z ?? 0;
        }
    }

    // Transfer — zero-copy back to main thread
    self.postMessage(
        {
            type:       'LANDMARKS',
            data:       landmarkBuf.buffer,
            handedness: handednessBuf.buffer,
            count,
        },
        [landmarkBuf.buffer, handednessBuf.buffer]
    );
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (e) => {
    const { type, buffer, width, height, timestamp } = e.data;

    if (type === 'INIT') {
        initWorker();
        return;
    }

    if (type === 'DETECT') {
        detect(buffer, width, height, timestamp);
    }
};
