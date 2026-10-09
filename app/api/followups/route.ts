import { NextRequest, NextResponse } from "next/server";
import { conversationRecord, getStorageMode, listCompanies, serviceHeaders, StorageMode } from "../../lib/tenant";
import { followupText, FollowupObjective } from "../../lib/followup-messages";

export const dynamic = "force-dynamic";

type Conversation = { id: number; company_id?: string; phone: string; contact_name: string | null; status: string; score?: number; last_message: string | null; ai_reply: string | null; summary: Record<string, any>; updated_at: string };

async function send(instance: string, phone: string, text: string) {
  const response = await fetch(`${process.env.EVOLUTION_API_URL!.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(instance)}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY! }, body: JSON.stringify({ number: phone, text }) }).catch(() => null);
  if (!response?.ok) return { ok: false, messageId: "" };
  const payload = await response.json().catch(() => ({}));
  return { ok: true, messageId: String(payload?.key?.id || payload?.messageId || payload?.id || "") };
}

function withoutClaim(summary: Record<string, any> = {}) {
  const { followup_claim_key: _key, followup_claim_until: _until, ...clean } = summary;
  return clean;
}

async function claimFollowup(mode: StorageMode, companyId: string, row: Conversation, claimKey: string) {
  const claimedAt = new Date().toISOString();
  const claimUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const scope = mode === "tables" ? `company_id=eq.${encodeURIComponent(companyId)}` : `summary->>company_id=eq.${encodeURIComponent(companyId)}`;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations?id=eq.${row.id}&updated_at=eq.${encodeURIComponent(row.updated_at)}&${scope}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ summary: { ...(row.summary || {}), followup_claim_key: claimKey, followup_claim_until: claimUntil }, updated_at: claimedAt }),
  });
  const rows = response.ok ? await response.json() : [];
  return rows[0] ? { claimedAt, originalUpdatedAt: row.updated_at, originalSummary: row.summary || {} } : null;
}

async function releaseFollowupClaim(row: Conversation, claim: { claimedAt: string; originalUpdatedAt: string; originalSummary: Record<string, any> }) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations?id=eq.${row.id}&updated_at=eq.${encodeURIComponent(claim.claimedAt)}`, {
    method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ summary: claim.originalSummary, updated_at: claim.originalUpdatedAt }),
  }).catch(() => null);
}

async function record(mode: StorageMode, companyId: string, row: Conversation, text: string, attempt: 1 | 2) {
  const tenantData = conversationRecord(mode, companyId, { ...withoutClaim(row.summary || {}), crm_stopped_at: row.summary?.crm_stopped_at || row.updated_at, crm_next_action_at: attempt === 1 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null });
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, { method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ ...tenantData, phone: row.phone, contact_name: row.contact_name || "Contato", last_message: `[FOLLOWUP_${attempt}]`, ai_reply: text, status: `followup_${attempt}`, updated_at: new Date().toISOString() }) });
}

async function recordPlanned(mode: StorageMode, companyId: string, row: Conversation, text: string, plan: Record<string, any>, attempt: number, messageId = "") {
  const tenantData = conversationRecord(mode, companyId, { ...withoutClaim(row.summary || {}), crm_followup_plan: plan, crm_next_action_at: plan.status === "active" ? plan.scheduled_at?.find((date: string) => !plan.sent?.some((item: any) => item.scheduled_at === date)) || null : null, outbound_message_id: messageId, outbound_source: "followup" });
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, { method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ ...tenantData, phone: row.phone, contact_name: row.contact_name || "Contato", last_message: `[CRM_FOLLOWUP_${attempt}]`, ai_reply: text, status: `followup_planned_${attempt}`, score: row.score || 0, updated_at: new Date().toISOString() }) });
}

export async function runFollowups(companyFilter?: string) {
  const needed = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "EVOLUTION_API_URL", "EVOLUTION_API_KEY"];
  if (needed.some((key) => !process.env[key])) throw new Error("Configuração incompleta");
  const mode = await getStorageMode();
  const select = mode === "tables" ? "id,company_id,phone,contact_name,status,score,last_message,ai_reply,summary,updated_at" : "id,phone,contact_name,status,score,last_message,ai_reply,summary,updated_at";
  const [conversationResponse, companies] = await Promise.all([
    fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations?select=${select}&order=updated_at.desc&limit=2000`, { headers: serviceHeaders(), cache: "no-store" }),
    listCompanies(),
  ]);
  if (!conversationResponse.ok) throw new Error("Falha ao consultar conversas");
  const rows = await conversationResponse.json() as Conversation[];
  const companyMap = new Map(companies.map((company) => [String(company.id), company]));
  const latest = new Map<string, { row: Conversation; companyId: string }>();
  for (const row of rows) {
    const companyId = String(row.company_id || row.summary?.company_id || "");
    if (!companyId || (companyFilter && companyId !== companyFilter)) continue;
    const keyValue = `${companyId}:${row.phone}`;
    if (!latest.has(keyValue)) latest.set(keyValue, { row, companyId });
  }
  let sent = 0;
  const now = Date.now();
  for (const { row, companyId } of latest.values()) {
    const company = companyMap.get(companyId);
    const contactOnly = row.status === "contact_imported" || row.summary?.contact_only === true || row.summary?.imported_from_whatsapp === true && row.summary?.manual_action_required !== false;
    const student = row.status === "student" || row.summary?.contact_type === "student";
    const enabledModules = company?.settings?.subscription?.modules;
    const pauseUntil = String(company?.settings?.ai_pause_until || "");
    const globalAiPaused = company?.settings?.ai_pause_indefinite === true || Boolean(pauseUntil && new Date(pauseUntil).getTime() > now);
    const automationSnoozedUntil = String(row.summary?.automation_snoozed_until || "");
    const automationSnoozed = row.summary?.automation_state === "snoozed_by_lead" || Boolean(automationSnoozedUntil && new Date(automationSnoozedUntil).getTime() > now);
    if (!company?.evolution_instance || contactOnly || student || globalAiPaused || automationSnoozed) continue;
    const plan = row.summary?.crm_followup_plan && typeof row.summary.crm_followup_plan === "object" ? row.summary.crm_followup_plan : null;
    if (plan?.status === "active") {
      if (Array.isArray(enabledModules) && !enabledModules.includes("crm") || ["scheduled", "confirmed"].includes(row.summary?.appointment_status)) continue;
      const scheduledAt = Array.isArray(plan.scheduled_at) ? plan.scheduled_at.map(String).slice(0, 3) : [];
      const sentItems = Array.isArray(plan.sent) ? plan.sent : [];
      const dueIndex = scheduledAt.findIndex((date: string) => new Date(date).getTime() <= now && !sentItems.some((item: any) => item.scheduled_at === date));
      if (dueIndex >= 0) {
        const attempt = dueIndex + 1;
        const claim = await claimFollowup(mode, companyId, row, `planned:${plan.id || "plan"}:${scheduledAt[dueIndex]}`);
        if (!claim) continue;
        const objective: FollowupObjective = plan.objective === "reschedule" ? "reschedule" : "recovery";
        const text = followupText(objective, attempt, row.contact_name || "", company.name);
        const instance = String(row.summary?.whatsapp_instance || company.evolution_instance);
        const delivered = await send(instance, row.phone, text);
        if (delivered?.ok) {
          const nextSent = [...sentItems, { attempt, scheduled_at: scheduledAt[dueIndex], sent_at: new Date().toISOString() }];
          const nextPlan = { ...plan, sent: nextSent, status: nextSent.length >= scheduledAt.length ? "completed" : "active", completed_at: nextSent.length >= scheduledAt.length ? new Date().toISOString() : null };
          await recordPlanned(mode, companyId, row, text, nextPlan, attempt, delivered.messageId);
          sent++;
        } else await releaseFollowupClaim(row, claim);
      }
      continue;
    }
    if (Array.isArray(enabledModules) && !enabledModules.includes("ai") || row.summary?.ai_paused || ["scheduled", "confirmed"].includes(row.summary?.appointment_status)) continue;
    const idleMs = now - new Date(row.updated_at).getTime();
    if (!Number.isFinite(idleMs) || idleMs > 12 * 60 * 60 * 1000) continue;
    let attempt: 1 | 2 | null = null;
    let text = "";
    if (row.status === "in_progress" && idleMs >= 15 * 60 * 1000) { attempt = 1; text = `Oi${row.contact_name ? `, ${row.contact_name.split(" ")[0]}` : ""}! Vi que nossa conversa ficou pendente. Quer que eu continue te ajudando por aqui? 😊`; }
    else if (row.status === "followup_1" && idleMs >= 15 * 60 * 1000) { attempt = 2; text = `Olá${row.contact_name ? `, ${row.contact_name.split(" ")[0]}` : ""}! Posso te ajudar a avançar com as informações ou encontrar um período que funcione melhor para você?`; }
    if (!attempt) continue;
    const claim = await claimFollowup(mode, companyId, row, `automatic:${attempt}:${row.id}`);
    if (!claim) continue;
    const instance = String(row.summary?.whatsapp_instance || company.evolution_instance);
    const delivered = await send(instance, row.phone, text);
    if (delivered?.ok) { await record(mode, companyId, { ...row, summary: { ...row.summary, outbound_message_id: delivered.messageId, outbound_source: "followup" } }, text, attempt); sent++; }
    else await releaseFollowupClaim(row, claim);
  }
  return { ok: true, checked: latest.size, sent };
}

export async function POST(request: NextRequest) {
  if (!process.env.WEBHOOK_SECRET || request.nextUrl.searchParams.get("secret") !== process.env.WEBHOOK_SECRET) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    return NextResponse.json(await runFollowups());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na automação" }, { status: 502 });
  }
}

export async function GET() { return NextResponse.json({ service: "PilatIA follow-ups", status: "online", attempts: [{ number: 1, afterMinutes: 15 }, { number: 2, afterMinutes: 30 }], scheduler: "every-minute", tenantAware: true }); }
