/**
 * mediapipe-worker.js — MediaPipe HandLandmarker running off the main thread.
 *
 * Protocol (ImageBitmap path — no getImageData, no pixel reads):
 *   Main → Worker:
 *     { type: 'DETECT', imageBitmap: ImageBitmap, now: number }
 *       imageBitmap is transferred (zero-copy); worker closes it after use.
 *
 *   Worker → Main:
 *     { type: 'READY' }
 *     { type: 'RESULT', right: {x,y,z}[] | null, left: {x,y,z}[] | null }
 *     { type: 'ERROR',  message: string }
 *
 * No loops, no rAF. One frame in, one RESULT out.
 */

'use strict';

const TASKS_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_BASE = TASKS_CDN + '/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

let _landmarker = null;
let _ready      = false;

async function _init() {
    try {
        const mod = await import(TASKS_CDN + '/vision_bundle.mjs');
        const fs  = await mod.FilesetResolver.forVisionTasks(WASM_BASE);
        _landmarker = await mod.HandLandmarker.createFromOptions(fs, {
            baseOptions: {
                modelAssetPath: MODEL_URL,
                delegate:       'CPU',  // WebGL not available in Worker context
            },
            runningMode:                'VIDEO',
            numHands:                   2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence:  0.5,
            minTrackingConfidence:      0.5,
        });
        _ready = true;
        self.postMessage({ type: 'READY' });
    } catch (err) {
        self.postMessage({ type: 'ERROR', message: String(err) });
    }
}

function _pick(res) {
    let right = null, left = null;
    if (!res || !res.landmarks || !res.handednesses) return { right, left };
    for (let i = 0; i < res.landmarks.length; i++) {
        const label = res.handednesses[i]?.[0]?.categoryName;
        // Map to plain {x,y,z} objects so structured clone is guaranteed clean.
        const plain = res.landmarks[i].map(({ x, y, z }) => ({ x, y, z }));
        if (label === 'Right') right = plain;
        else if (label === 'Left')  left  = plain;
    }
    return { right, left };
}

self.onmessage = function (e) {
    const { type, imageBitmap, now } = e.data;

    if (type !== 'DETECT') return;

    console.log('[worker] received frame, ready:', _ready);

    if (!_ready || !_landmarker) {
        imageBitmap?.close();
        self.postMessage({ type: 'RESULT', right: null, left: null });
        return;
    }

    let right = null, left = null;
    console.time('detect');
    try {
        const res = _landmarker.detectForVideo(imageBitmap, now);
        ({ right, left } = _pick(res));
    } catch (_) { /* swallow blip — RESULT with nulls keeps _detectInFlight unblocked */ }
    console.timeEnd('detect');
    imageBitmap?.close();
    self.postMessage({ type: 'RESULT', right, left });
};

_init();
