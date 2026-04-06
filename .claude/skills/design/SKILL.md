---
name: design
description: UI design, HUD layout, CSS variables, themes, cyber-noir, animation, glassmorphism, Orbitron font, color palette, DRIS//CORE interface
---

# VNGRD Design Skill

## Aesthetic
**Cyber-noir** — dark backgrounds, neon cyan/magenta/green accents, monospace fonts, glitch effects, glass morphism panels.

## Critical Rule (from CLAUDE.md)
- **DO NOT** refactor, rename, or move CSS/JS for the clock, ticker, or HUD grid
- The `DRIS//CORE` grid + absolute positioning must remain intact

## CSS Custom Properties (theme engine)
```css
:root {
  --accent-cyan: #00f5ff;
  --accent-magenta: #ff00ff;
  --accent-green: #00ff88;
  --bg-primary: #0a0a0f;
  --bg-secondary: #111118;
  --glass-bg: rgba(10, 10, 20, 0.7);
  --glass-border: rgba(0, 245, 255, 0.15);
}
```

## Themes Available
- `cyber_core` (default)
- `broadcast_pro`
- `night`
- `gold`
- (others defined in index.html)

Switch theme by swapping CSS variable values on `:root`.

## Typography
| Use | Font |
|-----|------|
| Headers / HUD labels | Orbitron, Bebas Neue, Russo One |
| Terminal / code | JetBrains Mono, Share Tech Mono, Space Mono |
| Body / UI | Inter |

## Glass Morphism Panel
```css
.hud-panel {
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
}
```

## Animation Patterns
- **Scanlines**: CSS `repeating-linear-gradient` overlay, low opacity
- **Flicker**: `@keyframes` opacity oscillation on accent elements
- **Glitch text**: CSS `clip-path` + translate offsets on `::before`/`::after`
- **Pulse border**: `box-shadow` keyframe cycling through accent colors

## Do / Don't
| Do | Don't |
|----|-------|
| Use CSS variables for all colors | Hardcode hex values inline |
| Add new panels as absolute/grid children | Change the outer grid structure |
| Use `backdrop-filter` for glass panels | Use `opacity` on the whole HUD |
| Animate with `transform`/`opacity` | Animate `width`/`height`/`top`/`left` (causes layout) |
