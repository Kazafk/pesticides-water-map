# Pesticides Water Map 🌿

Carte interactive des pesticides dans l'eau du robinet en France — commune par commune.

**Site :** https://kazafk.github.io/pesticides-water-map/

## Fonctionnalités

- **Mode Conformité** — score réglementaire (% prélèvements sous 0,1 µg/L) par commune
- **Mode Empreinte** — nombre de molécules distinctes détectées
- Toggle par molécule — recolore la carte sur une substance spécifique
- Panel commune — détail conformité + tableau molécules + fallback département
- Recherche par commune ou département
- Mobile-first (bottom sheet)

## Données

Source officielle : [Ministère de la Santé — contrôle sanitaire eau potable](https://www.data.gouv.fr/fr/datasets/resultats-du-controle-sanitaire-de-leau-distribuee-commune-par-commune/)

Années couvertes : 2023–2026 | Mise à jour : hebdomadaire (lundi)

17 molécules prioritaires (codes SANDRE vérifiés) : Atrazine, Glyphosate, AMPA, Diuron, S-Métolachlore, Chlorothalonil, Imidaclopride, Isoproturon, Carbendazime, Bentazone, Linuron, Oxadiazon, AMPA, et métabolites.

## Pipeline

```bash
pip install -r pipeline/requirements.txt
python pipeline/download_data.py      # télécharge les ZIPs (~900 MB)
python pipeline/compute_pesticides.py # génère public/communes-pesticides.json
```

## Seuil réglementaire

0,1 µg/L par molécule (directive européenne eau potable 98/83/CE).
