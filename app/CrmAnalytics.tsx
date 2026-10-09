"use client";

import { useEffect, useMemo, useState } from "react";
import "./crm-analytics.css";

type Lead = {
  id: number; name: string; updatedAt: string; stage: string; appointmentAt?: string | null;
  appointmentStatus?: string | null; opportunityValue?: number; objection?: string;
  stoppedRespondingAt?: string | null; contactAt?: string | null; contactOnly?: boolean; student?: boolean;
};
export type AdSpendRecord = { id: string; start: string; end: string; amount: number; createdAt: string };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const scheduled = (lead: Lead) => Boolean(lead.appointmentAt) || ["agendamento", "compareceu", "negociacao", "fechado"].includes(lead.stage);
const attended = (lead: Lead) => lead.appointmentStatus === "attended" || ["compareceu", "negociacao", "fechado"].includes(lead.stage);
const isoDay = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
};
const labelDay = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

export default function CrmAnalytics({ periodLeads, allLeads, records, disabled, onSaveRecords }: {
  periodLeads: Lead[]; allLeads: Lead[]; records: AdSpendRecord[]; disabled?: boolean;
  onSaveRecords: (records: AdSpendRecord[]) => Promise<boolean>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const [start, setStart] = useState(sevenDaysAgo);
  const [end, setEnd] = useState(today);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (end < start) setEnd(start); }, [start, end]);

  const stats = useMemo(() => {
    const bookings = periodLeads.filter(scheduled).length;
    const presences = periodLeads.filter(attended).length;
    const sales = periodLeads.filter((lead) => lead.stage === "fechado").length;
    const revenue = periodLeads.filter((lead) => lead.stage === "fechado").reduce((sum, lead) => sum + Math.max(0, Number(lead.opportunityValue) || 0), 0);
    return { leads: periodLeads.length, bookings, presences, sales, revenue };
  }, [periodLeads]);

  const daily = useMemo(() => {
    const map = new Map<string, { leads: Lead[]; bookings: number; presences: number; sales: number; value: number }>();
    periodLeads.forEach((lead) => {
      const key = isoDay(lead.contactAt || lead.updatedAt);
      if (!key) return;
      const row = map.get(key) || { leads: [], bookings: 0, presences: 0, sales: 0, value: 0 };
      row.leads.push(lead);
      if (scheduled(lead)) row.bookings++;
      if (attended(lead)) row.presences++;
      if (lead.stage === "fechado") { row.sales++; row.value += Math.max(0, Number(lead.opportunityValue) || 0); }
      map.set(key, row);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [periodLeads]);

  const objections = useMemo(() => {
    const map = new Map<string, number>();
    periodLeads.forEach((lead) => {
      const value = (lead.objection || (lead.stoppedRespondingAt ? "Parou de responder" : "")).trim();
      if (value) map.set(value, (map.get(value) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [periodLeads]);

  const annual = useMemo(() => {
    const year = new Date().getFullYear();
    const rows = Array.from({ length: 12 }, (_, month) => ({ month, leads: 0, bookings: 0, presences: 0, sales: 0, revenue: 0 }));
    allLeads.filter((lead) => !lead.contactOnly && !lead.student).forEach((lead) => {
      const date = new Date(lead.contactAt || lead.updatedAt);
      if (date.getFullYear() !== year) return;
      const row = rows[date.getMonth()];
      row.leads++;
      if (scheduled(lead)) row.bookings++;
      if (attended(lead)) row.presences++;
      if (lead.stage === "fechado") { row.sales++; row.revenue += Math.max(0, Number(lead.opportunityValue) || 0); }
    });
    return rows;
  }, [allLeads]);

  const periodDates = periodLeads.map((lead) => isoDay(lead.contactAt || lead.updatedAt)).filter(Boolean).sort();
  const periodStart = periodDates[0] || start;
  const periodEnd = periodDates.at(-1) || end;
  const spend = records.filter((record) => record.start <= periodEnd && record.end >= periodStart).reduce((sum, record) => sum + record.amount, 0);
  const roi = spend ? ((stats.revenue - spend) / spend) * 100 : 0;
  const maxDaily = Math.max(1, ...daily.map(([, row]) => row.leads.length));
  const maxObjection = Math.max(1, ...objections.map(([, count]) => count));
  const maxAnnual = Math.max(1, ...annual.map((row) => row.leads));

  const addSpend = async () => {
    const numeric = Number(amount.replace(",", "."));
    if (!numeric || numeric <= 0 || !start || !end) return;
    setBusy(true);
    const next = [...records, { id: crypto.randomUUID(), start, end, amount: numeric, createdAt: new Date().toISOString() }];
    if (await onSaveRecords(next)) setAmount("");
    setBusy(false);
  };
  const removeSpend = async (id: string) => {
    setBusy(true); await onSaveRecords(records.filter((record) => record.id !== id)); setBusy(false);
  };

  const rate = (value: number, base: number) => base ? Math.round(value / base * 100) : 0;
  return <section className="crm-analytics">
    <header className="crm-analytics-heading"><div><span>DESEMPENHO DO CRM</span><h2>Resumo comercial do período</h2><p>Indicadores calculados com os contatos exibidos no filtro acima.</p></div><b>{stats.leads} leads analisados</b></header>
    <div className="crm-kpis">
      <article><small>Leads</small><strong>{stats.leads}</strong><em>no período</em></article>
      <article><small>Taxa de agendamento</small><strong>{rate(stats.bookings, stats.leads)}%</strong><em>{stats.bookings} agendados</em></article>
      <article><small>Taxa de presença</small><strong>{rate(stats.presences, stats.bookings)}%</strong><em>{stats.presences} presenças</em></article>
      <article><small>Conversão</small><strong>{rate(stats.sales, stats.leads)}%</strong><em>{stats.sales} fechados</em></article>
      <article className="revenue"><small>Valor gerado</small><strong>{currency.format(stats.revenue)}</strong><em>vendas registradas</em></article>
    </div>

    <div className="crm-analytics-row">
      <article className="analytics-card daily-chart"><header><span>LEADS POR DIA</span><h3>Entrada e agendamentos</h3></header>
        <div className="chart-legend"><i />Leads <i />Agendados</div>
        <div className="daily-bars">{daily.length ? daily.slice(-31).map(([day, row]) => <div key={day}><div><i style={{ height: `${Math.max(5, row.leads.length / maxDaily * 100)}%` }} /><i style={{ height: `${Math.max(row.bookings ? 5 : 0, row.bookings / maxDaily * 100)}%` }} /></div><b>{row.leads.length}</b><small>{labelDay(day)}</small></div>) : <p>Os dados aparecerão conforme os leads entrarem.</p>}</div>
      </article>
      <article className="analytics-card objection-chart"><header><span>PRINCIPAIS OBJEÇÕES</span><h3>Motivos que travam a decisão</h3></header>
        <div>{objections.length ? objections.map(([name, count]) => <div key={name}><span><b>{name}</b><em>{count} lead(s)</em></span><i><u style={{ width: `${count / maxObjection * 100}%` }} /></i></div>) : <p>Nenhuma objeção registrada neste período.</p>}</div>
      </article>
    </div>

    <article className="analytics-card crm-daily-summary"><header><span>ACOMPANHAMENTO GERAL DOS LEADS</span><h3>Resumo por dia de contato</h3></header>
      <div className="crm-summary-table"><header><span>Data</span><span>Leads</span><span>Agendados</span><span>Presenças</span><span>Fechados</span><span>Valor</span></header>
        {[...daily].reverse().slice(0, 31).map(([day, row]) => <div key={day}><time>{labelDay(day)}</time><span title={row.leads.map((lead) => lead.name).join(", ")}><b>{row.leads.length}</b> {row.leads.slice(0, 3).map((lead) => lead.name).join(", ")}{row.leads.length > 3 ? "…" : ""}</span><strong>{row.bookings}</strong><strong>{row.presences}</strong><strong>{row.sales}</strong><em>{currency.format(row.value)}</em></div>)}
        {!daily.length && <p>Nenhum lead no período selecionado.</p>}
      </div>
    </article>

    <article className="analytics-card ad-performance"><header><span>INVESTIMENTO EM ANÚNCIOS</span><h3>Custos e retorno comercial</h3><p>Cadastre o valor real investido. Os cálculos usam os resultados registrados no CRM.</p></header>
      <div className="ad-entry"><label>De<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Até<input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label><label>Valor investido (R$)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Ex.: 500,00" /></label><button onClick={addSpend} disabled={busy || disabled}>{busy ? "Salvando…" : "Registrar investimento"}</button></div>
      <div className="ad-kpis"><span><small>Investimento considerado</small><strong>{currency.format(spend)}</strong></span><span><small>Custo por lead</small><strong>{stats.leads ? currency.format(spend / stats.leads) : "—"}</strong></span><span><small>Custo por agendamento</small><strong>{stats.bookings ? currency.format(spend / stats.bookings) : "—"}</strong></span><span><small>Custo por venda</small><strong>{stats.sales ? currency.format(spend / stats.sales) : "—"}</strong></span><span><small>ROI</small><strong className={roi >= 0 ? "positive" : "negative"}>{spend ? `${roi.toFixed(0)}%` : "—"}</strong></span></div>
      {records.length > 0 && <div className="ad-records">{records.slice(-5).reverse().map((record) => <span key={record.id}><b>{new Date(`${record.start}T12:00:00`).toLocaleDateString("pt-BR")} a {new Date(`${record.end}T12:00:00`).toLocaleDateString("pt-BR")}</b><em>{currency.format(record.amount)}</em><button onClick={() => removeSpend(record.id)} disabled={busy || disabled} aria-label="Excluir investimento">×</button></span>)}</div>}
    </article>

    <article className="analytics-card annual-monitor"><header><span>ACOMPANHAMENTO ANUAL</span><h3>Evolução mês a mês · {new Date().getFullYear()}</h3></header>
      <div className="annual-bars">{annual.map((row) => <div key={row.month}><div><i style={{ height: `${Math.max(row.leads ? 4 : 0, row.leads / maxAnnual * 100)}%` }} /><i style={{ height: `${Math.max(row.sales ? 4 : 0, row.sales / maxAnnual * 100)}%` }} /></div><strong>{row.leads}<small> leads</small></strong><b>{new Date(2020, row.month).toLocaleDateString("pt-BR", { month: "short" })}</b><em>{currency.format(row.revenue)}</em></div>)}</div>
      <div className="annual-totals"><span>Leads <b>{annual.reduce((sum, row) => sum + row.leads, 0)}</b></span><span>Agendamentos <b>{annual.reduce((sum, row) => sum + row.bookings, 0)}</b></span><span>Presenças <b>{annual.reduce((sum, row) => sum + row.presences, 0)}</b></span><span>Conversões <b>{annual.reduce((sum, row) => sum + row.sales, 0)}</b></span><span>Valor gerado <b>{currency.format(annual.reduce((sum, row) => sum + row.revenue, 0))}</b></span></div>
    </article>
  </section>;
}
