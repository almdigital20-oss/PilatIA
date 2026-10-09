import { NextRequest, NextResponse } from "next/server";
import { getTenant, tenantHasModule } from "../../../lib/tenant";
import { runReminders } from "../route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "agenda") && !tenantHasModule(tenant, "crm")) return NextResponse.json({ error: "Agenda não incluída no plano" }, { status: 403 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, checked: 0, sent: 0, demo: true });
  try {
    return NextResponse.json(await runReminders(tenant.companyId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha nos lembretes" }, { status: 502 });
  }
}
