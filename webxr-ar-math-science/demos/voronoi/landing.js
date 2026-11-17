import { createExperience, beginExperience, teardownExperience } from './assets/experience.js';

// Match three.js XRButton defaults — local-floor is required for setSession().
const XR_OPTIONS = {
  optionalFeatures: [
    'local-floor',
    'bounded-floor',
    'layers',
    'hand-tracking'
  ]
};

const launchBtn = document.getElementById('launch-xr');
const launchError = document.getElementById('launch-error');
const heroVideo = document.querySelector('.detail-hero-video');

/** Resolved on page load so the click handler can call requestSession immediately. */
let xrMode = null;

function showError(message) {
  launchError.hidden = false;
  launchError.textContent = message;
  launchBtn.disabled = false;
}

async function detectXRMode() {
  if (!navigator.xr) return null;
  if (await navigator.xr.isSessionSupported('immersive-ar')) return 'immersive-ar';
  if (await navigator.xr.isSessionSupported('immersive-vr')) return 'immersive-vr';
  return null;
}

detectXRMode().then((mode) => {
  xrMode = mode;
});

launchBtn.addEventListener('click', () => {
  launchError.hidden = true;
  launchBtn.disabled = true;

  if (!navigator.xr || !xrMode) {
    showError('WebXR is not available on this device or browser.');
    return;
  }

  // requestSession must start synchronously in the click handler (before any await).
  const sessionPromise = navigator.xr.requestSession(xrMode, XR_OPTIONS);

  let exp;
  try {
    exp = createExperience();
  } catch (err) {
    console.error('createExperience failed:', err);
    sessionPromise.then((s) => s.end()).catch(() => {});
    showError('Could not start WebXR. Try again from a supported headset or browser.');
    return;
  }

  sessionPromise
    .then(async (session) => {
      heroVideo?.pause();
      document.getElementById('landing').hidden = true;
      await beginExperience(exp, session);

      session.addEventListener('end', () => {
        window.location.reload();
      });
    })
    .catch(async (err) => {
      console.error('requestSession failed:', err);
      teardownExperience(exp);
      document.getElementById('landing').hidden = false;
      showError(err?.message || 'Could not start WebXR. Try again from a supported headset or browser.');
    });
});
