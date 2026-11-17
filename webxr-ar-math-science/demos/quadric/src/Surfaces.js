/**
 * surfaces.js
 *
 * Parametric definitions for 6 quadratic surfaces.
 *
 * Each surface fn signature:
 *   fn(out, u, v, params) → void
 *   - out   : { x, y, z } — mutated in place (no allocations)
 *   - u, v  : both in [0, 1]
 *   - params: shape-specific coefficients { a, b, c }
 *
 * Equations use standard math orientation (y = up).
 */

const TWO_PI = Math.PI * 2;

export const SURFACES = {

    // ── x²/a² + y²/b² + z²/c² = 1 ─────────────────────────────────────────
    // F = x²/a² + y²/b² + z²/c² − 1  →  ∇F = (2x/a², 2y/b², 2z/c²)
    ellipsoid: {
        label: 'Ellipsoid',
        defaultParams: { a: 1.0, b: 0.65, c: 0.5 },
        implicit(x, y, z, { a, b, c }) {
            return x*x/(a*a) + y*y/(b*b) + z*z/(c*c) - 1;
        },
        paramRanges: {
            a: { min: 0.1, max: 2.0, label: 'a  (x radius)' },
            b: { min: 0.1, max: 2.0, label: 'b  (y radius)' },
            c: { min: 0.1, max: 2.0, label: 'c  (z radius)' },
        },
        fn(out, u, v, { a, b, c }) {
            const phi    = u * Math.PI;
            const theta  = v * TWO_PI;
            const sinPhi = Math.sin(phi);
            out.x = a * sinPhi * Math.cos(theta);
            out.y = b * Math.cos(phi);
            out.z = c * sinPhi * Math.sin(theta);
        },
        normalAt(nout, x, y, z, { a, b, c }) {
            nout.x = x / (a * a);
            nout.y = y / (b * b);
            nout.z = z / (c * c);
        },
    },

    // ── x²/a² + z²/b² = y²/c²  (double cone) ──────────────────────────────
    // F = x²/a² + z²/b² − y²/c²  →  ∇F = (2x/a², −2y/c², 2z/b²)
    // Vertex (0,0,0) → ∇F = 0; fall back to (0,1,0).
    ellipticCone: {
        label: 'Elliptic Cone',
        defaultParams: { a: 1.0, b: 0.7, c: 1.0 },
        implicit(x, y, z, { a, b, c }) {
            return x*x/(a*a) + z*z/(b*b) - y*y/(c*c);
        },
        paramRanges: {
            a: { min: 0.1, max: 2.0, label: 'a  (x spread)' },
            b: { min: 0.1, max: 2.0, label: 'b  (z spread)' },
            c: { min: 0.1, max: 2.0, label: 'c  (height)' },
        },
        fn(out, u, v, { a, b, c }) {
            const t     = u * 2.0 - 1.0;
            const theta = v * TWO_PI;
            out.x = a * t * Math.cos(theta);
            out.y = c * t;
            out.z = b * t * Math.sin(theta);
        },
        normalAt(nout, x, y, z, { a, b, c }) {
            nout.x =  x / (a * a);
            nout.y = -y / (c * c);
            nout.z =  z / (b * b);
            // At the apex (0,0,0) gradient is zero — use axis direction
            if (nout.x === 0 && nout.y === 0 && nout.z === 0) {
                nout.x = 0; nout.y = 1; nout.z = 0;
            }
        },
    },

    // ── y = c·(x²/a² − z²/b²)  (saddle) ──────────────────────────────────
    // F = c·x²/a² − c·z²/b² − y  →  ∇F = (2cx/a², −1, −2cz/b²)
    hyperbolicParaboloid: {
        label: 'Hyperbolic Paraboloid',
        defaultParams: { a: 1.0, b: 1.0, c: 1.0 },
        implicit(x, y, z, { a, b, c }) {
            return c * (x*x/(a*a) - z*z/(b*b)) - y;
        },
        paramRanges: {
            a: { min: 0.1, max: 2.0, label: 'a  (x scale)' },
            b: { min: 0.1, max: 2.0, label: 'b  (z scale)' },
            c: { min: 0.1, max: 2.0, label: 'c  (height)' },
        },
        fn(out, u, v, { a, b, c }) {
            const x = u * 2.0 - 1.0;
            const z = v * 2.0 - 1.0;
            out.x = a * x;
            out.y = c * (x * x - z * z);
            out.z = b * z;
        },
        normalAt(nout, x, y, z, { a, b, c }) {
            nout.x =  2.0 * c * x / (a * a);
            nout.y = -1.0;
            nout.z = -2.0 * c * z / (b * b);
        },
    },

    // ── x²/a² + z²/b² − y²/c² = 1 ─────────────────────────────────────────
    // F = x²/a² + z²/b² − y²/c² − 1  →  ∇F = (2x/a², −2y/c², 2z/b²)
    hyperboloidOneSheet: {
        label: 'Hyperboloid (1 Sheet)',
        defaultParams: { a: 0.6, b: 0.6, c: 1.0 },
        implicit(x, y, z, { a, b, c }) {
            return x*x/(a*a) + z*z/(b*b) - y*y/(c*c) - 1;
        },
        paramRanges: {
            a: { min: 0.1, max: 2.0, label: 'a  (x scale)' },
            b: { min: 0.1, max: 2.0, label: 'b  (z scale)' },
            c: { min: 0.1, max: 2.0, label: 'c  (height)' },
        },
        fn(out, u, v, { a, b, c }) {
            const theta = u * TWO_PI;
            const T_MAX = 2.0;
            const t     = v * 2.0 * T_MAX - T_MAX;
            const ch    = Math.cosh(t);
            const sh    = Math.sinh(t);
            out.x = a * ch * Math.cos(theta);
            out.y = c * sh;
            out.z = b * ch * Math.sin(theta);
        },
        normalAt(nout, x, y, z, { a, b, c }) {
            nout.x =  x / (a * a);
            nout.y = -y / (c * c);
            nout.z =  z / (b * b);
        },
    },

    // ── y²/c² − x²/a² − z²/b² = 1 ─────────────────────────────────────────
    // F = y²/c² − x²/a² − z²/b² − 1  →  ∇F = (−2x/a², 2y/c², −2z/b²)
    // At vertex (0,±c,0): ∇F = (0, ±2/c, 0) → normalized (0,±1,0) ✓
    //
    // Two separate sheets, each with u = θ/2π, v = radial from vertex.
    // Built as independent sub-meshes to avoid bridging triangles.
    hyperboloidTwoSheets: {
        label: 'Hyperboloid (2 Sheets)',
        defaultParams: { a: 0.6, b: 0.6, c: 1.0 },
        implicit(x, y, z, { a, b, c }) {
            return y*y/(c*c) - x*x/(a*a) - z*z/(b*b) - 1;
        },
        paramRanges: {
            a: { min: 0.1, max: 2.0, label: 'a  (x scale)' },
            b: { min: 0.1, max: 2.0, label: 'b  (z scale)' },
            c: { min: 0.1, max: 2.0, label: 'c  (height)' },
        },
        normalAt(nout, x, y, z, { a, b, c }) {
            nout.x = -x / (a * a);
            nout.y =  y / (c * c);
            nout.z = -z / (b * b);
        },
        sheets: [
            {
                fn(out, u, v, { a, b, c }) {
                    const theta   = u * TWO_PI;
                    const T_MAX   = 2.0;
                    const coshMax = Math.cosh(T_MAX);
                    const yCos    = 1.0 + v * (coshMax - 1.0);
                    const sh      = Math.sinh(Math.acosh(yCos));
                    out.x = a * sh * Math.cos(theta);
                    out.y = c * yCos;
                    out.z = b * sh * Math.sin(theta);
                },
            },
            {
                fn(out, u, v, { a, b, c }) {
                    const theta   = u * TWO_PI;
                    const T_MAX   = 2.0;
                    const coshMax = Math.cosh(T_MAX);
                    const yCos    = 1.0 + v * (coshMax - 1.0);
                    const sh      = Math.sinh(Math.acosh(yCos));
                    out.x = a * sh * Math.cos(theta);
                    out.y = -c * yCos;
                    out.z = b * sh * Math.sin(theta);
                },
            },
        ],
    },

    // ── y = c·(x²/a² + z²/b²) ──────────────────────────────────────────────
    // F = c·x²/a² + c·z²/b² − y  →  ∇F = (2cx/a², −1, 2cz/b²)
    // At vertex (0,0,0): ∇F = (0,−1,0) → points downward (inward); negate → (0,1,0) ✓
    ellipticParaboloid: {
        label: 'Elliptic Paraboloid',
        defaultParams: { a: 1.0, b: 0.7, c: 1.0 },
        implicit(x, y, z, { a, b, c }) {
            return c * (x*x/(a*a) + z*z/(b*b)) - y;
        },
        paramRanges: {
            a: { min: 0.1, max: 2.0, label: 'a  (x scale)' },
            b: { min: 0.1, max: 2.0, label: 'b  (z scale)' },
            c: { min: 0.1, max: 2.0, label: 'c  (height)' },
        },
        fn(out, u, v, { a, b, c }) {
            const theta = u * TWO_PI;
            const r     = v;
            out.x = a * r * Math.cos(theta);
            out.y = c * r * r;
            out.z = b * r * Math.sin(theta);
        },
        normalAt(nout, x, y, z, { a, b, c }) {
            nout.x = -2.0 * c * x / (a * a);
            nout.y =  1.0;
            nout.z = -2.0 * c * z / (b * b);
        },
    },

};

export const SURFACE_NAMES = Object.keys(SURFACES);
