const LIMIT_UG_L = 0.1;

// Métadonnées réglementaires par code SANDRE
// danger: 3=haute préoccupation, 2=modérée, 1=sous surveillance
// url: fiche PubChem (NIH) — source ouverte et stable
const MOLECULE_META = {
  "1107": { danger: 3, note: "Interdit UE 2004 · perturbateur endocrinien avéré", url: "https://pubchem.ncbi.nlm.nih.gov/compound/2256" },
  "1108": { danger: 2, note: "Métabolite atrazine · activité perturbatrice endocrinienne", url: "https://pubchem.ncbi.nlm.nih.gov/compound/27681" },
  "1113": { danger: 1, note: "Autorisé · faible toxicité relative", url: "https://pubchem.ncbi.nlm.nih.gov/compound/2327" },
  "1129": { danger: 3, note: "Interdit UE 2010 · mutagène · reprotoxique Cat. 1B", url: "https://pubchem.ncbi.nlm.nih.gov/compound/25429" },
  "1177": { danger: 2, note: "Cancérogène suspecté · reprotoxique Cat. 2", url: "https://pubchem.ncbi.nlm.nih.gov/compound/3120" },
  "1208": { danger: 2, note: "Interdit UE 2016 · reprotoxique suspecté", url: "https://pubchem.ncbi.nlm.nih.gov/compound/39214" },
  "1209": { danger: 3, note: "Interdit UE 2017 · perturbateur endocrinien", url: "https://pubchem.ncbi.nlm.nih.gov/compound/4084" },
  "1473": { danger: 3, note: "Interdit UE 2019 · cancérogène probable Cat. 2", url: "https://pubchem.ncbi.nlm.nih.gov/compound/15217" },
  "1506": { danger: 2, note: "Cancérogène probable CIRC groupe 2A", url: "https://pubchem.ncbi.nlm.nih.gov/compound/3496" },
  "1667": { danger: 1, note: "Usage restreint · hépatotoxique", url: "https://pubchem.ncbi.nlm.nih.gov/compound/34656" },
  "1877": { danger: 2, note: "Néonicotinoïde · interdit en plein air UE 2018 · toxique pollinisateurs", url: "https://pubchem.ncbi.nlm.nih.gov/compound/86418" },
  "1907": { danger: 2, note: "Métabolite principal du glyphosate · persistant dans les eaux", url: "https://pubchem.ncbi.nlm.nih.gov/compound/70289" },
  "2974": { danger: 2, note: "Cancérogène suspecté · métabolites persistants dans les eaux souterraines", url: "https://pubchem.ncbi.nlm.nih.gov/compound/77295" },
  "6894": { danger: 1, note: "Métabolite métazachlore · sous surveillance réglementaire", url: "https://pubchem.ncbi.nlm.nih.gov/compound/91701" },
  "6895": { danger: 1, note: "Métabolite métazachlore · sous surveillance réglementaire", url: "https://pubchem.ncbi.nlm.nih.gov/compound/91701" },
  "7717": { danger: 3, note: "Métabolite chlorothalonil · mêmes préoccupations cancérogènes", url: "https://pubchem.ncbi.nlm.nih.gov/compound/15217" },
  "8865": { danger: 3, note: "Métabolite chlorothalonil · mêmes préoccupations cancérogènes", url: "https://pubchem.ncbi.nlm.nih.gov/compound/15217" },
};

const DANGER_CONFIG = {
  3: { label: "Haute préoccupation", color: "var(--red)" },
  2: { label: "Préoccupation modérée", color: "var(--orange)" },
  1: { label: "Sous surveillance", color: "var(--yellow)" },
};

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

// ── Concentration max vs seuil réglementaire ──────────────────────────────
function _maxVsSeuil(maxUgL) {
  // max_ug_l arrondi à 4 décimales : si 0, la vraie valeur est < 0.00005 µg/L
  if (maxUgL === 0) {
    return `&lt;&nbsp;0,0001&nbsp;µg/L`
      + ` <span class="mol-vs-seuil mol-vs-ok">(&lt;&nbsp;0,1&nbsp;% du seuil)</span>`;
  }
  const pct = (maxUgL / LIMIT_UG_L) * 100;
  if (maxUgL <= LIMIT_UG_L) {
    return `max&nbsp;${maxUgL.toFixed(4)}&nbsp;µg/L`
      + ` <span class="mol-vs-seuil mol-vs-ok">(${pct.toFixed(1)}&nbsp;% du seuil)</span>`;
  }
  const ratio = maxUgL / LIMIT_UG_L;
  return `max&nbsp;${maxUgL.toFixed(4)}&nbsp;µg/L`
    + ` <span class="mol-vs-seuil mol-vs-breach">(${ratio.toFixed(1)}×&nbsp;le seuil)</span>`;
}

// ── Liste molécules groupée par niveau de danger ───────────────────────────
function _sortedMolEntries(molEntries) {
  return molEntries.slice().sort(([codeA], [codeB]) => {
    const da = MOLECULE_META[codeA]?.danger ?? 1;
    const db = MOLECULE_META[codeB]?.danger ?? 1;
    if (db !== da) return db - da;
    return (MOLECULE_META[codeA]?.label ?? codeA).localeCompare(MOLECULE_META[codeB]?.label ?? codeB, 'fr');
  });
}

function _renderMoleculeList(molEntries, activeMol, clickable) {
  if (molEntries.length === 0) {
    return '<div style="color:var(--muted);font-size:11px;padding:8px 0">Aucune molécule prioritaire mesurée</div>';
  }

  const sorted = _sortedMolEntries(molEntries);

  // Grouper par niveau de danger
  const groups = {};
  for (const entry of sorted) {
    const d = MOLECULE_META[entry[0]]?.danger ?? 1;
    (groups[d] = groups[d] ?? []).push(entry);
  }

  return [3, 2, 1].filter(d => groups[d]).map(d => {
    const cfg = DANGER_CONFIG[d];
    const rows = groups[d].map(([code, mol]) => {
      const meta    = MOLECULE_META[code] ?? {};
      const isActive = clickable && code === activeMol;
      const breach   = mol.max_ug_l > LIMIT_UG_L;
      const maxStr   = _maxVsSeuil(mol.max_ug_l);
      const depStr   = breach
        ? `<span class="mol-breach-badge">⚠ ${mol.depassements} dép.</span>`
        : '';
      const link = meta.url
        ? `<a href="${_esc(meta.url)}" target="_blank" rel="noopener" class="mol-ext-link"
              title="Fiche PubChem (NIH)" onclick="event.stopPropagation()">↗ fiche</a>`
        : '';
      const codeAttr = clickable ? ` data-code="${code}"` : '';
      return `
        <div class="mol-row${isActive ? ' mol-row-active' : ''}${breach ? ' mol-row-breach' : ''}" ${codeAttr}>
          <div class="mol-danger-dot" style="color:${cfg.color}">●</div>
          <div class="mol-row-body">
            <div class="mol-row-top">
              <span class="mol-name">${_esc(mol.label)}</span>
              ${link}
            </div>
            <div class="mol-note">${_esc(meta.note ?? '')}</div>
            <div class="mol-stats">${mol.n} prélèv. · ${maxStr} ${depStr}</div>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="mol-group">
        <div class="mol-group-header" style="color:${cfg.color}">${cfg.label}</div>
        ${rows}
      </div>`;
  }).join('');
}

// ── Détail molécule sélectionnée ───────────────────────────────────────────
function _moleculeDetail(mol) {
  if (!mol || mol.n === 0) return '';
  const score  = 100 * (mol.n - mol.depassements) / mol.n;
  const color  = _scoreColor(score);
  const breach = mol.max_ug_l > LIMIT_UG_L;
  return `
    <div class="mol-detail-box">
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div>
          <div style="font-size:20px;font-weight:bold;color:${color}">${score.toFixed(1)} %</div>
          <div style="color:var(--muted);font-size:10px">conformité</div>
        </div>
        <div>
          <div style="font-size:16px;font-weight:bold;color:${breach ? 'var(--red)' : 'var(--text)'}">
            ${mol.max_ug_l === 0 ? '&lt;&nbsp;0,0001' : mol.max_ug_l.toFixed(4)} µg/L
          </div>
          <div style="color:var(--muted);font-size:10px">
            max mesuré · seuil&nbsp;${LIMIT_UG_L}&nbsp;µg/L
            ${breach
              ? `<span style="color:var(--red)">⚠ ${(mol.max_ug_l / LIMIT_UG_L).toFixed(1)}×</span>`
              : `<span style="color:var(--green)">${((mol.max_ug_l / LIMIT_UG_L) * 100).toFixed(1)}&nbsp;%</span>`
            }
          </div>
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
  const activeMolData = activeMol ? molecules?.[activeMol] : null;

  return `
    <div style="margin-bottom:10px">
      <div class="panel-score-big" style="color:${scoreColor}">${_esc(scoreStr)}</div>
      <div style="color:var(--muted);font-size:11px">
        ${n_prelevements} prélèvement${n_prelevements !== 1 ? 's' : ''}
        · ${n_depassements} dépassement${n_depassements !== 1 ? 's' : ''}
      </div>
    </div>
    ${molEntries.length > 0
      ? `<div style="font-size:10px;color:var(--muted);margin-bottom:4px">
           Cliquez une molécule pour recolorer la carte
         </div>
         <div class="mol-list">${_renderMoleculeList(molEntries, activeMol, true)}</div>
         ${activeMolData ? `<div style="font-size:11px;color:var(--muted);margin:8px 0 4px">${_esc(activeMolData.label)}</div>${_moleculeDetail(activeMolData)}` : ''}`
      : '<div style="color:var(--muted);font-size:11px">Aucune molécule prioritaire mesurée</div>'
    }`;
}

// ── Tab Empreinte ──────────────────────────────────────────────────────────
function _renderEmpreinte(commune) {
  const { n_molecules_detected, molecules } = commune;
  const molEntries = Object.entries(molecules || {});

  return `
    <div style="margin-bottom:10px">
      <div class="panel-score-big">${n_molecules_detected}</div>
      <div style="color:var(--muted);font-size:11px">
        molécule${n_molecules_detected !== 1 ? 's' : ''} détectée${n_molecules_detected !== 1 ? 's' : ''}
        sur ${molEntries.length} analysées
      </div>
    </div>
    ${molEntries.length > 0
      ? `<div class="mol-list">${_renderMoleculeList(molEntries, null, false)}</div>`
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

// ── Panel département ──────────────────────────────────────────────────────
export function updateDeptPanel(dept) {
  _currentCommune = null;
  const el    = document.getElementById('panel-content');
  const empty = document.getElementById('panel-empty');
  el.hidden    = false;
  empty.hidden = true;

  const panel = document.getElementById('panel');
  if (!panel.classList.contains('sheet-half') && !panel.classList.contains('sheet-full')) {
    panel.classList.add('sheet-half');
  }

  const conformiteStr = dept.score_conformite != null
    ? dept.score_conformite.toFixed(1) + ' %' : '—';
  const conformiteColor = dept.score_conformite == null ? 'var(--muted)'
    : dept.score_conformite >= 100 ? 'var(--green)'
    : dept.score_conformite >= 95  ? 'var(--yellow)'
    : dept.score_conformite >= 90  ? 'var(--orange)'
    : 'var(--red)';

  const topMolHtml = dept.top_molecules?.length
    ? dept.top_molecules.map(m => {
        const meta = MOLECULE_META[m.code];
        const dangerColor = meta ? DANGER_CONFIG[meta.danger]?.color : 'var(--muted)';
        return `<div style="display:flex;align-items:baseline;gap:8px;padding:3px 0;border-bottom:1px solid var(--border)">
          <span style="color:${dangerColor};font-size:10px">●</span>
          <span style="font-size:11px;flex:1">${_esc(m.label)}</span>
          <span style="color:var(--muted);font-size:10px">${m.count} communes</span>
          ${m.depassements > 0 ? `<span style="color:var(--red);font-size:10px">⚠ ${m.depassements}</span>` : ''}
        </div>`;
      }).join('')
    : '<div style="color:var(--muted);font-size:11px">Aucune donnée</div>';

  el.innerHTML = `
    <div style="margin-bottom:12px">
      <div class="panel-commune-name">Département ${_esc(dept.dept)}</div>
      <div class="panel-commune-sub">${dept.n_communes} communes avec mesures · ${dept.n_communes_total} total</div>
    </div>

    <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap">
      <div>
        <div class="panel-score-big" style="color:${conformiteColor}">${conformiteStr}</div>
        <div style="color:var(--muted);font-size:10px">conformité médiane</div>
      </div>
      <div>
        <div class="panel-score-big">${dept.n_molecules_detected ?? '—'}</div>
        <div style="color:var(--muted);font-size:10px">molécules médiane</div>
      </div>
    </div>

    <div style="display:flex;gap:16px;margin-bottom:14px;font-size:11px;color:var(--muted)">
      <div>${dept.n_prelevements.toLocaleString('fr-FR')} prélèvements</div>
      <div>${dept.n_depassements.toLocaleString('fr-FR')} dépassements</div>
    </div>

    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">
      Top 5 molécules détectées
    </div>
    ${topMolHtml}
  `;
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

  // Molécules cliquables dans l'onglet conformité
  el.querySelectorAll('.mol-row[data-code]').forEach(row => {
    row.addEventListener('click', () => {
      const code = row.dataset.code;
      _activeMol = _activeMol === code ? null : code;
      _onMoleculeSelect?.(_activeMol);
      _render();
    });
  });
}
