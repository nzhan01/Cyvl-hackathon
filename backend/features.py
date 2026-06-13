"""
Feature assembly: turn an address into the flat feature dict scoring.score_all
expects, pulling from cyvl_client (Cyvl), geo (routing), and external sources.

External sources (311 / Census / assessor) are stubbed deterministically for the
POC. Each stub is isolated so a teammate can drop in the real fetch later.
"""
from __future__ import annotations
import cyvl_client
import geo


def _external_stub(lat: float, lng: float) -> dict:
    """311 + Census + assessor placeholders. TODO: AskBoston 311, Census ACS."""
    seed = cyvl_client._mock_seed(lat, lng)
    return {
        "complaints_311": int(seed * 5),
        "crashes_nearby": int(seed * 3),
        "has_lighting": seed > 0.4,
        "tax_increase_pct": round(seed * 12, 1),
        "senior_pct": round(10 + seed * 20, 1),
        "new_permits_nearby": int(seed * 4),
        "parks_within_800m": int(seed * 3),
    }


def build_features(address: str | None = None, lat: float | None = None,
                   lng: float | None = None) -> dict:
    """Resolve location -> nearest amenities (OSM) -> routes -> Cyvl infra -> features.

    Pass either `address` (geocoded) or `lat`/`lng` (e.g. browser geolocation).
    """
    if lat is None or lng is None:
        if not address:
            raise ValueError("Provide an address or lat/lng")
        loc = geo.geocode(address)
        if loc is None:
            raise ValueError(f"Could not geocode address: {address!r}")
        lat, lng = loc

    infra = cyvl_client.infrastructure_at(lat, lng)
    safety = cyvl_client.safety_assets_at(lat, lng)   # REAL Cyvl safety assets
    ext = _external_stub(lat, lng)

    # Dynamically discover nearest amenities from OpenStreetMap (not Cyvl).
    # A category may be None if nothing is found nearby (no hardcoded fallback).
    amenities = geo.nearest_amenities(lat, lng)

    def _route_scores(amenity):
        if not amenity:
            return None, []
        route = geo.walking_route((lat, lng), (amenity["lat"], amenity["lng"]))
        return route, cyvl_client.pavement_along_route(route["coords"])

    hosp_route, hosp_scores = _route_scores(amenities["hospital"])
    pharm_route, pharm_scores = _route_scores(amenities["pharmacy"])

    FAR_KM = 99.0  # sentinel distance when an amenity isn't found nearby
    pharm_km = pharm_route["distance_km"] if pharm_route else FAR_KM
    hosp_km = hosp_route["distance_km"] if hosp_route else FAR_KM

    return {
        # location + discovered amenities
        "address": address, "lat": lat, "lng": lng,
        "amenities": amenities,
        # navigation (Cyvl)
        "pavement_score": infra["pavement_score"],
        "curb_cut_present": infra["curb_cut_present"],
        "curb_cut_damaged": infra["curb_cut_damaged"],
        "sidewalk_width_m": infra["sidewalk_width_m"],
        "road_width_m": infra["road_width_m"],
        # healthcare (route to pharmacy as proxy for daily-care errands)
        "healthcare_route_scores": pharm_scores,
        "healthcare_distance_km": pharm_km,
        # emergency (route to hospital)
        "hospital_route_score": sum(hosp_scores) / len(hosp_scores) if hosp_scores else 0,
        "hospital_distance_km": hosp_km,
        # social
        "nearest_center_km": pharm_km,   # proxy until senior-center data
        "social_route_scores": pharm_scores,
        "parks_within_800m": ext["parks_within_800m"],
        # safety (REAL Cyvl assets) + external risk penalties (stub for now)
        "lighting_count": safety["lighting_count"],
        "ped_crossing_count": safety["ped_crossing_count"],
        "surveillance_count": safety["surveillance_count"],
        "crosswalk_count": safety["crosswalk_count"],
        "safety_source": safety["source"],
        "complaints_311": ext["complaints_311"],
        "crashes_nearby": ext["crashes_nearby"],
        "tax_increase_pct": ext["tax_increase_pct"],
        "senior_pct": ext["senior_pct"],
        "new_permits_nearby": ext["new_permits_nearby"],
    }
