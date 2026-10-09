import { NextRequest, NextResponse } from "next/server";
import { getStorageMode, getTenant, serviceHeaders } from "../../lib/tenant";

export const dynamic = "force-dynamic";
const PLATFORM_ID = "00000000-0000-4000-8000-000000000000";

export async function GET(request: NextRequest) {
  if (!await getTenant(request)) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return NextResponse.json({ tutorials: [] });
  let tutorials: any[] = [];
  let announcements: any[] = [];
  if (await getStorageMode() === "tables") {
    const response = await fetch(`${base}/rest/v1/companies?id=eq.${PLATFORM_ID}&select=settings&limit=1`, { headers: serviceHeaders(), cache: "no-store" });
    const rows = response.ok ? await response.json() : [];
    tutorials = Array.isArray(rows[0]?.settings?.tutorials) ? rows[0].settings.tutorials : [];
    announcements = Array.isArray(rows[0]?.settings?.announcements) ? rows[0].settings.announcements : [];
  } else {
    const response = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders(), cache: "no-store" });
    const payload = response.ok ? await response.json() : {};
    const users = Array.isArray(payload) ? payload : Array.isArray(payload?.users) ? payload.users : [];
    const owner = users.find((user: any) => Array.isArray(user.user_metadata?.pilatia_platform_tutorials) || Array.isArray(user.user_metadata?.pilatia_platform_announcements));
    tutorials = Array.isArray(owner?.user_metadata?.pilatia_platform_tutorials) ? owner.user_metadata.pilatia_platform_tutorials : [];
    announcements = Array.isArray(owner?.user_metadata?.pilatia_platform_announcements) ? owner.user_metadata.pilatia_platform_announcements : [];
  }
  const activeAnnouncements = announcements.filter((item: any) => new Date(item.expiresAt).getTime() > Date.now());
  return NextResponse.json({ tutorials, announcements: activeAnnouncements }, { headers: { "Cache-Control": "no-store" } });
}
