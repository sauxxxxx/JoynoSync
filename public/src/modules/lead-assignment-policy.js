function normalizeDepartmentTokens(member) {
  return [member?.team, member?.department]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isInformationTechnologyMember(member) {
  const tokens = normalizeDepartmentTokens(member);
  const department = tokens.join(" ");
  return tokens.includes("it") || department.includes("information technology");
}

export function isLeadAssignableMember(member) {
  const status = String(member?.status || "").trim().toLowerCase();
  const role = String(member?.role || "").trim().toLowerCase();
  return status === "active" && role !== "guest" && !isInformationTechnologyMember(member);
}

export function isActiveSalesMember(member) {
  const status = String(member?.status || "").trim().toLowerCase();
  const role = String(member?.role || "").trim().toLowerCase();
  const departmentTokens = normalizeDepartmentTokens(member);
  return status === "active" && role !== "guest" && departmentTokens.includes("sales");
}
