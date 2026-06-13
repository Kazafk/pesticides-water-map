"""Télécharge et extrait les ZIPs annuels du contrôle sanitaire eau potable."""
import os, sys, zipfile
import requests

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(PROJECT_ROOT, "data", "raw")

ZIPS = [
    {"year": 2026, "filename": "dis-2026.zip",
     "url": "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20260601-162255/dis-2026.zip"},
    {"year": 2025, "filename": "dis-2025.zip",
     "url": "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20260422-070223/dis-2025.zip"},
    {"year": 2024, "filename": "dis-2024.zip",
     "url": "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20260422-071620/dis-2024.zip"},
    {"year": 2023, "filename": "dis-2023.zip",
     "url": "https://static.data.gouv.fr/resources/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/20241014-073810/dis-2023.zip"},
]


def _remote_size(url):
    try:
        r = requests.head(url, timeout=15, allow_redirects=True)
        cl = r.headers.get("Content-Length")
        return int(cl) if cl else None
    except Exception:
        return None


def _download(url, dest):
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
                print(f"\r    {done/1e6:.0f}/{total/1e6:.0f} MB", end="", flush=True)
    print()


def _extract(zip_path, year):
    dest_dir = os.path.join(RAW_DIR, str(year))
    os.makedirs(dest_dir, exist_ok=True)
    print(f"  Extraction vers {dest_dir}...", flush=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(dest_dir)
    files = os.listdir(dest_dir)
    print(f"  OK — {len(files)} fichiers: {files}", flush=True)
    return dest_dir


def download_all(force=False):
    os.makedirs(RAW_DIR, exist_ok=True)
    for entry in ZIPS:
        zip_path = os.path.join(RAW_DIR, entry["filename"])
        extract_dir = os.path.join(RAW_DIR, str(entry["year"]))

        if not force and os.path.exists(zip_path):
            local_size = os.path.getsize(zip_path)
            remote_size = _remote_size(entry["url"])
            if remote_size and local_size == remote_size:
                print(f"[{entry['year']}] ZIP à jour ({local_size/1e6:.0f} MB), skip")
                if not os.path.exists(extract_dir) or not os.listdir(extract_dir):
                    _extract(zip_path, entry["year"])
                continue

        print(f"[{entry['year']}] Téléchargement...")
        _download(entry["url"], zip_path)
        _extract(zip_path, entry["year"])
        print(f"[{entry['year']}] Terminé")


if __name__ == "__main__":
    download_all(force="--force" in sys.argv)
    print("Tous les ZIPs téléchargés et extraits.")
