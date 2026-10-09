import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the PilatIA application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>PilatIA — Pré-atendimento inteligente<\/title>/i);
  assert.match(html, /Preparando seu ambiente/);
  assert.match(html, /class="brandmark">P</);
});

test("keeps multi-unit authorization, CRM values and follow-ups durable", async () => {
  const [page, admin, leadsApi, units, connectionsApi, qrcodeRoute, followupApi, followupRunner, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/whatsapp-units.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/connections/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/qrcode/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/followup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/followups/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /connectionLimit/);
  assert.match(admin, /WhatsApps \/ unidades/);
  assert.match(units, /whatsappConnectionLimit/);
  assert.match(qrcodeRoute, /const ready = await ensureEvolutionInstance\(instance\)/);
  assert.ok(
    qrcodeRoute.indexOf("const ready = await ensureEvolutionInstance(instance)") <
      qrcodeRoute.indexOf("const qr = await getEvolutionQrCode(instance)"),
    "a instancia deve ser garantida antes da solicitacao do QR Code",
  );
  assert.match(connectionsApi, /Unidade não autorizada/);
  assert.match(page, /openCrmEditor/);
  assert.match(page, /Valor cadastrado no CRM/);
  assert.doesNotMatch(page, /\.length \* 350/);
  assert.match(leadsApi, /crm_value/);
  assert.match(leadsApi, /crm_stopped_at/);
  assert.match(leadsApi, /crm_next_action_at/);
  assert.match(page, /Programar follow-up automático/);
  assert.match(followupApi, /attempts.*Math\.max\(1, Math\.min\(3/);
  assert.match(followupApi, /three_days/);
  assert.match(followupRunner, /crm_followup_plan/);
  assert.match(worker, /api\/followups/);
});

test("separates existing students from new leads and pauses commercial automation", async () => {
  const [page, classifyApi, leadsApi, webhook, followupRunner, broadcasts] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/contacts/classify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/followups/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/broadcasts/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Marcar como aluno/);
  assert.match(page, /contactView/);
  assert.match(classifyApi, /contact_type: "student"/);
  assert.match(classifyApi, /ai_paused: true/);
  assert.match(leadsApi, /student/);
  assert.match(webhook, /identifiesExistingStudent/);
  assert.match(webhook, /saveStudentInbound/);
  assert.match(followupRunner, /contact_type === "student"/);
  assert.match(broadcasts, /contact_type === "student"/);
});

test("lets the platform administrator manage global YouTube tutorials", async () => {
  const [page, admin, adminApi, tutorialsApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform-admin/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tutorials/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /Salvar e atualizar para todos/);
  assert.match(admin, /Link do YouTube/);
  assert.match(adminApi, /tutorials_save/);
  assert.match(adminApi, /youtu\\\.be/);
  assert.match(tutorialsApi, /settings\?\.tutorials/);
  assert.match(page, /api\/tutorials/);
  assert.match(tutorialsApi, /getStorageMode/);
  assert.match(tutorialsApi, /pilatia_platform_tutorials/);
});

test("publishes expiring global announcements through the notification bell", async () => {
  const [page, admin, adminApi, contentApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AdminPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform-admin/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tutorials/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /Comunicados para todos os usuários/);
  assert.match(adminApi, /announcements_save/);
  assert.match(page, /notification-bell/);
  assert.match(page, /pilatia_read_announcements/);
  assert.match(contentApi, /activeAnnouncements/);
});

test("triages every configured service before qualifying or handing off", async () => {
  const [webhook, simulator, leads] = await Promise.all([
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai-simulator/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(webhook, /TRIAGEM DE SERVIÇO/);
  assert.match(webhook, /serviceCatalog/);
  assert.match(webhook, /asksForServiceTriage/);
  assert.match(webhook, /Não transfira apenas porque/);
  assert.match(webhook, /service_interest/);
  assert.match(simulator, /CATÁLOGO DE SERVIÇOS/);
  assert.match(leads, /serviceInterest/);
});

test("pauses AI temporarily without disconnecting WhatsApp", async () => {
  const [page, pauseApi, webhook, followups] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai-pause/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/followups/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Até eu reativar/);
  assert.match(page, /Programar pausa/);
  assert.match(pauseApi, /pause_indefinite/);
  assert.match(pauseApi, /pause_hours/);
  assert.match(webhook, /global_ai_pause/);
  assert.match(webhook, /saveInboundDuringGlobalPause/);
  assert.match(followups, /globalAiPaused/);
});

test("tracks real lead origin without guessing", async () => {
  const [page, webhook, leads] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /RASTREAMENTO DE ORIGEM/);
  assert.match(page, /PILATIA_GOOGLE/);
  assert.match(webhook, /Instagram Ads/);
  assert.match(webhook, /Facebook Ads/);
  assert.match(webhook, /Google/);
  assert.match(webhook, /lead_source_method/);
  assert.match(leads, /lead_source/);
});

test("offers kanban and detailed list CRM views with editable attribution and objections", async () => {
  const [page, leadsApi, webhook] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Kanban/);
  assert.match(page, /☷ Lista/);
  assert.match(page, /Todo o histórico/);
  assert.match(page, /crm-origin-options/);
  assert.match(page, /Objeção identificada/);
  assert.match(leadsApi, /crm_objection/);
  assert.match(leadsApi, /crm_converted_at/);
  assert.match(webhook, /nunca invente uma objeção/);
});

test("exposes CRM recovery, appointment reminders and scheduled next actions", async () => {
  const [page, followups, appointments] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/followups/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /sempre editável pelo atendente/);
  assert.match(page, /Recuperar agora/);
  assert.match(page, /Lembrar agora/);
  assert.match(page, /Programar próxima ação/);
  assert.match(page, /crm-next-action/);
  assert.match(followups, /crm_stopped_at/);
  assert.match(appointments, /action === "remind"/);
});

test("confirms WhatsApp delivery and keeps scheduling available on CRM-only plans", async () => {
  const [page, appointments, reminders, pulse, worker, vite] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reminders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reminders/pulse/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(appointments, /payload\?\.key\?\.id/);
  assert.match(appointments, /tenantHasModule\(tenant, "agenda"\) \|\| tenantHasModule\(tenant, "crm"\)/);
  assert.ok(appointments.indexOf("const delivery = await send") < appointments.indexOf("const updatedSummary ="));
  assert.match(appointments, /appointment_confirmation_message_id/);
  assert.match(appointments, /delivered: true/);
  assert.match(reminders, /enabledModules\.includes\("agenda"\) \|\| enabledModules\.includes\("crm"\)/);
  assert.match(reminders, /summary\.whatsapp_instance/);
  assert.match(pulse, /runReminders\(tenant\.companyId\)/);
  assert.match(page, /api\/reminders\/pulse/);
  assert.match(page, /label === "Agenda" && allowedModules\?\.includes\("crm"\)/);
  assert.match(worker, /api\/reminders/);
  assert.match(vite, /crons: \["\* \* \* \* \*"\]/);
});

test("opens CRM records by clicking the lead name in kanban and list views", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /crm-name-link/);
  assert.match(page, /Abrir cadastro de/);
  assert.ok((page.match(/className="crm-name-link"/g) || []).length >= 2);
});

test("filters broadcasts by date and CRM stage and restores the active page", async () => {
  const [page, broadcasts] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/broadcasts/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /FILTROS DO PÚBLICO/);
  assert.match(page, /7 dias/);
  assert.match(page, /14 dias/);
  assert.match(page, /Personalizado/);
  assert.match(page, /Etapa do CRM/);
  assert.match(page, /pilatia_active_page/);
  assert.match(broadcasts, /stageFilter/);
  assert.match(broadcasts, /fromTime/);
  assert.match(broadcasts, /toTime/);
});

test("builds an automatic CRM contact-attempt timeline from real conversation records", async () => {
  const [page, leadsApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /HISTÓRICO DE CONTATOS/);
  assert.match(page, /Tentativas e retomadas/);
  assert.match(page, /Pela IA/);
  assert.match(page, /Pelo atendente/);
  assert.match(leadsApi, /historyByPhone/);
  assert.match(leadsApi, /Recuperação automática da IA/);
  assert.match(leadsApi, /Contato realizado pelo atendente/);
  assert.match(leadsApi, /Primeiro contato recebido/);
});

test("adds CRM analytics and persistent ad investment records", async () => {
  const [analytics, profileApi] = await Promise.all([
    readFile(new URL("../app/CrmAnalytics.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/company-profile/route.ts", import.meta.url), "utf8"),
  ]);
  for (const text of ["DESEMPENHO DO CRM", "Taxa de agendamento", "Taxa de presença", "PRINCIPAIS OBJEÇÕES", "INVESTIMENTO EM ANÚNCIOS", "Custo por lead", "Custo por venda", "ROI", "ACOMPANHAMENTO ANUAL"]) {
    assert.match(analytics, new RegExp(text, "i"));
  }
  assert.match(analytics, /periodLeads/);
  assert.match(analytics, /opportunityValue/);
  assert.match(profileApi, /adSpendRecords/);
});

test("imports the complete WhatsApp contact base and keeps the open chat synchronized", async () => {
  const [page, contacts, leads] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/contacts/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(contacts, /findContacts/);
  assert.match(contacts, /findChats/);
  assert.match(contacts, /item\.remoteJid \|\| item\.remoteJidAlt/);
  assert.match(contacts, /index \+= 200/);
  assert.doesNotMatch(contacts, /slice\(0, 500\)/);
  assert.match(leads, /offset < 10_000/);
  assert.match(page, /loadOpenChat/);
  assert.match(page, /setInterval\(\(\) => \{ if \(document\.visibilityState === "visible"\) loadOpenChat\(\); \}, 5000\)/);
  assert.match(page, /Limitação do WhatsApp/);
});

test("triages imported contacts before starting commercial qualification", async () => {
  const webhook = await readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8");
  assert.match(webhook, /identifiesImportedLeadIntent/);
  assert.match(webhook, /saveImportedContactTriage/);
  assert.match(webhook, /imported_contact_triage_pending/);
  assert.match(webhook, /Você já é aluno\(a\) ou paciente/);
  assert.match(webhook, /contact_type = "lead"/);
  assert.match(webhook, /contact_type: "student"/);
  assert.match(webhook, /contact_only: false/);
  assert.match(webhook, /nao sou\|ainda nao sou\|nunca fui/);
});

test("renews an expired customer session for contact import and live chat", async () => {
  const [page, session, authMe] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/session.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/me/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /sessionRefreshRef/);
  assert.match(page, /response\.status === 401 && await refreshAccount\(false\)/);
  assert.match(page, /response\?\.status === 401 && retrySession && await refreshAccount\(false\)/);
  assert.match(page, /return loadOpenChat\(false\)/);
  assert.match(session, /grant_type=refresh_token/);
  assert.match(authMe, /setSessionCookies/);
});

test("preserves customer data on temporary database failures and isolates account switches", async () => {
  const [page, leadsApi, chatApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /loadedCompanyRef/);
  assert.match(page, /loadedCompanyRef\.current === companyId/);
  assert.match(leadsApi, /Os dados permanecem salvos/);
  assert.doesNotMatch(leadsApi, /if \(!baseUrl \|\| !key\) return NextResponse\.json\(\[\]\)/);
  assert.match(chatApi, /O histórico permanece salvo/);
  assert.match(chatApi, /status: 502/);
});

test("adds one tenant-scoped operational user without exposing company settings", async () => {
  const [page, panel, teamApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TeamAccessPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/team-members/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(teamApi, /MAX_COMPANY_MEMBERS = 2/);
  assert.match(teamApi, /tenant\.role !== "admin"/);
  assert.match(teamApi, /company_id: access\.tenant\.companyId/);
  assert.match(teamApi, /role: "agent"/);
  assert.match(teamApi, /method: "DELETE"/);
  assert.match(panel, /\/api\/team-members/);
  assert.match(panel, /Os dados da empresa e as conversas/);
  assert.match(page, /sensitiveCompanyPages/);
  assert.match(page, /account\.role === "agent"/);
  assert.match(page, /<TeamAccessPanel notify=\{notify\}/);
});

test("keeps AI learning fields on screen until Supabase confirms the save", async () => {
  const [page, onboarding, profileApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AiOnboarding.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/company-profile/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\}, \[account\?\.company\.id\]\);/);
  assert.match(page, /return false/);
  assert.match(page, /return true/);
  assert.match(onboarding, /onSave: \(\) => Promise<boolean>/);
  assert.match(onboarding, /if \(saved\) \{[^}]*onClose\(\)/);
  assert.match(onboarding, /if \(saved\) \{[^}]*onTest\(\)/);
  assert.match(profileApi, /Prefer: "return=representation"/);
  assert.match(profileApi, /const confirmed =/);
  assert.match(profileApi, /Nenhuma informação foi alterada/);
  assert.match(onboarding, /window\.setTimeout\(async \(\) =>/);
  assert.match(onboarding, /pilatia_ai_draft_/);
  assert.match(onboarding, /window\.localStorage\.setItem/);
  assert.match(onboarding, /lastSaved\.current = fingerprint/);
});

test("simulates the freshly saved company profile without inventing prices", async () => {
  const [simulator, onboarding] = await Promise.all([
    readFile(new URL("../app/api/ai-simulator/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/AiOnboarding.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(simulator, /select=settings&limit=1/);
  assert.match(simulator, /authorizedPriceKnowledge/);
  assert.match(simulator, /containsUnauthorizedPrice/);
  assert.match(simulator, /NENHUM PREÇO CADASTRADO/);
  assert.match(simulator, /replace\(\/\\\*\\\*\(\[\^\*\]\+\)\\\*\\\*\/g, "\*\$1\*"\)/);
  assert.match(simulator, /Para não te passar um valor incorreto/);
  assert.match(onboarding, /renderWhatsAppText\(message\.content\)/);
});

test("keeps the AI setup readable, scrollable and its actions visible", async () => {
  const css = await readFile(new URL("../app/ai-onboarding.css", import.meta.url), "utf8");
  assert.match(css, /height:min\(820px,calc\(100vh - 36px\)\)/);
  assert.match(css, /\.onboarding-fields\{min-height:0/);
  assert.match(css, /scrollbar-gutter:stable/);
  assert.match(css, /article>footer\{position:relative;z-index:4;flex:0 0 auto/);
  assert.match(css, /\.onboarding-fields input,.onboarding-fields textarea\{font-size:15px/);
  assert.match(css, /@media\(max-width:900px\)/);
});

test("opens chat conversations at the latest message without interrupting history reading", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /messagesViewportRef/);
  assert.match(page, /viewport\.scrollTop = viewport\.scrollHeight/);
  assert.match(page, /lastOpenedConversationRef\.current !== selectedLead\.phone/);
  assert.match(page, /distanceFromLatest < 120/);
  assert.match(page, /ref=\{messagesViewportRef\} onScroll=\{trackMessagesScroll\}/);
});

test("lets a company administrator disconnect WhatsApp without deleting PilatIA data", async () => {
  const [page, connectionsApi, evolution] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/connections/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/evolution.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /disconnectConnectionUnit/);
  assert.match(page, /Os contatos, conversas e configurações continuarão salvos/);
  assert.match(page, /"Desconectar"/);
  assert.match(connectionsApi, /export async function DELETE/);
  assert.match(connectionsApi, /tenant\.role !== "admin"/);
  assert.match(connectionsApi, /whatsappUnitsForTenant\(tenant\)/);
  assert.match(evolution, /\/instance\/logout\/\$\{encoded\}/);
  assert.match(evolution, /attempt < 5/);
  assert.match(evolution, /attempt === 1/);
  assert.match(evolution, /state !== "open" && state !== "connected"/);
});

test("keeps CRM and optional human chat receiving WhatsApp contacts when AI is not in the plan", async () => {
  const webhook = await readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8");
  assert.match(webhook, /saveInboundWithoutAi/);
  assert.match(webhook, /enabledModules\.includes\("crm"\) \|\| enabledModules\.includes\("chat"\)/);
  assert.match(webhook, /crm_stage: previousSummary\.crm_stage \|\| "novo"/);
  assert.match(webhook, /ai_disabled_by_plan: true/);
  assert.match(webhook, /status: "human_active"/);
  assert.match(webhook, /saved: passiveIntakeEnabled/);
  assert.ok(
    webhook.indexOf("const rawHistory = await getHistory") < webhook.indexOf("if (!aiEnabled)"),
    "o contato deve ser contextualizado antes de bloquear apenas a resposta da IA",
  );
});

test("prevents duplicated recovery messages and stops automation after human or lead closure", async () => {
  const [followups, webhook, chat, leads, page] = await Promise.all([
    readFile(new URL("../app/api/followups/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(followups, /claimFollowup/);
  assert.match(followups, /updated_at=eq\./);
  assert.match(followups, /Prefer: "return=representation"/);
  assert.match(followups, /followup_claim_until/);
  assert.match(followups, /automation_state === "snoozed_by_lead"/);
  assert.match(webhook, /saveHumanOutbound/);
  assert.match(webhook, /ignored: "system_outbound_echo"/);
  assert.match(webhook, /cancelledAutomationSummary\(previous, initiatedByCompany \? "human_outreach" : "human_replied"\)/);
  assert.match(webhook, /identifiesDeferredIntent/);
  assert.match(webhook, /status: "nurture_paused"/);
  assert.match(webhook, /automation_state: "snoozed_by_lead"/);
  assert.match(webhook, /vou faltar/);
  assert.match(chat, /automation_state: initiatedByCompany \? "human_outreach" : "human_replied"/);
  assert.match(leads, /automationState/);
  assert.match(page, /crm-automation-status/);
});

test("never uses the connected company name as the WhatsApp lead name", async () => {
  const [contactsImport, webhook, leads] = await Promise.all([
    readFile(new URL("../app/api/contacts/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(contactsImport, /usableName\(candidate, companyName\)/);
  assert.match(contactsImport, /normalizeContact\(item, "address_book", tenant\.companyName\)/);
  assert.match(contactsImport, /correctable/);
  assert.match(contactsImport, /contact_name: item\.name/);
  assert.match(contactsImport, /corrected \+= results\.filter/);
  assert.match(webhook, /reliableContactName/);
  assert.match(webhook, /reliableContactName\(incomingContactName, company\.name[^\n]+!fromMe/);
  assert.match(webhook, /reliableContactName\("", company\.name[^\n]+false\)/);
  assert.match(webhook, /isCompanyIdentity/);
  assert.match(contactsImport, /distinctiveTokens/);
  assert.match(leads, /isCompanyIdentity\(storedName, tenant\.companyName\)/);
});

test("keeps the primary company creator as administrator and never caches stale permissions", async () => {
  const [tenant, accountMe, register] = await Promise.all([
    readFile(new URL("../app/lib/tenant.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/me/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(register, /pilatia_role: "admin"/);
  assert.match(register, /role: "admin"/);
  assert.match(tenant, /primaryCompanyAdmin/);
  assert.match(tenant, /const resolvedRole = primaryCompanyAdmin \? "admin" : membershipRole/);
  assert.match(accountMe, /no-store, no-cache, must-revalidate, private/);
});

test("registers company-initiated WhatsApp conversations as active outreach", async () => {
  const [webhook, chat, leads] = await Promise.all([
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leads/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(webhook, /initiatedByCompany/);
  assert.match(webhook, /outbound_initiated_by_company: true/);
  assert.match(webhook, /lead_source: previousSummary\.lead_source \|\| \(initiatedByCompany \? "Prospecção ativa"/);
  assert.match(webhook, /status: "human_active"/);
  assert.match(chat, /automation_state: initiatedByCompany \? "human_outreach"/);
  assert.match(chat, /lead_source_method: current\?\.summary\?\.lead_source_method \|\| \(initiatedByCompany \? "company_outbound"/);
  assert.match(leads, /Prospecção iniciada pelo atendente/);
});

test("keeps the homologation environment visibly isolated from production", async () => {
  const [page, webhook, staging, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evolution/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/staging.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/staging.css", import.meta.url), "utf8"),
  ]);
  assert.match(staging, /STAGING_MODE = true/);
  assert.match(page, /HOMOLOGAÇÃO/);
  assert.match(page, /WhatsApp, disparos e banco de produção isolados/);
  assert.match(webhook, /Webhook desativado no ambiente de homologação/);
  assert.match(css, /\.staging-ribbon/);
});

test("adds a read-only operations health center to homologation", async () => {
  const [page, health, route, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OperationsHealth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations-health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-health.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(page, /\["Saúde", "◉"\]/);
  assert.match(page, /Abrir saúde da operação/);
  assert.match(page, /active === "Configurações" && healthOpen && <OperationsHealth/);
  assert.match(health, /Atualizar diagnóstico/);
  assert.match(health, /Nenhuma mensagem é enviada automaticamente/);
  assert.match(health, /Teste de envio bloqueado/);
  assert.match(route, /STAGING_MODE \|\| tenant\.demo/);
  assert.match(route, /Webhook de mensagens/);
  assert.doesNotMatch(route, /sendText|sendMessage|\/message\/sendText/);
  assert.match(css, /\.health-center/);
});
