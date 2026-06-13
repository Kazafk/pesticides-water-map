"""Calcule les scores pesticides par commune depuis les TXT extraits des ZIPs.

Format réel des données (vérifié sur dis-2026) :
- 3 fichiers .txt par année, séparateur virgule, encodage utf-8
- DIS_RESULT_*.txt : cdparametre, valtraduite, referenceprel
- DIS_PLV_*.txt   : inseecommuneprinc, dateprel, referenceprel
- Jointure via referenceprel entre les deux fichiers
"""
import csv, json, os, statistics
from datetime import datetime, timezone
import requests

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR      = os.path.join(PROJECT_ROOT, "data", "raw")
OUTPUT_FILE  = os.path.join(PROJECT_ROOT, "public", "communes-pesticides.json")

LIMIT_UG_L = 0.1

# Codes SANDRE vérifiés sur données réelles (Task 2 inspection)
PESTICIDE_CODES = {
    "1107": "Atrazine",
    "1108": "Atrazine-desethyl",
    "1113": "Bentazone",
    "1129": "Carbendazime",
    "1177": "Diuron",
    "1208": "Isoproturon",
    "1209": "Linuron",
    "1473": "Chlorothalonil",
    "1506": "Glyphosate",
    "1667": "Oxadiazon",
    "1877": "Imidaclopride",
    "1907": "AMPA",
    "2974": "S-Métolachlore",
    "6894": "OXA-Métazachlore",
    "6895": "ESA-Métazachlore",
    "7717": "Chlorothalonil R417888",
    "8865": "Chlorothalonil R471811",
}

YEARS = [2023, 2024, 2025, 2026]


def _log(msg):
    print(msg, flush=True)


# ── Fonctions pures (testables) ──────────────────────────────────────────────

def score_conformite(rows):
    """% prélèvements sans dépassement. rows = list of {'val': float}."""
    if not rows:
        return None
    n_breach = sum(1 for r in rows if r["val"] > LIMIT_UG_L)
    return round(100.0 * (len(rows) - n_breach) / len(rows), 2)


def n_molecules_detected(mol_data):
    """Nb molécules avec au moins 1 mesure > 0. mol_data = {code: [floats]}."""
    return sum(1 for vals in mol_data.values() if any(v > 0 for v in vals))


def dept_median_fallback(commune, all_communes):
    """Fallback département pour communes sans données."""
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
    result["last_date"] = None
    return result


# ── Chargement données brutes ────────────────────────────────────────────────

def _find_file(year_dir, pattern):
    """Trouve un fichier dont le nom contient `pattern` (insensible casse)."""
    for f in os.listdir(year_dir):
        if pattern.lower() in f.lower():
            return os.path.join(year_dir, f)
    return None


def _load_prelevement_index(year_dir, year):
    """Retourne {referenceprel: (inseecommuneprinc, dateprel)}."""
    plv_file = _find_file(year_dir, "PLV")
    if not plv_file:
        _log(f"  [{year}] Fichier PLV introuvable dans {year_dir}")
        return {}
    idx = {}
    with open(plv_file, encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter=",")
        for row in reader:
            ref = row.get("referenceprel", "").strip()
            insee = row.get("inseecommuneprinc", "").strip()
            date = (row.get("dateprel") or "")[:10]
            if ref and insee:
                idx[ref] = (insee, date)
    _log(f"  [{year}] {len(idx)} prélèvements indexés (PLV)")
    return idx


def load_raw_data():
    """Retourne {insee: {code: [vals], '_nom': str, '_dates': [str], '_rows': [dict]}}."""
    _log("Chargement des données brutes...")
    idx = {}
    total = 0

    for year in YEARS:
        year_dir = os.path.join(RAW_DIR, str(year))
        if not os.path.isdir(year_dir):
            _log(f"  [{year}] Répertoire absent, skip")
            continue

        plv_idx = _load_prelevement_index(year_dir, year)
        result_file = _find_file(year_dir, "RESULT")
        if not result_file:
            _log(f"  [{year}] Fichier RESULT introuvable")
            continue

        year_total = 0
        with open(result_file, encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f, delimiter=",")
            for row in reader:
                code_param = row.get("cdparametre", "").strip()
                if code_param not in PESTICIDE_CODES:
                    continue
                ref = row.get("referenceprel", "").strip()
                insee_date = plv_idx.get(ref)
                if not insee_date:
                    continue
                insee, date = insee_date

                val_str = row.get("valtraduite", "").strip().replace(",", ".")
                try:
                    val = float(val_str)
                except (ValueError, TypeError):
                    continue

                if insee not in idx:
                    idx[insee] = {"_nom": "", "_dates": [], "_rows": []}
                idx[insee]["_dates"].append(date)
                idx[insee]["_rows"].append({"code": code_param, "val": val})
                idx[insee].setdefault(code_param, []).append(val)
                year_total += 1

        _log(f"  [{year}] {year_total} mesures pesticides")
        total += year_total

    _log(f"Total: {total} mesures, {len(idx)} communes avec données")
    return idx


# ── Coordonnées géographiques ─────────────────────────────────────────────────

def fetch_coordinates():
    """Retourne {insee: {"lat", "lon", "nom"}} depuis geo.api.gouv.fr."""
    _log("Récupération coordonnées communes...")
    url = "https://geo.api.gouv.fr/communes?fields=code,nom,centre&format=json&geometry=centre"
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    coords = {}
    for c in r.json():
        code = c.get("code", "")
        nom = c.get("nom", "")
        centre = c.get("centre", {})
        if centre and centre.get("type") == "Point":
            lon, lat = centre["coordinates"]
            coords[code] = {"lat": round(lat, 5), "lon": round(lon, 5), "nom": nom}
    _log(f"  {len(coords)} communes avec coordonnées")
    return coords


# ── Calcul scores ─────────────────────────────────────────────────────────────

def _dept_from_insee(insee):
    return insee[:3] if insee.startswith("97") else insee[:2]


def compute_all(raw, coords):
    _log("Calcul des scores...")
    communes = []
    for insee, data in raw.items():
        rows_all = data["_rows"]
        dates = [d for d in data["_dates"] if d]
        sc = score_conformite(rows_all)
        n_dep = sum(1 for r in rows_all if r["val"] > LIMIT_UG_L)
        mol_data = {code: data[code] for code in PESTICIDE_CODES if code in data}
        n_det = n_molecules_detected(mol_data)
        molecules = {}
        for code, label in PESTICIDE_CODES.items():
            vals = data.get(code)
            if not vals:
                continue
            n_mol_dep = sum(1 for v in vals if v > LIMIT_UG_L)
            molecules[code] = {
                "label": label, "n": len(vals),
                "depassements": n_mol_dep,
                "max_ug_l": round(max(vals), 4),
            }
        geo = coords.get(insee, {})
        lat = geo.get("lat")
        lon = geo.get("lon")
        nom = geo.get("nom") or data["_nom"] or insee
        communes.append({
            "insee": insee, "nom": nom, "dept": _dept_from_insee(insee),
            "lat": lat, "lon": lon, "dept_fallback": False,
            "n_prelevements": len(rows_all), "n_depassements": n_dep,
            "score_conformite": sc, "n_molecules_detected": n_det,
            "last_date": max(dates) if dates else None,
            "molecules": molecules,
        })
    _log(f"  {len(communes)} communes calculées")
    return communes


def apply_fallback(communes_with_data, coords):
    _log("Fallback département...")
    have = {c["insee"] for c in communes_with_data}
    fallbacks = []
    for insee, geo in coords.items():
        if insee in have:
            continue
        dept = _dept_from_insee(insee)
        stub = {"insee": insee, "nom": geo.get("nom", ""), "dept": dept,
                "lat": geo.get("lat"), "lon": geo.get("lon")}
        fallbacks.append(dept_median_fallback(stub, communes_with_data))
    _log(f"  {len(fallbacks)} communes en fallback")
    return communes_with_data + fallbacks


def main():
    raw = load_raw_data()
    coords = fetch_coordinates()
    communes = compute_all(raw, coords)
    all_communes = apply_fallback(communes, coords)
    all_communes.sort(key=lambda c: c["insee"])

    years_present = sorted(y for y in YEARS if os.path.isdir(os.path.join(RAW_DIR, str(y))))
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
