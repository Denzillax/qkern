"use client";

import {
  Activity, ArchiveRestore, Bell, Blocks, Bot, Braces, ChevronDown, ChevronLeft, ChevronRight,
  CircleGauge, Cloud, Code2, Command, Database, FileClock, Fingerprint, HardDrive, KeyRound,
  Copy, LayoutDashboard, ListFilter, LogOut, Menu, Network, Pencil, Play, Plus, RefreshCw, Search,
  Settings, ShieldCheck, Table2, Terminal, Trash2, Users, Webhook, X, Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QKERNLogo, QKERNSymbol } from "@/components/brand";
import { loadConsoleInvoices, type ConsoleInvoiceResult } from "@/components/console/invoices";
import { ThemeToggle } from "@/components/theme-toggle";
import type {
  Approval,
  AuditEvent,
  AutomationMode,
  ChangeSet,
  Environment,
  Project,
  ProjectAutomationPolicy,
  Risk,
} from "@/lib/types";
import { classifySqlRisk, isReadOnlySql } from "@/lib/security";

type Snapshot = { user: { id: string; email: string }; organization: { id: string; name: string; slug: string }; projects: Project[]; changeSets: ChangeSet[]; approvals: Approval[]; audit: AuditEvent[] };
type ViewId = "overview" | "database" | "table" | "sql" | "auth" | "storage" | "compute" | "api" | "ai" | "activity" | "approvals" | "logs" | "monitoring" | "backups" | "settings";

type LiveTableColumn = {
  name: string; dataType: string; nullable: boolean; sensitive: boolean;
  primaryKeyPosition: number | null; insertable: boolean; updateable: boolean; selectable: boolean;
};
type LiveTable = {
  schema: string; name: string; rowSecurityEnabled: boolean; primaryKey: string[]; columns: LiveTableColumn[];
};
type LiveRows = {
  table: LiveTable; rows: Array<Record<string, unknown>>; rowCount: number;
  hasMore: boolean; nextCursor: string | null;
};
type ProjectApiKeyItem = {
  id: string; name: string; kind: "public" | "service"; prefix: string;
  expiresAt: string; revokedAt: string | null; createdAt: string;
};
type ProjectStorageBucketItem = {
  id: string; projectId: string; environment: Environment; name: string;
  readPolicy: "private" | "authenticated" | "owner" | "public" | "service";
  writePolicy: "private" | "authenticated" | "owner" | "service";
  allowedMimeTypes: string[]; maxObjectBytes: number; quotaBytes: number;
  usedBytes: number; reservedBytes: number; retentionDays: number | null;
  createdAt: string; updatedAt: string;
};
type UsageProjection = {
  projectId: string; environment: Environment; period: string;
  windowStart: string; windowEnd: string;
  metrics: Array<{
    metric: string; label: string; unit: "operations" | "rows" | "bytes";
    used: string; limit: string | null; remaining: string | null;
    mode: "unlimited" | "observe" | "enforce";
    status: "unlimited" | "ok" | "warning" | "exhausted" | "exceeded";
    revision: number | null;
  }>;
};

const nav: { id: ViewId; label: string; icon: typeof Database; badge?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "database", label: "Database", icon: Database },
  { id: "table", label: "Table Editor", icon: Table2 },
  { id: "sql", label: "SQL Editor", icon: Terminal },
  { id: "auth", label: "Authentication", icon: Fingerprint },
  { id: "storage", label: "Storage", icon: Cloud },
  { id: "compute", label: "Functions & Jobs", icon: Webhook },
  { id: "api", label: "API", icon: Braces },
  { id: "ai", label: "AI Bridge", icon: Bot, badge: "2" },
  { id: "activity", label: "AI Activity", icon: Activity },
  { id: "approvals", label: "Approval Center", icon: ShieldCheck, badge: "1" },
  { id: "logs", label: "Logs", icon: FileClock },
  { id: "monitoring", label: "Usage & Quotas", icon: CircleGauge },
  { id: "backups", label: "Backups", icon: ArchiveRestore },
  { id: "settings", label: "Settings", icon: Settings },
];

const demoTables = [
  { name: "users", rows: "2,847", size: "3.8 MB", rls: true },
  { name: "organizations", rows: "184", size: "612 kB", rls: true },
  { name: "products", rows: "840", size: "9.1 MB", rls: true },
  { name: "orders", rows: "12,402", size: "81.4 MB", rls: true },
  { name: "order_items", rows: "31,884", size: "129 MB", rls: true },
  { name: "profiles", rows: "2,721", size: "4.4 MB", rls: true },
];

export function ConsoleApp() {
  const router = useRouter();
  const [view, setView] = useState<ViewId>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [environment, setEnvironment] = useState<Environment>("development");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/console", { cache: "no-store" });
      if (response.status === 401) { router.replace("/login"); return; }
      if (!response.ok) throw new Error("Console data unavailable");
      setSnapshot(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const project = snapshot?.projects[0];
  const selected = nav.find((item) => item.id === view)!;

  function changeView(next: ViewId) { setView(next); setMobileOpen(false); }
  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="console-root">
      <aside className={`console-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="console-brand"><Link href="/">{collapsed ? <QKERNSymbol variant="white" size="sm" /> : <QKERNLogo variant="white" size="sm" />}</Link><button onClick={() => setCollapsed(!collapsed)} aria-label="Sidebar ein- oder ausklappen">{collapsed ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}</button></div>
        <div className="project-switch"><span className="project-glyph">QP</span><div><strong>{project?.name ?? "Loading project"}</strong><small>MVP workspace</small></div><ChevronDown size={14}/></div>
        <nav className="console-nav" aria-label="QKERN Console Navigation">
          {nav.map((item) => { const Icon = item.icon; return <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => changeView(item.id)} title={item.label}><Icon size={17}/><span>{item.label}</span>{item.badge && <small>{item.badge}</small>}</button>; })}
        </nav>
        <div className="sidebar-bottom"><Link href="/#developers"><Code2 size={16}/><span>QKERN Docs</span></Link><button><Users size={16}/><span>Team</span></button><div className="user-chip"><span>{snapshot?.user.email.slice(0, 2).toUpperCase() ?? "QK"}</span><div><strong>{snapshot?.user.email.split("@")[0] ?? "Account"}</strong><small>Owner</small></div><button onClick={logout} title="Abmelden" aria-label="Abmelden"><LogOut size={14}/></button></div></div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" aria-label="Navigation schließen" onClick={() => setMobileOpen(false)} />}

      <div className="console-workspace">
        <header className="console-topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Navigation öffnen"><Menu size={19}/></button>
          <div className="console-crumb"><span>{snapshot?.organization.name ?? "QKERN"}</span><b>/</b><strong>{project?.name ?? "Project"}</strong></div>
          <div className="console-tools">
            <select className={`environment-select ${environment}`} value={environment} onChange={(event) => setEnvironment(event.target.value as Environment)} aria-label="Umgebung auswählen">
              <option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option>
            </select>
            <button className="command-button" onClick={() => setCommandOpen(true)}><Search size={15}/><span>Search</span><kbd>⌘ K</kbd></button>
            <span className="system-online"><i/> Healthy</span>
            <ThemeToggle/><button className="icon-button" aria-label="Benachrichtigungen"><Bell size={16}/></button>
          </div>
        </header>

        <main className="console-page">
          <div className="console-titlebar"><div><span className="console-kicker">{(project?.name ?? "PROJECT").toUpperCase()} · {environment.toUpperCase()}</span><h1>{selected.label}</h1></div>{environment === "production" && <span className="production-guard"><ShieldCheck size={15}/> Production guard active</span>}</div>
          {loading && <LoadingState/>}
          {error && <ErrorState message={error} retry={load}/>} 
          {!loading && !error && snapshot && project && (
            <ViewRouter view={view} snapshot={snapshot} project={project} environment={environment} reload={load} navigate={changeView}/>
          )}
        </main>
      </div>
      {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onNavigate={changeView}/>} 
    </div>
  );
}

function ViewRouter(props: { view: ViewId; snapshot: Snapshot; project: Project; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void }) {
  switch (props.view) {
    case "overview": return <ProductPreview service="metrics backend"><Overview snapshot={props.snapshot} project={props.project} navigate={props.navigate}/></ProductPreview>;
    case "database": return <ProductPreview service="Database provisioning"><DatabaseView/></ProductPreview>;
    case "table": return <TableView projectId={props.project.id} environment={props.environment}/>;
    case "sql": return <ProductPreview service="project query executor"><SqlView projectId={props.project.id} environment={props.environment} reload={props.reload} navigate={props.navigate}/></ProductPreview>;
    case "auth": return <AuthView projectId={props.project.id} environment={props.environment}/>;
    case "storage": return <StorageView projectId={props.project.id} environment={props.environment}/>;
    case "compute": return <ComputeView projectId={props.project.id} environment={props.environment}/>;
    case "api": return <LiveApiView projectId={props.project.id} environment={props.environment}/>;
    case "ai": return <ProductPreview service="agent connection service"><AIBridge projectId={props.project.id} environment={props.environment} reload={props.reload} navigate={props.navigate}/></ProductPreview>;
    case "activity": case "logs": return <ActivityView audit={props.snapshot.audit} aiOnly={props.view === "activity"}/>;
    case "approvals": return <ApprovalView projectId={props.project.id} environment={props.environment} approvals={props.snapshot.approvals} changes={props.snapshot.changeSets} reload={props.reload}/>;
    case "monitoring": return <UsageView projectId={props.project.id} environment={props.environment}/>;
    case "backups": return <ProductPreview service="Backup worker"><BackupsView/></ProductPreview>;
    case "settings": return <SettingsView/>;
  }
}

function ProductPreview({ service, children }: { service: string; children: React.ReactNode }) {
  return <><div className="product-preview-notice"><Blocks size={16}/><div><strong>Product preview</strong><span>Sample project data is shown. The production {service} is not connected yet.</span></div></div>{children}</>;
}

function Overview({ snapshot, project, navigate }: { snapshot: Snapshot; project: Project; navigate: (view: ViewId) => void }) {
  const metrics = [
    ["API REQUESTS", project.apiRequests.toLocaleString("de-CH"), "+18.2%", Braces],
    ["ACTIVE USERS", project.activeUsers.toLocaleString("de-CH"), "+8.4%", Users],
    ["DATABASE", `${project.databaseSizeMb} MB`, "3.4% used", Database],
    ["STORAGE", `${(project.storageSizeMb / 1024).toFixed(2)} GB`, "of 20 GB", HardDrive],
  ] as const;
  return <>
    <div className="metric-grid">{metrics.map(([label, value, note, Icon]) => <article className="console-card metric-tile" key={label}><div><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{note}</small></article>)}</div>
    <div className="dashboard-grid">
      <article className="console-card chart-card"><div className="card-head"><div><span>API TRAFFIC</span><h3>Requests over 24 hours</h3></div><small>p95 184 ms</small></div><div className="bar-chart">{[28,44,36,52,48,64,57,76,69,84,61,73,79,68,88,74,91,82,67,78,86,70,64,72].map((height, index) => <i key={index} style={{height: `${height}%`}}/>)}</div><div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Now</span></div></article>
      <article className="console-card health-card"><div className="card-head"><div><span>PROJECT HEALTH</span><h3>All systems normal</h3></div><i className="status-orb"/></div>{[["Database", "18 ms"], ["Auth", "42 ms"], ["Storage", "67 ms"], ["REST API", "91 ms"], ["MCP Server", "38 ms"]].map(([label, value]) => <div className="service-row" key={label}><i/><span>{label}</span><strong>{value}</strong></div>)}</article>
    </div>
    <div className="dashboard-grid lower">
      <article className="console-card"><div className="card-head"><div><span>RECENT AI ACTIVITY</span><h3>Agent operations</h3></div><button className="plain-button" onClick={() => navigate("activity")}>View all</button></div>{snapshot.audit.slice(0,3).map((event) => <div className="event-row" key={event.id}><span className="event-icon"><Bot size={14}/></span><div><strong>{event.action}</strong><small>{event.actor} · {event.resource}</small></div><time>{formatTime(event.createdAt)}</time></div>)}</article>
      <article className="console-card"><div className="card-head"><div><span>APPROVAL CENTER</span><h3>{snapshot.approvals.filter((item) => item.status === "pending").length} request waiting</h3></div><button className="plain-button" onClick={() => navigate("approvals")}>Review</button></div>{snapshot.approvals.slice(0,2).map((approval) => <div className="approval-mini" key={approval.id}><span className={`risk ${approval.risk}`}>{approval.risk}</span><div><strong>{approval.action}</strong><small>{approval.requestedBy} · {approval.environment}</small></div><ChevronRight size={15}/></div>)}</article>
    </div>
  </>;
}

function DatabaseView() {
  return <div className="module-grid"><article className="console-card database-hero"><div className="db-icon"><Database size={26}/></div><div><span>POSTGRESQL 17</span><h2>nova-market-dev</h2><p>Healthy · ch-zrh-1 · Connection pooling active</p></div><button className="secondary-button"><KeyRound size={15}/> Connection details</button></article><article className="console-card"><div className="card-head"><div><span>DATABASE CORE</span><h3>Connection load</h3></div><strong>12 / 100</strong></div><div className="progress"><i style={{width:"12%"}}/></div><div className="detail-list"><div><span>Pool mode</span><strong>Transaction</strong></div><div><span>Average query</span><strong>18 ms</strong></div><div><span>Slow queries</span><strong>2</strong></div></div></article><article className="console-card span-2"><div className="card-head"><div><span>SCHEMA</span><h3>Public schema</h3></div><button className="button small"><Plus size={14}/> New table</button></div><TableList/></article></div>;
}

function TableList() { return <div className="data-table"><div className="data-row header"><span>Name</span><span>Rows</span><span>Size</span><span>Security</span></div>{demoTables.map((table) => <div className="data-row" key={table.name}><span><Table2 size={14}/><strong>{table.name}</strong></span><span>{table.rows}</span><span>{table.size}</span><span className="secure"><ShieldCheck size={13}/> RLS on</span></div>)}</div>; }

function TableView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [tables,setTables]=useState<string[]>([]);
  const [selected,setSelected]=useState("");
  const [data,setData]=useState<LiveRows|null>(null);
  const [query,setQuery]=useState("");
  const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");
  const [message,setMessage]=useState("");
  const [insertOpen,setInsertOpen]=useState(false);
  const [insertDraft,setInsertDraft]=useState("{\n  \"id\": \"\"\n}");

  const loadRows=useCallback(async(table:string)=>{
    if(!table)return;
    setState("loading");setMessage("");
    try{
      const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${table}/rows?schema=public&limit=50`,{cache:"no-store"});
      const payload=await response.json();
      if(response.status===503||response.status===409){setData(null);setState("unavailable");setMessage(payload.error??"Generated Data API is not enabled for this environment.");return;}
      if(!response.ok)throw new Error(payload.error??"Rows unavailable");
      setData(payload.data as LiveRows);setState("ready");
    }catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:"Rows unavailable");}
  },[projectId,environment]);

  useEffect(()=>{let active=true;setState("loading");setData(null);void fetch(`/api/v1/projects/${projectId}/environments/${environment}/schema?schema=public`,{cache:"no-store"}).then(async response=>({response,payload:await response.json()})).then(({response,payload})=>{if(!active)return;if(!response.ok){setTables([]);setSelected("");setState(response.status===503||response.status===409?"unavailable":"error");setMessage(payload.error??"Schema unavailable");return;}const names=(payload.data.tables as Array<{name:string;kind:string;rowSecurityEnabled:boolean}>).filter(table=>(table.kind==="table"||table.kind==="partitioned_table")&&table.rowSecurityEnabled).map(table=>table.name);setTables(names);const first=names[0]??"";setSelected(first);if(first)void loadRows(first);else{setState("unavailable");setMessage("No RLS-enabled table is available in the public schema.");}}).catch(()=>{if(active){setState("error");setMessage("Schema unavailable");}});return()=>{active=false;};},[projectId,environment,loadRows]);

  async function insert(){try{const row=JSON.parse(insertDraft) as unknown;if(!row||typeof row!=="object"||Array.isArray(row))throw new Error();const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",rows:[row]})});if(!response.ok)throw new Error((await response.json()).error??"Insert failed");setInsertOpen(false);await loadRows(selected);}catch{setMessage("Insert expects one valid JSON object with allowlisted columns.");setState("error");}}
  async function remove(row:Record<string,unknown>){if(!data?.table.primaryKey.length||!window.confirm("Delete this RLS-visible row?"))return;const match=Object.fromEntries(data.table.primaryKey.map(key=>[key,row[key]]));const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",match})});if(response.ok)await loadRows(selected);else{setState("error");setMessage((await response.json()).error??"Delete failed");}}
  async function edit(row:Record<string,unknown>){if(!data?.table.primaryKey.length)return;const raw=window.prompt("Changed values as JSON (primary keys cannot be changed)","{}");if(!raw)return;try{const values=JSON.parse(raw) as unknown;if(!values||typeof values!=="object"||Array.isArray(values))throw new Error();const match=Object.fromEntries(data.table.primaryKey.map(key=>[key,row[key]]));const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/tables/${selected}/rows`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({schema:"public",match,values})});if(!response.ok)throw new Error((await response.json()).error??"Update failed");await loadRows(selected);}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:"Update expects a JSON object.");}}

  const columns=data?.table.columns.filter(column=>column.selectable&&!column.sensitive).map(column=>column.name)??[];
  const rows=(data?.rows??[]).filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  return <div className="console-card table-editor live-table-editor"><div className="table-toolbar"><label className="table-select"><Table2 size={15}/><select value={selected} onChange={event=>{setSelected(event.target.value);void loadRows(event.target.value);}} aria-label="Table">{tables.map(table=><option key={table} value={table}>public.{table}</option>)}</select><ChevronDown size={14}/></label><div className="toolbar-search"><Search size={14}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search loaded rows…"/></div><button className="secondary-button" onClick={()=>void loadRows(selected)} disabled={!selected}><RefreshCw size={14}/> Refresh</button><button className="button small" onClick={()=>setInsertOpen(!insertOpen)} disabled={!selected||state!=="ready"}><Plus size={14}/> Insert row</button></div>{insertOpen&&<div className="inline-row-editor"><textarea value={insertDraft} onChange={event=>setInsertDraft(event.target.value)} aria-label="New row JSON"/><div><button className="ghost-button" onClick={()=>setInsertOpen(false)}>Cancel</button><button className="button small" onClick={()=>void insert()}>Insert with RLS</button></div></div>}{state==="loading"&&<div className="live-module-state"><RefreshCw size={24}/><h3>Loading live schema and rows…</h3></div>}{(state==="unavailable"||state==="error")&&<div className="live-module-state"><Database size={26}/><h3>{state==="unavailable"?"Generated Data API not ready":"Could not load rows"}</h3><p>{message}</p></div>}{state==="ready"&&<div className="records-grid live-records"><table><thead><tr>{columns.map(column=><th key={column}>{column}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map((row,index)=><tr key={data?.table.primaryKey.map(key=>String(row[key])).join(":")||index}>{columns.map(column=><td key={column}><code>{formatCell(row[column])}</code></td>)}<td className="row-actions"><button onClick={()=>void edit(row)} aria-label="Edit row"><Pencil size={13}/></button><button onClick={()=>void remove(row)} aria-label="Delete row"><Trash2 size={13}/></button></td></tr>)}{rows.length===0&&<tr><td colSpan={columns.length+1}>No RLS-visible rows.</td></tr>}</tbody></table></div>}<div className="table-footer"><span>{rows.length} loaded rows{data?.hasMore?" · more available by cursor":""}</span><span className="secure"><ShieldCheck size={12}/> Live schema · RLS enforced · sensitive columns excluded</span></div></div>;
}

function SqlView({ projectId, environment, reload, navigate }: { projectId: string; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void }) {
  const [sql, setSql] = useState("SELECT table_name, table_type\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name\nLIMIT 20");
  const [result, setResult] = useState<"idle"|"rows"|"approval"|"error">("idle");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const risk = useMemo(() => classifySqlRisk(sql, environment), [sql, environment]);
  const readOnly = isReadOnlySql(sql.replace(/\n/g, " "));
  // Bis Release 1.75 zeigte diese Ansicht vorbereitete Beispielzeilen und rief
  // die Query-Route nie — die Flaeche sah vorhanden aus, ohne es zu sein.
  // Jetzt laeuft ein Read-only-Statement wirklich: durch den Parser-Waechter,
  // in einer READ-ONLY-Transaktion, mit Zeilenlimit und Redaktion.
  async function run() {
    setRunning(true);
    setMessage("");
    try {
      if (readOnly) {
        const response = await fetch(`/api/v1/projects/${projectId}/environments/${environment}/query`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statement: sql, limit: 50 }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setResult("error");
          setMessage(payload.code ? `${payload.error} (${payload.code})` : payload.error ?? "Query failed");
          return;
        }
        setColumns(payload.data.columns as string[]);
        setRows(payload.data.rows as Array<Record<string, unknown>>);
        setTruncated(Boolean(payload.data.truncated));
        setResult("rows");
        return;
      }
      const response = await fetch("/api/v1/changesets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, environment, title: "SQL change from Console", statement: sql }),
      });
      if (!response.ok) { setResult("error"); setMessage("The change set could not be created."); return; }
      setResult("approval");
      await reload();
    } finally {
      setRunning(false);
    }
  }
  return <div className="sql-layout"><article className="console-card sql-editor"><div className="editor-tabs"><span className="active">Query 1 <X size={12}/></span><button><Plus size={13}/></button><div className={`risk ${risk}`}>{risk} risk</div></div><div className="editor-body"><div className="line-numbers">1<br/>2<br/>3<br/>4<br/>5</div><textarea value={sql} onChange={(event)=>setSql(event.target.value)} aria-label="SQL query" spellCheck={false}/></div><div className="editor-footer"><span>Read-only SQL runs against the project database, bounded and redacted. Writes become reviewed Change Sets.</span><button className="button small" onClick={()=>void run()} disabled={running}><Play size={13}/> {running ? "Running…" : readOnly ? "Run query" : "Create preview"}</button></div></article><article className="console-card result-panel"><div className="card-head"><div><span>RESULT</span><h3>{result === "rows" ? `${rows.length} rows${truncated ? " · truncated" : ""}` : result === "approval" ? "Change Set created" : result === "error" ? "Query failed" : "Ready"}</h3></div></div>{result === "idle" && <EmptyState icon={Terminal} title="Run a query" text="SELECT statements run read-only against the live project database."/>}{result === "rows" && rows.length === 0 && <EmptyState icon={Terminal} title="No rows" text="The query ran and returned an empty result."/>}{result === "rows" && rows.length > 0 && <div className="query-result">{rows.slice(0, 50).map((row, index) => <code key={index}>{columns.map((column) => String(row[column] ?? "∅")).join(" · ")}</code>)}</div>}{result === "approval" && <div className="success-state"><ShieldCheck size={34}/><h3>Preview is ready</h3><p>No database change was applied. Review the diff and risk in the Approval Center.</p><button className="button small" onClick={()=>navigate("approvals")}>Open Approval Center</button></div>}{result === "error" && <EmptyState icon={X} title="Could not run" text={message || "Check the statement and try again."}/>}</article></div>;
}

type ProjectAuthUserItem={id:string;email:string;status:"active"|"disabled";emailVerifiedAt:string|null;createdAt:string;appMetadata:Record<string,unknown>};
function AuthView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [users,setUsers]=useState<ProjectAuthUserItem[]>([]);const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");const [message,setMessage]=useState("");const [jwks,setJwks]=useState(false);
  const load=useCallback(async()=>{setState("loading");setMessage("");try{const [usersResponse,jwksResponse]=await Promise.all([fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/admin/users?limit=100`,{cache:"no-store"}),fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/.well-known/jwks.json`,{cache:"no-store"})]);setJwks(jwksResponse.ok);if(usersResponse.status===503){setState("unavailable");setMessage("Project Auth is disabled for this environment.");return;}const payload=await usersResponse.json();if(!usersResponse.ok)throw new Error(payload.error??"Project users unavailable");setUsers(payload.data.users);setState("ready");}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:"Project users unavailable");}},[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  async function toggle(user:ProjectAuthUserItem){const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/auth/admin/users/${user.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:user.status==="active"?"disabled":"active"})});if(response.ok)await load();else setMessage("User status could not be changed.");}
  const active=users.filter(user=>user.status==="active").length;const verified=users.filter(user=>Boolean(user.emailVerifiedAt)).length;
  if(state==="loading")return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>Loading Project Auth…</h3></div>;
  if(state==="unavailable"||state==="error")return <div className="console-card live-module-state"><Fingerprint size={26}/><h3>{state==="unavailable"?"Project Auth not enabled":"Project Auth unavailable"}</h3><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> Retry</button></div>;
  return <div className="module-grid"><article className="console-card auth-overview"><div><span>APP USERS</span><strong>{users.length}</strong><small>Loaded from this environment</small></div><div><span>ACTIVE</span><strong>{active}</strong><small>{users.length?`${Math.round(active/users.length*100)}% of users`:"No users"}</small></div><div><span>EMAIL VERIFIED</span><strong>{verified}</strong><small>{jwks?"JWKS online":"JWKS unavailable"}</small></div></article><article className="console-card span-2"><div className="card-head"><div><span>PROJECT AUTH</span><h3>Application users</h3></div><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> Refresh</button></div>{users.map(user=><div className="auth-user" key={user.id}><span className="avatar">{user.email.slice(0,2).toUpperCase()}</span><div><strong>{user.email}</strong><small>{user.emailVerifiedAt?`Verified ${new Intl.DateTimeFormat("de-CH").format(new Date(user.emailVerifiedAt))}`:"Verification pending"}</small></div><span>{Object.keys(user.appMetadata).length?"Metadata":"Email"}</span><span className={user.status==="active"?"secure":"muted"}>{user.status}</span><button className="plain-button" onClick={()=>void toggle(user)}>{user.status==="active"?"Disable":"Enable"}</button></div>)}{users.length===0&&<div className="live-module-state compact"><Fingerprint size={24}/><p>No app users yet. Use the scoped signup, Magic Link or OIDC endpoints.</p></div>}</article><article className="console-card"><div className="card-head"><div><span>AUTH CONTRACT</span><h3>Available methods</h3></div></div><div className="detail-list"><div><span>Email &amp; password</span><strong className="secure">Ready</strong></div><div><span>Magic Link / Reset</span><strong className="secure">Ready</strong></div><div><span>TOTP + Recovery</span><strong className="secure">Ready</strong></div><div><span>OIDC + PKCE</span><strong>Configured by environment</strong></div><div><span>Ed25519 JWKS</span><strong className={jwks?"secure":""}>{jwks?"Online":"Unavailable"}</strong></div></div></article></div>;
}

function StorageView({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [buckets,setBuckets]=useState<ProjectStorageBucketItem[]>([]);
  const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");
  const [message,setMessage]=useState("");
  const endpoint=`/api/v1/projects/${projectId}/environments/${environment}/storage/buckets`;
  const load=useCallback(async()=>{setState("loading");setMessage("");try{const response=await fetch(endpoint,{cache:"no-store"});const payload=await response.json();if(response.status===503){setBuckets([]);setState("unavailable");setMessage(payload.error??"Project Storage is disabled for this environment.");return;}if(!response.ok)throw new Error(payload.error??"Storage unavailable");setBuckets(payload.data as ProjectStorageBucketItem[]);setState("ready");}catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:"Storage unavailable");}},[endpoint]);
  useEffect(()=>{void load();},[load]);
  async function create(){const raw=window.prompt("Bucket name (lowercase, numbers and hyphens)","project-assets");if(!raw)return;const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:raw.trim()})});const payload=await response.json();if(!response.ok){setMessage(payload.error??"Bucket could not be created");setState("error");return;}await load();}
  async function remove(bucket:ProjectStorageBucketItem){if(!window.confirm(`Delete empty bucket ${bucket.name}?`))return;const response=await fetch(`${endpoint}/${bucket.id}`,{method:"DELETE"});if(response.ok)await load();else{const payload=await response.json();setMessage(payload.error??"Only empty buckets can be deleted");setState("error");}}
  const used=buckets.reduce((sum,bucket)=>sum+bucket.usedBytes,0);
  const quota=buckets.reduce((sum,bucket)=>sum+bucket.quotaBytes,0);
  const percent=quota>0?Math.min(100,(used/quota)*100):0;
  return <div className="module-grid"><article className="console-card storage-total"><Cloud size={24}/><div><span>STORAGE USED</span><strong>{formatBytes(used)}</strong><small>{quota?`of ${formatBytes(quota)}`:"No buckets"}</small></div><div className="progress"><i style={{width:`${percent}%`}}/></div></article><article className="console-card span-2"><div className="card-head"><div><span>BUCKETS · {environment.toUpperCase()}</span><h3>Project storage</h3></div><button className="button small" onClick={()=>void create()} disabled={state==="loading"||state==="unavailable"}><Plus size={14}/> New bucket</button></div>{state==="loading"&&<p className="muted">Loading storage policy and usage…</p>}{(state==="unavailable"||state==="error")&&<div className="live-module-state compact"><Cloud size={24}/><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={13}/> Retry</button></div>}{state==="ready"&&buckets.length===0&&<p className="muted">No buckets yet. New buckets are private and accept only the default safe MIME allowlist.</p>}{state==="ready"&&buckets.map(bucket=><div className="bucket-row" key={bucket.id}><span className="bucket-icon"><HardDrive size={16}/></span><div><strong>{bucket.name}</strong><small>{bucket.readPolicy} read · {bucket.writePolicy} write · {bucket.retentionDays?`${bucket.retentionDays}d retention`:"no lifecycle"}</small></div><span>{formatBytes(bucket.usedBytes)} / {formatBytes(bucket.quotaBytes)}</span><button className="icon-button" onClick={()=>void remove(bucket)} aria-label={`Delete ${bucket.name}`}><Trash2 size={14}/></button></div>)}</article><article className="console-card"><div className="card-head"><div><span>POLICY STATUS</span><h3>Private by default</h3></div><ShieldCheck className="secure" size={21}/></div><p className="muted">Uploads are bound to exact size, MIME type and SHA-256 checksum. Objects remain quarantined until a scanner marks them clean; signed downloads expire after at most 15 minutes.</p></article></div>;
}

type FunctionDefinitionItem={id:string;name:string;image:string;entrypoint:string;timeoutMs:number;memoryMiB:number;egressOrigins:string[];secretRefs:string[];enabled:boolean};
type CronDefinitionItem={id:string;name:string;expression:string;queue:string;enabled:boolean;lastDispatchedAt:string|null};
type WebhookDefinitionItem={id:string;name:string;url:string;eventTypes:string[];signingSecretRef:string;timeoutMs:number;maxAttempts:number;enabled:boolean};
type WebhookDeliveryItem={id:string;eventType:string;status:"pending"|"in_flight"|"delivered"|"dead_lettered";attemptCount:number;lastFailureCode:string|null;settledAt:string|null};

/**
 * Cron-Jobs und Webhooks verwalten.
 *
 * Bis Release 1.20 entstanden beide ausschliesslich ueber direkten
 * Datenbankzugriff: Der Betrieb lief, aber niemand konnte ihm ohne `psql`
 * sagen, was er tun soll.
 *
 * Nur das Aktivierungsflag ist aenderbar. Ausdruck, Queue, Ziel-URL und
 * Signaturreferenz sind unveraenderlich; eine Aenderung ist ein Loeschen und
 * ein neues Anlegen. Diese Entscheidung liegt als Spaltenrecht in der
 * Datenbank, nicht in dieser Ansicht.
 */
function ComputeView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [cron,setCron]=useState<CronDefinitionItem[]>([]);
  const [webhooks,setWebhooks]=useState<WebhookDefinitionItem[]>([]);
  const [functions,setFunctions]=useState<FunctionDefinitionItem[]>([]);
  const [deliveries,setDeliveries]=useState<WebhookDeliveryItem[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"unavailable"|"error">("loading");
  const [message,setMessage]=useState("");
  const base=`/api/v1/projects/${projectId}/environments/${environment}/compute`;

  const load=useCallback(async()=>{setState("loading");setMessage("");try{
    const [cronResponse,webhookResponse,functionResponse]=await Promise.all([
      fetch(`${base}/cron`,{cache:"no-store"}),fetch(`${base}/webhooks`,{cache:"no-store"}),
      fetch(`${base}/functions`,{cache:"no-store"})]);
    const cronPayload=await cronResponse.json();const webhookPayload=await webhookResponse.json();
    const functionPayload=await functionResponse.json();
    if(cronResponse.status===503||webhookResponse.status===503){setCron([]);setWebhooks([]);setFunctions([]);setState("unavailable");
      setMessage(cronPayload.error??webhookPayload.error??"Compute definitions are disabled for this environment.");return;}
    if(!cronResponse.ok)throw new Error(cronPayload.error??"Cron definitions unavailable");
    if(!webhookResponse.ok)throw new Error(webhookPayload.error??"Webhook definitions unavailable");
    if(!functionResponse.ok)throw new Error(functionPayload.error??"Function definitions unavailable");
    setCron(cronPayload.data as CronDefinitionItem[]);setWebhooks(webhookPayload.data as WebhookDefinitionItem[]);
    setFunctions(functionPayload.data as FunctionDefinitionItem[]);setState("ready");
  }catch(cause){setState("error");setMessage(cause instanceof Error?cause.message:"Compute definitions unavailable");}},[base]);
  useEffect(()=>{void load();},[load]);

  async function mutate(path:string,init:RequestInit){const response=await fetch(`${base}${path}`,init);
    if(response.ok){await load();return true;}
    const payload=await response.json().catch(()=>({}));setMessage(payload.error??"The change was rejected.");return false;}

  async function createCron(){const name=window.prompt("Cron name (lowercase, numbers, hyphen)","nightly-report");if(!name)return;
    const expression=window.prompt("UTC expression: */N * * * * or M H * * *","*/15 * * * *");if(!expression)return;
    const queue=window.prompt("Existing project queue","email_jobs");if(!queue)return;
    await mutate("/cron",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),expression:expression.trim(),queue:queue.trim()})});}

  async function createWebhook(){const name=window.prompt("Webhook name (lowercase, numbers, hyphen)","order-events");if(!name)return;
    const url=window.prompt("Exact public HTTPS target, no query and no fragment","https://receiver.example.com/hooks");if(!url)return;
    const events=window.prompt("Event types, comma separated","order.created");if(!events)return;
    // Nur die Referenz. Das Geheimnis selbst liegt im Vault und darf diese
    // Flaeche nie beruehren.
    const signingSecretRef=window.prompt("Vault reference of the signing key — never the secret itself","vault:webhook/orders");if(!signingSecretRef)return;
    await mutate("/webhooks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),url:url.trim(),eventTypes:events.split(",").map(entry=>entry.trim()).filter(Boolean),signingSecretRef:signingSecretRef.trim()})});}

  async function createFunction(){const name=window.prompt("Function name (lowercase, numbers, hyphen)","resize-image");if(!name)return;
    // Digest statt Tag: Ein Tag koennte morgen einen anderen Inhalt bezeichnen.
    const image=window.prompt("Image pinned by digest, for example registry.example.com/app/fn@sha256:…","");if(!image)return;
    const entrypoint=window.prompt("Entrypoint inside the image","handler.mjs");if(!entrypoint)return;
    await mutate("/functions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),image:image.trim(),entrypoint:entrypoint.trim()})});}

  async function testInvoke(fn:FunctionDefinitionItem){
    setMessage(`Running ${fn.name}…`);
    const response=await fetch(`${base}/invoke/${fn.name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:"console"})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(payload.error??"The function could not be executed");return;}
    setMessage(`${fn.name} answered with status ${payload.data?.statusCode ?? "?"}.`);}

  async function showDeliveries(webhook:WebhookDefinitionItem){
    if(selected===webhook.id){setSelected(null);setDeliveries([]);return;}
    const response=await fetch(`${base}/webhooks/${webhook.id}/deliveries?limit=20`,{cache:"no-store"});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(payload.error??"Delivery status unavailable");return;}
    setSelected(webhook.id);setDeliveries(payload.data as WebhookDeliveryItem[]);}

  if(state==="loading")return <div className="console-card live-module-state"><RefreshCw size={24}/><h3>Loading cron and webhook definitions…</h3></div>;
  if(state==="unavailable")return <div className="console-card live-module-state"><Webhook size={26}/><h3>Compute definitions not enabled</h3><p>{message}</p><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> Retry</button></div>;

  return <div className="module-grid">
    <article className="console-card span-2"><div className="card-head"><div><span>FUNCTIONS · {environment.toUpperCase()}</span><h3>Sandboxed execution</h3></div><button className="button small" onClick={()=>void createFunction()}><Plus size={14}/> New function</button></div>
      {functions.length===0&&<p className="muted">No functions yet. An image must be pinned by digest; the sandbox runs it without network, read-only, as a non-root user and with a hard memory limit.</p>}
      {functions.map(fn=><div className="bucket-row" key={fn.id}><span className="bucket-icon"><Blocks size={16}/></span>
        <div><strong>{fn.name}</strong><small>{fn.entrypoint} · {fn.memoryMiB} MiB · {fn.timeoutMs} ms · {fn.egressOrigins.length?`${fn.egressOrigins.length} egress origins (not yet executable)`:"no egress"}{fn.secretRefs.length?` · ${fn.secretRefs.length} secret refs`:""}</small></div>
        <span className={fn.enabled?"secure":"muted"}>{fn.enabled?"enabled":"paused"}</span>
        <button className="plain-button" onClick={()=>void testInvoke(fn)} disabled={!fn.enabled}>Test run</button>
        <button className="plain-button" onClick={()=>void mutate(`/functions/${fn.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!fn.enabled})})}>{fn.enabled?"Pause":"Enable"}</button>
        <button className="icon-button" onClick={()=>{if(window.confirm(`Delete function ${fn.name}? Image and limits cannot be edited, so this is how a change is made.`))void mutate(`/functions/${fn.id}`,{method:"DELETE"});}} aria-label={`Delete ${fn.name}`}><Trash2 size={14}/></button></div>)}
    </article>
    <article className="console-card span-2"><div className="card-head"><div><span>CRON · {environment.toUpperCase()}</span><h3>Scheduled dispatch</h3></div><button className="button small" onClick={()=>void createCron()}><Plus size={14}/> New cron job</button></div>
      {message&&<p className="muted">{message}</p>}
      {cron.length===0&&<p className="muted">No cron jobs yet. An occurrence is enqueued into an existing project queue with a deterministic dedupe key, so two schedulers produce exactly one message.</p>}
      {cron.map(job=><div className="bucket-row" key={job.id}><span className="bucket-icon"><Zap size={16}/></span>
        <div><strong>{job.name}</strong><small>{job.expression} UTC → {job.queue} · {job.lastDispatchedAt?`last ${new Intl.DateTimeFormat("de-CH",{dateStyle:"short",timeStyle:"short"}).format(new Date(job.lastDispatchedAt))}`:"never dispatched"}</small></div>
        <span className={job.enabled?"secure":"muted"}>{job.enabled?"enabled":"paused"}</span>
        <button className="plain-button" onClick={()=>void mutate(`/cron/${job.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!job.enabled})})}>{job.enabled?"Pause":"Enable"}</button>
        <button className="icon-button" onClick={()=>{if(window.confirm(`Delete cron job ${job.name}? Expression and queue cannot be edited, so this is how a change is made.`))void mutate(`/cron/${job.id}`,{method:"DELETE"});}} aria-label={`Delete ${job.name}`}><Trash2 size={14}/></button></div>)}
    </article>
    <article className="console-card"><div className="card-head"><div><span>DELIVERY CONTRACT</span><h3>Signed and acknowledged</h3></div><ShieldCheck className="secure" size={21}/></div>
      <p className="muted">Every delivery is signed with HMAC-SHA256 over timestamp and body. A receiver must answer 2xx <em>and</em> echo the <code>x-qkern-delivery-id</code> header; otherwise the attempt counts as failed and the server decides when to retry. Payloads are never shown here.</p></article>
    <article className="console-card span-2"><div className="card-head"><div><span>WEBHOOKS · {environment.toUpperCase()}</span><h3>Outbound delivery targets</h3></div><button className="button small" onClick={()=>void createWebhook()}><Plus size={14}/> New webhook</button></div>
      {webhooks.length===0&&<p className="muted">No webhooks yet. Targets must be exact public HTTPS URLs on port 443 without query or fragment — the same rule the deliverer applies, so a target accepted here cannot be rejected later.</p>}
      {webhooks.map(hook=><div key={hook.id}>
        <div className="bucket-row"><span className="bucket-icon"><Webhook size={16}/></span>
          <div><strong>{hook.name}</strong><small>{hook.url} · {hook.eventTypes.join(", ")} · {hook.maxAttempts} attempts · key {hook.signingSecretRef}</small></div>
          <span className={hook.enabled?"secure":"muted"}>{hook.enabled?"enabled":"paused"}</span>
          <button className="plain-button" onClick={()=>void showDeliveries(hook)}>{selected===hook.id?"Hide status":"Delivery status"}</button>
          <button className="plain-button" onClick={()=>void mutate(`/webhooks/${hook.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!hook.enabled})})}>{hook.enabled?"Pause":"Enable"}</button>
          <button className="icon-button" onClick={()=>{if(!hook.enabled&&window.confirm(`Delete webhook ${hook.name}? Pending deliveries are removed with it.`))void mutate(`/webhooks/${hook.id}`,{method:"DELETE"});else if(hook.enabled)setMessage("Pause the webhook before deleting it — deletion also removes its pending deliveries.");}} aria-label={`Delete ${hook.name}`}><Trash2 size={14}/></button></div>
        {selected===hook.id&&<div className="detail-list">{deliveries.length===0?<div><span>No deliveries recorded</span><strong className="muted">–</strong></div>:deliveries.map(delivery=><div key={delivery.id}><span>{delivery.eventType}<small>attempt {delivery.attemptCount}{delivery.lastFailureCode?` · ${delivery.lastFailureCode}`:""}</small></span><strong className={delivery.status==="delivered"?"secure":delivery.status==="dead_lettered"?"risk high":""}>{delivery.status}</strong></div>)}</div>}
      </div>)}
    </article>
  </div>;
}

function ApiView() { const [language,setLanguage]=useState("typescript"); return <div className="api-layout"><article className="console-card endpoint-list"><div className="card-head"><div><span>AUTO-GENERATED REST API</span><h3>Schema endpoints</h3></div><span className="secure">OpenAPI synced</span></div>{["products","orders","profiles","organizations"].map((endpoint)=><button key={endpoint}><span className="method get">GET</span><code>/v1/{endpoint}</code><ChevronRight size={14}/></button>)}</article><article className="console-card code-sample"><div className="code-head"><span>GET /v1/products</span><select value={language} onChange={e=>setLanguage(e.target.value)}><option value="typescript">TypeScript</option><option value="curl">cURL</option></select></div><pre>{language === "typescript" ? `const { data, error } = await qkern\n  .from("products")\n  .select("id, name, price")\n  .eq("active", true)\n  .limit(20);` : `curl 'https://api.example.qkern.ch/v1/products?limit=20' \\\n  -H "x-qkern-key: $QKERN_PUBLIC_KEY"`}</pre><div className="code-note"><ShieldCheck size={14}/> Response is filtered by the caller&apos;s RLS policies.</div></article></div>; }

function LiveApiView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [language,setLanguage]=useState("typescript");
  const [paths,setPaths]=useState<string[]>([]);
  const [keys,setKeys]=useState<ProjectApiKeyItem[]>([]);
  const [secret,setSecret]=useState("");
  const [message,setMessage]=useState("");
  const load=useCallback(async()=>{setMessage("");const [openapiResponse,keysResponse]=await Promise.all([fetch(`/api/v1/projects/${projectId}/environments/${environment}/generated-openapi?schema=public`,{cache:"no-store"}),fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys`,{cache:"no-store"})]);if(openapiResponse.ok){const document=await openapiResponse.json();setPaths(Object.keys(document.paths??{}));}else{setPaths([]);setMessage("Generated OpenAPI is unavailable until the project API role is configured.");}if(keysResponse.ok){setKeys((await keysResponse.json()).data as ProjectApiKeyItem[]);}},[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  async function createKey(kind:"public"|"service"){const name=window.prompt(`Name for the ${kind} key`,kind==="public"?"Browser public key":"Server service key");if(!name)return;const expiresAt=new Date(Date.now()+(kind==="public"?90:30)*24*60*60*1000).toISOString();const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,kind,expiresAt})});if(!response.ok){setMessage((await response.json()).error??"Key could not be created");return;}const payload=await response.json();setSecret(payload.data.secret);await load();}
  async function revoke(keyId:string){if(!window.confirm("Revoke this key permanently?"))return;const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/api-keys/${keyId}`,{method:"DELETE"});if(response.ok)await load();else setMessage("Key could not be revoked.");}
  const endpoint=paths[0]??`/v1/projects/${projectId}/environments/${environment}/tables/{table}/rows`;
  const typeScriptExample=`const response = await fetch(\n  \"/api${endpoint}?limit=20\",\n  { headers: {\n      Authorization: \"Bearer \" + QKERN_PUBLIC_KEY\n  } }\n);\nconst { data } = await response.json();`;
  const curlExample=`curl '/api${endpoint}?limit=20' -H \"Authorization: Bearer $QKERN_PUBLIC_KEY\"`;
  return <div className="api-console-grid"><article className="console-card endpoint-list"><div className="card-head"><div><span>AUTO-GENERATED REST API</span><h3>Live schema endpoints</h3></div><span className={paths.length?"secure":"muted"}>{paths.length?"OpenAPI synced":"Not configured"}</span></div>{paths.map(path=><button key={path}><span className="method get">CRUD</span><code>{path}</code><ChevronRight size={14}/></button>)}{paths.length===0&&<div className="live-module-state compact"><Braces size={24}/><p>{message||"No RLS-enabled table with a primary key is exposed."}</p></div>}</article><article className="console-card code-sample"><div className="code-head"><span>GET {endpoint}</span><select value={language} onChange={event=>setLanguage(event.target.value)}><option value="typescript">TypeScript</option><option value="curl">cURL</option></select></div><pre>{language==="typescript"?typeScriptExample:curlExample}</pre><div className="code-note"><ShieldCheck size={14}/> Filters are parameterized; rows are restricted by the project role and RLS.</div></article><article className="console-card span-2 api-key-manager"><div className="card-head"><div><span>PROJECT API KEYS</span><h3>Scoped access for {environment}</h3></div><div><button className="secondary-button" onClick={()=>void createKey("public")}><Plus size={13}/> Public key</button><button className="button small" onClick={()=>void createKey("service")}><Plus size={13}/> Service key</button></div></div>{secret&&<div className="one-time-secret"><div><strong>Copy now — shown only once</strong><code>{secret}</code></div><button onClick={()=>void navigator.clipboard.writeText(secret)}><Copy size={14}/> Copy</button><button onClick={()=>setSecret("")}><X size={14}/></button></div>}<div className="api-key-list">{keys.map(key=><div key={key.id}><span className={`key-kind ${key.kind}`}>{key.kind}</span><div><strong>{key.name}</strong><code>{key.prefix}…</code></div><span>{key.revokedAt?"revoked":`expires ${new Intl.DateTimeFormat("de-CH").format(new Date(key.expiresAt))}`}</span>{!key.revokedAt&&<button onClick={()=>void revoke(key.id)} aria-label="Revoke key"><Trash2 size={14}/></button>}</div>)}{keys.length===0&&<p className="muted">No keys created. Raw secrets are never stored and are shown once.</p>}</div></article></div>;
}

function AIBridge({ projectId, environment, reload, navigate }: { projectId: string; environment: Environment; reload: () => Promise<void>; navigate: (view: ViewId) => void }) {
  const [prompt,setPrompt]=useState("Inspect the schema and prepare an index for orders.created_at. Do not apply it."); const [creating,setCreating]=useState(false); const [done,setDone]=useState(false);
  async function create(){setCreating(true); const response=await fetch("/api/v1/changesets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,environment,title:"Index orders by creation time",statement:"CREATE INDEX orders_created_at_idx ON orders (created_at DESC)"})}); setCreating(false); if(response.ok){setDone(true);await reload();}}
  return <div className="ai-console-grid"><article className="console-card connection-card"><div className="card-head"><div><span>AI CONNECTIONS</span><h3>Connected agents</h3></div><button className="button small"><Plus size={14}/> Connect</button></div><div className="connected-agent"><div className="agent-mark">C</div><div><strong>Codex</strong><small>Read-only + migration preview</small></div><span className="secure">Connected</span><button>•••</button></div><div className="connected-agent"><div className="agent-mark claude">A</div><div><strong>Claude Code</strong><small>Developer · Development only</small></div><span className="secure">Connected</span><button>•••</button></div><div className="connection-meta"><span>Tokens expire after 60 min</span><span>Last call 4 min ago</span></div></article><article className="console-card workspace-card"><div className="card-head"><div><span>CONTROLLED AGENT WORKSPACE</span><h3>Prepare a backend change</h3></div><span className={`environment-select ${environment}`}>{environment}</span></div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} aria-label="Agent task"/><div className="workspace-scope"><ShieldCheck size={14}/><span>Agent can read schema and create previews. Approval and queueing follow the project&apos;s manual, guarded or autonomous policy; secrets remain hidden.</span></div><button className="button" onClick={create} disabled={creating}>{creating?"Preparing…":"Create safe preview"}<ArrowIcon/></button>{done&&<div className="inline-success"><CheckIcon/>Change Set created. <button onClick={()=>navigate("approvals")}>Open policy &amp; decisions</button></div>}</article><article className="console-card span-2 mcp-config"><div className="card-head"><div><span>CODEX SETUP</span><h3>Project-scoped Streamable HTTP</h3></div><span className="secure">Production target</span></div><pre>{`[mcp_servers.qkern]\nurl = "https://mcp.example.qkern.ch/mcp"\nauth = "oauth"\nrequired = true\nenabled_tools = ["qkern_project_get", "qkern_schema_list", "qkern_query_readonly", "qkern_migration_preview"]\ndefault_tools_approval_mode = "writes"`}</pre><p>OAuth must bind the MCP session to actor, organization, project, environment and tool scopes.</p></article></div>;
}

function ActivityView({ audit, aiOnly }: { audit: AuditEvent[]; aiOnly: boolean }) { return <article className="console-card activity-log"><div className="log-toolbar"><div className="toolbar-search"><Search size={14}/><input placeholder="Search events…"/></div><button className="secondary-button"><ListFilter size={14}/> Filters</button></div><div className="log-row log-header"><span>Time</span><span>Actor</span><span>Action</span><span>Resource</span><span>Status</span></div>{audit.filter(e=>!aiOnly||e.actor==="Codex").map(event=><div className="log-row" key={event.id}><time>{formatTime(event.createdAt)}</time><span><Bot size={13}/>{event.actor}</span><code>{event.action}</code><span>{event.resource}</span><span className={`log-status ${event.status}`}>{event.status}</span></div>)}</article>; }

function ApprovalView({ projectId, environment, approvals, changes, reload }: { projectId: string; environment: Environment; approvals: Approval[]; changes: ChangeSet[]; reload: () => Promise<void> }) {
  const [busy,setBusy]=useState("");
  async function decide(id:string,decision:"approved"|"rejected"){setBusy(id);await fetch(`/api/v1/approvals/${id}/decision`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision})});setBusy("");await reload();}
  const scopedApprovals = approvals.filter((approval) => approval.projectId === projectId && approval.environment === environment);
  return <div className="approval-list">
    <AutomationPolicyPanel projectId={projectId} environment={environment}/>
    {scopedApprovals.length===0&&<EmptyState icon={ShieldCheck} title="No approval requests" text="Risky agent and Console changes appear here."/>}
    {scopedApprovals.map(approval=>{const change=changes.find(item=>item.id===approval.changeSetId);return <article className="console-card approval-card" key={approval.id}><div className="approval-top"><span className={`risk ${approval.risk}`}>{approval.risk} risk</span><span>{approval.environment}</span><time>{formatTime(approval.createdAt)}</time></div><h2>{approval.action}</h2><p>Requested by {approval.requestedBy}. No change has been applied.</p>{change&&<><div className="approval-detail-grid"><div><span>AFFECTED RESOURCE</span><strong>{change.projectId}</strong></div><div><span>CHANGE SET</span><strong>{change.id}</strong></div><div><span>STATUS</span><strong>{approval.status}</strong></div></div><div className="approval-diff">{change.diff.map(line=><code key={line}>{line}</code>)}</div><div className="test-chips">{change.tests.map(test=><span key={test}><CheckIcon/>{test}</span>)}</div></>}{approval.status==="pending"?<div className="approval-actions"><button className="ghost-button" disabled={busy===approval.id} onClick={()=>decide(approval.id,"rejected")}>Reject</button><button className="button" disabled={busy===approval.id} onClick={()=>decide(approval.id,"approved")}>Approve once</button></div>:<div className={`decision-banner ${approval.status}`}>Decision recorded: {approval.status}</div>}</article>})}
  </div>;
}

function AutomationPolicyPanel({ projectId, environment }: { projectId: string; environment: Environment }) {
  const [policy,setPolicy]=useState<ProjectAutomationPolicy|null>(null);
  const [mode,setMode]=useState<AutomationMode>("manual");
  const [maxAutoRisk,setMaxAutoRisk]=useState<Risk>("low");
  const [autoQueue,setAutoQueue]=useState(false);
  const [emergencyStop,setEmergencyStop]=useState(false);
  const [state,setState]=useState<"loading"|"idle"|"saving"|"saved"|"error">("loading");

  useEffect(()=>{let active=true;setState("loading");void fetch(`/api/v1/projects/${projectId}/environments/${environment}/automation-policy`,{cache:"no-store"}).then(async response=>{if(!response.ok)throw new Error("policy unavailable");return (await response.json()).data as ProjectAutomationPolicy;}).then(next=>{if(!active)return;setPolicy(next);setMode(next.mode);setMaxAutoRisk(next.maxAutoRisk);setAutoQueue(next.autoQueue);setEmergencyStop(next.emergencyStop);setState("idle");}).catch(()=>{if(active)setState("error");});return()=>{active=false;};},[projectId,environment]);

  async function save(){setState("saving");const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/automation-policy`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,maxAutoRisk,autoQueue:environment==="production"?false:autoQueue,emergencyStop})});if(!response.ok){setState("error");return;}const next=(await response.json()).data as ProjectAutomationPolicy;setPolicy(next);setState("saved");}
  const description = mode === "manual" ? "Jede riskante Änderung wartet auf eine menschliche Entscheidung." : mode === "guarded" ? "Nur klar begrenzte, nicht-produktive Änderungen bis zur Risikogrenze werden automatisch freigegeben." : "Agenten dürfen Änderungen bis zur Risikogrenze ohne Freigabe pro Änderung genehmigen.";
  return <article className={`console-card automation-policy ${emergencyStop?"stopped":""}`}>
    <div className="card-head"><div><span>AUTOMATION POLICY · {environment.toUpperCase()}</span><h3>Freigabemodus</h3></div><span className={`automation-status ${emergencyStop?"stopped":mode}`}>{emergencyStop?"NOT-AUS":mode}</span></div>
    <p>{description} Jede automatische Entscheidung bleibt im Audit-Log nachvollziehbar.</p>
    <div className="automation-fields">
      <label>Modus<select value={mode} onChange={event=>setMode(event.target.value as AutomationMode)}><option value="manual">Manuell</option><option value="guarded">Abgesichert</option><option value="autonomous">Autonom</option></select></label>
      <label>Maximales Auto-Risiko<select value={maxAutoRisk} onChange={event=>setMaxAutoRisk(event.target.value as Risk)} disabled={mode==="manual"}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
      <label className="automation-check"><input type="checkbox" checked={autoQueue&&environment!=="production"} disabled={mode==="manual"||environment==="production"} onChange={event=>setAutoQueue(event.target.checked)}/><span>Nach Auto-Freigabe direkt einreihen<small>{environment==="production"?"Production braucht zusätzlich eine maschinell signierte Release-Autorisierung.":"Der Worker führt weiterhin alle Datenbank- und Ledger-Prüfungen aus."}</small></span></label>
      <label className="automation-check danger"><input type="checkbox" checked={emergencyStop} onChange={event=>setEmergencyStop(event.target.checked)}/><span>Not-Aus aktivieren<small>Stoppt sofort jede automatische Freigabe und Queue-Einreihung.</small></span></label>
    </div>
    {(mode==="autonomous"&&(maxAutoRisk==="high"||maxAutoRisk==="critical"))&&<div className="automation-warning"><ShieldCheck size={15}/><span>Weitreichende stehende Autorisierung. Nutze sie gezielt pro Projekt und Umgebung.</span></div>}
    <div className="automation-footer"><span>{policy?`Policy revision ${policy.revision}`:"Policy wird geladen"}</span>{state==="error"&&<strong>Policy konnte nicht geladen oder gespeichert werden.</strong>}{state==="saved"&&<strong className="secure">Gespeichert</strong>}<button className="button small" onClick={save} disabled={state==="loading"||state==="saving"}>{state==="saving"?"Speichern…":"Policy speichern"}</button></div>
  </article>;
}

function UsageView({projectId,environment}:{projectId:string;environment:Environment}) {
  const [projection,setProjection]=useState<UsageProjection|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"disabled"|"error">("loading");
  const load=useCallback(async()=>{
    setState("loading");
    try {
      const response=await fetch(`/api/v1/projects/${projectId}/environments/${environment}/usage`,{cache:"no-store"});
      if(response.status===503){setProjection(null);setState("disabled");return;}
      if(!response.ok)throw new Error("Usage projection unavailable");
      setProjection(((await response.json()) as {data:UsageProjection}).data);
      setState("ready");
    } catch {setProjection(null);setState("error");}
  },[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  if(state==="loading")return <LoadingState/>;
  if(state==="disabled")return <EmptyState icon={CircleGauge} title="Usage Metering ist deaktiviert" text="Aktiviere QKERN_USAGE_METERING_ENABLED und die dauerhafte Runtime-Persistenz, um echte Monatswerte zu sehen."/>;
  if(state==="error"||!projection)return <ErrorState message="Die Usage-Projektion konnte nicht geladen werden." retry={()=>void load()}/>;
  return <>
    <div className="product-preview-notice"><ShieldCheck size={16}/><div><strong>Read-only Usage-Projektion</strong><span>{projection.period} · tenantgebunden · keine Preise, Rechnungen oder Browser-mutierbaren Limits</span></div></div>
    <div className="metric-grid monitoring-grid">
      {projection.metrics.slice(0,4).map(item=><article className="console-card metric-tile" key={item.metric}><div><span>{item.label.toUpperCase()}</span><CircleGauge size={17}/></div><strong>{formatUsageAmount(item.used,item.unit)}</strong><small>{item.limit===null?"Kein Limit":`${formatUsageAmount(item.remaining??"0",item.unit)} verbleibend`}</small></article>)}
    </div>
    <article className="console-card chart-card">
      <div className="card-head"><div><span>MONTHLY LEDGER</span><h3>Usage und Quota-Status</h3></div><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> Aktualisieren</button></div>
      <div className="detail-list">
        {projection.metrics.map(item=><div key={item.metric}><span>{item.label}<small>{item.mode} · Revision {item.revision??"–"}</small></span><strong className={item.status==="exceeded"||item.status==="exhausted"?"risk high":item.status==="warning"?"risk medium":"secure"}>{formatUsageAmount(item.used,item.unit)}{item.limit===null?"":` / ${formatUsageAmount(item.limit,item.unit)}`} · {usageStatusLabel(item.status)}</strong></div>)}
      </div>
    </article>
    <InvoicesCard projectId={projectId} environment={environment}/>
  </>;
}

/**
 * Die ausgestellten Rechnungen — lesend, aus dem eingefrorenen Dokument des
 * Rechnungslaufs. Der Ladeweg steckt in `loadConsoleInvoices`, damit er ohne
 * Browser-Testumgebung pruefbar ist; hier wird er nur eingehaengt.
 */
function InvoicesCard({projectId,environment}:{projectId:string;environment:Environment}) {
  const [result,setResult]=useState<ConsoleInvoiceResult|null>(null);
  const load=useCallback(async()=>{
    setResult(null);
    setResult(await loadConsoleInvoices(projectId,environment));
  },[projectId,environment]);
  useEffect(()=>{void load();},[load]);
  return <article className="console-card chart-card">
    <div className="card-head"><div><span>INVOICES</span><h3>Ausgestellte Rechnungen</h3></div><button className="secondary-button" onClick={()=>void load()}><RefreshCw size={14}/> Aktualisieren</button></div>
    {result===null&&<p className="muted">Rechnungen werden geladen…</p>}
    {result?.state==="disabled"&&<p className="muted">Usage Metering ist deaktiviert — ohne Zähler kein Rechnungslauf.</p>}
    {result?.state==="error"&&<p className="muted">Die Rechnungen konnten nicht geladen werden.</p>}
    {result?.state==="ready"&&result.invoices.length===0&&<p className="muted">Noch keine Rechnung — der Rechnungslauf fakturiert abgeschlossene Monate.</p>}
    {result?.state==="ready"&&result.invoices.length>0&&<div className="detail-list">
      {result.invoices.map(invoice=><div key={invoice.invoiceNumber}><span>Rechnung Nr. {invoice.invoiceNumber}<small>{invoice.periodStart} bis {invoice.periodEnd} · fällig {invoice.dueAt.slice(0,10)} · {invoice.lines.length} {invoice.lines.length===1?"Posten":"Posten"}</small></span><strong>{invoice.total} {invoice.currency}</strong></div>)}
    </div>}
  </article>;
}

function BackupsView(){return <div className="module-grid"><article className="console-card backup-hero"><ArchiveRestore size={24}/><div><span>BACKUP STATUS</span><h2>Protected</h2><p>Last verified backup today at 03:00 UTC</p></div><button className="button small">Create backup</button></article><article className="console-card"><div className="card-head"><div><span>RETENTION</span><h3>7 daily backups</h3></div></div><div className="detail-list"><div><span>Encryption</span><strong className="secure">Active</strong></div><div><span>Point-in-time</span><strong>Roadmap</strong></div><div><span>Restore tests</span><strong>Weekly</strong></div></div></article><article className="console-card span-2"><div className="card-head"><div><span>BACKUP HISTORY</span><h3>Available restore points</h3></div></div>{["17 Jul 2026 · 03:00","16 Jul 2026 · 03:00","15 Jul 2026 · 03:00"].map((date,index)=><div className="backup-row" key={date}><span className="secure"><ShieldCheck size={15}/></span><div><strong>{date}</strong><small>284 MB · encrypted · checksum verified</small></div><span>{index===0?"Automatic":"Daily"}</span><button className="secondary-button">Restore preview</button></div>)}</article></div>}

function SettingsView(){return <div className="settings-layout"><aside className="console-card settings-nav"><button className="active">General</button><button>Environments</button><button>API keys</button><button>AI connections</button><button>Team access</button><button>Danger zone</button></aside><article className="console-card settings-form"><span className="console-kicker">PROJECT SETTINGS</span><h2>General</h2><label>Project name<input defaultValue="Nova Market"/></label><label>Project ID<input defaultValue="prj_novamarket" readOnly/></label><label>Region<select defaultValue="ch-zrh-1"><option>ch-zrh-1 · Switzerland</option></select></label><div className="form-note"><ShieldCheck size={16}/><p><strong>Infrastructure claim not yet verified</strong><br/>The region label is a product configuration example, not a public data-residency guarantee.</p></div><button className="button">Save changes</button></article></div>}

function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: ViewId) => void }){const [query,setQuery]=useState("");const matches=nav.filter(item=>item.label.toLowerCase().includes(query.toLowerCase()));return <div className="command-overlay" onMouseDown={onClose}><div className="command-palette" onMouseDown={e=>e.stopPropagation()}><div className="command-input"><Search size={18}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search QKERN Console…"/><button onClick={onClose}>ESC</button></div><div className="command-results"><span>NAVIGATE</span>{matches.map(item=>{const Icon=item.icon;return <button key={item.id} onClick={()=>{onNavigate(item.id);onClose();}}><Icon size={16}/>{item.label}<Command size={13}/></button>})}</div></div></div>}
function LoadingState(){return <div className="loading-grid">{Array.from({length:8}).map((_,i)=><i key={i}/>)}</div>}
function ErrorState({message,retry}:{message:string;retry:()=>void}){return <div className="error-state"><X size={30}/><h3>Console data could not be loaded</h3><p>{message}</p><button className="button small" onClick={retry}>Try again</button></div>}
function EmptyState({icon:Icon,title,text}:{icon:typeof Database;title:string;text:string}){return <div className="empty-state"><Icon size={28}/><h3>{title}</h3><p>{text}</p></div>}
function CheckIcon(){return <span className="check-icon">✓</span>}
function ArrowIcon(){return <span aria-hidden>→</span>}
function formatTime(value:string){return new Intl.DateTimeFormat("de-CH",{hour:"2-digit",minute:"2-digit"}).format(new Date(value))}
function formatCell(value:unknown){if(value===null)return "null";if(typeof value==="object")return JSON.stringify(value);return String(value)}
function formatBytes(value:number){if(value<1024)return `${value} B`;const units=["KB","MB","GB","TB","PB"];let amount=value/1024;let index=0;while(amount>=1024&&index<units.length-1){amount/=1024;index+=1;}return `${amount>=10?amount.toFixed(1):amount.toFixed(2)} ${units[index]}`;}
function formatUsageAmount(value:string,unit:"operations"|"rows"|"bytes"){
  const amount=BigInt(value);
  if(unit!=="bytes")return new Intl.NumberFormat("de-CH").format(amount);
  const units=[["PB",1125899906842624n],["TB",1099511627776n],["GB",1073741824n],["MB",1048576n],["KB",1024n]] as const;
  for(const [label,size] of units){if(amount>=size){const tenths=amount*10n/size;return `${tenths/10n}.${tenths%10n} ${label}`;}}
  return `${amount} B`;
}
function usageStatusLabel(status:UsageProjection["metrics"][number]["status"]){return ({unlimited:"unbegrenzt",ok:"im Rahmen",warning:"Warnschwelle",exhausted:"ausgeschöpft",exceeded:"überschritten"} as const)[status];}
