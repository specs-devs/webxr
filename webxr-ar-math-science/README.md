# AR Math & Science

A hub of interactive **WebXR** demos for **SPECS**, exploring ideas from math and science in AR.

Open the site on SPECS using the built-in browser, select a demo, and launch it in WebXR.

## Demos

| Demo | Topic |
|------|--------|
| [Boids](demos/boids/) | Simulation |
| [Chladni Patterns](demos/chladni/) | Acoustics |
| [Double Pendulum](demos/pendulum/) | Chaos |
| [Quadric Surfaces](demos/quadric/) | Geometry |
| [Refraction](demos/refraction/) | Optics |
| [Simple Harmonic Motion](demos/shm/) | Mechanics |
| [Solids of Revolution](demos/revolution/) | Calculus |
| [Spacetime Curvature](demos/spacetime/) | Relativity |
| [Strange Attractors](demos/attractor/) | Chaos |
| [Voronoi Diagram](demos/voronoi/) | Geometry |

## Requirements

- Node.js 18+ (for local builds)
- [SPECS](https://www.specs.com/) 
- An HTTPS URL reachable by the glasses (WebXR requires a secure context)

## Quick start

```bash
npm install
npm run build:demos
npx serve .
```

The `npx serve .` preview is for desktop testing. For SPECS, host this directory over HTTPS and open that URL in the built-in browser; plain HTTP on your local network is not a secure WebXR context.

- `npm run build:demos` — installs and builds every demo under `demos/`

### Single demo (dev)

```bash
cd demos/boids
npm install
npm run dev
```

## Creator

Created by [Adam Varga](https://x.com/dmvrg) — [@dmvrg on GitHub](https://github.com/dmvrg).

## License

MIT — see [LICENSE](LICENSE).

Inter font files under `fonts/` are licensed separately under the [SIL Open Font License](fonts/LICENSE.txt).
