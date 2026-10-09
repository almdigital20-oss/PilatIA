import { NextRequest, NextResponse } from "next/server";
import { conversationRecord, conversationScope, getTenant, serviceHeaders, tenantHasModule } from "../../lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "broadcasts")) return NextResponse.json({ error: "Disparos não estão incluídos neste plano" }, { status: 403 });
  const input = await request.json();
  const text = String(input.message || "").trim().slice(0, 2000);
  const segment = String(input.segment || "all");
  const requestedStage = String(input.stage || "all");
  const allowedStages = ["novo", "atendimento", "qualificado", "agendamento", "compareceu", "negociacao", "fechado", "perdido"];
  const stageFilter = allowedStages.includes(requestedStage) ? requestedStage : "all";
  const fromTime = input.dateFrom ? new Date(String(input.dateFrom).length === 10 ? `${input.dateFrom}T00:00:00` : String(input.dateFrom)).getTime() : null;
  const toTime = input.dateTo ? new Date(String(input.dateTo).length === 10 ? `${input.dateTo}T23:59:59` : String(input.dateTo)).getTime() : null;
  const selectedIds = Array.isArray(input.leadIds) ? input.leadIds.map(Number).filter(Number.isFinite) : [];
  const requestedLimit = Math.max(1, Math.min(100, Number(input.limit) || 50));
  const batchSize = Math.max(5, Math.min(50, Number(input.batchSize) || 20));
  if (text.length < 3) return NextResponse.json({ error: "Escreva uma mensagem" }, { status: 400 });
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!url || !process.env.EVOLUTION_API_KEY || !process.env.EVOLUTION_API_URL) return NextResponse.json({ error: "Integração incompleta" }, { status: 503 });
  if (tenant.userId === "demo") {
    const total = Math.min(selectedIds.length || requestedLimit, requestedLimit);
    return NextResponse.json({ ok: true, sent: total, total, batches: Math.ceil(total / batchSize), batchSizes: Array.from({ length: Math.ceil(total / batchSize) }, (_, index) => Math.min(batchSize, total - index * batchSize)), demo: true });
  }
  const scope = conversationScope(tenant.storageMode, tenant.companyId);
  const response = await fetch(`${url}/rest/v1/conversations?${scope}&select=id,phone,contact_name,status,score,summary,updated_at&order=updated_at.desc&limit=1000`, { headers: serviceHeaders(), cache: "no-store" });
  const rows = response.ok ? await response.json() : [];
  const latest = new Map<string, any>();
  for (const row of rows) if (row.phone && !latest.has(row.phone)) latest.set(row.phone, row);
  const now = Date.now();
  const eligible = [...latest.values()].filter((row) => {
    const student = row.status === "student" || row.summary?.contact_type === "student";
    if (student) return false;
    const rowTime = new Date(row.updated_at).getTime();
    if (Number.isFinite(fromTime) && rowTime < Number(fromTime) || Number.isFinite(toTime) && rowTime > Number(toTime)) return false;
    const stage = row.summary?.crm_stage || "novo";
    if (stageFilter !== "all" && stage !== stageFilter) return false;
    if (selectedIds.length) return selectedIds.includes(Number(row.id));
    const contactOnly = row.status === "contact_imported" || row.summary?.contact_only === true || row.summary?.imported_from_whatsapp === true && row.summary?.manual_action_required !== false;
    if (contactOnly) return false;
    if (segment === "scheduled") return stage === "agendamento";
    if (segment === "qualified") return stage === "qualificado" || Number(row.score) >= 75;
    if (segment === "followup") return String(row.status).startsWith("followup_") || (now - new Date(row.updated_at).getTime() > 30 * 60 * 1000 && stage !== "fechado");
    return stage !== "perdido";
  });
  const targets = eligible.slice(0, requestedLimit);
  let sent = 0;
  const batchSizes: number[] = [];
  for (let start = 0; start < targets.length; start += batchSize) {
    const batch = targets.slice(start, start + batchSize);
    batchSizes.push(batch.length);
    for (const row of batch) {
      const delivery = await fetch(`${process.env.EVOLUTION_API_URL.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(tenant.instance)}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY }, body: JSON.stringify({ number: row.phone, text }) }).catch(() => null);
      if (delivery?.ok) {
        const payload = await delivery.json().catch(() => ({}));
        const messageId = String(payload?.key?.id || payload?.messageId || payload?.id || "");
        const tenantData = conversationRecord(tenant.storageMode, tenant.companyId, { ...(row.summary || {}), last_campaign_at: new Date().toISOString(), outbound_message_id: messageId, outbound_source: "campaign" });
        await fetch(`${url}/rest/v1/conversations`, { method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ ...tenantData, phone: row.phone, contact_name: row.contact_name || "Contato", last_message: "", ai_reply: text, status: "campaign_sent", score: row.score || 0, updated_at: new Date().toISOString() }) });
        sent++;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (start + batchSize < targets.length) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return NextResponse.json({ ok: true, sent, total: targets.length, available: eligible.length, batches: batchSizes.length, batchSizes, manualAuthorization: selectedIds.length > 0 });
}
