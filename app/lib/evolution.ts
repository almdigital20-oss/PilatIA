const apiConfig = () => ({
  baseUrl: process.env.EVOLUTION_API_URL?.replace(/\/$/, ""),
  apiKey: process.env.EVOLUTION_API_KEY,
});

const webhookEvents = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];
const DEFAULT_TIMEOUT_MS = 15_000;
const WEBHOOK_TIMEOUT_MS = 8_000;
const webhookConfiguredUntil = new Map<string, number>();
const recentQrCodes = new Map<string, { qrcode: string; expiresAt: number }>();

function webhookUrl() {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return "";
  const publicUrl = (process.env.PUBLIC_APP_URL || "https://pilatia.conneczap.com.br").replace(/\/$/, "");
  return `${publicUrl}/api/evolution/webhook?secret=${encodeURIComponent(secret)}`;
}

async function evolutionFetch(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { baseUrl, apiKey } = apiConfig();
  if (!baseUrl || !apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function qrFromPayload(data: any) {
  const candidate = data?.base64 || data?.qrcode?.base64 || data?.qrCode || (typeof data?.qrcode === "string" ? data.qrcode : "");
  if (!candidate || typeof candidate !== "string") return "";
  return candidate.startsWith("data:image") ? candidate : `data:image/png;base64,${candidate}`;
}

async function responseMessage(response: Response | null, fallback: string) {
  if (!response) return fallback;
  const data = await response.clone().json().catch(() => ({}));
  const message = data?.response?.message || data?.message || data?.error;
  if (Array.isArray(message)) return String(message[0] || fallback);
  return String(message || fallback);
}

function isMissingInstance(response: Response, message: string) {
  return response.status === 404 || /not found|nao encontr|n[aã]o existe|does not exist/i.test(message);
}

export async function ensureEvolutionInstance(instance: string) {
  if (!instance) return { ok: false, error: "Instancia do WhatsApp ausente" } as const;
  const { baseUrl, apiKey } = apiConfig();
  if (!baseUrl || !apiKey) return { ok: false, error: "Evolution API nao configurada" } as const;

  const encoded = encodeURIComponent(instance);
  const stateResponse = await evolutionFetch(`/instance/connectionState/${encoded}`);
  if (!stateResponse) return { ok: false, error: "Evolution API temporariamente indisponivel" } as const;

  const stateData = await stateResponse.clone().json().catch(() => ({}));
  const state = String(stateData?.instance?.state || stateData?.state || "close").toLowerCase();
  if (stateResponse.ok) return { ok: true, created: false, state } as const;

  const stateError = await responseMessage(stateResponse, "Instancia nao encontrada");
  if (!isMissingInstance(stateResponse, stateError)) {
    return { ok: false, error: "A Evolution API recusou a instancia" } as const;
  }

  const created = await evolutionFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: instance,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      groupsIgnore: true,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    }),
  });
  if (!created) return { ok: false, error: "Evolution API temporariamente indisponivel" } as const;
  if (!created.ok && created.status !== 409) {
    return { ok: false, error: await responseMessage(created, "Nao foi possivel preparar a conexao do WhatsApp") } as const;
  }

  const createdData = await created.clone().json().catch(() => ({}));
  return {
    ok: true,
    created: created.ok,
    state: String(createdData?.instance?.status || createdData?.instance?.state || "connecting").toLowerCase(),
    qrcode: qrFromPayload(createdData),
  } as const;
}

export async function configureEvolutionWebhook(instance: string) {
  if (!instance) return { ok: false, error: "Instancia do WhatsApp ausente" } as const;
  if ((webhookConfiguredUntil.get(instance) || 0) > Date.now()) return { ok: true, cached: true } as const;
  const url = webhookUrl();
  if (!url) return { ok: false, error: "Webhook do WhatsApp nao configurado" } as const;
  const webhook = await evolutionFetch(`/webhook/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: false,
        events: webhookEvents,
      },
    }),
  }, WEBHOOK_TIMEOUT_MS);
  if (!webhook?.ok) return { ok: false, error: "Nao foi possivel ativar o atendimento automatico" } as const;
  webhookConfiguredUntil.set(instance, Date.now() + 60 * 60_000);
  return { ok: true, cached: false } as const;
}

export async function getEvolutionState(instance: string) {
  const response = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(instance)}`);
  if (!response?.ok) return "close";
  const data = await response.json().catch(() => ({}));
  return String(data?.instance?.state || data?.state || "close");
}

export async function disconnectEvolutionInstance(instance: string) {
  if (!instance) return { ok: false, error: "Instancia do WhatsApp ausente" } as const;
  const encoded = encodeURIComponent(instance);
  let response = await evolutionFetch(`/instance/logout/${encoded}`, { method: "DELETE" });
  if (response?.ok) return { ok: true } as const;

  // Algumas versoes encerram a sessao antes de concluir a resposta HTTP e
  // devolvem "Connection Closed". O estado demora alguns instantes para mudar.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 350 : 650));
    const stateResponse = await evolutionFetch(`/instance/connectionState/${encoded}`);
    if (stateResponse?.ok) {
      const data = await stateResponse.json().catch(() => ({}));
      const state = String(data?.instance?.state || data?.state || "unknown").toLowerCase();
      if (state !== "open" && state !== "connected") return { ok: true, recovered: true } as const;
    }
    // Logout e idempotente. Uma segunda chamada resolve proxies que encerram a
    // primeira requisicao antes de a Evolution terminar o processamento.
    if (attempt === 1) {
      const retry = await evolutionFetch(`/instance/logout/${encoded}`, { method: "DELETE" });
      if (retry?.ok) return { ok: true, retried: true } as const;
      if (retry) response = retry;
    }
  }

  return {
    ok: false,
    error: await responseMessage(response, "Nao foi possivel desconectar o WhatsApp agora"),
  } as const;
}

export async function getEvolutionQrCode(instance: string) {
  const encoded = encodeURIComponent(instance);
  let lastStatus = 503;
  let lastError = "Evolution API indisponivel";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await evolutionFetch(`/instance/connect/${encoded}`);
    if (!response) {
      lastStatus = 503;
      lastError = "Evolution API indisponivel";
    } else {
      const data = await response.json().catch(() => ({}));
      const qrcode = qrFromPayload(data);
      if (response.ok && qrcode) {
        recentQrCodes.set(instance, { qrcode, expiresAt: Date.now() + 35_000 });
        return { ok: true, qrcode } as const;
      }
      lastStatus = response.ok ? 502 : response.status;
      lastError = response.ok
        ? "A Evolution nao retornou um QR Code"
        : String(data?.response?.message?.[0] || data?.message || "Falha ao gerar QR Code");
      // A instancia ausente ou ja conectada nao melhora repetindo o mesmo endpoint.
      // O chamador consulta/cria a instancia e decide o proximo passo.
      if ([400, 404, 409].includes(response.status)) break;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700));
  }
  const cached = recentQrCodes.get(instance);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, qrcode: cached.qrcode, cached: true } as const;
  recentQrCodes.delete(instance);
  return { ok: false, error: lastError, status: lastStatus } as const;
}
