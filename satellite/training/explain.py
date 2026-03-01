"""SHAP TreeExplainer integration for per-prediction interpretability.

Every model prediction gets a SHAP explanation showing which features
contributed most to the decision. This is critical for:
  1. Debugging: "why did the model predict +5% ROE here?"
  2. Trust: user can see the reasoning, not just the number
  3. Feature selection: identify which features actually matter
  4. Anomaly detection: unusual SHAP patterns = unusual market conditions

SHAP TreeExplainer on XGBoost is ~100 microseconds per prediction.
"""

import logging
from dataclasses import dataclass

import numpy as np

log = logging.getLogger(__name__)


@dataclass
class PredictionExplanation:
    """SHAP explanation for a single prediction."""

    predicted_roe: float
    base_value: float
    feature_names: list[str]
    feature_values: list[float]
    shap_values: list[float]
    top_contributors: list[tuple[str, float, float]]

    @property
    def summary(self) -> str:
        """Human-readable summary of top contributors."""
        parts = []
        for name, val, shap_val in self.top_contributors[:5]:
            direction = "+" if shap_val > 0 else ""
            parts.append(f"{name}={val:.3f} ({direction}{shap_val:.2f}%)")
        return (
            f"Predicted {self.predicted_roe:+.1f}% ROE. "
            f"Top factors: {', '.join(parts)}"
        )


def create_explainer(model: object) -> object:
    """Create a SHAP TreeExplainer for the model.

    Args:
        model: Trained XGBoost Booster.

    Returns:
        shap.TreeExplainer instance.
    """
    import shap
    return shap.TreeExplainer(model)


def explain_prediction(
    explainer: object,
    transformed_features: list[float],
    raw_features: dict[str, float],
    feature_names: list[str],
    predicted_roe: float,
) -> PredictionExplanation:
    """Generate SHAP explanation for a single prediction.

    Args:
        explainer: SHAP TreeExplainer.
        transformed_features: Normalized feature vector (what the model saw).
        raw_features: Raw feature values (for human display).
        feature_names: Feature names in order.
        predicted_roe: The model's prediction (for context).

    Returns:
        PredictionExplanation with SHAP values and top contributors.
    """
    x = np.array([transformed_features])
    shap_values = explainer.shap_values(x)[0]
    base_value = float(explainer.expected_value)

    # Build sorted contributors list
    contributions = []
    for i, name in enumerate(feature_names):
        raw_val = raw_features.get(name, 0.0)
        shap_val = float(shap_values[i])
        contributions.append((name, raw_val, shap_val))

    # Sort by absolute SHAP value (most important first)
    contributions.sort(key=lambda c: abs(c[2]), reverse=True)

    return PredictionExplanation(
        predicted_roe=predicted_roe,
        base_value=base_value,
        feature_names=feature_names,
        feature_values=[raw_features.get(n, 0.0) for n in feature_names],
        shap_values=[float(s) for s in shap_values],
        top_contributors=contributions,
    )


def explain_batch(
    explainer: object,
    X: np.ndarray,
) -> np.ndarray:
    """Compute SHAP values for a batch of predictions.

    Args:
        explainer: SHAP TreeExplainer.
        X: Feature matrix (n_samples, n_features).

    Returns:
        SHAP values array (n_samples, n_features).
    """
    return explainer.shap_values(X)


def feature_importance_shap(
    explainer: object,
    X: np.ndarray,
    feature_names: list[str],
) -> dict[str, float]:
    """Compute mean absolute SHAP values for feature ranking.

    Better than gain-based importance because it accounts for
    feature interactions and is directional.

    Args:
        explainer: SHAP TreeExplainer.
        X: Feature matrix (representative sample).
        feature_names: Feature names.

    Returns:
        Dict mapping feature name -> mean absolute SHAP value,
        sorted by importance (descending).
    """
    shap_values = explainer.shap_values(X)
    mean_abs = np.mean(np.abs(shap_values), axis=0)

    importance = {}
    for i, name in enumerate(feature_names):
        importance[name] = float(mean_abs[i])

    return dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))
