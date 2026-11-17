import * as THREE from 'three';

export function createPlateAudio(deps) {
    const {
        camera, renderer, containerGroup, plateY,
        resonance, FREQUENCY_MAX_HZ,
    } = deps;
const plateAudioConfig = {
    masterVolume: 0.5,
    exciterLevel: 0.10,
    ringLevel: 0.85,
    partialLevel: 0.14,
    partialRatio: 2.756,
    audioHzMin: 130,       // physical 0 Hz maps here
    audioHzMax: 1000,      // physical FREQUENCY_MAX_HZ maps here
    lowpassHz: 4500,
    freqSmoothing: 0.03,   // setTargetAtTime time constants (seconds)
    gainSmoothing: 0.08,
};

/** Map a physical plate frequency into the ear-friendly listening band. */
function plateAudioHz(physicalHz) {
    const t = THREE.MathUtils.clamp(physicalHz / FREQUENCY_MAX_HZ, 0, 1);
    return plateAudioConfig.audioHzMin + t * (plateAudioConfig.audioHzMax - plateAudioConfig.audioHzMin);
}

const plateAudioState = {
    initialized: false,
    ctx: null,
    positional: null,
    masterGain: null,
    exciterOsc: null, exciterGain: null,
    ringOsc: null, ringGain: null,
    partialOsc: null, partialGain: null,
};

/** Rough equal-loudness tilt so high resonances don't pierce and lows stay present. */
function plateLoudnessCompensation(hz) {
    const f = THREE.MathUtils.clamp(hz, 80, 9000);
    return Math.pow(500 / f, 0.35);
}

function initPlateAudio() {
    if (plateAudioState.initialized) return;

    const listener = new THREE.AudioListener();
    camera.add(listener);
    const ctx = listener.context;

    const positional = new THREE.PositionalAudio(listener);
    positional.setRefDistance(0.6);
    positional.setRolloffFactor(1.1);
    positional.setDistanceModel('inverse');
    positional.position.set(0, plateY, 0);
    containerGroup.add(positional);

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = plateAudioConfig.lowpassHz;
    lowpass.Q.value = 0.4;

    // Safety compressor — resonance swells stay comfortable
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    masterGain.connect(lowpass);
    lowpass.connect(compressor);
    positional.setNodeSource(compressor);

    const makeVoice = (frequencyHz) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequencyHz;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        return { osc, gain };
    };

    const exciter = makeVoice(440);
    const ring = makeVoice(440);
    const partial = makeVoice(440 * plateAudioConfig.partialRatio);

    plateAudioState.initialized = true;
    plateAudioState.ctx = ctx;
    plateAudioState.positional = positional;
    plateAudioState.masterGain = masterGain;
    plateAudioState.exciterOsc = exciter.osc;
    plateAudioState.exciterGain = exciter.gain;
    plateAudioState.ringOsc = ring.osc;
    plateAudioState.ringGain = ring.gain;
    plateAudioState.partialOsc = partial.osc;
    plateAudioState.partialGain = partial.gain;
}

function updatePlateAudio() {
    if (!plateAudioState.initialized) return;

    const s = plateAudioState;
    const cfg = plateAudioConfig;
    const t = s.ctx.currentTime;
    const R = resonance.response;

    // Audible only while a control is actively being dragged (when AUDIO checkbox is on)
    const interacting = deps.frequencyKnobState.isGrabbed || deps.activeMenuSlider !== null;
    const audible = deps.plateAudioEnabled && renderer.xr.isPresenting && interacting;

    s.masterGain.gain.setTargetAtTime(audible ? cfg.masterVolume : 0, t, audible ? 0.06 : 0.15);
    if (!audible) return;

    // Exciter: follows the knob (fades out near physical 0 Hz)
    const driveAudioHz = plateAudioHz(resonance.driveHz);
    const driveFade = THREE.MathUtils.clamp(resonance.driveHz / 60, 0, 1);
    s.exciterOsc.frequency.setTargetAtTime(driveAudioHz, t, cfg.freqSmoothing);
    s.exciterGain.gain.setTargetAtTime(
        cfg.exciterLevel * driveFade * plateLoudnessCompensation(driveAudioHz),
        t, cfg.gainSmoothing
    );

    // Ring: the plate answering at its own eigenfrequency
    const ringAudioHz = plateAudioHz(resonance.dominantHz);
    s.ringOsc.frequency.setTargetAtTime(ringAudioHz, t, cfg.freqSmoothing);
    s.ringGain.gain.setTargetAtTime(
        cfg.ringLevel * Math.pow(R, 1.6) * plateLoudnessCompensation(ringAudioHz),
        t, cfg.gainSmoothing
    );

    // Metallic overtone (stays below ~2.8 kHz thanks to the audio-band mapping)
    const partialHz = ringAudioHz * cfg.partialRatio;
    s.partialOsc.frequency.setTargetAtTime(partialHz, t, cfg.freqSmoothing);
    s.partialGain.gain.setTargetAtTime(
        cfg.partialLevel * R * R * plateLoudnessCompensation(partialHz),
        t, cfg.gainSmoothing
    );
}

renderer.xr.addEventListener('sessionstart', () => {
    initPlateAudio();
    if (plateAudioState.ctx && plateAudioState.ctx.state === 'suspended') {
        plateAudioState.ctx.resume();
    }
});

    const api = {

        plateAudioConfig,
        plateAudioState,
        initPlateAudio,
        updatePlateAudio,
        plateAudioHz
    };
    Object.assign(deps, api);
    return api;
}
