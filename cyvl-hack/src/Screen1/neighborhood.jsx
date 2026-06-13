import { useState, useEffect, useRef } from "react";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const SCORE_CATEGORIES = [
  { key: "navigation", label: "Navigation", icon: "🧭", score: 72 },
  { key: "healthcare", label: "Healthcare", icon: "🏥", score: 88 },
  { key: "outdoor_safety", label: "Outdoor safety", icon: "🛡️", score: 55 },
  { key: "emergency", label: "Emergency", icon: "🚨", score: 91 },
  {
    key: "social_connection",
    label: "Social connection",
    icon: "🤝",
    score: 63,
  },
  {
    key: "displacement_risk",
    label: "Displacement risk",
    icon: "⚠️",
    score: 44,
  },
];

function ScoreBar({ score }) {
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div
      style={{
        flex: 1,
        height: 6,
        background: "#e5e7eb",
        borderRadius: 99,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${score}%`,
          height: "100%",
          background: color,
          borderRadius: 99,
          transition: "width 0.6s ease",
        }}
      />
    </div>
  );
}

function ScoreBadge({ score }) {
  const color = score >= 75 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  const bg = score >= 75 ? "#dcfce7" : score >= 50 ? "#fef3c7" : "#fee2e2";
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color,
        background: bg,
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

function OverallScore({ score }) {
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ position: "relative", width: 88, height: 88 }}>
      <svg width="88" height="88" style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx="44"
          cy="44"
          r="36"
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="7"
        />
        <circle
          cx="44"
          cy="44"
          r="36"
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#111827",
            lineHeight: 1,
          }}
        >
          {score}
        </span>
        <span style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
          / 100
        </span>
      </div>
    </div>
  );
}

export default function WalkabilityMap() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  const overallScore = selectedSite
    ? Math.round(
        SCORE_CATEGORIES.reduce((sum, c) => sum + c.score, 0) /
          SCORE_CATEGORIES.length
      )
    : null;

  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;

    const initMap = () => {
      if (!window.mapboxgl) return;
      window.mapboxgl.accessToken = MAPBOX_TOKEN;

      const map = new window.mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [-71.0998, 42.3876],
        zoom: 13,
        pitch: 45,
        bearing: -10,
      });

      map.addControl(new window.mapboxgl.NavigationControl(), "top-right");

      map.on("load", () => {
        map.addLayer({
          id: "3d-buildings",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          type: "fill-extrusion",
          minzoom: 12,
          paint: {
            "fill-extrusion-color": "#1e293b",
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": 0.85,
          },
        });
        setMapLoaded(true);
      });

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

  const searchAddress = async (query) => {
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

  const handleSelect = (feature) => {
    const [lng, lat] = feature.center;
    setAddress(feature.place_name);
    setSuggestions([]);
    setLoading(true);

    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [lng, lat],
        zoom: 16,
        pitch: 55,
        bearing: -15,
        duration: 1800,
      });

      if (markerRef.current) markerRef.current.remove();

      const el = document.createElement("div");
      el.style.cssText = `
        width: 18px; height: 18px;
        background: #ef4444;
        border: 3px solid #fff;
        border-radius: 50%;
        box-shadow: 0 0 0 4px rgba(239,68,68,0.3);
      `;

      markerRef.current = new window.mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .addTo(mapRef.current);
    }

    setTimeout(() => {
      setSelectedSite({ address: feature.place_name, lng, lat });
      setLoading(false);
    }, 1200);
  };

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

        {/* Address search overlay on map */}
        <div
          style={{
            position: "absolute",
            top: 20,
            left: 20,
            right: 20,
            zIndex: 10,
            maxWidth: 420,
          }}
        >
          <div
            style={{
              background: "rgba(15,23,42,0.92)",
              backdropFilter: "blur(12px)",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              overflow: "visible",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 14px",
                gap: 10,
              }}
            >
              <svg
                width="16"
                height="16"
                fill="none"
                viewBox="0 0 24 24"
                stroke="#94a3b8"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  searchAddress(e.target.value);
                }}
                placeholder="Enter a candidate address in Somerville..."
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#f1f5f9",
                  fontSize: 14,
                }}
              />
              {address && (
                <button
                  onClick={() => {
                    setAddress("");
                    setSuggestions([]);
                    setSelectedSite(null);
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
                    onClick={() => handleSelect(s)}
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
                    onMouseOver={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(255,255,255,0.06)")
                    }
                    onMouseOut={(e) =>
                      (e.currentTarget.style.background = "none")
                    }
                  >
                    <span style={{ color: "#f1f5f9", fontWeight: 500 }}>
                      {s.text}
                    </span>
                    <span style={{ color: "#64748b", marginLeft: 6 }}>
                      {s.place_name.replace(s.text + ", ", "").slice(0, 50)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Map label */}
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            background: "rgba(15,23,42,0.8)",
            borderRadius: 8,
            padding: "6px 12px",
            color: "#64748b",
            fontSize: 11,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          Somerville, MA · Pedestrian Route Intelligence
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div
        style={{
          width: 340,
          background: "#0f172a",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 20px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            Walkability Intelligence
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#f1f5f9" }}>
            Site Assessment
          </div>
        </div>

        {!selectedSite && !loading && (
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
              📍
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "#94a3b8",
                marginBottom: 8,
              }}
            >
              No site selected
            </div>
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
              Enter a candidate address on the map to evaluate pedestrian route
              conditions.
            </div>
          </div>
        )}

        {loading && (
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
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Analyzing routes...
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {selectedSite && !loading && (
          <>
            {/* Street name + overall score */}
            <div
              style={{
                padding: "16px 20px",
                background: "rgba(255,255,255,0.03)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#f1f5f9",
                      lineHeight: 1.4,
                    }}
                  >
                    {selectedSite.address.split(",")[0]}
                  </div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>
                    {selectedSite.address.split(",").slice(1, 3).join(",")}
                  </div>
                </div>
                <OverallScore score={overallScore} />
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: "rgba(59,130,246,0.15)",
                    color: "#93c5fd",
                    border: "1px solid rgba(59,130,246,0.2)",
                  }}
                >
                  Senior Living Candidate
                </span>
                <span
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.05)",
                    color: "#64748b",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  Somerville, MA
                </span>
              </div>
            </div>

            {/* Score categories */}
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
                Route breakdown
              </div>

              {SCORE_CATEGORIES.map((cat, i) => (
                <div
                  key={cat.key}
                  style={{
                    padding: "12px 20px",
                    borderBottom:
                      i < SCORE_CATEGORIES.length - 1
                        ? "1px solid rgba(255,255,255,0.04)"
                        : "none",
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.03)")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span style={{ fontSize: 15 }}>{cat.icon}</span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "#cbd5e1",
                        }}
                      >
                        {cat.label}
                      </span>
                    </div>
                    <ScoreBadge score={cat.score} />
                  </div>
                  <ScoreBar score={cat.score} />
                </div>
              ))}
            </div>

            {/* Footer action */}
            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                marginTop: "auto",
              }}
            >
              <button
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: "#1d4ed8",
                  border: "none",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <span>Generate full report</span>
                <svg
                  width="14"
                  height="14"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
