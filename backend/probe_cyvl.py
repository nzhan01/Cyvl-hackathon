"""
Cyvl API probe — the "run first query, confirm real data returns" check.

Usage:
    CYVL_API_KEY=... .venv/bin/python probe_cyvl.py
    (or put CYVL_API_KEY in backend/.env first)

Hits a Somerville location (default: near Davis Sq; pass --broadway for Broadway)
and prints how many features come back per layer + the exact `properties` keys,
so we can lock the field-name mapping in cyvl_client._extract_* .
"""
from __future__ import annotations
import json
import sys

from dotenv import load_dotenv
load_dotenv()

import cyvl_client as cc

# Broadway, Somerville (a main corridor) vs. Davis Square default.
LAT, LNG = (42.3990, -71.0980) if "--broadway" in sys.argv else (42.3964, -71.1222)


def probe(path: str, extra: dict | None = None):
    params = {"project_id": cc.PROJECT_ID, "radius_lat": LAT, "radius_lng": LNG,
              "radius_meters": 75, "limit": 5, **(extra or {})}
    fc = cc._get(path, params)
    feats = cc._features(fc)
    print(f"\n=== {path}  ({len(feats)} features) ===")
    if feats:
        print("properties keys:", sorted((feats[0].get('properties') or {}).keys()))
        print("first feature:", json.dumps(feats[0], indent=2)[:800])
    return feats


if __name__ == "__main__":
    if not cc.CYVL_LIVE:
        sys.exit("CYVL_API_KEY not set — add it to backend/.env and retry.")
    print(f"Probing Cyvl at lat={LAT} lng={LNG} (project {cc.PROJECT_ID})")
    probe("/api/v1/pavement/scores")
    probe("/api/v1/assets", {"asset_type": ["RAMP", "SIDEWALK", "CURB"]})
    probe("/api/v1/markings")
