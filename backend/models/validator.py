"""
Primitive validation model.

Goal: a small, trained ML model that *learns* the overall aging-livability score
from the same Cyvl-derived + external features, then validates the rule-based
engine — if the learned model and the rules agree closely, the scoring is
internally consistent; large residuals flag addresses worth a human look.

POC approach (CPU): scikit-learn GradientBoostingRegressor on synthetic feature
samples labeled by the rule engine (scoring.overall_aging_score). This trains in
seconds and needs no real data to demonstrate the concept.

NVIDIA path (GPU, sponsor tool): swap sklearn for RAPIDS cuML —
`from cuml.ensemble import RandomForestRegressor` — same fit/predict API. Train
on real Cyvl Somerville feature rows once the MCP export is available.
"""
from __future__ import annotations
import sys
from pathlib import Path

import numpy as np

sys.path.append(str(Path(__file__).resolve().parent.parent))
import scoring  # noqa: E402

FEATURE_ORDER = [
    "navigation", "healthcare", "safety", "emergency", "social", "displacement",
]


def _synthetic_dataset(n: int, rng: np.random.Generator):
    """Random dimension scores -> rule-engine overall. The model relearns the map."""
    X = rng.integers(0, 101, size=(n, len(FEATURE_ORDER)))
    y = np.array([
        scoring.overall_aging_score(dict(zip(FEATURE_ORDER, row))) for row in X
    ])
    return X, y


def train(n: int = 4000, seed: int = 42):
    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import mean_absolute_error, r2_score

    rng = np.random.default_rng(seed)
    X, y = _synthetic_dataset(n, rng)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=seed)

    model = GradientBoostingRegressor(random_state=seed)
    model.fit(Xtr, ytr)

    pred = model.predict(Xte)
    metrics = {"mae": round(float(mean_absolute_error(yte, pred)), 3),
               "r2": round(float(r2_score(yte, pred)), 4)}
    return model, metrics


def validate(model, dimensions: dict) -> dict:
    """Compare the learned prediction to the rule-based score for one address."""
    x = np.array([[dimensions[k] for k in FEATURE_ORDER]])
    predicted = float(model.predict(x)[0])
    rule_based = scoring.overall_aging_score(dimensions)
    residual = round(predicted - rule_based, 2)
    return {"rule_based": rule_based, "model_predicted": round(predicted, 2),
            "residual": residual, "consistent": abs(residual) <= 3}


if __name__ == "__main__":
    model, metrics = train()
    print("Validation model trained:", metrics)
    demo = {"navigation": 82, "healthcare": 64, "safety": 71,
            "emergency": 58, "social": 60, "displacement": 77}
    print("Sample validation:", validate(model, demo))
