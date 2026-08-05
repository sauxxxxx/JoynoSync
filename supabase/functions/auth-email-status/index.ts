import { createServiceClient } from "../_shared/runtime.ts";
import { handleCors, jsonResponse, methodNotAllowed } from "../_shared/runtime.ts";

function normalizeEmail(value: string | null) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatus(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "active") {
    return "Active";
  }
  if (normalized === "inactive") {
    return "Inactive";
  }
  if (normalized === "pending invite" || normalized === "pending_invite" || normalized === "invited") {
    return "Pending Invite";
  }
  return "";
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (req.method !== "GET") {
    return methodNotAllowed(req, ["GET"]);
  }

  try {
    const url = new URL(req.url);
    const email = normalizeEmail(url.searchParams.get("email"));
    if (!email) {
      return jsonResponse(req, 400, { ok: false, error: "Email is required" });
    }

    const client = createServiceClient();
    const { data, error } = await client
      .from("team_members")
      .select("status, workspace_id")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    const statuses = rows.map((row) => normalizeStatus(row?.status));
    const active = statuses.includes("Active");
    const pending = !active && statuses.includes("Pending Invite");

    return jsonResponse(req, 200, {
      ok: true,
      email,
      recognized: active || pending,
      active,
      pending
    });
  } catch (error) {
    console.error("auth-email-status failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
