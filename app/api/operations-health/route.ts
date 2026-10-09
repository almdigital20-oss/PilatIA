import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "../../lib/tenant";
import { STAGING_MODE } from "../../lib/staging";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const now = Date.now();
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  if (STAGING_MODE || tenant.demo) return NextResponse.json({
    generatedAt: new Date(now).toISOString(),
    environment: "staging",
    overall: "attention",
    summary: "Integrações reais isoladas para validação segura",
    metrics: [
      { label: "Leads aguardando", value: "3", detail: "Precisam de atendimento humano", tone: "warning" },
      { label: "Follow-ups pendentes", value: "2", detail: "Dentro da fila planejada", tone: "neutral" },
      { label: "Lembretes programados", value: "4", detail: "Nenhum disparo real na homologação", tone: "good" },
      { label: "Falhas de entrega", value: "0", detail: "Nas últimas 24 horas", tone: "good" },
    ],
    services: [
      { id: "app", name: "Aplicação PilatIA", status: "operational", detail: "Painel e autenticação respondendo", checkedAt: at(0) },
      { id: "whatsapp", name: "WhatsApp / Evolution", status: "isolated", detail: "Instância de produção não vinculada", checkedAt: at(0) },
      { id: "webhook", name: "Webhook de mensagens", status: "isolated", detail: "Bloqueado intencionalmente na homologação", checkedAt: at(0) },
      { id: "ai", name: "Atendimento com IA", status: "isolated", detail: "Simulação local sem consumo de API", checkedAt: at(0) },
      { id: "database", name: "Banco de dados", status: "operational", detail: "Base fictícia e isolada carregada", checkedAt: at(0) },
    ],
    alerts: [
      { id: "waiting", severity: "warning", title: "3 leads aguardam atendimento", detail: "Revise as conversas assumidas pela equipe.", page: "Chat" },
      { id: "followups", severity: "info", title: "2 próximas ações planejadas", detail: "Confira datas e responsáveis no CRM.", page: "CRM" },
      { id: "isolation", severity: "info", title: "Integrações reais protegidas", detail: "A homologação não envia nem recebe mensagens de produção.", page: "Conexões" },
    ],
    activity: [
      { id: "a1", direction: "in", title: "Mensagem recebida", detail: "Mariana Lopes · demonstração", at: at(4) },
      { id: "a2", direction: "out", title: "Resposta da IA preparada", detail: "Carlos Eduardo · demonstração", at: at(9) },
      { id: "a3", direction: "system", title: "Lembrete programado", detail: "Ana Paula · amanhã às 09:00", at: at(18) },
      { id: "a4", direction: "system", title: "Atendimento assumido", detail: "Mariana Lopes · equipe humana", at: at(31) },
    ],
  });

  return NextResponse.json({ error: "Diagnóstico de produção ainda não habilitado." }, { status: 503 });
}
