import { escapeHtml } from "../utils/text.js";
import {
  defaultAttendancePolicy,
  formatAttendanceDuration,
  formatAttendanceDurationClock,
  formatAttendanceTime,
  getAttendanceBreakMinutes,
  getAttendanceBreakSeconds,
  getAttendanceBreakTypeForEntry,
  getAttendanceBreakUsage,
  getAttendanceExpectedWorkedMinutes,
  getAttendanceOpenBreak,
  getAttendancePolicyBreakTypes,
  getAttendanceReferenceShiftContext,
  getAttendanceShiftRelativeMinutesForInstant,
  getAttendanceShiftTiming,
  getAttendanceNormalizedWindowMinutes,
  getAttendanceStatus,
  getAttendanceWorkedMinutes,
  getAttendanceWorkedSeconds,
  getCurrentActiveAttendanceLog,
  getCurrentTodayAttendanceLog,
  isAttendanceWithinWindow
} from "../modules/attendance-core.js";

function attendanceRoleValue(data) {
  const currentRole = String(data.currentUser?.role || "").trim();
  if (currentRole) {
    return currentRole;
  }
  const currentName = String(data.currentUser?.name || "").trim().toLowerCase();
  const memberRole =
    (data.teamMembers || []).find((member) => String(member.name || "").trim().toLowerCase() === currentName)?.role || "";
  return memberRole || "Member";
}

function canManageAttendance(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["owner", "admin", "manager"].includes(normalized);
}

function attendanceUserMatcher(member, fallbackName) {
  const fallback = String(fallbackName || "").trim().toLowerCase();
  const memberId = String(member?.id || "").trim();
  const memberName = String(member?.name || "").trim().toLowerCase();
  return (record) => {
    const recordId = String(record?.userId || "").trim();
    const recordName = String(record?.userName || "").trim().toLowerCase();
    if (recordId && memberId && recordId === memberId) {
      return true;
    }
    if (recordName && memberName && recordName === memberName) {
      return true;
    }
    if (recordName && fallback && recordName === fallback) {
      return true;
    }
    return false;
  };
}

function attendanceStatusClass(status) {
  return String(status || "off")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-");
}

function attendanceActionIcon(actionId) {
  const normalized = String(actionId || "").trim().toLowerCase();
  if (normalized === "attendance-start-break") {
    return "bi bi-pause-circle";
  }
  if (normalized === "attendance-end-break") {
    return "bi bi-play-circle";
  }
  return "bi bi-clock-history";
}

function attendanceFormatMetricClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours} Hr ${String(minutes).padStart(2, "0")} Mins ${String(seconds).padStart(2, "0")} Secs`;
}

function attendanceFormatTodayClockTime(value, timeZone = "") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "--:--:-- --";
  }
  const formatterOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  };
  if (timeZone) {
    formatterOptions.timeZone = timeZone;
  }
  return new Intl.DateTimeFormat("en-US", formatterOptions).format(date);
}

function attendanceFormatTimelineBreakDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} hr${hours === 1 ? "" : "s"}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} min${minutes === 1 ? "" : "s"}`);
  }
  if (!parts.length || (seconds > 0 && hours === 0)) {
    parts.push(`${seconds} sec${seconds === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
}

function attendanceBreakTone(index) {
  return ["is-morning", "is-midday", "is-evening"][index % 3] || "is-morning";
}

function attendanceBreakIcon(index) {
  return ["bi bi-sun", "bi bi-cup-hot", "bi bi-moon-stars"][index % 3] || "bi bi-sun";
}

function attendanceMemberDepartment(member) {
  return String(member?.team || member?.department || "").trim();
}

function attendanceResolvedTimeZone(policy) {
  const timeZone = String(policy?.timezone || "").trim();
  if (!timeZone || timeZone.toLowerCase() === "local") {
    return "";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "";
  }
}

function attendanceDateParts(value, timeZone = "") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    weekDay: weekdayMap[parts.weekday] ?? -1,
    isoDate: parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : ""
  };
}

function attendanceMinutesFromInstant(value, timeZone = "") {
  const parts = attendanceDateParts(value, timeZone);
  if (!parts) {
    return -1;
  }
  return parts.hour * 60 + parts.minute;
}

function attendanceTimeToMinutes(timeValue) {
  const raw = String(timeValue || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return -1;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return -1;
  }
  return hours * 60 + minutes;
}

function attendanceHistoryDateObject(isoDate) {
  const match = String(isoDate || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function attendanceHistoryIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    return "";
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function attendanceShiftHistoryIsoDate(isoDate, dayOffset) {
  const baseDate = attendanceHistoryDateObject(isoDate);
  if (!baseDate) {
    return "";
  }
  baseDate.setUTCDate(baseDate.getUTCDate() + Number(dayOffset || 0));
  return attendanceHistoryIsoDate(baseDate);
}

function attendanceHistoryDatesBetween(startIso, endIso) {
  const startDate = attendanceHistoryDateObject(startIso);
  const endDate = attendanceHistoryDateObject(endIso);
  if (!startDate || !endDate || startDate > endDate) {
    return [];
  }
  const dates = [];
  const cursor = new Date(startDate.getTime());
  while (cursor <= endDate) {
    dates.push(attendanceHistoryIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function attendanceFormatHistoryDate(isoDate, compact = false) {
  const date = attendanceHistoryDateObject(isoDate);
  if (!date) {
    return String(isoDate || "-");
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(compact
      ? { month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" })
  }).format(date);
}

function attendanceFormatHistoryDateNumeric(isoDate) {
  const date = attendanceHistoryDateObject(isoDate);
  if (!date) {
    return String(isoDate || "-");
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function attendanceMinutesFromTimeLabel(label) {
  const raw = String(label || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }
  const hourRaw = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (!Number.isFinite(hourRaw) || !Number.isFinite(minute)) {
    return null;
  }
  const normalizedHour = hourRaw % 12 + (meridiem === "PM" ? 12 : 0);
  return normalizedHour * 60 + minute;
}

function attendanceSortIconClass(sortKey, activeKey, sortDir) {
  if (sortKey !== activeKey || sortDir === "none") {
    return "bi-arrow-down-up";
  }
  return sortDir === "desc" ? "bi-sort-down" : "bi-sort-up";
}

function attendanceHeaderSortButton(label, sortKey, activeKey, sortDir) {
  const isActive = sortKey === activeKey && sortDir !== "none";
  return `
    <button
      type="button"
      class="table-sort-btn ${isActive ? "is-active" : ""}"
      data-action="attendance-table-sort"
      data-id="${sortKey}"
      aria-label="Sort by ${label}"
    >
      <span>${label}</span>
      <i class="bi ${attendanceSortIconClass(sortKey, activeKey, sortDir)}" aria-hidden="true"></i>
    </button>
  `;
}

function attendanceResolveHistoryWindow(rangeValue, startValue, endValue, todayIso) {
  const normalizedRange = String(rangeValue || "today").trim().toLowerCase();
  let startIso = "";
  let endIso = "";
  let label = "Last 7 days";

  if (normalizedRange === "today") {
    startIso = todayIso;
    endIso = todayIso;
    label = "Today";
  } else if (normalizedRange === "week") {
    const todayDate = attendanceHistoryDateObject(todayIso);
    if (todayDate) {
      const offset = (todayDate.getUTCDay() + 6) % 7;
      todayDate.setUTCDate(todayDate.getUTCDate() - offset);
      startIso = attendanceHistoryIsoDate(todayDate);
    }
    endIso = todayIso;
    label = "This week";
  } else if (normalizedRange === "month") {
    const todayDate = attendanceHistoryDateObject(todayIso);
    if (todayDate) {
      todayDate.setUTCDate(1);
      startIso = attendanceHistoryIsoDate(todayDate);
    }
    endIso = todayIso;
    label = "This month";
  } else if (normalizedRange === "yesterday") {
    startIso = attendanceShiftHistoryIsoDate(todayIso, -1);
    endIso = startIso;
    label = "Yesterday";
  } else if (normalizedRange === "30d") {
    startIso = attendanceShiftHistoryIsoDate(todayIso, -29);
    endIso = todayIso;
    label = "Last 30 days";
  } else if (normalizedRange === "custom") {
    const trimmedStart = String(startValue || "").trim();
    const trimmedEnd = String(endValue || "").trim();
    startIso = trimmedStart || trimmedEnd || attendanceShiftHistoryIsoDate(todayIso, -6);
    endIso = trimmedEnd || trimmedStart || todayIso;
    label = "Custom range";
  } else {
    startIso = attendanceShiftHistoryIsoDate(todayIso, -6);
    endIso = todayIso;
  }

  if (startIso && endIso && startIso > endIso) {
    [startIso, endIso] = [endIso, startIso];
  }

  return {
    range: ["today", "week", "month", "yesterday", "7d", "30d", "custom"].includes(normalizedRange) ? normalizedRange : "today",
    startIso,
    endIso,
    label
  };
}

function normalizeAttendanceTablePageSize(value) {
  const numeric = Number(value);
  return [10, 20, 50].includes(numeric) ? numeric : 10;
}

function buildAttendanceTablePagination(totalRecords, page, pageSize) {
  const safePageSize = Math.max(1, normalizeAttendanceTablePageSize(pageSize));
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalRecords) / safePageSize));
  const currentPage = Math.max(1, Math.min(Number(page) || 1, totalPages));
  const startIndex = totalRecords ? (currentPage - 1) * safePageSize : 0;
  const endIndex = Math.min(startIndex + safePageSize, totalRecords);
  return {
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    startIndex,
    endIndex,
    fromRecord: totalRecords ? startIndex + 1 : 0,
    toRecord: totalRecords ? endIndex : 0
  };
}

function renderAttendanceTableFooter(pagination, totalRecords) {
  return `
    <footer class="table-ops-footer">
      <div class="table-ops-page-size">
        <span>Show</span>
        <button type="button" class="crm-page-size-trigger" data-action="attendance-table-page-size-menu">
          <span>${pagination.pageSize}</span>
          <i class="bi bi-chevron-down" aria-hidden="true"></i>
        </button>
        <span>records</span>
      </div>
      <p class="task-meta">Records ${pagination.fromRecord} to ${pagination.toRecord} of ${totalRecords}</p>
      <div class="table-ops-pages">
        <span>${pagination.totalPages} page${pagination.totalPages === 1 ? "" : "s"}</span>
        <button type="button" data-action="attendance-table-page" data-id="${pagination.page - 1}" ${pagination.page <= 1 ? "disabled" : ""}>
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <button type="button" data-action="attendance-table-page" data-id="${pagination.page}" disabled>${pagination.page}</button>
        <button type="button" data-action="attendance-table-page" data-id="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </footer>
  `;
}

function attendanceMonthStartIso(isoDate) {
  const date = attendanceHistoryDateObject(isoDate);
  if (!date) {
    return "";
  }
  date.setUTCDate(1);
  return attendanceHistoryIsoDate(date);
}

function attendanceShiftMonthIso(isoDate, offset = 0) {
  const date = attendanceHistoryDateObject(attendanceMonthStartIso(isoDate));
  if (!date) {
    return "";
  }
  date.setUTCMonth(date.getUTCMonth() + Number(offset || 0), 1);
  return attendanceHistoryIsoDate(date);
}

function attendanceBuildCalendarMeta(monthIso, selectedStartIso, selectedEndIso, todayIso) {
  const monthStart = attendanceHistoryDateObject(attendanceMonthStartIso(monthIso || todayIso));
  if (!monthStart) {
    return { label: "", cells: [] };
  }
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric"
  }).format(monthStart);
  const gridStart = new Date(monthStart.getTime());
  const leadOffset = gridStart.getUTCDay();
  gridStart.setUTCDate(gridStart.getUTCDate() - leadOffset);
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const cellDate = new Date(gridStart.getTime());
    cellDate.setUTCDate(gridStart.getUTCDate() + index);
    const isoDate = attendanceHistoryIsoDate(cellDate);
    const inSelectedRange =
      Boolean(selectedStartIso && selectedEndIso && isoDate >= selectedStartIso && isoDate <= selectedEndIso);
    cells.push({
      isoDate,
      label: String(cellDate.getUTCDate()),
      isOutsideMonth: cellDate.getUTCMonth() !== monthStart.getUTCMonth(),
      isToday: isoDate === todayIso,
      isSelected: inSelectedRange
    });
  }
  return { label: monthLabel, cells };
}

function attendanceOverBreakEntries(record, policy, referenceIso = "", timeZone = attendanceResolvedTimeZone(policy)) {
  const usage = getAttendanceBreakUsage(record, policy, referenceIso, timeZone);
  return getAttendancePolicyBreakTypes(policy)
    .map((entry) => {
      const usageEntry = usage.get(entry.id) || { minutes: 0 };
      const allowedMinutes = Math.max(0, Number(entry.durationMinutes || 0) * Number(entry.maxPerDay || 1));
      const usedMinutes = Math.max(0, Number(usageEntry.minutes || 0));
      const overMinutes = Math.max(0, usedMinutes - allowedMinutes);
      return overMinutes > 0 ? { ...entry, usedMinutes, allowedMinutes, overMinutes } : null;
    })
    .filter(Boolean);
}

function attendanceTimelineEntries(record, policy, timeZone = attendanceResolvedTimeZone(policy)) {
  if (!record?.clockInAt) {
    return [];
  }
  const rows = [{ id: `${record.id}_in`, label: "Clock In", detail: "Shift started", at: record.clockInAt }];
  (Array.isArray(record.breaks) ? record.breaks : []).forEach((entry, index) => {
    const breakType = getAttendanceBreakTypeForEntry(entry, policy, timeZone);
    const breakLabel = breakType?.label || String(entry?.breakTypeLabel || "Break");
    const paidLabel = (breakType ? breakType.paid : Boolean(entry?.paid)) ? "Paid break" : "Unpaid break";
    if (entry?.startAt) {
      rows.push({ id: `${record.id}_break_start_${index}`, label: `${breakLabel} Start`, detail: `${paidLabel} started`, at: entry.startAt });
    }
    if (entry?.endAt) {
      const startTime = Date.parse(String(entry.startAt || ""));
      const endTime = Date.parse(String(entry.endAt || ""));
      const elapsedSeconds =
        Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime
          ? Math.floor((endTime - startTime) / 1000)
          : 0;
      const allowedSeconds = Math.max(0, Number(breakType?.durationMinutes || 0) * 60);
      const isOverBreak = allowedSeconds > 0 && elapsedSeconds > allowedSeconds;
      rows.push({
        id: `${record.id}_break_end_${index}`,
        label: `${breakLabel} End`,
        detail: "Back to work",
        at: entry.endAt,
        durationLabel: elapsedSeconds > 0 ? attendanceFormatTimelineBreakDuration(elapsedSeconds) : "",
        tone: isOverBreak ? "over" : "ok"
      });
    }
  });
  if (record?.clockOutAt) {
    rows.push({ id: `${record.id}_out`, label: "Clock Out", detail: "Shift ended", at: record.clockOutAt });
  }
  return rows.sort((left, right) => Date.parse(String(left.at || "")) - Date.parse(String(right.at || "")));
}

function attendanceTodayTimelineRows(record, policy, referenceIso = "", timeZone = attendanceResolvedTimeZone(policy)) {
  if (!record?.clockInAt) {
    return [];
  }
  const rows = [];
  const referenceMs = Date.parse(String(referenceIso || new Date().toISOString()));
  const safeReferenceMs = Number.isFinite(referenceMs) ? referenceMs : Date.now();
  const clockOutMs = Date.parse(String(record.clockOutAt || ""));
  const shiftDurationSeconds = getAttendanceWorkedSeconds(record, policy, referenceIso);

  rows.push({
    id: `${record.id}_shift`,
    label: "Shift",
    startAt: record.clockInAt,
    endAt: record.clockOutAt || "",
    durationLabel: formatAttendanceDurationClock(shiftDurationSeconds),
    tone: "neutral",
    isShift: true
  });

  (Array.isArray(record.breaks) ? record.breaks : []).forEach((entry, index) => {
    if (!entry?.startAt) {
      return;
    }
    const breakType = getAttendanceBreakTypeForEntry(entry, policy, timeZone);
    const breakLabel = breakType?.label || String(entry?.breakTypeLabel || "Break");
    const startMs = Date.parse(String(entry.startAt || ""));
    let endMs = Date.parse(String(entry.endAt || ""));
    if (!Number.isFinite(endMs)) {
      endMs = Number.isFinite(clockOutMs) ? clockOutMs : safeReferenceMs;
    }
    const elapsedSeconds =
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? Math.floor((endMs - startMs) / 1000)
        : 0;
    const allowedSeconds = Math.max(0, Number(breakType?.durationMinutes || 0) * 60);
    rows.push({
      id: `${record.id}_timeline_break_${index}`,
      label: breakLabel,
      startAt: entry.startAt,
      endAt: entry.endAt || "",
      durationLabel: formatAttendanceDurationClock(elapsedSeconds),
      tone: allowedSeconds > 0 && elapsedSeconds > allowedSeconds ? "over" : "ok",
      breakIndex: index,
      allowedSeconds
    });
  });

  return rows.sort((left, right) => Date.parse(String(left.startAt || "")) - Date.parse(String(right.startAt || "")));
}

export function renderAttendanceUpgrade(data, context) {
  const currentName = String(data.currentUser?.name || "").trim();
  const currentId = String(data.currentUser?.id || "").trim();
  const role = attendanceRoleValue(data);
  const managerMode = canManageAttendance(role);
  const nowIso = String(context.attendanceNowIso || new Date().toISOString());
  const logs = Array.isArray(data.attendanceLogs) ? data.attendanceLogs : [];
  const requests = Array.isArray(data.attendanceRequests) ? data.attendanceRequests : [];
  const policy = {
    ...defaultAttendancePolicy(),
    ...(data.attendancePolicy && typeof data.attendancePolicy === "object" ? data.attendancePolicy : {})
  };
  const breakTypes = getAttendancePolicyBreakTypes(policy);
  policy.breakTypes = breakTypes;
  const resolvedTimeZone = attendanceResolvedTimeZone(policy);
  const nowParts = attendanceDateParts(nowIso, resolvedTimeZone);
  const shiftContext = getAttendanceReferenceShiftContext(nowIso, policy);
  const calendarToday = nowParts?.isoDate || nowIso.slice(0, 10);
  const today = String(shiftContext.shiftDateIso || calendarToday);
  const nowDate = new Date(nowIso);
  const nowMinutes = Number.isFinite(shiftContext.localMinutes)
    ? shiftContext.localMinutes
    : nowParts
      ? nowParts.hour * 60 + nowParts.minute
      : nowDate.getHours() * 60 + nowDate.getMinutes();
  const shiftStartMinutes = Number.isFinite(shiftContext.shiftStartMinutes) ? shiftContext.shiftStartMinutes : 9 * 60;
  const shiftRelativeMinutes = Number.isFinite(shiftContext.relativeMinutes) ? shiftContext.relativeMinutes : nowMinutes;
  const lateAfterMinutes = Math.max(0, Number(policy.lateAfterMinutes ?? policy.graceMinutes ?? 10) || 0);
  const halfDayAfterMinutes = Math.max(0, Number(policy.halfDayAfterMinutes ?? 120) || 0);
  const autoAbsentAfterMinutes = Math.max(0, Number(policy.autoAbsentAfterMinutes ?? 0) || 0);
  const expectedWorkedMinutes = Math.max(0, getAttendanceExpectedWorkedMinutes(policy));
  const teamFilter = ["all", "late", "on-break", "overbreak", "absent", "leave"].includes(String(context.attendanceTeamFilter || "all"))
    ? String(context.attendanceTeamFilter || "all")
    : "all";
  const allMembers = Array.isArray(data.teamMembers) ? data.teamMembers : [];
  const teamSearch = String(context.attendanceTeamSearch || "").trim();
  const teamSearchLower = teamSearch.toLowerCase();
  const teamDepartmentValue = String(context.attendanceTeamDepartment || "all").trim() || "all";
  const departmentOptions = [...new Set(allMembers.map((member) => attendanceMemberDepartment(member)).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
  const currentMember =
    allMembers.find((member) => String(member.id || "").trim() === currentId) ||
    allMembers.find((member) => String(member.name || "").trim().toLowerCase() === currentName.toLowerCase()) ||
    null;

  const activeCurrentRecord = getCurrentActiveAttendanceLog(data);
  const currentTodayRecord = getCurrentTodayAttendanceLog(data, today);
  const summaryRecord = currentTodayRecord || activeCurrentRecord;
  const currentStatusRaw = getAttendanceStatus(activeCurrentRecord);
  const currentStatus =
    currentStatusRaw === "off"
      ? summaryRecord?.clockOutAt
        ? "Clocked Out"
        : "Off Shift"
      : currentStatusRaw === "on-break"
        ? "On Break"
        : "Working";
  const currentPrimaryAction =
    currentStatusRaw === "on-break"
      ? { id: "attendance-end-break", label: "End Break" }
      : currentStatusRaw === "working"
        ? { id: "attendance-start-break", label: "Start Break" }
        : { id: "attendance-clock-in", label: "Clock In" };
  const totalBreak = getAttendanceBreakMinutes(summaryRecord, policy, nowIso, null, resolvedTimeZone);
  const paidBreak = getAttendanceBreakMinutes(summaryRecord, policy, nowIso, true, resolvedTimeZone);
  const unpaidBreak = getAttendanceBreakMinutes(summaryRecord, policy, nowIso, false, resolvedTimeZone);
  const totalWorked = getAttendanceWorkedMinutes(summaryRecord, policy, nowIso, resolvedTimeZone);
  const totalWorkedSeconds = getAttendanceWorkedSeconds(summaryRecord, policy, nowIso);
  const totalBreakSeconds = getAttendanceBreakSeconds(summaryRecord, policy, nowIso, null);
  const breakUsageSummary = getAttendanceBreakUsage(summaryRecord, policy, nowIso, resolvedTimeZone);
  const currentOpenBreak = getAttendanceOpenBreak(activeCurrentRecord);
  const currentOpenBreakType = currentOpenBreak ? getAttendanceBreakTypeForEntry(currentOpenBreak, policy, resolvedTimeZone) : null;
  const currentOpenBreakMinutes = currentOpenBreak
    ? getAttendanceBreakMinutes({ breaks: [currentOpenBreak], clockOutAt: "" }, policy, nowIso, null, resolvedTimeZone)
    : 0;
  const currentOverBreakEntries = attendanceOverBreakEntries(summaryRecord, policy, nowIso, resolvedTimeZone);
  const currentOverBreakTotal = currentOverBreakEntries.reduce((sum, entry) => sum + Number(entry.overMinutes || 0), 0);
  const firstInLabel = summaryRecord?.clockInAt ? formatAttendanceTime(summaryRecord.clockInAt, resolvedTimeZone) : "--";
  const lastOutLabel = summaryRecord?.clockOutAt ? formatAttendanceTime(summaryRecord.clockOutAt, resolvedTimeZone) : "--";
  const todayTimelineRows = attendanceTodayTimelineRows(summaryRecord, policy, nowIso, resolvedTimeZone);
  const currentMemberMatcher = attendanceUserMatcher(
    currentMember || { id: currentId, name: currentName },
    currentName
  );
  const timelineRows = logs
    .filter((record) => currentMemberMatcher(record) && record?.clockInAt)
    .flatMap((record) => {
      const isLiveRecord = Boolean(summaryRecord?.id) && String(summaryRecord.id) === String(record.id || "");
      const recordReferenceIso =
        isLiveRecord
          ? nowIso
          : String(
              record.clockOutAt ||
                [...(Array.isArray(record.breaks) ? record.breaks : [])]
                  .reverse()
                  .find((entry) => entry?.endAt)?.endAt ||
                [...(Array.isArray(record.breaks) ? record.breaks : [])]
                  .reverse()
                  .find((entry) => entry?.startAt)?.startAt ||
                record.clockInAt ||
                nowIso
            ).trim() || nowIso;
      return attendanceTodayTimelineRows(record, policy, recordReferenceIso, resolvedTimeZone).map((entry) => ({
        ...entry,
        dateIso: String(record.date || ""),
        dateLabel: attendanceFormatHistoryDate(String(record.date || ""), false),
        isLiveRecord
      }));
    })
    .sort((left, right) => {
      if (String(left.dateIso || "") !== String(right.dateIso || "")) {
        return String(right.dateIso || "").localeCompare(String(left.dateIso || ""));
      }
      return Date.parse(String(left.startAt || "")) - Date.parse(String(right.startAt || ""));
    });
  const currentTimeLabel = attendanceFormatTodayClockTime(nowIso, resolvedTimeZone);
  const clockSecond = nowDate.getSeconds();
  const clockHour = nowParts?.hour ?? nowDate.getHours();
  const clockMinute = nowParts?.minute ?? nowDate.getMinutes();
  const clockHourDeg = ((clockHour % 12) + clockMinute / 60) * 30;
  const clockMinuteDeg = (clockMinute + clockSecond / 60) * 6;
  const clockSecondDeg = clockSecond * 6;
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const workDays = (Array.isArray(policy.workDays) ? policy.workDays : [1, 2, 3, 4, 5])
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const workDaySet = new Set(workDays);
  const isTodayWorkDay = workDaySet.has(shiftContext.shiftWeekDay ?? nowParts?.weekDay ?? nowDate.getDay());
  const workDaysLabel = workDays
    .map((day) => dayLabels[day] || "")
    .filter(Boolean)
    .join(", ");
  const clockOutButtonLabel = currentStatusRaw === "on-break" ? "End Break + Clock Out" : "Clock Out";
  const hasShiftRecord = Boolean(summaryRecord);
  const isClockedOutState = currentStatusRaw === "off" && Boolean(summaryRecord?.clockOutAt);
  const todayHeroLabel =
    !hasShiftRecord
      ? "Ready to clock in"
      : currentStatusRaw === "on-break"
        ? `${currentOpenBreakType?.label || "Break"} ${formatAttendanceDuration(currentOpenBreakMinutes)}`
        : `${formatAttendanceDuration(totalWorked)} worked`;
  const todayShiftLabel = `${policy.shiftStart} - ${policy.shiftEnd}`;
  const todayPrimaryActionIcon = attendanceActionIcon(currentPrimaryAction.id);
  const todayHeadline =
    !hasShiftRecord
      ? `Shift ${todayShiftLabel}`
      : currentStatusRaw === "on-break"
        ? currentOverBreakTotal > 0
          ? `Over by ${formatAttendanceDuration(currentOverBreakTotal)}`
          : `${currentOpenBreakType?.paid ? "Paid break" : "Break in progress"}`
        : currentStatusRaw === "working"
          ? "On shift right now"
          : "Shift completed";
  const todayAlerts = [];
  const todayMetaLine =
    !hasShiftRecord
      ? `${formatAttendanceDuration(totalBreak)} break`
      : currentStatusRaw === "on-break"
        ? `${formatAttendanceDuration(totalWorked)} worked • Shift ${todayShiftLabel}`
        : `${formatAttendanceDuration(totalBreak)} break • Shift ${todayShiftLabel}`;
  const todayStatusCardNote = todayAlerts.length
    ? `${todayAlerts[0].title}: ${todayAlerts[0].detail}`
    : !hasShiftRecord
      ? `Work days ${workDaysLabel || "Mon-Fri"}`
      : currentStatusRaw === "on-break"
        ? `${currentOpenBreakType?.label || "Break"} is active`
        : isClockedOutState
          ? `Shift ${todayShiftLabel}`
          : `${formatAttendanceDuration(totalWorked)} worked so far`;
  const historyWindow = attendanceResolveHistoryWindow(
    context.attendanceHistoryRange,
    context.attendanceHistoryDateStart,
    context.attendanceHistoryDateEnd,
    today
  );
  const historyMemberValue = String(context.attendanceHistoryMember || "all").trim() || "all";
  const calendarMonthIso = attendanceMonthStartIso(
    String(context.attendanceManagerMonth || "").trim() || historyWindow.endIso || historyWindow.startIso || today
  );
  const calendarMeta = attendanceBuildCalendarMeta(calendarMonthIso, historyWindow.startIso, historyWindow.endIso, calendarToday);

  const matchesManagerMember = (member) => {
    if (!member) {
      return false;
    }
    const memberValue = String(member.id || member.name || "").trim();
    const memberName = String(member.name || memberValue || "Member").trim().toLowerCase();
    const memberEmail = String(member.email || "").trim().toLowerCase();
    const memberDepartment = attendanceMemberDepartment(member).toLowerCase();
    if (historyMemberValue !== "all" && memberValue !== historyMemberValue) {
      return false;
    }
    if (teamDepartmentValue !== "all" && memberDepartment !== String(teamDepartmentValue).trim().toLowerCase()) {
      return false;
    }
    if (teamSearchLower && !memberName.includes(teamSearchLower) && !memberEmail.includes(teamSearchLower)) {
      return false;
    }
    return true;
  };

  if (currentStatusRaw === "on-break" && currentOpenBreakType) {
    todayAlerts.push({
      tone: currentOverBreakTotal > 0 ? "issue" : "break",
      title: currentOverBreakTotal > 0 ? "Overbreak" : "Active Break",
      detail:
        currentOverBreakTotal > 0
          ? `${currentOpenBreakType.label} is over by ${formatAttendanceDuration(currentOverBreakTotal)}.`
          : `${currentOpenBreakType.label} has used ${formatAttendanceDuration(currentOpenBreakMinutes)} so far.`
    });
  }
  if (currentOverBreakEntries.length && currentStatusRaw !== "on-break") {
    todayAlerts.push({
      tone: "issue",
      title: "Break limit exceeded",
      detail: `${currentOverBreakEntries[0].label} ran over by ${formatAttendanceDuration(currentOverBreakEntries[0].overMinutes)}.`
    });
  }

  const breakTrackingRows = breakTypes
    .map((entry, index) => {
      const usage = breakUsageSummary.get(entry.id) || { count: 0, minutes: 0 };
      const allowedMinutes = Math.max(0, Number(entry.durationMinutes || 0) * Number(entry.maxPerDay || 1));
      const usedMinutes = Math.max(0, Number(usage.minutes || 0));
      const overMinutes = Math.max(0, usedMinutes - allowedMinutes);
      const usageRatio = allowedMinutes > 0 ? Math.min(1, usedMinutes / allowedMinutes) : 0;
      const toneClass = attendanceBreakTone(index);
      const iconClass = attendanceBreakIcon(index);
      return `
        <div class="attendance-break-row ${toneClass}">
          <div class="attendance-break-row-main">
            <div class="attendance-break-row-headline">
              <div class="attendance-break-row-title">
                <span class="attendance-break-row-icon ${toneClass}">
                  <i class="${iconClass}" aria-hidden="true"></i>
                </span>
                <div class="attendance-break-row-copy">
                  <strong>${escapeHtml(entry.label)}</strong>
                  <p>${escapeHtml(`${entry.durationMinutes} min | ${entry.paid ? "Paid" : "Unpaid"}`)}</p>
                </div>
              </div>
              <div class="attendance-break-row-meta">
                <span class="attendance-break-chip">${escapeHtml(`${entry.windowStart}-${entry.windowEnd}`)}</span>
                <span class="attendance-break-chip">${escapeHtml(`Used ${usage.count}/${entry.maxPerDay}`)}</span>
                <span class="attendance-break-chip ${overMinutes > 0 ? "is-over" : ""}">${escapeHtml(
                  overMinutes > 0 ? `Over ${formatAttendanceDuration(overMinutes)}` : formatAttendanceDuration(usedMinutes)
                )}</span>
              </div>
            </div>
            <div class="attendance-break-row-progress">
              <span style="width:${usageRatio * 100}%"></span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  const breakPlanRows = breakTypes
    .map((entry) => {
      const usage = breakUsageSummary.get(entry.id) || { count: 0, minutes: 0 };
      const remaining = Math.max(0, Number(entry.maxPerDay || 1) - Number(usage.count || 0));
      const inWindow = isAttendanceWithinWindow(nowMinutes, entry.windowStart, entry.windowEnd);
      return `
        <div class="attendance-break-row">
          <div>
            <strong>${escapeHtml(entry.label)}</strong>
            <p>${escapeHtml(`${entry.durationMinutes} min | ${entry.paid ? "Paid" : "Unpaid"}`)}</p>
          </div>
          <div class="attendance-break-row-meta">
            <span class="attendance-break-chip">${escapeHtml(`${entry.windowStart}-${entry.windowEnd}`)}</span>
            <span class="attendance-break-chip">${escapeHtml(`Used ${usage.count}/${entry.maxPerDay}`)}</span>
            <span class="attendance-break-chip ${inWindow ? "is-open" : ""}">${inWindow ? "Window Open" : "Window Closed"}</span>
            <small>${remaining > 0 ? `${remaining} left` : "No remaining"}</small>
          </div>
        </div>
      `;
    })
    .join("");

  const requiredBreaks = breakTypes.filter((entry) => entry.required || Number(entry.minPerDay || 0) > 0);

  const teamRowsRaw = allMembers
    .filter((member) => matchesManagerMember(member))
    .map((member) => {
      const matchesMember = attendanceUserMatcher(member, "");
      const memberTodayRecord = [...logs]
        .filter((record) => matchesMember(record) && String(record.date || "") === today)
        .sort((left, right) => Date.parse(String(right.clockInAt || "")) - Date.parse(String(left.clockInAt || "")))[0] || null;
      const hasRecord = Boolean(memberTodayRecord);
      const memberOnLeave = String(member.status || "").trim().toLowerCase().includes("leave");
      const absentThreshold = shiftStartMinutes + autoAbsentAfterMinutes;
      const isAutoAbsent = !hasRecord && isTodayWorkDay && autoAbsentAfterMinutes > 0 && shiftRelativeMinutes >= absentThreshold;
      const rawStatus = memberOnLeave ? "leave" : hasRecord ? getAttendanceStatus(memberTodayRecord) : isAutoAbsent ? "absent" : "off";
      const displayStatus =
        rawStatus === "leave"
          ? "On Leave"
          : rawStatus === "off" && hasRecord
            ? "Clocked Out"
            : rawStatus === "on-break"
              ? "On Break"
              : rawStatus === "working"
                ? "Working"
                : rawStatus === "absent"
                  ? "Absent"
                  : "Off";
      const memberBreak = getAttendanceBreakMinutes(memberTodayRecord, policy, nowIso, null, resolvedTimeZone);
      const memberWorked = getAttendanceWorkedMinutes(memberTodayRecord, policy, nowIso, resolvedTimeZone);
      const memberUsage = getAttendanceBreakUsage(memberTodayRecord, policy, nowIso, resolvedTimeZone);
      const firstIn = memberTodayRecord?.clockInAt ? formatAttendanceTime(memberTodayRecord.clockInAt, resolvedTimeZone) : "--";
      const firstInMinutes = getAttendanceShiftRelativeMinutesForInstant(memberTodayRecord?.clockInAt, policy, resolvedTimeZone);
      const completedExpectedWork = expectedWorkedMinutes > 0 && memberWorked >= expectedWorkedMinutes;
      const isHalfDay =
        firstInMinutes >= 0 &&
        halfDayAfterMinutes > 0 &&
        !completedExpectedWork &&
        firstInMinutes > shiftStartMinutes + halfDayAfterMinutes;
      const isLate = firstInMinutes >= 0 && !isHalfDay && firstInMinutes > shiftStartMinutes + lateAfterMinutes;
      const unresolvedRequired = requiredBreaks.filter((entry) => {
        const usage = memberUsage.get(entry.id);
        const needed = Math.max(entry.required ? 1 : 0, Number(entry.minPerDay || 0));
        return (usage?.count || 0) < needed;
      });
      const referenceMinutes = getAttendanceShiftRelativeMinutesForInstant(memberTodayRecord?.clockOutAt || nowIso, policy, resolvedTimeZone);
      const missingRequired = unresolvedRequired.filter((entry) => {
        const windowRange = getAttendanceNormalizedWindowMinutes(entry.windowStart, entry.windowEnd, policy);
        if (windowRange.endMinutes < 0) {
          return true;
        }
        return referenceMinutes > windowRange.endMinutes;
      });
      const memberOverBreakEntries = attendanceOverBreakEntries(memberTodayRecord, policy, nowIso, resolvedTimeZone);
      const memberOverBreakTotal = memberOverBreakEntries.reduce((sum, entry) => sum + Number(entry.overMinutes || 0), 0);
      const openBreak = getAttendanceOpenBreak(memberTodayRecord);
      const openBreakType = openBreak ? getAttendanceBreakTypeForEntry(openBreak, policy, resolvedTimeZone) : null;
      const openBreakMinutes = openBreak
        ? getAttendanceBreakMinutes({ breaks: [openBreak], clockOutAt: "" }, policy, nowIso, null, resolvedTimeZone)
        : 0;
      const flags = [];
      if (rawStatus === "leave") {
        flags.push({ tone: "leave", label: "On leave" });
      }
      if (isHalfDay) {
        flags.push({ tone: "half-day", label: "Half day" });
      } else if (isLate) {
        flags.push({ tone: "late", label: "Late" });
      }
      if (rawStatus === "absent") {
        flags.push({ tone: "absent", label: "Absent" });
      }
      if (memberOverBreakTotal > 0) {
        flags.push({ tone: "issue", label: `Overbreak ${formatAttendanceDuration(memberOverBreakTotal)}` });
      }
      if (rawStatus === "on-break" && openBreakType) {
        flags.push({ tone: "break", label: `${openBreakType.label} ${formatAttendanceDuration(openBreakMinutes)}` });
      }
      return {
        member,
        rawStatus,
        displayStatus,
        firstIn,
        breakLabel:
          rawStatus === "on-break" && openBreakType
            ? `${openBreakType.label} | ${formatAttendanceDuration(openBreakMinutes)}`
            : formatAttendanceDuration(memberBreak),
        workedLabel: formatAttendanceDuration(memberWorked),
        compliance:
          rawStatus === "leave"
            ? "Approved leave"
            : rawStatus === "absent"
              ? "No clock-in record"
              : memberOverBreakEntries.length
                ? `${memberOverBreakEntries[0].label} over by ${formatAttendanceDuration(memberOverBreakEntries[0].overMinutes)}`
                : missingRequired.length
                  ? `Missing ${missingRequired.map((entry) => entry.label).join(", ")}`
                  : unresolvedRequired.length
                    ? "Break window still open"
                    : hasRecord
                      ? "Within policy"
                      : isTodayWorkDay
                        ? shiftRelativeMinutes >= shiftStartMinutes
                          ? "Waiting for clock in"
                          : "Before shift start"
                        : "No shift today",
        complianceTone:
          rawStatus === "absent" || memberOverBreakEntries.length || missingRequired.length
            ? "issue"
            : unresolvedRequired.length || (!hasRecord && isTodayWorkDay)
              ? "pending"
              : "ok",
        flags,
        isLate,
        isHalfDay,
        isOnLeave: rawStatus === "leave",
        overBreakTotal: memberOverBreakTotal
      };
    });

  const teamLiveStats = {
    working: teamRowsRaw.filter((row) => row.rawStatus === "working").length,
    onBreak: teamRowsRaw.filter((row) => row.rawStatus === "on-break").length,
    overBreak: teamRowsRaw.filter((row) => row.overBreakTotal > 0).length,
    absent: teamRowsRaw.filter((row) => row.rawStatus === "absent").length,
    onLeave: teamRowsRaw.filter((row) => row.isOnLeave).length
  };

  const historyMembers = (managerMode ? allMembers : [currentMember || data.currentUser || { id: currentId, name: currentName }])
    .filter(Boolean)
    .filter((member) => matchesManagerMember(member));
  const historyDates = attendanceHistoryDatesBetween(historyWindow.startIso, historyWindow.endIso)
    .filter((isoDate) => isoDate && isoDate <= today)
    .reverse();
  const historyRowsRaw = [];
  historyMembers.forEach((member) => {
    const memberValue = String(member.id || member.name || "").trim();
    const matchesMember = attendanceUserMatcher(member, "");
    const memberDepartment = attendanceMemberDepartment(member);
    const memberOnLeave = String(member.status || "").trim().toLowerCase().includes("leave");
    historyDates.forEach((dateIso) => {
      const memberRecord = [...logs]
        .filter((record) => matchesMember(record) && String(record.date || "") === dateIso)
        .sort((left, right) => Date.parse(String(right.clockInAt || "")) - Date.parse(String(left.clockInAt || "")))[0] || null;
      const dayObject = attendanceHistoryDateObject(dateIso);
      const workDay = workDaySet.has(dayObject ? dayObject.getUTCDay() : -1);
      const isPastDay = dateIso < today;
      const absentThreshold = shiftStartMinutes + autoAbsentAfterMinutes;
      const canMarkAbsentToday = autoAbsentAfterMinutes > 0 && shiftRelativeMinutes >= absentThreshold;
      const isOnLeaveToday = dateIso === today && memberOnLeave;
      if (!memberRecord) {
        if (!workDay) {
          return;
        }
        historyRowsRaw.push({
          key: `${memberValue || member.name || "member"}:${dateIso}:${isOnLeaveToday ? "leave" : isPastDay || canMarkAbsentToday ? "absent" : "pending"}`,
          memberKey: memberValue,
          departmentLabel: memberDepartment,
          logId: "",
          dateIso,
          dateLabel: attendanceFormatHistoryDate(dateIso),
          memberName: String(member.name || memberValue || "Member"),
          statusLabel: isOnLeaveToday ? "On Leave" : isPastDay || canMarkAbsentToday ? "Absent" : "Pending",
          statusTone: isOnLeaveToday ? "leave" : isPastDay || canMarkAbsentToday ? "absent" : "pending",
          activityLabel: isOnLeaveToday ? "On leave" : isPastDay || canMarkAbsentToday ? "No punches" : "Waiting for clock in",
          activityTone: isOnLeaveToday ? "leave" : isPastDay || canMarkAbsentToday ? "absent" : "pending",
          firstInLabel: "--",
          lastOutLabel: "--",
          workedLabel: "0m",
          breakLabel: "0m",
          overBreakLabel: "--",
          workedMinutes: 0,
          breakMinutes: 0,
          compliance: isOnLeaveToday ? "Approved leave" : isPastDay || canMarkAbsentToday ? "No clock-in record" : "Before absent threshold",
          complianceTone: isOnLeaveToday ? "is-ok" : isPastDay || canMarkAbsentToday ? "is-issue" : "is-pending",
          flags: [{ tone: isOnLeaveToday ? "leave" : isPastDay || canMarkAbsentToday ? "absent" : "pending", label: isOnLeaveToday ? "On leave" : isPastDay || canMarkAbsentToday ? "Absent" : "Pending" }],
          hasRecord: false,
          isAbsent: !isOnLeaveToday && (isPastDay || canMarkAbsentToday),
          isLate: false,
          isHalfDay: false,
          isOnLeave: isOnLeaveToday,
          overBreakTotal: 0,
          timelineRows: []
        });
        return;
      }

      const rawStatus = getAttendanceStatus(memberRecord);
      const firstInMinutes = getAttendanceShiftRelativeMinutesForInstant(memberRecord.clockInAt, policy, resolvedTimeZone);
      const memberBreak = getAttendanceBreakMinutes(memberRecord, policy, nowIso, null, resolvedTimeZone);
      const memberWorked = getAttendanceWorkedMinutes(memberRecord, policy, nowIso, resolvedTimeZone);
      const completedExpectedWork = expectedWorkedMinutes > 0 && memberWorked >= expectedWorkedMinutes;
      const isHalfDay =
        firstInMinutes >= 0 &&
        halfDayAfterMinutes > 0 &&
        !completedExpectedWork &&
        firstInMinutes > shiftStartMinutes + halfDayAfterMinutes;
      const isLate = firstInMinutes >= 0 && !isHalfDay && firstInMinutes > shiftStartMinutes + lateAfterMinutes;
      const overBreakEntries = attendanceOverBreakEntries(memberRecord, policy, nowIso, resolvedTimeZone);
      const overBreakTotal = overBreakEntries.reduce((sum, entry) => sum + Number(entry.overMinutes || 0), 0);
      const flags = [];
      if (isHalfDay) {
        flags.push({ tone: "half-day", label: "Half day" });
      } else if (isLate) {
        flags.push({ tone: "late", label: "Late" });
      }
      if (overBreakTotal > 0) {
        flags.push({ tone: "issue", label: `Overbreak ${formatAttendanceDuration(overBreakTotal)}` });
      }
      const liveStatusLabel =
        rawStatus === "on-break"
          ? "On Break"
          : rawStatus === "working"
            ? "Working"
            : memberRecord.clockOutAt
              ? "Clocked Out"
              : "Pending";
      const liveStatusTone =
        rawStatus === "on-break"
          ? "on-break"
          : rawStatus === "working"
            ? "working"
            : memberRecord.clockOutAt
              ? "clocked-out"
              : "pending";
      const statusLabel =
        dateIso === today
          ? liveStatusLabel
          : isHalfDay
            ? "Half Day"
            : isLate
              ? "Late"
              : "Present";
      const statusTone =
        dateIso === today
          ? liveStatusTone
          : isHalfDay
            ? "half-day"
            : isLate
              ? "late"
              : "present";
      historyRowsRaw.push({
        key: `${memberValue || member.name || "member"}:${dateIso}:${memberRecord.id}`,
        memberKey: memberValue,
        departmentLabel: memberDepartment,
        logId: String(memberRecord.id || "").trim(),
        dateIso,
        dateLabel: attendanceFormatHistoryDate(dateIso),
        memberName: String(member.name || memberValue || "Member"),
        statusLabel,
        statusTone,
        activityLabel:
          dateIso === today
            ? rawStatus === "on-break"
              ? "On Break"
              : rawStatus === "working"
                ? "Working"
                : "Clocked Out"
            : memberRecord.clockOutAt
              ? "Completed"
              : "Open session",
        activityTone:
          rawStatus === "on-break" ? "on-break" : rawStatus === "working" ? "working" : memberRecord.clockOutAt ? "off" : "pending",
        firstInLabel: memberRecord.clockInAt ? formatAttendanceTime(memberRecord.clockInAt, resolvedTimeZone) : "--",
        lastOutLabel: memberRecord.clockOutAt ? formatAttendanceTime(memberRecord.clockOutAt, resolvedTimeZone) : "--",
        workedLabel: formatAttendanceDuration(memberWorked),
        breakLabel: formatAttendanceDuration(memberBreak),
        overBreakLabel: overBreakTotal > 0 ? formatAttendanceDuration(overBreakTotal) : "--",
        workedMinutes: memberWorked,
        breakMinutes: memberBreak,
        compliance:
          overBreakTotal > 0
            ? `${overBreakEntries[0].label} over by ${formatAttendanceDuration(overBreakEntries[0].overMinutes)}`
            : isHalfDay
              ? "Started beyond half-day threshold"
              : isLate
                ? "Started late"
                : "Within policy",
        complianceTone: overBreakTotal > 0 || isLate || isHalfDay ? "is-issue" : "is-ok",
        flags,
        hasRecord: true,
        isAbsent: false,
        isLate,
        isHalfDay,
        isOnLeave: false,
        overBreakTotal,
        timelineRows: attendanceTimelineEntries(memberRecord, policy, resolvedTimeZone)
      });
    });
  });

  const historyRowsFiltered = historyRowsRaw.filter((row) => {
    if (teamFilter === "late") {
      return row.isLate || row.isHalfDay;
    }
    if (teamFilter === "overbreak") {
      return row.overBreakTotal > 0;
    }
    if (teamFilter === "absent") {
      return row.isAbsent;
    }
    if (teamFilter === "leave") {
      return row.isOnLeave;
    }
    if (teamFilter === "on-break") {
      return row.activityTone === "on-break";
    }
    return true;
  });
  const historyWindowIsSingleDay = historyWindow.startIso === historyWindow.endIso;
  const isTodayManagerRange = historyWindow.startIso === today && historyWindow.endIso === today;
  const requestedAttendanceSortKey = String(context.attendanceSortKey || "").trim();
  const requestedAttendanceSortDir =
    context.attendanceSortDir === "asc" || context.attendanceSortDir === "desc" ? context.attendanceSortDir : "none";
  const activeAttendanceSortKey =
    requestedAttendanceSortKey ||
    (isTodayManagerRange ? "status" : "date");
  const activeAttendanceSortDir =
    requestedAttendanceSortDir !== "none" ? requestedAttendanceSortDir : isTodayManagerRange ? "asc" : "desc";
  const statusPriorityForAttendanceRow = (row) => {
    if (row.overBreakTotal > 0) {
      return 0;
    }
    if (row.activityTone === "on-break") {
      return 1;
    }
    if (row.isLate || row.isHalfDay) {
      return 2;
    }
    if (row.activityTone === "pending" || row.statusTone === "pending") {
      return 3;
    }
    if (row.isAbsent) {
      return 4;
    }
    if (row.isOnLeave) {
      return 5;
    }
    return 6;
  };
  const sortableHistoryRows = [...historyRowsFiltered];
  const compareAttendanceRows = (left, right) => {
    const textCompare = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
    const numberCompare = (a, b, emptyLast = true) => {
      const leftEmpty = a === null || a === undefined || Number.isNaN(a);
      const rightEmpty = b === null || b === undefined || Number.isNaN(b);
      if (leftEmpty && rightEmpty) {
        return 0;
      }
      if (leftEmpty) {
        return emptyLast ? 1 : -1;
      }
      if (rightEmpty) {
        return emptyLast ? -1 : 1;
      }
      return Number(a) - Number(b);
    };
    switch (activeAttendanceSortKey) {
      case "employee":
        return textCompare(left.memberName, right.memberName) || textCompare(left.departmentLabel, right.departmentLabel);
      case "date":
        return textCompare(left.dateIso, right.dateIso) || textCompare(left.memberName, right.memberName);
      case "timeIn":
        return numberCompare(left.hasRecord ? attendanceMinutesFromTimeLabel(left.firstInLabel) : null, right.hasRecord ? attendanceMinutesFromTimeLabel(right.firstInLabel) : null) || textCompare(left.memberName, right.memberName);
      case "timeOut":
        return numberCompare(left.lastOutLabel !== "--" ? attendanceMinutesFromTimeLabel(left.lastOutLabel) : null, right.lastOutLabel !== "--" ? attendanceMinutesFromTimeLabel(right.lastOutLabel) : null) || textCompare(left.memberName, right.memberName);
      case "break":
        return numberCompare(left.breakMinutes, right.breakMinutes) || textCompare(left.memberName, right.memberName);
      case "hours":
        return numberCompare(left.workedMinutes, right.workedMinutes) || textCompare(left.memberName, right.memberName);
      case "status":
        return numberCompare(statusPriorityForAttendanceRow(left), statusPriorityForAttendanceRow(right), false) || textCompare(left.memberName, right.memberName);
      default:
        return 0;
    }
  };
  if (activeAttendanceSortKey && activeAttendanceSortDir !== "none") {
    const direction = activeAttendanceSortDir === "desc" ? -1 : 1;
    sortableHistoryRows.sort((left, right) => compareAttendanceRows(left, right) * direction);
  }
  const allHistoryRows = sortableHistoryRows;
  const tablePagination = buildAttendanceTablePagination(
    allHistoryRows.length,
    Number(context.attendanceTablePage || 1),
    Number(context.attendanceTablePageSize || 10)
  );
  const historyRows = allHistoryRows.slice(tablePagination.startIndex, tablePagination.endIndex);
  const selectedHistoryEntry =
    historyRows.find((entry) => entry.key === String(context.attendanceHistorySelectedLogId || "").trim()) || null;

  const managerSummary = {
    present: historyRowsFiltered.filter((row) => row.hasRecord && !row.isAbsent && !row.isOnLeave).length,
    absent: historyRowsFiltered.filter((row) => row.isAbsent).length,
    late: historyRowsFiltered.filter((row) => row.isLate || row.isHalfDay).length,
    overBreak: historyRowsFiltered.filter((row) => row.overBreakTotal > 0).length,
    onLeave: historyRowsFiltered.filter((row) => row.isOnLeave).length,
    workedMinutes: historyRowsFiltered.reduce((sum, row) => sum + Number(row.workedMinutes || 0), 0)
  };
  const managerTopbarTitle =
    historyWindow.range === "today"
      ? "Today"
      : historyWindow.range === "week"
        ? "This Week"
        : historyWindow.range === "month"
          ? "This Month"
          : historyWindow.range === "yesterday"
            ? "Yesterday"
            : historyWindow.range === "7d"
              ? "Last 7 Days"
              : historyWindow.range === "30d"
                ? "Last 30 Days"
                : historyWindowIsSingleDay
                  ? attendanceFormatHistoryDate(historyWindow.startIso)
                  : "Custom Range";
  const managerTopbarRangeLabel =
    isTodayManagerRange || (historyWindow.range === "custom" && historyWindowIsSingleDay)
      ? ""
      : `${attendanceFormatHistoryDate(historyWindow.startIso, true)} - ${attendanceFormatHistoryDate(historyWindow.endIso, true)}`;
  const managerSummaryCards = isTodayManagerRange
    ? [
        { label: "Working", value: teamLiveStats.working, detail: "Clocked in right now" },
        { label: "On Break", value: teamLiveStats.onBreak, detail: "Currently away from desk" },
        { label: "Overbreak", value: teamLiveStats.overBreak, detail: "Exceeded allowed break time" },
        { label: "Absent", value: teamLiveStats.absent, detail: "Missing attendance today" }
      ]
    : [
        { label: "Present", value: managerSummary.present, detail: "Worked in selected range" },
        { label: "Absent", value: managerSummary.absent, detail: "No punches recorded" },
        { label: "Late", value: managerSummary.late, detail: "Late or half-day starts" },
        { label: "On Leave", value: managerSummary.onLeave, detail: "Approved leave coverage" }
      ];
  const renderAttendanceManagerHistoryRows = (rows) =>
    rows.length
      ? rows
          .map(
            (row) => `
              <tr class="${selectedHistoryEntry?.key === row.key ? "is-selected" : ""}">
                <td>
                  <div class="attendance-manager-namecell">
                    <strong>${escapeHtml(row.memberName)}</strong>
                    <small>${escapeHtml(row.departmentLabel || "No department")} Â· ${escapeHtml(row.activityLabel)}</small>
                  </div>
                </td>
                <td>${escapeHtml(attendanceFormatHistoryDateNumeric(row.dateIso))}</td>
                <td>${escapeHtml(row.firstInLabel)}</td>
                <td>${escapeHtml(row.lastOutLabel)}</td>
                <td>${escapeHtml(row.breakLabel)}</td>
                <td>${escapeHtml(row.workedLabel)}</td>
                <td>
                  <div class="attendance-manager-statuscell">
                    <span class="attendance-status-pill is-${escapeHtml(row.statusTone)}">${escapeHtml(row.statusLabel)}</span>
                    <small>${escapeHtml(row.compliance)}</small>
                  </div>
                </td>
                <td>
                  <div class="attendance-manager-row-actions">
                    <button
                      type="button"
                      class="attendance-table-icon-btn ${selectedHistoryEntry?.key === row.key ? "is-active" : ""}"
                      data-action="attendance-history-select"
                      data-id="${escapeHtml(row.key)}"
                      aria-label="View daily timeline"
                      title="View daily timeline"
                    >
                      <i class="bi bi-eye" aria-hidden="true"></i>
                    </button>
                    <button
                      type="button"
                      class="attendance-table-icon-btn"
                      data-action="attendance-manual-entry"
                      data-id="${escapeHtml(`${row.memberKey}::${row.dateIso}`)}"
                      aria-label="${row.logId ? "Edit attendance" : "Add attendance"}"
                      title="${row.logId ? "Edit attendance" : "Add attendance"}"
                    >
                      <i class="bi ${row.logId ? "bi-pencil-square" : "bi-plus-square"}" aria-hidden="true"></i>
                    </button>
                  </div>
                </td>
              </tr>
            `
          )
          .join("")
      : "<tr><td colspan='8' class='task-meta'>No attendance rows for this filter.</td></tr>";

  const visibleRequests = (managerMode
    ? requests
    : requests.filter((entry) => {
        const entryName = String(entry.userName || "").trim().toLowerCase();
        const entryId = String(entry.userId || "").trim();
        return (currentId && entryId && entryId === currentId) || (currentName && entryName === currentName.toLowerCase());
      }))
    .slice()
    .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")));

  const availableTabs = managerMode ? ["today", "team", "requests", "policy"] : ["today", "requests", "policy"];
  const requestedTab = String(context.attendanceTab || "today").toLowerCase();
  const activeTab =
    requestedTab === "history" && managerMode ? "team" : availableTabs.includes(requestedTab) ? requestedTab : "today";

  return {
    title: "Attendance",
    subtitle: "Time in/out, breaks, and team attendance visibility",
    primaryAction: "Request Fix",
    showWaitingPanel: false,
    html: `
      <section class="view-block attendance-view attendance-v2">
        <nav class="attendance-v2-tabs" aria-label="Attendance sections">
          <button type="button" class="attendance-tab-btn ${activeTab === "today" ? "is-active" : ""}" data-action="attendance-tab" data-id="today">Timeline</button>
          ${
            managerMode
              ? `<button type="button" class="attendance-tab-btn ${activeTab === "team" ? "is-active" : ""}" data-action="attendance-tab" data-id="team">Team Attendance</button>`
              : ""
          }
          <button type="button" class="attendance-tab-btn ${activeTab === "requests" ? "is-active" : ""}" data-action="attendance-tab" data-id="requests">${
            managerMode ? "Requests" : "My Requests"
          }</button>
          <button type="button" class="attendance-tab-btn ${activeTab === "policy" ? "is-active" : ""}" data-action="attendance-tab" data-id="policy">Policy</button>
        </nav>

        <div class="attendance-v2-panels">
          ${
            activeTab === "today"
              ? `
                <section class="attendance-today-workspace">
                  <div class="attendance-today-topgrid">
                    <section class="attendance-panel attendance-today-dashboard-card is-${attendanceStatusClass(currentStatus)}">
                      <div class="attendance-today-dashboard-shell">
                        <div class="attendance-today-clock-block">
                        <div
                          class="attendance-today-clock-face"
                          data-attendance-today-clock
                          style="--attendance-clock-hour:${clockHourDeg}deg; --attendance-clock-minute:${clockMinuteDeg}deg; --attendance-clock-second:${clockSecondDeg}deg;"
                          aria-hidden="true"
                        >
                            <span class="attendance-today-clock-hand is-hour"></span>
                            <span class="attendance-today-clock-hand is-minute"></span>
                            <span class="attendance-today-clock-hand is-second"></span>
                            <span class="attendance-today-clock-center"></span>
                          </div>
                          <strong class="attendance-today-clock-digital" data-attendance-today-time>${escapeHtml(currentTimeLabel)}</strong>
                        </div>
                        <div class="attendance-today-dashboard-main">
                          <div class="attendance-today-dashboard-grid">
                            <article class="attendance-today-mini-card">
                              <span>Working Hours</span>
                              <strong data-attendance-today-worked>${escapeHtml(attendanceFormatMetricClock(totalWorkedSeconds))}</strong>
                            </article>
                            <article class="attendance-today-mini-card">
                              <span>Break Hours</span>
                              <strong data-attendance-today-break>${escapeHtml(attendanceFormatMetricClock(totalBreakSeconds))}</strong>
                            </article>
                            <article class="attendance-today-shift-card">
                              <i class="bi bi-moon-stars" aria-hidden="true"></i>
                              <div>
                                <strong>${escapeHtml(todayHeroLabel)}</strong>
                                <p>${escapeHtml(todayHeadline)}</p>
                                <small>${escapeHtml(todayStatusCardNote)}</small>
                              </div>
                            </article>
                          </div>
                          <div class="attendance-today-action-row">
                            <button class="attendance-today-cta" type="button" data-action="attendance-primary" data-id="${currentPrimaryAction.id}">
                              <i class="${todayPrimaryActionIcon}" aria-hidden="true"></i>
                              <span>${escapeHtml(currentPrimaryAction.label)}</span>
                            </button>
                          </div>
                          <div class="attendance-today-subactions">
                            <button type="button" class="mini-btn" data-action="attendance-clock-out" ${
                              currentStatusRaw === "working" || currentStatusRaw === "on-break" ? "" : "disabled"
                            }>${escapeHtml(clockOutButtonLabel)}</button>
                            <button type="button" class="mini-btn" data-action="attendance-request-create">Request Fix</button>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section class="attendance-panel attendance-today-break-card">
                      <header class="attendance-panel-head">
                        <p class="attendance-card-eyebrow">Break Tracking</p>
                      </header>
                      <div class="attendance-break-plan">
                        ${breakTrackingRows || "<p class='task-meta'>No break activity yet today.</p>"}
                      </div>
                    </section>
                  </div>

                  <section class="attendance-panel attendance-today-timeline-card">
                    <header class="attendance-panel-head">
                      <p class="attendance-card-eyebrow">Timeline</p>
                    </header>
                    <div class="data-table-shell attendance-today-timeline-shell">
                      <table class="data-table attendance-today-timeline-table">
                        <thead>
                          <tr>
                            <th>Event</th>
                            <th>Date</th>
                            <th>Start</th>
                            <th>End</th>
                            <th>Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${
                            timelineRows.length
                              ? timelineRows
                                  .map(
                                    (entry) => `
                                      <tr>
                                        <td><strong class="attendance-today-timeline-event">${escapeHtml(entry.label)}</strong></td>
                                        <td>${escapeHtml(entry.dateLabel || "--")}</td>
                                        <td>${escapeHtml(formatAttendanceTime(entry.startAt, resolvedTimeZone))}</td>
                                        <td>${escapeHtml(entry.endAt ? formatAttendanceTime(entry.endAt, resolvedTimeZone) : "--")}</td>
                                        <td>
                                          <span
                                            class="attendance-today-timeline-duration is-${escapeHtml(entry.tone || "neutral")}"
                                            ${entry.isLiveRecord && entry.isShift ? "data-attendance-today-shift-duration" : ""}
                                            ${
                                              entry.isLiveRecord && Number.isInteger(entry.breakIndex)
                                                ? `data-attendance-today-break-duration data-break-index="${escapeHtml(String(entry.breakIndex))}" data-allowed-seconds="${escapeHtml(String(entry.allowedSeconds || 0))}"`
                                                : ""
                                            }
                                          >${escapeHtml(entry.durationLabel)}</span>
                                        </td>
                                      </tr>
                                    `
                                  )
                                  .join("")
                              : "<tr><td colspan='5' class='task-meta'>No attendance history yet.</td></tr>"
                          }
                        </tbody>
                      </table>
                    </div>
                  </section>
                </section>
              `
              : ""
          }
          ${
            activeTab === "team" && managerMode
              ? `
                <section class="attendance-manager-shell">
                  <aside class="attendance-manager-sidebar">
                    <section class="attendance-panel attendance-manager-side-card">
                      <div class="attendance-manager-calendar">
                        <div class="attendance-manager-calendar-head">
                          <button type="button" class="attendance-manager-calendar-nav" data-action="attendance-manager-month" data-id="prev" aria-label="Previous month">
                            <i class="bi bi-chevron-left" aria-hidden="true"></i>
                          </button>
                          <strong>${escapeHtml(calendarMeta.label)}</strong>
                          <button type="button" class="attendance-manager-calendar-nav" data-action="attendance-manager-month" data-id="next" aria-label="Next month">
                            <i class="bi bi-chevron-right" aria-hidden="true"></i>
                          </button>
                        </div>
                        <div class="attendance-manager-calendar-weekdays">
                          <span>Sun</span>
                          <span>Mon</span>
                          <span>Tue</span>
                          <span>Wed</span>
                          <span>Thu</span>
                          <span>Fri</span>
                          <span>Sat</span>
                        </div>
                        <div class="attendance-manager-calendar-grid">
                          ${calendarMeta.cells
                            .map(
                              (cell) => `
                                <button
                                  type="button"
                                  class="attendance-manager-calendar-day ${cell.isOutsideMonth ? "is-outside" : ""} ${cell.isToday ? "is-today" : ""} ${cell.isSelected ? "is-selected" : ""}"
                                  data-action="attendance-manager-day"
                                  data-id="${escapeHtml(cell.isoDate)}"
                                >${escapeHtml(cell.label)}</button>
                              `
                            )
                            .join("")}
                        </div>
                      </div>
                    </section>

                    <section class="attendance-panel attendance-manager-side-card">
                      <header class="attendance-panel-head">
                        <p class="attendance-card-eyebrow">Filters</p>
                      </header>
                      <div class="attendance-manager-filter-group">
                        <span class="attendance-manager-filter-label">Range</span>
                        <div class="attendance-manager-chip-row is-segmented">
                          <button type="button" class="mini-btn ${historyWindow.range === "today" ? "is-active" : ""}" data-action="attendance-history-range" data-id="today">Today</button>
                          <button type="button" class="mini-btn ${historyWindow.range === "week" ? "is-active" : ""}" data-action="attendance-history-range" data-id="week">Week</button>
                          <button type="button" class="mini-btn ${historyWindow.range === "month" ? "is-active" : ""}" data-action="attendance-history-range" data-id="month">Month</button>
                        </div>
                      </div>
                      <div class="attendance-manager-filter-group">
                        <span class="attendance-manager-filter-label">Status</span>
                        <div class="attendance-manager-chip-row">
                          <button type="button" class="mini-btn ${teamFilter === "all" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="all">All</button>
                          <button type="button" class="mini-btn ${teamFilter === "late" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="late">Late</button>
                          <button type="button" class="mini-btn ${teamFilter === "overbreak" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="overbreak">Overbreak</button>
                          <button type="button" class="mini-btn ${teamFilter === "absent" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="absent">Absent</button>
                          <button type="button" class="mini-btn ${teamFilter === "leave" ? "is-active" : ""}" data-action="attendance-team-filter" data-id="leave">On Leave</button>
                        </div>
                      </div>
                    </section>

                    <section class="attendance-panel attendance-manager-side-card">
                      <header class="attendance-panel-head">
                        <p class="attendance-card-eyebrow">Scope</p>
                      </header>
                      <label class="attendance-history-field attendance-manager-select-field">
                        <span>Agent</span>
                        <select data-attendance-team-member>
                          <option value="all">All members</option>
                          ${allMembers
                            .map((member) => {
                              const optionValue = String(member.id || member.name || "").trim();
                              return `<option value="${escapeHtml(optionValue)}" ${
                                optionValue === historyMemberValue ? "selected" : ""
                              }>${escapeHtml(String(member.name || optionValue || "Member"))}</option>`;
                            })
                            .join("")}
                        </select>
                      </label>
                      <label class="attendance-history-field attendance-manager-select-field">
                        <span>Department</span>
                        <select data-attendance-team-department>
                          <option value="all">All departments</option>
                          ${departmentOptions
                            .map(
                              (department) =>
                                `<option value="${escapeHtml(department)}" ${
                                  department === teamDepartmentValue ? "selected" : ""
                                }>${escapeHtml(department)}</option>`
                            )
                            .join("")}
                        </select>
                      </label>
                    </section>
                  </aside>

                  <div class="attendance-manager-main">
                    <section class="attendance-panel attendance-manager-topbar-panel">
                      <div class="attendance-manager-topbar">
                        <div class="attendance-manager-topbar-copy">
                          <p class="attendance-card-eyebrow">Team Attendance</p>
                          <strong>${escapeHtml(managerTopbarTitle)}</strong>
                          ${managerTopbarRangeLabel ? `<span>${escapeHtml(managerTopbarRangeLabel)}</span>` : ""}
                        </div>
                        <div class="attendance-manager-topbar-actions">
                          <label class="attendance-manager-search">
                            <i class="bi bi-search" aria-hidden="true"></i>
                            <input id="attendanceTeamSearchInput" type="search" placeholder="Search by name or email" value="${escapeHtml(teamSearch)}" />
                          </label>
                          <div class="attendance-manager-secondary-actions">
                            <button type="button" class="mini-btn" data-action="attendance-range-modal" data-id="filter">
                              <i class="bi bi-calendar-range" aria-hidden="true"></i>
                              <span>Range</span>
                            </button>
                            <button type="button" class="mini-btn" data-action="attendance-range-modal" data-id="export">
                              <i class="bi bi-download" aria-hidden="true"></i>
                              <span>Export CSV</span>
                            </button>
                          </div>
                          <button type="button" class="table-ops-columns-btn" data-action="attendance-manual-entry" data-id="">
                            <i class="bi bi-plus-square" aria-hidden="true"></i>
                            <span>Add Attendance</span>
                          </button>
                        </div>
                      </div>
                    </section>

                    <section class="attendance-panel">
                      <div class="attendance-manager-summary-grid">
                        ${managerSummaryCards
                          .map(
                            (card) => `
                              <article class="attendance-manager-summary-card">
                                <span>${escapeHtml(card.label)}</span>
                                <strong>${escapeHtml(String(card.value))}</strong>
                                <small>${escapeHtml(card.detail)}</small>
                              </article>
                            `
                          )
                          .join("")}
                      </div>
                    </section>

                    <div class="attendance-manager-detail-grid">
                      <section class="attendance-panel attendance-manager-table-panel">
                        <div class="data-table-shell">
                          <table class="data-table">
                            <thead>
                              <tr>
                                <th>${attendanceHeaderSortButton("Employee", "employee", activeAttendanceSortKey, activeAttendanceSortDir)}</th>
                                <th>${attendanceHeaderSortButton("Date", "date", activeAttendanceSortKey, activeAttendanceSortDir)}</th>
                                <th>${attendanceHeaderSortButton("Time In", "timeIn", activeAttendanceSortKey, activeAttendanceSortDir)}</th>
                                <th>${attendanceHeaderSortButton("Time Out", "timeOut", activeAttendanceSortKey, activeAttendanceSortDir)}</th>
                                <th>${attendanceHeaderSortButton("Break", "break", activeAttendanceSortKey, activeAttendanceSortDir)}</th>
                                <th>${attendanceHeaderSortButton("Total Hours", "hours", activeAttendanceSortKey, activeAttendanceSortDir)}</th>
                                <th>${attendanceHeaderSortButton("Status", "status", activeAttendanceSortKey, activeAttendanceSortDir)}</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${
                                historyRows.length
                                  ? historyRows
                                      .map(
                                        (row) => `
                                          <tr class="${selectedHistoryEntry?.key === row.key ? "is-selected" : ""}">
                                            <td>
                                              <div class="attendance-manager-namecell">
                                                <strong>${escapeHtml(row.memberName)}</strong>
                                                <small>${escapeHtml(row.departmentLabel || "No department")} · ${escapeHtml(row.activityLabel)}</small>
                                              </div>
                                            </td>
                                            <td>${escapeHtml(attendanceFormatHistoryDateNumeric(row.dateIso))}</td>
                                            <td>${escapeHtml(row.firstInLabel)}</td>
                                            <td>${escapeHtml(row.lastOutLabel)}</td>
                                            <td>${escapeHtml(row.breakLabel)}</td>
                                            <td>${escapeHtml(row.workedLabel)}</td>
                                            <td>
                                              <div class="attendance-manager-statuscell">
                                                <span class="attendance-status-pill is-${escapeHtml(row.statusTone)}">${escapeHtml(row.statusLabel)}</span>
                                                <small>${escapeHtml(row.compliance)}</small>
                                              </div>
                                            </td>
                                            <td>
                                              <div class="attendance-manager-row-actions">
                                                <button
                                                  type="button"
                                                  class="attendance-table-icon-btn ${selectedHistoryEntry?.key === row.key ? "is-active" : ""}"
                                                  data-action="attendance-history-select"
                                                  data-id="${escapeHtml(row.key)}"
                                                  aria-label="View daily timeline"
                                                  title="View daily timeline"
                                                >
                                                  <i class="bi bi-eye" aria-hidden="true"></i>
                                                </button>
                                                <button
                                                  type="button"
                                                  class="attendance-table-icon-btn"
                                                  data-action="attendance-manual-entry"
                                                  data-id="${escapeHtml(`${row.memberKey}::${row.dateIso}`)}"
                                                  aria-label="${row.logId ? "Edit attendance" : "Add attendance"}"
                                                  title="${row.logId ? "Edit attendance" : "Add attendance"}"
                                                >
                                                  <i class="bi ${row.logId ? "bi-pencil-square" : "bi-plus-square"}" aria-hidden="true"></i>
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                        `
                                      )
                                      .join("")
                                  : "<tr><td colspan='8' class='task-meta'>No attendance rows for this filter.</td></tr>"
                              }
                            </tbody>
                          </table>
                        </div>
                        <table class="data-table" data-attendance-export-table hidden>
                          <thead>
                            <tr>
                              <th>Employee</th>
                              <th>Date</th>
                              <th>Time In</th>
                              <th>Time Out</th>
                              <th>Break</th>
                              <th>Total Hours</th>
                              <th>Status</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>${renderAttendanceManagerHistoryRows(allHistoryRows)}</tbody>
                        </table>
                        ${renderAttendanceTableFooter(tablePagination, allHistoryRows.length)}
                      </section>

                      ${
                        selectedHistoryEntry
                          ? `
                            <button type="button" class="attendance-manager-drawer-backdrop" data-action="attendance-history-close" aria-label="Close daily timeline drawer"></button>
                            <aside class="attendance-manager-drawer" aria-label="Daily timeline">
                              <section class="attendance-panel attendance-manager-drawer-panel">
                                <header class="attendance-panel-head attendance-manager-drawer-head">
                                  <p class="attendance-card-eyebrow">Daily Timeline</p>
                                  <button type="button" class="icon-btn" data-action="attendance-history-close" aria-label="Close daily timeline">
                                    <i class="bi bi-x-lg" aria-hidden="true"></i>
                                  </button>
                                </header>
                                <div class="attendance-manager-drawer-body">
                                  <div class="attendance-history-detail-head">
                                    <div>
                                      <strong>${escapeHtml(selectedHistoryEntry.memberName)}</strong>
                                      <p>${escapeHtml(selectedHistoryEntry.dateLabel)}</p>
                                    </div>
                                    <span class="attendance-status-pill is-${escapeHtml(selectedHistoryEntry.statusTone)}">${escapeHtml(selectedHistoryEntry.statusLabel)}</span>
                                  </div>
                                  <div class="attendance-summary-grid">
                                    <div><p>First In</p><strong>${escapeHtml(selectedHistoryEntry.firstInLabel)}</strong></div>
                                    <div><p>Last Out</p><strong>${escapeHtml(selectedHistoryEntry.lastOutLabel)}</strong></div>
                                    <div><p>Worked</p><strong>${escapeHtml(selectedHistoryEntry.workedLabel)}</strong></div>
                                    <div><p>Break</p><strong>${escapeHtml(selectedHistoryEntry.breakLabel)}</strong></div>
                                    <div><p>Overbreak</p><strong>${escapeHtml(selectedHistoryEntry.overBreakLabel)}</strong></div>
                                    <div><p>Activity</p><strong>${escapeHtml(selectedHistoryEntry.activityLabel)}</strong></div>
                                  </div>
                                  <div class="attendance-flag-row">
                                    ${
                                      selectedHistoryEntry.flags.length
                                        ? selectedHistoryEntry.flags
                                            .map(
                                              (flag) =>
                                                `<span class="attendance-flag-chip is-${escapeHtml(flag.tone)}">${escapeHtml(flag.label)}</span>`
                                            )
                                            .join("")
                                        : "<span class='task-meta'>No flags for this day.</span>"
                                    }
                                  </div>
                                  <div class="attendance-manager-detail-note ${escapeHtml(selectedHistoryEntry.complianceTone)}">${escapeHtml(selectedHistoryEntry.compliance)}</div>
                                  <div class="attendance-timeline-list">
                                    ${
                                      selectedHistoryEntry.timelineRows.length
                                        ? selectedHistoryEntry.timelineRows
                                            .map(
                                              (entry) => `
                                                <div class="attendance-timeline-item">
                                                  <div>
                                                    <div class="attendance-timeline-title">
                                                      <strong class="${entry.durationLabel ? `attendance-timeline-break-${escapeHtml(entry.tone || "ok")}` : ""}">${escapeHtml(entry.label)}</strong>
                                                      ${
                                                        entry.durationLabel
                                                          ? `<span class="attendance-timeline-duration is-${escapeHtml(entry.tone || "ok")}">${escapeHtml(entry.durationLabel)}</span>`
                                                          : ""
                                                      }
                                                    </div>
                                                    <p>${escapeHtml(entry.detail)}</p>
                                                  </div>
                                                  <span>${escapeHtml(formatAttendanceTime(entry.at, resolvedTimeZone))}</span>
                                                </div>
                                              `
                                            )
                                            .join("")
                                        : "<p class='task-meta'>No recorded punches for this date.</p>"
                                    }
                                  </div>
                                </div>
                              </section>
                            </aside>
                          `
                          : ""
                      }
                    </div>
                  </div>
                </section>
              `
              : ""
          }
          ${
            activeTab === "requests"
              ? `
                <section class="attendance-panel">
                  <header class="attendance-panel-head">
                    <p class="attendance-card-eyebrow">${managerMode ? "Adjustment Requests" : "My Requests"}</p>
                  </header>
                  <div class="data-table-shell">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Member</th>
                          <th>Type</th>
                          <th>Reason</th>
                          <th>Status</th>
                          ${managerMode ? "<th>Actions</th>" : ""}
                        </tr>
                      </thead>
                      <tbody>
                        ${
                          visibleRequests.length
                            ? visibleRequests
                                .map((entry) => {
                                  const status = String(entry.status || "Pending");
                                  const statusTone = status.toLowerCase().replaceAll(" ", "-");
                                  return `
                                    <tr>
                                      <td>${escapeHtml(String(entry.date || "-"))}</td>
                                      <td>${escapeHtml(String(entry.userName || "-"))}</td>
                                      <td>${escapeHtml(String(entry.type || "Missing Punch"))}</td>
                                      <td>${escapeHtml(String(entry.reason || "-"))}</td>
                                      <td><span class="attendance-status-pill is-${escapeHtml(statusTone)}">${escapeHtml(status)}</span></td>
                                      ${
                                        managerMode
                                          ? `
                                            <td>
                                              ${
                                                status === "Pending"
                                                  ? `
                                                    <div class="attendance-request-actions">
                                                      <button type="button" class="mini-btn" data-action="attendance-request-approve" data-id="${escapeHtml(String(entry.id || ""))}">Approve</button>
                                                      <button type="button" class="mini-btn mini-btn-danger" data-action="attendance-request-reject" data-id="${escapeHtml(String(entry.id || ""))}">Reject</button>
                                                    </div>
                                                  `
                                                  : "<span class='task-meta'>Reviewed</span>"
                                              }
                                            </td>
                                          `
                                          : ""
                                      }
                                    </tr>
                                  `;
                                })
                                .join("")
                            : `<tr><td colspan="${managerMode ? "6" : "5"}" class="task-meta">No requests yet.</td></tr>`
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              `
              : ""
          }
          ${
            activeTab === "policy"
              ? `
                <section class="attendance-panel">
                  <header class="attendance-panel-head">
                    <p class="attendance-card-eyebrow">Attendance Policy</p>
                    ${managerMode ? `<button type="button" class="mini-btn" data-action="attendance-policy-edit">Set Work Time</button>` : ""}
                  </header>
                  <div class="attendance-policy-grid">
                    <p><span>Shift</span><strong>${escapeHtml(policy.shiftStart)} - ${escapeHtml(policy.shiftEnd)}</strong></p>
                    <p><span>Late After</span><strong>${escapeHtml(`${lateAfterMinutes} min`)}</strong></p>
                    <p><span>Half-day</span><strong>${escapeHtml(`${halfDayAfterMinutes} min`)}</strong></p>
                    <p><span>Auto Absent</span><strong>${autoAbsentAfterMinutes > 0 ? escapeHtml(`${autoAbsentAfterMinutes} min`) : "Disabled"}</strong></p>
                    <p><span>Unpaid Break</span><strong>${escapeHtml(`${policy.breakMinutes} min`)}</strong></p>
                    <p><span>Work Days</span><strong>${escapeHtml(workDaysLabel || "Mon-Fri")}</strong></p>
                    <p><span>Timezone</span><strong>${escapeHtml(policy.timezone || "Local")}</strong></p>
                  </div>
                  <div class="attendance-break-plan">
                    ${breakPlanRows}
                  </div>
                </section>
              `
              : ""
          }
        </div>
      </section>
    `
  };
}
