"""
Cyvl data client — talks to the live Cyvl Data REST API.

Base:  https://i3.cyvl.app
Auth:  Authorization: Bearer <CYVL_API_KEY>
Docs:  https://i3.cyvl.app/docs   (OpenAPI: /openapi.json)

Endpoints used (all return GeoJSON FeatureCollections; all take project_id +
either bbox="w,s,e,n" or radius_lat/radius_lng/radius_meters):
  GET /api/v1/pavement/scores      -> PCI per segment
  GET /api/v1/assets               -> RAMP / SIDEWALK / CURB points + condition
  GET /api/v1/markings             -> crosswalks + condition
  GET /api/v1/infrastructure/query -> cross-layer

Behavior:
  - If CYVL_API_KEY is set -> live calls (CYVL_LIVE auto-on).
  - No key, or any request failure -> deterministic MOCK so the demo never breaks.
  - Property field names in the GeoJSON are confirmed via probe_cyvl.py; the
    extractors below try the likely keys defensively until then.
"""
from __future__ import annotations
import math
import os

import requests

PROJECT_ID = os.getenv("CYVL_PROJECT_ID", "f15b854a-d203-49c7-bc25-1350dd4a1cd6")
CYVL_BASE = os.getenv("CYVL_BASE", "https://i3.cyvl.app")
CYVL_API_KEY = os.getenv("CYVL_API_KEY", "")
CYVL_LIVE = bool(CYVL_API_KEY) and os.getenv("CYVL_LIVE", "true").lower() != "false"

# [west, south, east, north] — Somerville coverage.
SOMERVILLE_BBOX = [-71.1343408, 42.3734084, -71.0752535, 42.4180395]


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def _get(path: str, params: dict) -> dict | None:
    if not CYVL_LIVE:
        return None
    try:
        r = requests.get(f"{CYVL_BASE}{path}",
                         params={k: v for k, v in params.items() if v is not None},
                         headers={"Authorization": f"Bearer {CYVL_API_KEY}",
                                  "User-Agent": "cyvl-hackathon-poc/1.0 (Mozilla/5.0)"},
                         timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:  # network / auth / shape — fall back to mock
        print(f"[cyvl] {path} failed ({e}); using mock")
        return None


def _features(fc: dict | None) -> list[dict]:
    return (fc or {}).get("features", []) or []


def _prop(feat: dict, *keys, default=None):
    p = feat.get("properties", {}) or {}
    for k in keys:
        if k in p and p[k] is not None:
            return p[k]
    return default


def _feature_lat_lng(feat: dict) -> tuple[float, float] | None:
    g = feat.get("geometry") or {}
    c = g.get("coordinates")
    if not c:
        return None
    # Point -> [lng,lat]; LineString -> [[lng,lat],...] -> use midpoint.
    if g.get("type") == "Point":
        return c[1], c[0]
    flat = c
    while flat and isinstance(flat[0][0], (list, tuple)):
        flat = [pt for seg in flat for pt in seg]
    mid = flat[len(flat) // 2]
    return mid[1], mid[0]


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371000.0
    dlat = math.radians(b[0] - a[0]); dlng = math.radians(b[1] - a[1])
    h = (math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0]))
         * math.cos(math.radians(b[0])) * math.sin(dlng / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(h))


# --------------------------------------------------------------------------- #
# Mock (deterministic per-coordinate)
# --------------------------------------------------------------------------- #
def _mock_seed(lat: float, lng: float) -> float:
    return abs(((lat * 1000) % 1 + (lng * 1000) % 1) / 2)


def _mock_infra(lat: float, lng: float) -> dict:
    s = _mock_seed(lat, lng)
    return {
        "pavement_score": round(55 + s * 40, 1),
        "curb_cut_present": s > 0.25,
        "curb_cut_damaged": s > 0.8,
        "sidewalk_width_m": round(0.9 + s * 1.0, 2),
        "road_width_m": round(3.2 + s * 1.5, 2),
        "crosswalk_condition": ["None", "Poor", "Fair", "Good"][int(s * 3.99)],
        "source": "MOCK",
    }


# --------------------------------------------------------------------------- #
# Public API (same shape whether live or mock)
# --------------------------------------------------------------------------- #
def _extract_score(feat: dict) -> float | None:
    v = _prop(feat, "score", "pci", "pci_score", "pavement_score", "condition_score")
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def infrastructure_at(lat: float, lng: float, radius_m: int = 30) -> dict:
    """Cyvl-derived infrastructure facts near a point. Feeds score_navigation."""
    if not CYVL_LIVE:
        return _mock_infra(lat, lng)

    radius = {"radius_lat": lat, "radius_lng": lng, "radius_meters": radius_m}
    base = {"project_id": PROJECT_ID, "limit": 50, **radius}

    pav = _features(_get("/api/v1/pavement/scores", base))
    assets = _features(_get("/api/v1/assets", {**base, "asset_type": ["RAMP", "SIDEWALK", "CURB"]}))
    marks = _features(_get("/api/v1/markings", base))

    if not (pav or assets or marks):           # nothing live -> mock fallback
        return _mock_infra(lat, lng)

    scores = [s for s in (_extract_score(f) for f in pav) if s is not None]
    pavement_score = round(sum(scores) / len(scores), 1) if scores else _mock_infra(lat, lng)["pavement_score"]

    ramps = [f for f in assets if str(_prop(f, "asset_type", default="")).upper() == "RAMP"]
    sidewalks = [f for f in assets if str(_prop(f, "asset_type", default="")).upper() == "SIDEWALK"]

    def _bad(f):
        return str(_prop(f, "condition", default="")).lower() in {"poor", "damaged", "failed", "serious"}

    sw_widths = [w for w in (_prop(f, "width_m", "sidewalk_width_m", "width") for f in sidewalks) if isinstance(w, (int, float))]
    crosswalk = next((_prop(f, "condition", default="None") for f in marks), "None")

    return {
        "pavement_score": pavement_score,
        "curb_cut_present": bool(ramps),
        "curb_cut_damaged": any(_bad(f) for f in ramps),
        "sidewalk_width_m": round(float(sw_widths[0]), 2) if sw_widths else (1.5 if sidewalks else 0.9),
        "road_width_m": 4.0,  # TODO: derive from pavement segment width if exposed
        "crosswalk_condition": crosswalk,
        "source": "CYVL",
    }


def pavement_along_route(coords: list[tuple[float, float]]) -> list[float]:
    """Per-segment pavement score for a route polyline. Feeds route scoring.

    One bbox query for the whole route, then nearest pavement feature per point.
    """
    if not coords:
        return []
    if not CYVL_LIVE:
        return [_mock_infra(lat, lng)["pavement_score"] for lat, lng in coords]

    lats = [c[0] for c in coords]; lngs = [c[1] for c in coords]
    pad = 0.0008  # ~80m
    bbox = f"{min(lngs)-pad},{min(lats)-pad},{max(lngs)+pad},{max(lats)+pad}"
    feats = _features(_get("/api/v1/pavement/scores",
                           {"project_id": PROJECT_ID, "bbox": bbox, "limit": 500}))
    pts = [(p, _extract_score(f)) for f in feats
           if (p := _feature_lat_lng(f)) and _extract_score(f) is not None]
    if not pts:
        return [_mock_infra(lat, lng)["pavement_score"] for lat, lng in coords]

    out = []
    for c in coords:
        nearest = min(pts, key=lambda ps: _haversine_m(c, ps[0]))
        out.append(nearest[1])
    return out
