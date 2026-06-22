import { handleCors, jsonResponse, methodNotAllowed, requireCaller, getEnv, getRequiredEnv } from "../_shared/runtime.ts";
import { signState } from "../_shared/security.ts";

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
    const userId = String(url.searchParams.get("userId") || "").trim();
    const returnUrl =
      String(url.searchParams.get("returnUrl") || getEnv("EMAIL_DEFAULT_RETURN_URL", getEnv("PUBLIC_BASE_URL", "https://joynosync.web.app"))).trim();

    const state = await signState({ workspaceId, userId, returnUrl });
    const params = new URLSearchParams({
      client_id: getRequiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
      redirect_uri: getRequiredEnv("GOOGLE_OAUTH_REDIRECT_URI"),
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: getRequiredEnv("GOOGLE_OAUTH_SCOPES"),
      state
    });

    return jsonResponse(req, 200, {
      ok: true,
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    });
  } catch (error) {
    console.error("email-google-auth-start failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
