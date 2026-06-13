"""
Geocoding + routing helpers.

- Nominatim (OSM) for free geocoding of Somerville addresses.
- OSRM public demo server for walking routes (polyline -> coordinate list).
- Hardcoded demo amenities (hospital / pharmacy / transit) so the demo is
  reliable and quota-free. 

All network calls degrade gracefully: if a service is unreachable we fall back
to a straight-line stub so the pipeline never hard-fails during a live demo.
"""
from __future__ import annotations
import math
import requests

NOMINATIM = "https://nominatim.openstreetmap.org/search"
OSRM = "https://router.project-osrm.org/route/v1/foot"
OVERPASS = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "cyvl-hackathon-poc/1.0"}

# OSM tag filters per amenity category. Cyvl has no POIs, so amenities come from
# OpenStreetMap (Overpass) — nearest hospital / pharmacy-or-grocery / transit.
AMENITY_QUERIES = {
    "hospital": ['["amenity"="hospital"]', '["amenity"="clinic"]'],
    "pharmacy": ['["amenity"="pharmacy"]', '["shop"="supermarket"]', '["shop"="convenience"]'],
    "transit":  ['["highway"="bus_stop"]', '["railway"="station"]', '["public_transport"="platform"]'],
}

# Hardcoded fallback (used only if Overpass is unreachable mid-demo).
DEMO_AMENITIES = {
    "hospital":  {"name": "CHA Somerville Hospital",      "lat": 42.3876, "lng": -71.1009},
    "pharmacy":  {"name": "CVS Pharmacy (Davis Square)",  "lat": 42.3967, "lng": -71.1226},
    "transit":   {"name": "Davis Square MBTA Station",    "lat": 42.3968, "lng": -71.1218},
}


def geocode(address: str) -> tuple[float, float] | None:
    try:
        r = requests.get(NOMINATIM, params={"q": address, "format": "json", "limit": 1},
                         headers=HEADERS, timeout=8)
        r.raise_for_status()
        data = r.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        pass
    return None


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371.0
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1])
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def nearest_amenity(lat: float, lng: float, category: str,
                    radius_m: int = 1600) -> dict | None:
    """Nearest OSM amenity of `category` to a point, via Overpass. None if none found."""
    clauses = AMENITY_QUERIES.get(category, [])
    if not clauses:
        return None
    parts = []
    for sel in clauses:
        for el in ("node", "way"):
            parts.append(f'{el}{sel}(around:{radius_m},{lat},{lng});')
    query = f"[out:json][timeout:15];({''.join(parts)});out center 30;"
    try:
        r = requests.post(OVERPASS, data={"data": query}, headers=HEADERS, timeout=20)
        r.raise_for_status()
        best = None
        for el in r.json().get("elements", []):
            elat = el.get("lat") or (el.get("center") or {}).get("lat")
            elng = el.get("lon") or (el.get("center") or {}).get("lon")
            if elat is None or elng is None:
                continue
            d = _haversine_km((lat, lng), (elat, elng))
            tags = el.get("tags", {})
            cand = {"name": tags.get("name", category.title()), "lat": elat,
                    "lng": elng, "distance_km": round(d, 3), "source": "OSM"}
            if best is None or cand["distance_km"] < best["distance_km"]:
                best = cand
        return best
    except Exception:
        return None


def nearest_amenities(lat: float, lng: float) -> dict:
    """Nearest hospital / pharmacy / transit for a point, with hardcoded fallback."""
    out = {}
    for cat in ("hospital", "pharmacy", "transit"):
        found = nearest_amenity(lat, lng, cat)
        if found is None:
            fb = DEMO_AMENITIES[cat]
            found = {**fb, "distance_km": round(_haversine_km((lat, lng), (fb["lat"], fb["lng"])), 3),
                     "source": "FALLBACK"}
        out[cat] = found
    return out


def walking_route(origin: tuple[float, float], dest: tuple[float, float]) -> dict:
    """Return {coords: [(lat,lng)...], distance_km}. Falls back to a straight line."""
    try:
        url = f"{OSRM}/{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
        r = requests.get(url, params={"overview": "full", "geometries": "geojson"},
                         headers=HEADERS, timeout=8)
        r.raise_for_status()
        route = r.json()["routes"][0]
        coords = [(c[1], c[0]) for c in route["geometry"]["coordinates"]]
        return {"coords": coords, "distance_km": route["distance"] / 1000.0}
    except Exception:
        return {"coords": [origin, dest], "distance_km": _haversine_km(origin, dest)}
