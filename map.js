import { updatePanel, clearPanel } from './panel.js';

const COMMUNES_URL = './communes-pesticides.json';
const MAP_STYLE    = 'https://tiles.openfreemap.org/styles/dark';
const HISTORY_KEY  = 'pesticides-history';
const HISTORY_MAX  = 8;

// ── Couleurs ───────────────────────────────────────────────────────────────
function conformiteColor(score) {
  if (score == null) return '#2d2d2d';
  if (score >= 100)  return '#2ecc71';
  if (score >= 95)   return '#f1c40f';
  if (score >= 90)   return '#f39c12';
  return '#e74c3c';
}

function empreinteColor(n) {
  if (n == null) return '#2d2d2d';
  if (n === 0)   return '#374151';
  if (n <= 3)    return '#7e57c2';
  if (n <= 6)    return '#9c27b0';
  if (n <= 10)   return '#6a1b9a';
  return '#4a148c';
}

function moleculeColor(mol) {
  if (!mol || mol.n === 0) return '#2d2d2d';
  const score = 100 * (mol.n - mol.depassements) / mol.n;
  return conformiteColor(score);
}

// ── State ──────────────────────────────────────────────────────────────────
let communesData   = {};   // {insee: communeObj}
let map            = null;
let activeMode     = 'conformite';   // 'conformite' | 'empreinte' | 'molecule'
let activeMolecule = null;           // code SANDRE ou null
let geojson        = null;           // référence au FeatureCollection courant

// ── Color dispatch ─────────────────────────────────────────────────────────
function _colorFor(commune) {
  if (activeMode === 'empreinte') return empreinteColor(commune.n_molecules_detected);
  if (activeMode === 'molecule' && activeMolecule) {
    return moleculeColor(commune.molecules?.[activeMolecule]);
  }
  return conformiteColor(commune.score_conformite);
}

// ── Chargement données ─────────────────────────────────────────────────────
async function loadData() {
  const r = await fetch(COMMUNES_URL);
  const d = await r.json();

  for (const c of d.communes) {
    communesData[c.insee] = c;
  }

  document.getElementById('data-date').textContent =
    `Données ${d.years?.join('–') ?? ''} · màj ${new Date(d.generated_at).toLocaleDateString('fr-FR')}`;

  return d.communes;
}

// ── GeoJSON ────────────────────────────────────────────────────────────────
function buildGeojson(communes) {
  return {
    type: 'FeatureCollection',
    features: communes
      .filter(c => c.lat != null && c.lon != null)
      .map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
          insee:                c.insee,
          nom:                  c.nom,
          dept:                 c.dept,
          dept_fallback:        c.dept_fallback,
          score_conformite:     c.score_conformite,
          n_molecules_detected: c.n_molecules_detected,
          color:                _colorFor(c),
        },
      })),
  };
}

function recolorMap() {
  if (!map || !geojson) return;
  for (const f of geojson.features) {
    const c = communesData[f.properties.insee];
    if (c) f.properties.color = _colorFor(c);
  }
  map.getSource('communes').setData(geojson);
}

// ── Init carte ─────────────────────────────────────────────────────────────
async function initMap() {
  const communes = await loadData();

  map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [2.3, 46.6],
    zoom: 5.5,
    minZoom: 4,
  });

  map.on('load', () => {
    geojson = buildGeojson(communes);

    map.addSource('communes', { type: 'geojson', data: geojson });

    map.addLayer({
      id: 'communes-circles',
      type: 'circle',
      source: 'communes',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 2, 8, 5, 12, 9,
        ],
        'circle-opacity': 0.85,
      },
    });

    // Cercles fallback (cercles creux pour les communes sans données directes)
    map.addLayer({
      id: 'communes-fallback',
      type: 'circle',
      source: 'communes',
      filter: ['==', ['get', 'dept_fallback'], true],
      paint: {
        'circle-color': 'transparent',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': 0.5,
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 3, 8, 6, 12, 10,
        ],
      },
    });

    _setupInteractions();
    _updateLegend();
    _showOnboarding();
  });
}

// ── Interactions carte ─────────────────────────────────────────────────────
function _setupInteractions() {
  const tooltip = document.getElementById('map-tooltip');

  map.on('mousemove', 'communes-circles', (e) => {
    const p = e.features[0]?.properties;
    if (!p) return;
    map.getCanvas().style.cursor = 'pointer';
    const scoreStr = p.dept_fallback
      ? `${p.score_conformite != null ? Number(p.score_conformite).toFixed(1) : '?'} % (dept)`
      : `${p.score_conformite != null ? Number(p.score_conformite).toFixed(1) : '?'} %`;
    tooltip.style.display = 'block';
    tooltip.style.left = (e.point.x + 12) + 'px';
    tooltip.style.top  = (e.point.y + 12) + 'px';
    tooltip.textContent = `${p.nom} — ${scoreStr}`;
  });

  map.on('mouseleave', 'communes-circles', () => {
    map.getCanvas().style.cursor = '';
    tooltip.style.display = 'none';
  });

  map.on('click', 'communes-circles', (e) => {
    const p = e.features[0]?.properties;
    if (!p) return;
    const commune = communesData[p.insee];
    if (!commune) return;
    _selectCommune(commune);
  });
}

function _selectCommune(commune) {
  activeMolecule = null;
  updatePanel(commune, { onMoleculeSelect: _onMoleculeSelect });
  _saveHistory(commune);
}

function _onMoleculeSelect(code) {
  activeMolecule = code;
  activeMode = code ? 'molecule' : 'conformite';
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'conformite' && !code);
  });
  recolorMap();
}

// ── Toggle mode ────────────────────────────────────────────────────────────
function _setupModeToggle() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeMode = btn.dataset.mode;
      activeMolecule = null;
      recolorMap();
      _updateLegend();
    });
  });
}

function _updateLegend() {
  const legend = document.getElementById('legend');
  if (activeMode !== 'empreinte') {
    legend.innerHTML = `
      <div class="legend-title">Conformité réglementaire</div>
      <div class="legend-item"><span class="dot" style="background:#2ecc71"></span><div class="legend-label">100 % — Conforme</div></div>
      <div class="legend-item"><span class="dot" style="background:#f1c40f"></span><div class="legend-label">95–99 % — Dépassements rares</div></div>
      <div class="legend-item"><span class="dot" style="background:#f39c12"></span><div class="legend-label">90–95 % — Occasionnels</div></div>
      <div class="legend-item"><span class="dot" style="background:#e74c3c"></span><div class="legend-label">&lt; 90 % — Fréquents</div></div>
      <div class="legend-item"><span class="dot dot-nodata"></span><div class="legend-label">Sans données</div></div>
      <div class="legend-item"><span class="dot dot-fallback"></span><div class="legend-label">Données département</div></div>`;
  } else {
    legend.innerHTML = `
      <div class="legend-title">Empreinte pesticides</div>
      <div class="legend-item"><span class="dot" style="background:#374151"></span><div class="legend-label">0 molécule détectée</div></div>
      <div class="legend-item"><span class="dot" style="background:#7e57c2"></span><div class="legend-label">1–3 molécules</div></div>
      <div class="legend-item"><span class="dot" style="background:#9c27b0"></span><div class="legend-label">4–6 molécules</div></div>
      <div class="legend-item"><span class="dot" style="background:#6a1b9a"></span><div class="legend-label">7–10 molécules</div></div>
      <div class="legend-item"><span class="dot" style="background:#4a148c"></span><div class="legend-label">10+ molécules</div></div>`;
  }
}

// ── Recherche ──────────────────────────────────────────────────────────────
function _setupSearch() {
  const input    = document.getElementById('search');
  const dropdown = document.getElementById('search-dropdown');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { dropdown.hidden = true; return; }

    const results = Object.values(communesData)
      .filter(c => c.nom.toLowerCase().includes(q) || c.dept === q || c.insee.startsWith(q))
      .slice(0, 10);

    dropdown.innerHTML = results.map(c =>
      `<li data-insee="${c.insee}">${c.nom} <span style="color:var(--muted)">(${c.dept})</span></li>`
    ).join('');
    dropdown.hidden = results.length === 0;
  });

  dropdown.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const commune = communesData[li.dataset.insee];
    if (!commune) return;
    input.value = '';
    dropdown.hidden = true;
    _selectCommune(commune);
    if (commune.lat && commune.lon) {
      map.flyTo({ center: [commune.lon, commune.lat], zoom: 12, duration: 800 });
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-wrapper')) dropdown.hidden = true;
  });
}

// ── Boutons utilitaires ────────────────────────────────────────────────────
function _setupButtons() {
  document.getElementById('btn-home').addEventListener('click', () => {
    map.flyTo({ center: [2.3, 46.6], zoom: 5.5, duration: 800 });
  });

  document.getElementById('btn-locate').addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition(pos => {
      map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 11, duration: 800 });
    });
  });
}

// ── Historique ─────────────────────────────────────────────────────────────
function _saveHistory(commune) {
  const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    .filter(i => i.insee !== commune.insee);
  hist.unshift({ insee: commune.insee, nom: commune.nom, dept: commune.dept });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, HISTORY_MAX)));
}

// ── Onboarding ─────────────────────────────────────────────────────────────
function _showOnboarding() {
  if (localStorage.getItem('pesticides-onboarding-done')) return;
  const overlay = document.getElementById('onboarding-overlay');
  const modal   = document.getElementById('onboarding-modal');
  overlay.hidden = false;
  modal.hidden   = false;
  document.getElementById('btn-onboarding-close').addEventListener('click', () => {
    overlay.hidden = true;
    modal.hidden   = true;
    localStorage.setItem('pesticides-onboarding-done', '1');
  });
}

// ── Bottom sheet mobile ────────────────────────────────────────────────────
function _setupBottomSheet() {
  const panel  = document.getElementById('panel');
  const handle = document.getElementById('sheet-handle');
  const states = ['', 'sheet-half', 'sheet-full'];
  let idx = 0;
  handle.addEventListener('click', () => {
    panel.classList.remove(...states.filter(Boolean));
    idx = (idx + 1) % states.length;
    if (states[idx]) panel.classList.add(states[idx]);
  });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
initMap();
_setupModeToggle();
_setupSearch();
_setupButtons();
_setupBottomSheet();
