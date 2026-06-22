import { normalizeTaskPermissions } from "../modules/task-rbac.js";
import { initSupabase } from "./init.js";

const TASK_ATTACHMENT_BUCKET = "task-attachments";

function getClient() {
  const services = initSupabase();
  if (!services.configured || !services.client) {
    throw new Error("Supabase is not configured.");
  }
  return services.client;
}

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeIso(value) {
  return normalizeText(value);
}

function normalizeDateOnly(value) {
  const text = normalizeText(value);
  return text ? text.slice(0, 10) : "";
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeInteger(value, fallback = 0, minimum = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(minimum, fallback);
  }
  return Math.max(minimum, Math.round(numeric));
}

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapTaskComment(entry) {
  return {
    id: normalizeText(entry?.id),
    authorId: normalizeText(entry?.authorId),
    author: normalizeText(entry?.author, "Unknown"),
    text: normalizeText(entry?.text),
    createdAt: normalizeIso(entry?.createdAt)
  };
}

function mapTaskChecklistItem(entry) {
  return {
    id: normalizeText(entry?.id),
    label: normalizeText(entry?.label),
    done: normalizeBoolean(entry?.done),
    createdAt: normalizeIso(entry?.createdAt),
    completedAt: normalizeIso(entry?.completedAt)
  };
}

function mapTaskAttachment(entry) {
  return {
    id: normalizeText(entry?.id),
    name: normalizeText(entry?.name),
    size: normalizeNumber(entry?.size, 0),
    type: normalizeText(entry?.type),
    storagePath: normalizeText(entry?.storagePath),
    addedBy: normalizeText(entry?.addedBy, "Unknown"),
    addedById: normalizeText(entry?.addedById),
    createdAt: normalizeIso(entry?.createdAt),
    canDelete: entry?.canDelete === undefined ? true : Boolean(entry?.canDelete)
  };
}

function mapWorkActivity(entry) {
  return {
    id: normalizeText(entry?.id),
    type: normalizeText(entry?.type, "update"),
    actor: normalizeText(entry?.actor, "System"),
    actorId: normalizeText(entry?.actorId),
    text: normalizeText(entry?.text),
    details: entry?.details && typeof entry.details === "object" ? { ...entry.details } : {},
    taskId: normalizeText(entry?.taskId),
    taskTitle: normalizeText(entry?.taskTitle),
    createdAt: normalizeIso(entry?.createdAt)
  };
}

function mapTask(entry) {
  return {
    id: normalizeText(entry?.id),
    workspaceId: normalizeText(entry?.workspaceId),
    title: normalizeText(entry?.title, "Untitled Task"),
    assigneeId: normalizeText(entry?.assigneeId),
    assignee: normalizeText(entry?.assignee),
    dueDate: normalizeDateOnly(entry?.dueDate),
    deadlineAt: normalizeIso(entry?.deadlineAt),
    startTime: normalizeText(entry?.startTime, "09:00"),
    endTime: normalizeText(entry?.endTime),
    time: normalizeText(entry?.time, "09:00"),
    day: normalizeText(entry?.day),
    status: normalizeText(entry?.status, "New"),
    priority: normalizeText(entry?.priority, "low"),
    projectId: normalizeText(entry?.projectId),
    projectName: normalizeText(entry?.projectName),
    linkType: normalizeText(entry?.linkType),
    linkId: normalizeText(entry?.linkId),
    linkLabel: normalizeText(entry?.linkLabel),
    accountName: normalizeText(entry?.accountName),
    account: normalizeText(entry?.account, normalizeText(entry?.accountName)),
    taskType: normalizeText(entry?.taskType, "General"),
    callPhone: normalizeText(entry?.callPhone),
    reminderMinutes: normalizeInteger(entry?.reminderMinutes, 15, 0),
    recurrence: normalizeText(entry?.recurrence, "none").toLowerCase(),
    slaHours: normalizeText(entry?.slaHours),
    notes: normalizeText(entry?.notes),
    completedAt: normalizeIso(entry?.completedAt),
    createdAt: normalizeIso(entry?.createdAt),
    updatedAt: normalizeIso(entry?.updatedAt),
    backlogState: normalizeText(entry?.backlogState, "scheduled").toLowerCase(),
    permissions: normalizeTaskPermissions(entry?.permissions),
    comments: normalizeArray(entry?.comments).map(mapTaskComment),
    checklist: normalizeArray(entry?.checklist).map(mapTaskChecklistItem),
    attachments: normalizeArray(entry?.attachments).map(mapTaskAttachment),
    activity: normalizeArray(entry?.activity).map(mapWorkActivity)
  };
}

function mapProject(entry) {
  return {
    id: normalizeText(entry?.id),
    workspaceId: normalizeText(entry?.workspaceId),
    name: normalizeText(entry?.name, "Untitled Project"),
    ownerId: normalizeText(entry?.ownerId),
    owner: normalizeText(entry?.owner),
    status: normalizeText(entry?.status, "On Track"),
    progress: normalizeInteger(entry?.progress, 0, 0),
    deadline: normalizeDateOnly(entry?.deadline),
    accountId: normalizeText(entry?.accountId),
    accountName: normalizeText(entry?.accountName),
    account: normalizeText(entry?.account, normalizeText(entry?.accountName)),
    teamMemberIds: normalizeArray(entry?.teamMemberIds).map((item) => normalizeText(item)).filter(Boolean),
    teamMembers: normalizeArray(entry?.teamMembers).map((item) => normalizeText(item)).filter(Boolean),
    description: normalizeText(entry?.description),
    risks: normalizeText(entry?.risks),
    activity: normalizeArray(entry?.activity).map(mapWorkActivity),
    createdAt: normalizeIso(entry?.createdAt),
    updatedAt: normalizeIso(entry?.updatedAt)
  };
}

function buildTaskWaitingEntry(task) {
  const dueDate = normalizeDateOnly(task?.dueDate);
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  let status = "none";
  let label = "";
  if (dueDate) {
    if (dueDate < todayIso) {
      status = "overdue";
      label = "Overdue";
    } else if (dueDate === todayIso) {
      status = "today";
      label = "Today";
    } else if (dueDate === tomorrowIso) {
      status = "tomorrow";
      label = "Tomorrow";
    } else {
      label = dueDate;
    }
  }
  return {
    id: task.id,
    title: task.title,
    owner: task.assignee || "Unassigned",
    linkedType: task.linkType || task.taskType || "Task",
    due: {
      dueDate,
      status,
      label
    }
  };
}

function mapSnapshot(data) {
  const snapshot = data && typeof data === "object" ? data : {};
  const tasks = normalizeArray(snapshot.tasks).map(mapTask);
  return {
    tasks,
    projects: normalizeArray(snapshot.projects).map(mapProject),
    waitingList: tasks.filter((task) => task.backlogState === "queue").map(buildTaskWaitingEntry)
  };
}

async function callWorkRpc(functionName, args = {}) {
  const client = getClient();
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    throw error;
  }
  return mapSnapshot(data);
}

function normalizeTaskPayload(payload = {}) {
  return {
    title: normalizeText(payload.title),
    assigneeId: normalizeText(payload.assigneeId) || null,
    dueDate: normalizeDateOnly(payload.dueDate),
    startTime: normalizeText(payload.startTime, "09:00"),
    endTime: normalizeText(payload.endTime),
    priority: normalizeText(payload.priority, "low").toLowerCase(),
    projectId: normalizeText(payload.projectId) || null,
    linkType: normalizeText(payload.linkType),
    linkId: normalizeText(payload.linkId),
    linkLabel: normalizeText(payload.linkLabel),
    accountName: normalizeText(payload.accountName),
    taskType: normalizeText(payload.taskType),
    callPhone: normalizeText(payload.callPhone),
    reminderMinutes: normalizeInteger(payload.reminderMinutes, 15, 0),
    recurrence: normalizeText(payload.recurrence, "none").toLowerCase(),
    slaHours: normalizeText(payload.slaHours),
    notes: normalizeText(payload.notes),
    backlogState: normalizeText(payload.backlogState, "scheduled").toLowerCase(),
    clientRequestId: normalizeText(payload.clientRequestId)
  };
}

function hasOwnTaskPayloadField(payload, field) {
  return Object.prototype.hasOwnProperty.call(payload || {}, field);
}

function normalizeTaskUpdatePayload(payload = {}) {
  const normalized = {};

  if (hasOwnTaskPayloadField(payload, "title")) {
    normalized.title = normalizeText(payload.title);
  }
  if (hasOwnTaskPayloadField(payload, "assigneeId")) {
    normalized.assigneeId = normalizeText(payload.assigneeId) || null;
  }
  if (hasOwnTaskPayloadField(payload, "dueDate")) {
    normalized.dueDate = normalizeDateOnly(payload.dueDate);
  }
  if (hasOwnTaskPayloadField(payload, "startTime")) {
    normalized.startTime = normalizeText(payload.startTime);
  }
  if (hasOwnTaskPayloadField(payload, "endTime")) {
    normalized.endTime = normalizeText(payload.endTime);
  }
  if (hasOwnTaskPayloadField(payload, "priority")) {
    normalized.priority = normalizeText(payload.priority).toLowerCase();
  }
  if (hasOwnTaskPayloadField(payload, "projectId")) {
    normalized.projectId = normalizeText(payload.projectId) || null;
  }
  if (hasOwnTaskPayloadField(payload, "linkType")) {
    normalized.linkType = normalizeText(payload.linkType);
  }
  if (hasOwnTaskPayloadField(payload, "linkId")) {
    normalized.linkId = normalizeText(payload.linkId);
  }
  if (hasOwnTaskPayloadField(payload, "linkLabel")) {
    normalized.linkLabel = normalizeText(payload.linkLabel);
  }
  if (hasOwnTaskPayloadField(payload, "accountName")) {
    normalized.accountName = normalizeText(payload.accountName);
  }
  if (hasOwnTaskPayloadField(payload, "taskType")) {
    normalized.taskType = normalizeText(payload.taskType);
  }
  if (hasOwnTaskPayloadField(payload, "callPhone")) {
    normalized.callPhone = normalizeText(payload.callPhone);
  }
  if (hasOwnTaskPayloadField(payload, "reminderMinutes")) {
    normalized.reminderMinutes =
      payload.reminderMinutes === "" || payload.reminderMinutes === null || payload.reminderMinutes === undefined
        ? ""
        : normalizeInteger(payload.reminderMinutes, 15, 0);
  }
  if (hasOwnTaskPayloadField(payload, "recurrence")) {
    normalized.recurrence = normalizeText(payload.recurrence).toLowerCase();
  }
  if (hasOwnTaskPayloadField(payload, "slaHours")) {
    normalized.slaHours = normalizeText(payload.slaHours);
  }
  if (hasOwnTaskPayloadField(payload, "notes")) {
    normalized.notes = normalizeText(payload.notes);
  }
  if (hasOwnTaskPayloadField(payload, "backlogState")) {
    normalized.backlogState = normalizeText(payload.backlogState).toLowerCase();
  }
  if (hasOwnTaskPayloadField(payload, "clientRequestId")) {
    normalized.clientRequestId = normalizeText(payload.clientRequestId);
  }

  return normalized;
}

function normalizeProjectPayload(payload = {}) {
  return {
    name: normalizeText(payload.name),
    ownerId: normalizeText(payload.ownerId) || null,
    status: normalizeText(payload.status, "On Track"),
    progress: normalizeInteger(payload.progress, 0, 0),
    deadline: normalizeDateOnly(payload.deadline),
    accountId: normalizeText(payload.accountId) || null,
    accountName: normalizeText(payload.accountName),
    teamMemberIds: normalizeArray(payload.teamMemberIds).map((item) => normalizeText(item)).filter(Boolean),
    description: normalizeText(payload.description),
    risks: normalizeText(payload.risks)
  };
}

function sanitizeStorageSegment(value, fallback = "file") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

export function fetchSupabaseWorkSnapshot() {
  return callWorkRpc("get_work_snapshot");
}

export function createSupabaseTask(payload = {}) {
  return callWorkRpc("create_task", {
    p_payload: normalizeTaskPayload(payload)
  });
}

export function updateSupabaseTask(taskId, payload = {}) {
  return callWorkRpc("update_task", {
    p_task_id: normalizeText(taskId),
    p_payload: normalizeTaskUpdatePayload(payload)
  });
}

export function setSupabaseTaskStatus(taskId, status) {
  return callWorkRpc("set_task_status", {
    p_task_id: normalizeText(taskId),
    p_status: normalizeText(status)
  });
}

export function moveSupabaseTaskSchedule(taskId, dueDate, startTime = "", backlogState = "") {
  return callWorkRpc("move_task_schedule", {
    p_task_id: normalizeText(taskId),
    p_due_date: normalizeDateOnly(dueDate),
    p_start_time: normalizeText(startTime) || null,
    p_backlog_state: normalizeText(backlogState) || null
  });
}

export function deleteSupabaseTask(taskId) {
  return callWorkRpc("delete_task", {
    p_task_id: normalizeText(taskId)
  });
}

export function addSupabaseTaskComment(taskId, body) {
  return callWorkRpc("add_task_comment", {
    p_task_id: normalizeText(taskId),
    p_body: normalizeText(body)
  });
}

export function addSupabaseTaskChecklistItem(taskId, label) {
  return callWorkRpc("add_task_checklist_item", {
    p_task_id: normalizeText(taskId),
    p_label: normalizeText(label)
  });
}

export function toggleSupabaseTaskChecklistItem(itemId) {
  return callWorkRpc("toggle_task_checklist_item", {
    p_item_id: normalizeText(itemId)
  });
}

export function deleteSupabaseTaskChecklistItem(itemId) {
  return callWorkRpc("delete_task_checklist_item", {
    p_item_id: normalizeText(itemId)
  });
}

export function createSupabaseProject(payload = {}) {
  return callWorkRpc("create_project", {
    p_payload: normalizeProjectPayload(payload)
  });
}

export function updateSupabaseProject(projectId, payload = {}) {
  return callWorkRpc("update_project", {
    p_project_id: normalizeText(projectId),
    p_payload: normalizeProjectPayload(payload)
  });
}

export function setSupabaseProjectProgress(projectId, progress) {
  return callWorkRpc("set_project_progress", {
    p_project_id: normalizeText(projectId),
    p_progress: normalizeInteger(progress, 0, 0)
  });
}

export function deleteSupabaseProject(projectId) {
  return callWorkRpc("delete_project", {
    p_project_id: normalizeText(projectId)
  });
}

export async function uploadSupabaseTaskAttachment(taskId, workspaceId, file) {
  const client = getClient();
  const normalizedTaskId = normalizeText(taskId);
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedTaskId || !normalizedWorkspaceId || !(file instanceof File)) {
    throw new Error("Attachment upload requires a task, workspace, and file.");
  }

  const storagePath = [
    sanitizeStorageSegment(normalizedWorkspaceId, "workspace"),
    sanitizeStorageSegment(normalizedTaskId, "task"),
    `${Date.now()}-${sanitizeStorageSegment(file.name, "attachment")}`
  ].join("/");

  const { error: uploadError } = await client.storage
    .from(TASK_ATTACHMENT_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: normalizeText(file.type, "application/octet-stream")
    });

  if (uploadError) {
    throw uploadError;
  }

  try {
    return await callWorkRpc("register_task_attachment", {
      p_task_id: normalizedTaskId,
      p_storage_path: storagePath,
      p_file_name: normalizeText(file.name, "attachment"),
      p_mime_type: normalizeText(file.type, "application/octet-stream"),
      p_size_bytes: normalizeInteger(file.size, 0, 0)
    });
  } catch (error) {
    await client.storage.from(TASK_ATTACHMENT_BUCKET).remove([storagePath]).catch(() => null);
    throw error;
  }
}

export async function createSupabaseTaskAttachmentSignedUrl(storagePath, expiresInSeconds = 60) {
  const client = getClient();
  const normalizedStoragePath = normalizeText(storagePath);
  if (!normalizedStoragePath) {
    throw new Error("Attachment path is required.");
  }
  const ttl = Math.max(15, normalizeInteger(expiresInSeconds, 60, 15));
  const { data, error } = await client.storage.from(TASK_ATTACHMENT_BUCKET).createSignedUrl(normalizedStoragePath, ttl);
  if (error) {
    throw error;
  }
  return normalizeText(data?.signedUrl);
}

export async function downloadSupabaseTaskAttachment(storagePath) {
  const client = getClient();
  const normalizedStoragePath = normalizeText(storagePath);
  if (!normalizedStoragePath) {
    throw new Error("Attachment path is required.");
  }
  const { data, error } = await client.storage.from(TASK_ATTACHMENT_BUCKET).download(normalizedStoragePath);
  if (error) {
    throw error;
  }
  return data;
}

export async function deleteSupabaseTaskAttachment(attachmentId, storagePath = "") {
  const client = getClient();
  const normalizedStoragePath = normalizeText(storagePath);
  if (normalizedStoragePath) {
    const { error: storageError } = await client.storage.from(TASK_ATTACHMENT_BUCKET).remove([normalizedStoragePath]);
    if (storageError) {
      throw storageError;
    }
  }
  return callWorkRpc("delete_task_attachment", {
    p_attachment_id: normalizeText(attachmentId)
  });
}
