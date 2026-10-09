import { NextRequest } from "next/server";
import { costingCall } from "@/lib/costing/server";

export const runtime = "nodejs";

/** GET: the fixed rates behind the cost of each door. PUT {key: number}: change them. */
export async function GET() {
  return costingCall("indigo_cost_settings");
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const vals: Record<string, number> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) vals[k] = v;
  }
  return costingCall("indigo_cost_save_settings", [vals]);
}
