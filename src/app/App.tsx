import { useState, useEffect, useRef, createContext, useContext } from "react";
import {
  LayoutDashboard, Bot, PhoneCall, FileText, Mic, BarChart2, TrendingUp,
  ClipboardList, Heart, Settings, CreditCard, ChevronDown,
  Bell, HelpCircle, Search, User, Circle, CheckCircle2, AlertCircle,
  XCircle, Clock, ArrowUpRight, ArrowDownRight, Minus, Play, Pause,
  Download, Flag, Send, ChevronRight, Phone, Star, Zap, Shield,
  RefreshCw, Eye, EyeOff, Edit2, Trash2, Plus, Filter, Calendar,
  MoreHorizontal, Inbox, AlertTriangle, Check, X, Volume2, List, Columns,
  Lock, Unlock, Info, UploadCloud, MessageSquare, Users, Globe, Mail,
  Building2, Wifi, WifiOff, Database, Server, Layers, ToggleLeft,
  ToggleRight, ChevronLeft, PhoneOutgoing
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, LabelList
} from "recharts";

// ── Palette helpers ──────────────────────────────────────────────────────────
const TEAL = "#0D9488";
const PURPLE = "#7C3AED";
const INDIGO = "#6366F1";
const AMBER = "#F59E0B";
const RED = "#EF4444";
const GREEN = "#10B981";
const SLATE = "#64748B";

// ── Types ─────────────────────────────────────────────────────────────────────
interface StaffTask {
  id: string;
  patient?: string;
  phone?: string;
  type?: string;
  summary?: string;
  sentiment?: string;
  priority?: string;
  due?: string;
  assignee?: string;
  status: string;
  created_at?: string;
  [key: string]: unknown;
}

interface CallLog {
  id: number | string;
  time?: string;
  caller?: string;
  phone?: string;
  type?: string;
  service?: string;
  provider?: string;
  outcome?: string;
  sentiment?: string;
  duration?: string;
  staffAction?: boolean;
  direction?: "inbound" | "outbound";
  recordingUrl?: string;
  summary?: string;
}

type Transcript = {
  id: number | string;
  time?: string;
  caller?: string;
  outcome?: string;
  sentiment?: string;
  service?: string;
  duration?: string;
  preview?: string;
  direction?: "inbound" | "outbound";
  lines?: { speaker: string; text: string }[];
};

type AnalyticsPoint = { label: string; calls: number; minutes: number; completed: number; missed: number; avg: number };

// Shape of the Inbound Tracker's "Build Overview Response" node output.
type OverviewStats = {
  clientName: string; basePrice: number; clientRatePerMin: number; overageRate: number;
  minutesUsed: number; minutesIncluded: number; remainingMinutes: number; overageMinutes: number;
  totalCalls: number; overageUSD: number; monthlyTotal: number; avgCallMin: number;
  avgCallDisplay: string; billingPeriod: string; billingPct: number; billingPctRaw: number;
  totalRecordings: number; totalTranscripts: number;
};

// Shape of one entry from the Inbound Tracker's "Build Invoices Response" node.
type UsageInvoice = {
  id: string; invoice_id: string; period: string; amount: string; amountRaw: number;
  minutes: string; minutesUsed: number; includedMinutes: number; status: string;
  date: string; dueDate: string; paid: boolean; isOverage: boolean; overageMin: number;
  overageRate: number; overageCost: number; baseRate: number;
};

// Adapts the Inbound Tracker n8n workflow's response shapes (see
// "Build Calls Response" / "Build Transcripts Response" nodes) into this
// dashboard's existing CallLog/Transcript types.
function mapInboundCall(raw: Record<string, unknown>): CallLog {
  return {
    id: String(raw.call_id ?? raw.id ?? crypto.randomUUID()),
    time: String(raw.timestamp ?? raw.date ?? ""),
    caller: String(raw.callerName ?? raw.from ?? "Unknown"),
    phone: String(raw.from ?? ""),
    outcome: String(raw.status ?? ""),
    sentiment: String(raw.sentiment ?? ""),
    duration: String(raw.durationDisplay ?? raw.duration_display ?? ""),
    staffAction: false,
    direction: "inbound",
    recordingUrl: String(raw.recordingUrl ?? raw.recording_url ?? ""),
    summary: String(raw.summary ?? ""),
  };
}

function mapInboundTranscript(raw: Record<string, unknown>): Transcript {
  return {
    id: String(raw.call_id ?? raw.id ?? crypto.randomUUID()),
    time: String(raw.timestamp ?? raw.date ?? ""),
    caller: String(raw.callerName ?? "Unknown"),
    outcome: String(raw.status ?? ""),
    sentiment: String(raw.sentiment ?? ""),
    duration: String(raw.durationDisplay ?? raw.duration_display ?? ""),
    preview: String(raw.summary ?? ""),
    direction: "inbound",
    lines: Array.isArray(raw.transcript) ? raw.transcript as { speaker: string; text: string }[] : [],
  };
}

// ── Dashboard context ─────────────────────────────────────────────────────────
interface TenantInfo {
  client_id: string;
  clinic_id: string;
  clinic_name: string;
  receptionist_name: string;
  link_label: string;
}

interface DashboardCtx {
  accessToken: string | null;
  tenantInfo: TenantInfo | null;
  staffTasks: StaffTask[];
  callLogs: CallLog[];
  transcripts: Transcript[];
  analytics: AnalyticsPoint[];
  overview: OverviewStats | null;
  outboundOverview: OverviewStats | null;
  overviewRefreshing: boolean;
  refreshOverview: () => Promise<void>;
  invoices: UsageInvoice[];
  loading: boolean;
  settings: Record<string, unknown>;
  updateTaskStatus: (id: string, status: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  saveSection: (section: string, data: Record<string, unknown>) => Promise<boolean>;
  saveBulk: (sections: Record<string, unknown>) => Promise<void>;
  syncRetell: () => Promise<{ ok: boolean; error?: string }>;
}

const DashboardContext = createContext<DashboardCtx>({
  accessToken: null,
  tenantInfo: null,
  staffTasks: [],
  callLogs: [],
  transcripts: [],
  analytics: [],
  overview: null,
  outboundOverview: null,
  overviewRefreshing: false,
  refreshOverview: async () => {},
  invoices: [],
  loading: false,
  settings: {},
  updateTaskStatus: async () => {},
  deleteTask: async () => {},
  saveSection: async () => false,
  saveBulk: async () => {},
  syncRetell: async () => ({ ok: false }),
});

function useDashboard() { return useContext(DashboardContext); }


// ── Small reusable UI ─────────────────────────────────────────────────────────
function Badge({ label, variant }: { label: string; variant: string }) {
  const map: Record<string, string> = {
    Booked: "bg-emerald-100 text-emerald-700",
    Transferred: "bg-violet-100 text-violet-700",
    "FAQ Answered": "bg-teal-100 text-teal-700",
    "Staff Action": "bg-amber-100 text-amber-700",
    "Staff Action Needed": "bg-amber-100 text-amber-700",
    Failed: "bg-red-100 text-red-700",
    Positive: "bg-emerald-100 text-emerald-700",
    Neutral: "bg-slate-100 text-slate-600",
    Negative: "bg-orange-100 text-orange-700",
    Frustrated: "bg-red-100 text-red-600",
    Urgent: "bg-red-200 text-red-800 font-semibold",
    High: "bg-red-100 text-red-700",
    Medium: "bg-amber-100 text-amber-700",
    Low: "bg-slate-100 text-slate-600",
    New: "bg-blue-100 text-blue-700",
    "In Progress": "bg-violet-100 text-violet-700",
    Completed: "bg-emerald-100 text-emerald-700",
    Dismissed: "bg-slate-100 text-slate-500",
    Active: "bg-emerald-100 text-emerald-700",
    "Coming Soon": "bg-slate-100 text-slate-500",
    Live: "bg-emerald-100 text-emerald-700",
    Connected: "bg-emerald-100 text-emerald-700",
    Degraded: "bg-amber-100 text-amber-700",
    Down: "bg-red-100 text-red-700",
    Resolved: "bg-emerald-100 text-emerald-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[label] ?? "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub, icon: Icon, trend, color = "purple" }: {
  label: string; value: string; sub?: string; icon: any; trend?: string; color?: string;
}) {
  const colors: Record<string, string> = {
    purple: "bg-violet-50 text-violet-600",
    teal: "bg-teal-50 text-teal-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    indigo: "bg-indigo-50 text-indigo-600",
  };
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className={`p-1.5 rounded-md ${colors[color]}`}><Icon size={14} /></span>
      </div>
      <div>
        <p className="text-2xl font-semibold text-foreground font-['DM_Mono',monospace]">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {trend && (
        <div className="flex items-center gap-1 text-xs">
          {trend.startsWith("+") ? <ArrowUpRight size={12} className="text-emerald-500" /> : <ArrowDownRight size={12} className="text-red-400" />}
          <span className={trend.startsWith("+") ? "text-emerald-600" : "text-red-500"}>{trend} vs last week</span>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-card border border-border rounded-lg shadow-sm ${className}`}>{children}</div>;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
// `group` clusters related nav items under a shared header in the sidebar. Items
// with no group render as a plain top-level link.
const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },

  { id: "call-logs", label: "Call Logs", icon: PhoneCall, group: "Inbound" },
  { id: "transcripts", label: "Transcripts", icon: FileText, group: "Inbound" },
  { id: "recordings", label: "Recordings", icon: Mic, group: "Inbound" },
  { id: "analytics", label: "Analytics", icon: BarChart2, group: "Inbound" },
  { id: "staff-queue", label: "Staff Action Queue", icon: ClipboardList, group: "Inbound" },
  { id: "settings", label: "Settings", icon: Settings, group: "Inbound" },

  { id: "outbound-call-logs", label: "Call Logs", icon: PhoneCall, group: "Outbound" },
  { id: "outbound-transcripts", label: "Transcripts", icon: FileText, group: "Outbound" },
  { id: "outbound-recordings", label: "Recordings", icon: Mic, group: "Outbound" },
  { id: "outbound-analytics", label: "Analytics", icon: BarChart2, group: "Outbound" },

  { id: "payment-recovery", label: "Payment Recovery", icon: TrendingUp, group: "Billing" },
  { id: "billing", label: "Billing & Usage", icon: CreditCard, group: "Billing" },
];

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// Strict boolean coercion for values loaded from settings/storage, which may
// arrive as a real boolean, the string "true"/"false", or be missing.
// Boolean("false") === true in JS, so Boolean(value)/!!value on a stored
// string silently treats every closed day as open — use this instead
// anywhere a clinic-hours "open" flag (or similar stored flag) is read.
function parseBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return String(value).trim().toLowerCase() === "true";
}

const CLINIC_HOURS_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// The Clinic Hours form renders Mon-Sat as checked/8-6 (Sat 8-2) by default
// when a day's fields are still undefined, so the boxes look pre-filled on
// first load. That default is display-only unless it's written into the
// draft here too - otherwise saving before ever touching an already-"checked"
// box sends open_<Day> as "false" (missing -> parseBoolean(undefined)),
// silently contradicting what the screen showed.
function normalizeClinicHours(data: Record<string, string>): Record<string, string> {
  const out = { ...data };
  CLINIC_HOURS_DAYS.forEach((day, i) => {
    if (out[`open_${day}`] === undefined) out[`open_${day}`] = i < 6 ? "true" : "false";
    if (out[`start_${day}`] === undefined) out[`start_${day}`] = i < 6 ? "08:00" : "";
    if (out[`end_${day}`] === undefined) out[`end_${day}`] = i < 5 ? "18:00" : i === 5 ? "14:00" : "";
  });
  return out;
}

function Sidebar({ active, onNav }: { active: string; onNav: (id: string) => void }) {
  const { staffTasks, tenantInfo } = useDashboard();
  const openTaskCount = staffTasks.filter(t => t.status !== "Completed").length;

  return (
    <div className="w-[240px] min-h-screen bg-sidebar flex flex-col flex-shrink-0">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center">
            <Bot size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-none">{tenantInfo?.clinic_name ?? "Dashboard"}</p>
            <p className="text-[10px] text-sidebar-foreground opacity-60 mt-0.5">Automation Dashboard</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ id, label, icon: Icon, group }, i) => {
          const prevGroup = i > 0 ? navItems[i - 1].group : undefined;
          const showGroupHeader = group && group !== prevGroup;
          return (
            <div key={id}>
              {showGroupHeader && (
                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-wide">{group}</p>
              )}
              <button
                onClick={() => onNav(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors text-sm ${
                  active === id
                    ? "bg-violet-600/20 text-white font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
                }`}
              >
                <Icon size={15} className={active === id ? "text-violet-400" : ""} />
                <span className="flex-1">{label}</span>
                {id === "staff-queue" && openTaskCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{openTaskCount}</span>
                )}
              </button>
            </div>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center text-xs text-white font-semibold">
            {tenantInfo ? initials(tenantInfo.receptionist_name) : "—"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{tenantInfo?.receptionist_name ?? ""}</p>
            <p className="text-[10px] text-sidebar-foreground opacity-60">Front Desk</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────────
function TopBar() {
  const { tenantInfo } = useDashboard();
  return (
    <div className="h-14 bg-card border-b border-border flex items-center px-6 gap-4 flex-shrink-0">
      <div className="flex items-center gap-2 bg-muted border border-border rounded-md px-3 py-1.5 min-w-[160px] cursor-pointer hover:bg-accent transition-colors">
        <Building2 size={13} className="text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{tenantInfo?.clinic_name ?? "—"}</span>
        <ChevronDown size={12} className="text-muted-foreground ml-auto" />
      </div>
      <div className="flex items-center gap-2 bg-muted border border-border rounded-md px-3 py-1.5 cursor-pointer hover:bg-accent transition-colors">
        <Calendar size={13} className="text-muted-foreground" />
        <span className="text-sm text-foreground">Date range</span>
        <ChevronDown size={12} className="text-muted-foreground" />
      </div>
      <div className="flex-1 relative max-w-xs">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input className="w-full bg-muted border border-border rounded-md pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" placeholder="Search calls, patients…" />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium px-2.5 py-1 rounded-full">
          <Circle size={6} className="fill-emerald-500 text-emerald-500" /> Active
        </span>
        <button className="relative p-2 rounded-md hover:bg-muted transition-colors">
          <Bell size={15} className="text-muted-foreground" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
        </button>
        <button className="p-2 rounded-md hover:bg-muted transition-colors">
          <HelpCircle size={15} className="text-muted-foreground" />
        </button>
        <button className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-xs text-white font-semibold">{tenantInfo ? initials(tenantInfo.receptionist_name) : "—"}</button>
      </div>
    </div>
  );
}

// ── Screen: Overview ─────────────────────────────────────────────────────────
// One KPI row (Minutes Used / Total Calls / Overage Cost / Avg Call Duration)
// reused for both Inbound and Outbound, so adding outbound didn't mean
// duplicating four cards' worth of JSX with a different variable name.
function OverviewKpiRow({ stats }: { stats: OverviewStats | null }) {
  const pct = stats && stats.minutesIncluded > 0 ? Math.min(100, (stats.minutesUsed / stats.minutesIncluded) * 100) : 0;
  return (
    <div className="grid grid-cols-4 gap-4">
      <KpiCard label="Minutes Used" value={stats ? `${stats.minutesUsed.toFixed(2)} / ${stats.minutesIncluded}` : "—"} sub={stats ? `${pct.toFixed(2)}% of plan` : "—"} icon={Clock} color="amber" />
      <KpiCard label="Total Calls" value={stats ? String(stats.totalCalls) : "—"} sub={stats?.billingPeriod ?? "—"} icon={PhoneCall} color="purple" />
      <KpiCard label="Overage Cost" value={stats ? `$${stats.overageUSD.toFixed(2)}` : "—"} sub={stats ? `${stats.overageMinutes} min over` : "—"} icon={CreditCard} color={stats && stats.overageMinutes > 0 ? "red" : "green"} />
      <KpiCard label="Avg Call Duration" value={stats?.avgCallDisplay ?? "—"} sub="Per call" icon={Zap} color="teal" />
    </div>
  );
}

function OverviewScreen() {
  // Deliberately sourced from ONLY the n8n Overview webhooks (`overview` for
  // inbound, `outboundOverview` for outbound) - no staffTasks/callLogs/
  // analytics mixed in, so every number on this screen traces back to one
  // of those two sources. No outbound tracker workflow exists yet, so
  // outboundOverview stays null (rendered as "—") until one is wired up.
  const { overview, outboundOverview, overviewRefreshing, refreshOverview } = useDashboard();

  const combinedUsed = (overview?.minutesUsed ?? 0) + (outboundOverview?.minutesUsed ?? 0);
  const combinedIncluded = (overview?.minutesIncluded ?? 0) + (outboundOverview?.minutesIncluded ?? 0);
  const inboundShare = combinedIncluded > 0 ? Math.min(100, ((overview?.minutesUsed ?? 0) / combinedIncluded) * 100) : 0;
  const outboundShare = combinedIncluded > 0 ? Math.min(100 - inboundShare, ((outboundOverview?.minutesUsed ?? 0) / combinedIncluded) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Overview</h1>
          <p className="text-xs text-muted-foreground">Combined inbound & outbound usage at a glance.</p>
        </div>
        <button
          onClick={refreshOverview}
          disabled={overviewRefreshing}
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <RefreshCw size={13} className={overviewRefreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Total AI Minutes Used</p>
            <p className="text-xs text-muted-foreground mt-0.5">{overview?.billingPeriod ?? "—"} · Inbound + Outbound</p>
          </div>
          <p className="text-2xl font-semibold text-foreground font-mono">
            {combinedIncluded > 0 ? combinedUsed.toFixed(2) : "—"}
            <span className="text-sm text-muted-foreground font-normal"> / {combinedIncluded > 0 ? combinedIncluded : "—"} min</span>
          </p>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden flex">
          <div className="h-full bg-primary" style={{ width: `${inboundShare}%` }} />
          <div className="h-full bg-teal-500" style={{ width: `${outboundShare}%` }} />
        </div>
        <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /> Inbound — {overview ? `${overview.minutesUsed.toFixed(2)} / ${overview.minutesIncluded}` : "—"} min</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-teal-500" /> Outbound — {outboundOverview ? `${outboundOverview.minutesUsed.toFixed(2)} / ${outboundOverview.minutesIncluded}` : "—"} min</span>
        </div>
      </Card>

      <OverviewKpiRow stats={overview} />
      <OverviewKpiRow stats={outboundOverview} />

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Billing Summary</h3>
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Billing Period</p>
            <p className="font-semibold text-foreground mt-1">{overview?.billingPeriod ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Inbound Recordings</p>
            <p className="font-semibold text-foreground mt-1">{overview ? String(overview.totalRecordings) : "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Inbound Transcripts</p>
            <p className="font-semibold text-foreground mt-1">{overview ? String(overview.totalTranscripts) : "—"}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Screen: AI Receptionist ───────────────────────────────────────────────────
function AIReceptionistScreen() {
  const { tenantInfo } = useDashboard();
  const capabilities = [
    { name: "Answer inbound calls", status: "Active" },
    { name: "Book appointments", status: "Active" },
    { name: "Check availability", status: "Active" },
    { name: "Lookup appointments", status: "Active" },
    { name: "New patient intake", status: "Active" },
    { name: "Existing patient recognition", status: "Active" },
    { name: "Cancellation request intake", status: "Staff notification required" },
    { name: "Reschedule request intake", status: "Staff notification required" },
    { name: "FAQ answering", status: "Active" },
    { name: "Text follow-ups", status: "Active" },
    { name: "Human transfer", status: "Active" },
    { name: "Urgent escalation", status: "Active" },
    { name: "Payment reminders", status: "Coming Soon" },
    { name: "Intake form reminders", status: "Coming Soon" },
    { name: "Review requests", status: "Coming Soon" },
  ];

  const flowSteps = [
    "Greeting", "Identify Intent", "Collect Details", "Verify Patient",
    "Choose Action", "Run Juvonno Fn", "Confirm Result", "Send SMS", "Log Call"
  ];

  const activity: { text: string; time: string; icon: any; color: string }[] = [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">AI Receptionist — Grace</h1>
          <p className="text-xs text-muted-foreground">{tenantInfo?.clinic_name ?? "—"} · Live mode</p>
        </div>
      </div>

      {/* Top section: Agent card + metrics */}
      <div className="grid grid-cols-3 gap-4">
        {/* Agent Profile */}
        <Card className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-teal-500 flex items-center justify-center text-white font-bold text-lg">G</div>
            <div>
              <p className="font-semibold text-foreground">Grace</p>
              <p className="text-xs text-muted-foreground">AI Receptionist</p>
            </div>
            <Badge label="Active" variant="Active" />
          </div>
          <div className="space-y-2 text-xs">
            {[
              ["Clinic", tenantInfo?.clinic_name ?? "—"],
              ["Phone", "—"],
              ["Voice", "Alloy (Female)"],
              ["Language", "English"],
              ["Mode", "Live"],
              ["Agent ID", "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-foreground font-mono">{v}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-auto">
            <button className="bg-primary text-primary-foreground text-xs font-medium px-3 py-2 rounded-md hover:opacity-90">Test Agent</button>
            <button className="bg-muted border border-border text-xs font-medium px-3 py-2 rounded-md hover:bg-accent transition-colors">View Logs</button>
            <button className="bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-3 py-2 rounded-md hover:bg-amber-100 transition-colors">Pause Agent</button>
            <button className="bg-muted border border-border text-xs font-medium px-3 py-2 rounded-md hover:bg-accent transition-colors">Request Change</button>
          </div>
        </Card>

        {/* Performance metrics */}
        <div className="col-span-2 grid grid-cols-4 gap-3">
          {[
            { label: "Calls Today", value: "—", icon: PhoneCall, color: "purple" },
            { label: "Bookings Today", value: "—", icon: CheckCircle2, color: "teal" },
            { label: "Avg Duration", value: "—", icon: Clock, color: "indigo" },
            { label: "Transfer Rate", value: "—", icon: ArrowUpRight, color: "amber" },
            { label: "Failed Call Rate", value: "—", icon: XCircle, color: "red" },
            { label: "Avg Sentiment", value: "—", icon: Heart, color: "green" },
            { label: "Revenue Today", value: "—", icon: ArrowUpRight, color: "teal" },
            { label: "Tasks Created", value: "—", icon: ClipboardList, color: "amber" },
          ].map((m) => (
            <KpiCard key={m.label} label={m.label} value={m.value} icon={m.icon} color={m.color} />
          ))}
        </div>
      </div>

      {/* Capabilities grid + flow */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card>
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Capabilities</h3>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {capabilities.map((c) => (
                <div key={c.name} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30">
                  {c.status === "Active" ? <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" /> :
                   c.status === "Coming Soon" ? <Clock size={12} className="text-slate-400 flex-shrink-0" /> :
                   <AlertCircle size={12} className="text-amber-500 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground leading-tight truncate">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{c.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Live activity */}
        <Card>
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <h3 className="text-sm font-semibold text-foreground">Live Activity</h3>
          </div>
          <div className="p-3 space-y-2.5">
            {activity.length > 0 ? activity.map((a, i) => (
              <div key={i} className="flex gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors">
                <a.icon size={13} className={`${a.color} flex-shrink-0 mt-0.5`} />
                <div>
                  <p className="text-xs text-foreground leading-snug">{a.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{a.time}</p>
                </div>
              </div>
            )) : (
              <p className="text-xs text-muted-foreground text-center py-4">No recent activity</p>
            )}
          </div>
        </Card>
      </div>

      {/* Conversation Flow */}
      <Card>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Conversation Flow (Read-only)</h3>
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded">Managed by NAP Admins</span>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-0 overflow-x-auto pb-2">
            {flowSteps.map((step, i) => (
              <div key={step} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-violet-100 border-2 border-violet-400 flex items-center justify-center text-[10px] font-bold text-violet-700">{i + 1}</div>
                  <span className="text-[10px] text-center text-foreground whitespace-nowrap w-20">{step}</span>
                </div>
                {i < flowSteps.length - 1 && <div className="w-8 h-0.5 bg-violet-200 flex-shrink-0 mb-4" />}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 italic">Advanced booking logic, Juvonno mappings, and function settings are managed by NAP admins to protect clinic workflow accuracy.</p>
        </div>
      </Card>

    </div>
  );
}

// ── Screen: Outbound Agent ────────────────────────────────────────────────────
function OutboundAgentScreen() {
  const { tenantInfo } = useDashboard();
  const capabilities = [
    { name: "Appointment reminder calls", status: "Coming Soon" },
    { name: "Payment reminder calls", status: "Coming Soon" },
    { name: "Recall / re-engagement campaigns", status: "Coming Soon" },
    { name: "Post-visit follow-up calls", status: "Coming Soon" },
    { name: "Voicemail drop", status: "Coming Soon" },
    { name: "Callback scheduling", status: "Coming Soon" },
    { name: "No-show follow-up", status: "Coming Soon" },
    { name: "Waitlist notification calls", status: "Coming Soon" },
    { name: "Survey / feedback calls", status: "Coming Soon" },
  ];

  const flowSteps = [
    "Select Campaign", "Build Call List", "Dial Patient", "Verify Identity",
    "Deliver Message", "Capture Response", "Update Juvonno", "Log Call"
  ];

  const activity: { text: string; time: string; icon: any; color: string }[] = [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Outbound Agent</h1>
          <p className="text-xs text-muted-foreground">{tenantInfo?.clinic_name ?? "—"} · Not yet configured</p>
        </div>
      </div>

      {/* Top section: Agent card + metrics */}
      <div className="grid grid-cols-3 gap-4">
        {/* Agent Profile */}
        <Card className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold text-lg">O</div>
            <div>
              <p className="font-semibold text-foreground">Outbound Agent</p>
              <p className="text-xs text-muted-foreground">Automated outbound calling</p>
            </div>
            <Badge label="Inactive" variant="Inactive" />
          </div>
          <div className="space-y-2 text-xs">
            {[
              ["Clinic", tenantInfo?.clinic_name ?? "—"],
              ["Phone", "—"],
              ["Voice", "—"],
              ["Language", "English"],
              ["Mode", "Not configured"],
              ["Agent ID", "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-foreground font-mono">{v}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-auto">
            <button disabled className="bg-primary text-primary-foreground text-xs font-medium px-3 py-2 rounded-md opacity-40 cursor-not-allowed">Test Agent</button>
            <button className="bg-muted border border-border text-xs font-medium px-3 py-2 rounded-md hover:bg-accent transition-colors">View Logs</button>
            <button disabled className="bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-3 py-2 rounded-md opacity-40 cursor-not-allowed">Pause Agent</button>
            <button className="bg-muted border border-border text-xs font-medium px-3 py-2 rounded-md hover:bg-accent transition-colors">Request Setup</button>
          </div>
        </Card>

        {/* Performance metrics */}
        <div className="col-span-2 grid grid-cols-4 gap-3">
          {[
            { label: "Calls Today", value: "—", icon: PhoneOutgoing, color: "purple" },
            { label: "Connected Today", value: "—", icon: CheckCircle2, color: "teal" },
            { label: "Avg Duration", value: "—", icon: Clock, color: "indigo" },
            { label: "Voicemail Rate", value: "—", icon: ArrowUpRight, color: "amber" },
            { label: "Failed Call Rate", value: "—", icon: XCircle, color: "red" },
            { label: "Avg Sentiment", value: "—", icon: Heart, color: "green" },
            { label: "Campaigns Active", value: "—", icon: TrendingUp, color: "teal" },
            { label: "Tasks Created", value: "—", icon: ClipboardList, color: "amber" },
          ].map((m) => (
            <KpiCard key={m.label} label={m.label} value={m.value} icon={m.icon} color={m.color} />
          ))}
        </div>
      </div>

      {/* Capabilities grid + flow */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card>
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Capabilities</h3>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {capabilities.map((c) => (
                <div key={c.name} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30">
                  {c.status === "Active" ? <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" /> :
                   c.status === "Coming Soon" ? <Clock size={12} className="text-slate-400 flex-shrink-0" /> :
                   <AlertCircle size={12} className="text-amber-500 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground leading-tight truncate">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{c.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Live activity */}
        <Card>
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <span className="w-2 h-2 bg-slate-400 rounded-full" />
            <h3 className="text-sm font-semibold text-foreground">Live Activity</h3>
          </div>
          <div className="p-3 space-y-2.5">
            {activity.length > 0 ? activity.map((a, i) => (
              <div key={i} className="flex gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors">
                <a.icon size={13} className={`${a.color} flex-shrink-0 mt-0.5`} />
                <div>
                  <p className="text-xs text-foreground leading-snug">{a.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{a.time}</p>
                </div>
              </div>
            )) : (
              <p className="text-xs text-muted-foreground text-center py-4">No recent activity</p>
            )}
          </div>
        </Card>
      </div>

      {/* Campaign Flow */}
      <Card>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Campaign Flow (Read-only)</h3>
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded">Managed by NAP Admins</span>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-0 overflow-x-auto pb-2">
            {flowSteps.map((step, i) => (
              <div key={step} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center text-[10px] font-bold text-amber-700">{i + 1}</div>
                  <span className="text-[10px] text-center text-foreground whitespace-nowrap w-20">{step}</span>
                </div>
                {i < flowSteps.length - 1 && <div className="w-8 h-0.5 bg-amber-200 flex-shrink-0 mb-4" />}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 italic">Outbound campaign logic, call lists, and dialing schedules are managed by NAP admins to protect clinic workflow accuracy.</p>
        </div>
      </Card>

    </div>
  );
}

// ── Screen: Call Logs ─────────────────────────────────────────────────────────
function CallLogsScreen({ direction }: { direction: "inbound" | "outbound" }) {
  const { callLogs: allCallLogs, transcripts: allTranscripts } = useDashboard();
  const callLogs = allCallLogs.filter(c => (c.direction ?? "inbound") === direction);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  // The calls endpoint doesn't carry full conversation text - the transcripts
  // endpoint does, keyed by the same call id - so look it up there for the modal.
  const selectedTranscript = selectedCall ? allTranscripts.find(t => String(t.id) === String(selectedCall.id)) : null;

  return (
    <div className="p-6 space-y-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">{direction === "outbound" ? "Outbound Call Logs" : "Inbound Call Logs"}</h1>
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={13} className="text-muted-foreground flex-shrink-0" />
          {["Date Range", "Outcome", "Sentiment", "Service", "Provider", "Staff Action"].map((f) => (
            <button key={f} className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 border border-border rounded-md hover:bg-muted transition-colors">
              {f} <ChevronDown size={11} />
            </button>
          ))}
          <div className="flex items-center gap-2 ml-auto">
            <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
              <input type="checkbox" className="rounded" /> Negative only
            </label>
            <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
              <input type="checkbox" className="rounded" /> Failed only
            </label>
            <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
              <input type="checkbox" className="rounded" /> Staff action needed
            </label>
          </div>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Date/Time", "Caller", "Phone", "Outcome", "Sentiment", "Duration", ""].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {callLogs.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  No {direction} calls yet.
                </td></tr>
              ) : callLogs.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedCall(c)}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">{c.time}</td>
                  <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">{c.caller}</td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{c.phone}</td>
                  <td className="px-3 py-2.5"><Badge label={c.outcome ?? ""} variant={c.outcome ?? ""} /></td>
                  <td className="px-3 py-2.5"><Badge label={c.sentiment ?? ""} variant={c.sentiment ?? ""} /></td>
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{c.duration}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <Volume2 size={12} className={c.recordingUrl ? "text-foreground" : "text-muted-foreground/30"} />
                      <FileText size={12} className="text-foreground" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedCall && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-6" onClick={() => setSelectedCall(null)}>
            <div className="bg-card rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-border flex items-start justify-between flex-shrink-0">
                <div>
                  <p className="text-sm font-semibold text-foreground">{selectedCall.time}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">{selectedCall.duration}</span>
                    {selectedCall.sentiment && <Badge label={selectedCall.sentiment} variant={selectedCall.sentiment} />}
                  </div>
                </div>
                <button onClick={() => setSelectedCall(null)} className="flex items-center gap-1.5 text-xs font-medium border border-border px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors">
                  <X size={12} /> Close
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {selectedCall.summary && (
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Summary</p>
                    <p className="text-xs text-foreground leading-relaxed bg-muted/40 border border-border rounded-md p-3">{selectedCall.summary}</p>
                  </div>
                )}

                {selectedCall.recordingUrl ? (
                  <a href={selectedCall.recordingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline">
                    <Play size={12} /> Open Recording
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">No recording available for this call.</p>
                )}

                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Conversation</p>
                  {(selectedTranscript?.lines ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No transcript text available for this call.</p>
                  ) : (
                    <div className="space-y-3">
                      {selectedTranscript!.lines!.map((line, i) => (
                        <div key={i} className={`flex gap-3 ${line.speaker === "Caller" ? "flex-row-reverse" : ""}`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${line.speaker === "Caller" ? "bg-slate-200 text-slate-600" : "bg-violet-100 text-violet-700"}`}>
                            {line.speaker[0]}
                          </div>
                          <div className={`max-w-md ${line.speaker === "Caller" ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                            <span className="text-[10px] text-muted-foreground">{line.speaker}</span>
                            <div className={`text-xs px-3 py-2 rounded-lg ${line.speaker === "Caller" ? "bg-muted text-foreground" : "bg-violet-100 text-violet-900"}`}>
                              {line.text}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InboundCallLogsScreen() { return <CallLogsScreen direction="inbound" />; }
function OutboundCallLogsScreen() { return <CallLogsScreen direction="outbound" />; }
function InboundRecordingsScreen() { return <RecordingsScreen direction="inbound" />; }
function OutboundRecordingsScreen() { return <RecordingsScreen direction="outbound" />; }

// ── Screen: Transcripts ───────────────────────────────────────────────────────
function TranscriptsScreen({ direction }: { direction: "inbound" | "outbound" }) {
  const { transcripts: allTranscripts } = useDashboard();
  const filteredTranscripts = allTranscripts.filter(t => (t.direction ?? "inbound") === direction);
  const [selected, setSelected] = useState<Transcript | null>(null);

  return (
    <div className="p-6 h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">{direction === "outbound" ? "Outbound Transcripts" : "Inbound Transcripts"}</h1>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* List */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="w-full bg-card border border-border rounded-md pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" placeholder="Search transcripts…" />
          </div>
          <div className="flex gap-1.5">
            {["All", "Needs Review", "Negative"].map(f => (
              <button key={f} className="text-[10px] px-2 py-1 rounded border border-border hover:bg-muted transition-colors font-medium">{f}</button>
            ))}
          </div>
          <div className="space-y-2 overflow-y-auto flex-1">
            {filteredTranscripts.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No {direction} transcripts yet.</p>
            )}
            {filteredTranscripts.map((t) => (
              <div
                key={t.id}
                onClick={() => setSelected(t)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${selected?.id === t.id ? "border-primary/50 bg-violet-50" : "border-border bg-card hover:bg-muted/40"}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-foreground">{t.caller}</p>
                  <Badge label={t.sentiment} variant={t.sentiment} />
                </div>
                <p className="text-[10px] text-muted-foreground mb-1.5">{t.time} · {t.duration}</p>
                <p className="text-[10px] text-muted-foreground truncate">{t.preview}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Badge label={t.outcome} variant={t.outcome} />
                  <span className="text-[10px] text-muted-foreground">{t.service}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transcript Preview */}
        {selected ? (
          <Card className="flex-1 flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-sm font-semibold text-foreground">{selected.caller}</p>
                <p className="text-xs text-muted-foreground">{selected.time} · {selected.service} · {selected.duration}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge label={selected.outcome ?? ""} variant={selected.outcome ?? ""} />
                <Badge label={selected.sentiment ?? ""} variant={selected.sentiment ?? ""} />
              </div>
            </div>
            {/* Transcript lines */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {(selected.lines ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No transcript text available for this call.</p>
              )}
              {(selected.lines ?? []).map((line, i) => (
                <div key={i} className={`flex gap-3 ${line.speaker === "Caller" ? "flex-row-reverse" : ""}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${line.speaker === "Caller" ? "bg-slate-200 text-slate-600" : "bg-violet-100 text-violet-700"}`}>
                    {line.speaker[0]}
                  </div>
                  <div className={`max-w-md ${line.speaker === "Caller" ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                    <span className="text-[10px] text-muted-foreground">{line.speaker}</span>
                    <div className={`text-xs px-3 py-2 rounded-lg ${line.speaker === "Caller" ? "bg-muted text-foreground" : "bg-violet-100 text-violet-900"}`}>
                      {line.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
            <FileText size={24} className="text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Select a transcript to view</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function InboundTranscriptsScreen() { return <TranscriptsScreen direction="inbound" />; }
function OutboundTranscriptsScreen() { return <TranscriptsScreen direction="outbound" />; }

// ── Screen: Analytics ─────────────────────────────────────────────────────────
const ANALYTICS_RANGE_LABELS = ["Hourly", "Daily", "Weekly", "2 Months", "3 Months", "6 Months", "Yearly", "All Time"];

function AnalyticsScreen({ direction }: { direction: "inbound" | "outbound" }) {
  // Inbound is wired to the real Inbound Tracker n8n workflow's analytics
  // webhook, with its own range selector (matching Build Analytics Response's
  // range param). Outbound has no tracker workflow yet, so it deliberately
  // shows an empty state instead of quietly reusing inbound's numbers - the
  // old version of this screen showed identical data for both directions.
  const { accessToken } = useDashboard();
  const [range, setRange] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const [data, setData] = useState<AnalyticsPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (direction !== "inbound" || !accessToken) { setData([]); return; }
    setLoading(true);
    fetch(`/api/link/${accessToken}/inbound/analytics?range=${range}`)
      .then(r => r.ok ? r.json() : [])
      .then(res => setData(Array.isArray(res) ? res : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [accessToken, direction, range, refreshTick]);

  const totalCalls = data.reduce((sum, p) => sum + p.calls, 0);
  const totalMinutes = data.reduce((sum, p) => sum + p.minutes, 0);
  const completedCalls = data.reduce((sum, p) => sum + p.completed, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold bg-gradient-to-r from-violet-600 to-teal-500 bg-clip-text text-transparent">
            {direction === "outbound" ? "Outbound Analytics" : "Inbound Analytics"}
          </h1>
          <p className="text-xs text-muted-foreground">{direction === "outbound" ? "Outbound call volume and trends over time." : "Inbound call volume and trends over time."}</p>
        </div>
        {direction === "inbound" && (
          <button
            onClick={() => setRefreshTick(t => t + 1)}
            disabled={loading}
            className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-teal-500 text-white text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Call Volume</h3>
            <p className="text-xs text-muted-foreground">Calls over time — select a range</p>
          </div>
          <select
            value={range}
            onChange={e => setRange(Number(e.target.value))}
            disabled={direction === "outbound"}
            className="text-xs font-medium border border-border rounded-md px-2.5 py-1.5 bg-card disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ANALYTICS_RANGE_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </div>

        {direction === "outbound" ? (
          <p className="text-xs text-muted-foreground text-center py-16">No outbound tracker connected yet.</p>
        ) : data.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-16">{loading ? "Loading…" : "No calls in this range."}</p>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: Math.max(600, data.length * 48) }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: SLATE }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E8EAF6" }} />
                  <Bar dataKey="calls" fill={PURPLE} radius={[6, 6, 6, 6]}>
                    <LabelList dataKey="calls" position="top" style={{ fontSize: 11, fill: SLATE, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Total Calls (Range)" value={direction === "inbound" && data.length ? String(totalCalls) : "—"} icon={PhoneCall} color="purple" />
        <KpiCard label="Total Minutes (Range)" value={direction === "inbound" && data.length ? `${totalMinutes.toFixed(1)}m` : "—"} icon={Clock} color="teal" />
        <KpiCard label="Completed Calls" value={direction === "inbound" && data.length ? String(completedCalls) : "—"} icon={CheckCircle2} color="green" />
      </div>
    </div>
  );
}

function InboundAnalyticsScreen() { return <AnalyticsScreen direction="inbound" />; }
function OutboundAnalyticsScreen() { return <AnalyticsScreen direction="outbound" />; }

// ── Screen: Trends ────────────────────────────────────────────────────────────
function TrendsScreen() {
  // TODO: Replace with real insights from /api/link/:accessToken/analytics/insights
  // These are generated from call transcripts, sentiment analysis, and call outcomes via n8n
  const insights = [
    { icon: Clock, color: "violet", title: "Peak Call Times", body: "Most calls this week happened between 10 AM and 1 PM, with a secondary peak at 3–4 PM." },
    { icon: Star, color: "teal", title: "Most Requested Service", body: "Chiropractic leads with 87 requests (+11% vs last week). Massage therapy close behind at 61." },
    { icon: User, color: "indigo", title: "Most Requested Provider", body: "Your top provider is handling the highest share of provider-specific calls this week." },
    { icon: ArrowUpRight, color: "amber", title: "Common Transfer Reason", body: "Billing questions account for 48% of all staff transfers this week. Consider adding an FAQ entry." },
    { icon: XCircle, color: "red", title: "Top Failed Booking Reason", body: "5 of 12 failures were Juvonno API timeouts. Engineering has been notified for investigation." },
    { icon: Heart, color: "green", title: "Sentiment Trend", body: "Overall sentiment improved from 3.9 to 4.2 this week. Positive calls up 8%, frustrated calls down 3." },
    { icon: AlertCircle, color: "orange", title: "Negative Sentiment Themes", body: "Negative sentiment was mostly linked to billing questions and reschedule requests on Monday–Tuesday." },
    { icon: CreditCard, color: "violet", title: "Missed Revenue Opportunities", body: "12 patients asked for Saturday availability but no matching times were available. Consider expanding Saturday hours." },
    { icon: Moon, color: "indigo", title: "After-Hours Call Demand", body: "18 calls were received after 5 PM. 14 resulted in bookings via voicemail follow-up or SMS." },
    { icon: MessageSquare, color: "teal", title: "Common Patient Questions", body: "Top FAQ topics: parking (22%), insurance coverage (19%), what to bring to first visit (16%)." },
    { icon: ClipboardList, color: "amber", title: "Staff Workload Trend", body: "Staff tasks created by AI increased by 3 this week. Reschedule requests are the most time-consuming category." },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Trends & Insights</h1>
        <p className="text-xs text-muted-foreground mt-0.5">AI-generated insights from this week's call data</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {insights.map((ins) => {
          const colorMap: Record<string, string> = {
            violet: "bg-violet-50 text-violet-600 border-violet-200",
            teal: "bg-teal-50 text-teal-600 border-teal-200",
            indigo: "bg-indigo-50 text-indigo-600 border-indigo-200",
            amber: "bg-amber-50 text-amber-600 border-amber-200",
            red: "bg-red-50 text-red-600 border-red-200",
            green: "bg-emerald-50 text-emerald-600 border-emerald-200",
            orange: "bg-orange-50 text-orange-600 border-orange-200",
          };
          return (
            <Card key={ins.title} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <span className={`p-2 rounded-lg border ${colorMap[ins.color]} flex-shrink-0`}>
                  <ins.icon size={14} />
                </span>
                <div>
                  <p className="text-xs font-semibold text-foreground">{ins.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{ins.body}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Moon({ size = 24, ...props }: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// ── Screen: Staff Queue ───────────────────────────────────────────────────────
const STAFF_TASK_STATUSES = ["New", "In Progress", "Completed"] as const;

// Some staff-queue entries were saved by n8n workflows with fields as nested
// objects instead of plain strings (e.g. patient: {full_name: "..."}).
// React throws "Objects are not valid as a React child" if such a value is
// rendered directly, which crashes the whole screen - always render through
// this instead of the raw field.
function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return String(obj.full_name ?? obj.name ?? obj.label ?? JSON.stringify(obj));
  }
  return String(value);
}

function patientName(task: StaffTask): string {
  const name = safeText(task.patient);
  return name || "Unknown";
}

// Never infer "new patient" from visit_type alone - an existing patient can
// still book an Initial visit for a different service. patient_record_status
// / patient_status are the only fields that actually mean "never seen before".
// These are the direct structured fields from the n8n booking payload, not
// something parsed out of the free-text call summary.
function getPatientFlags(task: StaffTask) {
  const patientRecordStatus = safeText(task.patient_record_status);
  const patientStatus = safeText(task.patient_status);
  const visitType = safeText(task.visit_type);
  const gender = safeText(task.patient_gender);
  const dob = safeText(task.patient_date_of_birth);
  const phone = safeText(task.patient_phone ?? task.phone);
  const name = safeText(task.patient_name) || patientName(task);

  const isFirstTimePatient =
    patientRecordStatus.toLowerCase() === "new patient" ||
    patientStatus.toLowerCase().startsWith("new patient");

  const isFirstTimeVisit = visitType.toLowerCase() === "initial";

  const hasExplicitGender =
    Boolean(gender) && !["unknown", "null", "undefined"].includes(gender.toLowerCase());

  const newPatientIntakeComplete = isFirstTimePatient && Boolean(dob) && hasExplicitGender;

  const title = isFirstTimePatient
    ? `New Patient Appointment Booked - ${name}`
    : `Appointment Booked - ${name}`;

  const firstVisitLabel = isFirstTimePatient
    ? "First-time patient"
    : isFirstTimeVisit
      ? "Existing patient, initial visit"
      : "Existing patient, follow-up visit";

  return { isFirstTimePatient, isFirstTimeVisit, hasExplicitGender, newPatientIntakeComplete, dob, gender, phone, title, firstVisitLabel, visitType };
}

const STATUS_ACCENT: Record<string, string> = {
  New: "bg-blue-50 border-blue-100",
  "In Progress": "bg-violet-50 border-violet-100",
  Completed: "bg-emerald-50 border-emerald-100",
};

// n8n sends a lot of overlapping field names for the same concept (e.g.
// practitioner_name vs practitioner, service_display_name vs service). Each
// entry here picks the first alias with a real value, so the panel shows one
// clean row per concept instead of every raw key n8n happens to include.
// "Appointment Type" is deliberately Visit Type (Initial/Follow-up), not
// appointment_type - in practice appointment_type just repeats Service.
// Date of Birth and Patient Status are deliberately NOT here - DOB is
// sensitive and gated behind the New Patient Intake section below, and
// Patient Status is now surfaced as the New/Existing Patient badge instead
// of a plain text row.
const STAFF_TASK_DETAIL_FIELDS: { label: string; icon: any; keys: string[]; format?: (raw: string) => string }[] = [
  { label: "Practitioner", icon: User, keys: ["practitioner_name", "practitioner"] },
  { label: "Service", icon: Heart, keys: ["service_display_name", "service"] },
  { label: "Duration", icon: Clock, keys: ["duration_minutes", "duration"], format: raw => /^\d+$/.test(raw) ? `${raw} min` : raw },
  { label: "Location", icon: Building2, keys: ["location", "branch_name"] },
  { label: "Appointment ID", icon: FileText, keys: ["appointment_id", "calendar_event_id", "external_event_id"] },
];

function getTaskField(task: StaffTask, keys: string[], format?: (raw: string) => string): string {
  for (const key of keys) {
    const value = safeText(task[key]);
    if (value) return format ? format(value) : value;
  }
  return "";
}

function formatDateTime(value: unknown): string {
  const text = safeText(value);
  if (!text) return "";
  const date = new Date(text);
  if (isNaN(date.getTime())) return text;
  return date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatRelativeTime(value: unknown): string {
  const text = safeText(value);
  if (!text) return "";
  const date = new Date(text);
  if (isNaN(date.getTime())) return text;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function StaffQueueScreen() {
  const { staffTasks, updateTaskStatus, deleteTask } = useDashboard();
  const [filter, setFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // DOB/gender are sensitive - require an explicit click to reveal them each
  // time a different request is opened, rather than showing them by default.
  const [revealSensitiveId, setRevealSensitiveId] = useState<string | null>(null);

  function handleDelete(id: string) {
    if (confirmingId === id) {
      deleteTask(id);
      setConfirmingId(null);
      if (selectedId === id) setSelectedId(null);
    } else {
      setConfirmingId(id);
    }
  }

  const filters = ["All", "New", "In Progress", "Completed"];
  const visibleTasks = filter === "All" ? staffTasks : staffTasks.filter(t => t.status === filter);
  const sortedTasks = [...visibleTasks].sort((a, b) => {
    const completedDiff = (a.status === "Completed" ? 1 : 0) - (b.status === "Completed" ? 1 : 0);
    if (completedDiff !== 0) return completedDiff;
    return new Date(safeText(b.created_at)).getTime() - new Date(safeText(a.created_at)).getTime();
  });
  const selectedTask = staffTasks.find(t => t.id === selectedId) ?? null;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Staff Action Queue</h1>
        <p className="text-xs text-muted-foreground">{staffTasks.filter(t => t.status !== "Completed").length} open tasks</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium ${filter === f ? "bg-primary text-white border-primary" : "border-border hover:bg-muted"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {sortedTasks.length === 0 ? (
          <p className="text-xs text-muted-foreground py-10 text-center">No tasks here.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Type", "Patient", "Phone", "Requested", "Submitted", "Status", ""].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((task) => {
                const hasPatientInfo = Boolean(safeText(task.patient_record_status) || safeText(task.patient_status));
                const flags = hasPatientInfo ? getPatientFlags(task) : null;
                return (
                  <tr
                    key={task.id}
                    onClick={() => setSelectedId(task.id)}
                    className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer ${task.status === "Completed" ? "opacity-60" : ""}`}
                  >
                    <td className="px-4 py-3 text-foreground">{flags ? flags.title : (safeText(task.type) || "—")}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-[9px] font-bold flex-shrink-0">{patientName(task).charAt(0)}</div>
                        <span className="font-medium text-foreground">{patientName(task)}</span>
                        {flags && <Badge label={flags.isFirstTimePatient ? "New Patient" : "Existing Patient"} variant={flags.isFirstTimePatient ? "New" : "Neutral"} />}
                        {flags?.visitType && <Badge label={flags.isFirstTimeVisit ? "Initial Visit" : "Follow-up"} variant={flags.isFirstTimeVisit ? "In Progress" : "Neutral"} />}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{safeText(task.phone) || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(task.due) || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(task.created_at) || "—"}</td>
                    <td className="px-4 py-3"><Badge label={task.status} variant={task.status} /></td>
                    <td className="px-4 py-3 text-muted-foreground"><ChevronRight size={14} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {selectedTask && (() => {
        const hasPatientInfo = Boolean(safeText(selectedTask.patient_record_status) || safeText(selectedTask.patient_status));
        const flags = hasPatientInfo ? getPatientFlags(selectedTask) : null;
        const revealed = revealSensitiveId === selectedTask.id;
        return (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelectedId(null)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-card border-l border-border shadow-xl z-50 flex flex-col">
            <div className={`flex items-center justify-between px-5 py-4 border-b ${STATUS_ACCENT[selectedTask.status] ?? "bg-muted/40 border-border"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{flags ? flags.title : (safeText(selectedTask.type) || "Request")}</span>
                <Badge label={selectedTask.status} variant={selectedTask.status} />
              </div>
              <button onClick={() => setSelectedId(null)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="flex items-center gap-3 pb-4 border-b border-border">
                <div className="w-10 h-10 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold flex-shrink-0">{patientName(selectedTask).charAt(0)}</div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{patientName(selectedTask)}</p>
                  <p className="text-xs text-muted-foreground font-mono">{safeText(selectedTask.phone) || "No phone on file"}</p>
                </div>
              </div>

              {flags && (
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge label={flags.isFirstTimePatient ? "New Patient" : "Existing Patient"} variant={flags.isFirstTimePatient ? "New" : "Neutral"} />
                    {flags.visitType && <Badge label={flags.isFirstTimeVisit ? "Initial Visit" : "Follow-up"} variant={flags.isFirstTimeVisit ? "In Progress" : "Neutral"} />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">{flags.firstVisitLabel}</p>
                </div>
              )}

              {flags?.isFirstTimePatient && (
                <div className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">New Patient Intake</p>
                    <button
                      onClick={() => setRevealSensitiveId(revealed ? null : selectedTask.id)}
                      className="flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                    >
                      {revealed ? <><EyeOff size={10} /> Hide</> : <><Eye size={10} /> Show</>}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Date of Birth</p>
                      <p className="font-medium text-foreground mt-0.5 font-mono">{revealed ? (flags.dob || "—") : "••••••••"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Gender</p>
                      <p className="font-medium text-foreground mt-0.5">{revealed ? (flags.gender || "—") : "••••"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Phone Number</p>
                      <p className="font-medium text-foreground mt-0.5 font-mono">{revealed ? (flags.phone || "—") : "••••••••••"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Intake Status</p>
                      <p className={`font-medium mt-0.5 ${flags.newPatientIntakeComplete ? "text-emerald-600" : "text-amber-600"}`}>
                        {flags.newPatientIntakeComplete ? "Complete" : "Missing information"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                    <Calendar size={11} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide">Requested For</p>
                  </div>
                  <p className="text-xs font-medium text-foreground">{formatDateTime(selectedTask.due) || "—"}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                    <Clock size={11} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide">Submitted</p>
                  </div>
                  <p className="text-xs font-medium text-foreground">{formatDateTime(selectedTask.created_at) || "—"}</p>
                </div>
              </div>

              {selectedTask.priority && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Priority</span>
                  <Badge label={safeText(selectedTask.priority)} variant={safeText(selectedTask.priority)} />
                </div>
              )}

              {(() => {
                const rows = STAFF_TASK_DETAIL_FIELDS
                  .map(f => ({ ...f, value: getTaskField(selectedTask, f.keys, f.format) }))
                  .filter(r => r.value);
                if (rows.length === 0) return null;
                return (
                  <div className="rounded-md border border-border divide-y divide-border">
                    {rows.map(({ label, icon: Icon, value }) => (
                      <div key={label} className="flex items-center justify-between px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Icon size={12} />
                          <span>{label}</span>
                        </div>
                        <span className="font-medium text-foreground">{value}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {!!safeText(selectedTask.summary) && (
                <div>
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
                    <MessageSquare size={11} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide">Call Summary</p>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed bg-muted/40 border border-border rounded-md p-3">{safeText(selectedTask.summary)}</p>
                </div>
              )}
            </div>

            <div className="border-t border-border px-5 py-4 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={selectedTask.status}
                  onChange={(e) => updateTaskStatus(selectedTask.id, e.target.value)}
                  className="flex-1 text-xs font-medium border border-border rounded-md px-2.5 py-2 bg-card hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                >
                  {STAFF_TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  onClick={() => handleDelete(selectedTask.id)}
                  onBlur={() => setConfirmingId(null)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border transition-colors ${confirmingId === selectedTask.id ? "bg-destructive/10 text-destructive border-destructive/30" : "border-border text-muted-foreground hover:text-destructive hover:bg-muted"}`}
                >
                  <Trash2 size={12} /> {confirmingId === selectedTask.id ? "Confirm Delete" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </>
        );
      })()}
    </div>
  );
}

// ── Screen: Recordings ────────────────────────────────────────────────────────
function RecordingsScreen({ direction }: { direction: "inbound" | "outbound" }) {
  const { callLogs: allCallLogs } = useDashboard();
  const callLogs = allCallLogs.filter(c => (c.direction ?? "inbound") === direction);
  const [playing, setPlaying] = useState<number | string | null>(null);
  const [progress, setProgress] = useState(0); // seconds
  const [audioDuration, setAudioDuration] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string | number>>(new Set());
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingCall = callLogs.find(c => c.id === playing) ?? null;
  const visibleLogs = callLogs.filter(c => !dismissed.has(c.id));

  function togglePlay(c: CallLog) {
    if (!c.recordingUrl) return;
    if (playing === c.id) {
      audioRef.current?.pause();
      setPlaying(null);
    } else {
      setPlaying(c.id);
      setProgress(0);
      // Wait a tick for the <audio> src to update before playing.
      setTimeout(() => audioRef.current?.play(), 0);
    }
  }

  function formatTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">{direction === "outbound" ? "Outbound Recordings" : "Inbound Recordings"}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="bg-card border border-border rounded-md pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground w-48 focus:outline-none focus:ring-1 focus:ring-ring" placeholder="Search recordings…" />
          </div>
          <button className="flex items-center gap-1.5 bg-muted border border-border text-xs font-medium px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
            <Filter size={12} /> Filter
          </button>
        </div>
      </div>

      <Card>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["Date/Time", "Caller", "Service", "Outcome", "Sentiment", "Duration", "Consent", "Retention", ""].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleLogs.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">No {direction} recordings yet.</td></tr>
            ) : visibleLogs.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">{c.time}</td>
                <td className="px-4 py-3 font-medium text-foreground">{c.caller}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.service}</td>
                <td className="px-4 py-3"><Badge label={c.outcome ?? ""} variant={c.outcome ?? ""} /></td>
                <td className="px-4 py-3">{c.sentiment ? <Badge label={c.sentiment} variant={c.sentiment} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{c.duration}</td>
                <td className="px-4 py-3"><span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={11} /> Consented</span></td>
                <td className="px-4 py-3 text-muted-foreground">90 days</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => togglePlay(c)}
                      disabled={!c.recordingUrl}
                      title={c.recordingUrl ? "Play" : "No recording available"}
                      className={`p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${playing === c.id ? "bg-primary text-white" : "hover:bg-muted text-muted-foreground"}`}
                    >
                      {playing === c.id ? <Pause size={11} /> : <Play size={11} />}
                    </button>
                    <a
                      href={c.recordingUrl || undefined}
                      download
                      target="_blank"
                      rel="noreferrer"
                      title={c.recordingUrl ? "Download" : "No recording available"}
                      className={`p-1.5 rounded-md transition-colors ${c.recordingUrl ? "hover:bg-muted text-muted-foreground" : "opacity-30 pointer-events-none"}`}
                    >
                      <Download size={11} />
                    </a>
                    <button
                      onClick={() => setDismissed(prev => new Set(prev).add(c.id))}
                      title="Remove from this list"
                      className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {playingCall && (
        <Card className="p-4">
          <audio
            ref={audioRef}
            src={playingCall.recordingUrl}
            autoPlay
            onTimeUpdate={e => setProgress(e.currentTarget.currentTime)}
            onLoadedMetadata={e => setAudioDuration(e.currentTarget.duration)}
            onEnded={() => { setPlaying(null); setProgress(0); }}
          />
          <div className="flex items-center gap-4">
            <button onClick={() => togglePlay(playingCall)} className="w-9 h-9 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
              <Pause size={14} className="text-white" />
            </button>
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground mb-2">{playingCall.caller} · {playingCall.service}</p>
              <div
                className="h-2 bg-muted rounded-full overflow-hidden cursor-pointer"
                onClick={e => {
                  if (!audioRef.current || !audioDuration) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  audioRef.current.currentTime = ratio * audioDuration;
                }}
              >
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${audioDuration ? (progress / audioDuration) * 100 : 0}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>{formatTime(progress)}</span><span>{audioDuration ? formatTime(audioDuration) : playingCall.duration}</span>
              </div>
            </div>
            <a href={playingCall.recordingUrl} download target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Download size={12} /> Download
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Screen: Settings ──────────────────────────────────────────────────────────
interface DurationCategory { id: string; label: string; durations: string; }
interface AppointmentType { id: string; service_name: string; keywords: string; duration_categories: DurationCategory[]; }
interface Practitioner { id: string; name: string; keywords: string; staff_num: string; appointment_types: AppointmentType[]; }
interface FAQ { id: string; question: string; answer: string; }

type DraftKey = 'clinic_profile' | 'clinic_hours' | 'transfer_escalation' | 'sms_follow_ups';

// Visual metadata only - the internal section key strings below (used in
// every `activeSection === "..."` check) are unchanged, so none of the
// existing save/data logic is touched by this redesign.
const SETTINGS_SECTION_META: Record<string, { icon: any; subtitle: string; optional?: boolean }> = {
  "Clinic Profile": { icon: Building2, subtitle: "The contact and location details Grace shares with patients." },
  "Clinic Hours": { icon: Clock, subtitle: "When patients can call, visit, or request appointments." },
  "Practitioners": { icon: Users, subtitle: "Who patients can book with and which appointment types are available." },
  "Transfer & Escalation": { icon: PhoneOutgoing, subtitle: "When Grace should involve your team and where calls should go." },
  "FAQs / Knowledge Base": { icon: MessageSquare, subtitle: "Trusted clinic answers Grace can use during conversations." },
  "SMS Follow-Ups": { icon: Send, subtitle: "Patient messages sent after booking and appointment events.", optional: true },
};

function SettingsScreen() {
  const { tenantInfo, settings, saveSection } = useDashboard();
  const [activeSection, setActiveSection] = useState("Overview");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ section: string; ok: boolean } | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [faqSearch, setFaqSearch] = useState("");
  const [draft, setDraft] = useState<Record<DraftKey, Record<string, string>>>({
    clinic_profile: {}, clinic_hours: {}, transfer_escalation: {}, sms_follow_ups: {},
  });

  const sections = [
    "Clinic Profile", "Clinic Hours", "Practitioners",
    "Transfer & Escalation",
    "FAQs / Knowledge Base", "SMS Follow-Ups",
  ];

  // Only populate draft/practitioners/faqs from `settings` ONCE, the first
  // time real data arrives. Re-running this on every settings change (e.g.
  // whenever ANY section gets saved) would silently overwrite unsaved local
  // edits in OTHER sections with stale server data - a real, reproducible
  // data-loss bug, not just a theoretical one. After this initial load,
  // local state is the source of truth until the user explicitly saves.
  const settingsLoadedRef = useRef(false);
  useEffect(() => {
    if (settingsLoadedRef.current) return;
    if (Object.keys(settings).length === 0) return;
    settingsLoadedRef.current = true;
    setDraft({
      clinic_profile: (settings.clinic_profile ?? {}) as Record<string, string>,
      clinic_hours: normalizeClinicHours((settings.clinic_hours ?? {}) as Record<string, string>),
      transfer_escalation: (settings.transfer_escalation ?? {}) as Record<string, string>,
      sms_follow_ups: (settings.sms_follow_ups ?? {}) as Record<string, string>,
    });
    const savedP = (settings.practitioners as { list?: Practitioner[] })?.list;
    if (savedP && savedP.length > 0) setPractitioners(savedP);
    const savedF = (settings.faqs as { list?: FAQ[] })?.list;
    if (savedF && savedF.length > 0) setFaqs(savedF);
  }, [settings]);

  function setField(section: DraftKey, key: string, value: string) {
    setDraft(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
  }

  function reportSaveResult(section: string, ok: boolean) {
    setSaveResult({ section, ok });
    setTimeout(() => setSaveResult(r => (r?.section === section ? null : r)), ok ? 2500 : 5000);
  }

  async function handleSaveSection(section: DraftKey) {
    setSaving(true);
    const ok = await saveSection(section, draft[section]);
    setSaving(false);
    reportSaveResult(section, ok);
  }

  async function handleSavePractitioners() {
    setSaving(true);
    const ok = await saveSection('practitioners', { list: practitioners });
    setSaving(false);
    reportSaveResult('practitioners', ok);
  }

  async function handleSaveFaqs() {
    setSaving(true);
    const ok = await saveSection('faqs', { list: faqs });
    setSaving(false);
    reportSaveResult('faqs', ok);
  }

  // Read-only, derived from the same draft/practitioners/faqs state already
  // in memory - purely for the nav status dots and Overview checklist. Does
  // not affect what gets saved or how.
  const sectionComplete: Record<string, boolean> = {
    "Clinic Profile": Boolean(draft.clinic_profile.clinic_name && draft.clinic_profile.phone_number && draft.clinic_profile.address),
    "Clinic Hours": Object.keys(draft.clinic_hours).some(k => k.startsWith("open_")),
    "Practitioners": practitioners.length > 0 && practitioners.every(p => p.name && p.staff_num),
    "Transfer & Escalation": Boolean(draft.transfer_escalation.transfer_number),
    "FAQs / Knowledge Base": faqs.length > 0,
    "SMS Follow-Ups": true,
  };
  const requiredSections = sections.filter(s => !SETTINGS_SECTION_META[s]?.optional);
  const completedCount = requiredSections.filter(s => sectionComplete[s]).length;
  const setupComplete = completedCount === requiredSections.length;
  const firstIncompleteSection = requiredSections.find(s => !sectionComplete[s]) ?? null;

  // Dispatches to whichever save handler the currently active section
  // actually uses - same three handlers as before, just called from one
  // sticky bar instead of three separate per-section buttons.
  function saveActiveSection() {
    if (activeSection === "Practitioners") return handleSavePractitioners();
    if (activeSection === "FAQs / Knowledge Base") return handleSaveFaqs();
    if ((sections as string[]).includes(activeSection) && activeSection !== "Practitioners" && activeSection !== "FAQs / Knowledge Base") {
      const keyMap: Record<string, DraftKey> = {
        "Clinic Profile": "clinic_profile",
        "Clinic Hours": "clinic_hours",
        "Transfer & Escalation": "transfer_escalation",
        "SMS Follow-Ups": "sms_follow_ups",
      };
      const key = keyMap[activeSection];
      if (key) return handleSaveSection(key);
    }
    return Promise.resolve();
  }
  const activeSectionSaveResult = saveResult && (
    saveResult.section === "practitioners" && activeSection === "Practitioners" ? saveResult :
    saveResult.section === "faqs" && activeSection === "FAQs / Knowledge Base" ? saveResult :
    ["clinic_profile", "clinic_hours", "transfer_escalation", "sms_follow_ups"].includes(saveResult.section) &&
      saveResult.section === ({ "Clinic Profile": "clinic_profile", "Clinic Hours": "clinic_hours", "Transfer & Escalation": "transfer_escalation", "SMS Follow-Ups": "sms_follow_ups" } as Record<string, string>)[activeSection]
      ? saveResult : null
  );

  function addPractitioner() {
    setPractitioners(prev => [...prev, {
      id: crypto.randomUUID(), name: "", keywords: "", staff_num: "",
      appointment_types: [newAppointmentType()],
    }]);
  }

  function removePractitioner(id: string) {
    setPractitioners(prev => prev.filter(p => p.id !== id));
  }

  function updatePractitioner(id: string, field: 'name' | 'keywords' | 'staff_num', value: string) {
    setPractitioners(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }

  function newAppointmentType(): AppointmentType {
    return {
      id: crypto.randomUUID(), service_name: "", keywords: "",
      duration_categories: [
        { id: crypto.randomUUID(), label: "Initial", durations: "45,60" },
        { id: crypto.randomUUID(), label: "Follow-up", durations: "30,45,60" },
      ],
    };
  }

  function addAppointmentType(practitionerId: string) {
    setPractitioners(prev => prev.map(p => p.id === practitionerId ? {
      ...p, appointment_types: [...(p.appointment_types ?? []), newAppointmentType()],
    } : p));
  }

  function removeAppointmentType(practitionerId: string, typeId: string) {
    setPractitioners(prev => prev.map(p => p.id === practitionerId ? {
      ...p, appointment_types: p.appointment_types.filter(t => t.id !== typeId),
    } : p));
  }

  function updateAppointmentTypeField(practitionerId: string, typeId: string, field: 'service_name' | 'keywords', value: string) {
    setPractitioners(prev => prev.map(p => p.id === practitionerId ? {
      ...p, appointment_types: p.appointment_types.map(t => t.id === typeId ? { ...t, [field]: value } : t),
    } : p));
  }

  function addDurationCategory(practitionerId: string, typeId: string) {
    setPractitioners(prev => prev.map(p => p.id === practitionerId ? {
      ...p, appointment_types: p.appointment_types.map(t => t.id === typeId ? {
        ...t, duration_categories: [...(t.duration_categories ?? []), { id: crypto.randomUUID(), label: "", durations: "" }],
      } : t),
    } : p));
  }

  function removeDurationCategory(practitionerId: string, typeId: string, catId: string) {
    setPractitioners(prev => prev.map(p => p.id === practitionerId ? {
      ...p, appointment_types: p.appointment_types.map(t => t.id === typeId ? {
        ...t, duration_categories: t.duration_categories.filter(c => c.id !== catId),
      } : t),
    } : p));
  }

  function updateDurationCategory(practitionerId: string, typeId: string, catId: string, field: 'label' | 'durations', value: string) {
    setPractitioners(prev => prev.map(p => p.id === practitionerId ? {
      ...p, appointment_types: p.appointment_types.map(t => t.id === typeId ? {
        ...t, duration_categories: t.duration_categories.map(c => c.id === catId ? { ...c, [field]: value } : c),
      } : t),
    } : p));
  }

  function toggleDuration(practitionerId: string, typeId: string, catId: string, dur: string, currentDurations: string) {
    const set = new Set(currentDurations.split(',').map(s => s.trim()).filter(Boolean));
    set.has(dur) ? set.delete(dur) : set.add(dur);
    updateDurationCategory(practitionerId, typeId, catId, 'durations', [...set].join(','));
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-5 pb-24">
        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-1">Clinic Configuration</p>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Clinic setup</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Configure the information and rules {tenantInfo?.receptionist_name || "your AI receptionist"} uses to support your patients.</p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${setupComplete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {setupComplete ? "Ready" : "Needs attention"}
          </span>
        </div>

      <div className="flex gap-6">
      {/* Settings nav */}
      <div className="w-56 flex-shrink-0">
        <Card className="overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/40">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Settings</p>
          </div>
          <nav className="p-1.5 space-y-0.5">
            <button
              type="button"
              onClick={() => setActiveSection("Overview")}
              className={`w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-md text-xs transition-colors border-l-[3px] ${activeSection === "Overview" ? "bg-primary/10 text-primary font-semibold border-primary" : "text-foreground hover:bg-muted border-transparent"}`}
            >
              <LayoutDashboard size={13} />
              <span className="flex-1">Setup Overview</span>
            </button>
            <div className="h-px bg-border my-1" />
            {sections.map((s) => {
              const meta = SETTINGS_SECTION_META[s];
              const Icon = meta?.icon ?? Settings;
              const complete = sectionComplete[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSection(s)}
                  className={`w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-md text-xs transition-colors border-l-[3px] ${activeSection === s ? "bg-primary/10 text-primary font-semibold border-primary" : "text-foreground hover:bg-muted border-transparent"}`}
                >
                  <Icon size={13} className="flex-shrink-0" />
                  <span className="flex-1">{s}</span>
                  {meta?.optional ? (
                    <span className="text-[9px] text-muted-foreground">Optional</span>
                  ) : complete ? (
                    <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                  ) : (
                    <Circle size={12} className="text-muted-foreground/40 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </nav>
        </Card>
      </div>

      {/* Settings form */}
      <div className="flex-1 min-w-0">
        {activeSection === "Overview" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Setup Overview</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Where things stand across every setup section.</p>
            </div>
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">{completedCount} of {requiredSections.length} sections complete</p>
                <span className="text-xs font-medium text-muted-foreground">{Math.round((completedCount / requiredSections.length) * 100)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(completedCount / requiredSections.length) * 100}%` }} />
              </div>
              {firstIncompleteSection ? (
                <button type="button" onClick={() => setActiveSection(firstIncompleteSection)} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                  Continue setup: {firstIncompleteSection} <ChevronRight size={12} />
                </button>
              ) : (
                <p className="text-xs text-emerald-600 font-medium flex items-center gap-1.5"><CheckCircle2 size={12} /> All required sections are complete.</p>
              )}
            </Card>
            <Card className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/40">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Readiness Checklist</p>
              </div>
              <div className="divide-y divide-border">
                {sections.map(s => {
                  const meta = SETTINGS_SECTION_META[s];
                  const complete = sectionComplete[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setActiveSection(s)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <div>
                        <p className="text-xs font-medium text-foreground">{s}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{meta?.subtitle}</p>
                      </div>
                      {meta?.optional ? (
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">Optional</span>
                      ) : complete ? (
                        <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1 flex-shrink-0"><CheckCircle2 size={11} /> Complete</span>
                      ) : (
                        <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1 flex-shrink-0"><AlertCircle size={11} /> Needs attention</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        )}
        {activeSection === "Clinic Profile" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Clinic Profile</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{SETTINGS_SECTION_META["Clinic Profile"].subtitle}</p>
            </div>
            <Card className="p-5 space-y-4">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Clinic Identity</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Clinic Name</label>
                  <input value={draft.clinic_profile.clinic_name ?? tenantInfo?.clinic_name ?? ""} onChange={e => setField('clinic_profile', 'clinic_name', e.target.value)} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Website</label>
                  <input type="url" value={draft.clinic_profile.website ?? ""} onChange={e => setField('clinic_profile', 'website', e.target.value)} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Timezone</label>
                  <select value={draft.clinic_profile.timezone ?? "America/Vancouver (PST/PDT)"} onChange={e => setField('clinic_profile', 'timezone', e.target.value)} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>America/Vancouver (PST/PDT)</option>
                    <option>America/Toronto (EST/EDT)</option>
                    <option>America/New_York (EST/EDT)</option>
                    <option>America/Chicago (CST/CDT)</option>
                    <option>America/Denver (MST/MDT)</option>
                    <option>America/Los_Angeles (PST/PDT)</option>
                  </select>
                </div>
              </div>
            </Card>

            <Card className="p-5 space-y-4">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Contact Details</p>
              <div className="grid grid-cols-2 gap-4">
                {([
                  ["Phone Number", "phone_number", "", "tel"],
                  ["SMS Number", "sms_number", "", "tel"],
                  ["Email", "email", "", "email"],
                  ["Main Contact", "main_contact", tenantInfo?.receptionist_name ?? "", "text"],
                ] as [string, string, string, string][]).map(([label, key, fallback, type]) => (
                  <div key={key} className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">{label}</label>
                    <input type={type} value={draft.clinic_profile[key] ?? fallback} onChange={e => setField('clinic_profile', key, e.target.value)} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5 space-y-4">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Location</p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Address</label>
                <input value={draft.clinic_profile.address ?? ""} onChange={e => setField('clinic_profile', 'address', e.target.value)} placeholder="100 King Street West, Toronto, ON" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
            </Card>
          </div>
        )}

        {activeSection === "Clinic Hours" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Clinic Hours</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{SETTINGS_SECTION_META["Clinic Hours"].subtitle}</p>
            </div>
            <Card className="p-5 space-y-3">
              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, i) => {
                const isOpen = draft.clinic_hours[`open_${day}`] !== undefined ? parseBoolean(draft.clinic_hours[`open_${day}`]) : i < 6;
                const startVal = draft.clinic_hours[`start_${day}`] ?? (i < 6 ? "08:00" : "");
                const endVal = draft.clinic_hours[`end_${day}`] ?? (i < 5 ? "18:00" : i === 5 ? "14:00" : "");
                return (
                  <div key={day} className="flex items-center gap-4">
                    <span className="text-xs font-medium text-foreground w-24">{day}</span>
                    <input type="checkbox" checked={isOpen} onChange={e => setField('clinic_hours', `open_${day}`, e.target.checked ? 'true' : 'false')} className="rounded" />
                    <input type="time" value={startVal} onChange={e => setField('clinic_hours', `start_${day}`, e.target.value)} className="bg-input-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                    <span className="text-xs text-muted-foreground">to</span>
                    <input type="time" value={endVal} onChange={e => setField('clinic_hours', `end_${day}`, e.target.value)} className="bg-input-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                    {i < 5 && <span className="text-[10px] text-muted-foreground">Lunch 12:00–13:00</span>}
                  </div>
                );
              })}
            </Card>
          </div>
        )}

        {activeSection === "Practitioners" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Practitioners</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{SETTINGS_SECTION_META["Practitioners"].subtitle}</p>
              </div>
              <button type="button" onClick={addPractitioner} className="flex items-center gap-1.5 bg-muted border border-border text-xs font-medium px-3 py-2 rounded-md hover:bg-accent transition-colors">
                <Plus size={12} /> Add Practitioner
              </button>
            </div>

            {practitioners.length === 0 ? (
              <Card className="p-10 flex flex-col items-center justify-center gap-3 text-center">
                <Users size={28} className="text-muted-foreground/30" />
                <p className="text-sm font-medium text-foreground">No practitioners added yet</p>
                <p className="text-xs text-muted-foreground">Click "Add Practitioner" to get started.</p>
                <button type="button" onClick={addPractitioner} className="mt-1 flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90">
                  <Plus size={12} /> Add Practitioner
                </button>
              </Card>
            ) : (
              <div className="space-y-3">
                {practitioners.map((p, i) => {
                  const durations = ["15", "30", "45", "60", "75", "90"];
                  const types = p.appointment_types ?? [];
                  return (
                    <Card key={p.id} className="p-4 space-y-3">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Practitioner #{i + 1}</span>
                        <button type="button" onClick={() => removePractitioner(p.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                      {/* Name + ID */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground">Name</label>
                          <input value={p.name} onChange={e => updatePractitioner(p.id, 'name', e.target.value)} placeholder="Dr. Sarah Chen" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-foreground">Staff Number</label>
                          <input value={p.staff_num} onChange={e => updatePractitioner(p.id, 'staff_num', e.target.value)} placeholder="1122" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
                        </div>
                      </div>
                      {/* Name keywords */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-foreground">Name Keywords</label>
                        <input value={p.keywords} onChange={e => updatePractitioner(p.id, 'keywords', e.target.value)} placeholder="Erika, Dr. Bishop, Bishop" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                        <p className="text-[10px] text-muted-foreground">Aliases the AI uses to match callers asking for this person by name.</p>
                      </div>
                      {/* Service types */}
                      <div className="border-t border-border pt-3 space-y-2">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Service Types & Appointment Durations</p>
                        {types.map((t, ti) => (
                          <div key={t.id} className="bg-muted/40 border border-border rounded-md p-3 space-y-2">
                            {/* Service name + keywords */}
                            <div className="flex items-start gap-2">
                              <div className="flex-1 space-y-1.5">
                                <input value={t.service_name} onChange={e => updateAppointmentTypeField(p.id, t.id, 'service_name', e.target.value)} placeholder={`Service type #${ti + 1} (e.g. Chiropractic)`} className="w-full bg-input-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-medium" />
                                <input value={t.keywords ?? ""} onChange={e => updateAppointmentTypeField(p.id, t.id, 'keywords', e.target.value)} placeholder="Service keywords (e.g. chiro, chiropractor, adjustment)" className="w-full bg-input-background border border-border rounded-md px-3 py-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-muted-foreground" />
                              </div>
                              {types.length > 1 && (
                                <button type="button" onClick={() => removeAppointmentType(p.id, t.id)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-1.5">
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                            {/* Duration categories */}
                            <div className="space-y-1.5 pl-1">
                              {(t.duration_categories ?? []).map(c => {
                                const selected = new Set((c.durations ?? '').split(',').map(s => s.trim()).filter(Boolean));
                                return (
                                  <div key={c.id} className="flex flex-wrap items-center gap-2">
                                    <input value={c.label} onChange={e => updateDurationCategory(p.id, t.id, c.id, 'label', e.target.value)} placeholder="e.g. Initial, Follow-up, Cleaning" className="w-28 shrink-0 bg-input-background border border-border rounded px-2 py-1 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                                    <div className="flex flex-wrap gap-1.5">
                                      {durations.map(d => (
                                        <label key={d} className="flex items-center gap-1 text-[10px] text-foreground cursor-pointer select-none">
                                          <input type="checkbox" checked={selected.has(d)} onChange={() => toggleDuration(p.id, t.id, c.id, d, c.durations)} className="rounded" />
                                          {d}
                                        </label>
                                      ))}
                                    </div>
                                    {(t.duration_categories ?? []).length > 1 && (
                                      <button type="button" onClick={() => removeDurationCategory(p.id, t.id, c.id)} className="text-muted-foreground hover:text-destructive transition-colors ml-auto">
                                        <X size={10} />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                              <button type="button" onClick={() => addDurationCategory(p.id, t.id)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors pt-0.5">
                                <Plus size={9} /> Add duration type
                              </button>
                            </div>
                          </div>
                        ))}
                        <button type="button" onClick={() => addAppointmentType(p.id)} className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors pt-0.5">
                          <Plus size={10} /> Add Service Type
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeSection === "Transfer & Escalation" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Transfer & Escalation</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{SETTINGS_SECTION_META["Transfer & Escalation"].subtitle}</p>
            </div>
            <Card className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Transfer Phone Number</label>
                  <input type="tel" value={draft.transfer_escalation.transfer_number ?? ""} onChange={e => setField('transfer_escalation', 'transfer_number', e.target.value)} placeholder="+1 (604) 555-0100" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  <p className="text-[10px] text-muted-foreground">The number the AI transfers to when escalation is needed.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">After-Hours Transfer Number</label>
                  <input type="tel" value={draft.transfer_escalation.after_hours_number ?? ""} onChange={e => setField('transfer_escalation', 'after_hours_number', e.target.value)} placeholder="+1 (604) 555-0199" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  <p className="text-[10px] text-muted-foreground">Optional — leave blank to use the same number.</p>
                </div>
              </div>
              {(() => {
                // Structured toggle rows for the common triggers, serialized
                // as newline-separated lines into the SAME escalation_triggers
                // string field the backend already expects - no schema change.
                const TRIGGER_TEMPLATES = [
                  "Caller asks to speak to a human",
                  "Caller mentions an emergency or urgent situation",
                  "Caller is upset or frustrated",
                  "Caller has a complaint",
                ];
                const currentLines = (draft.transfer_escalation.escalation_triggers ?? "").split("\n").map(l => l.trim()).filter(Boolean);
                const customLines = currentLines.filter(l => !TRIGGER_TEMPLATES.includes(l));

                function toggleTrigger(template: string) {
                  const has = currentLines.includes(template);
                  const next = has ? currentLines.filter(l => l !== template) : [...currentLines, template];
                  setField('transfer_escalation', 'escalation_triggers', next.join("\n"));
                }
                function setCustomLines(text: string) {
                  const templateLines = TRIGGER_TEMPLATES.filter(t => currentLines.includes(t));
                  const next = [...templateLines, ...text.split("\n").map(l => l.trim()).filter(Boolean)];
                  setField('transfer_escalation', 'escalation_triggers', next.join("\n"));
                }

                return (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">Transfer Rules</label>
                    <p className="text-[10px] text-muted-foreground -mt-1">Grace transfers the call when any enabled rule matches.</p>
                    <div className="rounded-md border border-border divide-y divide-border">
                      {TRIGGER_TEMPLATES.map(template => (
                        <label key={template} className="flex items-center gap-2.5 px-3 py-2 text-xs text-foreground cursor-pointer hover:bg-muted/30">
                          <input type="checkbox" checked={currentLines.includes(template)} onChange={() => toggleTrigger(template)} className="rounded" />
                          {template}
                        </label>
                      ))}
                    </div>
                    <label className="text-xs font-medium text-foreground block pt-1">Custom Rules</label>
                    <textarea
                      rows={2}
                      value={customLines.join("\n")}
                      onChange={e => setCustomLines(e.target.value)}
                      placeholder="One custom condition per line"
                      className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    />
                  </div>
                );
              })()}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Hold / Transfer Message</label>
                <textarea rows={2} value={draft.transfer_escalation.hold_message ?? ""} onChange={e => setField('transfer_escalation', 'hold_message', e.target.value)} placeholder="Please hold while I transfer you to a member of our team." className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
              </div>
              <div className="flex flex-col gap-3 pt-1">
                {[
                  ["transfer_on_human_request", "Always transfer when caller asks for a human"],
                  ["transfer_on_no_availability", "Transfer if no appointment slots are available"],
                ].map(([name, label]) => (
                  <label key={name} className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer">
                    <input type="checkbox" checked={draft.transfer_escalation[name] !== 'false'} onChange={e => setField('transfer_escalation', name, e.target.checked ? 'true' : 'false')} className="rounded" />
                    {label}
                  </label>
                ))}
              </div>
            </Card>
          </div>
        )}

        {activeSection === "FAQs / Knowledge Base" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">FAQs / Knowledge Base</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{SETTINGS_SECTION_META["FAQs / Knowledge Base"].subtitle}</p>
              </div>
              <button type="button" onClick={() => setFaqs(prev => [...prev, { id: crypto.randomUUID(), question: "", answer: "" }])} className="flex items-center gap-1.5 bg-muted border border-border text-xs font-medium px-3 py-2 rounded-md hover:bg-accent transition-colors">
                <Plus size={12} /> Add FAQ
              </button>
            </div>
            {faqs.length === 0 ? (
              <Card className="p-10 flex flex-col items-center justify-center gap-3 text-center">
                <HelpCircle size={28} className="text-muted-foreground/30" />
                <p className="text-sm font-medium text-foreground">No FAQs added yet</p>
                <p className="text-xs text-muted-foreground">Add common questions callers ask and the answers the AI should give.</p>
                <button type="button" onClick={() => setFaqs([{ id: crypto.randomUUID(), question: "", answer: "" }])} className="mt-1 flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90">
                  <Plus size={12} /> Add FAQ
                </button>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={faqSearch}
                    onChange={e => setFaqSearch(e.target.value)}
                    placeholder="Search questions and answers…"
                    className="w-full bg-input-background border border-border rounded-md pl-8 pr-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                {faqs.filter(f =>
                  !faqSearch.trim() ||
                  f.question.toLowerCase().includes(faqSearch.trim().toLowerCase()) ||
                  f.answer.toLowerCase().includes(faqSearch.trim().toLowerCase())
                ).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">No FAQs match "{faqSearch}".</p>
                )}
                {faqs.filter(f =>
                  !faqSearch.trim() ||
                  f.question.toLowerCase().includes(faqSearch.trim().toLowerCase()) ||
                  f.answer.toLowerCase().includes(faqSearch.trim().toLowerCase())
                ).map((faq) => {
                  const i = faqs.findIndex(f => f.id === faq.id);
                  return (
                  <Card key={faq.id} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">FAQ #{i + 1}</span>
                      <button type="button" onClick={() => setFaqs(prev => prev.filter(f => f.id !== faq.id))} className="text-muted-foreground hover:text-destructive transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Question</label>
                      <input value={faq.question} onChange={e => setFaqs(prev => prev.map(f => f.id === faq.id ? { ...f, question: e.target.value } : f))} placeholder="What are your clinic hours?" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Answer</label>
                      <textarea value={faq.answer} onChange={e => setFaqs(prev => prev.map(f => f.id === faq.id ? { ...f, answer: e.target.value } : f))} rows={2} placeholder="We're open Monday to Friday, 8am to 6pm, and Saturday 8am to 2pm." className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
                    </div>
                  </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeSection === "SMS Follow-Ups" && (() => {
          const templates = [
            ["appointment_confirmed", "Appointment Confirmed", "Hi {patient_name}, your appointment at {clinic_name} is confirmed for {date} at {time}. Reply STOP to opt out."],
            ["reminder_24hr", "Reminder — 24 Hours Before", "Hi {patient_name}, just a reminder of your appointment tomorrow at {time} with {clinic_name}. Reply STOP to opt out."],
            ["reminder_2hr", "Reminder — 2 Hours Before", "Hi {patient_name}, your appointment is in 2 hours at {time}. See you soon! Reply STOP to opt out."],
            ["cancelled", "Appointment Cancelled", "Hi {patient_name}, your appointment on {date} at {clinic_name} has been cancelled. Call us to rebook. Reply STOP to opt out."],
            ["rescheduled", "Appointment Rescheduled", "Hi {patient_name}, your appointment has been rescheduled to {date} at {time}. Reply STOP to opt out."],
            ["no_show", "No-Show Follow-Up", "Hi {patient_name}, we missed you today. Please call us to rebook your appointment at {clinic_name}. Reply STOP to opt out."],
          ] as [string, string, string][];
          return (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-foreground">SMS Follow-Ups</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{SETTINGS_SECTION_META["SMS Follow-Ups"].subtitle}</p>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">Customize the SMS sent for each event. Use <span className="font-mono bg-muted px-1 rounded">{"{patient_name}"}</span>, <span className="font-mono bg-muted px-1 rounded">{"{date}"}</span>, <span className="font-mono bg-muted px-1 rounded">{"{time}"}</span>, <span className="font-mono bg-muted px-1 rounded">{"{clinic_name}"}</span> as placeholders.</p>
              <div className="space-y-3">
                {templates.map(([key, label, fallback]) => (
                  <Card key={key} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={draft.sms_follow_ups[`${key}_enabled`] !== 'false'} onChange={e => setField('sms_follow_ups', `${key}_enabled`, e.target.checked ? 'true' : 'false')} className="rounded" />
                          <span className="text-xs font-semibold text-foreground">{label}</span>
                        </label>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{(draft.sms_follow_ups[`${key}_message`] ?? fallback).length} chars</span>
                    </div>
                    <textarea rows={2} value={draft.sms_follow_ups[`${key}_message`] ?? fallback} onChange={e => setField('sms_follow_ups', `${key}_message`, e.target.value)} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
                  </Card>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Context rail */}
      {activeSection !== "Overview" && (
        <div className="w-72 flex-shrink-0 space-y-4">
          {activeSection === "Clinic Profile" && (
            <Card className="p-4 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">As Grace Will Say It</p>
              <p className="text-xs text-foreground leading-relaxed bg-muted/40 border border-border rounded-md p-3 italic">
                "You've reached {draft.clinic_profile.clinic_name || tenantInfo?.clinic_name || "the clinic"}{draft.clinic_profile.address ? ` at ${draft.clinic_profile.address}` : ""}. How can I help you today?"
              </p>
            </Card>
          )}
          {activeSection === "Transfer & Escalation" && (
            <Card className="p-4 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Receptionist Behavior</p>
              <p className="text-xs text-foreground leading-relaxed">
                {draft.transfer_escalation.transfer_number
                  ? `Grace transfers to ${draft.transfer_escalation.transfer_number} when a caller needs a person.`
                  : "Add a transfer number so Grace has somewhere to send callers who need a person."}
              </p>
            </Card>
          )}
          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Info size={11} />
              <p className="text-[10px] font-semibold uppercase tracking-wide">Tip</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {activeSection === "Clinic Profile" && "The address and phone number here are what Grace reads back to callers, so keep them exactly as patients would expect to hear them."}
              {activeSection === "Clinic Hours" && "Hours drive Grace's after-hours behavior automatically — no separate toggle needed once these are set."}
              {activeSection === "Practitioners" && "Add common variations of each practitioner's name so Grace can match callers who use only a first name or surname."}
              {activeSection === "Transfer & Escalation" && "Keep the transfer number staffed during clinic hours — Grace will route urgent callers there immediately."}
              {activeSection === "FAQs / Knowledge Base" && "Keep answers short and specific. Grace reads these back nearly verbatim during calls."}
              {activeSection === "SMS Follow-Ups" && "Test each message template with real variable values before enabling it for patients."}
            </p>
          </Card>
        </div>
      )}
      </div>
      </div>

      {/* Sticky save bar - hidden on the Overview tab, since there's nothing to save there */}
      {activeSection !== "Overview" && (
        <div className="flex-shrink-0 border-t border-border bg-card px-6 py-3 flex items-center justify-between">
          <div className="text-xs">
            {activeSectionSaveResult ? (
              <span className={`font-medium ${activeSectionSaveResult.ok ? "text-emerald-600" : "text-destructive"}`}>
                {activeSectionSaveResult.ok ? "Changes saved" : "Save failed — try again"}
              </span>
            ) : (
              <span className="text-muted-foreground">Editing {activeSection}</span>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={saveActiveSection}
            className="bg-primary text-primary-foreground text-xs font-semibold px-5 py-2 rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Screen: Billing & Usage ───────────────────────────────────────────────────
function BillingScreen() {
  const { invoices } = useDashboard();
  // Build Invoices Response already sorts newest period first.
  const latest = invoices[0] ?? null;
  const billingPct = latest ? Math.min(100, (latest.minutesUsed / latest.includedMinutes) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Billing & Usage</h1>
          <p className="text-xs text-muted-foreground">Billing cycle: {latest?.period ?? "—"}</p>
        </div>
        <button className="flex items-center gap-2 bg-muted border border-border text-xs font-medium px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
          <Download size={12} /> Download Invoice
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Current Plan" value={latest ? `$${latest.baseRate.toFixed(0)}/mo` : "—"} sub={latest ? `${latest.includedMinutes.toLocaleString()} min included` : "—"} icon={Star} color="purple" />
        <KpiCard label="Minutes Used" value={latest ? `${latest.minutesUsed} / ${latest.includedMinutes}` : "—"} sub="of plan included" icon={Clock} color="amber" />
        <KpiCard label="Est. Overage" value={latest ? `$${latest.overageCost.toFixed(2)}` : "—"} sub={latest ? `${latest.overageMin} min over` : "vs plan limits"} icon={CreditCard} color={latest?.isOverage ? "red" : "green"} />
        <KpiCard label="Latest Invoice" value={latest?.amount ?? "—"} sub={latest ? (latest.paid ? "Paid" : latest.status) : "Current cycle"} icon={CreditCard} color="purple" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Invoice History</h3>
          </div>
          {invoices.length === 0 ? (
            <p className="text-xs text-muted-foreground py-10 text-center">No invoices yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["Period", "Amount", "Minutes", "Status", "Due"].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-foreground">{inv.period}</td>
                    <td className="px-4 py-2.5 font-mono text-foreground">{inv.amount}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{inv.minutes}</td>
                    <td className="px-4 py-2.5"><Badge label={inv.paid ? "Paid" : inv.status} variant={inv.paid ? "Paid" : inv.status} /></td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{inv.dueDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Plan Details</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">AI Minutes Used</span>
                <span className="font-semibold text-foreground font-mono">{latest ? `${latest.minutesUsed} / ${latest.includedMinutes}` : "—"}</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${billingPct}%` }} />
              </div>
              {latest && billingPct >= 80 && (
                <p className="text-[10px] text-amber-600 mt-1 font-medium">
                  ⚠ {latest.isOverage ? "Over plan limit." : "Approaching plan limit."} {Math.max(0, latest.includedMinutes - latest.minutesUsed)} minutes remaining.
                </p>
              )}
            </div>
            <div className="pt-2 space-y-2 text-xs">
              {[
                ["Included Minutes", latest ? `${latest.includedMinutes.toLocaleString()}/mo` : "—"],
                ["Overage Rate", latest ? `$${latest.overageRate.toFixed(2)}/min` : "—"],
                ["Overage Minutes", latest ? String(latest.overageMin) : "—"],
                ["Invoice Status", latest ? (latest.paid ? "Paid" : latest.status) : "—"],
                ["Generated", latest?.date || "—"],
                ["Due Date", latest?.dueDate || "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium text-foreground">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Payment Recovery ─────────────────────────────────────────────────────────
type RecoveryStatus =
  | "new" | "sms_reminder_1_sent" | "email_reminder_1_sent"
  | "sms_reminder_2_sent" | "email_reminder_2_sent" | "payment_link_sent"
  | "paid" | "staff_escalation_required" | "manual_hold" | "failed";

interface PRInvoice {
  invoice_id: string; invoice_number: string; clinic_id: string;
  patient_name: string; patient_phone: string; patient_email: string;
  amount_due: number; original_amount?: number; recovered_amount?: number;
  due_date: string; status: RecoveryStatus;
  last_reminder_at?: string; next_reminder_at?: string;
  last_updated: string; attempt_count: number;
  last_synced_at?: string;
}
interface PRTask {
  task_id: string; invoice_id: string; invoice_number: string; patient_name: string;
  reminder_type: string; scheduled_time: string;
  status: "pending" | "completed" | "cancelled" | "failed";
  attempt_count: number; failure_reason?: string;
}
interface PRComm {
  comm_id: string; invoice_id: string; invoice_number: string; patient_name: string;
  channel: "sms" | "email"; recipient: string; message: string; reminder_type?: string;
  status: "queued" | "sent" | "delivered" | "failed"; timestamp: string;
}

const STATUS_LABELS: Record<RecoveryStatus, string> = {
  new: "New", sms_reminder_1_sent: "SMS 1 Sent", email_reminder_1_sent: "Email 1 Sent",
  sms_reminder_2_sent: "SMS 2 Sent", email_reminder_2_sent: "Email 2 Sent",
  payment_link_sent: "Payment Link Sent", paid: "Paid",
  staff_escalation_required: "Staff Attention", manual_hold: "Paused", failed: "Failed",
};
const STATUS_COLORS: Record<RecoveryStatus, string> = {
  new: "bg-blue-100 text-blue-700", sms_reminder_1_sent: "bg-blue-100 text-blue-700",
  email_reminder_1_sent: "bg-blue-100 text-blue-700", sms_reminder_2_sent: "bg-indigo-100 text-indigo-700",
  email_reminder_2_sent: "bg-indigo-100 text-indigo-700", payment_link_sent: "bg-violet-100 text-violet-700",
  paid: "bg-emerald-100 text-emerald-700", staff_escalation_required: "bg-amber-100 text-amber-700",
  manual_hold: "bg-slate-100 text-slate-600", failed: "bg-red-100 text-red-700",
};
function RecoveryBadge({ status }: { status: RecoveryStatus }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[status]}`}>{STATUS_LABELS[status]}</span>;
}

// TODO: Replace with real data from GET /billing/invoices endpoint (connects to n8n workflow that syncs Juvonno invoices)
const PR_INVOICES: PRInvoice[] = [
  { invoice_id:"inv_001", invoice_number:"INV-1001", clinic_id:"juvonno", patient_name:"Sarah Mitchell", patient_phone:"+16045550101", patient_email:"sarah@example.com", amount_due:285.00, original_amount:285, due_date:"2026-06-15", status:"sms_reminder_1_sent", last_reminder_at:"2026-07-01T09:00:00Z", next_reminder_at:"2026-07-02T09:00:00Z", last_updated:"2026-07-01T09:00:00Z", attempt_count:1, last_synced_at:"2026-07-04T08:00:00Z" },
  { invoice_id:"inv_002", invoice_number:"INV-1002", clinic_id:"juvonno", patient_name:"James Okafor", patient_phone:"+16045550102", patient_email:"james@example.com", amount_due:150.00, original_amount:150, due_date:"2026-06-20", status:"email_reminder_1_sent", last_reminder_at:"2026-07-02T10:00:00Z", next_reminder_at:"2026-07-05T09:00:00Z", last_updated:"2026-07-02T10:00:00Z", attempt_count:2, last_synced_at:"2026-07-04T08:00:00Z" },
  { invoice_id:"inv_003", invoice_number:"INV-1003", clinic_id:"juvonno", patient_name:"Priya Sharma", patient_phone:"", patient_email:"priya@example.com", amount_due:420.50, original_amount:420.50, due_date:"2026-06-10", status:"staff_escalation_required", last_reminder_at:"2026-06-30T09:00:00Z", last_updated:"2026-07-01T08:00:00Z", attempt_count:4, last_synced_at:"2026-07-04T08:00:00Z" },
  { invoice_id:"inv_004", invoice_number:"INV-1004", clinic_id:"juvonno", patient_name:"Tom Bellamy", patient_phone:"+16045550104", patient_email:"tom@example.com", amount_due:0, original_amount:95, recovered_amount:95, due_date:"2026-06-01", status:"paid", last_reminder_at:"2026-06-25T09:00:00Z", last_updated:"2026-07-03T14:22:00Z", attempt_count:2, last_synced_at:"2026-07-03T14:20:00Z" },
  { invoice_id:"inv_005", invoice_number:"INV-1005", clinic_id:"juvonno", patient_name:"Rachel Ng", patient_phone:"+16045550105", patient_email:"rachel@example.com", amount_due:330.00, original_amount:330, due_date:"2026-06-28", status:"manual_hold", last_reminder_at:"2026-06-29T09:00:00Z", last_updated:"2026-07-01T11:00:00Z", attempt_count:1, last_synced_at:"2026-07-04T08:00:00Z" },
  { invoice_id:"inv_006", invoice_number:"INV-1006", clinic_id:"juvonno", patient_name:"David Lam", patient_phone:"+16045550106", patient_email:"", amount_due:175.00, original_amount:175, due_date:"2026-07-01", status:"new", next_reminder_at:"2026-07-06T09:00:00Z", last_updated:"2026-07-04T00:00:00Z", attempt_count:0, last_synced_at:"2026-07-04T08:00:00Z" },
  { invoice_id:"inv_007", invoice_number:"INV-1007", clinic_id:"juvonno", patient_name:"Anita Patel", patient_phone:"+16045550107", patient_email:"anita@example.com", amount_due:512.00, original_amount:512, due_date:"2026-06-05", status:"failed", last_reminder_at:"2026-07-01T09:00:00Z", last_updated:"2026-07-01T09:05:00Z", attempt_count:3, last_synced_at:"2026-07-04T08:00:00Z" },
];
// TODO: Replace with real data from GET /billing/tasks endpoint (n8n maintains reminder tasks in Google Sheets)
const PR_TASKS: PRTask[] = [
  { task_id:"task_001", invoice_id:"inv_001", invoice_number:"INV-1001", patient_name:"Sarah Mitchell", reminder_type:"email_reminder_1", scheduled_time:"2026-07-02T09:00:00Z", status:"pending", attempt_count:0 },
  { task_id:"task_002", invoice_id:"inv_002", invoice_number:"INV-1002", patient_name:"James Okafor", reminder_type:"sms_reminder_2", scheduled_time:"2026-07-05T09:00:00Z", status:"pending", attempt_count:0 },
  { task_id:"task_007", invoice_id:"inv_001", invoice_number:"INV-1001", patient_name:"Sarah Mitchell", reminder_type:"reconciliation_check", scheduled_time:"2026-07-08T09:00:00Z", status:"pending", attempt_count:0 },
  { task_id:"task_003", invoice_id:"inv_003", invoice_number:"INV-1003", patient_name:"Priya Sharma", reminder_type:"staff_escalation", scheduled_time:"2026-07-01T08:00:00Z", status:"completed", attempt_count:1 },
  { task_id:"task_004", invoice_id:"inv_004", invoice_number:"INV-1004", patient_name:"Tom Bellamy", reminder_type:"sms_reminder_1", scheduled_time:"2026-06-25T09:00:00Z", status:"completed", attempt_count:1 },
  { task_id:"task_008", invoice_id:"inv_004", invoice_number:"INV-1004", patient_name:"Tom Bellamy", reminder_type:"reconciliation_check", scheduled_time:"2026-07-03T14:00:00Z", status:"completed", attempt_count:1 },
  { task_id:"task_005", invoice_id:"inv_007", invoice_number:"INV-1007", patient_name:"Anita Patel", reminder_type:"sms_reminder_2", scheduled_time:"2026-07-01T09:00:00Z", status:"failed", attempt_count:3, failure_reason:"Carrier rejection" },
  { task_id:"task_006", invoice_id:"inv_006", invoice_number:"INV-1006", patient_name:"David Lam", reminder_type:"sms_reminder_1", scheduled_time:"2026-07-06T09:00:00Z", status:"pending", attempt_count:0 },
  { task_id:"task_009", invoice_id:"inv_005", invoice_number:"INV-1005", patient_name:"Rachel Ng", reminder_type:"sms_reminder_1", scheduled_time:"2026-06-29T09:00:00Z", status:"cancelled", attempt_count:0 },
];
// TODO: Replace with real data from GET /billing/communications endpoint (SMS/email history from Twilio & email provider)
const PR_COMMS: PRComm[] = [
  { comm_id:"c001", invoice_id:"inv_001", invoice_number:"INV-1001", patient_name:"Sarah Mitchell", channel:"sms", recipient:"+1604···0101", reminder_type:"sms_reminder_1", message:"Hi Sarah, invoice INV-1001 has an outstanding balance of $285.00.", status:"delivered", timestamp:"2026-07-01T09:00:00Z" },
  { comm_id:"c002", invoice_id:"inv_002", invoice_number:"INV-1002", patient_name:"James Okafor", channel:"sms", recipient:"+1604···0102", reminder_type:"sms_reminder_1", message:"Hi James, invoice INV-1002 has an outstanding balance of $150.00.", status:"delivered", timestamp:"2026-07-01T09:01:00Z" },
  { comm_id:"c003", invoice_id:"inv_002", invoice_number:"INV-1002", patient_name:"James Okafor", channel:"email", recipient:"james@···.com", reminder_type:"email_reminder_1", message:"Hello James, our records show an outstanding balance of $150.00 for invoice INV-1002.", status:"sent", timestamp:"2026-07-02T10:00:00Z" },
  { comm_id:"c004", invoice_id:"inv_003", invoice_number:"INV-1003", patient_name:"Priya Sharma", channel:"email", recipient:"priya@···.com", reminder_type:"email_reminder_1", message:"Hello Priya, our records show an outstanding balance of $420.50 for invoice INV-1003.", status:"delivered", timestamp:"2026-06-30T09:00:00Z" },
  { comm_id:"c005", invoice_id:"inv_004", invoice_number:"INV-1004", patient_name:"Tom Bellamy", channel:"sms", recipient:"+1604···0104", reminder_type:"sms_reminder_1", message:"Hi Tom, invoice INV-1004 has an outstanding balance of $95.00.", status:"delivered", timestamp:"2026-06-25T09:00:00Z" },
  { comm_id:"c006", invoice_id:"inv_007", invoice_number:"INV-1007", patient_name:"Anita Patel", channel:"sms", recipient:"+1604···0107", reminder_type:"sms_reminder_2", message:"Hi Anita, invoice INV-1007 still has a balance of $512.00.", status:"failed", timestamp:"2026-07-01T09:00:00Z" },
];
// TODO: Fetch settings (templates, schedule, toggles) from GET /billing/settings endpoint
// POST /billing/settings saves back to n8n (which persists to Google Sheets or environment config)
const DEFAULT_TEMPLATES = {
  sms_1: "Hi {{patient_first_name}}, this is a reminder that invoice {{invoice_number}} has an outstanding balance of {{amount_due}}. {{payment_link}}",
  email_1_subject: "Payment reminder for invoice {{invoice_number}}",
  email_1_body: "Hello {{patient_first_name}},\n\nOur records show an outstanding balance of {{amount_due}} for invoice {{invoice_number}}.\n\nYou can make a payment here: {{payment_link}}\n\nIf you have already paid, please disregard this message.",
  sms_2: "Hi {{patient_first_name}}, we are following up about invoice {{invoice_number}}, which still has a balance of {{amount_due}}. {{payment_link}}",
  email_2_subject: "Follow-up for invoice {{invoice_number}}",
  email_2_body: "Hello {{patient_first_name}},\n\nWe are following up because invoice {{invoice_number}} still shows an outstanding balance of {{amount_due}}.\n\nYou can make a payment here: {{payment_link}}\n\nIf you need assistance, please contact the clinic.",
};

function PRLoadingSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-5 bg-muted rounded w-40" />
      <div className="grid grid-cols-3 gap-4">
        {[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}
      </div>
      <div className="h-48 bg-muted rounded-lg" />
      <div className="h-32 bg-muted rounded-lg" />
    </div>
  );
}

function PRErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center"><XCircle size={20} className="text-red-600" /></div>
      <div className="text-center"><p className="text-sm font-medium text-foreground">The dashboard could not load this data.</p><p className="text-xs text-muted-foreground mt-1">Check your connection and try again.</p></div>
      <button onClick={onRetry} className="flex items-center gap-2 text-xs font-medium border border-border px-4 py-2 rounded-md hover:bg-muted transition-colors"><RefreshCw size={12} /> Try again</button>
    </div>
  );
}

interface PRActivityEvent {
  id: string; invoice_number: string; label: string; timestamp: string;
}

function PaymentRecoveryScreen() {
  const { accessToken } = useDashboard();
  const [activeTab, setActiveTab] = useState("overview");
  const [activityLog, setActivityLog] = useState<PRActivityEvent[]>([]);
  const [search, setSearch] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [sortField, setSortField] = useState<"amount_due"|"due_date"|"last_updated"|"next_reminder_at">("due_date");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");
  const [taskTab, setTaskTab] = useState<"pending"|"completed"|"cancelled"|"failed">("pending");
  const [commFilter, setCommFilter] = useState("all");
  const [commDateFrom, setCommDateFrom] = useState("");
  const [commDateTo, setCommDateTo] = useState("");
  const [templates, setTemplates] = useState({ ...DEFAULT_TEMPLATES });
  const [schedule, setSchedule] = useState({ sms1_delay:0, email1_delay:1, sms2_delay:3, email2_delay:3, escalation_delay:1 });
  const [prSettings, setPrSettings] = useState({ sms_enabled:true, email_enabled:true, all_paused:false, timezone:"America/Toronto", send_start:"09:00", send_end:"19:00", min_balance:"0" });
  const [confirm, setConfirm] = useState<{ label: string; invoiceNum: string; onConfirm?: () => void } | null>(null);
  const [detailInvoice, setDetailInvoice] = useState<PRInvoice | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const fmt = (iso?: string) => iso ? new Date(iso).toLocaleDateString("en-CA", { month:"short", day:"numeric" }) : "—";
  const fmtAmt = (n: number) => `$${n.toFixed(2)}`;
  const VARS = ["{{patient_first_name}}","{{invoice_number}}","{{amount_due}}","{{due_date}}","{{payment_link}}","{{clinic_phone}}"];

  const showSuccess = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(""), 3000); };

  // Records the action in the Overview "Recent Activity" feed immediately (client-side, optimistic).
  // TODO: once endpoints below are live, replace this with the response from that POST call
  // so Recent Activity reflects the actual server-confirmed result instead of an optimistic entry.
  function logActivity(invoiceNum: string, label: string) {
    setActivityLog(prev => [{ id: crypto.randomUUID(), invoice_number: invoiceNum, label, timestamp: new Date().toISOString() }, ...prev].slice(0, 20));
  }

  // TODO: Wire each action to its n8n webhook via POST /api/link/:accessToken/billing/... (see endpoint list below)
  const simulateAction = (label: string, invoiceNum: string, cb?: () => void) => {
    setConfirm({ label, invoiceNum, onConfirm: () => { cb?.(); logActivity(invoiceNum, label); } });
  };

  const totalOutstanding = PR_INVOICES.filter(i => i.status !== "paid").reduce((s,i) => s + i.amount_due, 0);
  const recovered = PR_INVOICES.filter(i => i.status === "paid").reduce((s,i) => s + (i.recovered_amount ?? i.original_amount ?? 0), 0);
  const activeUnpaid = PR_INVOICES.filter(i => !["paid","manual_hold","failed"].includes(i.status)).length;
  const staffAttn = PR_INVOICES.filter(i => i.status === "staff_escalation_required").length;
  const remindersSent = PR_COMMS.filter(c => ["sent","delivered"].includes(c.status)).length;
  const failedCount = PR_COMMS.filter(c => c.status === "failed").length;

  const funnelStages = [
    { label:"New", count: PR_INVOICES.filter(i => i.status === "new").length },
    { label:"SMS 1 Sent", count: PR_INVOICES.filter(i => i.status === "sms_reminder_1_sent").length },
    { label:"Email 1 Sent", count: PR_INVOICES.filter(i => i.status === "email_reminder_1_sent").length },
    { label:"SMS 2 Sent", count: PR_INVOICES.filter(i => i.status === "sms_reminder_2_sent").length },
    { label:"Email 2 Sent", count: PR_INVOICES.filter(i => i.status === "email_reminder_2_sent").length },
    { label:"Staff Attention", count: PR_INVOICES.filter(i => i.status === "staff_escalation_required").length },
    { label:"Paid", count: PR_INVOICES.filter(i => i.status === "paid").length },
  ];

  const sortedFilteredInvoices = [...PR_INVOICES]
    .filter(i => {
      const matchesFilter =
        invoiceFilter === "unpaid" ? i.status !== "paid" :
        invoiceFilter === "paid" ? i.status === "paid" :
        invoiceFilter === "escalation" ? i.status === "staff_escalation_required" :
        invoiceFilter === "hold" ? i.status === "manual_hold" :
        invoiceFilter === "failed" ? i.status === "failed" :
        invoiceFilter === "missing_phone" ? !i.patient_phone :
        invoiceFilter === "missing_email" ? !i.patient_email : true;
      const matchesSearch = !search ||
        i.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
        i.patient_name.toLowerCase().includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortField === "amount_due") return dir * (a.amount_due - b.amount_due);
      if (sortField === "due_date") return dir * (a.due_date.localeCompare(b.due_date));
      if (sortField === "last_updated") return dir * (a.last_updated.localeCompare(b.last_updated));
      if (sortField === "next_reminder_at") return dir * ((a.next_reminder_at ?? "").localeCompare(b.next_reminder_at ?? ""));
      return 0;
    });

  const filteredTasks = PR_TASKS.filter(t => t.status === taskTab);

  const filteredComms = PR_COMMS.filter(c => {
    const matchesType =
      commFilter === "sms" ? c.channel === "sms" :
      commFilter === "email" ? c.channel === "email" :
      commFilter === "sent" ? c.status === "sent" :
      commFilter === "delivered" ? c.status === "delivered" :
      commFilter === "failed" ? c.status === "failed" : true;
    const ts = c.timestamp.slice(0, 10);
    const fromOk = !commDateFrom || ts >= commDateFrom;
    const toOk = !commDateTo || ts <= commDateTo;
    return matchesType && fromOk && toOk;
  });

  const attentionInvoices = PR_INVOICES.filter(i =>
    i.status === "staff_escalation_required" || i.status === "failed" ||
    !i.patient_phone || !i.patient_email
  );

  const tabs = [
    { id:"overview", label:"Overview" }, { id:"invoices", label:"Invoices" },
    { id:"followups", label:"Follow-Ups" }, { id:"communications", label:"Communications" },
    { id:"settings", label:"Settings" },
  ];

  const filterBtns = (opts: [string,string][], current: string, set: (v: string) => void) => (
    <div className="flex items-center gap-0.5 bg-muted border border-border rounded-md p-1 w-fit flex-shrink-0 flex-wrap">
      {opts.map(([v,l]) => (
        <button key={v} onClick={() => set(v)} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${current === v ? "bg-card shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
      ))}
    </div>
  );

  const SortTh = ({ field, label }: { field: typeof sortField; label: string }) => (
    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-foreground"
      onClick={() => { if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortField(field); setSortDir("asc"); } }}>
      <span className="flex items-center gap-1">{label}{sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</span>
    </th>
  );

  // Success toast
  const SuccessToast = successMsg ? (
    <div className="fixed bottom-4 right-4 z-50 bg-emerald-600 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2">
      <CheckCircle2 size={13} /> {successMsg}
    </div>
  ) : null;

  // Confirmation modal
  // TODO: On confirm, call POST /api/link/:accessToken/billing/invoices/:invoiceId/:action (see endpoint list)
  if (confirm) return (
    <>
      {SuccessToast}
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <Card className="p-6 max-w-sm w-full mx-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">{confirm.label}</h3>
          <p className="text-xs text-muted-foreground">This will update the automation for invoice <span className="font-mono font-medium">{confirm.invoiceNum}</span>.</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setConfirm(null)} className="text-xs border border-border px-3 py-1.5 rounded-md hover:bg-muted transition-colors">Cancel</button>
            <button onClick={() => { const cb = confirm.onConfirm; setConfirm(null); cb?.(); showSuccess(`${confirm.label} completed`); }} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:opacity-90">Confirm</button>
          </div>
        </Card>
      </div>
    </>
  );

  // Invoice detail
  if (detailInvoice) {
    const inv = detailInvoice;
    const timeline = PR_COMMS.filter(c => c.invoice_id === inv.invoice_id);
    const invTasks = PR_TASKS.filter(t => t.invoice_id === inv.invoice_id);
    return (
      <div className="p-6 space-y-5 overflow-y-auto h-full">
        {SuccessToast}
        <button onClick={() => setDetailInvoice(null)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft size={13} /> Back to Invoices
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-base font-semibold text-foreground">{inv.invoice_number}</h1>
            <p className="text-xs text-muted-foreground">{inv.patient_name} · ID: <span className="font-mono">{inv.invoice_id}</span></p>
          </div>
          <RecoveryBadge status={inv.status} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4 space-y-2.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Invoice Info</p>
            {([
              ["Invoice #", inv.invoice_number],
              ["Internal ID", inv.invoice_id],
              ["Patient", inv.patient_name],
              ["Phone", inv.patient_phone || "— Missing"],
              ["Email", inv.patient_email || "— Missing"],
              ["Original Amount", inv.original_amount != null ? fmtAmt(inv.original_amount) : "—"],
              ["Amount Due", fmtAmt(inv.amount_due)],
              ["Due Date", fmt(inv.due_date)],
              ["Last Juvonno Sync", fmt(inv.last_synced_at)],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs gap-2">
                <span className="text-muted-foreground shrink-0">{k}</span>
                <span className={`text-foreground font-medium truncate text-right ${v.startsWith("— Missing") ? "text-amber-600" : ""}`}>{v}</span>
              </div>
            ))}
          </Card>
          <Card className="p-4 space-y-2.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Automation</p>
            {([
              ["Status", STATUS_LABELS[inv.status]],
              ["Reminders", inv.status === "manual_hold" ? "Paused" : "Active"],
              ["Last Reminder", fmt(inv.last_reminder_at)],
              ["Next Reminder", fmt(inv.next_reminder_at)],
              ["Attempt Count", String(inv.attempt_count)],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{k}</span>
                <span className={`font-medium ${k === "Reminders" && v === "Paused" ? "text-amber-600" : "text-foreground"}`}>{v}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-border space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Scheduled Tasks</p>
              {invTasks.length === 0
                ? <p className="text-[10px] text-muted-foreground">No tasks found.</p>
                : invTasks.map(t => (
                    <div key={t.task_id} className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground font-mono">{t.reminder_type}</span>
                      <span className={`font-medium ${t.status === "failed" ? "text-red-600" : t.status === "completed" ? "text-emerald-600" : "text-foreground"}`}>{t.status} · {fmt(t.scheduled_time)}</span>
                    </div>
                  ))
              }
            </div>
          </Card>
          <Card className="p-4 space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Actions</p>
            {[
              { label:"Send SMS now", disabled:!inv.patient_phone, hint: !inv.patient_phone ? "No phone number" : "" },
              { label:"Send Email now", disabled:!inv.patient_email, hint: !inv.patient_email ? "No email address" : "" },
              { label: inv.status === "manual_hold" ? "Resume reminders" : "Pause reminders", disabled:false, hint:"" },
              { label:"Reschedule next reminder", disabled: inv.status === "paid", hint:"" },
              { label:"Reconcile with Juvonno", disabled:false, hint:"" },
              { label:"Escalate to staff", disabled: inv.status === "staff_escalation_required", hint:"" },
            ].map(a => (
              <div key={a.label}>
                <button disabled={a.disabled} onClick={() => simulateAction(a.label, inv.invoice_number)}
                  className="w-full text-left text-xs px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {a.label}
                </button>
                {a.hint && <p className="text-[10px] text-amber-600 pl-1 mt-0.5">{a.hint}</p>}
              </div>
            ))}
          </Card>
        </div>
        <Card className="p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recovery Timeline</p>
          {timeline.length === 0
            ? <p className="text-xs text-muted-foreground py-6 text-center">No communications yet.</p>
            : <div className="space-y-3">{timeline.map(c => (
                <div key={c.comm_id} className="flex items-start gap-3">
                  <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${c.status === "failed" ? "bg-red-100" : c.channel === "sms" ? "bg-blue-100" : "bg-violet-100"}`}>
                    {c.channel === "sms" ? <MessageSquare size={10} className={c.status === "failed" ? "text-red-600" : "text-blue-600"} /> : <Mail size={10} className="text-violet-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground capitalize">{c.channel} · {c.reminder_type ?? "reminder"}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${c.status === "delivered" ? "bg-emerald-100 text-emerald-700" : c.status === "sent" ? "bg-blue-100 text-blue-700" : c.status === "failed" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{c.status}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{fmt(c.timestamp)} · To: {c.recipient}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{c.message}</p>
                  </div>
                </div>
              ))}</div>
          }
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {SuccessToast}
      {/* Sub-tab nav */}
      <div className="border-b border-border px-6 flex items-center gap-0.5 bg-card flex-shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => {
            setActiveTab(t.id);
            setLoading(true); setError(false);
            setTimeout(() => setLoading(false), 600);
          }} className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <PRLoadingSkeleton />}
        {!loading && error && <PRErrorState onRetry={() => { setError(false); setLoading(true); setTimeout(() => setLoading(false), 600); }} />}
        {!loading && !error && <>

        {/* Overview */}
        {activeTab === "overview" && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div><h1 className="text-base font-semibold text-foreground">Payment Recovery</h1><p className="text-xs text-muted-foreground">Automated invoice follow-up overview</p></div>
              <button onClick={() => { showSuccess("Sync requested — Juvonno data will refresh shortly."); }} className="flex items-center gap-2 bg-muted border border-border text-xs font-medium px-3 py-2 rounded-md hover:bg-accent transition-colors"><RefreshCw size={12} /> Sync Juvonno</button>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              <KpiCard label="Total Outstanding" value={fmtAmt(totalOutstanding)} icon={TrendingUp} color="amber" />
              <KpiCard label="Recovered Revenue" value={fmtAmt(recovered)} icon={CheckCircle2} color="green" />
              <KpiCard label="Active Unpaid" value={String(activeUnpaid)} icon={FileText} color="indigo" />
              <KpiCard label="Staff Attention" value={String(staffAttn)} icon={AlertTriangle} color="amber" />
              <KpiCard label="Reminders Sent" value={String(remindersSent)} icon={Send} color="teal" />
              <KpiCard label="Failed Reminders" value={String(failedCount)} icon={XCircle} color="red" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-4">
                <p className="text-xs font-semibold text-foreground mb-4">Recovery Funnel</p>
                <div className="space-y-3">
                  {funnelStages.map(s => (
                    <div key={s.label} className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground w-28 shrink-0">{s.label}</span>
                      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width:`${PR_INVOICES.length ? (s.count / PR_INVOICES.length) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs font-mono text-foreground w-4 text-right">{s.count}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-foreground">Staff Attention Required</p>
                  <span className="text-[10px] text-muted-foreground">{attentionInvoices.length} invoice{attentionInvoices.length !== 1 ? "s" : ""}</span>
                </div>
                {attentionInvoices.length === 0
                  ? <p className="text-xs text-muted-foreground text-center py-6">No invoices require attention.</p>
                  : <div className="space-y-1">{attentionInvoices.map(inv => (
                      <div key={inv.invoice_id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div>
                          <p className="text-xs font-medium text-foreground">{inv.patient_name}</p>
                          <p className="text-[10px] text-muted-foreground">{inv.invoice_number} · {fmtAmt(inv.amount_due)}
                            {!inv.patient_phone && <span className="ml-1 text-amber-600">· No phone</span>}
                            {!inv.patient_email && <span className="ml-1 text-amber-600">· No email</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <RecoveryBadge status={inv.status} />
                          <button onClick={() => setDetailInvoice(inv)} className="text-[10px] text-primary hover:underline">View</button>
                        </div>
                      </div>
                    ))}</div>
                }
              </Card>
            </div>
            <Card className="p-4">
              <p className="text-xs font-semibold text-foreground mb-3">Recent Activity</p>
              {/* Merges system communications (SMS/email sends) with staff-triggered actions (send/pause/escalate/etc.) into one feed */}
              {(() => {
                const commEvents = PR_COMMS.map(c => ({
                  key: `comm_${c.comm_id}`, timestamp: c.timestamp, kind: "comm" as const, comm: c,
                }));
                const actionEvents = activityLog.map(a => ({
                  key: `act_${a.id}`, timestamp: a.timestamp, kind: "action" as const, action: a,
                }));
                const merged = [...commEvents, ...actionEvents].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 10);
                return merged.length === 0
                  ? <p className="text-xs text-muted-foreground text-center py-6">No recent activity.</p>
                  : <div className="space-y-0">
                      {merged.map(ev => ev.kind === "comm" ? (
                        <div key={ev.key} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${ev.comm.status === "failed" ? "bg-red-100" : ev.comm.channel === "sms" ? "bg-blue-100" : "bg-violet-100"}`}>
                            {ev.comm.channel === "sms" ? <MessageSquare size={10} className={ev.comm.status === "failed" ? "text-red-600" : "text-blue-600"} /> : <Mail size={10} className="text-violet-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground">
                              <span className="font-medium">{ev.comm.patient_name}</span> · {ev.comm.channel.toUpperCase()}{" "}
                              <span className={ev.comm.status === "failed" ? "text-red-600" : ev.comm.status === "delivered" ? "text-emerald-600" : "text-muted-foreground"}>{ev.comm.status}</span>
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate">{ev.comm.message}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">{fmt(ev.comm.timestamp)}</span>
                        </div>
                      ) : (
                        <div key={ev.key} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-100">
                            <ClipboardList size={10} className="text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground"><span className="font-medium">{ev.action.label}</span> · {ev.action.invoice_number}</p>
                            <p className="text-[10px] text-muted-foreground">Staff action</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">{fmt(ev.action.timestamp)}</span>
                        </div>
                      ))}
                    </div>;
              })()}
            </Card>
          </div>
        )}

        {/* Invoices */}
        {activeTab === "invoices" && (
          <div className="p-6 space-y-4">
            <h1 className="text-base font-semibold text-foreground">Invoices</h1>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative min-w-[180px] max-w-xs flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Invoice # or patient name…" className="w-full bg-muted border border-border rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              {filterBtns([
                ["all","All"],["unpaid","Unpaid"],["paid","Paid"],
                ["escalation","Staff Attn"],["hold","Paused"],["failed","Failed"],
                ["missing_phone","No Phone"],["missing_email","No Email"],
              ], invoiceFilter, setInvoiceFilter)}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[10px] text-muted-foreground">Sort:</span>
                <select value={sortField} onChange={e => setSortField(e.target.value as typeof sortField)} className="bg-muted border border-border rounded-md px-2 py-1 text-[10px] text-foreground focus:outline-none">
                  <option value="due_date">Due Date</option>
                  <option value="amount_due">Amount</option>
                  <option value="last_updated">Last Updated</option>
                  <option value="next_reminder_at">Next Reminder</option>
                </select>
                <button onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} className="text-[10px] bg-muted border border-border px-2 py-1 rounded-md hover:bg-accent">{sortDir === "asc" ? "↑ Asc" : "↓ Desc"}</button>
              </div>
            </div>
            {sortedFilteredInvoices.length === 0
              ? <Card className="p-10 text-center"><p className="text-sm font-medium text-foreground">No invoices found</p><p className="text-xs text-muted-foreground mt-1">Try adjusting your search or filter.</p></Card>
              : <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Invoice #</th>
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Patient</th>
                        <SortTh field="amount_due" label="Amount Due" />
                        <SortTh field="due_date" label="Due Date" />
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Status</th>
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Contact</th>
                        <SortTh field="last_updated" label="Last Reminder" />
                        <SortTh field="next_reminder_at" label="Next Reminder" />
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Actions</th>
                      </tr></thead>
                      <tbody>
                        {sortedFilteredInvoices.map(inv => (
                          <tr key={inv.invoice_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-mono font-medium text-foreground">{inv.invoice_number}</td>
                            <td className="px-4 py-3 text-foreground whitespace-nowrap">{inv.patient_name}</td>
                            <td className="px-4 py-3 font-mono">{fmtAmt(inv.amount_due)}</td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmt(inv.due_date)}</td>
                            <td className="px-4 py-3"><RecoveryBadge status={inv.status} /></td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-0.5">
                                <span className={`text-[10px] ${inv.patient_phone ? "text-emerald-600" : "text-amber-600"}`}>{inv.patient_phone ? "✓ Phone" : "✗ No phone"}</span>
                                <span className={`text-[10px] ${inv.patient_email ? "text-emerald-600" : "text-amber-600"}`}>{inv.patient_email ? "✓ Email" : "✗ No email"}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmt(inv.last_reminder_at)}</td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmt(inv.next_reminder_at)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button onClick={() => setDetailInvoice(inv)} className="text-[10px] font-medium text-primary hover:underline whitespace-nowrap">View</button>
                                <span className="text-border">·</span>
                                <button onClick={() => simulateAction("Send reminder now", inv.invoice_number)} className="text-[10px] text-muted-foreground hover:text-foreground">Send</button>
                                <span className="text-border">·</span>
                                <button onClick={() => simulateAction(inv.status === "manual_hold" ? "Resume reminders" : "Pause reminders", inv.invoice_number)} className="text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap">{inv.status === "manual_hold" ? "Resume" : "Pause"}</button>
                                <span className="text-border">·</span>
                                <button onClick={() => simulateAction("Escalate to staff", inv.invoice_number)} className="text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap">Escalate</button>
                                <span className="text-border">·</span>
                                <button onClick={() => simulateAction("Reconcile with Juvonno", inv.invoice_number)} className="text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap">Reconcile</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
            }
          </div>
        )}

        {/* Follow-Ups */}
        {activeTab === "followups" && (
          <div className="p-6 space-y-4">
            <h1 className="text-base font-semibold text-foreground">Follow-Ups</h1>
            {filterBtns([["pending","Pending"],["completed","Completed"],["cancelled","Cancelled"],["failed","Failed"]], taskTab, (v) => setTaskTab(v as typeof taskTab))}
            {filteredTasks.length === 0
              ? <Card className="p-10 text-center"><p className="text-sm font-medium text-foreground">No {taskTab} reminders</p><p className="text-xs text-muted-foreground mt-1">No reminder tasks in this category.</p></Card>
              : <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border bg-muted/50">
                        {["Task ID","Invoice #","Patient","Type","Scheduled","Status","Attempts","Notes","Actions"].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {filteredTasks.map(t => (
                          <tr key={t.task_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-mono text-muted-foreground text-[10px]">{t.task_id}</td>
                            <td className="px-4 py-3 font-mono font-medium text-foreground">{t.invoice_number}</td>
                            <td className="px-4 py-3 text-foreground whitespace-nowrap">{t.patient_name}</td>
                            <td className="px-4 py-3 font-mono text-muted-foreground text-[10px]">{t.reminder_type}</td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmt(t.scheduled_time)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${t.status === "completed" ? "bg-emerald-100 text-emerald-700" : t.status === "failed" ? "bg-red-100 text-red-700" : t.status === "cancelled" ? "bg-slate-100 text-slate-600" : "bg-blue-100 text-blue-700"}`}>{t.status}</span>
                            </td>
                            <td className="px-4 py-3 text-center font-mono">{t.attempt_count}</td>
                            <td className="px-4 py-3 text-muted-foreground">{t.failure_reason ?? "—"}</td>
                            <td className="px-4 py-3">
                              {t.status === "pending"
                                ? <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => simulateAction("Send now", t.invoice_number)} className="text-[10px] text-primary hover:underline">Send now</button>
                                    <span className="text-border">·</span>
                                    <button onClick={() => simulateAction("Reschedule task", t.invoice_number)} className="text-[10px] text-muted-foreground hover:text-foreground">Reschedule</button>
                                    <span className="text-border">·</span>
                                    <button onClick={() => simulateAction("Cancel task", t.invoice_number)} className="text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
                                    <span className="text-border">·</span>
                                    <button onClick={() => { const inv = PR_INVOICES.find(i => i.invoice_id === t.invoice_id); if (inv) setDetailInvoice(inv); }} className="text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap">Open invoice</button>
                                  </div>
                                : <div className="flex items-center gap-1.5">
                                    <button onClick={() => { const inv = PR_INVOICES.find(i => i.invoice_id === t.invoice_id); if (inv) setDetailInvoice(inv); }} className="text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap">Open invoice</button>
                                  </div>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
            }
          </div>
        )}

        {/* Communications */}
        {activeTab === "communications" && (
          <div className="p-6 space-y-4">
            <h1 className="text-base font-semibold text-foreground">Communications</h1>
            <div className="flex items-center gap-3 flex-wrap">
              {filterBtns([["all","All"],["sms","SMS"],["email","Email"],["sent","Sent"],["delivered","Delivered"],["failed","Failed"]], commFilter, setCommFilter)}
              <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                <label className="text-[10px] text-muted-foreground">From</label>
                <input type="date" value={commDateFrom} onChange={e => setCommDateFrom(e.target.value)} className="bg-muted border border-border rounded-md px-2 py-1 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                <label className="text-[10px] text-muted-foreground">To</label>
                <input type="date" value={commDateTo} onChange={e => setCommDateTo(e.target.value)} className="bg-muted border border-border rounded-md px-2 py-1 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                {(commDateFrom || commDateTo) && <button onClick={() => { setCommDateFrom(""); setCommDateTo(""); }} className="text-[10px] text-muted-foreground hover:text-foreground">Clear</button>}
              </div>
            </div>
            {filteredComms.length === 0
              ? <Card className="p-10 text-center"><p className="text-sm font-medium text-foreground">No communications found</p><p className="text-xs text-muted-foreground mt-1">Try adjusting your filter or date range.</p></Card>
              : <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border bg-muted/50">
                        {["Date","Invoice #","Patient","Channel","Recipient","Message Preview","Status"].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {filteredComms.map(c => (
                          <tr key={c.comm_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmt(c.timestamp)}</td>
                            <td className="px-4 py-3 font-mono font-medium text-foreground">{c.invoice_number}</td>
                            <td className="px-4 py-3 text-foreground whitespace-nowrap">{c.patient_name}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${c.channel === "sms" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"}`}>
                                {c.channel === "sms" ? <MessageSquare size={9} /> : <Mail size={9} />}{c.channel.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-muted-foreground">{c.recipient}</td>
                            <td className="px-4 py-3 text-muted-foreground max-w-[220px] truncate">{c.message}</td>
                            <td className="px-4 py-3">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${c.status === "delivered" ? "bg-emerald-100 text-emerald-700" : c.status === "sent" ? "bg-blue-100 text-blue-700" : c.status === "failed" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{c.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
            }
          </div>
        )}

        {/* Settings */}
        {activeTab === "settings" && (
          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-semibold text-foreground">Recovery Settings</h1>
              <div className="flex items-center gap-3">
                {saveMsg && <span className="text-xs text-emerald-600 font-medium">{saveMsg}</span>}
                <button onClick={() => { setSavingSettings(true); setTimeout(() => { setSavingSettings(false); setSaveMsg("Settings saved"); setTimeout(() => setSaveMsg(""), 3000); }, 800); }} disabled={savingSettings} className="bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50">
                  {savingSettings ? "Saving…" : "Save Settings"}
                </button>
              </div>
            </div>
            <Card className="p-5 space-y-4">
              <p className="text-xs font-semibold text-foreground">Automation Controls</p>
              <div className="space-y-3">
                {([
                  { key:"sms_enabled", label:"Enable SMS reminders" },
                  { key:"email_enabled", label:"Enable email reminders" },
                  { key:"all_paused", label:"Pause ALL reminders (global override)" },
                ] as const).map(({ key, label }) => (
                  <label key={key} className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-xs text-foreground">{label}</span>
                    <button type="button" onClick={() => setPrSettings(prev => ({ ...prev, [key]: !prev[key] }))}
                      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${prSettings[key] ? "bg-primary" : "bg-muted border border-border"}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${prSettings[key] ? "translate-x-4" : ""}`} />
                    </button>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border md:grid-cols-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Clinic Timezone</label>
                  <select value={prSettings.timezone} onChange={e => setPrSettings(s => ({ ...s, timezone:e.target.value }))} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>America/Toronto</option><option>America/Vancouver</option><option>America/New_York</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Send Window Start</label>
                  <input type="time" value={prSettings.send_start} onChange={e => setPrSettings(s => ({ ...s, send_start:e.target.value }))} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Send Window End</label>
                  <input type="time" value={prSettings.send_end} onChange={e => setPrSettings(s => ({ ...s, send_end:e.target.value }))} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Minimum Invoice Balance ($)</label>
                  <input type="number" min={0} value={prSettings.min_balance} onChange={e => setPrSettings(s => ({ ...s, min_balance:e.target.value }))} placeholder="0" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>
            </Card>
            <Card className="p-5 space-y-4">
              <p className="text-xs font-semibold text-foreground">Reminder Schedule</p>
              <p className="text-[10px] text-muted-foreground">Days between each reminder stage. Set 0 to send immediately when eligible.</p>
              {([
                { key:"sms1_delay" as const, label:"SMS Reminder 1", sub:"Days after invoice becomes eligible" },
                { key:"email1_delay" as const, label:"Email Reminder 1", sub:"Days after SMS 1" },
                { key:"sms2_delay" as const, label:"SMS Reminder 2", sub:"Days after Email 1" },
                { key:"email2_delay" as const, label:"Email Reminder 2", sub:"Days after SMS 2" },
                { key:"escalation_delay" as const, label:"Staff Escalation", sub:"Days after Email 2" },
              ]).map(({ key, label, sub }) => (
                <div key={key} className="flex items-center justify-between">
                  <div><p className="text-xs font-medium text-foreground">{label}</p><p className="text-[10px] text-muted-foreground">{sub}</p></div>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={30} value={schedule[key]} onChange={e => setSchedule(s => ({ ...s, [key]:parseInt(e.target.value)||0 }))} className="w-16 bg-input-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground text-center focus:outline-none focus:ring-1 focus:ring-ring" />
                    <span className="text-xs text-muted-foreground">days</span>
                  </div>
                </div>
              ))}
            </Card>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-foreground">Message Templates</p>
              {(["sms_1","email_1_subject","email_1_body","sms_2","email_2_subject","email_2_body"] as const).map(field => {
                const labelMap: Record<string, string> = { sms_1:"SMS Reminder 1", email_1_subject:"Email Reminder 1 — Subject", email_1_body:"Email Reminder 1 — Body", sms_2:"SMS Reminder 2", email_2_subject:"Email Reminder 2 — Subject", email_2_body:"Email Reminder 2 — Body" };
                const isSMS = field === "sms_1" || field === "sms_2";
                const val = templates[field];
                const preview = val
                  .replace("{{patient_first_name}}","Sarah")
                  .replace("{{invoice_number}}","INV-1001")
                  .replace("{{amount_due}}","$285.00")
                  .replace("{{due_date}}","Jun 15")
                  .replace("{{payment_link}}","[pay.clinic.ca/inv-1001]")
                  .replace("{{clinic_phone}}","(604) 555-0100");
                return (
                  <Card key={field} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-foreground">{labelMap[field]}</p>
                      {isSMS && <span className={`text-[10px] font-mono ${val.length > 160 ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{val.length} / 160 chars</span>}
                    </div>
                    <textarea value={val} onChange={e => setTemplates(prev => ({ ...prev, [field]:e.target.value }))} rows={isSMS ? 3 : 5} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
                    <div className="flex flex-wrap gap-1.5">
                      {VARS.map(v => <button key={v} type="button" onClick={() => setTemplates(prev => ({ ...prev, [field]:prev[field]+v }))} className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded font-mono hover:bg-accent transition-colors">{v}</button>)}
                    </div>
                    <div className="space-y-1.5 pt-1 border-t border-border">
                      <p className="text-[10px] font-medium text-muted-foreground">Preview:</p>
                      <p className="text-[10px] text-foreground bg-muted rounded-md p-2 whitespace-pre-wrap font-mono leading-relaxed">{preview}</p>
                      <button type="button" onClick={() => setTemplates(prev => ({ ...prev, [field]:DEFAULT_TEMPLATES[field] }))} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">Restore default</button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        </>}
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
const SCREENS: Record<string, React.FC> = {
  "overview": OverviewScreen,
  "call-logs": InboundCallLogsScreen,
  "transcripts": InboundTranscriptsScreen,
  "recordings": InboundRecordingsScreen,
  "analytics": InboundAnalyticsScreen,
  "staff-queue": StaffQueueScreen,
  "settings": SettingsScreen,
  "outbound-call-logs": OutboundCallLogsScreen,
  "outbound-transcripts": OutboundTranscriptsScreen,
  "outbound-recordings": OutboundRecordingsScreen,
  "outbound-analytics": OutboundAnalyticsScreen,
  "payment-recovery": PaymentRecoveryScreen,
  "billing": BillingScreen,
};

function getTokenFromURL(): string | null {
  const match = window.location.pathname.match(/^\/t\/([^/]+)/);
  return match ? match[1] : null;
}

export default function App() {
  const [activeNav, setActiveNav] = useState("overview");
  const [accessToken] = useState<string | null>(getTokenFromURL);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [staffTasks, setStaffTasks] = useState<StaffTask[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsPoint[]>([]);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [outboundOverview, setOutboundOverview] = useState<OverviewStats | null>(null);
  const [invoices, setInvoices] = useState<UsageInvoice[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/link/${accessToken}/tenant`).then(r => r.ok ? r.json() : null),
      fetch(`/api/link/${accessToken}/queue/requests`).then(r => r.ok ? r.json() : []),
      fetch(`/api/link/${accessToken}/settings`).then(r => r.ok ? r.json() : {}),
      fetch(`/api/link/${accessToken}/inbound/calls`).then(r => r.ok ? r.json() : { calls: [] }),
      fetch(`/api/link/${accessToken}/inbound/transcripts`).then(r => r.ok ? r.json() : { transcripts: [] }),
      fetch(`/api/link/${accessToken}/inbound/analytics`).then(r => r.ok ? r.json() : []),
      fetch(`/api/link/${accessToken}/inbound/overview`).then(r => r.ok ? r.json() : null),
      fetch(`/api/link/${accessToken}/inbound/invoices`).then(r => r.ok ? r.json() : { invoices: [] }),
      // No outbound tracker exists yet, so this 404s/502s until one is wired
      // up - that's expected, and just leaves outboundOverview null.
      fetch(`/api/link/${accessToken}/outbound/overview`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([tenant, requests, savedSettings, callsRes, transcriptsRes, analyticsRes, overviewRes, invoicesRes, outboundOverviewRes]) => {
        setTenantInfo(tenant);
        setStaffTasks(requests);
        setSettings(savedSettings ?? {});
        setCallLogs(Array.isArray(callsRes?.calls) ? callsRes.calls.map(mapInboundCall) : []);
        setTranscripts(Array.isArray(transcriptsRes?.transcripts) ? transcriptsRes.transcripts.map(mapInboundTranscript) : []);
        setAnalytics(Array.isArray(analyticsRes) ? analyticsRes : []);
        setOverview(overviewRes && !overviewRes.error ? overviewRes : null);
        setInvoices(Array.isArray(invoicesRes?.invoices) ? invoicesRes.invoices : []);
        setOutboundOverview(outboundOverviewRes && !outboundOverviewRes.error ? outboundOverviewRes : null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessToken]);

  // Staff Action Queue needs new requests to show up without a manual
  // refresh, so poll it quietly in the background (no loading spinner).
  useEffect(() => {
    if (!accessToken) return;
    const interval = setInterval(() => {
      fetch(`/api/link/${accessToken}/queue/requests`)
        .then(r => r.ok ? r.json() : null)
        .then(requests => { if (requests) setStaffTasks(requests); })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(interval);
  }, [accessToken]);

  // Inbound Tracker data (calls/transcripts/analytics/overview/invoices)
  // should reflect new calls without a manual refresh too - poll it quietly
  // in the background, same pattern as the Staff Action Queue above.
  useEffect(() => {
    if (!accessToken) return;
    const interval = setInterval(() => {
      Promise.all([
        fetch(`/api/link/${accessToken}/inbound/calls`).then(r => r.ok ? r.json() : null),
        fetch(`/api/link/${accessToken}/inbound/transcripts`).then(r => r.ok ? r.json() : null),
        fetch(`/api/link/${accessToken}/inbound/analytics`).then(r => r.ok ? r.json() : null),
        fetch(`/api/link/${accessToken}/inbound/overview`).then(r => r.ok ? r.json() : null),
        fetch(`/api/link/${accessToken}/inbound/invoices`).then(r => r.ok ? r.json() : null),
        fetch(`/api/link/${accessToken}/outbound/overview`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
        .then(([callsRes, transcriptsRes, analyticsRes, overviewRes, invoicesRes, outboundOverviewRes]) => {
          if (Array.isArray(callsRes?.calls)) setCallLogs(callsRes.calls.map(mapInboundCall));
          if (Array.isArray(transcriptsRes?.transcripts)) setTranscripts(transcriptsRes.transcripts.map(mapInboundTranscript));
          if (Array.isArray(analyticsRes)) setAnalytics(analyticsRes);
          if (overviewRes && !overviewRes.error) setOverview(overviewRes);
          if (Array.isArray(invoicesRes?.invoices)) setInvoices(invoicesRes.invoices);
          if (outboundOverviewRes && !outboundOverviewRes.error) setOutboundOverview(outboundOverviewRes);
        })
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [accessToken]);

  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  async function refreshOverview() {
    if (!accessToken) return;
    setOverviewRefreshing(true);
    try {
      const [res, outboundRes] = await Promise.all([
        fetch(`/api/link/${accessToken}/inbound/overview`),
        fetch(`/api/link/${accessToken}/outbound/overview`).catch(() => null),
      ]);
      const data = res.ok ? await res.json() : null;
      setOverview(data && !data.error ? data : null);
      const outboundData = outboundRes && outboundRes.ok ? await outboundRes.json() : null;
      setOutboundOverview(outboundData && !outboundData.error ? outboundData : null);
    } catch {
      // keep whatever was last loaded
    } finally {
      setOverviewRefreshing(false);
    }
  }

  async function updateTaskStatus(id: string, status: string) {
    if (!accessToken) return;
    const res = await fetch(`/api/link/${accessToken}/queue/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated: StaffTask = await res.json();
      setStaffTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    }
  }

  async function deleteTask(id: string) {
    if (!accessToken) return;
    const res = await fetch(`/api/link/${accessToken}/queue/requests/${id}`, { method: 'DELETE' });
    if (res.ok) setStaffTasks(prev => prev.filter(t => t.id !== id));
  }

  async function saveSection(section: string, data: Record<string, unknown>): Promise<boolean> {
    if (!accessToken) return false;
    try {
      const res = await fetch(`/api/link/${accessToken}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, data }),
      });
      if (!res.ok) return false;
      const updated: Record<string, unknown> = await res.json();
      // The response echoes the server's FULL settings, but responses from
      // different sections' saves can arrive out of order (e.g. this save
      // and an unrelated section's save fired close together). Only trust
      // this response for the section we actually just saved - otherwise a
      // slightly-stale response for another section can silently overwrite
      // newer local data for a section it never touched.
      setSettings(prev => ({ ...prev, [section]: updated[section] }));
      return true;
    } catch {
      return false;
    }
  }

  async function saveBulk(sections: Record<string, unknown>) {
    if (!accessToken) return;
    const res = await fetch(`/api/link/${accessToken}/settings/bulk`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections }),
    });
    if (!res.ok) return;
    const updated: Record<string, unknown> = await res.json();
    // Same out-of-order-response protection as saveSection: only trust this
    // response for the sections actually included in this bulk save.
    setSettings(prev => {
      const next = { ...prev };
      for (const key of Object.keys(sections)) next[key] = updated[key];
      return next;
    });
  }

  async function syncRetell(): Promise<{ ok: boolean; error?: string }> {
    if (!accessToken) return { ok: false, error: 'No access token' };
    const res = await fetch(`/api/link/${accessToken}/settings/retell-sync`, { method: 'POST' });
    const json = await res.json();
    return res.ok ? { ok: true } : { ok: false, error: json.error ?? 'Sync failed' };
  }

  const Screen = SCREENS[activeNav] ?? OverviewScreen;

  if (!accessToken) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Lock size={20} className="text-muted-foreground" />
          </div>
          <h1 className="text-sm font-semibold text-foreground">No dashboard link</h1>
          <p className="text-xs text-muted-foreground max-w-xs">Open this dashboard using your unique link, e.g. <span className="font-mono">/t/your-token</span></p>
        </div>
      </div>
    );
  }

  return (
    <DashboardContext.Provider value={{ accessToken, tenantInfo, staffTasks, callLogs, transcripts, analytics, overview, outboundOverview, overviewRefreshing, refreshOverview, invoices, loading, settings, updateTaskStatus, deleteTask, saveSection, saveBulk, syncRetell }}>
      <div
        className="flex h-screen w-screen overflow-hidden bg-background"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        <Sidebar active={activeNav} onNav={setActiveNav} />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-muted-foreground">Loading…</p>
              </div>
            ) : (
              <Screen />
            )}
          </main>
        </div>
      </div>
    </DashboardContext.Provider>
  );
}
