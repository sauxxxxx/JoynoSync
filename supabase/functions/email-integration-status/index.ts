import { findEmailIntegration } from "../_shared/domain.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (req.method !== "GET") {
    return methodNotAllowed(req, ["GET"]);
  }

  const auth = await requireCaller(req);
  if (auth.response) {
    return auth.response;
  }

  try {
    const url = new URL(req.url);
    const workspaceId = String(url.searchParams.get("workspaceId") || "").trim();
    const userId = String(url.searchParams.get("userId") || auth.caller?.uid || "").trim();
    const integrationId = String(url.searchParams.get("integrationId") || "").trim();
    const integration = await findEmailIntegration({ workspaceId, userId, integrationId });

    if (!integration) {
      return jsonResponse(req, 200, {
        ok: true,
        connected: false,
        provider: "gmail",
        email: null,
        integrationId: null,
        updatedAt: null,
        source: null
      });
    }

    return jsonResponse(req, 200, {
      ok: true,
      connected: Boolean(integration.connected),
      provider: integration.provider || "gmail",
      email: integration.email || null,
      integrationId: integration.integrationId || null,
      updatedAt: integration.updatedAt || null,
      source: integration.source || "supabase"
    });
  } catch (error) {
    console.error("email-integration-status failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
