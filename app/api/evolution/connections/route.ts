import { NextRequest, NextResponse } from "next/server";
import { disconnectEvolutionInstance, getEvolutionState } from "../../../lib/evolution";
import { getTenant, serviceHeaders } from "../../../lib/tenant";
import { sanitizeWhatsAppUnitProfile, whatsappConnectionLimit, whatsappUnitsForTenant } from "../../../lib/whatsapp-units";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };

async function saveSettings(tenant: NonNullable<Awaited<ReturnType<typeof getTenant>>>, settings: Record<string, unknown>) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return false;
  if (tenant.storageMode === "metadata") {
    const metadata = { ...(tenant.userMetadata || {}), pilatia_settings: settings };
    const response = await fetch(`${base}/auth/v1/admin/users/${tenant.userId}`, {
      method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ user_metadata: metadata }),
    });
    return response.ok;
  }
  const response = await fetch(`${base}/rest/v1/companies?id=eq.${tenant.companyId}`, {
    method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ settings }),
  });
  return response.ok;
}

export async function GET(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (tenant.userId === "demo") return NextResponse.json({ limit: 1, units: [{ id: "unit-1", name: "Unidade principal", connected: true, state: "open" }] }, { headers: noStore });
  const units = whatsappUnitsForTenant(tenant);
  const states = await Promise.all(units.map(async (unit) => {
    const state = String(await getEvolutionState(unit.instance).catch(() => "unknown")).toLowerCase();
    return { ...unit, connected: state === "open" || state === "connected", state };
  }));
  return NextResponse.json({ limit: whatsappConnectionLimit(tenant.settings), units: states }, { headers: noStore });
}

export async function PATCH(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (tenant.userId === "demo") return NextResponse.json({ error: "O ambiente demonstrativo não altera dados" }, { status: 403 });
  if (tenant.role !== "admin") return NextResponse.json({ error: "Somente o administrador da empresa pode editar unidades" }, { status: 403 });
  const input = await request.json();
  const index = Math.trunc(Number(input.index));
  const units = whatsappUnitsForTenant(tenant);
  if (index < 0 || index >= units.length) return NextResponse.json({ error: "Unidade não autorizada" }, { status: 403 });
  const name = String(input.name || "").trim().slice(0, 80);
  if (name.length < 2) return NextResponse.json({ error: "Informe o nome da unidade" }, { status: 400 });
  units[index] = { ...units[index], name, profile: input.profile === undefined ? units[index].profile : sanitizeWhatsAppUnitProfile(input.profile) };
  const settings = { ...(tenant.settings || {}), whatsapp_units: units.map(({ id, ...unit }) => unit) };
  const saved = await saveSettings(tenant, settings);
  return saved ? NextResponse.json({ ok: true, units }) : NextResponse.json({ error: "Não foi possível salvar a unidade" }, { status: 502 });
}

export async function DELETE(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (tenant.userId === "demo") return NextResponse.json({ error: "O ambiente demonstrativo não altera dados" }, { status: 403 });
  if (tenant.role !== "admin") return NextResponse.json({ error: "Somente o administrador da empresa pode desconectar unidades" }, { status: 403 });
  const input = await request.json().catch(() => ({}));
  const index = Math.trunc(Number(input.index));
  const units = whatsappUnitsForTenant(tenant);
  if (index < 0 || index >= units.length) return NextResponse.json({ error: "Unidade não autorizada" }, { status: 403 });
  const disconnected = await disconnectEvolutionInstance(units[index].instance);
  if (!disconnected.ok) return NextResponse.json({ error: disconnected.error }, { status: 502, headers: noStore });
  return NextResponse.json({ ok: true, index, connected: false }, { headers: noStore });
}
