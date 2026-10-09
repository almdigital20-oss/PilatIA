import { NextRequest, NextResponse } from "next/server";
import { conversationScope, getTenant } from "../../lib/tenant";

export const dynamic = "force-dynamic";

const config = () => ({
  baseUrl: process.env.SUPABASE_URL?.replace(/\/$/, ""),
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

const headers = (key: string) => ({ "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` });
const comparableName = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isCompanyIdentity = (value: unknown, companyName: string) => {
  const candidate = comparableName(value);
  const company = comparableName(companyName);
  if (!candidate || !company) return false;
  if (candidate === company) return true;
  const genericBusinessWords = new Set(["pilates", "studio", "estudio", "clinica", "academia", "fisioterapia", "saude", "fitness", "centro", "unidade"]);
  const distinctiveTokens = company.split(" ").filter((token) => token.length >= 4 && !genericBusinessWords.has(token));
  return candidate.length >= 4 && (company.startsWith(`${candidate} `) || company.endsWith(` ${candidate}`) || distinctiveTokens.includes(candidate));
};

export async function GET(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { baseUrl, key } = config();
  if (!baseUrl || !key) return NextResponse.json({ error: "Base de dados temporariamente indisponível" }, { status: 503 });
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const response = await fetch(`${baseUrl}/rest/v1/conversations?${conversationScope(tenant.storageMode, tenant.companyId)}&select=id,phone,contact_name,status,score,last_message,ai_reply,summary,updated_at&order=updated_at.desc&limit=${pageSize}&offset=${offset}`, {
      headers: headers(key), cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: "Não foi possível carregar os contatos agora. Os dados permanecem salvos." }, { status: 502 });
    const page = await response.json() as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const latest = new Map<string, Record<string, unknown>>();
  const historyByPhone = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const phone = String(row.phone || "");
    if (phone) historyByPhone.set(phone, [...(historyByPhone.get(phone) || []), row]);
    if (phone && !latest.has(phone)) latest.set(phone, row);
  }
  const leads = [...latest.values()].map((row) => {
    const storedName = String(row.contact_name || "").trim();
    const name = !storedName || isCompanyIdentity(storedName, tenant.companyName) ? "Contato do WhatsApp" : storedName;
    const status = String(row.status || "in_progress");
    const summaryObject = row.summary && typeof row.summary === "object" ? row.summary as Record<string, unknown> : {};
    const phone = String(row.phone || "");
    const phoneHistory = historyByPhone.get(phone) || [];
    const oldest = phoneHistory.filter((item) => String(item.last_message || "").trim() && !String(item.last_message).startsWith("[")).at(-1) || phoneHistory.at(-1);
    const contactAttempts = [
      ...(oldest ? [{ id: `${oldest.id}-started`, at: String(oldest.updated_at), actor: "Contato" as const, type: "Primeiro contato recebido", preview: String(oldest.last_message || "Conversa iniciada pelo WhatsApp").slice(0, 180) }] : []),
      ...phoneHistory.filter((item) => String(item.ai_reply || "").trim()).slice(0, 49).map((item) => {
        const itemStatus = String(item.status || "");
        const human = itemStatus === "human_active" || itemStatus === "campaign_sent" || itemStatus === "manual_followup_sent";
        const type = itemStatus === "manual_followup_sent" ? "Recuperação iniciada pelo atendente"
          : itemStatus.startsWith("followup_planned_") ? "Follow-up automático programado"
            : itemStatus.startsWith("followup_") ? "Recuperação automática da IA"
              : itemStatus === "campaign_sent" ? "Disparo realizado pelo atendente"
                : itemStatus === "human_active" && item.summary?.outbound_initiated_by_company === true ? "Prospecção iniciada pelo atendente"
                  : itemStatus === "human_active" ? "Contato realizado pelo atendente"
                  : itemStatus === "qualified" ? "Conclusão da qualificação pela IA"
                    : "Atendimento realizado pela IA";
        return { id: `${item.id}-attempt`, at: String(item.updated_at), actor: human ? "Atendente" as const : "IA" as const, type, preview: String(item.ai_reply).replace(/\s+/g, " ").trim().slice(0, 180) };
      }),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const contactOnly = status === "contact_imported" || summaryObject.contact_only === true || (summaryObject.imported_from_whatsapp === true && summaryObject.manual_action_required === true);
    const student = status === "student" || summaryObject.contact_type === "student";
    const defaultStage = status === "qualified" ? "qualificado" : status.startsWith("followup_") ? "atendimento" : "novo";
    const readableKeys = ["service_interest", "ad_interest", "experience", "motivation", "pain", "start_timing", "preferred_period", "qualificacao"];
    const summary = Object.entries(summaryObject).filter(([key]) => readableKeys.includes(key)).map(([, value]) => value).filter(Boolean).join(" • ");
    return {
      id: Number(row.id), name,
      initials: name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
      phone, source: String(summaryObject.lead_source || "WhatsApp"),
      unitName: String(summaryObject.whatsapp_unit_name || "Unidade principal"),
      status: student ? "Aluno" : contactOnly ? "Somente contato" : status === "qualified" ? "Qualificado" : status.startsWith("followup_") ? "Follow-up" : "Em atendimento",
      tone: student ? "student" : contactOnly ? "contact" : status === "qualified" ? "hot" : status.startsWith("followup_") ? "waiting" : "active",
      stage: String(summaryObject.crm_stage || defaultStage),
      aiPaused: student || Boolean(summaryObject.ai_paused) || status === "human_active" || status === "qualified",
      handoffPending: status === "qualified" && Boolean(summaryObject.ai_paused) && !summaryObject.human_owner,
      handoffReason: String(summaryObject.handoff_reason || "Qualificação concluída pela IA"),
      nextAction: String(summaryObject.next_action || "Dar sequência ao atendimento"),
      humanOwner: summaryObject.human_owner ? String(summaryObject.human_owner) : null,
      appointmentAt: summaryObject.appointment_at ? String(summaryObject.appointment_at) : null,
      appointmentStatus: summaryObject.appointment_status ? String(summaryObject.appointment_status) : null,
      appointmentNotes: summaryObject.appointment_notes ? String(summaryObject.appointment_notes) : "",
      opportunityValue: Math.max(0, Number(summaryObject.crm_value) || 0),
      soldPlan: summaryObject.crm_plan ? String(summaryObject.crm_plan) : "",
      crmNotes: summaryObject.crm_notes ? String(summaryObject.crm_notes) : "",
      contactAt: summaryObject.crm_contact_at ? String(summaryObject.crm_contact_at) : String(row.updated_at),
      stoppedRespondingAt: summaryObject.crm_stopped_at ? String(summaryObject.crm_stopped_at) : null,
      nextActionAt: summaryObject.crm_next_action_at ? String(summaryObject.crm_next_action_at) : null,
      convertedAt: summaryObject.crm_converted_at ? String(summaryObject.crm_converted_at) : null,
      objection: String(summaryObject.crm_objection || summaryObject.objection || ""),
      followupPlan: summaryObject.crm_followup_plan && typeof summaryObject.crm_followup_plan === "object" ? summaryObject.crm_followup_plan : null,
      automationState: String(summaryObject.automation_state || (summaryObject.ai_paused ? "human_active" : "active")),
      automationSnoozedUntil: summaryObject.automation_snoozed_until ? String(summaryObject.automation_snoozed_until) : null,
      stoppedReason: String(summaryObject.crm_stopped_reason || ""),
      contactAttempts,
      updatedAt: String(row.updated_at),
      qualification: {
        serviceInterest: summaryObject.service_interest || null,
        experience: summaryObject.experience || null,
        motivation: summaryObject.motivation || null,
        pain: summaryObject.pain || null,
        startTiming: summaryObject.start_timing || null,
        preferredPeriod: summaryObject.preferred_period || null,
      },
      imported: Boolean(summaryObject.imported_from_whatsapp),
      contactOnly,
      student,
      manualActionRequired: contactOnly || Boolean(summaryObject.manual_action_required),
      time: new Date(String(row.updated_at)).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
      summary: contactOnly ? "Importado da agenda do WhatsApp · nenhuma automação ativa" : summary || "Qualificação em andamento", score: Number(row.score || 0),
    };
  });
  return NextResponse.json(leads, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { baseUrl, key } = config();
  if (!baseUrl || !key) return NextResponse.json({ error: "Configuração incompleta" }, { status: 503 });
  const input = await request.json();
  const { id, stage } = input;
  const allowed = ["novo", "atendimento", "qualificado", "agendamento", "compareceu", "negociacao", "fechado", "perdido"];
  if (!Number.isFinite(Number(id)) || !allowed.includes(stage)) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const scope = conversationScope(tenant.storageMode, tenant.companyId);
  const current = await fetch(`${baseUrl}/rest/v1/conversations?id=eq.${Number(id)}&${scope}&select=summary,phone&limit=1`, { headers: headers(key), cache: "no-store" });
  const rows = current.ok ? await current.json() : [];
  const summary = rows[0]?.summary && typeof rows[0].summary === "object" ? rows[0].summary : {};
  if (!rows[0]) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  const dateValue = (value: unknown) => {
    const text = String(value || "").trim();
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };
  const opportunityValue = Math.max(0, Math.min(100000000, Number(input.opportunityValue) || 0));
  const nextSummary = {
    ...summary,
    crm_stage: stage,
    crm_stage_manual: true,
    crm_plan: String(input.soldPlan || "").trim().slice(0, 160),
    crm_value: Math.round(opportunityValue * 100) / 100,
    crm_notes: String(input.crmNotes || "").trim().slice(0, 4000),
    lead_source: String(input.source || summary.lead_source || "WhatsApp").trim().slice(0, 120),
    crm_objection: String(input.objection || "").trim().slice(0, 500),
    crm_contact_at: dateValue(input.contactAt),
    crm_stopped_at: dateValue(input.stoppedRespondingAt),
    crm_next_action_at: dateValue(input.nextActionAt),
    crm_converted_at: dateValue(input.convertedAt) || (stage === "fechado" ? new Date().toISOString() : summary.crm_converted_at || null),
  };
  const updated = await fetch(`${baseUrl}/rest/v1/conversations?id=eq.${Number(id)}&${scope}`, {
    method: "PATCH", headers: { ...headers(key), Prefer: "return=minimal" },
    body: JSON.stringify({ summary: nextSummary }),
  });
  let whatsappLabel = "unavailable";
  const leadInstance = String(summary.whatsapp_instance || tenant.instance || "");
  if (updated.ok && leadInstance && process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY) {
    const labelsResponse = await fetch(`${process.env.EVOLUTION_API_URL}/label/findLabels/${encodeURIComponent(leadInstance)}`, { headers: { apikey: process.env.EVOLUTION_API_KEY }, cache: "no-store" }).catch(() => null);
    const labels = labelsResponse?.ok ? await labelsResponse.json() : [];
    const targetName = allowed.includes(stage) ? ({novo:"Novo contato",atendimento:"Em atendimento",qualificado:"Qualificado",agendamento:"Agendado",compareceu:"Compareceu",negociacao:"Negociação",fechado:"Fechado",perdido:"Perdido"} as Record<string,string>)[stage] : "";
    const label = Array.isArray(labels) ? labels.find((item) => String(item.name).toLowerCase() === targetName.toLowerCase()) : null;
    if (label?.id) {
      const sync = await fetch(`${process.env.EVOLUTION_API_URL}/label/handleLabel/${encodeURIComponent(leadInstance)}`, { method:"POST", headers:{"Content-Type":"application/json",apikey:process.env.EVOLUTION_API_KEY}, body:JSON.stringify({number:rows[0].phone,labelId:label.id,action:"add"}) }).catch(()=>null);
      whatsappLabel = sync?.ok ? "synced" : "failed";
    }
  }
  return updated.ok ? NextResponse.json({ ok: true, whatsappLabel }) : NextResponse.json({ error: "Não foi possível mover o lead" }, { status: 502 });
}
