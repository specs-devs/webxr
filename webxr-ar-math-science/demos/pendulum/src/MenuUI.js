import * as THREE from 'three';
import gsap from 'gsap';
import { Text as TroikaText } from 'troika-three-text';
import { bindHeadRelativePlacementOnSessionStart } from './XRHeadPlacement.js';

export function createMenuUI(deps) {
    const {
        scene, camera, renderer,
        containerGroup, containerSize, HEAD_OFFSET, DESKTOP_CONTAINER_POS, INITIAL_CONTAINER_SCALE,
        UIHeaderRef, UIHeaderRoot, updateUIHeaderRefPosition,
        lThumbObj, lIndexObj, rThumbObj, rIndexObj,
        pinchState,
        twoHandedManip, leftPinchJumpGuard, rightPinchJumpGuard,
        pendulumConfig, PENDULUM_DEFAULTS, pendulumState, grabInfo,
        isAnyGrabbed,
        mass1, mass2, mass1Label, mass2Label,
        mass1SphereGeomRefRadius, mass2SphereGeomRefRadius,
        getViewCameraWorld, computePendulumEnergies, setEnergyTarget,
        enforceConstraints, projectVelocitiesToConstraints, stabilizePendulumState,
        clearMass2Trail, updatePendulum,
        resetPendulumToVerticalRestPose, applyTinyResetSway, resetTransitionState,
        _upVector,
    } = deps;

    const { simFlags } = deps;
    // Mutable shared state (same pattern as Boids deps.UIPanelOn)
    deps.menuUIPanelOn = false;
    deps.menuFrameDelta = 0.016;

const menuTextureBase = ( import.meta.env.BASE_URL || '/' ).replace( /\/?$/, '/' );
const menuTextureLoader = new THREE.TextureLoader();
function loadMenuTexture( relativePath ) {
	const tex = menuTextureLoader.load( menuTextureBase + relativePath );
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
// ─── Info panel: pivot at cube center on rig; Y-billboard; Troika SDF text (no CanvasTexture / GPU bitmap uploads) ───
/** Logical layout width/height (px) — drives world positions relative to historic canvas layout */
const INFO_PANEL_TEX_W = 204;
const INFO_PANEL_TEX_H = 300;
const INFO_PANEL_FONT_PX = 12;
const infoPanelAspect = INFO_PANEL_TEX_W / INFO_PANEL_TEX_H;
/** World size of the info bbox vs base `containerSize * 0.52` height */
const INFO_PANEL_VISUAL_SCALE = 1.6;
const infoPlaneHeight = pendulumConfig.containerSize * 0.52 * INFO_PANEL_VISUAL_SCALE;
const infoPlaneWidth = infoPlaneHeight * infoPanelAspect;

/** Pixel layout — adjust gaps here without retuning world math. */
const INFO_PANEL_LAYOUT = {
	originX: 14,
	originY: 22,
	headerStepY: 22,
	rowStepY: 18,
	gapSpeedToEnergyY: 18,
	valueMarginX: 14,
	columnTightenPx: 68,
	speedDotRadius: 5,
	speedDot2Radius: 5,
	speedLabelGapAfterDot: 6,
	colorText: '#ffffff',
	speedDotM1: '#e8732a',
	speedDotM2: '#e8c938'
};

/** Speed column: SI m/s, extra fraction when |v| < 10 (typical lab pendulum range). */
function formatInfoPanelSpeed( speed ) {
	if ( ! Number.isFinite( speed ) ) return '— m/s';
	if ( Math.abs( speed ) >= 10 ) return `${ speed.toFixed( 1 ) } m/s`;
	return `${ speed.toFixed( 2 ) } m/s`;
}

/** Energy column: SI joules; more decimals when |E| is small (textbook-style readability). */
function formatInfoPanelEnergyJoules( joules ) {
	if ( ! Number.isFinite( joules ) ) return '— J';
	const a = Math.abs( joules );
	if ( a >= 100 ) return `${ joules.toFixed( 1 ) } J`;
	if ( a >= 1 ) return `${ joules.toFixed( 2 ) } J`;
	return `${ joules.toFixed( 3 ) } J`;
}

/** Right column strings — update via setInfoPanelValues(). */
const _infoEnergyInit = computePendulumEnergies( pendulumState );
const infoPanelValues = {
	speedM1: `${ pendulumState.vel1.length().toFixed( 2 ) } m/s`,
	speedM2: `${ pendulumState.vel2.length().toFixed( 2 ) } m/s`,
	energyKE: formatInfoPanelEnergyJoules( _infoEnergyInit.ke ),
	energyPE: formatInfoPanelEnergyJoules( _infoEnergyInit.pe ),
	energyTotal: formatInfoPanelEnergyJoules( _infoEnergyInit.total ),
};

const _infoRowPxY = ( () => {

	const L = INFO_PANEL_LAYOUT;
	let py = L.originY;
	const r = {};
	r.speedHeader = py;
	py += L.headerStepY;
	r.m1 = py;
	py += L.rowStepY;
	r.m2 = py;
	py += L.rowStepY + L.gapSpeedToEnergyY;
	r.energyHeader = py;
	py += L.headerStepY;
	r.ke = py;
	py += L.rowStepY;
	r.pe = py;
	py += L.rowStepY;
	r.total = py;
	return r;

} )();

const _infoPxLocal = new THREE.Vector3();
function infoPanelPixelToLocal( px, py, z = 0.002 ) {

	_infoPxLocal.set(
		( px / INFO_PANEL_TEX_W - 0.5 ) * infoPlaneWidth,
		( 0.5 - py / INFO_PANEL_TEX_H ) * infoPlaneHeight,
		z
	);
	return _infoPxLocal;

}

const infoFontSizeWorld = INFO_PANEL_FONT_PX / INFO_PANEL_TEX_H * infoPlaneHeight;

function createStatsTroikaText() {

	const t = new TroikaText();
	t.fontSize = infoFontSizeWorld;
	t.fontWeight = 'bold';
	t.anchorY = 'middle';
	t.material.depthWrite = false;
	t.material.toneMapped = false;
	t.frustumCulled = false;
	t.color = 0xffffff;
	/** WebGL SDF path can glitch on some XR/mobile stacks; worker SDF is more stable here. */
	t.gpuAccelerateSDF = false;
	return t;

}

const _L = INFO_PANEL_LAYOUT;
const _colRightPx = INFO_PANEL_TEX_W - _L.valueMarginX - _L.columnTightenPx;
const _massLabelLeftPx = _L.originX + 2 * Math.max( _L.speedDotRadius, _L.speedDot2Radius ) + _L.speedLabelGapAfterDot;
const INFO_DOT_HEX = {
	m1: parseInt( _L.speedDotM1.slice( 1 ), 16 ),
	m2: parseInt( _L.speedDotM2.slice( 1 ), 16 )
};

const infoPanelPlane = new THREE.Group();
infoPanelPlane.name = 'InfoPanel';
infoPanelPlane.frustumCulled = false;
infoPanelPlane.position.set( -0.46, 0.12, 0.2 );

function addStatsDotMesh( pyPx, radiusPx, colorHex ) {

	const rw = radiusPx / INFO_PANEL_TEX_H * infoPlaneHeight;
	const mesh = new THREE.Mesh(
		new THREE.CircleGeometry( 1, 32 ),
		new THREE.MeshBasicMaterial( {
			color: colorHex,
			toneMapped: false,
			depthWrite: false,
			side: THREE.DoubleSide
		} )
	);
	mesh.scale.setScalar( rw );
	const p = infoPanelPixelToLocal( _L.originX + radiusPx, pyPx, 0 );
	mesh.position.copy( p );
	mesh.frustumCulled = false;
	infoPanelPlane.add( mesh );

}

function addStatsLabel( label, px, pyPx ) {

	const t = createStatsTroikaText();
	t.text = label;
	t.anchorX = 'left';
	t.position.copy( infoPanelPixelToLocal( px, pyPx, 0.002 ) );
	t.sync();
	infoPanelPlane.add( t );

}

/**
 * M₁ / M₂: Unicode subscripts are missing from Troika’s default glyph set — fake with M + small digit.
 * @param {string} digit '1' | '2'
 */
function addStatsMassSubscriptLabel( px, pyPx, digit ) {

	const g = new THREE.Group();
	g.position.copy( infoPanelPixelToLocal( px, pyPx, 0.002 ) );
	g.frustumCulled = false;

	const letter = createStatsTroikaText();
	letter.text = 'M';
	letter.anchorX = 'left';
	letter.anchorY = 'middle';
	letter.sync();

	const subNum = createStatsTroikaText();
	subNum.text = digit;
	subNum.fontSize = infoFontSizeWorld * 0.64;
	subNum.anchorX = 'left';
	subNum.anchorY = 'middle';
	/** Sit just past the M’s advance width (~0.85–0.95 em on bold sans); 0.62 em overlapped the letter. */
	subNum.position.x = infoFontSizeWorld * 0.98;
	subNum.position.y = -infoFontSizeWorld * 0.27;
	subNum.sync();

	g.add( letter );
	g.add( subNum );
	infoPanelPlane.add( g );

}

function addStatsValueRight( troikaMesh, pyPx ) {

	troikaMesh.anchorX = 'right';
	troikaMesh.position.copy( infoPanelPixelToLocal( _colRightPx, pyPx, 0.002 ) );
	troikaMesh.sync();
	infoPanelPlane.add( troikaMesh );

}

addStatsLabel( 'SPEED', _L.originX, _infoRowPxY.speedHeader );
addStatsDotMesh( _infoRowPxY.m1, _L.speedDotRadius, INFO_DOT_HEX.m1 );
addStatsMassSubscriptLabel( _massLabelLeftPx, _infoRowPxY.m1, '1' );
addStatsDotMesh( _infoRowPxY.m2, _L.speedDot2Radius, INFO_DOT_HEX.m2 );
addStatsMassSubscriptLabel( _massLabelLeftPx, _infoRowPxY.m2, '2' );
addStatsLabel( 'ENERGY', _L.originX, _infoRowPxY.energyHeader );
addStatsLabel( 'KE', _L.originX, _infoRowPxY.ke );
addStatsLabel( 'PE', _L.originX, _infoRowPxY.pe );
addStatsLabel( 'Total', _L.originX, _infoRowPxY.total );

const infoTxtSpeedM1 = createStatsTroikaText();
infoTxtSpeedM1.text = infoPanelValues.speedM1;
addStatsValueRight( infoTxtSpeedM1, _infoRowPxY.m1 );

const infoTxtSpeedM2 = createStatsTroikaText();
infoTxtSpeedM2.text = infoPanelValues.speedM2;
addStatsValueRight( infoTxtSpeedM2, _infoRowPxY.m2 );

const infoTxtKE = createStatsTroikaText();
infoTxtKE.text = infoPanelValues.energyKE;
addStatsValueRight( infoTxtKE, _infoRowPxY.ke );

const infoTxtPE = createStatsTroikaText();
infoTxtPE.text = infoPanelValues.energyPE;
addStatsValueRight( infoTxtPE, _infoRowPxY.pe );

const infoTxtTot = createStatsTroikaText();
infoTxtTot.text = infoPanelValues.energyTotal;
addStatsValueRight( infoTxtTot, _infoRowPxY.total );

/**
 * Merge partial value strings; Troika refreshes glyphs (no CanvasTexture uploads).
 * @param {Partial<typeof infoPanelValues>} partial
 */
function setInfoPanelValues( partial ) {

	Object.assign( infoPanelValues, partial );
	infoTxtSpeedM1.text = infoPanelValues.speedM1;
	infoTxtSpeedM2.text = infoPanelValues.speedM2;
	infoTxtKE.text = infoPanelValues.energyKE;
	infoTxtPE.text = infoPanelValues.energyPE;
	infoTxtTot.text = infoPanelValues.energyTotal;

}

const infoPanelPivot = new THREE.Object3D();
infoPanelPivot.name = 'InfoPanelPivot';
infoPanelPivot.frustumCulled = false;
infoPanelPivot.position.set( 0, 0, 0 );
containerGroup.add( infoPanelPivot );
infoPanelPivot.add( infoPanelPlane );

/** Net world size s × (REF/s × mul) = REF × mul while gap scales with rig */
const INFO_PANEL_REF_CONTAINER_SCALE = containerGroup.scale.x || 1;
const INFO_PANEL_SIZE_MUL = 0.88;

/** Hysteresis: hide floating header + stats panel when rig scale crosses up through this */
const CONTAINER_UI_OVERSCALE_HIDE_AT = 1.22;
/** Reveal again only after scale drops below this (must be < HIDE_AT to avoid threshold flicker) */
const CONTAINER_UI_OVERSCALE_SHOW_AT = 1.08;
let containerOverscaleUIHidden = false;
/** Multiplier on info plane scale while STATS is on (GSAP 0–1 when overscaled) */
const infoPanelOverscaleMul = { v: 1 };
/** Last synced overscale mul target; declared before applyInfoUIVisibility() init call (TDZ) */
let infoOverscaleMulAnimTarget = 1;

const _infoPivotWorld = new THREE.Vector3();
const _infoPlaneWorld = new THREE.Vector3();
const _infoPivotCam = new THREE.Vector3();
const _infoPivotCamQuat = new THREE.Quaternion();
const _infoPivotLookDir = new THREE.Vector3();
const _infoContainerWorldQuat = new THREE.Quaternion();
const _infoBillboardWorldQuat = new THREE.Quaternion();

function updateInfoPanelWorldScale() {
	const s = containerGroup.scale.x || 1;
	const base = ( INFO_PANEL_REF_CONTAINER_SCALE / s ) * INFO_PANEL_SIZE_MUL;
	const overscaleMul = simFlags.infoUIEnabled && containerOverscaleUIHidden ? infoPanelOverscaleMul.v : 1;
	infoPanelPlane.scale.setScalar( base * overscaleMul );
}

/**
 * Pivot at container center; world Y-billboard toward camera (heading only, like UIHeaderRoot).
 * Heading uses the panel world position (not cube center) so yaw matches the camera for the offset plane.
 */
function updateInfoPanelPivot() {
	getViewCameraWorld( _infoPivotCam, _infoPivotCamQuat );
	containerGroup.getWorldQuaternion( _infoContainerWorldQuat );

	const applyHeadingFrom = ( worldAnchor ) => {
		_infoPivotLookDir.copy( _infoPivotCam ).sub( worldAnchor );
		_infoPivotLookDir.y = 0;
		if ( _infoPivotLookDir.lengthSq() <= 0.0001 ) return false;
		const heading = Math.atan2( _infoPivotLookDir.x, _infoPivotLookDir.z );
		_infoBillboardWorldQuat.setFromAxisAngle( _upVector, heading );
		infoPanelPivot.quaternion.copy( _infoContainerWorldQuat ).invert().multiply( _infoBillboardWorldQuat );
		return true;
	};

	// Pass 1: cube center (stable seed). Pass 2: plane center after matrices catch up.
	infoPanelPivot.getWorldPosition( _infoPivotWorld );
	applyHeadingFrom( _infoPivotWorld );
	containerGroup.updateMatrixWorld( true );
	infoPanelPlane.getWorldPosition( _infoPlaneWorld );
	applyHeadingFrom( _infoPlaneWorld );
}

updateInfoPanelWorldScale();
updateInfoPanelPivot();
const UI_HEADER_ASPECT = 528 / 144;
const UI_HEADER_PLANE_SCALE = 1.2;
const UIHeaderWidth = 0.35 * UI_HEADER_PLANE_SCALE;
const UIHeaderHeight = UIHeaderWidth / UI_HEADER_ASPECT;
const UIHeaderGeometry = new THREE.PlaneGeometry( UIHeaderWidth, UIHeaderHeight );
const uiHeaderTex = loadMenuTexture( 'static/ui-header.png' );
const UIHeaderMaterial = new THREE.MeshBasicMaterial( {
	map: uiHeaderTex,
	color: 0xffffff,
	side: THREE.DoubleSide,
	transparent: true,
	depthTest: false
} );
const UIHeader = new THREE.Mesh( UIHeaderGeometry, UIHeaderMaterial );
UIHeader.name = 'UIHeader';
UIHeader.frustumCulled = false;
UIHeader.position.set( 0, 0, 0.01 );
UIHeaderRoot.add( UIHeader );

/** Scale for header checkbox meshes + canvas labels (TRAIL / STATS) */
const HEADER_CHECKBOX_LABEL_SCALE = 0.94;
const checkboxSize = 0.025 * HEADER_CHECKBOX_LABEL_SCALE;

/** Anchor groups only (no ui-toggle.png plate) — same local poses as the old toggle planes */
const UIToggle = new THREE.Object3D();
UIToggle.name = 'UIToggle';
UIToggle.position.set( -0.098, -0.075, 0.001 );
UIToggle.frustumCulled = false;
UIHeader.add( UIToggle );

const checkboxTex = loadMenuTexture( 'static/ui-checkbox.png' );
const UIToggleCheckbox = new THREE.Mesh(
	new THREE.PlaneGeometry( checkboxSize, checkboxSize ),
	new THREE.MeshBasicMaterial( {
		map: checkboxTex,
		transparent: true,
		side: THREE.DoubleSide,
		depthTest: false
	} )
);
UIToggleCheckbox.position.set( -0.08, 0, 0.001 );
UIToggleCheckbox.frustumCulled = false;
UIToggle.add( UIToggleCheckbox );

const checkboxInSize = checkboxSize * 0.5;
const checkboxInTex = loadMenuTexture( 'static/ui-checkbox-in.png' );
const UIToggleCheckboxIn = new THREE.Mesh(
	new THREE.PlaneGeometry( checkboxInSize, checkboxInSize ),
	new THREE.MeshBasicMaterial( {
		map: checkboxInTex,
		transparent: true,
		side: THREE.DoubleSide,
		depthTest: false
	} )
);
UIToggleCheckboxIn.position.set( 0, 0, 0.001 );
UIToggleCheckboxIn.frustumCulled = false;
UIToggleCheckboxIn.visible = true;
UIToggleCheckbox.add( UIToggleCheckboxIn );

const toggleTextCanvas = document.createElement( 'canvas' );
toggleTextCanvas.width = 512;
toggleTextCanvas.height = 64;
const toggleTextCtx = toggleTextCanvas.getContext( '2d' );
toggleTextCtx.fillStyle = '#ffffff';
toggleTextCtx.font = `bold ${ Math.round( 48 * HEADER_CHECKBOX_LABEL_SCALE ) }px system-ui, sans-serif`;
toggleTextCtx.textAlign = 'center';
toggleTextCtx.textBaseline = 'middle';
toggleTextCtx.fillText( 'TRAIL', toggleTextCanvas.width / 2, toggleTextCanvas.height / 2 );
const toggleTextTexture = new THREE.CanvasTexture( toggleTextCanvas );
toggleTextTexture.colorSpace = THREE.SRGBColorSpace;
const UIToggleText = new THREE.Mesh(
	new THREE.PlaneGeometry( 0.25 * 0.8 * HEADER_CHECKBOX_LABEL_SCALE, 0.0312 * 0.8 * HEADER_CHECKBOX_LABEL_SCALE ),
	new THREE.MeshBasicMaterial( {
		map: toggleTextTexture,
		transparent: true,
		side: THREE.DoubleSide,
		depthTest: false
	} )
);
UIToggleText.position.set( -0.035, 0, 0.001 );
UIToggleText.frustumCulled = false;
UIToggle.add( UIToggleText );

const UIToggleInfo = new THREE.Object3D();
UIToggleInfo.name = 'UIToggleInfo';
UIToggleInfo.position.set( 0.022, -0.075, 0.001 );
UIToggleInfo.frustumCulled = false;
UIHeader.add( UIToggleInfo );

const UIToggleInfoCheckbox = new THREE.Mesh(
	new THREE.PlaneGeometry( checkboxSize, checkboxSize ),
	new THREE.MeshBasicMaterial( {
		map: checkboxTex,
		transparent: true,
		side: THREE.DoubleSide,
		depthTest: false
	} )
);
UIToggleInfoCheckbox.position.set( -0.09, 0, 0.001 );
UIToggleInfoCheckbox.frustumCulled = false;
UIToggleInfo.add( UIToggleInfoCheckbox );

const UIToggleInfoCheckboxIn = new THREE.Mesh(
	new THREE.PlaneGeometry( checkboxInSize, checkboxInSize ),
	new THREE.MeshBasicMaterial( {
		map: checkboxInTex,
		transparent: true,
		side: THREE.DoubleSide,
		depthTest: false
	} )
);
UIToggleInfoCheckboxIn.position.set( 0, 0, 0.001 );
UIToggleInfoCheckboxIn.frustumCulled = false;
UIToggleInfoCheckboxIn.visible = simFlags.infoUIEnabled;
UIToggleInfoCheckbox.add( UIToggleInfoCheckboxIn );

const infoToggleTextCanvas = document.createElement( 'canvas' );
infoToggleTextCanvas.width = 512;
infoToggleTextCanvas.height = 64;
const infoToggleTextCtx = infoToggleTextCanvas.getContext( '2d' );
infoToggleTextCtx.fillStyle = '#ffffff';
infoToggleTextCtx.font = `bold ${ Math.round( 48 * HEADER_CHECKBOX_LABEL_SCALE ) }px system-ui, sans-serif`;
infoToggleTextCtx.textAlign = 'center';
infoToggleTextCtx.textBaseline = 'middle';
infoToggleTextCtx.fillText( 'STATS', infoToggleTextCanvas.width / 2, infoToggleTextCanvas.height / 2 );
const infoToggleTextTexture = new THREE.CanvasTexture( infoToggleTextCanvas );
infoToggleTextTexture.colorSpace = THREE.SRGBColorSpace;
const UIToggleInfoText = new THREE.Mesh(
	new THREE.PlaneGeometry( 0.25 * 0.8 * HEADER_CHECKBOX_LABEL_SCALE, 0.0312 * 0.8 * HEADER_CHECKBOX_LABEL_SCALE ),
	new THREE.MeshBasicMaterial( {
		map: infoToggleTextTexture,
		transparent: true,
		side: THREE.DoubleSide,
		depthTest: false
	} )
);
UIToggleInfoText.position.set( -0.042, 0, 0.001 );
UIToggleInfoText.frustumCulled = false;
UIToggleInfo.add( UIToggleInfoText );

function applyInfoUIVisibility() {
	mass1Label.visible = simFlags.infoUIEnabled;
	mass2Label.visible = simFlags.infoUIEnabled;
	infoPanelPivot.visible = simFlags.infoUIEnabled;
	/** STATS on while already zoom-past-threshold: avoid one frame at full scale before tween */
	syncInfoPanelOverscaleMul( { snapIfHidden: true } );
}
applyInfoUIVisibility();

const _headerAnchorWorld = new THREE.Vector3();
const _headerCamWorld = new THREE.Vector3();
const _headerLookDir = new THREE.Vector3();
const _headerBillboardQuat = new THREE.Quaternion();

function updateUIHeaderRoot() {
	UIHeaderRef.getWorldPosition( _headerAnchorWorld );
	UIHeaderRoot.position.copy( _headerAnchorWorld );
	getViewCameraWorld( _headerCamWorld, _headerBillboardQuat );
	_headerLookDir.copy( _headerCamWorld ).sub( _headerAnchorWorld );
	_headerLookDir.y = 0;
	if ( _headerLookDir.lengthSq() > 0.0001 ) {
		const heading = Math.atan2( _headerLookDir.x, _headerLookDir.z );
		UIHeaderRoot.quaternion.setFromAxisAngle( _upVector, heading );
	}
}

const UIHeaderState = {
	isInsideCube: false
};

let uiHeaderScaleAnimTarget = 1;

function getUIHeaderScaleTarget() {
	return ( UIHeaderState.isInsideCube || containerOverscaleUIHidden ) ? 0 : 1;
}

function syncUIHeaderScaleTarget() {
	const t = getUIHeaderScaleTarget();
	if ( t === uiHeaderScaleAnimTarget ) return;
	uiHeaderScaleAnimTarget = t;
	gsap.killTweensOf( UIHeader.scale );
	gsap.to( UIHeader.scale, {
		x: t, y: t, z: t,
		duration: 0.35,
		ease: 'power2.inOut'
	} );
}

/**
 * @param {{ snapIfHidden?: boolean }} [opts] If STATS was just enabled while already overscaled, snap to 0 (no flash).
 */
function syncInfoPanelOverscaleMul( opts = {} ) {
	if ( ! simFlags.infoUIEnabled ) {
		gsap.killTweensOf( infoPanelOverscaleMul );
		infoPanelOverscaleMul.v = 1;
		infoOverscaleMulAnimTarget = 1;
		return;
	}
	const t = containerOverscaleUIHidden ? 0 : 1;
	if ( opts.snapIfHidden && t === 0 ) {
		gsap.killTweensOf( infoPanelOverscaleMul );
		infoPanelOverscaleMul.v = 0;
		infoOverscaleMulAnimTarget = 0;
		return;
	}
	if ( t === infoOverscaleMulAnimTarget ) return;
	infoOverscaleMulAnimTarget = t;
	gsap.killTweensOf( infoPanelOverscaleMul );
	gsap.to( infoPanelOverscaleMul, {
		v: t,
		duration: 0.35,
		ease: 'power2.inOut'
	} );
}

function updateContainerOverscaleUI() {
	const s = containerGroup.scale.x;
	let changed = false;
	if ( ! containerOverscaleUIHidden && s >= CONTAINER_UI_OVERSCALE_HIDE_AT ) {
		containerOverscaleUIHidden = true;
		changed = true;
	} else if ( containerOverscaleUIHidden && s <= CONTAINER_UI_OVERSCALE_SHOW_AT ) {
		containerOverscaleUIHidden = false;
		changed = true;
	}
	if ( changed ) {
		syncUIHeaderScaleTarget();
		syncInfoPanelOverscaleMul();
	}
}

function updateUIHeaderInsideCube( inside = isCameraInsideMenuCube() ) {
	if ( inside === UIHeaderState.isInsideCube ) return;
	UIHeaderState.isInsideCube = inside;
	syncUIHeaderScaleTarget();
}

const _toggleCheckboxWorld = new THREE.Vector3();

function checkTogglePress() {
	if ( ! menuButtonState.xrReady ) return;
	if ( menuButtonState.cooldown > 0 ) return;
	if ( isCameraInsideMenuCube() ) return;
	if ( UIHeader.scale.x < 0.01 ) return;

	UIToggleCheckbox.getWorldPosition( _toggleCheckboxWorld );
	let dL = lIndexObj.position.distanceToSquared( _toggleCheckboxWorld );
	let dR = rIndexObj.position.distanceToSquared( _toggleCheckboxWorld );
	if ( dL < MENU_BUTTON_PRESS_DIST_SQ || dR < MENU_BUTTON_PRESS_DIST_SQ ) {
		onTogglePressed();
		return;
	}
	UIToggleInfoCheckbox.getWorldPosition( _toggleCheckboxWorld );
	dL = lIndexObj.position.distanceToSquared( _toggleCheckboxWorld );
	dR = rIndexObj.position.distanceToSquared( _toggleCheckboxWorld );
	if ( dL < MENU_BUTTON_PRESS_DIST_SQ || dR < MENU_BUTTON_PRESS_DIST_SQ ) {
		onInfoTogglePressed();
	}
}

function onTogglePressed() {
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( UIToggleCheckbox );
	simFlags.trailsEnabled = ! simFlags.trailsEnabled;
	UIToggleCheckboxIn.visible = simFlags.trailsEnabled;
	if ( ! simFlags.trailsEnabled ) clearMass2Trail();
}

function onInfoTogglePressed() {
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( UIToggleInfoCheckbox );
	simFlags.infoUIEnabled = ! simFlags.infoUIEnabled;
	UIToggleInfoCheckboxIn.visible = simFlags.infoUIEnabled;
	applyInfoUIVisibility();
}
updateUIHeaderRefPosition();

const menuEdgeOffset = () => pendulumConfig.containerSize * 0.5;
const menuOuterOffset = 0.06;
const menuDownOffset = 0.06;

const menuEdgeLocalPositions = [
	new THREE.Vector3( 0, -menuEdgeOffset(), -menuEdgeOffset() ),
	new THREE.Vector3( 0, -menuEdgeOffset(), menuEdgeOffset() ),
	new THREE.Vector3( -menuEdgeOffset(), -menuEdgeOffset(), 0 ),
	new THREE.Vector3( menuEdgeOffset(), -menuEdgeOffset(), 0 )
];

const menuEdgeOffsetDirections = [
	new THREE.Vector3( 0, -1, -1 ).normalize(),
	new THREE.Vector3( 0, -1, 1 ).normalize(),
	new THREE.Vector3( -1, -1, 0 ).normalize(),
	new THREE.Vector3( 1, -1, 0 ).normalize()
];

const menuReferenceNormals = [
	new THREE.Vector3( 0, 0, -1 ),
	new THREE.Vector3( 0, 0, 1 ),
	new THREE.Vector3( -1, 0, 0 ),
	new THREE.Vector3( 1, 0, 0 )
];

const menuUIReferencePoint = [
	new THREE.Object3D(),
	new THREE.Object3D(),
	new THREE.Object3D(),
	new THREE.Object3D()
];
menuUIReferencePoint.forEach( p => scene.add( p ) );

const _menuEdgeWorldPos = new THREE.Vector3();
const _menuOffsetDir = new THREE.Vector3();

function updateMenuUIReferencePositions() {
	const scale = containerGroup.scale.x;
	for ( let i = 0; i < 4; i ++ ) {
		_menuEdgeWorldPos.copy( menuEdgeLocalPositions[ i ] )
			.multiplyScalar( scale )
			.applyQuaternion( containerGroup.quaternion )
			.add( containerGroup.position );
		_menuOffsetDir.copy( menuEdgeOffsetDirections[ i ] )
			.applyQuaternion( containerGroup.quaternion );
		const combined = Math.sqrt( menuOuterOffset * menuOuterOffset + menuDownOffset * menuDownOffset );
		_menuEdgeWorldPos.addScaledVector( _menuOffsetDir, combined );
		menuUIReferencePoint[ i ].position.copy( _menuEdgeWorldPos );
		menuUIReferencePoint[ i ].quaternion.copy( containerGroup.quaternion );
	}
}

updateMenuUIReferencePositions();

const menuUIRoot = new THREE.Object3D();
scene.add( menuUIRoot );

const menuUIConfig = { currentEdgeIndex: 0 };

const _menuCamWorld = new THREE.Vector3();
const _menuRefWorld = new THREE.Vector3();
const _menuRefNormal = new THREE.Vector3();
const _menuToCam = new THREE.Vector3();
const _menuLookAt = new THREE.Vector3();

/** Same idea as script-ONLY-REF.js / menu-button-ref: axis-aligned slab around container center */
function isCameraInsideMenuCube() {
	camera.getWorldPosition( _menuCamWorld );
	const scaledHalfSize = pendulumConfig.containerSize * 0.5 * containerGroup.scale.x;
	const p = containerGroup.position;
	return (
		Math.abs( _menuCamWorld.x - p.x ) < scaledHalfSize &&
		Math.abs( _menuCamWorld.y - p.y ) < scaledHalfSize &&
		Math.abs( _menuCamWorld.z - p.z ) < scaledHalfSize
	);
}

function updateMenuUIRoot( camInside = isCameraInsideMenuCube() ) {
	if ( camInside ) {
		menuUIRoot.visible = false;
		return;
	}
	menuUIRoot.visible = true;
	camera.getWorldPosition( _menuCamWorld );
	let best = 0;
	let bestScore = -Infinity;
	for ( let i = 0; i < menuUIReferencePoint.length; i ++ ) {
		menuUIReferencePoint[ i ].getWorldPosition( _menuRefWorld );
		_menuRefNormal.copy( menuReferenceNormals[ i ] ).applyQuaternion( containerGroup.quaternion );
		_menuToCam.subVectors( _menuCamWorld, _menuRefWorld ).normalize();
		const facing = _menuToCam.dot( _menuRefNormal );
		const distScore = 1 / ( _menuCamWorld.distanceTo( _menuRefWorld ) + 0.1 );
		const score = facing * distScore;
		if ( facing > 0 && score > bestScore ) {
			bestScore = score;
			best = i;
		}
	}
	menuUIReferencePoint[ best ].getWorldPosition( _menuRefWorld );
	menuUIRoot.position.copy( _menuRefWorld );
	_menuRefNormal.copy( menuReferenceNormals[ best ] ).applyQuaternion( containerGroup.quaternion );
	_menuLookAt.copy( menuUIRoot.position ).add( _menuRefNormal );
	menuUIRoot.lookAt( _menuLookAt );
	menuUIConfig.currentEdgeIndex = best;
}

/** Menu panel texture layout (e.g. 511×305; ui-menu.png is 5× that, same aspect) */
const MENU_PANEL_TEX_W = 511;
const MENU_PANEL_TEX_H = 305;
const menuPanelPlaneAspect = MENU_PANEL_TEX_W / MENU_PANEL_TEX_H;
const _menuPanelPlaneArea = 0.2535 * 0.2343;
const menuPlaneHeight = Math.sqrt( _menuPanelPlaneArea / menuPanelPlaneAspect );
const menuPlaneWidth = menuPlaneHeight * menuPanelPlaneAspect;
const menuPlaneGeom = new THREE.PlaneGeometry( menuPlaneWidth, menuPlaneHeight );
const menuPanelTex = loadMenuTexture( 'static/ui-menu.png' );
const menuUIPlane = new THREE.Mesh(
	menuPlaneGeom,
	new THREE.MeshBasicMaterial( { map: menuPanelTex, side: THREE.DoubleSide, transparent: true } )
);
menuUIPlane.rotation.x = -22.5 * Math.PI / 180;
menuUIPlane.scale.set( 0, 0, 0 );
menuUIPlane.visible = false;
menuUIRoot.add( menuUIPlane );

const MENU_PAUSE_PLAY_TEX_W = 160;
const MENU_PAUSE_PLAY_TEX_H = 56;
const MENU_PAUSE_PLAY_WIDTH = 0.08;
const menuPausePlayAspect = MENU_PAUSE_PLAY_TEX_W / MENU_PAUSE_PLAY_TEX_H;
const MENU_PAUSE_PLAY_HEIGHT = MENU_PAUSE_PLAY_WIDTH / menuPausePlayAspect;
/** Horizontal spacing between Pause / Speed / Reset row (center to center). */
const MENU_ROW_BUTTON_X_STEP = MENU_PAUSE_PLAY_WIDTH + 0.004;
const MENU_ROW_BUTTON_Y = 0.066;
const MENU_ROW_BUTTON_Z = 0.01;
const MENU_ROW_PAUSE_PLAY_X = -0.105;
const menuPauseTex = loadMenuTexture( 'static/ui-button-pause.png' );
const menuPlayTex = loadMenuTexture( 'static/ui-button-play.png' );
const menuSpeedTex = loadMenuTexture( 'static/ui-button-speed.png' );
const menuResetTex = loadMenuTexture( 'static/ui-button-reset.png' );
const menuUIPausePlayButton = new THREE.Mesh(
	new THREE.PlaneGeometry( MENU_PAUSE_PLAY_WIDTH, MENU_PAUSE_PLAY_HEIGHT ),
	new THREE.MeshBasicMaterial( { map: menuPauseTex, side: THREE.DoubleSide, transparent: true, depthTest: false } )
);
menuUIPausePlayButton.position.set( MENU_ROW_PAUSE_PLAY_X, MENU_ROW_BUTTON_Y, MENU_ROW_BUTTON_Z );
menuUIPlane.add( menuUIPausePlayButton );

const menuUISpeedButton = new THREE.Mesh(
	new THREE.PlaneGeometry( MENU_PAUSE_PLAY_WIDTH, MENU_PAUSE_PLAY_HEIGHT ),
	new THREE.MeshBasicMaterial( { map: menuSpeedTex, side: THREE.DoubleSide, transparent: true, depthTest: false } )
);
menuUISpeedButton.position.set( MENU_ROW_PAUSE_PLAY_X + MENU_ROW_BUTTON_X_STEP, MENU_ROW_BUTTON_Y, MENU_ROW_BUTTON_Z );
menuUIPlane.add( menuUISpeedButton );

const MENU_SPEED_LABEL_CANVAS_W = 512;
const MENU_SPEED_LABEL_CANVAS_H = 128;
const menuSpeedLabelCanvas = document.createElement( 'canvas' );
menuSpeedLabelCanvas.width = MENU_SPEED_LABEL_CANVAS_W;
menuSpeedLabelCanvas.height = MENU_SPEED_LABEL_CANVAS_H;
const menuSpeedLabelCtx = menuSpeedLabelCanvas.getContext( '2d' );
const menuSpeedLabelTex = new THREE.CanvasTexture( menuSpeedLabelCanvas );
menuSpeedLabelTex.colorSpace = THREE.SRGBColorSpace;
menuSpeedLabelTex.minFilter = THREE.LinearFilter;
menuSpeedLabelTex.magFilter = THREE.LinearFilter;
menuSpeedLabelTex.generateMipmaps = false;

const MENU_SPEED_LEVELS = [
	{ label: 'Speed: 0.5x', timeScale: 0.5 },
	{ label: 'Speed: 1x', timeScale: 1 },
	{ label: 'Speed: 2x', timeScale: 2 }
];
const menuSpeedButtonState = {
	/** Index into MENU_SPEED_LEVELS; default 1x */
	index: 1
};

function setMenuSpeedButtonLabelText( text ) {

	if ( ! menuSpeedLabelCtx ) return;
	menuSpeedLabelCtx.clearRect( 0, 0, MENU_SPEED_LABEL_CANVAS_W, MENU_SPEED_LABEL_CANVAS_H );
	menuSpeedLabelCtx.font = '600 52px Helvetica, Arial, sans-serif';
	menuSpeedLabelCtx.fillStyle = '#ffff00';
	menuSpeedLabelCtx.textAlign = 'center';
	menuSpeedLabelCtx.textBaseline = 'middle';
	menuSpeedLabelCtx.fillText( text, MENU_SPEED_LABEL_CANVAS_W * 0.5, MENU_SPEED_LABEL_CANVAS_H * 0.5 );
	menuSpeedLabelTex.needsUpdate = true;

}

function syncMenuSpeedButtonFromState() {

	const level = MENU_SPEED_LEVELS[ menuSpeedButtonState.index ];
	pendulumConfig.timeScale = level.timeScale;
	setMenuSpeedButtonLabelText( level.label );

}

syncMenuSpeedButtonFromState();

const menuSpeedLabelPlaneW = MENU_PAUSE_PLAY_WIDTH * 0.92;
const menuSpeedLabelPlaneH = menuSpeedLabelPlaneW * ( MENU_SPEED_LABEL_CANVAS_H / MENU_SPEED_LABEL_CANVAS_W );
const menuUISpeedTextLabel = new THREE.Mesh(
	new THREE.PlaneGeometry( menuSpeedLabelPlaneW, menuSpeedLabelPlaneH ),
	new THREE.MeshBasicMaterial( {
		map: menuSpeedLabelTex,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false
	} )
);
menuUISpeedTextLabel.position.set( 0, -0.001, 0.0 );
menuUISpeedTextLabel.scale.set( 1.45, 1.45, 1 );
menuUISpeedButton.add( menuUISpeedTextLabel );
menuUISpeedButton.userData.setSpeedLabelText = setMenuSpeedButtonLabelText;
menuUISpeedButton.userData.syncSpeedMenuFromState = syncMenuSpeedButtonFromState;

const menuUIResetButton = new THREE.Mesh(
	new THREE.PlaneGeometry( MENU_PAUSE_PLAY_WIDTH, MENU_PAUSE_PLAY_HEIGHT ),
	new THREE.MeshBasicMaterial( { map: menuResetTex, side: THREE.DoubleSide, transparent: true, depthTest: false } )
);
menuUIResetButton.position.set( MENU_ROW_PAUSE_PLAY_X + MENU_ROW_BUTTON_X_STEP * 2, MENU_ROW_BUTTON_Y, MENU_ROW_BUTTON_Z );
menuUIPlane.add( menuUIResetButton );

const menuCloseSize = 0.03;
const menuCloseTex = loadMenuTexture( 'static/ui-button-close.png' );
const menuUICloseButton = new THREE.Mesh(
	new THREE.PlaneGeometry( menuCloseSize, menuCloseSize ),
	new THREE.MeshBasicMaterial( { map: menuCloseTex, side: THREE.DoubleSide, transparent: true, depthTest: false } )
);
menuUICloseButton.position.set( 0.128, 0.065, 0.01 );
menuUIPlane.add( menuUICloseButton );

const menuPrevSize = 0.025;
const menuPrevTex = loadMenuTexture( 'static/ui-button-prev.png' );
const menuUIPrevButton = new THREE.Mesh(
	new THREE.PlaneGeometry( menuPrevSize, menuPrevSize ),
	new THREE.MeshBasicMaterial( { map: menuPrevTex, side: THREE.DoubleSide, transparent: true, depthTest: false } )
);
menuUIPrevButton.position.set( -0.08, -0.066, 0.01 );
menuUIPlane.add( menuUIPrevButton );

const menuNextSize = menuPrevSize;
const menuNextTex = loadMenuTexture( 'static/ui-button-next.png' );
const menuUINextButton = new THREE.Mesh(
	new THREE.PlaneGeometry( menuNextSize, menuNextSize ),
	new THREE.MeshBasicMaterial( { map: menuNextTex, side: THREE.DoubleSide, transparent: true, depthTest: false } )
);
menuUINextButton.position.set( 0.128, -0.066, 0.01 );
menuUIPlane.add( menuUINextButton );

const menuGravityLabelCanvas = document.createElement( 'canvas' );
menuGravityLabelCanvas.width = 1024;
menuGravityLabelCanvas.height = 128;
const menuGravityLabelCtx = menuGravityLabelCanvas.getContext( '2d' );
const menuGravityLabelFontSize = 56;
const menuGravityLabelFontFamily = 'Helvetica, Arial, sans-serif';

const MENU_GRAVITY_PRESETS = [
	{ planet: 'Jupiter', gravity: 24.79 },
	{ planet: 'Saturn', gravity: 10.44 },
	{ planet: 'Earth', gravity: 9.81 },
	{ planet: 'Mars', gravity: 3.72 },
	{ planet: 'Moon', gravity: 1.62 },
	{ planet: 'Zero-G', gravity: 0.00 }
];

const menuGravityStepperState = {
	index: 2 // Earth default
};

function drawMenuGravityLabel( preset ) {
	const boldText = preset.planet;
	const regularText = ` · ${ preset.gravity.toFixed( 2 ) } m/s²`;
	menuGravityLabelCtx.clearRect( 0, 0, menuGravityLabelCanvas.width, menuGravityLabelCanvas.height );
	menuGravityLabelCtx.fillStyle = '#ffffff';
	menuGravityLabelCtx.textBaseline = 'middle';
	menuGravityLabelCtx.textAlign = 'left';
	menuGravityLabelCtx.font = `700 ${ menuGravityLabelFontSize }px ${ menuGravityLabelFontFamily }`;
	const boldWidth = menuGravityLabelCtx.measureText( boldText ).width;
	menuGravityLabelCtx.font = `400 ${ menuGravityLabelFontSize }px ${ menuGravityLabelFontFamily }`;
	const regularWidth = menuGravityLabelCtx.measureText( regularText ).width;
	const textWidth = boldWidth + regularWidth;
	const startX = ( menuGravityLabelCanvas.width - textWidth ) * 0.5;
	const y = menuGravityLabelCanvas.height * 0.5;
	menuGravityLabelCtx.font = `700 ${ menuGravityLabelFontSize }px ${ menuGravityLabelFontFamily }`;
	menuGravityLabelCtx.fillText( boldText, startX, y );
	menuGravityLabelCtx.font = `400 ${ menuGravityLabelFontSize }px ${ menuGravityLabelFontFamily }`;
	menuGravityLabelCtx.fillText( regularText, startX + boldWidth, y );
}

const menuGravityLabelTex = new THREE.CanvasTexture( menuGravityLabelCanvas );
menuGravityLabelTex.colorSpace = THREE.SRGBColorSpace;
menuGravityLabelTex.minFilter = THREE.LinearFilter;
menuGravityLabelTex.magFilter = THREE.LinearFilter;
menuGravityLabelTex.generateMipmaps = false;

const menuGravityLabelWidth = 0.22;
const menuGravityLabelHeight = menuGravityLabelWidth * ( menuGravityLabelCanvas.height / menuGravityLabelCanvas.width );
const menuGravityLabel = new THREE.Mesh(
	new THREE.PlaneGeometry( menuGravityLabelWidth, menuGravityLabelHeight ),
	new THREE.MeshBasicMaterial( {
		map: menuGravityLabelTex,
		transparent: true,
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false,
		toneMapped: false
	} )
);
menuGravityLabel.position.set( 0.024, -0.066, 0.001 );
menuUIPlane.add( menuGravityLabel );

function syncMenuGravityFromState() {
	const preset = MENU_GRAVITY_PRESETS[ menuGravityStepperState.index ];
	pendulumConfig.gravity = preset.gravity;
	drawMenuGravityLabel( preset );
	menuGravityLabelTex.needsUpdate = true;
}

syncMenuGravityFromState();

// ─── Sliders One/Two → L₁/L₂ (0.1–0.4 m); Three/Four → M₁+R₁ / M₂+R₂ (coupled norms) ───
const menuSliderTrackWidth = 0.09;
const menuSliderTrackHeight = 0.0025;
/** Local position on panel; z coplanar with panel */
const MENU_SLIDER_ONE_POS = new THREE.Vector3( -0.03, 0.018, 0 );
const MENU_SLIDER_TWO_GAP_X = 0.034;
const MENU_SLIDER_ROW_GAP_Y = 0.039;
const MENU_SLIDER_TWO_POS = new THREE.Vector3(
	MENU_SLIDER_ONE_POS.x + menuSliderTrackWidth + MENU_SLIDER_TWO_GAP_X,
	MENU_SLIDER_ONE_POS.y,
	MENU_SLIDER_ONE_POS.z
);
const MENU_SLIDER_THREE_POS = new THREE.Vector3(
	MENU_SLIDER_ONE_POS.x,
	MENU_SLIDER_ONE_POS.y - MENU_SLIDER_ROW_GAP_Y,
	MENU_SLIDER_ONE_POS.z
);
const MENU_SLIDER_FOUR_POS = new THREE.Vector3(
	MENU_SLIDER_TWO_POS.x,
	MENU_SLIDER_TWO_POS.y - MENU_SLIDER_ROW_GAP_Y,
	MENU_SLIDER_TWO_POS.z
);

const MENU_SLIDER_KEYS = [ 'sliderOne', 'sliderTwo', 'sliderThree', 'sliderFour' ];

const menuSliderSharedGeom = {
	track: new THREE.PlaneGeometry( menuSliderTrackWidth, menuSliderTrackHeight ),
	trackDot: new THREE.SphereGeometry( 0.0045, 16, 16 ),
	grabDot: new THREE.SphereGeometry( 0.008, 16, 16 ),
	connector: new THREE.BoxGeometry( 1, 1, 1 ),
};

const _menuSliderGrabDotWorld = new THREE.Vector3();
const _menuSliderTrackWorld = new THREE.Vector3();
const _menuSliderTrackDir = new THREE.Vector3();
const _menuSliderPinchWorld = new THREE.Vector3();
const _menuConnectorTrackDot = new THREE.Vector3();
const _menuConnectorGrabDot = new THREE.Vector3();
const _menuConnectorMid = new THREE.Vector3();
/** scratch for local point → axis direction via world subtract */
const _menuSliderDirScratch = new THREE.Vector3();
/** pinch ↔ track projections */
const _menuSliderScratch = new THREE.Vector3();

let activeMenuSliderKey = null;

/** Slider-normalized position 0..1 maps linearly to arm length in metres. */
const ARM_LENGTH_SLIDER_MIN_M = 0.1;
const ARM_LENGTH_SLIDER_MAX_M = 0.4;

function armLengthWorldFromSliderNorm( norm ) {
	const n = THREE.MathUtils.clamp( norm, 0, 1 );
	return THREE.MathUtils.lerp( ARM_LENGTH_SLIDER_MIN_M, ARM_LENGTH_SLIDER_MAX_M, n );
}

function armLengthSliderNormFromWorld( worldLenM ) {
	const w = THREE.MathUtils.clamp(
		worldLenM,
		ARM_LENGTH_SLIDER_MIN_M,
		ARM_LENGTH_SLIDER_MAX_M
	);
	return ( w - ARM_LENGTH_SLIDER_MIN_M ) / ( ARM_LENGTH_SLIDER_MAX_M - ARM_LENGTH_SLIDER_MIN_M );
}

const MASS_SLIDER_MIN = 0.1;
const MASS_SLIDER_MAX = 3.0;

function massWorldFromSliderNorm( norm ) {
	const n = THREE.MathUtils.clamp( norm, 0, 1 );
	return THREE.MathUtils.lerp( MASS_SLIDER_MIN, MASS_SLIDER_MAX, n );
}

function massSliderNormFromWorld( mass ) {
	const w = THREE.MathUtils.clamp( mass, MASS_SLIDER_MIN, MASS_SLIDER_MAX );
	return ( w - MASS_SLIDER_MIN ) / ( MASS_SLIDER_MAX - MASS_SLIDER_MIN );
}

/** Same slider norm as mass; sliders three/four drive both. */
const SPHERE_RADIUS_SLIDER_MIN = 0.01;
const SPHERE_RADIUS_SLIDER_MAX = 0.05;

function sphereRadiusWorldFromSliderNorm( norm ) {
	const n = THREE.MathUtils.clamp( norm, 0, 1 );
	return THREE.MathUtils.lerp( SPHERE_RADIUS_SLIDER_MIN, SPHERE_RADIUS_SLIDER_MAX, n );
}

function menuSliderInitialNorm( key ) {
	if ( key === 'sliderOne' ) return armLengthSliderNormFromWorld( pendulumConfig.length1 );
	if ( key === 'sliderTwo' ) return armLengthSliderNormFromWorld( pendulumConfig.length2 );
	if ( key === 'sliderThree' ) return massSliderNormFromWorld( pendulumConfig.mass1 );
	if ( key === 'sliderFour' ) return massSliderNormFromWorld( pendulumConfig.mass2 );
	return 0.5;
}

const _lengthChangeVelRel = new THREE.Vector3();

/**
 * Keep each link's angular rate when arm lengths change (v ∝ L).
 * Leaving |v| fixed while shortening is a winch against centrifugal force and
 * pumps mechanical energy into the pendulum.
 */
function rescaleVelocitiesForLengthChange( oldL1, oldL2 ) {
	const L1 = pendulumConfig.length1;
	const L2 = pendulumConfig.length2;
	const r1 = L1 / Math.max( oldL1, 1e-9 );
	const r2 = L2 / Math.max( oldL2, 1e-9 );
	if ( Math.abs( r1 - 1 ) < 1e-12 && Math.abs( r2 - 1 ) < 1e-12 ) return;

	_lengthChangeVelRel.subVectors( pendulumState.vel2, pendulumState.vel1 );
	pendulumState.vel1.multiplyScalar( r1 );
	pendulumState.vel2.copy( pendulumState.vel1 ).addScaledVector( _lengthChangeVelRel, r2 );

	projectVelocitiesToConstraints(
		pendulumState,
		pendulumConfig.mass1,
		pendulumConfig.mass2
	);
}

function applyPendulumArmLengthFromMenuSlider( key ) {
	const oldL1 = pendulumConfig.length1;
	const oldL2 = pendulumConfig.length2;
	if ( key === 'sliderOne' ) {
		pendulumConfig.length1 = armLengthWorldFromSliderNorm( menuSliders.sliderOne.state.value );
	} else if ( key === 'sliderTwo' ) {
		pendulumConfig.length2 = armLengthWorldFromSliderNorm( menuSliders.sliderTwo.state.value );
	}
	if ( ! isAnyGrabbed() ) {
		enforceConstraints(
			pendulumState.pos1,
			pendulumState.pos2,
			pendulumConfig.mass1,
			pendulumConfig.mass2,
			pendulumConfig.length1,
			pendulumConfig.length2
		);
		rescaleVelocitiesForLengthChange( oldL1, oldL2 );
		stabilizePendulumState( pendulumState );
	}
}

function applyPendulumMassFromMenuSlider( key ) {
	if ( key === 'sliderThree' ) {
		const n = menuSliders.sliderThree.state.value;
		pendulumConfig.mass1 = massWorldFromSliderNorm( n );
		pendulumConfig.sphereRadius1 = sphereRadiusWorldFromSliderNorm( n );
		mass1.scale.setScalar( pendulumConfig.sphereRadius1 / mass1SphereGeomRefRadius );
	} else if ( key === 'sliderFour' ) {
		const n = menuSliders.sliderFour.state.value;
		pendulumConfig.mass2 = massWorldFromSliderNorm( n );
		pendulumConfig.sphereRadius2 = sphereRadiusWorldFromSliderNorm( n );
		mass2.scale.setScalar( pendulumConfig.sphereRadius2 / mass2SphereGeomRefRadius );
	}
	if ( ! isAnyGrabbed() ) {
		stabilizePendulumState( pendulumState );
	}
}

function resetPendulumSystem() {
	gsap.killTweensOf( resetTransitionState );
	forceMenuSliderReleaseNoSnap();
	grabInfo.left.target = null;
	grabInfo.right.target = null;
	grabInfo.left.history.length = 0;
	grabInfo.right.history.length = 0;

	menuSpeedButtonState.index = 1;
	syncMenuSpeedButtonFromState();

	const earthPresetIndex = Math.max(
		0,
		MENU_GRAVITY_PRESETS.findIndex( ( p ) => Math.abs( p.gravity - 9.81 ) < 0.0001 )
	);
	menuGravityStepperState.index = earthPresetIndex;
	syncMenuGravityFromState();

	menuSliders.sliderOne.state.value = armLengthSliderNormFromWorld( PENDULUM_DEFAULTS.length1 );
	menuSliders.sliderTwo.state.value = armLengthSliderNormFromWorld( PENDULUM_DEFAULTS.length2 );
	menuSliders.sliderThree.state.value = massSliderNormFromWorld( PENDULUM_DEFAULTS.mass1 );
	menuSliders.sliderFour.state.value = massSliderNormFromWorld( PENDULUM_DEFAULTS.mass2 );

	for ( let i = 0; i < MENU_SLIDER_KEYS.length; i ++ ) {
		const key = MENU_SLIDER_KEYS[ i ];
		menuSliderUpdateTrackDotFromValue( key );
		menuSliderUpdateGrabDotWhenIdle( key );
	}

	applyPendulumArmLengthFromMenuSlider( 'sliderOne' );
	applyPendulumArmLengthFromMenuSlider( 'sliderTwo' );
	applyPendulumMassFromMenuSlider( 'sliderThree' );
	applyPendulumMassFromMenuSlider( 'sliderFour' );

	const startPos1 = pendulumState.pos1.clone();
	const startPos2 = pendulumState.pos2.clone();
	const targetPos1 = new THREE.Vector3( 0, -pendulumConfig.length1, 0 );
	const targetPos2 = new THREE.Vector3( 0, -( pendulumConfig.length1 + pendulumConfig.length2 ), 0 );
	const tweenPos1 = new THREE.Vector3();
	const tweenPos2 = new THREE.Vector3();

	resetTransitionState.active = true;
	resetTransitionState.progress = 0;
	clearMass2Trail();

	gsap.to( resetTransitionState, {
		progress: 1,
		duration: 0.22,
		ease: 'power2.out',
		onUpdate: () => {
			tweenPos1.lerpVectors( startPos1, targetPos1, resetTransitionState.progress );
			tweenPos2.lerpVectors( startPos2, targetPos2, resetTransitionState.progress );
			pendulumState.pos1.copy( tweenPos1 );
			pendulumState.pos2.copy( tweenPos2 );
			pendulumState.vel1.set( 0, 0, 0 );
			pendulumState.vel2.set( 0, 0, 0 );
		},
		onComplete: () => {
			resetPendulumToVerticalRestPose();
			applyTinyResetSway();
			resetTransitionState.active = false;
			updatePendulum();
			setEnergyTarget();
		}
	} );
}

function createMenuSlider( key, planePos ) {
	const trackMat = new THREE.MeshBasicMaterial( {
		color: 0xffffff,
		side: THREE.DoubleSide,
		depthTest: false
	} );
	const track = new THREE.Mesh( menuSliderSharedGeom.track, trackMat );
	track.position.copy( planePos );
	menuUIPlane.add( track );

	const trackDotMat = new THREE.MeshBasicMaterial( { color: 0xffffff, depthTest: false } );
	const trackDot = new THREE.Mesh( menuSliderSharedGeom.trackDot, trackDotMat );
	trackDot.position.set( 0, 0, 0.001 );
	track.add( trackDot );

	const grabDotMat = new THREE.MeshBasicMaterial( { color: 0xffff00, depthTest: true } );
	const grabDot = new THREE.Mesh( menuSliderSharedGeom.grabDot, grabDotMat );
	grabDot.position.set( 0, 0, 0.002 );
	track.add( grabDot );

	const connectorMat = new THREE.MeshBasicMaterial( {
		color: 0xffffff,
		depthTest: true,
		transparent: true,
		opacity: 0.6
	} );
	const connector = new THREE.Mesh( menuSliderSharedGeom.connector, connectorMat );
	connector.visible = false;
	connector.frustumCulled = false;
	scene.add( connector );

	const grabDistance = 0.025;
	const state = {
		isGrabbed: false,
		grabbingHand: null,
		/** 0..1 along track (length, or paired mass + sphere radius for sliders three/four). */
		value: menuSliderInitialNorm( key ),
		grabDistance,
		/** Keep equal to grabDistance ** 2 (per-slider if grabDistance ever diverges). */
		grabDistanceSq: grabDistance * grabDistance,
		trackHalfWidth: menuSliderTrackWidth * 0.5,
		initialGrabX: 0
	};

	return {
		key,
		state,
		track,
		trackDot,
		grabDot,
		connector
	};
}

const menuSliders = {
	sliderOne: createMenuSlider( 'sliderOne', MENU_SLIDER_ONE_POS ),
	sliderTwo: createMenuSlider( 'sliderTwo', MENU_SLIDER_TWO_POS ),
	sliderThree: createMenuSlider( 'sliderThree', MENU_SLIDER_THREE_POS ),
	sliderFour: createMenuSlider( 'sliderFour', MENU_SLIDER_FOUR_POS )
};

function isAnyMenuSliderGrabbed() {
	for ( let i = 0; i < MENU_SLIDER_KEYS.length; i ++ )
		if ( menuSliders[ MENU_SLIDER_KEYS[ i ] ].state.isGrabbed ) return true;
	return false;
}

function menuSliderUpdateTrackDotFromValue( key ) {
	const s = menuSliders[ key ];
	const trackX = ( s.state.value - 0.5 ) * 2 * s.state.trackHalfWidth;
	s.trackDot.position.x = trackX;
}

function menuSliderUpdateGrabDotWhenIdle( key ) {
	const s = menuSliders[ key ];
	if ( s.state.isGrabbed ) return;
	s.grabDot.position.x = s.trackDot.position.x;
}

function menuSliderUpdateConnector( key ) {
	const s = menuSliders[ key ];
	s.trackDot.getWorldPosition( _menuConnectorTrackDot );
	s.grabDot.getWorldPosition( _menuConnectorGrabDot );

	const distance = _menuConnectorTrackDot.distanceTo( _menuConnectorGrabDot );
	_menuConnectorMid.addVectors( _menuConnectorTrackDot, _menuConnectorGrabDot ).multiplyScalar( 0.5 );
	s.connector.position.copy( _menuConnectorMid );

	const thickness = 0.002;
	s.connector.scale.set( thickness, thickness, distance );

	s.connector.lookAt( _menuConnectorGrabDot );
}

function menuSliderSetTrackAxisWorldFromTrack( key ) {
	const s = menuSliders[ key ];
	s.track.updateMatrixWorld( true );
	s.track.getWorldPosition( _menuSliderTrackWorld );
	_menuSliderDirScratch.set( 1, 0, 0 );
	_menuSliderTrackDir.copy(
		s.track.localToWorld( _menuSliderDirScratch )
	).sub( _menuSliderTrackWorld ).normalize();
}

function onMenuSliderGrab( key, hand ) {
	const s = menuSliders[ key ];
	activeMenuSliderKey = key;
	s.state.isGrabbed = true;
	s.state.grabbingHand = hand;

	if ( hand === 'left' )
		_menuSliderPinchWorld.addVectors( lThumbObj.position, lIndexObj.position ).multiplyScalar( 0.5 );
	else
		_menuSliderPinchWorld.addVectors( rThumbObj.position, rIndexObj.position ).multiplyScalar( 0.5 );

	menuSliderSetTrackAxisWorldFromTrack( key );

	const toPinch = _menuSliderScratch.subVectors( _menuSliderPinchWorld, _menuSliderTrackWorld );
	s.state.initialGrabX = toPinch.dot( _menuSliderTrackDir );

	s.grabDot.getWorldPosition( _menuSliderGrabDotWorld );
	s.track.remove( s.grabDot );
	scene.add( s.grabDot );
	s.grabDot.position.copy( _menuSliderGrabDotWorld );

	s.grabDot.scale.setScalar( 1.2 );

	s.connector.visible = true;
	menuSliderUpdateConnector( key );
}

function onMenuSliderDrag( key ) {
	const s = menuSliders[ key ];
	if ( s.state.grabbingHand === 'left' )
		_menuSliderPinchWorld.addVectors( lThumbObj.position, lIndexObj.position ).multiplyScalar( 0.5 );
	else
		_menuSliderPinchWorld.addVectors( rThumbObj.position, rIndexObj.position ).multiplyScalar( 0.5 );

	s.grabDot.position.copy( _menuSliderPinchWorld );

	menuSliderSetTrackAxisWorldFromTrack( key );

	const toPinch = _menuSliderScratch.subVectors( _menuSliderPinchWorld, _menuSliderTrackWorld );
	const currentProjectedX = toPinch.dot( _menuSliderTrackDir );

	const deltaX = currentProjectedX - s.state.initialGrabX;
	const currentTrackX = ( s.state.value - 0.5 ) * 2 * s.state.trackHalfWidth;
	let newTrackX = currentTrackX + deltaX;
	newTrackX = Math.max( -s.state.trackHalfWidth, Math.min( s.state.trackHalfWidth, newTrackX ) );

	s.state.value = ( newTrackX / s.state.trackHalfWidth + 1 ) * 0.5;
	s.state.initialGrabX = currentProjectedX;

	menuSliderUpdateTrackDotFromValue( key );
	menuSliderUpdateConnector( key );

	if ( key === 'sliderOne' || key === 'sliderTwo' )
		applyPendulumArmLengthFromMenuSlider( key );
	else if ( key === 'sliderThree' || key === 'sliderFour' )
		applyPendulumMassFromMenuSlider( key );
	// Do not setEnergyTarget here — PE snaps while KE is still mid-rescale would
	// ratchet _energyTarget upward; rebaseline on slider release instead.
}

function menuSliderKillGrabTweenAndResetGrabDotChildren( key ) {
	const s = menuSliders[ key ];
	gsap.killTweensOf( s.grabDot.position );
	s.grabDot.getWorldPosition( _menuSliderGrabDotWorld );
	if ( s.grabDot.parent !== s.track ) {
		scene.remove( s.grabDot );
		s.track.add( s.grabDot );
	}
	s.track.worldToLocal( _menuSliderGrabDotWorld );
	s.grabDot.position.copy( _menuSliderGrabDotWorld );
}

function onMenuSliderRelease( key ) {
	const s = menuSliders[ key ];
	s.state.isGrabbed = false;
	s.state.grabbingHand = null;
	activeMenuSliderKey = null;

	s.connector.visible = false;
	s.grabDot.scale.setScalar( 1 );

	menuSliderKillGrabTweenAndResetGrabDotChildren( key );

	gsap.to( s.grabDot.position, {
		x: s.trackDot.position.x,
		y: s.trackDot.position.y,
		z: 0.002,
		duration: 0.1,
		ease: 'power2.out'
	} );

	if ( ! isAnyGrabbed() ) setEnergyTarget();
}

function menuSliderResolveActiveOrGrabbedKey() {
	if ( MENU_SLIDER_KEYS.includes( activeMenuSliderKey ) ) return activeMenuSliderKey;
	for ( let i = 0; i < MENU_SLIDER_KEYS.length; i ++ ) {
		const k = MENU_SLIDER_KEYS[ i ];
		if ( menuSliders[ k ].state.isGrabbed ) return k;
	}
	return null;
}

/** If panel closes while dragging, reparent knob and hide connector */
function forceMenuSliderReleaseNoSnap() {
	const key = menuSliderResolveActiveOrGrabbedKey();
	if ( ! key ) return;
	const s = menuSliders[ key ];
	activeMenuSliderKey = null;
	s.state.isGrabbed = false;
	s.state.grabbingHand = null;
	s.connector.visible = false;
	s.grabDot.scale.setScalar( 1 );
	menuSliderKillGrabTweenAndResetGrabDotChildren( key );
	s.grabDot.position.set( s.trackDot.position.x, s.trackDot.position.y, 0.002 );
	if ( ! isAnyGrabbed() ) setEnergyTarget();
}

function checkMenuSliderGrab() {
	if ( ! menuButtonState.xrReady ) return;
	if ( ! deps.menuUIPanelOn || ! menuUIPlane.visible ) return;

	const leftPinching = pinchState.left;
	const rightPinching = pinchState.right;

	if ( MENU_SLIDER_KEYS.includes( activeMenuSliderKey ) ) {
		const key = activeMenuSliderKey;
		const s = menuSliders[ key ];
		const still =
			( s.state.grabbingHand === 'left' && leftPinching ) ||
			( s.state.grabbingHand === 'right' && rightPinching );
		if ( ! still ) onMenuSliderRelease( key );
		else onMenuSliderDrag( key );
		return;
	}

	for ( let i = 0; i < MENU_SLIDER_KEYS.length; i ++ ) {
		const key = MENU_SLIDER_KEYS[ i ];
		const s = menuSliders[ key ];
		s.grabDot.getWorldPosition( _menuSliderGrabDotWorld );

		const grabDistSq = s.state.grabDistanceSq;
		if ( leftPinching ) {
			_menuSliderPinchWorld.addVectors( lThumbObj.position, lIndexObj.position ).multiplyScalar( 0.5 );
			if (
				_menuSliderPinchWorld.distanceToSquared( _menuSliderGrabDotWorld ) < grabDistSq
			) {
				onMenuSliderGrab( key, 'left' );
				return;
			}
		}
		if ( rightPinching ) {
			_menuSliderPinchWorld.addVectors( rThumbObj.position, rIndexObj.position ).multiplyScalar( 0.5 );
			if (
				_menuSliderPinchWorld.distanceToSquared( _menuSliderGrabDotWorld ) < grabDistSq
			) {
				onMenuSliderGrab( key, 'right' );
				return;
			}
		}
	}
}

for ( let i = 0; i < MENU_SLIDER_KEYS.length; i ++ ) {
	menuSliderUpdateTrackDotFromValue( MENU_SLIDER_KEYS[ i ] );
	menuSliderUpdateGrabDotWhenIdle( MENU_SLIDER_KEYS[ i ] );
}

{
	const n3 = menuSliders.sliderThree.state.value;
	const n4 = menuSliders.sliderFour.state.value;
	pendulumConfig.sphereRadius1 = sphereRadiusWorldFromSliderNorm( n3 );
	pendulumConfig.sphereRadius2 = sphereRadiusWorldFromSliderNorm( n4 );
	mass1.scale.setScalar( pendulumConfig.sphereRadius1 / mass1SphereGeomRefRadius );
	mass2.scale.setScalar( pendulumConfig.sphereRadius2 / mass2SphereGeomRefRadius );
	if ( ! isAnyGrabbed() ) {
		enforceConstraints(
			pendulumState.pos1,
			pendulumState.pos2,
			pendulumConfig.mass1,
			pendulumConfig.mass2,
			pendulumConfig.length1,
			pendulumConfig.length2
		);
	}
}

const menuButtonTex = loadMenuTexture( 'static/ui-button-menu.png' );
const menuUIButtonGeom = new THREE.PlaneGeometry( 0.04, 0.04 );
const menuUIButton = new THREE.Mesh(
	menuUIButtonGeom,
	new THREE.MeshBasicMaterial( { map: menuButtonTex, side: THREE.DoubleSide, transparent: true } )
);

const menuUIButtonPivot = new THREE.Object3D();
menuUIButtonPivot.rotation.x = -22.5 * Math.PI / 180;
menuUIButtonPivot.position.z = -0.001;
menuUIRoot.add( menuUIButtonPivot );
menuUIButtonPivot.add( menuUIButton );

menuUIRoot.frustumCulled = false;
menuUIButtonPivot.frustumCulled = false;
menuUIRoot.traverse( ( obj ) => {
	if ( obj.isMesh ) obj.frustumCulled = false;
} );

const menuButtonState = {
	isPressed: false,
	cooldown: 0,
	cooldownDuration: 0.5,
	pressDistance: 0.025,
	xrReady: false,
	xrStartupDelay: 1.0
};

/** Must stay equal to menuButtonState.pressDistance ** 2 if press distance changes. */
const MENU_BUTTON_PRESS_DIST_SQ =
	menuButtonState.pressDistance * menuButtonState.pressDistance;

// menuUIPanelOn lives on deps

const menuUIDistanceConfig = {
	maxDistance: 1.2,
	/** Keep false to prevent auto-collapse when user moves away. */
	autoCloseOnDistance: false,
	isAnimating: false
};
/** Must stay equal to menuUIDistanceConfig.maxDistance ** 2 if maxDistance changes. */
const MENU_UI_MAX_DISTANCE_SQ = menuUIDistanceConfig.maxDistance * menuUIDistanceConfig.maxDistance;

const menuUIAnimConfig = {
	buttonHideDelay: 0.1,
	panelShowDelay: 0.0,
	panelScaleDuration: 0.3,
	panelHideDuration: 0.3,
	buttonScaleDuration: 0.3,
	panelEase: 'power2.out',
	buttonEase: 'power2.inOut'
};

const _menuBtnWorld = new THREE.Vector3();
const _menuCloseWorld = new THREE.Vector3();
const _menuPrevWorld = new THREE.Vector3();
const _menuNextWorld = new THREE.Vector3();
const _menuPausePlayWorld = new THREE.Vector3();
const _menuSpeedWorld = new THREE.Vector3();
const _menuResetWorld = new THREE.Vector3();
const _menuDistCheck = new THREE.Vector3();

/** Frame dt for menu cooldown — set each frame like script-ONLY-REF.js `delta` */
// menuFrameDelta lives on deps

function animateMenuButtonPress( buttonMesh, options = {} ) {
	const { onPeak, scaleUp = 1.15 } = options;
	gsap.killTweensOf( buttonMesh.position );
	gsap.killTweensOf( buttonMesh.scale );
	const z0 = buttonMesh.position.z;
	const pressZ = -0.02;
	const pressDur = 0.15;
	const retDur = 0.15;
	const delay = 0.075;
	const tl = gsap.timeline();
	tl.to( buttonMesh.position, { z: z0 + pressZ, duration: pressDur, ease: 'power2.out' }, 0 );
	tl.to( buttonMesh.scale, { x: scaleUp, y: scaleUp, duration: pressDur, ease: 'power2.out' }, 0 );
	if ( typeof onPeak === 'function' ) {
		tl.call( onPeak, [], pressDur );
	}
	tl.to( buttonMesh.position, { z: z0, duration: retDur, ease: 'power2.out' }, pressDur + delay );
	tl.to( buttonMesh.scale, { x: 1, y: 1, duration: retDur, ease: 'power2.out' }, pressDur + delay );
}

function checkMenuButtonPress() {
	if ( ! menuButtonState.xrReady ) return;
	if ( menuButtonState.cooldown > 0 ) {
		menuButtonState.cooldown -= deps.menuFrameDelta;
		return;
	}
	if ( ! menuUIButton.visible ) return;
	menuUIButton.getWorldPosition( _menuBtnWorld );
	if ( lIndexObj.position.distanceToSquared( _menuBtnWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuButtonPressed();
		return;
	}
	if ( rIndexObj.position.distanceToSquared( _menuBtnWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuButtonPressed();
	}
}

function onMenuButtonPressed() {
	menuButtonState.isPressed = true;
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( menuUIButton, { scaleUp: 1.3 } );
	if ( ! deps.menuUIPanelOn ) showMenuUIPanel();
}

function checkMenuCloseButtonPress() {
	if ( ! menuButtonState.xrReady ) return;
	if ( menuButtonState.cooldown > 0 ) return;
	if ( isAnyMenuSliderGrabbed() ) return;
	if ( ! deps.menuUIPanelOn || ! menuUIPlane.visible ) return;
	menuUICloseButton.getWorldPosition( _menuCloseWorld );
	if ( lIndexObj.position.distanceToSquared( _menuCloseWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuCloseButtonPressed();
		return;
	}
	if ( rIndexObj.position.distanceToSquared( _menuCloseWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuCloseButtonPressed();
	}
}

function onMenuCloseButtonPressed() {
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( menuUICloseButton, { scaleUp: 1.3 } );
	setTimeout( () => { hideMenuUIPanel(); }, 150 );
}

function checkMenuPrevButtonPress() {
	if ( ! menuButtonState.xrReady ) return;
	if ( menuButtonState.cooldown > 0 ) return;
	if ( isAnyMenuSliderGrabbed() ) return;
	if ( ! deps.menuUIPanelOn || ! menuUIPlane.visible ) return;
	menuUIPrevButton.getWorldPosition( _menuPrevWorld );
	if ( lIndexObj.position.distanceToSquared( _menuPrevWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuPrevButtonPressed();
		return;
	}
	if ( rIndexObj.position.distanceToSquared( _menuPrevWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuPrevButtonPressed();
	}
}

function onMenuPrevButtonPressed() {
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( menuUIPrevButton, {
		scaleUp: 1.3,
		onPeak: () => {
			const n = MENU_GRAVITY_PRESETS.length;
			menuGravityStepperState.index = ( menuGravityStepperState.index - 1 + n ) % n;
			syncMenuGravityFromState();
		}
	} );
}

function checkMenuNextButtonPress() {
	if ( ! menuButtonState.xrReady ) return;
	if ( menuButtonState.cooldown > 0 ) return;
	if ( isAnyMenuSliderGrabbed() ) return;
	if ( ! deps.menuUIPanelOn || ! menuUIPlane.visible ) return;
	menuUINextButton.getWorldPosition( _menuNextWorld );
	if ( lIndexObj.position.distanceToSquared( _menuNextWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuNextButtonPressed();
		return;
	}
	if ( rIndexObj.position.distanceToSquared( _menuNextWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuNextButtonPressed();
	}
}

function onMenuNextButtonPressed() {
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( menuUINextButton, {
		scaleUp: 1.3,
		onPeak: () => {
			const n = MENU_GRAVITY_PRESETS.length;
			menuGravityStepperState.index = ( menuGravityStepperState.index + 1 ) % n;
			syncMenuGravityFromState();
		}
	} );
}

const menuPausePlayState = {
	// true: currently running (button shows Pause icon), false: paused (button shows Play icon)
	isPause: true
};

function checkMenuPausePlayButtonPress() {
	if ( ! menuButtonState.xrReady ) return;
	if ( menuButtonState.cooldown > 0 ) return;
	if ( isAnyMenuSliderGrabbed() ) return;
	if ( ! deps.menuUIPanelOn || ! menuUIPlane.visible ) return;
	menuUIPausePlayButton.getWorldPosition( _menuPausePlayWorld );
	if ( lIndexObj.position.distanceToSquared( _menuPausePlayWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuPausePlayButtonPressed();
		return;
	}
	if ( rIndexObj.position.distanceToSquared( _menuPausePlayWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuPausePlayButtonPressed();
	}
}

function onMenuPausePlayButtonPressed() {
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( menuUIPausePlayButton, {
		scaleUp: 1.2,
		onPeak: () => {
			menuPausePlayState.isPause = ! menuPausePlayState.isPause;
			menuUIPausePlayButton.material.map = menuPausePlayState.isPause ? menuPauseTex : menuPlayTex;
			menuUIPausePlayButton.material.needsUpdate = true;
		}
	} );
}

function checkMenuSpeedButtonPress() {
	if ( ! menuButtonState.xrReady ) return;
	if ( menuButtonState.cooldown > 0 ) return;
	if ( isAnyMenuSliderGrabbed() ) return;
	if ( ! deps.menuUIPanelOn || ! menuUIPlane.visible ) return;
	menuUISpeedButton.getWorldPosition( _menuSpeedWorld );
	if ( lIndexObj.position.distanceToSquared( _menuSpeedWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuSpeedButtonPressed();
		return;
	}
	if ( rIndexObj.position.distanceToSquared( _menuSpeedWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuSpeedButtonPressed();
	}
}

function onMenuSpeedButtonPressed() {
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( menuUISpeedButton, {
		scaleUp: 1.2,
		onPeak: () => {
			menuSpeedButtonState.index = ( menuSpeedButtonState.index + 1 ) % MENU_SPEED_LEVELS.length;
			syncMenuSpeedButtonFromState();
		}
	} );
}

function checkMenuResetButtonPress() {
	if ( ! menuButtonState.xrReady ) return;
	if ( menuButtonState.cooldown > 0 ) return;
	if ( isAnyMenuSliderGrabbed() ) return;
	if ( ! deps.menuUIPanelOn || ! menuUIPlane.visible ) return;
	menuUIResetButton.getWorldPosition( _menuResetWorld );
	if ( lIndexObj.position.distanceToSquared( _menuResetWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuResetButtonPressed();
		return;
	}
	if ( rIndexObj.position.distanceToSquared( _menuResetWorld ) < MENU_BUTTON_PRESS_DIST_SQ ) {
		onMenuResetButtonPressed();
	}
}

function onMenuResetButtonPressed() {
	menuButtonState.cooldown = menuButtonState.cooldownDuration;
	animateMenuButtonPress( menuUIResetButton, {
		scaleUp: 1.2,
		onPeak: resetPendulumSystem
	} );
}

function showMenuUIPanel() {
	deps.menuUIPanelOn = true;
	menuUIDistanceConfig.isAnimating = true;
	const tl = gsap.timeline( {
		onComplete: () => { menuUIDistanceConfig.isAnimating = false; }
	} );
	tl.to( {}, { duration: menuUIAnimConfig.buttonHideDelay } );
	tl.to( menuUIButton.scale, {
		x: 0, y: 0,
		duration: menuUIAnimConfig.buttonScaleDuration,
		ease: menuUIAnimConfig.buttonEase,
		onComplete: () => { menuUIButton.visible = false; }
	} );
	tl.to( {}, { duration: menuUIAnimConfig.panelShowDelay } );
	tl.call( () => { menuUIPlane.visible = true; } );
	tl.to( menuUIPlane.scale, {
		x: 1, y: 1, z: 1,
		duration: menuUIAnimConfig.panelScaleDuration,
		ease: menuUIAnimConfig.panelEase
	} );
}

function hideMenuUIPanel() {
	forceMenuSliderReleaseNoSnap();
	deps.menuUIPanelOn = false;
	menuUIDistanceConfig.isAnimating = true;
	menuUIButton.position.z = 0;
	const tl = gsap.timeline( {
		onComplete: () => { menuUIDistanceConfig.isAnimating = false; }
	} );
	tl.to( menuUIPlane.scale, {
		x: 0, y: 0, z: 0,
		duration: menuUIAnimConfig.panelHideDuration,
		ease: 'power2.in',
		onComplete: () => { menuUIPlane.visible = false; }
	} );
	tl.call( () => { menuUIButton.visible = true; }, [], `-=${ menuUIAnimConfig.panelHideDuration * 0.3 }` );
	tl.to( menuUIButton.scale, {
		x: 1, y: 1,
		duration: menuUIAnimConfig.buttonScaleDuration,
		ease: menuUIAnimConfig.panelEase
	}, `-=${ menuUIAnimConfig.panelScaleDuration * 0.3 }` );
}

function checkMenuPanelDistance() {
	if ( ! menuUIDistanceConfig.autoCloseOnDistance ) return;
	if ( ! deps.menuUIPanelOn || menuUIDistanceConfig.isAnimating ) return;
	menuUIButton.getWorldPosition( _menuDistCheck );
	camera.getWorldPosition( _menuCamWorld );
	if ( _menuCamWorld.distanceToSquared( _menuDistCheck ) > MENU_UI_MAX_DISTANCE_SQ ) {
		hideMenuUIPanel();
	}
}

renderer.xr.addEventListener( 'sessionstart', () => {
	setTimeout( () => { menuButtonState.xrReady = true; }, menuButtonState.xrStartupDelay * 1000 );
} );
renderer.xr.addEventListener( 'sessionend', () => { menuButtonState.xrReady = false; } );

// Head-relative placement on XR session start (standing / sitting safe)
const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
	renderer,
	camera,
	placements: [{
		object: containerGroup,
		offset: HEAD_OFFSET,
		options: { yawOnly: true },
	}],
	onPlaced: () => {
		twoHandedManip.isActive = false;
		leftPinchJumpGuard.reset();
		rightPinchJumpGuard.reset();
		updateMenuUIReferencePositions();
		updateUIHeaderRefPosition();
		updateUIHeaderRoot();
		updateMenuUIRoot();
	},
	onSessionEnd: () => {
		containerGroup.position.copy( DESKTOP_CONTAINER_POS );
		containerGroup.quaternion.identity();
		containerGroup.scale.setScalar( INITIAL_CONTAINER_SCALE );
		twoHandedManip.isActive = false;
		leftPinchJumpGuard.reset();
		rightPinchJumpGuard.reset();
		updateMenuUIReferencePositions();
		updateUIHeaderRefPosition();
		updateUIHeaderRoot();
		updateMenuUIRoot();
	},
});


    const api = {
        menuPausePlayState,
        menuButtonState,
        infoPanelValues,
        setInfoPanelValues,
        formatInfoPanelSpeed,
        formatInfoPanelEnergyJoules,
        updateInfoPanelWorldScale,
        updateInfoPanelPivot,
        updateContainerOverscaleUI,
        updateUIHeaderRoot,
        updateUIHeaderInsideCube,
        checkTogglePress,
        isCameraInsideMenuCube,
        updateMenuUIReferencePositions,
        updateMenuUIRoot,
        checkMenuButtonPress,
        checkMenuSliderGrab,
        checkMenuCloseButtonPress,
        checkMenuPrevButtonPress,
        checkMenuNextButtonPress,
        checkMenuPausePlayButtonPress,
        checkMenuSpeedButtonPress,
        checkMenuResetButtonPress,
        checkMenuPanelDistance,
        isAnyMenuSliderGrabbed,
        resetPendulumSystem,
        UIHeader,
        xrHeadPlacement
    };
    Object.assign(deps, api);
    return api;
}
