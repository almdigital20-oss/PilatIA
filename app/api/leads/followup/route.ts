import { NextRequest, NextResponse } from "next/server";
import { conversationRecord, conversationScope, getTenant, serviceHeaders, tenantHasModule } from "../../../lib/tenant";
import { followupText, FollowupObjective } from "../../../lib/followup-messages";

export const dynamic = "force-dynamic";

async function send(instance: string, phone: string, text: string) {
  const base = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  if (!base || !process.env.EVOLUTION_API_KEY) return null;
  const response = await fetch(`${base}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY }, body: JSON.stringify({ number: phone, text }),
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return { ok: true, messageId: String(payload?.key?.id || payload?.messageId || payload?.id || "") };
}

export async function POST(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "crm")) return NextResponse.json({ error: "CRM não incluído neste plano" }, { status: 403 });
  const input = await request.json();
  const id = Number(input.id);
  const action = String(input.action || "schedule");
  const objective: FollowupObjective = input.objective === "reschedule" ? "reschedule" : "recovery";
  if (!Number.isFinite(id) || !["immediate", "schedule", "cancel"].includes(action)) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, demo: true, action });
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Integração incompleta" }, { status: 503 });
  const scope = conversationScope(tenant.storageMode, tenant.companyId);
  const response = await fetch(`${base}/rest/v1/conversations?id=eq.${id}&${scope}&select=id,phone,contact_name,status,score,summary&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
  const rows = response.ok ? await response.json() : [];
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  const summary = row.summary && typeof row.summary === "object" ? row.summary : {};
  if (row.status === "student" || summary.contact_type === "student") return NextResponse.json({ error: "Este contato está marcado como aluno e não recebe recuperação comercial automática" }, { status: 409 });
  const now = new Date();

  if (action === "cancel") {
    const previous = summary.crm_followup_plan && typeof summary.crm_followup_plan === "object" ? summary.crm_followup_plan : {};
    const nextSummary = { ...summary, crm_followup_plan: { ...previous, status: "cancelled", cancelled_at: now.toISOString() }, crm_next_action_at: null };
    const saved = await fetch(`${base}/rest/v1/conversations?id=eq.${id}&${scope}`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ summary: nextSummary }) });
    return saved.ok ? NextResponse.json({ ok: true, plan: nextSummary.crm_followup_plan }) : NextResponse.json({ error: "Não foi possível cancelar a sequência" }, { status: 502 });
  }

  if (action === "immediate") {
    const instance = String(summary.whatsapp_instance || tenant.instance || "");
    if (!instance) return NextResponse.json({ error: "WhatsApp da unidade não configurado" }, { status: 409 });
    const text = followupText(objective, 1, String(row.contact_name || ""), tenant.companyName);
    const delivered = await send(instance, String(row.phone), text);
    if (!delivered?.ok) return NextResponse.json({ error: "Não foi possível enviar pelo WhatsApp" }, { status: 502 });
    const sentAt = now.toISOString();
    const tenantData = conversationRecord(tenant.storageMode, tenant.companyId, { ...summary, last_manual_followup_at: sentAt, last_manual_followup_objective: objective, outbound_message_id: delivered.messageId, outbound_source: "human_platform" });
    await fetch(`${base}/rest/v1/conversations`, { method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ ...tenantData, phone: row.phone, contact_name: row.contact_name || "Contato", last_message: "", ai_reply: text, status: "manual_followup_sent", score: row.score || 0, updated_at: sentAt }) });
    return NextResponse.json({ ok: true, sent: true, text, sentAt });
  }

  const attempts = Math.max(1, Math.min(3, Math.trunc(Number(input.attempts) || 1)));
  const cadenceDays = input.cadence === "three_days" ? 3 : 1;
  const requestedStart = new Date(String(input.firstAt || ""));
  const firstAt = Number.isNaN(requestedStart.getTime()) ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : requestedStart;
  if (firstAt.getTime() < now.getTime() + 60_000) return NextResponse.json({ error: "Escolha um horário futuro para iniciar" }, { status: 400 });
  const scheduledAt = Array.from({ length: attempts }, (_, index) => new Date(firstAt.getTime() + index * cadenceDays * 24 * 60 * 60 * 1000).toISOString());
  const plan = { id: crypto.randomUUID(), objective, status: "active", attempts, cadence_days: cadenceDays, scheduled_at: scheduledAt, sent: [], created_at: now.toISOString() };
  const nextSummary = { ...summary, crm_followup_plan: plan, crm_next_action_at: scheduledAt[0] };
  const saved = await fetch(`${base}/rest/v1/conversations?id=eq.${id}&${scope}`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ summary: nextSummary }) });
  return saved.ok ? NextResponse.json({ ok: true, plan, nextActionAt: scheduledAt[0] }) : NextResponse.json({ error: "Não foi possível agendar a sequência" }, { status: 502 });
}
