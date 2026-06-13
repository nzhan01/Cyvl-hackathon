"""
Google Maps Directions -> per-street walking segments enriched with Cyvl data.

Pipeline (see /api/directions in main.py):
  1. Call the Google Directions API in walking mode
  2. Parse each step (= one street) into a segment with start/end + polyline
  3. For each segment, query Cyvl around the segment midpoint
  4. Attach the Cyvl summary under "infrastructure"

Needs GOOGLE_MAPS_KEY in the environment (enable "Directions API" for the key
in Google Cloud Console). The encoded polyline is passed through untouched —
the frontend decodes it with @mapbox/polyline.
"""
from __future__ import annotations
import os
import re

import requests

import cyvl_client

DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"


def _key() -> str:
    return os.getenv("GOOGLE_MAPS_KEY", "")


def fetch_walking_directions(origin: str, destination: str) -> list[dict]:
    if not _key():
        raise RuntimeError("GOOGLE_MAPS_KEY not set in .env")
    resp = requests.get(
        DIRECTIONS_URL,
        params={"origin": origin, "destination": destination,
                "mode": "walking", "key": _key()},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("status") != "OK":
        msg = data.get("error_message", "")
        raise ValueError(f"Directions API error: {data.get('status')} {msg}".strip())
    return data["routes"][0]["legs"][0]["steps"]


def parse_steps(steps: list[dict]) -> list[dict]:
    segments = []
    for step in steps:
        street = re.sub(r"<[^>]+>", "", step["html_instructions"])
        segments.append({
            "street_name": street,
            "start": step["start_location"],   # {lat, lng}
            "end": step["end_location"],        # {lat, lng}
            "distance_m": step["distance"]["value"],
            "duration_s": step["duration"]["value"],
            "polyline": step["polyline"]["points"],  # pass through to frontend
        })
    return segments


def cyvl_radius_for_segment(seg: dict) -> dict:
    mid_lat = (seg["start"]["lat"] + seg["end"]["lat"]) / 2
    mid_lng = (seg["start"]["lng"] + seg["end"]["lng"]) / 2
    # Google splits walking routes into short (30-80m) steps, so the midpoint
    # radius often hits its floor. 30m was too tight for Cyvl's density here and
    # returned 0 features on most segments; 75m reliably catches the street's
    # data (verified against the live API). Cap at 150m so a very long single
    # step doesn't sweep in parallel/adjacent streets.
    radius_m = min(max(seg["distance_m"] / 2 + 20, 75), 150)
    return {"lat": mid_lat, "lng": mid_lng, "meters": radius_m}


def enrich(origin: str, destination: str) -> list[dict]:
    """Full pipeline: Google steps -> segments -> Cyvl infrastructure per segment."""
    segments = parse_steps(fetch_walking_directions(origin, destination))
    for seg in segments:
        r = cyvl_radius_for_segment(seg)
        seg["infrastructure"] = cyvl_client.segment_infrastructure(
            r["lat"], r["lng"], r["meters"])
    return segments
