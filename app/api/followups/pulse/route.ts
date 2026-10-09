import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "../../../lib/tenant";
import { runFollowups } from "../route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, checked: 0, sent: 0, demo: true });
  try {
    return NextResponse.json(await runFollowups(tenant.companyId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha na automação" }, { status: 502 });
  }
}
