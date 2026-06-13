import { useState, useEffect, useRef } from "react";

const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;
const API_BASE = "https://cyvl-hackathon.onrender.com";
const APS_VIEWER_VERSION = "7.*";

// Metadata only — scores come live from the backend (no mock values).
const SCORE_CATEGORIES = [
  {
    key: "navigation",
    label: "Navigation",
    icon: "🧭",
    description:
      "How easy it is to find your way around — sidewalk continuity, signage, and intersection clarity along nearby routes.",
  },
  {
    key: "healthcare",
    label: "Healthcare",
    icon: "🏥",
    description:
      "Proximity and accessibility of healthcare facilities such as hospitals, clinics, and pharmacies.",
  },
  {
    key: "outdoor_safety",
    label: "Outdoor safety",
    icon: "🛡️",
    description:
      "Condition of sidewalks, crossings, lighting, and other infrastructure that affects safety while walking outdoors.",
  },
  {
    key: "emergency",
    label: "Emergency",
    icon: "🚨",
    description:
      "How quickly emergency services (fire, police, EMS) can reach this location based on proximity and road access.",
  },
  {
    key: "social_connection",
    label: "Social connection",
    icon: "🤝",
    description:
      "Access to community spaces, parks, and gathering points that support social interaction for residents.",
  },
  {
    key: "displacement_risk",
    label: "Displacement risk",
    icon: "⚠️",
    description:
      "Likelihood of residents being displaced due to rising costs or development pressure in the surrounding area.",
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
            color: "#f1f5f9",
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

// ── APS Viewer Panel ──────────────────────────────────────────────────────────
function APSViewerPanel({ site, onClose }) {
  const viewerContainer = useRef(null);
  const viewerRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [statusMsg, setStatusMsg] = useState("Connecting to Autodesk...");

  const loadViewerSDK = () =>
    new Promise((resolve, reject) => {
      if (window.Autodesk?.Viewing) {
        resolve();
        return;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${APS_VIEWER_VERSION}/style.min.css`;
      document.head.appendChild(link);
      const script = document.createElement("script");
      script.src = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${APS_VIEWER_VERSION}/viewer3D.min.js`;
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error("Failed to load Autodesk Viewer SDK"));
      document.head.appendChild(script);
    });

  const pollStatus = async (urn) => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(
        `${API_BASE}/api/aps/status/${encodeURIComponent(urn)}`
      );
      const data = await res.json();
      setStatusMsg(`Translating 3D model... ${data.progress || ""}`);
      if (data.status === "success") return true;
      if (data.status === "failed") throw new Error("Model translation failed");
    }
    throw new Error("Translation timed out");
  };

  const loadModel = (viewer, urn, token) =>
    new Promise((resolve, reject) => {
      window.Autodesk.Viewing.Document.load(
        `urn:${urn}`,
        (doc) => {
          const node = doc.getRoot().getDefaultGeometry();
          viewer.loadDocumentNode(doc, node).then(resolve).catch(reject);
        },
        (err) => reject(new Error(`Document load failed: ${err}`))
      );
    });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!site?.lat || !site?.lng || !site?.address) {
        setStatus("error");
        setStatusMsg("No site selected — please select an address first.");
        return;
      }
      try {
        // Step 1 — Get APS token
        setStatusMsg("Authenticating with Autodesk...");
        const tokenRes = await fetch(`${API_BASE}/api/aps/token`, {
          method: "POST",
        });
        if (!tokenRes.ok) throw new Error("aps_credentials");
        const { access_token } = await tokenRes.json();
        if (cancelled) return;

        // Step 2 — Load viewer SDK
        setStatusMsg("Loading 3D viewer SDK...");
        await loadViewerSDK();
        if (cancelled) return;

        // Step 3 — Initialize viewer
        setStatusMsg("Initializing viewer...");
        await new Promise((resolve, reject) => {
          window.Autodesk.Viewing.Initializer(
            { env: "AutodeskProduction", accessToken: access_token },
            () => resolve(),
            (err) => reject(err)
          );
        });
        if (cancelled) return;

        const viewer = new window.Autodesk.Viewing.GuiViewer3D(
          viewerContainer.current,
          { extensions: ["Autodesk.DefaultTools.NavTools"] }
        );
        viewer.start();
        viewerRef.current = viewer;

        // Step 4 — Generate model from Cyvl data
        setStatusMsg("Generating 3D model from Cyvl street data...");
        const genRes = await fetch(`${API_BASE}/api/aps/generate-model`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: site.lat,
            lng: site.lng,
            address: site.address,
          }),
        });
        if (!genRes.ok) throw new Error("Model generation failed");
        const { urn } = await genRes.json();
        if (cancelled) return;

        // Step 5 — Poll until translation complete
        setStatusMsg("Translating model for 3D viewer...");
        await pollStatus(urn);
        if (cancelled) return;

        // Step 6 — Load model into viewer
        setStatusMsg("Loading 3D scene...");
        await loadModel(viewer, urn, access_token);
        if (cancelled) return;

        setStatus("ready");
        setStatusMsg("");
      } catch (err) {
        if (cancelled) return;
        console.error("APS pipeline error:", err);
        if (err.message === "aps_credentials" || err.message?.includes("401")) {
          setStatus("no_credentials");
        } else {
          setStatus("error");
          setStatusMsg(err.message || "Pipeline failed");
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      if (viewerRef.current) {
        viewerRef.current.finish();
        viewerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      style={{
        width: 500,
        background: "#0f172a",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: "#475569",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 3,
            }}
          >
            Autodesk Platform Services
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9" }}>
            {site?.address?.split(",")[0] || "3D Street View"}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "#94a3b8",
            cursor: "pointer",
            padding: "6px 12px",
            fontSize: 13,
          }}
        >
          ✕ Close
        </button>
      </div>

      {/* Viewer */}
      <div style={{ flex: 1, position: "relative", minHeight: 400 }}>
        <div ref={viewerContainer} style={{ width: "100%", height: "100%" }} />

        {status !== "ready" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#0f172a",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
              textAlign: "center",
              gap: 16,
            }}
          >
            {status === "loading" && (
              <>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    border: "3px solid rgba(255,255,255,0.1)",
                    borderTopColor: "#3b82f6",
                    borderRadius: "50%",
                    animation: "aps-spin 0.8s linear infinite",
                  }}
                />
                <style>{`@keyframes aps-spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  {statusMsg}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#334155",
                    maxWidth: 280,
                    lineHeight: 1.6,
                  }}
                >
                  Pulling Cyvl street data → building 3D geometry → uploading to
                  Autodesk
                </div>
              </>
            )}
            {status === "no_credentials" && (
              <>
                <div style={{ fontSize: 40 }}>🏗️</div>
                <div
                  style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8" }}
                >
                  Autodesk 3D Viewer
                </div>
                <div
                  style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}
                >
                  APS credentials are not configured yet.
                </div>
                <div
                  style={{
                    background: "rgba(59,130,246,0.08)",
                    border: "1px solid rgba(59,130,246,0.2)",
                    borderRadius: 10,
                    padding: "14px 18px",
                    fontSize: 12,
                    color: "#93c5fd",
                    lineHeight: 1.9,
                    textAlign: "left",
                    maxWidth: 340,
                  }}
                >
                  <strong style={{ color: "#bfdbfe" }}>To enable:</strong>
                  <br />
                  1. Sign up at aps.autodesk.com
                  <br />
                  2. Create an app → copy Client ID + Secret
                  <br />
                  3. Add to Render environment variables:
                  <br />
                  &nbsp;&nbsp;&nbsp;APS_CLIENT_ID=...
                  <br />
                  &nbsp;&nbsp;&nbsp;APS_CLIENT_SECRET=...
                  <br />
                  4. Redeploy the backend
                </div>
              </>
            )}
            {status === "error" && (
              <>
                <div style={{ fontSize: 36 }}>⚠️</div>
                <div
                  style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}
                >
                  Pipeline error
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#475569",
                    lineHeight: 1.6,
                    maxWidth: 300,
                  }}
                >
                  {statusMsg}
                </div>
                <button
                  onClick={() => {
                    setStatus("loading");
                    setStatusMsg("Retrying...");
                  }}
                  style={{
                    background: "#1d4ed8",
                    border: "none",
                    borderRadius: 7,
                    color: "#fff",
                    fontSize: 13,
                    padding: "9px 20px",
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "10px 20px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background:
              status === "ready"
                ? "#22c55e"
                : status === "error"
                ? "#ef4444"
                : "#f59e0b",
          }}
        />
        <span style={{ fontSize: 11, color: "#475569" }}>
          {status === "ready"
            ? "3D model loaded — Cyvl + Autodesk"
            : status === "error"
            ? "Pipeline failed"
            : status === "no_credentials"
            ? "Waiting for APS credentials"
            : statusMsg}
        </span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const AMENITY_TYPES = {
  hospital: { icon: "🏥", color: "#ef4444", label: "Hospital" },
  pharmacy: { icon: "💊", color: "#22c55e", label: "Pharmacy / Grocery" },
  transit: { icon: "🚌", color: "#3b82f6", label: "Transit stop" },
};

export default function WalkabilityMap() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const amenityMarkersRef = useRef([]);
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [scores, setScores] = useState(null);
  const [overallScore, setOverallScore] = useState(null);
  const [validation, setValidation] = useState(null);
  const [issues, setIssues] = useState([]);
  const [amenities, setAmenities] = useState(null);
  const [error, setError] = useState(null);
  const [showAPS, setShowAPS] = useState(false);

  const resetAssessment = () => {
    setSelectedSite(null);
    setScores(null);
    setOverallScore(null);
    setValidation(null);
    setIssues([]);
    setAmenities(null);
    setError(null);
    setShowAPS(false);
  };

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
      el.style.cssText = `width: 18px; height: 18px; background: #ef4444; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 0 4px rgba(239,68,68,0.3);`;
      markerRef.current = new window.mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .addTo(mapRef.current);
    }

    setSelectedSite({ address: feature.place_name, lng, lat });
    setScores(null);
    setError(null);
    setShowAPS(false);

    fetch(`${API_BASE}/api/score-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Score request failed: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setScores(d.dimensions);
        setOverallScore(d.overall);
        setValidation(d.validation);
        setIssues(d.issues || []);
        setAmenities(d.amenities || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // Plot a marker for each tracked amenity (hospital, pharmacy/grocery, transit).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    amenityMarkersRef.current.forEach((m) => m.remove());
    amenityMarkersRef.current = [];

    if (!amenities) return;

    Object.entries(amenities).forEach(([type, info]) => {
      if (!info?.lat || !info?.lng) return;
      const config = AMENITY_TYPES[type] || { icon: "📍", color: "#94a3b8", label: type };

      const el = document.createElement("div");
      el.style.cssText = `
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        background: ${config.color};
        border: 2px solid #fff;
        border-radius: 50%;
        font-size: 14px;
        box-shadow: 0 0 0 3px ${config.color}4D;
      `;
      el.textContent = config.icon;

      const popup = new window.mapboxgl.Popup({ offset: 16, closeButton: false }).setHTML(
        `<div style="font-family: -apple-system, sans-serif; font-size: 12px;">
          <strong>${config.label}</strong><br/>
          ${info.name || "Unknown"}<br/>
          ${info.distance_km != null ? `${info.distance_km.toFixed(2)} km away` : ""}
        </div>`
      );

      const marker = new window.mapboxgl.Marker(el)
        .setLngLat([info.lng, info.lat])
        .setPopup(popup)
        .addTo(map);

      amenityMarkersRef.current.push(marker);
    });
  }, [amenities, mapLoaded]);

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
                    resetAssessment();
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

      {/* SCORE PANEL */}
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

        {selectedSite && !loading && error && (
          <div
            style={{
              padding: 24,
              color: "#fca5a5",
              fontSize: 13,
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            Could not load live scores for this site.
            <div style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>
              {error}
            </div>
          </div>
        )}

        {selectedSite && !loading && scores && (
          <>
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
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
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
                {validation && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: validation.consistent
                        ? "rgba(34,197,94,0.15)"
                        : "rgba(245,158,11,0.15)",
                      color: validation.consistent ? "#86efac" : "#fcd34d",
                      border: `1px solid ${
                        validation.consistent
                          ? "rgba(34,197,94,0.3)"
                          : "rgba(245,158,11,0.3)"
                      }`,
                    }}
                    title={`Model predicted ${validation.model_predicted}, residual ${validation.residual}`}
                  >
                    {validation.consistent
                      ? "✓ Model-validated"
                      : "⚠ Check scores"}
                  </span>
                )}
              </div>
            </div>

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
                    <ScoreBadge score={scores[cat.key]} />
                  </div>
                  <ScoreBar score={scores[cat.key]} />
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: "#64748b",
                      lineHeight: 1.5,
                    }}
                  >
                    {cat.description}
                  </div>
                </div>
              ))}
            </div>

            {issues.length > 0 && (
              <div style={{ padding: "4px 20px 16px" }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "#475569",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  Flagged issues
                </div>
                {issues.map((iss, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      fontSize: 12,
                      color: "#fca5a5",
                      marginBottom: 6,
                    }}
                  >
                    <span>⚠️</span>
                    <span>{iss}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Footer — two buttons */}
            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                marginTop: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <button
                onClick={() => {
                  if (selectedSite?.lat && selectedSite?.lng) {
                    setShowAPS(!showAPS);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: showAPS ? "rgba(59,130,246,0.15)" : "#1d4ed8",
                  border: showAPS ? "1px solid rgba(59,130,246,0.4)" : "none",
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
                <span>
                  {showAPS ? "✕ Close 3D View" : "🏗️ Open in 3D — Autodesk"}
                </span>
                {!showAPS && (
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
                )}
              </button>
              <button
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "#94a3b8",
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

      {/* APS VIEWER PANEL — slides in when showAPS is true */}
      {showAPS && (
        <APSViewerPanel site={selectedSite} onClose={() => setShowAPS(false)} />
      )}
    </div>
  );
}
