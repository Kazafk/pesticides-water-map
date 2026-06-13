const LIMIT_UG_L = 0.1;

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _scoreColor(score) {
  if (score == null) return 'var(--muted)';
  if (score >= 100)  return 'var(--green)';
  if (score >= 95)   return 'var(--yellow)';
  if (score >= 90)   return 'var(--orange)';
  return 'var(--red)';
}

// ── Détail molécule ────────────────────────────────────────────────────────
function _moleculeDetail(mol) {
  if (!mol || mol.n === 0) return '<div class="chart-stats">Aucune mesure disponible</div>';

  const score = 100 * (mol.n - mol.depassements) / mol.n;
  const color = _scoreColor(score);
  const breach = mol.max_ug_l > LIMIT_UG_L;

  return `
    <div class="chart-wrap">
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div>
          <div style="font-size:20px;font-weight:bold;color:${color}">${score.toFixed(1)} %</div>
          <div style="color:var(--muted);font-size:10px">conformité</div>
        </div>
        <div>
          <div style="font-size:16px;font-weight:bold;color:${breach ? 'var(--red)' : 'var(--text)'}">
            ${mol.max_ug_l.toFixed(4)} µg/L
          </div>
          <div style="color:var(--muted);font-size:10px">max mesuré ${breach ? '⚠ &gt; ' + LIMIT_UG_L : '≤ ' + LIMIT_UG_L}</div>
        </div>
        <div>
          <div style="font-size:16px">${mol.n}</div>
          <div style="color:var(--muted);font-size:10px">prélèvements</div>
        </div>
      </div>
    </div>`;
}

// ── Tab Conformité ─────────────────────────────────────────────────────────
function _renderConformite(commune, activeMol) {
  const { score_conformite: score, n_depassements, n_prelevements, molecules } = commune;
  const scoreStr   = score != null ? score.toFixed(1) + ' %' : '—';
  const scoreColor = _scoreColor(score);

  const molEntries = Object.entries(molecules || {});
  const pills = molEntries.map(([code, mol]) => {
    const hasBreach = mol.depassements > 0;
    const isActive  = code === activeMol;
    const cls = ['season-pill', hasBreach ? 'breach' : '', isActive ? 'active' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-code="${code}">${_esc(mol.label)}</button>`;
  }).join('');

  const activeMolData = activeMol ? molecules?.[activeMol] : null;
  const chart = activeMolData ? _moleculeDetail(activeMolData) : '';

  return `
    <div style="margin-bottom:10px">
      <div class="panel-score-big" style="color:${scoreColor}">${_esc(scoreStr)}</div>
      <div style="color:var(--muted);font-size:11px">
        ${n_prelevements} prélèvement${n_prelevements !== 1 ? 's' : ''}
        · ${n_depassements} dépassement${n_depassements !== 1 ? 's' : ''}
      </div>
    </div>
    ${molEntries.length > 0
      ? `<div class="season-pills">${pills}</div>${chart}`
      : '<div style="color:var(--muted);font-size:11px">Aucune molécule prioritaire mesurée</div>'
    }`;
}

// ── Tab Empreinte ──────────────────────────────────────────────────────────
function _renderEmpreinte(commune) {
  const { n_molecules_detected, molecules } = commune;
  const molEntries = Object.entries(molecules || {});

  const rows = molEntries.map(([, mol]) => {
    const breach = mol.max_ug_l > LIMIT_UG_L;
    return `<tr>
      <td>${_esc(mol.label)}</td>
      <td style="text-align:right">${mol.n}</td>
      <td style="text-align:right" class="${breach ? 'breach-cell' : 'ok-cell'}">
        ${mol.max_ug_l.toFixed(4)}${breach ? ' ⚠' : ''}
      </td>
      <td style="text-align:right;color:var(--muted)">${LIMIT_UG_L}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-bottom:10px">
      <div class="panel-score-big">${n_molecules_detected}</div>
      <div style="color:var(--muted);font-size:11px">
        molécule${n_molecules_detected !== 1 ? 's' : ''} détectée${n_molecules_detected !== 1 ? 's' : ''}
        sur ${molEntries.length} analysées
      </div>
    </div>
    ${rows
      ? `<table class="molecule-table">
          <thead><tr><th>Molécule</th><th>Mes.</th><th>Max µg/L</th><th>Seuil</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : '<div style="color:var(--muted);font-size:11px">Aucune molécule prioritaire mesurée</div>'
    }`;
}

// ── State module ───────────────────────────────────────────────────────────
let _activeTab = 'conformite';
let _activeMol = null;
let _currentCommune = null;
let _onMoleculeSelect = null;

export function updatePanel(commune, { onMoleculeSelect } = {}) {
  _activeTab = 'conformite';
  _activeMol = null;
  _currentCommune = commune;
  _onMoleculeSelect = onMoleculeSelect ?? null;

  const el    = document.getElementById('panel-content');
  const empty = document.getElementById('panel-empty');
  el.hidden    = false;
  empty.hidden = true;

  const panel = document.getElementById('panel');
  if (!panel.classList.contains('sheet-half') && !panel.classList.contains('sheet-full')) {
    panel.classList.add('sheet-half');
  }

  _render();
}

export function clearPanel() {
  document.getElementById('panel-content').hidden = true;
  document.getElementById('panel-empty').hidden   = false;
  _currentCommune = null;
}

function _render() {
  if (!_currentCommune) return;
  const commune = _currentCommune;
  const el = document.getElementById('panel-content');
  const { nom, dept, last_date, dept_fallback, n_prelevements } = commune;

  const lastDateStr = last_date
    ? new Date(last_date).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
    : '—';

  const fallbackNote = dept_fallback
    ? `<div class="panel-fallback-note">ℹ Aucune mesure communale disponible — données agrégées au département ${_esc(dept)}.</div>`
    : '';

  el.innerHTML = `
    <div style="margin-bottom:12px">
      <div class="panel-commune-name">${_esc(nom)}</div>
      <div class="panel-commune-sub">
        Dép. ${_esc(dept)} · ${n_prelevements} prélèvement${n_prelevements !== 1 ? 's' : ''} · ${lastDateStr}
        ${dept_fallback ? '· <em>données département</em>' : ''}
      </div>
      ${fallbackNote}
    </div>

    <div class="panel-tabs">
      <button class="panel-tab${_activeTab === 'conformite' ? ' active' : ''}" data-tab="conformite">Conformité</button>
      <button class="panel-tab${_activeTab === 'empreinte'  ? ' active' : ''}" data-tab="empreinte">Empreinte</button>
    </div>

    <div id="tab-conformite" ${_activeTab !== 'conformite' ? 'hidden' : ''}>${_renderConformite(commune, _activeMol)}</div>
    <div id="tab-empreinte"  ${_activeTab !== 'empreinte'  ? 'hidden' : ''}>${_renderEmpreinte(commune)}</div>
  `;

  el.querySelectorAll('.panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      el.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      el.querySelector('#tab-conformite').hidden = _activeTab !== 'conformite';
      el.querySelector('#tab-empreinte').hidden  = _activeTab !== 'empreinte';
    });
  });

  el.querySelectorAll('.season-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const code = pill.dataset.code;
      _activeMol = _activeMol === code ? null : code;
      _onMoleculeSelect?.(_activeMol);
      _render();
    });
  });
}
