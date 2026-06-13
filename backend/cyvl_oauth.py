"""
Cyvl OAuth login — get a Bearer token via Authorization Code + PKCE.

The Cyvl Data API (i3.cyvl.app) is a protected resource of the cyvl.app auth
server. This script runs the full browser login flow and writes the resulting
access token into backend/.env as CYVL_API_KEY (and CYVL_REFRESH_TOKEN).

Run:
    cd backend && .venv/bin/python cyvl_oauth.py

It will:
  1. Dynamically register a public OAuth client (no secret, PKCE).
  2. Open your browser to cyvl.app to log in + consent.
  3. Catch the redirect on http://localhost:8765/callback.
  4. Exchange the code for an access token.
  5. Verify the token against /api/v1/projects and save it to .env.
"""
from __future__ import annotations
import base64
import hashlib
import http.server
import json
import secrets
import threading
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

AUTH_BASE = "https://cyvl.app/auth/v1/oauth"
AUTHORIZE = f"{AUTH_BASE}/authorize"
TOKEN = f"{AUTH_BASE}/token"
REGISTER = f"{AUTH_BASE}/clients/register"
RESOURCE = "https://i3.cyvl.app"
REDIRECT_URI = "http://localhost:8765/callback"
SCOPE = "openid email profile"
ENV_PATH = Path(__file__).resolve().parent / ".env"

_auth_code: dict = {}
# cyvl.app's WAF rejects the default Python-urllib agent -> use a browser UA.
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def _post_json(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "User-Agent": _UA,
                 "Accept": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _post_form(url: str, form: dict) -> dict:
    req = urllib.request.Request(
        url, data=urllib.parse.urlencode(form).encode(),
        headers={"content-type": "application/x-www-form-urlencoded",
                 "User-Agent": _UA, "Accept": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(40)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.urlparse(self.path)
        if q.path != "/callback":
            self.send_response(404); self.end_headers(); return
        params = urllib.parse.parse_qs(q.query)
        _auth_code.update({k: v[0] for k, v in params.items()})
        self.send_response(200)
        self.send_header("content-type", "text/html"); self.end_headers()
        ok = "code" in _auth_code
        self.wfile.write(
            (f"<h2>{'✅ Login complete' if ok else '❌ Login failed'}</h2>"
             "<p>You can close this tab and return to the terminal.</p>").encode())

    def log_message(self, *a):  # silence
        pass


def _save_env(key: str, value: str):
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    out, found = [], False
    for ln in lines:
        if ln.startswith(f"{key}="):
            out.append(f"{key}={value}"); found = True
        else:
            out.append(ln)
    if not found:
        out.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(out) + "\n")


def main():
    print("1/4  Registering OAuth client …")
    client = _post_json(REGISTER, {
        "client_name": "cyvl-hackathon-poc",
        "redirect_uris": [REDIRECT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": SCOPE,
    })
    client_id = client["client_id"]

    verifier, challenge = _pkce()
    state = secrets.token_urlsafe(16)
    auth_url = AUTHORIZE + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": client_id,
        "redirect_uri": REDIRECT_URI, "scope": SCOPE, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
        "resource": RESOURCE,
    })

    server = http.server.HTTPServer(("localhost", 8765), _Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()

    print("2/4  Opening browser to log in … if it doesn't open, paste this URL:\n")
    print("    " + auth_url + "\n")
    webbrowser.open(auth_url)

    print("3/4  Waiting for you to log in + authorize …")
    server.socket.settimeout(180)
    while "code" not in _auth_code and "error" not in _auth_code:
        threading.Event().wait(0.5)
    if "error" in _auth_code:
        raise SystemExit(f"Authorization failed: {_auth_code}")
    if _auth_code.get("state") != state:
        raise SystemExit("State mismatch — aborting (possible CSRF).")

    print("4/4  Exchanging code for token …")
    tok = _post_form(TOKEN, {
        "grant_type": "authorization_code", "code": _auth_code["code"],
        "redirect_uri": REDIRECT_URI, "client_id": client_id,
        "code_verifier": verifier, "resource": RESOURCE,
    })
    access = tok["access_token"]
    _save_env("CYVL_API_KEY", access)
    if tok.get("refresh_token"):
        _save_env("CYVL_REFRESH_TOKEN", tok["refresh_token"])

    # Verify against the data API.
    req = urllib.request.Request(
        f"{RESOURCE}/api/v1/projects?limit=1",
        headers={"Authorization": f"Bearer {access}", "User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read()[:200]
        print("\n✅ Token works against the Cyvl API. Saved to .env (CYVL_API_KEY).")
        print("   /api/v1/projects ->", body.decode(errors="replace"))
    except Exception as e:
        print(f"\n⚠️  Token saved but test call failed: {e}")
        print("   The token may lack data-read scope. Tell me the error.")


if __name__ == "__main__":
    main()
