"use client";

import { useEffect, useMemo, useState } from "react";
import "./admin.css";
import "./admin-modules.css";
import "./admin-company-tools.css";
import "./admin-tutorials.css";

type Plan = { id: string; name: string; price: number; interval: "monthly" | "yearly"; active: boolean; maxUsers: number; maxMessages: number; features: string[]; modules: string[] };
type Client = { id: string; name: string; email: string; userId: string; active: boolean; status: string; planId: string; planName: string; monthlyValue: number; createdAt: string | null; lastSignInAt: string | null; businessType: string; whatsappConnected: boolean; connectionLimit: number };
type Tutorial = { id: string; title: string; description: string; videoId: string };
type Announcement = { id: string; title: string; message: string; expiresAt: string; createdAt: string };
type AdminData = { clients: Client[]; plans: Plan[]; tutorials: Tutorial[]; announcements: Announcement[]; metrics: { totalClients: number; activeClients: number; inactiveClients: number; monthlyRevenue: number; averageTicket: number } };

const emptyData: AdminData = { clients: [], plans: [], tutorials: [], announcements: [], metrics: { totalClients: 0, activeClients: 0, inactiveClients: 0, monthlyRevenue: 0, averageTicket: 0 } };
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const statusLabels: Record<string, string> = { trial: "Em teste", active: "Ativo", past_due: "Pagamento pendente", cancelled: "Cancelado" };
const moduleOptions = [["chat", "Chat"], ["ai", "Agente de IA"], ["crm", "CRM"], ["agenda", "Agenda"], ["broadcasts", "Disparos"], ["contacts", "Contatos"]];

export default function AdminPanel({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<AdminData>(emptyData);
  const [tab, setTab] = useState<"overview" | "clients" | "plans" | "tutorials" | "announcements">("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    const response = await fetch("/api/platform-admin", { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setData(payload); else notify(payload.error || "Não foi possível carregar a administração");
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const update = async (body: Record<string, unknown>, success: string) => {
    setBusy(String(body.companyId || body.planId || body.userId || body.action));
    const response = await fetch("/api/platform-admin", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) return notify(payload.error || "Não foi possível concluir a ação");
    notify(success); await load();
  };

  const filteredClients = useMemo(() => data.clients.filter((client) => `${client.name} ${client.email}`.toLowerCase().includes(query.toLowerCase())), [data.clients, query]);
  const saveClient = (client: Client, changes: Partial<Client>) => update({ action: "client_update", companyId: client.id, email: changes.email ?? client.email, active: changes.active ?? client.active, status: changes.status ?? client.status, planId: changes.planId ?? client.planId, connectionLimit: changes.connectionLimit ?? client.connectionLimit }, "Cadastro do cliente atualizado");
  const resetPassword = (client: Client) => {
    if (!client.userId) return notify("Este cliente ainda não possui usuário vinculado");
    const password = window.prompt(`Defina uma senha temporária para ${client.name}. Use pelo menos 8 caracteres:`);
    if (password) update({ action: "password_reset", userId: client.userId, password }, "Senha temporária atualizada");
  };
  const updateIdentity = async (client: Client, name: string, email: string) => {
    setBusy(client.id);
    const response = await fetch("/api/platform-admin/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: client.id, userId: client.userId, name, email }),
    });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) return notify(payload.error || "Nao foi possivel atualizar a empresa");
    notify("Dados da empresa atualizados");
    await load();
  };
  const deleteCompany = async (client: Client) => {
    const confirmation = window.prompt(`Esta acao exclui definitivamente ${client.name}, o acesso e os dados vinculados. Digite EXCLUIR para confirmar.`);
    if (confirmation !== "EXCLUIR") return;
    setBusy(client.id);
    const response = await fetch("/api/platform-admin/company", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: client.id, confirmation: client.id }),
    });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) return notify(payload.error || "Nao foi possivel excluir a empresa");
    notify(payload.warning || "Empresa excluida definitivamente");
    await load();
  };
  const addPlan = () => {
    const plan: Plan = { id: crypto.randomUUID(), name: "Novo plano", price: 0, interval: "monthly", active: true, maxUsers: 1, maxMessages: 1000, features: ["Atendimento com IA", "CRM e agenda"], modules: moduleOptions.map(([id]) => id) };
    setData((current) => ({ ...current, plans: [...current.plans, plan] })); setTab("plans");
  };
  const changePlan = (id: string, changes: Partial<Plan>) => setData((current) => ({ ...current, plans: current.plans.map((plan) => plan.id === id ? { ...plan, ...changes } : plan) }));
  const changeTutorial = (id: string, changes: Partial<Tutorial>) => setData((current) => ({ ...current, tutorials: current.tutorials.map((tutorial) => tutorial.id === id ? { ...tutorial, ...changes } : tutorial) }));
  const addTutorial = () => setData((current) => ({ ...current, tutorials: [...current.tutorials, { id: crypto.randomUUID(), title: "Novo tutorial", description: "", videoId: "" }] }));
  const saveTutorials = () => update({ action: "tutorials_save", tutorials: data.tutorials.map((tutorial) => ({ ...tutorial, url: tutorial.videoId })) }, "Tutoriais atualizados para todos os usuários");
  const addAnnouncement = () => setData((current) => ({ ...current, announcements: [...current.announcements, { id: crypto.randomUUID(), title: "Novidade no PilatIA", message: "", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), createdAt: new Date().toISOString() }] }));
  const changeAnnouncement = (id: string, changes: Partial<Announcement>) => setData((current) => ({ ...current, announcements: current.announcements.map((item) => item.id === id ? { ...item, ...changes } : item) }));
  const saveAnnouncements = () => update({ action: "announcements_save", announcements: data.announcements }, "Comunicados atualizados para todos os usuários");

  if (loading && !data.clients.length && !data.plans.length) return <div className="admin-loading"><i />Carregando gestão da plataforma…</div>;

  return <section className="admin-shell">
    <div className="admin-hero"><div><span>CONTROLE DA PLATAFORMA</span><h2>Administração PilatIA</h2><p>Visão financeira, clientes, assinaturas e acessos em um ambiente exclusivo do administrador.</p></div><button onClick={load} disabled={loading}>{loading ? "Atualizando…" : "↻ Atualizar dados"}</button></div>
    <nav className="admin-tabs"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Visão geral</button><button className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}>Clientes <b>{data.clients.length}</b></button><button className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>Planos <b>{data.plans.length}</b></button><button className={tab === "tutorials" ? "active" : ""} onClick={() => setTab("tutorials")}>Tutoriais <b>{data.tutorials.length}</b></button><button className={tab === "announcements" ? "active" : ""} onClick={() => setTab("announcements")}>Comunicados <b>{data.announcements.length}</b></button></nav>

    {tab === "overview" && <><div className="admin-metrics"><article><span>Total de clientes</span><strong>{data.metrics.totalClients}</strong><small>Empresas cadastradas</small><i>◎</i></article><article><span>Clientes ativos</span><strong>{data.metrics.activeClients}</strong><small>{data.metrics.inactiveClients} inativo(s)</small><i>✓</i></article><article><span>Receita mensal</span><strong>{currency.format(data.metrics.monthlyRevenue)}</strong><small>Assinaturas ativas</small><i>R$</i></article><article><span>Ticket médio</span><strong>{currency.format(data.metrics.averageTicket)}</strong><small>Por cliente ativo</small><i>↗</i></article></div><div className="admin-overview-grid"><article className="ops-card"><header><span>CARTEIRA DE CLIENTES</span><h3>Situação das contas</h3></header><div className="admin-account-bars"><div><span>Ativos <b>{data.metrics.activeClients}</b></span><i><em style={{ width: `${data.metrics.totalClients ? data.metrics.activeClients / data.metrics.totalClients * 100 : 0}%` }} /></i></div><div><span>Inativos <b>{data.metrics.inactiveClients}</b></span><i><em className="inactive" style={{ width: `${data.metrics.totalClients ? data.metrics.inactiveClients / data.metrics.totalClients * 100 : 0}%` }} /></i></div></div><button onClick={() => setTab("clients")}>Gerenciar clientes</button></article><article className="ops-card"><header><span>PLANOS E RECEITA</span><h3>Distribuição atual</h3></header><div className="admin-plan-summary">{data.plans.length ? data.plans.map((plan) => { const count = data.clients.filter((client) => client.planId === plan.id).length; return <div key={plan.id}><span><strong>{plan.name}</strong><small>{count} cliente(s)</small></span><b>{currency.format(plan.price)}<small>/{plan.interval === "yearly" ? "ano" : "mês"}</small></b></div>; }) : <p>Nenhum plano criado ainda.</p>}</div><button onClick={addPlan}>＋ Criar primeiro plano</button></article></div></>}

    {tab === "clients" && <section className="admin-clients ops-card">
      <header><div><span>CLIENTES DA PLATAFORMA</span><h3>Cadastros e acessos</h3></div><label>⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa ou e-mail" /></label></header>
      <div className="admin-client-table">
        <div className="head"><span>Empresa</span><span>Plano</span><span>Assinatura</span><span>Entrada</span><span>Acesso</span><span>Ações</span></div>
        {filteredClients.map((client) => <div className="row" key={client.id}>
          <span><input className="company-name-input" defaultValue={client.name} aria-label={`Nome de ${client.name}`} onBlur={(event) => event.target.value.trim() !== client.name && updateIdentity(client, event.target.value, client.email)} /><input defaultValue={client.email} onBlur={(event) => event.target.value.trim().toLowerCase() !== client.email && updateIdentity(client, client.name, event.target.value)} /><small>{client.businessType} · {client.whatsappConnected ? "WhatsApp configurado" : "WhatsApp pendente"}</small></span>
          <span><select value={client.planId} onChange={(event) => saveClient(client, { planId: event.target.value })}><option value="">Sem plano</option>{data.plans.filter((plan) => plan.active || plan.id === client.planId).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><small>{client.monthlyValue ? currency.format(client.monthlyValue) + "/mês" : "Sem recorrência"}</small></span>
          <span><select className={`status ${client.status}`} value={client.status} onChange={(event) => saveClient(client, { status: event.target.value })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></span>
          <span><b>{client.createdAt ? new Date(client.createdAt).toLocaleDateString("pt-BR") : "—"}</b><small>{client.lastSignInAt ? `Último acesso ${new Date(client.lastSignInAt).toLocaleDateString("pt-BR")}` : "Ainda não acessou"}</small></span>
          <span><button className={client.active ? "account-active" : "account-inactive"} disabled={busy === client.id} onClick={() => saveClient(client, { active: !client.active, status: client.active ? "cancelled" : "active" })}>{client.active ? "● Liberado" : "● Bloqueado"}</button><label className="connection-limit">WhatsApps / unidades<input type="number" min="1" max="20" defaultValue={client.connectionLimit || 1} onBlur={(event) => { const value = Math.max(1, Math.min(20, Number(event.target.value) || 1)); event.target.value = String(value); if (value !== client.connectionLimit) saveClient(client, { connectionLimit: value }); }} /></label></span>
          <span className="client-actions"><button onClick={() => update({ action: "send_recovery", email: client.email }, "E-mail de recuperação solicitado")}>Enviar acesso</button><button onClick={() => resetPassword(client)}>Nova senha</button><button className="danger" disabled={busy === client.id} onClick={() => deleteCompany(client)}>Excluir definitivamente</button></span>
        </div>)}
      </div>
      {!filteredClients.length && <div className="admin-empty">Nenhum cliente encontrado.</div>}
    </section>}

    {tab === "plans" && <section className="admin-plans"><header><div><span>PLANOS DE ASSINATURA</span><h3>Produtos e limites</h3><p>Crie valores, periodicidade, recursos e limites para cada oferta.</p></div><button onClick={addPlan}>＋ Novo plano</button></header><div className="plan-grid">{data.plans.map((plan) => <article className="ops-card" key={plan.id}><div className="plan-top"><input value={plan.name} onChange={(event) => changePlan(plan.id, { name: event.target.value })} /><label><input type="checkbox" checked={plan.active} onChange={(event) => changePlan(plan.id, { active: event.target.checked })} /> Ativo</label></div><div className="plan-price"><span>R$</span><input type="number" min="0" step="0.01" value={plan.price} onChange={(event) => changePlan(plan.id, { price: Number(event.target.value) })} /><select value={plan.interval} onChange={(event) => changePlan(plan.id, { interval: event.target.value as Plan["interval"] })}><option value="monthly">por mês</option><option value="yearly">por ano</option></select></div><div className="plan-limits"><label>Usuários<input type="number" min="1" max="100" value={plan.maxUsers} onChange={(event) => changePlan(plan.id, { maxUsers: Number(event.target.value) })} /></label><label>Mensagens/mês<input type="number" min="0" value={plan.maxMessages} onChange={(event) => changePlan(plan.id, { maxMessages: Number(event.target.value) })} /></label></div><label className="unlimited-plan"><input type="checkbox" checked={plan.features.includes("__pilatia_unlimited__")} onChange={(event) => changePlan(plan.id, { features: event.target.checked ? [...plan.features.filter((item) => item !== "__pilatia_unlimited__"), "__pilatia_unlimited__"] : plan.features.filter((item) => item !== "__pilatia_unlimited__"), modules: event.target.checked ? moduleOptions.map(([id]) => id) : plan.modules, maxUsers: event.target.checked ? 100 : plan.maxUsers, maxMessages: event.target.checked ? 0 : plan.maxMessages })} /> Sem limite: todos os módulos e sem vencimento</label><div className="plan-modules"><span>FUNÇÕES LIBERADAS</span>{moduleOptions.map(([id, label]) => <label key={id}><input type="checkbox" checked={plan.modules.includes(id)} onChange={(event) => changePlan(plan.id, { modules: event.target.checked ? [...plan.modules, id] : plan.modules.filter((module) => module !== id) })} />{label}</label>)}</div><label className="plan-features">Descrição dos recursos<textarea value={plan.features.filter((item) => item !== "__pilatia_unlimited__").join("\n")} onChange={(event) => changePlan(plan.id, { features: [...event.target.value.split("\n").filter(Boolean), ...(plan.features.includes("__pilatia_unlimited__") ? ["__pilatia_unlimited__"] : [])] })} placeholder="Um recurso por linha" /></label><footer><button className="delete" onClick={() => update({ action: "plan_delete", planId: plan.id }, "Plano excluído")}>Excluir</button><button className="save" disabled={busy === plan.id} onClick={() => update({ action: "plan_save", plan }, "Plano salvo")}>{busy === plan.id ? "Salvando…" : "Salvar plano"}</button></footer></article>)}</div>{!data.plans.length && <div className="admin-empty plans"><strong>Você ainda não criou planos.</strong><p>Crie o primeiro plano para começar a vincular assinaturas aos clientes.</p><button onClick={addPlan}>＋ Criar plano</button></div>}</section>}

    {tab === "tutorials" && <section className="admin-tutorials"><header><div><span>CENTRAL DE AJUDA</span><h3>Tutoriais para todos os usuários</h3><p>Adicione vídeos não listados ou públicos do YouTube. Ao salvar, a central de tutoriais é atualizada para todas as empresas.</p></div><button onClick={addTutorial}>＋ Novo tutorial</button></header><div className="tutorial-admin-list">{data.tutorials.map((tutorial, index) => <article className="ops-card" key={tutorial.id}><i>{String(index + 1).padStart(2, "0")}</i><div><label>Título<input value={tutorial.title} onChange={(event) => changeTutorial(tutorial.id, { title: event.target.value })} /></label><label>Descrição<input value={tutorial.description} onChange={(event) => changeTutorial(tutorial.id, { description: event.target.value })} /></label><label>Link do YouTube<input value={tutorial.videoId.startsWith("http") ? tutorial.videoId : tutorial.videoId ? `https://youtu.be/${tutorial.videoId}` : ""} placeholder="https://youtu.be/..." onChange={(event) => changeTutorial(tutorial.id, { videoId: event.target.value })} /></label></div><button className="danger" onClick={() => setData((current) => ({ ...current, tutorials: current.tutorials.filter((item) => item.id !== tutorial.id) }))}>Excluir</button></article>)}</div><button className="save-tutorials" disabled={busy === "tutorials_save"} onClick={saveTutorials}>{busy === "tutorials_save" ? "Salvando…" : "Salvar e atualizar para todos"}</button></section>}

    {tab === "announcements" && <section className="admin-tutorials"><header><div><span>COMUNICAÇÃO DA PLATAFORMA</span><h3>Comunicados para todos os usuários</h3><p>Crie novidades com prazo de exibição. Enquanto estiverem válidas, aparecerão no sino do painel.</p></div><button onClick={addAnnouncement}>＋ Novo comunicado</button></header><div className="tutorial-admin-list announcement-admin-list">{data.announcements.map((item) => <article className="ops-card" key={item.id}><i>🔔</i><div><label>Título<input value={item.title} onChange={(event) => changeAnnouncement(item.id, { title: event.target.value })} /></label><label>Mensagem<input value={item.message} placeholder="Conte a novidade de forma curta e clara" onChange={(event) => changeAnnouncement(item.id, { message: event.target.value })} /></label><label>Exibir até<input type="datetime-local" value={new Date(item.expiresAt).toISOString().slice(0, 16)} onChange={(event) => event.target.value && changeAnnouncement(item.id, { expiresAt: new Date(event.target.value).toISOString() })} /></label></div><button className="danger" onClick={() => setData((current) => ({ ...current, announcements: current.announcements.filter((announcement) => announcement.id !== item.id) }))}>Excluir</button></article>)}</div><button className="save-tutorials" disabled={busy === "announcements_save"} onClick={saveAnnouncements}>{busy === "announcements_save" ? "Salvando…" : "Salvar comunicados"}</button></section>}
  </section>;
}
