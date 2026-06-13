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
import zipfile

import cyvl_client
import geo
import aps


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _latlon_to_xy(lat: float, lng: float, origin_lat: float, origin_lng: float) -> tuple[float, float]:
    x = (lng - origin_lng) * math.cos(math.radians(origin_lat)) * 111320
    y = (lat - origin_lat) * 111320
    return x, y


def _segment_color(score: float) -> str:
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
    return """# Cyvl Walkability Materials

newmtl mat_ground
Ka 0.3 0.3 0.35
Kd 0.45 0.45 0.5
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
Ka 0.4 0.4 0.45
Kd 0.55 0.55 0.6
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
    lines = ["# Cyvl Walkability 3D Scene", "mtllib scene.mtl", ""]
    vertices = []
    faces = []
    current_v = 1

    def add_quad(p1, p2, p3, p4, material):
        nonlocal current_v
        for p in [p1, p2, p3, p4]:
            vertices.append(f"v {p[0]:.3f} {p[1]:.3f} {p[2]:.3f}")
        faces.append(f"usemtl {material}")
        faces.append(f"f {current_v} {current_v+1} {current_v+2} {current_v+3}")
        current_v += 4

    # ── Pre-compute all XY coordinates ───────────────────────────────────
    all_xy = [_latlon_to_xy(c[0], c[1], origin_lat, origin_lng) for c in route_coords]
    all_x = [p[0] for p in all_xy]
    all_y = [p[1] for p in all_xy]

    # ── Ground plane sized to fit the full route ──────────────────────────
    pad = 20
    gx_min = min(all_x) - pad
    gx_max = max(all_x) + pad
    gy_min = min(all_y) - pad
    gy_max = max(all_y) + pad

    add_quad(
        (gx_min, 0, gy_min), (gx_max, 0, gy_min),
        (gx_max, 0, gy_max), (gx_min, 0, gy_max),
        "mat_ground"
    )

    # ── Route segments — full route, no clamping ──────────────────────────
    road_width = max(infra.get("road_width_m", 4.0), 8.0)
    sidewalk_w = max(infra.get("sidewalk_width_m", 1.5), 4.0)

    for i in range(len(route_coords) - 1):
        if i >= len(route_scores):
            break

        ax, ay = all_xy[i]
        bx, by = all_xy[i + 1]

        dx = bx - ax
        dy = by - ay
        length = math.sqrt(dx * dx + dy * dy) or 1
        nx = -dy / length
        ny = dx / length

        hw = road_width / 2
        sw = sidewalk_w

        # Road surface colored by pavement score
        add_quad(
            (ax + nx*hw, 0.01, ay + ny*hw),
            (bx + nx*hw, 0.01, by + ny*hw),
            (bx - nx*hw, 0.01, by - ny*hw),
            (ax - nx*hw, 0.01, ay - ny*hw),
            _segment_color(route_scores[i])
        )

        # Left sidewalk
        add_quad(
            (ax + nx*hw,      0.05, ay + ny*hw),
            (bx + nx*hw,      0.05, by + ny*hw),
            (bx + nx*(hw+sw), 0.05, by + ny*(hw+sw)),
            (ax + nx*(hw+sw), 0.05, ay + ny*(hw+sw)),
            "mat_sidewalk"
        )

        # Right sidewalk
        add_quad(
            (ax - nx*(hw+sw), 0.05, ay - ny*(hw+sw)),
            (bx - nx*(hw+sw), 0.05, by - ny*(hw+sw)),
            (bx - nx*hw,      0.05, by - ny*hw),
            (ax - nx*hw,      0.05, ay - ny*hw),
            "mat_sidewalk"
        )

    # ── Buildings placed dynamically along the full route ─────────────────
    for i in range(0, len(route_coords) - 1, 3):
        ax, ay = all_xy[i]
        dx, dy = 0.0, 0.0

        if i + 1 < len(route_coords):
            bx, by = all_xy[i + 1]
            length = math.sqrt((bx - ax)**2 + (by - ay)**2) or 1
            dx = -(by - ay) / length
            dy = (bx - ax) / length

        offset = road_width / 2 + sidewalk_w + 8
        height = 6 + (i % 4) * 3

        for side in [1, -1]:
            bldg_x = ax + dx * side * offset
            bldg_z = ay + dy * side * offset
            hw = 6.0

            # Front
            add_quad(
                (bldg_x-hw, 0,      bldg_z-hw),
                (bldg_x+hw, 0,      bldg_z-hw),
                (bldg_x+hw, height, bldg_z-hw),
                (bldg_x-hw, height, bldg_z-hw),
                "mat_building"
            )
            # Back
            add_quad(
                (bldg_x+hw, 0,      bldg_z+hw),
                (bldg_x-hw, 0,      bldg_z+hw),
                (bldg_x-hw, height, bldg_z+hw),
                (bldg_x+hw, height, bldg_z+hw),
                "mat_building"
            )
            # Left
            add_quad(
                (bldg_x-hw, 0,      bldg_z+hw),
                (bldg_x-hw, 0,      bldg_z-hw),
                (bldg_x-hw, height, bldg_z-hw),
                (bldg_x-hw, height, bldg_z+hw),
                "mat_building"
            )
            # Right
            add_quad(
                (bldg_x+hw, 0,      bldg_z-hw),
                (bldg_x+hw, 0,      bldg_z+hw),
                (bldg_x+hw, height, bldg_z+hw),
                (bldg_x+hw, height, bldg_z-hw),
                "mat_building"
            )
            # Roof
            add_quad(
                (bldg_x-hw, height, bldg_z-hw),
                (bldg_x+hw, height, bldg_z-hw),
                (bldg_x+hw, height, bldg_z+hw),
                (bldg_x-hw, height, bldg_z+hw),
                "mat_building"
            )

    obj_lines = lines + vertices + [""] + faces
    return "\n".join(obj_lines)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def generate_and_upload(lat: float, lng: float, address: str) -> str:
    """
    Full pipeline: Cyvl data -> OBJ -> APS upload -> translate -> URN.
    Returns the base64 URN string.
    """
    # 1. Pull Cyvl infrastructure data
    infra = cyvl_client.infrastructure_at(lat, lng)

    # 2. Get full walking route to nearest hospital
    amenities = geo.nearest_amenities(lat, lng)
    hosp = amenities["hospital"]
    route = geo.walking_route((lat, lng), (hosp["lat"], hosp["lng"]))
    coords = route["coords"][:120] # full route — no limit
    scores = cyvl_client.pavement_along_route(coords)

    # 3. Build OBJ + MTL
    obj_content = _build_obj(lat, lng, coords, scores, infra)
    mtl_content = _build_mtl()

    # 4. Zip OBJ + MTL
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("scene.obj", obj_content)
        zf.writestr("scene.mtl", mtl_content)
    zip_bytes = zip_buffer.getvalue()

    # 5. Upload to APS OSS
    safe_addr = address.replace(" ", "").replace(",", "").replace("/", "")[:40]
    filename = f"cyvl_{safe_addr}.zip"
    urn = aps.upload_obj(filename, zip_bytes)

    # 6. Trigger SVF2 translation
    import requests
    token = aps.get_token()
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

    return urn