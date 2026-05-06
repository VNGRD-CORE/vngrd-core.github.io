// ═══════════════════════════════════════════════════════════════
// MEDIA LOADER MODULE — Bulk file upload handler
// Extracted from main.js. Depends on: $, APP, log, rotateMedia,
// updateQueueDisplay (globals)
// ═══════════════════════════════════════════════════════════════

// MEDIA & CYCLE LOGIC
function loadMediaFiles(input) {
    const isFirstLoad = APP.media.currentIndex === -1;
    Array.from(input.files).forEach((file, idx) => {
        const url = URL.createObjectURL(file);
        const type = file.type.startsWith('video') ? 'video' : (file.type === 'image/gif' ? 'gif' : 'image');
        const item = { type, url, element: null, name: file.name, duration: type === 'video' ? null : 8, transitionType: 'optical-fade', transitionDuration: 0.8, easing: 'linear', beatSync: false };
        if (type === 'video') {
            const vid = document.createElement('video'); vid.src = url; vid.muted = true; vid.loop = !APP.state.isCycle; vid.playsInline = true; vid.preload = 'auto'; item.element = vid; $('media-container').appendChild(vid);
        } else if (type === 'image') {
            // createObjectURL = native blob ref for GIF animation.
            // gif-host is a direct child of <body> (position:fixed, opacity:0.01).
            // Browser compositor keeps it alive → GIF frames advance each tick.
            const img = document.createElement('img');
            // SCRUB Chrome GIF-freeze attributes BEFORE setting src
            img.removeAttribute('crossOrigin');
            img.style.display = 'block';
            img.style.filter = 'none';
            img.src = url;
            item.element = img;
            var host = $('gif-host');
            if (host) host.appendChild(img);
            // Detect EXIF-correct dimensions (mobile photo orientation)
            img.onload = function() {
                if (typeof createImageBitmap === 'function') {
                    createImageBitmap(img).then(function(bmp) {
                        img._effectiveWidth = bmp.width;
                        img._effectiveHeight = bmp.height;
                        bmp.close();
                    }).catch(function() {});
                }
                if (isFirstLoad && idx === 0) {
                    log('MEDIA: READY [' + file.name + '] ' + img.naturalWidth + 'x' + img.naturalHeight);
                    rotateMedia();
                }
            };
        }
        // gif: element created lazily in rotateMedia/previousMedia; no DOM setup needed here
        APP.media.queue.push(item);
        // Videos and GIFs trigger rotate immediately; images wait for onload callback
        if (isFirstLoad && idx === 0 && (type === 'video' || type === 'gif')) rotateMedia();
    });
    updateQueueDisplay(); $('media-dot').classList.remove('off'); log(`MEDIA: +${input.files.length}`);
}
