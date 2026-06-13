"""
FastAPI app — Pedestrian Route Intelligence backend.
Three endpoints (CORS open so the Leaflet/React frontend can hit them):
  POST /api/score-address  {address}        -> {6 scores + issues}
  POST /api/route          {origin, dest}   -> {segments + pavement scores}
  POST /api/report         {address}        -> {scores + claude summary}
  POST /api/aps/token                       -> {access_token}
  POST /api/aps/upload     {filename, file_base64} -> {urn}
  POST /api/aps/translate  {urn}            -> {result, urn}
  GET  /api/aps/status/{urn}                -> {status, progress}
Run:  uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""
from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()

import base64

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import aps
import cyvl_client
import features
import geo
import llm
import generate_model
import scoring
from models import validator

app = FastAPI(title="Pedestrian Route Intelligence", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Train the validation model once at startup (seconds). Used to cross-check that
# the rule-based overall score is internally consistent.
_VALIDATION_MODEL, _VALIDATION_METRICS = validator.train()

# Frontend (gokhul branch) uses these dimension keys; expose as aliases so the
# React code can do dimensions[cat.key] directly. Canonical keys stay too.
FRONTEND_ALIASES = {
    "safety": "outdoor_safety",
    "social": "social_connection",
    "displacement": "displacement_risk",
}


# ── Pydantic models ──────────────────────────────────────────────────────────

class AddressIn(BaseModel):
    address: str | None = None
    lat: float | None = None
    lng: float | None = None

class GenerateModelIn(BaseModel):
    lat: float
    lng: float
    address: str
class RouteIn(BaseModel):
    origin: str
    dest: str

class ApsUploadIn(BaseModel):
    filename: str
    file_base64: str

class ApsTranslateIn(BaseModel):
    urn: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _segment_band(score: float) -> str:
    return "green" if score >= 70 else ("yellow" if score >= 45 else "red")


def _to_latlng(s: str) -> tuple[float, float]:
    if "," in s and all(
        p.strip().lstrip("-").replace(".", "").isdigit() for p in s.split(",", 1)
    ):
        lat, lng = s.split(",", 1)
        return float(lat), float(lng)
    loc = geo.geocode(s)
    if loc is None:
        raise HTTPException(400, f"Could not geocode: {s!r}")
    return loc


# ── Existing routes ──────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "cyvl_live": cyvl_client.CYVL_LIVE}


@app.post("/api/score-address")
def score_address(body: AddressIn):
    try:
        feats = features.build_features(body.address, body.lat, body.lng)
    except ValueError as e:
        raise HTTPException(400, str(e))
    result = scoring.score_all(feats)
    dims = result["dimensions"]

    # Validate the score against the trained model BEFORE adding alias keys
    # (validator expects the canonical 6 keys).
    validation = validator.validate(_VALIDATION_MODEL, dims)

    # Add frontend-friendly aliases alongside the canonical keys.
    for canon, alias in FRONTEND_ALIASES.items():
        dims[alias] = dims[canon]

    issues = []
    if not feats["curb_cut_present"]:
        issues.append("Missing curb ramp near site")
    if feats["curb_cut_damaged"]:
        issues.append("Damaged curb ramp near site")
    if feats["sidewalk_width_m"] < 1.0:
        issues.append("Sidewalk narrower than wheelchair minimum (1.0m)")
    if feats["pavement_score"] < 55:
        issues.append("Poor pavement condition on adjacent street")
    if feats.get("ped_crossing_count", 0) == 0 and feats.get("safety_source") == "CYVL":
        issues.append("No signalized pedestrian crossings detected nearby")
    return {
        "address": feats["address"], "lat": feats["lat"], "lng": feats["lng"],
        "amenities": feats["amenities"], **result,
        "safety_source": feats.get("safety_source"),
        "validation": validation, "issues": issues,
    }


# Repair-cost model (matches the frontend's documented contract).
REPAIR_THRESHOLD = 70      # pavement score at/above which no repair is needed
REPAIR_COST_PER_FT = 45    # $/ft stand-in


@app.post("/api/route")
def route(body: RouteIn):
    origin, dest = _to_latlng(body.origin), _to_latlng(body.dest)
    r = geo.walking_route(origin, dest)
    coords = r["coords"]                      # [(lat, lng), ...]
    detail = cyvl_client.pavement_detail_along_route(coords)

    segments = []
    for i in range(len(coords) - 1):
        a, b = coords[i], coords[i + 1]
        score = detail[i]["score"]
        length_ft = round(geo._haversine_km(a, b) * 1000 * 3.28084)
        repair_cost = round(
            max(0, REPAIR_THRESHOLD - score) * REPAIR_COST_PER_FT * length_ft / 100, 2)
        segments.append({
            "id": i,
            "from": [a[1], a[0]],             # GeoJSON / Mapbox order: [lng, lat]
            "to": [b[1], b[0]],
            "street_name": detail[i]["street_name"],
            "pavement_score": score,
            "band": _segment_band(score),
            "length_ft": length_ft,
            "repair_cost": repair_cost,
        })

    scores = [s["pavement_score"] for s in segments]
    avg = round(sum(scores) / len(scores)) if scores else 0
    total_repair = round(sum(s["repair_cost"] for s in segments), 2)
    return {
        "distance_km": round(r["distance_km"], 3),
        "walkability_score": avg,
        "total_repair_cost": total_repair,
        "segments": segments,
    }


@app.post("/api/report")
def report(body: AddressIn):
    scored = score_address(body)
    summary = llm.summarize(body.address, scored)
    return {**scored, "summary": summary}


# ── APS routes ───────────────────────────────────────────────────────────────

@app.post("/api/aps/token")
def aps_token():
    try:
        token = aps.get_token()
        return {"access_token": token}
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(502, f"APS auth failed: {e}")


@app.post("/api/aps/upload")
def aps_upload(body: ApsUploadIn):
    try:
        file_bytes = base64.b64decode(body.file_base64)
        urn = aps.upload_obj(body.filename, file_bytes)
        return {"urn": urn, "filename": body.filename}
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(502, f"APS upload failed: {e}")


@app.post("/api/aps/translate")
def aps_translate(body: ApsTranslateIn):
    try:
        result = aps.translate(body.urn)
        return {"result": result, "urn": body.urn}
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(502, f"APS translation failed: {e}")


@app.get("/api/aps/status/{urn}")
def aps_status(urn: str):
    try:
        return aps.translation_status(urn)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(502, f"APS status check failed: {e}")
    
@app.post("/api/aps/generate-model")
def aps_generate_model(body: GenerateModelIn):
    """Pull Cyvl data, build OBJ, upload to APS, trigger translation. Returns URN."""
    try:
        urn = generate_model.generate_and_upload(body.lat, body.lng, body.address)
        return {"urn": urn}
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(502, f"Model generation failed: {e}")