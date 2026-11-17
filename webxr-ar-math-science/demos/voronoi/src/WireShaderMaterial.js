import * as THREE from 'three';

export function createWireShaderMaterial(color = 0xffffff, opacity = 1) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: opacity },
        },
        vertexShader: `
            attribute float edgeAlpha;
            varying float vEdgeAlpha;
            void main() {
                vEdgeAlpha = edgeAlpha;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying float vEdgeAlpha;
            void main() {
                float a = vEdgeAlpha * uOpacity;
                if (a < 0.01) discard;
                gl_FragColor = vec4(uColor, a);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
}
