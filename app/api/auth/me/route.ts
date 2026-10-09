import { NextRequest, NextResponse } from "next/server";
import { getTenant, serviceHeaders } from "../../../lib/tenant";
import { clearSessionCookies, setSessionCookies } from "../../../lib/session";

const accountPayload = (tenant: NonNullable<Awaited<ReturnType<typeof getTenant>>>) => ({ user: { email: tenant.email }, company: { id: tenant.companyId, name: tenant.companyName }, role: tenant.role, subscription: tenant.settings?.subscription || null });
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache" };

export async function GET(request:NextRequest){
  const tenant=await getTenant(request);
  if(tenant)return NextResponse.json(accountPayload(tenant),{headers:noStore});
  const refreshToken=request.cookies.get("pilatia_refresh")?.value;
  const base=process.env.SUPABASE_URL?.replace(/\/$/,"");
  if(!refreshToken||!base)return clearSessionCookies(NextResponse.json({error:"Não autenticado"},{status:401}));
  const refreshed=await fetch(`${base}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:serviceHeaders(),body:JSON.stringify({refresh_token:refreshToken})}).catch(()=>null);
  if(!refreshed?.ok)return clearSessionCookies(NextResponse.json({error:"Sessão expirada"},{status:401}));
  const session=await refreshed.json();
  const renewedTenant=await getTenant(request,session.access_token);
  if(!renewedTenant)return clearSessionCookies(NextResponse.json({error:"Conta indisponível"},{status:401}));
  return setSessionCookies(NextResponse.json({...accountPayload(renewedTenant),renewed:true},{headers:noStore}),session.access_token,session.refresh_token,session.expires_in);
}
