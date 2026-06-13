import { useState } from "react";

const API_BASE = "https://cyvl-hackathon.onrender.com";

const DIMENSIONS = [
  { key: "navigation", label: "Navigation", costPerPoint: 2800 },
  { key: "healthcare", label: "Healthcare", costPerPoint: 3200 },
  { key: "outdoor_safety", label: "Outdoor safety", costPerPoint: 4100 },
  { key: "emergency", label: "Emergency", costPerPoint: 2600 },
  { key: "social_connection", label: "Social connection", costPerPoint: 1900 },
  { key: "displacement_risk", label: "Displacement risk", costPerPoint: 3500 },
];

function extractScores(data) {
  return {
    navigation: data.dimensions?.navigation ?? 0,
    healthcare: data.dimensions?.healthcare ?? 0,
    outdoor_safety: data.dimensions?.safety ?? 0,
    emergency: data.dimensions?.emergency ?? 0,
    social_connection: data.dimensions?.social ?? 0,
    displacement_risk: data.dimensions?.displacement ?? 0,
  };
}

function computeRepairCost(scores) {
  return DIMENSIONS.reduce((total, d) => {
    const gap = Math.max(0, 70 - scores[d.key]);
    return total + gap * d.costPerPoint;
  }, 0);
}

function formatCost(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}

function ScoreBar({ score, isWinner, animate }) {
  const color = score < 45 ? "#ef4444" : score < 65 ? "#f59e0b" : "#22c55e";
  return (
    <div
      style={{
        flex: 1,
        height: 7,
        background: "rgba(255,255,255,0.08)",
        borderRadius: 99,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: animate ? `${score}%` : "0%",
          height: "100%",
          background: color,
          borderRadius: 99,
          transition: "width 0.7s cubic-bezier(0.4,0,0.2,1)",
          boxShadow: isWinner ? `0 0 8px ${color}44` : "none",
        }}
      />
    </div>
  );
}

function DeltaBadge({ delta }) {
  if (delta === 0) return null;
  const isPos = delta > 0;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: isPos ? "#22c55e" : "#ef4444",
        background: isPos ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
        border: `1px solid ${
          isPos ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"
        }`,
        borderRadius: 5,
        padding: "1px 6px",
        minWidth: 36,
        textAlign: "center",
        display: "inline-block",
      }}
    >
      {isPos ? "+" : ""}
      {delta}
    </span>
  );
}

function WinnerChip() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: "#22c55e",
        background: "rgba(34,197,94,0.15)",
        border: "1px solid rgba(34,197,94,0.3)",
        borderRadius: 5,
        padding: "2px 7px",
        marginLeft: 8,
        letterSpacing: "0.03em",
      }}
    >
      winner
    </span>
  );
}

// ── Address input with autocomplete ──────────────────────────────────────────
function AddressInput({ label, value, onChange, onAnalyze, color, loading }) {
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
        )}.json?access_token=${
          process.env.REACT_APP_MAPBOX_TOKEN
        }&proximity=-71.0998,42.3876&types=address&limit=5`
      );
      const data = await res.json();
      setSuggestions(data.features || []);
    } catch {
      setSuggestions([]);
    }
  };

  return (
    <div style={{ flex: 1, position: "relative" }}>
      <div
        style={{
          fontSize: 11,
          color: "#475569",
          marginBottom: 6,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "#1e293b",
          border: `1px solid ${color}44`,
          borderRadius: 10,
          padding: "10px 14px",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 14, color }}>{loading ? "⟳" : "●"}</span>
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            search(e.target.value);
          }}
          placeholder="Enter address in Somerville..."
          onKeyDown={(e) => e.key === "Enter" && onAnalyze()}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#f1f5f9",
            fontSize: 14,
          }}
        />
        {value && !loading && (
          <button
            onClick={onAnalyze}
            style={{
              background: color + "22",
              border: `1px solid ${color}44`,
              borderRadius: 6,
              color,
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 10px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Analyze
          </button>
        )}
      </div>

      {/* Autocomplete dropdown */}
      {suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "rgba(15,23,42,0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "0 0 10px 10px",
            overflow: "hidden",
          }}
        >
          {suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onChange(s.place_name);
                setSuggestions([]);
                onAnalyze();
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
              onMouseOver={(e) =>
                (e.currentTarget.style.background = "rgba(255,255,255,0.06)")
              }
              onMouseOut={(e) => (e.currentTarget.style.background = "none")}
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
  );
}

function SiteCard({
  label,
  address,
  scores,
  repairCost,
  overallScore,
  isWinner,
  color,
  error,
}) {
  if (!scores && !error)
    return (
      <div
        style={{
          flex: 1,
          background: "#1e293b",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "#475569" }}>
          Enter an address above
        </span>
      </div>
    );

  if (error)
    return (
      <div
        style={{
          flex: 1,
          background: "#1e293b",
          borderRadius: 12,
          border: "1px solid rgba(239,68,68,0.2)",
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "#f87171" }}>
          Could not load scores
        </span>
      </div>
    );

  return (
    <div
      style={{
        flex: 1,
        background: "#1e293b",
        borderRadius: 12,
        border: isWinner
          ? `1.5px solid ${color}`
          : "1px solid rgba(255,255,255,0.08)",
        padding: "18px 20px",
        position: "relative",
      }}
    >
      {isWinner && (
        <div
          style={{
            position: "absolute",
            top: -1,
            right: 16,
            background: color,
            color: "#0f172a",
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: "0 0 6px 6px",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Better site
        </div>
      )}
      <div style={{ fontSize: 12, color, fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "#94a3b8",
          marginBottom: 14,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {address.split(",")[0]}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 44,
            fontWeight: 700,
            color: "#f1f5f9",
            lineHeight: 1,
          }}
        >
          {overallScore}
        </span>
        <span style={{ fontSize: 16, color: "#475569", fontWeight: 400 }}>
          /100
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#f59e0b", fontWeight: 500 }}>
        Repair est: {formatCost(repairCost)}
      </div>
    </div>
  );
}

export default function SiteComparison() {
  const [addrA, setAddrA] = useState("");
  const [addrB, setAddrB] = useState("");
  const [scoresA, setScoresA] = useState(null);
  const [scoresB, setScoresB] = useState(null);
  const [overallA, setOverallA] = useState(null);
  const [overallB, setOverallB] = useState(null);
  const [errorA, setErrorA] = useState(null);
  const [errorB, setErrorB] = useState(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [reportA, setReportA] = useState(false);
  const [reportB, setReportB] = useState(false);

  const fetchScores = async (
    address,
    setSite,
    setOverall,
    setError,
    setLoading
  ) => {
    if (!address.trim()) return;
    setLoading(true);
    setError(null);
    setSite(null);

    try {
      const geoRes = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          address
        )}.json?access_token=${
          process.env.REACT_APP_MAPBOX_TOKEN
        }&proximity=-71.0998,42.3876&limit=1`
      );
      const geoData = await geoRes.json();
      if (!geoData.features?.length) throw new Error("Address not found");
      const [lng, lat] = geoData.features[0].center;

      const res = await fetch(`${API_BASE}/api/score-address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      if (!res.ok) throw new Error(`Score request failed: ${res.status}`);
      const data = await res.json();

      setAnimate(false);
      setTimeout(() => {
        setSite(extractScores(data));
        setOverall(data.overall ?? 0);
        setAnimate(true);
      }, 50);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const analyzeA = () =>
    fetchScores(addrA, setScoresA, setOverallA, setErrorA, setLoadingA);
  const analyzeB = () =>
    fetchScores(addrB, setScoresB, setOverallB, setErrorB, setLoadingB);

  const analyzeBoth = () => {
    analyzeA();
    analyzeB();
    setReportA(false);
    setReportB(false);
  };

  const repairA = scoresA ? computeRepairCost(scoresA) : 0;
  const repairB = scoresB ? computeRepairCost(scoresB) : 0;
  const siteAWins = (overallA ?? 0) >= (overallB ?? 0);
  const bothReady = scoresA && scoresB;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#f1f5f9",
        padding: "28px 32px",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            color: "#475569",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 4,
          }}
        >
          Pedestrian Route Intelligence
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#f1f5f9",
              margin: 0,
            }}
          >
            Site comparison
          </h1>
          <div
            style={{
              fontSize: 12,
              color: "#475569",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              padding: "4px 12px",
            }}
          >
            Somerville, MA
          </div>
        </div>
        <p
          style={{
            fontSize: 13,
            color: "#475569",
            marginTop: 6,
            marginBottom: 0,
          }}
        >
          Compare two candidate sites across six walkability dimensions.
          Identify the better acquisition and negotiate repair costs into the
          deal.
        </p>
      </div>

      {/* Address inputs */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <AddressInput
          label="Site A"
          value={addrA}
          onChange={setAddrA}
          onAnalyze={analyzeA}
          color="#3b82f6"
          loading={loadingA}
        />
        <div
          style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}
        >
          <div style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
            vs
          </div>
        </div>
        <AddressInput
          label="Site B"
          value={addrB}
          onChange={setAddrB}
          onAnalyze={analyzeB}
          color="#a78bfa"
          loading={loadingB}
        />
        <div
          style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}
        >
          <button
            onClick={analyzeBoth}
            style={{
              background: "#1d4ed8",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              padding: "11px 20px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Compare sites →
          </button>
        </div>
      </div>

      {/* Site summary cards */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <SiteCard
          label="Site A"
          address={addrA || "—"}
          scores={scoresA}
          repairCost={repairA}
          overallScore={overallA}
          isWinner={bothReady && siteAWins}
          color="#3b82f6"
          error={errorA}
        />
        <SiteCard
          label="Site B"
          address={addrB || "—"}
          scores={scoresB}
          repairCost={repairB}
          overallScore={overallB}
          isWinner={bothReady && !siteAWins}
          color="#a78bfa"
          error={errorB}
        />
      </div>

      {/* Dimension breakdown */}
      {bothReady && (
        <>
          <div
            style={{
              background: "#1e293b",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.07)",
              overflow: "hidden",
              marginBottom: 20,
            }}
          >
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>
                Score breakdown by dimension
              </span>
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  fontSize: 11,
                  color: "#475569",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#3b82f6",
                      display: "inline-block",
                    }}
                  />
                  Site A — {addrA.split(",")[0]}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#a78bfa",
                      display: "inline-block",
                    }}
                  />
                  Site B — {addrB.split(",")[0]}
                </span>
              </div>
            </div>

            {DIMENSIONS.map((dim, i) => {
              const sA = scoresA[dim.key];
              const sB = scoresB[dim.key];
              const delta = sA - sB;
              const aWins = sA >= sB;

              return (
                <div
                  key={dim.key}
                  style={{
                    padding: "14px 20px",
                    borderBottom:
                      i < DIMENSIONS.length - 1
                        ? "1px solid rgba(255,255,255,0.04)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        color: "#64748b",
                        fontWeight: 500,
                        minWidth: 130,
                      }}
                    >
                      {dim.label}
                    </span>
                    {aWins ? (
                      <span style={{ fontSize: 11, color: "#3b82f6" }}>
                        Site A leads
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "#a78bfa" }}>
                        Site B leads
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 7,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "#94a3b8",
                        minWidth: 110,
                        textAlign: "right",
                      }}
                    >
                      {addrA.split(",")[0]}
                    </span>
                    <ScoreBar score={sA} isWinner={aWins} animate={animate} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color:
                          sA < 45 ? "#ef4444" : sA < 65 ? "#f59e0b" : "#22c55e",
                        minWidth: 28,
                        textAlign: "right",
                      }}
                    >
                      {sA}
                    </span>
                    {aWins && <WinnerChip />}
                    {!aWins && <DeltaBadge delta={delta} />}
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "#94a3b8",
                        minWidth: 110,
                        textAlign: "right",
                      }}
                    >
                      {addrB.split(",")[0]}
                    </span>
                    <ScoreBar score={sB} isWinner={!aWins} animate={animate} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color:
                          sB < 45 ? "#ef4444" : sB < 65 ? "#f59e0b" : "#22c55e",
                        minWidth: 28,
                        textAlign: "right",
                      }}
                    >
                      {sB}
                    </span>
                    {!aWins && <WinnerChip />}
                    {aWins && <DeltaBadge delta={-delta} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add to report buttons */}
          <div style={{ display: "flex", gap: 16 }}>
            <div
              style={{
                flex: 1,
                background: "#1e293b",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#3b82f6",
                    fontWeight: 600,
                    marginBottom: 2,
                  }}
                >
                  Site A
                </div>
                <div style={{ fontSize: 13, color: "#94a3b8" }}>
                  {addrA.split(",")[0]}
                </div>
              </div>
              <button
                onClick={() => setReportA(!reportA)}
                style={{
                  background: reportA
                    ? "rgba(34,197,94,0.15)"
                    : "rgba(59,130,246,0.12)",
                  border: `1px solid ${
                    reportA ? "rgba(34,197,94,0.3)" : "rgba(59,130,246,0.25)"
                  }`,
                  borderRadius: 8,
                  color: reportA ? "#22c55e" : "#3b82f6",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "8px 18px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  transition: "all 0.2s",
                }}
              >
                {reportA ? <>✓ Added to report</> : <>+ Add to report</>}
              </button>
            </div>

            <div
              style={{
                flex: 1,
                background: "#1e293b",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#a78bfa",
                    fontWeight: 600,
                    marginBottom: 2,
                  }}
                >
                  Site B
                </div>
                <div style={{ fontSize: 13, color: "#94a3b8" }}>
                  {addrB.split(",")[0]}
                </div>
              </div>
              <button
                onClick={() => setReportB(!reportB)}
                style={{
                  background: reportB
                    ? "rgba(34,197,94,0.15)"
                    : "rgba(167,139,250,0.12)",
                  border: `1px solid ${
                    reportB ? "rgba(34,197,94,0.3)" : "rgba(167,139,250,0.25)"
                  }`,
                  borderRadius: 8,
                  color: reportB ? "#22c55e" : "#a78bfa",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "8px 18px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  transition: "all 0.2s",
                }}
              >
                {reportB ? <>✓ Added to report</> : <>+ Add to report</>}
              </button>
            </div>
          </div>

          {/* Negotiation insight */}
          {repairA !== repairB && (
            <div
              style={{
                marginTop: 16,
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 10,
                padding: "12px 18px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 18 }}>💡</span>
              <div>
                <span
                  style={{ fontSize: 13, color: "#f59e0b", fontWeight: 500 }}
                >
                  Negotiation insight:&nbsp;
                </span>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>
                  {repairA > repairB
                    ? `Site A carries ${formatCost(
                        repairA - repairB
                      )} more in estimated remediation costs than Site B. Use this delta to negotiate the acquisition price.`
                    : `Site B carries ${formatCost(
                        repairB - repairA
                      )} more in estimated remediation costs than Site A. Use this delta to negotiate the acquisition price.`}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
