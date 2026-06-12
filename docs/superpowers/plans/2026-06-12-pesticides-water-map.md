# Pesticides Water Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carte interactive des pesticides dans l'eau du robinet en France — score de conformité réglementaire + empreinte (nb molécules détectées), commune par commune, depuis les ZIPs data.gouv.fr.

**Architecture:** Pipeline Python télécharge 4 ZIPs annuels (2023–2026) du Ministère Santé, parse les CSVs, calcule deux scores par commune (conformité + empreinte), écrit `communes-pesticides.json`. Front-end statique MapLibre GL avec toggle double-mode et panel commune. Déployé sur GitHub Pages via Action hebdomadaire.

**Tech Stack:** Python 3.12 + requests (pipeline), MapLibre GL 4 (carte), Vanilla JS ES modules (front), GitHub Pages (hébergement), pytest (tests pipeline).

---

## File Map

```
pesticides-water-map/
├── pipeline/
│   ├── download_data.py      # Tâche 2 — télécharge/extrait les 4 ZIPs
│   ├── compute_pesticides.py # Tâche 3 — calcule scores, écrit JSON
│   └── requirements.txt      # requests, pytest
├── tests/
│   └── test_compute.py       # Tâche 3 — tests des fonctions de calcul
├── public/
│   ├── index.html            # Tâche 4 — shell HTML
│   ├── style.css             # Tâche 4 — styles (dark theme, toggle, légende)
│   ├── map.js                # Tâche 5 — MapLibre + toggle + search + events
│   ├── panel.js              # Tâche 6 — panel commune + pills + chart
│   └── communes-pesticides.json  # généré par pipeline
├── .github/workflows/
│   └── update-data.yml       # Tâche 7 — GitHub Action hebdomadaire
├── data/raw/                 # gitignored — ZIPs et CSVs extraits
├── .gitignore
└── README.md
```

---

## Task 1 — Scaffolding du projet

**Files:**
- Create: `.gitignore`
- Create: `pipeline/requirements.txt`
- Create: `data/.gitkeep`
- Create: `public/.gitkeep`

- [ ] **Créer .gitignore**

```
data/raw/
__pycache__/
*.pyc
.pytest_cache/
*.egg-info/
.env
```

- [ ] **Créer pipeline/requirements.txt**

```
requests
pytest
```

- [ ] **Créer les dossiers vides nécessaires**

```bash
mkdir -p data/raw pipeline tests public .github/workflows
touch data/.gitkeep public/.gitkeep
```

- [ ] **Commiter le scaffolding**

```bash
git add .gitignore pipeline/requirements.txt data/.gitkeep public/.gitkeep
git commit -m "chore: scaffolding projet pesticides-water-map"
```

---

## Task 2 — Inspection du format CSV + vérification codes SANDRE

**Files:**
- Create: `pipeline/inspect_csv.py` (script ponctuel, supprimé après usage)

**Contexte :** Les noms de colonnes dans les ZIPs Ministère Santé peuvent différer des noms de l'API Hub'Eau. Cette tâche télécharge un échantillon du ZIP 2025 et inspecte les colonnes réelles.

- [ ] **Créer pipeline/inspect_csv.py**

```python
"""Script one-shot pour inspecter le format CSV du dataset Ministère Santé."""
import io, zipfile, requests, csv

URL_2025 = "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20260422-070223/dis-2025.zip"

# Codes SANDRE candidats à vérifier (estimations — à corriger selon résultats)
CANDIDATE_CODES = {
    "1506", "1742", "1107", "1212", "1467",
    "1155", "1173", "1260", "2892", "5559",
    "1459", "1192", "1114", "1560", "1497",
}

print("Téléchargement partiel du ZIP 2025 (premiers 5 MB)...")
headers = {"Range": "bytes=0-5000000"}
r = requests.get(URL_2025, headers=headers, timeout=60)
print(f"  HTTP {r.status_code}, {len(r.content)} bytes reçus")

# Essai direct d'un ZIP partiel (peut échouer selon structure)
try:
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        names = z.namelist()
        print(f"Fichiers dans le ZIP: {names[:5]}")
        # Lire le premier CSV
        csv_name = next((n for n in names if n.endswith('.csv')), None)
        if csv_name:
            with z.open(csv_name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding='utf-8', errors='replace'), delimiter=';')
                cols = reader.fieldnames
                print(f"\nColonnes CSV ({len(cols)}): {cols}")
                rows = [next(reader) for _ in range(5)]
                print(f"\nExemple de lignes:")
                for row in rows:
                    print(dict(row))
                
                # Chercher les codes pesticides
                code_col = next((c for c in cols if 'param' in c.lower() and 'code' in c.lower()), None)
                print(f"\nColonne code parametre identifiée: {code_col}")
except Exception as e:
    print(f"ZIP partiel non lisible ({e}) — télécharger le ZIP complet localement d'abord")
    print("Exécuter: python pipeline/download_data.py --year 2025 puis relancer ce script")
```

- [ ] **Exécuter l'inspection (nécessite téléchargement préalable si ZIP partiel échoue)**

```bash
cd pesticides-water-map
pip install requests
python pipeline/inspect_csv.py
```

Résultat attendu : liste des colonnes CSV et 5 exemples de lignes.

- [ ] **Noter les résultats réels dans un commentaire en haut de compute_pesticides.py**

En particulier :
- Nom exact de la colonne code INSEE commune (ex: `code_commune_insee`, `inseecommune`, `codecommune`)
- Nom exact de la colonne code paramètre (ex: `code_parametre`, `codeparametre`)
- Nom exact de la colonne résultat numérique (ex: `resultat_numerique`, `resultatnumerique`, `valtexte`)
- Nom exact de la colonne date prélèvement (ex: `date_prelevement`, `dateprelevement`)
- Séparateur CSV (`;` ou `,`)
- Encodage (UTF-8 ou Latin-1)

- [ ] **Vérifier les codes SANDRE pesticides réels**

Parcourir les lignes du CSV, regrouper par `libelle_parametre` (ou équivalent), chercher les pesticides.
Les codes ci-dessous sont des estimations — les corriger si l'inspection révèle des différences :

```
1107 → Atrazine           (très répandu, présence historique)
1742 → AMPA               (métabolite glyphosate)
1506 → Glyphosate
1212 → Métolachlore-S     (à vérifier — peut être 2987 ou autre)
1467 → Chlorothalonil     (à vérifier)
1155 → Diuron
1173 → Isoproturon
1260 → Oxadiazon          (à vérifier)
2892 → Métazachlore
5559 → Chlorothalonil-R   (métabolite, à vérifier)
1459 → Bentazone
1192 → Linuron
1114 → Carbendazime
1560 → Imidaclopride
1497 → Tébuconazole
```

- [ ] **Supprimer le script d'inspection une fois les colonnes notées**

```bash
rm pipeline/inspect_csv.py
```

---

## Task 3 — pipeline/download_data.py

**Files:**
- Create: `pipeline/download_data.py`

- [ ] **Créer pipeline/download_data.py**

```python
"""Télécharge et extrait les ZIPs annuels du contrôle sanitaire eau potable."""
import os, sys, zipfile
import requests

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(PROJECT_ROOT, "data", "raw")

# URLs des ZIPs (Resource IDs stables data.gouv.fr)
ZIPS = [
    {
        "year": 2026,
        "url": "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20260601-162255/dis-2026.zip",
        "filename": "dis-2026.zip",
    },
    {
        "year": 2025,
        "url": "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20260422-070223/dis-2025.zip",
        "filename": "dis-2025.zip",
    },
    {
        "year": 2024,
        "url": "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20260422-071620/dis-2024.zip",
        "filename": "dis-2024.zip",
    },
    {
        "year": 2023,
        "url": "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20241014-073810/dis-2023.zip",
        "filename": "dis-2023.zip",
    },
]


def _remote_size(url: str) -> int | None:
    """Retourne la taille distante via HEAD, ou None si indisponible."""
    try:
        r = requests.head(url, timeout=15, allow_redirects=True)
        cl = r.headers.get("Content-Length")
        return int(cl) if cl else None
    except Exception:
        return None


def _download(url: str, dest: str) -> None:
    """Télécharge url vers dest avec barre de progression."""
    print(f"  Téléchargement {os.path.basename(dest)}...", flush=True)
    r = requests.get(url, stream=True, timeout=300)
    r.raise_for_status()
    total = int(r.headers.get("Content-Length", 0))
    done = 0
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=1 << 20):
            f.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r    {done / 1e6:.0f} / {total / 1e6:.0f} MB", end="", flush=True)
    print()


def _extract(zip_path: str, year: int) -> str:
    """Extrait le ZIP dans data/raw/{year}/, retourne le répertoire."""
    dest_dir = os.path.join(RAW_DIR, str(year))
    os.makedirs(dest_dir, exist_ok=True)
    print(f"  Extraction vers {dest_dir}...", flush=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(dest_dir)
    print(f"  OK — {len(os.listdir(dest_dir))} fichiers", flush=True)
    return dest_dir


def download_all(force: bool = False) -> None:
    os.makedirs(RAW_DIR, exist_ok=True)
    for entry in ZIPS:
        zip_path = os.path.join(RAW_DIR, entry["filename"])
        extract_dir = os.path.join(RAW_DIR, str(entry["year"]))

        # Cache : ne re-télécharger que si taille distante différente ou absent
        if not force and os.path.exists(zip_path):
            local_size = os.path.getsize(zip_path)
            remote_size = _remote_size(entry["url"])
            if remote_size and local_size == remote_size:
                print(f"[{entry['year']}] ZIP à jour ({local_size / 1e6:.0f} MB), skip")
                if not os.path.exists(extract_dir) or not os.listdir(extract_dir):
                    _extract(zip_path, entry["year"])
                continue

        print(f"[{entry['year']}] Téléchargement...")
        _download(entry["url"], zip_path)
        _extract(zip_path, entry["year"])
        print(f"[{entry['year']}] Terminé")


if __name__ == "__main__":
    force = "--force" in sys.argv
    download_all(force=force)
    print("Tous les ZIPs téléchargés et extraits.")
```

- [ ] **Tester le téléchargement (un seul ZIP d'abord pour valider)**

Modifier temporairement ZIPS pour ne garder que l'entrée 2026 (le plus petit, 85 MB) puis :

```bash
python pipeline/download_data.py
```

Résultat attendu : `data/raw/dis-2026.zip` présent, `data/raw/2026/` contenant des CSVs.

- [ ] **Vérifier que le cache fonctionne (relancer = skip)**

```bash
python pipeline/download_data.py
```

Résultat attendu : `[2026] ZIP à jour ... skip`

- [ ] **Restaurer ZIPS complet et lancer le téléchargement des 4 années**

```bash
python pipeline/download_data.py
```

Attendre ~10 min pour les ~900 MB.

- [ ] **Commiter**

```bash
git add pipeline/download_data.py pipeline/requirements.txt
git commit -m "feat: pipeline download_data — téléchargement ZIPs avec cache"
```

---

## Task 4 — pipeline/compute_pesticides.py + tests

**Files:**
- Create: `pipeline/compute_pesticides.py`
- Create: `tests/test_compute.py`

**Note :** Adapter les constantes `COL_*` selon les résultats de l'inspection CSV (Task 2).

- [ ] **Écrire les tests en premier**

Créer `tests/test_compute.py` :

```python
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline'))
from compute_pesticides import (
    score_conformite,
    n_molecules_detected,
    dept_median_fallback,
    LIMIT_UG_L,
)


def test_score_conformite_perfect():
    # 0 dépassement sur 10 prélèvements → 100 %
    rows = [{"val": 0.05}, {"val": 0.03}, {"val": 0.0}] * 3 + [{"val": 0.01}]
    assert score_conformite(rows) == 100.0


def test_score_conformite_one_breach():
    # 1 dépassement sur 4 → 75 %
    rows = [{"val": 0.12}, {"val": 0.05}, {"val": 0.03}, {"val": 0.01}]
    assert score_conformite(rows) == pytest.approx(75.0)


def test_score_conformite_empty():
    # Aucun prélèvement → None
    assert score_conformite([]) is None


def test_score_conformite_all_breach():
    rows = [{"val": 0.15}, {"val": 0.20}]
    assert score_conformite(rows) == pytest.approx(0.0)


def test_n_molecules_detected_counts_nonzero():
    # 2 molécules avec val > 0, 1 avec val == 0
    mol_data = {
        "1506": [0.04, 0.0],   # détectée (max > 0)
        "1742": [0.0, 0.0],    # non détectée
        "1107": [0.02],        # détectée
    }
    assert n_molecules_detected(mol_data) == 2


def test_n_molecules_detected_none():
    assert n_molecules_detected({}) == 0


def test_dept_median_fallback_basic():
    communes = [
        {"dept": "38", "score_conformite": 80.0, "dept_fallback": False},
        {"dept": "38", "score_conformite": 90.0, "dept_fallback": False},
        {"dept": "38", "score_conformite": 100.0, "dept_fallback": False},
    ]
    no_data = {"insee": "38999", "dept": "38"}
    result = dept_median_fallback(no_data, communes)
    assert result["score_conformite"] == 90.0
    assert result["dept_fallback"] is True


def test_limit_ug_l():
    assert LIMIT_UG_L == 0.1
```

- [ ] **Lancer les tests (doivent échouer — module inexistant)**

```bash
cd pesticides-water-map
pip install pytest
pytest tests/test_compute.py -v
```

Résultat attendu : `ImportError: No module named 'compute_pesticides'`

- [ ] **Créer pipeline/compute_pesticides.py**

```python
"""Calcule les scores pesticides par commune depuis les CSVs extraits des ZIPs."""
import csv, io, json, os, statistics, zipfile
from datetime import datetime, timezone
import requests

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR      = os.path.join(PROJECT_ROOT, "data", "raw")
OUTPUT_FILE  = os.path.join(PROJECT_ROOT, "public", "communes-pesticides.json")

# ── Adapter ces constantes selon l'inspection CSV (Task 2) ──────────────────
# Noms de colonnes réels dans les CSVs du Ministère Santé :
COL_INSEE    = "code_commune_insee"   # code INSEE commune (5 chiffres)
COL_NOM      = "nom_commune"          # nom de la commune
COL_CODE     = "code_parametre"       # code SANDRE du paramètre
COL_RESULTAT = "resultat_numerique"   # valeur numérique (µg/L pour pesticides)
COL_DATE     = "date_prelevement"     # date de prélèvement (YYYY-MM-DD)
COL_LIBELLE  = "libelle_parametre"    # nom du paramètre (pour vérification)
CSV_SEP      = ";"                    # séparateur (vérifier lors de Task 2)
CSV_ENC      = "utf-8"               # encoding (essayer latin-1 si erreurs)
# ────────────────────────────────────────────────────────────────────────────

LIMIT_UG_L = 0.1  # seuil réglementaire unique tous pesticides (directive EU)

# Codes SANDRE pesticides prioritaires (vérifiés lors de Task 2)
PESTICIDE_CODES = {
    "1107": "Atrazine",
    "1114": "Carbendazime",
    "1155": "Diuron",
    "1173": "Isoproturon",
    "1192": "Linuron",
    "1212": "Métolachlore-S",
    "1260": "Oxadiazon",
    "1459": "Bentazone",
    "1467": "Chlorothalonil",
    "1497": "Tébuconazole",
    "1506": "Glyphosate",
    "1560": "Imidaclopride",
    "1742": "AMPA",
    "2892": "Métazachlore",
    "5559": "Chlorothalonil-R",
}

YEARS = [2023, 2024, 2025, 2026]


def _log(msg: str) -> None:
    print(msg, flush=True)


# ── Fonctions pures (testables) ─────────────────────────────────────────────

def score_conformite(rows: list[dict]) -> float | None:
    """% prélèvements sans dépassement de LIMIT_UG_L.

    rows: liste de dicts avec clé 'val' (float).
    """
    if not rows:
        return None
    n_breach = sum(1 for r in rows if r["val"] > LIMIT_UG_L)
    return round(100.0 * (len(rows) - n_breach) / len(rows), 2)


def n_molecules_detected(mol_data: dict[str, list[float]]) -> int:
    """Nb molécules avec au moins 1 mesure > 0.

    mol_data: {code: [val1, val2, ...]}
    """
    return sum(1 for vals in mol_data.values() if any(v > 0 for v in vals))


def dept_median_fallback(commune: dict, all_communes: list[dict]) -> dict:
    """Applique le fallback département sur une commune sans données.

    Retourne le dict commune enrichi avec dept_fallback=True et les médianes.
    """
    dept = commune["dept"]
    peers = [c for c in all_communes
             if c.get("dept") == dept and not c.get("dept_fallback")]

    scores = [c["score_conformite"] for c in peers if c.get("score_conformite") is not None]
    detections = [c["n_molecules_detected"] for c in peers]

    result = dict(commune)
    result["score_conformite"] = round(statistics.median(scores), 2) if scores else None
    result["n_molecules_detected"] = int(statistics.median(detections)) if detections else 0
    result["n_prelevements"] = 0
    result["n_depassements"] = 0
    result["dept_fallback"] = True
    result["molecules"] = {}
    return result


# ── Chargement des données brutes ───────────────────────────────────────────

def _iter_csv_rows(year: int):
    """Yield dicts depuis tous les CSVs de data/raw/{year}/."""
    year_dir = os.path.join(RAW_DIR, str(year))
    if not os.path.isdir(year_dir):
        _log(f"  [{year}] Répertoire absent, skip")
        return

    csv_files = [f for f in os.listdir(year_dir) if f.endswith(".csv")]
    _log(f"  [{year}] {len(csv_files)} fichier(s) CSV")

    for fname in csv_files:
        fpath = os.path.join(year_dir, fname)
        try:
            with open(fpath, encoding=CSV_ENC, errors="replace") as f:
                reader = csv.DictReader(f, delimiter=CSV_SEP)
                for row in reader:
                    yield row
        except Exception as e:
            _log(f"  [{year}] Erreur lecture {fname}: {e}")


def load_raw_data() -> dict:
    """Retourne {insee: {code: [vals], '_nom': str, '_dates': [str]}}."""
    _log("Chargement des données brutes...")
    idx: dict[str, dict] = {}
    total = 0

    for year in YEARS:
        year_total = 0
        for row in _iter_csv_rows(year):
            code_param = row.get(COL_CODE, "").strip()
            if code_param not in PESTICIDE_CODES:
                continue

            insee = row.get(COL_INSEE, "").strip()
            if not insee or len(insee) < 5:
                continue

            val_str = row.get(COL_RESULTAT, "").strip().replace(",", ".")
            try:
                val = float(val_str)
            except (ValueError, TypeError):
                continue

            nom = row.get(COL_NOM, "").strip()
            date = (row.get(COL_DATE) or "")[:10]

            if insee not in idx:
                idx[insee] = {"_nom": nom, "_dates": [], "_rows": []}
            idx[insee]["_dates"].append(date)
            idx[insee]["_rows"].append({"code": code_param, "val": val})

            if code_param not in idx[insee]:
                idx[insee][code_param] = []
            idx[insee][code_param].append(val)

            year_total += 1

        _log(f"  [{year}] {year_total} lignes pesticides chargées")
        total += year_total

    _log(f"Total: {total} mesures, {len(idx)} communes avec données")
    return idx


# ── Coordonnées géographiques ────────────────────────────────────────────────

def fetch_coordinates() -> dict[str, tuple[float, float]]:
    """Retourne {insee: (lat, lon)} depuis geo.api.gouv.fr."""
    _log("Récupération coordonnées communes...")
    url = "https://geo.api.gouv.fr/communes?fields=code,centre&format=json&geometry=centre"
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    data = r.json()
    coords = {}
    for c in data:
        code = c.get("code", "")
        centre = c.get("centre", {})
        if centre and centre.get("type") == "Point":
            lon, lat = centre["coordinates"]
            coords[code] = (round(lat, 5), round(lon, 5))
    _log(f"  {len(coords)} communes avec coordonnées")
    return coords


# ── Calcul des scores ────────────────────────────────────────────────────────

def _dept_from_insee(insee: str) -> str:
    if insee.startswith("97"):
        return insee[:3]
    return insee[:2]


def compute_all(raw: dict, coords: dict) -> list[dict]:
    """Calcule les scores pour toutes les communes avec données."""
    _log("Calcul des scores...")
    communes = []

    for insee, data in raw.items():
        rows_all = data["_rows"]
        dates = [d for d in data["_dates"] if d]

        # Score conformité global
        sc = score_conformite(rows_all)

        # Dépassements
        n_dep = sum(1 for r in rows_all if r["val"] > LIMIT_UG_L)

        # Par molécule
        mol_data = {
            code: data[code]
            for code in PESTICIDE_CODES
            if code in data
        }
        n_det = n_molecules_detected(mol_data)

        # Détail par molécule pour le panel
        molecules = {}
        for code, label in PESTICIDE_CODES.items():
            vals = data.get(code)
            if not vals:
                continue
            n_mol_dep = sum(1 for v in vals if v > LIMIT_UG_L)
            molecules[code] = {
                "label": label,
                "n": len(vals),
                "depassements": n_mol_dep,
                "max_ug_l": round(max(vals), 4),
            }

        lat, lon = coords.get(insee, (None, None))
        dept = _dept_from_insee(insee)

        communes.append({
            "insee": insee,
            "nom": data["_nom"],
            "dept": dept,
            "lat": lat,
            "lon": lon,
            "dept_fallback": False,
            "n_prelevements": len(rows_all),
            "n_depassements": n_dep,
            "score_conformite": sc,
            "n_molecules_detected": n_det,
            "last_date": max(dates) if dates else None,
            "molecules": molecules,
        })

    _log(f"  {len(communes)} communes calculées")
    return communes


def apply_fallback(communes_with_data: list[dict], coords: dict) -> list[dict]:
    """Ajoute les communes sans données avec fallback département."""
    _log("Application du fallback département...")
    have = {c["insee"] for c in communes_with_data}
    all_insees = set(coords.keys())
    missing = all_insees - have

    fallbacks = []
    for insee in missing:
        lat, lon = coords.get(insee, (None, None))
        dept = _dept_from_insee(insee)
        stub = {"insee": insee, "nom": "", "dept": dept, "lat": lat, "lon": lon}
        fb = dept_median_fallback(stub, communes_with_data)
        fallbacks.append(fb)

    _log(f"  {len(fallbacks)} communes en fallback département")
    return communes_with_data + fallbacks


# ── Point d'entrée ───────────────────────────────────────────────────────────

def main() -> None:
    raw = load_raw_data()
    coords = fetch_coordinates()
    communes = compute_all(raw, coords)
    all_communes = apply_fallback(communes, coords)
    all_communes.sort(key=lambda c: c["insee"])

    years_present = sorted({y for y in YEARS if os.path.isdir(os.path.join(RAW_DIR, str(y)))})
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "years": years_present,
        "limit_ug_l": LIMIT_UG_L,
        "communes": all_communes,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(OUTPUT_FILE) / 1e6
    _log(f"Écrit: {OUTPUT_FILE} ({size_mb:.1f} MB, {len(all_communes)} communes)")


if __name__ == "__main__":
    main()
```

- [ ] **Lancer les tests (doivent passer maintenant)**

```bash
pytest tests/test_compute.py -v
```

Résultat attendu :
```
tests/test_compute.py::test_score_conformite_perfect PASSED
tests/test_compute.py::test_score_conformite_one_breach PASSED
tests/test_compute.py::test_score_conformite_empty PASSED
tests/test_compute.py::test_score_conformite_all_breach PASSED
tests/test_compute.py::test_n_molecules_detected_counts_nonzero PASSED
tests/test_compute.py::test_n_molecules_detected_none PASSED
tests/test_compute.py::test_dept_median_fallback_basic PASSED
tests/test_compute.py::test_limit_ug_l PASSED

8 passed in ...s
```

- [ ] **Lancer le pipeline complet (nécessite data/raw/ rempli depuis Task 3)**

```bash
python pipeline/compute_pesticides.py
```

Résultat attendu : `Écrit: public/communes-pesticides.json (X.X MB, ~35000 communes)`

- [ ] **Vérifier le JSON produit**

```bash
python -c "
import json
with open('public/communes-pesticides.json') as f:
    d = json.load(f)
print('Communes:', len(d['communes']))
print('Années:', d['years'])
# Trouver une commune avec données réelles
with_data = [c for c in d['communes'] if not c['dept_fallback'] and c['n_prelevements'] > 0]
print('Avec données:', len(with_data))
print('Exemple:', json.dumps(with_data[0], indent=2, ensure_ascii=False)[:500])
"
```

Résultat attendu : commune exemple avec `score_conformite`, `n_molecules_detected`, et `molecules` non vides.

- [ ] **Commiter**

```bash
git add pipeline/compute_pesticides.py tests/test_compute.py public/communes-pesticides.json
git commit -m "feat: pipeline compute_pesticides + tests"
```

---

## Task 5 — public/index.html + style.css

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`

- [ ] **Créer public/index.html**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pesticides Water Map — Eau du robinet en France</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- Onboarding -->
  <div id="onboarding-overlay" hidden></div>
  <div id="onboarding-modal" hidden>
    <div id="onboarding-header">
      <span id="onboarding-logo">🌿</span>
      <div>
        <div id="onboarding-title">Pesticides Water Map</div>
        <div id="onboarding-sub">Pesticides dans l'eau du robinet — France</div>
      </div>
    </div>
    <p id="onboarding-intro">
      Cette carte visualise la présence de pesticides dans l'eau du robinet
      de <strong>~35 000 communes françaises</strong> sur les 3 dernières années,
      à partir des données officielles du contrôle sanitaire.
    </p>
    <div id="onboarding-scores">
      <div class="ob-score-row">
        <span class="ob-dot" style="background:var(--green)"></span>
        <div><strong>Conforme 100 %</strong> — Aucun dépassement du seuil de 0,1 µg/L</div>
      </div>
      <div class="ob-score-row">
        <span class="ob-dot" style="background:var(--yellow)"></span>
        <div><strong>Conforme 95–99 %</strong> — Dépassements rares</div>
      </div>
      <div class="ob-score-row">
        <span class="ob-dot" style="background:var(--orange)"></span>
        <div><strong>Conforme 90–95 %</strong> — Dépassements occasionnels</div>
      </div>
      <div class="ob-score-row">
        <span class="ob-dot" style="background:var(--red)"></span>
        <div><strong>Conforme &lt; 90 %</strong> — Dépassements fréquents</div>
      </div>
    </div>
    <p id="onboarding-hint">Cliquez sur une commune ou cherchez votre ville.</p>
    <div id="onboarding-actions">
      <button id="btn-onboarding-close">Commencer</button>
    </div>
  </div>

  <div id="app">
    <header id="topbar">
      <div id="brand">
        <span id="brand-title">🌿 Pesticides Water Map</span>
        <span id="brand-subtitle">Eau du robinet — France</span>
      </div>
      <div id="controls">
        <!-- Toggle mode -->
        <div id="mode-toggle">
          <button class="mode-btn active" data-mode="conformite">Conformité %</button>
          <button class="mode-btn" data-mode="empreinte">Empreinte</button>
        </div>
        <div id="search-wrapper">
          <input id="search" type="text" placeholder="🔍 Commune ou département..." autocomplete="off">
          <ul id="search-dropdown" class="search-dropdown" hidden></ul>
        </div>
        <button id="btn-home" class="btn-icon" title="Vue France entière">🏠</button>
        <button id="btn-locate" class="btn-icon" title="Me localiser">📍</button>
        <span id="data-date">Chargement…</span>
      </div>
    </header>

    <main id="main-layout">
      <div id="map-container">
        <div id="map"></div>
        <div id="map-tooltip"></div>
        <div id="legend" data-mode="conformite">
          <!-- Contenu dynamique mis à jour par map.js selon le mode -->
        </div>
      </div>
      <div id="panel">
        <div id="sheet-handle"></div>
        <div id="panel-empty">Cliquez sur une commune pour voir le détail</div>
        <div id="panel-content" hidden></div>
      </div>
    </main>
  </div>

  <script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script>
  <script type="module" src="map.js"></script>
</body>
</html>
```

- [ ] **Créer public/style.css**

```css
:root {
  --bg:      #0d1117;
  --surface: #161b22;
  --border:  #21262d;
  --text:    #c9d1d9;
  --muted:   #8b949e;
  --green:   #2ecc71;
  --yellow:  #f1c40f;
  --orange:  #f39c12;
  --red:     #e74c3c;
  --violet:  #9b59b6;
  --nodata:  #2d2d2d;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  height: 100vh;
  overflow: hidden;
}

#app { display: flex; flex-direction: column; height: 100vh; }

/* ── Topbar ─────────────────────────────────────────── */
#topbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  z-index: 10;
  flex-wrap: wrap;
  gap: 6px;
}
#brand { display: flex; align-items: center; gap: 10px; }
#brand-title    { color: var(--green); font-weight: bold; }
#brand-subtitle { color: var(--muted); font-size: 11px; }
#controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── Mode toggle ─────────────────────────────────────── */
#mode-toggle {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.mode-btn {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
  padding: 4px 10px;
  transition: background .15s, color .15s;
}
.mode-btn.active {
  background: var(--green);
  color: #000;
  font-weight: bold;
}
.mode-btn:not(.active):hover { background: var(--border); color: var(--text); }

/* ── Recherche ───────────────────────────────────────── */
#search-wrapper { position: relative; }
#search {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  padding: 4px 8px;
  font-size: 11px;
  width: 200px;
}
#search:focus { outline: none; border-color: var(--green); }
.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-top: 2px;
  list-style: none;
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}
.search-dropdown li {
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.search-dropdown li:hover { background: var(--border); }

.btn-icon {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  padding: 4px 7px;
}
.btn-icon:hover { background: var(--border); }

#data-date { color: var(--muted); font-size: 11px; }

/* ── Layout ──────────────────────────────────────────── */
#main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}
#map-container { position: relative; flex: 1; }
#map { width: 100%; height: 100%; }

/* ── Légende ─────────────────────────────────────────── */
#legend {
  position: absolute;
  bottom: 24px;
  left: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 11px;
  z-index: 5;
  min-width: 160px;
}
.legend-title { color: var(--muted); font-size: 10px; text-transform: uppercase; margin-bottom: 6px; }
.legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.dot-nodata { background: var(--nodata); border: 1px solid var(--border); }
.dot-fallback {
  background: transparent;
  border: 2px dashed var(--muted);
}
.legend-label { color: var(--text); }
.legend-sub   { color: var(--muted); font-size: 10px; }

/* ── Tooltip ─────────────────────────────────────────── */
#map-tooltip {
  position: absolute;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 11px;
  pointer-events: none;
  display: none;
  z-index: 20;
  white-space: nowrap;
}

/* ── Panel ───────────────────────────────────────────── */
#panel {
  width: 320px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
#panel-empty {
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  padding: 40px 20px;
}
#panel-content { padding: 14px; }

#sheet-handle { display: none; }

.panel-commune-name {
  font-size: 16px;
  font-weight: bold;
  color: var(--text);
}
.panel-commune-sub {
  color: var(--muted);
  font-size: 11px;
  margin-top: 2px;
  margin-bottom: 10px;
}
.panel-score-big {
  font-size: 22px;
  font-weight: bold;
  margin-bottom: 4px;
}
.panel-fallback-note {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 11px;
  padding: 6px 10px;
  margin-bottom: 10px;
}

/* ── Tabs du panel ───────────────────────────────────── */
.panel-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}
.panel-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  padding: 6px 12px;
  margin-bottom: -1px;
}
.panel-tab.active {
  border-bottom-color: var(--green);
  color: var(--text);
}

/* ── Pills molécules ─────────────────────────────────── */
.season-pills {
  display: flex;
  gap: 5px;
  padding: 8px 0 4px;
  flex-wrap: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.season-pills::-webkit-scrollbar { display: none; }
.season-pill {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
  padding: 3px 9px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: border-color .15s, color .15s;
}
.season-pill:hover { border-color: var(--green); color: var(--text); }
.season-pill.active { background: var(--green); border-color: var(--green); color: #000; font-weight: bold; }
.season-pill.breach { border-color: var(--red); }
.season-pill.breach.active { background: var(--red); border-color: var(--red); }

/* ── Tableau empreinte ───────────────────────────────── */
.molecule-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  margin-top: 8px;
}
.molecule-table th {
  color: var(--muted);
  font-weight: normal;
  padding: 4px 6px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.molecule-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.molecule-table .breach-cell { color: var(--red); font-weight: bold; }
.molecule-table .ok-cell     { color: var(--muted); }

/* ── Chart SVG ───────────────────────────────────────── */
.chart-wrap { margin: 10px 0; }
.chart-stats { color: var(--muted); font-size: 10px; margin-top: 4px; }

/* ── Raw data rows ───────────────────────────────────── */
.raw-data-row {
  display: flex;
  gap: 8px;
  font-size: 11px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
  align-items: baseline;
}
.raw-data-date { color: var(--muted); flex-shrink: 0; width: 56px; }
.raw-data-val  { font-weight: bold; flex-shrink: 0; }
.raw-data-breach { color: var(--red); }

/* ── Mobile bottom sheet ─────────────────────────────── */
@media (max-width: 700px) {
  #main-layout { flex-direction: column; position: relative; }
  #panel {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    width: 100%;
    height: 44px;
    border-left: none;
    border-top: 1px solid var(--border);
    border-radius: 14px 14px 0 0;
    overflow: hidden;
    transition: height .3s ease;
    z-index: 30;
  }
  #panel.sheet-half { height: 50vh; }
  #panel.sheet-full { height: 92vh; }
  #sheet-handle {
    display: block;
    width: 36px; height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 8px auto 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  #panel-content { overflow-y: auto; flex: 1; }
  #panel { display: flex; flex-direction: column; }
}

/* ── Onboarding ──────────────────────────────────────── */
#onboarding-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.6);
  z-index: 200;
}
#onboarding-modal {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  width: min(480px, 90vw);
  z-index: 201;
}
#onboarding-header {
  display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
}
#onboarding-logo { font-size: 32px; }
#onboarding-title { font-size: 18px; font-weight: bold; color: var(--green); }
#onboarding-sub   { color: var(--muted); font-size: 12px; }
#onboarding-intro { color: var(--text); line-height: 1.5; margin-bottom: 16px; font-size: 13px; }
.ob-score-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12px; }
.ob-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
#onboarding-hint { color: var(--muted); font-size: 11px; margin: 12px 0; }
#onboarding-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
#btn-onboarding-close {
  background: var(--green); border: none; border-radius: 6px;
  color: #000; cursor: pointer; font-size: 13px; font-weight: bold; padding: 8px 20px;
}
```

- [ ] **Commiter**

```bash
git add public/index.html public/style.css
git commit -m "feat: HTML shell + CSS dark theme"
```

---

## Task 6 — public/map.js

**Files:**
- Create: `public/map.js`

- [ ] **Créer public/map.js**

```javascript
import { updatePanel, clearPanel } from './panel.js';

const COMMUNES_URL   = './communes-pesticides.json';
const MAP_STYLE      = 'https://tiles.openfreemap.org/styles/dark';
const HISTORY_KEY    = 'pesticides-history';
const HISTORY_MAX    = 8;

// ── Couleurs ──────────────────────────────────────────────────────────────
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

function moleculeColor(mol, code) {
  // Colore selon le score de conformité de la molécule choisie
  if (!mol) return '#2d2d2d';
  if (mol.n === 0) return '#2d2d2d';
  const score = 100 * (mol.n - mol.depassements) / mol.n;
  return conformiteColor(score);
}

// ── State ─────────────────────────────────────────────────────────────────
let communesData    = {};   // {insee: communeObj}
let generatedAt     = null;
let map             = null;
let activeCommune   = null;
let activeMode      = 'conformite';   // 'conformite' | 'empreinte'
let activeMolecule  = null;           // code SANDRE ou null
let _geojsonSource  = null;

// ── Chargement données ────────────────────────────────────────────────────
async function loadData() {
  const r = await fetch(COMMUNES_URL);
  const d = await r.json();
  generatedAt = d.generated_at;

  for (const c of d.communes) {
    communesData[c.insee] = c;
  }

  document.getElementById('data-date').textContent =
    `Données ${d.years?.join('–') ?? ''} · màj ${new Date(generatedAt).toLocaleDateString('fr-FR')}`;

  return d.communes;
}

// ── GeoJSON helpers ───────────────────────────────────────────────────────
function buildGeojson(communes) {
  return {
    type: 'FeatureCollection',
    features: communes
      .filter(c => c.lat != null && c.lon != null)
      .map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
          insee:               c.insee,
          nom:                 c.nom,
          dept:                c.dept,
          dept_fallback:       c.dept_fallback,
          score_conformite:    c.score_conformite,
          n_molecules_detected: c.n_molecules_detected,
          color: _colorFor(c, activeMode, activeMolecule),
        },
      })),
  };
}

function _colorFor(commune, mode, molCode) {
  if (mode === 'empreinte') return empreinteColor(commune.n_molecules_detected);
  if (mode === 'molecule' && molCode) {
    return moleculeColor(commune.molecules?.[molCode], molCode);
  }
  return conformiteColor(commune.score_conformite);
}

function recolorMap() {
  if (!_geojsonSource) return;
  const features = _geojsonSource.getSource('communes')._data.features;
  for (const f of features) {
    const c = communesData[f.properties.insee];
    if (c) f.properties.color = _colorFor(c, activeMode, activeMolecule);
  }
  _geojsonSource.getSource('communes').setData(_geojsonSource.getSource('communes')._data);
}

// ── Init carte ────────────────────────────────────────────────────────────
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
    const geojson = buildGeojson(communes);

    map.addSource('communes', { type: 'geojson', data: geojson });
    _geojsonSource = map;

    // Cercles normaux
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

    // Cercles fallback (hachurés simulés par double cercle)
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

// ── Interactions carte ────────────────────────────────────────────────────
function _setupInteractions() {
  const tooltip = document.getElementById('map-tooltip');

  map.on('mousemove', 'communes-circles', (e) => {
    const p = e.features[0]?.properties;
    if (!p) return;
    map.getCanvas().style.cursor = 'pointer';
    const scoreStr = p.dept_fallback
      ? `${p.score_conformite?.toFixed(1) ?? '?'} % (dept)`
      : `${p.score_conformite?.toFixed(1) ?? '?'} %`;
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
  activeCommune = commune;
  activeMolecule = null;
  updatePanel(commune, { onMoleculeSelect: _onMoleculeSelect });
  _saveHistory(commune);
}

function _onMoleculeSelect(code) {
  activeMolecule = code;
  // Recolore la carte selon cette molécule
  const mode = code ? 'molecule' : activeMode;
  const features = map.getSource('communes')._data.features;
  for (const f of features) {
    const c = communesData[f.properties.insee];
    if (c) f.properties.color = _colorFor(c, mode, code);
  }
  map.getSource('communes').setData(map.getSource('communes')._data);
}

// ── Toggle mode ───────────────────────────────────────────────────────────
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
  if (activeMode === 'conformite') {
    legend.innerHTML = `
      <div class="legend-title">Conformité réglementaire</div>
      <div class="legend-item"><span class="dot" style="background:#2ecc71"></span><div><div class="legend-label">100 % — Conforme</div></div></div>
      <div class="legend-item"><span class="dot" style="background:#f1c40f"></span><div><div class="legend-label">95–99 % — Dépassements rares</div></div></div>
      <div class="legend-item"><span class="dot" style="background:#f39c12"></span><div><div class="legend-label">90–95 % — Occasionnels</div></div></div>
      <div class="legend-item"><span class="dot" style="background:#e74c3c"></span><div><div class="legend-label">&lt; 90 % — Fréquents</div></div></div>
      <div class="legend-item"><span class="dot dot-nodata"></span><div><div class="legend-label">Sans données</div></div></div>
      <div class="legend-item"><span class="dot dot-fallback"></span><div><div class="legend-label">Données département</div></div></div>`;
  } else {
    legend.innerHTML = `
      <div class="legend-title">Empreinte pesticides</div>
      <div class="legend-item"><span class="dot" style="background:#374151"></span><div><div class="legend-label">0 molécule détectée</div></div></div>
      <div class="legend-item"><span class="dot" style="background:#7e57c2"></span><div><div class="legend-label">1–3 molécules</div></div></div>
      <div class="legend-item"><span class="dot" style="background:#9c27b0"></span><div><div class="legend-label">4–6 molécules</div></div></div>
      <div class="legend-item"><span class="dot" style="background:#6a1b9a"></span><div><div class="legend-label">7–10 molécules</div></div></div>
      <div class="legend-item"><span class="dot" style="background:#4a148c"></span><div><div class="legend-label">10+ molécules</div></div></div>`;
  }
}

// ── Recherche ─────────────────────────────────────────────────────────────
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

// ── Boutons utilitaires ───────────────────────────────────────────────────
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

// ── Historique ────────────────────────────────────────────────────────────
function _saveHistory(commune) {
  const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    .filter(i => i.insee !== commune.insee);
  hist.unshift({ insee: commune.insee, nom: commune.nom, dept: commune.dept });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, HISTORY_MAX)));
}

// ── Onboarding ────────────────────────────────────────────────────────────
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

// ── Bottom sheet mobile ───────────────────────────────────────────────────
function _setupBottomSheet() {
  const panel  = document.getElementById('panel');
  const handle = document.getElementById('sheet-handle');
  const states = ['', 'sheet-half', 'sheet-full'];
  let idx = 0;
  handle.addEventListener('click', () => {
    panel.classList.remove(...states);
    idx = (idx + 1) % states.length;
    if (states[idx]) panel.classList.add(states[idx]);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
initMap();
_setupModeToggle();
_setupSearch();
_setupButtons();
_setupBottomSheet();
```

- [ ] **Commiter**

```bash
git add public/map.js
git commit -m "feat: map.js — MapLibre, toggle modes, search, interactions"
```

---

## Task 7 — public/panel.js

**Files:**
- Create: `public/panel.js`

- [ ] **Créer public/panel.js**

```javascript
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

// ── Graphique temporel (même pattern SCA Water Map) ───────────────────────
function _moleculeChart(mol, label) {
  // mol = { label, n, depassements, max_ug_l }
  // Pour le graphique on n'a pas les séries temporelles dans le JSON —
  // afficher un résumé texte à la place
  if (!mol || mol.n === 0) return '<div class="chart-stats">Aucune mesure disponible</div>';

  const score = 100 * (mol.n - mol.depassements) / mol.n;
  const color = _scoreColor(score);
  const breach = mol.max_ug_l > LIMIT_UG_L;

  return `
    <div class="chart-wrap">
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${_esc(label)}</div>
      <div style="display:flex;gap:16px;align-items:center">
        <div>
          <div style="font-size:20px;font-weight:bold;color:${color}">${score.toFixed(1)} %</div>
          <div style="color:var(--muted);font-size:10px">conformité</div>
        </div>
        <div>
          <div style="font-size:16px;font-weight:bold;color:${breach ? 'var(--red)' : 'var(--text)'}">
            ${mol.max_ug_l.toFixed(4)} µg/L
          </div>
          <div style="color:var(--muted);font-size:10px">max mesuré ${breach ? '⚠ > ' + LIMIT_UG_L : '≤ ' + LIMIT_UG_L}</div>
        </div>
        <div>
          <div style="font-size:16px">${mol.n}</div>
          <div style="color:var(--muted);font-size:10px">prélèvements</div>
        </div>
      </div>
    </div>`;
}

// ── Tab Conformité ────────────────────────────────────────────────────────
function _renderConformite(commune, activeMol, onMoleculeSelect) {
  const { score_conformite: score, n_depassements, n_prelevements, molecules } = commune;
  const scoreStr = score != null ? score.toFixed(1) + ' %' : '—';
  const scoreColor = _scoreColor(score);

  // Pills — toutes les molécules présentes dans les données
  const molEntries = Object.entries(molecules || {});
  const pills = molEntries.map(([code, mol]) => {
    const hasBreach = mol.depassements > 0;
    const isActive  = code === activeMol;
    const cls = ['season-pill', hasBreach ? 'breach' : '', isActive ? 'active' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-code="${code}" title="${_esc(mol.label)}">${_esc(mol.label.split('-')[0])}</button>`;
  }).join('');

  const activeMolData  = activeMol ? molecules?.[activeMol] : null;
  const activeMolLabel = activeMolData?.label ?? activeMol ?? '';
  const chart = activeMolData ? _moleculeChart(activeMolData, activeMolLabel) : '';

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

// ── Tab Empreinte ─────────────────────────────────────────────────────────
function _renderEmpreinte(commune) {
  const { n_molecules_detected, molecules } = commune;
  const molEntries = Object.entries(molecules || {});

  const rows = molEntries.map(([code, mol]) => {
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
        sur ${Object.keys(molecules || {}).length} analysées
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

// ── Export principal ──────────────────────────────────────────────────────
let _activeTab = 'conformite';
let _activeMol = null;
let _currentOnMoleculeSelect = null;

export function updatePanel(commune, { onMoleculeSelect } = {}) {
  _activeTab = 'conformite';
  _activeMol = null;
  _currentOnMoleculeSelect = onMoleculeSelect;

  const el = document.getElementById('panel-content');
  const empty = document.getElementById('panel-empty');
  el.hidden = false;
  empty.hidden = true;

  // Ouvrir le panel mobile au niveau half si fermé
  const panel = document.getElementById('panel');
  if (!panel.classList.contains('sheet-half') && !panel.classList.contains('sheet-full')) {
    panel.classList.add('sheet-half');
  }

  _render(commune);
}

export function clearPanel() {
  document.getElementById('panel-content').hidden = true;
  document.getElementById('panel-empty').hidden = false;
}

function _render(commune) {
  const el = document.getElementById('panel-content');
  const {
    nom, dept, last_date, dept_fallback,
    n_prelevements, score_conformite,
  } = commune;

  const lastDateStr = last_date
    ? new Date(last_date).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
    : '—';

  const scoreColor = _scoreColor(score_conformite);

  const fallbackNote = dept_fallback
    ? `<div class="panel-fallback-note">ℹ Aucune mesure communale disponible — données agrégées au niveau du département ${dept}.</div>`
    : '';

  const conformiteContent = _renderConformite(commune, _activeMol, _currentOnMoleculeSelect);
  const empreinteContent  = _renderEmpreinte(commune);

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
      <button class="panel-tab${_activeTab === 'empreinte' ? ' active' : ''}" data-tab="empreinte">Empreinte</button>
    </div>

    <div id="tab-conformite" ${_activeTab !== 'conformite' ? 'hidden' : ''}>${conformiteContent}</div>
    <div id="tab-empreinte"  ${_activeTab !== 'empreinte'  ? 'hidden' : ''}>${empreinteContent}</div>
  `;

  // ── Event listeners ──
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
      _currentOnMoleculeSelect?.(_activeMol);
      _render(commune);  // re-render pour mettre à jour pill active + chart
    });
  });
}
```

- [ ] **Commiter**

```bash
git add public/panel.js
git commit -m "feat: panel.js — conformité + empreinte + pills molécules"
```

---

## Task 8 — GitHub Action + déploiement

**Files:**
- Create: `.github/workflows/update-data.yml`

- [ ] **Créer .github/workflows/update-data.yml**

```yaml
name: Update pesticides data

on:
  schedule:
    - cron: '0 6 * * 1'   # Lundi 6h UTC
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: pip install -r pipeline/requirements.txt

      - name: Download ZIP data
        run: python pipeline/download_data.py

      - name: Compute pesticide scores
        run: python pipeline/compute_pesticides.py

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@de7a3b52866469b176e3c6b8d1b3950b1e68a61f
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
```

- [ ] **Créer le repo GitHub et pousser**

```bash
# Créer le repo public
gh repo create pesticides-water-map --public --source=. --remote=origin --push

# Créer la branche gh-pages vide pour Pages
git worktree add .ghp --orphan gh-pages
echo "<!DOCTYPE html><html><body>Initializing...</body></html>" > .ghp/index.html
cd .ghp
git add index.html
git commit -m "chore: init gh-pages"
git push origin gh-pages
cd ..
git worktree remove .ghp
```

- [ ] **Configurer GitHub Pages**

```bash
# Activer Pages sur la branche gh-pages
gh api repos/{owner}/pesticides-water-map/pages --method POST \
  --field source[branch]=gh-pages --field source[path]=/
```

Ou via l'interface GitHub : Settings → Pages → Source: Deploy from branch → gh-pages / root.

- [ ] **Lancer l'Action manuellement pour le premier déploiement**

```bash
gh workflow run update-data.yml
gh run watch   # suivre la progression
```

Durée estimée : 8–12 min (téléchargement ~900 MB + traitement CSV + déploiement).

- [ ] **Commiter le workflow**

```bash
git add .github/workflows/update-data.yml
git commit -m "feat: GitHub Action hebdomadaire + déploiement gh-pages"
git push origin main
```

- [ ] **Vérifier le déploiement**

URL du site : `https://{username}.github.io/pesticides-water-map/`

Vérifier :
- La carte se charge avec des communes colorées
- Le toggle Conformité / Empreinte recolore la carte
- Cliquer sur une commune ouvre le panel
- Les pills s'affichent pour les molécules présentes

---

## Self-Review

**Couverture spec :**
- ✅ Score de conformité réglementaire (Task 4)
- ✅ Empreinte pesticides nb molécules (Task 4)
- ✅ Toggle double mode carte (Task 5, 6)
- ✅ Commune + fallback département avec indication (Task 4, 5, 7)
- ✅ 3 dernières années (Task 4 — YEARS = [2023, 2024, 2025, 2026])
- ✅ ZIPs data.gouv.fr (Task 3)
- ✅ Liste fixe 15 molécules + sélecteur interactif (Task 4, 7)
- ✅ Recoloration carte par molécule (Task 6)
- ✅ Mobile bottom sheet (Task 5, 7)
- ✅ GitHub Action hebdomadaire (Task 8)
- ✅ Nouveau repo GitHub public (Task 8)

**Point d'attention :** Les noms de colonnes CSV (COL_INSEE, COL_CODE, etc.) dans `compute_pesticides.py` sont des estimations qui DOIVENT être vérifiées lors de la Task 2 d'inspection. Si les noms réels diffèrent, les constantes `COL_*` sont à adapter avant de lancer le pipeline complet (Task 4).
