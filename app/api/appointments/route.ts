import { NextRequest, NextResponse } from "next/server";
import { conversationRecord, conversationScope, getTenant, tenantHasModule } from "../../lib/tenant";
import { getBusinessProfile } from "../../lib/business-types";

export const dynamic = "force-dynamic";
const cfg = () => ({ url: process.env.SUPABASE_URL?.replace(/\/$/, ""), key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const auth = (key: string) => ({ "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` });

async function send(instance: string, phone: string, text: string) {
  if (!instance || !process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return { ok: false, messageId: "" };
  const response = await fetch(`${process.env.EVOLUTION_API_URL.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(instance)}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY }, body: JSON.stringify({ number: phone, text }) }).catch(() => null);
  if (!response?.ok) return { ok: false, messageId: "" };
  const payload = await response.json().catch(() => ({}));
  const messageId = String(payload?.key?.id || payload?.messageId || payload?.id || "");
  return { ok: Boolean(messageId), messageId };
}

const canSchedule = (tenant: NonNullable<Awaited<ReturnType<typeof getTenant>>>) => tenantHasModule(tenant, "agenda") || tenantHasModule(tenant, "crm");

export async function POST(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!canSchedule(tenant)) return NextResponse.json({ error: "Agenda não está incluída neste plano" }, { status: 403 });
  const { url, key } = cfg();
  if (!url || !key) return NextResponse.json({ error: "Configuração incompleta" }, { status: 503 });
  const { id, appointmentAt, contactName, phone, notes } = await request.json();
  const business = getBusinessProfile(tenant.settings?.businessType);
  const hasExistingLead = Number.isFinite(Number(id)) && Number(id) > 0;
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  const cleanName = String(contactName || "").trim().slice(0, 120);
  const cleanNotes = String(notes || "").trim().slice(0, 600);
  if (!appointmentAt || Number.isNaN(new Date(appointmentAt).getTime())) return NextResponse.json({ error: "Escolha uma data e horário válidos" }, { status: 400 });
  if (!hasExistingLead && (cleanName.length < 2 || cleanPhone.length < 10 || cleanPhone.length > 15)) return NextResponse.json({ error: "Informe nome e WhatsApp válidos" }, { status: 400 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, id: hasExistingLead ? Number(id) : Date.now(), appointmentAt, demo: true });
  const scope = conversationScope(tenant.storageMode, tenant.companyId);
  const formatted = new Date(appointmentAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  const confirmation = `Sua ${business.appointmentNoun} de ${business.serviceName} foi agendada com sucesso para ${formatted} ✅\n\nVocê receberá lembretes antes do horário. Se precisar alterar, responda REAGENDAR ou CANCELAR.`;
  let targetPhone = cleanPhone;
  let targetName = cleanName;
  let recordId = Number(id);
  let targetInstance = tenant.instance;
  let currentSummary: Record<string, any> = {};

  if (hasExistingLead) {
    const current = await fetch(`${url}/rest/v1/conversations?id=eq.${Number(id)}&${scope}&select=summary,phone,contact_name&limit=1`, { headers: auth(key), cache: "no-store" });
    const rows = current.ok ? await current.json() : [];
    if (!rows[0]) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    currentSummary = rows[0].summary && typeof rows[0].summary === "object" ? rows[0].summary : {};
    targetPhone = String(rows[0].phone || "");
    targetName = String(rows[0].contact_name || "Contato");
    targetInstance = String(currentSummary.whatsapp_instance || tenant.instance || "");
  }

  const delivery = await send(targetInstance, targetPhone, confirmation);
  if (!delivery.ok) return NextResponse.json({ error: "O agendamento não foi salvo porque o WhatsApp não confirmou a entrega. Verifique a conexão e tente novamente." }, { status: 502 });

  if (hasExistingLead) {
    const updatedSummary = { ...currentSummary, contact_only: false, manual_action_required: false, manually_activated_at: new Date().toISOString(), ai_paused: true, crm_stage: "agendamento", appointment_at: appointmentAt, appointment_status: "scheduled", appointment_notes: cleanNotes, appointment_confirmation_message_id: delivery.messageId, appointment_confirmation_sent_at: new Date().toISOString(), outbound_message_id: delivery.messageId, outbound_source: "appointment", reminder_24h_sent: false, reminder_3h_sent: false, reminder_2h_sent: false };
    const updated = await fetch(`${url}/rest/v1/conversations?id=eq.${Number(id)}&${scope}`, { method: "PATCH", headers: { ...auth(key), Prefer: "return=minimal" }, body: JSON.stringify({ summary: updatedSummary, status: "qualified", score: 70 }) });
    if (!updated.ok) return NextResponse.json({ error: "A confirmação foi entregue, mas não foi possível salvar o agendamento. Tente novamente." }, { status: 502 });
  } else {
    const summary = { crm_stage: "agendamento", appointment_at: appointmentAt, appointment_status: "scheduled", appointment_notes: cleanNotes, lead_source: "Manual", ai_paused: true, whatsapp_instance: targetInstance, appointment_confirmation_message_id: delivery.messageId, appointment_confirmation_sent_at: new Date().toISOString(), outbound_message_id: delivery.messageId, outbound_source: "appointment", reminder_24h_sent: false, reminder_3h_sent: false, reminder_2h_sent: false };
    const tenantData = conversationRecord(tenant.storageMode, tenant.companyId, summary);
    const created = await fetch(`${url}/rest/v1/conversations`, { method: "POST", headers: { ...auth(key), Prefer: "return=representation" }, body: JSON.stringify({ ...tenantData, phone: cleanPhone, contact_name: cleanName, last_message: "", ai_reply: confirmation, status: "qualified", score: 70, updated_at: new Date().toISOString() }) });
    const createdRows = created.ok ? await created.json() : [];
    if (!created.ok || !createdRows[0]) return NextResponse.json({ error: "Falha ao criar contato e agendamento" }, { status: 502 });
    recordId = Number(createdRows[0].id);
  }

  return NextResponse.json({ ok: true, delivered: true, messageId: delivery.messageId, id: recordId, appointmentAt, contactName: targetName, phone: targetPhone });
}

export async function PATCH(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!canSchedule(tenant)) return NextResponse.json({ error: "Agenda não está incluída neste plano" }, { status: 403 });
  const { url, key } = cfg();
  if (!url || !key) return NextResponse.json({ error: "Configuração incompleta" }, { status: 503 });
  const { id, action } = await request.json();
  const business = getBusinessProfile(tenant.settings?.businessType);
  const allowed = ["confirm", "cancel", "attended", "no_show", "remind"];
  if (!Number.isFinite(Number(id)) || !allowed.includes(action)) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, demo: true });
  const scope = conversationScope(tenant.storageMode, tenant.companyId);
  const current = await fetch(`${url}/rest/v1/conversations?id=eq.${Number(id)}&${scope}&select=summary,phone,contact_name&limit=1`, { headers: auth(key), cache: "no-store" });
  const rows = current.ok ? await current.json() : [];
  if (!rows[0]) return NextResponse.json({ error: "Agendamento não encontrado" }, { status: 404 });
  const summary = rows[0].summary && typeof rows[0].summary === "object" ? rows[0].summary : {};
  if (action === "remind") {
    const formatted = summary.appointment_at ? new Date(summary.appointment_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "o horário combinado";
    const delivery = await send(String(summary.whatsapp_instance || tenant.instance || ""), rows[0].phone, `Olá! Passando para confirmar sua ${business.appointmentNoun} de ${business.serviceName} em ${formatted} 😊 Responda CONFIRMAR, REAGENDAR ou CANCELAR.`);
    if (!delivery.ok) return NextResponse.json({ error: "Não foi possível enviar o lembrete" }, { status: 502 });
    await fetch(`${url}/rest/v1/conversations?id=eq.${Number(id)}&${scope}`, { method: "PATCH", headers: { ...auth(key), Prefer: "return=minimal" }, body: JSON.stringify({ summary: { ...summary, outbound_message_id: delivery.messageId, reminder_message_id: delivery.messageId, outbound_source: "reminder", last_manual_reminder_at: new Date().toISOString() } }) });
    return NextResponse.json({ ok: true, delivered: true, messageId: delivery.messageId });
  }
  const changes: Record<string, string> = action === "confirm" ? { appointment_status: "confirmed" }
    : action === "cancel" ? { appointment_status: "cancelled", crm_stage: "atendimento" }
    : action === "attended" ? { appointment_status: "attended", crm_stage: "compareceu" }
    : { appointment_status: "no_show", crm_stage: "atendimento" };
  const result = await fetch(`${url}/rest/v1/conversations?id=eq.${Number(id)}&${scope}`, { method: "PATCH", headers: { ...auth(key), Prefer: "return=minimal" }, body: JSON.stringify({ summary: { ...summary, ...changes } }) });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Falha ao atualizar" }, { status: 502 });
}
