import * as THREE from 'three';
import gsap from 'gsap';
import { bindHeadRelativePlacementOnSessionStart } from './XRHeadPlacement.js';

export function createMenuUI(deps) {
    const {
        scene, camera, renderer,
        containerSize, containerCube, DESKTOP_CONTAINER_POS, HEAD_OFFSET,
        UIHeaderRef, UIHeaderRoot, UIReferencePoint, UIReferenceNormals,
        updateUIReferencePositions, updateUIHeaderRefPosition,
    } = deps;

renderer.xr.addEventListener('sessionstart', () => {
    // Wait for startup delay before enabling button interactions
    setTimeout(() => {
        buttonState.xrReady = true;
    }, buttonState.xrStartupDelay * 1000);
});

renderer.xr.addEventListener('sessionend', () => {
    buttonState.xrReady = false;
});

const UI_HEADER_ASPECT = 398 / 144;
const UIHeaderWidth = 0.35;
const UIHeaderHeight = UIHeaderWidth / UI_HEADER_ASPECT;
const UIHeaderGeometry = new THREE.PlaneGeometry(UIHeaderWidth, UIHeaderHeight);
const uiHeaderTexture = new THREE.TextureLoader().load('static/ui-header.png');
uiHeaderTexture.colorSpace = THREE.SRGBColorSpace;
const UIHeaderMaterial = new THREE.MeshBasicMaterial({
    map: uiHeaderTexture,
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UIHeader = new THREE.Mesh(UIHeaderGeometry, UIHeaderMaterial);
UIHeader.name = 'UIHeader';
UIHeader.frustumCulled = false;
UIHeader.position.set(0, 0, 0.01);
UIHeaderRoot.add(UIHeader);

// Toggle UI for trails - child of UIHeader
const toggleWidth = 0.04; // 220/60 aspect ratio
const toggleHeight = 0.04;
const toggleGeometry = new THREE.PlaneGeometry(toggleWidth, toggleHeight);
const toggleTexture = new THREE.TextureLoader().load('static/ui-toggle.png');
const toggleMaterial = new THREE.MeshBasicMaterial({
    map: toggleTexture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false
});
const UIToggle = new THREE.Mesh(toggleGeometry, toggleMaterial);
UIToggle.position.set(-0.06, -0.08, 0.001); // Below the header
UIToggle.frustumCulled = false;
UIHeader.add(UIToggle);

// Checkbox outer box
const checkboxSize = 0.025;
const checkboxGeometry = new THREE.PlaneGeometry(checkboxSize, checkboxSize);
const checkboxTexture = new THREE.TextureLoader().load('static/ui-checkbox.png');
const checkboxMaterial = new THREE.MeshBasicMaterial({
    map: checkboxTexture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false
});
const UIToggleCheckbox = new THREE.Mesh(checkboxGeometry, checkboxMaterial);
UIToggleCheckbox.position.set(-0.08, 0, 0.001);
UIToggleCheckbox.frustumCulled = false;
UIToggle.add(UIToggleCheckbox);

// Checkbox inner (checked state)
const checkboxInSize = checkboxSize * 0.5;
const checkboxInGeometry = new THREE.PlaneGeometry(checkboxInSize, checkboxInSize);
const checkboxInTexture = new THREE.TextureLoader().load('static/ui-checkbox-in.png');
const checkboxInMaterial = new THREE.MeshBasicMaterial({
    map: checkboxInTexture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false
});
const UIToggleCheckboxIn = new THREE.Mesh(checkboxInGeometry, checkboxInMaterial);
UIToggleCheckboxIn.position.set(0, 0, 0.001);
UIToggleCheckboxIn.frustumCulled = false;
UIToggleCheckboxIn.visible = false; // Start with trails off
UIToggleCheckbox.add(UIToggleCheckboxIn);

// Toggle text label
const toggleTextCanvas = document.createElement('canvas');
toggleTextCanvas.width = 512;
toggleTextCanvas.height = 64;
const toggleTextCtx = toggleTextCanvas.getContext('2d');
toggleTextCtx.fillStyle = '#ffffff';
toggleTextCtx.font = 'bold 48px Helvetica';
toggleTextCtx.textAlign = 'center';
toggleTextCtx.textBaseline = 'middle';
toggleTextCtx.fillText('TRAILS', toggleTextCanvas.width / 2, toggleTextCanvas.height / 2);

const toggleTextTexture = new THREE.CanvasTexture(toggleTextCanvas);
toggleTextTexture.colorSpace = THREE.SRGBColorSpace;
const toggleTextWidth = 0.25 * 0.8;
const toggleTextHeight = 0.0312 * 0.8;
const toggleTextGeometry = new THREE.PlaneGeometry(toggleTextWidth, toggleTextHeight);
const toggleTextMaterial = new THREE.MeshBasicMaterial({
    map: toggleTextTexture,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false
});
const UIToggleText = new THREE.Mesh(toggleTextGeometry, toggleTextMaterial);
UIToggleText.position.set(-0.028, 0, 0.001);
UIToggleText.frustumCulled = false;
UIToggle.add(UIToggleText);

// UIRoot - world space reference for UI panel (using Object3D, no geometry)
const UIRoot = new THREE.Object3D();
scene.add(UIRoot);

// UIRoot is now an empty Object3D (no visible debug sphere)

// UIPlane - attached to UIRoot
const UIPlaneGeometry = new THREE.PlaneGeometry(0.2535, 0.2343); // 474:438 aspect ratio, 130% scale
const UI_Y_PIXEL = 0.2343 / 438; // world units per design pixel (panel height)
const textureLoader = new THREE.TextureLoader();
const uiPanelTexture = textureLoader.load('static/ui-panel.png');
uiPanelTexture.colorSpace = THREE.SRGBColorSpace;
const UIPlaneMaterial = new THREE.MeshBasicMaterial({ 
    map: uiPanelTexture,
    side: THREE.DoubleSide,
    transparent: true
});
const UIPlane = new THREE.Mesh(UIPlaneGeometry, UIPlaneMaterial);
UIPlane.rotation.x = -22.5 * Math.PI / 180; // Tilt 22.5° upward
UIPlane.scale.set(0, 0, 0); // Start at scale 0 for animation
UIPlane.visible = false; // Hidden initially
UIPlane.frustumCulled = false; // Always visible on narrow FOV AR glasses
UIRoot.add(UIPlane);

// UICloseButton - square panel as child of UIPlane
const closeButtonSize = 0.03; // Square size
const UICloseButtonGeometry = new THREE.PlaneGeometry(closeButtonSize, closeButtonSize);
const uiCloseButtonTexture = textureLoader.load('static/ui-button-close.png');
uiCloseButtonTexture.colorSpace = THREE.SRGBColorSpace;
const UICloseButtonMaterial = new THREE.MeshBasicMaterial({ 
    map: uiCloseButtonTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UICloseButton = new THREE.Mesh(UICloseButtonGeometry, UICloseButtonMaterial);
UICloseButton.position.set(0.1, 0.09, 0.01); // Position relative to UIPlane
UICloseButton.frustumCulled = false;
UIPlane.add(UICloseButton); // Child of UIPlane - inherits scale animation

// UIButtonPlus - square panel as child of UIPlane
const plusButtonSize = 0.025; // Slightly smaller than close button
const UIButtonPlusGeometry = new THREE.PlaneGeometry(plusButtonSize, plusButtonSize);
const uiButtonPlusTexture = textureLoader.load('static/ui-button-plus.png');
uiButtonPlusTexture.colorSpace = THREE.SRGBColorSpace;
const UIButtonPlusMaterial = new THREE.MeshBasicMaterial({ 
    map: uiButtonPlusTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UIButtonPlus = new THREE.Mesh(UIButtonPlusGeometry, UIButtonPlusMaterial);
UIButtonPlus.position.set(0.1, 0.045 + 2 * UI_Y_PIXEL, 0.01); // Position relative to UIPlane, lower Y
UIButtonPlus.frustumCulled = false;
UIPlane.add(UIButtonPlus); // Child of UIPlane - inherits scale animation

// UIButtonNext - copy of UIButtonPlus, positioned lower
const nextButtonSize = 0.025;
const UIButtonNextGeometry = new THREE.PlaneGeometry(nextButtonSize, nextButtonSize);
const uiButtonNextTexture = textureLoader.load('static/ui-button-next.png');
uiButtonNextTexture.colorSpace = THREE.SRGBColorSpace;
const UIButtonNextMaterial = new THREE.MeshBasicMaterial({ 
    map: uiButtonNextTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UIButtonNext = new THREE.Mesh(UIButtonNextGeometry, UIButtonNextMaterial);
UIButtonNext.position.set(0.1, -0.089 + 2 * UI_Y_PIXEL, 0.01); // Moved down on Y
UIButtonNext.frustumCulled = false;
UIPlane.add(UIButtonNext); // Child of UIPlane - inherits scale animation

// UIButtonPrev - copy of UIButtonNext, positioned on left side
const prevButtonSize = 0.025;
const UIButtonPrevGeometry = new THREE.PlaneGeometry(prevButtonSize, prevButtonSize);
const uiButtonPrevTexture = textureLoader.load('static/ui-button-prev.png');
uiButtonPrevTexture.colorSpace = THREE.SRGBColorSpace;
const UIButtonPrevMaterial = new THREE.MeshBasicMaterial({ 
    map: uiButtonPrevTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UIButtonPrev = new THREE.Mesh(UIButtonPrevGeometry, UIButtonPrevMaterial);
UIButtonPrev.position.set(-0.1, -0.089 + 2 * UI_Y_PIXEL, 0.01); // Moved to left side
UIButtonPrev.frustumCulled = false;
UIPlane.add(UIButtonPrev); // Child of UIPlane - inherits scale animation

// UIButtonMinus - square panel as child of UIPlane
const minusButtonSize = 0.025; // Same size as plus button
const UIButtonMinusGeometry = new THREE.PlaneGeometry(minusButtonSize, minusButtonSize);
const uiButtonMinusTexture = textureLoader.load('static/ui-button-minus.png');
uiButtonMinusTexture.colorSpace = THREE.SRGBColorSpace;
const UIButtonMinusMaterial = new THREE.MeshBasicMaterial({ 
    map: uiButtonMinusTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UIButtonMinus = new THREE.Mesh(UIButtonMinusGeometry, UIButtonMinusMaterial);
UIButtonMinus.position.set(-0.025, 0.045 + 2 * UI_Y_PIXEL, 0.01); // Position relative to UIPlane, moved left
UIButtonMinus.frustumCulled = false;
UIPlane.add(UIButtonMinus); // Child of UIPlane - inherits scale animation

// UIBoidsCounterText - canvas-based text display for runtime updates
const counterTextCanvas = document.createElement('canvas');
counterTextCanvas.width = 128;
counterTextCanvas.height = 64;
const counterTextCtx = counterTextCanvas.getContext('2d');

// Current counter value
let counterValue = 200;

// Function to update the counter text
function updateCounterText(value) {
    counterValue = value;
    counterTextCtx.clearRect(0, 0, counterTextCanvas.width, counterTextCanvas.height);
    counterTextCtx.fillStyle = '#ffffff';
    counterTextCtx.font = 'bold 38px Helvetica';
    counterTextCtx.textAlign = 'center';
    counterTextCtx.textBaseline = 'middle';
    counterTextCtx.fillText(String(value), counterTextCanvas.width / 2, counterTextCanvas.height / 2);
    counterTextTexture.needsUpdate = true;
}

const counterTextTexture = new THREE.CanvasTexture(counterTextCanvas);
counterTextTexture.colorSpace = THREE.SRGBColorSpace;

const UIBoidsCounterTextGeometry = new THREE.PlaneGeometry(0.05, 0.025); // Wide enough for 3 digits
const UIBoidsCounterTextMaterial = new THREE.MeshBasicMaterial({
    map: counterTextTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UIBoidsCounterText = new THREE.Mesh(UIBoidsCounterTextGeometry, UIBoidsCounterTextMaterial);
UIBoidsCounterText.position.set(0.0345, 0.045, 0); // Halfway between minus (-0.025) and plus (0.1)
UIBoidsCounterText.frustumCulled = false;
UIPlane.add(UIBoidsCounterText);

// Initialize counter text
updateCounterText(counterValue);

// UITemplateText - canvas-based text display for template name
const templateTextCanvas = document.createElement('canvas');
templateTextCanvas.width = 256;
templateTextCanvas.height = 64;
const templateTextCtx = templateTextCanvas.getContext('2d');

// Function to update the template text
function updateTemplateText(text) {
    templateTextCtx.clearRect(0, 0, templateTextCanvas.width, templateTextCanvas.height);
    templateTextCtx.fillStyle = '#ffffff';
    templateTextCtx.font = 'bold 44px Helvetica';
    templateTextCtx.textAlign = 'center';
    templateTextCtx.textBaseline = 'middle';
    templateTextCtx.fillText(text, templateTextCanvas.width / 2, templateTextCanvas.height / 2);
    templateTextTexture.needsUpdate = true;
}

const templateTextTexture = new THREE.CanvasTexture(templateTextCanvas);
templateTextTexture.colorSpace = THREE.SRGBColorSpace;

const UITemplateTextGeometry = new THREE.PlaneGeometry(0.08, 0.02); // 4:1 ratio matching canvas
const UITemplateTextMaterial = new THREE.MeshBasicMaterial({
    map: templateTextTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UITemplateText = new THREE.Mesh(UITemplateTextGeometry, UITemplateTextMaterial);
UITemplateText.position.set(0, -0.09, 0.0); // Same Y as Next/Prev buttons
UITemplateText.frustumCulled = false;
UIPlane.add(UITemplateText);

// Template system - 7 slots for preset configurations
const templates = [
    'Custom',
    'Sparrows',
    'Fireflies',
    'Sardines',
    'Bees',
    'Geese',
    'Mosquitoes'
];
let currentTemplateIndex = 0;

// Template configurations - actual values (not normalized)
const templateConfigs = {
    Custom: null, // User-defined, no preset
    Sparrows: { separation: 2.0, alignment: 1.0, cohesion: 1.0, speed: 0.4 },
    Fireflies: { separation: 2.5, alignment: 0.3, cohesion: 0.3, speed: 0.5 },
    Sardines: { separation: 2.5, alignment: 1.8, cohesion: 1.0, speed: 0.3 },
    Bees: { separation: 1.5, alignment: 0.5, cohesion: 1.6, speed: 0.5 },
    Geese: { separation: 2.8, alignment: 2.5, cohesion: 0.4, speed: 0.3 },
    Mosquitoes: { separation: 1.0, alignment: 0.2, cohesion: 1.4, speed: 0.5 }
};

// Initialize template text
updateTemplateText(templates[currentTemplateIndex]);

/**
 * Sliders System - Object-based approach for multiple sliders
 */
const sliderTrackWidth = 0.115;
const sliderTrackHeight = sliderTrackWidth * (5 / 215); // 215:5 aspect ratio
const SLIDER_TOP_Y = 0.018;
const SLIDER_BOTTOM_Y = -0.053;
const SLIDER_Y_SPACING = (SLIDER_TOP_Y - SLIDER_BOTTOM_Y) / 3;
const SLIDER_Y_OFFSET = 5 * UI_Y_PIXEL;

// Shared geometries and textures for all sliders
const sharedSliderGeometries = {
    track: new THREE.PlaneGeometry(sliderTrackWidth, sliderTrackHeight),
    trackDot: new THREE.SphereGeometry(0.0045, 16, 16),
    grabDot: new THREE.SphereGeometry(0.008, 16, 16),
    connector: new THREE.BoxGeometry(1, 1, 1),
    valueText: new THREE.PlaneGeometry(0.05, 0.025)
};

// Helper vectors for slider interaction (shared across all sliders)
const _sliderGrabDotWorldPos = new THREE.Vector3();
const _sliderTrackWorldPos = new THREE.Vector3();
const _sliderTrackWorldDir = new THREE.Vector3();
const _pinchWorldPos = new THREE.Vector3();
const _grabDotTargetPos = new THREE.Vector3();
const _trackDotWorldPos = new THREE.Vector3();
const _connectorTrackDotPos = new THREE.Vector3();
const _connectorGrabDotPos = new THREE.Vector3();
const _connectorMidpoint = new THREE.Vector3();
const _connectorDirection = new THREE.Vector3();

/**
 * Create a slider instance with all its UI elements
 */
function createSlider(config) {
    // Create canvas for value text
    const textCanvas = document.createElement('canvas');
    textCanvas.width = 128;
    textCanvas.height = 64;
    const textCtx = textCanvas.getContext('2d');
    const textTexture = new THREE.CanvasTexture(textCanvas);
    textTexture.colorSpace = THREE.SRGBColorSpace;
    
    // Create value text mesh
    const valueTextMaterial = new THREE.MeshBasicMaterial({
        map: textTexture,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false
    });
    const valueText = new THREE.Mesh(sharedSliderGeometries.valueText, valueTextMaterial);
    valueText.position.set(0.078, 0, 0);
    valueText.frustumCulled = false;
    
    // Create track (solid white plane — no texture)
    const trackMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: false,
        opacity: 1.0,
        depthTest: false,
        depthWrite: false
    });
    const track = new THREE.Mesh(sharedSliderGeometries.track, trackMaterial);
    track.position.copy(config.position);
    track.frustumCulled = false;
    UIPlane.add(track);
    track.add(valueText);
    
    // Create track dot (white sphere)
    const trackDotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
    const trackDot = new THREE.Mesh(sharedSliderGeometries.trackDot, trackDotMaterial);
    trackDot.position.set(0, 0, 0.001);
    trackDot.frustumCulled = false;
    track.add(trackDot);
    
    // Create grab dot (yellow sphere) — render above track so white bar never shows through
    const grabDotMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 1.0,
        depthTest: false,
        depthWrite: false
    });
    const grabDot = new THREE.Mesh(sharedSliderGeometries.grabDot, grabDotMaterial);
    grabDot.position.set(0, 0, 0.002);
    grabDot.frustumCulled = false;
    grabDot.renderOrder = 2000;
    track.add(grabDot);
    
    // Create connector (added to scene, not track)
    const connectorMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: true,
        transparent: true,
        opacity: 0.6
    });
    const connector = new THREE.Mesh(sharedSliderGeometries.connector, connectorMaterial);
    connector.visible = false;
    connector.frustumCulled = false;
    scene.add(connector);
    
    return {
        // State
        state: {
            isGrabbed: false,
            grabbingHand: null,
            value: config.defaultValue,
            minValue: config.minValue,
            maxValue: config.maxValue,
            grabDistance: 0.025,
            trackHalfWidth: sliderTrackWidth * 0.5,
            grabOffset: new THREE.Vector3(),
            initialGrabX: 0
        },
        // UI Elements
        track: track,
        trackDot: trackDot,
        grabDot: grabDot,
        connector: connector,
        valueText: valueText,
        // Canvas elements for text
        textCanvas: textCanvas,
        textCtx: textCtx,
        textTexture: textTexture,
        // Config
        onUpdate: config.onUpdate // Callback when slider value changes
    };
}

// Sliders collection
const sliders = {
    separation: createSlider({
        position: new THREE.Vector3(0.022, SLIDER_TOP_Y - SLIDER_Y_OFFSET, 0.0),
        defaultValue: 0.5,
        minValue: 0,
        maxValue: 3,
        onUpdate: (actualValue) => {
            // Map so that 1.5 = 0.04 (default separation)
            const newSeparationDist = actualValue * (0.04 / 1.5);
            deps.boidsConfig.separationDist = newSeparationDist;
            deps.boidsConfig.separationDistSq = newSeparationDist * newSeparationDist;
        }
    }),
    alignment: createSlider({
        position: new THREE.Vector3(0.022, SLIDER_TOP_Y - SLIDER_Y_SPACING - SLIDER_Y_OFFSET, 0.0),
        defaultValue: 0.33, // 1.0 on 0-3 scale (default alignmentWeight)
        minValue: 0,
        maxValue: 3,
        onUpdate: (actualValue) => {
            deps.boidsConfig.alignmentWeight = actualValue;
        }
    }),
    cohesion: createSlider({
        position: new THREE.Vector3(0.022, SLIDER_TOP_Y - 2 * SLIDER_Y_SPACING - SLIDER_Y_OFFSET, 0.0),
        defaultValue: 0.33, // 1.0 on 0-3 scale (default cohesionWeight)
        minValue: 0,
        maxValue: 3,
        onUpdate: (actualValue) => {
            deps.boidsConfig.cohesionWeight = actualValue;
        }
    }),
    maxSpeed: createSlider({
        position: new THREE.Vector3(0.022, SLIDER_BOTTOM_Y - SLIDER_Y_OFFSET, 0.0),
        defaultValue: 0.5556, // 0.3 on 0.05-0.5 scale (default maxSpeed)
        minValue: 0.05,
        maxValue: 0.5,
        onUpdate: (actualValue) => {
            deps.boidsConfig.maxSpeed = actualValue;
            deps.boidsConfig.maxSpeedSq = actualValue * actualValue;
        }
    })
};

/**
 * Update slider value text display
 */
function updateSliderValueText(sliderKey, value) {
    const slider = sliders[sliderKey];
    slider.textCtx.clearRect(0, 0, slider.textCanvas.width, slider.textCanvas.height);
    slider.textCtx.fillStyle = '#ffffff';
    slider.textCtx.font = 'bold 34px Helvetica';
    slider.textCtx.textAlign = 'center';
    slider.textCtx.textBaseline = 'middle';
    slider.textCtx.fillText(String(value), slider.textCanvas.width / 2, slider.textCanvas.height / 2);
    slider.textTexture.needsUpdate = true;
}

/**
 * Get actual value from normalized slider value
 */
function getSliderActualValue(sliderKey) {
    const state = sliders[sliderKey].state;
    return state.minValue + state.value * (state.maxValue - state.minValue);
}

/**
 * Update slider text with formatted actual value
 */
function updateSliderText(sliderKey) {
    const actualValue = getSliderActualValue(sliderKey);
    const formattedValue = actualValue.toFixed(1);
    updateSliderValueText(sliderKey, formattedValue);
}

/**
 * Update track dot position based on slider value
 */
function updateSliderTrackDotFromValue(sliderKey) {
    const slider = sliders[sliderKey];
    const trackX = (slider.state.value - 0.5) * 2 * slider.state.trackHalfWidth;
    slider.trackDot.position.x = trackX;
}

/**
 * Update grab dot to follow track dot when not grabbed
 */
function updateSliderGrabDotPosition(sliderKey) {
    const slider = sliders[sliderKey];
    if (slider.state.isGrabbed) return;
    slider.grabDot.position.x = slider.trackDot.position.x;
}

/**
 * Update all sliders grab dot positions
 */
function updateAllSliderGrabDots() {
    for (const key in sliders) {
        updateSliderGrabDotPosition(key);
    }
}

/**
 * Apply slider value to boids config (called on update)
 */
function applySliderValue(sliderKey) {
    const slider = sliders[sliderKey];
    const actualValue = getSliderActualValue(sliderKey);
    if (slider.onUpdate) {
        slider.onUpdate(actualValue);
    }
}

/**
 * Apply template configuration to all sliders
 */
function applyTemplate(templateName) {
    const config = templateConfigs[templateName];
    
    // If CUSTOM or no config, don't change slider values
    if (!config) return;
    
    // Update separation slider
    const sepState = sliders.separation.state;
    const sepNormalized = (config.separation - sepState.minValue) / (sepState.maxValue - sepState.minValue);
    sepState.value = Math.max(0, Math.min(1, sepNormalized));
    updateSliderTrackDotFromValue('separation');
    updateSliderGrabDotPosition('separation');
    updateSliderText('separation');
    applySliderValue('separation');
    
    // Update alignment slider
    const aliState = sliders.alignment.state;
    const aliNormalized = (config.alignment - aliState.minValue) / (aliState.maxValue - aliState.minValue);
    aliState.value = Math.max(0, Math.min(1, aliNormalized));
    updateSliderTrackDotFromValue('alignment');
    updateSliderGrabDotPosition('alignment');
    updateSliderText('alignment');
    applySliderValue('alignment');
    
    // Update cohesion slider
    const cohState = sliders.cohesion.state;
    const cohNormalized = (config.cohesion - cohState.minValue) / (cohState.maxValue - cohState.minValue);
    cohState.value = Math.max(0, Math.min(1, cohNormalized));
    updateSliderTrackDotFromValue('cohesion');
    updateSliderGrabDotPosition('cohesion');
    updateSliderText('cohesion');
    applySliderValue('cohesion');
    
    // Update maxSpeed slider
    const spdState = sliders.maxSpeed.state;
    const spdNormalized = (config.speed - spdState.minValue) / (spdState.maxValue - spdState.minValue);
    spdState.value = Math.max(0, Math.min(1, spdNormalized));
    updateSliderTrackDotFromValue('maxSpeed');
    updateSliderGrabDotPosition('maxSpeed');
    updateSliderText('maxSpeed');
    applySliderValue('maxSpeed');
}

// UIButton - attached to UIRoot via pivot for proper press animation
const UIButtonGeometry = new THREE.PlaneGeometry(0.04, 0.04); // Square
const uiButtonTexture = textureLoader.load('static/ui-button-menu.png');
uiButtonTexture.colorSpace = THREE.SRGBColorSpace;
const UIButtonMaterial = new THREE.MeshBasicMaterial({ 
    map: uiButtonTexture,
    side: THREE.DoubleSide,
    transparent: true
});

// Pivot handles the tilt - button animates along pivot's local Z (perpendicular to face)
const UIButtonPivot = new THREE.Object3D();
UIButtonPivot.rotation.x = -22.5 * Math.PI / 180; // Tilt applied to pivot
UIButtonPivot.position.z = -0.001;
UIRoot.add(UIButtonPivot);

const UIButton = new THREE.Mesh(UIButtonGeometry, UIButtonMaterial);
UIButton.frustumCulled = false;
// No rotation on button itself - pivot handles orientation
UIButtonPivot.add(UIButton);

// Button press state
const buttonState = {
    isPressed: false,
    cooldown: 0,
    cooldownDuration: 0.5, // Seconds before button can be pressed again
    pressDistance: 0.025,  // Distance threshold for finger to trigger press
    xrReady: false,        // Prevents triggers before XR is fully initialized
    xrStartupDelay: 1.0    // Seconds to wait after XR session starts
};

// UI Panel state
deps.UIPanelOn = false;

// Auto-close panel when container is too far
const UIDistanceConfig = {
    maxDistance: 1.2,  // Distance threshold (meters) - beyond comfortable reach
    isAnimating: false // Prevent multiple hide triggers during animation
};

// UI animation config
const UIAnimConfig = {
    buttonHideDelay: 0.1,    // Delay after press before button scales down
    panelShowDelay: 0.0,     // Delay after button hides before panel scales up
    panelScaleDuration: 0.3, // Panel scale UP duration
    panelHideDuration: 0.3,  // Panel scale DOWN duration
    buttonScaleDuration: 0.3,
    panelEase: 'power2.out',
    buttonEase: 'power2.inOut'
};

// Helper vector for button press detection
const _buttonWorldPos = new THREE.Vector3();
const _closeButtonWorldPos = new THREE.Vector3();
const _plusButtonWorldPos = new THREE.Vector3();
const _minusButtonWorldPos = new THREE.Vector3();
const _nextButtonWorldPos = new THREE.Vector3();
const _prevButtonWorldPos = new THREE.Vector3();
const _toggleWorldPos = new THREE.Vector3();

/**
 * Button Press Animation - visual feedback when button is pressed
 * Moves button back and scales up, then returns to original state
 */
function animateButtonPress(buttonMesh) {
    // Kill any existing animations on this button
    gsap.killTweensOf(buttonMesh.position);
    gsap.killTweensOf(buttonMesh.scale);
    
    // Store original z position to return to
    const originalZ = buttonMesh.position.z;
    
    // Animation parameters
    const pressDepth = -0.02; // How far back the button moves (local Z)
    const scaleUp = 1.3; // Scale multiplier
    const pressDuration = 0.15; // Duration of press animation
    const returnDuration = 0.15; // Duration of return animation
    const delayBeforeReturn = 0.075; // Pause at pressed state
    
    // Create timeline for sequential animations
    const tl = gsap.timeline();
    
    // Press: move back and scale up
    tl.to(buttonMesh.position, {
        z: originalZ + pressDepth,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    
    tl.to(buttonMesh.scale, {
        x: scaleUp,
        y: scaleUp,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    
    // Return: move forward and scale back to original
    tl.to(buttonMesh.position, {
        z: originalZ,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
    
    tl.to(buttonMesh.scale, {
        x: 1,
        y: 1,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
}

/**
 * Check if index finger is pressing the button
 */
function checkButtonPress() {
    // Don't check until XR is fully initialized
    if (!buttonState.xrReady) return;
    
    // Don't check if in cooldown
    if (buttonState.cooldown > 0) {
        buttonState.cooldown -= deps.delta;
        return;
    }
    
    // Don't check if button is hidden
    if (!UIButton.visible) return;
    
    // Get button world position
    UIButton.getWorldPosition(_buttonWorldPos);
    
    // Check left index finger
    const leftDist = deps.lIndexObj.position.distanceTo(_buttonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onButtonPressed();
        return;
    }
    
    // Check right index finger
    const rightDist = deps.rIndexObj.position.distanceTo(_buttonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onButtonPressed();
        return;
    }
}

/**
 * Called when button is pressed
 */
function onButtonPressed() {
    buttonState.isPressed = true;
    buttonState.cooldown = buttonState.cooldownDuration;
    
    // Trigger press animation feedback
    animateButtonPress(UIButton);
    
    // Toggle panel if it's currently off
    if (!deps.UIPanelOn) {
        showUIPanel();
    }
}

/**
 * Check if index finger is pressing the close button
 */
function checkCloseButtonPress() {
    // Don't check until XR is fully initialized
    if (!buttonState.xrReady) return;
    
    // Don't check if in cooldown
    if (buttonState.cooldown > 0) return;
    
    // Only check if panel is visible
    if (!deps.UIPanelOn || !UIPlane.visible) return;
    
    // Get close button world position
    UICloseButton.getWorldPosition(_closeButtonWorldPos);
    
    // Check left index finger
    const leftDist = deps.lIndexObj.position.distanceTo(_closeButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onCloseButtonPressed();
        return;
    }
    
    // Check right index finger
    const rightDist = deps.rIndexObj.position.distanceTo(_closeButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onCloseButtonPressed();
        return;
    }
}

/**
 * Called when close button is pressed
 */
function onCloseButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    
    // Trigger press animation feedback
    animateButtonPress(UICloseButton);
    
    // Close the panel after a short delay for animation
    setTimeout(() => {
        hideUIPanel();
    }, 150);
}

/**
 * Check if index finger is pressing the plus button
 */
function checkPlusButtonPress() {
    // Don't check until XR is fully initialized
    if (!buttonState.xrReady) return;
    
    // Don't check if in cooldown
    if (buttonState.cooldown > 0) return;
    
    // Only check if panel is visible
    if (!deps.UIPanelOn || !UIPlane.visible) return;
    
    // Get plus button world position
    UIButtonPlus.getWorldPosition(_plusButtonWorldPos);
    
    // Check left index finger
    const leftDist = deps.lIndexObj.position.distanceTo(_plusButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onPlusButtonPressed();
        return;
    }
    
    // Check right index finger
    const rightDist = deps.rIndexObj.position.distanceTo(_plusButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onPlusButtonPressed();
        return;
    }
}

/**
 * Called when plus button is pressed
 */
function onPlusButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    
    // Trigger press animation feedback
    animateButtonPress(UIButtonPlus);
    
    // Increase counter by 50, max 500
    const newValue = Math.min(counterValue + 50, 500);
    updateCounterText(newValue);
    deps.updateBoidsCount(newValue);
}

/**
 * Check if index finger is pressing the minus button
 */
function checkMinusButtonPress() {
    // Don't check until XR is fully initialized
    if (!buttonState.xrReady) return;
    
    // Don't check if in cooldown
    if (buttonState.cooldown > 0) return;
    
    // Only check if panel is visible
    if (!deps.UIPanelOn || !UIPlane.visible) return;
    
    // Get minus button world position
    UIButtonMinus.getWorldPosition(_minusButtonWorldPos);
    
    // Check left index finger
    const leftDist = deps.lIndexObj.position.distanceTo(_minusButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onMinusButtonPressed();
        return;
    }
    
    // Check right index finger
    const rightDist = deps.rIndexObj.position.distanceTo(_minusButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onMinusButtonPressed();
        return;
    }
}

/**
 * Called when minus button is pressed
 */
function onMinusButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    
    // Trigger press animation feedback
    animateButtonPress(UIButtonMinus);
    
    // Decrease counter by 50, min 50
    const newValue = Math.max(counterValue - 50, 50);
    updateCounterText(newValue);
    deps.updateBoidsCount(newValue);
}

/**
 * Check if index finger is pressing the next button
 */
function checkNextButtonPress() {
    // Don't check until XR is fully initialized
    if (!buttonState.xrReady) return;
    
    // Don't check if in cooldown
    if (buttonState.cooldown > 0) return;
    
    // Only check if panel is visible
    if (!deps.UIPanelOn || !UIPlane.visible) return;
    
    // Get next button world position
    UIButtonNext.getWorldPosition(_nextButtonWorldPos);
    
    // Check left index finger
    const leftDist = deps.lIndexObj.position.distanceTo(_nextButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onNextButtonPressed();
        return;
    }
    
    // Check right index finger
    const rightDist = deps.rIndexObj.position.distanceTo(_nextButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onNextButtonPressed();
        return;
    }
}

/**
 * Called when next button is pressed
 */
function onNextButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    
    // Trigger press animation feedback
    animateButtonPress(UIButtonNext);
    
    // Cycle to next template (wrap around)
    currentTemplateIndex = (currentTemplateIndex + 1) % templates.length;
    updateTemplateText(templates[currentTemplateIndex]);
    
    // Apply template settings
    applyTemplate(templates[currentTemplateIndex]);
}

/**
 * Check if index finger is pressing the prev button
 */
function checkPrevButtonPress() {
    // Don't check until XR is fully initialized
    if (!buttonState.xrReady) return;
    
    // Don't check if in cooldown
    if (buttonState.cooldown > 0) return;
    
    // Only check if panel is visible
    if (!deps.UIPanelOn || !UIPlane.visible) return;
    
    // Get prev button world position
    UIButtonPrev.getWorldPosition(_prevButtonWorldPos);
    
    // Check left index finger
    const leftDist = deps.lIndexObj.position.distanceTo(_prevButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onPrevButtonPressed();
        return;
    }
    
    // Check right index finger
    const rightDist = deps.rIndexObj.position.distanceTo(_prevButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onPrevButtonPressed();
        return;
    }
}

/**
 * Called when prev button is pressed
 */
function onPrevButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    
    // Trigger press animation feedback
    animateButtonPress(UIButtonPrev);
    
    // Cycle to previous template (wrap around)
    currentTemplateIndex = (currentTemplateIndex - 1 + templates.length) % templates.length;
    updateTemplateText(templates[currentTemplateIndex]);
    
    // Apply template settings
    applyTemplate(templates[currentTemplateIndex]);
}

/**
 * Check if index finger is pressing the toggle checkbox
 */
function checkTogglePress() {
    // Don't check until XR is fully initialized
    if (!buttonState.xrReady) return;
    
    // Don't check if in cooldown
    if (buttonState.cooldown > 0) return;
    
    // Get toggle checkbox world position
    UIToggleCheckbox.getWorldPosition(_toggleWorldPos);
    
    // Check left index finger
    const leftDist = deps.lIndexObj.position.distanceTo(_toggleWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onTogglePressed();
        return;
    }
    
    // Check right index finger
    const rightDist = deps.rIndexObj.position.distanceTo(_toggleWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onTogglePressed();
        return;
    }
}

/**
 * Called when toggle checkbox is pressed
 */
function onTogglePressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    
    // Trigger press animation feedback
    animateButtonPress(UIToggleCheckbox);
    
    // Toggle trails
    deps.trailsEnabled = !deps.trailsEnabled;
    deps.setTrailsEnabled(deps.trailsEnabled);
    
    // Update checkbox visual
    UIToggleCheckboxIn.visible = deps.trailsEnabled;
}

// Currently active slider (for drag operations)
let activeSliderKey = null;

/**
 * Check if a hand is pinching near any slider grab dot and handle grab interaction
 */
function checkSliderGrab() {
    // Don't check until XR is ready or if panel is not visible
    if (!buttonState.xrReady) return;
    if (!deps.UIPanelOn || !UIPlane.visible) return;
    
    // Tracking-gated, debounced pinch (updated in handTracking)
    const leftPinching = deps.pinchTracker.left.pinching;
    const rightPinching = deps.pinchTracker.right.pinching;
    
    // If a slider is currently grabbed, handle drag or release
    if (activeSliderKey) {
        const slider = sliders[activeSliderKey];
        const stillPinching = (slider.state.grabbingHand === 'left' && leftPinching) ||
                              (slider.state.grabbingHand === 'right' && rightPinching);
        
        if (!stillPinching) {
            onSliderRelease(activeSliderKey);
        } else {
            onSliderDrag(activeSliderKey);
        }
        return;
    }
    
    // Not currently grabbed - check all sliders for new grab
    for (const sliderKey in sliders) {
        const slider = sliders[sliderKey];
        
        // Get current grab dot world position
        slider.grabDot.getWorldPosition(_sliderGrabDotWorldPos);
        
        // Check left hand
        if (leftPinching) {
            _pinchWorldPos.addVectors(deps.lThumbObj.position, deps.lIndexObj.position).multiplyScalar(0.5);
            const distToGrabDot = _pinchWorldPos.distanceTo(_sliderGrabDotWorldPos);
            
            if (distToGrabDot < slider.state.grabDistance) {
                onSliderGrab(sliderKey, 'left');
                return;
            }
        }
        
        // Check right hand
        if (rightPinching) {
            _pinchWorldPos.addVectors(deps.rThumbObj.position, deps.rIndexObj.position).multiplyScalar(0.5);
            const distToGrabDot = _pinchWorldPos.distanceTo(_sliderGrabDotWorldPos);
            
            if (distToGrabDot < slider.state.grabDistance) {
                onSliderGrab(sliderKey, 'right');
                return;
            }
        }
    }
}

/**
 * Called when a slider grab dot is grabbed
 */
function onSliderGrab(sliderKey, hand) {
    const slider = sliders[sliderKey];
    activeSliderKey = sliderKey;
    slider.state.isGrabbed = true;
    slider.state.grabbingHand = hand;
    
    // Store initial grab X position projected onto track axis
    if (hand === 'left') {
        _pinchWorldPos.addVectors(deps.lThumbObj.position, deps.lIndexObj.position).multiplyScalar(0.5);
    } else {
        _pinchWorldPos.addVectors(deps.rThumbObj.position, deps.rIndexObj.position).multiplyScalar(0.5);
    }
    
    // Calculate initial projected position on track axis
    slider.track.getWorldPosition(_sliderTrackWorldPos);
    _sliderTrackWorldDir.set(1, 0, 0);
    const trackWorldX = slider.track.localToWorld(_sliderTrackWorldDir.clone().add(slider.track.position));
    _sliderTrackWorldDir.copy(trackWorldX).sub(_sliderTrackWorldPos).normalize();
    
    // Project pinch position onto track axis (relative to track center)
    const toPinch = _pinchWorldPos.clone().sub(_sliderTrackWorldPos);
    slider.state.initialGrabX = toPinch.dot(_sliderTrackWorldDir);
    
    // Reparent grab dot from track to scene for free world-space movement
    slider.grabDot.getWorldPosition(_sliderGrabDotWorldPos);
    slider.track.remove(slider.grabDot);
    scene.add(slider.grabDot);
    slider.grabDot.position.copy(_sliderGrabDotWorldPos);
    
    // Visual feedback - scale up grab dot slightly
    slider.grabDot.scale.setScalar(1.2);
    
    // Show the connector
    slider.connector.visible = true;
    updateSliderConnector(sliderKey);
}

/**
 * Called each frame while slider is being dragged
 */
function onSliderDrag(sliderKey) {
    const slider = sliders[sliderKey];
    
    // Get current pinch position
    if (slider.state.grabbingHand === 'left') {
        _pinchWorldPos.addVectors(deps.lThumbObj.position, deps.lIndexObj.position).multiplyScalar(0.5);
    } else {
        _pinchWorldPos.addVectors(deps.rThumbObj.position, deps.rIndexObj.position).multiplyScalar(0.5);
    }
    
    // Move the grab dot to follow the pinch (free 3D movement)
    slider.grabDot.position.copy(_pinchWorldPos);
    
    // Get track world position and direction
    slider.track.getWorldPosition(_sliderTrackWorldPos);
    _sliderTrackWorldDir.set(1, 0, 0);
    const trackWorldX = slider.track.localToWorld(_sliderTrackWorldDir.clone().add(slider.track.position));
    _sliderTrackWorldDir.copy(trackWorldX).sub(_sliderTrackWorldPos).normalize();
    
    // Project pinch position onto track axis (relative to track center)
    const toPinch = _pinchWorldPos.clone().sub(_sliderTrackWorldPos);
    const currentProjectedX = toPinch.dot(_sliderTrackWorldDir);
    
    // Calculate delta X from initial grab position
    const deltaX = currentProjectedX - slider.state.initialGrabX;
    
    // Calculate new track position based on delta
    const currentTrackX = (slider.state.value - 0.5) * 2 * slider.state.trackHalfWidth;
    let newTrackX = currentTrackX + deltaX;
    
    // Clamp to track bounds
    newTrackX = Math.max(-slider.state.trackHalfWidth, Math.min(slider.state.trackHalfWidth, newTrackX));
    
    // Update slider value (normalize to 0-1)
    slider.state.value = (newTrackX / slider.state.trackHalfWidth + 1) * 0.5;
    
    // Update initial grab X so delta is calculated from current position each frame
    slider.state.initialGrabX = currentProjectedX;
    
    // Update track dot position
    updateSliderTrackDotFromValue(sliderKey);
    
    // Update slider text display
    updateSliderText(sliderKey);
    
    // Apply slider value to boids config
    applySliderValue(sliderKey);
    
    // Switch to CUSTOM when user manually adjusts any slider
    if (currentTemplateIndex !== 0) {
        currentTemplateIndex = 0;
        updateTemplateText(templates[currentTemplateIndex]);
    }
    
    // Update connector to follow both dots
    updateSliderConnector(sliderKey);
}

/**
 * Update the connector cube to stretch between TrackDot and GrabDot
 */
function updateSliderConnector(sliderKey) {
    const slider = sliders[sliderKey];
    
    // Get world positions of both dots
    slider.trackDot.getWorldPosition(_connectorTrackDotPos);
    slider.grabDot.getWorldPosition(_connectorGrabDotPos);
    
    // Calculate distance between dots
    const distance = _connectorTrackDotPos.distanceTo(_connectorGrabDotPos);
    
    // Position connector at midpoint
    _connectorMidpoint.addVectors(_connectorTrackDotPos, _connectorGrabDotPos).multiplyScalar(0.5);
    slider.connector.position.copy(_connectorMidpoint);
    
    // Scale connector: thin in X/Y, stretched along Z (will be rotated)
    const thickness = 0.002;
    slider.connector.scale.set(thickness, thickness, distance);
    
    // Orient connector to point from TrackDot to GrabDot
    _connectorDirection.subVectors(_connectorGrabDotPos, _connectorTrackDotPos).normalize();
    slider.connector.lookAt(_connectorGrabDotPos);
}

/**
 * Called when slider is released
 */
function onSliderRelease(sliderKey) {
    const slider = sliders[sliderKey];
    slider.state.isGrabbed = false;
    slider.state.grabbingHand = null;
    activeSliderKey = null;
    
    // Hide the connector
    slider.connector.visible = false;
    
    // Reset grab dot scale
    slider.grabDot.scale.setScalar(1);
    
    // Get current world position of grab dot before reparenting
    slider.grabDot.getWorldPosition(_sliderGrabDotWorldPos);
    
    // Reparent immediately back to track
    scene.remove(slider.grabDot);
    slider.track.add(slider.grabDot);
    
    // Convert world position to track's local space
    slider.track.worldToLocal(_sliderGrabDotWorldPos);
    slider.grabDot.position.copy(_sliderGrabDotWorldPos);
    
    // Animate in local space to track dot position
    gsap.to(slider.grabDot.position, {
        x: slider.trackDot.position.x,
        y: slider.trackDot.position.y,
        z: 0.002,
        duration: 0.1,
        ease: 'power2.out'
    });
}

/**
 * Show the UI Panel with animation
 * Waits for configured delay, then scales up panel and scales down button
 */
function showUIPanel() {
    deps.UIPanelOn = true;
    UIDistanceConfig.isAnimating = true; // Prevent distance check during animation
    
    // Create timeline for the show sequence
    const tl = gsap.timeline({
        onComplete: () => {
            UIDistanceConfig.isAnimating = false;
        }
    });
    
    // 1. Wait after button press
    tl.to({}, { duration: UIAnimConfig.buttonHideDelay });
    
    // 2. Scale down the button
    tl.to(UIButton.scale, {
        x: 0,
        y: 0,
        duration: UIAnimConfig.buttonScaleDuration,
        ease: UIAnimConfig.buttonEase,
        onComplete: () => {
            UIButton.visible = false;
        }
    });
    
    // 3. Wait after button hides
    tl.to({}, { duration: UIAnimConfig.panelShowDelay });
    
    // 4. Scale up the panel (square panel is a child, scales automatically)
    tl.call(() => {
        UIPlane.visible = true;
    });
    
    tl.to(UIPlane.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: UIAnimConfig.panelScaleDuration,
        ease: UIAnimConfig.panelEase
    });
}

/**
 * Hide the UI Panel and show button again
 * Called by close button on panel (to be implemented)
 */
function hideUIPanel() {
    deps.UIPanelOn = false;
    UIDistanceConfig.isAnimating = true;
    
    // Reset button position/scale before showing (in case it was mid-press animation)
    UIButton.position.z = 0;
    
    // Create timeline for the hide sequence
    const tl = gsap.timeline({
        onComplete: () => {
            UIDistanceConfig.isAnimating = false;
        }
    });
    
    // If any slider was grabbed, reparent it back to track before hiding
    for (const sliderKey in sliders) {
        const slider = sliders[sliderKey];
        if (slider.state.isGrabbed) {
            slider.state.isGrabbed = false;
            slider.state.grabbingHand = null;
            slider.connector.visible = false;
            slider.grabDot.scale.setScalar(1);
            gsap.killTweensOf(slider.grabDot.position);
            scene.remove(slider.grabDot);
            slider.track.add(slider.grabDot);
            slider.grabDot.position.copy(slider.trackDot.position);
            slider.grabDot.position.z = 0.002;
        }
    }
    activeSliderKey = null;
    
    // Scale down panel (grab dot is a child, hides automatically)
    tl.to(UIPlane.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: UIAnimConfig.panelHideDuration,
        ease: 'power2.in',
        onComplete: () => {
            UIPlane.visible = false;
        }
    });
    
    // Scale up button (slightly overlapping)
    tl.call(() => {
        UIButton.visible = true;
    }, [], `-=${UIAnimConfig.panelHideDuration * 0.3}`);
    
    tl.to(UIButton.scale, {
        x: 1,
        y: 1,
        duration: UIAnimConfig.buttonScaleDuration,
        ease: UIAnimConfig.panelEase
    }, `-=${UIAnimConfig.panelScaleDuration * 0.3}`);
}

/**
 * Check if container is too far and auto-close panel
 */
const _buttonDistancePos = new THREE.Vector3();
function checkPanelDistance() {
    // Only check if panel is open and not currently animating
    if (!deps.UIPanelOn || UIDistanceConfig.isAnimating) return;
    
    // Get distance from camera to button (world position)
    UIButton.getWorldPosition(_buttonDistancePos);
    const distance = camera.position.distanceTo(_buttonDistancePos);
    
    // If too far, close the panel
    if (distance > UIDistanceConfig.maxDistance) {
        hideUIPanel();
    }
}

// Helper vectors for UI positioning
const _cameraWorldPos = new THREE.Vector3();
const _refPointWorldPos = new THREE.Vector3();
const _refNormalWorld = new THREE.Vector3();
const _toCamera = new THREE.Vector3();
const _uiLookAt = new THREE.Vector3();

// UI positioning config
const UIConfig = {
    currentEdgeIndex: 0
};

// UIHeader visibility state - prevents repeated triggers
const UIHeaderState = {
    isInsideCube: false,
    isAnimating: false
};

/**
 * Hide UIHeader when entering cube (scale to 0)
 */
function hideUIHeader() {
    if (UIHeaderState.isAnimating) return;
    UIHeaderState.isAnimating = true;
    
    gsap.to(UIHeader.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: 0.3,
        ease: 'power2.inOut',
        onComplete: () => {
            UIHeaderState.isAnimating = false;
        }
    });
}

/**
 * Show UIHeader when exiting cube (scale to 1)
 */
function showUIHeader() {
    if (UIHeaderState.isAnimating) return;
    UIHeaderState.isAnimating = true;
    
    gsap.to(UIHeader.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: 0.3,
        ease: 'power2.inOut',
        onComplete: () => {
            UIHeaderState.isAnimating = false;
        }
    });
}

// Update UIRoot position to closest facing edge
// Check if camera is inside the scaled cube
function isCameraInsideCube() {
    camera.getWorldPosition(_cameraWorldPos);
    
    // Get scaled half-size of the cube
    const scaledHalfSize = containerSize * 0.5 * containerCube.scale.x;
    
    // Get cube center position
    const cubePos = containerCube.position;
    
    // Check if camera is within cube bounds on all axes
    return (
        Math.abs(_cameraWorldPos.x - cubePos.x) < scaledHalfSize &&
        Math.abs(_cameraWorldPos.y - cubePos.y) < scaledHalfSize &&
        Math.abs(_cameraWorldPos.z - cubePos.z) < scaledHalfSize
    );
}

function updateUIRoot() {
    // Check if camera is inside the cube
    const isInside = isCameraInsideCube();
    
    // Detect state change for UIHeader animation (prevent repeated triggers)
    if (isInside && !UIHeaderState.isInsideCube) {
        // Just entered cube - hide UIHeader
        UIHeaderState.isInsideCube = true;
        hideUIHeader();
    } else if (!isInside && UIHeaderState.isInsideCube) {
        // Just exited cube - show UIHeader
        UIHeaderState.isInsideCube = false;
        showUIHeader();
    }
    
    // Hide UI panel/button when camera is inside the cube
    if (isInside) {
        UIRoot.visible = false;
        return;
    }
    
    // Show UI when outside
    UIRoot.visible = true;
    
    // Get camera world position
    camera.getWorldPosition(_cameraWorldPos);
    
    let bestIndex = 0;
    let bestScore = -Infinity;
    
    // Find the reference point that is closest AND facing the camera
    for (let i = 0; i < UIReferencePoint.length; i++) {
        // Get world position of reference point
        UIReferencePoint[i].getWorldPosition(_refPointWorldPos);
        
        // Get world direction of edge normal
        _refNormalWorld.copy(UIReferenceNormals[i]);
        _refNormalWorld.applyQuaternion(containerCube.quaternion);
        
        // Direction from reference point to camera
        _toCamera.subVectors(_cameraWorldPos, _refPointWorldPos).normalize();
        
        // Dot product: positive = facing camera, negative = facing away
        const facingScore = _toCamera.dot(_refNormalWorld);
        
        // Distance (closer is better, so we invert)
        const distance = _cameraWorldPos.distanceTo(_refPointWorldPos);
        const distanceScore = 1 / (distance + 0.1);
        
        // Combined score: must be facing (positive dot) and close
        const score = facingScore * distanceScore;
        
        if (facingScore > 0 && score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }
    
    // Get target position - hard repositioning (no lerp)
    UIReferencePoint[bestIndex].getWorldPosition(_refPointWorldPos);
    UIRoot.position.copy(_refPointWorldPos);
    
    // Align UIRoot rotation with edge normal (not facing camera)
    // Get the world normal direction for this edge
    _refNormalWorld.copy(UIReferenceNormals[bestIndex]);
    _refNormalWorld.applyQuaternion(containerCube.quaternion);
    
    // Look along the edge normal direction
    _uiLookAt.copy(UIRoot.position).add(_refNormalWorld);
    UIRoot.lookAt(_uiLookAt);
    
    UIConfig.currentEdgeIndex = bestIndex;
}

const _upVector = new THREE.Vector3(0, 1, 0);
const _headerWorldPos = new THREE.Vector3();
const _headerLookDir = new THREE.Vector3();

function updateUIHeaderRoot() {
    UIHeaderRef.getWorldPosition(_headerWorldPos);
    UIHeaderRoot.position.copy(_headerWorldPos);

    _headerLookDir.copy(camera.position).sub(_headerWorldPos);
    _headerLookDir.y = 0;

    if (_headerLookDir.lengthSq() > 0.0001) {
        const heading = Math.atan2(_headerLookDir.x, _headerLookDir.z);
        UIHeaderRoot.quaternion.setFromAxisAngle(_upVector, heading);
    }
}

// Head-relative placement on XR session start (standing / sitting safe)
const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
    renderer,
    camera,
    placements: [{
        object: containerCube,
        offset: HEAD_OFFSET,
        options: { yawOnly: true },
    }],
    onPlaced: () => {
        deps.syncBoidsGroupToContainer();
        updateUIReferencePositions();
        updateUIHeaderRefPosition();
        updateUIHeaderRoot();
        updateUIRoot();
    },
    onSessionEnd: () => {
        containerCube.position.copy(DESKTOP_CONTAINER_POS);
        containerCube.quaternion.identity();
        containerCube.scale.setScalar(1);
        deps.syncBoidsGroupToContainer();
        deps.twoHandedManip.isActive = false;
        updateUIReferencePositions();
        updateUIHeaderRefPosition();
        updateUIHeaderRoot();
        updateUIRoot();
    },
});

// Initialize all sliders (text and apply values) — after boidsConfig exists on deps
for (const sliderKey in sliders) {
    updateSliderText(sliderKey);
    updateSliderTrackDotFromValue(sliderKey);
    applySliderValue(sliderKey);
}


    const api = {
        UIHeader,
        UIToggle,
        UIToggleCheckbox,
        UIToggleCheckboxIn,
        UIToggleText,
        UIRoot,
        UIPlane,
        UICloseButton,
        UIButtonPlus,
        UIButtonNext,
        UIButtonPrev,
        UIButtonMinus,
        UIBoidsCounterText,
        counterValue,
        updateCounterText,
        updateTemplateText,
        templates,
        currentTemplateIndex,
        templateConfigs,
        sliders,
        createSlider,
        updateSliderValueText,
        getSliderActualValue,
        updateSliderText,
        updateSliderTrackDotFromValue,
        updateSliderGrabDotPosition,
        updateAllSliderGrabDots,
        applySliderValue,
        applyTemplate,
        UIButtonPivot,
        UIButton,
        buttonState,
        UIDistanceConfig,
        UIAnimConfig,
        animateButtonPress,
        checkButtonPress,
        onButtonPressed,
        checkCloseButtonPress,
        onCloseButtonPressed,
        checkPlusButtonPress,
        onPlusButtonPressed,
        checkMinusButtonPress,
        onMinusButtonPressed,
        checkNextButtonPress,
        onNextButtonPressed,
        checkPrevButtonPress,
        onPrevButtonPressed,
        checkTogglePress,
        onTogglePressed,
        activeSliderKey,
        checkSliderGrab,
        onSliderGrab,
        onSliderDrag,
        updateSliderConnector,
        onSliderRelease,
        showUIPanel,
        hideUIPanel,
        checkPanelDistance,
        UIConfig,
        UIHeaderState,
        hideUIHeader,
        showUIHeader,
        isCameraInsideCube,
        updateUIRoot,
        updateUIHeaderRoot,
        xrHeadPlacement
    };
    Object.assign(deps, api);
    return api;
}
