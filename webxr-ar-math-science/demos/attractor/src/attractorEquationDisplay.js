/**
 * Attractor ODE cards: offscreen canvas → CanvasTexture on a scene plane.
 * Math via hand-authored token rows (measure pass, then draw pass).
 */

/** Academic / textbook serif (STIX ≈ LaTeX-adjacent publishing faces). */
const EQUATION_FONT =
    '"STIX Two Text", "STIX Two Math", "Times New Roman", Times, serif';

const TOKEN = {
    TEXT: 'text',
    FRAC: 'frac',
    OP: 'op',
    GAP: 'gap',
};

let equationFontReadyPromise = null;

/** Ensures STIX (or fallback) is ready before canvas measure/draw. */
export function prepareEquationFont() {
    if (!equationFontReadyPromise) {
        equationFontReadyPromise = Promise.all([
            document.fonts.load('400 32px "STIX Two Text"'),
            document.fonts.load('400 32px "STIX Two Math"'),
            document.fonts.ready,
        ]).catch(() => undefined);
    }
    return equationFontReadyPromise;
}

function mathFont(size) {
    return `400 ${size}px ${EQUATION_FONT}`;
}

function setTextFont(ctx, fontSize) {
    ctx.font = mathFont(fontSize);
}

/** @typedef {{ type: string, value?: string, num?: string, den?: string, em?: number }} EquationToken */

function measureFraction(ctx, token, fontSize) {
    setTextFont(ctx, fontSize);
    const numW = ctx.measureText(token.num).width;
    const denW = ctx.measureText(token.den).width;
    const barW = Math.max(numW, denW) + fontSize * 0.14;
    const between = fontSize * 0.12;
    const stackH = fontSize * 2 + between * 2;
    return {
        width: barW + fontSize * 0.1,
        barW,
        between,
        stackH,
        ascent: stackH * 0.52,
        descent: stackH * 0.48,
    };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {EquationToken} token
 * @param {number} fontSize
 */
function measureToken(ctx, token, fontSize) {
    switch (token.type) {
        case TOKEN.TEXT: {
            setTextFont(ctx, fontSize);
            const w = ctx.measureText(token.value).width;
            return { width: w, ascent: fontSize * 0.72, descent: fontSize * 0.2 };
        }
        case TOKEN.OP: {
            setTextFont(ctx, fontSize);
            const pad = fontSize * 0.32;
            const w = ctx.measureText(token.value).width + pad * 2;
            return { width: w, ascent: fontSize * 0.72, descent: fontSize * 0.2, opPad: pad };
        }
        case TOKEN.GAP:
            return {
                width: fontSize * (token.em ?? 1),
                ascent: 0,
                descent: 0,
            };
        case TOKEN.FRAC:
            return measureFraction(ctx, token, fontSize);
        default:
            return { width: 0, ascent: 0, descent: 0 };
    }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {EquationToken[]} tokens
 * @param {number} fontSize
 */
function measureTokenRow(ctx, tokens, fontSize) {
    let width = 0;
    let ascent = 0;
    let descent = 0;
    for (const token of tokens) {
        const m = measureToken(ctx, token, fontSize);
        width += m.width;
        ascent = Math.max(ascent, m.ascent);
        descent = Math.max(descent, m.descent);
    }
    return { width, height: ascent + descent, ascent, descent };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {EquationToken} token
 * @param {number} x
 * @param {number} baselineY
 * @param {number} fontSize
 */
function drawToken(ctx, token, x, baselineY, fontSize) {
    const m = measureToken(ctx, token, fontSize);

    switch (token.type) {
        case TOKEN.TEXT: {
            setTextFont(ctx, fontSize);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(token.value, x, baselineY);
            return m.width;
        }
        case TOKEN.OP: {
            setTextFont(ctx, fontSize);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(token.value, x + (m.opPad ?? 0), baselineY);
            return m.width;
        }
        case TOKEN.GAP:
            return m.width;
        case TOKEN.FRAC: {
            const cx = x + m.width * 0.5;
            const barW = m.barW;
            const between = m.between;
            const barY = baselineY - fontSize * 0.32;

            setTextFont(ctx, fontSize);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(token.num, cx, barY - between);

            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = Math.max(1, fontSize * 0.045);
            ctx.beginPath();
            ctx.moveTo(cx - barW / 2, barY);
            ctx.lineTo(cx + barW / 2, barY);
            ctx.stroke();

            ctx.textBaseline = 'top';
            ctx.fillText(token.den, cx, barY + between);
            return m.width;
        }
        default:
            return 0;
    }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {EquationToken[]} tokens
 * @param {number} rowCenterY
 * @param {number} fontSize
 * @param {number} anchorX left edge of row
 */
function drawTokenRow(ctx, tokens, rowCenterY, fontSize, anchorX) {
    const { ascent, descent } = measureTokenRow(ctx, tokens, fontSize);
    const baselineY = rowCenterY + (ascent - descent) * 0.5;
    let x = anchorX;
    for (const token of tokens) {
        x += drawToken(ctx, token, x, baselineY, fontSize);
    }
}

/** @typedef {{ rows: EquationToken[][], params?: EquationToken[][], bodySize?: number, paramSize?: number, padX?: number, paramColumnGapEm?: number }} EquationDefinition */

/** Shared body/param size and left inset — match Lorenz on every attractor card. */
const EQUATION_LAYOUT = {
    padX: 0.16,
    bodySize: 0.048,
    paramSize: 0.044,
};

/** @type {Record<string, EquationDefinition>} */
const ATTRACTOR_EQUATIONS = {
    lorenz: {
        ...EQUATION_LAYOUT,
        rows: [
            [
                { type: TOKEN.FRAC, num: 'dx', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'σ(y − x)' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dy', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'x(ρ − z) − y' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dz', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'xy − βz' },
            ],
        ],
        params: [
            [{ type: TOKEN.TEXT, value: 'σ = 10' }],
            [{ type: TOKEN.TEXT, value: 'ρ = 28' }],
            [
                { type: TOKEN.TEXT, value: 'β =' },
                { type: TOKEN.GAP, em: 0.35 },
                { type: TOKEN.FRAC, num: '8', den: '3' },
            ],
        ],
    },
    rossler: {
        ...EQUATION_LAYOUT,
        rows: [
            [
                { type: TOKEN.FRAC, num: 'dx', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: '−y − z' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dy', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'x + ay' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dz', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'b + z(x − c)' },
            ],
        ],
        params: [
            [{ type: TOKEN.TEXT, value: 'a = 0.2' }],
            [{ type: TOKEN.TEXT, value: 'b = 0.2' }],
            [{ type: TOKEN.TEXT, value: 'c = 5.7' }],
        ],
    },
    aizawa: {
        ...EQUATION_LAYOUT,
        rows: [
            [
                { type: TOKEN.FRAC, num: 'dx', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: '(z − b)x − dy' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dy', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'dx + (z − b)y' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dz', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'c + az - z3/3 - x2 + fzx3' },
            ],
        ],
        params: [
            [{ type: TOKEN.TEXT, value: 'a = 0.95' }],
            [{ type: TOKEN.TEXT, value: 'b = 0.7' }],
            [{ type: TOKEN.TEXT, value: 'c = 0.6' }],
            [{ type: TOKEN.TEXT, value: 'd = 3.5' }],
            [{ type: TOKEN.TEXT, value: 'e = 0.25' }],
            [{ type: TOKEN.TEXT, value: 'f = 0.1' }],
        ],
    },
    thomas: {
        ...EQUATION_LAYOUT,
        rows: [
            [
                { type: TOKEN.FRAC, num: 'dx', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'sin(y) − bx' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dy', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'sin(z) − by' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dz', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'sin(x) − bz' },
            ],
        ],
        params: [[{ type: TOKEN.TEXT, value: 'b = 0.208186' }]],
    },
    dadras: {
        ...EQUATION_LAYOUT,
        rows: [
            [
                { type: TOKEN.FRAC, num: 'dx', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'y − ax + byz' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dy', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'cy − xz + z' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dz', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'dxy − hz' },
            ],
        ],
        params: [
            [{ type: TOKEN.TEXT, value: 'a = 3' }],
            [{ type: TOKEN.TEXT, value: 'b = 2.7' }],
            [{ type: TOKEN.TEXT, value: 'c = 1.7' }],
            [{ type: TOKEN.TEXT, value: 'd = 2' }],
            [{ type: TOKEN.TEXT, value: 'h = 9' }],
        ],
    },
    halvorsen: {
        ...EQUATION_LAYOUT,
        rows: [
            [
                { type: TOKEN.FRAC, num: 'dx', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: '−ax − 4y − 4z − y²' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dy', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: '−ay − 4z − 4x − z²' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dz', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: '−az − 4x − 4y − x²' },
            ],
        ],
        params: [[{ type: TOKEN.TEXT, value: 'a = 1.4' }]],
    },
    dequanLi: {
        ...EQUATION_LAYOUT,
        rows: [
            [
                { type: TOKEN.FRAC, num: 'dx', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'a(y − x) + dxz' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dy', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'kx + fy − xz' },
            ],
            [
                { type: TOKEN.FRAC, num: 'dz', den: 'dt' },
                { type: TOKEN.OP, value: '=' },
                { type: TOKEN.TEXT, value: 'cz + xy − ex²' },
            ],
        ],
        params: [
            [{ type: TOKEN.TEXT, value: 'a = 40' }],
            [{ type: TOKEN.TEXT, value: 'd = 0.16' }],
            [{ type: TOKEN.TEXT, value: 'e = 0.65' }],
            [{ type: TOKEN.TEXT, value: 'k = 55' }],
            [{ type: TOKEN.TEXT, value: 'f = 20' }],
            [
                { type: TOKEN.TEXT, value: 'c =' },
                { type: TOKEN.GAP, em: 0.35 },
                { type: TOKEN.FRAC, num: '11', den: '6' },
            ],
        ],
    },
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {EquationToken[][]} params
 * @param {number} paramSize
 * @param {number} padX
 * @param {number} startY
 * @param {number} paramRowGap
 * @param {EquationDefinition} def
 */
function renderEquationParams(ctx, params, paramSize, padX, startY, paramRowGap, def) {
    if (params.length <= 3) {
        let y = startY;
        for (const row of params) {
            const { height } = measureTokenRow(ctx, row, paramSize);
            drawTokenRow(ctx, row, y + height * 0.5, paramSize, padX);
            y += height + paramRowGap;
        }
        return y;
    }

    const left = params.slice(0, 3);
    const right = params.slice(3);
    const columnGap = paramSize * (def.paramColumnGapEm ?? 1.25);

    let leftMaxW = 0;
    for (const row of left) {
        leftMaxW = Math.max(leftMaxW, measureTokenRow(ctx, row, paramSize).width);
    }
    const rightX = padX + leftMaxW + columnGap;
    const rowCount = Math.max(left.length, right.length);

    let y = startY;
    for (let i = 0; i < rowCount; i++) {
        const leftRow = left[i];
        const rightRow = right[i];
        let rowHeight = 0;

        if (leftRow) {
            rowHeight = Math.max(rowHeight, measureTokenRow(ctx, leftRow, paramSize).height);
        }
        if (rightRow) {
            rowHeight = Math.max(rowHeight, measureTokenRow(ctx, rightRow, paramSize).height);
        }

        const rowCenterY = y + rowHeight * 0.5;
        if (leftRow) drawTokenRow(ctx, leftRow, rowCenterY, paramSize, padX);
        if (rightRow) drawTokenRow(ctx, rightRow, rowCenterY, paramSize, rightX);

        y += rowHeight + paramRowGap;
    }

    return y;
}

function renderEquationDefinition(ctx, w, h, def) {
    const bodySize = Math.round(w * (def.bodySize ?? 0.048));
    const paramSize = Math.round(w * (def.paramSize ?? bodySize * 0.92));
    const padX = w * (def.padX ?? 0.08);
    const padTop = h * 0.11;
    const rowGap = bodySize * (def.rowGapEm ?? 0.6);
    const blockGap = bodySize * (def.blockGapEm ?? 0.95);

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';

    let y = padTop;

    for (const row of def.rows) {
        const { height } = measureTokenRow(ctx, row, bodySize);
        drawTokenRow(ctx, row, y + height * 0.5, bodySize, padX);
        y += height + rowGap;
    }

    if (def.params) {
        const paramRowGap = paramSize * (def.paramRowGapEm ?? def.rowGapEm ?? 0.6);
        y += blockGap - rowGap;
        y = renderEquationParams(ctx, def.params, paramSize, padX, y, paramRowGap, def);
    }
}

/** @returns {{ canvas: HTMLCanvasElement, texture: import('three').CanvasTexture, ctx: CanvasRenderingContext2D, dpr: number, designW: number, designH: number }} */
export function createEquationCanvasTexture(THREE, designW, designH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(designW * dpr);
    canvas.height = Math.round(designH * dpr);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return {
        canvas,
        texture,
        ctx: canvas.getContext('2d'),
        dpr,
        designW,
        designH,
    };
}

/**
 * @returns {Promise<boolean>}
 */
export async function renderAttractorEquation(attractorKey, target) {
    const def = ATTRACTOR_EQUATIONS[attractorKey];
    if (!def) return false;

    await prepareEquationFont();

    const { canvas, ctx, dpr, designW, designH } = target;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderEquationDefinition(ctx, designW, designH, def);
    return true;
}

export function hasAttractorEquation(attractorKey) {
    return attractorKey in ATTRACTOR_EQUATIONS;
}

prepareEquationFont();
