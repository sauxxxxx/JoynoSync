import { createServiceClient, getSupabaseUrl } from "../_shared/runtime.ts";
import {
  resolveWorkspaceMemberContext,
  ringCentralRequest
} from "../_shared/ringcentral.ts";
import { handleCors, jsonResponse, methodNotAllowed, requireCaller } from "../_shared/runtime.ts";

function text(value: unknown, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function requiredConfiguration() {
  const names = [
    "RINGCENTRAL_CLIENT_ID",
    "RINGCENTRAL_CLIENT_SECRET",
    "RINGCENTRAL_JWT",
    "RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN"
  ];
  return names.filter((name) => !text(Deno.env.get(name)));
}

async function resolveIntegrationAccess(workspaceId: string, memberId: string) {
  const service = createServiceClient();
  const { data, error } = await service
    .from("team_members")
    .select("role, status")
    .eq("workspace_id", workspaceId)
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  const role = text(data?.role).toLowerCase();
  if (data?.status !== "Active") {
    throw new Error("Only active workspace members can view RingCentral integration status.");
  }
  return {
    role,
    canConnect: ["owner", "admin"].includes(role),
    canOperate: ["owner", "admin", "manager"].includes(role)
  };
}

function webhookUrl() {
  return text(
    Deno.env.get("RINGCENTRAL_WEBHOOK_URL"),
    `${getSupabaseUrl()}/functions/v1/ringcentral-webhook`
  );
}

function extensionRef() {
  return text(
    Deno.env.get("RINGCENTRAL_DEFAULT_EXTENSION_REF") || Deno.env.get("RINGCENTRAL_DEFAULT_EXTENSION_ID"),
    "~"
  );
}

async function loadSubscriptions() {
  const response = await ringCentralRequest("/restapi/v1.0/subscription");
  return Array.isArray(response.records) ? response.records as Record<string, unknown>[] : [];
}

function findWebhookSubscription(records: Record<string, unknown>[], address: string) {
  return records.find((record) => {
    const delivery = record.deliveryMode && typeof record.deliveryMode === "object"
      ? record.deliveryMode as Record<string, unknown>
      : {};
    return text(delivery.address) === address;
  }) || null;
}

async function buildStatus(member: { workspaceId: string; memberId: string }, access: { role: string; canConnect: boolean; canOperate: boolean }) {
  const missing = requiredConfiguration();
  if (missing.length) {
    return {
      ok: true,
      configured: false,
      connected: false,
      status: "needs-setup",
      missing,
      role: access.role,
      canConnect: access.canConnect,
      canOperate: access.canOperate
    };
  }

  const address = webhookUrl();
  const records = await loadSubscriptions();
  const subscription = findWebhookSubscription(records, address);
  const service = createServiceClient();
  const [{ data: identity }, { data: presence }] = await Promise.all([
    service.from("telephony_identities")
      .select("caller_id,direct_number,provider_extension_ref,extension_number,display_name,extension_status,active,updated_at")
      .eq("workspace_id", member.workspaceId)
      .eq("member_id", member.memberId)
      .eq("provider", "ringcentral")
      .maybeSingle(),
    service.from("agent_presence")
      .select("last_provider_sync_at")
      .eq("workspace_id", member.workspaceId)
      .eq("provider", "ringcentral")
      .order("last_provider_sync_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);
  const providerStatus = text(subscription?.status).toLowerCase();
  const connected = Boolean(subscription?.id) && !["blacklisted", "suspended", "expired"].includes(providerStatus);
  return {
    ok: true,
    configured: true,
    connected,
    status: connected ? "connected" : subscription?.id ? "needs-attention" : "not-connected",
    subscriptionId: text(subscription?.id),
    subscriptionStatus: text(subscription?.status),
    expiresAt: text(subscription?.expirationTime),
    webhookUrl: address,
    extensionRef: text(identity?.provider_extension_ref, extensionRef()),
    extensionNumber: text(identity?.extension_number),
    serviceUser: text(identity?.display_name),
    directNumber: text(identity?.direct_number || identity?.caller_id),
    identityActive: identity?.active === true,
    identityUpdatedAt: text(identity?.updated_at),
    lastSyncAt: text(presence?.last_provider_sync_at),
    role: access.role,
    canConnect: access.canConnect,
    canOperate: access.canOperate
  };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (!["GET", "POST"].includes(req.method)) return methodNotAllowed(req, ["GET", "POST"]);

  const auth = await requireCaller(req);
  if (auth.response) return auth.response;

  try {
    const member = await resolveWorkspaceMemberContext({
      uid: auth.caller?.uid,
      email: auth.caller?.email
    });
    const access = await resolveIntegrationAccess(member.workspaceId, member.memberId);

    if (req.method === "GET") {
      return jsonResponse(req, 200, await buildStatus(member, access));
    }

    const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = text(payload.action, "connect").toLowerCase();
    if (!["connect", "disconnect", "test"].includes(action)) {
      return jsonResponse(req, 400, { ok: false, error: "Unsupported RingCentral integration action." });
    }
    if (["connect", "disconnect"].includes(action) && !access.canConnect) {
      return jsonResponse(req, 403, { ok: false, error: "Only an owner or admin can connect or disconnect RingCentral." });
    }
    if (action === "test" && !access.canOperate) {
      return jsonResponse(req, 403, { ok: false, error: "Only an owner, admin, or manager can test RingCentral." });
    }

    const missing = requiredConfiguration();
    if (missing.length) {
      return jsonResponse(req, 503, {
        ok: false,
        ready: false,
        error: "RingCentral synchronization is not fully configured.",
        missing
      });
    }

    const targetWebhookUrl = webhookUrl();
    const validationToken = text(Deno.env.get("RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN"));
    const targetExtensionRef = extensionRef();
    const service = createServiceClient();

    if (action === "test") {
      const providerExtension = await ringCentralRequest(`/restapi/v1.0/account/~/extension/${targetExtensionRef}`);
      return jsonResponse(req, 200, {
        ok: true,
        tested: true,
        accountName: text(providerExtension.contact && typeof providerExtension.contact === "object"
          ? (providerExtension.contact as Record<string, unknown>).company
          : ""),
        extensionName: text(providerExtension.name),
        extensionNumber: text(providerExtension.extensionNumber),
        extensionStatus: text(providerExtension.status)
      });
    }

    const existingRecords = await loadSubscriptions();
    const existingSubscription = findWebhookSubscription(existingRecords, targetWebhookUrl);
    if (action === "disconnect") {
      if (existingSubscription?.id) {
        await ringCentralRequest(`/restapi/v1.0/subscription/${text(existingSubscription.id)}`, { method: "DELETE" });
      }
      const { error: disableError } = await service.from("telephony_identities")
        .update({ active: false })
        .eq("workspace_id", member.workspaceId)
        .eq("provider", "ringcentral");
      if (disableError) throw disableError;
      const { error: settingsError } = await service.from("ringcentral_workspace_settings")
        .update({ active: false })
        .eq("workspace_id", member.workspaceId);
      if (settingsError) throw settingsError;
      return jsonResponse(req, 200, { ok: true, connected: false, status: "not-connected" });
    }

    const { data: mappedIdentities, error: mappingError } = await service.from("telephony_identities")
      .select("provider_extension_ref")
      .eq("workspace_id", member.workspaceId)
      .eq("provider", "ringcentral")
      .eq("active", true);
    if (mappingError) throw mappingError;
    const mappedExtensionRefs = [...new Set(
      (mappedIdentities || []).map((entry) => text(entry.provider_extension_ref)).filter(Boolean)
    )];
    const subscribedExtensionRefs = mappedExtensionRefs.length ? mappedExtensionRefs : [targetExtensionRef];
    const eventFilters = subscribedExtensionRefs.map(
      (providerExtensionRef) => `/restapi/v1.0/account/~/extension/${providerExtensionRef}/telephony/sessions`
    );
    const body = {
      eventFilters,
      deliveryMode: {
        transportType: "WebHook",
        address: targetWebhookUrl,
        validationToken
      }
    };

    const subscription = existingSubscription?.id
      ? await ringCentralRequest(`/restapi/v1.0/subscription/${text(existingSubscription.id)}`, { method: "PUT", body })
      : await ringCentralRequest("/restapi/v1.0/subscription", { method: "POST", body });

    return jsonResponse(req, 200, {
      ok: true,
      ready: true,
      subscriptionId: text(subscription.id),
      status: text(subscription.status),
      expiresAt: text(subscription.expirationTime),
      webhookUrl: targetWebhookUrl,
      eventFilters
    });
  } catch (error) {
    console.error("ringcentral-subscription failed", error);
    const message = String(error instanceof Error ? error.message : error);
    const status = message.startsWith("Only ") ? 403 : 500;
    return jsonResponse(req, status, { ok: false, ready: false, error: message });
  }
});
