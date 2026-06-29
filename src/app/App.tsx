import { useState } from "react";
import {
  LayoutDashboard, Bot, PhoneCall, FileText, Mic, BarChart2, TrendingUp,
  ClipboardList, Heart, Settings, CreditCard, Activity, ChevronDown,
  Bell, HelpCircle, Search, User, Circle, CheckCircle2, AlertCircle,
  XCircle, Clock, ArrowUpRight, ArrowDownRight, Minus, Play, Pause,
  Download, Flag, Send, ChevronRight, Phone, Star, Zap, Shield,
  RefreshCw, Eye, EyeOff, Edit2, Trash2, Plus, Filter, Calendar,
  MoreHorizontal, Inbox, AlertTriangle, Check, X, Volume2, List, Columns,
  Lock, Unlock, Info, UploadCloud, MessageSquare, Users, Globe, Mail,
  Building2, Wifi, WifiOff, Database, Server, Layers, ToggleLeft,
  ToggleRight, ChevronLeft
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area
} from "recharts";

// ── Palette helpers ──────────────────────────────────────────────────────────
const TEAL = "#0D9488";
const PURPLE = "#7C3AED";
const INDIGO = "#6366F1";
const AMBER = "#F59E0B";
const RED = "#EF4444";
const GREEN = "#10B981";
const SLATE = "#64748B";

// ── Sample data ──────────────────────────────────────────────────────────────
const callsOverTime = [
  { day: "Mon", calls: 42, bookings: 18 },
  { day: "Tue", calls: 58, bookings: 27 },
  { day: "Wed", calls: 51, bookings: 22 },
  { day: "Thu", calls: 67, bookings: 31 },
  { day: "Fri", calls: 74, bookings: 35 },
  { day: "Sat", calls: 38, bookings: 14 },
  { day: "Sun", calls: 19, bookings: 7 },
];

const outcomeData = [
  { name: "Booked", value: 154, color: GREEN },
  { name: "Transferred", value: 48, color: PURPLE },
  { name: "FAQ Answered", value: 72, color: TEAL },
  { name: "Staff Action", value: 31, color: AMBER },
  { name: "Failed", value: 12, color: RED },
];

const sentimentData = [
  { name: "Positive", value: 182, color: GREEN },
  { name: "Neutral", value: 98, color: SLATE },
  { name: "Negative", value: 29, color: AMBER },
];

const sentimentOverTime = [
  { day: "Mon", score: 4.1 },
  { day: "Tue", score: 4.3 },
  { day: "Wed", score: 3.8 },
  { day: "Thu", score: 4.2 },
  { day: "Fri", score: 4.5 },
  { day: "Sat", score: 4.4 },
  { day: "Sun", score: 4.6 },
];

const topServices = [
  { service: "Chiropractic", requests: 87 },
  { service: "Physiotherapy", requests: 73 },
  { service: "Massage Therapy", requests: 61 },
  { service: "Pelvic Physio", requests: 38 },
  { service: "Stretch Therapy", requests: 24 },
];

const callLogs = [
  { id: 1, time: "2024-06-28 10:02", caller: "Aaryan Anjan", phone: "+1 604-555-0142", type: "New Patient", service: "Chiropractic", provider: "Dr. Jasjit Khaira", outcome: "Booked", sentiment: "Positive", duration: "3:24", staffAction: false },
  { id: 2, time: "2024-06-28 10:18", caller: "Mei Tanaka", phone: "+1 604-555-0287", type: "Existing", service: "Massage Therapy", provider: "Ariel Zohar", outcome: "Booked", sentiment: "Positive", duration: "2:47", staffAction: false },
  { id: 3, time: "2024-06-28 10:35", caller: "David Osei", phone: "+1 604-555-0391", type: "Existing", service: "Physiotherapy", provider: "Sharisse Dukhu", outcome: "Transferred", sentiment: "Neutral", duration: "1:58", staffAction: false },
  { id: 4, time: "2024-06-28 10:52", caller: "Priya Singh", phone: "+1 604-555-0445", type: "New Patient", service: "Pelvic Physio", provider: "Priya Kaushal", outcome: "Staff Action", sentiment: "Negative", duration: "5:12", staffAction: true },
  { id: 5, time: "2024-06-28 11:07", caller: "Marcus Webb", phone: "+1 604-555-0563", type: "Existing", service: "Chiropractic", provider: "Dr. Jasjit Khaira", outcome: "FAQ Answered", sentiment: "Neutral", duration: "1:23", staffAction: false },
  { id: 6, time: "2024-06-28 11:24", caller: "Fatima Al-Hassan", phone: "+1 604-555-0672", type: "New Patient", service: "Stretch Therapy", provider: "Kulwinder Chohan", outcome: "Booked", sentiment: "Positive", duration: "4:01", staffAction: false },
  { id: 7, time: "2024-06-28 11:39", caller: "James Okonkwo", phone: "+1 604-555-0714", type: "Existing", service: "Physiotherapy", provider: "Sabreen Sanghera", outcome: "Failed", sentiment: "Negative", duration: "6:43", staffAction: true },
  { id: 8, time: "2024-06-28 11:55", caller: "Lena Kovacs", phone: "+1 604-555-0823", type: "New Patient", service: "Massage Therapy", provider: "Ariel Zohar", outcome: "Booked", sentiment: "Positive", duration: "3:15", staffAction: false },
];

const staffTasks = [
  { id: 1, patient: "Priya Singh", phone: "+1 604-555-0445", type: "Reschedule Request", summary: "Patient unable to attend Friday appointment, requests Monday morning slot", sentiment: "Negative", priority: "High", due: "2:00 PM", assignee: "Front Desk", status: "New" },
  { id: 2, patient: "James Okonkwo", phone: "+1 604-555-0714", type: "Failed Booking", summary: "API error during booking — patient needs callback to confirm slot", sentiment: "Negative", priority: "High", due: "1:30 PM", assignee: "Sharisse Dukhu", status: "In Progress" },
  { id: 3, patient: "Anika Patel", phone: "+1 604-555-0916", type: "Cancellation Request", summary: "Patient cancelling 2 PM massage due to illness. Needs rebooking next week.", sentiment: "Neutral", priority: "Medium", due: "3:00 PM", assignee: "Front Desk", status: "New" },
  { id: 4, patient: "Ryan Cho", phone: "+1 604-555-1027", type: "Billing Question", summary: "Asked about insurance coverage for pelvic physio — transferred to staff, call missed", sentiment: "Neutral", priority: "Low", due: "EOD", assignee: "Billing Admin", status: "New" },
  { id: 5, patient: "Nadia Hussain", phone: "+1 604-555-1138", type: "Complaint", summary: "Patient frustrated with appointment wait time, wants to speak to manager", sentiment: "Negative", priority: "High", due: "12:00 PM", assignee: "Manager", status: "Completed" },
];

const transcripts = [
  { id: 1, time: "2024-06-28 10:02", caller: "Aaryan Anjan", outcome: "Booked", sentiment: "Positive", service: "Chiropractic", duration: "3:24", preview: "Hi, I'd like to book a chiropractic appointment..." },
  { id: 2, time: "2024-06-28 10:52", caller: "Priya Singh", outcome: "Staff Action", sentiment: "Negative", service: "Pelvic Physio", duration: "5:12", preview: "I've been waiting for a callback and nobody is helping..." },
  { id: 3, time: "2024-06-28 11:39", caller: "James Okonkwo", outcome: "Failed", sentiment: "Negative", service: "Physiotherapy", duration: "6:43", preview: "The system said it booked but I never got a confirmation..." },
];

const sampleTranscriptLines = [
  { speaker: "Grace (AI)", text: "Thank you for calling Recoup Health. This is Grace. How can I help you today?" },
  { speaker: "Caller", text: "Hi, I'd like to book a chiropractic appointment with Dr. Khaira if possible." },
  { speaker: "Grace (AI)", text: "Absolutely! I can help with that. Are you a new or existing patient with us?" },
  { speaker: "Caller", text: "I'm an existing patient. My name is Aaryan Anjan." },
  { speaker: "Grace (AI)", text: "Great, let me look you up in our system. Could you please confirm your date of birth for verification?" },
  { speaker: "Caller", text: "Sure, it's March 12th, 1990." },
  { speaker: "Grace (AI)", text: "Perfect, I've found your record. Dr. Khaira has availability this Thursday at 10:30 AM or Friday at 2:00 PM. Which works better for you?" },
  { speaker: "Caller", text: "Thursday at 10:30 works great." },
  { speaker: "Grace (AI)", text: "Wonderful! I've booked you in for Thursday, June 29th at 10:30 AM with Dr. Jasjit Khaira for a chiropractic session. You'll receive a confirmation text shortly. Is there anything else I can help you with?" },
  { speaker: "Caller", text: "No, that's perfect. Thank you!" },
  { speaker: "Grace (AI)", text: "You're welcome! We'll see you Thursday. Have a great day!" },
];

const errorLogs = [
  { id: 1, time: "2024-06-28 11:39", fn: "book_appointment", clinic: "Recoup Health", error: "API Timeout", status: "Failed", retry: "3/3", notes: "Juvonno unresponsive", action: "Review" },
  { id: 2, time: "2024-06-28 09:14", fn: "lookup_patient", clinic: "Recoup Health", error: "404 Not Found", status: "Resolved", retry: "1/3", notes: "New patient, no record", action: "None" },
  { id: 3, time: "2024-06-27 16:52", fn: "check_availability", clinic: "Recoup Health", error: "Rate Limit", status: "Resolved", retry: "2/3", notes: "Retried successfully", action: "None" },
];

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
const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "ai-receptionist", label: "AI Receptionist", icon: Bot },
  { id: "call-logs", label: "Call Logs", icon: PhoneCall },
  { id: "transcripts", label: "Transcripts", icon: FileText },
  { id: "recordings", label: "Recordings", icon: Mic },
  { id: "analytics", label: "Analytics", icon: BarChart2 },
  { id: "staff-queue", label: "Staff Action Queue", icon: ClipboardList, badge: 4 },
  { id: "sentiment", label: "Sentiment Insights", icon: Heart },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "billing", label: "Billing & Usage", icon: CreditCard },
  { id: "integration", label: "Integration Health", icon: Activity },
];

function Sidebar({ active, onNav }: { active: string; onNav: (id: string) => void }) {
  return (
    <div className="w-[240px] min-h-screen bg-sidebar flex flex-col flex-shrink-0">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center">
            <Bot size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-none">NAP Clinic</p>
            <p className="text-[10px] text-sidebar-foreground opacity-60 mt-0.5">Automation Dashboard</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            onClick={() => onNav(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors text-sm ${
              active === id
                ? "bg-violet-600/20 text-white font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
            }`}
          >
            <Icon size={15} className={active === id ? "text-violet-400" : ""} />
            <span className="flex-1">{label}</span>
            {badge && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center text-xs text-white font-semibold">SK</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">Sabreen Sanghera</p>
            <p className="text-[10px] text-sidebar-foreground opacity-60">Manager</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────────
function TopBar() {
  return (
    <div className="h-14 bg-card border-b border-border flex items-center px-6 gap-4 flex-shrink-0">
      <div className="flex items-center gap-2 bg-muted border border-border rounded-md px-3 py-1.5 min-w-[160px] cursor-pointer hover:bg-accent transition-colors">
        <Building2 size={13} className="text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Recoup Health</span>
        <ChevronDown size={12} className="text-muted-foreground ml-auto" />
      </div>
      <div className="flex items-center gap-2 bg-muted border border-border rounded-md px-3 py-1.5 cursor-pointer hover:bg-accent transition-colors">
        <Calendar size={13} className="text-muted-foreground" />
        <span className="text-sm text-foreground">Jun 22 – Jun 28</span>
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
        <button className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-xs text-white font-semibold">SS</button>
      </div>
    </div>
  );
}

// ── Screen: Overview ─────────────────────────────────────────────────────────
function OverviewScreen() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Overview</h1>
          <p className="text-xs text-muted-foreground">Week of June 22 – 28, 2024 · Recoup Health</p>
        </div>
        <button className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 transition-opacity">
          <Download size={13} /> Export Report
        </button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Total Calls Handled" value="317" sub="This week" icon={PhoneCall} trend="+12%" color="purple" />
        <KpiCard label="Bookings Created" value="154" sub="Via AI" icon={CheckCircle2} trend="+8%" color="teal" />
        <KpiCard label="Missed Calls Recovered" value="28" sub="Converted to bookings" icon={RefreshCw} trend="+5%" color="green" />
        <KpiCard label="Transfers to Staff" value="48" sub="15% transfer rate" icon={ArrowUpRight} trend="-3%" color="amber" />
        <KpiCard label="Appointment Lookups" value="89" sub="Existing patients" icon={Search} trend="+6%" color="indigo" />
        <KpiCard label="Availability Checks" value="124" sub="Unique queries" icon={Calendar} trend="+14%" color="purple" />
        <KpiCard label="Cancellation Requests" value="19" sub="Staff notified" icon={XCircle} trend="+2%" color="amber" />
        <KpiCard label="Reschedule Requests" value="24" sub="Staff notified" icon={Clock} trend="+1%" color="amber" />
        <KpiCard label="Avg Sentiment Score" value="4.2 / 5" sub="↑ From 3.9 last week" icon={Heart} trend="+0.3" color="green" />
        <KpiCard label="Est. Revenue Booked" value="$18,480" sub="At avg $120/visit" icon={ArrowUpRight} trend="+10%" color="teal" />
        <KpiCard label="Admin Hours Saved" value="43.5 hrs" sub="Est. @ 8 min/call" icon={Clock} trend="+12%" color="purple" />
        <KpiCard label="AI Success Rate" value="96.2%" sub="Function success" icon={Zap} trend="+0.8%" color="green" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Calls & Bookings Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={callsOverTime}>
              <defs>
                <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PURPLE} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={PURPLE} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bookGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={TEAL} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={TEAL} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E8EAF6" }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="calls" stroke={PURPLE} strokeWidth={2} fill="url(#callGrad)" name="Calls" />
              <Area type="monotone" dataKey="bookings" stroke={TEAL} strokeWidth={2} fill="url(#bookGrad)" name="Bookings" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Call Outcomes</h3>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={outcomeData} cx="50%" cy="50%" innerRadius={45} outerRadius={72} dataKey="value" strokeWidth={0}>
                  {outcomeData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 flex-1">
              {outcomeData.map((d) => (
                <div key={d.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-xs text-foreground">{d.name}</span>
                  </div>
                  <span className="text-xs font-semibold text-foreground font-mono">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Bookings by Day</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={callsOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="bookings" fill={TEAL} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Sentiment Breakdown</h3>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={sentimentData} cx="50%" cy="50%" innerRadius={45} outerRadius={72} dataKey="value" strokeWidth={0}>
                  {sentimentData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2 flex-1">
              {sentimentData.map((d) => (
                <div key={d.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-xs text-foreground">{d.name}</span>
                  </div>
                  <span className="text-xs font-semibold text-foreground font-mono">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Recent Calls */}
        <div className="col-span-2">
          <Card>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Recent Calls</h3>
              <button className="text-xs text-primary font-medium hover:underline">View All</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Time", "Caller", "Service", "Outcome", "Sentiment", "Duration"].map(h => (
                      <th key={h} className="text-left px-4 py-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {callLogs.slice(0, 5).map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{c.time.split(" ")[1]}</td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{c.caller}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{c.service}</td>
                      <td className="px-4 py-2.5"><Badge label={c.outcome} variant={c.outcome} /></td>
                      <td className="px-4 py-2.5"><Badge label={c.sentiment} variant={c.sentiment} /></td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground">{c.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* AI Health Card */}
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">AI Receptionist Health</h3>
            <Badge label="Active" variant="Active" />
          </div>
          <div className="space-y-2.5 text-xs">
            {[
              ["Agent Name", "Grace"],
              ["Status", "Live"],
              ["Last Call", "11:55 AM today"],
              ["Last Booking", "11:07 AM today"],
              ["Function Success", "96.2%"],
              ["Phone Number", "+1 604-555-0100"],
              ["Connected Clinic", "Recoup Health"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-foreground">{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto pt-2 grid grid-cols-2 gap-2">
            <button className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-md hover:opacity-90">Test Agent</button>
            <button className="bg-muted text-foreground text-xs font-medium px-3 py-1.5 rounded-md hover:bg-accent transition-colors border border-border">Pause Agent</button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Screen: AI Receptionist ───────────────────────────────────────────────────
function AIReceptionistScreen() {
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

  const activity = [
    { text: "Booked chiropractic appointment for Aaryan Anjan", time: "2 min ago", icon: CheckCircle2, color: "text-emerald-600" },
    { text: "Checked availability for massage therapy on Thursday", time: "14 min ago", icon: Calendar, color: "text-violet-600" },
    { text: "Sent reschedule request to front desk — Priya Singh", time: "31 min ago", icon: Send, color: "text-amber-600" },
    { text: "Transferred billing question to front desk", time: "47 min ago", icon: ArrowUpRight, color: "text-indigo-600" },
    { text: "Logged negative sentiment call for review — James Okonkwo", time: "1h ago", icon: AlertCircle, color: "text-red-500" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">AI Receptionist — Grace</h1>
          <p className="text-xs text-muted-foreground">Recoup Health · Live mode · Last updated Jun 28, 2024</p>
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
              ["Clinic", "Recoup Health"],
              ["Phone", "+1 604-555-0100"],
              ["Voice", "Alloy (Female)"],
              ["Language", "English"],
              ["Mode", "Live"],
              ["Agent ID", "agent_jkx7r2"],
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
            { label: "Calls Today", value: "31", icon: PhoneCall, color: "purple" },
            { label: "Bookings Today", value: "14", icon: CheckCircle2, color: "teal" },
            { label: "Avg Duration", value: "3:12", icon: Clock, color: "indigo" },
            { label: "Transfer Rate", value: "14%", icon: ArrowUpRight, color: "amber" },
            { label: "Failed Call Rate", value: "2.1%", icon: XCircle, color: "red" },
            { label: "Avg Sentiment", value: "4.3/5", icon: Heart, color: "green" },
            { label: "Revenue Today", value: "$1,680", icon: ArrowUpRight, color: "teal" },
            { label: "Tasks Created", value: "3", icon: ClipboardList, color: "amber" },
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
            {activity.map((a, i) => (
              <div key={i} className="flex gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors">
                <a.icon size={13} className={`${a.color} flex-shrink-0 mt-0.5`} />
                <div>
                  <p className="text-xs text-foreground leading-snug">{a.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{a.time}</p>
                </div>
              </div>
            ))}
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

// ── Screen: Call Logs ─────────────────────────────────────────────────────────
function CallLogsScreen() {
  const [selectedCall, setSelectedCall] = useState<typeof callLogs[0] | null>(null);

  return (
    <div className="p-6 space-y-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Call Logs</h1>
        <button className="flex items-center gap-2 bg-muted border border-border text-sm font-medium px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
          <Download size={13} /> Export CSV
        </button>
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

      <div className="grid grid-cols-4 gap-4">
        {/* Table */}
        <div className="col-span-3">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Date/Time", "Caller", "Phone", "Type", "Service", "Provider", "Outcome", "Sentiment", "Duration", ""].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {callLogs.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedCall(c)}
                      className={`border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors ${selectedCall?.id === c.id ? "bg-violet-50" : ""}`}
                    >
                      <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap">{c.time}</td>
                      <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">{c.caller}</td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{c.phone}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{c.type}</td>
                      <td className="px-3 py-2.5 text-foreground whitespace-nowrap">{c.service}</td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{c.provider.split(" ").slice(-1)[0]}</td>
                      <td className="px-3 py-2.5"><Badge label={c.outcome} variant={c.outcome} /></td>
                      <td className="px-3 py-2.5"><Badge label={c.sentiment} variant={c.sentiment} /></td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{c.duration}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          <button className="p-1 hover:text-primary transition-colors" title="Recording"><Volume2 size={12} /></button>
                          <button className="p-1 hover:text-primary transition-colors" title="Transcript"><FileText size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Call Detail Panel */}
        <div>
          {selectedCall ? (
            <Card className="p-4 space-y-3 sticky top-0">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Call Detail</h3>
                <button onClick={() => setSelectedCall(null)} className="p-1 hover:bg-muted rounded"><X size={13} /></button>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-semibold text-sm">{selectedCall.caller[0]}</div>
                  <div>
                    <p className="font-semibold text-foreground">{selectedCall.caller}</p>
                    <p className="text-muted-foreground font-mono">{selectedCall.phone}</p>
                  </div>
                </div>
                {[
                  ["Date/Time", selectedCall.time],
                  ["Duration", selectedCall.duration],
                  ["Type", selectedCall.type],
                  ["Service", selectedCall.service],
                  ["Provider", selectedCall.provider],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium text-foreground text-right">{v}</span>
                  </div>
                ))}
                <div className="flex justify-between py-1.5 border-b border-border">
                  <span className="text-muted-foreground">Outcome</span>
                  <Badge label={selectedCall.outcome} variant={selectedCall.outcome} />
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Sentiment</span>
                  <Badge label={selectedCall.sentiment} variant={selectedCall.sentiment} />
                </div>
              </div>
              {/* Mock audio player */}
              <div className="bg-muted rounded-lg p-3 flex items-center gap-3">
                <button className="w-7 h-7 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                  <Play size={11} className="text-white ml-0.5" />
                </button>
                <div className="flex-1">
                  <div className="h-1 bg-border rounded-full overflow-hidden">
                    <div className="h-full w-1/3 bg-primary rounded-full" />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>1:08</span><span>{selectedCall.duration}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button className="bg-primary text-primary-foreground text-xs py-1.5 rounded-md hover:opacity-90">Mark Reviewed</button>
                <button className="bg-muted border border-border text-xs py-1.5 rounded-md hover:bg-accent transition-colors">Create Task</button>
                <button className="bg-muted border border-border text-xs py-1.5 rounded-md hover:bg-accent transition-colors">Flag Issue</button>
                <button className="bg-teal-50 text-teal-700 border border-teal-200 text-xs py-1.5 rounded-md hover:bg-teal-100 transition-colors">Send Follow-up</button>
              </div>
            </Card>
          ) : (
            <Card className="p-6 flex flex-col items-center justify-center gap-2 text-center h-48">
              <PhoneCall size={24} className="text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">Select a call to view details</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Screen: Transcripts ───────────────────────────────────────────────────────
function TranscriptsScreen() {
  const [selected, setSelected] = useState(transcripts[0]);
  const [masked, setMasked] = useState(false);

  return (
    <div className="p-6 h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Transcripts</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
            {masked ? <EyeOff size={13} className="text-muted-foreground" /> : <Eye size={13} className="text-muted-foreground" />}
            Mask Sensitive Info
            <div onClick={() => setMasked(!masked)} className={`w-8 h-4 rounded-full transition-colors cursor-pointer ${masked ? "bg-primary" : "bg-switch-background"} flex items-center px-0.5`}>
              <div className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${masked ? "translate-x-4" : "translate-x-0"}`} />
            </div>
          </label>
          <button className="flex items-center gap-2 bg-muted border border-border text-xs font-medium px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
            <Download size={12} /> Export
          </button>
        </div>
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
            {transcripts.map((t) => (
              <div
                key={t.id}
                onClick={() => setSelected(t)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${selected.id === t.id ? "border-primary/50 bg-violet-50" : "border-border bg-card hover:bg-muted/40"}`}
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
        <Card className="flex-1 flex flex-col min-h-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-sm font-semibold text-foreground">{selected.caller}</p>
              <p className="text-xs text-muted-foreground">{selected.time} · {selected.service} · {selected.duration}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge label={selected.outcome} variant={selected.outcome} />
              <Badge label={selected.sentiment} variant={selected.sentiment} />
            </div>
          </div>
          {/* AI summary */}
          <div className="px-5 py-3 bg-violet-50 border-b border-border flex-shrink-0">
            <p className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide mb-1">AI Summary</p>
            <p className="text-xs text-foreground">Existing patient called to book a chiropractic appointment with Dr. Khaira. Identity verified successfully. Thursday 10:30 AM slot confirmed. Positive experience throughout the call. No staff action required.</p>
          </div>
          {/* Transcript lines */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {sampleTranscriptLines.map((line, i) => (
              <div key={i} className={`flex gap-3 ${line.speaker === "Caller" ? "flex-row-reverse" : ""}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${line.speaker === "Caller" ? "bg-slate-200 text-slate-600" : "bg-violet-100 text-violet-700"}`}>
                  {line.speaker[0]}
                </div>
                <div className={`max-w-md ${line.speaker === "Caller" ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                  <span className="text-[10px] text-muted-foreground">{line.speaker}</span>
                  <div className={`text-xs px-3 py-2 rounded-lg ${line.speaker === "Caller" ? "bg-muted text-foreground" : "bg-violet-100 text-violet-900"}`}>
                    {masked && line.speaker === "Caller" ? line.text.replace(/\b(March|1990|\d{3}-\d{4})\b/g, "████") : line.text}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Screen: Analytics ─────────────────────────────────────────────────────────
function AnalyticsScreen() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold text-foreground">Analytics</h1>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Total Calls" value="317" icon={PhoneCall} trend="+12%" color="purple" />
        <KpiCard label="Avg Call Duration" value="3m 12s" icon={Clock} trend="-0:14" color="teal" />
        <KpiCard label="AI Success Rate" value="96.2%" icon={Zap} trend="+0.8%" color="green" />
        <KpiCard label="Revenue Estimate" value="$18,480" icon={ArrowUpRight} trend="+10%" color="amber" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Calls by Day</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={callsOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="calls" fill={PURPLE} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Top Services Requested</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={topServices} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis type="number" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="service" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} width={100} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="requests" fill={TEAL} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Sentiment Score Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={sentimentOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis domain={[3, 5]} tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Line type="monotone" dataKey="score" stroke={GREEN} strokeWidth={2} dot={{ fill: GREEN, r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">AI Success Rate Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={[
              { day: "Mon", rate: 94 }, { day: "Tue", rate: 97 }, { day: "Wed", rate: 95 },
              { day: "Thu", rate: 96 }, { day: "Fri", rate: 98 }, { day: "Sat", rate: 96 }, { day: "Sun", rate: 97 }
            ]}>
              <defs>
                <linearGradient id="rateGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={INDIGO} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={INDIGO} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis domain={[90, 100]} tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Area type="monotone" dataKey="rate" stroke={INDIGO} strokeWidth={2} fill="url(#rateGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Failed booking reasons */}
      <Card>
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Failed Booking Reasons</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["Reason", "Count", "% of Failures", "Most Affected Service", "Trend"].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["API Timeout / Juvonno Error", "5", "41.7%", "Physiotherapy", "+2"],
              ["No Availability Found", "4", "33.3%", "Chiropractic", "0"],
              ["Patient Verification Failed", "2", "16.7%", "Massage Therapy", "-1"],
              ["Invalid Service Requested", "1", "8.3%", "Pelvic Physio", "0"],
            ].map(([reason, count, pct, svc, trend]) => (
              <tr key={reason} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium text-foreground">{reason}</td>
                <td className="px-4 py-2.5 font-mono text-foreground">{count}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{pct}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{svc}</td>
                <td className="px-4 py-2.5"><span className={Number(trend) > 0 ? "text-red-500" : Number(trend) < 0 ? "text-emerald-500" : "text-muted-foreground"}>{trend === "0" ? "—" : trend}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Screen: Trends ────────────────────────────────────────────────────────────
function TrendsScreen() {
  const insights = [
    { icon: Clock, color: "violet", title: "Peak Call Times", body: "Most calls this week happened between 10 AM and 1 PM, with a secondary peak at 3–4 PM." },
    { icon: Star, color: "teal", title: "Most Requested Service", body: "Chiropractic leads with 87 requests (+11% vs last week). Massage therapy close behind at 61." },
    { icon: User, color: "indigo", title: "Most Requested Provider", body: "Dr. Jasjit Khaira is the most requested provider, accounting for 34% of all provider-specific calls." },
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
        <p className="text-xs text-muted-foreground mt-0.5">AI-generated insights from this week's call data · Recoup Health</p>
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
function StaffQueueScreen() {
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const columns = [
    { status: "New", tasks: staffTasks.filter(t => t.status === "New") },
    { status: "In Progress", tasks: staffTasks.filter(t => t.status === "In Progress") },
    { status: "Completed", tasks: staffTasks.filter(t => t.status === "Completed") },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Staff Action Queue</h1>
          <p className="text-xs text-muted-foreground">{staffTasks.filter(t => t.status !== "Completed").length} open tasks · 1 urgent</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded-md overflow-hidden">
            <button onClick={() => setView("kanban")} className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${view === "kanban" ? "bg-primary text-white" : "bg-card hover:bg-muted text-foreground"}`}>
              <Columns size={12} /> Kanban
            </button>
            <button onClick={() => setView("table")} className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${view === "table" ? "bg-primary text-white" : "bg-card hover:bg-muted text-foreground"}`}>
              <List size={12} /> Table
            </button>
          </div>
          <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-md hover:opacity-90">
            <Plus size={12} /> Add Task
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {["All", "New", "In Progress", "High Priority", "Cancellations", "Failed Bookings"].map((f) => (
          <button key={f} className="text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors font-medium">{f}</button>
        ))}
      </div>

      {view === "kanban" ? (
        <div className="grid grid-cols-3 gap-4">
          {columns.map(({ status, tasks }) => (
            <div key={status}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-foreground">{status}</span>
                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">{tasks.length}</span>
              </div>
              <div className="space-y-3">
                {tasks.map((task) => (
                  <Card key={task.id} className="p-3 space-y-2.5 hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground leading-snug">{task.type}</p>
                      <Badge label={task.priority} variant={task.priority} />
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">{task.summary}</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-[9px] font-bold">{task.patient[0]}</div>
                      <span className="text-[10px] font-medium text-foreground">{task.patient}</span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-border">
                      <div className="flex items-center gap-1.5">
                        <Badge label={task.sentiment} variant={task.sentiment} />
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock size={9} /> {task.due}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Assigned: {task.assignee}</span>
                      <div className="flex gap-1">
                        <button className="p-1 hover:text-primary transition-colors"><CheckCircle2 size={11} /></button>
                        <button className="p-1 hover:text-muted-foreground transition-colors"><MoreHorizontal size={11} /></button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Patient", "Type", "Priority", "Sentiment", "Due", "Assignee", "Status", ""].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffTasks.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{t.patient}</p>
                    <p className="text-muted-foreground font-mono">{t.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-foreground">{t.type}</td>
                  <td className="px-4 py-3"><Badge label={t.priority} variant={t.priority} /></td>
                  <td className="px-4 py-3"><Badge label={t.sentiment} variant={t.sentiment} /></td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{t.due}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.assignee}</td>
                  <td className="px-4 py-3"><Badge label={t.status} variant={t.status} /></td>
                  <td className="px-4 py-3">
                    <button className="p-1 hover:text-primary transition-colors"><MoreHorizontal size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── Screen: Sentiment Insights ────────────────────────────────────────────────
function SentimentScreen() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold text-foreground">Sentiment Insights</h1>

      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Avg Score", value: "4.2/5", color: "green" },
          { label: "Positive", value: "182", color: "green" },
          { label: "Neutral", value: "98", color: "purple" },
          { label: "Negative", value: "29", color: "amber" },
          { label: "vs Last Week", value: "+0.3", color: "teal" },
        ].map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} icon={Heart} color={s.color} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Sentiment Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={sentimentOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis domain={[3, 5]} tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Line type="monotone" dataKey="score" stroke={GREEN} strokeWidth={2} dot={{ fill: GREEN, r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Sentiment by Service</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={topServices.map((s) => ({ ...s, score: (3.8 + Math.random() * 1).toFixed(1) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis dataKey="service" tick={{ fontSize: 10, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis domain={[3, 5]} tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Bar dataKey="score" fill={TEAL} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Review Calls */}
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Calls Needing Review</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Time", "Patient", "Sentiment", "Reason", "Outcome"].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { time: "11:39", patient: "James Okonkwo", sentiment: "Negative", reason: "Failed booking", outcome: "Failed" },
                { time: "10:52", patient: "Priya Singh", sentiment: "Negative", reason: "Wanted human staff", outcome: "Staff Action" },
                { time: "09:14", patient: "Nadia Hussain", sentiment: "Negative", reason: "Complaint", outcome: "Transferred" },
                { time: "08:47", patient: "Omar Ibrahim", sentiment: "Negative", reason: "Medical concern", outcome: "Transferred" },
              ].map((r) => (
                <tr key={r.patient} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{r.time}</td>
                  <td className="px-3 py-2.5 font-medium text-foreground">{r.patient}</td>
                  <td className="px-3 py-2.5"><Badge label={r.sentiment} variant={r.sentiment} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.reason}</td>
                  <td className="px-3 py-2.5"><Badge label={r.outcome} variant={r.outcome} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

// ── Screen: Recordings ────────────────────────────────────────────────────────
function RecordingsScreen() {
  const [playing, setPlaying] = useState<number | null>(null);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Recordings</h1>
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
            {callLogs.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">{c.time}</td>
                <td className="px-4 py-3 font-medium text-foreground">{c.caller}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.service}</td>
                <td className="px-4 py-3"><Badge label={c.outcome} variant={c.outcome} /></td>
                <td className="px-4 py-3"><Badge label={c.sentiment} variant={c.sentiment} /></td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{c.duration}</td>
                <td className="px-4 py-3"><span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={11} /> Consented</span></td>
                <td className="px-4 py-3 text-muted-foreground">90 days</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPlaying(playing === c.id ? null : c.id)}
                      className={`p-1.5 rounded-md transition-colors ${playing === c.id ? "bg-primary text-white" : "hover:bg-muted text-muted-foreground"}`}
                    >
                      {playing === c.id ? <Pause size={11} /> : <Play size={11} />}
                    </button>
                    <button className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"><Download size={11} /></button>
                    <button className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"><Flag size={11} /></button>
                    <button className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"><Trash2 size={11} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {playing && (
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setPlaying(null)} className="w-9 h-9 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
              <Pause size={14} className="text-white" />
            </button>
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground mb-2">{callLogs.find(c => c.id === playing)?.caller} · {callLogs.find(c => c.id === playing)?.service}</p>
              <div className="h-2 bg-muted rounded-full overflow-hidden cursor-pointer">
                <div className="h-full w-2/5 bg-primary rounded-full transition-all" />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>1:18</span><span>{callLogs.find(c => c.id === playing)?.duration}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Volume2 size={14} className="text-muted-foreground" />
              <div className="w-20 h-1.5 bg-muted rounded-full"><div className="h-full w-3/4 bg-muted-foreground rounded-full" /></div>
            </div>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"><Download size={12} /> Download</button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Screen: Settings ──────────────────────────────────────────────────────────
function SettingsScreen() {
  const [activeSection, setActiveSection] = useState("Clinic Profile");
  const sections = [
    "Clinic Profile", "Clinic Hours", "Services", "Practitioners",
    "Booking Rules", "Transfer & Escalation", "Cancellation/Reschedule",
    "FAQs / Knowledge Base", "SMS Follow-Ups", "Voice & AI Personality",
    "Notifications", "Privacy & Compliance", "User Roles",
    "Juvonno Integration", "Billing Settings",
  ];

  return (
    <div className="p-6 flex gap-6">
      {/* Settings nav */}
      <div className="w-52 flex-shrink-0">
        <Card className="overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/40">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Settings</p>
          </div>
          <nav className="p-1.5 space-y-0.5">
            {sections.map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${activeSection === s ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted"}`}
              >
                {s}
              </button>
            ))}
          </nav>
        </Card>
      </div>

      {/* Settings form */}
      <div className="flex-1">
        {activeSection === "Clinic Profile" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Clinic Profile</h2>
              <button className="bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90">Save Changes</button>
            </div>
            <Card className="p-5">
              <div className="grid grid-cols-2 gap-4">
                {[
                  ["Clinic Name", "Recoup Health", "text"],
                  ["Phone Number", "+1 604-555-0100", "tel"],
                  ["SMS Number", "+1 604-555-0101", "tel"],
                  ["Email", "info@recouphealth.ca", "email"],
                  ["Website", "https://recouphealth.ca", "url"],
                  ["Main Contact", "Sabreen Sanghera", "text"],
                ].map(([label, val, type]) => (
                  <div key={label as string} className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">{label}</label>
                    <input defaultValue={val as string} type={type as string} className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Timezone</label>
                  <select className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>America/Vancouver (PST/PDT)</option>
                    <option>America/Toronto (EST/EDT)</option>
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Address</label>
                  <input defaultValue="3456 Oak Street, Vancouver, BC V6H 2L4" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeSection === "Clinic Hours" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Clinic Hours</h2>
              <button className="bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90">Save Changes</button>
            </div>
            <Card className="p-5 space-y-3">
              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, i) => (
                <div key={day} className="flex items-center gap-4">
                  <span className="text-xs font-medium text-foreground w-24">{day}</span>
                  <input type="checkbox" defaultChecked={i < 6} className="rounded" />
                  <input type="time" defaultValue={i < 6 ? "08:00" : undefined} className="bg-input-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input type="time" defaultValue={i < 5 ? "18:00" : i === 5 ? "14:00" : undefined} className="bg-input-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                  {i < 5 && <span className="text-[10px] text-muted-foreground">Lunch 12:00–13:00</span>}
                </div>
              ))}
            </Card>
          </div>
        )}

        {activeSection === "Juvonno Integration" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Juvonno Integration</h2>
              <div className="flex items-center gap-2">
                <Badge label="Connected" variant="Connected" />
                <button className="bg-muted border border-border text-xs font-medium px-3 py-1.5 rounded-md hover:bg-accent transition-colors">Request Change</button>
              </div>
            </div>
            <Card className="p-5 space-y-3">
              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <CheckCircle2 size={14} className="text-emerald-600" />
                <p className="text-xs text-emerald-700 font-medium">Juvonno API connected and healthy · Last sync 2 min ago</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ["Booking API", "✓ Operational"],
                  ["Lookup API", "✓ Operational"],
                  ["Availability API", "✓ Operational"],
                  ["Errors Today", "1 (resolved)"],
                ].map(([k, v]) => (
                  <div key={k} className="p-3 bg-muted rounded-lg flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium text-foreground">{v}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2">
                <div className="flex items-center gap-2 mb-3">
                  <Lock size={12} className="text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Technical settings below are managed by NAP admins.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["API Key", "••••••••••••jkx7"],
                    ["API Base URL", "https://api.juvonno.com/v2"],
                    ["Branch Code", "RH-001"],
                    ["Clinic/Company ID", "clinic_8472"],
                    ["Retell Agent ID", "agent_jkx7r2"],
                    ["Twilio Number", "+1 604-555-0100"],
                  ].map(([k, v]) => (
                    <div key={k} className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Lock size={10} /> {k}</label>
                      <input readOnly value={v as string} className="w-full bg-muted border border-border rounded-md px-3 py-2 text-xs text-muted-foreground cursor-not-allowed font-mono" />
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeSection === "Voice & AI Personality" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Voice & AI Personality</h2>
              <button className="bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90">Save Changes</button>
            </div>
            <Card className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Voice</label>
                  <select className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>Alloy (Female)</option>
                    <option>Echo (Male)</option>
                    <option>Nova (Female)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Speaking Style</label>
                  <select className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>Warm and professional</option>
                    <option>Formal</option>
                    <option>Casual and friendly</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Language</label>
                  <select className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>English</option>
                    <option>French</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Conversation Speed</label>
                  <select className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>Normal</option>
                    <option>Slightly slower</option>
                    <option>Slightly faster</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Greeting Message</label>
                <textarea rows={2} defaultValue="Thank you for calling Recoup Health. This is Grace. How can I help you today?" className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">After-Hours Greeting</label>
                <textarea rows={2} defaultValue="Thank you for calling Recoup Health. Our clinic is currently closed. Our hours are Monday to Friday 8 AM to 6 PM. Please call back during business hours or leave a message." className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Recording Consent Message</label>
                <textarea rows={2} defaultValue="This call may be recorded for quality assurance purposes." className="w-full bg-input-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
              </div>
            </Card>
          </div>
        )}

        {!["Clinic Profile", "Clinic Hours", "Juvonno Integration", "Voice & AI Personality"].includes(activeSection) && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">{activeSection}</h2>
              <button className="bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90">Save Changes</button>
            </div>
            <Card className="p-8 flex flex-col items-center justify-center gap-3 text-center">
              <Settings size={28} className="text-muted-foreground/30" />
              <p className="text-sm font-medium text-foreground">{activeSection}</p>
              <p className="text-xs text-muted-foreground max-w-xs">This settings section is ready to be configured. Click a field to begin editing your {activeSection.toLowerCase()} settings.</p>
              <button className="mt-2 bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded-md hover:opacity-90">Configure {activeSection}</button>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen: Billing & Usage ───────────────────────────────────────────────────
function BillingScreen() {
  const usageData = [
    { week: "W1", minutes: 210, calls: 72 },
    { week: "W2", minutes: 248, calls: 89 },
    { week: "W3", minutes: 195, calls: 68 },
    { week: "W4", minutes: 312, calls: 104 },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Billing & Usage</h1>
          <p className="text-xs text-muted-foreground">Billing cycle: June 1 – June 30, 2024</p>
        </div>
        <button className="flex items-center gap-2 bg-muted border border-border text-xs font-medium px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
          <Download size={12} /> Download Invoice
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Current Plan" value="Growth" sub="$299/mo · Renews Jul 1" icon={Star} color="purple" />
        <KpiCard label="Minutes Used" value="965" sub="of 1,000 included" icon={Clock} color="amber" />
        <KpiCard label="Calls Handled" value="317" sub="This cycle" icon={PhoneCall} color="teal" />
        <KpiCard label="Est. Overage" value="$0" sub="Within plan limits" icon={CreditCard} color="green" />
        <KpiCard label="SMS Sent" value="284" sub="Confirmations + follow-ups" icon={MessageSquare} color="indigo" />
        <KpiCard label="Estimated Invoice" value="$299.00" sub="Due July 1, 2024" icon={CreditCard} color="purple" />
        <KpiCard label="Revenue Booked by AI" value="$18,480" sub="Est. at $120 avg visit" icon={ArrowUpRight} color="green" />
        <KpiCard label="Admin Hours Saved" value="43.5 hrs" sub="Est. at 8 min/call" icon={Clock} color="teal" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Usage Over Time (June)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={usageData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8EAF6" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: SLATE }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="minutes" fill={PURPLE} radius={[4, 4, 0, 0]} name="Minutes" />
              <Bar dataKey="calls" fill={TEAL} radius={[4, 4, 0, 0]} name="Calls" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Plan Details</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">AI Minutes Used</span>
                <span className="font-semibold text-foreground font-mono">965 / 1,000</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full" style={{ width: "96.5%" }} />
              </div>
              <p className="text-[10px] text-amber-600 mt-1 font-medium">⚠ Approaching plan limit. 35 minutes remaining.</p>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">SMS Usage</span>
                <span className="font-semibold text-foreground font-mono">284 / 500</span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-teal-400 rounded-full" style={{ width: "56.8%" }} />
              </div>
            </div>
            <div className="pt-2 space-y-2 text-xs">
              {[
                ["Plan", "Growth"],
                ["Included Minutes", "1,000/mo"],
                ["Included SMS", "500/mo"],
                ["Overage Rate", "$0.08/min"],
                ["Billing Date", "July 1, 2024"],
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

// ── Screen: Integration Health ─────────────────────────────────────────────────
function IntegrationScreen() {
  const services = [
    { name: "Retell AI", status: "Connected", icon: Bot, detail: "Agent active · Last call 11:55 AM" },
    { name: "Juvonno API", status: "Connected", icon: Database, detail: "All functions operational · Last sync 2 min ago" },
    { name: "Twilio SMS", status: "Connected", icon: MessageSquare, detail: "284 SMS sent this cycle" },
    { name: "Booking Function", status: "Connected", icon: CheckCircle2, detail: "154 successful bookings this week" },
    { name: "Lookup Function", status: "Connected", icon: Search, detail: "89 lookups · 100% success rate" },
    { name: "Availability Function", status: "Connected", icon: Calendar, detail: "124 checks · 1 rate limit error (resolved)" },
    { name: "Webhook Handler", status: "Connected", icon: Server, detail: "All webhooks acknowledged" },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold text-foreground">Integration Health</h1>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Overall Health" value="98.7%" icon={Activity} color="green" />
        <KpiCard label="Function Success Rate" value="96.2%" icon={Zap} color="teal" />
        <KpiCard label="Errors Today" value="1" sub="1 resolved" icon={AlertCircle} color="amber" />
        <KpiCard label="Last Incident" value="3 days ago" icon={Clock} color="purple" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {services.map((s) => (
          <Card key={s.name} className="p-4 flex items-center gap-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.status === "Connected" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
              <s.icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground">{s.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{s.detail}</p>
            </div>
            <Badge label={s.status} variant={s.status} />
          </Card>
        ))}
      </div>

      {/* Error log */}
      <Card>
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Technical Error Log</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {["Timestamp", "Function", "Clinic", "Error Type", "Status", "Retries", "Notes", "Action"].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {errorLogs.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">{e.time}</td>
                <td className="px-4 py-3 text-foreground font-mono text-[10px]">{e.fn}</td>
                <td className="px-4 py-3 text-muted-foreground">{e.clinic}</td>
                <td className="px-4 py-3 text-red-600 font-medium">{e.error}</td>
                <td className="px-4 py-3"><Badge label={e.status} variant={e.status} /></td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{e.retry}</td>
                <td className="px-4 py-3 text-muted-foreground">{e.notes}</td>
                <td className="px-4 py-3">
                  {e.action === "Review" ? (
                    <button className="text-[10px] font-medium text-primary border border-primary/30 px-2 py-0.5 rounded hover:bg-primary hover:text-white transition-colors">Review</button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
const SCREENS: Record<string, React.FC> = {
  "overview": OverviewScreen,
  "ai-receptionist": AIReceptionistScreen,
  "call-logs": CallLogsScreen,
  "transcripts": TranscriptsScreen,
  "recordings": RecordingsScreen,
  "analytics": AnalyticsScreen,
  "staff-queue": StaffQueueScreen,
  "sentiment": SentimentScreen,
  "settings": SettingsScreen,
  "billing": BillingScreen,
  "integration": IntegrationScreen,
};

export default function App() {
  const [activeNav, setActiveNav] = useState("overview");
  const Screen = SCREENS[activeNav] ?? OverviewScreen;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-background"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <Sidebar active={activeNav} onNav={setActiveNav} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <Screen />
        </main>
      </div>
    </div>
  );
}
