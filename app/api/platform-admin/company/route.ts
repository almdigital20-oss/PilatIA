import { NextRequest, NextResponse } from "next/server";
import { getStorageMode, serviceHeaders } from "../../../lib/tenant";
import { isPlatformAdmin } from "../../../lib/platform-admin";

export const dynamic = "force-dynamic";

const PLATFORM_ID = "00000000-0000-0000-0000-000000000000";
const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "") || "";

async function getUsers() {
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: serviceHeaders(), cache: "no-store",
  });
  if (!response.ok) throw new Error("Nao foi possivel consultar os usuarios da empresa");
  const payload = await response.json();
  return Array.isArray(payload) ? payload : Array.isArray(payload?.users) ? payload.users : [];
}

async function tableCompany(companyId: string) {
  const response = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${encodeURIComponent(companyId)}&select=id,name,evolution_instance,settings&limit=1`, {
    headers: serviceHeaders(), cache: "no-store",
  });
  const rows = response.ok ? await response.json() : [];
  return rows[0] || null;
}

async function tableUserIds(companyId: string) {
  const response = await fetch(`${baseUrl()}/rest/v1/company_members?company_id=eq.${encodeURIComponent(companyId)}&select=user_id`, {
    headers: serviceHeaders(), cache: "no-store",
  });
  const rows = response.ok ? await response.json() : [];
  return rows.map((row: any) => String(row.user_id)).filter(Boolean);
}

async function removeEvolutionInstance(instance: string) {
  const url = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!url || !key || !instance) return true;
  const response = await fetch(`${url}/instance/delete/${encodeURIComponent(instance)}`, {
    method: "DELETE", headers: { apikey: key, "Content-Type": "application/json" }, cache: "no-store",
  }).catch(() => null);
  return Boolean(response?.ok || response?.status === 404);
}

export async function PATCH(request: NextRequest) {
  if (!await isPlatformAdmin(request)) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  try {
    const input = await request.json();
    const companyId = String(input.companyId || "");
    const name = String(input.name || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    if (!companyId || companyId === PLATFORM_ID) return NextResponse.json({ error: "Empresa invalida" }, { status: 400 });
    if (name.length < 2 || name.length > 120) return NextResponse.json({ error: "Informe um nome entre 2 e 120 caracteres" }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Informe um email valido" }, { status: 400 });

    const mode = await getStorageMode();
    const users = await getUsers();
    let userIds: string[] = [];
    if (mode === "tables") {
      const company = await tableCompany(companyId);
      if (!company) return NextResponse.json({ error: "Empresa nao encontrada" }, { status: 404 });
      userIds = await tableUserIds(companyId);
      const updated = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${encodeURIComponent(companyId)}`, {
        method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ name }),
      });
      if (!updated.ok) throw new Error("Nao foi possivel atualizar o nome da empresa");
    } else {
      userIds = users.filter((user: any) => user.user_metadata?.pilatia_company_id === companyId).map((user: any) => String(user.id));
      if (!userIds.length) return NextResponse.json({ error: "Empresa nao encontrada" }, { status: 404 });
    }

    const ownerId = String(input.userId || userIds[0] || "");
    for (const userId of userIds) {
      const user = users.find((item: any) => String(item.id) === userId);
      const metadata = user?.user_metadata || {};
      const body: Record<string, unknown> = {
        user_metadata: { ...metadata, pilatia_company_name: name, company_name: name },
      };
      if (userId === ownerId) body.email = email;
      const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT", headers: serviceHeaders(), body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("A empresa foi atualizada, mas o acesso nao pode ser alterado");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar a empresa" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!await isPlatformAdmin(request)) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  try {
    const input = await request.json();
    const companyId = String(input.companyId || "");
    if (!companyId || companyId === PLATFORM_ID || input.confirmation !== companyId) {
      return NextResponse.json({ error: "Confirmacao de exclusao invalida" }, { status: 400 });
    }

    const mode = await getStorageMode();
    const users = await getUsers();
    let userIds: string[] = [];
    let instance = "";
    if (mode === "tables") {
      const company = await tableCompany(companyId);
      if (!company) return NextResponse.json({ error: "Empresa nao encontrada" }, { status: 404 });
      instance = String(company.evolution_instance || "");
      userIds = await tableUserIds(companyId);
      const removed = await fetch(`${baseUrl()}/rest/v1/companies?id=eq.${encodeURIComponent(companyId)}`, {
        method: "DELETE", headers: { ...serviceHeaders(), Prefer: "return=minimal" },
      });
      if (!removed.ok) throw new Error("Nao foi possivel excluir os dados da empresa");
    } else {
      const companyUsers = users.filter((user: any) => user.user_metadata?.pilatia_company_id === companyId);
      if (!companyUsers.length) return NextResponse.json({ error: "Empresa nao encontrada" }, { status: 404 });
      userIds = companyUsers.map((user: any) => String(user.id));
      instance = String(companyUsers[0]?.user_metadata?.pilatia_evolution_instance || "");
    }

    for (const userId of userIds) {
      const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE", headers: serviceHeaders(),
      });
      if (!response.ok && response.status !== 404) throw new Error("Dados removidos, mas um acesso de usuario permaneceu ativo");
    }
    const evolutionRemoved = await removeEvolutionInstance(instance);
    return NextResponse.json({ ok: true, warning: evolutionRemoved ? null : "Empresa excluida; a instancia de WhatsApp deve ser revisada" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao excluir a empresa" }, { status: 502 });
  }
}
