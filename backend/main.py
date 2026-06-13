"""
FastAPI app — Pedestrian Route Intelligence backend.

Three endpoints (CORS open so the Leaflet/React frontend can hit them):
  POST /api/score-address  {address}        -> {6 scores + issues}
  POST /api/route          {origin, dest}   -> {segments + pavement scores}
  POST /api/report         {address}        -> {scores + claude summary}

Run:  uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""
from __future__ import annotations
from dotenv import load_dotenv
load_dotenv()  # pull ANTHROPIC_API_KEY / CYVL_LIVE from backend/.env

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import cyvl_client
import features
import geo
import llm
import scoring

app = FastAPI(title="Pedestrian Route Intelligence", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class AddressIn(BaseModel):
    address: str | None = None
    lat: float | None = None   # optional: from browser geolocation
    lng: float | None = None


class RouteIn(BaseModel):
    origin: str   # address or "lat,lng"
    dest: str


def _segment_band(score: float) -> str:
    return "green" if score >= 70 else ("yellow" if score >= 45 else "red")


def _to_latlng(s: str) -> tuple[float, float]:
    if "," in s and all(p.strip().lstrip("-").replace(".", "").isdigit()
                        for p in s.split(",", 1)):
        lat, lng = s.split(",", 1)
        return float(lat), float(lng)
    loc = geo.geocode(s)
    if loc is None:
        raise HTTPException(400, f"Could not geocode: {s!r}")
    return loc


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
    issues = []
    if not feats["curb_cut_present"]:
        issues.append("Missing curb ramp near site")
    if feats["curb_cut_damaged"]:
        issues.append("Damaged curb ramp near site")
    if feats["sidewalk_width_m"] < 1.0:
        issues.append("Sidewalk narrower than wheelchair minimum (1.0m)")
    if feats["pavement_score"] < 55:
        issues.append("Poor pavement condition on adjacent street")
    return {"address": feats["address"], "lat": feats["lat"], "lng": feats["lng"],
            "amenities": feats["amenities"], **result, "issues": issues}


@app.post("/api/route")
def route(body: RouteIn):
    origin, dest = _to_latlng(body.origin), _to_latlng(body.dest)
    r = geo.walking_route(origin, dest)
    scores = cyvl_client.pavement_along_route(r["coords"])
    segments = [
        {"from": list(r["coords"][i]), "to": list(r["coords"][i + 1]),
         "pavement_score": scores[i], "band": _segment_band(scores[i])}
        for i in range(len(r["coords"]) - 1)
    ]
    avg = round(sum(scores) / len(scores)) if scores else 0
    return {"distance_km": round(r["distance_km"], 3), "walkability_score": avg,
            "segments": segments}


@app.post("/api/report")
def report(body: AddressIn):
    scored = score_address(body)
    summary = llm.summarize(body.address, scored)
    return {**scored, "summary": summary}
