import { NextRequest, NextResponse } from "next/server";
import { ensureEvolutionInstance } from "../../../lib/evolution";
import { getStorageMode, serviceHeaders } from "../../../lib/tenant";
import { setSessionCookies } from "../../../lib/session";
import { getBusinessProfile, isBusinessType } from "../../../lib/business-types";

export async function POST(request: NextRequest) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret) return NextResponse.json({ error: "Autenticação não configurada" }, { status: 503 });
  const { companyName, email, password, businessType } = await request.json();
  const cleanName = String(companyName || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (cleanName.length < 2 || !cleanEmail.includes("@") || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Preencha empresa, e-mail válido e senha com pelo menos 8 caracteres" }, { status: 400 });
  }

  const mode = await getStorageMode();
  const companyId = crypto.randomUUID();
  const instance = `pilatia_${companyId.slice(0, 8)}`;
  const selectedBusinessType = isBusinessType(businessType) ? businessType : "pilates";
  const business = getBusinessProfile(selectedBusinessType);
  const settings = { ai_name: `Assistente de atendimento do ${cleanName}`, businessType: selectedBusinessType, businessLabel: business.label, remindersEnabled: true };
  const userMetadata = {
    company_name: cleanName,
    pilatia_company_id: companyId,
    pilatia_company_name: cleanName,
    pilatia_evolution_instance: instance,
    pilatia_settings: settings,
    pilatia_role: "admin",
    pilatia_active: true,
  };

  const userResponse = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST", headers: serviceHeaders(),
    body: JSON.stringify({ email: cleanEmail, password, email_confirm: true, user_metadata: userMetadata }),
  });
  const userData = await userResponse.json();
  if (!userResponse.ok) return NextResponse.json({ error: userData.msg || userData.message || "Não foi possível criar o usuário" }, { status: 400 });

  if (mode === "tables") {
    const companyResponse = await fetch(`${base}/rest/v1/companies`, {
      method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ id: companyId, name: cleanName, evolution_instance: instance, settings }),
    });
    if (!companyResponse.ok) {
      await fetch(`${base}/auth/v1/admin/users/${userData.id}`, { method: "DELETE", headers: serviceHeaders() });
      return NextResponse.json({ error: "Não foi possível criar a empresa" }, { status: 502 });
    }
    const memberResponse = await fetch(`${base}/rest/v1/company_members`, {
      method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ company_id: companyId, user_id: userData.id, role: "admin" }),
    });
    if (!memberResponse.ok) {
      await fetch(`${base}/rest/v1/companies?id=eq.${companyId}`, { method: "DELETE", headers: serviceHeaders() });
      await fetch(`${base}/auth/v1/admin/users/${userData.id}`, { method: "DELETE", headers: serviceHeaders() });
      return NextResponse.json({ error: "Não foi possível concluir o cadastro" }, { status: 502 });
    }
  }

  // A rota do QR tambem garante a instancia, portanto uma indisponibilidade
  // momentanea da Evolution nao desfaz o cadastro. Quando disponivel, a
  // instancia ja fica preparada antes de o modal ser aberto.
  const whatsapp = await ensureEvolutionInstance(instance);

  const login = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: serviceHeaders(), body: JSON.stringify({ email: cleanEmail, password }),
  });
  const session = await login.json();
  if (!login.ok || !session.access_token) return NextResponse.json({ error: "Cadastro criado. Faça login para continuar." }, { status: 201 });
  const response = NextResponse.json({
    ok: true,
    company: { id: companyId, name: cleanName },
    user: { email: cleanEmail },
    role: "admin",
    whatsappReady: whatsapp.ok,
  });
  return setSessionCookies(response, session.access_token, session.refresh_token, session.expires_in);
}
