import { NextRequest, NextResponse } from "next/server";
import { conversationRecord, conversationScope, getTenant, serviceHeaders, StorageMode, tenantHasModule } from "../../lib/tenant";

export const dynamic = "force-dynamic";

const base = () => process.env.SUPABASE_URL?.replace(/\/$/, "");

async function latest(mode: StorageMode, companyId: string, phone: string) {
  const response = await fetch(`${base()}/rest/v1/conversations?${conversationScope(mode, companyId)}&phone=eq.${encodeURIComponent(phone)}&select=contact_name,score,summary,status&order=updated_at.desc&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
  const rows = response.ok ? await response.json() : [];
  return rows[0] || null;
}

async function record(mode: StorageMode, companyId: string, phone: string, name: string, text: string, summary: Record<string, unknown>, status = "human_active") {
  const tenantData = conversationRecord(mode, companyId, summary);
  return fetch(`${base()}/rest/v1/conversations`, {
    method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: "", ai_reply: text, status, score: 80, updated_at: new Date().toISOString() }),
  });
}

export async function GET(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "chat")) return NextResponse.json({ error: "Chat não está incluído neste plano" }, { status: 403 });
  const phone = request.nextUrl.searchParams.get("phone")?.replace(/\D/g, "") || "";
  if (!phone) return NextResponse.json({ messages: [], mode: "ai" });
  if (tenant.userId === "demo") return NextResponse.json({ messages: [], mode: "ai" });
  if (!base()) return NextResponse.json({ error: "Base de dados temporariamente indisponível" }, { status: 503 });
  const response = await fetch(`${base()}/rest/v1/conversations?${conversationScope(tenant.storageMode, tenant.companyId)}&phone=eq.${phone}&select=id,last_message,ai_reply,status,summary,updated_at&order=updated_at.asc&limit=200`, { headers: serviceHeaders(), cache: "no-store" }).catch(() => null);
  if (!response?.ok) return NextResponse.json({ error: "Não foi possível atualizar a conversa agora. O histórico permanece salvo." }, { status: 502 });
  const rows = await response.json();
  const messages: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (row.last_message && !String(row.last_message).startsWith("[")) messages.push({ id: `${row.id}-in`, direction: "in", text: row.last_message, at: row.updated_at, author: "Contato" });
    if (row.ai_reply) messages.push({ id: `${row.id}-out`, direction: "out", text: row.ai_reply, at: row.updated_at, author: row.status === "human_active" || row.status === "campaign_sent" ? "Atendente" : "IA" });
  }
  const last = rows.at(-1);
  const mode = last && (last.status === "human_active" || last.summary?.ai_paused) ? "human" : "ai";
  return NextResponse.json({ messages, mode }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "chat")) return NextResponse.json({ error: "Chat não está incluído neste plano" }, { status: 403 });
  const input = await request.json();
  const phone = String(input.phone || "").replace(/\D/g, "");
  const text = String(input.text || "").trim().slice(0, 2000);
  if (!phone || !text) return NextResponse.json({ error: "Mensagem inválida" }, { status: 400 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, demo: true, sentAt: new Date().toISOString() });
  if (!tenant.instance || !process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return NextResponse.json({ error: "WhatsApp não conectado" }, { status: 409 });
  const delivery = await fetch(`${process.env.EVOLUTION_API_URL.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(tenant.instance)}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY }, body: JSON.stringify({ number: phone, text }) });
  if (!delivery.ok) return NextResponse.json({ error: "Não foi possível enviar pelo WhatsApp" }, { status: 502 });
  const deliveryPayload = await delivery.json().catch(() => ({}));
  const messageId = String(deliveryPayload?.key?.id || deliveryPayload?.messageId || deliveryPayload?.id || "");
  const current = await latest(tenant.storageMode, tenant.companyId, phone);
  const previousPlan = current?.summary?.crm_followup_plan && typeof current.summary.crm_followup_plan === "object" ? current.summary.crm_followup_plan : null;
  const now = new Date().toISOString();
  const initiatedByCompany = !current?.summary?.last_customer_at;
  const saved = await record(tenant.storageMode, tenant.companyId, phone, current?.contact_name || input.contactName || "Contato", text, {
    ...(current?.summary || {}), ai_paused: true, human_owner: tenant.email, last_human_at: now, crm_next_action_at: null,
    automation_state: initiatedByCompany ? "human_outreach" : "human_replied", outbound_message_id: messageId, outbound_source: "human_platform",
    crm_stage: current?.summary?.crm_stage || "atendimento", crm_contact_at: current?.summary?.crm_contact_at || now,
    lead_source: current?.summary?.lead_source || (initiatedByCompany ? "Prospecção ativa" : "WhatsApp"),
    lead_source_method: current?.summary?.lead_source_method || (initiatedByCompany ? "company_outbound" : "direct"),
    lead_temperature: current?.summary?.lead_temperature || (initiatedByCompany ? "outbound" : "inbound"),
    ...(initiatedByCompany ? { outbound_initiated_by_company: true, first_company_outbound_at: current?.summary?.first_company_outbound_at || now } : {}),
    ...(previousPlan?.status === "active" ? { crm_followup_plan: { ...previousPlan, status: "cancelled", cancelled_at: now, cancel_reason: "human_replied" } } : {}),
  });
  return saved.ok ? NextResponse.json({ ok: true, sentAt: now, initiatedByCompany }) : NextResponse.json({ error: "Mensagem enviada, mas o histórico não foi atualizado" }, { status: 502 });
}

export async function PATCH(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "chat")) return NextResponse.json({ error: "Chat não está incluído neste plano" }, { status: 403 });
  const input = await request.json();
  const phone = String(input.phone || "").replace(/\D/g, "");
  const mode = input.mode === "human" ? "human" : "ai";
  if (!phone) return NextResponse.json({ error: "Contato inválido" }, { status: 400 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, mode, demo: true });
  const current = await latest(tenant.storageMode, tenant.companyId, phone);
  if (!current) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  const summary = { ...(current.summary || {}), ai_paused: mode === "human", human_owner: mode === "human" ? tenant.email : null, ai_mode_changed_at: new Date().toISOString() };
  const saved = await record(tenant.storageMode, tenant.companyId, phone, current.contact_name || "Contato", "", summary, mode === "human" ? "human_active" : "in_progress");
  return saved.ok ? NextResponse.json({ ok: true, mode }) : NextResponse.json({ error: "Não foi possível alterar o atendimento" }, { status: 502 });
}
