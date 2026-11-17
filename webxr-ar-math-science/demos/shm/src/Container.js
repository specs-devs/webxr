import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import helvetikerBold from '../public/static/fonts/helvetiker_bold.typeface.json';
import helvetikerRegular from '../public/static/fonts/helvetiker_regular.typeface.json';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';

export function createContainer(deps) {
    const { scene, springConfig, containerAnchorLocalY } = deps;

/** Half-edge of the visual cube (planes sit on faces, edges meet at corners). */
const containerHalf = springConfig.containerVisualSize * 0.5;
const containerBackLocalZ = -containerHalf - springConfig.backPlaneDrop;
const containerLeftLocalX = -containerHalf - springConfig.leftPlaneDrop;
const containerBottomLocalY = -containerHalf - springConfig.bottomPlaneDrop;

/** Mass reference point at equilibrium in container space (matches springAnchor − restLength). */
const equilibriumLocalY = containerAnchorLocalY() - springConfig.restLength;

/**
 * Wireframe Container Cube
 */
/** Yaw on load: corner/vertical edge toward default view (+Z), not a flat face. */
const CONTAINER_DEFAULT_YAW = -Math.PI / 4;

const containerGroup = new THREE.Group();
containerGroup.position.set(
    springConfig.containerPosition.x,
    springConfig.springAttachWorldY - containerAnchorLocalY(),
    springConfig.containerPosition.z
);
containerGroup.rotation.y = CONTAINER_DEFAULT_YAW;
containerGroup.scale.setScalar(springConfig.compositionScale);
scene.add(containerGroup);

/** Desktop / pre-XR preview — fixed world position (floor-relative). */
const DESKTOP_CONTAINER_POS = containerGroup.position.clone();
/** Head-local offset applied when an immersive session starts (yaw faces head + CONTAINER_DEFAULT_YAW). */
const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };

const cubeGeometry = new THREE.BoxGeometry(
    springConfig.containerVisualSize,
    springConfig.containerVisualSize,
    springConfig.containerVisualSize
);
const cubeEdges = new THREE.EdgesGeometry(cubeGeometry);
const cubeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
const containerCube = new THREE.LineSegments(cubeEdges, cubeMaterial);
containerCube.visible = false;
containerGroup.add(containerCube);

/** Back reference plane (wireframe): same side length as the container cube face */
const backPlaneGeom = new THREE.PlaneGeometry(
    springConfig.containerVisualSize,
    springConfig.containerVisualSize
);
const backPlaneEdges = new THREE.EdgesGeometry(backPlaneGeom);
const backPlaneWireMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    opacity: 1.0,
    transparent: false
});
const containerBackPlane = new THREE.LineSegments(backPlaneEdges, backPlaneWireMaterial);
containerBackPlane.position.set(0, 0, 0);
containerBackPlane.visible = true;

/** Parent for back frame (on −Z face) + phase plot (offset to equilibrium height on that face). */
const backPlaneVizGroup = new THREE.Group();
backPlaneVizGroup.position.set(0, 0, containerBackLocalZ);
backPlaneVizGroup.scale.setScalar(1);
containerGroup.add(backPlaneVizGroup);
backPlaneVizGroup.add(containerBackPlane);

/** Thick bottom + one vertical accent bar per frame; inner faces flush with wireframe edges. */
const frameAccentEdgeThickness = 0.003;
const frameAccentHalfT = frameAccentEdgeThickness * 0.5;
const frameHalfExtent = springConfig.containerVisualSize * 0.5;
const framePlaneSize = springConfig.containerVisualSize;
const frameAccentEdgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const frameZeroGuideMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.5,
    transparent: false
});
const frameBottomAccentGeom = new THREE.BoxGeometry(
    framePlaneSize,
    frameAccentEdgeThickness,
    frameAccentEdgeThickness
);
const frameRightAccentGeom = new THREE.BoxGeometry(
    frameAccentEdgeThickness,
    framePlaneSize,
    frameAccentEdgeThickness
);

function addFrameAccentEdges(parent, verticalEdge = 'right') {
    const bottom = new THREE.Mesh(frameBottomAccentGeom, frameAccentEdgeMat);
    bottom.position.set(0, -frameHalfExtent + frameAccentHalfT, 0);
    bottom.frustumCulled = false;
    parent.add(bottom);

    const onRight = verticalEdge === 'right';
    const vertical = new THREE.Mesh(frameRightAccentGeom, frameAccentEdgeMat);
    vertical.position.set(
        (onRight ? 1 : -1) * (frameHalfExtent - frameAccentHalfT),
        0,
        0
    );
    vertical.frustumCulled = false;
    parent.add(vertical);
}

const FRAME_PLANE_Z_EPS = 0.003;
const FRAME_AXIS_TICK_SIZE = 0.01;
const frameAxisTickGeom = new THREE.BoxGeometry(
    FRAME_AXIS_TICK_SIZE,
    FRAME_AXIS_TICK_SIZE,
    FRAME_AXIS_TICK_SIZE
);

/** Cube tick centered on a frame edge (wireframe plane at z = 0) where an axis crosses zero. */
function addFrameAxisZeroTick(parent, edge, value) {
    const mesh = new THREE.Mesh(frameAxisTickGeom, frameAccentEdgeMat);
    mesh.frustumCulled = false;

    if (edge === 'bottom') {
        mesh.position.set(value, -frameHalfExtent, 0);
    } else if (edge === 'top') {
        mesh.position.set(value, frameHalfExtent, 0);
    } else if (edge === 'left') {
        mesh.position.set(-frameHalfExtent, value, 0);
    } else {
        mesh.position.set(frameHalfExtent, value, 0);
    }

    parent.add(mesh);
    return mesh;
}

const FRAME_ZERO_GUIDE_THICKNESS = 0.0015;
const frameZeroGuideHGeom = new THREE.BoxGeometry(
    framePlaneSize,
    FRAME_ZERO_GUIDE_THICKNESS,
    FRAME_ZERO_GUIDE_THICKNESS
);
const frameZeroGuideVGeom = new THREE.BoxGeometry(
    FRAME_ZERO_GUIDE_THICKNESS,
    framePlaneSize,
    FRAME_ZERO_GUIDE_THICKNESS
);

/** Horizontal + vertical guides through axis zeros (wireframe plane, z = 0). */
function addFrameAxisZeroGuides(parent, positionZeroY) {
    const horizontal = new THREE.Mesh(frameZeroGuideHGeom, frameZeroGuideMat);
    horizontal.position.set(0, positionZeroY, 0);
    horizontal.frustumCulled = false;
    parent.add(horizontal);

    const vertical = new THREE.Mesh(frameZeroGuideVGeom, frameZeroGuideMat);
    vertical.position.set(0, 0, 0);
    vertical.frustumCulled = false;
    parent.add(vertical);
}

const FRAME_AXIS_LABEL_SIZE = 0.021;
const FRAME_AXIS_LABEL_PAD = 0.016;
const FRAME_AXIS_TITLE_SIZE = 0.023;
const FRAME_AXIS_END_LABEL_SIZE = 0.026;
const FRAME_AXIS_END_LABEL_PAD = 0.015;
const FRAME_AXIS_ZERO_LABEL_PAD = 0.014;
const FRAME_AXIS_END_LABEL_TOP_PAD = 0.025;
/** When false, hide axis names (position / time / velocity); top titles stay visible. */
const SHOW_FRAME_AXIS_TEXTS = false;
/** Top titles: extra inset above frame; cap-height aligned so descenders don't shift Y. */
const FRAME_AXIS_LABEL_TOP_PAD = 0.045;
const helvetikerFont = new FontLoader().parse(helvetikerBold);
const helvetikerRegularFont = new FontLoader().parse(helvetikerRegular);

function addFrameAxisLabel(parent, text, rotationY = 0, placement = 'bottom') {
    const labelSize = placement === 'top' ? FRAME_AXIS_TITLE_SIZE : FRAME_AXIS_LABEL_SIZE;
    const geom = new TextGeometry(text, {
        font: helvetikerFont,
        size: labelSize,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const textH = bb.max.y - bb.min.y;
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mesh.rotation.y = rotationY;
    const labelZ = FRAME_PLANE_Z_EPS + 0.002;

    if (placement === 'left' || placement === 'right') {
        geom.translate(-(bb.min.x + bb.max.x) * 0.5, -(bb.min.y + bb.max.y) * 0.5, 0);
        const onRight = placement === 'right';
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(
            (onRight ? 1 : -1) * (frameHalfExtent + FRAME_AXIS_LABEL_PAD + textH * 0.5),
            0,
            labelZ
        );
    } else if (placement === 'top') {
        // Anchor cap height (bb.max.y), not bbox bottom — avoids 'y' descenders shifting titles.
        geom.translate(-(bb.min.x + bb.max.x) * 0.5, -bb.max.y, 0);
        mesh.position.set(0, frameHalfExtent + FRAME_AXIS_LABEL_TOP_PAD + 0.004, labelZ);
    } else {
        geom.translate(-(bb.min.x + bb.max.x) * 0.5, -bb.max.y, 0);
        mesh.position.set(0, -frameHalfExtent - FRAME_AXIS_LABEL_PAD, labelZ);
    }

    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
}

/** Single-letter symbol at an axis tip (same font/material as frame labels; z = 0 on wireframe). */
function addFrameAxisEndLabel(parent, text, rotationY = 0, tip = 'bottomRight', localOffsetX = 0, localOffsetY = 0) {
    const geom = new TextGeometry(text, {
        font: helvetikerFont,
        size: FRAME_AXIS_END_LABEL_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const textW = bb.max.x - bb.min.x;
    geom.translate(-(bb.min.x + bb.max.x) * 0.5, -bb.max.y, 0);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mesh.rotation.y = rotationY;
    const pad = FRAME_AXIS_END_LABEL_PAD;
    const yOut = -frameHalfExtent - pad;

    if (tip === 'bottomRight') {
        mesh.position.set(frameHalfExtent + pad + textW * 0.5 + localOffsetX, yOut + localOffsetY, 0);
    } else if (tip === 'bottomLeft') {
        mesh.position.set(-frameHalfExtent - pad - textW * 0.5 + localOffsetX, yOut + localOffsetY, 0);
    } else if (tip === 'leftTop') {
        mesh.position.set(
            -frameHalfExtent - pad - textW * 0.5 + localOffsetX,
            frameHalfExtent + FRAME_AXIS_END_LABEL_TOP_PAD + localOffsetY,
            0
        );
    } else if (tip === 'rightTop') {
        mesh.position.set(
            frameHalfExtent + pad + textW * 0.5 + localOffsetX,
            frameHalfExtent + FRAME_AXIS_END_LABEL_TOP_PAD + localOffsetY,
            0
        );
    }

    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
}

/** Endpoint label with regular font (used for numeric markers like ±1). */
function addFrameAxisNumericEndLabel(parent, text, rotationY = 0, tip = 'bottomRight') {
    const geom = new TextGeometry(text, {
        font: helvetikerRegularFont,
        size: FRAME_AXIS_END_LABEL_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const textW = bb.max.x - bb.min.x;
    geom.translate(-(bb.min.x + bb.max.x) * 0.5, -bb.max.y, 0);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mesh.rotation.y = rotationY;
    const pad = FRAME_AXIS_ZERO_LABEL_PAD;
    const yOut = -frameHalfExtent - pad;

    if (tip === 'bottomRight') {
        mesh.position.set(frameHalfExtent + pad + textW * 0.5, yOut, 0);
    } else if (tip === 'bottomLeft') {
        mesh.position.set(-frameHalfExtent - pad - textW * 0.5, yOut, 0);
    } else if (tip === 'leftTop') {
        mesh.position.set(
            -frameHalfExtent - pad - textW * 0.5,
            frameHalfExtent + FRAME_AXIS_END_LABEL_TOP_PAD,
            0
        );
    } else if (tip === 'rightTop') {
        mesh.position.set(
            frameHalfExtent + pad + textW * 0.5,
            frameHalfExtent + FRAME_AXIS_END_LABEL_TOP_PAD,
            0
        );
    }

    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
}

/** Numeric label on a frame axis tick (regular weight; same size/plane as axis-end symbols). */
function addFrameAxisZeroLabel(parent, rotationY = 0, edge, value, text = '0') {
    const geom = new TextGeometry(text, {
        font: helvetikerRegularFont,
        size: FRAME_AXIS_END_LABEL_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const textW = bb.max.x - bb.min.x;
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mesh.rotation.y = rotationY;
    const pad = FRAME_AXIS_ZERO_LABEL_PAD;

    if (edge === 'bottom') {
        geom.translate(-(bb.min.x + bb.max.x) * 0.5, -bb.max.y, 0);
        mesh.position.set(value, -frameHalfExtent - pad, 0);
    } else if (edge === 'left') {
        geom.translate(-(bb.min.x + bb.max.x) * 0.5, -(bb.min.y + bb.max.y) * 0.5, 0);
        mesh.position.set(-frameHalfExtent - pad - textW * 0.5, value, 0);
    } else if (edge === 'right') {
        geom.translate(-(bb.min.x + bb.max.x) * 0.5, -(bb.min.y + bb.max.y) * 0.5, 0);
        mesh.position.set(frameHalfExtent + pad + textW * 0.5, value, 0);
    }

    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
}

function formatAxisElapsedTime(totalSeconds) {
    const seconds = Math.max(0, totalSeconds);
    return `${seconds.toFixed(2)}`;
}

/** Time-axis label at t=0 with regular scientific time text. */
function addFrameTimeAxisZeroLabel(parent, rotationY = 0, value = 0) {
    const group = new THREE.Group();
    group.rotation.y = rotationY;
    group.position.set(value, -frameHalfExtent - FRAME_AXIS_ZERO_LABEL_PAD, 0);

    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const timeGeom = new TextGeometry('0.00', {
        font: helvetikerRegularFont,
        size: FRAME_AXIS_END_LABEL_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false
    });
    timeGeom.computeBoundingBox();
    const timeBb = timeGeom.boundingBox;
    const timeW = timeBb.max.x - timeBb.min.x;
    timeGeom.translate(-timeBb.min.x, -timeBb.max.y, 0);
    const timeMesh = new THREE.Mesh(timeGeom, material);
    timeMesh.position.set(-timeW * 0.5, 0, 0);
    group.add(timeMesh);
    group.frustumCulled = false;
    parent.add(group);

    return {
        group,
        timeMesh,
        update(seconds) {
            const next = formatAxisElapsedTime(seconds);
            const nextGeom = new TextGeometry(next, {
                font: helvetikerRegularFont,
                size: FRAME_AXIS_END_LABEL_SIZE,
                height: 0,
                curveSegments: 8,
                bevelEnabled: false
            });
            nextGeom.computeBoundingBox();
            const nextBb = nextGeom.boundingBox;
            const nextW = nextBb.max.x - nextBb.min.x;
            nextGeom.translate(-nextBb.min.x, -nextBb.max.y, 0);

            timeMesh.geometry.dispose();
            timeMesh.geometry = nextGeom;
            timeMesh.position.set(-nextW * 0.5, 0, 0);
        }
    };
}

addFrameAccentEdges(backPlaneVizGroup, 'left');
addFrameAxisZeroTick(backPlaneVizGroup, 'bottom', 0); // velocity = 0
addFrameAxisZeroTick(backPlaneVizGroup, 'left', equilibriumLocalY); // position = 0
addFrameAxisZeroGuides(backPlaneVizGroup, equilibriumLocalY);
addFrameAxisZeroLabel(backPlaneVizGroup, 0, 'bottom', 0);
addFrameAxisZeroLabel(backPlaneVizGroup, 0, 'left', equilibriumLocalY);
addFrameAxisZeroLabel(backPlaneVizGroup, 0, 'bottom', frameHalfExtent, '1');
addFrameAxisZeroLabel(backPlaneVizGroup, 0, 'left', frameHalfExtent, '1');
addFrameAxisNumericEndLabel(backPlaneVizGroup, '-1', 0, 'bottomLeft');
addFrameAxisEndLabel(backPlaneVizGroup, 'v', 0, 'bottomRight', 0.004, -0.0015);
addFrameAxisEndLabel(
    backPlaneVizGroup,
    'x',
    0,
    'leftTop',
    -0.02,
    -FRAME_AXIS_END_LABEL_TOP_PAD + FRAME_AXIS_END_LABEL_SIZE * 0.38
);
if (SHOW_FRAME_AXIS_TEXTS) {
    addFrameAxisLabel(backPlaneVizGroup, 'velocity', 0);
    addFrameAxisLabel(backPlaneVizGroup, 'position', 0, 'left');
}
addFrameAxisLabel(backPlaneVizGroup, 'Velocity vs Position', 0, 'top');

const backPhaseVizGroup = new THREE.Group();
backPhaseVizGroup.position.set(0, equilibriumLocalY, 0);
backPlaneVizGroup.add(backPhaseVizGroup);

/** Left reference plane (wireframe on −X face). */
const leftPlaneVizGroup = new THREE.Group();
leftPlaneVizGroup.position.set(containerLeftLocalX, 0, 0);
leftPlaneVizGroup.rotation.y = -Math.PI / 2;
containerGroup.add(leftPlaneVizGroup);

const containerLeftPlane = new THREE.LineSegments(backPlaneEdges, backPlaneWireMaterial);
containerLeftPlane.visible = true;
leftPlaneVizGroup.add(containerLeftPlane);

const LEFT_PLANE_Z_EPS = 0;

addFrameAccentEdges(leftPlaneVizGroup);
addFrameAxisZeroTick(leftPlaneVizGroup, 'bottom', 0); // time = now
addFrameAxisZeroTick(leftPlaneVizGroup, 'right', equilibriumLocalY); // position = 0
addFrameAxisZeroGuides(leftPlaneVizGroup, equilibriumLocalY);
const leftTimeAxisLabel = addFrameTimeAxisZeroLabel(leftPlaneVizGroup, Math.PI, 0);
leftTimeAxisLabel.group.visible = false;
addFrameAxisZeroLabel(leftPlaneVizGroup, Math.PI, 'right', equilibriumLocalY);
addFrameAxisZeroLabel(leftPlaneVizGroup, Math.PI, 'right', frameHalfExtent, '1');
addFrameAxisNumericEndLabel(leftPlaneVizGroup, '-1', Math.PI, 'bottomRight');
addFrameAxisEndLabel(leftPlaneVizGroup, 't', Math.PI, 'bottomLeft');
addFrameAxisEndLabel(
    leftPlaneVizGroup,
    'x',
    Math.PI,
    'rightTop',
    0.02,
    -FRAME_AXIS_END_LABEL_TOP_PAD + FRAME_AXIS_END_LABEL_SIZE * 0.39
);
if (SHOW_FRAME_AXIS_TEXTS) {
    addFrameAxisLabel(leftPlaneVizGroup, 'time', Math.PI);
    addFrameAxisLabel(leftPlaneVizGroup, 'position', Math.PI, 'right');
}
addFrameAxisLabel(leftPlaneVizGroup, 'Time vs Position', Math.PI, 'top');

/**
 * Shared in-place tube-mesh builder for curves that lie in a single Z-plane
 * (all control points share one Z value — true for the traveling-wave trace
 * and the phase-space spiral trail). Avoids allocating a fresh
 * TubeGeometry/BufferGeometry (and the GPU buffer create/destroy churn that
 * comes with swapping a mesh's geometry) every animation frame: the index
 * buffer is built once, and each update only rewrites the position/normal
 * typed arrays already bound to the mesh.
 */

const bottomPlaneVizGroup = new THREE.Group();
bottomPlaneVizGroup.position.set(0, containerBottomLocalY, 0);
bottomPlaneVizGroup.rotation.x = -Math.PI / 2;
containerGroup.add(bottomPlaneVizGroup);

bottomPlaneVizGroup.visible = false;


    const api = {
        containerHalf, containerBackLocalZ, containerLeftLocalX, containerBottomLocalY,
        equilibriumLocalY, CONTAINER_DEFAULT_YAW, containerGroup, DESKTOP_CONTAINER_POS,
        HEAD_OFFSET, containerCube, backPlaneVizGroup, backPhaseVizGroup,
        leftPlaneVizGroup, bottomPlaneVizGroup, LEFT_PLANE_Z_EPS,
        helvetikerFont, helvetikerRegularFont, frameHalfExtent, SHOW_FRAME_AXIS_TEXTS,
        backPlaneEdges, backPlaneWireMaterial,
    };
    Object.assign(deps, api);
    return api;
}
