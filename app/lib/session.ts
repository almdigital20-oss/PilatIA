import { NextRequest, NextResponse } from "next/server";
import { getTenant, serviceHeaders, type Tenant } from "./tenant";

const cookieBase = { httpOnly: true, secure: true, sameSite: "lax" as const };

export function setSessionCookies(response: NextResponse, accessToken: string, refreshToken: string, expiresIn = 3600) {
  response.cookies.set("pilatia_access", accessToken, { ...cookieBase, path: "/", maxAge: Math.max(300, Number(expiresIn) || 3600) });
  response.cookies.set("pilatia_refresh", "", { ...cookieBase, path: "/api/auth", maxAge: 0 });
  response.cookies.set("pilatia_refresh", refreshToken, { ...cookieBase, path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

export type RenewedSession = { accessToken: string; refreshToken: string; expiresIn: number };

export async function getTenantWithSessionRefresh(request: NextRequest): Promise<{ tenant: Tenant; session?: RenewedSession } | null> {
  const tenant = await getTenant(request);
  if (tenant) return { tenant };

  const refreshToken = request.cookies.get("pilatia_refresh")?.value;
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!refreshToken || !base) return null;

  const refreshed = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  }).catch(() => null);
  if (!refreshed?.ok) return null;

  const payload = await refreshed.json().catch(() => null);
  if (!payload?.access_token || !payload?.refresh_token) return null;
  const renewedTenant = await getTenant(request, payload.access_token);
  if (!renewedTenant) return null;

  return {
    tenant: renewedTenant,
    session: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: Number(payload.expires_in) || 3600,
    },
  };
}

export function applyRenewedSession(response: NextResponse, session?: RenewedSession) {
  if (!session) return response;
  return setSessionCookies(response, session.accessToken, session.refreshToken, session.expiresIn);
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set("pilatia_access", "", { ...cookieBase, path: "/", maxAge: 0 });
  response.cookies.set("pilatia_refresh", "", { ...cookieBase, path: "/", maxAge: 0 });
  response.cookies.set("pilatia_refresh", "", { ...cookieBase, path: "/api/auth", maxAge: 0 });
  response.cookies.set("pilatia_demo", "", { ...cookieBase, path: "/", maxAge: 0 });
  response.cookies.set("pilatia_admin", "", { ...cookieBase, path: "/", maxAge: 0 });
  return response;
}
