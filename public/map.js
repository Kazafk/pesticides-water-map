import { updatePanel, updateDeptPanel, clearPanel } from './panel.js';

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
let communesData   = {};
let deptData       = {};
let map            = null;
let activeMode     = 'conformite';
let activeMolecule = null;
let activeDeptView = false;
let geojson        = null;
let deptGeojson    = null;

// ── Color dispatch ─────────────────────────────────────────────────────────
function _colorFor(commune) {
  // Les communes en fallback département s'affichent comme "sans données"
  if (commune.dept_fallback) return '#2d2d2d';
  if (activeMode === 'empreinte') return empreinteColor(commune.n_molecules_detected);
  if (activeMode === 'molecule' && activeMolecule) return moleculeColor(commune.molecules?.[activeMolecule]);
  return conformiteColor(commune.score_conformite);
}

function _deptColorFor(dept) {
  if (activeMode === 'empreinte') return empreinteColor(dept.n_molecules_detected);
  return conformiteColor(dept.score_conformite);
}

// ── Chargement données ─────────────────────────────────────────────────────
async function loadData() {
  const r = await fetch(COMMUNES_URL);
  const d = await r.json();
  for (const c of d.communes) communesData[c.insee] = c;
  document.getElementById('data-date').textContent =
    `Données ${d.years?.join('–') ?? ''} · màj ${new Date(d.generated_at).toLocaleDateString('fr-FR')}`;
  return d.communes;
}

// ── Agrégation département ─────────────────────────────────────────────────
function computeDeptData(communes) {
  const byDept = {};
  for (const c of communes) {
    if (!byDept[c.dept]) byDept[c.dept] = { real: [], all: [] };
    byDept[c.dept].all.push(c);
    if (!c.dept_fallback) byDept[c.dept].real.push(c);
  }
  const median = arr => arr.length ? arr[Math.floor(arr.length / 2)] : null;

  const result = {};
  for (const [dept, { real, all }] of Object.entries(byDept)) {
    if (!real.length) continue;
    const withCoords = all.filter(c => c.lat && c.lon);
    if (!withCoords.length) continue;

    const lat = withCoords.reduce((s, c) => s + c.lat, 0) / withCoords.length;
    const lon = withCoords.reduce((s, c) => s + c.lon, 0) / withCoords.length;
    const scores = real.map(c => c.score_conformite).filter(s => s != null).sort((a, b) => a - b);
    const dets   = real.map(c => c.n_molecules_detected).sort((a, b) => a - b);

    // Molécules les plus présentes (nb communes où détectée)
    const molCount = {};
    for (const c of real) {
      for (const [code, mol] of Object.entries(c.molecules || {})) {
        if (!molCount[code]) molCount[code] = { count: 0, label: mol.label, depassements: 0 };
        molCount[code].count++;
        if (mol.depassements > 0) molCount[code].depassements++;
      }
    }
    const topMolecules = Object.entries(molCount)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([code, v]) => ({ code, ...v }));

    result[dept] = {
      dept,
      lat: Math.round(lat * 100) / 100,
      lon: Math.round(lon * 100) / 100,
      score_conformite: scores.length ? Math.round(median(scores) * 10) / 10 : null,
      n_molecules_detected: median(dets),
      n_communes: real.length,
      n_communes_total: all.length,
      n_prelevements: real.reduce((s, c) => s + (c.n_prelevements || 0), 0),
      n_depassements: real.reduce((s, c) => s + (c.n_depassements || 0), 0),
      top_molecules: topMolecules,
    };
  }
  return result;
}

// ── GeoJSON communes ───────────────────────────────────────────────────────
function buildGeojson(communes) {
  // Fallback en premier → rendu sous les communes réelles
  const sorted = [...communes].sort((a, b) => {
    if (a.dept_fallback && !b.dept_fallback) return -1;
    if (!a.dept_fallback && b.dept_fallback) return 1;
    return 0;
  });
  return {
    type: 'FeatureCollection',
    features: sorted
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

// ── GeoJSON départements ───────────────────────────────────────────────────
function buildDeptGeojson() {
  return {
    type: 'FeatureCollection',
    features: Object.values(deptData).map(d => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
      properties: {
        dept:                 d.dept,
        score_conformite:     d.score_conformite,
        n_molecules_detected: d.n_molecules_detected,
        n_communes:           d.n_communes,
        color:                _deptColorFor(d),
      },
    })),
  };
}

// ── Recolorage ─────────────────────────────────────────────────────────────
function recolorMap() {
  if (!map || !geojson) return;
  for (const f of geojson.features) {
    const c = communesData[f.properties.insee];
    if (c) f.properties.color = _colorFor(c);
  }
  map.getSource('communes').setData(geojson);

  if (deptGeojson) {
    for (const f of deptGeojson.features) {
      const d = deptData[f.properties.dept];
      if (d) f.properties.color = _deptColorFor(d);
    }
    map.getSource('depts').setData(deptGeojson);
  }
}

// ── Init carte ─────────────────────────────────────────────────────────────
async function initMap() {
  const communes = await loadData();
  deptData    = computeDeptData(communes);

  map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [2.3, 46.6],
    zoom: 5.5,
    minZoom: 4,
  });

  map.on('load', () => {
    // ── Calque communes ──
    geojson = buildGeojson(communes);
    map.addSource('communes', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'communes-circles',
      type: 'circle',
      source: 'communes',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 8, 5, 12, 9],
        'circle-opacity': ['case', ['get', 'dept_fallback'], 0.35, 0.85],
      },
    });

    // ── Calque départements (caché par défaut) ──
    deptGeojson = buildDeptGeojson();
    map.addSource('depts', { type: 'geojson', data: deptGeojson });
    map.addLayer({
      id: 'dept-circles',
      type: 'circle',
      source: 'depts',
      layout: { visibility: 'none' },
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 16, 8, 26, 12, 40],
        'circle-opacity': 0.85,
        'circle-stroke-color': 'rgba(255,255,255,0.25)',
        'circle-stroke-width': 2,
      },
    });

    map.addLayer({
      id: 'dept-labels',
      type: 'symbol',
      source: 'depts',
      layout: {
        visibility: 'none',
        'text-field': ['get', 'dept'],
        'text-size': 11,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1 },
    });

    _setupInteractions();
    _setupDeptInteractions();
    _updateLegend();
    _showOnboarding();
  });
}

// ── Interactions communes ──────────────────────────────────────────────────
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

// ── Interactions départements ──────────────────────────────────────────────
function _setupDeptInteractions() {
  const tooltip = document.getElementById('map-tooltip');

  map.on('mousemove', 'dept-circles', (e) => {
    const p = e.features[0]?.properties;
    if (!p) return;
    map.getCanvas().style.cursor = 'pointer';
    tooltip.style.display = 'block';
    tooltip.style.left = (e.point.x + 12) + 'px';
    tooltip.style.top  = (e.point.y + 12) + 'px';
    const score = p.score_conformite != null ? Number(p.score_conformite).toFixed(1) + ' %' : '?';
    tooltip.textContent = `Dép. ${p.dept} — ${score} · ${p.n_communes} communes`;
  });

  map.on('mouseleave', 'dept-circles', () => {
    map.getCanvas().style.cursor = '';
    tooltip.style.display = 'none';
  });

  map.on('click', 'dept-circles', (e) => {
    const p = e.features[0]?.properties;
    if (!p) return;
    const d = deptData[p.dept];
    if (!d) return;
    updateDeptPanel(d);
  });
}

// ── Vue départements ───────────────────────────────────────────────────────
function _toggleDeptView(btn) {
  activeDeptView = !activeDeptView;
  btn.classList.toggle('active', activeDeptView);

  const communeVis = activeDeptView ? 'none' : 'visible';
  const deptVis    = activeDeptView ? 'visible' : 'none';
  map.setLayoutProperty('communes-circles', 'visibility', communeVis);
  map.setLayoutProperty('dept-circles',     'visibility', deptVis);
  map.setLayoutProperty('dept-labels',      'visibility', deptVis);

  if (activeDeptView) clearPanel();
  _updateLegend();
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
  if (activeDeptView) {
    const metricLabel = activeMode === 'empreinte' ? 'Empreinte médiane' : 'Conformité médiane';
    legend.innerHTML = `
      <div class="legend-title">Vue Départements — ${metricLabel}</div>
      ${activeMode !== 'empreinte' ? `
        <div class="legend-item"><span class="dot" style="background:#2ecc71"></span><div class="legend-label">100 % — Conforme</div></div>
        <div class="legend-item"><span class="dot" style="background:#f1c40f"></span><div class="legend-label">95–99 %</div></div>
        <div class="legend-item"><span class="dot" style="background:#f39c12"></span><div class="legend-label">90–95 %</div></div>
        <div class="legend-item"><span class="dot" style="background:#e74c3c"></span><div class="legend-label">&lt; 90 %</div></div>` : `
        <div class="legend-item"><span class="dot" style="background:#374151"></span><div class="legend-label">0 molécule</div></div>
        <div class="legend-item"><span class="dot" style="background:#7e57c2"></span><div class="legend-label">1–3</div></div>
        <div class="legend-item"><span class="dot" style="background:#9c27b0"></span><div class="legend-label">4–6</div></div>
        <div class="legend-item"><span class="dot" style="background:#4a148c"></span><div class="legend-label">7+</div></div>`}`;
    return;
  }
  if (activeMode !== 'empreinte') {
    legend.innerHTML = `
      <div class="legend-title">Conformité réglementaire</div>
      <div class="legend-item"><span class="dot" style="background:#2ecc71"></span><div class="legend-label">100 % — Conforme</div></div>
      <div class="legend-item"><span class="dot" style="background:#f1c40f"></span><div class="legend-label">95–99 % — Rares</div></div>
      <div class="legend-item"><span class="dot" style="background:#f39c12"></span><div class="legend-label">90–95 % — Occasionnels</div></div>
      <div class="legend-item"><span class="dot" style="background:#e74c3c"></span><div class="legend-label">&lt; 90 % — Fréquents</div></div>
      <div class="legend-item"><span class="dot dot-nodata"></span><div class="legend-label">Sans données / fallback</div></div>`;
  } else {
    legend.innerHTML = `
      <div class="legend-title">Empreinte pesticides</div>
      <div class="legend-item"><span class="dot" style="background:#374151"></span><div class="legend-label">0 molécule</div></div>
      <div class="legend-item"><span class="dot" style="background:#7e57c2"></span><div class="legend-label">1–3</div></div>
      <div class="legend-item"><span class="dot" style="background:#9c27b0"></span><div class="legend-label">4–6</div></div>
      <div class="legend-item"><span class="dot" style="background:#6a1b9a"></span><div class="legend-label">7–10</div></div>
      <div class="legend-item"><span class="dot" style="background:#4a148c"></span><div class="legend-label">10+</div></div>
      <div class="legend-item"><span class="dot dot-nodata"></span><div class="legend-label">Sans données / fallback</div></div>`;
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
      .filter(c => !c.dept_fallback && (c.nom.toLowerCase().includes(q) || c.dept === q || c.insee.startsWith(q)))
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
    // Quitter la vue département si active
    if (activeDeptView) {
      const btn = document.getElementById('btn-dept-view');
      _toggleDeptView(btn);
    }
    _selectCommune(commune);
    if (commune.lat && commune.lon) {
      map.flyTo({ center: [commune.lon, commune.lat], zoom: 12, duration: 800 });
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-wrapper')) dropdown.hidden = true;
  });
}

// ── Boutons ────────────────────────────────────────────────────────────────
function _setupButtons() {
  document.getElementById('btn-home').addEventListener('click', () => {
    map.flyTo({ center: [2.3, 46.6], zoom: 5.5, duration: 800 });
  });

  document.getElementById('btn-locate').addEventListener('click', () => {
    navigator.geolocation?.getCurrentPosition(pos => {
      map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 11, duration: 800 });
    });
  });

  document.getElementById('btn-dept-view').addEventListener('click', function () {
    _toggleDeptView(this);
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
