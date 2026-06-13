import { useState } from "react";
import logo from "./logo.svg";
import "./App.css";
import WalkabilityMap from "./Screen1/neighborhood";
import SiteComparison from "./Screen3/Sitecomparision";
import RouteMap from "./Screen2/RouteMap";

const TABS = [
  { key: "walkability", label: "Walkability", component: WalkabilityMap },
  { key: "route", label: "Route", component: RouteMap },
  { key: "comparison", label: "Compare sites", component: SiteComparison },
];

function App() {
  const [activeTab, setActiveTab] = useState(TABS[0].key);
  const ActiveComponent = TABS.find((t) => t.key === activeTab).component;

  return (
    <div className="App">
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          justifyContent: "center",
          gap: 4,
          padding: 8,
          background: "#0f172a",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.08)",
              background: activeTab === tab.key ? "#1d4ed8" : "transparent",
              color: activeTab === tab.key ? "#fff" : "#94a3b8",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        style={{
          position: "fixed",
          top: 40,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: activeTab === "comparison" ? "auto" : "hidden",
        }}
      >
        <ActiveComponent />
      </div>
    </div>
  );
}

export default App;
