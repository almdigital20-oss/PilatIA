import { NextRequest, NextResponse } from "next/server";
import { conversationScope, getTenant, serviceHeaders } from "../../../lib/tenant";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const input = await request.json();
  const id = Number(input.id);
  const student = input.student === true;
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Contato inválido" }, { status: 400 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, student, demo: true });
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Integração incompleta" }, { status: 503 });
  const scope = conversationScope(tenant.storageMode, tenant.companyId);
  const current = await fetch(`${base}/rest/v1/conversations?id=eq.${id}&${scope}&select=summary,status&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
  const rows = current.ok ? await current.json() : [];
  if (!rows[0]) return NextResponse.json({ error: "Contato não encontrado" }, { status: 404 });
  const summary = rows[0].summary && typeof rows[0].summary === "object" ? rows[0].summary : {};
  const previousPlan = summary.crm_followup_plan && typeof summary.crm_followup_plan === "object" ? summary.crm_followup_plan : null;
  const nextSummary = student ? {
    ...summary,
    contact_type: "student",
    student_marked_at: new Date().toISOString(),
    ai_paused: true,
    crm_next_action_at: null,
    ...(previousPlan?.status === "active" ? { crm_followup_plan: { ...previousPlan, status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "marked_as_student" } } : {}),
  } : {
    ...summary,
    contact_type: "lead",
    student_marked_at: null,
    ai_paused: false,
  };
  const response = await fetch(`${base}/rest/v1/conversations?id=eq.${id}&${scope}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ summary: nextSummary, status: student ? "student" : "in_progress" }),
  });
  return response.ok ? NextResponse.json({ ok: true, student }) : NextResponse.json({ error: "Não foi possível atualizar o contato" }, { status: 502 });
}
