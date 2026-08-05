import { savePublicInviteRecord } from "../_shared/domain.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }
  if (req.method !== "POST") {
    return methodNotAllowed(req, ["POST"]);
  }

  const auth = await requireCaller(req);
  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const invite = await savePublicInviteRecord(payload);
    return jsonResponse(req, 200, {
      ok: true,
      inviteId: invite.inviteId,
      active: invite.active,
      status: invite.status
    });
  } catch (error) {
    console.error("invite-upsert failed", error);
    return jsonResponse(req, 400, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
