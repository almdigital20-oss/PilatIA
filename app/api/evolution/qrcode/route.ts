import { NextRequest, NextResponse } from "next/server";
import { configureEvolutionWebhook, ensureEvolutionInstance, getEvolutionQrCode, getEvolutionState } from "../../../lib/evolution";
import { applyRenewedSession, getTenantWithSessionRefresh } from "../../../lib/session";
import { whatsappUnitsForTenant } from "../../../lib/whatsapp-units";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" };

export async function GET(request: NextRequest) {
  // A própria rota renova a sessão. Em navegadores móveis, a aba pode ser
  // suspensa enquanto a pessoa alterna para o WhatsApp e o access token pode
  // vencer antes de o JavaScript conseguir fazer uma segunda requisição.
  const authorization = await getTenantWithSessionRefresh(request);
  const reply = (body: Record<string, unknown>, status = 200) => applyRenewedSession(
    NextResponse.json(body, { status, headers: noStore }),
    authorization?.session,
  );
  if (!authorization) return reply({ error: "Nao autenticado" }, 401);
  const { tenant } = authorization;
  const unitIndex = Math.max(0, Math.trunc(Number(request.nextUrl.searchParams.get("unit")) || 0));
  const units = whatsappUnitsForTenant(tenant);
  const unit = units[unitIndex];
  if (!unit) return reply({ error: "Esta unidade ainda nao foi autorizada pelo administrador" }, 403);
  const instance = unit.instance;
  if (!instance) return reply({ error: "Instancia do WhatsApp nao configurada" }, 503);

  if (request.nextUrl.searchParams.get("status") === "1") {
    let state = (await getEvolutionState(instance)).toLowerCase();
    // O cadastro nao deve depender de uma criacao anterior ter terminado.
    // Se a instancia ainda nao existir, esta propria rota a prepara para que
    // o usuario precise apenas abrir o modal e ler o QR Code.
    if (!state || state === "close") {
      const ready = await ensureEvolutionInstance(instance);
      if (!ready.ok) {
        return reply({ connected: false, state: "unavailable", error: ready.error, retryable: true }, 503);
      }
      state = String(ready.state || "connecting").toLowerCase();
    }
    const connected = state === "open" || state === "connected";
    if (connected) await configureEvolutionWebhook(instance);
    return reply({ connected, state, unit: unit.id, unitName: unit.name });
  }

  // Garanta primeiro que a instancia individual da empresa exista. Consultar
  // /connect antes disso fazia novos cadastros entrarem em um ciclo sem QR.
  const ready = await ensureEvolutionInstance(instance);
  if (!ready.ok) {
    return reply({ error: ready.error, retryable: true }, 503);
  }
  const state = String(ready.state || await getEvolutionState(instance)).toLowerCase();
  if (state === "open" || state === "connected") {
    await configureEvolutionWebhook(instance);
    return reply({ connected: true });
  }

  if (ready.qrcode) {
    return reply({
      connected: false,
      qrcode: ready.qrcode,
      refreshAfter: 45,
      generatedAt: new Date().toISOString(),
    });
  }

  const qr = await getEvolutionQrCode(instance);
  if (!qr.ok) {
    return reply({ error: qr.error, retryable: true }, qr.status);
  }
  return reply({
    connected: false,
    qrcode: qr.qrcode,
    refreshAfter: 45,
    generatedAt: new Date().toISOString(),
  });
}
