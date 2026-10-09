import { NextRequest, NextResponse } from "next/server";
import { getTenant, serviceHeaders } from "../../lib/tenant";

export const dynamic = "force-dynamic";

function pauseState(settings: Record<string, any>) {
  const indefinite = settings.ai_pause_indefinite === true;
  const until = String(settings.ai_pause_until || "");
  const active = indefinite || Boolean(until && new Date(until).getTime() > Date.now());
  return { active, indefinite, until: active && !indefinite ? until : null };
}

export async function GET(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json(pauseState(tenant.settings || {}), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (tenant.userId === "demo") return NextResponse.json({ error: "O ambiente demonstrativo não altera dados" }, { status: 403 });
  if (tenant.role !== "admin") return NextResponse.json({ error: "Somente administradores podem pausar a IA" }, { status: 403 });
  const input = await request.json();
  const action = String(input.action || "");
  const hours = [2, 4, 6].includes(Number(input.hours)) ? Number(input.hours) : 0;
  let until: string | null = null;
  let indefinite = false;
  if (action === "pause_indefinite") indefinite = true;
  else if (action === "pause_hours" && hours) until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  else if (action === "pause_until") {
    const requested = new Date(String(input.until || ""));
    if (Number.isNaN(requested.getTime()) || requested.getTime() <= Date.now()) return NextResponse.json({ error: "Escolha uma data futura" }, { status: 400 });
    until = requested.toISOString();
  } else if (action !== "resume") return NextResponse.json({ error: "Ação inválida" }, { status: 400 });

  const nextSettings = { ...(tenant.settings || {}), ai_pause_indefinite: indefinite, ai_pause_until: until };
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (tenant.storageMode === "metadata") {
    const metadata = { ...(tenant.userMetadata || {}), pilatia_settings: nextSettings };
    const response = await fetch(`${base}/auth/v1/admin/users/${tenant.userId}`, { method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ user_metadata: metadata }) });
    return response.ok ? NextResponse.json(pauseState(nextSettings)) : NextResponse.json({ error: "Não foi possível alterar a pausa" }, { status: 502 });
  }
  const response = await fetch(`${base}/rest/v1/companies?id=eq.${tenant.companyId}`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ settings: nextSettings }) });
  return response.ok ? NextResponse.json(pauseState(nextSettings)) : NextResponse.json({ error: "Não foi possível alterar a pausa" }, { status: 502 });
}
