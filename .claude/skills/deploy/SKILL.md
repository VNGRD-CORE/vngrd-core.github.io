---
name: deploy
description: Deploy to GitHub Pages, check paths, .nojekyll, environment variables, Alchemy key injection, GitHub Actions, Heroku backend
---

# VNGRD Deploy Skill

## Critical Rules (from CLAUDE.md)
- **Always use relative paths** — no leading `/` anywhere
- **`.nojekyll` must exist** in root to prevent GitHub Pages from blocking assets
- **No absolute paths** — everything relative to repo root

## Pre-Deploy Checklist
- [ ] `.nojekyll` exists in root
- [ ] No paths starting with `/` in HTML/JS/CSS
- [ ] All asset refs use `./` prefix (e.g. `./assets/logo.glb`)
- [ ] `ALCHEMY_KEY` injected via GitHub Actions secret (not hardcoded)
- [ ] `src/app.js` import maps use relative or CDN URLs only
- [ ] Service worker (`sw.js`) cache list updated if new assets added
- [ ] `manifest.json` icons exist at listed paths

## GitHub Pages (static frontend)
Deploy happens automatically on push to `main` (or configured branch).

```yaml
# .github/workflows/deploy.yml pattern
- name: Inject Alchemy key
  run: sed -i "s/YOUR_ALCHEMY_KEY/${{ secrets.ALCHEMY_KEY }}/g" index.html
```

## Heroku (Python backend)
```
Procfile: web: uvicorn main:app --host 0.0.0.0 --port $PORT
```
Required env vars on Heroku:
- `DEEPGRAM_API_KEY`
- `FAL_KEY`
- `PINATA_JWT`
- `OPENAI_API_KEY`

## Quick Path Audit
Run this to find any absolute paths that will break on GitHub Pages:
```bash
grep -rn 'src="/' index.html src/
grep -rn "href='/" index.html
grep -rn "url('/" *.css
```

## Service Worker Cache Update
When adding new files, update `sw.js` cache list:
```js
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/Compositor.js',
  // add new assets here
];
```
