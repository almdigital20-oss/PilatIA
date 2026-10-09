import { NextRequest, NextResponse } from "next/server";
import { serviceHeaders } from "../../../lib/tenant";
import { setSessionCookies } from "../../../lib/session";
import { createPlatformAdminSession } from "../../../lib/platform-admin";

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();
  const cleanLogin = String(email || "").trim().toLowerCase();
  const adminLogin = String(process.env.PILATIA_ADMIN_LOGIN || "admin").trim().toLowerCase();
  const adminPassword = String(process.env.PILATIA_ADMIN_PASSWORD || "admin");
  if (cleanLogin === adminLogin && password === adminPassword) {
    const response = NextResponse.json({ ok: true, admin: true });
    response.cookies.set("pilatia_admin", await createPlatformAdminSession(), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
    response.cookies.set("pilatia_demo", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  }
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return NextResponse.json({ error: "Configuração incompleta" }, { status: 503 });
  const login = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: serviceHeaders(), body: JSON.stringify({ email: cleanLogin, password }) });
  const data = await login.json();
  if (!login.ok) return NextResponse.json({ error: "Login ou senha inválidos" }, { status: 401 });
  return setSessionCookies(NextResponse.json({ ok: true }), data.access_token, data.refresh_token, data.expires_in);
}
