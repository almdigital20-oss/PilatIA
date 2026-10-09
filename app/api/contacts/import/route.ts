import { NextRequest, NextResponse } from "next/server";
import { conversationRecord, conversationScope, getTenant, serviceHeaders, tenantHasModule } from "../../../lib/tenant";

export const dynamic = "force-dynamic";

const evolutionRows = (payload: any, keys: string[]) => {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  return [];
};

const comparableName = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isCompanyIdentity = (value: unknown, companyName: string) => {
  const candidate = comparableName(value);
  const company = comparableName(companyName);
  if (!candidate || !company) return false;
  if (candidate === company) return true;
  const genericBusinessWords = new Set(["pilates", "studio", "estudio", "clinica", "academia", "fisioterapia", "saude", "fitness", "centro", "unidade"]);
  const distinctiveTokens = company.split(" ").filter((token) => token.length >= 4 && !genericBusinessWords.has(token));
  return candidate.length >= 4 && (company.startsWith(`${candidate} `) || company.endsWith(` ${candidate}`) || distinctiveTokens.includes(candidate));
};

const usableName = (value: unknown, companyName: string) => {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const normalized = comparableName(name);
  if (!normalized || isCompanyIdentity(name, companyName)) return "";
  if (["contato", "contato do whatsapp", "whatsapp", "unknown", "desconhecido", "sem nome"].includes(normalized)) return "";
  if (/^\+?\d{8,15}$/.test(name.replace(/[\s()-]/g, ""))) return "";
  return name;
};

const normalizeContact = (item: any, source: "address_book" | "chat", companyName: string) => {
  const rawId = String(item.remoteJid || item.remoteJidAlt || item.jid || item.id || "");
  const candidates = source === "address_book"
    ? [item.name, item.notify, item.contact?.name, item.contact?.pushName, item.pushName, item.verifiedName]
    : [item.contact?.name, item.contact?.pushName, item.name, item.notify, item.pushName, item.verifiedName];
  const name = candidates.map((candidate) => usableName(candidate, companyName)).find(Boolean) || "Contato do WhatsApp";
  return {
    phone: rawId.replace(/@(?:s\.whatsapp\.net|c\.us)$/, "").replace(/\D/g, ""),
    name,
    id: rawId,
    source,
  };
};

export async function POST(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!tenantHasModule(tenant, "contacts")) return NextResponse.json({ error: "Contatos não estão incluídos neste plano" }, { status: 403 });
  if (tenant.userId === "demo") return NextResponse.json({ ok: true, found: 24, imported: 24, skipped: 0, unsupported: 0, source: "contacts_and_chats", demo: true });
  if (!tenant.instance || !process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return NextResponse.json({ error: "Conecte o WhatsApp primeiro" }, { status: 409 });

  const apiBase = process.env.EVOLUTION_API_URL.replace(/\/$/, "");
  const evolutionHeaders = { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY };
  const [contactsResponse, chatsResponse] = await Promise.all([
    fetch(`${apiBase}/chat/findContacts/${encodeURIComponent(tenant.instance)}`, { method: "POST", headers: evolutionHeaders, body: JSON.stringify({ where: {} }), cache: "no-store" }).catch(() => null),
    fetch(`${apiBase}/chat/findChats/${encodeURIComponent(tenant.instance)}`, { method: "POST", headers: evolutionHeaders, body: JSON.stringify({ where: {} }), cache: "no-store" }).catch(() => null),
  ]);
  if (!contactsResponse?.ok && !chatsResponse?.ok) return NextResponse.json({ error: "Não foi possível consultar os contatos e conversas do WhatsApp" }, { status: 502 });

  const contactsPayload = contactsResponse?.ok ? await contactsResponse.json().catch(() => []) : [];
  const chatsPayload = chatsResponse?.ok ? await chatsResponse.json().catch(() => []) : [];
  const rawContacts = evolutionRows(contactsPayload, ["contacts"]);
  const rawChats = evolutionRows(chatsPayload, ["chats"]);
  const normalized = [
    ...rawContacts.map((item: any) => normalizeContact(item, "address_book", tenant.companyName)),
    ...rawChats.map((item: any) => normalizeContact(item, "chat", tenant.companyName)),
  ];
  const unsupported = normalized.filter((item) => item.id.includes("@lid") || (!item.id.includes("@g.us") && item.phone.length < 8)).length;
  const valid = normalized.filter((item) => item.phone.length >= 8 && !item.id.includes("@g.us") && !item.id.includes("@lid"));
  const contactsByPhone = new Map<string, (typeof valid)[number]>();
  for (const item of valid) {
    const current = contactsByPhone.get(item.phone);
    const currentHasName = current && usableName(current.name, tenant.companyName);
    const incomingHasName = usableName(item.name, tenant.companyName);
    if (!current || (!currentHasName && incomingHasName) || (current.source === "chat" && item.source === "address_book" && incomingHasName)) contactsByPhone.set(item.phone, item);
  }
  const contacts = [...contactsByPhone.values()];

  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const existing = new Set<string>();
  const existingByPhone = new Map<string, { id: number; name: string }>();
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const existingResponse = await fetch(`${url}/rest/v1/conversations?${conversationScope(tenant.storageMode, tenant.companyId)}&select=id,phone,contact_name&order=updated_at.desc&limit=1000&offset=${offset}`, { headers: serviceHeaders(), cache: "no-store" });
    if (!existingResponse.ok) break;
    const existingRows = await existingResponse.json();
    existingRows.forEach((row: any) => {
      const phone = String(row.phone);
      existing.add(phone);
      if (!existingByPhone.has(phone)) existingByPhone.set(phone, { id: Number(row.id), name: String(row.contact_name || "") });
    });
    if (existingRows.length < 1000) break;
  }
  const fresh = contacts.filter((item) => !existing.has(item.phone));
  const correctable = contacts.filter((item) => {
    const current = existingByPhone.get(item.phone);
    return current && !usableName(current.name, tenant.companyName) && Boolean(usableName(item.name, tenant.companyName));
  });

  let corrected = 0;
  for (let index = 0; index < correctable.length; index += 50) {
    const batch = correctable.slice(index, index + 50);
    const results = await Promise.all(batch.map((item) => fetch(`${url}/rest/v1/conversations?${conversationScope(tenant.storageMode, tenant.companyId)}&phone=eq.${encodeURIComponent(item.phone)}`, {
      method: "PATCH", headers: { ...serviceHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ contact_name: item.name }),
    }).catch(() => null)));
    corrected += results.filter((response) => response?.ok).length;
  }

  for (let index = 0; index < fresh.length; index += 200) {
    const batch = fresh.slice(index, index + 200);
    const inserted = await fetch(`${url}/rest/v1/conversations`, {
      method: "POST",
      headers: { ...serviceHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify(batch.map((item) => ({
        ...conversationRecord(tenant.storageMode, tenant.companyId, {
          imported_from_whatsapp: true,
          contact_only: true,
          manual_action_required: true,
          lead_source: item.source === "chat" ? "Histórico do WhatsApp" : "Agenda do WhatsApp",
        }),
        phone: item.phone,
        contact_name: item.name,
        last_message: "",
        ai_reply: "",
        status: "contact_imported",
        score: 0,
        updated_at: new Date().toISOString(),
      }))),
    });
    if (!inserted.ok) return NextResponse.json({ error: `Foram encontrados ${contacts.length} contatos, mas a importação parou no lote ${Math.floor(index / 200) + 1}. Tente novamente.` }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    found: contacts.length,
    imported: fresh.length,
    corrected,
    skipped: contacts.length - fresh.length,
    unsupported,
    addressBookFound: rawContacts.length,
    chatsFound: rawChats.length,
    source: "contacts_and_chats",
  });
}
