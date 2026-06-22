import { exchangeGoogleToken, fetchGoogleUser, upsertEmailIntegration } from "../_shared/domain.ts";
import { getEnv, getRequiredEnv, handleCors, methodNotAllowed, redirectResponse } from "../_shared/runtime.ts";
import { verifyState } from "../_shared/security.ts";

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
    const authError = String(url.searchParams.get("error") || "").trim();
    if (authError) {
      throw new Error(`Google OAuth error: ${authError}`);
    }

    const code = String(url.searchParams.get("code") || "").trim();
    if (!code) {
      throw new Error("Missing OAuth code");
    }

    const statePayload = (await verifyState(String(url.searchParams.get("state") || ""))) as Record<string, string>;
    const tokenResponse = await exchangeGoogleToken({
      client_id: getRequiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: getRequiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      code,
      redirect_uri: getRequiredEnv("GOOGLE_OAUTH_REDIRECT_URI"),
      grant_type: "authorization_code"
    });

    const refreshToken = String(tokenResponse.refresh_token || "").trim();
    if (!refreshToken) {
      throw new Error("Google did not return refresh token. Reconnect with prompt=consent.");
    }

    const accessToken = String(tokenResponse.access_token || "").trim();
    const profile = await fetchGoogleUser(accessToken);
    const workspaceId = String(statePayload.workspaceId || "").trim();
    const userId = String(statePayload.userId || profile.sub || profile.email || "").trim();
    const integrationId = workspaceId && userId ? `gmail_${workspaceId}_${userId}` : `gmail_${profile.sub || Date.now()}`;

    await upsertEmailIntegration({
      integrationId,
      workspaceId,
      userId,
      email: String(profile.email || "").trim(),
      refreshToken,
      scope: String(tokenResponse.scope || getEnv("GOOGLE_OAUTH_SCOPES", "")).trim()
    });

    const returnUrlRaw =
      String(
        statePayload.returnUrl || getEnv("EMAIL_DEFAULT_RETURN_URL", getEnv("PUBLIC_BASE_URL", "https://joynosync.web.app"))
      ).trim() || getEnv("PUBLIC_BASE_URL", "https://joynosync.web.app");
    const returnUrl = new URL(returnUrlRaw);
    returnUrl.searchParams.set("email", "connected");
    returnUrl.searchParams.set("provider", "gmail");
    returnUrl.searchParams.set("integrationId", integrationId);
    return redirectResponse(req, returnUrl.toString());
  } catch (error) {
    console.error("email-google-auth-callback failed", error);
    const fallback =
      getEnv("EMAIL_DEFAULT_RETURN_URL", getEnv("PUBLIC_BASE_URL", "https://joynosync.web.app")) ||
      getEnv("PUBLIC_BASE_URL", "https://joynosync.web.app");
    const url = new URL(fallback);
    url.searchParams.set("email", "error");
    url.searchParams.set("message", String(error instanceof Error ? error.message : error));
    return redirectResponse(req, url.toString());
  }
});
