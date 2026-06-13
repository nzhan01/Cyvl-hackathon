import { useState } from "react";

const DIMENSIONS = [
  { key: "navigation", label: "Navigation", costPerPoint: 2800 },
  { key: "healthcare", label: "Healthcare", costPerPoint: 3200 },
  { key: "outdoor_safety", label: "Outdoor safety", costPerPoint: 4100 },
  { key: "emergency", label: "Emergency", costPerPoint: 2600 },
  { key: "social_connection", label: "Social connection", costPerPoint: 1900 },
  { key: "displacement_risk", label: "Displacement risk", costPerPoint: 3500 },
];

const MOCK_SCORES = {
  "289 Broadway, Somerville": {
    navigation: 58,
    healthcare: 65,
    outdoor_safety: 59,
    emergency: 63,
    social_connection: 55,
    displacement_risk: 64,
  },
  "45 Holland St, Somerville": {
    navigation: 40,
    healthcare: 46,
    outdoor_safety: 38,
    emergency: 42,
    social_connection: 48,
    displacement_risk: 52,
  },
};

function computeScores(address) {
  if (MOCK_SCORES[address]) return MOCK_SCORES[address];
  const seed = address.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return DIMENSIONS.reduce((acc, d, i) => {
    acc[d.key] = 35 + ((seed * (i + 7) * 13) % 55);
    return acc;
  }, {});
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
  const winnerGlow = isWinner ? `0 0 8px ${color}44` : "none";
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
          boxShadow: winnerGlow,
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

function AddressInput({ label, value, onChange, onAnalyze, color }) {
  return (
    <div style={{ flex: 1 }}>
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
        <span style={{ fontSize: 14, color }}>●</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
        {value && (
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
    </div>
  );
}

function SiteCard({ label, address, scores, repairCost, isWinner, color }) {
  if (!scores) return null;
  const overall = Math.round(
    Object.values(scores).reduce((a, b) => a + b, 0) / DIMENSIONS.length
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
          {overall}
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
  const [addrA, setAddrA] = useState("289 Broadway, Somerville");
  const [addrB, setAddrB] = useState("45 Holland St, Somerville");
  const [scoresA, setScoresA] = useState(
    computeScores("289 Broadway, Somerville")
  );
  const [scoresB, setScoresB] = useState(
    computeScores("45 Holland St, Somerville")
  );
  const [analyzed, setAnalyzed] = useState(true);
  const [animate, setAnimate] = useState(true);
  const [reportA, setReportA] = useState(false);
  const [reportB, setReportB] = useState(false);

  const analyze = () => {
    if (!addrA || !addrB) return;
    setAnimate(false);
    setTimeout(() => {
      setScoresA(computeScores(addrA));
      setScoresB(computeScores(addrB));
      setAnalyzed(true);
      setReportA(false);
      setReportB(false);
      setTimeout(() => setAnimate(true), 50);
    }, 80);
  };

  const repairA = scoresA ? computeRepairCost(scoresA) : 0;
  const repairB = scoresB ? computeRepairCost(scoresB) : 0;

  const overallA = scoresA
    ? Math.round(
        Object.values(scoresA).reduce((a, b) => a + b, 0) / DIMENSIONS.length
      )
    : 0;
  const overallB = scoresB
    ? Math.round(
        Object.values(scoresB).reduce((a, b) => a + b, 0) / DIMENSIONS.length
      )
    : 0;
  const siteAWins = overallA >= overallB;

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
          onAnalyze={analyze}
          color="#3b82f6"
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
          onAnalyze={analyze}
          color="#a78bfa"
        />
        <div
          style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}
        >
          <button
            onClick={analyze}
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

      {analyzed && scoresA && scoresB && (
        <>
          {/* Site summary cards */}
          <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
            <SiteCard
              label="Site A"
              address={addrA}
              scores={scoresA}
              repairCost={repairA}
              isWinner={siteAWins}
              color="#3b82f6"
            />
            <SiteCard
              label="Site B"
              address={addrB}
              scores={scoresB}
              repairCost={repairB}
              isWinner={!siteAWins}
              color="#a78bfa"
            />
          </div>

          {/* Dimension breakdown */}
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
                  {/* Category label row */}
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

                  {/* Site A bar */}
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

                  {/* Site B bar */}
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
            {/* Site A report */}
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
                {reportA ? (
                  <>
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Added to report
                  </>
                ) : (
                  <>
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add to report
                  </>
                )}
              </button>
            </div>

            {/* Site B report */}
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
                {reportB ? (
                  <>
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Added to report
                  </>
                ) : (
                  <>
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add to report
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Repair cost delta callout */}
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
