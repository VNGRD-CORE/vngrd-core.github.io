---
name: 3d
description: Three.js, 3D logo, hologram, WebXR, VR, GLB model loading, shaders, scene rendering, animation, floating cinema
---

# VNGRD 3D / Three.js Skill

## Stack
- **Three.js v0.160.0** — via import map
- **GLTFLoader** — loading `.glb` models
- **WebXR Device API** — VR headset support
- **Canvas 2D + WebGL** — VJ effects, trails, glitch, pixelation

## Critical Rules (from CLAUDE.md)
- **Always use relative paths** for assets: `./assets/logo.glb` NOT `/assets/logo.glb`
- **Always use a `LoadingManager`** to confirm model exists before rendering
- The HUD layout and positioning must not be changed

## Loading a GLB Model (correct pattern)
```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const manager = new THREE.LoadingManager();
manager.onError = (url) => console.error(`Failed to load: ${url}`);

const loader = new GLTFLoader(manager);
loader.load(
  './assets/logo.glb',          // relative path — required for GitHub Pages
  (gltf) => {
    scene.add(gltf.scene);
  },
  (progress) => { /* optional loading bar */ },
  (error) => { console.error('GLB load error', error); }
);
```

## WebXR VR Setup
```js
renderer.xr.enabled = true;
document.body.appendChild(VRButton.createButton(renderer));

renderer.setAnimationLoop(() => {
  const pose = renderer.xr.getCamera().matrixWorld;
  // update floating cinema screen position relative to pose
  renderer.render(scene, camera);
});
```

## VJ Effects (Canvas 2D)
- **RGB Glitch**: split R/G/B channels with pixel offset
- **Trails**: low-opacity fill each frame instead of clearing
- **Pixelation**: draw scaled-down then scale-up with `imageSmoothingEnabled = false`
- **Rumble**: translate canvas context randomly each frame

## Debugging Checklist
- [ ] Is the `.glb` path relative (starts with `./`)?
- [ ] Is `LoadingManager` used? Does `onError` fire?
- [ ] Is Three.js loaded via import map before use?
- [ ] Is `renderer.xr.enabled = true` set before VR button creation?
- [ ] Is the animation loop using `renderer.setAnimationLoop` (not `requestAnimationFrame`) for WebXR?
- [ ] Are shaders compiled without errors? (check WebGL console warnings)
- [ ] Is the scene added to the correct camera/scene reference?
