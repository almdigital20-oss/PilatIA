"use client";

import { useCallback, useEffect, useState } from "react";
import "./operations-health.css";

type HealthPayload = {
  generatedAt: string;
  environment: "staging" | "production";
  overall: "healthy" | "attention" | "critical";
  summary: string;
  metrics: Array<{ label: string; value: string; detail: string; tone: "good" | "warning" | "neutral" }>;
  services: Array<{ id: string; name: string; status: "operational" | "isolated" | "attention"; detail: string; checkedAt: string }>;
  alerts: Array<{ id: string; severity: "warning" | "info"; title: string; detail: string; page?: string }>;
  activity: Array<{ id: string; direction: "in" | "out" | "system"; title: string; detail: string; at: string }>;
};

const statusLabel = { operational: "Operacional", isolated: "Isolado", attention: "Atenção" } as const;

export default function OperationsHealth({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/operations-health", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o diagnóstico.");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o diagnóstico.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return <section className="health-center">
    <section className="health-hero">
      <div><span>SAÚDE DA OPERAÇÃO</span><h2>Visão técnica em um só lugar</h2><p>Acompanhe integrações, filas e situações que precisam de atenção sem executar ações automáticas.</p></div>
      <div className={`health-overall ${data?.overall || "attention"}`}><i>{data?.overall === "healthy" ? "✓" : "!"}</i><span><strong>{data?.overall === "healthy" ? "Operação saudável" : "Ambiente controlado"}</strong><small>{data?.summary || "Carregando diagnóstico…"}</small></span></div>
    </section>

    <div className="health-toolbar"><span>{data ? `Atualizado em ${new Date(data.generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "Consultando serviços…"}</span><button onClick={refresh} disabled={busy}>{busy ? "Atualizando…" : "↻ Atualizar diagnóstico"}</button></div>
    {error && <div className="health-error"><strong>Diagnóstico indisponível</strong><span>{error}</span><button onClick={refresh}>Tentar novamente</button></div>}

    {data && <>
      <section className="health-metrics">{data.metrics.map((metric) => <article key={metric.label} className={metric.tone}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></article>)}</section>

      <section className="health-layout">
        <article className="health-panel services"><header><div><span>INTEGRAÇÕES</span><h3>Estado dos serviços</h3></div><b>{data.services.filter((item) => item.status === "operational").length}/{data.services.length} operacionais</b></header>
          <div>{data.services.map((service) => <section key={service.id}><i className={service.status} /><span><strong>{service.name}</strong><small>{service.detail}</small></span><em className={service.status}>{statusLabel[service.status]}</em></section>)}</div>
        </article>

        <article className="health-panel alerts"><header><div><span>PRIORIDADES</span><h3>Precisam de atenção</h3></div><b>{data.alerts.length}</b></header>
          <div>{data.alerts.map((alert) => <section key={alert.id}><i className={alert.severity}>{alert.severity === "warning" ? "!" : "i"}</i><span><strong>{alert.title}</strong><small>{alert.detail}</small></span>{alert.page && <button onClick={() => onNavigate(alert.page!)}>Abrir</button>}</section>)}</div>
        </article>
      </section>

      <section className="health-layout lower">
        <article className="health-panel activity"><header><div><span>ATIVIDADE RECENTE</span><h3>Mensagens e automações</h3></div></header>
          <div>{data.activity.map((item) => <section key={item.id}><i className={item.direction}>{item.direction === "in" ? "↓" : item.direction === "out" ? "↑" : "•"}</i><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{new Date(item.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></section>)}</div>
        </article>
        <article className="health-panel safe-actions"><header><div><span>AÇÕES SEGURAS</span><h3>Investigar sem disparar</h3></div></header><p>Estes atalhos apenas abrem as áreas de gestão. Nenhuma mensagem é enviada automaticamente.</p><div><button onClick={() => onNavigate("Conexões")}>Ver conexões</button><button onClick={() => onNavigate("Chat")}>Abrir Chat</button><button onClick={() => onNavigate("CRM")}>Ver CRM</button><button disabled title="Disponível somente com número de teste homologado">Teste de envio bloqueado</button></div></article>
      </section>
      {data.environment === "staging" && <div className="health-staging-note"><strong>Homologação protegida</strong><span>Os estados acima são dados controlados para validar a interface. WhatsApp, banco e disparos de produção continuam isolados.</span></div>}
    </>}
  </section>;
}
