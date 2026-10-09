import type { CompanyRecord, Tenant } from "./tenant";

export type WhatsAppUnit = {
  id: string;
  name: string;
  instance: string;
  profile: Record<string, string>;
};

const unitProfileFields = ["address", "businessHours", "availablePeriods", "services", "prices", "paymentMethods", "promotionText", "cancellationPolicy"] as const;

export function sanitizeWhatsAppUnitProfile(input: unknown) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return Object.fromEntries(unitProfileFields.map((field) => [field, String(source[field] || "").trim().slice(0, 5000)]));
}

export function settingsForWhatsAppUnit(settings: Record<string, any> | null | undefined, unit: WhatsAppUnit | undefined) {
  const effective = { ...(settings || {}) };
  if (!unit) return effective;
  for (const [key, value] of Object.entries(unit.profile || {})) if (String(value).trim()) effective[key] = value;
  return effective;
}

export function whatsappConnectionLimit(settings: Record<string, any> | null | undefined) {
  return Math.max(1, Math.min(20, Math.trunc(Number(settings?.connection_limit) || 1)));
}

function storedUnits(settings: Record<string, any> | null | undefined) {
  return Array.isArray(settings?.whatsapp_units) ? settings.whatsapp_units : [];
}

function buildUnits(companyId: string, companyName: string, primaryInstance: string, settings: Record<string, any> | null | undefined) {
  const limit = whatsappConnectionLimit(settings);
  const stored = storedUnits(settings);
  const base = String(primaryInstance || `pilatia_${companyId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`).slice(0, 48);
  return Array.from({ length: limit }, (_, index): WhatsAppUnit => {
    const saved = stored[index] && typeof stored[index] === "object" ? stored[index] : {};
    return {
      id: `unit-${index + 1}`,
      name: String(saved.name || (index === 0 ? "Unidade principal" : `Unidade ${index + 1}`)).trim().slice(0, 80),
      instance: index === 0 ? primaryInstance : `${base}_u${index + 1}`,
      profile: sanitizeWhatsAppUnitProfile(saved.profile),
    };
  });
}

export function whatsappUnitsForTenant(tenant: Tenant) {
  return buildUnits(tenant.companyId, tenant.companyName, tenant.instance, tenant.settings);
}

export function whatsappUnitsForCompany(company: CompanyRecord) {
  return buildUnits(company.id, company.name, company.evolution_instance, company.settings);
}
