# Handoff: `/api/directions` returns empty Cyvl infrastructure for almost every segment

**From:** Nicholas (frontend, `gokhul` branch)
**To:** Backend team (`backend` branch)
**Affected file:** `backend/directions.py` — `cyvl_radius_for_segment()`
**Severity:** Medium — feature works end-to-end but shows "No pavement data" for nearly every street segment

---

## Symptom

On Screen 2 (Route Map), the frontend calls `POST /api/directions` and renders each
returned segment's `infrastructure` block (`pavement_score`, `distress_count`, `signs`).
In practice, almost every segment comes back with:

```json
"infrastructure": { "pavement_score": null, "distress_count": 0, "signs": [] }
```

The frontend handles this gracefully (shows a "No pavement data" tag), but it means the
core feature — per-segment Cyvl infrastructure overlay — is effectively not showing real
data for most routes.

---

## Root cause: search radius per segment is too small for this dataset

`cyvl_radius_for_segment()` in `backend/directions.py` computes the Cyvl query radius as:

```python
def cyvl_radius_for_segment(seg: dict) -> dict:
    mid_lat = (seg["start"]["lat"] + seg["end"]["lat"]) / 2
    mid_lng = (seg["start"]["lng"] + seg["end"]["lng"]) / 2
    radius_m = max(seg["distance_m"] / 2 + 20, 30)  # buffer; min 30m
    return {"lat": mid_lat, "lng": mid_lng, "meters": radius_m}
```

Google's walking directions break routes into many short steps (often 30–80m each), so
`radius_m` usually lands near its **30m floor**. At that radius, Cyvl's
`/api/v1/pavement/scores`, `/api/v1/pavement/distresses`, and `/api/v1/signs` almost
always return **zero features** — even directly on a street with good Cyvl coverage.

### Verified directly against the live Cyvl API

Test point: midpoint of the first segment of a real route ("Highland Avenue", Somerville),
project `f15b854a-d203-49c7-bc25-1350dd4a1cd6`:

| Radius queried | `pavement/scores` results | `pavement/distresses` (med/high) results |
|---|---|---|
| 40m (≈ what the backend currently uses) | **0** | **0** |
| 80m | 10 (scores 62–91, "Highland Avenue") | — |
| 100m | 10+ | 20+ (weathering, patching, alligator cracking, "Highland Avenue") |
| 300m | 10+ | — |

So the endpoints, params (`project_id`, `radius_lat`, `radius_lng`, `radius_meters`),
and auth are all correct — Cyvl genuinely has data here, it's just further from the
route-segment midpoint than the current radius reaches.

`/api/v1/signs` returned 0 even at 100m for this particular point — that may be a real
coverage gap in this area and is lower priority.

---

## Suggested fix

Raise the floor (and possibly the scaling) in `cyvl_radius_for_segment()`:

```python
def cyvl_radius_for_segment(seg: dict) -> dict:
    mid_lat = (seg["start"]["lat"] + seg["end"]["lat"]) / 2
    mid_lng = (seg["start"]["lng"] + seg["end"]["lng"]) / 2
    radius_m = max(seg["distance_m"] / 2 + 20, 75)  # was 30 — too tight for this dataset
    return {"lat": mid_lat, "lng": mid_lng, "meters": radius_m}
```

Recommend testing with a few real routes and tuning the floor (75–100m worked in spot
checks) — too large a radius risks segments picking up data from adjacent/parallel
streets, so it's a tradeoff worth validating visually.

Also worth considering: `segment_infrastructure()` in `cyvl_client.py` queries
`/api/v1/pavement/distresses` without a `severity` filter — fine at this radius, but if
the radius is increased a lot, watch for slower responses on long routes.

---

## How to repro / verify a fix

```bash
curl -s -X POST https://cyvl-hackathon.onrender.com/api/directions \
  -H "Content-Type: application/json" \
  -d '{"origin":"42.3876,-71.0998","destination":"42.3912,-71.0823"}' \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
for s in d['segments']:
    print(s['street_name'][:40], '| pav:', s['infrastructure']['pavement_score'],
          '| distress:', s['infrastructure']['distress_count'],
          '| signs:', len(s['infrastructure']['signs']))
"
```

Before the fix, every segment shows `pav: None | distress: 0 | signs: 0`. After the fix,
segments along streets with Cyvl coverage (e.g. Highland Avenue) should show real
`pavement_score` values and non-zero `distress` counts.
