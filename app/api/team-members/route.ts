import { NextRequest, NextResponse } from "next/server";
import { getTenant, serviceHeaders } from "../../lib/tenant";

const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const MAX_COMPANY_MEMBERS = 2;

async function companyMembers(companyId: string) {
  const response = await fetch(`${baseUrl()}/rest/v1/company_members?company_id=eq.${encodeURIComponent(companyId)}&select=company_id,user_id,role,created_at&order=created_at.asc`, {
    headers: serviceHeaders(), cache: "no-store",
  });
  if (!response.ok) throw new Error("Não foi possível consultar os acessos da empresa");
  return await response.json() as Array<{ company_id: string; user_id: string; role: string; created_at: string }>;
}

async function authUser(userId: string) {
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: serviceHeaders(), cache: "no-store" });
  if (!response.ok) return null;
  return await response.json();
}

async function requireCompanyAdmin(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (tenant.userId === "demo") return { error: NextResponse.json({ error: "O ambiente demonstrativo não altera acessos" }, { status: 403 }) };
  if (tenant.role !== "admin") return { error: NextResponse.json({ error: "Somente o administrador principal pode gerenciar a equipe" }, { status: 403 }) };
  if (tenant.storageMode !== "tables") return { error: NextResponse.json({ error: "A gestão de equipe requer a estrutura multiempresa ativa" }, { status: 409 }) };
  return { tenant };
}

async function memberPayload(companyId: string, currentUserId: string) {
  const members = await companyMembers(companyId);
  const users = await Promise.all(members.map((member) => authUser(member.user_id)));
  return members.map((member, index) => {
    const user = users[index] || {};
    const metadata = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
    return {
      id: member.user_id,
      name: String(metadata.pilatia_member_name || metadata.full_name || user.email || "Usuário"),
      email: String(user.email || ""),
      role: member.role,
      owner: member.role === "admin",
      current: member.user_id === currentUserId,
      createdAt: member.created_at,
      lastSignInAt: user.last_sign_in_at || null,
    };
  });
}

export async function GET(request: NextRequest) {
  const access = await requireCompanyAdmin(request);
  if ("error" in access) return access.error;
  try {
    const members = await memberPayload(access.tenant.companyId, access.tenant.userId);
    return NextResponse.json({ members, limit: MAX_COMPANY_MEMBERS, available: Math.max(0, MAX_COMPANY_MEMBERS - members.length) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível consultar a equipe" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireCompanyAdmin(request);
  if ("error" in access) return access.error;
  const input = await request.json();
  const name = String(input.name || "").trim().slice(0, 120);
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (name.length < 2 || !email.includes("@") || password.length < 8) {
    return NextResponse.json({ error: "Informe nome, e-mail válido e senha temporária com pelo menos 8 caracteres" }, { status: 400 });
  }

  const members = await companyMembers(access.tenant.companyId);
  if (members.length >= MAX_COMPANY_MEMBERS) return NextResponse.json({ error: "Esta empresa já utiliza os dois acessos disponíveis" }, { status: 409 });

  const userResponse = await fetch(`${baseUrl()}/auth/v1/admin/users`, {
    method: "POST", headers: serviceHeaders(),
    body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: {
        pilatia_member_name: name,
        full_name: name,
        pilatia_company_id: access.tenant.companyId,
        pilatia_company_name: access.tenant.companyName,
        pilatia_role: "agent",
        pilatia_active: true,
      },
    }),
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok) return NextResponse.json({ error: user.msg || user.message || "Não foi possível criar o acesso. Verifique se o e-mail já está em uso." }, { status: 400 });

  const memberResponse = await fetch(`${baseUrl()}/rest/v1/company_members`, {
    method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ company_id: access.tenant.companyId, user_id: user.id, role: "agent" }),
  });
  if (!memberResponse.ok) {
    await fetch(`${baseUrl()}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE", headers: serviceHeaders() });
    return NextResponse.json({ error: "Não foi possível vincular o usuário à empresa" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, members: await memberPayload(access.tenant.companyId, access.tenant.userId) }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const access = await requireCompanyAdmin(request);
  if ("error" in access) return access.error;
  const input = await request.json();
  const userId = String(input.userId || "");
  const members = await companyMembers(access.tenant.companyId);
  const member = members.find((item) => item.user_id === userId);
  if (!member || member.role === "admin" || userId === access.tenant.userId) return NextResponse.json({ error: "Usuário operacional inválido" }, { status: 404 });

  const current = await authUser(userId);
  if (!current) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const body: Record<string, unknown> = {};
  const name = String(input.name || "").trim().slice(0, 120);
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (name) body.user_metadata = { ...(current.user_metadata || {}), pilatia_member_name: name, full_name: name, pilatia_company_id: access.tenant.companyId, pilatia_company_name: access.tenant.companyName, pilatia_role: "agent", pilatia_active: true };
  if (email) {
    if (!email.includes("@")) return NextResponse.json({ error: "Informe um e-mail válido" }, { status: 400 });
    body.email = email;
    body.email_confirm = true;
  }
  if (password) {
    if (password.length < 8) return NextResponse.json({ error: "A nova senha deve ter pelo menos 8 caracteres" }, { status: 400 });
    body.password = password;
  }
  if (!Object.keys(body).length) return NextResponse.json({ error: "Nenhuma alteração informada" }, { status: 400 });
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", headers: serviceHeaders(), body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return response.ok
    ? NextResponse.json({ ok: true, members: await memberPayload(access.tenant.companyId, access.tenant.userId) })
    : NextResponse.json({ error: data.msg || data.message || "Não foi possível atualizar o acesso" }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const access = await requireCompanyAdmin(request);
  if ("error" in access) return access.error;
  const userId = String(request.nextUrl.searchParams.get("userId") || "");
  const members = await companyMembers(access.tenant.companyId);
  const member = members.find((item) => item.user_id === userId);
  if (!member || member.role === "admin" || userId === access.tenant.userId) return NextResponse.json({ error: "O acesso principal não pode ser removido" }, { status: 403 });
  const response = await fetch(`${baseUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: serviceHeaders() });
  if (!response.ok && response.status !== 404) return NextResponse.json({ error: "Não foi possível remover o acesso" }, { status: 502 });
  return NextResponse.json({ ok: true, members: await memberPayload(access.tenant.companyId, access.tenant.userId) });
}
