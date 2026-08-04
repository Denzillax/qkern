"use client";

import { Bot, CheckCircle2, Database, Radio, ShieldCheck, Table2, Users } from "lucide-react";
import { useState } from "react";
import { QKERNLogo, QKERNSymbol } from "@/components/brand";

const tabs = [
  { id: "database", label: "Database", icon: Database },
  { id: "auth", label: "Auth", icon: Users },
  { id: "ai", label: "AI Bridge", icon: Bot },
  { id: "approval", label: "Approvals", icon: ShieldCheck },
];

export function ConsolePreview() {
  const [active, setActive] = useState("database");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="preview-shell" aria-label="Interaktive Vorschau der QKERN Console">
      <aside className={`preview-sidebar ${collapsed ? "collapsed" : ""}`}>
        <button className="brand-button" onClick={() => setCollapsed(!collapsed)} aria-label="Sidebar ein- oder ausklappen">
          {collapsed ? <QKERNSymbol variant="white" size="sm" /> : <QKERNLogo variant="white" size="sm" />}
        </button>
        <div className="preview-nav">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => setActive(tab.id)}>
                <Icon size={16} /><span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <div className="preview-status"><span className="live-dot" /> <span>All systems normal</span></div>
      </aside>
      <div className="preview-main">
        <div className="preview-topbar">
          <span className="crumb">MOQRO / <strong>Nova Market</strong></span>
          <span className="environment-pill"><span /> Development</span>
        </div>
        <div className="preview-content">
          <div className="preview-heading">
            <div><span className="eyebrow">PROJECT CORE</span><h3>{tabs.find((tab) => tab.id === active)?.label}</h3></div>
            <span className="health"><CheckCircle2 size={14} /> Healthy</span>
          </div>
          {active === "database" && <DatabasePreview />}
          {active === "auth" && <AuthPreview />}
          {active === "ai" && <AIPreview />}
          {active === "approval" && <ApprovalPreview />}
        </div>
      </div>
    </div>
  );
}

function DatabasePreview() {
  return (
    <div className="preview-grid">
      <div className="preview-card wide">
        <div className="card-label"><Table2 size={15} /> PUBLIC SCHEMA <span>6 tables</span></div>
        <div className="table-list">
          {["users", "organizations", "products", "orders"].map((name, index) => (
            <div key={name}><span className="table-icon">{index === 3 ? "12k" : `0${index + 1}`}</span><strong>{name}</strong><span>{["2.8k", "184", "840", "12.4k"][index]} rows</span></div>
          ))}
        </div>
      </div>
      <div className="preview-card metric"><span>API requests</span><strong>128.4k</strong><small>+18.2% this week</small></div>
      <div className="preview-card metric"><span>Database</span><strong>284 MB</strong><small>of 8 GB used</small></div>
    </div>
  );
}

function AuthPreview() {
  return (
    <div className="preview-card wide auth-table">
      <div className="card-label"><Users size={15} /> ACTIVE USERS <span>2,847 total</span></div>
      {["Amira Keller", "Noah Steiner", "Lea Baumann", "Marco Rossi"].map((name, index) => (
        <div className="user-row" key={name}><span className="avatar">{name.split(" ").map((part) => part[0]).join("")}</span><strong>{name}</strong><span>{index % 2 ? "GitHub" : "Email"}</span><small>active</small></div>
      ))}
    </div>
  );
}

function AIPreview() {
  return (
    <div className="preview-grid">
      <div className="preview-card agent-card"><div className="agent-mark">C</div><div><strong>Codex</strong><span>Read-only · Connected</span></div><span className="live-dot" /></div>
      <div className="preview-card agent-card"><div className="agent-mark claude">A</div><div><strong>Claude Code</strong><span>Developer · Connected</span></div><span className="live-dot" /></div>
      <div className="preview-card wide terminal-card"><div><Radio size={14} /> LATEST AGENT ACTION</div><code>qkern_migration_preview({`{ project: "nova-market" }`})</code><span>Schema diff generated · waiting for approval</span></div>
    </div>
  );
}

function ApprovalPreview() {
  return (
    <div className="preview-card wide approval-preview">
      <div className="risk-line"><span className="risk medium">MEDIUM RISK</span><span>Requested 2 min ago by Codex</span></div>
      <h4>Add order status history</h4>
      <p>Creates one protected table and one index. No existing records are modified.</p>
      <div className="diff"><span>+</span> CREATE TABLE order_status_history<br/><span>+</span> ENABLE ROW LEVEL SECURITY</div>
      <div className="approval-buttons"><button className="ghost-button">Reject</button><button className="button small">Review change</button></div>
    </div>
  );
}
