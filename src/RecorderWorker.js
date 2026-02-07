// ═══════════════════════════════════════════════════════════════════════════
// VNGRD RecorderWorker — Offloaded Buffer Handler (Web Worker)
// Keeps the UI thread stutter-free by handling all chunk processing here.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const state = {
    chunks: [],
    maxDuration: 30000,
    totalBytes: 0,
    startTime: 0,
    isRecording: false
};

self.onmessage = function (e) {
    const { type, payload } = e.data;

    switch (type) {
        case 'INIT': {
            state.maxDuration = payload.maxDuration || 30000;
            state.chunks = [];
            state.totalBytes = 0;
            state.startTime = Date.now();
            state.isRecording = true;
            self.postMessage({ type: 'STATUS', payload: 'WORKER_ARMED' });
            break;
        }

        case 'CHUNK': {
            if (!state.isRecording) return;

            const { data, time } = payload;
            state.chunks.push({ data, time, size: data.size });
            state.totalBytes += data.size;

            // Prune chunks older than maxDuration
            const cutoff = Date.now() - state.maxDuration;
            const pruned = [];
            let prunedBytes = 0;

            for (let i = state.chunks.length - 1; i >= 0; i--) {
                if (state.chunks[i].time >= cutoff) {
                    pruned.unshift(state.chunks[i]);
                    prunedBytes += state.chunks[i].size;
                }
            }

            state.chunks = pruned;
            state.totalBytes = prunedBytes;

            self.postMessage({
                type: 'BUFFER_STATUS',
                payload: {
                    chunkCount: state.chunks.length,
                    totalBytes: state.totalBytes,
                    durationMs: state.chunks.length > 0
                        ? Date.now() - state.chunks[0].time
                        : 0
                }
            });
            break;
        }

        case 'FLUSH': {
            // Return all buffered chunks for download/export
            const blobs = state.chunks.map(c => c.data);
            const totalSize = state.totalBytes;
            const duration = state.chunks.length > 0
                ? state.chunks[state.chunks.length - 1].time - state.chunks[0].time
                : 0;

            self.postMessage({
                type: 'FLUSH_RESULT',
                payload: {
                    blobs,
                    totalSize,
                    durationMs: duration,
                    chunkCount: state.chunks.length
                }
            }, blobs.map(b => b));

            break;
        }

        case 'STOP': {
            state.isRecording = false;
            state.chunks = [];
            state.totalBytes = 0;
            self.postMessage({ type: 'STATUS', payload: 'WORKER_STOPPED' });
            break;
        }

        case 'GET_STATS': {
            const durationMs = state.chunks.length > 0
                ? Date.now() - state.chunks[0].time
                : 0;
            const durationSec = durationMs / 1000 || 1;
            const bitrate = Math.round((state.totalBytes * 8) / durationSec);

            self.postMessage({
                type: 'STATS',
                payload: {
                    chunkCount: state.chunks.length,
                    totalBytes: state.totalBytes,
                    durationMs,
                    estimatedBitrate: bitrate,
                    isRecording: state.isRecording
                }
            });
            break;
        }

        default:
            self.postMessage({ type: 'ERROR', payload: `Unknown message type: ${type}` });
    }
};
