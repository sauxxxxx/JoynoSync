import { findPublicInviteRecord } from "../_shared/domain.ts";
import { handleCors, jsonResponse, methodNotAllowed } from "../_shared/runtime.ts";

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
    const inviteId = String(url.searchParams.get("id") || url.searchParams.get("inviteId") || "").trim();
    const token = String(url.searchParams.get("token") || "").trim();
    if (!inviteId && !token) {
      return jsonResponse(req, 400, { ok: false, error: "Invite id is required" });
    }

    const invite = await findPublicInviteRecord({ inviteId, token });
    if (!invite) {
      return jsonResponse(req, 404, { ok: false, error: "Invite not found" });
    }
    if (!invite.active || invite.status !== "Pending Invite") {
      return jsonResponse(req, 410, { ok: false, error: "Invite is no longer active" });
    }

    return jsonResponse(req, 200, {
      ok: true,
      invite: {
        id: invite.inviteId,
        inviteId: invite.inviteId,
        token: invite.token,
        email: invite.email,
        name: invite.name,
        role: invite.role,
        team: invite.team,
        workspace: invite.workspace,
        workspaceId: invite.workspaceId || null,
        invitedBy: invite.invitedBy,
        status: invite.status,
        updatedAt: invite.updatedAt || null
      }
    });
  } catch (error) {
    console.error("invite-resolve failed", error);
    return jsonResponse(req, 500, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});
