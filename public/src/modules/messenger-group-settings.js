function normalizeMemberIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function isActiveMember(member) {
  return String(member?.status || "").trim().toLowerCase() === "active";
}

export function resolveMessengerGroupInitialMemberIds(conversation, teamMembers = [], currentUserId = "") {
  const savedMemberIds = normalizeMemberIds(conversation?.memberIds);
  const activeMemberIds = (teamMembers || []).filter(isActiveMember).map((member) => member?.id);
  const fallbackMemberIds = savedMemberIds.length
    ? savedMemberIds
    : activeMemberIds;
  const normalizedCurrentUserId = String(currentUserId || "").trim();
  const currentUserHasRosterEntry = activeMemberIds.some((memberId) => String(memberId || "").trim() === normalizedCurrentUserId);
  return normalizeMemberIds([
    ...fallbackMemberIds,
    ...(normalizedCurrentUserId && (savedMemberIds.includes(normalizedCurrentUserId) || currentUserHasRosterEntry)
      ? [normalizedCurrentUserId]
      : [])
  ]);
}

export function isMessengerGroupMemberProtected(member, initialMemberIds = [], currentUserId = "") {
  const memberId = String(member?.id || "").trim();
  if (!memberId) {
    return false;
  }
  if (memberId === String(currentUserId || "").trim()) {
    return true;
  }
  const initialMembers = new Set(normalizeMemberIds(initialMemberIds));
  const role = String(member?.role || "").trim().toLowerCase();
  return initialMembers.has(memberId) && (role === "owner" || role === "admin");
}

export function getMessengerGroupRemovedMembers(initialMemberIds = [], nextMemberIds = [], teamMembers = []) {
  const nextMembers = new Set(normalizeMemberIds(nextMemberIds));
  const membersById = new Map((teamMembers || []).map((member) => [String(member?.id || "").trim(), member]));
  return normalizeMemberIds(initialMemberIds)
    .filter((memberId) => !nextMembers.has(memberId))
    .map((memberId) => membersById.get(memberId))
    .filter(Boolean);
}

export function hasMessengerGroupChanges(initialName, nextName, initialMemberIds = [], nextMemberIds = []) {
  const initialIds = normalizeMemberIds(initialMemberIds).sort();
  const nextIds = normalizeMemberIds(nextMemberIds).sort();
  return String(initialName || "").trim() !== String(nextName || "").trim() ||
    initialIds.length !== nextIds.length ||
    initialIds.some((memberId, index) => memberId !== nextIds[index]);
}

export { normalizeMemberIds as normalizeMessengerGroupMemberIds };
