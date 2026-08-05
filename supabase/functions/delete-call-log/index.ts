import { createServiceClient, handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";
import { getCallLogById, resolveWorkspaceMemberContext } from "../_shared/ringcentral.ts";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

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
    const callLogId = normalizeText(payload.callLogId);
    if (!callLogId) {
      return jsonResponse(req, 400, { ok: false, error: "Call id is required." });
    }

    const member = await resolveWorkspaceMemberContext({
      uid: auth.caller?.uid,
      email: auth.caller?.email
    });
    const callLog = await getCallLogById(callLogId);
    if (!callLog || String(callLog.workspace_id || "") !== member.workspaceId) {
      return jsonResponse(req, 404, { ok: false, error: "Call record not found." });
    }
    if (String(callLog.member_id || "") !== member.memberId) {
      return jsonResponse(req, 403, { ok: false, error: "This call is not assigned to the current agent." });
    }

    const service = createServiceClient();
    const { error } = await service.from("call_logs").delete().eq("id", callLogId);
    if (error) {
      throw error;
    }

    return jsonResponse(req, 200, {
      ok: true,
      callLogId
    });
  } catch (error) {
    console.error("delete-call-log failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
