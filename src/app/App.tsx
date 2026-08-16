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
  ToggleRight, ChevronLeft, PhoneOutgoing, LogOut
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, LabelList
} from "recharts";

// ── Palette helpers ──────────────────────────────────────────────────────────
// Healthcare-appropriate teal/white palette. `PURPLE` keeps its name (renaming
// would touch every chart/KpiCard call site) but is now a clinical blue used
// as the second series color alongside TEAL, matching --chart-2 in theme.css.
const TEAL = "#0D9488";
const PURPLE = "#2563EB";
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
  phone?: string;
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
//
// For outbound, the updated "Juvonno Outbound Tracker - Contact Logging"
// n8n workflow now reads the real destination number and contact name off
// Retell's call_analyzed webhook itself (to_number / metadata / dynamic
// variables) and writes contact_first_name / contact_last_name /
// contact_name / to_number straight into the Call Log and Transcripts
// sheets - so the dashboard just displays those fields directly. This
// replaces the old CSV-order-guessing workaround (localStorage FIFO queue),
// which is no longer needed now that n8n reports the correct contact per
// call.
function outboundContactName(raw: Record<string, unknown>): string {
  const full = String(raw.contact_name ?? "").trim();
  if (full) return full;
  const first = String(raw.contact_first_name ?? "").trim();
  const last = String(raw.contact_last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ");
  return combined || "Unknown";
}

function mapInboundCall(raw: Record<string, unknown>, direction: "inbound" | "outbound" = "inbound"): CallLog {
  return {
    id: String(raw.call_id ?? raw.id ?? crypto.randomUUID()),
    time: String(raw.timestamp ?? raw.date ?? ""),
    caller: direction === "outbound" ? outboundContactName(raw) : String(raw.callerName ?? raw.from ?? "Unknown"),
    phone: direction === "outbound"
      ? String(raw.to_number ?? raw.to ?? raw.phone ?? raw.phoneNumber ?? "")
      : String(raw.from ?? raw.to ?? raw.phone ?? raw.phoneNumber ?? ""),
    outcome: String(raw.status ?? ""),
    sentiment: String(raw.sentiment ?? ""),
    duration: String(raw.durationDisplay ?? raw.duration_display ?? ""),
    staffAction: false,
    direction,
    recordingUrl: String(raw.recordingUrl ?? raw.recording_url ?? ""),
    summary: String(raw.summary ?? ""),
  };
}

function mapInboundTranscript(raw: Record<string, unknown>, direction: "inbound" | "outbound" = "inbound"): Transcript {
  return {
    id: String(raw.call_id ?? raw.id ?? crypto.randomUUID()),
    time: String(raw.timestamp ?? raw.date ?? ""),
    caller: direction === "outbound" ? outboundContactName(raw) : String(raw.callerName ?? "Unknown"),
    phone: direction === "outbound"
      ? String(raw.to_number ?? raw.to ?? raw.phone ?? raw.phoneNumber ?? "")
      : String(raw.from ?? raw.to ?? raw.phone ?? raw.phoneNumber ?? ""),
    outcome: String(raw.status ?? ""),
    sentiment: String(raw.sentiment ?? ""),
    duration: String(raw.durationDisplay ?? raw.duration_display ?? ""),
    preview: String(raw.summary ?? ""),
    direction,
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

// Connection status fields live at the TOP LEVEL of the production public
// settings response (clinic_configs columns), separate from the nested
// `settings` JSONB sections (clinic_profile/clinic_hours/etc.) - captured
// here specifically for the Production Readiness checklist (§12), since
// nothing else in the app reads Juvonno/Retell connection state today.
interface ConnectionStatus {
  hasJuvonnoApiKey: boolean;
  juvonnoBaseUrl: string;
  defaultBranchCode: string;
  retellReceptionistAgentId: string;
  retellReceptionistPhoneNumber: string;
  retellOutboundAgentId: string;
  retellOutboundPhoneNumber: string;
  retellRecoveryAgentId: string;
  retellRecoveryPhoneNumber: string;
  // IANA identifier (e.g. "America/Toronto") straight from clinic_configs -
  // NOT the same as the "America/Toronto (EST/EDT)" display string the
  // Clinic Profile timezone dropdown stores, which Intl can't use directly.
  // This is the one source of truth for rendering appointment times, so a
  // 9:00 AM appointment never shows as 10:00 AM just because a staff
  // member's browser is in a different zone than the clinic (FRONTEND-
  // POLISH-REVIEW-2026-08-12.md P0#2).
  timezone: string;
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
  connectionStatus: ConnectionStatus | null;
  loadError: string | null;
  approveTask: (id: string) => Promise<{ success: boolean; response?: string; errorCode?: string }>;
  rejectTask: (id: string, resolutionCode?: string, resolutionNote?: string) => Promise<boolean>;
  assignTask: (id: string, assignedUserId: string) => Promise<boolean>;
  archiveTask: (id: string, resolutionNote?: string) => Promise<boolean>;
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
  connectionStatus: null,
  loadError: null,
  approveTask: async () => ({ success: false }),
  rejectTask: async () => false,
  assignTask: async () => false,
  archiveTask: async () => false,
  saveSection: async () => false,
  saveBulk: async () => {},
  syncRetell: async () => ({ ok: false }),
});

function useDashboard() { return useContext(DashboardContext); }

// ── Production session auth (RivaCare handoff §5) ───────────────────────────
// Legacy /t/:token links bypass this entirely (see AppGate below) - a
// tenant/clinic-verified server session is the new path; the old
// access-token link is left alone as-is.
interface ClinicOption { clinicId: string; clinicName: string; role: string }
interface AuthSession { userId: string; tenantId: string; activeClinicId: string | null; clinics: ClinicOption[]; csrfToken: string }

interface AuthCtx {
  session: AuthSession | null;
  authLoading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchClinic: (clinicId: string) => Promise<{ ok: boolean; error?: string }>;
}

const AuthContext = createContext<AuthCtx>({
  session: null,
  authLoading: true,
  login: async () => ({ ok: false }),
  logout: async () => {},
  switchClinic: async () => ({ ok: false }),
});
function useAuth() { return useContext(AuthContext); }

// One request helper for both identity modes: legacy access-token links hit
// /api/link/:token/<suffix> with no cookie/CSRF machinery; a real session
// hits /api/dashboard/<suffix> with the session cookie + CSRF header on
// mutations. Every route suffix (inbound/*, outbound/*, settings, recovery/*,
// queue/*) is intentionally identical between the two backends, so callers
// don't need to know which mode they're in.
async function apiFetch(accessToken: string | null, csrfToken: string | undefined, suffix: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  const fetchInit: RequestInit = { method, signal: init.signal };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchInit.body = JSON.stringify(init.body);
  }
  if (accessToken) {
    fetchInit.headers = headers;
    return fetch(`/api/link/${accessToken}${suffix}`, fetchInit);
  }
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  fetchInit.headers = headers;
  fetchInit.credentials = "include";
  return fetch(`/api/dashboard${suffix}`, fetchInit);
}

// A non-ok response and an empty-but-successful response mean completely
// different things ("something's broken" vs. "there's nothing here yet"),
// but plain `r.ok ? r.json() : <empty fallback>` collapses them into the
// same UI state. This preserves the distinction so callers can show a real
// error instead of silently rendering an empty/zeroed screen.
async function safeJson(res: Response): Promise<{ ok: boolean; status: number; json: any }> {
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

// One human-readable message per failure category (handoff §5's
// 401/403/502-504/network split), so a failed fetch never gets presented as
// "this clinic just has no data".
function describeLoadFailure(status: number): string {
  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 403) return "You don't have access to this clinic's data.";
  if (status === 404) return "Some dashboard data could not be found.";
  if (status >= 500 || status === 0) return "The integration is temporarily unavailable. Some data may be missing.";
  return "Some dashboard data could not be loaded.";
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include" });
        if (!res.ok) { if (!cancelled) setSession(null); return; }
        const data = await res.json();
        // /api/auth/session doesn't reissue a CSRF token (only login and
        // active-clinic do) - the existing cookie is still valid, so a stale
        // in-memory csrfToken from a prior login this page load is fine;
        // a full reload with no prior login just has no CSRF token until
        // the next login/switch-clinic response provides one.
        if (!cancelled) setSession(prev => ({ userId: data.userId, tenantId: data.tenantId, activeClinicId: data.activeClinicId ?? null, clinics: Array.isArray(data.clinics) ? data.clinics : [], csrfToken: prev?.csrfToken ?? "" }));
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function login(username: string, password: string) {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message ?? "Invalid username or password." };
      setSession({ userId: data.userId, tenantId: data.tenantId, activeClinicId: data.activeClinicId ?? null, clinics: Array.isArray(data.clinics) ? data.clinics : [], csrfToken: data.csrfToken });
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reach the server." };
    }
  }

  async function logout() {
    if (session) {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers: { "X-CSRF-Token": session.csrfToken } }).catch(() => {});
    }
    setSession(null);
  }

  async function switchClinic(clinicId: string) {
    if (!session) return { ok: false, error: "Not signed in." };
    try {
      const res = await fetch("/api/session/active-clinic", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
        body: JSON.stringify({ clinicId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error?.message ?? "You do not have access to this clinic." };
      setSession(prev => (prev ? { ...prev, activeClinicId: data.activeClinicId, csrfToken: data.csrfToken } : prev));
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reach the server." };
    }
  }

  return <AuthContext.Provider value={{ session, authLoading, login, logout, switchClinic }}>{children}</AuthContext.Provider>;
}

function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setError("");
    setSubmitting(true);
    const result = await login(username, password);
    setSubmitting(false);
    if (!result.ok) setError(result.error ?? "Sign in failed.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-lg shadow-sm p-6 space-y-5">
        <div>
          <h1 className="text-lg font-semibold bg-gradient-to-r from-teal-600 to-cyan-500 bg-clip-text text-transparent">RivaCare Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-1">Sign in to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-foreground">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              className="w-full mt-1 bg-input-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mt-1 bg-input-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !username || !password}
            className="w-full bg-gradient-to-r from-teal-600 to-cyan-500 text-white text-sm font-medium py-2 rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

// Clinic switcher shown in the top bar under session auth. Nothing is
// rendered in legacy access-token mode (a link is already scoped to one
// clinic, there's nothing to switch between).
function ClinicSwitcher() {
  const { session, switchClinic } = useAuth();
  const [switching, setSwitching] = useState(false);
  if (!session || session.clinics.length === 0) return null;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const clinicId = e.target.value;
    if (clinicId === session!.activeClinicId) return;
    setSwitching(true);
    const result = await switchClinic(clinicId);
    setSwitching(false);
    if (result.ok) window.location.reload();
  }

  return (
    <select
      value={session.activeClinicId ?? ""}
      onChange={handleChange}
      disabled={switching}
      className="bg-muted border border-border rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
    >
      {session.clinics.map((c) => (
        <option key={c.clinicId} value={c.clinicId}>{c.clinicName}</option>
      ))}
    </select>
  );
}

// ── Small reusable UI ─────────────────────────────────────────────────────────
function Badge({ label, variant }: { label: string; variant: string }) {
  const map: Record<string, string> = {
    Booked: "bg-emerald-100 text-emerald-700",
    Transferred: "bg-teal-100 text-teal-700",
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
    "In Progress": "bg-teal-100 text-teal-700",
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
    purple: "bg-blue-50 text-blue-600",
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

// Reusable confirmation dialog for any destructive/state-changing action
// (Approve/Reject/Archive in Staff Queue, Approve/Reject in Payment
// Recovery's queue). `children` lets a caller embed extra inline inputs
// (e.g. a rejection-reason field) between the body text and the buttons.
function ConfirmModal({ title, body, confirmLabel = "Confirm", danger, busy, onConfirm, onCancel, children }: {
  title: string; body: string; confirmLabel?: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <Card className="p-6 max-w-sm w-full mx-4 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{body}</p>
        {children}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy} className="text-xs border border-border px-3 py-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`text-xs px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50 ${danger ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </Card>
    </div>
  );
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
  { id: "activity", label: "Activity", icon: Bell, group: "Inbound" },
  { id: "settings", label: "Settings", icon: Settings, group: "Inbound" },

  { id: "outbound-make-call", label: "Make a Call", icon: PhoneOutgoing, group: "Outbound" },
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
          <div className="w-7 h-7 rounded-md bg-teal-600 flex items-center justify-center">
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
                    ? "bg-teal-600/20 text-white font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
                }`}
              >
                <Icon size={15} className={active === id ? "text-teal-400" : ""} />
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
          <div className="w-7 h-7 rounded-full bg-teal-700 flex items-center justify-center text-xs text-white font-semibold">
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
  const { session, logout } = useAuth();
  return (
    <div className="h-14 bg-card border-b border-border flex items-center px-6 gap-4 flex-shrink-0">
      {session ? (
        <ClinicSwitcher />
      ) : (
        <div className="flex items-center gap-2 bg-muted border border-border rounded-md px-3 py-1.5 min-w-[160px] cursor-pointer hover:bg-accent transition-colors">
          <Building2 size={13} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{tenantInfo?.clinic_name ?? "—"}</span>
          <ChevronDown size={12} className="text-muted-foreground ml-auto" />
        </div>
      )}
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
        {session && (
          <button onClick={logout} title="Sign out" className="p-2 rounded-md hover:bg-muted transition-colors">
            <LogOut size={15} className="text-muted-foreground" />
          </button>
        )}
        <button className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-xs text-white font-semibold">{tenantInfo ? initials(tenantInfo.receptionist_name) : "—"}</button>
      </div>
    </div>
  );
}

// ── Screen: Overview ─────────────────────────────────────────────────────────
// One KPI row (Minutes Used / Total Calls / Overage Cost / Avg Call Duration)
// reused for both Inbound and Outbound, so adding outbound didn't mean
// duplicating four cards' worth of JSX with a different variable name.
// n8n overview responses can legitimately have some numeric fields missing
// (partial data, an intermediate error shape, etc.) even when the object
// itself isn't null - `undefined.toFixed()` throws, so every numeric field
// read from one of these responses must be coerced through this first.
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function OverviewKpiRow({ stats, direction }: { stats: OverviewStats | null; direction: "inbound" | "outbound" }) {
  // Total Calls is deliberately NOT read from stats.totalCalls: the n8n
  // overview webhook scopes that count to the billing period, while the
  // Analytics screen scopes its count to the selected chart range - two
  // different windows that will legitimately disagree. Counting the actual
  // fetched callLogs instead means this card always agrees with whatever
  // the Call Logs / Analytics screens show for the same call records.
  const { callLogs } = useDashboard();
  const totalCalls = callLogs.filter(c => (c.direction ?? "inbound") === direction).length;
  const minutesUsed = num(stats?.minutesUsed);
  const minutesIncluded = num(stats?.minutesIncluded);
  const overageUSD = num(stats?.overageUSD);
  const overageMinutes = num(stats?.overageMinutes);
  const pct = minutesIncluded > 0 ? Math.min(100, (minutesUsed / minutesIncluded) * 100) : 0;
  return (
    <div className="grid grid-cols-4 gap-4">
      <KpiCard label="Minutes Used" value={stats ? `${minutesUsed.toFixed(2)} / ${minutesIncluded}` : "—"} sub={stats ? `${pct.toFixed(2)}% of plan` : "—"} icon={Clock} color="amber" />
      <KpiCard label="Total Calls" value={stats ? String(totalCalls) : "—"} sub={stats?.billingPeriod ?? "—"} icon={PhoneCall} color="purple" />
      <KpiCard label="Overage Cost" value={stats ? `$${overageUSD.toFixed(2)}` : "—"} sub={stats ? `${overageMinutes} min over` : "—"} icon={CreditCard} color={overageMinutes > 0 ? "red" : "green"} />
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
  const { overview, outboundOverview, overviewRefreshing, refreshOverview, loadError } = useDashboard();
  // A dash means "nothing here" everywhere on this screen - that's only true
  // when the load actually succeeded and came back empty. If it failed, every
  // dash below is really "unknown", not "zero" (FRONTEND-POLISH-REVIEW-
  // 2026-08-12.md P1#6), so surface the real reason instead of letting staff
  // read a failed integration as an idle clinic.
  const noData = !overview && !outboundOverview;

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

      {noData && (
        <div className={`text-xs rounded-md px-3 py-2.5 flex items-center justify-between ${loadError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
          <span>{loadError ? `Could not load usage data — ${loadError}` : "No usage recorded yet for this clinic."}</span>
          {loadError && <button onClick={refreshOverview} className="font-medium hover:underline flex-shrink-0 ml-3">Retry</button>}
        </div>
      )}

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
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /> Inbound — {overview ? `${num(overview.minutesUsed).toFixed(2)} / ${num(overview.minutesIncluded)}` : "—"} min</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-teal-500" /> Outbound — {outboundOverview ? `${num(outboundOverview.minutesUsed).toFixed(2)} / ${num(outboundOverview.minutesIncluded)}` : "—"} min</span>
        </div>
      </Card>

      <OverviewKpiRow stats={overview} direction="inbound" />
      <OverviewKpiRow stats={outboundOverview} direction="outbound" />

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
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-600 to-cyan-500 flex items-center justify-center text-white font-bold text-lg">G</div>
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
                  <div className="w-8 h-8 rounded-full bg-teal-100 border-2 border-teal-400 flex items-center justify-center text-[10px] font-bold text-teal-700">{i + 1}</div>
                  <span className="text-[10px] text-center text-foreground whitespace-nowrap w-20">{step}</span>
                </div>
                {i < flowSteps.length - 1 && <div className="w-8 h-0.5 bg-teal-200 flex-shrink-0 mb-4" />}
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
                {["Date/Time", direction === "outbound" ? "Contact" : "Caller", "Phone", "Outcome", "Sentiment", "Duration", ""].map(h => (
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
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${line.speaker === "Caller" ? "bg-slate-200 text-slate-600" : "bg-teal-100 text-teal-700"}`}>
                            {line.speaker[0]}
                          </div>
                          <div className={`max-w-md ${line.speaker === "Caller" ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                            <span className="text-[10px] text-muted-foreground">{line.speaker}</span>
                            <div className={`text-xs px-3 py-2 rounded-lg ${line.speaker === "Caller" ? "bg-muted text-foreground" : "bg-teal-100 text-teal-900"}`}>
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
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${selected?.id === t.id ? "border-primary/50 bg-teal-50" : "border-border bg-card hover:bg-muted/40"}`}
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
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${line.speaker === "Caller" ? "bg-slate-200 text-slate-600" : "bg-teal-100 text-teal-700"}`}>
                    {line.speaker[0]}
                  </div>
                  <div className={`max-w-md ${line.speaker === "Caller" ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                    <span className="text-[10px] text-muted-foreground">{line.speaker}</span>
                    <div className={`text-xs px-3 py-2 rounded-lg ${line.speaker === "Caller" ? "bg-muted text-foreground" : "bg-teal-100 text-teal-900"}`}>
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
  // Each direction is wired to its own real n8n tracker workflow's analytics
  // webhook (inbound/analytics or outbound/analytics), each with its own
  // range selector (matching Build Analytics Response's range param). They
  // are genuinely separate Google Sheets, so the numbers won't match.
  const { accessToken } = useDashboard();
  const { session } = useAuth();
  const [range, setRange] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const [data, setData] = useState<AnalyticsPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accessToken && !session) { setData([]); return; }
    setLoading(true);
    apiFetch(accessToken, session?.csrfToken, `/${direction}/analytics?range=${range}`)
      .then(r => r.ok ? r.json() : [])
      .then(res => setData(Array.isArray(res) ? res : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [accessToken, session, direction, range, refreshTick]);

  const totalCalls = data.reduce((sum, p) => sum + p.calls, 0);
  const totalMinutes = data.reduce((sum, p) => sum + p.minutes, 0);
  const completedCalls = data.reduce((sum, p) => sum + p.completed, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold bg-gradient-to-r from-teal-600 to-cyan-500 bg-clip-text text-transparent">
            {direction === "outbound" ? "Outbound Analytics" : "Inbound Analytics"}
          </h1>
          <p className="text-xs text-muted-foreground">{direction === "outbound" ? "Outbound call volume and trends over time." : "Inbound call volume and trends over time."}</p>
        </div>
        <button
          onClick={() => setRefreshTick(t => t + 1)}
          disabled={loading}
          className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-cyan-500 text-white text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
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
            className="text-xs font-medium border border-border rounded-md px-2.5 py-1.5 bg-card disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {ANALYTICS_RANGE_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </div>

        {data.length === 0 ? (
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
        <KpiCard label="Total Calls (Range)" value={data.length ? String(totalCalls) : "—"} icon={PhoneCall} color="purple" />
        <KpiCard label="Total Minutes (Range)" value={data.length ? `${totalMinutes.toFixed(1)}m` : "—"} icon={Clock} color="teal" />
        <KpiCard label="Completed Calls" value={data.length ? String(completedCalls) : "—"} icon={CheckCircle2} color="green" />
      </div>
    </div>
  );
}

function InboundAnalyticsScreen() { return <AnalyticsScreen direction="inbound" />; }
function OutboundAnalyticsScreen() { return <AnalyticsScreen direction="outbound" />; }

// ── Screen: Make a Call ───────────────────────────────────────────────────────
interface CsvContact { phoneNumber: string; firstName: string; lastName: string; row: number; valid: boolean; reason?: string; }

const REQUIRED_CSV_HEADERS = "phone_number, patient_first_name, patient_last_name";

// Same E.164 check the n8n workflow itself enforces - validating here first
// means a bad CSV gets caught before the batch call ever fires, not after.
function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

function csvSplit(line: string): string[] {
  return line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
}

// Header-name aware, not positional - matches by column NAME (aliasing the
// n8n workflow's own accepted field names) so column order in the CSV
// doesn't matter, only that phone/first/last name columns exist somewhere.
function parseContactsCsv(text: string): CsvContact[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headerCols = csvSplit(lines[0]).map(h => h.toLowerCase().replace(/[\s_]+/g, ""));
  const findCol = (...aliases: string[]) => headerCols.findIndex(h => aliases.includes(h));
  const phoneIdx = findCol("phonenumber", "phone", "number");
  const firstIdx = findCol("patientfirstname", "firstname", "first");
  const lastIdx = findCol("patientlastname", "lastname", "last");
  const hasHeader = phoneIdx !== -1 || firstIdx !== -1 || lastIdx !== -1;
  const rows = hasHeader ? lines.slice(1) : lines;

  return rows.map((line, i) => {
    const cols = csvSplit(line);
    const phoneNumber = (hasHeader && phoneIdx !== -1 ? cols[phoneIdx] : cols[0] ?? "").replace(/[\s().-]/g, "");
    const firstName = (hasHeader && firstIdx !== -1 ? cols[firstIdx] : cols[1]) ?? "";
    const lastName = (hasHeader && lastIdx !== -1 ? cols[lastIdx] : cols[2]) ?? "";
    const row = i + 1;
    if (!phoneNumber) return { phoneNumber, firstName, lastName, row, valid: false, reason: "Missing phone number" };
    if (!isE164(phoneNumber)) return { phoneNumber, firstName, lastName, row, valid: false, reason: "Not E.164 (e.g. +14165551234)" };
    return { phoneNumber, firstName, lastName, row, valid: true };
  });
}

function MakeCallScreen() {
  const { accessToken } = useDashboard();
  const [contacts, setContacts] = useState<CsvContact[]>([]);
  const [fileName, setFileName] = useState("");
  const [batchName, setBatchName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validContacts = contacts.filter(c => c.valid);
  const invalidContacts = contacts.filter(c => !c.valid);

  function reset() {
    setContacts([]);
    setFileName("");
    setBatchName("");
    setResult(null);
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setContacts(parseContactsCsv(String(reader.result ?? "")));
    reader.readAsText(file);
  }

  async function startBatchCall() {
    if (!accessToken || validContacts.length === 0) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/link/${accessToken}/outbound/make-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: batchName || undefined,
          // Matches the outbound tracker's recipient contract: E.164
          // phone_number plus first/last/full name as Retell dynamic
          // variables. clinic_id/client_id are added server-side from the
          // authenticated tenant, not trusted from the browser.
          contacts: validContacts.map(c => ({
            phone_number: c.phoneNumber.trim(),
            first_name: c.firstName.trim(),
            last_name: c.lastName.trim(),
            full_name: [c.firstName.trim(), c.lastName.trim()].filter(Boolean).join(" "),
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success !== false) {
        setResult({ ok: true, message: `Batch call started for ${validContacts.length} contact${validContacts.length === 1 ? "" : "s"}.` });
        setContacts([]);
        setFileName("");
      } else {
        setResult({ ok: false, message: json.error || "Failed to start batch call." });
      }
    } catch {
      setResult({ ok: false, message: "Could not reach the outbound workflow. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold bg-gradient-to-r from-teal-600 to-cyan-500 bg-clip-text text-transparent">Make a Call</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Upload a contact list and launch an outbound campaign via Retell AI.</p>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-cyan-500 text-white text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-gradient-to-r from-teal-600 to-cyan-500">
        Outbound
      </span>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Contacts Ready" value={String(validContacts.length)} sub="Valid rows from CSV" icon={PhoneOutgoing} color="teal" />
        <KpiCard label="Rows With Issues" value={String(invalidContacts.length)} sub="Need cleanup before submission" icon={FileText} color={invalidContacts.length > 0 ? "amber" : "purple"} />
        <Card className="p-4 flex flex-col gap-1.5">
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Retell Status</span>
            <span className="p-1.5 rounded-md bg-teal-50 text-teal-600"><Zap size={14} /></span>
          </div>
          <p className="text-lg font-semibold text-foreground">Ready</p>
          <span className="inline-flex items-center w-fit text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 mt-0.5">n8n → Retell AI</span>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 items-start">
        <Card className="p-5 space-y-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">CSV Upload</p>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
            className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center gap-2 text-center cursor-pointer hover:bg-muted/30 transition-colors"
          >
            <UploadCloud size={22} className="text-muted-foreground/50" />
            <p className="text-sm font-semibold text-foreground">{fileName || "Drop CSV here or browse"}</p>
            <p className="text-[10px] text-muted-foreground">Required headers: {REQUIRED_CSV_HEADERS}</p>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Batch Name (optional)</label>
            <input value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="e.g. Reminder calls - July" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Validation</p>
            {contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-md p-3">Upload a CSV to validate contacts.</p>
            ) : (
              <div className="flex items-center gap-3 text-xs bg-muted/40 border border-border rounded-md p-3">
                <span className="flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 size={12} /> {validContacts.length} valid</span>
                {invalidContacts.length > 0 && (
                  <span className="flex items-center gap-1 text-destructive font-medium"><AlertTriangle size={12} /> {invalidContacts.length} invalid</span>
                )}
              </div>
            )}
          </div>

          {result && (
            <p className={`text-xs rounded-md p-3 border ${result.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-destructive"}`}>
              {result.message}
            </p>
          )}

          <button
            type="button"
            onClick={startBatchCall}
            disabled={submitting || validContacts.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2.5 rounded-md hover:opacity-90 disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground transition-colors"
          >
            <PhoneOutgoing size={13} />
            {submitting ? "Starting batch call…" : validContacts.length === 0 ? "Upload contacts first" : `Start Batch Call (${validContacts.length})`}
          </button>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Contact Preview</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Valid contacts from the uploaded CSV</p>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">{validContacts.length} contact{validContacts.length === 1 ? "" : "s"}</span>
          </div>
          {validContacts.length === 0 ? (
            <p className="text-xs text-muted-foreground py-14 text-center">No valid contacts to preview yet.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 sticky top-0">
                    {["Phone Number", "First Name", "Last Name", "Row"].map(h => (
                      <th key={h} className="text-left px-4 py-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {validContacts.map((c) => (
                    <tr key={c.row} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 font-mono text-foreground">{c.phoneNumber}</td>
                      <td className="px-4 py-2 text-foreground">{c.firstName || "—"}</td>
                      <td className="px-4 py-2 text-foreground">{c.lastName || "—"}</td>
                      <td className="px-4 py-2 font-mono text-muted-foreground">{c.row}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

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
            violet: "bg-teal-50 text-teal-600 border-teal-200",
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
// The AI Receptionist's "APPOINTMENT REQUESTS AUDIT READY" workflow only
// ever inserts cancellation requests into `requests` now (bookings/lookups/
// reschedules go to the separate appointment_events audit stream instead,
// per FRONTEND-BFF-HANDOFF.md - they don't need staff action, so they don't
// land here). Rows come back from GET /api/dashboard/queue/requests shaped
// like the Postgres row (id/status/priority/data JSONB), not the old flat
// dashboard_payload shape - this flattens it into the existing StaffTask
// fields so the rest of this screen's rendering code didn't need a rewrite.
const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "Pending", in_progress: "In Progress", completed: "Completed",
  failed: "Failed", rejected: "Rejected", archived: "Archived",
};

function mapAppointmentRequest(row: Record<string, unknown>): StaffTask {
  const data = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : {};
  const patient = data.patient && typeof data.patient === "object" ? data.patient as Record<string, unknown> : {};
  const appointment = data.appointment && typeof data.appointment === "object" ? data.appointment as Record<string, unknown> : {};
  const rawStatus = String(row.status ?? "pending");
  return {
    id: String(row.id),
    status: REQUEST_STATUS_LABEL[rawStatus] ?? rawStatus,
    raw_status: rawStatus,
    type: "Cancellation Request",
    patient: safeText(patient.display_name) || [safeText(patient.first_name), safeText(patient.last_name)].filter(Boolean).join(" ") || "Unknown",
    patient_phone: safeText(patient.phone),
    phone: safeText(patient.phone),
    summary: safeText(data.reason),
    due: safeText(appointment.starts_at),
    created_at: safeText(row.created_at),
    priority: safeText(row.priority),
    assignee: safeText(row.assigned_user_id),
    appointment_id: safeText(appointment.id) || safeText(row.juvonno_appointment_id),
    practitioner_name: safeText(appointment.practitioner_name),
    duration_minutes: appointment.duration_minutes,
    requires_staff_action: row.requires_staff_action,
  };
}

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
  Pending: "bg-blue-50 border-blue-100",
  "In Progress": "bg-teal-50 border-teal-100",
  Completed: "bg-emerald-50 border-emerald-100",
  Rejected: "bg-slate-50 border-slate-200",
  Failed: "bg-red-50 border-red-100",
  Archived: "bg-slate-50 border-slate-200",
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

function clinicTimezoneAbbrev(timezone: string, date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(date).find(p => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

// For APPOINTMENT times specifically (never for "when did this event happen"
// timestamps). Defaults to America/Toronto when no clinic timezone is known
// yet (RivaCare Frontend Appointment-Time Fix, 2026-08-13).
//
// Deliberately reads the Y-M-D/H:M digits straight out of the string instead
// of doing real offset-aware date math: appointment 5867 was confirmed by
// Juvonno/the AI receptionist for 10:00 AM, the provider returned
// "...T10:00:00-05:00", and re-rendering that through real America/Toronto
// DST math (-04:00 in August) shifted it to 11:00 AM. The attached offset is
// evidently sometimes wrong/stale on the provider side (a proper fix belongs
// in a BFF normalization step that returns a canonical UTC instant instead),
// but until that lands, trusting the literal wall-clock numbers the provider
// wrote is the only way to guarantee the dashboard shows the same hour
// Juvonno and the caller actually agreed on.
function formatClinicTime(value: unknown, timezone?: string | null): string {
  const text = safeText(value);
  if (!text) return "";
  const tz = timezone || "America/Toronto";
  const naive = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (naive) {
    const [, y, mo, d, h, mi] = naive;
    const localDate = new Date(Number(y), Number(mo) - 1, Number(d));
    const weekday = localDate.toLocaleDateString(undefined, { weekday: "short" });
    const monthDay = localDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const hour24 = Number(h);
    const hour12 = hour24 % 12 || 12;
    const ampm = hour24 < 12 ? "AM" : "PM";
    const abbrev = clinicTimezoneAbbrev(tz, localDate);
    return `${weekday}, ${monthDay}, ${hour12}:${mi} ${ampm}${abbrev ? ` ${abbrev}` : ""}`;
  }
  const date = new Date(text);
  if (isNaN(date.getTime())) return text;
  try {
    const formatted = date.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz,
    });
    const abbrev = clinicTimezoneAbbrev(tz, date);
    return abbrev ? `${formatted} ${abbrev}` : formatted;
  } catch {
    return formatDateTime(value);
  }
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

// Pending/In Progress/Failed are exact statuses; History groups every
// resolved terminal state (Completed + Rejected) into one tab - archived
// rows never appear here at all once archived (the n8n list query excludes
// archived_at IS NOT NULL unconditionally), so History isn't "everything",
// it's "resolved but not yet archived".
const STAFF_QUEUE_TABS: { id: string; label: string; match: (t: StaffTask) => boolean }[] = [
  { id: "pending", label: "Pending", match: (t) => t.status === "Pending" },
  { id: "in_progress", label: "In Progress", match: (t) => t.status === "In Progress" },
  { id: "failed", label: "Failed", match: (t) => t.status === "Failed" },
  { id: "history", label: "History", match: (t) => t.status === "Completed" || t.status === "Rejected" },
];

function StaffQueueScreen() {
  const { staffTasks, approveTask, rejectTask, assignTask, archiveTask, connectionStatus } = useDashboard();
  const clinicTimezone = connectionStatus?.timezone || null;
  const { session } = useAuth();
  const [tab, setTab] = useState("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingModal, setPendingModal] = useState<{ type: "approve" | "reject" | "archive"; id: string } | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; error?: boolean; code?: string } | null>(null);
  // DOB/gender are sensitive - require an explicit click to reveal them each
  // time a different request is opened, rather than showing them by default.
  const [revealSensitiveId, setRevealSensitiveId] = useState<string | null>(null);

  async function confirmPendingAction() {
    if (!pendingModal) return;
    const { type, id } = pendingModal;
    setActionBusy(true);
    if (type === "approve") {
      const result = await approveTask(id);
      // Never claim success without provider_confirmed (approveTask's own
      // three-field gate already enforces this) - a safety refusal like
      // CANCELLATION_STRATEGY_NOT_VALIDATED still comes back as a normal
      // response, so the copy has to be unambiguous that Juvonno was NOT
      // touched (FRONTEND-POLISH-REVIEW-2026-08-12.md P1#5).
      setActionMessage({
        text: result.success
          ? (result.response || "Cancellation confirmed in Juvonno.")
          : (result.response || "The appointment is still active in Juvonno. The cancellation was not confirmed."),
        error: !result.success,
        code: result.success ? undefined : result.errorCode,
      });
    } else if (type === "reject") {
      const ok = await rejectTask(id, "staff_rejected", rejectNote || undefined);
      setActionMessage({ text: ok ? "Request rejected." : "Could not reject the request.", error: !ok });
    } else {
      const ok = await archiveTask(id);
      setActionMessage({ text: ok ? "Request archived." : "Could not archive the request.", error: !ok });
      if (ok && selectedId === id) setSelectedId(null);
    }
    setActionBusy(false);
    setPendingModal(null);
    setRejectNote("");
  }

  async function handleAssignToMe(id: string) {
    if (!session?.userId) return;
    setActionBusy(true);
    const ok = await assignTask(id, session.userId);
    setActionBusy(false);
    setActionMessage({ text: ok ? "Assigned to you." : "Could not assign the request.", error: !ok });
  }

  const visibleTasks = staffTasks.filter(STAFF_QUEUE_TABS.find(t => t.id === tab)?.match ?? (() => true));
  const sortedTasks = [...visibleTasks].sort((a, b) => new Date(safeText(b.created_at)).getTime() - new Date(safeText(a.created_at)).getTime());
  const selectedTask = staffTasks.find(t => t.id === selectedId) ?? null;

  useEffect(() => {
    setActionMessage(null);
  }, [selectedId]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Staff Action Queue</h1>
        <p className="text-xs text-muted-foreground">{staffTasks.filter(t => t.status === "Pending").length} pending cancellation requests</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {STAFF_QUEUE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium ${tab === t.id ? "bg-primary text-white border-primary" : "border-border hover:bg-muted"}`}
          >
            {t.label} <span className="opacity-70">({staffTasks.filter(t.match).length})</span>
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
                        <div className="w-5 h-5 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-[9px] font-bold flex-shrink-0">{patientName(task).charAt(0)}</div>
                        <span className="font-medium text-foreground">{patientName(task)}</span>
                        {flags && <Badge label={flags.isFirstTimePatient ? "New Patient" : "Existing Patient"} variant={flags.isFirstTimePatient ? "New" : "Neutral"} />}
                        {flags?.visitType && <Badge label={flags.isFirstTimeVisit ? "Initial Visit" : "Follow-up"} variant={flags.isFirstTimeVisit ? "In Progress" : "Neutral"} />}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{safeText(task.phone) || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatClinicTime(task.due, clinicTimezone) || "—"}</td>
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
                <div className="w-10 h-10 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-bold flex-shrink-0">{patientName(selectedTask).charAt(0)}</div>
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
                  <p className="text-xs font-medium text-foreground">{formatClinicTime(selectedTask.due, clinicTimezone) || "—"}</p>
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

            <div className="border-t border-border px-5 py-4 space-y-3">
              {actionMessage && (
                <div className={`text-xs rounded-md px-3 py-2 ${actionMessage.error ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-700"}`}>
                  <p>{actionMessage.text}</p>
                  {actionMessage.code && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] font-medium opacity-80 hover:opacity-100">Technical details</summary>
                      <p className="mt-1 font-mono text-[10px] opacity-80">{actionMessage.code}</p>
                    </details>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {selectedTask.status === "Pending" && (
                  <>
                    <button
                      disabled={actionBusy}
                      onClick={() => setPendingModal({ type: "approve", id: selectedTask.id })}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md bg-emerald-600 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      <Check size={12} /> Approve Cancellation
                    </button>
                    <button
                      disabled={actionBusy}
                      onClick={() => setPendingModal({ type: "reject", id: selectedTask.id })}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      <X size={12} /> Reject
                    </button>
                    <button
                      disabled={actionBusy}
                      onClick={() => handleAssignToMe(selectedTask.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      <User size={12} /> Assign to Me
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPendingModal({ type: "archive", id: selectedTask.id })}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border text-muted-foreground hover:text-destructive hover:bg-muted transition-colors ml-auto"
                >
                  <Trash2 size={12} /> Archive
                </button>
              </div>
            </div>
          </div>
        </>
        );
      })()}

      {pendingModal && pendingModal.type === "approve" && (
        <ConfirmModal
          title="Approve this cancellation?"
          body="This will cancel the appointment in Juvonno. The patient will not be notified automatically by this action."
          confirmLabel="Approve"
          busy={actionBusy}
          onConfirm={confirmPendingAction}
          onCancel={() => setPendingModal(null)}
        />
      )}
      {pendingModal && pendingModal.type === "reject" && (
        <ConfirmModal
          title="Reject this cancellation request?"
          body="The appointment stays active. This just clears the request from the staff queue."
          confirmLabel="Reject"
          danger
          busy={actionBusy}
          onConfirm={confirmPendingAction}
          onCancel={() => setPendingModal(null)}
        >
          <input
            autoFocus
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Reason for rejecting (optional)"
            className="w-full text-xs border border-border rounded-md px-2.5 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </ConfirmModal>
      )}
      {pendingModal && pendingModal.type === "archive" && (
        <ConfirmModal
          title="Archive this request?"
          body="This removes it from the active queue. It stays available for audit history but won't show up here again."
          confirmLabel="Archive"
          danger
          busy={actionBusy}
          onConfirm={confirmPendingAction}
          onCancel={() => setPendingModal(null)}
        />
      )}

    </div>
  );
}

// ── Screen: Activity ─────────────────────────────────────────────────────────
// Append-only notification/audit stream (appointment_events) - a separate
// source from the Staff Action Queue above. Only cancellation_requested and
// change_failed events have any staff-actionable follow-up; everything else
// is informational (FRONTEND-BFF-HANDOFF.md).
interface ActivityEvent {
  id: string;
  event_type: string;
  status: string;
  request_id?: string | null;
  juvonno_appointment_id?: string | null;
  patient_external_id?: string | null;
  retell_call_id?: string | null;
  previous_start_at?: string | null;
  new_start_at?: string | null;
  duration_minutes?: number | null;
  actor_type?: string | null;
  provider?: string | null;
  error_code?: string | null;
  data?: Record<string, unknown> | null;
  created_at: string;
  completed_at?: string | null;
}

const ACTIVITY_EVENT_LABEL: Record<string, string> = {
  booking_created: "Appointment Booked",
  appointment_lookup: "Appointment Looked Up",
  cancellation_requested: "Cancellation Requested",
  cancellation_rejected: "Cancellation Rejected",
  reschedule_attempted: "Reschedule Started",
  rescheduled: "Appointment Rescheduled",
  cancellation_completed: "Appointment Cancelled",
  change_failed: "Appointment Action Failed",
};
const ACTIVITY_EVENT_TYPES = Object.keys(ACTIVITY_EVENT_LABEL);
const ACTIVITY_NEEDS_ACTION = new Set(["cancellation_requested", "change_failed"]);
const ACTIVITY_BADGE_VARIANT: Record<string, string> = {
  booking_created: "Completed",
  appointment_lookup: "Neutral",
  cancellation_requested: "Staff Action",
  cancellation_rejected: "Neutral",
  reschedule_attempted: "In Progress",
  rescheduled: "Completed",
  cancellation_completed: "Completed",
  change_failed: "Failed",
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

// Patient identity fallback order per FRONTEND-POLISH-REVIEW-2026-08-12.md
// P1#3: data.patient_name (lookup/booking events) -> data.patient.display_name
// (cancellation events, same nested shape mapAppointmentRequest reads) ->
// the external chart ID -> the provider appointment ID -> nothing. Chart/
// appointment IDs are shown as a secondary line whenever a real name is
// available, so staff aren't left staring at a bare number.
function activityPatientLabel(event: ActivityEvent): { primary: string; secondary: string } {
  const data = event.data ?? {};
  const patientObj = data.patient && typeof data.patient === "object" ? data.patient as Record<string, unknown> : {};
  const primary = safeText(data.patient_name) || safeText(patientObj.display_name) || safeText(event.patient_external_id) || safeText(event.juvonno_appointment_id) || "—";
  const idParts: string[] = [];
  if (event.patient_external_id) idParts.push(`Chart ${event.patient_external_id}`);
  if (event.juvonno_appointment_id) idParts.push(`Appointment ${event.juvonno_appointment_id}`);
  return { primary, secondary: idParts.join(" · ") };
}

// cancellation_requested rows are always status "completed" in Postgres -
// that's the audit WRITE succeeding, not the cancellation itself happening.
// Showing "Completed" next to a "Needs Action" badge reads as "already
// handled", so this event type gets its own delivery-vs-workflow label split
// (FRONTEND-POLISH-REVIEW-2026-08-12.md P1#4) instead of the raw DB status.
function activityStatusLabel(event: ActivityEvent): string {
  if (event.event_type === "cancellation_requested") return "Recorded";
  return event.status ? event.status[0].toUpperCase() + event.status.slice(1) : event.status;
}

function ActivityScreen() {
  const { accessToken, connectionStatus, staffTasks } = useDashboard();
  const clinicTimezone = connectionStatus?.timezone || null;
  const { session } = useAuth();
  const identityReady = Boolean(accessToken) || Boolean(session);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const hasLoadedOnce = useRef(false);

  async function loadEvents(isBackground: boolean, signal?: AbortSignal) {
    if (!identityReady) return;
    if (!isBackground) { setLoading(!hasLoadedOnce.current); setError(false); }
    const params = new URLSearchParams();
    if (eventTypeFilter) params.set("eventType", eventTypeFilter);
    if (statusFilter) params.set("status", statusFilter);
    params.set("limit", "50");
    try {
      const res = await apiFetch(accessToken, session?.csrfToken, `/activity?${params.toString()}`, { signal });
      if (!res.ok) throw new Error("failed");
      const json = await res.json().catch(() => []);
      setEvents(Array.isArray(json) ? json : []);
      hasLoadedOnce.current = true;
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      if (!hasLoadedOnce.current) setError(true);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    if (!identityReady) return;
    const controller = new AbortController();
    loadEvents(false, controller.signal);
    return () => controller.abort();
  }, [identityReady, accessToken, eventTypeFilter, statusFilter]);

  // First page only, every 25s while visible - never load full history on a
  // poll tick (FRONTEND-BFF-HANDOFF.md).
  useEffect(() => {
    if (!identityReady) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadEvents(true);
    }, 25000);
    return () => clearInterval(interval);
  }, [identityReady, accessToken, eventTypeFilter, statusFilter]);

  useEffect(() => {
    if (!selectedId) { setSelectedEvent(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    apiFetch(accessToken, session?.csrfToken, `/activity/${selectedId}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (!cancelled) setSelectedEvent(json?.event ?? null); })
      .catch(() => { if (!cancelled) setSelectedEvent(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Activity</h1>
          <p className="text-xs text-muted-foreground">Bookings, lookups, reschedules, and cancellations across the AI receptionist.</p>
        </div>
        <button onClick={() => loadEvents(false)} className="flex items-center gap-2 text-xs font-medium border border-border px-3 py-1.5 rounded-md hover:bg-muted transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="flex items-center gap-2">
        <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)} className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-card">
          <option value="">All event types</option>
          {ACTIVITY_EVENT_TYPES.map(t => <option key={t} value={t}>{ACTIVITY_EVENT_LABEL[t]}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-card">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {loading ? (
        <div className="p-10 text-center text-xs text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="p-10 text-center text-xs text-muted-foreground">
          Could not load activity. <button onClick={() => loadEvents(false)} className="text-primary hover:underline">Try again</button>
        </div>
      ) : (
        <Card className="overflow-hidden">
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-10 text-center">No activity yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {["Event", "Status", "Patient / Appointment", "When", ""].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const patient = activityPatientLabel(event);
                  return (
                  <tr
                    key={event.id}
                    onClick={() => setSelectedId(event.id)}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 text-foreground">
                      <div className="flex items-center gap-2">
                        {ACTIVITY_EVENT_LABEL[event.event_type] ?? event.event_type}
                        {ACTIVITY_NEEDS_ACTION.has(event.event_type) && <Badge label="Needs Action" variant="Staff Action" />}
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge label={activityStatusLabel(event)} variant={ACTIVITY_BADGE_VARIANT[event.event_type] ?? "Neutral"} /></td>
                    <td className="px-4 py-3 text-foreground">
                      <p className="font-medium">{patient.primary}</p>
                      {patient.secondary && <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{patient.secondary}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(event.created_at)}</td>
                    <td className="px-4 py-3 text-muted-foreground"><ChevronRight size={14} /></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {selectedId && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelectedId(null)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-card border-l border-border shadow-xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <span className="text-sm font-semibold text-foreground">
                {selectedEvent ? (ACTIVITY_EVENT_LABEL[selectedEvent.event_type] ?? selectedEvent.event_type) : "Event"}
              </span>
              <button onClick={() => setSelectedId(null)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-xs">
              {detailLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : !selectedEvent ? (
                <p className="text-muted-foreground">Could not load this event.</p>
              ) : (
                <>
                  {(() => {
                    const patient = activityPatientLabel(selectedEvent);
                    return (
                      <div>
                        <p className="text-sm font-semibold text-foreground">{patient.primary}</p>
                        {patient.secondary && <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{patient.secondary}</p>}
                      </div>
                    );
                  })()}
                  <div className="rounded-md border border-border divide-y divide-border">
                    <DetailRow label="Event Delivery" value={<Badge label={activityStatusLabel(selectedEvent)} variant={ACTIVITY_BADGE_VARIANT[selectedEvent.event_type] ?? "Neutral"} />} />
                    {selectedEvent.request_id && (() => {
                      const linked = staffTasks.find(t => t.id === selectedEvent.request_id);
                      return <DetailRow label="Request State" value={linked ? <Badge label={linked.status} variant={linked.status} /> : selectedEvent.request_id} />;
                    })()}
                    {selectedEvent.juvonno_appointment_id && <DetailRow label="Appointment ID" value={selectedEvent.juvonno_appointment_id} />}
                    {selectedEvent.patient_external_id && <DetailRow label="Patient ID" value={selectedEvent.patient_external_id} />}
                    {selectedEvent.duration_minutes != null && <DetailRow label="Duration" value={`${selectedEvent.duration_minutes} min`} />}
                    {selectedEvent.previous_start_at && <DetailRow label="Previous Time" value={formatClinicTime(selectedEvent.previous_start_at, clinicTimezone)} />}
                    {selectedEvent.new_start_at && <DetailRow label="New Time" value={formatClinicTime(selectedEvent.new_start_at, clinicTimezone)} />}
                    {selectedEvent.provider && <DetailRow label="Provider" value={selectedEvent.provider} />}
                    {selectedEvent.error_code && <DetailRow label="Error" value={selectedEvent.error_code} />}
                    <DetailRow label="Created" value={formatDateTime(selectedEvent.created_at)} />
                    {selectedEvent.completed_at && <DetailRow label="Completed" value={formatDateTime(selectedEvent.completed_at)} />}
                  </div>
                  {ACTIVITY_NEEDS_ACTION.has(selectedEvent.event_type) && (
                    <p className="text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                      {selectedEvent.event_type === "cancellation_requested"
                        ? "The appointment is still active in Juvonno. This has a linked request in the Staff Action Queue awaiting approval."
                        : "This action failed and needs manual reconciliation. The appointment was not changed."}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
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
              {["Date/Time", direction === "outbound" ? "Contact" : "Caller", "Service", "Outcome", "Sentiment", "Duration", "Consent", "Retention", ""].map(h => (
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
// service_id/product_id/schedule_type_id are the Juvonno booking identifiers
// n8n needs to create a correct appointment (FRONTEND-DEVELOPER-HANDOFF-
// BOOKING-HARDENING.md §1) - kept per practitioner+service, never merged into
// one clinic-wide value, since two practitioners can offer the "same"
// service under different Juvonno service/product/schedule-type IDs.
interface AppointmentType { id: string; service_name: string; keywords: string; service_id: string; product_id: string; schedule_type_id: string; duration_categories: DurationCategory[]; }
interface Practitioner { id: string; name: string; keywords: string; staff_num: string; appointment_types: AppointmentType[]; }
interface FAQ { id: string; question: string; answer: string; category?: string; }

const FAQ_CATEGORIES = [
  "Appointments", "Services", "Pricing and Insurance", "Clinic Policies",
  "Location and Parking", "Accessibility", "Preparation and Aftercare", "General",
];

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
  const { tenantInfo, settings, connectionStatus, saveSection } = useDashboard();
  const { session } = useAuth();
  // Only an owner is plausibly able to go confirm these directly (clinic_configs,
  // user_clinic_access, the sandbox-validated cancellation strategy - none of
  // which any clinic-level role can see from this dashboard). Everyone else
  // gets told who to contact instead of a "Confirm manually" that implies
  // they have somewhere to go check (FRONTEND-POLISH-REVIEW-2026-08-12.md P1#7).
  const currentClinicRole = session?.clinics.find(c => c.clinicId === session.activeClinicId)?.role ?? null;
  const canConfirmManually = currentClinicRole === "owner";
  const [activeSection, setActiveSection] = useState("Overview");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ section: string; ok: boolean } | null>(null);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [faqSearch, setFaqSearch] = useState("");
  const [faqCategoryFilter, setFaqCategoryFilter] = useState("All");
  // Practitioner cards default to collapsed summaries so the section doesn't
  // read as one long expanded form - expanding one is purely a UI toggle,
  // it doesn't affect what's in `practitioners` or what gets saved.
  const [expandedPractitionerId, setExpandedPractitionerId] = useState<string | null>(null);
  // Which appointment types have their "Juvonno booking identifiers"
  // advanced section open - collapsed by default since most staff never
  // need to touch these (BOOKING-HARDENING.md §2).
  const [expandedIdentifierIds, setExpandedIdentifierIds] = useState<Set<string>>(new Set());
  function toggleIdentifiers(typeId: string) {
    setExpandedIdentifierIds(prev => {
      const next = new Set(prev);
      next.has(typeId) ? next.delete(typeId) : next.add(typeId);
      return next;
    });
  }
  // Purely a visual step tab (matches the 3-step reference design) - steps 2
  // and 3 both reveal the same Services block since service + duration data
  // live together in one appointment_type, not two separate saved sections.
  const [practitionerStep, setPractitionerStep] = useState<Record<string, number>>({});
  // One textarea ref per SMS template key, so variable pills can insert at
  // the current cursor position instead of always appending to the end.
  const smsTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  function insertSmsVariable(key: string, fallback: string, token: string) {
    const el = smsTextareaRefs.current[key];
    const current = draft.sms_follow_ups[`${key}_message`] ?? fallback;
    if (!el) {
      setField('sms_follow_ups', `${key}_message`, current + token);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setField('sms_follow_ups', `${key}_message`, next);
    setTimeout(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    }, 0);
  }
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
    // Practitioners saved before the Juvonno-identifier fields existed won't
    // have service_id/product_id/schedule_type_id in their stored JSON -
    // default those to "" rather than leaving them undefined, which would
    // otherwise make the identifier <input>s below start as uncontrolled.
    if (savedP && savedP.length > 0) {
      setPractitioners(savedP.map(p => ({
        ...p,
        appointment_types: (p.appointment_types ?? []).map(t => ({
          service_id: "", product_id: "", schedule_type_id: "", ...t,
        })),
      })));
    }
    const savedF = (settings.faqs as { list?: FAQ[] })?.list;
    if (savedF && savedF.length > 0) setFaqs(savedF);
  }, [settings]);

  function setField(section: DraftKey, key: string, value: string) {
    setDraft(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
  }

  const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  // Batch actions write into the exact same open_/start_/end_<Day> keys the
  // day rows already use - no new fields, just fewer clicks to set them.
  function copyDayToDays(sourceDay: string, targetDays: string[]) {
    setDraft(prev => {
      const hours = { ...prev.clinic_hours };
      const openVal = hours[`open_${sourceDay}`] ?? "true";
      const startVal = hours[`start_${sourceDay}`] ?? "";
      const endVal = hours[`end_${sourceDay}`] ?? "";
      for (const day of targetDays) {
        hours[`open_${day}`] = openVal;
        hours[`start_${day}`] = startVal;
        hours[`end_${day}`] = endVal;
      }
      return { ...prev, clinic_hours: hours };
    });
  }

  function clearAllHours() {
    setDraft(prev => {
      const hours = { ...prev.clinic_hours };
      for (const day of WEEK_DAYS) {
        hours[`open_${day}`] = "false";
        hours[`start_${day}`] = "";
        hours[`end_${day}`] = "";
      }
      return { ...prev, clinic_hours: hours };
    });
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

  // Production Readiness (handoff doc §12) - a stricter, deploy-gating
  // checklist beyond the setup sections above. `ok: null` means this
  // dashboard genuinely has no way to check the item (either the data isn't
  // exposed by any BFF route yet, or it's deliberately admin-only) - those
  // render as "Confirm manually" rather than a fabricated pass/fail, and
  // block the overall Ready state same as a real failure would.
  type ReadinessItem = { label: string; ok: boolean | null; note?: string; section?: string };

  // Booking configuration status (BOOKING-HARDENING.md §6) - specifically
  // the mechanics n8n needs to place a correct Juvonno appointment, as its
  // own visible-but-non-blocking checklist. Distinct from the broader
  // Production Readiness list below, which also covers Retell/API-key/user-
  // access concerns unrelated to booking mechanics - "Practitioner/service/
  // duration mappings configured" there reuses bookingReady so the two
  // checklists can't quietly disagree with each other.
  const staffNumsOk = practitioners.length > 0 && practitioners.every(p => p.staff_num) &&
    new Set(practitioners.map(p => p.staff_num)).size === practitioners.length;
  const serviceMappingOk = practitioners.length > 0 && practitioners.every(p =>
    (p.appointment_types ?? []).length > 0 &&
    p.appointment_types.every(t => t.service_id && t.schedule_type_id));
  const durationRulesOk = practitioners.length > 0 && practitioners.every(p =>
    (p.appointment_types ?? []).every(t =>
      (t.duration_categories ?? []).length > 0 &&
      t.duration_categories.every(c => c.label.trim() && (c.durations ?? "").split(",").some(d => parseInt(d.trim(), 10) > 0))));
  const bookingReadiness: ReadinessItem[] = [
    { label: "Clinic timezone", ok: /^[A-Za-z_]+\/[A-Za-z_]+$/.test(connectionStatus?.timezone ?? ""), section: "Clinic Profile" },
    { label: "Branch code", ok: Boolean(connectionStatus?.defaultBranchCode) },
    { label: "Clinic hours", ok: sectionComplete["Clinic Hours"], section: "Clinic Hours" },
    { label: "Transfer number", ok: /^\+[1-9]\d{6,14}$/.test(draft.transfer_escalation.transfer_number ?? ""), section: "Transfer & Escalation" },
    { label: "Booking notice/window", ok: null, note: "Not yet exposed in Settings UI - confirm in clinic_configs" },
    { label: "Practitioner staff numbers", ok: staffNumsOk, section: "Practitioners" },
    { label: "Service mapping (Service ID + Schedule Type ID)", ok: serviceMappingOk, section: "Practitioners" },
    { label: "Duration rules (Initial/Follow-up)", ok: durationRulesOk, section: "Practitioners" },
  ];
  const bookingReady = bookingReadiness.every(i => i.ok === true);

  const productionReadiness: ReadinessItem[] = [
    { label: "Clinic hours configured", ok: sectionComplete["Clinic Hours"], section: "Clinic Hours" },
    { label: "Transfer number is valid E.164", ok: /^\+[1-9]\d{6,14}$/.test(draft.transfer_escalation.transfer_number ?? ""), section: "Transfer & Escalation" },
    { label: "Minimum booking notice configured", ok: null, note: "Not yet exposed in Settings UI - confirm in clinic_configs" },
    { label: "Maximum booking window configured", ok: null, note: "Not yet exposed in Settings UI - confirm in clinic_configs" },
    { label: "Juvonno base URL, branch code, and API key connected", ok: Boolean(connectionStatus?.juvonnoBaseUrl && connectionStatus?.defaultBranchCode && connectionStatus?.hasJuvonnoApiKey) },
    { label: "Practitioner/service/duration mappings configured", ok: staffNumsOk && serviceMappingOk && durationRulesOk, section: "Practitioners" },
    { label: "Retell receptionist agent and phone number mapped", ok: Boolean(connectionStatus?.retellReceptionistAgentId && connectionStatus?.retellReceptionistPhoneNumber) },
    { label: "Authorized owner/admin/manager has clinic access", ok: null, note: "Confirm in user_clinic_access" },
    { label: "Cancellation strategy sandbox-validated", ok: null, note: "Administrator-only - required before enabling cancellation approval" },
  ];
  const productionReady = productionReadiness.every(i => i.ok === true);

  // Shared renderer for both readiness cards below (Booking configuration
  // status + Production Readiness) - same three-state item row (OK / Missing
  // -> jump to section / Confirm manually or Contact administrator).
  function renderReadinessCard(title: string, subtitle: string, items: ReadinessItem[], ready: boolean, readyLabel: string, notReadyLabel: string) {
    return (
      <Card className="overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <span className={`text-[10px] font-medium px-2 py-1 rounded-full flex-shrink-0 ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {ready ? readyLabel : notReadyLabel}
          </span>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.label} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-xs font-medium text-foreground">{item.label}</p>
                {item.note && <p className="text-[10px] text-muted-foreground mt-0.5">{item.note}</p>}
              </div>
              {item.ok === true ? (
                <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1 flex-shrink-0"><CheckCircle2 size={11} /> OK</span>
              ) : item.ok === false ? (
                item.section ? (
                  <button
                    onClick={() => setActiveSection(item.section!)}
                    className="text-[10px] text-amber-600 font-medium flex items-center gap-1 flex-shrink-0 hover:underline"
                  >
                    <AlertCircle size={11} /> Missing — Fix in {item.section}
                  </button>
                ) : (
                  <span className="text-[10px] text-amber-600 font-medium flex items-center gap-1 flex-shrink-0"><AlertCircle size={11} /> Missing</span>
                )
              ) : canConfirmManually ? (
                <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 flex-shrink-0"><Info size={11} /> Confirm manually</span>
              ) : (
                <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 flex-shrink-0"><Info size={11} /> Contact RivaCare administrator</span>
              )}
            </div>
          ))}
        </div>
      </Card>
    );
  }

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

  // Purely for the sticky bar's "Unsaved changes" vs "All changes saved" text
  // - compares current in-memory draft against the last-loaded `settings`
  // snapshot from context. Doesn't affect what gets saved or how.
  const isActiveSectionDirty = (() => {
    if (activeSection === "Practitioners") {
      const saved = (settings.practitioners as { list?: Practitioner[] })?.list ?? [];
      return JSON.stringify(practitioners) !== JSON.stringify(saved);
    }
    if (activeSection === "FAQs / Knowledge Base") {
      const saved = (settings.faqs as { list?: FAQ[] })?.list ?? [];
      return JSON.stringify(faqs) !== JSON.stringify(saved);
    }
    const keyMap: Record<string, DraftKey> = {
      "Clinic Profile": "clinic_profile",
      "Clinic Hours": "clinic_hours",
      "Transfer & Escalation": "transfer_escalation",
      "SMS Follow-Ups": "sms_follow_ups",
    };
    const key = keyMap[activeSection];
    if (!key) return false;
    return JSON.stringify(draft[key]) !== JSON.stringify(settings[key] ?? {});
  })();

  function addPractitioner() {
    const id = crypto.randomUUID();
    setPractitioners(prev => [...prev, {
      id, name: "", keywords: "", staff_num: "",
      appointment_types: [newAppointmentType()],
    }]);
    setExpandedPractitionerId(id);
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
      service_id: "", product_id: "", schedule_type_id: "",
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

  function updateAppointmentTypeField(practitionerId: string, typeId: string, field: 'service_name' | 'keywords' | 'service_id' | 'product_id' | 'schedule_type_id', value: string) {
    setPractitioners(prev => prev.map(p => p.id === practitionerId ? {
      ...p, appointment_types: p.appointment_types.map(t => t.id === typeId ? { ...t, [field]: value.trim() } : t),
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

            {renderReadinessCard(
              "Booking Configuration Status",
              "Non-blocking - what n8n needs to place a correct Juvonno appointment (BOOKING-HARDENING.md §6).",
              bookingReadiness, bookingReady, "Booking Ready", "Booking Not Ready"
            )}

            {renderReadinessCard(
              "Production Readiness",
              "Deploy-gating checks, stricter than the setup sections above.",
              productionReadiness, productionReady, "Production Ready", "Not Production Ready"
            )}
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
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Clinic Hours</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{SETTINGS_SECTION_META["Clinic Hours"].subtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => copyDayToDays("Monday", ["Tuesday", "Wednesday", "Thursday", "Friday"])} className="text-[10px] font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted transition-colors">
                  Copy Monday to weekdays
                </button>
                <button type="button" onClick={() => copyDayToDays("Monday", WEEK_DAYS.slice(1))} className="text-[10px] font-medium text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted transition-colors">
                  Apply to all days
                </button>
                <button type="button" onClick={clearAllHours} className="text-[10px] font-medium text-muted-foreground hover:text-destructive border border-border rounded-md px-2.5 py-1.5 hover:bg-red-50 transition-colors">
                  Clear all hours
                </button>
              </div>
            </div>
            <Card className="p-5 space-y-3">
              {WEEK_DAYS.map((day, i) => {
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
                  const isExpanded = expandedPractitionerId === p.id;
                  const isComplete = Boolean(p.name && p.staff_num && types.length > 0);
                  const serviceCount = types.filter(t => t.service_name).length;
                  const staffNumDuplicate = Boolean(p.staff_num) && practitioners.some(other => other.id !== p.id && other.staff_num === p.staff_num);

                  if (!isExpanded) {
                    return (
                      <Card key={p.id} className="p-3">
                        <div className="w-full flex items-center gap-3 text-left">
                          <button
                            type="button"
                            onClick={() => setExpandedPractitionerId(p.id)}
                            className="flex-1 min-w-0 flex items-center gap-3 text-left"
                          >
                            <div className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {(p.name || "?").charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">{p.name || `Practitioner #${i + 1}`}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {p.staff_num ? `Staff #${p.staff_num}` : "No staff number"} · {serviceCount} service{serviceCount === 1 ? "" : "s"}
                              </p>
                            </div>
                            {staffNumDuplicate && (
                              <span className="flex items-center gap-1 text-[9px] font-medium text-red-700 bg-red-50 px-1.5 py-0.5 rounded flex-shrink-0">
                                <AlertTriangle size={9} /> Duplicate staff #
                              </span>
                            )}
                            {isComplete ? (
                              <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                            ) : (
                              <span className="text-[9px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">Incomplete</span>
                            )}
                            <span className="text-[10px] font-medium text-primary flex-shrink-0">Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removePractitioner(p.id)}
                            aria-label={`Remove ${p.name || `practitioner #${i + 1}`}`}
                            className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </Card>
                    );
                  }

                  const step = practitionerStep[p.id] ?? 1;
                  const STEPS = [
                    { n: 1, label: "Practitioner details" },
                    { n: 2, label: "Services" },
                    { n: 3, label: "Appointment lengths" },
                  ];

                  return (
                    <Card key={p.id} className="p-6 space-y-5">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Practitioner #{i + 1}</p>
                          <h3 className="text-base font-semibold text-foreground mt-0.5">{p.name || "New practitioner"}</h3>
                        </div>
                        <div className="flex items-center gap-3">
                          <button type="button" onClick={() => setExpandedPractitionerId(null)} className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                            Collapse
                          </button>
                          <button type="button" onClick={() => removePractitioner(p.id)} aria-label={`Remove ${p.name || `practitioner #${i + 1}`}`} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      {/* Step tabs */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {STEPS.map((s, si) => (
                          <div key={s.n} className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPractitionerStep(prev => ({ ...prev, [p.id]: s.n }))}
                              className="flex items-center gap-1.5"
                            >
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${step === s.n ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                                {s.n}
                              </span>
                              <span className={`text-xs font-medium ${step === s.n ? "text-primary" : "text-muted-foreground"}`}>{s.label}</span>
                            </button>
                            {si < STEPS.length - 1 && <ChevronRight size={13} className="text-muted-foreground/50" />}
                          </div>
                        ))}
                      </div>

                      {step === 1 && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-foreground">Display name</label>
                              <input value={p.name} onChange={e => updatePractitioner(p.id, 'name', e.target.value)} placeholder="Dr. Sarah Chen" className="w-full bg-input-background border border-border rounded-full px-4 py-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-foreground">Juvonno staff number</label>
                              <input
                                value={p.staff_num}
                                onChange={e => updatePractitioner(p.id, 'staff_num', e.target.value)}
                                placeholder="1122"
                                className={`w-full bg-input-background border rounded-full px-4 py-2.5 text-xs text-foreground focus:outline-none focus:ring-1 font-mono ${staffNumDuplicate ? "border-red-300 focus:ring-red-300" : "border-border focus:ring-ring"}`}
                              />
                              {staffNumDuplicate && (
                                <p className="text-[10px] text-destructive">Another practitioner already uses this staff number.</p>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-foreground">Names patients may use</label>
                            <input value={p.keywords} onChange={e => updatePractitioner(p.id, 'keywords', e.target.value)} placeholder="Sarah, Dr. Chen, Chen" className="w-full bg-input-background border border-border rounded-full px-4 py-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                            <p className="text-[10px] text-muted-foreground">Separate aliases with commas so the receptionist can match patient requests correctly.</p>
                          </div>
                        </div>
                      )}

                      {(step === 2 || step === 3) && (
                        <div className="border-t border-border pt-4 space-y-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">Services and appointment lengths</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Tell the receptionist what this practitioner provides and which times it can offer.</p>
                          </div>
                          {types.map((t, ti) => (
                            <div key={t.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
                              {/* Service name + keywords */}
                              <div className="flex items-start gap-3">
                                <div className="flex-1 grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-foreground">Service {ti + 1}</label>
                                    <input value={t.service_name} onChange={e => updateAppointmentTypeField(p.id, t.id, 'service_name', e.target.value)} placeholder="e.g. Chiropractic" className="w-full bg-input-background border border-border rounded-full px-4 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-medium" />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-foreground">Patient keywords</label>
                                    <input value={t.keywords ?? ""} onChange={e => updateAppointmentTypeField(p.id, t.id, 'keywords', e.target.value)} placeholder="chiro, adjustment" className="w-full bg-input-background border border-border rounded-full px-4 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-muted-foreground" />
                                  </div>
                                </div>
                                {types.length > 1 && (
                                  <button type="button" onClick={() => removeAppointmentType(p.id, t.id)} aria-label={`Remove service type ${t.service_name || `#${ti + 1}`}`} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-6">
                                    <X size={13} />
                                  </button>
                                )}
                              </div>
                              {/* Duration categories */}
                              <div className="space-y-2.5">
                                {(t.duration_categories ?? []).map(c => {
                                  const selected = new Set((c.durations ?? '').split(',').map(s => s.trim()).filter(Boolean));
                                  return (
                                    <div key={c.id} className="flex items-center gap-3 bg-muted/30 border border-border rounded-lg p-3">
                                      <input value={c.label} onChange={e => updateDurationCategory(p.id, t.id, c.id, 'label', e.target.value)} placeholder="e.g. Initial, Follow-up" className="w-28 shrink-0 bg-transparent text-xs font-medium text-foreground focus:outline-none" />
                                      <div className="flex flex-wrap gap-1.5 flex-1">
                                        {durations.map(d => (
                                          <button
                                            type="button"
                                            key={d}
                                            onClick={() => toggleDuration(p.id, t.id, c.id, d, c.durations)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selected.has(d) ? "bg-primary text-white" : "bg-card border border-border text-foreground hover:bg-muted"}`}
                                          >
                                            {d} min
                                          </button>
                                        ))}
                                      </div>
                                      {(t.duration_categories ?? []).length > 1 && (
                                        <button type="button" onClick={() => removeDurationCategory(p.id, t.id, c.id)} aria-label={`Remove duration category ${c.label || ""}`} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                                          <X size={12} />
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                                <button type="button" onClick={() => addDurationCategory(p.id, t.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-0.5">
                                  <Plus size={11} /> Add duration type
                                </button>
                              </div>
                              {/* Juvonno booking identifiers (advanced, collapsed by default) */}
                              {(() => {
                                const idsOpen = expandedIdentifierIds.has(t.id);
                                const idsComplete = Boolean(t.service_id && t.schedule_type_id);
                                return (
                                  <div className="border-t border-border pt-3">
                                    <button
                                      type="button"
                                      onClick={() => toggleIdentifiers(t.id)}
                                      className="flex items-center justify-between w-full text-left"
                                    >
                                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                        <Database size={11} /> Juvonno booking identifiers
                                        {!idsComplete && <Badge label="Incomplete" variant="Medium" />}
                                      </span>
                                      <ChevronDown size={13} className={`text-muted-foreground transition-transform ${idsOpen ? "rotate-180" : ""}`} />
                                    </button>
                                    {idsOpen && (
                                      <div className="grid grid-cols-3 gap-3 mt-3">
                                        <div className="space-y-1">
                                          <label className="text-[10px] font-medium text-muted-foreground">Juvonno Service ID *</label>
                                          <input value={t.service_id ?? ""} onChange={e => updateAppointmentTypeField(p.id, t.id, 'service_id', e.target.value)} placeholder="e.g. 123" className="w-full bg-input-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[10px] font-medium text-muted-foreground">Juvonno Product ID</label>
                                          <input value={t.product_id ?? ""} onChange={e => updateAppointmentTypeField(p.id, t.id, 'product_id', e.target.value)} placeholder="e.g. 456" className="w-full bg-input-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[10px] font-medium text-muted-foreground">Juvonno Schedule Type ID *</label>
                                          <input value={t.schedule_type_id ?? ""} onChange={e => updateAppointmentTypeField(p.id, t.id, 'schedule_type_id', e.target.value)} placeholder="e.g. 789" className="w-full bg-input-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                                        </div>
                                      </div>
                                    )}
                                    <p className="text-[10px] text-muted-foreground mt-2">
                                      Required before this service is booking-ready. Product ID may stay blank only once this clinic's Juvonno API has been confirmed to accept appointments without one.
                                    </p>
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                          <button type="button" onClick={() => addAppointmentType(p.id)} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline pt-1">
                            <Plus size={13} /> Add appointment type
                          </button>
                        </div>
                      )}
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
                <div className="flex items-center gap-1.5 flex-wrap">
                  {["All", ...FAQ_CATEGORIES].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setFaqCategoryFilter(cat)}
                      className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition-colors ${faqCategoryFilter === cat ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                {faqs.filter(f =>
                  (!faqSearch.trim() ||
                    f.question.toLowerCase().includes(faqSearch.trim().toLowerCase()) ||
                    f.answer.toLowerCase().includes(faqSearch.trim().toLowerCase())) &&
                  (faqCategoryFilter === "All" || (f.category ?? "General") === faqCategoryFilter)
                ).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">No FAQs match this search/category.</p>
                )}
                {faqs.filter(f =>
                  (!faqSearch.trim() ||
                    f.question.toLowerCase().includes(faqSearch.trim().toLowerCase()) ||
                    f.answer.toLowerCase().includes(faqSearch.trim().toLowerCase())) &&
                  (faqCategoryFilter === "All" || (f.category ?? "General") === faqCategoryFilter)
                ).map((faq) => {
                  const i = faqs.findIndex(f => f.id === faq.id);
                  const normalizedQ = faq.question.trim().toLowerCase();
                  const isDuplicate = Boolean(normalizedQ) && faqs.some(f => f.id !== faq.id && f.question.trim().toLowerCase() === normalizedQ);
                  return (
                  <Card key={faq.id} className={`p-4 space-y-3 ${isDuplicate ? "border-amber-300" : ""}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">FAQ #{i + 1}</span>
                        <span className="text-[9px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{faq.category ?? "General"}</span>
                        {isDuplicate && (
                          <span className="flex items-center gap-1 text-[9px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            <AlertTriangle size={9} /> Duplicate question
                          </span>
                        )}
                      </div>
                      <button type="button" onClick={() => setFaqs(prev => prev.filter(f => f.id !== faq.id))} aria-label="Remove FAQ" className="text-muted-foreground hover:text-destructive transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2 space-y-1.5">
                        <label className="text-xs font-medium text-foreground">Question</label>
                        <input value={faq.question} onChange={e => setFaqs(prev => prev.map(f => f.id === faq.id ? { ...f, question: e.target.value } : f))} placeholder="What are your clinic hours?" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <label className="text-xs font-medium text-foreground">Category</label>
                        <select
                          value={faq.category ?? "General"}
                          onChange={e => setFaqs(prev => prev.map(f => f.id === faq.id ? { ...f, category: e.target.value } : f))}
                          className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {FAQ_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </div>
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
                {templates.map(([key, label, fallback]) => {
                  const enabled = draft.sms_follow_ups[`${key}_enabled`] !== 'false';
                  const message = draft.sms_follow_ups[`${key}_message`] ?? fallback;
                  const segments = Math.max(1, Math.ceil(message.length / 160));
                  const previewText = message
                    .replace(/\{patient_name\}/g, "Sarah")
                    .replace(/\{clinic_name\}/g, tenantInfo?.clinic_name || "the clinic")
                    .replace(/\{date\}/g, "Jul 24")
                    .replace(/\{time\}/g, "2:00 PM");
                  return (
                    <Card key={key} className="p-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2 space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={enabled} onChange={e => setField('sms_follow_ups', `${key}_enabled`, e.target.checked ? 'true' : 'false')} className="rounded" />
                              <span className="text-xs font-semibold text-foreground">{label}</span>
                              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                                {enabled ? "Enabled" : "Paused"}
                              </span>
                            </label>
                            <span className="text-[10px] text-muted-foreground">{message.length} chars · {segments} segment{segments === 1 ? "" : "s"}</span>
                          </div>
                          <textarea
                            ref={el => { smsTextareaRefs.current[key] = el; }}
                            rows={3}
                            value={message}
                            onChange={e => setField('sms_follow_ups', `${key}_message`, e.target.value)}
                            className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                          />
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {[
                                ["Patient Name", "{patient_name}"],
                                ["Clinic Name", "{clinic_name}"],
                                ["Date", "{date}"],
                                ["Time", "{time}"],
                              ].map(([varLabel, token]) => (
                                <button
                                  key={token}
                                  type="button"
                                  onClick={() => insertSmsVariable(key, fallback, token)}
                                  className="text-[9px] font-medium text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded-full transition-colors"
                                >
                                  + {varLabel}
                                </button>
                              ))}
                            </div>
                            <button type="button" onClick={() => setField('sms_follow_ups', `${key}_message`, fallback)} className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                              Restore default
                            </button>
                          </div>
                        </div>
                        <div className="bg-muted/40 rounded-md p-3 flex flex-col justify-center">
                          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Preview</p>
                          <div className="bg-primary text-primary-foreground text-[11px] leading-relaxed rounded-2xl rounded-bl-sm px-3 py-2 max-w-[90%]">
                            {previewText}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
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
            ) : isActiveSectionDirty ? (
              <span className="font-medium text-amber-600">Unsaved changes in {activeSection}</span>
            ) : (
              <span className="text-muted-foreground">All changes saved</span>
            )}
          </div>
          <button
            type="button"
            disabled={saving || !isActiveSectionDirty}
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
  const { invoices, loadError } = useDashboard();
  // Build Invoices Response already sorts newest period first.
  const latest = invoices[0] ?? null;
  const latestMinutesUsed = num(latest?.minutesUsed);
  const latestIncludedMinutes = num(latest?.includedMinutes);
  const billingPct = latestIncludedMinutes > 0 ? Math.min(100, (latestMinutesUsed / latestIncludedMinutes) * 100) : 0;

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

      {invoices.length === 0 && (
        <div className={`text-xs rounded-md px-3 py-2.5 ${loadError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
          {loadError ? `Could not load billing data — ${loadError}` : "No usage recorded yet — a plan may not be configured for this clinic."}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Current Plan" value={latest ? `$${num(latest.baseRate).toFixed(0)}/mo` : "—"} sub={latest ? `${latestIncludedMinutes.toLocaleString()} min included` : "—"} icon={Star} color="purple" />
        <KpiCard label="Minutes Used" value={latest ? `${latestMinutesUsed} / ${latestIncludedMinutes}` : "—"} sub="of plan included" icon={Clock} color="amber" />
        <KpiCard label="Est. Overage" value={latest ? `$${num(latest.overageCost).toFixed(2)}` : "—"} sub={latest ? `${num(latest.overageMin)} min over` : "vs plan limits"} icon={CreditCard} color={latest?.isOverage ? "red" : "green"} />
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
                <span className="font-semibold text-foreground font-mono">{latest ? `${latestMinutesUsed} / ${latestIncludedMinutes}` : "—"}</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: `${billingPct}%` }} />
              </div>
              {latest && billingPct >= 80 && (
                <p className="text-[10px] text-amber-600 mt-1 font-medium">
                  ⚠ {latest.isOverage ? "Over plan limit." : "Approaching plan limit."} {Math.max(0, latestIncludedMinutes - latestMinutesUsed)} minutes remaining.
                </p>
              )}
            </div>
            <div className="pt-2 space-y-2 text-xs">
              {[
                ["Included Minutes", latest ? `${latestIncludedMinutes.toLocaleString()}/mo` : "—"],
                ["Overage Rate", latest ? `$${num(latest.overageRate).toFixed(2)}/min` : "—"],
                ["Overage Minutes", latest ? String(num(latest.overageMin)) : "—"],
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
// AI-outbound-call recovery (Retell), per the Payment Recovery spec. Reads
// and writes via /api/link/:accessToken/recovery/* (server/index.js), which
// proxies to the tenant's n8n_webhook_url using recovery.get_* / recovery.*
// event names. Field readers below accept BOTH the spec's camelCase contract
// and snake_case (Google-Sheets-column style) since the exact response shape
// depends on how that n8n workflow ends up serializing its Sheets columns.
function pick(obj: any, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  return undefined;
}
function pickText(obj: any, ...keys: string[]): string { return safeText(pick(obj, ...keys)); }
function pickNum(obj: any, ...keys: string[]): number { return num(pick(obj, ...keys)); }
function pickBool(obj: any, ...keys: string[]): boolean { return parseBoolean(pick(obj, ...keys)); }

type RInvoiceStatus = "unpaid" | "paid" | "manual_hold" | "staff_attention" | "failed" | string;
type RStage = "new" | "day_3_payment_request" | "day_7_call" | "day_14_call" | "staff_escalation" | "recovered" | "closed" | string;
type RApproval = "pending" | "approved" | "rejected" | string;
type RQueueStatus = "configuration_required" | "pending" | "submitted" | "in_progress" | "completed" | "cancelled_paid" | "cancelled_hold" | "staff_followup_required" | "failed" | string;

interface RInvoice {
  invoiceId: string; invoiceNumber: string; patientName: string;
  phoneMasked: string; emailMasked: string;
  originalAmount: number; amountDue: number;
  status: RInvoiceStatus; dueDate: string; daysOverdue: number;
  stage: RStage; manualHold: boolean; optedOut: boolean;
  recoveryEntryAmount: number; paidAt: string; lastVerifiedAt: string; lastUpdated: string;
}
interface RQueueItem {
  queueId: string; patientName: string; phoneMasked: string;
  invoiceNumbers: string[]; amountDue: number; dueDate: string; daysOverdue: number;
  callStage: string; scheduledFor: string;
  approval: RApproval; queueStatus: RQueueStatus; attemptCount: number; blockers: string[];
}
interface RCall {
  id: string; patientName: string; timestamp: string; stage: string; outcome: string;
  duration: string; balance: number; paidAfterward: boolean; staffFollowup: boolean;
}
interface RActivity { id: string; patientName: string; type: string; status: string; summary: string; timestamp: string; }
interface RMetrics {
  totalOutstanding: number; activeUnpaidInvoices: number;
  eligibleOverdue: number;
  recoveredRevenue: number; recoveredInvoices: number;
  automatedContacts: number; callsAttempted: number; callsAnswered: number;
  staffHoursSaved: number; labourSavings: number; automationCost: number;
  estimatedIncrementalRecovery: number | null; estimatedTotalSavings: number | null; roiPercent: number | null;
  lastUpdated: string;
}

function mapRInvoice(r: any): RInvoice {
  return {
    invoiceId: pickText(r, "invoiceId", "invoice_id"),
    invoiceNumber: pickText(r, "invoiceNumber", "invoice_number"),
    patientName: pickText(r, "patientDisplayName", "patient_name") || "Unknown",
    phoneMasked: pickText(r, "patientPhoneMasked", "patient_phone_masked", "patient_phone"),
    emailMasked: pickText(r, "patientEmailMasked", "patient_email_masked", "patient_email"),
    originalAmount: pickNum(r, "originalAmount", "original_amount"),
    amountDue: pickNum(r, "amountDue", "amount_due"),
    status: pickText(r, "status") || "unpaid",
    dueDate: pickText(r, "dueDate", "due_date"),
    daysOverdue: pickNum(r, "daysOverdue", "days_overdue"),
    stage: pickText(r, "recoveryStage", "recovery_stage") || "new",
    manualHold: pickBool(r, "manualHold", "manual_hold"),
    optedOut: pickBool(r, "optedOut", "opt_out"),
    recoveryEntryAmount: pickNum(r, "recoveryProgramEntryAmount", "recovery_program_entry_amount"),
    paidAt: pickText(r, "paidAt", "paid_at"),
    lastVerifiedAt: pickText(r, "lastVerifiedAt", "last_verified_at"),
    lastUpdated: pickText(r, "lastUpdated", "last_updated"),
  };
}
function mapRQueueItem(r: any): RQueueItem {
  const nums = pick(r, "invoiceNumbers", "invoice_numbers");
  return {
    queueId: pickText(r, "queueId", "queue_id"),
    patientName: pickText(r, "patientDisplayName", "patient_name") || "Unknown",
    phoneMasked: pickText(r, "patientPhoneMasked", "patient_phone_masked", "patient_phone"),
    invoiceNumbers: Array.isArray(nums) ? nums.map(String) : pickText(r, "invoiceNumbers", "invoice_numbers").split(",").map(s => s.trim()).filter(Boolean),
    amountDue: pickNum(r, "amountDue", "amount_due"),
    dueDate: pickText(r, "dueDate", "due_date"),
    daysOverdue: pickNum(r, "daysOverdue", "days_overdue"),
    callStage: pickText(r, "callStage", "call_stage") || "day_7",
    scheduledFor: pickText(r, "scheduledFor", "scheduled_for"),
    approval: pickText(r, "approvalStatus", "approval_status") || "pending",
    queueStatus: pickText(r, "queueStatus", "queue_status") || "pending",
    attemptCount: pickNum(r, "attemptCount", "attempt_count"),
    blockers: Array.isArray(r?.blockers) ? r.blockers.map(String) : [],
  };
}
function mapRCall(r: any): RCall {
  return {
    id: pickText(r, "id", "callId", "call_id") || crypto.randomUUID(),
    patientName: pickText(r, "patientDisplayName", "patient_name") || "Unknown",
    timestamp: pickText(r, "timestamp", "callTimestamp", "call_timestamp"),
    stage: pickText(r, "stage", "callStage", "call_stage"),
    outcome: pickText(r, "outcome", "callOutcome", "call_outcome"),
    duration: pickText(r, "duration", "callDurationDisplay", "call_duration_display"),
    balance: pickNum(r, "amountDue", "amount_due", "balance"),
    paidAfterward: pickBool(r, "paidAfterward", "paid_afterward"),
    staffFollowup: pickBool(r, "staffFollowup", "staff_followup_required"),
  };
}
function mapRActivity(r: any): RActivity {
  return {
    id: pickText(r, "id") || crypto.randomUUID(),
    patientName: pickText(r, "patientDisplayName", "patient_name"),
    type: pickText(r, "type"),
    status: pickText(r, "status") || "info",
    summary: pickText(r, "summary"),
    timestamp: pickText(r, "timestamp"),
  };
}
function mapRMetrics(r: any): RMetrics {
  return {
    totalOutstanding: pickNum(r, "totalOutstanding", "total_outstanding"),
    activeUnpaidInvoices: pickNum(r, "activeUnpaidInvoices", "active_unpaid_invoices"),
    eligibleOverdue: pickNum(r, "eligibleOverdue", "eligible_overdue"),
    recoveredRevenue: pickNum(r, "recoveredRevenue", "recovered_revenue"),
    recoveredInvoices: pickNum(r, "recoveredInvoices", "recovered_invoices"),
    automatedContacts: pickNum(r, "automatedContacts", "automated_contacts"),
    callsAttempted: pickNum(r, "callsAttempted", "calls_attempted"),
    callsAnswered: pickNum(r, "callsAnswered", "calls_answered"),
    staffHoursSaved: pickNum(r, "staffHoursSaved", "staff_hours_saved"),
    labourSavings: pickNum(r, "labourSavings", "labour_savings"),
    automationCost: pickNum(r, "automationCost", "automation_cost"),
    estimatedIncrementalRecovery: pick(r, "estimatedIncrementalRecovery", "estimated_incremental_recovery") != null ? pickNum(r, "estimatedIncrementalRecovery", "estimated_incremental_recovery") : null,
    estimatedTotalSavings: pick(r, "estimatedTotalSavings", "estimated_total_savings") != null ? pickNum(r, "estimatedTotalSavings", "estimated_total_savings") : null,
    roiPercent: pick(r, "roiPercent", "roi_percent") != null ? pickNum(r, "roiPercent", "roi_percent") : null,
    lastUpdated: pickText(r, "lastUpdated", "last_updated"),
  };
}

const R_INVOICE_STATUS_LABEL: Record<string, string> = { unpaid: "Unpaid", paid: "Paid", manual_hold: "On Hold", staff_attention: "Staff Attention", failed: "Failed" };
const R_STAGE_LABEL: Record<string, string> = { new: "New", day_3_payment_request: "Day-3 Request", day_7_call: "Day-7 Call", day_14_call: "Day-14 Call", staff_escalation: "Staff Escalation", recovered: "Recovered", closed: "Closed" };
const R_QUEUE_STATUS_LABEL: Record<string, string> = { configuration_required: "Config Required", pending: "Pending", submitted: "Submitted", in_progress: "In Progress", completed: "Completed", cancelled_paid: "Cancelled (Paid)", cancelled_hold: "Cancelled (Hold)", staff_followup_required: "Needs Follow-up", failed: "Failed" };
// Outcome -> visual tone, per spec §10.1 (never colour-only - RPill always
// pairs the tone with the literal label text too).
const R_OUTCOME_TONE: Record<string, "green" | "blue" | "gray" | "amber" | "red"> = {
  reminder_delivered: "green", already_paid: "green",
  voicemail_left: "blue", payment_link_requested: "blue",
  no_answer: "gray",
  billing_question: "amber", billing_dispute: "amber", promise_to_pay: "amber",
  financial_assistance_requested: "amber", staff_followup_required: "amber",
  wrong_number: "red", opt_out: "red", technical_failure: "red",
};
function RPill({ label, tone }: { label: string; tone: "green" | "blue" | "gray" | "amber" | "red" | "slate" }) {
  const toneClass: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700",
    gray: "bg-slate-100 text-slate-600", amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700", slate: "bg-slate-100 text-slate-600",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${toneClass[tone]}`}>{label}</span>;
}
function humanizeSnake(s: string): string { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

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

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
}
function fmtCurrency(n: number): string { return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function PaymentRecoveryScreen() {
  const { accessToken } = useDashboard();
  const { session } = useAuth();
  const identityReady = Boolean(accessToken) || Boolean(session);
  const [activeTab, setActiveTab] = useState<"overview" | "queue" | "invoices" | "calls" | "settings">("overview");

  const [metrics, setMetrics] = useState<RMetrics | null>(null);
  const [invoices, setInvoices] = useState<RInvoice[]>([]);
  const [queue, setQueue] = useState<RQueueItem[]>([]);
  const [calls, setCalls] = useState<RCall[]>([]);
  const [activity, setActivity] = useState<RActivity[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const [search, setSearch] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [queueFilter, setQueueFilter] = useState("pending");
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());
  const [callsSubTab, setCallsSubTab] = useState<"calls" | "activity">("calls");

  const [confirm, setConfirm] = useState<{ title: string; body: string; onConfirm: () => void } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [staleWarning, setStaleWarning] = useState(false);
  const hasLoadedOnce = useRef(false);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  // Prefers the consolidated /recovery/snapshot endpoint (one request instead
  // of six). Falls back to the legacy six-request pattern if the snapshot
  // route 404s/502s - e.g. the n8n workflow hasn't been updated to emit
  // `recovery.get_snapshot` yet - so this keeps working against either
  // workflow version instead of going blank. Session mode has no legacy
  // fallback to drop to (the production recovery API only speaks snapshot).
  async function loadSnapshot(signal: AbortSignal): Promise<boolean> {
    if (!identityReady) return false;
    const res = await apiFetch(accessToken, session?.csrfToken, "/recovery/snapshot", { signal });
    if (!res.ok) return false;
    const snap = await res.json().catch(() => null);
    if (!snap || typeof snap !== "object" || snap.error) return false;
    setMetrics(mapRMetrics(snap.metrics ?? {}));
    setInvoices((Array.isArray(snap.invoices) ? snap.invoices : []).map(mapRInvoice));
    setQueue((Array.isArray(snap.queue) ? snap.queue : []).map(mapRQueueItem));
    setCalls((Array.isArray(snap.calls) ? snap.calls : []).map(mapRCall));
    setActivity((Array.isArray(snap.activity) ? snap.activity : []).map(mapRActivity));
    setSettings(snap.settings && typeof snap.settings === "object" ? snap.settings : {});
    setGeneratedAt(String(snap.generated_at ?? snap.metrics?.last_updated ?? ""));
    return true;
  }

  async function loadLegacy(signal: AbortSignal): Promise<boolean> {
    if (!accessToken) return false;
    const [mRaw, iRaw, qRaw, cRaw, aRaw, sRaw] = await Promise.all([
      fetch(`/api/link/${accessToken}/recovery/overview`, { signal }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`/api/link/${accessToken}/recovery/invoices`, { signal }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`/api/link/${accessToken}/recovery/queue`, { signal }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`/api/link/${accessToken}/recovery/calls`, { signal }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`/api/link/${accessToken}/recovery/activity`, { signal }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`/api/link/${accessToken}/recovery/settings`, { signal }).then(r => r.ok ? r.json() : Promise.reject()),
    ]);
    setMetrics(mapRMetrics(mRaw));
    setInvoices((Array.isArray(iRaw) ? iRaw : iRaw?.invoices ?? []).map(mapRInvoice));
    setQueue((Array.isArray(qRaw) ? qRaw : qRaw?.queue ?? []).map(mapRQueueItem));
    setCalls((Array.isArray(cRaw) ? cRaw : cRaw?.calls ?? []).map(mapRCall));
    setActivity((Array.isArray(aRaw) ? aRaw : aRaw?.activity ?? []).map(mapRActivity));
    setSettings(sRaw && typeof sRaw === "object" ? sRaw : {});
    setGeneratedAt(String(mRaw?.last_updated ?? mRaw?.lastUpdated ?? ""));
    return true;
  }

  // isBackground: a silent poll refresh - on failure, keep whatever data is
  // already on screen (and show the stale badge) rather than blanking the
  // whole screen with PRErrorState, per the "don't replace good data with an
  // error" requirement.
  async function loadRecoveryData(isBackground: boolean, signal: AbortSignal) {
    if (!isBackground) { setLoading(!hasLoadedOnce.current); setError(false); }
    try {
      const ok = await loadSnapshot(signal).catch(() => false) || (accessToken ? await loadLegacy(signal) : false);
      if (!ok) throw new Error("no data");
      hasLoadedOnce.current = true;
      setStaleWarning(false);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      if (!hasLoadedOnce.current) setError(true);
      else setStaleWarning(true);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    if (!identityReady) return;
    const controller = new AbortController();
    loadRecoveryData(false, controller.signal);
    return () => controller.abort();
  }, [identityReady, accessToken, refreshTick]);

  // Poll every 90s while the tab is visible; refresh immediately when it
  // becomes visible again after being hidden.
  useEffect(() => {
    if (!identityReady) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const controller = new AbortController();
      loadRecoveryData(true, controller.signal);
    }, 90000);
    function onVisible() {
      if (document.visibilityState === "visible") {
        const controller = new AbortController();
        loadRecoveryData(true, controller.signal);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [identityReady]);

  // "Data may be stale" once the last successful sync is >3 minutes old.
  useEffect(() => {
    const ts = generatedAt ? new Date(generatedAt).getTime() : NaN;
    if (isNaN(ts)) return;
    const check = () => setStaleWarning(Date.now() - ts > 3 * 60 * 1000);
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [generatedAt]);

  function refetch() { setRefreshTick(t => t + 1); }

  async function postAction(path: string, body?: unknown): Promise<boolean> {
    if (!identityReady) return false;
    setActionBusy(true);
    try {
      // /recovery/settings is PUT in the production API (§7) but POST in the
      // legacy one - everything else is POST in both.
      const method = !accessToken && path === "/recovery/settings" ? "PUT" : "POST";
      const res = await apiFetch(accessToken, session?.csrfToken, path, { method, body: body ?? {} });
      return res.ok;
    } catch {
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  function askConfirm(title: string, body: string, onConfirm: () => void) {
    setConfirm({ title, body, onConfirm });
  }

  async function runConfirmed() {
    if (!confirm) return;
    const { onConfirm } = confirm;
    setConfirm(null);
    onConfirm();
  }

  // ── Derived data ──────────────────────────────────────────────────────
  const activeUnpaid = invoices.filter(i => i.status !== "paid");
  const recoveryRate = (() => {
    const cohort = invoices.filter(i => i.recoveryEntryAmount > 0);
    const cohortTotal = cohort.reduce((s, i) => s + i.recoveryEntryAmount, 0);
    const recovered = cohort.filter(i => i.status === "paid").reduce((s, i) => s + i.recoveryEntryAmount, 0);
    return cohortTotal > 0 ? (recovered / cohortTotal) * 100 : null;
  })();
  const netValue = metrics ? (metrics.estimatedIncrementalRecovery ?? 0) + metrics.labourSavings - metrics.automationCost : null;

  const staffAttention = invoices
    .filter(i => i.status === "staff_attention" || i.status === "failed")
    .slice(0, 5);

  const filteredInvoices = invoices
    .filter(i => {
      const matchesFilter =
        invoiceFilter === "unpaid" ? i.status !== "paid" :
        invoiceFilter === "paid" ? i.status === "paid" :
        invoiceFilter === "attention" ? i.status === "staff_attention" :
        invoiceFilter === "hold" ? i.manualHold : true;
      const matchesSearch = !search ||
        i.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
        i.patientName.toLowerCase().includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const filteredQueue = queue.filter(q => {
    if (queueFilter === "pending") return q.approval === "pending";
    if (queueFilter === "approved") return q.approval === "approved" && q.queueStatus !== "completed";
    if (queueFilter === "completed") return q.queueStatus === "completed";
    if (queueFilter === "cancelled") return q.queueStatus.startsWith("cancelled");
    if (queueFilter === "failed") return q.queueStatus === "failed";
    return true;
  });
  const queueSelectableIds = filteredQueue.filter(q => q.approval === "pending" && !["cancelled_paid", "cancelled_hold"].includes(q.queueStatus)).map(q => q.queueId);
  const allSelected = queueSelectableIds.length > 0 && queueSelectableIds.every(id => selectedQueueIds.has(id));

  function toggleQueueSelect(id: string) {
    setSelectedQueueIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleSelectAll() {
    setSelectedQueueIds(allSelected ? new Set() : new Set(queueSelectableIds));
  }

  async function approveQueueIds(ids: string[]) {
    const ok = await postAction("/recovery/queue/approve", { queueIds: ids });
    showToast(ok ? `Approved ${ids.length} call${ids.length === 1 ? "" : "s"}.` : "Could not reach the recovery workflow.");
    setSelectedQueueIds(new Set());
    if (ok) refetch();
  }
  async function rejectQueueIds(ids: string[]) {
    const ok = await postAction("/recovery/queue/reject", { queueIds: ids });
    showToast(ok ? `Rejected ${ids.length} call${ids.length === 1 ? "" : "s"}.` : "Could not reach the recovery workflow.");
    setSelectedQueueIds(new Set());
    if (ok) refetch();
  }
  async function invoiceAction(action: "hold" | "resume" | "reconcile" | "escalate", inv: RInvoice) {
    const ok = await postAction(`/recovery/invoices/${encodeURIComponent(inv.invoiceId)}/${action}`);
    showToast(ok ? `${humanizeSnake(action)} applied to ${inv.invoiceNumber}.` : "Could not reach the recovery workflow.");
    if (ok) refetch();
  }

  const TABS: { id: typeof activeTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "queue", label: "Recovery Queue" },
    { id: "invoices", label: "Invoices" },
    { id: "calls", label: "Calls & Activity" },
    { id: "settings", label: "Settings" },
  ];

  if (loading) return <PRLoadingSkeleton />;
  if (error) return <PRErrorState onRetry={refetch} />;

  return (
    <div className="p-6 space-y-5">
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-emerald-600 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2">
          <CheckCircle2 size={13} /> {toast}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <Card className="p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">{confirm.title}</h3>
            <p className="text-xs text-muted-foreground">{confirm.body}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirm(null)} className="text-xs border border-border px-3 py-1.5 rounded-md hover:bg-muted transition-colors">Cancel</button>
              <button onClick={runConfirmed} disabled={actionBusy} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-50">Confirm</button>
            </div>
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Payment Recovery</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Outstanding balances, AI call recovery, and staff follow-up in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          {generatedAt && !isNaN(new Date(generatedAt).getTime()) && (
            <span className="text-[10px] text-muted-foreground">Last synced {timeAgo(generatedAt)}</span>
          )}
          {staleWarning && <RPill label="Data may be stale" tone="amber" />}
          <button onClick={refetch} className="flex items-center gap-2 bg-muted border border-border text-xs font-medium px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`text-xs font-medium px-3 py-2 border-b-2 transition-colors ${activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-5">
          <div className="grid grid-cols-5 gap-3">
            <Card className="p-4 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Outstanding</p>
              <p className="text-xl font-semibold text-foreground font-mono">{metrics ? fmtCurrency(metrics.totalOutstanding) : "—"}</p>
              <p className="text-[10px] text-muted-foreground">{metrics ? `across ${metrics.activeUnpaidInvoices} invoice${metrics.activeUnpaidInvoices === 1 ? "" : "s"}` : "point-in-time balance"}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recovered After Automation</p>
              <p className="text-xl font-semibold text-emerald-600 font-mono">{metrics ? fmtCurrency(metrics.recoveredRevenue) : "—"}</p>
              <p className="text-[10px] text-muted-foreground" title="Revenue recovered after the invoice entered the recovery program - not automatically incremental revenue.">{metrics ? `${metrics.recoveredInvoices} invoice${metrics.recoveredInvoices === 1 ? "" : "s"}` : "—"}</p>
            </Card>
            <Card className="p-4 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Recovery Rate</p>
              <p className="text-xl font-semibold text-foreground font-mono">{recoveryRate != null ? `${recoveryRate.toFixed(1)}%` : "—"}</p>
              <p className="text-[10px] text-muted-foreground">Recovered ÷ eligible cohort balance</p>
            </Card>
            <Card className="p-4 space-y-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Staff Hours Saved</p>
                <span className="text-[9px] font-medium bg-slate-100 text-slate-600 px-1 rounded">Estimated</span>
              </div>
              <p className="text-xl font-semibold text-foreground font-mono">{metrics ? metrics.staffHoursSaved.toFixed(1) : "—"}</p>
              <p className="text-[10px] text-muted-foreground" title="Automated contacts × assumed manual minutes per follow-up ÷ 60, from Settings.">{metrics ? fmtCurrency(metrics.labourSavings) : "—"} in labour savings</p>
            </Card>
            <Card className="p-4 space-y-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Est. Net Value</p>
                <span className="text-[9px] font-medium bg-slate-100 text-slate-600 px-1 rounded">Estimated</span>
              </div>
              <p className="text-xl font-semibold text-foreground font-mono">{netValue != null ? fmtCurrency(netValue) : "—"}</p>
              <p className="text-[10px] text-muted-foreground" title="Estimated incremental recovery + labour savings − automation cost.">
                {metrics?.estimatedIncrementalRecovery == null ? "Excludes incremental recovery (no baseline yet)" : "Incremental recovery + savings − cost"}
              </p>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Needs Staff Attention</h3>
                {staffAttention.length > 0 && <button onClick={() => setActiveTab("invoices")} className="text-[10px] text-primary font-medium hover:underline">View all</button>}
              </div>
              {staffAttention.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No accounts need attention right now.</p>
              ) : (
                <div className="divide-y divide-border">
                  {staffAttention.map(inv => (
                    <div key={inv.invoiceId} className="px-4 py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-medium text-foreground">{inv.patientName}</p>
                        <p className="text-[10px] text-muted-foreground">{fmtCurrency(inv.amountDue)} · {inv.daysOverdue}d overdue · {R_INVOICE_STATUS_LABEL[inv.status] ?? humanizeSnake(inv.status)}</p>
                      </div>
                      <button onClick={() => setActiveTab("invoices")} className="text-[10px] font-medium text-primary hover:underline">Open</button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
              </div>
              {activity.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No recovery activity yet.</p>
              ) : (
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {activity.slice(0, 10).map(a => (
                    <div key={a.id} className="px-4 py-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{a.patientName || humanizeSnake(a.type)}</span>
                        <span className="text-[10px] text-muted-foreground">{fmtDate(a.timestamp)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{a.summary || humanizeSnake(a.type)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === "queue" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 bg-muted border border-border rounded-md p-1 w-fit">
              {["pending", "approved", "completed", "cancelled", "failed"].map(f => (
                <button key={f} onClick={() => setQueueFilter(f)} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${queueFilter === f ? "bg-card shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>{humanizeSnake(f)}</button>
              ))}
            </div>
            {selectedQueueIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{selectedQueueIds.size} selected</span>
                <button
                  onClick={() => {
                    const ids = [...selectedQueueIds];
                    const total = queue.filter(q => ids.includes(q.queueId)).reduce((s, q) => s + q.amountDue, 0);
                    askConfirm("Approve selected calls?", `${ids.length} patient${ids.length === 1 ? "" : "s"}, ${fmtCurrency(total)} total balance. These will be dispatched for outbound calling once submitted.`, () => approveQueueIds(ids));
                  }}
                  className="text-[10px] font-medium bg-primary text-primary-foreground px-2.5 py-1.5 rounded-md hover:opacity-90"
                >
                  Approve selected
                </button>
                <button
                  onClick={() => { const ids = [...selectedQueueIds]; askConfirm("Reject selected calls?", `${ids.length} call candidate${ids.length === 1 ? "" : "s"} will be rejected and not dispatched.`, () => rejectQueueIds(ids)); }}
                  className="text-[10px] font-medium border border-border px-2.5 py-1.5 rounded-md hover:bg-muted"
                >
                  Reject selected
                </button>
              </div>
            )}
          </div>

          <Card className="overflow-hidden">
            {filteredQueue.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">No calls in this view.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-2.5"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded" /></th>
                    {["Patient", "Invoices", "Balance", "Days Overdue", "Stage", "Scheduled", "Approval", "Status", ""].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.map(q => {
                    const selectable = q.approval === "pending" && !["cancelled_paid", "cancelled_hold"].includes(q.queueStatus);
                    return (
                      <tr key={q.queueId} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5">{selectable && <input type="checkbox" checked={selectedQueueIds.has(q.queueId)} onChange={() => toggleQueueSelect(q.queueId)} className="rounded" />}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground">{q.patientName}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{q.invoiceNumbers.length > 1 ? `${q.invoiceNumbers.length} invoices` : q.invoiceNumbers[0] ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-foreground">{fmtCurrency(q.amountDue)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{q.daysOverdue}d</td>
                        <td className="px-4 py-2.5"><RPill label={q.callStage === "day_14" ? "Day 14" : "Day 7"} tone="blue" /></td>
                        <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(q.scheduledFor)}</td>
                        <td className="px-4 py-2.5"><RPill label={humanizeSnake(q.approval)} tone={q.approval === "approved" ? "green" : q.approval === "rejected" ? "red" : "amber"} /></td>
                        <td className="px-4 py-2.5"><RPill label={R_QUEUE_STATUS_LABEL[q.queueStatus] ?? humanizeSnake(q.queueStatus)} tone={q.queueStatus === "completed" ? "green" : q.queueStatus === "failed" ? "red" : "gray"} /></td>
                        <td className="px-4 py-2.5">
                          {q.approval === "pending" && (
                            <div className="flex gap-1">
                              <button onClick={() => askConfirm("Approve this call?", `${q.patientName}, ${fmtCurrency(q.amountDue)}.`, () => approveQueueIds([q.queueId]))} className="text-[10px] font-medium text-primary hover:underline">Approve</button>
                              <button onClick={() => askConfirm("Reject this call?", `${q.patientName} will not be called for this cycle.`, () => rejectQueueIds([q.queueId]))} className="text-[10px] font-medium text-muted-foreground hover:text-destructive">Reject</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {activeTab === "invoices" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice # or patient…" className="bg-card border border-border rounded-md pl-8 pr-3 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex items-center gap-1 bg-muted border border-border rounded-md p-1 w-fit">
              {["all", "unpaid", "paid", "attention", "hold"].map(f => (
                <button key={f} onClick={() => setInvoiceFilter(f)} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${invoiceFilter === f ? "bg-card shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>{f === "all" ? "All" : R_INVOICE_STATUS_LABEL[f] ?? humanizeSnake(f)}</button>
              ))}
            </div>
          </div>

          <Card className="overflow-hidden">
            {filteredInvoices.length === 0 ? (
              <p className="text-xs text-muted-foreground py-10 text-center">No invoices match this view.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Invoice", "Patient", "Contact", "Balance", "Due", "Overdue", "Stage", "Status", ""].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map(inv => (
                    <tr key={inv.invoiceId} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-foreground">{inv.invoiceNumber}</td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{inv.patientName}</td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono">{inv.phoneMasked || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-foreground">{fmtCurrency(inv.amountDue)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(inv.dueDate)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{inv.daysOverdue}d</td>
                      <td className="px-4 py-2.5"><RPill label={R_STAGE_LABEL[inv.stage] ?? humanizeSnake(inv.stage)} tone="blue" /></td>
                      <td className="px-4 py-2.5"><RPill label={R_INVOICE_STATUS_LABEL[inv.status] ?? humanizeSnake(inv.status)} tone={inv.status === "paid" ? "green" : inv.status === "staff_attention" || inv.status === "failed" ? "red" : inv.manualHold ? "gray" : "amber"} /></td>
                      <td className="px-4 py-2.5">
                        {inv.status !== "paid" && (
                          <div className="flex gap-1.5">
                            {inv.manualHold ? (
                              <button onClick={() => invoiceAction("resume", inv)} className="text-[10px] font-medium text-primary hover:underline">Resume</button>
                            ) : (
                              <button onClick={() => askConfirm("Place on hold?", `${inv.patientName} will be paused from further recovery contact.`, () => invoiceAction("hold", inv))} className="text-[10px] font-medium text-muted-foreground hover:text-foreground">Hold</button>
                            )}
                            <button onClick={() => invoiceAction("reconcile", inv)} className="text-[10px] font-medium text-muted-foreground hover:text-foreground">Reconcile</button>
                            <button onClick={() => askConfirm("Escalate to staff?", `${inv.patientName} will be flagged for manual staff follow-up.`, () => invoiceAction("escalate", inv))} className="text-[10px] font-medium text-muted-foreground hover:text-destructive">Escalate</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {activeTab === "calls" && (
        <div className="space-y-4">
          <div className="flex items-center gap-1 bg-muted border border-border rounded-md p-1 w-fit">
            <button onClick={() => setCallsSubTab("calls")} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${callsSubTab === "calls" ? "bg-card shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>Call Outcomes</button>
            <button onClick={() => setCallsSubTab("activity")} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${callsSubTab === "activity" ? "bg-card shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>All Activity</button>
          </div>

          {callsSubTab === "calls" ? (
            <Card className="overflow-hidden">
              {calls.length === 0 ? (
                <p className="text-xs text-muted-foreground py-10 text-center">Call outcomes will appear after the first completed call.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {["Patient", "Date/Time", "Stage", "Outcome", "Duration", "Balance", "Paid After", "Staff Follow-up"].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map(c => (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-foreground">{c.patientName}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(c.timestamp)}</td>
                        <td className="px-4 py-2.5"><RPill label={c.stage === "day_14" ? "Day 14" : "Day 7"} tone="blue" /></td>
                        <td className="px-4 py-2.5"><RPill label={humanizeSnake(c.outcome) || "—"} tone={R_OUTCOME_TONE[c.outcome] ?? "gray"} /></td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground">{c.duration || "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-foreground">{fmtCurrency(c.balance)}</td>
                        <td className="px-4 py-2.5">{c.paidAfterward ? <RPill label="Paid" tone="green" /> : "—"}</td>
                        <td className="px-4 py-2.5">{c.staffFollowup ? <RPill label="Needed" tone="amber" /> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {activity.length === 0 ? (
                <p className="text-xs text-muted-foreground py-10 text-center">No recovery activity occurred yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {activity.map(a => (
                    <div key={a.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-medium text-foreground">{a.patientName || humanizeSnake(a.type)}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{a.summary || humanizeSnake(a.type)}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-3">{fmtDate(a.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {activeTab === "settings" && (
        <div className="max-w-2xl space-y-4">
          <Card className="p-5 space-y-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Automation Controls</p>
            {[
              ["ai_calls_enabled", "Enable AI calls"],
              ["day_7_enabled", "Enable Day-7 calls"],
              ["day_14_enabled", "Enable Day-14 calls"],
              ["require_manual_approval", "Require manual approval"],
              ["weekend_calls_enabled", "Enable weekend calls"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center justify-between py-1.5 border-b border-border last:border-0 text-xs">
                <span className="text-foreground">{label}</span>
                <input
                  type="checkbox"
                  checked={parseBoolean(settings?.[key])}
                  onChange={e => setSettings(prev => ({ ...(prev ?? {}), [key]: e.target.checked }))}
                  className="rounded"
                />
              </label>
            ))}
          </Card>
          <Card className="p-5 space-y-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Financial Assumptions</p>
            {[
              ["manual_minutes_per_followup", "Manual minutes per follow-up"],
              ["loaded_hourly_cost", "Loaded staff hourly cost ($)"],
              ["monthly_platform_cost", "Monthly allocated platform cost ($)"],
            ].map(([key, label]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-foreground">{label}</label>
                <input
                  type="number"
                  value={safeText(settings?.[key])}
                  onChange={e => setSettings(prev => ({ ...(prev ?? {}), [key]: e.target.value }))}
                  className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ))}
          </Card>
          <button
            onClick={async () => {
              const ok = await postAction("/recovery/settings", settings ?? {});
              showToast(ok ? "Settings saved." : "Could not reach the recovery workflow.");
              if (ok) refetch();
            }}
            disabled={actionBusy}
            className="bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50"
          >
            Save Settings
          </button>
          <button
            onClick={() => askConfirm("Pause all calls?", "This immediately stops all outbound recovery calls for every patient until re-enabled.", async () => {
              const ok = await postAction("/recovery/settings", { ...(settings ?? {}), ai_calls_enabled: false });
              showToast(ok ? "All calls paused." : "Could not reach the recovery workflow.");
              if (ok) refetch();
            })}
            className="ml-2 text-xs font-medium text-destructive border border-destructive/30 px-4 py-2 rounded-md hover:bg-red-50"
          >
            Pause All Calls
          </button>
        </div>
      )}
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
  "activity": ActivityScreen,
  "settings": SettingsScreen,
  "outbound-make-call": MakeCallScreen,
  "outbound-call-logs": OutboundCallLogsScreen,
  "outbound-transcripts": OutboundTranscriptsScreen,
  "outbound-recordings": OutboundRecordingsScreen,
  "outbound-analytics": OutboundAnalyticsScreen,
  "payment-recovery": PaymentRecoveryScreen,
  "billing": BillingScreen,
};

// Legacy access-token links (/t/:token) are retired (server/index.js 410s
// the whole /api/link/* surface) - the dashboard is session-only now.
// Visiting an old /t/:token URL still loads this SPA (it's just a path,
// unhandled by any router), but AppGate no longer treats it specially, so
// it renders the same login gate as every other URL.
export default function App() {
  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  );
}

function AppGate() {
  const { session, authLoading } = useAuth();
  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!session) return <LoginScreen />;
  return <DashboardShell />;
}

function DashboardShell() {
  const { session, logout } = useAuth();
  const [activeNav, setActiveNav] = useState("overview");
  // Always null now that /t/:token access is retired - kept as a variable
  // (rather than deleted outright) because apiFetch/identityReady below
  // still branch on it, and a null accessToken is exactly what routes them
  // through the session-based /api/dashboard/* path.
  const accessToken: string | null = null;
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [staffTasks, setStaffTasks] = useState<StaffTask[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsPoint[]>([]);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [outboundOverview, setOutboundOverview] = useState<OverviewStats | null>(null);
  const [invoices, setInvoices] = useState<UsageInvoice[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Legacy mode has its own /tenant + /queue/requests + /settings endpoints
  // per access-token link; session mode derives the same information from
  // the session itself (tenantId/activeClinicId) plus the public settings
  // endpoint - there's no per-clinic "/tenant" concept to fetch separately.
  const identityReady = Boolean(accessToken) || Boolean(session);
  const csrfToken = session?.csrfToken;

  useEffect(() => {
    if (!identityReady) return;
    setLoading(true);
    const failed = { ok: false, status: 0, json: null as any };
    Promise.all([
      accessToken ? fetch(`/api/link/${accessToken}/tenant`).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
      apiFetch(accessToken, csrfToken, "/queue/requests").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/settings").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/inbound/calls").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/inbound/transcripts").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/inbound/analytics").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/inbound/overview").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/inbound/invoices").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/outbound/overview").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/outbound/calls").then(safeJson).catch(() => failed),
      apiFetch(accessToken, csrfToken, "/outbound/transcripts").then(safeJson).catch(() => failed),
    ])
      .then(([tenant, queueRes, settingsRes, callsRes, transcriptsRes, analyticsRes, overviewRes, invoicesRes, outboundOverviewRes, outboundCallsRes, outboundTranscriptsRes]) => {
        const savedSettings = settingsRes.json;
        if (accessToken) {
          if (tenant) setTenantInfo(tenant);
          setSettings(savedSettings ?? {});
        } else if (savedSettings && typeof savedSettings === "object") {
          // The production public-config response is the clinic_configs row
          // (tenant_id/clinic_name/...) plus a nested `settings` object of
          // saved sections - not the flat per-section bag the legacy
          // /settings endpoint returns, so both need deriving from it.
          const cfg = savedSettings as Record<string, unknown>;
          setTenantInfo({
            client_id: String(cfg.tenant_id ?? session?.tenantId ?? ""),
            clinic_id: String(cfg.clinic_id ?? session?.activeClinicId ?? ""),
            clinic_name: String(cfg.clinic_name ?? ""),
            receptionist_name: "Grace",
            link_label: String(cfg.clinic_name ?? session?.activeClinicId ?? ""),
          });
          setSettings((cfg.settings && typeof cfg.settings === "object" ? cfg.settings : {}) as Record<string, unknown>);
          setConnectionStatus({
            hasJuvonnoApiKey: cfg.has_juvonno_api_key === true,
            juvonnoBaseUrl: String(cfg.juvonno_base_url ?? ""),
            defaultBranchCode: String(cfg.default_branch_code ?? ""),
            retellReceptionistAgentId: String(cfg.retell_receptionist_agent_id ?? ""),
            retellReceptionistPhoneNumber: String(cfg.retell_receptionist_phone_number ?? ""),
            retellOutboundAgentId: String(cfg.retell_outbound_agent_id ?? ""),
            retellOutboundPhoneNumber: String(cfg.retell_outbound_phone_number ?? ""),
            retellRecoveryAgentId: String(cfg.retell_recovery_agent_id ?? ""),
            retellRecoveryPhoneNumber: String(cfg.retell_recovery_phone_number ?? ""),
            timezone: String(cfg.timezone ?? ""),
          });
        }
        const requests = queueRes.json;
        setStaffTasks(Array.isArray(requests) ? requests.map(mapAppointmentRequest) : []);
        const callsJson = callsRes.json, transcriptsJson = transcriptsRes.json, analyticsJson = analyticsRes.json;
        const overviewJson = overviewRes.json, invoicesJson = invoicesRes.json, outboundOverviewJson = outboundOverviewRes.json;
        const outboundCallsJson = outboundCallsRes.json, outboundTranscriptsJson = outboundTranscriptsRes.json;
        const inboundCalls = Array.isArray(callsJson?.calls) ? callsJson.calls.map((c: Record<string, unknown>) => mapInboundCall(c, "inbound")) : [];
        const outboundCalls = Array.isArray(outboundCallsJson?.calls) ? outboundCallsJson.calls.map((c: Record<string, unknown>) => mapInboundCall(c, "outbound")) : [];
        setCallLogs([...inboundCalls, ...outboundCalls]);
        const inboundTranscripts = Array.isArray(transcriptsJson?.transcripts) ? transcriptsJson.transcripts.map((t: Record<string, unknown>) => mapInboundTranscript(t, "inbound")) : [];
        const outboundTranscripts = Array.isArray(outboundTranscriptsJson?.transcripts) ? outboundTranscriptsJson.transcripts.map((t: Record<string, unknown>) => mapInboundTranscript(t, "outbound")) : [];
        setTranscripts([...inboundTranscripts, ...outboundTranscripts]);
        setAnalytics(Array.isArray(analyticsJson) ? analyticsJson : []);
        setOverview(overviewJson && !overviewJson.error ? overviewJson : null);
        setInvoices(Array.isArray(invoicesJson?.invoices) ? invoicesJson.invoices : []);
        setOutboundOverview(outboundOverviewJson && !outboundOverviewJson.error ? outboundOverviewJson : null);

        // A failed fetch and a genuinely empty clinic must never look the
        // same - surface one prioritized error banner instead of silently
        // rendering dashes/"no data yet" for what's actually an integration
        // or access failure (handoff §5). 401 takes priority over 403 over
        // everything else, since "you're logged out" is the most actionable.
        const coreResults = [queueRes, settingsRes, overviewRes, callsRes];
        const failures = coreResults.filter(r => !r.ok);
        if (failures.length > 0) {
          const rank = (s: number) => (s === 401 ? 0 : s === 403 ? 1 : 2);
          const worst = [...failures].sort((a, b) => rank(a.status) - rank(b.status))[0];
          setLoadError(describeLoadFailure(worst.status));
        } else {
          setLoadError(null);
        }
      })
      .catch(() => setLoadError("Some dashboard data could not be loaded."))
      .finally(() => setLoading(false));
  }, [identityReady, accessToken, csrfToken]);

  // Staff Action Queue needs new requests to show up without a manual
  // refresh, so poll it quietly in the background (no loading spinner).
  // Skipped while the tab is hidden - a background tab doesn't need live
  // data, and every open tab runs this independently, so an 8s cadence
  // across a few tabs was enough to trip the n8n workflow's Google Sheets
  // rate limit (429 "too many requests" on Read Billing/Calls nodes).
  useEffect(() => {
    if (!identityReady) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      apiFetch(accessToken, csrfToken, "/queue/requests")
        .then(r => r.ok ? r.json() : null)
        .then(requests => { if (Array.isArray(requests)) setStaffTasks(requests.map(mapAppointmentRequest)); })
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [identityReady, accessToken, csrfToken]);

  // Inbound Tracker data (calls/transcripts/analytics/overview/invoices)
  // should reflect new calls without a manual refresh too - poll it quietly
  // in the background, same pattern as the Staff Action Queue above. This
  // fires 8 parallel n8n requests per tick, each reading one or more Google
  // Sheets tabs, so it's the main contributor to Sheets rate-limit errors -
  // keep this interval well above the staff-queue one and skip it entirely
  // while the tab is hidden.
  useEffect(() => {
    if (!identityReady) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      Promise.all([
        apiFetch(accessToken, csrfToken, "/inbound/calls").then(r => r.ok ? r.json() : null),
        apiFetch(accessToken, csrfToken, "/inbound/transcripts").then(r => r.ok ? r.json() : null),
        apiFetch(accessToken, csrfToken, "/inbound/analytics").then(r => r.ok ? r.json() : null),
        apiFetch(accessToken, csrfToken, "/inbound/overview").then(r => r.ok ? r.json() : null),
        apiFetch(accessToken, csrfToken, "/inbound/invoices").then(r => r.ok ? r.json() : null),
        apiFetch(accessToken, csrfToken, "/outbound/overview").then(r => r.ok ? r.json() : null).catch(() => null),
        apiFetch(accessToken, csrfToken, "/outbound/calls").then(r => r.ok ? r.json() : null).catch(() => null),
        apiFetch(accessToken, csrfToken, "/outbound/transcripts").then(r => r.ok ? r.json() : null).catch(() => null),
      ])
        .then(([callsRes, transcriptsRes, analyticsRes, overviewRes, invoicesRes, outboundOverviewRes, outboundCallsRes, outboundTranscriptsRes]) => {
          if (Array.isArray(callsRes?.calls) || Array.isArray(outboundCallsRes?.calls)) {
            const inboundCalls = Array.isArray(callsRes?.calls) ? callsRes.calls.map((c: Record<string, unknown>) => mapInboundCall(c, "inbound")) : [];
            const outboundCalls = Array.isArray(outboundCallsRes?.calls) ? outboundCallsRes.calls.map((c: Record<string, unknown>) => mapInboundCall(c, "outbound")) : [];
            setCallLogs([...inboundCalls, ...outboundCalls]);
          }
          if (Array.isArray(transcriptsRes?.transcripts) || Array.isArray(outboundTranscriptsRes?.transcripts)) {
            const inboundTranscripts = Array.isArray(transcriptsRes?.transcripts) ? transcriptsRes.transcripts.map((t: Record<string, unknown>) => mapInboundTranscript(t, "inbound")) : [];
            const outboundTranscripts = Array.isArray(outboundTranscriptsRes?.transcripts) ? outboundTranscriptsRes.transcripts.map((t: Record<string, unknown>) => mapInboundTranscript(t, "outbound")) : [];
            setTranscripts([...inboundTranscripts, ...outboundTranscripts]);
          }
          if (Array.isArray(analyticsRes)) setAnalytics(analyticsRes);
          if (overviewRes && !overviewRes.error) setOverview(overviewRes);
          if (Array.isArray(invoicesRes?.invoices)) setInvoices(invoicesRes.invoices);
          if (outboundOverviewRes && !outboundOverviewRes.error) setOutboundOverview(outboundOverviewRes);
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [identityReady, accessToken, csrfToken]);

  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  async function refreshOverview() {
    if (!identityReady) return;
    setOverviewRefreshing(true);
    try {
      const [res, outboundRes] = await Promise.all([
        apiFetch(accessToken, csrfToken, "/inbound/overview"),
        apiFetch(accessToken, csrfToken, "/outbound/overview").catch(() => null),
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

  // Approve is cancellation-approval only - it re-fetches the appointment
  // from Juvonno, cancels it if not already, and verifies the cancelled
  // state before marking the request completed. A 200 response alone isn't
  // success; only trust request_status==="completed" && provider_confirmed.
  async function approveTask(id: string): Promise<{ success: boolean; response?: string; errorCode?: string }> {
    if (!identityReady) return { success: false };
    const res = await apiFetch(accessToken, csrfToken, `/queue/requests/${id}/approve`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    const ok = res.ok && json.success === true && json.request_status === "completed" && json.provider_confirmed === true;
    if (ok) setStaffTasks(prev => prev.map(t => t.id === id ? { ...t, status: "Completed" } : t));
    return { success: ok, response: json.response, errorCode: json.error_code };
  }

  // An HTTP 200 from n8n does not mean the mutation actually happened - the
  // envelope can be { success: false, error_code: ... } (not found, wrong
  // status, forbidden, etc.) inside a 200. Only json.success === true means
  // the row actually changed; res.ok alone was updating the UI on requests
  // n8n had silently refused.
  async function rejectTask(id: string, resolutionCode?: string, resolutionNote?: string): Promise<boolean> {
    if (!identityReady) return false;
    const res = await apiFetch(accessToken, csrfToken, `/queue/requests/${id}/reject`, { method: "POST", body: { resolutionCode, resolutionNote } });
    const json = await res.json().catch(() => ({}));
    const ok = res.ok && json.success === true;
    if (ok) setStaffTasks(prev => prev.map(t => t.id === id ? { ...t, status: "Rejected" } : t));
    return ok;
  }

  async function assignTask(id: string, assignedUserId: string): Promise<boolean> {
    if (!identityReady) return false;
    const res = await apiFetch(accessToken, csrfToken, `/queue/requests/${id}/assign`, { method: "POST", body: { assignedUserId } });
    const json = await res.json().catch(() => ({}));
    const ok = res.ok && json.success === true;
    if (ok) setStaffTasks(prev => prev.map(t => t.id === id ? { ...t, status: "In Progress", assignee: assignedUserId } : t));
    return ok;
  }

  // Archive replaces delete - there is no hard-delete route for requests
  // anymore (FRONTEND-BFF-HANDOFF.md).
  async function archiveTask(id: string, resolutionNote?: string): Promise<boolean> {
    if (!identityReady) return false;
    const res = await apiFetch(accessToken, csrfToken, `/queue/requests/${id}/archive`, { method: "POST", body: { resolutionNote } });
    const json = await res.json().catch(() => ({}));
    const ok = res.ok && json.success === true;
    if (ok) setStaffTasks(prev => prev.filter(t => t.id !== id));
    return ok;
  }

  // Session mode has no distinct /settings/bulk or /settings-section write -
  // the production Settings Backend workflow takes one consolidated
  // PUT /settings body (handoff §8). Legacy still has per-section PATCH-like
  // semantics via POST /settings, so this only special-cases the difference.
  async function saveSection(section: string, data: Record<string, unknown>): Promise<boolean> {
    if (!identityReady) return false;
    try {
      const res = accessToken
        ? await fetch(`/api/link/${accessToken}/settings`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ section, data }),
          })
        : await apiFetch(accessToken, csrfToken, "/settings", { method: "PUT", body: { settings: { [section]: data } } });
      if (!res.ok) return false;
      if (accessToken) {
        // Legacy response echoes the server's FULL settings, but responses
        // from different sections' saves can arrive out of order (e.g. this
        // save and an unrelated section's save fired close together). Only
        // trust this response for the section we actually just saved -
        // otherwise a slightly-stale response for another section can
        // silently overwrite newer local data for a section it never touched.
        const updated: Record<string, unknown> = await res.json();
        setSettings(prev => ({ ...prev, [section]: updated[section] }));
      } else {
        // The production Settings Backend's save response is a save
        // confirmation (has_juvonno_api_key, retell assignments, etc.), not
        // an echo of the settings JSON - apply what we already know we sent.
        setSettings(prev => ({ ...prev, [section]: data }));
      }
      return true;
    } catch {
      return false;
    }
  }

  // No session-mode equivalent to legacy's /settings/bulk - the production
  // save endpoint takes one section per call already via saveSection above.
  // Bulk-saves multiple sections sequentially instead of inventing a new
  // n8n contract for this.
  async function saveBulk(sections: Record<string, unknown>) {
    if (!identityReady) return;
    if (accessToken) {
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
      return;
    }
    for (const [section, data] of Object.entries(sections)) {
      await saveSection(section, data as Record<string, unknown>);
    }
  }

  async function syncRetell(): Promise<{ ok: boolean; error?: string }> {
    if (!accessToken) return { ok: false, error: 'Not available - Retell sync is a legacy-link-only action.' };
    const res = await fetch(`/api/link/${accessToken}/settings/retell-sync`, { method: 'POST' });
    const json = await res.json();
    return res.ok ? { ok: true } : { ok: false, error: json.error ?? 'Sync failed' };
  }

  const Screen = SCREENS[activeNav] ?? OverviewScreen;

  if (!identityReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Lock size={20} className="text-muted-foreground" />
          </div>
          <h1 className="text-sm font-semibold text-foreground">Not signed in</h1>
          <p className="text-xs text-muted-foreground max-w-xs">Sign in to view this dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardContext.Provider value={{ accessToken, tenantInfo, staffTasks, callLogs, transcripts, analytics, overview, outboundOverview, overviewRefreshing, refreshOverview, invoices, loading, settings, connectionStatus, loadError, approveTask, rejectTask, assignTask, archiveTask, saveSection, saveBulk, syncRetell }}>
      <div
        className="flex h-screen w-screen overflow-hidden bg-background"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        <Sidebar active={activeNav} onNav={setActiveNav} />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <TopBar />
          {loadError && !loading && (
            <div className="flex items-center gap-2 bg-destructive/10 border-b border-destructive/30 text-destructive text-xs px-4 py-2">
              <AlertTriangle size={13} className="flex-shrink-0" />
              <span>{loadError}</span>
            </div>
          )}
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
