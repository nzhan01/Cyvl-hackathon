"""
Autodesk Platform Services (APS) helpers.

Handles 2-legged OAuth, OSS bucket/upload, and Model Derivative translation.
Add to backend/.env:
    APS_CLIENT_ID=your_client_id
    APS_CLIENT_SECRET=your_client_secret
    APS_BUCKET_KEY=walkability-bucket   (optional, defaults below)

All calls degrade gracefully — if credentials are missing, endpoints return
a clear error rather than crashing the whole app.
"""
from __future__ import annotations
import base64
import os
import time

import requests

APS_BASE      = "https://developer.api.autodesk.com"
APS_CLIENT_ID     = os.getenv("APS_CLIENT_ID", "")
APS_CLIENT_SECRET = os.getenv("APS_CLIENT_SECRET", "")
BUCKET_KEY    = os.getenv("APS_BUCKET_KEY", "walkability-tool-bucket")

_UA = "cyvl-hackathon-poc/1.0"

# Simple in-process token cache (token lasts 1h; cache for 55 min)
_token_cache: dict = {"token": None, "expires_at": 0}


def get_token() -> str:
    """Return a valid 2-legged APS bearer token, refreshing if needed."""
    if not APS_CLIENT_ID or not APS_CLIENT_SECRET:
        raise RuntimeError("APS_CLIENT_ID / APS_CLIENT_SECRET not set in .env")

    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"]:
        return _token_cache["token"]

    r = requests.post(
        f"{APS_BASE}/authentication/v2/token",
        headers={"User-Agent": _UA},
        data={
            "client_id": APS_CLIENT_ID,
            "client_secret": APS_CLIENT_SECRET,
            "grant_type": "client_credentials",
            "scope": "data:read data:write data:create bucket:create bucket:read",
        },
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 3600) - 300
    return _token_cache["token"]


def ensure_bucket(token: str) -> None:
    """Create the OSS bucket if it doesn't exist yet."""
    check = requests.get(
        f"{APS_BASE}/oss/v2/buckets/{BUCKET_KEY}/details",
        headers={"Authorization": f"Bearer {token}", "User-Agent": _UA},
        timeout=10,
    )
    if check.status_code == 200:
        return  # already exists

    requests.post(
        f"{APS_BASE}/oss/v2/buckets",
        headers={"Authorization": f"Bearer {token}", "User-Agent": _UA,
                 "Content-Type": "application/json"},
        json={"bucketKey": BUCKET_KEY, "policyKey": "transient"},
        timeout=10,
    )


def upload_obj(filename: str, file_bytes: bytes) -> str:
    """Upload raw bytes to OSS and return the base64-encoded URN."""
    token = get_token()
    ensure_bucket(token)

    r = requests.put(
        f"{APS_BASE}/oss/v2/buckets/{BUCKET_KEY}/objects/{filename}",
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": _UA,
            "Content-Type": "application/octet-stream",
        },
        data=file_bytes,
        timeout=60,
    )
    r.raise_for_status()
    object_id = r.json()["objectId"]
    return base64.b64encode(object_id.encode()).decode()


def translate(urn: str) -> str:
    """Kick off SVF2 translation. Returns result string ('created' or 'success')."""
    token = get_token()
    r = requests.post(
        f"{APS_BASE}/modelderivative/v2/designdata/job",
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": _UA,
            "Content-Type": "application/json",
            "x-ads-force": "true",
        },
        json={
            "input": {"urn": urn},
            "output": {"formats": [{"type": "svf2", "views": ["2d", "3d"]}]},
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("result", "pending")


def translation_status(urn: str) -> dict:
    """Poll the manifest for translation progress."""
    token = get_token()
    r = requests.get(
        f"{APS_BASE}/modelderivative/v2/designdata/{urn}/manifest",
        headers={"Authorization": f"Bearer {token}", "User-Agent": _UA},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    return {"status": data.get("status"), "progress": data.get("progress")}