"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { businessTypes, getBusinessProfile } from "./lib/business-types";
import type { BusinessType } from "./lib/business-types";
import "./contact-import.css";
import AdminPanel from "./AdminPanel";
import TeamAccessPanel from "./TeamAccessPanel";
import { AiOnboardingModal, AiReadinessCard, AiSimulatorModal } from "./AiOnboarding";
import "./ai-onboarding-actions.css";
import "./crm-units.css";
import "./notifications.css";
import "./team-access.css";
import CrmAnalytics from "./CrmAnalytics";
import type { AdSpendRecord } from "./CrmAnalytics";
import { STAGING_MODE } from "./lib/staging";
import OperationsHealth from "./OperationsHealth";

type Account = { user: { email: string }; company: { id: string; name: string }; role: string; subscription?: { status?: string; modules?: string[] } | null };
type Lead = {
  id: number; name: string; initials: string; phone: string; source: string; status: string; tone: string;
  unitName?: string; handoffPending?: boolean; handoffReason?: string; nextAction?: string; humanOwner?: string | null;
  time: string; updatedAt: string; summary: string; score: number; stage: string; aiPaused?: boolean;
  appointmentAt?: string | null; appointmentStatus?: string | null; imported?: boolean; contactOnly?: boolean; manualActionRequired?: boolean; student?: boolean;
  appointmentNotes?: string;
  opportunityValue?: number; soldPlan?: string; crmNotes?: string;
  contactAt?: string | null; stoppedRespondingAt?: string | null; nextActionAt?: string | null; convertedAt?: string | null; objection?: string;
  followupPlan?: FollowupPlan | null;
  automationState?: string; automationSnoozedUntil?: string | null; stoppedReason?: string;
  contactAttempts?: ContactAttempt[];
  qualification?: { serviceInterest?: unknown; experience?: unknown; motivation?: unknown; pain?: unknown; startTiming?: unknown; preferredPeriod?: unknown };
};
type ContactAttempt = { id: string; at: string; actor: "IA" | "Atendente" | "Contato"; type: string; preview: string };
type ChatMessage = { id: string; direction: "in" | "out"; text: string; at: string; author: string };
type Profile = {
  companyName: string; city: string; address: string; businessHours: string; services: string; prices: string;
  availablePeriods: string; cancellationPolicy: string; differentials: string; faq: string; toneGuidelines: string;
  qualificationQuestions: string[]; remindersEnabled: boolean; onboardingComplete: boolean; demo?: boolean;
  aiModel: "gpt-5.4-nano" | "gpt-5.4-mini" | "gpt-5.4"; groupMessages: boolean;
  groupingDelaySeconds: number; historyMessages: number;
  businessType: BusinessType;
  serviceHowItWorks: string; firstExperience: string; paymentMethods: string; promotionText: string; promotionExpiresAt: string;
  assistantGreeting: string; emojiStyle: "none" | "light" | "expressive"; commercialGoal: string; handoffInstructions: string;
  adSpendRecords: AdSpendRecord[];
};
type AiUsage = { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; responses: number; byModel: Record<string, number> };
type UnitProfile = { address: string; businessHours: string; availablePeriods: string; services: string; prices: string; paymentMethods: string; promotionText: string; cancellationPolicy: string };
type WhatsAppUnit = { id: string; name: string; instance?: string; connected: boolean; state: string; profile?: Partial<UnitProfile> };
type CrmDraft = { stage: string; source: string; soldPlan: string; opportunityValue: string; objection: string; crmNotes: string; contactAt: string; stoppedRespondingAt: string; nextActionAt: string; convertedAt: string };
type FollowupPlan = { id?: string; objective?: "recovery" | "reschedule"; status?: string; attempts?: number; cadence_days?: number; scheduled_at?: string[]; sent?: Array<{ attempt: number; scheduled_at: string; sent_at: string }> };
type Announcement = { id: string; title: string; message: string; expiresAt: string; createdAt: string };
type ContactImportResult = { found: number; imported: number; skipped: number; unsupported: number };

const stages = [
  { id: "novo", title: "Novo contato", color: "#41d879" },
  { id: "atendimento", title: "Em atendimento", color: "#47a7ff" },
  { id: "qualificado", title: "Qualificado", color: "#d6ee63" },
  { id: "agendamento", title: "Agendado", color: "#ffb84a" },
  { id: "compareceu", title: "Compareceu", color: "#7bdbce" },
  { id: "negociacao", title: "Negociação", color: "#9b83ff" },
  { id: "fechado", title: "Fechado", color: "#20c55a" },
  { id: "perdido", title: "Perdido", color: "#ff6f78" },
];

const defaultProfile: Profile = { companyName: "", city: "", address: "", businessHours: "", services: "", prices: "", availablePeriods: "", cancellationPolicy: "", differentials: "", faq: "", toneGuidelines: "Acolhedor, objetivo e profissional", qualificationQuestions: [], remindersEnabled: true, onboardingComplete: false, aiModel: "gpt-5.4-mini", groupMessages: true, groupingDelaySeconds: 5, historyMessages: 20, businessType: "pilates", serviceHowItWorks: "", firstExperience: "", paymentMethods: "", promotionText: "", promotionExpiresAt: "", assistantGreeting: "", emojiStyle: "light", commercialGoal: "", handoffInstructions: "", adSpendRecords: [] };
const aiModels = [
  { id: "gpt-5.4-nano" as const, name: "GPT-5.4 nano", badge: "Econômico", description: "Mais rápido e barato para alto volume e conversas simples.", input: "$0,20", output: "$1,25" },
  { id: "gpt-5.4-mini" as const, name: "GPT-5.4 mini", badge: "Recomendado", description: "Melhor equilíbrio entre qualidade, velocidade e custo para atendimento.", input: "$0,75", output: "$4,50" },
  { id: "gpt-5.4" as const, name: "GPT-5.4", badge: "Avançado", description: "Mais inteligente para situações complexas, com custo e tempo maiores.", input: "$2,50", output: "$15,00" },
];

const defaultTutorials = [
  { id: "GKZGCT-rWS4", number: "01", title: "Conheça o PilatIA", description: "Uma visão geral da plataforma e de como o PilatIA organiza o atendimento." },
  { id: "PTwliHuJy6s", number: "02", title: "Funções e operações do PilatIA", description: "Aprenda a utilizar os principais recursos da operação no dia a dia." },
  { id: "CQr55SQo_Bs", number: "03", title: "Gestão do PilatIA", description: "Veja como acompanhar contatos, atendimento, CRM e gestão da plataforma." },
];

const demoLeads: Lead[] = [
  { id: -1, name: "Mariana Lopes", initials: "ML", phone: "5511998764321", source: "Instagram", status: "Pronta para agendar", tone: "hot", time: "Hoje, 10:42", updatedAt: new Date().toISOString(), summary: "Primeira experiência • fortalecimento • quer começar agora • manhã", score: 92, stage: "agendamento", aiPaused: true, appointmentAt: new Date(Date.now() + 86400000).toISOString(), appointmentStatus: "confirmed" },
  { id: -2, name: "Carlos Eduardo", initials: "CE", phone: "5511987651234", source: "Google", status: "Em qualificação", tone: "active", time: "Hoje, 09:18", updatedAt: new Date(Date.now() - 3600000).toISOString(), summary: "Já fez Pilates • dor lombar • indicação médica", score: 74, stage: "qualificado" },
  { id: -3, name: "Ana Paula", initials: "AP", phone: "5511977889900", source: "WhatsApp", status: "Aguardando resposta", tone: "waiting", time: "Ontem, 18:35", updatedAt: new Date(Date.now() - 86400000).toISOString(), summary: "Postura e qualidade de vida • prefere noite", score: 66, stage: "atendimento" },
  { id: -4, name: "Rafael Silva", initials: "RS", phone: "5511966655443", source: "Indicação", status: "Novo contato", tone: "active", time: "Ontem, 16:10", updatedAt: new Date(Date.now() - 90000000).toISOString(), summary: "Qualificação iniciada", score: 35, stage: "novo" },
  { id: -5, name: "Beatriz Costa", initials: "BC", phone: "5511955544332", source: "Instagram", status: "Compareceu", tone: "hot", time: "12/07, 14:30", updatedAt: new Date(Date.now() - 172800000).toISOString(), summary: "Aula experimental concluída • negociação em andamento", score: 88, stage: "negociacao" },
  { id: -6, name: "João Mendes", initials: "JM", phone: "5511944433221", source: "Google", status: "Fechado", tone: "hot", time: "10/07, 11:20", updatedAt: new Date(Date.now() - 345600000).toISOString(), summary: "Plano mensal contratado", score: 100, stage: "fechado", soldPlan: "Plano mensal", opportunityValue: 350, crmNotes: "Contrato confirmado pela equipe." },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const formatWhen = (value?: string | null) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Horário pendente";
const dateKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

export default function Home() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState<{ companyName: string; email: string; password: string; businessType: BusinessType }>({ companyName: "", email: "", password: "", businessType: "pilates" });
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [active, setActive] = useState("Dashboard");
  const [activeRestored, setActiveRestored] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatMode, setChatMode] = useState<"ai" | "human">("ai");
  const [messageDraft, setMessageDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [aiUsage, setAiUsage] = useState<AiUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, responses: 0, byModel: {} });
  const [toast, setToast] = useState("");
  const [connected, setConnected] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [qrStatus, setQrStatus] = useState<"idle" | "loading" | "ready" | "connected" | "error">("idle");
  const [qrUnit, setQrUnit] = useState(0);
  const [connectionUnits, setConnectionUnits] = useState<WhatsAppUnit[]>([]);
  const [connectionLimit, setConnectionLimit] = useState(1);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [editingUnit, setEditingUnit] = useState<number | null>(null);
  const [aiPause, setAiPause] = useState<{ active: boolean; indefinite: boolean; until: string | null }>({ active: false, indefinite: false, until: null });
  const [aiPauseBusy, setAiPauseBusy] = useState(false);
  const [aiPauseUntilInput, setAiPauseUntilInput] = useState("");
  const [crmEditor, setCrmEditor] = useState<Lead | null>(null);
  const [crmDraft, setCrmDraft] = useState<CrmDraft>({ stage: "novo", source: "WhatsApp", soldPlan: "", opportunityValue: "", objection: "", crmNotes: "", contactAt: "", stoppedRespondingAt: "", nextActionAt: "", convertedAt: "" });
  const [crmView, setCrmView] = useState<"kanban" | "list">("kanban");
  const [followupObjective, setFollowupObjective] = useState<"recovery" | "reschedule">("recovery");
  const [followupAttempts, setFollowupAttempts] = useState(2);
  const [followupCadence, setFollowupCadence] = useState<"daily" | "three_days">("daily");
  const [followupFirstAt, setFollowupFirstAt] = useState("");
  const [followupBusy, setFollowupBusy] = useState(false);
  const [scheduleLead, setScheduleLead] = useState<Lead | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [manualContactName, setManualContactName] = useState("");
  const [manualContactPhone, setManualContactPhone] = useState("");
  const [dashboardRange, setDashboardRange] = useState("7");
  const [chatFilter, setChatFilter] = useState<"all" | "human" | "ai">("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [crmRange, setCrmRange] = useState("30");
  const [crmStart, setCrmStart] = useState("");
  const [crmEnd, setCrmEnd] = useState("");
  const [search, setSearch] = useState("");
  const [contactView, setContactView] = useState<"all" | "leads" | "students">("all");
  const [agendaMode, setAgendaMode] = useState<"month" | "week" | "day">("month");
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [broadcastSegment, setBroadcastSegment] = useState("scheduled");
  const [broadcastRange, setBroadcastRange] = useState("30");
  const [broadcastStart, setBroadcastStart] = useState("");
  const [broadcastEnd, setBroadcastEnd] = useState("");
  const [broadcastStage, setBroadcastStage] = useState("all");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastMode, setBroadcastMode] = useState<"limit" | "manual">("limit");
  const [broadcastLimit, setBroadcastLimit] = useState(50);
  const [broadcastBatchSize, setBroadcastBatchSize] = useState(20);
  const [selectedBroadcastIds, setSelectedBroadcastIds] = useState<number[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialMinimized, setTutorialMinimized] = useState(false);
  const [tutorials, setTutorials] = useState(defaultTutorials);
  const [tutorialId, setTutorialId] = useState(defaultTutorials[0].id);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readAnnouncements, setReadAnnouncements] = useState<string[]>([]);
  const [handoffAlertsEnabled, setHandoffAlertsEnabled] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const sessionRefreshRef = useRef<Promise<boolean> | null>(null);
  const loadedCompanyRef = useRef("");
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToLatestMessageRef = useRef(true);
  const lastOpenedConversationRef = useRef("");
  const seenHandoffsRef = useRef<Set<number>>(new Set());
  const handoffAlertsReadyRef = useRef(false);

  const isPlatformAdmin = account?.role === "superadmin";
  const isCompanyAdmin = account?.role === "admin";
  const isDemo = isPlatformAdmin;
  const availableUnits = [...new Set(leads.map((lead) => lead.unitName).filter(Boolean) as string[])];
  const chatLeads = leads.filter((lead) => {
    if (lead.contactOnly) return false;
    const matchesSearch = `${lead.name} ${lead.phone}`.toLowerCase().includes(search.toLowerCase());
    const matchesMode = chatFilter === "all" || (chatFilter === "human" ? lead.aiPaused : !lead.aiPaused);
    return matchesSearch && matchesMode && (unitFilter === "all" || lead.unitName === unitFilter);
  });
  const selectedLead = chatLeads.find((lead) => lead.phone === selectedPhone) || chatLeads[0];
  const handoffLeads = leads.filter((lead) => lead.handoffPending && !lead.student && !lead.contactOnly);
  const currentBusiness = getBusinessProfile(profile.businessType);
  const currentTutorial = tutorials.find((tutorial) => tutorial.id === tutorialId) || tutorials[0];
  const notify = (text: string) => { setToast(text); window.setTimeout(() => setToast(""), 3000); };

  useEffect(() => {
    const savedPage = window.localStorage.getItem("pilatia_active_page");
    if (savedPage) setActive(savedPage);
    setActiveRestored(true);
  }, []);
  useEffect(() => {
    setHandoffAlertsEnabled(window.localStorage.getItem("pilatia_handoff_alerts") === "on");
  }, []);
  useEffect(() => {
    const pending = handoffLeads.map((lead) => lead.id);
    if (!handoffAlertsReadyRef.current) {
      seenHandoffsRef.current = new Set(pending);
      handoffAlertsReadyRef.current = true;
      return;
    }
    const fresh = handoffLeads.filter((lead) => !seenHandoffsRef.current.has(lead.id));
    fresh.forEach((lead) => {
      notify(`${lead.name} está aguardando um atendente`);
      if (handoffAlertsEnabled) {
        try {
          const audio = new AudioContext();
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          gain.gain.setValueAtTime(0.08, audio.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
          oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.35);
        } catch {}
        if ("Notification" in window && Notification.permission === "granted") new Notification("PilatIA · atendimento humano", { body: `${lead.name} concluiu a qualificação${lead.unitName ? ` · ${lead.unitName}` : ""}.` });
      }
    });
    seenHandoffsRef.current = new Set(pending);
  }, [handoffLeads.map((lead) => lead.id).join(","), handoffAlertsEnabled]);
  useEffect(() => {
    if (activeRestored) window.localStorage.setItem("pilatia_active_page", active);
  }, [active, activeRestored]);
  useEffect(() => {
    if (account && active === "Administração" && account.role !== "superadmin") setActive("Dashboard");
    if (account && account.role === "agent" && ["Agentes IA", "Conexões", "Qualificação", "Configurações"].includes(active)) setActive("Dashboard");
  }, [account, active]);
  const openSchedule = (lead: Lead | null = null) => {
    setScheduleLead(lead);
    setScheduleAt(lead?.appointmentAt ? new Date(lead.appointmentAt).toISOString().slice(0, 16) : "");
    setScheduleNotes(lead?.appointmentNotes || "");
    setManualContactName("");
    setManualContactPhone("");
    setScheduleOpen(true);
  };
  const closeSchedule = () => {
    setScheduleOpen(false); setScheduleLead(null); setScheduleAt(""); setScheduleNotes(""); setManualContactName(""); setManualContactPhone("");
  };

  const refreshAccount = async (logoutOnFailure = false) => {
    if (sessionRefreshRef.current) return sessionRefreshRef.current;
    const task = (async () => {
      try {
        const response = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: "no-store" });
        if (response.ok) { setAccount(await response.json()); return true; }
        if (logoutOnFailure && response.status === 401) setAccount(null);
        else if (logoutOnFailure) window.setTimeout(() => refreshAccount(true), 3000);
      } catch {
        if (logoutOnFailure) window.setTimeout(() => refreshAccount(true), 3000);
      }
      return false;
    })();
    sessionRefreshRef.current = task;
    try { return await task; } finally { if (sessionRefreshRef.current === task) sessionRefreshRef.current = null; }
  };

  const loadLeads = async (retrySession = true) => {
    const response = await fetch("/api/leads", { cache: "no-store" });
    if (response.status === 401) {
      if (retrySession && await refreshAccount(false)) await loadLeads(false);
      return;
    }
    if (!response.ok) return;
    const data = await response.json();
    const next = data.length ? data : isDemo ? demoLeads : [];
    setLeads(next);
    setSelectedPhone((current) => current || next[0]?.phone || "");
  };

  useEffect(() => { refreshAccount(true); }, []);
  useEffect(() => {
    const companyId = account?.company.id || "";
    if (!companyId || loadedCompanyRef.current === companyId) return;
    loadedCompanyRef.current = companyId;
    setLeads([]);
    setMessages([]);
    setSelectedPhone("");
    setProfile(defaultProfile);
    setImportResult(null);
  }, [account?.company.id]);
  useEffect(() => { if (!account) return; loadLeads(); const timer = window.setInterval(loadLeads, 15000); return () => window.clearInterval(timer); }, [account]);
  useEffect(() => {
    if (!account || isDemo) return;
    let busy = false;
    const resume = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      const valid = await refreshAccount(false);
      if (valid) await loadLeads();
      busy = false;
    };
    const visibility = () => { if (document.visibilityState === "visible") resume(); };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(resume, 20 * 60_000);
    return () => { window.removeEventListener("focus", resume); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", visibility); window.clearInterval(timer); };
  }, [account?.company.id, isDemo]);
  useEffect(() => { if (!account) return; fetch("/api/company-profile", { cache: "no-store" }).then(async (response) => { if (response.ok) setProfile({ ...defaultProfile, ...(await response.json()) }); }).catch(() => {}); }, [account?.company.id]);
  useEffect(() => { if (!account) return; try { setReadAnnouncements(JSON.parse(localStorage.getItem("pilatia_read_announcements") || "[]")); } catch {} fetch("/api/tutorials", { cache: "no-store" }).then(async (response) => { if (!response.ok) return; const payload = await response.json(); if (Array.isArray(payload.tutorials) && payload.tutorials.length) { const next = payload.tutorials.map((tutorial: any, index: number) => ({ id: String(tutorial.videoId), number: String(index + 1).padStart(2, "0"), title: String(tutorial.title), description: String(tutorial.description || "") })).filter((tutorial: any) => tutorial.id); if (next.length) { setTutorials(next); setTutorialId((current) => next.some((tutorial: any) => tutorial.id === current) ? current : next[0].id); } } setAnnouncements(Array.isArray(payload.announcements) ? payload.announcements : []); }).catch(() => {}); }, [account]);
  const unreadAnnouncements = announcements.filter((item) => !readAnnouncements.includes(item.id));
  const notificationCount = unreadAnnouncements.length + handoffLeads.length;

  const enableHandoffAlerts = async () => {
    let allowed = true;
    if ("Notification" in window && Notification.permission === "default") allowed = (await Notification.requestPermission()) === "granted";
    else if ("Notification" in window) allowed = Notification.permission === "granted";
    setHandoffAlertsEnabled(true);
    window.localStorage.setItem("pilatia_handoff_alerts", "on");
    notify(allowed ? "Alertas de atendimento ativados neste dispositivo." : "Alerta sonoro ativado. O navegador não autorizou notificações externas.");
  };
  const openNotifications = () => {
    setNotificationsOpen((current) => !current);
    if (unreadAnnouncements.length) {
      const next = [...new Set([...readAnnouncements, ...unreadAnnouncements.map((item) => item.id)])];
      setReadAnnouncements(next);
      localStorage.setItem("pilatia_read_announcements", JSON.stringify(next));
    }
  };
  useEffect(() => { if (!account) return; fetch("/api/ai-usage", { cache: "no-store" }).then(async (response) => { if (response.ok) setAiUsage(await response.json()); }).catch(() => {}); }, [account, active]);
  useEffect(() => {
    if (!account || isDemo) return;
    const pulse = () => Promise.all([
      fetch("/api/followups/pulse", { method: "POST", cache: "no-store" }).catch(() => null),
      fetch("/api/reminders/pulse", { method: "POST", cache: "no-store" }).catch(() => null),
    ]);
    pulse();
    const timer = window.setInterval(pulse, 60_000);
    return () => window.clearInterval(timer);
  }, [account, isDemo]);

  const loadConnectionUnits = async () => {
    if (!account) return;
    setConnectionBusy(true);
    try {
      const response = await fetch("/api/evolution/connections", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) {
        setConnectionUnits(Array.isArray(data.units) ? data.units : []);
        setConnectionLimit(Math.max(1, Number(data.limit) || 1));
        setConnected(Boolean(data.units?.[0]?.connected));
      }
    } finally {
      setConnectionBusy(false);
    }
  };

  const loadAiPause = async () => {
    const response = await fetch("/api/ai-pause", { cache: "no-store" });
    if (response.ok) setAiPause(await response.json());
  };

  const changeAiPause = async (body: Record<string, unknown>) => {
    setAiPauseBusy(true);
    const response = await fetch("/api/ai-pause", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    setAiPauseBusy(false);
    if (!response.ok) return notify(data.error || "Não foi possível alterar a pausa da IA");
    setAiPause(data); setAiPauseUntilInput("");
    notify(data.active ? "IA pausada. O WhatsApp continua conectado e as mensagens entram no Chat." : "IA reativada para novos atendimentos.");
  };

  useEffect(() => { if (account && active === "Conexões") { loadConnectionUnits(); loadAiPause(); } }, [account?.company.id, active]);
  useEffect(() => {
    if (!account || isDemo) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/evolution/qrcode?status=1&t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();
        if (!cancelled && response.ok) setConnected(Boolean(data.connected));
      } catch {}
    };
    check();
    const timer = window.setInterval(check, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [account, isDemo]);

  useEffect(() => {
    if (!selectedLead || !account || active !== "Chat") return;
    let cancelled = false;
    const loadOpenChat = async (retrySession = true) => {
      const response = await fetch(`/api/chat?phone=${encodeURIComponent(selectedLead.phone)}&t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
      if (response?.status === 401 && retrySession && await refreshAccount(false)) return loadOpenChat(false);
      if (!response?.ok) return;
      const data = await response.json();
      const seeded: ChatMessage[] = isDemo && !data.messages?.length ? [
        { id: "d1", direction: "in", text: "Oi, gostaria de saber mais sobre Pilates.", at: new Date(Date.now() - 1200000).toISOString(), author: "Contato" },
        { id: "d2", direction: "out", text: "Oi, tudo bem? Que bom que você chamou. Eu vou te ajudar com as informações do Pilates. Você já fez Pilates antes?", at: new Date(Date.now() - 1100000).toISOString(), author: "IA" },
        { id: "d3", direction: "in", text: "Nunca fiz. Quero fortalecer e começar agora, de preferência de manhã.", at: new Date(Date.now() - 900000).toISOString(), author: "Contato" },
        { id: "d4", direction: "out", text: "Perfeito, já entendi o que você procura 😊 Vou passar seu atendimento para nossa equipe confirmar o melhor horário.", at: new Date(Date.now() - 800000).toISOString(), author: "IA" },
      ] : data.messages || [];
      if (!cancelled) { setMessages(seeded); setChatMode(selectedLead.aiPaused ? "human" : data.mode || "ai"); }
    };
    loadOpenChat();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") loadOpenChat(); }, 5000);
    const refreshVisible = () => { if (document.visibilityState === "visible") loadOpenChat(); };
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [selectedLead?.id, active, account]);

  useLayoutEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport || !selectedLead || active !== "Chat") return;
    const conversationChanged = lastOpenedConversationRef.current !== selectedLead.phone;
    if (conversationChanged) {
      lastOpenedConversationRef.current = selectedLead.phone;
      shouldStickToLatestMessageRef.current = true;
    }
    if (conversationChanged || shouldStickToLatestMessageRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [active, selectedLead?.phone, messages]);

  const trackMessagesScroll = () => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const distanceFromLatest = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldStickToLatestMessageRef.current = distanceFromLatest < 120;
  };

  useEffect(() => {
    if (!showSetup) return;
    let cancelled = false;
    let failures = 0;
    let hasQrCode = false;
    let qrTimer = 0;
    let statusTimer = 0;
    let closeTimer = 0;
    let finished = false;
    let qrBusy = false;
    let statusBusy = false;
    let lastQrError = "";
    const controller = new AbortController();
    setQrStatus("loading");
    setQrCode("");

    const requestConnection = async (url: string) => {
      let response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (response.status === 401 && !controller.signal.aborted) {
        const renewed = await refreshAccount(false);
        if (renewed && !controller.signal.aborted) {
          response = await fetch(url, { cache: "no-store", signal: controller.signal });
        }
      }
      return response;
    };

    const finishConnection = () => {
      if (finished || cancelled) return;
      finished = true;
      if (qrUnit === 0) setConnected(true);
      setConnectionUnits((items) => items.map((unit, index) => index === qrUnit ? { ...unit, connected: true, state: "open" } : unit));
      setQrCode("");
      setQrStatus("connected");
      window.clearTimeout(qrTimer);
      window.clearTimeout(statusTimer);
      closeTimer = window.setTimeout(() => {
        if (!cancelled) {
          setShowSetup(false);
          if (!profile.onboardingComplete && !isDemo) window.setTimeout(() => setOnboardingOpen(true), 350);
        }
      }, 1200);
    };

    const checkConnection = async (initial = false) => {
      if (statusBusy || cancelled || finished || controller.signal.aborted) return;
      statusBusy = true;
      try {
        const response = await requestConnection(`/api/evolution/qrcode?status=1&unit=${qrUnit}&t=${Date.now()}`);
        const data = await response.json();
        if (!cancelled && !finished && response.ok && data.connected) {
          finishConnection();
          return;
        }
      } catch {} finally {
        statusBusy = false;
      }
      if (initial && !cancelled && !finished && !controller.signal.aborted) refreshQrCode();
      if (!cancelled && !finished && !controller.signal.aborted) statusTimer = window.setTimeout(checkConnection, 2500);
    };

    const refreshQrCode = async () => {
      if (qrBusy || cancelled || finished || controller.signal.aborted) return;
      qrBusy = true;
      try {
        const response = await requestConnection(`/api/evolution/qrcode?unit=${qrUnit}&t=${Date.now()}`);
        const data = await response.json();
        if (!response.ok) {
          lastQrError = String(data.error || "Falha ao gerar QR Code");
          throw new Error(lastQrError);
        }
        if (cancelled || finished) return;
        if (data.connected) {
          finishConnection();
          return;
        }
        if (!data.qrcode) throw new Error("QR Code vazio");
        failures = 0;
        hasQrCode = true;
        setQrCode(data.qrcode);
        setQrStatus("ready");
        qrTimer = window.setTimeout(refreshQrCode, Math.max(35, Number(data.refreshAfter) || 45) * 1000);
      } catch {
        if (cancelled || finished || controller.signal.aborted) return;
        failures += 1;
        if (!hasQrCode) {
          setQrCode(lastQrError);
          setQrStatus(failures >= 3 ? "error" : "loading");
        }
        qrTimer = window.setTimeout(refreshQrCode, failures >= 3 ? 5000 : 2500);
      } finally {
        qrBusy = false;
      }
    };

    // Android e iOS suspendem a aba quando o usuário abre o WhatsApp. Ao
    // voltar, verificamos a conexão e renovamos o QR imediatamente, sem exigir
    // atualizar a página ou refazer o login.
    const resumeConnection = () => {
      if (document.visibilityState === "hidden" || cancelled || finished) return;
      window.clearTimeout(qrTimer);
      window.clearTimeout(statusTimer);
      checkConnection(false);
      refreshQrCode();
    };

    window.addEventListener("focus", resumeConnection);
    window.addEventListener("pageshow", resumeConnection);
    document.addEventListener("visibilitychange", resumeConnection);
    checkConnection(true);
    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("focus", resumeConnection);
      window.removeEventListener("pageshow", resumeConnection);
      document.removeEventListener("visibilitychange", resumeConnection);
      window.clearTimeout(qrTimer);
      window.clearTimeout(statusTimer);
      window.clearTimeout(closeTimer);
    };
  }, [showSetup, qrUnit]);

  const submitAuth = async () => {
    setAuthBusy(true); setAuthError("");
    const response = await fetch(`/api/account-${authMode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(authForm) });
    const data = await response.json();
    if (!response.ok) { setAuthError(data.error || "Não foi possível entrar"); setAuthBusy(false); return; }
    const me = await fetch("/api/auth/me", { cache: "no-store" }); setAccount(me.ok ? await me.json() : data); setAuthBusy(false);
  };

  const moveLead = async (id: number, stage: string) => {
    const lead = leads.find((item) => item.id === id);
    if (!lead) return;
    const previous = leads; setLeads((items) => items.map((lead) => lead.id === id ? { ...lead, stage } : lead));
    if (isDemo) return notify("Lead atualizado no funil de demonstração");
    const response = await fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, stage, source: lead.source, soldPlan: lead.soldPlan, opportunityValue: lead.opportunityValue, objection: lead.objection, crmNotes: lead.crmNotes, contactAt: lead.contactAt, stoppedRespondingAt: lead.stoppedRespondingAt, nextActionAt: lead.nextActionAt, convertedAt: lead.convertedAt }) });
    if (!response.ok) { setLeads(previous); notify("Não foi possível mover o lead"); } else notify("Lead atualizado no CRM e etiqueta sincronizada");
  };

  const toLocalDateTime = (value?: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const openCrmEditor = (lead: Lead) => {
    setCrmEditor(lead);
    setCrmDraft({ stage: lead.stage, source: lead.source || "WhatsApp", soldPlan: lead.soldPlan || "", opportunityValue: lead.opportunityValue ? String(lead.opportunityValue) : "", objection: lead.objection || "", crmNotes: lead.crmNotes || "", contactAt: toLocalDateTime(lead.contactAt || lead.updatedAt), stoppedRespondingAt: toLocalDateTime(lead.stoppedRespondingAt), nextActionAt: toLocalDateTime(lead.nextActionAt), convertedAt: toLocalDateTime(lead.convertedAt) });
    setFollowupObjective(lead.followupPlan?.objective || (lead.stage === "agendamento" || Boolean(lead.appointmentAt) ? "reschedule" : "recovery"));
    setFollowupAttempts(Math.max(1, Math.min(3, Number(lead.followupPlan?.attempts) || 2)));
    setFollowupCadence(lead.followupPlan?.cadence_days === 3 ? "three_days" : "daily");
    setFollowupFirstAt(toLocalDateTime(lead.followupPlan?.scheduled_at?.find((date) => !lead.followupPlan?.sent?.some((item) => item.scheduled_at === date)) || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));
  };
  const saveCrmCard = async (closeAfter = true) => {
    if (!crmEditor) return;
    const updatedLead: Lead = { ...crmEditor, stage: crmDraft.stage, source: crmDraft.source.trim() || "WhatsApp", soldPlan: crmDraft.soldPlan.trim(), opportunityValue: Math.max(0, Number(crmDraft.opportunityValue) || 0), objection: crmDraft.objection.trim(), crmNotes: crmDraft.crmNotes.trim(), contactAt: crmDraft.contactAt || null, stoppedRespondingAt: crmDraft.stoppedRespondingAt || null, nextActionAt: crmDraft.nextActionAt || null, convertedAt: crmDraft.convertedAt || null };
    if (!isDemo) {
      const response = await fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: updatedLead.id, stage: updatedLead.stage, source: updatedLead.source, soldPlan: updatedLead.soldPlan, opportunityValue: updatedLead.opportunityValue, objection: updatedLead.objection, crmNotes: updatedLead.crmNotes, contactAt: updatedLead.contactAt, stoppedRespondingAt: updatedLead.stoppedRespondingAt, nextActionAt: updatedLead.nextActionAt, convertedAt: updatedLead.convertedAt }) });
      const data = await response.json();
      if (!response.ok) { notify(data.error || "Não foi possível salvar o card"); return null; }
    }
    setLeads((items) => items.map((lead) => lead.id === updatedLead.id ? updatedLead : lead));
    setCrmEditor(updatedLead);
    if (closeAfter) { setCrmEditor(null); notify("Informações do CRM salvas"); }
    return updatedLead;
  };

  const runLeadFollowup = async (action: "immediate" | "schedule" | "cancel", objectiveOverride?: "recovery" | "reschedule") => {
    if (!crmEditor || followupBusy) return;
    const effectiveObjective = objectiveOverride || followupObjective;
    if (objectiveOverride) setFollowupObjective(objectiveOverride);
    setFollowupBusy(true);
    const savedLead = await saveCrmCard(false);
    if (!savedLead) { setFollowupBusy(false); return; }
    const response = await fetch("/api/leads/followup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: savedLead.id, action, objective: effectiveObjective, attempts: followupAttempts, cadence: followupCadence, firstAt: followupFirstAt }) });
    const data = await response.json();
    setFollowupBusy(false);
    if (!response.ok) return notify(data.error || "Não foi possível configurar o follow-up");
    if (action === "immediate") { if (!isDemo) await loadLeads(); notify(effectiveObjective === "reschedule" ? "Mensagem para retomar o agendamento enviada" : "Mensagem de recuperação enviada"); return; }
    const nextPlan = action === "cancel" ? { ...(savedLead.followupPlan || {}), status: "cancelled" } : data.plan;
    const nextActionAt = action === "cancel" ? null : data.nextActionAt || data.plan?.scheduled_at?.[0] || null;
    const nextLead = { ...savedLead, followupPlan: nextPlan, nextActionAt };
    setCrmEditor(nextLead); setLeads((items) => items.map((lead) => lead.id === nextLead.id ? nextLead : lead));
    setCrmDraft((draft) => ({ ...draft, nextActionAt: toLocalDateTime(nextActionAt) }));
    notify(action === "cancel" ? "Sequência automática cancelada" : `${followupAttempts} tentativa(s) programada(s)`);
  };

  const renameConnectionUnit = async (index: number, name: string) => {
    const normalized = name.trim();
    if (normalized.length < 2 || normalized === connectionUnits[index]?.name) return;
    const response = await fetch("/api/evolution/connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index, name: normalized }) });
    const data = await response.json();
    if (!response.ok) return notify(data.error || "Não foi possível renomear a unidade");
    setConnectionUnits((items) => items.map((unit, unitIndex) => unitIndex === index ? { ...unit, name: normalized } : unit));
    notify("Nome da unidade atualizado");
  };

  const saveConnectionUnitProfile = async (index: number) => {
    const unit = connectionUnits[index];
    if (!unit) return;
    setConnectionBusy(true);
    const response = await fetch("/api/evolution/connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index, name: unit.name, profile: unit.profile || {} }) });
    const data = await response.json().catch(() => ({}));
    setConnectionBusy(false);
    if (!response.ok) return notify(data.error || "Não foi possível salvar os dados da unidade");
    setEditingUnit(null);
    notify("Dados da unidade salvos e aplicados ao atendimento da IA");
  };

  const disconnectConnectionUnit = async (index: number) => {
    const unit = connectionUnits[index];
    if (!unit?.connected || connectionBusy) return;
    if (!window.confirm(`Desconectar o WhatsApp de ${unit.name}?\n\nOs contatos, conversas e configurações continuarão salvos no PilatIA.`)) return;
    setConnectionBusy(true);
    try {
      const response = await fetch("/api/evolution/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return notify(data.error || "Não foi possível desconectar o WhatsApp");
      setConnectionUnits((items) => items.map((item, unitIndex) => unitIndex === index ? { ...item, connected: false, state: "close" } : item));
      if (index === 0) setConnected(false);
      setShowSetup(false);
      setQrCode("");
      setQrStatus("idle");
      notify("WhatsApp desconectado. Você pode conectá-lo novamente por QR Code quando quiser.");
    } finally {
      setConnectionBusy(false);
    }
  };

  const toggleChatMode = async () => {
    if (!selectedLead) return;
    if (selectedLead.student && chatMode === "human") return notify("Este contato está marcado como aluno e permanece em atendimento humano.");
    const next = selectedLead.handoffPending ? "human" : chatMode === "ai" ? "human" : "ai";
    const response = await fetch("/api/chat", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: selectedLead.phone, mode: next }) });
    if (!response.ok) return notify("Não foi possível alterar o modo");
    setChatMode(next); setLeads((items) => items.map((lead) => lead.id === selectedLead.id ? { ...lead, aiPaused: next === "human", handoffPending: false, humanOwner: next === "human" ? account?.user.email || "Atendente" : null } : lead));
    notify(next === "human" ? "Atendimento assumido. A IA está pausada neste contato." : "IA reativada para este contato.");
  };

  const sendHumanMessage = async () => {
    if (!selectedLead || !messageDraft.trim() || chatBusy) return;
    setChatBusy(true);
    if (chatMode !== "human") await fetch("/api/chat", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: selectedLead.phone, mode: "human" }) });
    const text = messageDraft.trim();
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: selectedLead.phone, contactName: selectedLead.name, text }) });
    if (response.ok) { setMessages((items) => [...items, { id: `local-${Date.now()}`, direction: "out", text, at: new Date().toISOString(), author: "Atendente" }]); setMessageDraft(""); setChatMode("human"); setLeads((items) => items.map((lead) => lead.id === selectedLead.id ? { ...lead, aiPaused: true, handoffPending: false, humanOwner: account?.user.email || "Atendente" } : lead)); }
    else notify((await response.json()).error || "Falha ao enviar mensagem");
    setChatBusy(false);
  };

  const saveProfile = async () => {
    try {
      const response = await fetch("/api/company-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { notify(data.error || "Não foi possível salvar"); return false; }
      const { ok: _ok, ...savedProfile } = data;
      setProfile((current) => ({ ...current, ...savedProfile }));
      notify("Informações da empresa salvas e aplicadas na IA");
      return true;
    } catch {
      notify("Não foi possível salvar. Verifique a conexão e tente novamente.");
      return false;
    }
  };
  const saveAdSpendRecords = async (adSpendRecords: AdSpendRecord[]) => {
    if (profile.demo) { notify("A demonstração não altera investimentos"); return false; }
    const response = await fetch("/api/company-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...profile, adSpendRecords }) });
    const data = await response.json();
    if (!response.ok) { notify(data.error || "Não foi possível salvar o investimento"); return false; }
    setProfile((current) => ({ ...current, ...data, adSpendRecords }));
    notify("Investimento atualizado e indicadores recalculados");
    return true;
  };

  const saveAppointment = async () => {
    if (!scheduleAt) return notify("Escolha a data e o horário");
    if (!scheduleLead && (manualContactName.trim().length < 2 || manualContactPhone.replace(/\D/g, "").length < 10)) return notify("Informe nome e WhatsApp do novo contato");
    const appointmentAt = new Date(scheduleAt).toISOString();
    const response = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: scheduleLead?.id, appointmentAt, contactName: manualContactName, phone: manualContactPhone, notes: scheduleNotes }) });
    const data = await response.json();
    if (!response.ok) return notify(data.error || "Não foi possível salvar o agendamento");
    if (scheduleLead) setLeads((items) => items.map((lead) => lead.id === scheduleLead.id ? { ...lead, stage: "agendamento", appointmentAt, appointmentStatus: "scheduled", appointmentNotes: scheduleNotes } : lead));
    else await loadLeads();
    closeSchedule(); notify(scheduleLead?.appointmentAt ? "Agendamento atualizado e confirmação reenviada" : "Agendamento salvo e confirmação enviada");
  };

  const appointmentAction = async (lead: Lead, action: string) => {
    const response = await fetch("/api/appointments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: lead.id, action }) });
    if (!response.ok) return notify("Não foi possível atualizar o agendamento");
    if (action === "remind") return notify("Lembrete manual enviado pelo WhatsApp");
    const map: Record<string, Partial<Lead>> = { confirm: { appointmentStatus: "confirmed" }, cancel: { appointmentStatus: "cancelled", stage: "atendimento" }, attended: { appointmentStatus: "attended", stage: "compareceu" }, no_show: { appointmentStatus: "no_show", stage: "atendimento" } };
    setLeads((items) => items.map((item) => item.id === lead.id ? { ...item, ...(map[action] || {}) } : item)); notify("Agenda atualizada");
  };

  const importContacts = async () => {
    setImportBusy(true);
    const requestImport = () => fetch("/api/contacts/import", { method: "POST", cache: "no-store" });
    let response = await requestImport();
    if (response.status === 401 && await refreshAccount(false)) response = await requestImport();
    const data = await response.json();
    setImportBusy(false);
    if (!response.ok) return notify(data.error || "Falha ao importar contatos");
    setImportResult(data);
    notify(`${data.imported} novo(s) contato(s) importado(s); ${data.skipped || 0} já existiam`); if (!isDemo) loadLeads();
  };

  const startContactConversation = async (lead: Lead) => {
    if (isDemo) { setLeads((items) => items.map((item) => item.id === lead.id ? { ...item, contactOnly: false, manualActionRequired: false, aiPaused: true, stage: "atendimento" } : item)); setSelectedPhone(lead.phone); setActive("Chat"); return; }
    const response = await fetch("/api/contacts/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: lead.id }) });
    const data = await response.json();
    if (!response.ok) return notify(data.error || "Não foi possível abrir a conversa");
    await loadLeads(); setSelectedPhone(lead.phone); setActive("Chat"); notify("Conversa aberta em modo humano. A IA permanece pausada.");
  };

  const selectContactForBroadcast = (lead: Lead) => {
    setBroadcastSegment("all"); setBroadcastMode("manual"); setSelectedBroadcastIds([lead.id]); setActive("Disparos");
    notify("Contato selecionado manualmente. Revise a mensagem antes de enviar.");
  };

  const classifyContact = async (lead: Lead, student: boolean) => {
    if (!isDemo) {
      const response = await fetch("/api/contacts/classify", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: lead.id, student }) });
      const data = await response.json();
      if (!response.ok) return notify(data.error || "Não foi possível atualizar o contato");
    }
    setLeads((items) => items.map((item) => item.id === lead.id ? { ...item, student, aiPaused: student, status: student ? "Aluno" : "Em atendimento", tone: student ? "student" : "active", nextActionAt: student ? null : item.nextActionAt } : item));
    notify(student ? "Contato marcado como aluno. A IA e as automações foram pausadas." : "Contato voltou para novos atendimentos.");
  };

  const sendBroadcast = async () => {
    if (!broadcastMessage.trim()) return notify("Escreva a mensagem do disparo");
    if (!broadcastTargetCount) return notify("Selecione pelo menos um contato para o disparo");
    setBroadcastBusy(true); const response = await fetch("/api/broadcasts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segment: broadcastSegment, stage: broadcastStage, dateFrom: broadcastRange === "custom" ? broadcastStart : new Date(Date.now() - Number(broadcastRange) * 86400000).toISOString(), dateTo: broadcastRange === "custom" ? broadcastEnd : "", message: broadcastMessage, leadIds: broadcastMode === "manual" ? validSelectedBroadcastIds : [], limit: broadcastTargetCount, batchSize: broadcastBatchSize }) }); const data = await response.json(); setBroadcastBusy(false);
    if (!response.ok) return notify(data.error || "Não foi possível enviar"); setBroadcastMessage(""); setSelectedBroadcastIds([]); notify(`Disparo concluído: ${data.sent} contato(s) em ${data.batches || 1} lote(s)`);
  };

  const crmLeads = useMemo(() => leads.filter((lead) => {
    if (lead.contactOnly || lead.student || (unitFilter !== "all" && lead.unitName !== unitFilter)) return false;
    const query = search.toLowerCase(); if (query && !`${lead.name} ${lead.phone}`.toLowerCase().includes(query)) return false;
    const time = new Date(lead.updatedAt).getTime();
    if (crmRange === "custom") { if (crmStart && time < new Date(`${crmStart}T00:00:00`).getTime()) return false; if (crmEnd && time > new Date(`${crmEnd}T23:59:59`).getTime()) return false; return true; }
    if (crmRange === "month") { const date = new Date(time), now = new Date(); return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); }
    if (crmRange === "year") return new Date(time).getFullYear() === new Date().getFullYear();
    if (crmRange === "all") return true;
    return time >= Date.now() - Number(crmRange) * 86400000;
  }), [leads, search, crmRange, crmStart, crmEnd, unitFilter]);
  const dashboardLeads = useMemo(() => leads.filter((lead) => {
    if (lead.contactOnly || lead.student) return false;
    const updatedAt = new Date(lead.updatedAt).getTime();
    return Number.isFinite(updatedAt) && updatedAt >= Date.now() - Number(dashboardRange) * 86400000;
  }), [leads, dashboardRange]);
  const dashboardScheduled = dashboardLeads.filter((lead) => lead.appointmentAt && lead.appointmentStatus !== "cancelled");
  const scheduled = leads.filter((lead) => !lead.contactOnly && (unitFilter === "all" || lead.unitName === unitFilter) && lead.appointmentAt && !["cancelled"].includes(lead.appointmentStatus || ""));
  const readyToSchedule = leads.filter((lead) => !lead.contactOnly && (unitFilter === "all" || lead.unitName === unitFilter) && ["qualificado", "agendamento"].includes(lead.stage) && !lead.appointmentAt);
  const appointmentsByDate = useMemo(() => { const map = new Map<string, Lead[]>(); scheduled.forEach((lead) => { const date = new Date(lead.appointmentAt!); const key = dateKey(date); map.set(key, [...(map.get(key) || []), lead]); }); return map; }, [scheduled]);
  const agendaDates = useMemo(() => {
    if (agendaMode === "month") return Array.from({ length: new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate() }, (_, index) => new Date(monthCursor.getFullYear(), monthCursor.getMonth(), index + 1));
    if (agendaMode === "day") return [new Date(monthCursor)];
    const start = new Date(monthCursor); start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [agendaMode, monthCursor]);
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1).getDay();
  const agendaTitle = agendaMode === "month" ? monthCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : agendaMode === "day" ? monthCursor.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }) : `${agendaDates[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} — ${agendaDates[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
  const moveAgenda = (direction: number) => setMonthCursor((current) => {
    if (agendaMode === "month") return new Date(current.getFullYear(), current.getMonth() + direction, 1);
    const next = new Date(current); next.setDate(next.getDate() + direction * (agendaMode === "week" ? 7 : 1)); return next;
  });
  const broadcastCandidates = leads.filter((lead) => {
    if (lead.student) return false;
    const leadTime = new Date(lead.updatedAt).getTime();
    const dateMatches = broadcastRange === "custom"
      ? (!broadcastStart || leadTime >= new Date(`${broadcastStart}T00:00:00`).getTime()) && (!broadcastEnd || leadTime <= new Date(`${broadcastEnd}T23:59:59`).getTime())
      : leadTime >= Date.now() - Number(broadcastRange) * 86400000;
    if (!dateMatches || broadcastStage !== "all" && lead.stage !== broadcastStage) return false;
    if (lead.contactOnly) return broadcastMode === "manual" && broadcastSegment === "all";
    return broadcastSegment === "scheduled" ? lead.stage === "agendamento" : broadcastSegment === "qualified" ? lead.stage === "qualificado" || lead.score >= 75 : broadcastSegment === "followup" ? Date.now() - new Date(lead.updatedAt).getTime() > 1800000 && lead.stage !== "fechado" : lead.stage !== "perdido";
  });
  const validSelectedBroadcastIds = selectedBroadcastIds.filter((id) => broadcastCandidates.some((lead) => lead.id === id));
  const broadcastTargetCount = broadcastMode === "manual" ? validSelectedBroadcastIds.length : Math.min(broadcastCandidates.length, Math.max(1, Math.min(100, broadcastLimit)));
  const broadcastBatchPlan = Array.from({ length: Math.ceil(broadcastTargetCount / broadcastBatchSize) }, (_, index) => Math.min(broadcastBatchSize, broadcastTargetCount - index * broadcastBatchSize));

  if (account === undefined) return <main className="auth-screen"><div className="auth-loading"><div className="brandmark">P</div><span>Preparando seu ambiente…</span></div></main>;
  if (account === null) return <main className="auth-screen">
    <section className="auth-brand">
      <div className="brandmark">P</div><span>PLATAFORMA MULTIEMPRESA</span>
      {STAGING_MODE && <div className="staging-login-badge">AMBIENTE DE HOMOLOGAÇÃO · DADOS FICTÍCIOS</div>}
      <h1>Atendimento que transforma conversas em alunos.</h1>
      <p>IA, WhatsApp, CRM e agenda para negócios de movimento, saúde e bem-estar.</p>
      <div className="auth-points"><i>✓</i> Dados isolados por empresa <i>✓</i> IA adaptada ao segmento <i>✓</i> Agenda e lembretes</div>
    </section>
    <section className="auth-card">
      <span>{authMode === "login" ? "ACESSAR CONTA" : "CRIAR NOVA EMPRESA"}</span>
      <h2>{authMode === "login" ? "Bem-vindo ao PilatIA" : "Comece em poucos minutos"}</h2>
      <p>{authMode === "login" ? "Entre com seu login e senha." : "Escolha o segmento e crie o ambiente exclusivo da sua empresa."}</p>
      {authMode === "register" && <>
        <label>Nome da empresa<input value={authForm.companyName} onChange={(event) => setAuthForm({ ...authForm, companyName: event.target.value })} placeholder="Ex.: Movimento com a Ju" /></label>
        <label>Tipo de negócio<select value={authForm.businessType} onChange={(event) => setAuthForm({ ...authForm, businessType: event.target.value as BusinessType })}>{businessTypes.map((business) => <option value={business.id} key={business.id}>{business.label}</option>)}</select><small className="field-help">A IA usará o vocabulário e o roteiro mais adequado para este segmento.</small></label>
      </>}
      <label>{authMode === "login" ? "Login ou e-mail" : "E-mail de acesso"}<input value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder={authMode === "login" ? "Seu login ou e-mail" : "voce@empresa.com"} /></label>
      <label>Senha<input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder={authMode === "login" ? "Sua senha" : "Mínimo de 8 caracteres"} onKeyDown={(event) => event.key === "Enter" && submitAuth()} /></label>
      {authError && <div className="auth-error">{authError}</div>}
      <button onClick={submitAuth} disabled={authBusy}>{authBusy ? "Aguarde…" : authMode === "login" ? "Entrar" : "Criar empresa"}</button>
      {STAGING_MODE ? <small>Prévia protegida: cadastros e integrações reais estão desativados.</small> : <small>{authMode === "login" ? "Ainda não possui cadastro?" : "Já possui uma conta?"} <button onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}>{authMode === "login" ? "Cadastre-se aqui" : "Fazer login"}</button></small>}
    </section>
  </main>;

  const allNav = [
    ["Dashboard", "▦"], ["Chat", "◫"], ["Agentes IA", "✦"], ["CRM", "▥"], ["Agenda", "▣"],
    ["Conexões", "◇"], ["Disparos", "▷"], ["Contatos", "♙"], ["Qualificação", "✓"], ["Configurações", "⚙"], ...(isPlatformAdmin ? [["Administração", "⌘"]] : []), ["Tutoriais", "▶"],
  ];
  const moduleByPage: Record<string, string> = { Chat: "chat", "Agentes IA": "ai", CRM: "crm", Agenda: "agenda", Disparos: "broadcasts", Contatos: "contacts", Qualificação: "ai" };
  const allowedModules = Array.isArray(account.subscription?.modules) ? account.subscription.modules : null;
  const sensitiveCompanyPages = ["Agentes IA", "Conexões", "Qualificação", "Configurações"];
  const nav = allNav.filter(([label]) => {
    if (account.role === "agent" && sensitiveCompanyPages.includes(label)) return false;
    if (label === "Agenda" && allowedModules?.includes("crm")) return true;
    return !moduleByPage[label] || !allowedModules || allowedModules.includes(moduleByPage[label]);
  });

  return <main className="ops-shell pia-ui">
    {STAGING_MODE && <div className="staging-ribbon"><strong>HOMOLOGAÇÃO</strong><span>Dados fictícios · WhatsApp, disparos e banco de produção isolados</span></div>}
    <aside className="ops-sidebar"><div className="ops-brand"><div>P</div><span><strong>PilatIA</strong><small>{isPlatformAdmin ? "Controle da plataforma" : "Central de atendimento"}</small></span></div><nav>{nav.map(([label, icon], index) => <div key={label}>{index === 0 && <p>OPERAÇÃO</p>}{label === "Conexões" && <p>GESTÃO</p>}{label === "Administração" && <p>PLATAFORMA</p>}{label === "Tutoriais" && <p>AJUDA</p>}<button className={active === label ? "active" : ""} onClick={() => { if (label === "Tutoriais") { setTutorialOpen(true); setTutorialMinimized(false); } else setActive(label); }}><i>{icon}</i><span>{label}</span>{label === "Chat" && leads.filter((lead) => lead.aiPaused).length > 0 && <b>{leads.filter((lead) => lead.aiPaused).length}</b>}{label === "Conexões" && <em className={connected ? "online" : "offline"} />}</button></div>)}</nav><div className="ops-account"><div>{account.company.name.slice(0, 2).toUpperCase()}</div><span><strong>{isPlatformAdmin ? "Administrador PilatIA" : account.company.name}</strong><small>{account.user.email}</small></span><button title="Sair" onClick={async () => { await fetch("/api/account-logout", { method: "POST" }); setAccount(null); }}>↪</button></div></aside>
    <section className="ops-content"><header className="ops-topbar"><div><span>PAINEL / {active.toUpperCase()}</span><h1>{active}</h1><p>{active === "Administração" ? "Gestão central da plataforma" : `${account.company.name} · operação em tempo real`}</p></div><div>{!isPlatformAdmin && <button className="notification-bell" aria-label="Abrir notificações" onClick={openNotifications}>🔔{notificationCount > 0 && <b>{notificationCount}</b>}</button>}{active !== "Administração" && <><button className="icon-button" onClick={() => setActive("Chat")}>⌁</button>{isCompanyAdmin && <button className="connection-button" onClick={() => { setQrUnit(0); setShowSetup(true); }}>{connected ? "● WhatsApp conectado" : "+ Conectar WhatsApp"}</button>}</>}</div></header>
    {notificationsOpen && <aside className="notifications-panel"><header><span>CENTRAL DE ATENÇÃO</span><button onClick={() => setNotificationsOpen(false)}>×</button></header>{handoffLeads.length > 0 && <section className="handoff-notifications"><strong>AGUARDANDO ATENDENTE · {handoffLeads.length}</strong>{handoffLeads.map((lead) => <button key={lead.id} onClick={() => { setSelectedPhone(lead.phone); setActive("Chat"); setNotificationsOpen(false); }}><i>👤</i><span><b>{lead.name}</b><small>{lead.handoffReason}{lead.unitName ? ` · ${lead.unitName}` : ""}</small></span><em>Atender</em></button>)}</section>}{!handoffAlertsEnabled && <button className="enable-alerts" onClick={enableHandoffAlerts}>Ativar alerta sonoro e do navegador</button>}{announcements.length ? announcements.map((item) => <article key={item.id}><i>🔔</i><div><strong>{item.title}</strong><p>{item.message}</p><small>Disponível até {new Date(item.expiresAt).toLocaleDateString("pt-BR")}</small></div></article>) : !handoffLeads.length && <div className="notifications-empty">Nenhuma pendência no momento.</div>}</aside>}
      <div className={`ops-page ${active === "Dashboard" ? "pia-dashboard" : active === "CRM" ? "pia-crm" : active === "Chat" ? "pia-chat" : "pia-secondary"}`}>
        {active === "Dashboard" && isCompanyAdmin && <AiReadinessCard profile={profile} onOpen={() => setOnboardingOpen(true)} onTest={() => setSimulatorOpen(true)} />}
        {active === "Dashboard" && <><section className="ops-filterbar"><div>{[["7", "7 dias"], ["14", "14 dias"], ["30", "30 dias"]].map(([value, label]) => <button key={value} className={dashboardRange === value ? "active" : ""} aria-pressed={dashboardRange === value} onClick={() => setDashboardRange(value)}>{label}</button>)}</div><span>{dashboardLeads.length} contato(s) no período</span></section><section className="metric-grid"><article><span>Novos contatos</span><strong>{dashboardLeads.filter((lead) => lead.stage === "novo").length}</strong><small>Entraram no período</small><i>↗</i></article><article><span>Agendamentos</span><strong>{dashboardScheduled.length}</strong><small>{dashboardScheduled.filter((lead) => lead.appointmentStatus === "confirmed").length} confirmados</small><i>▣</i></article><article><span>Vendas fechadas</span><strong>{dashboardLeads.filter((lead) => lead.stage === "fechado").length}</strong><small>{dashboardLeads.length ? Math.round(dashboardLeads.filter((lead) => lead.stage === "fechado").length / dashboardLeads.length * 100) : 0}% de conversão</small><i>✓</i></article><article><span>Oportunidades</span><strong>{money.format(dashboardLeads.filter((lead) => ["negociacao", "fechado"].includes(lead.stage)).reduce((total, lead) => total + Math.max(0, Number(lead.opportunityValue) || 0), 0))}</strong><small>Valor cadastrado no CRM</small><i>R$</i></article></section><section className="dashboard-grid"><article className="ops-card performance"><div className="card-title"><div><span>DESEMPENHO DA OPERAÇÃO</span><h2>Funil comercial</h2></div><button onClick={() => setActive("CRM")}>Abrir CRM</button></div><div className="funnel-bars">{stages.slice(0, 7).map((stage) => { const count = dashboardLeads.filter((lead) => lead.stage === stage.id).length; return <div key={stage.id}><span>{stage.title}<b>{count}</b></span><i><em style={{ width: `${Math.max(6, dashboardLeads.length ? count / dashboardLeads.length * 100 : 0)}%`, background: stage.color }} /></i></div>; })}</div></article><article className="ops-card priority"><div className="card-title"><div><span>PRIORIDADES</span><h2>Precisam de atenção</h2></div></div>{dashboardLeads.filter((lead) => lead.aiPaused || lead.score >= 75).slice(0, 5).map((lead) => <button key={lead.id} onClick={() => { setSelectedPhone(lead.phone); setActive("Chat"); }}><div className="contact-avatar">{lead.initials}</div><span><strong>{lead.name}</strong><small>{lead.aiPaused ? "Aguardando atendente" : lead.status}</small></span><b>{lead.score}</b></button>)}</article></section></>}

        {active === "Chat" && <section className="chat-layout">
          <aside className="chat-list ops-card">
            <div className="chat-list-head"><div><span>CAIXA DE ENTRADA</span><h2>Conversas</h2></div><b>{chatLeads.length}</b></div>
            <label className="search-field">⌕<input placeholder="Buscar contato…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <div className="chat-tabs">{[["all", "Todas"], ["human", "Humano"], ["ai", "IA"]].map(([value, label]) => <button key={value} className={chatFilter === value ? "active" : ""} aria-pressed={chatFilter === value} onClick={() => setChatFilter(value as "all" | "human" | "ai")}>{label}</button>)}</div>{availableUnits.length > 1 && <select className="unit-filter" value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}><option value="all">Todas as unidades</option>{availableUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>}
            <div className="conversation-list">{chatLeads.map((lead) => <button className={selectedLead?.phone === lead.phone ? "active" : ""} key={lead.id} onClick={() => setSelectedPhone(lead.phone)}><div className="contact-avatar">{lead.initials}</div><span><strong>{lead.name}</strong><small>{lead.summary}</small><em>{lead.aiPaused ? "Atendente" : "IA ativa"}</em></span><time>{lead.time}</time></button>)}</div>
          </aside>
          <article className="chat-room ops-card">{selectedLead ? <><header><div className="contact-avatar">{selectedLead.initials}</div><span><strong>{selectedLead.name}</strong><small>{selectedLead.phone} · {selectedLead.handoffPending ? "Aguardando atendente" : chatMode === "human" ? "Atendimento humano" : "IA respondendo"}</small></span><button className={chatMode === "human" ? "mode human" : "mode"} onClick={toggleChatMode}>{selectedLead.handoffPending ? "Assumir atendimento" : chatMode === "human" ? "Devolver para IA" : "Assumir atendimento"}</button></header><div className={`mode-banner ${selectedLead.handoffPending ? "handoff" : ""}`}><i className={chatMode} />{selectedLead.handoffPending ? `A IA concluiu a qualificação. ${selectedLead.nextAction || "Este contato aguarda atendimento humano."}` : chatMode === "human" ? "Você assumiu esta conversa. A IA não responderá enquanto o modo humano estiver ativo." : "A IA está qualificando o contato. Você pode assumir a qualquer momento."}</div><div className="messages" ref={messagesViewportRef} onScroll={trackMessagesScroll}>{messages.map((message) => <div key={message.id} className={`message ${message.direction}`}><small>{message.author}</small><p>{message.text}</p><time>{new Date(message.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></div>)}</div><footer><textarea value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendHumanMessage(); } }} placeholder="Digite uma mensagem para enviar pelo WhatsApp…" /><button onClick={sendHumanMessage} disabled={chatBusy}>{chatBusy ? "…" : "Enviar"}</button></footer></> : <div className="empty-work">Nenhuma conversa neste filtro</div>}</article>
          <aside className="chat-contact ops-card">{selectedLead && <><div className="contact-profile"><div className="contact-avatar large">{selectedLead.initials}</div><h3>{selectedLead.name}</h3><p>{selectedLead.phone}</p><span className={selectedLead.score >= 75 ? "hot" : ""}>Score {selectedLead.score}/100</span></div><div className="contact-actions"><button onClick={() => openSchedule(selectedLead)}>＋ Agendar</button><button onClick={() => setActive("CRM")}>Ver no CRM</button></div><div className="contact-data"><span>RESUMO DA IA</span><p>{selectedLead.summary}</p><dl><div><dt>Origem</dt><dd>{selectedLead.source}</dd></div><div><dt>Etapa</dt><dd>{stages.find((stage) => stage.id === selectedLead.stage)?.title || selectedLead.stage}</dd></div><div><dt>Preferência</dt><dd>{String(selectedLead.qualification?.preferredPeriod || "Não informado")}</dd></div></dl></div></>}</aside>
        </section>}
        {active === "Contatos" && <div className="contact-import-explainer"><div><b>O que será importado</b><span>Contatos disponibilizados pela agenda sincronizada e números encontrados nas conversas do WhatsApp conectado. A importação não envia mensagens e não ativa a IA.</span></div><div><b>Limitação do WhatsApp</b><span>Contatos que o próprio WhatsApp não disponibiliza para aparelhos conectados — incluindo alguns números não salvos ou identificadores privados — não podem ser recuperados pela API.</span></div>{importResult && <div className="import-result"><b>Última importação concluída</b><span><strong>{importResult.found}</strong> encontrados · <strong>{importResult.imported}</strong> novos · <strong>{importResult.skipped}</strong> já existentes{importResult.unsupported ? ` · ${importResult.unsupported} sem número disponível` : ""}</span></div>}</div>}

        {active === "Agentes IA" && <div className="ai-onboarding-actions"><button onClick={() => setSimulatorOpen(true)}>▷ Testar minha IA</button><button onClick={() => setOnboardingOpen(true)}>✦ Configuração rápida</button></div>}
        {active === "Agentes IA" && <section className="section-stack ai-settings-page">
          <div className="section-hero"><div><span>AGENTE COMERCIAL</span><h2>Inteligência da sua empresa</h2><p>Personalize conhecimento, modelo e memória sem perder o padrão profissional do atendimento.</p></div><div className="ai-live"><i /> IA ativa</div></div>
          <section className="ai-grid"><article className="ops-card"><div className="card-title"><div><span>IDENTIDADE</span><h2>Como a IA se apresenta</h2></div></div><div className="identity-preview"><div>P</div><p>“Olá! Sou a assistente de atendimento da <strong>{profile.companyName || account.company.name}</strong>. Como posso te ajudar?”</p></div><label>Tom de comunicação<textarea value={profile.toneGuidelines} onChange={(event) => setProfile({ ...profile, toneGuidelines: event.target.value })} /></label><label>Diferenciais da empresa<textarea value={profile.differentials} onChange={(event) => setProfile({ ...profile, differentials: event.target.value })} placeholder="Ex.: avaliação individual, equipamentos modernos…" /></label></article><article className="ops-card"><div className="card-title"><div><span>BASE DE CONHECIMENTO</span><h2>Informações para responder</h2></div></div><label>Serviços oferecidos<textarea value={profile.services} onChange={(event) => setProfile({ ...profile, services: event.target.value })} /></label><label>Perguntas frequentes e orientações<textarea value={profile.faq} onChange={(event) => setProfile({ ...profile, faq: event.target.value })} placeholder="O que levar, como funciona a primeira aula…" /></label><label>Valores e condições autorizadas<textarea value={profile.prices} onChange={(event) => setProfile({ ...profile, prices: event.target.value })} placeholder="Deixe em branco para a IA encaminhar à equipe" /></label></article></section>
          <article className="ops-card model-settings"><div className="card-title"><div><span>MODELO DE IA</span><h2>Escolha o equilíbrio ideal</h2><p>Preços estimados por 1 milhão de tokens de entrada e saída.</p></div><b>Atual: {aiModels.find((model) => model.id === profile.aiModel)?.name}</b></div><div className="model-options">{aiModels.map((model) => <button type="button" key={model.id} className={profile.aiModel === model.id ? "active" : ""} aria-pressed={profile.aiModel === model.id} onClick={() => setProfile({ ...profile, aiModel: model.id })}><span><strong>{model.name}</strong><em>{model.badge}</em></span><p>{model.description}</p><small>Entrada {model.input} · Saída {model.output}</small></button>)}</div></article>
          <section className="memory-usage-grid"><article className="ops-card memory-settings"><div className="card-title"><div><span>MEMÓRIA E CONTINUIDADE</span><h2>Conversas sem recomeçar</h2></div></div><label className="ai-toggle"><span><strong>Agrupar mensagens rápidas</strong><small>Aguarda alguns segundos e responde uma vez quando o lead envia várias mensagens seguidas.</small></span><input type="checkbox" checked={profile.groupMessages} onChange={(event) => setProfile({ ...profile, groupMessages: event.target.checked })} /></label><label className="range-setting"><span><strong>Tempo para agrupar</strong><small>{profile.groupingDelaySeconds} segundos</small></span><input type="range" min="2" max="8" value={profile.groupingDelaySeconds} disabled={!profile.groupMessages} onChange={(event) => setProfile({ ...profile, groupingDelaySeconds: Number(event.target.value) })} /></label><label className="history-setting"><span><strong>Mensagens no histórico</strong><small>A IA retoma agendamentos, retornos e follow-ups a partir deste contexto.</small></span><input type="number" min="6" max="50" value={profile.historyMessages} onChange={(event) => setProfile({ ...profile, historyMessages: Math.max(6, Math.min(50, Number(event.target.value) || 20)) })} /></label><div className="memory-ok"><i>✓</i><span><strong>Retomada inteligente ativa</strong><small>Respostas de recuperação entram no histórico e a qualificação continua do ponto certo.</small></span></div></article>
          <article className="ops-card usage-card"><div className="card-title"><div><span>CONSUMO DA IA · 30 DIAS</span><h2>Uso real da OpenAI</h2></div><b>{aiUsage.responses} respostas</b></div><div className="usage-total"><span><small>Tokens processados</small><strong>{new Intl.NumberFormat("pt-BR").format(aiUsage.totalTokens)}</strong></span><span><small>Custo estimado</small><strong>US$ {aiUsage.estimatedCostUsd.toFixed(4).replace(".", ",")}</strong></span></div><div className="usage-breakdown"><span>Entrada <b>{new Intl.NumberFormat("pt-BR").format(aiUsage.inputTokens)}</b></span><span>Saída <b>{new Intl.NumberFormat("pt-BR").format(aiUsage.outputTokens)}</b></span></div><div className="usage-models">{Object.entries(aiUsage.byModel).length ? Object.entries(aiUsage.byModel).map(([model, tokens]) => <div key={model}><span>{model}</span><b>{new Intl.NumberFormat("pt-BR").format(tokens)} tokens</b></div>) : <p>O consumo começará a aparecer após as próximas respostas da IA.</p>}</div><small className="cost-note">Estimativa calculada pelos tokens informados pela OpenAI. A cobrança oficial continua na conta da API.</small></article></section>
          <button className="save-button ai-save" onClick={saveProfile} disabled={profile.demo}>Salvar configurações e atualizar IA</button>
          <div className="guardrails ops-card"><span>PADRÃO PILATIA PROTEGIDO</span><div><b>3–4 perguntas</b><small>Qualificação objetiva</small></div><div><b>1 pergunta</b><small>Por mensagem</small></div><div><b>Memória contínua</b><small>Sem repetir o roteiro</small></div><div><b>Transferência</b><small>Quando estiver pronto</small></div></div>
        </section>}

        {active === "CRM" && <section className="crm-section">
          <div className="section-hero compact"><div><span>CRM / {account.company.name.toUpperCase()}</span><h2>Gestão de oportunidades</h2><p>Organize, filtre, mova e registre os detalhes de cada negociação.</p></div><strong>{crmLeads.length} contatos</strong></div>
          <div className="crm-tools"><label className="search-field">⌕<input placeholder="Buscar nome ou telefone" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select value={crmRange} onChange={(event) => setCrmRange(event.target.value)}><option value="7">Últimos 7 dias</option><option value="14">Últimos 14 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="month">Este mês</option><option value="year">Este ano</option><option value="all">Todo o histórico</option><option value="custom">Período personalizado</option></select>{availableUnits.length > 1 && <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}><option value="all">Todas as unidades</option>{availableUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>}{crmRange === "custom" && <><input type="date" value={crmStart} onChange={(event) => setCrmStart(event.target.value)} /><input type="date" value={crmEnd} onChange={(event) => setCrmEnd(event.target.value)} /></>}<button onClick={() => { setSearch(""); setCrmRange("30"); setCrmStart(""); setCrmEnd(""); setUnitFilter("all"); }}>Limpar</button><div className="crm-view-switch"><button className={crmView === "kanban" ? "active" : ""} onClick={() => setCrmView("kanban")}>▥ Kanban</button><button className={crmView === "list" ? "active" : ""} onClick={() => setCrmView("list")}>☷ Lista</button></div></div>
          {crmView === "kanban" ? <div className="kanban-v2">{stages.map((stage) => { const cards = crmLeads.filter((lead) => lead.stage === stage.id); return <div className="kanban-col" key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveLead(Number(event.dataTransfer.getData("leadId")), stage.id)}><header><span><i style={{ background: stage.color }} />{stage.title}</span><b>{cards.length}</b></header><div>{cards.map((lead) => <article key={lead.id} draggable onDragStart={(event) => event.dataTransfer.setData("leadId", String(lead.id))} onDoubleClick={() => openCrmEditor(lead)}><div><div className="contact-avatar">{lead.initials}</div><span><button className="crm-name-link" onClick={() => openCrmEditor(lead)} aria-label={`Abrir cadastro de ${lead.name}`}>{lead.name}</button><small>{lead.phone}</small></span><b>{lead.score}</b></div><p>{lead.summary}</p>{Boolean(lead.soldPlan || lead.opportunityValue) && <div className="crm-card-commercial"><span>{lead.soldPlan || "Oportunidade"}</span><strong>{money.format(Number(lead.opportunityValue) || 0)}</strong></div>}<footer><em>{lead.nextActionAt ? `Próxima ação ${formatWhen(lead.nextActionAt)}` : lead.aiPaused ? "Humano" : lead.source}</em><span><button onClick={() => openCrmEditor(lead)}>Editar</button><button onClick={() => { setSelectedPhone(lead.phone); setActive("Chat"); }}>Chat</button></span></footer></article>)}</div>{!cards.length && <p className="drop-hint">Arraste um contato para esta etapa</p>}</div>; })}</div> :
          <div className="crm-list ops-card"><header><span>Data do contato</span><span>Nome</span><span>WhatsApp</span><span>Origem</span><span>Serviço</span><span>Etapa</span><span>Conversão</span><span>Objeção</span><span>Valor</span><span>Ações</span></header>{crmLeads.map((lead) => <div key={lead.id}><time>{new Date(lead.contactAt || lead.updatedAt).toLocaleDateString("pt-BR")}</time><button className="crm-name-link" onClick={() => openCrmEditor(lead)} aria-label={`Abrir cadastro de ${lead.name}`}>{lead.name}</button><span>{lead.phone}</span><em>{lead.source}</em><span>{lead.soldPlan || String(lead.qualification?.serviceInterest || "Não informado")}</span><b>{stages.find((stage) => stage.id === lead.stage)?.title || lead.stage}</b><span>{lead.stage === "fechado" ? "Sim" : lead.stage === "perdido" ? "Não" : "Em aberto"}</span><span title={lead.objection}>{lead.objection || (lead.stoppedRespondingAt ? "Parou de responder" : "Não identificada")}</span><strong>{lead.opportunityValue ? money.format(lead.opportunityValue) : "—"}</strong><span className="crm-list-actions"><button onClick={() => openCrmEditor(lead)}>Editar</button><button onClick={() => { setSelectedPhone(lead.phone); setActive("Chat"); }}>Chat</button></span></div>)}{!crmLeads.length && <p>Nenhum contato encontrado neste período.</p>}</div>}
          <CrmAnalytics periodLeads={crmLeads} allLeads={leads} records={profile.adSpendRecords || []} disabled={profile.demo} onSaveRecords={saveAdSpendRecords} />
        </section>}

        {active === "Agenda" && <section className="agenda-section">
          <div className="section-hero compact"><div><span>AGENDA OPERACIONAL</span><h2>Agendamentos e confirmações</h2><p>Controle horários, confirmações e lembretes em um só lugar.</p></div><button className="save-button" onClick={() => openSchedule(null)}>＋ Novo agendamento</button></div>
          <div className="agenda-toolbar"><button aria-label="Período anterior" onClick={() => moveAgenda(-1)}>‹</button><strong>{agendaTitle}</strong><button aria-label="Próximo período" onClick={() => moveAgenda(1)}>›</button>{availableUnits.length > 1 && <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}><option value="all">Todas as unidades</option>{availableUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>}<div><button className={agendaMode === "day" ? "active" : ""} aria-pressed={agendaMode === "day"} onClick={() => setAgendaMode("day")}>Dia</button><button className={agendaMode === "week" ? "active" : ""} aria-pressed={agendaMode === "week"} onClick={() => setAgendaMode("week")}>Semana</button><button className={agendaMode === "month" ? "active" : ""} aria-pressed={agendaMode === "month"} onClick={() => setAgendaMode("month")}>Mês</button></div></div>
          <div className="agenda-layout"><article className="calendar ops-card">
            {agendaMode !== "day" && <div className="week-labels">{["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((day) => <span key={day}>{day}</span>)}</div>}
            <div className={`month-grid ${agendaMode}-view`}>{agendaMode === "month" && Array.from({ length: firstDay }).map((_, index) => <div className="blank" key={`blank-${index}`} />)}{agendaDates.map((date) => { const items = appointmentsByDate.get(dateKey(date)) || []; const isToday = dateKey(date) === dateKey(new Date()); return <div key={dateKey(date)} className={isToday ? "today" : ""}>{agendaMode !== "month" && <small>{date.toLocaleDateString("pt-BR", { weekday: "short", month: "short" })}</small>}<b>{date.getDate()}</b>{items.slice(0, agendaMode === "month" ? 3 : 12).map((lead) => <button key={lead.id} onClick={() => openSchedule(lead)}><time>{new Date(lead.appointmentAt!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>{lead.name}</button>)}</div>; })}</div>
          </article><aside className="agenda-side"><article className="ops-card"><div className="card-title"><div><span>PRONTOS PARA AGENDAR</span><h2>Fila comercial</h2></div><b>{readyToSchedule.length}</b></div>{readyToSchedule.map((lead) => <button className="queue-row" key={lead.id} onClick={() => openSchedule(lead)}><div className="contact-avatar">{lead.initials}</div><span><strong>{lead.name}</strong><small>{lead.summary}</small></span><b>＋</b></button>)}</article><article className="ops-card reminders-card"><span>LEMBRETES AUTOMÁTICOS</span><h3>24h, 3h e 2h antes</h3><p>O sistema envia pelo WhatsApp e registra cada envio no agendamento.</p><i>{profile.remindersEnabled ? "Automação ativa" : "Automação pausada"}</i></article></aside></div>
          <section className="appointment-list ops-card"><div className="card-title"><div><span>PRÓXIMOS HORÁRIOS</span><h2>Coordenação da agenda</h2></div></div>{[...scheduled].sort((a, b) => new Date(a.appointmentAt!).getTime() - new Date(b.appointmentAt!).getTime()).map((lead) => <div className="appointment-row" key={lead.id}><time><strong>{new Date(lead.appointmentAt!).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</strong><span>{new Date(lead.appointmentAt!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></time><div className="contact-avatar">{lead.initials}</div><span><strong>{lead.name}</strong><small>{lead.phone}{lead.appointmentNotes ? ` · ${lead.appointmentNotes}` : ""}</small></span><em className={lead.appointmentStatus || "scheduled"}>{lead.appointmentStatus === "confirmed" ? "Confirmado" : lead.appointmentStatus === "attended" ? "Compareceu" : "Aguardando"}</em><div><button onClick={() => appointmentAction(lead, "remind")}>Lembrar agora</button><button onClick={() => appointmentAction(lead, "confirm")}>Confirmar</button><button onClick={() => appointmentAction(lead, "attended")}>Compareceu</button><button onClick={() => openSchedule(lead)}>Editar</button></div></div>)}</section>
        </section>}

        {active === "Disparos" && <section className="section-stack">
          <div className="section-hero"><div><span>CAMPANHAS E AUTOMAÇÕES</span><h2>Disparos segmentados</h2><p>Escolha quem deve receber a mensagem. Cada envio respeita os contatos da empresa conectada.</p></div></div>
          <div className="broadcast-grid">
            <article className="ops-card segment-card broadcast-audience"><div className="card-title"><div><span>1. PÚBLICO</span><h2>Escolha os contatos</h2></div><b>{broadcastCandidates.length} disponíveis</b></div>{[["scheduled", "Agendados", "Confirmações, orientações e avisos"], ["followup", "Pararam de responder", "Recupere conversas sem retorno"], ["qualified", "Qualificados", "Leads com maior intenção"], ["all", "Todos os contatos", "Exceto contatos perdidos"]].map(([id, title, description]) => <button className={broadcastSegment === id ? "active" : ""} key={id} onClick={() => { setBroadcastSegment(id); setSelectedBroadcastIds([]); }}><i>{broadcastSegment === id ? "✓" : ""}</i><span><strong>{title}</strong><small>{description}</small></span></button>)}<section className="broadcast-filters"><header><span>FILTROS DO PÚBLICO</span><button onClick={() => { setBroadcastRange("30"); setBroadcastStart(""); setBroadcastEnd(""); setBroadcastStage("all"); setSelectedBroadcastIds([]); }}>Limpar filtros</button></header><div className="broadcast-range-buttons">{[["7", "7 dias"], ["14", "14 dias"], ["30", "30 dias"], ["custom", "Personalizado"]].map(([value, label]) => <button key={value} className={broadcastRange === value ? "active" : ""} onClick={() => { setBroadcastRange(value); setSelectedBroadcastIds([]); }}>{label}</button>)}</div>{broadcastRange === "custom" && <div className="broadcast-custom-dates"><label>De<input type="date" value={broadcastStart} onChange={(event) => { setBroadcastStart(event.target.value); setSelectedBroadcastIds([]); }} /></label><label>Até<input type="date" value={broadcastEnd} onChange={(event) => { setBroadcastEnd(event.target.value); setSelectedBroadcastIds([]); }} /></label></div>}<label className="broadcast-stage-filter">Etapa do CRM<select value={broadcastStage} onChange={(event) => { setBroadcastStage(event.target.value); setSelectedBroadcastIds([]); }}><option value="all">Todas as etapas</option>{stages.map((stage) => <option value={stage.id} key={stage.id}>{stage.title}</option>)}</select></label><small>{broadcastCandidates.length} contato(s) correspondem ao período, segmento e etapa selecionados.</small></section><div className="broadcast-mode"><button className={broadcastMode === "limit" ? "active" : ""} onClick={() => setBroadcastMode("limit")}>Usar quantidade</button><button className={broadcastMode === "manual" ? "active" : ""} onClick={() => setBroadcastMode("manual")}>Selecionar manualmente</button></div>{broadcastMode === "manual" && <div className="broadcast-contact-picker"><header><span>{validSelectedBroadcastIds.length} selecionados</span><div><button onClick={() => setSelectedBroadcastIds(broadcastCandidates.slice(0, 100).map((lead) => lead.id))}>Selecionar até 100</button><button onClick={() => setSelectedBroadcastIds([])}>Limpar</button></div></header>{broadcastCandidates.map((lead) => <label key={lead.id}><input type="checkbox" checked={validSelectedBroadcastIds.includes(lead.id)} onChange={() => setSelectedBroadcastIds((ids) => ids.includes(lead.id) ? ids.filter((id) => id !== lead.id) : ids.length < 100 ? [...ids, lead.id] : ids)} /><span><strong>{lead.name}</strong><small>{lead.phone} · {stages.find((stage) => stage.id === lead.stage)?.title}</small></span></label>)}</div>}</article>
            <article className="ops-card composer-card"><div className="card-title"><div><span>2. MENSAGEM E RITMO</span><h2>Prepare o disparo</h2></div><b>{broadcastTargetCount} destinatários</b></div><label>Mensagem<textarea value={broadcastMessage} onChange={(event) => setBroadcastMessage(event.target.value)} placeholder="Olá! Passando para confirmar…" /></label><div className="template-row"><button onClick={() => setBroadcastMessage(`Olá! Passando para confirmar sua ${currentBusiness.appointmentNoun} de ${currentBusiness.serviceName} 😊 Está tudo certo para você?`)}>Confirmação</button><button onClick={() => setBroadcastMessage("Oi! Vi que nossa conversa ficou pendente. Ainda posso te ajudar a encontrar o melhor horário para começar?")}>Retomada</button><button onClick={() => setBroadcastMessage("Olá! Temos uma novidade para você. Quer receber mais informações?")}>Campanha</button></div><div className="broadcast-controls">{broadcastMode === "limit" && <label>Quantidade nesta operação<input type="number" min="1" max="100" value={broadcastLimit} onChange={(event) => setBroadcastLimit(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /><small>Máximo de 100 contatos por operação</small></label>}<label>Contatos por lote<input type="number" min="5" max="50" value={broadcastBatchSize} onChange={(event) => setBroadcastBatchSize(Math.max(5, Math.min(50, Number(event.target.value) || 20)))} /><small>O sistema faz uma pausa entre os lotes</small></label></div><div className="batch-plan"><span>PLANO DE ENVIO</span><div>{broadcastBatchPlan.length ? broadcastBatchPlan.map((size, index) => <b key={index}>Lote {index + 1}: {size}</b>) : <small>Nenhum contato selecionado</small>}</div></div><div className="broadcast-summary"><span><b>{broadcastTargetCount}</b> contatos em <b>{broadcastBatchPlan.length}</b> lote(s)</span><small>O ritmo reduz picos, mas o uso deve respeitar as políticas do WhatsApp.</small></div><button className="save-button wide" onClick={sendBroadcast} disabled={broadcastBusy || !broadcastTargetCount}>{broadcastBusy ? "Enviando lotes…" : `Enviar ${broadcastTargetCount} contato(s)`}</button></article>
          </div>
          <div className="automation-strip ops-card"><span><i /> Retomadas automáticas ativas · verificação a cada minuto</span><div><b>1ª tentativa</b><small>15 minutos sem resposta</small></div><div><b>2ª tentativa</b><small>30 minutos sem resposta</small></div><div><b>Agendamentos</b><small>24h, 3h e 2h antes</small></div></div>
        </section>}

        {active === "Contatos" && <section className="section-stack"><div className="section-hero compact"><div><span>BASE DE CONTATOS</span><h2>Alunos e novos contatos, bem separados</h2><p>A IA identifica quando a pessoa já é aluna. A equipe também pode ajustar a classificação manualmente a qualquer momento.</p></div><button className="save-button" onClick={importContacts} disabled={importBusy}>{importBusy ? "Importando…" : "↓ Importar do WhatsApp"}</button></div><div className="contact-import-rule"><b>Proteção automática</b><span>Contatos marcados como alunos ficam fora da qualificação, do CRM comercial e dos disparos automáticos. O atendimento humano continua disponível no Chat.</span></div><div className="contacts-tools"><label className="search-field">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" /></label><div className="contact-view-tabs"><button className={contactView === "all" ? "active" : ""} onClick={() => setContactView("all")}>Todos <b>{leads.length}</b></button><button className={contactView === "leads" ? "active" : ""} onClick={() => setContactView("leads")}>Novos leads <b>{leads.filter((lead) => !lead.student).length}</b></button><button className={contactView === "students" ? "active" : ""} onClick={() => setContactView("students")}>Alunos <b>{leads.filter((lead) => lead.student).length}</b></button></div></div><div className="contacts-v2 ops-card"><header><span>Contato</span><span>Origem</span><span>Etapa</span><span>Score</span><span>Última interação</span><span>Ações</span></header>{leads.filter((lead) => (contactView === "all" || (contactView === "students" ? lead.student : !lead.student)) && `${lead.name} ${lead.phone}`.toLowerCase().includes(search.toLowerCase())).map((lead) => <div key={lead.id}><span><div className="contact-avatar">{lead.initials}</div><b>{lead.name}<small>{lead.phone}</small></b></span><span>{lead.student ? <em className="student-badge">Aluno</em> : lead.contactOnly ? <em className="contact-only-badge">Importado · manual</em> : lead.imported ? "Importado" : lead.source}</span><span><em>{lead.student ? "Atendimento humano" : lead.contactOnly ? "Somente contato" : stages.find((stage) => stage.id === lead.stage)?.title || lead.stage}</em></span><span>{lead.contactOnly || lead.student ? "—" : `${lead.score}/100`}</span><span>{lead.time}</span><span><button onClick={() => lead.contactOnly ? startContactConversation(lead) : (setSelectedPhone(lead.phone), setActive("Chat"))}>{lead.contactOnly ? "Iniciar conversa" : "Conversar"}</button>{!lead.student && <button onClick={() => openSchedule(lead)}>Agendar</button>}<button className={lead.student ? "student-toggle active" : "student-toggle"} onClick={() => classifyContact(lead, !lead.student)}>{lead.student ? "Voltar para lead" : "Marcar como aluno"}</button>{lead.contactOnly && !lead.student && <button onClick={() => selectContactForBroadcast(lead)}>Selecionar disparo</button>}</span></div>)}</div></section>}

        {active === "Qualificação" && <section className="section-stack"><div className="section-hero"><div><span>QUALIFICAÇÃO COMERCIAL · {currentBusiness.shortLabel.toUpperCase()}</span><h2>Roteiro estratégico da IA</h2><p>O roteiro principal se adapta automaticamente ao segmento. Você pode incluir até cinco perguntas extras, usadas apenas quando forem relevantes.</p></div><div className="ai-live"><i /> {currentBusiness.label}</div></div><div className="qualification-layout"><article className="ops-card"><div className="card-title"><div><span>ROTEIRO ADAPTADO</span><h2>Perguntas essenciais</h2></div><b>Protegido</b></div>{[["01", "Experiência", currentBusiness.experienceQuestion], ["02", "Motivação", currentBusiness.motivationQuestion], ["03", "Momento", "Quer começar agora ou está pesquisando para mais adiante?"], ["04", "Disponibilidade", "Qual período funciona melhor: manhã, tarde ou noite?"]].map(([number, title, question]) => <div className="qualification-row" key={number}><b>{number}</b><span><strong>{title}</strong><small>{question}</small></span><em>Ativa</em></div>)}</article><article className="ops-card custom-questions"><div className="card-title"><div><span>PERSONALIZAÇÃO</span><h2>Perguntas extras</h2></div><b>{profile.qualificationQuestions.length}/5</b></div><p>A IA usa no máximo uma pergunta extra e não ultrapassa quatro perguntas na conversa.</p>{profile.qualificationQuestions.map((question, index) => <div key={index}><span>{index + 1}</span><input value={question} onChange={(event) => setProfile({ ...profile, qualificationQuestions: profile.qualificationQuestions.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} /><button onClick={() => setProfile({ ...profile, qualificationQuestions: profile.qualificationQuestions.filter((_, itemIndex) => itemIndex !== index) })}>×</button></div>)}{profile.qualificationQuestions.length < 5 && <button className="add-question" onClick={() => setProfile({ ...profile, qualificationQuestions: [...profile.qualificationQuestions, ""] })}>＋ Adicionar pergunta</button>}<button className="save-button wide" onClick={saveProfile} disabled={profile.demo}>Salvar roteiro</button></article></div></section>}

        {active === "Conexões" && <section className="section-stack">
          <div className="section-hero"><div><span>UNIDADES E INTEGRAÇÕES</span><h2>Conexões do sistema</h2><p>Cada unidade autorizada possui seu próprio WhatsApp, mantendo conversas e atendimento vinculados à mesma empresa.</p></div><strong>{connectionLimit} {connectionLimit === 1 ? "conexão autorizada" : "conexões autorizadas"}</strong></div>
          <div className="unit-permission-note"><div><b>Uma conexão vem liberada por padrão.</b><span>Para adicionar outra unidade, solicite a liberação ao administrador da plataforma.</span></div><button onClick={loadConnectionUnits} disabled={connectionBusy}>{connectionBusy ? "Verificando…" : "↻ Atualizar status"}</button></div>
          <article className={`ops-card ai-pause-card ${aiPause.active ? "paused" : ""}`}><div className="ai-pause-status"><i>{aiPause.active ? "Ⅱ" : "AI"}</i><span><strong>{aiPause.active ? "IA temporariamente pausada" : "IA atendendo normalmente"}</strong><small>{aiPause.active ? aiPause.indefinite ? "Pausada até você reativar. O WhatsApp permanece conectado." : `Retoma automaticamente em ${new Date(aiPause.until!).toLocaleString("pt-BR")}. O WhatsApp permanece conectado.` : "Novos contatos recebem o pré-atendimento automático."}</small></span><em>{aiPause.active ? "Pausada" : "Ativa"}</em></div>{aiPause.active ? <button className="resume-ai" disabled={aiPauseBusy} onClick={() => changeAiPause({ action: "resume" })}>{aiPauseBusy ? "Reativando…" : "▶ Reativar IA agora"}</button> : <div className="ai-pause-controls"><span>PAUSA RÁPIDA</span><div><button disabled={aiPauseBusy} onClick={() => changeAiPause({ action: "pause_hours", hours: 2 })}>2 horas</button><button disabled={aiPauseBusy} onClick={() => changeAiPause({ action: "pause_hours", hours: 4 })}>4 horas</button><button disabled={aiPauseBusy} onClick={() => changeAiPause({ action: "pause_hours", hours: 6 })}>6 horas</button><button disabled={aiPauseBusy} onClick={() => changeAiPause({ action: "pause_indefinite" })}>Até eu reativar</button></div><label>Ou pausar até<input type="datetime-local" value={aiPauseUntilInput} onChange={(event) => setAiPauseUntilInput(event.target.value)} /><button disabled={aiPauseBusy || !aiPauseUntilInput} onClick={() => changeAiPause({ action: "pause_until", until: aiPauseUntilInput })}>Programar pausa</button></label></div>}</article>
          <article className="ops-card origin-tracking-card">
            <div className="origin-tracking-copy"><span>RASTREAMENTO DE ORIGEM</span><h3>Saiba de qual anúncio o contato veio</h3><p>Meta Ads é identificado automaticamente quando o WhatsApp envia a referência do anúncio. Para garantir a origem — principalmente no Google — use uma das mensagens abaixo no link ou anúncio.</p></div>
            <div className="origin-tracking-options">
              {[
                ["Instagram", "Olá, vim pelo Instagram [PILATIA_INSTAGRAM]"],
                ["Facebook", "Olá, vim pelo Facebook [PILATIA_FACEBOOK]"],
                ["Google", "Olá, vim pelo Google [PILATIA_GOOGLE]"],
              ].map(([source, message]) => <div key={source}><span><strong>{source}</strong><small>{message}</small></span><button onClick={async () => { await navigator.clipboard.writeText(message); notify(`Mensagem de ${source} copiada.`); }}>Copiar mensagem</button></div>)}
            </div>
            <small className="origin-tracking-note">Quando não houver referência nem marcador, o CRM registra “WhatsApp”. A PilatIA nunca adivinha a origem.</small>
          </article>
          <div className="connections-grid unit-connections">{connectionUnits.map((unit, index) => <article className="ops-card unit-card" key={unit.id}><div className="unit-card-summary"><div className="connection-icon whatsapp">W</div><span><input value={unit.name} aria-label={`Nome da ${unit.name}`} onChange={(event) => setConnectionUnits((items) => items.map((item, unitIndex) => unitIndex === index ? { ...item, name: event.target.value } : item))} onBlur={(event) => renameConnectionUnit(index, event.target.value)} /><p>WhatsApp da unidade {index + 1} · mensagens, contatos e etiquetas</p></span><em className={unit.connected ? "ok" : "warning"}>{unit.connected ? "Conectado" : "Aguardando conexão"}</em><div className="connection-actions"><button onClick={() => setEditingUnit(editingUnit === index ? null : index)}>{editingUnit === index ? "Fechar dados" : "Configurar unidade"}</button><button onClick={() => { setQrUnit(index); setShowSetup(true); }}>{unit.connected ? "Ver conexão" : "Conectar QR Code"}</button>{unit.connected && <button className="disconnect" disabled={connectionBusy} onClick={() => disconnectConnectionUnit(index)}>{connectionBusy ? "Aguarde…" : "Desconectar"}</button>}</div></div>{editingUnit === index && <div className="unit-profile-form"><p>Campos vazios herdam automaticamente as configurações gerais da empresa.</p>{([['address','Endereço'],['businessHours','Horário de funcionamento'],['availablePeriods','Períodos disponíveis'],['services','Serviços desta unidade'],['prices','Preços autorizados'],['paymentMethods','Formas de pagamento'],['promotionText','Condição comercial'],['cancellationPolicy','Política de cancelamento']] as Array<[keyof UnitProfile,string]>).map(([field,label]) => <label key={field}>{label}<textarea value={String(unit.profile?.[field] || '')} onChange={(event) => setConnectionUnits((items) => items.map((item, unitIndex) => unitIndex === index ? { ...item, profile: { ...(item.profile || {}), [field]: event.target.value } } : item))} placeholder={`Herdar: ${String(profile[field as keyof Profile] || 'não informado')}`} /></label>)}<button className="save-button" disabled={connectionBusy} onClick={() => saveConnectionUnitProfile(index)}>{connectionBusy ? "Salvando…" : "Salvar dados da unidade"}</button></div>}</article>)}</div>
          {!connectionUnits.length && <div className="ops-card connection-empty">{connectionBusy ? "Consultando conexões autorizadas…" : "Não foi possível carregar as conexões. Tente atualizar o status."}</div>}
          <div className="connections-grid"><article className="ops-card"><div className="connection-icon openai">AI</div><span><h3>OpenAI</h3><p>Qualificação e resumo inteligente</p></span><em className="ok">Operacional</em></article><article className="ops-card"><div className="connection-icon database">DB</div><span><h3>Supabase</h3><p>Contatos, conversas e isolamento por empresa</p></span><em className="ok">Operacional</em></article></div>
        </section>}

        {active === "Configurações" && <section className="section-stack"><div className="section-hero"><div><span>CONFIGURAÇÕES DA EMPRESA</span><h2>Identidade e operação</h2><p>Essas informações ficam isoladas no cadastro da sua empresa e personalizam todo o atendimento.</p></div></div><article className="settings-form ops-card"><div className="card-title"><div><span>PERFIL</span><h2>Dados básicos</h2></div><em>{profile.demo ? "Demonstração · somente leitura" : "Dados protegidos"}</em></div><div className="form-v2"><label>Nome da empresa<input value={profile.companyName} onChange={(event) => setProfile({ ...profile, companyName: event.target.value })} /></label><label>Tipo de negócio<select value={profile.businessType} onChange={(event) => setProfile({ ...profile, businessType: event.target.value as BusinessType })}>{businessTypes.map((business) => <option value={business.id} key={business.id}>{business.label}</option>)}</select></label><label>Cidade<input value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} /></label><label className="full">Endereço<input value={profile.address} onChange={(event) => setProfile({ ...profile, address: event.target.value })} /></label><label>Horário de funcionamento<textarea value={profile.businessHours} onChange={(event) => setProfile({ ...profile, businessHours: event.target.value })} /></label><label>Períodos disponíveis<textarea value={profile.availablePeriods} onChange={(event) => setProfile({ ...profile, availablePeriods: event.target.value })} /></label><label>Política de cancelamento<textarea value={profile.cancellationPolicy} onChange={(event) => setProfile({ ...profile, cancellationPolicy: event.target.value })} /></label><label>Serviços<textarea value={profile.services} onChange={(event) => setProfile({ ...profile, services: event.target.value })} /></label></div><div className="segment-preview"><span>ATENDIMENTO ADAPTADO</span><strong>{currentBusiness.label}</strong><small>A IA utilizará termos de {currentBusiness.serviceName}, mantendo o padrão comercial e o limite de quatro perguntas.</small></div><label className="switch-row"><span><strong>Lembretes automáticos</strong><small>Enviar 24h, 3h e 2h antes do agendamento</small></span><input type="checkbox" checked={profile.remindersEnabled} onChange={(event) => setProfile({ ...profile, remindersEnabled: event.target.checked })} /></label><button className="save-button" onClick={saveProfile} disabled={profile.demo}>Salvar configurações</button></article></section>}
        {active === "Configurações" && isCompanyAdmin && <TeamAccessPanel notify={notify} />}
        {active === "Configurações" && <section className="settings-health-entry ops-card"><div><span>DIAGNÓSTICO</span><h2>Saúde da operação</h2><p>Consulte integrações, filas, lembretes e alertas quando precisar investigar o funcionamento da plataforma.</p></div><button onClick={() => setHealthOpen((open) => !open)}>{healthOpen ? "Fechar diagnóstico" : "Abrir saúde da operação"}</button></section>}
        {active === "Configurações" && healthOpen && <OperationsHealth onNavigate={(page) => { setHealthOpen(false); setActive(page); }} />}
        {active === "Administração" && isPlatformAdmin && <AdminPanel notify={notify} />}
      </div>
    </section>
    {onboardingOpen && !isPlatformAdmin && <AiOnboardingModal profile={profile} onChange={(next) => setProfile(next as Profile)} onClose={() => setOnboardingOpen(false)} onSave={saveProfile} onTest={() => { setOnboardingOpen(false); setSimulatorOpen(true); }} />}
    {simulatorOpen && !isPlatformAdmin && <AiSimulatorModal onClose={() => setSimulatorOpen(false)} />}

    {crmEditor && <div className="modal-backdrop" onMouseDown={() => setCrmEditor(null)}><div className="modal crm-editor-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={() => setCrmEditor(null)}>×</button>
      <span className="eyebrow">CRM / OPORTUNIDADE</span><h2>{crmEditor.name}</h2><p>{crmEditor.phone} · registre somente informações reais do atendimento.</p>
      <div className={`crm-automation-status ${crmEditor.automationState || "active"}`}><strong>Automação</strong><span>{crmEditor.automationState === "snoozed_by_lead" ? `Suspensa a pedido do contato${crmEditor.automationSnoozedUntil ? ` até ${formatWhen(crmEditor.automationSnoozedUntil)}` : ""}` : crmEditor.automationState === "human_replied" ? "Cancelada após resposta do atendente" : crmEditor.aiPaused ? "Atendimento humano ativo" : "Ativa"}</span>{crmEditor.stoppedReason && <small>{crmEditor.stoppedReason}</small>}</div>
      <div className="crm-editor-form">
        <label>Etapa<select value={crmDraft.stage} onChange={(event) => setCrmDraft((draft) => ({ ...draft, stage: event.target.value }))}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label>
        <label>Origem do contato<input list="crm-origin-options" value={crmDraft.source} onChange={(event) => setCrmDraft((draft) => ({ ...draft, source: event.target.value }))} placeholder="Selecione ou escreva a origem manualmente" /><small className="field-help">Identificada pela IA quando possível · sempre editável pelo atendente.</small><datalist id="crm-origin-options"><option value="Instagram Ads" /><option value="Facebook Ads" /><option value="Meta Ads" /><option value="Google" /><option value="WhatsApp" /><option value="Indicação" /><option value="Ligação" /><option value="Evento" /><option value="Orgânico" /></datalist></label>
        <label>Plano ou serviço fechado<input value={crmDraft.soldPlan} onChange={(event) => setCrmDraft((draft) => ({ ...draft, soldPlan: event.target.value }))} placeholder="Ex.: Plano 2x por semana" /></label>
        <label>Valor da oportunidade (R$)<input type="number" min="0" step="0.01" value={crmDraft.opportunityValue} onChange={(event) => setCrmDraft((draft) => ({ ...draft, opportunityValue: event.target.value }))} placeholder="0,00" /></label>
        <label>Data do contato<input type="datetime-local" value={crmDraft.contactAt} onChange={(event) => setCrmDraft((draft) => ({ ...draft, contactAt: event.target.value }))} /></label>
        <label>Data da conversão<input type="datetime-local" value={crmDraft.convertedAt} onChange={(event) => setCrmDraft((draft) => ({ ...draft, convertedAt: event.target.value }))} /></label>
        <label>Parou de responder em<input type="datetime-local" value={crmDraft.stoppedRespondingAt} onChange={(event) => setCrmDraft((draft) => ({ ...draft, stoppedRespondingAt: event.target.value }))} /><small className="field-help">Registrado automaticamente na primeira tentativa de recuperação; pode ser corrigido.</small></label>
        <label>Próxima ação<input type="datetime-local" value={crmDraft.nextActionAt} onChange={(event) => { setCrmDraft((draft) => ({ ...draft, nextActionAt: event.target.value })); setFollowupFirstAt(event.target.value); }} /><small className="field-help">Use este horário para programar a próxima ação da IA.</small></label>
        <label className="full">Objeção identificada<input value={crmDraft.objection} onChange={(event) => setCrmDraft((draft) => ({ ...draft, objection: event.target.value }))} placeholder="A IA preenche quando identificar; o atendente pode corrigir." /></label>
        <label className="full">Registro do atendimento<textarea rows={5} value={crmDraft.crmNotes} onChange={(event) => setCrmDraft((draft) => ({ ...draft, crmNotes: event.target.value }))} placeholder="Anote contexto, objeções, combinação feita e próximos passos." /></label>
      </div>
      <section className="crm-attempt-history">
        <header><div><span>HISTÓRICO DE CONTATOS</span><h3>Tentativas e retomadas</h3></div><b>{(crmEditor.contactAttempts || []).filter((item) => item.actor !== "Contato").length} tentativa(s)</b></header>
        <div className="attempt-stats"><span><strong>{(crmEditor.contactAttempts || []).filter((item) => item.actor === "IA").length}</strong><small>Pela IA</small></span><span><strong>{(crmEditor.contactAttempts || []).filter((item) => item.actor === "Atendente").length}</strong><small>Pelo atendente</small></span><span><strong>{(crmEditor.contactAttempts || []).filter((item) => /recuper|follow-up/i.test(item.type)).length}</strong><small>Recuperações</small></span></div>
        <div className="attempt-timeline">{crmEditor.contactAttempts?.length ? crmEditor.contactAttempts.map((attempt) => <article key={attempt.id}><i className={attempt.actor === "IA" ? "ai" : attempt.actor === "Atendente" ? "human" : "contact"}>{attempt.actor === "IA" ? "AI" : attempt.actor === "Atendente" ? "AT" : "C"}</i><span><strong>{attempt.type}</strong><small>{new Date(attempt.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {attempt.actor}</small><p>{attempt.preview}</p></span></article>) : <p className="attempt-empty">As tentativas aparecerão automaticamente após os próximos contatos.</p>}</div>
      </section>
      <section className="crm-quick-actions">
        <header><span>AÇÕES RÁPIDAS</span><strong>O que você quer fazer com este contato?</strong></header>
        <div><button disabled={followupBusy} onClick={() => runLeadFollowup("immediate", "recovery")}><i>↻</i><span><strong>Recuperar agora</strong><small>Enviar uma mensagem de retomada</small></span></button>{crmEditor.appointmentAt && <button onClick={() => appointmentAction(crmEditor, "remind")}><i>◷</i><span><strong>Lembrar agora</strong><small>Confirmar o horário pelo WhatsApp</small></span></button>}<button onClick={() => { setCrmEditor(null); openSchedule(crmEditor); }}><i>＋</i><span><strong>{crmEditor.appointmentAt ? "Editar agendamento" : "Criar agendamento"}</strong><small>{crmEditor.appointmentAt ? "Alterar horário e reprogramar lembretes" : "Definir data, horário e lembretes"}</small></span></button><button onClick={() => document.getElementById("crm-next-action")?.scrollIntoView({ behavior: "smooth", block: "start" })}><i>⌁</i><span><strong>Programar próxima ação</strong><small>Recuperação ou novo agendamento</small></span></button></div>
      </section>
      <section className="crm-followup-box" id="crm-next-action">
        <header><div><span>AUTOMAÇÃO DE FOLLOW-UP</span><h3>Ative a próxima ação da IA</h3></div>{crmEditor.followupPlan?.status === "active" && <b>● Sequência ativa</b>}</header>
        {crmEditor.followupPlan?.status === "active" && <div className="followup-active-plan"><strong>{crmEditor.followupPlan.sent?.length || 0} de {crmEditor.followupPlan.attempts || 0} tentativa(s) enviada(s)</strong><span>Próximo contato: {formatWhen(crmEditor.nextActionAt)}</span><button disabled={followupBusy} onClick={() => runLeadFollowup("cancel")}>Cancelar sequência</button></div>}
        <div className="followup-objectives"><button className={followupObjective === "recovery" ? "active" : ""} onClick={() => setFollowupObjective("recovery")}><strong>Recuperar conversa</strong><small>Para quem parou de responder</small></button><button className={followupObjective === "reschedule" ? "active" : ""} onClick={() => setFollowupObjective("reschedule")}><strong>Retomar agendamento</strong><small>Para quem ainda não definiu horário</small></button></div>
        <button className="followup-now" disabled={followupBusy} onClick={() => runLeadFollowup("immediate")}>{followupBusy ? "Enviando…" : followupObjective === "recovery" ? "Enviar recuperação agora" : "Tentar agendar agora"}</button>
        <div className="followup-divider"><span>ou programe uma sequência</span></div>
        <div className="followup-scheduler"><label>Quantidade<select value={followupAttempts} onChange={(event) => setFollowupAttempts(Number(event.target.value))}><option value={1}>1 tentativa</option><option value={2}>2 tentativas</option><option value={3}>3 tentativas</option></select></label><label>Intervalo<select value={followupCadence} onChange={(event) => setFollowupCadence(event.target.value as "daily" | "three_days")}><option value="daily">Uma por dia</option><option value="three_days">A cada 3 dias</option></select></label><label>Começar em<input type="datetime-local" value={followupFirstAt} onChange={(event) => setFollowupFirstAt(event.target.value)} /></label></div>
        <p className="followup-suggestion">Sugestão: {followupAttempts} tentativa(s), {followupCadence === "daily" ? "uma por dia" : "a cada três dias"}. A sequência para automaticamente se o lead responder.</p>
        <button className="followup-schedule" disabled={followupBusy || !followupFirstAt} onClick={() => runLeadFollowup("schedule")}>{followupBusy ? "Programando…" : "Programar follow-up automático"}</button>
      </section>
      <div className="crm-editor-actions"><button onClick={() => setCrmEditor(null)}>Cancelar</button><button onClick={() => saveCrmCard()}>Salvar informações</button></div>
    </div></div>}

    {showSetup && <div className="modal-backdrop" onMouseDown={() => setShowSetup(false)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowSetup(false)}>×</button><div className="whatsapp-logo">W</div><span className="eyebrow">CONEXÃO WHATSAPP</span><h2>{qrStatus === "connected" ? "WhatsApp conectado" : "Leia o QR Code"}</h2><p>Abra o WhatsApp, acesse Aparelhos conectados e leia o código.</p>{qrStatus === "loading" && <div className="qr-loading"><i />Verificando conexão segura…</div>}{qrStatus === "ready" && <div className="qr"><img src={qrCode} alt="QR Code do WhatsApp" /><span>O código é renovado automaticamente</span></div>}{qrStatus === "connected" && <div className="connected-card"><div className="connected-check">✓</div><div><strong>Conexão ativa</strong><p>Mensagens e contatos sincronizados</p></div></div>}{qrStatus === "error" && <div className="qr-error"><strong>Não foi possível consultar o WhatsApp agora</strong><p>{qrCode || "O sistema continuará tentando automaticamente."}</p><button onClick={() => { setShowSetup(false); window.setTimeout(() => setShowSetup(true), 50); }}>Tentar agora</button></div>}</div></div>}
    {scheduleOpen && <div className="modal-backdrop" onMouseDown={closeSchedule}><div className="modal schedule-v2 schedule-editor" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={closeSchedule}>×</button><span className="eyebrow">{scheduleLead?.appointmentAt ? "EDITAR AGENDAMENTO" : "NOVO AGENDAMENTO"}</span><h2>{scheduleLead?.appointmentAt ? `Editar horário de ${scheduleLead.name}` : "Criar agendamento manual"}</h2><p>Selecione um contato existente ou cadastre nome e WhatsApp. A confirmação será enviada imediatamente.</p><label>Contato<select value={scheduleLead?.id || "new"} onChange={(event) => { const id = Number(event.target.value); openSchedule(Number.isFinite(id) ? leads.find((lead) => lead.id === id) || null : null); }}><option value="new">＋ Novo contato</option>{leads.map((lead) => <option value={lead.id} key={lead.id}>{lead.name} · {lead.phone}</option>)}</select></label>{!scheduleLead && <div className="manual-contact-fields"><label>Nome<input value={manualContactName} onChange={(event) => setManualContactName(event.target.value)} placeholder="Nome do cliente" /></label><label>WhatsApp<input value={manualContactPhone} onChange={(event) => setManualContactPhone(event.target.value)} placeholder="55 11 99999-9999" /></label></div>}<label>Data e horário<input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></label><label>Observações<textarea value={scheduleNotes} onChange={(event) => setScheduleNotes(event.target.value)} placeholder="Profissional, unidade ou orientação importante…" /></label><div className="schedule-summary"><span>Confirmação imediata</span><span>Lembretes em 24h, 3h e 2h</span></div><button className="save-button wide" onClick={saveAppointment}>{scheduleLead?.appointmentAt ? "Salvar alterações" : "Confirmar agendamento"}</button></div></div>}
    {tutorialOpen && <div className={`tutorial-layer ${tutorialMinimized ? "minimized" : ""}`} onMouseDown={() => !tutorialMinimized && setTutorialOpen(false)}>
      <section className="tutorial-modal" role="dialog" aria-modal={!tutorialMinimized} aria-label="Central de tutoriais do PilatIA" onMouseDown={(event) => event.stopPropagation()}>
        <header className="tutorial-header"><div><span>CENTRAL DE AJUDA</span><strong>{tutorialMinimized ? currentTutorial.title : "Aprenda a usar o PilatIA"}</strong></div><div><button aria-label={tutorialMinimized ? "Ampliar tutorial" : "Minimizar tutorial"} title={tutorialMinimized ? "Ampliar" : "Minimizar"} onClick={() => setTutorialMinimized(!tutorialMinimized)}>{tutorialMinimized ? "□" : "—"}</button><button aria-label="Fechar tutoriais" title="Fechar" onClick={() => setTutorialOpen(false)}>×</button></div></header>
        <div className="tutorial-body">
          <aside><p>Assista às aulas na ordem ou escolha o assunto que precisa agora.</p>{tutorials.map((tutorial) => <button key={tutorial.id} className={tutorial.id === tutorialId ? "active" : ""} onClick={() => setTutorialId(tutorial.id)}><i>{tutorial.number}</i><span><strong>{tutorial.title}</strong><small>{tutorial.description}</small></span><b>▶</b></button>)}</aside>
          <article><div className="tutorial-video"><iframe key={currentTutorial.id} src={`https://www.youtube-nocookie.com/embed/${currentTutorial.id}?rel=0&modestbranding=1`} title={`Aula ${currentTutorial.number} - ${currentTutorial.title}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div><div className="tutorial-caption"><span>AULA {currentTutorial.number}</span><h3>{currentTutorial.title}</h3><p>{currentTutorial.description}</p></div></article>
        </div>
      </section>
    </div>}
    {toast && <div className="toast">{toast}</div>}
  </main>;
}
