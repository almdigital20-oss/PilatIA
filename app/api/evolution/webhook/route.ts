import { NextRequest, NextResponse } from "next/server";
import { conversationRecord, findCompanyByInstance, getStorageMode } from "../../../lib/tenant";
import { settingsForWhatsAppUnit, whatsappUnitsForCompany } from "../../../lib/whatsapp-units";
import { getBusinessProfile } from "../../../lib/business-types";
import type { BusinessProfile } from "../../../lib/business-types";
import { STAGING_MODE } from "../../../lib/staging";

const required = ["OPENAI_API_KEY", "EVOLUTION_API_URL", "EVOLUTION_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

type Turn = { id?: number; contact_name?: string; last_message: string; ai_reply: string; status: string; updated_at: string; score?: number; summary?: Record<string, unknown> };
type HandoffMode = "schedule" | "consultative" | null;
type AiModel = "gpt-5.4-nano" | "gpt-5.4-mini" | "gpt-5.4";
type TokenUsage = { model: AiModel; input_tokens: number; output_tokens: number; total_tokens: number; estimated_cost_usd: number };
type LeadOrigin = { isAdLead: boolean; source: string; method: "referral" | "message" | "direct"; adTitle: string | null };

const modelRates: Record<AiModel, { input: number; output: number }> = {
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4": { input: 2.5, output: 15 },
};

function getAiSettings(settings: Record<string, unknown> | undefined) {
  const requested = String(settings?.aiModel || "gpt-5.4-mini") as AiModel;
  return {
    model: requested in modelRates ? requested : "gpt-5.4-mini" as AiModel,
    groupMessages: settings?.groupMessages !== false,
    groupingDelaySeconds: Math.max(2, Math.min(8, Number(settings?.groupingDelaySeconds) || 5)),
    historyMessages: Math.max(6, Math.min(50, Number(settings?.historyMessages) || 20)),
  };
}

function detectLeadOrigin(event: Record<string, any>, message: string): LeadOrigin {
  const payload = event.data || {};
  const messageData = payload.message || {};
  const contexts = [
    payload.contextInfo,
    payload.messageContextInfo,
    messageData.contextInfo,
    messageData.extendedTextMessage?.contextInfo,
    messageData.imageMessage?.contextInfo,
    messageData.videoMessage?.contextInfo,
    messageData.buttonsResponseMessage?.contextInfo,
    messageData.listResponseMessage?.contextInfo,
  ].filter(Boolean);
  const externalAd = contexts.map((context) => context.externalAdReply).find(Boolean);
  const referral = payload.referral || messageData.referral || externalAd;
  const originText = [payload.source, payload.sourceType, payload.medium, referral?.sourceUrl, referral?.sourceId, referral?.mediaType]
    .filter(Boolean).join(" ").toLowerCase();
  const messageMentionsAd = /\b(vim|venho|cheguei|vi|encontrei|cliquei|chamei)\b.{0,45}\b(an[uú]ncio|instagram|facebook|face|meta|google)\b/i.test(message)
    || /\b(an[uú]ncio|instagram|facebook|meta|google)\b.{0,45}\b(vim|vi|cliquei|chamei|interessei)\b/i.test(message)
    || /\[(PILATIA_)?(GOOGLE|INSTAGRAM|FACEBOOK|META)\]/i.test(message);
  const combined = `${originText} ${message.toLowerCase()}`;
  const source = /instagram|ig\.me|\[(pilatia_)?instagram\]/i.test(combined) ? "Instagram Ads"
    : /facebook|fb\.me|\[(pilatia_)?facebook\]/i.test(combined) ? "Facebook Ads"
      : /google|gclid|gad_source|utm_source=google|\[(pilatia_)?google\]/i.test(combined) ? "Google"
        : Boolean(referral) || /meta|advert|anuncio|anúncio|ctwa/.test(originText) || messageMentionsAd ? "Meta Ads"
          : "WhatsApp";
  const isAdLead = source !== "WhatsApp";
  const adTitle = String(referral?.title || referral?.body || referral?.headline || "").trim().slice(0, 180) || null;
  return { isAdLead, source, method: referral ? "referral" : messageMentionsAd || source !== "WhatsApp" ? "message" : "direct", adTitle };
}

function readUsage(json: Record<string, unknown>, model: AiModel): TokenUsage {
  const usage = (json.usage || {}) as Record<string, unknown>;
  const input = Number(usage.prompt_tokens) || 0;
  const output = Number(usage.completion_tokens) || 0;
  const rates = modelRates[model];
  return { model, input_tokens: input, output_tokens: output, total_tokens: Number(usage.total_tokens) || input + output, estimated_cost_usd: Number(((input * rates.input + output * rates.output) / 1_000_000).toFixed(8)) };
}

function mergeUsage(model: AiModel, ...items: TokenUsage[]): TokenUsage {
  const input = items.reduce((sum, item) => sum + item.input_tokens, 0);
  const output = items.reduce((sum, item) => sum + item.output_tokens, 0);
  const cost = items.reduce((sum, item) => sum + item.estimated_cost_usd, 0);
  return { model, input_tokens: input, output_tokens: output, total_tokens: input + output, estimated_cost_usd: Number(cost.toFixed(8)) };
}

const systemPrompt = `Você é a atendente virtual de um estúdio de Pilates no WhatsApp.

REGRAS DE CONVERSA:
- Fale em português brasileiro, de forma humana, simpática e objetiva.
- Leia todo o histórico antes de responder.
- Nunca repita uma pergunta que o contato já respondeu, nem peça novamente nome, experiência, objetivo, indicação médica ou disponibilidade já informados.
- Não repita ou recapitule todas as respostas do contato a cada mensagem. Confirme brevemente e avance.
- Faça no máximo uma pergunta por mensagem.
- Se a resposta estiver ambígua, esclareça apenas aquele ponto.
- Não use listas, formulários, linguagem robótica ou textos longos.
- Não invente preços, horários, profissionais ou informações do estúdio.
- Não diagnostique, prescreva ou prometa resultado médico.
- Se houver urgência, dor intensa ou relato de risco, recomende avaliação médica.

QUALIFICAÇÃO BÁSICA — LIMITE OBRIGATÓRIO DE 3 PERGUNTAS:
- Faça no máximo 3 perguntas de qualificação durante toda a conversa com cada cliente.
- Conte no histórico quantas perguntas você já fez. Nunca ultrapasse três.
- Escolha somente as perguntas mais úteis entre estas, pulando tudo que o cliente já respondeu espontaneamente:
  1. Você já fez Pilates antes?
  2. Está buscando por indicação médica ou por vontade própria?
  3. Você sente alguma dor hoje?
  4. Seu objetivo é dor, postura, fortalecimento ou qualidade de vida?
  5. Você quer começar agora ou está pesquisando para mais pra frente?
  6. Você prefere manhã, tarde ou noite?
- Adapte o texto ao contexto para soar natural, mas não una várias perguntas em uma mensagem.
- Priorize: experiência; motivo/objetivo ou dor; momento para começar ou período preferido.
- Se o cliente já fornecer várias informações de uma vez, não pergunte de novo e avance para o próximo ponto útil.
- Toda mensagem intermediária deve terminar com uma pergunta clara que conduza o atendimento.
- Se perguntarem sobre planos ou preços e não houver valores confirmados no histórico, diga brevemente que a equipe passará as opções adequadas e continue com a próxima pergunta de qualificação.
- Nunca responda apenas sobre planos e fique esperando sem conduzir o próximo passo.

FINALIZAÇÃO:
Ao obter respostas suficientes ou ao atingir 3 perguntas feitas, não faça mais perguntas. Envie uma mensagem curta avisando que alguém da equipe continuará o atendimento e acrescente [TRANSFERIR] no final. Não use [TRANSFERIR] antes disso.`;

const qualificationPrompt = `Você é uma consultora comercial no WhatsApp para uma empresa de movimento, saúde ou bem-estar. Sua missão é criar uma experiência acolhedora, entender rapidamente o momento do cliente e entregar o lead pronto para o atendente apenas confirmar o agendamento.

ABERTURA DA PRIMEIRA RESPOSTA:
Use a abertura personalizada fornecida no bloco SEGMENTO CONFIGURADO apenas uma vez.
Na mesma mensagem, faça a primeira pergunta estratégica.

PERSONALIZAÇÃO E INTENÇÃO:
- O bloco CONTATO informa o primeiro nome quando ele estiver disponível. Use-o naturalmente na abertura ou em um momento importante, nunca em todas as mensagens.
- Antes de seguir o roteiro, identifique a intenção atual: entender como funciona, conhecer preço/pagamento, agendar, relatar dor/limitação, reagendar/cancelar ou falar com uma pessoa.
- Responda primeiro à dúvida real usando somente a BASE DE CONHECIMENTO AUTORIZADA. Depois faça uma única pergunta contextual para continuar.
- Não ignore uma pergunta direta para voltar mecanicamente ao roteiro.
- Quando a resposta precisar de mais contexto, use no máximo dois blocos curtos de mensagem. Não envie uma sequência de perguntas.

TRIAGEM DE SERVIÇO — REGRA PRIORITÁRIA:
- O bloco CATÁLOGO DE SERVIÇOS informa tudo o que a empresa realmente oferece.
- Quando houver mais de uma opção e o interesse ainda não estiver claro, a primeira pergunta deve descobrir qual serviço a pessoa procura. Cite brevemente somente as opções cadastradas.
- Se a pessoa disser que não quer o serviço principal, nunca interprete isso como desinteresse e nunca transfira por esse motivo. Apresente as outras opções cadastradas e pergunte qual faz mais sentido.
- Depois que o serviço estiver claro, adapte experiência, motivação, vocabulário e próximo passo à opção escolhida. Não continue falando de Pilates se a pessoa escolheu fisioterapia, funcional ou outro serviço cadastrado.
- Não invente modalidades, benefícios ou condições que não constem no catálogo e na base autorizada.
- A triagem de serviço conta como uma pergunta do limite total. Evite perguntar novamente qual serviço a pessoa busca.

ROTEIRO OBRIGATÓRIO DE 3 A 4 PERGUNTAS:
1. Experiência: use a pergunta de experiência fornecida no bloco SEGMENTO CONFIGURADO.
2. Motivação: reconheça brevemente a resposta anterior e use a pergunta de motivação fornecida para o segmento.
3. Momento: descubra se quer começar agora/em breve ou se está apenas pesquisando para o futuro.
4. Disponibilidade: quando necessário, pergunte qual período encaixa melhor — manhã, tarde ou noite.

LEADS FRIOS DE ANÚNCIO:
- Quando o bloco ORIGEM DO LEAD indicar Meta Ads, trate como um primeiro contato que ainda precisa ganhar confiança.
- Na primeira mensagem, reconheça naturalmente que a pessoa veio pelo anúncio, sem dizer que você rastreou dados dela.
- A primeira pergunta deve descobrir o gatilho de interesse: o que chamou atenção no anúncio ou o que fez a pessoa buscar o serviço agora.
- A resposta dessa pergunta já pode preencher motivação/objetivo. Não faça a mesma pergunta novamente com outras palavras.
- Em seguida, descubra apenas os pontos ainda pendentes entre experiência, momento para começar e disponibilidade.
- Faça uma validação curta e útil antes de cada nova pergunta. Se houver informação autorizada da empresa que reduza insegurança, use-a brevemente, sem inventar benefícios.
- Leads frios não devem receber pressão, textos promocionais genéricos nem uma sequência que pareça interrogatório.
- Dúvidas sobre preço, confiança, horário ou funcionamento são sinais de consideração. Responda brevemente, mantenha a conversa e conduza o próximo passo.

TRATAMENTO DE PREÇO — REGRA CRÍTICA:
- Perguntar preço é sinal de interesse. Nunca repreenda, desconverse ou encerre o atendimento por isso.
- Descubra com naturalidade se a pessoa está comparando lugares/opções ou se quer entender o investimento para começar agora.
- Não pergunte "por que quer saber o preço?" de forma seca. Reconheça primeiro que investimento é uma parte importante da decisão.
- Nunca invente, estime, calcule, sugira faixa de preço ou use valores comuns de mercado.
- Só mencione números e condições que apareçam explicitamente no bloco PREÇOS AUTORIZADOS.
- Se não houver preço autorizado, diga que a equipe apresentará as opções corretas para o caso e continue com uma única pergunta estratégica.
- Mesmo quando houver preço cadastrado, não responda apenas com o valor: informe somente o que foi autorizado e conduza para intenção, comparação ou agendamento.

REGRAS COMERCIAIS:
- Leia o histórico inteiro e nunca repita uma informação ou pergunta já respondida.
- Se houver mensagem de follow-up ou o cliente voltar depois de uma pausa, reconheça a retomada de forma natural e continue exatamente do próximo ponto pendente. Nunca reinicie a apresentação ou o roteiro.
- Se o cliente antecipar uma resposta, pule aquela etapa e use a próxima pergunta mais útil.
- Faça apenas uma pergunta por mensagem. Faça no mínimo três e nunca ultrapasse quatro perguntas no total.
- Cada mensagem intermediária deve terminar com uma pergunta clara.
- Antes da pergunta, faça uma validação curta e genuína da resposta anterior, sem recapitular tudo.
- Use mensagens curtas, naturais, calorosas e seguras. Não pareça formulário ou robô.
- Não invente preços, planos, horários, profissionais ou condições. Se perguntarem valor, diga que a equipe apresentará a opção adequada e continue conduzindo.
- Não diagnostique ou prometa resultado médico. Em urgência ou dor intensa, oriente avaliação médica.
- Nunca fique esperando depois de falar de preço ou planos: conduza o próximo passo com uma pergunta.
- Obedeça rigorosamente ao segmento configurado e use o nome correto do serviço. Nunca chame o serviço de Pilates quando o segmento não for Pilates.

TRANSFERÊNCIA E INTENÇÃO:
- Nunca transfira antes de receber respostas para pelo menos três perguntas.
- Considere inclinado a agendar somente quem demonstrar intenção de começar agora/em breve. Se também souber o período preferido, o lead está pronto.
- Respostas como "depende", "talvez", "não sei" ou "mais para frente" não significam desinteresse. Não encerre, não descarte e não use uma despedida genérica.
- Quando o momento para começar estiver indefinido, use a quarta e última pergunta para entender com delicadeza o que falta para a decisão: horário, investimento, segurança sobre a modalidade ou outro motivo. Não pressione.
- Depois da terceira resposta: se intenção e período já estiverem claros, transfira. Se faltar um desses pontos, faça a quarta e última pergunta de forma contextual, sem voltar ao roteiro como um formulário.
- Depois da quarta resposta: se estiver inclinado, diga "Perfeito, já entendi o que você procura 😊 Vou passar seu atendimento para nossa equipe. Já deixei tudo organizado para eles só confirmarem o melhor horário com você." e acrescente [TRANSFERIR].
- Depois da quarta resposta, mesmo que ainda não esteja pronto para agendar, não encerre o lead. Diga que organizou as informações e que uma atendente dará sequência para explicar as possibilidades sem compromisso; acrescente [TRANSFERIR].
- Nunca use [NUTRIR], nunca diga apenas que ficará à disposição e nunca repita uma mensagem já enviada.`;

const supabaseHeaders = () => ({
  "Content-Type": "application/json",
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
});

async function getHistory(companyId: string | null, phone: string, limit = 20): Promise<Turn[]> {
  const queryData: Record<string,string> = {
    select: "id,contact_name,last_message,ai_reply,status,updated_at,score,summary",
    phone: `eq.${phone}`,
    order: "updated_at.desc",
    limit: String(Math.max(6, Math.min(70, limit))),
  };
  if (companyId) {
    const mode = await getStorageMode();
    const key = mode === "tables" ? "company_id" : "summary->>company_id";
    queryData[key] = `eq.${companyId}`;
  }
  const query = new URLSearchParams(queryData);
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations?${query}`, {
    headers: supabaseHeaders(), cache: "no-store",
  });
  if (!response.ok) return [];
  const rows = (await response.json()) as Turn[];
  return rows.reverse();
}

function buildSummary(history: Turn[], currentMessage: string) {
  const answers = [...history.filter((turn) => !turn.status.startsWith("followup_")).map((turn) => turn.last_message), currentMessage]
    .filter(Boolean).slice(-4);
  return { qualificacao: answers.join(" • "), proximo_passo: "Confirmar horário e agendar aula experimental" };
}

async function extractQualification(history: Turn[], currentMessage: string, model: AiModel) {
  const answers=[...history.filter((turn)=>!turn.status.startsWith("followup_")).map((turn)=>turn.last_message),currentMessage].filter(Boolean);
  const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model,response_format:{type:"json_object"},messages:[{role:"system",content:"Extraia a qualificação do lead. Retorne somente JSON com: intent, service_interest, experience, motivation, pain, start_timing, preferred_period, objection, ready_to_schedule (boolean), missing_fields (array). Use null quando não informado. objection deve conter somente uma barreira explicitamente demonstrada pelo lead, como preço, horário, distância, insegurança, comparação ou falta de tempo; nunca invente uma objeção. ready_to_schedule só pode ser true quando houver intenção de começar agora/em breve e período preferido."},{role:"user",content:answers.join("\n")} ]})});
  if(!response.ok)return { qualification: null, usage: mergeUsage(model) }; try{const data=await response.json();const parsed=JSON.parse(data.choices?.[0]?.message?.content||"{}");return {qualification:{intent:String(parsed.intent||"informacao").slice(0,80),service_interest:parsed.service_interest?String(parsed.service_interest).slice(0,120):null,experience:parsed.experience?String(parsed.experience).slice(0,200):null,motivation:parsed.motivation?String(parsed.motivation).slice(0,250):null,pain:parsed.pain?String(parsed.pain).slice(0,250):null,start_timing:parsed.start_timing?String(parsed.start_timing).slice(0,150):null,preferred_period:parsed.preferred_period?String(parsed.preferred_period).slice(0,100):null,objection:parsed.objection?String(parsed.objection).slice(0,500):null,ready_to_schedule:Boolean(parsed.ready_to_schedule),missing_fields:Array.isArray(parsed.missing_fields)?parsed.missing_fields.map(String).slice(0,6):[]},usage:readUsage(data,model)};}catch{return { qualification: null, usage: mergeUsage(model) };}
}

function isReadyToSchedule(history: Turn[], currentMessage: string) {
  const allText = [...history.map((turn) => turn.last_message), currentMessage].join(" ").toLowerCase();
  const current = currentMessage.trim().toLowerCase();
  const wantsSoon = /(come[cç]ar agora|quero come[cç]ar|quanto antes|o mais r[aá]pido|essa semana|pr[oó]xima semana|em breve|imediat)/i.test(allText)
    || /^(sim|quero|com certeza|pode ser)/i.test(current);
  const hasPeriod = /(manh[ãa]|tarde|noite|qualquer hor[aá]rio|qualquer per[ií]odo)/i.test(allText);
  return wantsSoon && hasPeriod;
}

function isPriceInquiry(message: string) {
  return /\b(pre[cç]o|valor|valores|quanto custa|quanto fica|mensalidade|plano|planos|investimento|or[cç]amento|promo[cç][aã]o)\b/i.test(message);
}

function getAuthorizedPrices(settings: Record<string, unknown> | undefined) {
  const prices = String(settings?.prices || "").replace(/\s+/g, " ").trim();
  const payment = String(settings?.paymentMethods || "").replace(/\s+/g, " ").trim();
  const promotion = String(settings?.promotionText || "").replace(/\s+/g, " ").trim();
  const expiresAt = String(settings?.promotionExpiresAt || "");
  const promotionActive = Boolean(promotion) && (!expiresAt || new Date(`${expiresAt}T23:59:59`).getTime() >= Date.now());
  const authorized = [prices && !/^(consultar|sob consulta|consulte|n[aã]o informado|a combinar|falar com a equipe)/i.test(prices) ? prices : "", payment ? `Formas de pagamento: ${payment}` : "", promotionActive ? `Condição promocional ativa: ${promotion}${expiresAt ? ` (válida até ${new Date(`${expiresAt}T12:00:00`).toLocaleDateString("pt-BR")})` : ""}` : ""].filter(Boolean).join(". ");
  return authorized.slice(0, 700);
}

function promptKnowledge(settings: Record<string, any> | undefined) {
  const source = settings || {};
  const expiresAt = String(source.promotionExpiresAt || "");
  const promotionActive = Boolean(source.promotionText) && (!expiresAt || new Date(`${expiresAt}T23:59:59`).getTime() >= Date.now());
  return {
    services: source.services || "", how_it_works: source.serviceHowItWorks || "", first_experience: source.firstExperience || "",
    differentials: source.differentials || "", frequently_asked_questions: source.faq || "", prices: source.prices || "",
    payment_methods: source.paymentMethods || "", active_promotion: promotionActive ? source.promotionText : "", promotion_expiration: promotionActive ? expiresAt : "",
    city: source.city || "", address: source.address || "", business_hours: source.businessHours || "", available_periods: source.availablePeriods || "",
    cancellation_policy: source.cancellationPolicy || "", commercial_goal: source.commercialGoal || "", handoff_instructions: source.handoffInstructions || "",
    tone: source.toneGuidelines || "Acolhedor, objetivo e profissional", emoji_style: source.emojiStyle || "light",
  };
}

function serviceCatalog(settings: Record<string, any> | undefined, primaryService: string) {
  const raw = String(settings?.services || "").replace(/\s+/g, " ").trim();
  const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const known = [
    ["Pilates", /\bpilates\b/], ["Fisioterapia", /\bfisioterapia\b/], ["Treinamento funcional", /\b(funcional|treinamento funcional)\b/],
    ["Personal trainer", /\b(personal|personal trainer)\b/], ["Musculação", /\bmusculacao\b/], ["Yoga", /\byoga\b/],
    ["RPG", /\brpg\b/], ["Massoterapia", /\bmassoterapia\b/], ["Quiropraxia", /\bquiropraxia\b/],
  ] as const;
  const detected = known.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label);
  if (!detected.some((item) => item.toLowerCase() === primaryService.toLowerCase())) detected.unshift(primaryService);
  return { raw: raw || primaryService, options: [...new Set(detected)].slice(0, 8) };
}

function asksForServiceTriage(message: string, catalog: { options: string[] }) {
  if (catalog.options.length < 2) return false;
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const mentioned = catalog.options.filter((item) => normalized.includes(item.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(" ")[0]));
  return mentioned.length === 0 || /\b(nao quero|nao procuro|nao tenho interesse)\b/.test(normalized);
}

function firstName(name: string) {
  const clean = String(name || "").replace(/[^\p{L}\p{M}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  const first = clean.split(" ")[0] || "";
  return first.length >= 2 && first.length <= 30 && !/^(contato|cliente|unknown|null)$/i.test(first) ? first : "";
}

function containsUnauthorizedPrice(reply: string, authorizedPrices: string) {
  const mentions = reply.match(/R\$\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*(?:reais|por m[eê]s|mensais)/gi) || [];
  if (!mentions.length) return false;
  if (!authorizedPrices) return true;
  const allowedDigits = authorizedPrices.replace(/\D/g, " ").split(/\s+/).filter(Boolean);
  return mentions.some((mention) => {
    const mentionedDigits = mention.replace(/\D/g, " ").split(/\s+/).filter(Boolean);
    return mentionedDigits.some((digits) => !allowedDigits.includes(digits));
  });
}

function priceInquiryReply(authorizedPrices: string, leadName = "") {
  const opening = leadName ? `${leadName}, claro 😊` : "Claro 😊";
  if (authorizedPrices) return `${opening} Estas são as condições autorizadas pela equipe: ${authorizedPrices}. Para eu te orientar da forma certa, você está comparando opções ou quer entender o investimento para começar agora?`;
  return `${leadName ? `${leadName}, entendo` : "Entendo"}, o investimento é uma parte importante da decisão 😊 Para não te passar uma informação que não corresponda ao que você precisa, nossa equipe vai apresentar as opções certinhas. Você está comparando com outros lugares ou quer entender o valor para começar agora?`;
}

function priceHandoffReply(authorizedPrices: string, ready: boolean) {
  const valueText = authorizedPrices
    ? `Estas são as condições autorizadas pela equipe: ${authorizedPrices}.`
    : "A equipe vai te apresentar as opções de valores certinhas, sem te passar uma informação que não corresponda ao que você precisa.";
  const nextStep = ready
    ? "Já organizei suas preferências e vou chamar uma atendente para confirmar o melhor horário com você."
    : "Já organizei o que você procura e vou chamar uma atendente para entender sua comparação e explicar as opções com calma.";
  return `Claro, o investimento é uma parte importante da decisão 😊 ${valueText} ${nextStep}`;
}

function hasUncertainTiming(message: string, structured: Record<string, unknown> | null) {
  const timing = `${message} ${String(structured?.start_timing || "")}`.toLowerCase();
  return /\b(depende|talvez|n[aã]o sei|ainda n[aã]o|mais pra frente|mais para frente|futur|estou pesquisando|s[oó] pesquisando)\b/i.test(timing);
}

function scheduleHandoffMessage() {
  return "Perfeito, já entendi o que você procura 😊 Vou passar seu atendimento para nossa equipe. Já deixei tudo organizado para eles só confirmarem o melhor horário com você.";
}

function consultativeHandoffMessage() {
  return "Entendi seu momento 😊 Já organizei o que você me contou e vou passar para uma atendente da nossa equipe. Ela vai te explicar as possibilidades com mais detalhes e entender com você o que faz sentido agora, sem compromisso. Só um instante.";
}

function nextRequiredQuestion(questionsAsked: number, currentMessage = "", structured: Record<string, unknown> | null = null, business: BusinessProfile = getBusinessProfile("pilates"), isAdLead = false) {
  if (questionsAsked <= 0 && isAdLead) return `Oi, tudo bem? Que bom que você veio pelo nosso anúncio 😊 Eu vou te ajudar com as informações sobre ${business.serviceName}. O que mais chamou sua atenção e fez você procurar esse atendimento agora?`;
  if (questionsAsked <= 0) return `Oi, tudo bem? Que bom que você chamou. Eu vou te ajudar com as informações sobre ${business.serviceName}. ${business.experienceQuestion}`;
  if (questionsAsked === 1 && isAdLead) return `Entendi 😊 ${business.experienceQuestion}`;
  if (questionsAsked === 1) return `Entendi 😊 ${business.motivationQuestion}`;
  if (questionsAsked === 2) return "Faz sentido. Você pretende começar agora ou está pesquisando para mais para frente?";
  if (hasUncertainTiming(currentMessage, structured)) return `Entendi, isso é bem comum 😊 O que mais pesa para você decidir quando começar: encaixar um horário, entender o investimento ou saber melhor como ${business.serviceName} pode te ajudar?`;
  return "Ótimo. Para eu deixar seu atendimento pronto para agendamento, qual período funciona melhor para você: manhã, tarde ou noite?";
}

function normalizedText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isCompanyIdentity(value: string, companyName: string) {
  const candidate = normalizedText(value);
  const company = normalizedText(companyName);
  if (!candidate || !company) return false;
  if (candidate === company) return true;
  const genericBusinessWords = new Set(["pilates", "studio", "estudio", "clinica", "academia", "fisioterapia", "saude", "fitness", "centro", "unidade"]);
  const distinctiveTokens = company.split(" ").filter((token) => token.length >= 4 && !genericBusinessWords.has(token));
  return candidate.length >= 4 && (company.startsWith(`${candidate} `) || company.endsWith(` ${candidate}`) || distinctiveTokens.includes(candidate));
}

function reliableContactName(incoming: string, companyName: string, previous = "", trustIncoming = true) {
  const generic = new Set(["", "contato", "contato do whatsapp", "whatsapp", "unknown", "desconhecido", "sem nome"]);
  const clean = (value: string) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const valid = (value: string) => {
    const normalized = normalizedText(value);
    return !generic.has(normalized) && !isCompanyIdentity(value, companyName) && !/^\+?\d{8,15}$/.test(value.replace(/[\s()-]/g, ""));
  };
  const candidate = clean(incoming);
  const stored = clean(previous);
  return trustIncoming && valid(candidate) ? candidate : valid(stored) ? stored : "Contato";
}

function identifiesExistingStudent(value: string) {
  const text = normalizedText(value);
  if (/\b(nao sou|ainda nao sou|nunca fui)\s+(alun[oa]|paciente|cliente)\b/.test(text)) return false;
  return /\b(sou alun[oa]|ja sou alun[oa]|sou paciente|ja sou paciente|sou cliente|ja sou cliente|ja faco (pilates|fisioterapia|funcional|aula|treino) (ai|com voces)|ja treino (ai|com voces)|sou alun[oa] de voces|sou paciente de voces)\b/.test(text)
    || /\b(vou faltar|nao (vou|consigo|conseguirei) (ir|comparecer)|preciso repor|quero repor|remarcar minha aula|cancelar minha aula|minha mensalidade|meu horario fixo|ausencia)\b.*\b(aula|pilates|fisioterapia|funcional|treino|hoje|amanha|semana|segunda|terca|quarta|quinta|sexta)\b/.test(text);
}

function identifiesDeferredIntent(value: string) {
  const text = normalizedText(value);
  return /\b(depois (eu )?(vejo|confiro|decido|retorno|respondo|entro em contato)|vou ver (direitinho|com calma)|entro em contato (depois|mais tarde)|falo com voces depois|por enquanto (nao|obrigad[oa])|obrigad[oa] por enquanto|agora nao|nesse momento nao|mais pra frente|quando eu puder eu (chamo|retorno)|vou pensar)\b/.test(text);
}

function identifiesImportedLeadIntent(value: string) {
  const text = normalizedText(value);
  return /\b(nao sou|ainda nao sou|nunca fui)\s+(alun[oa]|paciente|cliente)\b/.test(text)
    || /\b(quero conhecer|quero saber|quero informacoes|gostaria de informacoes|tenho interesse|aula experimental|avaliacao|quero comecar|retomando|retomar|voltei para saber|orcamento|preco|valor)\b/.test(text);
}

function isRepeatedReply(history: Turn[], reply: string) {
  const candidate = normalizedText(reply);
  if (!candidate) return false;
  return history.slice(-6).some((turn) => {
    const previous = normalizedText(turn.ai_reply || "");
    if (!previous) return false;
    if (candidate === previous) return true;
    const candidateWords = new Set(candidate.split(" "));
    const previousWords = new Set(previous.split(" "));
    const intersection = [...candidateWords].filter((word) => previousWords.has(word)).length;
    const union = new Set([...candidateWords, ...previousWords]).size;
    return candidate.length > 70 && previous.length > 70 && union > 0 && intersection / union >= 0.86;
  });
}

async function saveTurn(companyId: string | null, phone: string, name: string, message: string, reply: string, handoff: HandoffMode, history: Turn[] = [], structured: Record<string,unknown> | null = null, usage?: TokenUsage, leadContext: Record<string, unknown> = {}) {
  const transfer = handoff !== null;
  const summary = structured ? { ...leadContext, ...structured, objection: structured.objection || leadContext.objection || null } : transfer ? { ...leadContext, ...buildSummary(history, message) } : { ...leadContext };
  const previousStage = String(history.at(-1)?.summary?.crm_stage || "");
  const manualStageLocked = history.at(-1)?.summary?.crm_stage_manual === true;
  const manuallyAdvancedStages = ["agendamento", "compareceu", "negociacao", "fechado", "perdido"];
  const crmStage = manualStageLocked && previousStage ? previousStage : manuallyAdvancedStages.includes(previousStage) ? previousStage : transfer ? "qualificado" : "atendimento";
  const handoffData = handoff === "schedule"
    ? { appointment_status: "pending", handoff_reason: "Lead qualificado e inclinado a agendar", next_action: "Confirmar melhor horário" }
    : handoff === "consultative"
      ? { handoff_reason: "Lead qualificado e precisa de orientação para avançar", next_action: "Atendente explicar possibilidades e remover objeções" }
      : {};
  const mode = await getStorageMode();
  const usageData = usage ? { ai_usage: usage } : {};
  const tenantData = companyId ? conversationRecord(mode, companyId, { ...summary, ...usageData, crm_stage: crmStage, crm_stage_manual: manualStageLocked, ai_paused: transfer, ...handoffData }) : { summary: { ...summary, ...usageData, crm_stage: crmStage, crm_stage_manual: manualStageLocked } };
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST",
    headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({
      ...tenantData, phone, contact_name: name, last_message: message, ai_reply: reply,
      status: transfer ? "qualified" : "in_progress",
      score: handoff === "schedule" ? 90 : handoff === "consultative" ? 78 : Math.min(75, 25 + history.filter((turn) => !turn.status.startsWith("followup_")).length * 20),
      updated_at: new Date().toISOString(),
    }),
  });
}

async function saveBufferedInbound(companyId: string | null, phone: string, name: string, message: string, bufferId: string, leadContext: Record<string, unknown> = {}) {
  const mode = await getStorageMode();
  const tenantData = companyId ? conversationRecord(mode, companyId, { ...leadContext, crm_stage: "atendimento", buffer_message_id: bufferId, ai_paused: false }) : { summary: { ...leadContext, crm_stage: "atendimento", buffer_message_id: bufferId } };
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: message, ai_reply: "", status: "buffering", score: 20, updated_at: new Date().toISOString() }),
  });
}

async function deleteBufferedRows(rows: Turn[]) {
  const ids = rows.map((row) => row.id).filter((id): id is number => typeof id === "number");
  if (!ids.length) return;
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations?id=in.(${ids.join(",")})`, { method: "DELETE", headers: { ...supabaseHeaders(), Prefer: "return=minimal" } });
}

async function saveInboundForHuman(companyId: string | null, phone: string, name: string, message: string, previous: Turn | undefined) {
  const mode = await getStorageMode();
  const tenantData = companyId ? conversationRecord(mode, companyId, { ...(previous?.summary || {}), ai_paused: true, last_customer_at: new Date().toISOString() }) : { summary: previous?.summary || {} };
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: message, ai_reply: "", status: "human_active", score: 80, updated_at: new Date().toISOString() }),
  });
}

async function saveInboundDuringGlobalPause(companyId: string, phone: string, name: string, message: string, previous: Turn | undefined, leadContext: Record<string, unknown>) {
  const mode = await getStorageMode();
  const previousSummary = previous?.summary || {};
  const tenantData = conversationRecord(mode, companyId, { ...previousSummary, ...leadContext, global_ai_pause_received: true, last_customer_at: new Date().toISOString() });
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: message, ai_reply: "", status: "in_progress", score: previous?.score || 20, updated_at: new Date().toISOString() }),
  });
}

function cancelledAutomationSummary(previous: Turn | undefined, reason: string) {
  const previousSummary = previous?.summary || {};
  const plan = previousSummary.crm_followup_plan && typeof previousSummary.crm_followup_plan === "object" ? previousSummary.crm_followup_plan : null;
  return {
    ...previousSummary,
    crm_next_action_at: null,
    automation_state: reason,
    automation_updated_at: new Date().toISOString(),
    ...(plan?.status === "active" ? { crm_followup_plan: { ...plan, status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason } } : {}),
  };
}

async function saveHumanOutbound(companyId: string, phone: string, name: string, message: string, messageId: string, previous: Turn | undefined, initiatedByCompany = false) {
  const mode = await getStorageMode();
  const now = new Date().toISOString();
  const previousSummary = previous?.summary || {};
  const summary = {
    ...cancelledAutomationSummary(previous, initiatedByCompany ? "human_outreach" : "human_replied"),
    ai_paused: true,
    human_active_at: now,
    outbound_message_id: messageId,
    outbound_source: "human_device",
    crm_stage: previousSummary.crm_stage || "atendimento",
    crm_contact_at: previousSummary.crm_contact_at || now,
    lead_source: previousSummary.lead_source || (initiatedByCompany ? "Prospecção ativa" : "WhatsApp"),
    lead_source_method: previousSummary.lead_source_method || (initiatedByCompany ? "company_outbound" : "direct"),
    lead_temperature: previousSummary.lead_temperature || (initiatedByCompany ? "outbound" : "inbound"),
    ...(initiatedByCompany ? { outbound_initiated_by_company: true, first_company_outbound_at: previousSummary.first_company_outbound_at || now } : {}),
  };
  const tenantData = conversationRecord(mode, companyId, summary);
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: "", ai_reply: message, status: "human_active", score: previous?.score || 80, updated_at: new Date().toISOString() }),
  });
}

async function saveDeferredConversation(companyId: string, phone: string, name: string, message: string, reply: string, previous: Turn | undefined, leadContext: Record<string, unknown>) {
  const mode = await getStorageMode();
  const summary = {
    ...cancelledAutomationSummary(previous, "lead_requested_pause"),
    ...leadContext,
    ai_paused: false,
    automation_state: "snoozed_by_lead",
    automation_snoozed_until: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    crm_next_action_at: null,
    crm_stopped_reason: "Lead pediu para retomar depois",
  };
  const tenantData = conversationRecord(mode, companyId, summary);
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: message, ai_reply: reply, status: "nurture_paused", score: previous?.score || 30, updated_at: new Date().toISOString() }),
  });
}

function isSystemOutboundEcho(history: Turn[], message: string, messageId: string) {
  const normalized = normalizedText(message);
  return history.slice(-12).some((turn) => {
    const recent = Date.now() - new Date(turn.updated_at).getTime() < 5 * 60 * 1000;
    const source = String(turn.summary?.outbound_source || "");
    const knownIds = [turn.summary?.outbound_message_id, turn.summary?.appointment_confirmation_message_id, turn.summary?.reminder_message_id].map(String);
    const knownId = Boolean(messageId && knownIds.includes(messageId));
    const knownText = ["ai", "followup", "reminder", "campaign", "appointment", "human_platform"].includes(source)
      && normalized && normalizedText(turn.ai_reply || "").includes(normalized);
    return recent && (knownId || knownText) && source !== "human_device";
  });
}

async function saveInboundWithoutAi(companyId: string, phone: string, name: string, message: string, previous: Turn | undefined, leadContext: Record<string, unknown>) {
  const mode = await getStorageMode();
  const previousSummary = previous?.summary || {};
  const tenantData = conversationRecord(mode, companyId, {
    ...previousSummary,
    ...leadContext,
    crm_stage: previousSummary.crm_stage || "novo",
    ai_paused: true,
    ai_disabled_by_plan: true,
    last_customer_at: new Date().toISOString(),
  });
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({
      ...tenantData,
      phone,
      contact_name: name,
      last_message: message,
      ai_reply: "",
      status: "human_active",
      score: previous?.score ?? 10,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function saveStudentInbound(companyId: string, phone: string, name: string, message: string, reply: string, previous: Turn | undefined, leadContext: Record<string, unknown>) {
  const mode = await getStorageMode();
  const previousSummary = previous?.summary || {};
  const plan = previousSummary.crm_followup_plan && typeof previousSummary.crm_followup_plan === "object" ? previousSummary.crm_followup_plan : null;
  const summary = {
    ...previousSummary,
    ...leadContext,
    contact_type: "student",
    student_marked_at: previousSummary.student_marked_at || new Date().toISOString(),
    contact_only: false,
    manual_action_required: false,
    imported_contact_triage_pending: false,
    ai_paused: true,
    crm_next_action_at: null,
    ...(plan?.status === "active" ? { crm_followup_plan: { ...plan, status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "student_identified" } } : {}),
  };
  const tenantData = conversationRecord(mode, companyId, summary);
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: message, ai_reply: reply, status: "student", score: 0, updated_at: new Date().toISOString() }),
  });
}

async function saveImportedContactTriage(companyId: string, phone: string, name: string, message: string, reply: string, previous: Turn | undefined, leadContext: Record<string, unknown>) {
  const mode = await getStorageMode();
  const tenantData = conversationRecord(mode, companyId, {
    ...(previous?.summary || {}),
    ...leadContext,
    imported_from_whatsapp: true,
    contact_only: false,
    manual_action_required: false,
    imported_contact_triage_pending: true,
    crm_stage: "atendimento",
    ai_paused: false,
  });
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: message, ai_reply: reply, status: "contact_triage", score: 15, updated_at: new Date().toISOString() }),
  });
}

async function saveAppointmentReply(companyId: string | null, phone: string, name: string, message: string, reply: string, previous: Turn, changes: Record<string, unknown>) {
  const mode = await getStorageMode();
  const tenantData = companyId ? conversationRecord(mode, companyId, { ...(previous.summary || {}), ...changes, ai_paused: true }) : { summary: { ...(previous.summary || {}), ...changes, ai_paused: true } };
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/conversations`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ ...tenantData, phone, contact_name: name, last_message: message, ai_reply: reply, status: "human_active", score: 90, updated_at: new Date().toISOString() }),
  });
}

async function sendWhatsApp(instance: string, phone: string, text: string) {
  const baseUrl = process.env.EVOLUTION_API_URL!.replace(/\/$/, "");
  const boundary = text.length > 260 ? [...text.matchAll(/[.!?](?:\s|$)/g)].map((match) => (match.index || 0) + 1).filter((index) => index >= 110 && index <= Math.min(360, text.length - 70)).at(-1) : undefined;
  const parts = boundary ? [text.slice(0, boundary).trim(), text.slice(boundary).trim()].filter(Boolean) : [text];
  const messageIds: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const typingDelay = Math.max(1_000, Math.min(2_200, 850 + part.length * 7));
    const typingStartedAt = Date.now();
    await fetch(`${baseUrl}/chat/sendPresence/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY! },
      body: JSON.stringify({ number: phone, presence: "composing", delay: typingDelay }),
    }).catch(() => null);
    const remainingDelay = typingDelay - (Date.now() - typingStartedAt);
    if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    const delivery = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY! },
      body: JSON.stringify({ number: phone, text: part }),
    }).catch(() => null);
    if (!delivery?.ok) return { ok: false };
    const payload = await delivery.json().catch(() => ({}));
    const messageId = String(payload?.key?.id || payload?.messageId || payload?.id || "");
    if (messageId) messageIds.push(messageId);
    if (index < parts.length - 1) await new Promise((resolve) => setTimeout(resolve, 450));
  }
  return { ok: true, messageId: messageIds.at(-1) || "", messageIds };
}

export async function POST(request: NextRequest) {
  if (STAGING_MODE) return NextResponse.json({ error: "Webhook desativado no ambiente de homologação" }, { status: 403 });
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) return NextResponse.json({ error: `Configuração pendente: ${missing.join(", ")}` }, { status: 503 });
  if (process.env.WEBHOOK_SECRET && request.nextUrl.searchParams.get("secret") !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const event = await request.json();
  if (String(event.event).toLowerCase().replace("_", ".") !== "messages.upsert") {
    return NextResponse.json({ ignored: true });
  }
  const message = event.data?.message?.conversation || event.data?.message?.extendedTextMessage?.text;
  const phone = String(event.data?.key?.remoteJid || "").replace(/@s\.whatsapp\.net$/, "");
  if (!message || !phone) return NextResponse.json({ ignored: true });
  const incomingContactName = String(event.data?.pushName || "Contato").trim().slice(0, 120) || "Contato";
  const fromMe = event.data?.key?.fromMe === true;
  const providerMessageId = String(event.data?.key?.id || "");
  const detectedOrigin = detectLeadOrigin(event, String(message));

  const instanceName = String(event.instance || process.env.EVOLUTION_INSTANCE_NAME || "");
  const company = await findCompanyByInstance(instanceName);
  if (!company?.active) return NextResponse.json({ error: "Empresa não encontrada ou inativa" }, { status: 404 });
  const currentUnit = whatsappUnitsForCompany(company).find((unit) => unit.instance === instanceName);
  const effectiveSettings = settingsForWhatsAppUnit(company.settings, currentUnit);
  company.settings = effectiveSettings;
  const enabledModules = company.settings?.subscription?.modules;

  const aiSettings = getAiSettings(company.settings);
  const business = getBusinessProfile(effectiveSettings?.businessType);
  const catalog = serviceCatalog(effectiveSettings, business.serviceName);
  const authorizedPrices = getAuthorizedPrices(effectiveSettings);
  let incomingMessage = String(message).trim();
  const rawHistory = await getHistory(company.id, phone, aiSettings.historyMessages + 10);
  const contactName = reliableContactName(incomingContactName, company.name, String(rawHistory.at(-1)?.contact_name || ""), !fromMe);
  const leadFirstName = firstName(contactName);
  const previousSummary = rawHistory.at(-1)?.summary || {};
  if (fromMe) {
    let outboundHistory = rawHistory;
    if (!isSystemOutboundEcho(outboundHistory, incomingMessage, providerMessageId)) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      outboundHistory = await getHistory(company.id, phone, aiSettings.historyMessages + 10);
    }
    if (isSystemOutboundEcho(outboundHistory, incomingMessage, providerMessageId)) return NextResponse.json({ ok: true, ignored: "system_outbound_echo" });
    const storedContactName = reliableContactName("", company.name, String(outboundHistory.at(-1)?.contact_name || ""), false);
    const initiatedByCompany = !outboundHistory.some((turn) => String(turn.last_message || "").trim() && !String(turn.last_message).startsWith("["));
    await saveHumanOutbound(company.id, phone, storedContactName, incomingMessage, providerMessageId, outboundHistory.at(-1), initiatedByCompany);
    return NextResponse.json({ ok: true, humanOutbound: true, initiatedByCompany, automationsCancelled: true });
  }
  const persistentKeys = ["crm_stage", "crm_stage_manual", "crm_plan", "crm_value", "crm_notes", "crm_objection", "objection", "crm_contact_at", "crm_stopped_at", "crm_next_action_at", "crm_converted_at", "appointment_at", "appointment_status", "appointment_notes", "contact_type", "student_marked_at", "imported_from_whatsapp", "contact_only", "manual_action_required", "imported_contact_triage_pending", "automation_state", "automation_snoozed_until", "crm_stopped_reason"];
  const persistentContext = Object.fromEntries(persistentKeys.filter((key) => previousSummary[key] !== undefined).map((key) => [key, previousSummary[key]]));
  if (previousSummary.automation_state === "snoozed_by_lead") {
    persistentContext.automation_state = "active";
    persistentContext.automation_snoozed_until = null;
  }
  if (previousSummary.crm_followup_plan && typeof previousSummary.crm_followup_plan === "object") {
    persistentContext.crm_followup_plan = previousSummary.crm_followup_plan.status === "active"
      ? { ...previousSummary.crm_followup_plan, status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "lead_replied" }
      : previousSummary.crm_followup_plan;
    persistentContext.crm_next_action_at = null;
  }
  const previousOriginTurn = [...rawHistory].reverse().find((turn) => turn.summary?.lead_source);
  const previousSource = String(previousOriginTurn?.summary?.lead_source || "");
  let isAdLead = detectedOrigin.isAdLead || ["Meta Ads", "Instagram Ads", "Facebook Ads", "Google"].includes(previousSource);
  let leadSource = detectedOrigin.isAdLead ? detectedOrigin.source : previousSource || "WhatsApp";
  let leadSourceMethod = detectedOrigin.isAdLead ? detectedOrigin.method : String(previousOriginTurn?.summary?.lead_source_method || "direct");
  let adTitle = detectedOrigin.adTitle || String(previousOriginTurn?.summary?.ad_title || "").slice(0, 180) || null;
  const getLeadContext = (extra: Record<string, unknown> = {}) => ({ ...persistentContext, lead_source: leadSource || "WhatsApp", lead_source_method: leadSourceMethod, lead_temperature: isAdLead ? "cold" : "inbound", whatsapp_unit_id: currentUnit?.id || "unit-1", whatsapp_unit_name: currentUnit?.name || "Unidade principal", whatsapp_instance: instanceName, ...(adTitle ? { ad_title: adTitle } : {}), ...extra });
  let history = rawHistory.filter((turn) => turn.status !== "buffering").slice(-aiSettings.historyMessages);
  let lastTurn = history.at(-1);
  const duplicateTurn = rawHistory.at(-1);
  if (duplicateTurn?.last_message?.trim() === incomingMessage && Date.now() - new Date(duplicateTurn.updated_at).getTime() < 120_000) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  const planControlsModules = Array.isArray(enabledModules);
  const aiEnabled = !planControlsModules || enabledModules.includes("ai");
  const passiveIntakeEnabled = !planControlsModules || enabledModules.includes("crm") || enabledModules.includes("chat");
  if (!aiEnabled) {
    if (passiveIntakeEnabled) {
      await saveInboundWithoutAi(company.id, phone, contactName, incomingMessage, lastTurn, getLeadContext());
    }
    return NextResponse.json({ ok: true, skipped: "ai_not_in_plan", saved: passiveIntakeEnabled, humanHandoffActive: passiveIntakeEnabled });
  }
  const globalPauseUntil = String(company.settings?.ai_pause_until || "");
  const globalAiPaused = company.settings?.ai_pause_indefinite === true || Boolean(globalPauseUntil && new Date(globalPauseUntil).getTime() > Date.now());
  if (globalAiPaused) {
    await saveInboundDuringGlobalPause(company.id, phone, contactName, incomingMessage, lastTurn, getLeadContext());
    return NextResponse.json({ ok: true, skipped: "global_ai_pause", until: company.settings?.ai_pause_indefinite === true ? null : globalPauseUntil });
  }
  const alreadyStudent = previousSummary.contact_type === "student" || lastTurn?.status === "student";
  const studentDetected = identifiesExistingStudent(incomingMessage);
  if (alreadyStudent || studentDetected) {
    const reply = alreadyStudent ? "" : `Entendi! Como você já é aluno(a) da ${company.name}, vou direcionar sua mensagem para nossa equipe continuar o atendimento por aqui.`;
    const sent = reply ? await sendWhatsApp(instanceName, phone, reply) : null;
    await saveStudentInbound(company.id, phone, contactName, incomingMessage, reply, lastTurn, getLeadContext(sent?.messageId ? { outbound_message_id: sent.messageId, outbound_source: "ai" } : {}));
    return NextResponse.json({ ok: true, student: true, autoDetected: studentDetected && !alreadyStudent, humanHandoffActive: true });
  }
  const importedContact = previousSummary.imported_from_whatsapp === true
    && (previousSummary.manual_action_required === true || previousSummary.contact_only === true || previousSummary.imported_contact_triage_pending === true || lastTurn?.status === "contact_imported" || lastTurn?.status === "contact_triage");
  if (importedContact) {
    if (identifiesImportedLeadIntent(incomingMessage)) {
      persistentContext.contact_only = false;
      persistentContext.manual_action_required = false;
      persistentContext.imported_contact_triage_pending = false;
      persistentContext.contact_type = "lead";
      persistentContext.crm_stage = "atendimento";
    } else {
      const reply = previousSummary.imported_contact_triage_pending === true
        ? `Só para eu direcionar você certinho: você já é aluno(a) ou paciente da ${company.name}, ou está buscando informações para conhecer nossos serviços?`
        : `Oi! Vi que seu contato já está na nossa lista 😊 Você já é aluno(a) ou paciente da ${company.name}, ou está retomando o contato para conhecer nossos serviços?`;
      const sent = await sendWhatsApp(instanceName, phone, reply);
      if (!sent.ok) return NextResponse.json({ error: "Falha ao enviar a triagem do contato" }, { status: 502 });
      await saveImportedContactTriage(company.id, phone, contactName, incomingMessage, reply, lastTurn, getLeadContext({ outbound_message_id: sent.messageId || "", outbound_source: "ai" }));
      return NextResponse.json({ ok: true, importedContactTriage: true });
    }
  }
  const command = incomingMessage.toLowerCase();
  if (lastTurn?.summary?.appointment_at && /^(confirmar|confirmo|reagendar|cancelar|cancelo)$/.test(command)) {
    const isConfirm = command.startsWith("confirm");
    const isCancel = command.startsWith("cancel");
    const reply = isConfirm ? `Tudo certo! Seu horário na ${company.name} está confirmado ✅` : isCancel ? `Certo, o agendamento foi cancelado. A equipe da ${company.name} pode te ajudar com uma nova data.` : `Entendi. Vou avisar a equipe da ${company.name} para combinar um novo horário com você.`;
    const changes = isConfirm ? { appointment_status: "confirmed" } : isCancel ? { appointment_status: "cancelled", crm_stage: "atendimento" } : { appointment_status: "reschedule_requested", crm_stage: "atendimento" };
    const sent = await sendWhatsApp(instanceName, phone, reply);
    if (sent.ok) await saveAppointmentReply(company.id, phone, contactName, incomingMessage, reply, lastTurn, { ...changes, outbound_message_id: sent.messageId || "", outbound_source: "ai" });
    return NextResponse.json({ ok: sent.ok, appointmentAction: command });
  }
  if (lastTurn?.status === "human_active" || lastTurn?.summary?.ai_paused === true) {
    await saveInboundForHuman(company.id, phone, contactName, incomingMessage, lastTurn);
    return NextResponse.json({ ok: true, humanHandoffActive: true, saved: true });
  }

  if (identifiesDeferredIntent(incomingMessage)) {
    const alreadyPaused = lastTurn?.status === "nurture_paused";
    const reply = alreadyPaused ? "" : `Tudo bem${leadFirstName ? `, ${leadFirstName}` : ""}! Vou deixar suas informações registradas. Quando quiser retomar, é só me chamar por aqui 😊`;
    const sent = reply ? await sendWhatsApp(instanceName, phone, reply) : null;
    if (reply && !sent?.ok) return NextResponse.json({ error: "Falha ao confirmar a pausa da conversa" }, { status: 502 });
    await saveDeferredConversation(company.id, phone, contactName, incomingMessage, reply, lastTurn, getLeadContext(sent?.messageId ? { outbound_message_id: sent.messageId, outbound_source: "ai" } : {}));
    return NextResponse.json({ ok: true, deferred: true, automationsSuspended: true });
  }

  if (aiSettings.groupMessages) {
    const bufferId = String(event.data?.key?.id || `${Date.now()}-${phone}`);
    await saveBufferedInbound(company.id, phone, contactName, incomingMessage, bufferId, getLeadContext());
    await new Promise((resolve) => setTimeout(resolve, aiSettings.groupingDelaySeconds * 1000));
    const refreshed = await getHistory(company.id, phone, aiSettings.historyMessages + 10);
    const cutoff = Date.now() - (aiSettings.groupingDelaySeconds + 12) * 1000;
    const pending = refreshed.filter((turn) => turn.status === "buffering" && new Date(turn.updated_at).getTime() >= cutoff);
    const bufferedAd = pending.find((turn) => ["Meta Ads", "Instagram Ads", "Facebook Ads", "Google"].includes(String(turn.summary?.lead_source || "")));
    if (bufferedAd) {
      isAdLead = true;
      leadSource = String(bufferedAd.summary?.lead_source || leadSource);
      leadSourceMethod = String(bufferedAd.summary?.lead_source_method || leadSourceMethod);
      adTitle = adTitle || String(bufferedAd.summary?.ad_title || "").slice(0, 180) || null;
    }
    const newest = pending.at(-1);
    if (String(newest?.summary?.buffer_message_id || "") !== bufferId) return NextResponse.json({ ok: true, grouped: true, waitingForLatestMessage: true });
    incomingMessage = [...new Set(pending.map((turn) => turn.last_message.trim()).filter(Boolean))].join("\n");
    await deleteBufferedRows(pending);
    history = refreshed.filter((turn) => turn.status !== "buffering").slice(-aiSettings.historyMessages);
    lastTurn = history.at(-1);
  }

  const priceAsked = isPriceInquiry(incomingMessage);

  const greeting = /^(oi+|ol[aá]|opa|bom dia|boa tarde|boa noite|novo atendimento|reiniciar atendimento|come[cç]ar de novo)/i.test(incomingMessage);
  const priorQuestions = history.filter((turn) => !turn.status.startsWith("followup_")).reduce((total, turn) => total + (turn.ai_reply.match(/\?/g)?.length || 0), 0);
  if (lastTurn?.status !== "qualified" && greeting && priorQuestions >= 3) history = [];
  if (lastTurn?.status === "qualified") {
    const text = incomingMessage.toLowerCase();
    const returningGreeting = /^(oi+|ol[aá]|opa|bom dia|boa tarde|boa noite|voltei|quero (mais )?informa[cç][oõ]es|podemos conversar)/i.test(text);
    const inactiveFor30Minutes = Date.now() - new Date(lastTurn.updated_at).getTime() > 30 * 60 * 1000;
    if (!returningGreeting && !inactiveFor30Minutes) return NextResponse.json({ ok: true, humanHandoffActive: true });
    history = [];
  } else {
    const lastFinishedSession = history.map((turn) => turn.status).lastIndexOf("qualified");
    if (lastFinishedSession >= 0) history = history.slice(lastFinishedSession + 1);
  }

  const questionsAsked = history
    .filter((turn) => !turn.status.startsWith("followup_"))
    .reduce((total, turn) => total + (turn.ai_reply.match(/\?/g)?.length || 0), 0);
  if (questionsAsked >= 4) {
    const extraction=await extractQualification(history,incomingMessage,aiSettings.model);
    const structured=extraction.qualification;
    const ready = Boolean(structured?.ready_to_schedule) || isReadyToSchedule(history, incomingMessage);
    const handoff: HandoffMode = ready ? "schedule" : "consultative";
    const finalMessage = priceAsked ? priceHandoffReply(authorizedPrices, ready) : ready ? scheduleHandoffMessage() : consultativeHandoffMessage();
    const sent = await sendWhatsApp(instanceName, phone, finalMessage);
    if (!sent.ok) return NextResponse.json({ error: "Falha ao enviar resposta no WhatsApp" }, { status: 502 });
    await saveTurn(company.id, phone, contactName, incomingMessage, finalMessage, handoff, history, structured, extraction.usage, getLeadContext({ outbound_message_id: sent.messageId || "", outbound_source: "ai" }));
    return NextResponse.json({ ok: true, transfer: true, handoff });
  }

  const extraQuestions = Array.isArray(effectiveSettings?.qualificationQuestions) ? effectiveSettings.qualificationQuestions.map(String).slice(0, 5) : [];
  const messages = [
    { role: "system", content: `${qualificationPrompt}\n\nORIGEM DO LEAD:\nOrigem: ${isAdLead ? "Meta Ads — lead frio de anúncio" : "WhatsApp — origem não confirmada como anúncio"}\n${adTitle ? `Referência do anúncio: ${adTitle}\n` : ""}${isAdLead ? `Na primeira resposta, reconheça que a pessoa veio pelo anúncio e descubra o que chamou sua atenção. Não repita essa pergunta se a motivação já estiver clara no histórico.` : "Não afirme que veio de anúncio sem confirmação."}\n\nSEGMENTO CONFIGURADO:\nTipo de negócio: ${business.label}\nServiço principal: ${business.serviceName}\nNome da atividade: ${business.shortLabel}\nPergunta de experiência: ${business.experienceQuestion}\nPergunta de motivação: ${business.motivationQuestion}\nFoco comercial: ${business.focus}\nAbertura padrão: "${String(company.settings?.assistantGreeting || `Oi, tudo bem? Que bom que você chamou. Eu vou te ajudar com as informações sobre ${business.serviceName}.`).slice(0, 300)}"\nUse exatamente esse contexto e nunca troque o segmento por Pilates quando a empresa não for um estúdio de Pilates.\n\nCONTATO:\nNome recebido no WhatsApp: ${contactName}\nPrimeiro nome seguro para uso: ${leadFirstName || "não disponível"}\n${leadFirstName ? `Você pode chamar a pessoa de ${leadFirstName} uma vez na abertura ou em um momento importante. Não repita o nome em toda resposta.` : "Não invente um nome e não chame a pessoa de Contato."}\n\nIDENTIDADE DA EMPRESA:\nVocê é a assistente de atendimento da empresa "${company.name}". Se perguntarem quem é você ou de onde fala, identifique-se exatamente como assistente de atendimento da ${company.name}. Nunca mencione outra empresa.\n\nBASE DE CONHECIMENTO AUTORIZADA (não invente nada além disso):\n${JSON.stringify(promptKnowledge(company.settings))}\nPromoção vazia significa que não existe promoção ativa. Nunca mencione condição vencida.\n\nPERGUNTAS EXTRAS AUTORIZADAS:\n${extraQuestions.length ? extraQuestions.map((question:string, index:number)=>`${index+1}. ${question}`).join("\n") : "Nenhuma"}\nUse no máximo uma pergunta extra quando ela for realmente relevante e sempre respeite o limite total de quatro perguntas. As perguntas essenciais de intenção e disponibilidade têm prioridade.` },
    { role: "system", content: `CATÁLOGO DE SERVIÇOS DA EMPRESA:\nDescrição cadastrada: ${catalog.raw}\nOpções reconhecidas: ${catalog.options.join(", ")}\n${catalog.options.length > 1 ? "A empresa oferece múltiplos serviços. Se a opção desejada ainda não estiver clara, faça primeiro uma triagem curta citando somente essas opções. Depois adapte experiência, motivação e próximo passo ao serviço escolhido. Não transfira apenas porque a pessoa não quer o serviço principal." : "Siga a qualificação do serviço principal."}` },
    ...history.flatMap((turn) => turn.status.startsWith("followup_")
      ? [{ role: "assistant", content: turn.ai_reply }]
      : [{ role: "user", content: turn.last_message }, { role: "assistant", content: turn.ai_reply }]),
    { role: "user", content: incomingMessage },
  ];

  const completion = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: aiSettings.model, messages }),
  });
  if (!completion.ok) return NextResponse.json({ error: "Falha ao gerar resposta" }, { status: 502 });
  const json = await completion.json();
  let rawReply = json.choices?.[0]?.message?.content || "Vou chamar alguém da nossa equipe para continuar com você.";
  const extraction=await extractQualification(history,incomingMessage,aiSettings.model);
  const structured=extraction.qualification;
  const usage=mergeUsage(aiSettings.model,readUsage(json,aiSettings.model),extraction.usage);
  const ready = Boolean(structured?.ready_to_schedule) || isReadyToSchedule(history, incomingMessage);
  if (questionsAsked === 0 && asksForServiceTriage(incomingMessage, catalog)) {
    const options = catalog.options.join(", ").replace(/, ([^,]*)$/, " ou $1");
    rawReply = `${isAdLead ? "Que bom que você veio pelo nosso anúncio 😊 " : "Que bom que você chamou 😊 "}Aqui na ${company.name} trabalhamos com ${options}. Para eu te orientar certinho, qual desses atendimentos você está buscando?`;
  } else if (priceAsked) {
    rawReply = priceInquiryReply(authorizedPrices, questionsAsked === 0 ? leadFirstName : "");
  } else if (questionsAsked === 0 && isAdLead) {
    rawReply = nextRequiredQuestion(0, incomingMessage, structured, business, true);
  }
  if (!priceAsked && questionsAsked === 3 && !ready && hasUncertainTiming(incomingMessage, structured)) {
    rawReply = nextRequiredQuestion(questionsAsked, incomingMessage, structured, business, isAdLead);
  }
  if (containsUnauthorizedPrice(rawReply, authorizedPrices)) {
    rawReply = priceInquiryReply(authorizedPrices, questionsAsked === 0 ? leadFirstName : "");
  }
  const requestedTransfer = rawReply.includes("[TRANSFERIR]");
  const requestedNurture = rawReply.includes("[NUTRIR]");
  if ((requestedTransfer && questionsAsked < 3) || requestedNurture || (requestedTransfer && !ready && questionsAsked < 4)) {
    rawReply = questionsAsked < 4
      ? nextRequiredQuestion(questionsAsked, incomingMessage, structured, business, isAdLead)
      : `${consultativeHandoffMessage()} [TRANSFERIR]`;
  }
  const newQuestions = rawReply.match(/\?/g)?.length || 0;
  if (questionsAsked + newQuestions > 4) rawReply = ready
    ? `${scheduleHandoffMessage()} [TRANSFERIR]`
    : `${consultativeHandoffMessage()} [TRANSFERIR]`;
  let handoff: HandoffMode = rawReply.includes("[TRANSFERIR]") && questionsAsked >= 3 ? (ready ? "schedule" : "consultative") : null;
  let reply = rawReply.replaceAll("[TRANSFERIR]", "").replaceAll("[NUTRIR]", "").replace(/\s+/g," ").trim();
  if ((reply.match(/\?/g)?.length || 0) > 1) reply = reply.slice(0, reply.indexOf("?") + 1);
  if (reply.length > 650) reply = `${reply.slice(0, 645).replace(/\s+\S*$/,"")}…`;
  if (isRepeatedReply(history, reply)) {
    if (questionsAsked >= 3) {
      handoff = ready ? "schedule" : "consultative";
      reply = ready
        ? "Ótimo, já deixei seu interesse e suas preferências organizados 😊 Vou chamar uma atendente para combinar com você a melhor opção de horário."
        : consultativeHandoffMessage();
    } else {
      reply = nextRequiredQuestion(questionsAsked, incomingMessage, structured, business, isAdLead);
    }
  }
  const sent = await sendWhatsApp(instanceName, phone, reply);
  if (!sent.ok) return NextResponse.json({ error: "Falha ao enviar resposta no WhatsApp" }, { status: 502 });
  await saveTurn(company.id, phone, contactName, incomingMessage, reply, handoff, history, structured, usage, getLeadContext({ outbound_message_id: sent.messageId || "", outbound_source: "ai" }));
  return NextResponse.json({ ok: true, transfer: handoff !== null, handoff });
}

export async function GET() {
  return NextResponse.json({ service: "PilatIA webhook", status: "online", memory: "enabled" });
}
