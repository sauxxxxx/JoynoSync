function createPermissionShape(value) {
  return {
    canView: value,
    canUpdateProgress: value,
    canEditCore: value,
    canReassign: value,
    canDelete: value,
    canUploadAttachment: value,
    canComment: value,
    canManageChecklist: value
  };
}

export function normalizeTaskPermissions(value) {
  if (!value || typeof value !== "object") {
    return createPermissionShape(true);
  }
  const base = createPermissionShape(false);
  return {
    canView: Boolean(value.canView ?? base.canView),
    canUpdateProgress: Boolean(value.canUpdateProgress ?? base.canUpdateProgress),
    canEditCore: Boolean(value.canEditCore ?? base.canEditCore),
    canReassign: Boolean(value.canReassign ?? base.canReassign),
    canDelete: Boolean(value.canDelete ?? base.canDelete),
    canUploadAttachment: Boolean(value.canUploadAttachment ?? base.canUploadAttachment),
    canComment: Boolean(value.canComment ?? value.canUpdateProgress ?? base.canComment),
    canManageChecklist: Boolean(value.canManageChecklist ?? value.canUpdateProgress ?? base.canManageChecklist)
  };
}

export function canTaskUpdateProgress(task) {
  return normalizeTaskPermissions(task?.permissions).canUpdateProgress;
}

export function canTaskEditCore(task) {
  return normalizeTaskPermissions(task?.permissions).canEditCore;
}

export function canTaskReassign(task) {
  return normalizeTaskPermissions(task?.permissions).canReassign;
}

export function canTaskDelete(task) {
  return normalizeTaskPermissions(task?.permissions).canDelete;
}

export function canTaskUploadAttachment(task) {
  return normalizeTaskPermissions(task?.permissions).canUploadAttachment;
}

export function canTaskComment(task) {
  return normalizeTaskPermissions(task?.permissions).canComment;
}

export function canTaskManageChecklist(task) {
  return normalizeTaskPermissions(task?.permissions).canManageChecklist;
}

export function canTaskDeleteAttachment(task, attachment) {
  if (attachment && typeof attachment === "object" && "canDelete" in attachment) {
    return Boolean(attachment.canDelete);
  }
  const permissions = normalizeTaskPermissions(task?.permissions);
  return permissions.canDelete || permissions.canUploadAttachment;
}
