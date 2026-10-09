import { NextRequest, NextResponse } from "next/server";
import { getStorageMode, serviceHeaders } from "../../lib/tenant";
import { isPlatformAdmin } from "../../lib/platform-admin";

export const dynamic = "force-dynamic";

const PLATFORM_ID = "00000000-0000-4000-8000-000000000000";
type Plan = { id: string; name: string; price: number; interval: "monthly" | "yearly"; active: boolean; maxUsers: number; maxMessages: number; features: string[]; modules: string[] };
type Tutorial = { id: string; title: string; description: string; videoId: string };
type Announcement = { id: string; title: string; message: string; expiresAt: string; createdAt: string };
const defaultTutorials: Tutorial[] = [
  { id: "GKZGCT-rWS4", title: "Conheça o PilatIA", description: "Uma visão geral da plataforma e de como o PilatIA organiza o atendimento.", videoId: "GKZGCT-rWS4" },
  { id: "PTwliHuJy6s", title: "Funções e operações do PilatIA", description: "Aprenda a utilizar os principais recursos da operação no dia a dia.", videoId: "PTwliHuJy6s" },
  { id: "CQr55SQo_Bs", title: "Gestão do PilatIA", description: "Veja como acompanhar contatos, atendimento, CRM e gestão da plataforma.", videoId: "CQr55SQo_Bs" },
];

const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "") || "";

async function getUsers() {
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders(), cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível consultar os usuários");
  const payload = await response.json();
  return Array.isArray(payload) ? payload : Array.isArray(payload?.users) ? payload.users : [];
}

async function tableData() {
  const [companiesResponse, membersResponse, users] = await Promise.all([
    fetch(`${baseUrl()}/rest/v1/companies?select=id,name,evolution_instance,settings,active,created_at&order=created_at.desc`, { headers: serviceHeaders(), cache: "no-store" }),
    fetch(`${baseUrl()}/rest/v1/company_members?select=company_id,user_id,role,created_at`, { headers: serviceHeaders(), cache: "no-store" }),
    getUsers(),
  ]);
  if (!companiesResponse.ok || !membersResponse.ok) throw new Error("Não foi possível consultar as empresas");
  return { companies: await companiesResponse.json(), members: await membersResponse.json(), users };
}

async function ensurePlatformSettings() {
  const response = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${PLATFORM_ID}&select=id,settings&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
  const rows = response.ok ? await response.json() : [];
  if (rows[0]) return rows[0];
  const created = await fetch(`${baseUrl()}/rest/v1/companies`, {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ id: PLATFORM_ID, name: "PilatIA · Configuração da plataforma", active: false, settings: { system_record: true, plans: [] } }),
  });
  const createdRows = created.ok ? await created.json() : [];
  if (!created.ok || !createdRows[0]) throw new Error("Não foi possível preparar os planos");
  return createdRows[0];
}

function normalizePlan(input: any): Plan {
  const id = String(input?.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || crypto.randomUUID();
  return {
    id,
    name: String(input?.name || "Novo plano").trim().slice(0, 80),
    price: Math.max(0, Math.round(Number(input?.price || 0) * 100) / 100),
    interval: input?.interval === "yearly" ? "yearly" : "monthly",
    active: input?.active !== false,
    maxUsers: Math.max(1, Math.min(100, Number(input?.maxUsers) || 1)),
    maxMessages: Math.max(0, Math.min(1000000, Number(input?.maxMessages) || 0)),
    features: Array.isArray(input?.features) ? input.features.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 20) : [],
    modules: Array.isArray(input?.modules) ? input.modules.map(String).filter((item: string) => ["chat", "ai", "crm", "agenda", "broadcasts", "contacts"].includes(item)) : ["chat", "ai", "crm", "agenda", "broadcasts", "contacts"],
  };
}

function normalizeTutorial(input: any): Tutorial {
  const url = String(input?.url || input?.videoId || "").trim();
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,20})/) || url.match(/^([A-Za-z0-9_-]{6,20})$/);
  return {
    id: String(input?.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || crypto.randomUUID(),
    title: String(input?.title || "Novo tutorial").trim().slice(0, 100),
    description: String(input?.description || "").trim().slice(0, 240),
    videoId: match?.[1] || "",
  };
}

function normalizeAnnouncement(input: any): Announcement {
  const expires = new Date(String(input?.expiresAt || ""));
  return {
    id: String(input?.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || crypto.randomUUID(),
    title: String(input?.title || "Novidade no PilatIA").trim().slice(0, 100),
    message: String(input?.message || "").trim().slice(0, 1000),
    expiresAt: Number.isNaN(expires.getTime()) ? new Date(Date.now() + 7 * 86400000).toISOString() : expires.toISOString(),
    createdAt: String(input?.createdAt || new Date().toISOString()),
  };
}

function subscriptionStatus(value: unknown, active: boolean) {
  const allowed = ["trial", "active", "past_due", "cancelled"];
  const status = String(value || "");
  return allowed.includes(status) ? status : active ? "trial" : "cancelled";
}

async function buildDashboard() {
  const mode = await getStorageMode();
  const users = await getUsers();
  let companies: any[] = [];
  let members: any[] = [];
  let plans: Plan[] = [];
  let tutorials: Tutorial[] = [];
  let announcements: Announcement[] = [];
  if (mode === "tables") {
    const data = await tableData();
    companies = data.companies.filter((company: any) => company.id !== PLATFORM_ID && company.settings?.system_record !== true);
    members = data.members;
    const platform = data.companies.find((company: any) => company.id === PLATFORM_ID || company.settings?.system_record === true) || await ensurePlatformSettings();
    plans = Array.isArray(platform.settings?.plans) ? platform.settings.plans.map(normalizePlan) : [];
    tutorials = Array.isArray(platform.settings?.tutorials) ? platform.settings.tutorials.map(normalizeTutorial).filter((item: Tutorial) => item.videoId) : [];
    announcements = Array.isArray(platform.settings?.announcements) ? platform.settings.announcements.map(normalizeAnnouncement) : [];
  } else {
    const mapped = new Map<string, any>();
    for (const user of users) {
      const metadata = user.user_metadata || {};
      const id = String(metadata.pilatia_company_id || "");
      if (id && !mapped.has(id)) mapped.set(id, { id, name: metadata.pilatia_company_name || metadata.company_name || "Empresa", settings: metadata.pilatia_settings || {}, active: metadata.pilatia_active !== false, created_at: user.created_at });
      if (!plans.length && Array.isArray(metadata.pilatia_platform_plans)) plans = metadata.pilatia_platform_plans.map(normalizePlan);
      if (!tutorials.length && Array.isArray(metadata.pilatia_platform_tutorials)) tutorials = metadata.pilatia_platform_tutorials.map(normalizeTutorial).filter((item: Tutorial) => item.videoId);
      if (!announcements.length && Array.isArray(metadata.pilatia_platform_announcements)) announcements = metadata.pilatia_platform_announcements.map(normalizeAnnouncement);
    }
    companies = [...mapped.values()];
  }
  const userMap = new Map(users.map((user: any) => [String(user.id), user]));
  const clients = companies.map((company: any) => {
    const member = members.find((item: any) => item.company_id === company.id && item.role === "admin") || members.find((item: any) => item.company_id === company.id);
    const fallbackUser = users.find((user: any) => user.user_metadata?.pilatia_company_id === company.id);
    const user: any = member ? userMap.get(String(member.user_id)) : fallbackUser;
    const settings = company.settings && typeof company.settings === "object" ? company.settings : {};
    const subscription = settings.subscription && typeof settings.subscription === "object" ? settings.subscription : {};
    const status = subscriptionStatus(subscription.status, company.active !== false);
    const plan = plans.find((item) => item.id === subscription.plan_id);
    return {
      id: company.id,
      name: company.name,
      email: user?.email || "Sem e-mail",
      userId: user?.id || "",
      active: company.active !== false,
      status,
      planId: String(subscription.plan_id || ""),
      planName: plan?.name || "Sem plano",
      monthlyValue: status === "active" && plan && !plan.features.includes("__pilatia_unlimited__") ? plan.interval === "yearly" ? plan.price / 12 : plan.price : 0,
      createdAt: company.created_at || user?.created_at || null,
      lastSignInAt: user?.last_sign_in_at || null,
      businessType: settings.businessLabel || settings.businessType || "Não informado",
      whatsappConnected: Boolean(company.evolution_instance),
      connectionLimit: Math.max(1, Math.min(20, Math.trunc(Number(settings.connection_limit) || 1))),
    };
  });
  const activeClients = clients.filter((client: any) => client.active && ["active", "trial"].includes(client.status)).length;
  const monthlyRevenue = clients.reduce((total: number, client: any) => total + Number(client.monthlyValue || 0), 0);
  return { clients, plans, tutorials: tutorials.length ? tutorials : defaultTutorials, announcements, metrics: { totalClients: clients.length, activeClients, inactiveClients: clients.length - activeClients, monthlyRevenue, averageTicket: activeClients ? monthlyRevenue / activeClients : 0 } };
}

async function savePlans(plans: Plan[]) {
  const mode = await getStorageMode();
  if (mode === "tables") {
    const platform = await ensurePlatformSettings();
    const response = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${PLATFORM_ID}`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ settings: { ...(platform.settings || {}), system_record: true, plans } }) });
    if (!response.ok) throw new Error("Não foi possível salvar os planos");
    return;
  }
  const users = await getUsers();
  const owner = users.find((user: any) => Array.isArray(user.user_metadata?.pilatia_platform_plans)) || users[0];
  if (!owner) throw new Error("Cadastre a primeira empresa antes de criar planos");
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${owner.id}`, { method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ user_metadata: { ...(owner.user_metadata || {}), pilatia_platform_plans: plans } }) });
  if (!response.ok) throw new Error("Não foi possível salvar os planos");
}

async function saveTutorials(tutorials: Tutorial[]) {
  const mode = await getStorageMode();
  if (mode === "tables") {
    const platform = await ensurePlatformSettings();
    const response = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${PLATFORM_ID}`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ settings: { ...(platform.settings || {}), system_record: true, tutorials } }) });
    if (!response.ok) throw new Error("Não foi possível salvar os tutoriais");
    return;
  }
  const users = await getUsers();
  const owner = users.find((user: any) => Array.isArray(user.user_metadata?.pilatia_platform_tutorials)) || users[0];
  if (!owner) throw new Error("Cadastre a primeira empresa antes de criar tutoriais");
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${owner.id}`, { method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ user_metadata: { ...(owner.user_metadata || {}), pilatia_platform_tutorials: tutorials } }) });
  if (!response.ok) throw new Error("Não foi possível salvar os tutoriais");
}

async function saveAnnouncements(announcements: Announcement[]) {
  const mode = await getStorageMode();
  if (mode === "tables") {
    const platform = await ensurePlatformSettings();
    const response = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${PLATFORM_ID}`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ settings: { ...(platform.settings || {}), system_record: true, announcements } }) });
    if (!response.ok) throw new Error("Não foi possível salvar os comunicados");
    return;
  }
  const users = await getUsers();
  const owner = users.find((user: any) => Array.isArray(user.user_metadata?.pilatia_platform_announcements)) || users[0];
  if (!owner) throw new Error("Cadastre a primeira empresa antes de criar comunicados");
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${owner.id}`, { method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ user_metadata: { ...(owner.user_metadata || {}), pilatia_platform_announcements: announcements } }) });
  if (!response.ok) throw new Error("Não foi possível salvar os comunicados");
}

export async function GET(request: NextRequest) {
  if (!await isPlatformAdmin(request)) return NextResponse.json({ error: "Acesso exclusivo do administrador" }, { status: 403 });
  try { return NextResponse.json(await buildDashboard(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar administração" }, { status: 502 }); }
}

export async function PATCH(request: NextRequest) {
  if (!await isPlatformAdmin(request)) return NextResponse.json({ error: "Acesso exclusivo do administrador" }, { status: 403 });
  try {
    const input = await request.json();
    const action = String(input.action || "");
    if (action === "tutorials_save") {
      const tutorials = Array.isArray(input.tutorials) ? input.tutorials.map(normalizeTutorial) : [];
      if (tutorials.some((item: Tutorial) => !item.videoId)) return NextResponse.json({ error: "Confira os links do YouTube" }, { status: 400 });
      await saveTutorials(tutorials.slice(0, 30));
      return NextResponse.json({ ok: true, tutorials });
    }
    if (action === "announcements_save") {
      const announcements = Array.isArray(input.announcements) ? input.announcements.map(normalizeAnnouncement).filter((item: Announcement) => item.message) : [];
      await saveAnnouncements(announcements.slice(0, 20));
      return NextResponse.json({ ok: true, announcements });
    }
    if (action === "plan_save" || action === "plan_delete") {
      const dashboard = await buildDashboard();
      if (action === "plan_delete" && dashboard.clients.some((client: any) => client.planId === input.planId)) return NextResponse.json({ error: "Este plano ainda está vinculado a clientes" }, { status: 409 });
      const nextPlans = action === "plan_delete" ? dashboard.plans.filter((plan: Plan) => plan.id !== input.planId) : [...dashboard.plans.filter((plan: Plan) => plan.id !== input.plan?.id), normalizePlan(input.plan)];
      await savePlans(nextPlans);
      return NextResponse.json({ ok: true, plans: nextPlans });
    }
    if (action === "password_reset") {
      const password = String(input.password || "");
      if (!input.userId || password.length < 8) return NextResponse.json({ error: "Informe uma senha temporária com pelo menos 8 caracteres" }, { status: 400 });
      const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${input.userId}`, { method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ password }) });
      return response.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Não foi possível alterar a senha" }, { status: 502 });
    }
    if (action === "send_recovery") {
      const email = String(input.email || "").trim().toLowerCase();
      const response = await fetch(`${baseUrl()}/auth/v1/recover`, { method: "POST", headers: serviceHeaders(), body: JSON.stringify({ email, redirect_to: request.nextUrl.origin }) });
      return response.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Não foi possível enviar a recuperação. Verifique o SMTP do Supabase." }, { status: 502 });
    }
    if (action === "client_update") {
      const dashboard = await buildDashboard();
      const client = dashboard.clients.find((item: any) => item.id === input.companyId);
      if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
      const active = input.active !== false;
      const status = subscriptionStatus(input.status, active);
      const planId = String(input.planId || "");
      const selectedPlan = dashboard.plans.find((plan: Plan) => plan.id === planId);
      const connectionLimit = Math.max(1, Math.min(20, Math.trunc(Number(input.connectionLimit) || 1)));
      const mode = await getStorageMode();
      if (mode === "tables") {
        const current = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${client.id}&select=settings&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
        const rows = current.ok ? await current.json() : [];
        const settings = rows[0]?.settings || {};
        const response = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${client.id}`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ active, settings: { ...settings, connection_limit: connectionLimit, subscription: { ...(settings.subscription || {}), plan_id: planId || null, status, modules: selectedPlan?.modules || null, max_users: selectedPlan?.maxUsers || null, max_messages: selectedPlan?.maxMessages || null, updated_at: new Date().toISOString() } } }) });
        if (!response.ok) throw new Error("Não foi possível atualizar a empresa");
      }
      if (client.userId) {
        const users = await getUsers();
        const user = users.find((item: any) => item.id === client.userId);
        const metadata = user?.user_metadata || {};
        const settings = metadata.pilatia_settings || {};
        const body: Record<string, any> = { user_metadata: { ...metadata, pilatia_active: active, pilatia_settings: { ...settings, connection_limit: connectionLimit, subscription: { ...(settings.subscription || {}), plan_id: planId || null, status, modules: selectedPlan?.modules || null, max_users: selectedPlan?.maxUsers || null, max_messages: selectedPlan?.maxMessages || null, updated_at: new Date().toISOString() } } } };
        const email = String(input.email || "").trim().toLowerCase();
        if (email.includes("@") && email !== client.email) body.email = email;
        const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${client.userId}`, { method: "PUT", headers: serviceHeaders(), body: JSON.stringify(body) });
        if (!response.ok) throw new Error("Empresa atualizada, mas o acesso do usuário não pôde ser sincronizado");
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na administração" }, { status: 502 });
  }
}
