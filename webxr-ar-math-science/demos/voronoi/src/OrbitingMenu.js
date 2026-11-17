import * as THREE from 'three';
import gsap from 'gsap';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

/**
 * Orbiting menu button + panel that face the user and respond to index-finger press.
 */
const INTERACTION_KNOB_RADIUS = 0.008;

export class OrbitingMenu {
    constructor(containerGroup, renderer, options = {}) {
        this.containerGroup = containerGroup;
        this.containerViewOffset = options.containerViewOffset ?? null;
        this.renderer = renderer;
        this.scene = options.scene;
        this.leftIndex = options.leftIndex;
        this.rightIndex = options.rightIndex;
        this.leftThumb = options.leftThumb;
        this.rightThumb = options.rightThumb;
        this.pinchState = options.pinchState;
        this.isInteractionLocked = options.isInteractionLocked ?? (() => false);

        this.containerHalf = options.containerHalf ?? 0.225;
        const bottomY = -this.containerHalf;

        this.orbitOutset2D = options.orbitOutset2D ?? -0.05;
        this.orbitOutset3D = options.orbitOutset3D ?? 0.16;
        this.getViewScaleBlend = options.getViewScaleBlend ?? (() => 0);

        const MENU_LOCAL_Y = bottomY - 0.08;
        const MENU_PLANE_SIZE = 0.04;
        const MENU_TILT_UP_RAD = THREE.MathUtils.degToRad(20);

        this.MENU_LOCAL_Y = MENU_LOCAL_Y;

        this.menuPlaceholderGroup = new THREE.Group();
        containerGroup.add(this.menuPlaceholderGroup);

        const textureLoader = new THREE.TextureLoader();

        const menuButtonTexture = textureLoader.load('./static/ui-button-menu.png');
        menuButtonTexture.colorSpace = THREE.SRGBColorSpace;

        const menuButtonPivot = new THREE.Object3D();
        menuButtonPivot.rotation.x = -MENU_TILT_UP_RAD;
        menuButtonPivot.position.z = -0.001;
        this.menuPlaceholderGroup.add(menuButtonPivot);

        this.menuButton = new THREE.Mesh(
            new THREE.PlaneGeometry(MENU_PLANE_SIZE, MENU_PLANE_SIZE),
            new THREE.MeshBasicMaterial({
                map: menuButtonTexture,
                opacity: 1.0,
                transparent: true,
                side: THREE.FrontSide,
            })
        );
        this.menuButton.frustumCulled = false;
        menuButtonPivot.add(this.menuButton);

        const MENU_PANEL_W = 0.31;
        const MENU_PANEL_H = MENU_PANEL_W * (220 / 638);
        /** Open scale for the whole panel (buttons, labels, slider, etc.). */
        this.menuPanelOpenScale = 1.1;
        const menuPanelTexture = textureLoader.load('./static/ui-menu-placeholder.png');
        menuPanelTexture.colorSpace = THREE.SRGBColorSpace;

        this.menuPanel = new THREE.Mesh(
            new THREE.PlaneGeometry(MENU_PANEL_W, MENU_PANEL_H),
            new THREE.MeshBasicMaterial({
                map: menuPanelTexture,
                side: THREE.FrontSide,
                transparent: true,
            })
        );
        this.menuPanel.rotation.x = -MENU_TILT_UP_RAD;
        this.menuPanel.scale.set(0, 0, 0);
        this.menuPanel.visible = false;
        this.menuPanel.frustumCulled = false;
        this.menuPlaceholderGroup.add(this.menuPanel);

        const MENU_CLOSE_SIZE = 0.03;
        const MENU_PANEL_BUTTON_Y = 0.064;
        const MENU_CLOSE_BUTTON_Y = 0.026;
        const MENU_CLOSE_BUTTON_X = 0.126;

        const MENU_CHECKBOX_SIZE = 0.015;
        const MENU_CHECKBOX_1_X = -0.125;
        const MENU_CHECKBOX_2_X = -0.033;
        const MENU_CHECKBOX_3_X = 0.063;
        const MENU_CHECKBOX_Y = -0.021;
        const MENU_CHECKBOX_Z = 0.01;
        const MENU_CHECKBOX_CIRCLE_Y_OFFSET_PX = 3;
        const MENU_CHECKBOX_CIRCLE_Y = MENU_CHECKBOX_Y + MENU_PANEL_W * (MENU_CHECKBOX_CIRCLE_Y_OFFSET_PX / 638);
        this.menuCheckboxRowY = MENU_CHECKBOX_Y;

        // Checkbox labels — same canvas style as Explode slider label (panel local space).
        const MENU_CHECKBOX_LABEL_EUCLIDEAN = { x: -0.114, y: -0.021, z: 0 };
        const MENU_CHECKBOX_LABEL_MANHATTAN = { x: -0.021, y: -0.021, z: 0 };
        const MENU_CHECKBOX_LABEL_DELAUNAY = { x: 0.074, y: -0.021, z: 0 };

        const MENU_CHECKBOX_IN_SIZE = 0.008;
        const MENU_CHECKBOX_IN_X = 0;
        const MENU_CHECKBOX_IN_Y = 0;
        const MENU_CHECKBOX_IN_Z = 0.0;

        const MENU_TOGGLE_TEXT_SIZE = 0.018 * 0.5;
        const MENU_TOGGLE_Z = 0.01;
        const MENU_TOGGLE_Y = MENU_CLOSE_BUTTON_Y;

        const MENU_TOGGLE_A_X = -0.08;
        const MENU_TOGGLE_B_X = 0.036;
        const MENU_TOGGLE_PRESS_SCALE = 1.2;
        const MENU_TOGGLE_ACTIVE_COLOR = 0xffff00;
        const MENU_TOGGLE_INACTIVE_COLOR = 0xffffff;

        this.onViewModeChange = options.onViewModeChange ?? null;
        this.viewMode = options.viewMode ?? '2D';
        this.menuTogglePressScale = MENU_TOGGLE_PRESS_SCALE;
        this.menuToggleActiveColor = MENU_TOGGLE_ACTIVE_COLOR;
        this.menuToggleInactiveColor = MENU_TOGGLE_INACTIVE_COLOR;
        this.menuToggleA = null;
        this.menuToggleB = null;
        this.menuToggleAX = MENU_TOGGLE_A_X;
        this.menuToggleBX = MENU_TOGGLE_B_X;
        this.menuCheckboxesEnabled = true;

        const HIGHLIGHT_TAG_TEX_W = 711;
        const HIGHLIGHT_TAG_TEX_H = 138;
        const HIGHLIGHT_TAG_W = MENU_PANEL_W * (HIGHLIGHT_TAG_TEX_W / 638) * 0.33;
        const HIGHLIGHT_TAG_H = HIGHLIGHT_TAG_W * (HIGHLIGHT_TAG_TEX_H / HIGHLIGHT_TAG_TEX_W);
        const HIGHLIGHT_TAG_X = MENU_TOGGLE_B_X;
        const HIGHLIGHT_TAG_Y = MENU_TOGGLE_Y;
        const HIGHLIGHT_TAG_Z = 0.009;
        const HIGHLIGHT_TAG_MOVE_DURATION = 0.25;

        this.highlightTagMoveDuration = HIGHLIGHT_TAG_MOVE_DURATION;

        const highlightTagTexture = textureLoader.load('./static/ui-toggle-active.png');
        highlightTagTexture.colorSpace = THREE.SRGBColorSpace;
        this.highlightTag = new THREE.Mesh(
            new THREE.PlaneGeometry(HIGHLIGHT_TAG_W, HIGHLIGHT_TAG_H),
            new THREE.MeshBasicMaterial({
                map: highlightTagTexture,
                side: THREE.FrontSide,
                transparent: true,
                depthTest: false,
            })
        );
        this.highlightTag.position.set(HIGHLIGHT_TAG_X, HIGHLIGHT_TAG_Y, HIGHLIGHT_TAG_Z);
        this.highlightTag.frustumCulled = false;
        this.menuPanel.add(this.highlightTag);
        this.updateToggleColors();

        const closeTexture = textureLoader.load('./static/ui-button-close.png');
        closeTexture.colorSpace = THREE.SRGBColorSpace;
        this.menuCloseButton = new THREE.Mesh(
            new THREE.PlaneGeometry(MENU_CLOSE_SIZE, MENU_CLOSE_SIZE),
            new THREE.MeshBasicMaterial({
                map: closeTexture,
                side: THREE.FrontSide,
                transparent: true,
                depthTest: false,
            })
        );
        this.menuCloseButton.position.set(MENU_CLOSE_BUTTON_X, MENU_CLOSE_BUTTON_Y, 0.01);
        this.menuCloseButton.frustumCulled = false;
        this.menuPanel.add(this.menuCloseButton);

        const checkboxTexture = textureLoader.load('./static/ui-checkbox.png');
        checkboxTexture.colorSpace = THREE.SRGBColorSpace;
        const checkboxInTexture = textureLoader.load('./static/ui-checkbox-in.png');
        checkboxInTexture.colorSpace = THREE.SRGBColorSpace;

        const createMenuCheckbox = (x) => {
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(MENU_CHECKBOX_SIZE, MENU_CHECKBOX_SIZE),
                new THREE.MeshBasicMaterial({
                    map: checkboxTexture,
                    side: THREE.FrontSide,
                    transparent: true,
                    depthTest: false,
                })
            );
            mesh.position.set(x, MENU_CHECKBOX_CIRCLE_Y, MENU_CHECKBOX_Z);
            mesh.frustumCulled = false;
            this.menuPanel.add(mesh);

            const meshIn = new THREE.Mesh(
                new THREE.PlaneGeometry(MENU_CHECKBOX_IN_SIZE, MENU_CHECKBOX_IN_SIZE),
                new THREE.MeshBasicMaterial({
                    map: checkboxInTexture,
                    side: THREE.FrontSide,
                    transparent: true,
                    depthTest: false,
                })
            );
            meshIn.position.set(MENU_CHECKBOX_IN_X, MENU_CHECKBOX_IN_Y, MENU_CHECKBOX_IN_Z);
            meshIn.visible = false;
            meshIn.frustumCulled = false;
            mesh.add(meshIn);

            return { mesh, meshIn, checked: false };
        };

        this.menuCheckboxes = [
            createMenuCheckbox(MENU_CHECKBOX_1_X),
            createMenuCheckbox(MENU_CHECKBOX_2_X),
            createMenuCheckbox(MENU_CHECKBOX_3_X),
        ];
        this.menuCheckbox = this.menuCheckboxes[0].mesh;
        this.menuCheckboxIn = this.menuCheckboxes[0].meshIn;

        this._initMenuPanelLabelConfig();
        this.menuCheckboxLabels = [
            this._createMenuPanelLabelText('Euclidean', MENU_CHECKBOX_LABEL_EUCLIDEAN),
            this._createMenuPanelLabelText('Manhattan', MENU_CHECKBOX_LABEL_MANHATTAN),
            this._createMenuPanelLabelText('Delaunay', MENU_CHECKBOX_LABEL_DELAUNAY),
        ];

        this._initMenuSlider(MENU_PANEL_W, options.menuSlider, MENU_CHECKBOX_Y, 0);

        this.onCheckboxChange = options.onCheckboxChange ?? null;
        this.activeCheckboxIndex = options.activeCheckboxIndex ?? 0;
        this.setActiveCheckbox(this.activeCheckboxIndex);

        const menuFontLoader = new FontLoader();
        menuFontLoader.load('./static/fonts/helvetiker_bold.typeface.json', (font) => {
            const createToggleText = (text, color, x) => {
                const geometry = new TextGeometry(text, {
                    font,
                    size: MENU_TOGGLE_TEXT_SIZE,
                    height: 0,
                    curveSegments: 4,
                });
                geometry.computeBoundingBox();
                const box = geometry.boundingBox;
                const centerX = (box.max.x + box.min.x) * 0.5;
                const visualMinY = Math.max(0, box.min.y);
                const visualCenterY = (box.max.y + visualMinY) * 0.5;
                geometry.translate(-centerX, -visualCenterY, 0);

                const mesh = new THREE.Mesh(
                    geometry,
                    new THREE.MeshBasicMaterial({
                        color,
                        depthTest: false,
                    })
                );
                mesh.position.set(x, MENU_TOGGLE_Y, MENU_TOGGLE_Z);
                mesh.frustumCulled = false;
                this.menuPanel.add(mesh);
                return mesh;
            };

            this.menuToggleA = createToggleText('2D', this.menuToggleInactiveColor, MENU_TOGGLE_A_X);
            this.menuToggleB = createToggleText('3D', this.menuToggleInactiveColor, MENU_TOGGLE_B_X);
            this.updateToggleColors();
            this.syncMenuRowForViewMode(this.viewMode);
        });

        this.syncMenuRowForViewMode(this.viewMode);

        this.menuButtonState = {
            cooldown: 0,
            cooldownDuration: 0.5,
            pressDistance: 0.025,
            xrReady: false,
            xrStartupDelay: 1.0,
        };

        this.menuPanelOpen = false;

        this.menuUiAnimConfig = {
            buttonHideDelay: 0.1,
            panelShowDelay: 0.0,
            panelScaleDuration: 0.3,
            panelHideDuration: 0.3,
            buttonScaleDuration: 0.3,
            panelEase: 'power2.out',
            buttonEase: 'power2.inOut',
        };

        this._menuButtonWorldPos = new THREE.Vector3();
        this._menuPanelButtonWorldPos = new THREE.Vector3();
        this._menuSliderGrabDotWorldPos = new THREE.Vector3();
        this._menuSliderTrackWorldPos = new THREE.Vector3();
        this._menuSliderTrackWorldDir = new THREE.Vector3();
        this._menuSliderTrackWorldXEnd = new THREE.Vector3();
        this._menuSliderPinchWorldPos = new THREE.Vector3();
        this._menuSliderConnectorTrackDotPos = new THREE.Vector3();
        this._menuSliderConnectorGrabDotPos = new THREE.Vector3();
        this._menuSliderConnectorMidpoint = new THREE.Vector3();
        this.activeMenuSlider = null;
        this._camWorldPos = new THREE.Vector3();
        this._camContainerLocal = new THREE.Vector3();
        this._containerWorldScale = new THREE.Vector3();
        this._viewCompensationOffset = new THREE.Vector3();

        renderer.xr.addEventListener('sessionstart', () => {
            setTimeout(() => {
                this.menuButtonState.xrReady = true;
            }, this.menuButtonState.xrStartupDelay * 1000);
        });
        renderer.xr.addEventListener('sessionend', () => {
            this.menuButtonState.xrReady = false;
        });
    }

    update(delta, { skipInteractions = false } = {}) {
        this.updateMenuPlaceholder();
        this.updateViewCompensation();
        if (!skipInteractions) {
            this.checkMenuButtonPress(delta);
            this.checkMenuSlidersGrab();
            this.checkMenuPanelButtonsPress();
        }
        this.updateMenuSliderGrabDot();
    }

    get isMenuSliderGrabbed() {
        return this.activeMenuSlider !== null;
    }

    updateViewCompensation() {
        if (!this.containerViewOffset) return;

        const viewBlend = this.getViewScaleBlend();
        if (viewBlend <= 0) {
            this.containerViewOffset.position.set(0, 0, 0);
            return;
        }

        this.renderer.xr.getCamera().getWorldPosition(this._camWorldPos);
        this._camContainerLocal.copy(this._camWorldPos);
        this.containerGroup.worldToLocal(this._camContainerLocal);

        const dx = this._camContainerLocal.x;
        const dz = this._camContainerLocal.z;
        const horizLenSq = dx * dx + dz * dz;
        const yaw = horizLenSq > 1e-8 ? Math.atan2(dx, dz) : 0;

        const deltaR = (this.orbitOutset3D - this.orbitOutset2D) * viewBlend;
        this.containerGroup.getWorldScale(this._containerWorldScale);
        const containerScale = this._containerWorldScale.x;

        this._viewCompensationOffset.set(
            -Math.sin(yaw) * deltaR * containerScale,
            0,
            -Math.cos(yaw) * deltaR * containerScale
        );
        this._viewCompensationOffset.applyQuaternion(this.containerGroup.quaternion);
        this.containerViewOffset.position.copy(this._viewCompensationOffset);
    }

    updateMenuPlaceholder() {
        this.renderer.xr.getCamera().getWorldPosition(this._camWorldPos);
        this._camContainerLocal.copy(this._camWorldPos);
        this.containerGroup.worldToLocal(this._camContainerLocal);

        const dx = this._camContainerLocal.x;
        const dz = this._camContainerLocal.z;
        const horizLenSq = dx * dx + dz * dz;
        const yaw = horizLenSq > 1e-8 ? Math.atan2(dx, dz) : 0;

        const viewBlend = this.getViewScaleBlend();
        const orbitOutset = THREE.MathUtils.lerp(this.orbitOutset2D, this.orbitOutset3D, viewBlend);
        const orbitRadius = this.containerHalf + orbitOutset;

        this.menuPlaceholderGroup.position.set(
            Math.sin(yaw) * orbitRadius,
            this.MENU_LOCAL_Y,
            Math.cos(yaw) * orbitRadius
        );
        this.menuPlaceholderGroup.rotation.set(0, yaw, 0);

        this.containerGroup.getWorldScale(this._containerWorldScale);
        this.menuPlaceholderGroup.scale.set(
            this._containerWorldScale.x > 1e-8 ? 1 / this._containerWorldScale.x : 1,
            this._containerWorldScale.y > 1e-8 ? 1 / this._containerWorldScale.y : 1,
            this._containerWorldScale.z > 1e-8 ? 1 / this._containerWorldScale.z : 1
        );
    }

    animateMenuButtonPress(buttonMesh, scaleUp = 1.3) {
        gsap.killTweensOf(buttonMesh.position);
        gsap.killTweensOf(buttonMesh.scale);

        const originalZ = buttonMesh.position.z;
        const pressDepth = -0.02;
        const pressDuration = 0.15;
        const returnDuration = 0.15;
        const delayBeforeReturn = 0.075;

        const tl = gsap.timeline();
        tl.to(buttonMesh.position, { z: originalZ + pressDepth, duration: pressDuration, ease: 'power2.out' }, 0);
        tl.to(buttonMesh.scale, { x: scaleUp, y: scaleUp, duration: pressDuration, ease: 'power2.out' }, 0);
        tl.to(buttonMesh.position, { z: originalZ, duration: returnDuration, ease: 'power2.out' }, pressDuration + delayBeforeReturn);
        tl.to(buttonMesh.scale, { x: 1, y: 1, duration: returnDuration, ease: 'power2.out' }, pressDuration + delayBeforeReturn);
    }

    checkMenuButtonPress(delta) {
        const state = this.menuButtonState;
        if (!state.xrReady) return;

        if (state.cooldown > 0) {
            state.cooldown -= delta;
            return;
        }

        if (this.pinchState.left || this.pinchState.right) return;
        if (!this.menuButton.visible) return;

        this.menuButton.getWorldPosition(this._menuButtonWorldPos);

        if (this.leftIndex.position.distanceTo(this._menuButtonWorldPos) < state.pressDistance) {
            this.onMenuButtonPressed();
            return;
        }
        if (this.rightIndex.position.distanceTo(this._menuButtonWorldPos) < state.pressDistance) {
            this.onMenuButtonPressed();
        }
    }

    onMenuButtonPressed() {
        this.menuButtonState.cooldown = this.menuButtonState.cooldownDuration;
        this.animateMenuButtonPress(this.menuButton);

        if (!this.menuPanelOpen) {
            this.showMenuPanel();
        }
    }

    checkMenuPanelButtonPress(buttonMesh, onPressed) {
        buttonMesh.getWorldPosition(this._menuPanelButtonWorldPos);

        if (this.leftIndex.position.distanceTo(this._menuPanelButtonWorldPos) < this.menuButtonState.pressDistance) {
            onPressed();
            return true;
        }
        if (this.rightIndex.position.distanceTo(this._menuPanelButtonWorldPos) < this.menuButtonState.pressDistance) {
            onPressed();
            return true;
        }
        return false;
    }

    updateToggleColors(animateHighlight = false) {
        if (this.highlightTag) {
            const targetX = this.viewMode === '2D' ? this.menuToggleAX : this.menuToggleBX;
            if (animateHighlight) {
                gsap.killTweensOf(this.highlightTag.position);
                gsap.to(this.highlightTag.position, {
                    x: targetX,
                    duration: this.highlightTagMoveDuration,
                    ease: 'power2.inOut',
                });
            } else {
                gsap.killTweensOf(this.highlightTag.position);
                this.highlightTag.position.x = targetX;
            }
        }

        if (!this.menuToggleA || !this.menuToggleB) return;

        const is2D = this.viewMode === '2D';
        this.menuToggleA.material.color.setHex(is2D ? this.menuToggleActiveColor : this.menuToggleInactiveColor);
        this.menuToggleB.material.color.setHex(is2D ? this.menuToggleInactiveColor : this.menuToggleActiveColor);
    }

    setViewMode(mode, animateHighlight = false) {
        if (mode !== '2D' && mode !== '3D') return;
        const modeChanged = mode !== this.viewMode;
        this.viewMode = mode;
        this.syncMenuRowForViewMode(mode);
        this.updateToggleColors(animateHighlight && modeChanged);
    }

    setMenuCheckboxesEnabled(active) {
        this.menuCheckboxesEnabled = active;
        this.menuCheckboxes.forEach((checkbox) => {
            checkbox.mesh.visible = active;
        });
        if (this.menuCheckboxLabels) {
            this.menuCheckboxLabels.forEach((label) => {
                label.visible = active;
            });
        }
    }

    syncMenuRowForViewMode(mode) {
        const is2D = mode === '2D';
        this.setMenuCheckboxesEnabled(is2D);
        this.setMenuSliderEnabled(!is2D);
    }

    onMenuTogglePressed(toggleMesh) {
        this.menuButtonState.cooldown = this.menuButtonState.cooldownDuration;
        this.animateMenuButtonPress(toggleMesh, this.menuTogglePressScale);

        const nextMode = this.viewMode === '2D' ? '3D' : '2D';
        if (this.onViewModeChange && this.onViewModeChange(nextMode) === false) return;

        this.setViewMode(nextMode, true);
    }

    updateCheckboxVisual(index) {
        const checkbox = this.menuCheckboxes[index];
        if (checkbox?.meshIn) {
            checkbox.meshIn.visible = checkbox.checked;
        }
    }

    setActiveCheckbox(index) {
        if (index < 0 || index >= this.menuCheckboxes.length) return;

        this.activeCheckboxIndex = index;
        this.menuCheckboxes.forEach((checkbox, i) => {
            checkbox.checked = i === index;
            this.updateCheckboxVisual(i);
        });
    }

    onMenuCheckboxPressed(index) {
        const checkbox = this.menuCheckboxes[index];
        if (!checkbox) return;

        this.menuButtonState.cooldown = this.menuButtonState.cooldownDuration;
        this.animateMenuButtonPress(checkbox.mesh);

        if (index === this.activeCheckboxIndex) return;

        if (this.onCheckboxChange && this.onCheckboxChange(index) === false) return;

        this.setActiveCheckbox(index);
    }

    checkMenuPanelButtonsPress() {
        const state = this.menuButtonState;
        if (!state.xrReady) return;
        if (this.isInteractionLocked()) return;
        if (state.cooldown > 0) return;
        if (!this.menuPanelOpen || !this.menuPanel.visible) return;
        if (this.activeMenuSlider) return;
        if (this.pinchState.left || this.pinchState.right) return;

        if (this.menuToggleA && this.checkMenuPanelButtonPress(
            this.menuToggleA,
            () => this.onMenuTogglePressed(this.menuToggleA)
        )) return;

        if (this.menuToggleB && this.checkMenuPanelButtonPress(
            this.menuToggleB,
            () => this.onMenuTogglePressed(this.menuToggleB)
        )) return;

        if (this.menuCheckboxesEnabled) {
            for (let i = 0; i < this.menuCheckboxes.length; i++) {
                if (this.checkMenuPanelButtonPress(
                    this.menuCheckboxes[i].mesh,
                    () => this.onMenuCheckboxPressed(i)
                )) return;
            }
        }

        this.checkMenuPanelButtonPress(this.menuCloseButton, () => this.onMenuCloseButtonPressed());
    }

    onMenuCloseButtonPressed() {
        this.menuButtonState.cooldown = this.menuButtonState.cooldownDuration;
        this.animateMenuButtonPress(this.menuCloseButton);
        setTimeout(() => { this.hideMenuPanel(); }, 150);
    }

    showMenuPanel() {
        this.menuPanelOpen = true;

        const cfg = this.menuUiAnimConfig;
        const tl = gsap.timeline();

        tl.to({}, { duration: cfg.buttonHideDelay });
        tl.to(this.menuButton.scale, {
            x: 0,
            y: 0,
            duration: cfg.buttonScaleDuration,
            ease: cfg.buttonEase,
            onComplete: () => { this.menuButton.visible = false; },
        });
        tl.to({}, { duration: cfg.panelShowDelay });
        tl.call(() => { this.menuPanel.visible = true; });
        const openScale = this.menuPanelOpenScale;
        tl.to(this.menuPanel.scale, {
            x: openScale,
            y: openScale,
            z: openScale,
            duration: cfg.panelScaleDuration,
            ease: cfg.panelEase,
        });
    }

    hideMenuPanel() {
        this.menuPanelOpen = false;
        this.releaseActiveMenuSlider();
        this.menuButton.position.z = 0;

        const cfg = this.menuUiAnimConfig;
        const tl = gsap.timeline();

        tl.to(this.menuPanel.scale, {
            x: 0,
            y: 0,
            z: 0,
            duration: cfg.panelHideDuration,
            ease: 'power2.in',
            onComplete: () => { this.menuPanel.visible = false; },
        });
        tl.call(() => { this.menuButton.visible = true; }, [], `-=${cfg.panelHideDuration * 0.3}`);
        tl.to(this.menuButton.scale, {
            x: 1,
            y: 1,
            duration: cfg.buttonScaleDuration,
            ease: cfg.panelEase,
        }, `-=${cfg.panelScaleDuration * 0.3}`);
    }

    _initMenuPanelLabelConfig() {
        const MENU_PANEL_LABEL_TEXT_SCALE = 0.8;
        this.menuPanelLabelConfig = {
            textScale: MENU_PANEL_LABEL_TEXT_SCALE,
            textHeight: 0.025 * MENU_PANEL_LABEL_TEXT_SCALE,
            textFont: `bold ${Math.round(34 * MENU_PANEL_LABEL_TEXT_SCALE)}px Helvetica`,
        };
    }

    _createMenuPanelLabelText(text, position) {
        const cfg = this.menuPanelLabelConfig;
        const canvasHeight = Math.round(64 * cfg.textScale);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = cfg.textFont;
        const textWidth = ctx.measureText(text).width;
        const padding = 12 * cfg.textScale;
        canvas.width = Math.ceil(textWidth + padding * 2);
        canvas.height = canvasHeight;

        ctx.fillStyle = '#ffffff';
        ctx.font = cfg.textFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, padding, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        const planeWidth = cfg.textHeight * (canvas.width / canvas.height);
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(planeWidth, cfg.textHeight),
            new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.FrontSide,
                transparent: true,
                depthTest: false,
            })
        );
        mesh.position.set(position.x + planeWidth * 0.5, position.y, position.z);
        mesh.frustumCulled = false;
        this.menuPanel.add(mesh);
        return mesh;
    }

    _initMenuSlider(menuPanelW, config, menuRowY = 0, menuRowZ = 0) {
        if (!config || !this.scene) return;

        const MENU_SLIDER_TRACK_WIDTH = 0.175;
        const MENU_SLIDER_TRACK_HEIGHT = 0.0025;
        const MENU_SLIDER_TRACK_X_OFFSET_PX = 2;
        const MENU_SLIDER_VALUE_TEXT_X = 0.115;
        const MENU_SLIDER_LABEL_TEXT_LEFT_X = -0.142;
        const MENU_SLIDER_INACTIVE_TEXT_OPACITY = 0.8;
        const MENU_SLIDER_INACTIVE_CONTROL_OPACITY = 0.5;
        const MENU_SLIDER_ACTIVE_GRAB_COLOR = 0xffff00;
        const MENU_SLIDER_INACTIVE_GRAB_COLOR = 0xffffff;

        const labelCfg = this.menuPanelLabelConfig;
        this.menuSliderConfig = {
            trackWidth: MENU_SLIDER_TRACK_WIDTH,
            trackControlsOffsetX: menuPanelW * (MENU_SLIDER_TRACK_X_OFFSET_PX / 638),
            textFont: labelCfg.textFont,
            textHeight: labelCfg.textHeight,
            valueTextWidth: 0.05 * labelCfg.textScale,
            valueTextX: MENU_SLIDER_VALUE_TEXT_X,
            labelTextLeftX: MENU_SLIDER_LABEL_TEXT_LEFT_X,
            inactiveTextOpacity: MENU_SLIDER_INACTIVE_TEXT_OPACITY,
            inactiveControlOpacity: MENU_SLIDER_INACTIVE_CONTROL_OPACITY,
            activeGrabColor: MENU_SLIDER_ACTIVE_GRAB_COLOR,
            inactiveGrabColor: MENU_SLIDER_INACTIVE_GRAB_COLOR,
        };

        this.menuSliderGeometries = {
            track: new THREE.PlaneGeometry(MENU_SLIDER_TRACK_WIDTH, MENU_SLIDER_TRACK_HEIGHT),
            trackDot: new THREE.SphereGeometry(0.0045, 16, 16),
            grabDot: new THREE.SphereGeometry(INTERACTION_KNOB_RADIUS, 16, 16),
            connector: new THREE.BoxGeometry(1, 1, 1),
            valueText: new THREE.PlaneGeometry(this.menuSliderConfig.valueTextWidth, labelCfg.textHeight),
        };

        const sliderPosition = new THREE.Vector3(
            config.position?.x ?? 0.005,
            config.position?.y ?? menuRowY,
            config.position?.z ?? menuRowZ
        );

        this.menuSlider = this._createMenuSlider({
            position: sliderPosition,
            label: config.label ?? 'Value',
            minValue: config.min ?? 0,
            maxValue: config.max ?? 1,
            initialValue: config.initialValue ?? config.min ?? 0,
            valueDecimals: config.valueDecimals ?? 2,
            onUpdate: config.onUpdate ?? null,
            onRelease: config.onRelease ?? null,
        });
    }

    _createMenuSliderLabelText(text, leftX) {
        const cfg = this.menuSliderConfig;
        const labelCfg = this.menuPanelLabelConfig;
        const canvasHeight = Math.round(64 * labelCfg.textScale);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = cfg.textFont;
        const textWidth = ctx.measureText(text).width;
        const padding = 12 * labelCfg.textScale;
        canvas.width = Math.ceil(textWidth + padding * 2);
        canvas.height = canvasHeight;

        ctx.fillStyle = '#ffffff';
        ctx.font = cfg.textFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, padding, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        const planeWidth = cfg.textHeight * (canvas.width / canvas.height);
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(planeWidth, cfg.textHeight),
            new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.FrontSide,
                transparent: true,
                depthTest: false,
            })
        );
        mesh.position.set(leftX + planeWidth * 0.5, 0, 0);
        mesh.frustumCulled = false;
        return mesh;
    }

    _createMenuSlider(config) {
        const cfg = this.menuSliderConfig;
        const trackHalfWidth = this.menuSliderGeometries.track.parameters.width * 0.5;
        const range = config.maxValue - config.minValue;
        const normalized = range <= 0
            ? 0
            : THREE.MathUtils.clamp((config.initialValue - config.minValue) / range, 0, 1);

        const labelCfg = this.menuPanelLabelConfig;
        const valueTextCanvas = document.createElement('canvas');
        valueTextCanvas.width = Math.round(128 * labelCfg.textScale);
        valueTextCanvas.height = Math.round(64 * labelCfg.textScale);
        const valueTextCtx = valueTextCanvas.getContext('2d');
        const valueTextTexture = new THREE.CanvasTexture(valueTextCanvas);
        valueTextTexture.colorSpace = THREE.SRGBColorSpace;

        const valueTextMaterial = new THREE.MeshBasicMaterial({
            map: valueTextTexture,
            side: THREE.FrontSide,
            transparent: true,
            depthTest: false,
        });
        const valueText = new THREE.Mesh(this.menuSliderGeometries.valueText, valueTextMaterial);
        valueText.position.set(cfg.valueTextX, 0, 0);
        valueText.frustumCulled = false;

        const sliderRoot = new THREE.Object3D();
        sliderRoot.position.copy(config.position);
        sliderRoot.frustumCulled = false;
        this.menuPanel.add(sliderRoot);
        sliderRoot.add(valueText);

        let labelText = null;
        if (config.label) {
            labelText = this._createMenuSliderLabelText(config.label, cfg.labelTextLeftX);
            sliderRoot.add(labelText);
        }

        const trackControls = new THREE.Object3D();
        trackControls.position.x = cfg.trackControlsOffsetX;
        trackControls.frustumCulled = false;
        sliderRoot.add(trackControls);

        const track = new THREE.Mesh(
            this.menuSliderGeometries.track,
            new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
        );
        track.frustumCulled = false;
        trackControls.add(track);

        const trackDot = new THREE.Mesh(
            this.menuSliderGeometries.trackDot,
            new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
        );
        trackDot.position.set(0, 0, 0.001);
        trackDot.frustumCulled = false;
        trackControls.add(trackDot);

        const grabDot = new THREE.Mesh(
            this.menuSliderGeometries.grabDot,
            new THREE.MeshBasicMaterial({ color: cfg.activeGrabColor, depthTest: true })
        );
        grabDot.position.set(0, 0, 0.002);
        grabDot.frustumCulled = false;
        trackControls.add(grabDot);

        const connector = new THREE.Mesh(
            this.menuSliderGeometries.connector,
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                depthTest: true,
                transparent: true,
                opacity: 0.6,
            })
        );
        connector.visible = false;
        connector.frustumCulled = false;
        this.scene.add(connector);

        const slider = {
            value: {
                normalized,
                min: config.minValue,
                max: config.maxValue,
                decimals: config.valueDecimals,
            },
            elements: {
                root: sliderRoot,
                trackControls,
                track,
                trackDot,
                grabDot,
                connector,
            },
            text: {
                label: labelText,
                value: valueText,
                valueCanvas: valueTextCanvas,
                valueCtx: valueTextCtx,
                valueTexture: valueTextTexture,
            },
            interaction: {
                enabled: true,
                isGrabbed: false,
                grabbingHand: null,
                grabDistance: 0.025,
                trackHalfWidth,
                initialGrabX: 0,
            },
            onUpdate: config.onUpdate,
            onRelease: config.onRelease ?? null,
        };

        this._updateMenuSliderTrackDotFromValue(slider);
        this._updateMenuSliderGrabDotPosition(slider);
        this._updateMenuSliderValueText(slider);
        return slider;
    }

    setMenuSliderEnabled(active) {
        const slider = this.menuSlider;
        if (!slider) return;

        const cfg = this.menuSliderConfig;
        const { root, track, trackDot, grabDot } = slider.elements;

        if (!active && this.activeMenuSlider === slider) {
            this.releaseActiveMenuSlider();
        }

        root.visible = active;
        slider.interaction.enabled = active;

        if (!active) return;

        track.material.transparent = false;
        track.material.opacity = 1;
        trackDot.visible = true;
        trackDot.material.transparent = false;
        trackDot.material.opacity = 1;
        grabDot.visible = true;
        grabDot.material.transparent = true;
        grabDot.material.color.setHex(cfg.activeGrabColor);
        grabDot.material.opacity = 1;

        if (slider.text.label) {
            slider.text.label.material.opacity = 1;
        }
        slider.text.value.material.opacity = 1;
    }

    setMenuSliderValue(actualValue) {
        const slider = this.menuSlider;
        if (!slider) return;

        const range = slider.value.max - slider.value.min;
        slider.value.normalized = range <= 0
            ? 0
            : THREE.MathUtils.clamp((actualValue - slider.value.min) / range, 0, 1);
        this._updateMenuSliderTrackDotFromValue(slider);
        this._updateMenuSliderGrabDotPosition(slider);
        this._updateMenuSliderValueText(slider);
    }

    _getMenuSliderActualValue(slider) {
        const { normalized, min, max } = slider.value;
        return min + normalized * (max - min);
    }

    _updateMenuSliderValueTextCanvas(slider, displayValue) {
        const { valueCanvas, valueCtx, valueTexture } = slider.text;
        const cfg = this.menuSliderConfig;
        valueCtx.clearRect(0, 0, valueCanvas.width, valueCanvas.height);
        valueCtx.fillStyle = '#ffffff';
        valueCtx.font = cfg.textFont;
        valueCtx.textAlign = 'center';
        valueCtx.textBaseline = 'middle';
        valueCtx.fillText(String(displayValue), valueCanvas.width / 2, valueCanvas.height / 2);
        valueTexture.needsUpdate = true;
    }

    _updateMenuSliderValueText(slider) {
        const actual = this._getMenuSliderActualValue(slider);
        const text = slider.value.decimals !== undefined
            ? actual.toFixed(slider.value.decimals)
            : actual.toFixed(1);
        this._updateMenuSliderValueTextCanvas(slider, text);
    }

    _updateMenuSliderTrackDotFromValue(slider) {
        const trackX = (slider.value.normalized - 0.5) * 2 * slider.interaction.trackHalfWidth;
        slider.elements.trackDot.position.x = trackX;
    }

    _updateMenuSliderGrabDotPosition(slider) {
        if (!slider || slider.interaction.isGrabbed) return;
        slider.elements.grabDot.position.x = slider.elements.trackDot.position.x;
    }

    updateMenuSliderGrabDot() {
        this._updateMenuSliderGrabDotPosition(this.menuSlider);
    }

    _applyMenuSliderNormalizedValue(slider) {
        if (slider.onUpdate) {
            slider.onUpdate(this._getMenuSliderActualValue(slider));
        }
    }

    _getMenuSliderTrackWorldDir(slider) {
        slider.elements.track.getWorldPosition(this._menuSliderTrackWorldPos);
        this._menuSliderTrackWorldXEnd.set(1, 0, 0);
        slider.elements.track.localToWorld(this._menuSliderTrackWorldXEnd);
        this._menuSliderTrackWorldDir.copy(this._menuSliderTrackWorldXEnd).sub(this._menuSliderTrackWorldPos).normalize();
    }

    _getMenuSliderPinchWorldPos(hand) {
        if (hand === 'left') {
            return this._menuSliderPinchWorldPos.addVectors(
                this.leftThumb.position,
                this.leftIndex.position
            ).multiplyScalar(0.5);
        }
        return this._menuSliderPinchWorldPos.addVectors(
            this.rightThumb.position,
            this.rightIndex.position
        ).multiplyScalar(0.5);
    }

    checkMenuSlidersGrab() {
        const slider = this.menuSlider;
        if (!slider || !this.leftThumb || !this.rightThumb) return;

        const state = this.menuButtonState;
        if (!state.xrReady) return;
        if (this.isInteractionLocked()) return;
        if (!this.menuPanelOpen || !this.menuPanel.visible) return;

        const leftPinching = this.pinchState.left;
        const rightPinching = this.pinchState.right;

        if (this.activeMenuSlider) {
            const stillPinching =
                (this.activeMenuSlider.interaction.grabbingHand === 'left' && leftPinching) ||
                (this.activeMenuSlider.interaction.grabbingHand === 'right' && rightPinching);

            if (!stillPinching) {
                this.onMenuSliderRelease(this.activeMenuSlider);
            } else {
                this.onMenuSliderDrag(this.activeMenuSlider);
            }
            return;
        }

        if (!slider.elements.root.visible || slider.interaction.enabled === false) return;

        slider.elements.grabDot.getWorldPosition(this._menuSliderGrabDotWorldPos);

        if (leftPinching) {
            this._getMenuSliderPinchWorldPos('left');
            if (this._menuSliderPinchWorldPos.distanceTo(this._menuSliderGrabDotWorldPos) < slider.interaction.grabDistance) {
                this.onMenuSliderGrab(slider, 'left');
                return;
            }
        }

        if (rightPinching) {
            this._getMenuSliderPinchWorldPos('right');
            if (this._menuSliderPinchWorldPos.distanceTo(this._menuSliderGrabDotWorldPos) < slider.interaction.grabDistance) {
                this.onMenuSliderGrab(slider, 'right');
            }
        }
    }

    onMenuSliderGrab(slider, hand) {
        this.activeMenuSlider = slider;
        slider.interaction.isGrabbed = true;
        slider.interaction.grabbingHand = hand;

        this._getMenuSliderPinchWorldPos(hand);
        this._getMenuSliderTrackWorldDir(slider);
        slider.interaction.initialGrabX = this._menuSliderPinchWorldPos.clone()
            .sub(this._menuSliderTrackWorldPos)
            .dot(this._menuSliderTrackWorldDir);

        slider.elements.grabDot.getWorldPosition(this._menuSliderGrabDotWorldPos);
        slider.elements.trackControls.remove(slider.elements.grabDot);
        this.scene.add(slider.elements.grabDot);
        slider.elements.grabDot.position.copy(this._menuSliderGrabDotWorldPos);
        slider.elements.grabDot.scale.setScalar(1.2);

        slider.elements.connector.visible = true;
        this._updateMenuSliderConnector(slider);
    }

    onMenuSliderDrag(slider) {
        this._getMenuSliderPinchWorldPos(slider.interaction.grabbingHand);
        slider.elements.grabDot.position.copy(this._menuSliderPinchWorldPos);

        this._getMenuSliderTrackWorldDir(slider);

        const currentProjectedX = this._menuSliderPinchWorldPos.clone()
            .sub(this._menuSliderTrackWorldPos)
            .dot(this._menuSliderTrackWorldDir);
        const deltaX = currentProjectedX - slider.interaction.initialGrabX;
        const currentTrackX = (slider.value.normalized - 0.5) * 2 * slider.interaction.trackHalfWidth;
        let newTrackX = currentTrackX + deltaX;
        newTrackX = Math.max(
            -slider.interaction.trackHalfWidth,
            Math.min(slider.interaction.trackHalfWidth, newTrackX)
        );

        slider.value.normalized = (newTrackX / slider.interaction.trackHalfWidth + 1) * 0.5;
        slider.interaction.initialGrabX = currentProjectedX;

        this._updateMenuSliderTrackDotFromValue(slider);
        this._updateMenuSliderValueText(slider);
        this._applyMenuSliderNormalizedValue(slider);
        this._updateMenuSliderConnector(slider);
    }

    _updateMenuSliderConnector(slider) {
        slider.elements.trackDot.getWorldPosition(this._menuSliderConnectorTrackDotPos);
        slider.elements.grabDot.getWorldPosition(this._menuSliderConnectorGrabDotPos);

        const distance = this._menuSliderConnectorTrackDotPos.distanceTo(this._menuSliderConnectorGrabDotPos);
        this._menuSliderConnectorMidpoint.addVectors(
            this._menuSliderConnectorTrackDotPos,
            this._menuSliderConnectorGrabDotPos
        ).multiplyScalar(0.5);
        slider.elements.connector.position.copy(this._menuSliderConnectorMidpoint);

        const thickness = 0.002;
        slider.elements.connector.scale.set(thickness, thickness, distance);
        slider.elements.connector.lookAt(this._menuSliderConnectorGrabDotPos);
    }

    onMenuSliderRelease(slider) {
        slider.interaction.isGrabbed = false;
        slider.interaction.grabbingHand = null;
        this.activeMenuSlider = null;

        slider.elements.connector.visible = false;
        slider.elements.grabDot.scale.setScalar(1);

        slider.onRelease?.();

        slider.elements.grabDot.getWorldPosition(this._menuSliderGrabDotWorldPos);
        this.scene.remove(slider.elements.grabDot);
        slider.elements.trackControls.add(slider.elements.grabDot);
        slider.elements.trackControls.worldToLocal(this._menuSliderGrabDotWorldPos);
        slider.elements.grabDot.position.copy(this._menuSliderGrabDotWorldPos);

        gsap.to(slider.elements.grabDot.position, {
            x: slider.elements.trackDot.position.x,
            y: slider.elements.trackDot.position.y,
            z: 0.002,
            duration: 0.1,
            ease: 'power2.out',
        });
    }

    releaseActiveMenuSlider() {
        if (this.activeMenuSlider) {
            this.onMenuSliderRelease(this.activeMenuSlider);
        }
    }
}
