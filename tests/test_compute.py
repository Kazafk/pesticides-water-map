import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline'))
from compute_pesticides import score_conformite, n_molecules_detected, dept_median_fallback, LIMIT_UG_L
import pytest


def test_score_conformite_perfect():
    rows = [{"val": 0.05}] * 10
    assert score_conformite(rows) == 100.0


def test_score_conformite_one_breach():
    rows = [{"val": 0.12}, {"val": 0.05}, {"val": 0.03}, {"val": 0.01}]
    assert score_conformite(rows) == pytest.approx(75.0)


def test_score_conformite_empty():
    assert score_conformite([]) is None


def test_score_conformite_all_breach():
    rows = [{"val": 0.15}, {"val": 0.20}]
    assert score_conformite(rows) == pytest.approx(0.0)


def test_n_molecules_detected_counts_nonzero():
    mol_data = {"1506": [0.04, 0.0], "1742": [0.0, 0.0], "1107": [0.02]}
    assert n_molecules_detected(mol_data) == 2


def test_n_molecules_detected_none():
    assert n_molecules_detected({}) == 0


def test_dept_median_fallback_basic():
    communes = [
        {"dept": "38", "score_conformite": 80.0, "dept_fallback": False, "n_molecules_detected": 3},
        {"dept": "38", "score_conformite": 90.0, "dept_fallback": False, "n_molecules_detected": 5},
        {"dept": "38", "score_conformite": 100.0, "dept_fallback": False, "n_molecules_detected": 7},
    ]
    result = dept_median_fallback(
        {"insee": "38999", "nom": "", "dept": "38", "lat": None, "lon": None},
        communes
    )
    assert result["score_conformite"] == 90.0
    assert result["dept_fallback"] is True
    assert result["n_prelevements"] == 0


def test_limit_ug_l():
    assert LIMIT_UG_L == 0.1
