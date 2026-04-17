/**
 * mediapipe-worker.js — Isolated MediaPipe HandLandmarker for KineticRack
 *
 * Runs in a Web Worker (type: 'module'). Receives raw video frame pixels
 * via Transferable ArrayBuffer, returns hand landmark data to main thread.
 *
 * Protocol:
 *   Main → Worker  { type: 'INIT' }
 *   Worker → Main  { type: 'READY' }
 *
 *   Main → Worker  { type: 'DETECT', buffer, width, height, timestamp }
 *   Worker → Main  { type: 'LANDMARKS', data: Float32Array.buffer,
 *                    handedness: Uint8Array.buffer, count }
 *
 * Landmark data: count × 21 × 3 floats (x, y, z per landmark)
 * Handedness:    count bytes — 1=Left, 2=Right
 */

import {
    HandLandmarker,
    FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

let _landmarker = null;
let _ready      = false;
let _lastTs     = -1;

async function _init() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        _landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath:
                    'https://storage.googleapis.com/mediapipe-models/' +
                    'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                delegate: 'GPU',
            },
            runningMode:                'VIDEO',
            numHands:                   2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence:  0.6,
            minTrackingConfidence:      0.5,
        });
        _ready = true;
        self.postMessage({ type: 'READY' });
    } catch (e) {
        self.postMessage({ type: 'ERROR', message: String(e) });
    }
}

self.onmessage = async function (e) {
    const { type, buffer, width, height, timestamp } = e.data;

    if (type === 'INIT') {
        await _init();
        return;
    }

    if (type === 'DETECT') {
        if (!_ready || !_landmarker) {
            _postEmpty();
            return;
        }

        try {
            // Reconstruct pixel data from transferred buffer
            const pixels  = new Uint8ClampedArray(buffer);
            const imgData = new ImageData(pixels, width, height);
            const bitmap  = await createImageBitmap(imgData);

            // Ensure monotonically increasing timestamp for VIDEO mode
            const ts = (timestamp > _lastTs) ? timestamp : _lastTs + 1;
            _lastTs  = ts;

            const results = _landmarker.detectForVideo(bitmap, ts);
            bitmap.close();

            const count = results.landmarks?.length ?? 0;
            const LM_F  = 21 * 3; // floats per hand

            const lmBuf = new Float32Array(count * LM_F);
            const hdBuf = new Uint8Array(count);

            for (let h = 0; h < count; h++) {
                const lms   = results.landmarks[h];
                const label = results.handedness[h]?.[0]?.categoryName;
                // MediaPipe returns mirrored labels — swap so 2=viewer's right
                hdBuf[h] = (label === 'Left') ? 2 : 1;

                const base = h * LM_F;
                for (let i = 0; i < 21; i++) {
                    lmBuf[base + i * 3]     = lms[i].x;
                    lmBuf[base + i * 3 + 1] = lms[i].y;
                    lmBuf[base + i * 3 + 2] = lms[i].z ?? 0;
                }
            }

            self.postMessage(
                { type: 'LANDMARKS', data: lmBuf.buffer, handedness: hdBuf.buffer, count },
                [lmBuf.buffer, hdBuf.buffer]
            );

        } catch (err) {
            _postEmpty();
        }
    }
};

function _postEmpty() {
    self.postMessage({
        type:       'LANDMARKS',
        data:       new Float32Array(0).buffer,
        handedness: new Uint8Array(0).buffer,
        count:      0,
    });
}
