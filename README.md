<div align="center">

# SPECS WebXR

**Run WebXR experiences on SPECS from the browser, with standard web APIs and no Lens Studio project.**

[![WebXR on SPECS](https://img.shields.io/badge/WebXR-SPECS-blue)](https://docs.lensstudio.com/develop/capabilities/ar/webxr/?target=specs)
[![Three.js](https://img.shields.io/badge/Three.js-standard_WebXR-black)](https://threejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

## What is here

This repository contains **AR Math & Science**, a hub of ten interactive Three.js WebXR demos for SPECS, plus its design source and on-device preview captures.

| Path | Contents |
|:--|:--|
| [`webxr-ar-math-science/`](webxr-ar-math-science/) | The complete static site and all ten demo projects |
| [`design/`](design/) | Figma source for the AR Math & Science hub, via Git LFS |
| [`preview/`](preview/) | Full-length on-device preview captures, via Git LFS |

## How WebXR works on SPECS

WebXR is the web standard for VR and AR in the browser. On SPECS, the built-in browser uses WebKit and the SPECS OpenXR runtime, so experiences built with standard web technologies can run without a Lens Studio project or an installed Lens.

- Open the SPECS browser from Lens Explorer and visit an **HTTPS URL**.
- Use the WebXR Device API and AR module to start an `immersive-ar` session.
- Use hand input for interaction; the SPECS browser also supports WebXR Hit Test.
- Exit immersive mode from the System Menu on the wearer's palm.
- Capture and share the experience using the built-in SPECS controls.

See [WebXR on SPECS](https://docs.lensstudio.com/develop/capabilities/ar/webxr/?target=specs) for the complete platform guide and current feature support.

## AR Math & Science demos

| Demo | Topic |
|:--|:--|
| [Boids](webxr-ar-math-science/demos/boids/) | Flocking simulation |
| [Chladni Patterns](webxr-ar-math-science/demos/chladni/) | Acoustics and vibration |
| [Double Pendulum](webxr-ar-math-science/demos/pendulum/) | Chaotic motion |
| [Quadric Surfaces](webxr-ar-math-science/demos/quadric/) | Geometry |
| [Refraction](webxr-ar-math-science/demos/refraction/) | Optics |
| [Simple Harmonic Motion](webxr-ar-math-science/demos/shm/) | Mechanics |
| [Solids of Revolution](webxr-ar-math-science/demos/revolution/) | Calculus |
| [Spacetime Curvature](webxr-ar-math-science/demos/spacetime/) | Relativity |
| [Strange Attractors](webxr-ar-math-science/demos/attractor/) | Dynamical systems |
| [Voronoi Diagram](webxr-ar-math-science/demos/voronoi/) | Computational geometry |

## Build and run

Requirements: Node.js 18+, npm, Git LFS, and an HTTPS server for testing on SPECS.

```bash
git lfs install
git clone https://github.com/specs-devs/webxr.git
cd webxr/webxr-ar-math-science
npm run build:demos
```

`npm run build:demos` installs and builds every demo under `demos/`. To work on one demo instead:

```bash
cd demos/boids
npm install
npm run dev
```

For a desktop-only local preview, run `npx serve .` from `webxr-ar-math-science/`.

**For SPECS, serve the `webxr-ar-math-science/` directory over HTTPS**, then open that URL in the SPECS browser. Browsers restrict WebXR to secure contexts; a plain HTTP address on your local network is not enough. No Lens Studio project is required.

## Performance on SPECS

The demos follow the SPECS WebXR guidance:

- **Designed for AR, not VR:** compact content placed in the room rather than full-view VR environments.
- **Antialiasing disabled:** every demo creates its WebGL renderer with `antialias: false`, avoiding unnecessary multisampling memory and fill-rate costs.
- **Standard WebXR options:** hand tracking and other capabilities are requested as optional features rather than hard requirements.
- **Small assets:** keep textures, meshes and shader complexity constrained when extending the demos.
- **Hardware-friendly video:** use H.264, HEVC or VP9 for video; avoid VP8.
- **Few WebXR layers:** excessive layers can force a slower compositing path on SPECS.

If SPECS reports `App Stopped: high memory used`, first check antialiasing, WebXR Layers and asset sizes.

## Platform support at a glance

| WebXR capability | SPECS browser |
|:--|:--|
| WebXR Device API and AR Module | Supported |
| Hand Input and Hit Test | Supported |
| Gamepads | Supported |
| Anchors | Session-only; not persistent between sessions |
| Layers | Supported with performance limits |
| Plane Detection, Depth Sensing and Mesh Detection | Not currently supported |
| Image tracking, raw camera access and lighting estimation | Not currently supported |

Request newer capabilities as optional features and check `session.enabledFeatures` so the experience can fall back cleanly.

## More WebXR examples

Adam also created the separate **Chair, Sneaker, Burger and 3D Tic-Tac-Toe** demos described in the SPECS WebXR documentation. Their source is in [`dmvrg/webxr-ar-demos`](https://github.com/dmvrg/webxr-ar-demos).

Useful references:

- [WebXR on SPECS](https://docs.lensstudio.com/develop/capabilities/ar/webxr/?target=specs)
- [Immersive Web](https://immersiveweb.dev/)
- [WebXR samples](https://immersive-web.github.io/webxr-samples/)

## Creator and license

**Created by [Adam Varga](https://x.com/dmvrg) — [@dmvrg on GitHub](https://github.com/dmvrg).**

The AR Math & Science source is available under the [MIT License](LICENSE), copyright © 2026 dmvrg. Inter font files are licensed separately under the [SIL Open Font License](webxr-ar-math-science/fonts/LICENSE.txt).
