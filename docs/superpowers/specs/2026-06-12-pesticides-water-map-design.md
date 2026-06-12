# Pesticides Water Map — Spec Design

**Date :** 2026-06-12  
**Statut :** Validé — prêt pour implémentation  
**Repo cible :** `pesticides-water-map` (nouveau repo GitHub public)  
**Référence :** SCA Water Map (`kazafk/sca-water-map`) — même squelette architectural

---

## 1. Objectif

Carte interactive de la présence de pesticides dans l'eau du robinet en France, commune par commune, sur les 3 dernières années.

Deux lectures complémentaires exposées via un toggle :

- **Conformité réglementaire** — % de prélèvements sans dépassement du seuil légal (0,1 µg/L par molécule)
- **Empreinte pesticides** — nombre de molécules différentes détectées (même sous le seuil)

Un sélecteur de molécule permet de recolorer la carte et d'explorer le détail d'une molécule spécifique.

---

## 2. Source de données

**Dataset :** Résultats du contrôle sanitaire de l'eau distribuée commune par commune  
**Producteur :** Ministère des Solidarités et de la Santé  
**URL data.gouv.fr :** `https://www.data.gouv.fr/datasets/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune`  
**Dataset ID :** `5cf8d9ed8b4c4110294c841d`

**Fichiers utilisés (3 ans glissants + partiel année courante) :**

| Fichier | Taille | Resource ID | Usage |
|---------|--------|-------------|-------|
| `dis-2026.zip` | 84,7 MB | `2ac3eaa3-7525-4919-8592-7815a868d844` | données communales 2026 (partiel) |
| `dis-2025.zip` | 276,7 MB | `7e38c236-dd3c-455e-a728-f0ecb84b1a7c` | données communales 2025 |
| `dis-2024.zip` | 274,9 MB | `a631e486-c790-42d0-8368-6a42b1a3dc1d` | données communales 2024 |
| `dis-2023.zip` | 278,4 MB | `c89dec4a-d985-447c-a102-75ba814c398e` | données communales 2023 |

**Seuil réglementaire :** 0,1 µg/L par molécule de pesticide (directive eau potable).

---

## 3. Molécules prioritaires

Liste fixe de 15 molécules. Les codes SANDRE exacts sont à vérifier dans les données réelles lors de l'implémentation (les codes ci-dessous sont des estimations — vérifier via `libelle_parametre` dans les CSVs).

```python
PESTICIDE_CODES = {
    "1506": "Glyphosate",
    "1742": "AMPA",
    "1107": "Atrazine",
    "1212": "Métolachlore-S",
    "1467": "Chlorothalonil",
    "1155": "Diuron",
    "1173": "Isoproturon",
    "1260": "Oxadiazon",
    "2892": "Métazachlore",
    "5559": "Chlorothalonil-R",
    "1459": "Bentazone",
    "1192": "Linuron",
    "1114": "Carbendazime",
    "1560": "Imidaclopride",
    "1497": "Tébuconazole",
}
LIMIT_UG_L = 0.1
```

**Note implémentation :** la première tâche du pipeline est de vérifier ces codes en inspectant un échantillon du CSV 2025 et de les corriger si nécessaire.

---

## 4. Modèle de données — `communes-pesticides.json`

```json
{
  "generated_at": "2026-06-12T06:00:00Z",
  "years": [2023, 2024, 2025],
  "communes": [
    {
      "insee": "38185",
      "nom": "Grenoble",
      "dept": "38",
      "lat": 45.188,
      "lon": 5.724,
      "dept_fallback": false,
      "n_prelevements": 45,
      "n_depassements": 1,
      "score_conformite": 97.8,
      "n_molecules_detected": 5,
      "last_date": "2025-09-12",
      "molecules": {
        "1506": { "label": "Glyphosate", "n": 12, "depassements": 0, "max_ug_l": 0.04 },
        "1742": { "label": "AMPA",       "n": 12, "depassements": 1, "max_ug_l": 0.14 },
        "1107": { "label": "Atrazine",   "n":  8, "depassements": 0, "max_ug_l": 0.02 }
      }
    }
  ]
}
```

**Champs :**

| Champ | Type | Description |
|-------|------|-------------|
| `score_conformite` | float 0–100 | % prélèvements sans aucun dépassement (toutes molécules) |
| `n_molecules_detected` | int | nb molécules avec au moins 1 mesure > 0 sur 3 ans |
| `n_depassements` | int | nb prélèvements avec au moins 1 dépassement de 0,1 µg/L |
| `dept_fallback` | bool | true = données agrégées département, pas de mesures communales |
| `molecules` | object | détail par molécule de la liste fixe (si présente dans les données) |

**Fallback département :** si une commune n'a aucun prélèvement sur 3 ans, elle hérite de la médiane des scores de son département. `dept_fallback: true`.

---

## 5. Architecture

```
pesticides-water-map/
├── pipeline/
│   ├── download_data.py          # télécharge/met en cache les ZIPs
│   ├── compute_pesticides.py     # parse CSVs, calcule scores, écrit le JSON
│   └── requirements.txt          # requests
├── public/
│   ├── index.html
│   ├── map.js                    # Leaflet + toggle modes + recherche commune
│   ├── panel.js                  # panel latéral (desktop) + bottom sheet (mobile)
│   ├── style.css
│   └── communes-pesticides.json  # généré par le pipeline, ~5–15 MB
├── .github/
│   └── workflows/
│       └── update-data.yml       # GitHub Action hebdomadaire
├── data/
│   └── raw/                      # ZIPs téléchargés en local (gitignored)
└── docs/
    └── superpowers/specs/
        └── 2026-06-12-pesticides-water-map-design.md
```

**`data/raw/`** dans `.gitignore` — les ZIPs ne sont jamais commités.

---

## 6. Pipeline Python

### `download_data.py`

- Télécharge les 4 ZIPs depuis les URLs statiques data.gouv.fr
- Cache local : ne re-télécharge que si taille distante différente (HEAD request)
- Extrait les CSVs dans `data/raw/{year}/`

### `compute_pesticides.py`

**Étape 1 — Chargement**
- Lit les CSVs de 2023, 2024, 2025, 2026 (les 4 ZIPs téléchargés)
- Filtre sur `code_parametre in PESTICIDE_CODES`
- Colonnes utilisées : `code_commune_insee`, `code_parametre`, `resultat_numerique`, `date_prelevement`

**Étape 2 — Agrégation par commune**
```python
# Score conformité
score = 100 * (n_total - n_avec_depassement) / n_total

# Empreinte
n_detected = len({code for code, rows in by_molecule.items()
                  if any(r > 0 for r in rows)})
```

**Étape 3 — Fallback département**
- Communes sans mesures → médiane du département pour `score_conformite` et `n_molecules_detected`
- `dept_fallback: true`

**Étape 4 — Coordonnées géographiques**
- Même approche que SCA : table INSEE → lat/lon intégrée ou API géo.api.gouv.fr

**Étape 5 — Écriture**
- Tri par insee, écriture `public/communes-pesticides.json`

---

## 7. Interface utilisateur

### Carte

- **Fond de carte** : même tile sombre que SCA (ou variante claire selon palette choisie)
- **Toggle global** : `[ Conformité % ] [ Empreinte ]` — visible en permanence en haut à gauche
- **Légende dynamique** selon le mode :
  - Conformité : `■ 100 % ■ 95–99 % ■ 90–95 % ■ < 90 %` (vert → rouge)
  - Empreinte : `■ 0 ■ 1–3 ■ 4–6 ■ 7–10 ■ 10+ molécules` (blanc → violet)
- **Commune fallback** : même couleur mais cercle hachuré (CSS `stroke-dasharray`)
- **Recherche** : barre de recherche commune (même pattern SCA)

### Panel commune (desktop latéral, mobile bottom sheet)

```
GRENOBLE (38)                      97,8 % ✓
45 prélèvements · 2023–2025 · données communales

════ Conformité ════════════════════════════
Score global : 97,8 %  (1 dépassement sur 45)

[pills] Glyphosate | AMPA | Atrazine | Métolachlore | …

→ pill active : graphique temporel de la molécule
  (même composant que SCA — agrégation mensuelle, médiane)

════ Empreinte ═════════════════════════════
5 molécules détectées sur 15 analysées

Molécule        Mesures  Max mesuré  Seuil
Glyphosate        12      0,04 µg/L   0,1
AMPA              12      0,14 µg/L ⚠ 0,1
Atrazine           8      0,02 µg/L   0,1
```

**Indicateur fallback** dans le panel (si `dept_fallback: true`) :
> *ℹ Aucune mesure communale disponible — données agrégées au niveau du département.*

### Sélection molécule → recoloration carte

Quand une pill est active dans le panel, la carte recolore selon le score de conformité de cette molécule uniquement (score calculé côté client depuis `molecules[code]`).

---

## 8. GitHub Action

```yaml
name: Update pesticides data
on:
  schedule:
    - cron: '0 6 * * 1'   # lundi 6h UTC
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install requests
      - run: python pipeline/download_data.py
      - run: python pipeline/compute_pesticides.py
      - name: Deploy to gh-pages
        run: |
          git config user.email "action@github.com"
          git config user.name "GitHub Action"
          git worktree add .ghp gh-pages
          cp public/communes-pesticides.json .ghp/
          cd .ghp
          git add communes-pesticides.json
          git commit -m "data: update $(date -u +%Y-%m-%d)" || echo "No changes"
          git push origin gh-pages
```

**Durée estimée :** 5–10 min (téléchargement ~800 MB + traitement CSV).  
**Espace disque runner :** 14 GB disponibles — pas de contrainte.

---

## 9. Repo GitHub

- **Nom :** `pesticides-water-map`
- **Visibilité :** public
- **GitHub Pages :** branch `gh-pages`, dossier racine
- **Créer lors de l'implémentation** avec `gh repo create`

---

## 10. Ce qui n'est pas dans ce spec

- Authentification / backend — hors scope (100 % statique)
- Téléchargement des données par l'utilisateur — hors scope
- Comparaison entre communes — hors scope
- Historique avant 2023 — hors scope (3 ans glissants seulement)
