// === 3D LOGO PIPELINE (rebuilt) ===
let THREE = null;
const _3D = { scene: null, camera: null, renderer: null, model: null, ready: false };
const sysLog = (...a) => (window.log || console.log)(...a);

async function ensure3D() {
    if (_3D.ready) return;
    THREE = window.THREE;
    if (!THREE || !THREE.Scene) throw new Error('THREE_NOT_LOADED — check CDN script in <head>');

    const canvas = document.getElementById('three-canvas');
    if (!canvas) throw new Error('CANVAS_NOT_FOUND');

    _3D.scene = new THREE.Scene();

    _3D.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    _3D.camera.position.set(0, 0, 4);
    _3D.camera.lookAt(0, 0, 0);
    _3D.camera.updateProjectionMatrix();

    _3D.renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true, antialias: true });
    // Renderer owns its own canvas (renderer.domElement); no DOM binding so
    // drawImage compositing onto vj-canvas works correctly every frame.
    _3D.renderer.setPixelRatio(1);
    _3D.renderer.setSize(512, 512, false);
    _3D.renderer.setClearColor(0x000000, 0);
    _3D.renderer.outputEncoding = THREE.sRGBEncoding || 3001; // r128 uses outputEncoding

    // Lighting — bright enough to see geometry clearly
    _3D.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0x00ffcc, 1.5);
    key.position.set(3, 4, 5); _3D.scene.add(key);
    const fill = new THREE.DirectionalLight(0x0088ff, 0.8);
    fill.position.set(-3, -1, 2); _3D.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xff3300, 0.4);
    rim.position.set(0, -3, -3); _3D.scene.add(rim);

    _3D.ready = true;
    window._three = _3D;
    sysLog('3D_INIT: WEBGL_OK');
}

function clearModel() {
    if (!_3D.model || !THREE) return;
    _3D.scene.remove(_3D.model);
    _3D.model.traverse(function(obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(function(m) { m.dispose(); });
        }
    });
    _3D.model = null;
}

function centerAndScale(obj) {
    // Reset transforms first
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    obj.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) { sysLog('3D_WARN: EMPTY_BOUNDS'); return; }

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim === 0 || !isFinite(maxDim)) { sysLog('3D_WARN: ZERO_SIZE'); return; }

    const scaleFactor = 2.5 / maxDim;
    obj.scale.setScalar(scaleFactor);
    // Move object so its center is at origin (accounting for scale)
    obj.position.set(-center.x * scaleFactor, -center.y * scaleFactor, -center.z * scaleFactor);
    obj.updateMatrixWorld(true);

    sysLog('3D_FIT: scale=' + scaleFactor.toFixed(3) + ' dim=' + maxDim.toFixed(2));
}

function countMeshes(obj) {
    let count = 0;
    obj.traverse(function(child) { if (child.isMesh || child.isLine || child.isPoints) count++; });
    return count;
}

function applyHUDMaterial(obj) {
    const mat = new THREE.MeshStandardMaterial({
        color: 0x00ddaa, emissive: 0x004433, roughness: 0.4, metalness: 0.6,
        transparent: true, opacity: 0.9, side: THREE.DoubleSide
    });
    obj.traverse(function(child) {
        if (child.isMesh) {
            if (child.geometry && !child.geometry.attributes.normal) {
                child.geometry.computeVertexNormals();
            }
            // Always apply HUD material for uploaded models (they have no textures)
            child.material = mat;
            child.castShadow = false;
            child.receiveShadow = false;
        }
    });
}

// --- FORMAT LOADERS — all use .parse() (no network fetch) ---

async function loadOBJ(file) {
    const OBJLoader = THREE.OBJLoader;
    if (!OBJLoader) throw new Error('OBJ_LOADER_NOT_AVAILABLE');
    const text = await file.text();
    sysLog('3D_OBJ: parsing ' + text.length + ' chars');
    const obj = new OBJLoader().parse(text);
    const meshCount = countMeshes(obj);
    sysLog('3D_OBJ: ' + meshCount + ' meshes found');
    if (meshCount === 0) throw new Error('OBJ_NO_MESHES');
    return obj;
}

async function loadFBX(file) {
    const FBXLoader = THREE.FBXLoader;
    if (!FBXLoader) throw new Error('FBX_LOADER_NOT_AVAILABLE — upload OBJ or STL instead');
    const buf = await file.arrayBuffer();
    const obj = new FBXLoader().parse(buf, '');
    if (countMeshes(obj) === 0) throw new Error('FBX_NO_MESHES');
    return obj;
}

async function loadSTL(file) {
    const STLLoader = THREE.STLLoader;
    if (!STLLoader) throw new Error('STL_LOADER_NOT_AVAILABLE');
    const buf = await file.arrayBuffer();
    const geom = new STLLoader().parse(buf);
    if (!geom || !geom.attributes.position || geom.attributes.position.count === 0) throw new Error('STL_EMPTY');
    geom.computeVertexNormals();
    return new THREE.Mesh(geom);
}

async function loadAMF(file) {
    const text = await file.text();
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const group = new THREE.Group();

    xml.querySelectorAll('object').forEach(function(obj) {
        const meshEl = obj.querySelector('mesh');
        if (!meshEl) return;
        const verts = [];
        meshEl.querySelectorAll('vertices > vertex > coordinates').forEach(function(c) {
            verts.push(
                parseFloat(c.querySelector('x')?.textContent || 0),
                parseFloat(c.querySelector('y')?.textContent || 0),
                parseFloat(c.querySelector('z')?.textContent || 0)
            );
        });
        meshEl.querySelectorAll('volume').forEach(function(vol) {
            const idx = [];
            vol.querySelectorAll('triangle').forEach(function(tri) {
                idx.push(
                    parseInt(tri.querySelector('v1')?.textContent || 0),
                    parseInt(tri.querySelector('v2')?.textContent || 0),
                    parseInt(tri.querySelector('v3')?.textContent || 0)
                );
            });
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            g.setIndex(idx);
            g.computeVertexNormals();
            group.add(new THREE.Mesh(g));
        });
    });

    if (group.children.length === 0) throw new Error('NO_GEOMETRY_IN_AMF');
    return group;
}

async function loadIGES(file) {
    const text = await file.text();
    const lines = text.split('\n');
    const group = new THREE.Group();
    const dirEntries = [];
    const paramData = {};

    for (const line of lines) {
        if (line.length < 73) continue;
        const section = line[72];
        const seqNum = parseInt(line.substring(73).trim());

        if (section === 'D' && seqNum % 2 === 1) {
            dirEntries.push({ type: parseInt(line.substring(0, 8).trim()), seq: seqNum });
        }
        if (section === 'P') {
            const dePtr = parseInt(line.substring(64, 72).trim());
            if (!paramData[dePtr]) paramData[dePtr] = '';
            paramData[dePtr] += line.substring(0, 64);
        }
    }

    const pts = [];
    for (const de of dirEntries) {
        const raw = paramData[de.seq];
        if (!raw) continue;
        const vals = raw.replace(/;.*$/, '').trim().split(',').map(function(s) { return s.trim(); });

        if (de.type === 110 && vals.length >= 7) {
            const coords = vals.slice(1, 7).map(Number);
            if (coords.every(function(n) { return !isNaN(n); })) {
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
                group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x00ffcc })));
            }
        }
        if (de.type === 116 && vals.length >= 4) {
            const [, x, y, z] = vals.map(Number);
            if (!isNaN(x)) pts.push(x, y, z);
        }
        if (de.type === 100 && vals.length >= 8) {
            const [, zt, cx, cy, sx, sy, ex, ey] = vals.map(Number);
            if (!isNaN(cx)) {
                const r = Math.hypot(sx - cx, sy - cy);
                const sa = Math.atan2(sy - cy, sx - cx);
                const ea = Math.atan2(ey - cy, ex - cx);
                const curve = new THREE.EllipseCurve(cx, cy, r, r, sa, ea, false);
                const cPts = curve.getPoints(32).map(function(p) { return new THREE.Vector3(p.x, p.y, zt || 0); });
                const g = new THREE.BufferGeometry().setFromPoints(cPts);
                group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x00ffcc })));
            }
        }
    }

    if (pts.length > 0) {
        const pGeom = new THREE.BufferGeometry();
        pGeom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        group.add(new THREE.Points(pGeom, new THREE.PointsMaterial({ color: 0x00ffcc, size: 0.05 })));
    }

    if (group.children.length === 0) throw new Error('NO_PARSEABLE_ENTITIES_IN_IGES');
    return group;
}

// --- FILE UPLOAD HANDLER ---
const btn3d = document.getElementById('btn-upload-3d');
const fileInput3d = document.getElementById('file-3d-logo');
const btn3dX = document.getElementById('btn-3d-x');

if (btn3d) btn3d.addEventListener('click', function() { if (fileInput3d) fileInput3d.click(); });

if (fileInput3d) {
    fileInput3d.addEventListener('change', async function(e) {
        if (!e.target.files.length) return;

        const file = e.target.files[0];
        const ext = file.name.split('.').pop().toLowerCase();

        sysLog('3D_LOAD: ' + file.name.toUpperCase() + ' (' + (file.size / 1024).toFixed(0) + 'KB)');

        try {
            await ensure3D();
        } catch (initErr) {
            sysLog('3D_INIT_FAIL: ' + (initErr.message || initErr));
            console.error('3D INIT:', initErr);
            return;
        }

        clearModel();

        try {
            let model;
            switch (ext) {
                case 'obj': model = await loadOBJ(file); break;
                case 'fbx': model = await loadFBX(file); break;
                case 'stl': model = await loadSTL(file); break;
                case 'amf': model = await loadAMF(file); break;
                case 'igs': case 'iges': model = await loadIGES(file); break;
                default: throw new Error('UNSUPPORTED_FORMAT: ' + ext.toUpperCase());
            }

            // Validate geometry exists
            const mc = countMeshes(model);
            sysLog('3D_PARSED: ' + mc + ' objects');

            // Compute normals for all meshes
            model.traverse(function(child) {
                if (child.isMesh && child.geometry) {
                    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
                }
            });

            centerAndScale(model);
            if (ext !== 'igs' && ext !== 'iges') applyHUDMaterial(model);

            _3D.model = model;
            _3D.scene.add(model);

            // Ensure camera is aimed at the model
            _3D.camera.position.set(0, 0, 4);
            _3D.camera.lookAt(0, 0, 0);
            _3D.camera.updateProjectionMatrix();

            // P2P Mix-Minus: only render locally when not in an active call
            if (!(window.APP && window.APP.peer && window.APP.peer.call)) {
                window.APP.trinity.logo3d.visible = true;
            }

            // Force immediate render + verify pixels
            _3D.renderer.render(_3D.scene, _3D.camera);
            const gl = _3D.renderer.getContext();
            const pixel = new Uint8Array(4);
            gl.readPixels(256, 256, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            sysLog('3D_LOGO: OK (' + ext.toUpperCase() + ') center_px=[' + pixel[0] + ',' + pixel[1] + ',' + pixel[2] + ',' + pixel[3] + ']');

            if (pixel[3] === 0) sysLog('3D_WARN: CENTER_TRANSPARENT — model may be off-center or too small');
        } catch (err) {
            sysLog('3D_ERR: ' + (err.message || err));
            console.error('3D LOAD ERROR:', err);
        }

        fileInput3d.value = '';
    });
}

if (btn3dX) {
    btn3dX.addEventListener('click', function() {
        if (window.APP && window.APP.trinity.logo3d.visible) {
            window.APP.trinity.logo3d.visible = false;
            sysLog('3D_LOGO: HIDDEN');
        } else if (_3D.model) {
            clearModel();
            if (window.APP) window.APP.trinity.logo3d.visible = false;
            sysLog('3D_LOGO: CLEARED');
        }
    });
}
// --- AUDIO HARDWARE SCAN ENGINE ---
    // --- HARDWARE SCANNER: COPIED FROM TEST.HTML ---
(function() {
    const btnScan = document.getElementById('btn-scan-inputs');
    const selInput = document.getElementById('audio-input-select');

    if (btnScan) {
        btnScan.onclick = async function() {
            try {
                // 1. PRIME: Request stream to unlock the real hardware names on the Mac
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // 2. ENUMERATE: Now that labels are unlocked, get the real names
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(d => d.kind === 'audioinput');
                
                if (selInput) {
                    selInput.innerHTML = '<option value="">SELECT_HARDWARE...</option>';
                    audioInputs.forEach(d => {
                        const opt = document.createElement('option');
                        opt.value = d.deviceId;
                        // This will now show "MacBook Pro Microphone" instead of "Input 1"
                        opt.text = d.label || 'HARDWARE_INPUT_' + (selInput.length);
                        selInput.appendChild(opt);
                    });
                    
                    // Reveal the menu now that it has real names
                    selInput.style.display = 'block'; 
                    
                    // 3. CLEANUP: Stop the temp stream so the red recording dot goes away
                    stream.getTracks().forEach(t => t.stop());
                    
                    if (typeof ghostLog === 'function') ghostLog('AUDIO: HARDWARE_LABELS_UNLOCKED', 'ok');
                }
            } catch (e) { 
                if (typeof ghostLog === 'function') ghostLog('SCAN_ERR: ' + e.message, 'crit'); 
            }
        };
    }

})();
