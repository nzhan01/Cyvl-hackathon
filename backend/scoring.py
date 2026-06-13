"""
Aging-livability scoring engine.

Six dimension scores (each 0-100, higher = better for aging residents) combine
into one overall score. Each dimension normalizes a different data source.

This is the rule-based "model" that (a) powers the demo and (b) generates the
training labels for the primitive validation model in models/validator.py.
"""
from __future__ import annotations


# --- Dimension 1: Navigation + mobility (25%) -------------------------------
# Cyvl owns this entirely: pavement CV score + LiDAR-derived curb/sidewalk facts.
def score_navigation(pavement_score: float, curb_cut_present: bool,
                     curb_cut_damaged: bool, sidewalk_width_m: float) -> int:
    curb_score = 100 if (curb_cut_present and not curb_cut_damaged) else (
        40 if curb_cut_present else 0)
    width_score = 100 if sidewalk_width_m >= 1.5 else (
        60 if sidewalk_width_m >= 1.0 else 20)
    return round(pavement_score * 0.5 + curb_score * 0.3 + width_score * 0.2)


# --- Dimension 2: Healthcare access (20%) -----------------------------------
def score_healthcare(route_scores: list[float], distance_km: float) -> int:
    if not route_scores:
        return 0
    avg_route = sum(route_scores) / len(route_scores)
    distance_penalty = max(0, (distance_km - 0.5) * 30)  # >1km gets harder
    return round(max(0, avg_route - distance_penalty))


# --- Dimension 3: Outdoor safety (20%) --------------------------------------
# Built UP from REAL Cyvl above-ground safety infrastructure near the site:
# streetlights (LUMINARIES), pedestrian crossing infra (push buttons, signal
# heads, traffic signals, beacons), crosswalk markings, and CCTV. Optional
# external risk penalties (311 complaints, crashes) subtract if/when wired.
def score_safety(lighting_count: int, ped_crossing_count: int,
                 surveillance_count: int, crosswalk_count: int = 0,
                 complaints_311: int = 0, crashes_nearby: int = 0) -> int:
    lighting = min(30, lighting_count * 6)          # night visibility
    crossings = min(40, ped_crossing_count * 4)     # safe, signalized crossings
    crosswalks = min(20, crosswalk_count * 5)       # marked crossings
    surveillance = min(10, surveillance_count * 5)  # CCTV presence
    score = lighting + crossings + crosswalks + surveillance
    score -= min(25, complaints_311 * 5)            # external risk (optional)
    score -= min(20, crashes_nearby * 7)
    return round(max(0, min(100, score)))


# --- Dimension 4: Emergency access (15%) ------------------------------------
def score_emergency(road_width_m: float, hospital_route_score: float,
                    hospital_distance_km: float) -> int:
    width_score = 100 if road_width_m >= 4.0 else (
        60 if road_width_m >= 3.5 else 20)            # ambulance clearance
    distance_penalty = max(0, (hospital_distance_km - 1.0) * 20)
    route_score = max(0, hospital_route_score - distance_penalty)
    return round(width_score * 0.4 + route_score * 0.6)


# --- Dimension 5: Social connection (12%) -----------------------------------
def score_social(nearest_center_km: float, route_to_center: list[float],
                 parks_within_800m: int) -> int:
    avg_route = sum(route_to_center) / len(route_to_center) if route_to_center else 0
    distance_penalty = max(0, (nearest_center_km - 0.4) * 40)  # only 2 centers
    center_score = max(0, avg_route - distance_penalty)
    park_bonus = min(20, parks_within_800m * 7)
    return round(min(100, center_score * 0.7 + park_bonus * 0.3 + park_bonus))


# --- Dimension 6: Displacement risk (8%, inverted) --------------------------
# Higher score = lower displacement risk = better for residents.
def score_displacement(tax_increase_pct: float, senior_pct: float,
                       new_permits_nearby: int) -> int:
    tax_penalty = min(40, tax_increase_pct * 2)       # over 18 months
    permit_penalty = min(30, new_permits_nearby * 5)  # within 500m
    density_penalty = min(20, senior_pct * 0.5)
    return round(max(0, 100 - tax_penalty - permit_penalty - density_penalty))


WEIGHTS = {
    "navigation":   0.25,
    "healthcare":   0.20,
    "safety":       0.20,
    "emergency":    0.15,
    "social":       0.12,
    "displacement": 0.08,
}


def overall_aging_score(dims: dict[str, float]) -> int:
    return round(sum(dims[k] * WEIGHTS[k] for k in WEIGHTS))


def score_all(features: dict) -> dict:
    """Run all six dimensions from a flat feature dict and return scores + overall.

    `features` is the normalized output of cyvl_client + geo + external sources.
    Returns a dict ready to serialize as the /api/score-address response.
    """
    dims = {
        "navigation": score_navigation(
            features["pavement_score"], features["curb_cut_present"],
            features["curb_cut_damaged"], features["sidewalk_width_m"]),
        "healthcare": score_healthcare(
            features["healthcare_route_scores"], features["healthcare_distance_km"]),
        "safety": score_safety(
            features["lighting_count"], features["ped_crossing_count"],
            features["surveillance_count"], features["crosswalk_count"],
            features["complaints_311"], features["crashes_nearby"]),
        "emergency": score_emergency(
            features["road_width_m"], features["hospital_route_score"],
            features["hospital_distance_km"]),
        "social": score_social(
            features["nearest_center_km"], features["social_route_scores"],
            features["parks_within_800m"]),
        "displacement": score_displacement(
            features["tax_increase_pct"], features["senior_pct"],
            features["new_permits_nearby"]),
    }
    return {"dimensions": dims, "overall": overall_aging_score(dims),
            "weights": WEIGHTS}
