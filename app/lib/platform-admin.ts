import { NextRequest } from "next/server";

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

async function signature(payload: string) {
  const secret = process.env.PILATIA_ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret) return "";
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export async function createPlatformAdminSession() {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const payload = `${expiresAt}.${crypto.randomUUID()}`;
  return `${payload}.${await signature(payload)}`;
}

export async function isPlatformAdmin(request: NextRequest) {
  const token = request.cookies.get("pilatia_admin")?.value || "";
  const parts = token.split(".");
  if (parts.length !== 3 || Number(parts[0]) < Date.now()) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = await signature(payload);
  if (!expected || expected.length !== parts[2].length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ parts[2].charCodeAt(index);
  return difference === 0;
}
