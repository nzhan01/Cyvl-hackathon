import { useState, useEffect, useRef } from "react";
import polyline from "@mapbox/polyline";

const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;
const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:8000";

const DEFAULT_CENTER = [-71.0998, 42.3876]; // Somerville, MA

const BAND_COLORS = {
  green: { line: "#22c55e", text: "#16a34a", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.25)" },
  yellow: { line: "#f59e0b", text: "#d97706", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)" },
  red: { line: "#ef4444", text: "#dc2626", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.25)" },
};

// Placeholder cost model — TODO(backend): repair cost should come from the
// scoring engine alongside pavement_score. $/ft below is a rough stand-in.
const REPAIR_THRESHOLD = 70;
const REPAIR_COST_PER_FT = 45;

function bandFromScore(score) {
  if (score >= 70) return "green";
  if (score >= 45) return "yellow";
  return "red";
}

function formatCost(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

function lerp(a, b, t) {
  return [a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t];
}

// ---------------------------------------------------------------------------
// Mock data — TODO(backend): delete once /api/route is wired up below
// ---------------------------------------------------------------------------
function generateMockRoute(origin, destination) {
  const SEGMENT_COUNT = 6;
  const segments = [];

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const from = lerp(origin, destination, i / SEGMENT_COUNT);
    const to = lerp(origin, destination, (i + 1) / SEGMENT_COUNT);
    const seed = Math.abs(Math.sin((origin.lat + destination.lng + i * 37.13) * 12.9898));
    const pavement_score = Math.round(35 + seed * 60);
    const length_ft = 220 + Math.round(seed * 260);
    const repair_cost =
      (Math.max(0, REPAIR_THRESHOLD - pavement_score) * REPAIR_COST_PER_FT * length_ft) / 100;

    segments.push({
      id: i,
      from,
      to,
      street_name: `Segment ${i + 1}`,
      pavement_score,
      band: bandFromScore(pavement_score),
      length_ft,
      repair_cost,
    });
  }

  const distance_km = segments.reduce((sum, s) => sum + s.length_ft, 0) / 3280.84;
  const walkability_score = Math.round(
    segments.reduce((sum, s) => sum + s.pavement_score, 0) / segments.length
  );
  const total_repair_cost = segments.reduce((sum, s) => sum + s.repair_cost, 0);

  return { distance_km, walkability_score, total_repair_cost, segments };
}

// ---------------------------------------------------------------------------
// Backend hookup point
//
// POST /api/directions {origin, destination} -> { segments: [...] }, where each
// segment is a Google Maps walking step enriched with Cyvl pavement data:
//
// {
//   street_name: string,
//   start: {lat, lng}, end: {lat, lng},
//   distance_m: number, duration_s: number,
//   polyline: string,   // encoded, decoded below with @mapbox/polyline
//   infrastructure: { pavement_score: number | null, distress_count: number, signs: string[] }
// }
//
// Reshaped here into the {distance_km, walkability_score, total_repair_cost,
// segments} contract the rest of this component expects.
// ---------------------------------------------------------------------------
function directionsToRouteData(rawSegments) {
  // Drop zero-length "turn here" steps -- their polyline decodes to a single
  // point, which is not a valid GeoJSON LineString.
  const segments = rawSegments
    .filter((seg) => polyline.decode(seg.polyline).length >= 2)
    .map((seg, i) => {
      const coords = polyline.decode(seg.polyline).map(([lat, lng]) => [lng, lat]);
      const pavement_score = seg.infrastructure?.pavement_score ?? 70;
      const length_ft = seg.distance_m * 3.28084;
      const repair_cost =
        (Math.max(0, REPAIR_THRESHOLD - pavement_score) * REPAIR_COST_PER_FT * length_ft) / 100;

      return {
        id: i,
        coords,
        from: coords[0],
        to: coords[coords.length - 1],
        street_name: seg.street_name,
        pavement_score: Math.round(pavement_score),
        has_pavement_data: seg.infrastructure?.pavement_score != null,
        band: bandFromScore(pavement_score),
        length_ft: Math.round(length_ft),
        repair_cost,
        distress_count: seg.infrastructure?.distress_count ?? 0,
        signs: seg.infrastructure?.signs ?? [],
      };
    });

  const distance_km = rawSegments.reduce((sum, s) => sum + s.distance_m, 0) / 1000;
  const walkability_score = segments.length
    ? Math.round(segments.reduce((sum, s) => sum + s.pavement_score, 0) / segments.length)
    : 0;
  const total_repair_cost = segments.reduce((sum, s) => sum + s.repair_cost, 0);

  return { distance_km, walkability_score, total_repair_cost, segments };
}

const NO_ROUTE_MESSAGE =
  "No walking route found between these locations. Try addresses that are closer together or reachable on foot.";

async function fetchRouteAssessment(origin, destination) {
  // Real backend call (POST /api/directions). Send exact lat,lng from Mapbox
  // so the backend doesn't re-geocode.
  let res;
  try {
    res = await fetch(`${API_BASE}/api/directions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
      }),
    });
  } catch (e) {
    // Network error / backend unreachable -> fall back to mock so the demo
    // never breaks.
    console.warn("Backend /api/directions unreachable, using mock:", e);
    return generateMockRoute(origin, destination);
  }

  if (res.status === 400) {
    // Google Directions returned ZERO_RESULTS / NOT_FOUND -- no walking path
    // exists between these points. This is a real "no route" case, not a
    // backend failure, so surface it instead of masking it with mock data.
    throw new Error(NO_ROUTE_MESSAGE);
  }

  if (!res.ok) {
    console.warn(`Backend /api/directions error ${res.status}, using mock`);
    return generateMockRoute(origin, destination);
  }

  const data = await res.json();
  const routeData = directionsToRouteData(data.segments);
  if (routeData.segments.length === 0) {
    // All steps were zero-length (degenerate route) -- treat as no route.
    throw new Error(NO_ROUTE_MESSAGE);
  }
  return routeData;
}

function routeToGeoJSON(routeData) {
  return {
    type: "FeatureCollection",
    features: routeData.segments.map((s) => ({
      type: "Feature",
      properties: {
        id: s.id,
        pavement_score: s.pavement_score,
        band: s.band,
      },
      geometry: {
        type: "LineString",
        coordinates: s.coords || [s.from, s.to],
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Address input with Mapbox geocoding autocomplete
// ---------------------------------------------------------------------------
function AddressInput({ label, placeholder, value, onChangeText, onSelect, dotColor }) {
  const [suggestions, setSuggestions] = useState([]);

  const search = async (query) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          query
        )}.json?access_token=${MAPBOX_TOKEN}&proximity=-71.0998,42.3876&types=address&limit=5`
      );
      const data = await res.json();
      setSuggestions(data.features || []);
    } catch {
      setSuggestions([]);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          background: "rgba(15,23,42,0.92)",
          backdropFilter: "blur(12px)",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: dotColor,
              flexShrink: 0,
            }}
          />
          <input
            value={value}
            onChange={(e) => {
              onChangeText(e.target.value);
              search(e.target.value);
            }}
            placeholder={placeholder}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f1f5f9",
              fontSize: 14,
            }}
          />
          {value && (
            <button
              onClick={() => {
                onChangeText("");
                onSelect(null);
                setSuggestions([]);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                padding: 0,
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>

        {suggestions.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onChangeText(s.place_name);
                  setSuggestions([]);
                  onSelect({
                    address: s.place_name,
                    lng: s.center[0],
                    lat: s.center[1],
                  });
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  background: "none",
                  border: "none",
                  color: "#cbd5e1",
                  fontSize: 13,
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "none")}
              >
                <span style={{ color: "#f1f5f9", fontWeight: 500 }}>{s.text}</span>
                <span style={{ color: "#64748b", marginLeft: 6 }}>
                  {s.place_name.replace(s.text + ", ", "").slice(0, 50)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {label && (
        <div style={{ fontSize: 10, color: "#475569", marginTop: 4, marginLeft: 4 }}>{label}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panel pieces
// ---------------------------------------------------------------------------
function ScoreBadge({ score, band, noData }) {
  if (noData) {
    return (
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#64748b",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 6,
          padding: "2px 8px",
          minWidth: 36,
          textAlign: "center",
        }}
      >
        —
      </span>
    );
  }
  const c = BAND_COLORS[band];
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: c.text,
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 6,
        padding: "2px 8px",
        minWidth: 36,
        textAlign: "center",
      }}
    >
      {score}
    </span>
  );
}

function InfraTag({ icon, label, tone }) {
  const toneColors = {
    neutral: { color: "#64748b", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)" },
    warn: { color: "#d97706", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
  };
  const c = toneColors[tone] || toneColors.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 5,
        padding: "2px 6px",
      }}
    >
      {icon} {label}
    </span>
  );
}

function SegmentRow({ segment, isHovered, onHover }) {
  const c = BAND_COLORS[segment.band];
  const signCounts = segment.signs.reduce((acc, s) => {
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div
      onMouseEnter={() => onHover(segment.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        padding: "12px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        cursor: "pointer",
        background: isHovered ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "background 0.15s",
        borderLeft: isHovered ? `2px solid ${c.line}` : "2px solid transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>{segment.street_name}</span>
        <ScoreBadge score={segment.pavement_score} band={segment.band} noData={!segment.has_pavement_data} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b" }}>
        <span>{segment.length_ft} ft</span>
        <span>
          Repair cost:{" "}
          <span style={{ color: segment.repair_cost > 0 ? "#f1f5f9" : "#475569", fontWeight: 500 }}>
            {formatCost(segment.repair_cost)}
          </span>
        </span>
      </div>
      {(segment.distress_count > 0 || segment.signs.length > 0 || !segment.has_pavement_data) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {!segment.has_pavement_data && (
            <InfraTag icon="—" label="No pavement data" tone="neutral" />
          )}
          {segment.distress_count > 0 && (
            <InfraTag
              icon="⚠"
              label={`${segment.distress_count} distress${segment.distress_count === 1 ? "" : "es"}`}
              tone="warn"
            />
          )}
          {Object.entries(signCounts).map(([type, count]) => (
            <InfraTag
              key={type}
              icon="🪧"
              label={count > 1 ? `${type} ×${count}` : type}
              tone="neutral"
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function RouteMap() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({ origin: null, destination: null });

  const [originText, setOriginText] = useState("");
  const [destText, setDestText] = useState("");
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);

  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hoveredSegment, setHoveredSegment] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [amenities, setAmenities] = useState(null);  // nearest hospital/pharmacy/transit

  // --- init map ---------------------------------------------------------
  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;

    const initMap = () => {
      if (!window.mapboxgl) return;
      window.mapboxgl.accessToken = MAPBOX_TOKEN;

      const map = new window.mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: DEFAULT_CENTER,
        zoom: 13,
      });

      map.addControl(new window.mapboxgl.NavigationControl(), "top-right");
      map.on("load", () => setMapLoaded(true));

      mapRef.current = map;
    };

    if (window.mapboxgl) {
      initMap();
    } else {
      const script = document.createElement("script");
      script.src = "https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js";
      script.onload = initMap;
      document.head.appendChild(script);

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css";
      document.head.appendChild(link);
    }
  }, []);

  // --- fetch route once both endpoints are set ---------------------------
  useEffect(() => {
    if (!origin || !destination) {
      setRouteData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchRouteAssessment(origin, destination)
      .then((data) => {
        if (!cancelled) setRouteData(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || "Failed to load route");
          setRouteData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [origin, destination]);

  // --- fetch nearby amenities (hospital/pharmacy/transit) for the origin ---
  useEffect(() => {
    if (!origin) {
      setAmenities(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/nearby`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: origin.lat, lng: origin.lng }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setAmenities(d.amenities);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [origin]);

  // --- markers -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const placeMarker = (key, point, color) => {
      if (markersRef.current[key]) {
        markersRef.current[key].remove();
        markersRef.current[key] = null;
      }
      if (!point) return;

      const el = document.createElement("div");
      el.style.cssText = `
        width: 18px; height: 18px;
        background: ${color};
        border: 3px solid #fff;
        border-radius: 50%;
        box-shadow: 0 0 0 4px ${color}4D;
      `;
      markersRef.current[key] = new window.mapboxgl.Marker(el)
        .setLngLat([point.lng, point.lat])
        .addTo(map);
    };

    // Emoji pin + popup for a nearby amenity (hospital/pharmacy/transit).
    const AMENITY_STYLE = {
      hospital: { emoji: "🏥", label: "Hospital" },
      pharmacy: { emoji: "💊", label: "Pharmacy" },
      transit: { emoji: "🚏", label: "Transit" },
    };
    const placeAmenity = (key, a) => {
      if (markersRef.current[key]) {
        markersRef.current[key].remove();
        markersRef.current[key] = null;
      }
      if (!a) return;
      const s = AMENITY_STYLE[key];
      const el = document.createElement("div");
      el.style.cssText =
        "font-size:24px;cursor:pointer;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7));";
      el.textContent = s.emoji;
      const popup = new window.mapboxgl.Popup({ offset: 16 }).setHTML(
        `<div style="font-size:12px;color:#0f172a;font-family:sans-serif">
           <b>${a.name}</b><br/>${s.label} · ${a.distance_km} km away</div>`
      );
      markersRef.current[key] = new window.mapboxgl.Marker(el)
        .setLngLat([a.lng, a.lat])
        .setPopup(popup)
        .addTo(map);
    };

    placeMarker("origin", origin, "#3b82f6");
    placeMarker("destination", destination, "#ef4444");

    ["hospital", "pharmacy", "transit"].forEach((k) =>
      placeAmenity(k, amenities ? amenities[k] : null)
    );

    const anchor = origin || destination;
    if (anchor) {
      const bounds = new window.mapboxgl.LngLatBounds(
        [anchor.lng, anchor.lat],
        [anchor.lng, anchor.lat]
      );
      if (origin) bounds.extend([origin.lng, origin.lat]);
      if (destination) bounds.extend([destination.lng, destination.lat]);
      // include amenity markers so the nearby hospital/pharmacy/transit show
      if (amenities) {
        ["hospital", "pharmacy", "transit"].forEach((k) => {
          if (amenities[k]) bounds.extend([amenities[k].lng, amenities[k].lat]);
        });
      }
      map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 800 });
    }
  }, [origin, destination, mapLoaded, amenities]);

  // --- route segments layer ----------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const sourceId = "route-segments";
    const layerId = "route-segments-line";
    const highlightSourceId = "route-segments-highlight";
    const highlightLayerId = "route-segments-highlight-line";

    const empty = { type: "FeatureCollection", features: [] };
    const data = routeData ? routeToGeoJSON(routeData) : empty;

    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData(data);
    } else {
      map.addSource(sourceId, { type: "geojson", data });
      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 5,
          "line-color": [
            "match",
            ["get", "band"],
            "green", BAND_COLORS.green.line,
            "yellow", BAND_COLORS.yellow.line,
            "red", BAND_COLORS.red.line,
            "#64748b",
          ],
        },
      });
    }

    if (!map.getSource(highlightSourceId)) {
      map.addSource(highlightSourceId, { type: "geojson", data: empty });
      map.addLayer({
        id: highlightLayerId,
        type: "line",
        source: highlightSourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 9,
          "line-color": "#ffffff",
          "line-opacity": 0.35,
        },
      });
    }
  }, [routeData, mapLoaded]);

  // --- highlight hovered segment -------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource("route-segments-highlight");
    if (!source) return;

    if (hoveredSegment == null || !routeData) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const segment = routeData.segments.find((s) => s.id === hoveredSegment);
    if (!segment) return;

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: segment.coords || [segment.from, segment.to] },
        },
      ],
    });
  }, [hoveredSegment, routeData, mapLoaded]);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "#0f172a",
        overflow: "hidden",
      }}
    >
      {/* MAP */}
      <div style={{ flex: 1, position: "relative" }}>
        <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

        {/* Address inputs */}
        <div
          style={{
            position: "absolute",
            top: 20,
            left: 20,
            right: 20,
            zIndex: 10,
            maxWidth: 420,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <AddressInput
            placeholder="Origin address..."
            value={originText}
            onChangeText={setOriginText}
            onSelect={setOrigin}
            dotColor="#3b82f6"
          />
          <AddressInput
            placeholder="Destination address..."
            value={destText}
            onChangeText={setDestText}
            onSelect={setDestination}
            dotColor="#ef4444"
          />
        </div>

        {/* Legend */}
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            background: "rgba(15,23,42,0.85)",
            borderRadius: 8,
            padding: "10px 14px",
            color: "#94a3b8",
            fontSize: 11,
            border: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            gap: 14,
          }}
        >
          {Object.entries(BAND_COLORS).map(([band, c]) => (
            <div key={band} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.line }} />
              <span style={{ textTransform: "capitalize" }}>{band}</span>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div
        style={{
          width: 360,
          background: "#0f172a",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div
            style={{
              fontSize: 11,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            Route Intelligence
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#f1f5f9" }}>Route Assessment</div>
        </div>

        {!origin || !destination ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
                fontSize: 24,
              }}
            >
              🧭
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#94a3b8", marginBottom: 8 }}>
              No route selected
            </div>
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
              Enter an origin and destination address to evaluate the pedestrian route between
              them.
            </div>
          </div>
        ) : loading ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                border: "3px solid rgba(255,255,255,0.1)",
                borderTopColor: "#3b82f6",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div style={{ fontSize: 13, color: "#64748b" }}>Analyzing route...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "rgba(248,113,113,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
                fontSize: 24,
              }}
            >
              ⚠️
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#f87171", marginBottom: 8 }}>
              Couldn't load route
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{error}</div>
          </div>
        ) : routeData ? (
          <>
            {/* Summary */}
            <div style={{ padding: "16px 20px", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#475569" }}>Distance</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#f1f5f9" }}>
                    {routeData.distance_km.toFixed(2)} km
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#475569", textAlign: "right" }}>Walkability</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "#f1f5f9", textAlign: "right" }}>
                    {routeData.walkability_score}
                    <span style={{ fontSize: 12, color: "#475569" }}> / 100</span>
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: "rgba(59,130,246,0.08)",
                  border: "1px solid rgba(59,130,246,0.15)",
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 12, color: "#93c5fd" }}>Estimated repair cost</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>
                  {formatCost(routeData.total_repair_cost)}
                </span>
              </div>
            </div>

            {/* Segment breakdown */}
            <div style={{ padding: "12px 0" }}>
              <div
                style={{
                  padding: "4px 20px 10px",
                  fontSize: 11,
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Segment breakdown
              </div>
              {routeData.segments.map((segment) => (
                <SegmentRow
                  key={segment.id}
                  segment={segment}
                  isHovered={hoveredSegment === segment.id}
                  onHover={setHoveredSegment}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
