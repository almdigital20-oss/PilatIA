import { NextRequest, NextResponse } from "next/server";
import { getTenant, serviceHeaders } from "../../lib/tenant";

type Usage = { model?: unknown; input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown; estimated_cost_usd?: unknown };

export async function GET(request: NextRequest) {
  const tenant = await getTenant(request);
  if (!tenant) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (tenant.userId === "demo") return NextResponse.json({ inputTokens: 18420, outputTokens: 4970, totalTokens: 23390, estimatedCostUsd: 0.0362, responses: 37, byModel: { "gpt-5.4-mini": 23390 } });

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const queryData: Record<string, string> = { select: "summary,updated_at", updated_at: `gte.${since}`, order: "updated_at.desc", limit: "5000" };
  queryData[tenant.storageMode === "tables" ? "company_id" : "summary->>company_id"] = `eq.${tenant.companyId}`;
  const response = await fetch(`${process.env.SUPABASE_URL?.replace(/\/$/, "")}/rest/v1/conversations?${new URLSearchParams(queryData)}`, { headers: serviceHeaders(), cache: "no-store" });
  if (!response.ok) return NextResponse.json({ inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, responses: 0, byModel: {} });

  const rows = await response.json() as Array<{ summary?: { ai_usage?: Usage } }>;
  const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, responses: 0, byModel: {} as Record<string, number> };
  for (const row of rows) {
    const usage = row.summary?.ai_usage;
    if (!usage) continue;
    const input = Number(usage.input_tokens) || 0;
    const output = Number(usage.output_tokens) || 0;
    const total = Number(usage.total_tokens) || input + output;
    const model = String(usage.model || "não informado");
    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.totalTokens += total;
    totals.estimatedCostUsd += Number(usage.estimated_cost_usd) || 0;
    totals.responses += 1;
    totals.byModel[model] = (totals.byModel[model] || 0) + total;
  }
  totals.estimatedCostUsd = Number(totals.estimatedCostUsd.toFixed(6));
  return NextResponse.json(totals);
}
