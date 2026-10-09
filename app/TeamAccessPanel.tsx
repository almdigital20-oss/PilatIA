"use client";

import { useEffect, useState } from "react";

type Member = { id: string; name: string; email: string; role: string; owner: boolean; current: boolean; createdAt: string; lastSignInAt: string | null };

export default function TeamAccessPanel({ notify }: { notify: (message: string) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [limit, setLimit] = useState(2);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  const load = async () => {
    setLoading(true);
    const response = await fetch("/api/team-members", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) return notify(data.error || "Não foi possível consultar os acessos");
    setMembers(Array.isArray(data.members) ? data.members : []);
    setLimit(Math.max(2, Number(data.limit) || 2));
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    const response = await fetch("/api/team-members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return notify(data.error || "Não foi possível criar o acesso");
    setMembers(data.members || []); setForm({ name: "", email: "", password: "" });
    notify("Usuário da equipe criado e vinculado a esta empresa");
  };

  const resetPassword = async (member: Member) => {
    const password = window.prompt(`Defina uma nova senha temporária para ${member.name}:`);
    if (!password) return;
    setBusy(true);
    const response = await fetch("/api/team-members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.id, password }) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return notify(data.error || "Não foi possível alterar a senha");
    notify("Senha temporária atualizada");
  };

  const remove = async (member: Member) => {
    if (!window.confirm(`Remover o acesso de ${member.name}? Os dados da empresa e as conversas serão preservados.`)) return;
    setBusy(true);
    const response = await fetch(`/api/team-members?userId=${encodeURIComponent(member.id)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return notify(data.error || "Não foi possível remover o acesso");
    setMembers(data.members || []); notify("Acesso da equipe removido");
  };

  return <article className="ops-card team-access-panel">
    <header><div><span>EQUIPE E ACESSOS</span><h2>Compartilhe a operação com sua recepção</h2><p>O usuário adicional acessa os mesmos contatos, Chat, CRM e Agenda, sem poder alterar a conexão ou as configurações da empresa.</p></div><b>{members.length}/{limit} acessos</b></header>
    <div className="team-member-list">{loading ? <p className="team-empty">Consultando acessos…</p> : members.map((member) => <section key={member.id}>
      <i>{member.name.slice(0, 2).toUpperCase()}</i><div><strong>{member.name}</strong><span>{member.email}</span><small>{member.owner ? "Administrador principal" : "Usuário operacional"}{member.lastSignInAt ? ` · Último acesso ${new Date(member.lastSignInAt).toLocaleDateString("pt-BR")}` : ""}</small></div>
      {member.owner ? <em>Proprietário</em> : <aside><button disabled={busy} onClick={() => resetPassword(member)}>Nova senha</button><button className="danger" disabled={busy} onClick={() => remove(member)}>Remover</button></aside>}
    </section>)}</div>
    {!loading && members.length < limit && <div className="team-create-form"><div><span>NOVO USUÁRIO OPERACIONAL</span><h3>Crie o segundo acesso da empresa</h3></div><label>Nome<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Mariana · Recepção" /></label><label>E-mail<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="recepcao@empresa.com" /></label><label>Senha temporária<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo de 8 caracteres" /></label><button disabled={busy} onClick={create}>{busy ? "Criando acesso…" : "+ Criar usuário adicional"}</button><small>A senha pode ser alterada pelo administrador a qualquer momento. O limite padrão é de um usuário adicional por empresa.</small></div>}
    {!loading && members.length >= limit && <div className="team-limit-note"><b>✓ Dois acessos ativos</b><span>Para trocar o usuário operacional, remova o acesso atual e crie outro.</span></div>}
  </article>;
}
