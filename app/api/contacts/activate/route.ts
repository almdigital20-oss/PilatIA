import { NextRequest, NextResponse } from "next/server";
import { conversationRecord, conversationScope, getTenant, serviceHeaders, tenantHasModule } from "../../../lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "contacts") || !tenantHasModule(tenant, "chat")) return NextResponse.json({ error: "Conversa não incluída neste plano" }, { status: 403 });
  const { id } = await request.json();
  if (!Number.isFinite(Number(id))) return NextResponse.json({ error: "Contato inválido" }, { status: 400 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, demo: true });

  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Configuração incompleta" }, { status: 503 });
  const scope = conversationScope(tenant.storageMode, tenant.companyId);
  const current = await fetch(`${url}/rest/v1/conversations?id=eq.${Number(id)}&${scope}&select=phone,contact_name,score,summary&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
  const rows = current.ok ? await current.json() : [];
  if (!rows[0]) return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 });

  const summary = rows[0].summary && typeof rows[0].summary === "object" ? rows[0].summary : {};
  const tenantData = conversationRecord(tenant.storageMode, tenant.companyId, {
    ...summary,
    contact_only: false,
    manual_action_required: false,
    manually_activated_at: new Date().toISOString(),
    crm_stage: "atendimento",
    crm_stage_manual: true,
    ai_paused: true,
  });
  const created = await fetch(`${url}/rest/v1/conversations`, {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      ...tenantData,
      phone: rows[0].phone,
      contact_name: rows[0].contact_name || "Contato",
      last_message: "",
      ai_reply: "",
      status: "human_active",
      score: Number(rows[0].score || 0),
      updated_at: new Date().toISOString(),
    }),
  });
  const createdRows = created.ok ? await created.json() : [];
  return created.ok
    ? NextResponse.json({ ok: true, id: createdRows[0]?.id, phone: rows[0].phone })
    : NextResponse.json({ error: "Não foi possível abrir a conversa" }, { status: 502 });
}
