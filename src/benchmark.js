// ═══════════════════════════════════════════════════════════════════════════
// VNGRD DIAGNOSTIC — Phase 0 Baseline Benchmark
// Run in browser console to measure current recording performance
// ═══════════════════════════════════════════════════════════════════════════

(function VNGRD_Benchmark() {
    'use strict';

    const BENCHMARK_DURATION_MS = 5000;
    const results = {
        videoBitsPerSecond: 0,
        frameDropRate: 0,
        avgFps: 0,
        codec: 'unknown',
        canvasResolution: '0x0',
        timestamp: new Date().toISOString()
    };

    const canvas = document.getElementById('vj-canvas');
    if (!canvas) {
        console.error('[VNGRD_BENCH] No #vj-canvas found');
        return;
    }

    results.canvasResolution = `${canvas.width}x${canvas.height}`;

    // Measure FPS over the benchmark window
    let frameCount = 0;
    let startTime = performance.now();
    let rafId;

    function countFrame(ts) {
        frameCount++;
        if (ts - startTime < BENCHMARK_DURATION_MS) {
            rafId = requestAnimationFrame(countFrame);
        }
    }
    rafId = requestAnimationFrame(countFrame);

    // Capture a short recording to measure actual encoded bitrate
    const stream = canvas.captureStream(60);
    const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp9',
        'video/webm'
    ];

    let recorder;
    let selectedMime = 'video/webm';

    for (const mime of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
            selectedMime = mime;
            break;
        }
    }
    results.codec = selectedMime;

    const chunks = [];
    try {
        recorder = new MediaRecorder(stream, {
            mimeType: selectedMime,
            videoBitsPerSecond: 8000000
        });
    } catch (e) {
        recorder = new MediaRecorder(stream);
    }

    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
        cancelAnimationFrame(rafId);

        const elapsed = (performance.now() - startTime) / 1000;
        results.avgFps = Math.round(frameCount / elapsed);

        // Calculate total bytes recorded
        const totalBytes = chunks.reduce((sum, c) => sum + c.size, 0);
        const totalBits = totalBytes * 8;
        const durationSec = BENCHMARK_DURATION_MS / 1000;
        results.videoBitsPerSecond = Math.round(totalBits / durationSec);

        // Frame drop estimate (expected 60fps)
        const expectedFrames = 60 * durationSec;
        const dropped = Math.max(0, expectedFrames - frameCount);
        results.frameDropRate = parseFloat(((dropped / expectedFrames) * 100).toFixed(2));

        // Output results
        console.log('%c[VNGRD BENCHMARK RESULTS]', 'color: #00f3ff; font-size: 14px; font-weight: bold');
        console.table(results);

        const bitrateThreshold = 2000000; // 2Mbps
        if (results.videoBitsPerSecond < bitrateThreshold) {
            console.log(
                '%c UPGRADE REQUIRED: Current bitrate %s bps is below 2Mbps threshold. Proceeding with 15Mbps VP9 pipeline.',
                'color: #ff3333; font-weight: bold',
                results.videoBitsPerSecond.toLocaleString()
            );
        } else {
            console.log(
                '%c BASELINE OK: Current bitrate %s bps exceeds 2Mbps threshold.',
                'color: #00ff88; font-weight: bold',
                results.videoBitsPerSecond.toLocaleString()
            );
        }

        // Expose globally for programmatic access
        window.VNGRD_BENCHMARK = results;

        // Clean up stream tracks
        stream.getTracks().forEach(t => t.stop());
    };

    console.log('[VNGRD_BENCH] Starting %dms benchmark...', BENCHMARK_DURATION_MS);
    recorder.start(1000);

    setTimeout(() => {
        if (recorder.state === 'recording') {
            recorder.stop();
        }
    }, BENCHMARK_DURATION_MS);
})();
