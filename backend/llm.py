"""
Claude summary for the Screen-4 report: two-sentence plain-English risk summary
from raw dimension scores. Falls back to a deterministic template if no API key
is set, so the demo never breaks on a network/credential issue.

Model: claude-haiku-4-5-20251001 (fast + cheap; plenty for a 2-sentence summary).
Set ANTHROPIC_API_KEY in the environment to enable the live call.
"""
from __future__ import annotations
import os

MODEL = "claude-haiku-4-5-20251001"


def _template(address: str, result: dict) -> str:
    dims = result["dimensions"]
    overall = result["overall"]
    worst = min(dims, key=dims.get)
    best = max(dims, key=dims.get)
    return (f"{address} scores {overall}/100 for aging livability, with its "
            f"strongest support in {best} ({dims[best]}) and its biggest gap in "
            f"{worst} ({dims[worst]}). Acquisition teams should weigh the "
            f"{worst.replace('_', ' ')} risk before committing to this site.")


def summarize(address: str, result: dict) -> str:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return _template(address, result)
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=key)
        dims = result["dimensions"]
        prompt = (
            "You are advising a senior-living acquisition team. In exactly two "
            "plain-English sentences, summarize the aging-livability risk for this "
            f"candidate site.\nAddress: {address}\nOverall: {result['overall']}/100\n"
            f"Dimension scores (0-100, higher is better): {dims}\n"
            "Name the weakest dimension and what it means for elderly residents.")
        msg = client.messages.create(
            model=MODEL, max_tokens=180,
            messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text.strip()
    except Exception:
        return _template(address, result)
