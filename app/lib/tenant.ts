import { NextRequest } from "next/server";
import { isPlatformAdmin } from "./platform-admin";
import { whatsappUnitsForCompany } from "./whatsapp-units";

export type StorageMode = "tables" | "metadata";
export type CompanyRecord = {
  id: string;
  name: string;
  evolution_instance: string;
  active: boolean;
  settings: Record<string, any>;
  owner_user_id?: string;
  user_metadata?: Record<string, any>;
};
export type Tenant = {
  userId: string;
  email: string;
  companyId: string;
  companyName: string;
  instance: string;
  role: string;
  settings: Record<string, any>;
  storageMode: StorageMode;
  userMetadata?: Record<string, any>;
};

export const serviceHeaders = () => ({
  "Content-Type": "application/json",
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
});

const baseUrl = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
let storageCache: { mode: StorageMode; expiresAt: number } | null = null;

export async function getStorageMode(): Promise<StorageMode> {
  if (storageCache && storageCache.expiresAt > Date.now()) return storageCache.mode;
  const base = baseUrl();
  if (!base || !process.env.SUPABASE_SERVICE_ROLE_KEY) return "metadata";
  const response = await fetch(`${base}/rest/v1/companies?select=id&limit=1`, { headers: serviceHeaders(), cache: "no-store" }).catch(() => null);
  const mode: StorageMode = response?.ok ? "tables" : "metadata";
  storageCache = { mode, expiresAt: Date.now() + 60_000 };
  return mode;
}

export function conversationScope(mode: StorageMode, companyId: string) {
  return new URLSearchParams({ [mode === "tables" ? "company_id" : "summary->>company_id"]: `eq.${companyId}` }).toString();
}

export function conversationRecord(mode: StorageMode, companyId: string, summary: Record<string, any> = {}) {
  return {
    ...(mode === "tables" ? { company_id: companyId } : {}),
    summary: { ...summary, company_id: companyId },
  };
}

export function tenantHasModule(tenant: Tenant, module: string) {
  if (tenant.role === "superadmin") return true;
  const modules = tenant.settings?.subscription?.modules;
  return !Array.isArray(modules) || modules.includes(module);
}

function companyFromMetadata(user: any): CompanyRecord | null {
  const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const id = String(metadata.pilatia_company_id || "");
  if (!id) return null;
  return {
    id,
    name: String(metadata.pilatia_company_name || metadata.company_name || "Empresa"),
    evolution_instance: String(metadata.pilatia_evolution_instance || ""),
    active: metadata.pilatia_active !== false,
    settings: metadata.pilatia_settings && typeof metadata.pilatia_settings === "object" ? metadata.pilatia_settings : {},
    owner_user_id: String(user.id || ""),
    user_metadata: metadata,
  };
}

export async function listCompanies(): Promise<CompanyRecord[]> {
  const base = baseUrl();
  if (!base) return [];
  const mode = await getStorageMode();
  if (mode === "tables") {
    const response = await fetch(`${base}/rest/v1/companies?active=eq.true&select=id,name,evolution_instance,settings,active`, { headers: serviceHeaders(), cache: "no-store" });
    return response.ok ? await response.json() : [];
  }
  const response = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders(), cache: "no-store" });
  if (!response.ok) return [];
  const payload = await response.json();
  const users = Array.isArray(payload) ? payload : Array.isArray(payload?.users) ? payload.users : [];
  const companies = users.map(companyFromMetadata).filter(Boolean) as CompanyRecord[];
  return [...new Map(companies.map((company) => [company.id, company])).values()].filter((company) => company.active);
}

export async function findCompanyByInstance(instance: string): Promise<CompanyRecord | null> {
  const companies = await listCompanies();
  return companies.find((company) => whatsappUnitsForCompany(company).some((unit) => unit.instance === instance)) || null;
}

export async function getTenant(request: NextRequest, accessToken?: string): Promise<Tenant | null> {
  if (await isPlatformAdmin(request)) return {
    userId: "demo", email: process.env.PILATIA_ADMIN_LOGIN || "admin", companyId: "00000000-0000-4000-8000-000000000001",
    companyName: "PilatIA", instance: "", role: "superadmin", settings: {}, storageMode: await getStorageMode(),
  };
  const token = accessToken || request.cookies.get("pilatia_access")?.value;
  const base = baseUrl();
  if (!token || !base || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const userResponse = await fetch(`${base}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  const mode = await getStorageMode();
  if (mode === "tables") {
    const memberResponse = await fetch(`${base}/rest/v1/company_members?user_id=eq.${user.id}&select=company_id,role&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
    const members = memberResponse.ok ? await memberResponse.json() : [];
    if (!members[0]) return null;
    const companyResponse = await fetch(`${base}/rest/v1/companies?id=eq.${members[0].company_id}&select=id,name,evolution_instance,active,settings&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
    const companies = companyResponse.ok ? await companyResponse.json() : [];
    if (!companies[0]?.active) return null;
    const metadataCompanyId = String(user.user_metadata?.pilatia_company_id || "");
    const metadataRole = String(user.user_metadata?.pilatia_role || "").toLowerCase();
    const membershipRole = String(members[0].role || "agent").toLowerCase();
    const primaryCompanyAdmin = metadataCompanyId === String(companies[0].id) && metadataRole === "admin";
    const resolvedRole = primaryCompanyAdmin ? "admin" : membershipRole;
    return { userId: user.id, email: user.email, companyId: companies[0].id, companyName: companies[0].name, instance: companies[0].evolution_instance || "", role: resolvedRole, settings: companies[0].settings || {}, storageMode: mode };
  }
  const company = companyFromMetadata(user);
  if (!company?.active) return null;
  return { userId: user.id, email: user.email, companyId: company.id, companyName: company.name, instance: company.evolution_instance, role: String(user.user_metadata?.pilatia_role || "admin"), settings: company.settings, storageMode: mode, userMetadata: company.user_metadata };
}
