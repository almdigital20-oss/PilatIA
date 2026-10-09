import { NextRequest, NextResponse } from "next/server";
import { conversationScope, getStorageMode, listCompanies, serviceHeaders } from "../../lib/tenant";
import { getBusinessProfile } from "../../lib/business-types";

export const dynamic = "force-dynamic";

export async function runReminders(onlyCompanyId?: string) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) throw new Error("Configuração incompleta");
  const mode = await getStorageMode();
  const select = mode === "tables" ? "id,company_id,phone,contact_name,summary" : "id,phone,contact_name,summary";
  const [conversationResponse, companies] = await Promise.all([
    fetch(`${url}/rest/v1/conversations?select=${select}&order=updated_at.desc&limit=2000`, { headers: serviceHeaders(), cache: "no-store" }),
    listCompanies(),
  ]);
  const rows = conversationResponse.ok ? await conversationResponse.json() : [];
  const companyMap = new Map(companies.map((company) => [String(company.id), company]));
  const latest = new Map<string, any>();
  for (const row of rows) {
    const companyId = String(row.company_id || row.summary?.company_id || "");
    if (!companyId || onlyCompanyId && companyId !== onlyCompanyId) continue;
    const keyValue = `${companyId}:${row.phone}`;
    if (!latest.has(keyValue)) latest.set(keyValue, { ...row, tenant_company_id: companyId });
  }
  let sent = 0;
  for (const row of latest.values()) {
    const company = companyMap.get(String(row.tenant_company_id));
    const summary = row.summary || {};
    const enabledModules = company?.settings?.subscription?.modules;
    const schedulingEnabled = !Array.isArray(enabledModules) || enabledModules.includes("agenda") || enabledModules.includes("crm");
    const instance = String(summary.whatsapp_instance || company?.evolution_instance || "");
    if (!company || !instance || !schedulingEnabled || company.settings?.remindersEnabled === false || !summary.appointment_at || !["scheduled", "confirmed"].includes(summary.appointment_status)) continue;
    const business = getBusinessProfile(company.settings?.businessType);
    const diff = new Date(summary.appointment_at).getTime() - Date.now();
    let field = "", text = "";
    if (diff > 23 * 3600000 && diff <= 25 * 3600000 && !summary.reminder_24h_sent) { field = "reminder_24h_sent"; text = `Olá! Sua ${business.appointmentNoun} de ${business.serviceName} na ${company.name} é amanhã 😊 Responda CONFIRMAR, REAGENDAR ou CANCELAR.`; }
    else if (diff > 2.5 * 3600000 && diff <= 3.5 * 3600000 && !summary.reminder_3h_sent) { field = "reminder_3h_sent"; text = `Sua ${business.appointmentNoun} de ${business.serviceName} na ${company.name} é daqui a 3 horas. Está tudo certo? Responda CONFIRMAR, REAGENDAR ou CANCELAR.`; }
    else if (diff > 1.5 * 3600000 && diff <= 2.5 * 3600000 && !summary.reminder_2h_sent) { field = "reminder_2h_sent"; text = `Faltam cerca de 2 horas para sua ${business.appointmentNoun} de ${business.serviceName} na ${company.name} 😊 Estamos te esperando!`; }
    if (!field) continue;
    const delivery = await fetch(`${process.env.EVOLUTION_API_URL.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(instance)}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY }, body: JSON.stringify({ number: row.phone, text }) }).catch(() => null);
    if (delivery?.ok) {
      const payload = await delivery.json().catch(() => ({}));
      const messageId = String(payload?.key?.id || payload?.messageId || payload?.id || "");
      await fetch(`${url}/rest/v1/conversations?id=eq.${row.id}&${conversationScope(mode, row.tenant_company_id)}`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ summary: { ...summary, [field]: true, outbound_message_id: messageId, reminder_message_id: messageId, outbound_source: "reminder" } }) });
      sent++;
    }
  }
  return { ok: true, sent, checked: latest.size };
}

export async function POST(request: NextRequest) {
  if (!process.env.WEBHOOK_SECRET || request.nextUrl.searchParams.get("secret") !== process.env.WEBHOOK_SECRET) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    return NextResponse.json(await runReminders());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha nos lembretes" }, { status: 502 });
  }
}

export async function GET() { return NextResponse.json({ service: "PilatIA reminders", status: "online", windows: ["24h", "3h", "2h"], tenantAware: true }); }
