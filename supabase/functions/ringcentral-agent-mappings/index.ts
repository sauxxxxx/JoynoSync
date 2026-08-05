import {
  resolveWorkspaceMemberContext,
  ringCentralRequest
} from "../_shared/ringcentral.ts";
import {
  createServiceClient,
  handleCors,
  jsonResponse,
  methodNotAllowed,
  requireCaller
} from "../_shared/runtime.ts";

function text(value: unknown, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function phone(value: unknown) {
  const normalized = text(value).replace(/[^\d+]/g, "");
  return normalized.startsWith("+") ? `+${normalized.slice(1).replace(/\D/g, "")}` : normalized.replace(/\D/g, "");
}

function providerContact(entry: Record<string, unknown>) {
  return entry.contact && typeof entry.contact === "object"
    ? entry.contact as Record<string, unknown>
    : {};
}

function providerExtension(entry: Record<string, unknown>) {
  const contact = providerContact(entry);
  const displayName = text(
    entry.name,
    [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(" ") || `Extension ${text(entry.extensionNumber)}`
  );
  const directNumber = phone(
    contact.businessPhone || contact.companyPhone || contact.mobilePhone || entry.directNumber
  );
  const status = text(entry.status, "Unknown");
  const type = text(entry.type, "User");
  return {
    id: text(entry.id),
    providerUserRef: text(entry.id),
    extensionNumber: text(entry.extensionNumber),
    displayName,
    directNumber,
    callerId: directNumber,
    accountName: text(contact.company),
    status,
    type,
    selectable: status.toLowerCase() === "enabled" && type.toLowerCase() === "user"
  };
}

async function integrationAccess(workspaceId: string, memberId: string) {
  const service = createServiceClient();
  const { data, error } = await service.from("team_members")
    .select("role,status")
    .eq("workspace_id", workspaceId)
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  if (data?.status !== "Active") throw new Error("Only active workspace members can manage RingCentral.");
  const role = text(data?.role).toLowerCase();
  return {
    role,
    canManage: ["owner", "admin"].includes(role),
    canView: true
  };
}

async function loadProviderExtensions() {
  const payload = await ringCentralRequest("/restapi/v1.0/account/~/extension", {
    query: { type: "User", perPage: 1000 }
  });
  const records = Array.isArray(payload.records)
    ? payload.records as Record<string, unknown>[]
    : [];
  return records.map(providerExtension).filter((entry) => entry.id);
}

async function loadSetup(workspaceId: string) {
  const service = createServiceClient();
  const [extensions, membersResult, mappingsResult, settingsResult, unlinkedResult] = await Promise.all([
    loadProviderExtensions(),
    service.from("team_members")
      .select("id,name,email,role,status")
      .eq("workspace_id", workspaceId)
      .eq("status", "Active")
      .order("name", { ascending: true }),
    service.from("telephony_identities")
      .select("id,member_id,caller_id,direct_number,provider_user_ref,provider_extension_ref,extension_number,display_name,extension_status,active,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("provider", "ringcentral")
      .eq("active", true),
    service.from("ringcentral_workspace_settings")
      .select("active,task_owner_policy,unknown_number_policy,multiple_match_policy,activated_at,updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    service.from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("provider", "ringcentral")
      .or("linked_entity_id.is.null,linked_entity_id.eq.")
  ]);
  if (membersResult.error) throw membersResult.error;
  if (mappingsResult.error) throw mappingsResult.error;
  if (settingsResult.error) throw settingsResult.error;
  if (unlinkedResult.error) throw unlinkedResult.error;

  const mappings = (mappingsResult.data || []).map((entry) => ({
    id: text(entry.id),
    memberId: text(entry.member_id),
    callerId: text(entry.caller_id),
    directNumber: text(entry.direct_number),
    providerUserRef: text(entry.provider_user_ref),
    providerExtensionRef: text(entry.provider_extension_ref),
    extensionNumber: text(entry.extension_number),
    displayName: text(entry.display_name),
    extensionStatus: text(entry.extension_status),
    active: entry.active === true,
    updatedAt: text(entry.updated_at)
  }));
  const workflow = settingsResult.data || {};
  return {
    teamMembers: (membersResult.data || []).map((entry) => ({
      id: text(entry.id),
      name: text(entry.name, "Team member"),
      email: text(entry.email),
      role: text(entry.role),
      status: text(entry.status)
    })),
    providerExtensions: extensions,
    mappings,
    mappedCount: mappings.length,
    activeMemberCount: (membersResult.data || []).length,
    unlinkedCallCount: Number(unlinkedResult.count || 0),
    workflow: {
      active: workflow.active === true,
      taskOwnerPolicy: text(workflow.task_owner_policy, "calling-agent"),
      unknownNumberPolicy: text(workflow.unknown_number_policy, "unlinked-calls"),
      multipleMatchPolicy: text(workflow.multiple_match_policy, "manual-selection"),
      activatedAt: text(workflow.activated_at),
      updatedAt: text(workflow.updated_at)
    }
  };
}

async function saveMapping(workspaceId: string, memberId: string, extensionId: string) {
  const service = createServiceClient();
  const { data: member, error: memberError } = await service.from("team_members")
    .select("id,status")
    .eq("workspace_id", workspaceId)
    .eq("id", memberId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member || member.status !== "Active") throw new Error("Choose an active JoynoSync agent.");

  const extensions = await loadProviderExtensions();
  const extension = extensions.find((entry) => entry.id === extensionId);
  if (!extension) throw new Error("The selected RingCentral extension no longer exists.");
  if (!extension.selectable) throw new Error("Only enabled RingCentral user extensions can be mapped.");

  const { data: duplicate, error: duplicateError } = await service.from("telephony_identities")
    .select("member_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "ringcentral")
    .eq("provider_extension_ref", extension.id)
    .eq("active", true)
    .neq("member_id", memberId)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) throw new Error("That RingCentral extension is already mapped to another active agent.");

  const { error } = await service.from("telephony_identities").upsert({
    workspace_id: workspaceId,
    member_id: memberId,
    provider: "ringcentral",
    caller_id: extension.callerId,
    direct_number: extension.directNumber,
    provider_user_ref: extension.providerUserRef,
    provider_extension_ref: extension.id,
    extension_number: extension.extensionNumber,
    display_name: extension.displayName,
    extension_status: extension.status,
    active: true,
    metadata: { accountName: extension.accountName, type: extension.type }
  }, { onConflict: "workspace_id,member_id,provider" });
  if (error) throw error;
}

async function removeMapping(workspaceId: string, memberId: string) {
  const service = createServiceClient();
  const { error } = await service.from("telephony_identities")
    .update({ active: false })
    .eq("workspace_id", workspaceId)
    .eq("member_id", memberId)
    .eq("provider", "ringcentral");
  if (error) throw error;
}

async function saveWorkflow(workspaceId: string, memberId: string, payload: Record<string, unknown>) {
  const taskOwnerPolicy = text(payload.taskOwnerPolicy, "calling-agent");
  const unknownNumberPolicy = text(payload.unknownNumberPolicy, "unlinked-calls");
  if (!["calling-agent", "lead-owner"].includes(taskOwnerPolicy)) throw new Error("Choose a valid task owner policy.");
  if (!["unlinked-calls", "confirm-create"].includes(unknownNumberPolicy)) throw new Error("Choose a valid unknown-number policy.");
  const service = createServiceClient();
  const { error } = await service.from("ringcentral_workspace_settings").upsert({
    workspace_id: workspaceId,
    active: payload.active === true,
    task_owner_policy: taskOwnerPolicy,
    unknown_number_policy: unknownNumberPolicy,
    multiple_match_policy: "manual-selection",
    activated_at: payload.active === true ? new Date().toISOString() : null,
    activated_by_member_id: payload.active === true ? memberId : null
  }, { onConflict: "workspace_id" });
  if (error) throw error;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (!["GET", "POST"].includes(req.method)) return methodNotAllowed(req, ["GET", "POST"]);
  const auth = await requireCaller(req);
  if (auth.response) return auth.response;

  try {
    const member = await resolveWorkspaceMemberContext({ uid: auth.caller?.uid, email: auth.caller?.email });
    const access = await integrationAccess(member.workspaceId, member.memberId);
    if (!access.canView) return jsonResponse(req, 403, { ok: false, error: "Only active workspace members can view RingCentral setup." });
    if (req.method === "GET") return jsonResponse(req, 200, { ok: true, ...(await loadSetup(member.workspaceId)) });
    if (!access.canManage) return jsonResponse(req, 403, { ok: false, error: "Only an Owner or Admin can change RingCentral setup." });

    const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = text(payload.action).toLowerCase();
    if (action === "save-mapping") {
      await saveMapping(member.workspaceId, text(payload.memberId), text(payload.extensionId));
    } else if (action === "remove-mapping") {
      await removeMapping(member.workspaceId, text(payload.memberId));
    } else if (action === "save-workflow") {
      await saveWorkflow(member.workspaceId, member.memberId, payload);
    } else {
      return jsonResponse(req, 400, { ok: false, error: "Unsupported RingCentral setup action." });
    }
    return jsonResponse(req, 200, { ok: true, ...(await loadSetup(member.workspaceId)) });
  } catch (error) {
    console.error("ringcentral-agent-mappings failed", error);
    return jsonResponse(req, 500, { ok: false, error: text(error instanceof Error ? error.message : error, "RingCentral setup failed.") });
  }
});
