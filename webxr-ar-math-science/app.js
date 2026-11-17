/* ============================================================
   AR Math & Science — hub logic
   Data-driven card grid and demo detail views.
   ============================================================ */

// Prevent the hub scroll offset from being carried onto demo pages
// (Safari ignores subpage-only scrollRestoration without this).
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

const HUB_SCROLL_KEY = 'hubScrollY';

function saveHubScroll() {
  try {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    sessionStorage.setItem(HUB_SCROLL_KEY, String(y));
  } catch (_) { /* private mode */ }
}

function restoreHubScroll() {
  try {
    const raw = sessionStorage.getItem(HUB_SCROLL_KEY);
    if (raw == null) return;
    const y = Number(raw);
    if (!Number.isFinite(y) || y <= 0) return;
    const apply = () => {
      window.scrollTo(0, y);
      document.documentElement.scrollTop = y;
      document.body.scrollTop = y;
    };
    apply();
    requestAnimationFrame(apply);
  } catch (_) { /* private mode */ }
}

window.addEventListener('pagehide', saveHubScroll);
window.addEventListener('pageshow', restoreHubScroll);

const DEMOS = [
  { id: 'boids',      name: 'Boids',                  tag: 'Simulation',
    localPath: '/demos/boids/',
    heroVideo: true,
    desc: 'Emergent flocking from three simple rules: separation, alignment, and cohesion among agents.' },
  { id: 'chladni',    name: 'Chladni Patterns',        tag: 'Acoustics',
    localPath: '/demos/chladni/',
    heroVideo: true,
    desc: 'Standing waves on a vibrating plate gather particles into the intricate nodal lines of Chladni figures.' },
  { id: 'pendulum',   name: 'Double Pendulum',        tag: 'Chaos',
    localPath: '/demos/pendulum/',
    heroVideo: true,
    desc: 'A classic chaotic system, two linked pendulums whose motion is exquisitely sensitive to initial conditions.' },
  { id: 'quadric',    name: 'Quadric Surfaces',       tag: 'Geometry',
    localPath: '/demos/quadric/',
    heroVideo: true,
    desc: 'Ellipsoids, paraboloids, and hyperboloids are the 3D surfaces described by second-degree equations.' },
  { id: 'refraction', name: 'Refraction',            tag: 'Optics',
    localPath: '/demos/refraction/',
    heroVideo: true,
    desc: 'Light bends as it passes through prisms and lenses, its path governed by Snell\'s Law.' },
  { id: 'shm',        name: 'Simple Harmonic Motion', tag: 'Mechanics',
    localPath: '/demos/shm/',
    heroVideo: true,
    desc: 'Springs and oscillators trace out sinusoidal motion, the periodic back-and-forth that underlies waves and vibration.' },
  { id: 'revolution', name: 'Solids of Revolution',   tag: 'Calculus',
    localPath: '/demos/revolution/',
    heroVideo: true,
    desc: 'Sweeping a 2D curve around an axis generates a 3D solid, the geometry behind the volume integral.' },
  { id: 'spacetime',  name: 'Spacetime Curvature',    tag: 'Relativity',
    localPath: '/demos/spacetime/',
    heroVideo: true,
    desc: 'A deformable grid visualises how mass warps the fabric of spacetime, bending the paths around it.' },
  { id: 'attractor',  name: 'Strange Attractors',      tag: 'Chaos',
    localPath: '/demos/attractor/',
    heroVideo: true,
    desc: 'A strange attractor traces looping, never-repeating trajectories through three-dimensional space.' },
  { id: 'voronoi',    name: 'Voronoi Diagram',        tag: 'Geometry',
    localPath: '/demos/voronoi/',
    heroVideo: true,
    desc: 'Space partitioned into cells, each closest to its own seed point, forms a structure found all across nature.' }
];

/** 1080 on desktop landscape; 720 on portrait, phones, and touch/XR browsers. */
function preferDesktopHeroVideo() {
  return window.matchMedia(
    '(orientation: landscape) and (min-width: 900px) and (hover: hover) and (pointer: fine)'
  ).matches;
}

function heroVideoSrc(id) {
  return `thumbnails/${id}-${preferDesktopHeroVideo() ? '1080' : '720'}.mp4`;
}

function thumbSrc(d) {
  return `thumbnails/${d.id}-large.jpg`;
}

/** Two-line title HTML for long names; `<br class="detail-title-br">` shows only on mobile. */
const DETAIL_TITLE_HTML = {
  chladni: 'Chladni <br class="detail-title-br">Patterns',
  spacetime: 'Spacetime <br class="detail-title-br">Curvature',
  shm: 'Simple Harmonic <br class="detail-title-br">Motion',
  revolution: 'Solids of <br class="detail-title-br">Revolution',
};

function mountThumb(container, d, { imgClass, readyClass = 'has-thumb', src } = {}) {
  const img = document.createElement('img');
  img.className = imgClass;
  img.alt = '';
  img.decoding = 'async';
  const reveal = () => container.classList.add(readyClass);
  img.onload = reveal;
  img.onerror = () => img.remove();
  // Attach handlers before src so cached loads still reveal (Safari often skips onload otherwise).
  img.src = src || thumbSrc(d);
  if (img.complete && img.naturalWidth > 0) reveal();
  container.prepend(img);
}

function mountDetailHero(container, d) {
  if (!d.heroVideo) {
    mountThumb(container, d, { imgClass: 'detail-hero-img', readyClass: 'has-media' });
    return;
  }

  const video = document.createElement('video');
  video.className = 'detail-hero-video';
  video.src = heroVideoSrc(d.id);
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = 'auto';
  const showVideo = () => {
    container.classList.add('has-media');
    video.play().catch(() => {});
  };
  video.addEventListener('loadeddata', showVideo, { once: true });
  video.addEventListener('canplay', showVideo, { once: true });
  video.onerror = () => {
    video.remove();
    mountThumb(container, d, { imgClass: 'detail-hero-img', readyClass: 'has-media' });
  };
  container.prepend(video);
}

/* ---------------- Build grid ---------------- */
const grid = document.getElementById('grid');
DEMOS.forEach((d) => {
  // Always use <a> — Safari breaks flex layout / replaced content inside <button>.
  const card = document.createElement('a');
  card.className = 'card';
  if (d.localPath) {
    card.href = d.localPath.endsWith('/') ? d.localPath : `${d.localPath}/`;
  } else {
    card.href = `#${d.id}`;
  }
  card.innerHTML = `
    <div class="card-thumb">
      <div class="card-body">
        <div class="card-name">${d.name}</div>
      </div>
    </div>`;
  mountThumb(card.querySelector('.card-thumb'), d, {
    imgClass: 'card-thumb-img',
    src: thumbSrc(d),
  });
  card.addEventListener('click', saveHubScroll);
  grid.appendChild(card);
});

/* ---------------- View switching ---------------- */
const overview = document.getElementById('view-overview');
const detail = document.getElementById('view-detail');
const content = document.getElementById('content');

const ICON_LAUNCH = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10"/><path d="M9 2h5v5M14 2 7 9"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5 15 14H1z"/><path d="M8 6v4"/><circle cx="8" cy="12" r=".6" fill="currentColor" stroke="none"/></svg>';
const ICON_HAND = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.0" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 7.7V4.8c0-.5.4-.9.9-.9s.9.4.9.9v2.4"/><path d="M7 7.2V3.9c0-.5.4-.9.9-.9s.9.4.9.9v3.3"/><path d="M8.8 7.2V4.9c0-.5.4-.9.9-.9s.9.4.9.9v3.5"/><path d="M10.6 8V6.3c0-.5.4-.9.9-.9s.9.4.9.9v2.8c0 2.2-1.8 4-4 4h-.7c-1.4 0-2.6-.7-3.4-1.9L3.5 9.8c-.2-.4 0-.9.3-1.1.4-.2.8-.1 1.1.3L5.2 9.6"/></svg>';

let activeId = 'overview';

function demoLaunchHref(d) {
  const path = d.localPath.endsWith('/') ? d.localPath : `${d.localPath}/`;
  return `${path}?launch=1`;
}

function hashDemoId() {
  const id = location.hash.replace('#', '');
  return id && DEMOS.some((d) => d.id === id) ? id : null;
}

function redirectIntegratedDemoHash() {
  const id = hashDemoId();
  if (!id) return false;
  const d = DEMOS.find((demo) => demo.id === id);
  if (d?.localPath) {
    location.replace(d.localPath.endsWith('/') ? d.localPath : `${d.localPath}/`);
    return true;
  }
  return false;
}

/** Narrow viewports scroll <body> instead of .content, so both need resetting. */
function scrollViewToTop() {
  content.scrollTop = 0;
  window.scrollTo(0, 0);
}

function showOverview() {
  detail.querySelectorAll('.detail-hero-video').forEach((v) => v.pause());
  detail.hidden = true;
  overview.hidden = false;
  scrollViewToTop();
  activeId = 'overview';
}

function showDemo(id) {
  const d = DEMOS.find((demo) => demo.id === id);
  if (!d) return;
  const notesTitle = 'Interactions';
  const interactionItemsByDemo = {
    pendulum: [
      'Two-hand pinch: rotate, move, and scale the scene',
      'Single pinch: interact with the pendulum'
    ],
    quadric: [
      'Two-hand pinch: rotate, move, and scale the scene',
      'Single pinch: interact with cross-section slices'
    ],
    spacetime: [
      'Two-hand pinch: rotate, move, and scale the scene',
      'Single pinch: move the planets (in <em>Place</em> mode)'
    ],
    attractor: [
      'Two-hand pinch: rotate, move, and scale the scene'
    ],
    revolution: [
      'Two-hand pinch: rotate, move, and scale the scene',
      'Single pinch: edit the curve shape by moving and adding points; rotate the revolution slider'
    ],
    chladni: [
      'Two-hand pinch: rotate, move, and scale the scene'
    ],
    voronoi: [
      'Two-hand pinch: rotate, move, and scale the scene',
      'Single pinch: add, move, and delete (merge) the seed points'
    ],
    boids: [
      'Two-hand pinch: move, rotate, and scale the scene',
      '<strong>Wave</strong> or <strong>touch</strong> to interact with the boids'
    ],
    refraction: [
      'Two-hand pinch: rotate and move the scene',
      'Single pinch: grab and move objects',
      '<strong>Drag</strong> an object into the menu to delete it'
    ],
    shm: [
      'Two-hand pinch: move, rotate, and scale the scene',
      'Single pinch: interact with the spring'
    ]
  };
  const defaultInteractionItems = ['Two-hand pinch: rotate, move, and scale the scene'];
  const interactionItems = interactionItemsByDemo[d.id] || defaultInteractionItems;
  const notesItems = interactionItems
    .map((item) => {
      const parts = item.split(':');
      if (parts.length > 1) {
        const label = parts[0].trim();
        const text = parts.slice(1).join(':').trim();
        return `<li><strong>${label}:</strong> ${text}</li>`;
      }
      return `<li>${item}</li>`;
    })
    .join('');
  const notesBlock = `
    <div class="notes">
      <div class="notes-title notes-title-interactions">${ICON_HAND} ${notesTitle}</div>
      <ul>${notesItems}</ul>
    </div>`;

  detail.innerHTML = `
    <button class="detail-back" type="button" data-target="overview"><span class="detail-back-icon" aria-hidden="true">‹</span> Back</button>
    <div class="detail-intro">
      <span class="detail-eyebrow">${d.tag.toUpperCase()}</span>
      <h1 class="detail-title${DETAIL_TITLE_HTML[d.id] ? ' detail-title-nowrap' : ''}">${DETAIL_TITLE_HTML[d.id] || d.name}</h1>
      <p class="detail-desc">${d.desc}</p>
      <div class="detail-launch">
        <a class="btn btn-primary" href="${demoLaunchHref(d)}">Launch in WebXR ${ICON_LAUNCH}</a>
      </div>
    </div>

    <div class="detail-hero"></div>

    ${notesBlock}`;

  mountDetailHero(detail.querySelector('.detail-hero'), d);

  overview.hidden = true;
  detail.hidden = false;
  scrollViewToTop();
  activeId = id;
}

/* ---------------- Events ---------------- */
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-target]');
  if (!trigger) return;
  const target = trigger.dataset.target;
  if (target === 'overview') {
    if (hashDemoId()) history.back();
    return;
  }
  if (target === activeId) return;
  history.pushState(null, '', '#' + target);
  showDemo(target);
});

/* Deep link + browser back/forward (#demo-id) */
function routeFromHash() {
  if (redirectIntegratedDemoHash()) return;
  const id = hashDemoId();
  const nextId = id || 'overview';
  if (nextId === activeId) return;
  if (nextId === 'overview') showOverview();
  else showDemo(nextId);
}
window.addEventListener('hashchange', routeFromHash);
window.addEventListener('popstate', routeFromHash);
routeFromHash();
