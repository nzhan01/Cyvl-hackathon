"""
generate_model.py

Pulls Cyvl street data for a lat/lng and generates a 3D OBJ file.
The OBJ is then uploaded to APS OSS and translated to SVF2.

Pipeline:
  1. Pull pavement + assets + markings from Cyvl (or mock)
  2. Build a simple 3D scene: ground plane, sidewalk segments, buildings
  3. Write OBJ + MTL files
  4. Upload to APS OSS
  5. Trigger Model Derivative translation
  6. Return URN
"""
from __future__ import annotations
import io
import math
import os
import tempfile
import zipfile

import cyvl_client
import geo
import aps

# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _latlon_to_xy(lat: float, lng: float, origin_lat: float, origin_lng: float) -> tuple[float, float]:
    """Convert lat/lng to local XY meters relative to an origin point."""
    x = (lng - origin_lng) * math.cos(math.radians(origin_lat)) * 111320
    y = (lat - origin_lat) * 111320
    return x, y


def _segment_color(score: float) -> str:
    """Return OBJ material name based on pavement score."""
    if score >= 70:
        return "mat_green"
    elif score >= 45:
        return "mat_yellow"
    else:
        return "mat_red"


# ---------------------------------------------------------------------------
# OBJ + MTL builders
# ---------------------------------------------------------------------------

def _build_mtl() -> str:
    """Build MTL material definitions."""
    return """# Cyvl Walkability Materials

newmtl mat_ground
Ka 0.1 0.1 0.1
Kd 0.2 0.2 0.2
Ks 0.0 0.0 0.0

newmtl mat_green
Ka 0.0 0.4 0.0
Kd 0.13 0.77 0.37
Ks 0.1 0.1 0.1

newmtl mat_yellow
Ka 0.4 0.3 0.0
Kd 0.97 0.62 0.15
Ks 0.1 0.1 0.1

newmtl mat_red
Ka 0.4 0.0 0.0
Kd 0.93 0.29 0.27
Ks 0.1 0.1 0.1

newmtl mat_building
Ka 0.15 0.15 0.2
Kd 0.3 0.3 0.4
Ks 0.2 0.2 0.2

newmtl mat_sidewalk
Ka 0.3 0.3 0.3
Kd 0.6 0.6 0.6
Ks 0.0 0.0 0.0
"""


def _build_obj(
    origin_lat: float,
    origin_lng: float,
    route_coords: list[tuple[float, float]],
    route_scores: list[float],
    infra: dict,
) -> str:
    """
    Build an OBJ string representing the street scene.
    - Ground plane (50m x 50m)
    - Route segments colored by pavement score
    - Sidewalk strips alongside the route
    - Simple box buildings on either side
    """
    lines = ["# Cyvl Walkability 3D Scene", "mtllib scene.mtl", ""]
    vertices = []
    faces = []
    current_v = 1  # OBJ vertex index is 1-based

    def add_quad(p1, p2, p3, p4, material):
        nonlocal current_v
        for p in [p1, p2, p3, p4]:
            vertices.append(f"v {p[0]:.3f} {p[1]:.3f} {p[2]:.3f}")
        faces.append(f"usemtl {material}")
        faces.append(f"f {current_v} {current_v+1} {current_v+2} {current_v+3}")
        current_v += 4

    # ── Ground plane ──────────────────────────────────────────────────────
    add_quad(
        (-200, 0, -200), (200, 0, -200),
        (200, 0, 200), (-200, 0, 200),
        "mat_ground"
    )

    # ── Route segments ────────────────────────────────────────────────────
    road_width = infra.get("road_width_m", 4.0)
    sidewalk_w = infra.get("sidewalk_width_m", 1.5)

    for i in range(len(route_coords) - 1):
        if i >= len(route_scores):
            break

        ax, ay = _latlon_to_xy(route_coords[i][0], route_coords[i][1], origin_lat, origin_lng)
        bx, by = _latlon_to_xy(route_coords[i+1][0], route_coords[i+1][1], origin_lat, origin_lng)

        # Clamp to scene bounds
        if abs(ax) > 200 or abs(ay) > 200 or abs(bx) > 200 or abs(by) > 200:
            continue

        dx = bx - ax
        dy = by - ay
        length = math.sqrt(dx*dx + dy*dy) or 1
        nx = -dy / length  # normal perpendicular to segment
        ny = dx / length

        hw = road_width / 2  # half road width
        sw = sidewalk_w      # sidewalk width

        # Road surface
        add_quad(
            (ax + nx*hw, 0.01, ay + ny*hw),
            (bx + nx*hw, 0.01, by + ny*hw),
            (bx - nx*hw, 0.01, by - ny*hw),
            (ax - nx*hw, 0.01, ay - ny*hw),
            _segment_color(route_scores[i])
        )

        # Left sidewalk
        add_quad(
            (ax + nx*hw,       0.05, ay + ny*hw),
            (bx + nx*hw,       0.05, by + ny*hw),
            (bx + nx*(hw+sw),  0.05, by + ny*(hw+sw)),
            (ax + nx*(hw+sw),  0.05, ay + ny*(hw+sw)),
            "mat_sidewalk"
        )

        # Right sidewalk
        add_quad(
            (ax - nx*(hw+sw),  0.05, ay - ny*(hw+sw)),
            (bx - nx*(hw+sw),  0.05, by - ny*(hw+sw)),
            (bx - nx*hw,       0.05, by - ny*hw),
            (ax - nx*hw,       0.05, ay - ny*hw),
            "mat_sidewalk"
        )

    # ── Simple buildings on either side ───────────────────────────────────
    building_positions = [
        (-20, -20, 8),  (15, -20, 12), (-20, 15, 6),
    (15, 15, 10),   (-25, 0, 7),   (20, 0, 9),
    (-20, -60, 8),  (15, -60, 10), (-20, 60, 7),
    (15, 60, 11),   (-25, 40, 8),  (20, -40, 9),
    (-20, -120, 8), (15, -120, 10),(-20, 120, 7),
    (15, 120, 11),  (-25, 90, 8),  (20, -90, 9),
    ]
    for bx, bz, height in building_positions:
        hw = 4.0
        # Front face
        add_quad(
            (bx-hw, 0,      bz-hw), (bx+hw, 0,      bz-hw),
            (bx+hw, height, bz-hw), (bx-hw, height, bz-hw),
            "mat_building"
        )
        # Back face
        add_quad(
            (bx+hw, 0,      bz+hw), (bx-hw, 0,      bz+hw),
            (bx-hw, height, bz+hw), (bx+hw, height, bz+hw),
            "mat_building"
        )
        # Left face
        add_quad(
            (bx-hw, 0,      bz+hw), (bx-hw, 0,      bz-hw),
            (bx-hw, height, bz-hw), (bx-hw, height, bz+hw),
            "mat_building"
        )
        # Right face
        add_quad(
            (bx+hw, 0,      bz-hw), (bx+hw, 0,      bz+hw),
            (bx+hw, height, bz+hw), (bx+hw, height, bz-hw),
            "mat_building"
        )
        # Roof
        add_quad(
            (bx-hw, height, bz-hw), (bx+hw, height, bz-hw),
            (bx+hw, height, bz+hw), (bx-hw, height, bz+hw),
            "mat_building"
        )

    # Assemble OBJ
    obj_lines = lines + vertices + [""] + faces
    return "\n".join(obj_lines)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

_urn_cache: dict = {}  # address -> URN; repeat opens skip the whole pipeline


def generate_and_upload(lat: float, lng: float, address: str) -> str:
    """
    Full pipeline: Cyvl data → OBJ → APS upload → translate → URN.
    Returns the base64 URN string. Cached per address for fast repeat opens.
    """
    key = (address or f"{lat:.5f},{lng:.5f}").strip().lower()
    if key in _urn_cache:
        return _urn_cache[key]

    # 1. Pull Cyvl infrastructure data
    infra = cyvl_client.infrastructure_at(lat, lng)

    # 2. Walking route to the nearest amenity (hospital preferred). Categories
    # can be None (no hardcoded fallback) — pick the first available, else origin.
    amenities = geo.nearest_amenities(lat, lng)
    dest = amenities.get("hospital") or amenities.get("pharmacy") or amenities.get("transit")
    if dest:
        route = geo.walking_route((lat, lng), (dest["lat"], dest["lng"]))
        coords = route["coords"][:60]  # keep the scene tight around the site
    else:
        coords = [(lat, lng)]
    scores = cyvl_client.pavement_along_route(coords)

    # 3. Build OBJ + MTL
    obj_content = _build_obj(lat, lng, coords, scores, infra)
    mtl_content = _build_mtl()

    # 4. Zip OBJ + MTL together (required for multi-file OBJ by APS)
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("scene.obj", obj_content)
        zf.writestr("scene.mtl", mtl_content)
    zip_bytes = zip_buffer.getvalue()

    # 5. Upload to APS OSS
    safe_addr = address.replace(" ", "").replace(",", "").replace("/", "")[:40]
    filename = f"cyvl_{safe_addr}.zip"
    urn = aps.upload_obj(filename, zip_bytes)

    # 6. Trigger SVF2 translation with rootFilename
    token = aps.get_token()
    import requests, base64
    requests.post(
        "https://developer.api.autodesk.com/modelderivative/v2/designdata/job",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-ads-force": "true",
        },
        json={
            "input": {
                "urn": urn,
                "compressedUrn": True,
                "rootFilename": "scene.obj",
            },
            "output": {
                "formats": [{"type": "svf2", "views": ["3d"]}]
            },
        },
        timeout=30,
    )

    _urn_cache[key] = urn
    return urn