import { NextRequest, NextResponse } from "next/server";
import { getTenant, serviceHeaders, tenantHasModule } from "../../lib/tenant";
import { getBusinessProfile } from "../../lib/business-types";

export const dynamic = "force-dynamic";

const demoSettings = {
  businessType: "pilates", services: "Pilates individual e em pequenos grupos", serviceHowItWorks: "Aulas orientadas de acordo com o objetivo e a condição de cada aluno.",
  firstExperience: "A primeira experiência inclui uma conversa de avaliação.", businessHours: "Segunda a sexta, das 7h às 20h", availablePeriods: "Manhã, tarde e noite",
  prices: "Valores apresentados pela equipe", paymentMethods: "Pix e cartão", toneGuidelines: "Acolhedor, objetivo e profissional", emojiStyle: "light",
};

function activeKnowledge(settings: Record<string, any>) {
  const promotionExpiresAt = String(settings.promotionExpiresAt || "");
  const promotionActive = Boolean(settings.promotionText) && (!promotionExpiresAt || new Date(`${promotionExpiresAt}T23:59:59`).getTime() >= Date.now());
  return {
    services: settings.services || "",
    how_it_works: settings.serviceHowItWorks || "",
    first_experience: settings.firstExperience || "",
    differentials: settings.differentials || "",
    frequently_asked_questions: settings.faq || "",
    prices: settings.prices || "",
    payment_methods: settings.paymentMethods || "",
    active_promotion: promotionActive ? settings.promotionText : "",
    promotion_expiration: promotionActive ? promotionExpiresAt : "",
    business_hours: settings.businessHours || "",
    available_periods: settings.availablePeriods || "",
    address: settings.address || "",
    cancellation_policy: settings.cancellationPolicy || "",
    commercial_goal: settings.commercialGoal || "",
    handoff_instructions: settings.handoffInstructions || "",
  };
}

function authorizedPriceKnowledge(settings: Record<string, any>) {
  const prices = String(settings.prices || "").replace(/\s+/g, " ").trim();
  const payment = String(settings.paymentMethods || "").replace(/\s+/g, " ").trim();
  const promotion = String(settings.promotionText || "").replace(/\s+/g, " ").trim();
  const expiresAt = String(settings.promotionExpiresAt || "");
  const promotionActive = Boolean(promotion) && (!expiresAt || new Date(`${expiresAt}T23:59:59`).getTime() >= Date.now());
  const realPrice = prices && !/^(consultar|sob consulta|consulte|n[aã]o informado|a combinar|falar com a equipe)$/i.test(prices) ? prices : "";
  return { realPrice, payment, promotion: promotionActive ? promotion : "" };
}

function containsUnauthorizedPrice(reply: string, authorized: string) {
  const mentions = reply.match(/R\$\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*(?:reais|por sess[aã]o|por m[eê]s|mensais)/gi) || [];
  if (!mentions.length) return false;
  if (!authorized) return true;
  const allowedDigits = authorized.replace(/\D/g, " ").split(/\s+/).filter(Boolean);
  return mentions.some((mention) => mention.replace(/\D/g, " ").split(/\s+/).filter(Boolean).some((digits) => !allowedDigits.includes(digits)));
}

export async function POST(request: NextRequest) {
 try {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "ai")) return NextResponse.json({ error: "Agente de IA não incluído neste plano" }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI não configurada" }, { status: 503 });
  const input = await request.json();
  const message = String(input.message || "").trim().slice(0, 800);
  if (!message) return NextResponse.json({ error: "Digite uma mensagem" }, { status: 400 });
  let settings = tenant.userId === "demo" ? demoSettings : tenant.settings || {};
  if (tenant.userId !== "demo" && tenant.storageMode === "tables") {
    const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
    const fresh = await fetch(`${base}/rest/v1/companies?id=eq.${tenant.companyId}&select=settings&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
    const rows = fresh.ok ? await fresh.json() : [];
    if (rows[0]?.settings) settings = rows[0].settings;
  }
  const priceKnowledge = authorizedPriceKnowledge(settings);
  const business = getBusinessProfile(settings.businessType);
  const model = ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"].includes(settings.aiModel) ? settings.aiModel : "gpt-5.4-mini";
  const history = Array.isArray(input.history) ? input.history.slice(-10).map((item: any) => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 800) })) : [];
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [
      { role: "system", content: `Você está no simulador de atendimento da empresa "${tenant.companyName}". Responda como a assistente comercial dessa empresa para um contato chamado Cliente de teste.

SEGMENTO: ${business.label}. Serviço principal: ${business.serviceName}.
CATÁLOGO DE SERVIÇOS: ${settings.services || business.serviceName}.
CONHECIMENTO AUTORIZADO: ${JSON.stringify(activeKnowledge(settings))}
TOM: ${settings.toneGuidelines || "acolhedor, objetivo e profissional"}. EMOJIS: ${settings.emojiStyle || "light"}.

REGRAS: responda primeiro à dúvida real do contato e só depois faça uma pergunta curta que conduza o próximo passo. Quando houver mais de um serviço cadastrado e o interesse não estiver claro, pergunte qual opção a pessoa busca, citando somente o catálogo autorizado. Se a pessoa não quiser o serviço principal, continue a triagem com as demais opções e não transfira apenas por isso. Adapte toda a conversa ao serviço escolhido. Use no máximo uma pergunta. Não invente preço, promoção, pagamento, horário, profissional, benefício ou condição. PREÇO AUTORIZADO: ${priceKnowledge.realPrice || "NENHUM PREÇO CADASTRADO — encaminhe para a equipe sem citar números"}. PAGAMENTO AUTORIZADO: ${priceKnowledge.payment || "não informado"}. PROMOÇÃO AUTORIZADA: ${priceKnowledge.promotion || "nenhuma"}. Promoção vazia não existe. Se faltar informação, diga que a equipe confirmará. Para destacar uma expressão, use apenas um asterisco de cada lado, no padrão do WhatsApp: *texto*. Nunca exiba dois asteriscos. Use o primeiro nome com moderação. Não diagnostique. Mantenha a resposta natural e com no máximo 500 caracteres.` },
      ...history,
      { role: "user", content: message },
    ] }),
  });
  if (!response.ok) return NextResponse.json({ error: "Não foi possível gerar o teste agora" }, { status: 502 });
  const data = await response.json();
  let reply = String(data.choices?.[0]?.message?.content || "A equipe poderá te ajudar com essa informação.").replace(/\*\*([^*]+)\*\*/g, "*$1*").replace(/\s+/g, " ").trim().slice(0, 650);
  if (containsUnauthorizedPrice(reply, priceKnowledge.realPrice)) reply = "Para não te passar um valor incorreto, a equipe vai confirmar as opções adequadas para você. Quer que eu encaminhe seu interesse para verificarem os detalhes?";
  return NextResponse.json({ reply });
 } catch (error) {
  console.error("ai-simulator failure", error);
  return NextResponse.json(
    { error: "Não foi possível concluir o teste agora. Tente novamente em alguns instantes." },
    { status: 500 },
  );
 }
}
