import { NextRequest, NextResponse } from "next/server";
import { getTenant, serviceHeaders } from "../../lib/tenant";
import { isBusinessType } from "../../lib/business-types";

const demoProfile = {
  city: "São Paulo", address: "Unidade demonstração", businessHours: "Segunda a sexta, das 7h às 20h",
  services: "Pilates individual e em grupo", prices: "Consultar equipe", availablePeriods: "Manhã, tarde e noite",
  cancellationPolicy: "Cancelamentos com antecedência", differentials: "Atendimento próximo e avaliação individual",
  faq: "A primeira aula é uma avaliação. Roupas confortáveis são recomendadas.", toneGuidelines: "Acolhedor, objetivo e profissional",
  serviceHowItWorks: "Aulas orientadas de acordo com o objetivo de cada aluno.", firstExperience: "A primeira experiência inclui uma avaliação individual.",
  paymentMethods: "Pix e cartão", promotionText: "", promotionExpiresAt: "", assistantGreeting: "Olá! Sou a assistente de atendimento da PilatIA.",
  emojiStyle: "light", commercialGoal: "Entender o interesse e preparar o agendamento.", handoffInstructions: "Transferir após entender objetivo, momento e disponibilidade.",
  qualificationQuestions: ["Você possui alguma restrição importante para a prática?"], remindersEnabled: true, onboardingComplete: true,
  aiModel: "gpt-5.4-mini", groupMessages: true, groupingDelaySeconds: 5, historyMessages: 20,
  businessType: "pilates",
};

const allowedModels = new Set(["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"]);

export async function GET(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (tenant.userId === "demo") return NextResponse.json({ companyName: "PilatIA", ...demoProfile, demo: true });
  if (tenant.storageMode === "metadata") return NextResponse.json({ companyName: tenant.companyName, ...(tenant.settings || {}) });
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const response = await fetch(`${base}/rest/v1/companies?id=eq.${tenant.companyId}&select=name,settings&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
  const rows = response.ok ? await response.json() : [];
  if (!rows[0]) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
  return NextResponse.json({ companyName: rows[0].name, ...(rows[0].settings || {}) });
}

export async function PATCH(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (tenant.userId === "demo") return NextResponse.json({ error: "O ambiente demonstrativo não altera dados" }, { status: 403 });
  if (tenant.role !== "admin") return NextResponse.json({ error: "Somente administradores podem alterar" }, { status: 403 });
  const input = await request.json();
  const textFields = ["city", "address", "businessHours", "services", "prices", "availablePeriods", "cancellationPolicy", "differentials", "faq", "toneGuidelines", "serviceHowItWorks", "firstExperience", "paymentMethods", "promotionText", "assistantGreeting", "commercialGoal", "handoffInstructions"];
  const clean: Record<string, unknown> = {};
  for (const field of textFields) clean[field] = String(input[field] || "").trim().slice(0, 2000);
  clean.qualificationQuestions = (Array.isArray(input.qualificationQuestions) ? input.qualificationQuestions : [])
    .map((question: unknown) => String(question || "").trim().slice(0, 240)).filter(Boolean).slice(0, 5);
  clean.adSpendRecords = (Array.isArray(input.adSpendRecords) ? input.adSpendRecords : [])
    .map((record: unknown) => {
      const item = record && typeof record === "object" ? record as Record<string, unknown> : {};
      const start = String(item.start || "");
      const end = String(item.end || "");
      return {
        id: String(item.id || "").slice(0, 80),
        start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : "",
        end: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : "",
        amount: Math.max(0, Math.min(10_000_000, Number(item.amount) || 0)),
        createdAt: String(item.createdAt || new Date().toISOString()).slice(0, 40),
      };
    }).filter((record: { id: string; start: string; end: string; amount: number }) => record.id && record.start && record.end && record.amount > 0)
    .slice(-104);
  clean.remindersEnabled = input.remindersEnabled !== false;
  clean.businessType = isBusinessType(input.businessType) ? input.businessType : "pilates";
  clean.aiModel = allowedModels.has(String(input.aiModel)) ? String(input.aiModel) : "gpt-5.4-mini";
  clean.groupMessages = input.groupMessages !== false;
  clean.groupingDelaySeconds = Math.max(2, Math.min(8, Number(input.groupingDelaySeconds) || 5));
  clean.historyMessages = Math.max(6, Math.min(50, Number(input.historyMessages) || 20));
  clean.emojiStyle = ["none", "light", "expressive"].includes(String(input.emojiStyle)) ? String(input.emojiStyle) : "light";
  const promotionExpiresAt = String(input.promotionExpiresAt || "").trim();
  clean.promotionExpiresAt = /^\d{4}-\d{2}-\d{2}$/.test(promotionExpiresAt) ? promotionExpiresAt : "";
  clean.onboardingComplete = Boolean(clean.businessHours && clean.services && clean.availablePeriods && clean.serviceHowItWorks);
  const companyName = String(input.companyName || tenant.companyName).trim().slice(0, 120);
  if (companyName.length < 2) return NextResponse.json({ error: "Informe o nome da empresa" }, { status: 400 });
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (tenant.storageMode === "metadata") {
    const metadata = { ...(tenant.userMetadata || {}), company_name: companyName, pilatia_company_name: companyName, pilatia_settings: { ...(tenant.settings || {}), ...clean } };
    const response = await fetch(`${base}/auth/v1/admin/users/${tenant.userId}`, {
      method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ user_metadata: metadata }),
    });
    return response.ok ? NextResponse.json({ ok: true, companyName, ...clean }) : NextResponse.json({ error: "Não foi possível salvar" }, { status: 502 });
  }
  const current = await fetch(`${base}/rest/v1/companies?id=eq.${tenant.companyId}&select=settings&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
  if (!current.ok) return NextResponse.json({ error: "Não foi possível consultar as configurações atuais. Nenhuma informação foi alterada." }, { status: 502 });
  const rows = await current.json();
  if (!rows[0]) return NextResponse.json({ error: "Empresa não encontrada. Nenhuma informação foi alterada." }, { status: 404 });
  const nextSettings = { ...(rows[0].settings || {}), ...clean };
  const response = await fetch(`${base}/rest/v1/companies?id=eq.${tenant.companyId}&select=name,settings`, { method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=representation" }, body: JSON.stringify({ name: companyName, settings: nextSettings }) });
  if (!response.ok) return NextResponse.json({ error: "Não foi possível salvar. Suas informações não foram descartadas." }, { status: 502 });
  const savedRows = await response.json();
  const saved = savedRows[0];
  const confirmed = saved?.name === companyName && Object.entries(clean).every(([key, value]) => JSON.stringify(saved.settings?.[key]) === JSON.stringify(value));
  if (!confirmed) return NextResponse.json({ error: "O banco não confirmou todas as informações. Tente novamente." }, { status: 502 });
  return NextResponse.json({ ok: true, companyName: saved.name, ...saved.settings });
}
