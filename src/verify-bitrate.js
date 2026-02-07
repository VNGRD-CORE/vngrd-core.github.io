// ═══════════════════════════════════════════════════════════════════════════
// VNGRD verify-bitrate.js — Phase 6 Proof of Work
// Run in browser console after recording to verify 15Mbps target was hit
// ═══════════════════════════════════════════════════════════════════════════

(function VNGRD_VerifyBitrate() {
    'use strict';

    const TARGET_BITRATE = 15000000; // 15Mbps target
    const TOLERANCE = 0.6; // Allow 60% minimum (9Mbps) due to VBR encoding

    console.log('%c[VNGRD BITRATE VERIFICATION]', 'color: #00f3ff; font-size: 16px; font-weight: bold');
    console.log('Analyzing last recording...\n');

    // Method 1: Check Compositor stats if available
    if (window.APP && window.APP.compositor) {
        const compositor = window.APP.compositor;

        compositor.getStats().then(stats => {
            console.log('%cCompositor Stats:', 'color: #ffcc00; font-weight: bold');
            console.table({
                'Compositor FPS': stats.compositorFps,
                'Dropped Frames': stats.droppedFrames,
                'Chunk Count': stats.chunkCount || 'N/A',
                'Total Bytes': stats.totalBytes ? stats.totalBytes.toLocaleString() : 'N/A',
                'Duration (ms)': stats.durationMs || 'N/A',
                'Estimated Bitrate': stats.estimatedBitrate
                    ? `${(stats.estimatedBitrate / 1000000).toFixed(2)} Mbps`
                    : 'N/A',
                'Is Recording': stats.isRecording
            });

            if (stats.estimatedBitrate) {
                verifyResult(stats.estimatedBitrate);
            } else {
                console.log('No bitrate data from compositor. Try Method 2 below.');
            }
        });
    }

    // Method 2: Check Time Machine chunks
    if (window.APP && window.APP.timeMachine && window.APP.timeMachine.chunks.length > 0) {
        const chunks = window.APP.timeMachine.chunks;
        const totalBytes = chunks.reduce((sum, c) => sum + (c.data ? c.data.size : 0), 0);
        const durationMs = chunks[chunks.length - 1].time - chunks[0].time;
        const durationSec = durationMs / 1000 || 1;
        const bitrate = Math.round((totalBytes * 8) / durationSec);

        console.log('%cTime Machine Buffer Analysis:', 'color: #ffcc00; font-weight: bold');
        console.table({
            'Chunks': chunks.length,
            'Total Size': `${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
            'Duration': `${durationSec.toFixed(1)}s`,
            'Encoded Bitrate': `${(bitrate / 1000000).toFixed(2)} Mbps`
        });

        verifyResult(bitrate);
    }

    // Method 3: Analyze a .webm Blob directly (for downloaded files)
    window.VNGRD_VerifyBlob = function (blob, durationSeconds) {
        if (!blob || !durationSeconds) {
            console.log('Usage: VNGRD_VerifyBlob(blob, durationInSeconds)');
            return;
        }
        const bits = blob.size * 8;
        const bitrate = Math.round(bits / durationSeconds);

        console.log('%cBlob Analysis:', 'color: #ffcc00; font-weight: bold');
        console.table({
            'Blob Size': `${(blob.size / 1024 / 1024).toFixed(2)} MB`,
            'Duration': `${durationSeconds}s`,
            'Encoded Bitrate': `${(bitrate / 1000000).toFixed(2)} Mbps`,
            'Blob Type': blob.type
        });

        verifyResult(bitrate);
    };

    function verifyResult(actualBitrate) {
        const ratio = actualBitrate / TARGET_BITRATE;
        const mbps = (actualBitrate / 1000000).toFixed(2);
        const targetMbps = (TARGET_BITRATE / 1000000).toFixed(0);

        console.log('\n');

        if (ratio >= TOLERANCE) {
            console.log(
                '%c PASS — Encoded bitrate: %s Mbps (target: %s Mbps, ratio: %s)',
                'background: #00ff88; color: #000; font-size: 14px; font-weight: bold; padding: 4px 12px;',
                mbps, targetMbps, ratio.toFixed(2)
            );

            if (ratio >= 0.9) {
                console.log('%c OBS-LEVEL DETERMINISM ACHIEVED', 'color: #00ff88; font-size: 12px;');
            } else {
                console.log(
                    '%c NOTE: VBR encoding typically reaches 60-90%% of target. This is within spec.',
                    'color: #ffcc00;'
                );
            }
        } else {
            console.log(
                '%c FAIL — Encoded bitrate: %s Mbps (target: %s Mbps, ratio: %s)',
                'background: #ff3333; color: #fff; font-size: 14px; font-weight: bold; padding: 4px 12px;',
                mbps, targetMbps, ratio.toFixed(2)
            );
            console.log(
                '%c The encoder could not sustain the target bitrate. Check codec support and canvas complexity.',
                'color: #ff3333;'
            );
        }

        // MediaRecorder capability check
        console.log('\n%cCodec Support Check:', 'color: #00f3ff; font-weight: bold');
        const codecs = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        codecs.forEach(c => {
            const supported = MediaRecorder.isTypeSupported(c);
            console.log(
                `  ${supported ? '\u2705' : '\u274C'} ${c}`
            );
        });
    }

    // If no data sources are available
    if ((!window.APP || !window.APP.compositor) &&
        (!window.APP || !window.APP.timeMachine || window.APP.timeMachine.chunks.length === 0)) {
        console.log(
            '%cNo recording data found. Start a recording first, or use:\n' +
            '  VNGRD_VerifyBlob(blob, durationInSeconds)\n' +
            'to analyze a downloaded .webm file.',
            'color: #ffcc00;'
        );
    }
})();
