# Project Handoff: Pedestrian Route Intelligence Tool (Cyvl Hackathon)

## Event Context
- **Cyvl Hackathon** — June 13, 2026, Somerville, MA (one-day hackathon, "Build the physical future")
- Sponsors: Cyvl (infrastructure intelligence platform), NVIDIA, Autodesk, AskBoston.ai
- **Real data requirement**: Mock data scores lower with judges. Must use real Cyvl data on Somerville, optionally paired with real external data (Google Maps, OSM, MassGIS, etc.)
- Team has: Cyvl MCP access (live API), $200 Anthropic API credit, Cyvl platform access (cyvl.app)

## Team Background
- Software developer with basic civil engineering / urban planning knowledge
- Working solo or small team; one-day build

---

## The Idea

### Problem Statement
Senior living developers spend millions underwriting demand, demographics, and zoning — but have no systematic way to verify that the physical environment around a candidate site actually supports independent resident mobility. Standard due diligence confirms that a hospital, pharmacy, grocery store, or bus stop is "within walking distance" on a map — but never checks whether the *route* there is actually walkable: continuous sidewalks, curb ramps at every crossing, safe and visible crosswalks. That gap surfaces after the deal closes, as ADA complaints, resident mobility incidents, or unplanned retrofit costs.

### Solution
A **Pedestrian Route Intelligence tool**: enter a candidate address in Somerville → tool identifies nearest hospital, pharmacy/grocery store, and public transit stop → pulls walking routes to each via Google Maps → cross-references the actual streets/sidewalks along each route against Cyvl's infrastructure data (sidewalk presence, curb ramps, crosswalk condition, pavement condition) → produces an **"Actual Walkability Score"** per route, visualized on an interactive map with flagged failure points (e.g., "no curb ramp at this crossing").

### Target Demo Amenities (scoped to 3)
1. **Hospital / urgent care**
2. **Pharmacy / grocery store**
3. **Public transit stop** (bus stop or T station)

---

## App Flow (Core Pipeline)

1. **Input**: User enters a Somerville address
2. **Routing**: Geocode address → find nearest hospital, pharmacy/grocery, transit stop (via Google Places API or hardcoded for demo) → get walking route polyline to each via Google Directions API (walking mode)
3. **Infrastructure Scoring (CORE / MOST IMPORTANT STEP)**:
   - Take the route polyline(s) and identify which streets/segments are traversed
   - Buffer the route geometry (~10-15m) and query Cyvl MCP/API for infrastructure along that buffer:
     - `list_pavement_segments` — pavement condition (PCI score) for streets being walked/crossed
     - `list_above_ground_assets` (filter: `RAMP`, `SIDEWALK`, `CURB`) — presence/absence and condition along the route
     - `list_markings` (filter: crosswalk types — `CONTINENTAL CROSSWALK`, `STANDARD CROSSWALK`, `LADDER CROSSWALK`, `STOP BAR`) — condition at street crossings
   - Break the route into segments (e.g., per block or ~50-100m chunks) and score each segment based on:
     - Sidewalk asset present near segment? (binary or density-based)
     - Curb ramps present at crossing points along segment?
     - Crosswalk condition at crossings (Good/Fair/Poor/None)
     - Pavement condition of crossed roadway (wider/worse roads = harder crossings)
   - Aggregate segment scores → overall "Actual Walkability Score" (0-100) per route/amenity
4. **Output**: Interactive map (Leaflet + OpenStreetMap tiles) showing:
   - The route(s) from address to each amenity, color-coded by segment walkability score (e.g., green/yellow/red)
   - Markers at specific failure points (missing ramp, poor crosswalk, etc.) with popups showing the Cyvl data/image backing the flag
   - Summary score per amenity (e.g., "Hospital: 72/100 — 2 crossings without curb ramps")

---

## Key Cyvl Data Notes (from live exploration)

- **Project**: "City of Somerville, MA Marketing Demo" (project_id: `f15b854a-d203-49c7-bc25-1350dd4a1cd6`)
- Only Somerville is covered (no Boston/Cambridge) — bounds: `[-71.1343408, 42.3734084, -71.0752535, 42.4180395]`
- **Pavement**: 5,080 segments, ~152,000 ft total. ~87% Fair-or-better, ~13% Poor/Very Poor/Serious/Failed
- **Above-ground assets relevant to walkability**:
  - 748 RAMP (curb ramps / ADA ramps)
  - 864 SIDEWALK
  - 915 CURB
  - 149 TRAFFIC_SIGNAL + 215 TRAFFIC_SIGNAL_POLE
  - 164 PEDESTRIAN_PUSH_BUTTON
  - 99 STAND_ALONE_PEDESTRIAN_HEAD
- **Markings/striping relevant to crossings**: crosswalks (Continental, Standard, Ladder — each with condition: Good/Fair/Poor/None), stop bars, handicap symbols
- **Caveat**: Above-ground assets are returned as **points**, not continuous linear sidewalk geometry — scoring needs to work on "asset density/presence near route segment" rather than continuous polyline coverage. Some condition fields return `"unknown"` — verify real condition data exists for the specific route area before building scoring around it.
- Spatial queries available: `bbox`, `radius` (lat/lng/meters), or `polygon` (GeoJSON) — polygon/buffer around route polyline is the natural fit here
- Tool: `query_infrastructure` allows cross-layer queries (pavement, sign, above_ground_asset, distress, striping in one call) — likely your main workhorse for per-segment queries

---

## Tech Stack Decision Points (TO DISCUSS)

### Frontend
- **Map**: Leaflet.js + OpenStreetMap tiles (explicitly requested — free, no API key needed for tiles)
- Framework: React (likely, for state management of route/score data) or could be simpler vanilla JS + Leaflet for speed

### Backend / API layer
- Needs to:
  1. Call Google Maps Directions API (walking) — requires Google Maps API key
  2. Call Cyvl MCP/API for infrastructure data along route buffer
  3. Run the scoring algorithm (geometric buffering + spatial join between route and Cyvl features)
- Candidates: Python (FastAPI/Flask) — strong geospatial libraries (Shapely for buffering/intersection, GeoPandas if needed) vs. Node/TypeScript (turf.js for geospatial ops, consistent with React frontend)
- **Recommendation leaning**: Python backend for geospatial scoring (Shapely + turf-equivalent operations are mature), with a simple REST endpoint the React/Leaflet frontend calls

### Geospatial operations needed
- Decode Google polyline → list of lat/lng points
- Buffer route line by N meters → polygon
- Query Cyvl features within that polygon (or per-segment sub-polygons)
- Spatial join: which Cyvl features fall near which route segment
- Aggregate into segment scores → overall score

### APIs/Keys needed
- Google Maps Platform: Directions API + Places API (nearby search for amenities) — need API key, watch quota/billing
- Cyvl MCP: team API key (provided at kickoff, $200 Anthropic credit separate)
- Optional: Anthropic API (Claude) — could be used for natural-language summary of walkability issues ("This route has 2 missing curb ramps near intersections X and Y")

---

## Open Questions for Next Session
1. Confirm exact Cyvl API endpoint structure for geospatial polygon queries (MCP tools explored: `query_infrastructure`, `list_pavement_segments`, `list_above_ground_assets`, `list_markings` — all support `polygon` GeoJSON filter)
2. Decide scoring algorithm weights (sidewalk presence vs. ramp presence vs. crosswalk condition vs. pavement condition)
3. Decide segment granularity (per-block vs. fixed-distance chunks)
4. Pick 1-2 real Somerville addresses + amenities for the demo (test data availability before committing)
5. Finalize frontend/backend framework choice
6. Scope: how many amenities/routes to actually compute live vs. pre-cache for demo reliability
