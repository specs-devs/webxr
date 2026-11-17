import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';

/** Matches `public/static/fonts/helvetiker_bold.typeface.json`. */
export const HELVETIKER_BOLD_URL = 'static/fonts/helvetiker_bold.typeface.json';

let _helvetikerBold = null;
let _helvetikerBoldPromise = null;

/** Load helvetiker bold once; safe to call multiple times. */
export function loadHelvetikerBold() {
    if (_helvetikerBold) return Promise.resolve(_helvetikerBold);
    if (_helvetikerBoldPromise) return _helvetikerBoldPromise;

    _helvetikerBoldPromise = new Promise((resolve, reject) => {
        new FontLoader().load(
            HELVETIKER_BOLD_URL,
            (font) => {
                _helvetikerBold = font;
                resolve(font);
            },
            undefined,
            reject
        );
    });
    return _helvetikerBoldPromise;
}

export function getHelvetikerBold() {
    return _helvetikerBold;
}

/**
 * Flat centered ShapeGeometry text fitted inside a world-space box.
 * Geometry is rebuilt only when the string changes (via updateShapeTextMesh).
 */
export function buildFittedShapeTextGeometry(font, text, maxWidth, maxHeight, curveSegments = 4) {
    const content = text || ' ';

    const probe = new THREE.ShapeGeometry(font.generateShapes(content, 1), curveSegments);
    probe.computeBoundingBox();
    const probeBox = probe.boundingBox;
    const probeW = probeBox.max.x - probeBox.min.x;
    const probeH = probeBox.max.y - probeBox.min.y;
    probe.dispose();

    const size = probeW > 0 && probeH > 0
        ? Math.min(maxWidth / probeW, maxHeight / probeH)
        : 1;

    const geometry = new THREE.ShapeGeometry(font.generateShapes(content, size), curveSegments);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    geometry.translate(
        -(box.max.x + box.min.x) * 0.5,
        -(box.max.y + box.min.y) * 0.5,
        0
    );
    return geometry;
}

/** Centered ShapeGeometry at a fixed em size — glyph scale does not change with string length. */
export function buildFixedSizeShapeTextGeometry(font, text, fontSize, curveSegments = 4, stableVerticalCenter = false) {
    const content = text || ' ';
    const geometry = new THREE.ShapeGeometry(font.generateShapes(content, fontSize), curveSegments);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const centerX = -(box.max.x + box.min.x) * 0.5;
    let centerY = -(box.max.y + box.min.y) * 0.5;
    if (stableVerticalCenter && font?.data) {
        const res = font.data.resolution || 1000;
        const asc = font.data.ascender ?? font.data.boundingBox?.yMax ?? res;
        const desc = font.data.descender ?? font.data.boundingBox?.yMin ?? 0;
        // Font em-box center is fixed for every string; only glyph bbox changes with descenders.
        const emCenterY = ((asc + desc) * 0.5 / res) * fontSize;
        centerY = -emCenterY;
    }
    geometry.translate(centerX, centerY, 0);
    return geometry;
}

export function createFixedShapeTextMesh(font, text, options = {}) {
    const {
        fontSize,
        color = 0xffffff,
        curveSegments = 4,
        depthTest = false,
        depthWrite = false,
        side = THREE.DoubleSide,
        renderOrder = 0,
        opacity = 1,
        stableVerticalCenter = false,
    } = options;

    const geometry = buildFixedSizeShapeTextGeometry(
        font, text, fontSize, curveSegments, stableVerticalCenter
    );
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthTest,
        depthWrite,
        side,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.userData.shapeText = {
        mode: 'fixed',
        lastText: text,
        lastColor: material.color.getHex(),
        fontSize,
        curveSegments,
        opacity,
        stableVerticalCenter,
    };
    return mesh;
}

export function createShapeTextMesh(font, text, options = {}) {
    const {
        maxWidth = 0.1,
        maxHeight = 0.04,
        color = 0xffffff,
        curveSegments = 4,
        depthTest = false,
        depthWrite = false,
        side = THREE.DoubleSide,
        renderOrder = 0,
    } = options;

    const geometry = buildFittedShapeTextGeometry(font, text, maxWidth, maxHeight, curveSegments);
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthTest,
        depthWrite,
        side,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.userData.shapeText = {
        mode: 'fit',
        lastText: text,
        lastColor: material.color.getHex(),
        maxWidth,
        maxHeight,
        curveSegments,
    };
    return mesh;
}

/** Returns true when geometry or color was updated. */
export function updateFixedShapeTextMesh(mesh, font, text, color) {
    const state = mesh.userData.shapeText;
    if (!state || !font || state.mode !== 'fixed') return false;

    const nextColor = color === undefined
        ? state.lastColor
        : new THREE.Color(color).getHex();

    if (state.lastText === text && state.lastColor === nextColor) return false;

    mesh.geometry.dispose();
    mesh.geometry = buildFixedSizeShapeTextGeometry(
        font,
        text,
        state.fontSize,
        state.curveSegments,
        state.stableVerticalCenter
    );

    if (state.lastColor !== nextColor) {
        mesh.material.color.setHex(nextColor);
        state.lastColor = nextColor;
    }
    state.lastText = text;
    return true;
}

/** Returns true when geometry or color was updated. */
export function updateShapeTextMesh(mesh, font, text, color) {
    const state = mesh.userData.shapeText;
    if (!state || !font || state.mode === 'fixed') return false;

    const nextColor = color === undefined
        ? state.lastColor
        : new THREE.Color(color).getHex();

    if (state.lastText === text && state.lastColor === nextColor) return false;

    mesh.geometry.dispose();
    mesh.geometry = buildFittedShapeTextGeometry(
        font,
        text,
        state.maxWidth,
        state.maxHeight,
        state.curveSegments
    );

    if (state.lastColor !== nextColor) {
        mesh.material.color.setHex(nextColor);
        state.lastColor = nextColor;
    }
    state.lastText = text;
    return true;
}

export function disposeShapeTextMesh(mesh) {
    if (!mesh) return;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
    mesh.userData.shapeText = null;
}

/** Original canvas: 44px title / 28px subtitle in an 80px-tall label. */
const NAME_LABEL_TITLE_FONT_FRAC = 44 / 80;
const NAME_LABEL_SUB_FONT_FRAC = 28 / 80;
/** Vertical offset of each line from center, as a fraction of label height — increase for more gap. */
const NAME_LABEL_LINE_SPREAD = 0.34;
const NAME_LABEL_SUB_OPACITY = 0.8;

function _clearNameLabelGroupChildren(group) {
    while (group.children.length > 0) {
        const child = group.children[0];
        disposeShapeTextMesh(child);
        group.remove(child);
    }
}

function _populateNameLabelGroup(group, font, title, subtitle, layout) {
    const { height, curveSegments = 4 } = layout;
    const hasSubtitle = !!subtitle;
    const titleFontSize = height * NAME_LABEL_TITLE_FONT_FRAC;

    const titleMesh = createFixedShapeTextMesh(font, title || ' ', {
        fontSize: titleFontSize,
        color: 0xffffff,
        curveSegments,
    });

    if (hasSubtitle) {
        titleMesh.position.y = height * NAME_LABEL_LINE_SPREAD;
        const subMesh = createFixedShapeTextMesh(font, subtitle, {
            fontSize: height * NAME_LABEL_SUB_FONT_FRAC,
            color: 0xffffff,
            curveSegments,
            opacity: NAME_LABEL_SUB_OPACITY,
        });
        subMesh.position.y = -height * NAME_LABEL_LINE_SPREAD;
        group.add(subMesh);
    }

    group.add(titleMesh);
}

/**
 * Two-line object name label (title + optional IOR subtitle).
 * Fitted to `width` × `height` world units — same footprint as the old canvas plane.
 */
export function createNameLabelGroup(font, title, subtitle = '', layout = {}) {
    const {
        width = 0.156,
        height = 0.024375,
        curveSegments = 4,
    } = layout;

    const group = new THREE.Group();
    group.frustumCulled = false;
    group.userData.nameLabelLayout = { width, height, curveSegments };
    group.userData.lastKey = `${title}||${subtitle}`;

    _populateNameLabelGroup(group, font, title, subtitle, { width, height, curveSegments });
    return group;
}

/** Rebuild label children when title, subtitle, or layout mode changes. */
export function updateNameLabelGroup(group, font, title, subtitle = '') {
    if (!group || !font) return false;
    const key = `${title}||${subtitle}`;
    if (group.userData.lastKey === key) return false;

    const layout = group.userData.nameLabelLayout;
    if (!layout) return false;

    _clearNameLabelGroupChildren(group);
    _populateNameLabelGroup(group, font, title, subtitle, layout);
    group.userData.lastKey = key;
    return true;
}

export function disposeNameLabelGroup(group) {
    if (!group) return;
    _clearNameLabelGroupChildren(group);
    group.userData.nameLabelLayout = null;
    group.userData.lastKey = null;
}
