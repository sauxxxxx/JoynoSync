import { createId } from "../data/store.js";
import { resolveCurrentUserId, resolveCurrentUserName, resolveCurrentUserRole } from "./profile-core.js";

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

function todayIsoLocal(daysFromNow = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromNow);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeTimeValue(value, fallback = "09:00") {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return fallback;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return -1;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeReferenceDate(value) {
  const date = value instanceof Date ? value : new Date(value || new Date().toISOString());
  if (Number.isNaN(date.valueOf())) {
    return new Date();
  }
  return date;
}

export function getAttendanceShiftTiming(policy) {
  const shiftStartMinutes = timeToMinutes(policy?.shiftStart);
  const shiftEndMinutes = timeToMinutes(policy?.shiftEnd);
  const crossesMidnight =
    shiftStartMinutes >= 0 && shiftEndMinutes >= 0 && shiftEndMinutes < shiftStartMinutes;
  const durationMinutes =
    shiftStartMinutes < 0 || shiftEndMinutes < 0
      ? -1
      : shiftEndMinutes === shiftStartMinutes
        ? 0
        : crossesMidnight
          ? 1440 - shiftStartMinutes + shiftEndMinutes
          : shiftEndMinutes - shiftStartMinutes;
  return {
    shiftStartMinutes,
    shiftEndMinutes,
    crossesMidnight,
    durationMinutes
  };
}

export function getAttendanceRequiredUnpaidBreakMinutes(policy) {
  return getAttendancePolicyBreakTypes(policy).reduce((sum, entry) => {
    if (entry.paid) {
      return sum;
    }
    const requiredCount = Math.max(entry.required ? 1 : 0, Number(entry.minPerDay || 0));
    return sum + Math.max(0, requiredCount) * Math.max(0, Number(entry.durationMinutes || 0));
  }, 0);
}

export function getAttendanceExpectedWorkedMinutes(policy) {
  const timing = getAttendanceShiftTiming(policy);
  if (!Number.isFinite(timing.durationMinutes) || timing.durationMinutes <= 0) {
    return 0;
  }
  return Math.max(0, timing.durationMinutes - getAttendanceRequiredUnpaidBreakMinutes(policy));
}

function isValidIanaTimezone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone || timeZone.toLowerCase() === "local") {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveAttendanceTimeZone(policy) {
  const timeZone = String(policy?.timezone || "").trim();
  return isValidIanaTimezone(timeZone) ? timeZone : "";
}

function getDatePartsInTimeZone(value, timeZone = "") {
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
    year: Number(parts.year || 0),
    month: Number(parts.month || 0),
    day: Number(parts.day || 0),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    weekDay: weekdayMap[parts.weekday] ?? -1,
    isoDate: parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : ""
  };
}

export function getAttendanceReferenceShiftContext(referenceIso = "", policy = {}) {
  const timeZone = resolveAttendanceTimeZone(policy);
  const referenceDate = normalizeReferenceDate(referenceIso);
  const parts = getDatePartsInTimeZone(referenceDate, timeZone);
  const timing = getAttendanceShiftTiming(policy);
  const localMinutes = parts ? parts.hour * 60 + parts.minute : referenceDate.getHours() * 60 + referenceDate.getMinutes();
  const carriesOver = Boolean(timing.crossesMidnight && localMinutes >= 0 && localMinutes <= timing.shiftEndMinutes);
  const anchorParts = carriesOver
    ? getDatePartsInTimeZone(new Date(referenceDate.getTime() - 12 * 60 * 60 * 1000), timeZone) || parts
    : parts;
  return {
    ...timing,
    timeZone,
    referenceParts: parts,
    localMinutes,
    carriesOver,
    shiftDateIso: String(anchorParts?.isoDate || parts?.isoDate || referenceDate.toISOString().slice(0, 10)),
    shiftWeekDay: Number.isInteger(anchorParts?.weekDay) ? anchorParts.weekDay : parts?.weekDay ?? referenceDate.getDay(),
    relativeMinutes: carriesOver ? localMinutes + 1440 : localMinutes,
    shiftStartRelativeMinutes: timing.shiftStartMinutes,
    shiftEndRelativeMinutes: timing.crossesMidnight ? timing.shiftEndMinutes + 1440 : timing.shiftEndMinutes
  };
}

export function getAttendanceShiftRelativeMinutesForInstant(value, policy, timeZone = resolveAttendanceTimeZone(policy)) {
  const parts = getDatePartsInTimeZone(value, timeZone);
  if (!parts) {
    return -1;
  }
  const timing = getAttendanceShiftTiming(policy);
  const localMinutes = parts.hour * 60 + parts.minute;
  if (timing.crossesMidnight && localMinutes <= timing.shiftEndMinutes) {
    return localMinutes + 1440;
  }
  return localMinutes;
}

export function getAttendanceNormalizedWindowMinutes(windowStart, windowEnd, policy) {
  const startMinutes = timeToMinutes(windowStart);
  const endMinutes = timeToMinutes(windowEnd);
  if (startMinutes < 0 || endMinutes < 0) {
    return {
      startMinutes: -1,
      endMinutes: -1
    };
  }
  const timing = getAttendanceShiftTiming(policy);
  let normalizedStart = startMinutes;
  let normalizedEnd = endMinutes;
  if (timing.crossesMidnight) {
    if (normalizedStart < timing.shiftStartMinutes) {
      normalizedStart += 1440;
    }
    if (normalizedEnd < timing.shiftStartMinutes) {
      normalizedEnd += 1440;
    }
  }
  if (normalizedEnd < normalizedStart) {
    normalizedEnd += 1440;
  }
  return {
    startMinutes: normalizedStart,
    endMinutes: normalizedEnd
  };
}

export function defaultAttendancePolicy() {
  return {
    shiftStart: "09:00",
    shiftEnd: "18:00",
    graceMinutes: 10,
    lateAfterMinutes: 10,
    halfDayAfterMinutes: 180,
    autoAbsentAfterMinutes: 0,
    breakMinutes: 60,
    timezone: "Local",
    workDays: [...DEFAULT_WORK_DAYS],
    breakTypes: [
      {
        id: "morning",
        label: "Morning Break",
        durationMinutes: 15,
        paid: true,
        required: false,
        maxPerDay: 1,
        minPerDay: 0,
        windowStart: "09:30",
        windowEnd: "11:30"
      },
      {
        id: "lunch",
        label: "Lunch Break",
        durationMinutes: 60,
        paid: false,
        required: true,
        maxPerDay: 1,
        minPerDay: 1,
        windowStart: "11:30",
        windowEnd: "14:30"
      },
      {
        id: "afternoon",
        label: "Afternoon Break",
        durationMinutes: 15,
        paid: true,
        required: false,
        maxPerDay: 1,
        minPerDay: 0,
        windowStart: "14:30",
        windowEnd: "17:30"
      }
    ]
  };
}

export function getAttendancePolicyBreakTypes(policy) {
  const fallback = defaultAttendancePolicy().breakTypes;
  const source = Array.isArray(policy?.breakTypes) ? policy.breakTypes : fallback;
  return source
    .map((entry, index) => ({
      id: String(entry?.id || `break_${index + 1}`).trim().toLowerCase(),
      label: String(entry?.label || `Break ${index + 1}`).trim(),
      durationMinutes: Math.max(1, Number(entry?.durationMinutes || 1)),
      paid: Boolean(entry?.paid),
      required: Boolean(entry?.required),
      maxPerDay: Math.max(1, Number(entry?.maxPerDay || 1)),
      minPerDay: Math.max(0, Number(entry?.minPerDay || 0)),
      windowStart: normalizeTimeValue(entry?.windowStart, "00:00"),
      windowEnd: normalizeTimeValue(entry?.windowEnd, "23:59")
    }))
    .filter((entry) => entry.id);
}

export function getAttendanceBreakTypeMap(policy) {
  return new Map(getAttendancePolicyBreakTypes(policy).map((item) => [item.id, item]));
}

export function getAttendanceBreakStartMinutes(entry, timeZone = "") {
  const startValue = String(entry?.startAt || entry?.start || "").trim();
  const startMs = Date.parse(startValue);
  if (Number.isFinite(startMs)) {
    const parts = getDatePartsInTimeZone(startMs, timeZone);
    if (!parts) {
      return -1;
    }
    return parts.hour * 60 + parts.minute;
  }
  const parsed = timeToMinutes(startValue);
  return parsed >= 0 ? parsed : -1;
}

export function isAttendanceWithinWindow(currentMinutes, windowStart, windowEnd) {
  const start = timeToMinutes(windowStart);
  const end = timeToMinutes(windowEnd);
  if (start < 0 || end < 0) {
    return true;
  }
  if (end >= start) {
    return currentMinutes >= start && currentMinutes <= end;
  }
  return currentMinutes >= start || currentMinutes <= end;
}

export function getAttendanceWindowDistance(currentMinutes, windowStart, windowEnd) {
  const start = timeToMinutes(windowStart);
  const end = timeToMinutes(windowEnd);
  if (start < 0 || end < 0 || currentMinutes < 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (isAttendanceWithinWindow(currentMinutes, windowStart, windowEnd)) {
    return 0;
  }
  if (end >= start) {
    if (currentMinutes < start) {
      return start - currentMinutes;
    }
    return currentMinutes - end;
  }
  const toStart = (start - currentMinutes + 1440) % 1440;
  const toEnd = (currentMinutes - end + 1440) % 1440;
  return Math.min(toStart, toEnd);
}

export function getAttendanceBreakTypeForEntry(entry, policy) {
  const timeZone = resolveAttendanceTimeZone(policy);
  const breakTypeMap = getAttendanceBreakTypeMap(policy);
  const rawTypeId = String(entry?.breakTypeId || "").trim().toLowerCase();
  if (rawTypeId && breakTypeMap.has(rawTypeId)) {
    return breakTypeMap.get(rawTypeId) || null;
  }
  const breakTypes = getAttendancePolicyBreakTypes(policy);
  if (!breakTypes.length) {
    return null;
  }
  const startMinutes = getAttendanceBreakStartMinutes(entry, timeZone);
  if (startMinutes < 0) {
    return breakTypes[0];
  }
  return breakTypes.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }
    const candidateDistance = getAttendanceWindowDistance(startMinutes, candidate.windowStart, candidate.windowEnd);
    const bestDistance = getAttendanceWindowDistance(startMinutes, best.windowStart, best.windowEnd);
    if (candidateDistance < bestDistance) {
      return candidate;
    }
    if (candidateDistance === bestDistance && candidate.required && !best.required) {
      return candidate;
    }
    return best;
  }, null);
}

export function getAttendanceAutoBreakTypeForStart(startIso, policy) {
  const entry = { startAt: startIso };
  const resolved = getAttendanceBreakTypeForEntry(entry, policy);
  return resolved || getAttendancePolicyBreakTypes(policy)[0] || null;
}

export function getAttendanceBreakUsage(record, policy, referenceIso = "") {
  const breakTypes = getAttendancePolicyBreakTypes(policy);
  const usage = new Map(
    breakTypes.map((entry) => [
      entry.id,
      {
        id: entry.id,
        label: entry.label,
        paid: Boolean(entry.paid),
        maxPerDay: Math.max(1, Number(entry.maxPerDay || 1)),
        minPerDay: Math.max(0, Number(entry.minPerDay || 0)),
        required: Boolean(entry.required),
        durationMinutes: Math.max(1, Number(entry.durationMinutes || 1)),
        windowStart: entry.windowStart,
        windowEnd: entry.windowEnd,
        count: 0,
        minutes: 0
      }
    ])
  );
  if (!record) {
    return usage;
  }
  const referenceMs = Date.parse(String(referenceIso || new Date().toISOString()));
  const safeReferenceMs = Number.isFinite(referenceMs) ? referenceMs : Date.now();
  const clockOutMs = Date.parse(String(record.clockOutAt || ""));
  const breaks = Array.isArray(record.breaks) ? record.breaks : [];
  breaks.forEach((entry) => {
    const typeConfig = getAttendanceBreakTypeForEntry(entry, policy);
    if (!typeConfig) {
      return;
    }
    const target = usage.get(typeConfig.id);
    if (!target) {
      return;
    }
    const startMs = Date.parse(String(entry?.startAt || ""));
    if (!Number.isFinite(startMs)) {
      return;
    }
    let endMs = Date.parse(String(entry?.endAt || ""));
    if (!Number.isFinite(endMs)) {
      endMs = Number.isFinite(clockOutMs) ? clockOutMs : safeReferenceMs;
    }
    if (endMs <= startMs) {
      return;
    }
    target.count += 1;
    target.minutes += Math.max(0, Math.round((endMs - startMs) / 60000));
  });
  return usage;
}

export function ensureAttendanceCollections(data) {
  if (!Array.isArray(data.attendanceLogs)) {
    data.attendanceLogs = [];
  }
  if (!Array.isArray(data.attendanceRequests)) {
    data.attendanceRequests = [];
  }
  const defaultPolicy = defaultAttendancePolicy();
  const sourcePolicy = data.attendancePolicy && typeof data.attendancePolicy === "object" ? data.attendancePolicy : {};
  const workDays = Array.isArray(sourcePolicy.workDays)
    ? sourcePolicy.workDays
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : defaultPolicy.workDays;
  data.attendancePolicy = {
    ...defaultPolicy,
    ...sourcePolicy,
    shiftStart: normalizeTimeValue(sourcePolicy.shiftStart, defaultPolicy.shiftStart),
    shiftEnd: normalizeTimeValue(sourcePolicy.shiftEnd, defaultPolicy.shiftEnd),
    graceMinutes: Math.max(
      0,
      Number(sourcePolicy.graceMinutes ?? sourcePolicy.lateAfterMinutes ?? defaultPolicy.graceMinutes) || 0
    ),
    lateAfterMinutes: Math.max(
      0,
      Number(sourcePolicy.lateAfterMinutes ?? sourcePolicy.graceMinutes ?? defaultPolicy.lateAfterMinutes) || 0
    ),
    halfDayAfterMinutes: Math.max(0, Number(sourcePolicy.halfDayAfterMinutes ?? defaultPolicy.halfDayAfterMinutes) || 0),
    autoAbsentAfterMinutes: Math.max(0, Number(sourcePolicy.autoAbsentAfterMinutes ?? defaultPolicy.autoAbsentAfterMinutes) || 0),
    breakTypes: getAttendancePolicyBreakTypes(sourcePolicy),
    workDays: workDays.length ? [...new Set(workDays)] : defaultPolicy.workDays
  };
  const unpaidPlannedMinutes = data.attendancePolicy.breakTypes
    .filter((entry) => !entry.paid)
    .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
  data.attendancePolicy.breakMinutes = Math.max(
    0,
    Number(sourcePolicy.breakMinutes ?? unpaidPlannedMinutes ?? defaultPolicy.breakMinutes) || 0
  );

  data.attendanceLogs = data.attendanceLogs.map((record) => {
    const breaks = Array.isArray(record?.breaks) ? record.breaks : [];
    return {
      ...record,
      breaks: breaks.map((entry, index) => {
        const typeConfig =
          getAttendanceBreakTypeForEntry(
            {
              ...entry,
              breakTypeId: entry?.breakTypeId || entry?.type || ""
            },
            data.attendancePolicy
          ) || data.attendancePolicy.breakTypes[0];
        return {
          id: String(entry?.id || "").trim() || createId(`brk_${index + 1}`),
          startAt: String(entry?.startAt || ""),
          endAt: String(entry?.endAt || ""),
          breakTypeId: String(typeConfig?.id || "lunch"),
          breakTypeLabel: String(entry?.breakTypeLabel || typeConfig?.label || "Break"),
          paid: entry?.paid === undefined ? Boolean(typeConfig?.paid) : Boolean(entry.paid)
        };
      })
    };
  });
}

export function attendanceMatchesCurrentUser(record, data) {
  const currentUserId = resolveCurrentUserId(data);
  const recordUserId = String(record?.userId || "").trim();
  return Boolean(recordUserId && currentUserId && recordUserId === currentUserId);
}

export function getAttendanceOpenBreak(record) {
  const breaks = Array.isArray(record?.breaks) ? record.breaks : [];
  return breaks.find((entry) => !String(entry?.endAt || "").trim()) || null;
}

export function getAttendanceBreakMinutes(record, policy, referenceIso = "", paidFilter = null) {
  if (!record) {
    return 0;
  }
  const referenceMs = Date.parse(String(referenceIso || new Date().toISOString()));
  const safeReferenceMs = Number.isFinite(referenceMs) ? referenceMs : Date.now();
  const clockOutMs = Date.parse(String(record.clockOutAt || ""));
  const breaks = Array.isArray(record.breaks) ? record.breaks : [];
  return breaks.reduce((sum, entry) => {
    const typeConfig = getAttendanceBreakTypeForEntry(entry, policy);
    const isPaid = typeConfig ? Boolean(typeConfig.paid) : Boolean(entry?.paid);
    if (paidFilter === true && !isPaid) {
      return sum;
    }
    if (paidFilter === false && isPaid) {
      return sum;
    }
    const startMs = Date.parse(String(entry?.startAt || ""));
    if (!Number.isFinite(startMs)) {
      return sum;
    }
    let endMs = Date.parse(String(entry?.endAt || ""));
    if (!Number.isFinite(endMs)) {
      endMs = Number.isFinite(clockOutMs) ? clockOutMs : safeReferenceMs;
    }
    if (endMs <= startMs) {
      return sum;
    }
    return sum + Math.max(0, Math.round((endMs - startMs) / 60000));
  }, 0);
}

export function getAttendanceBreakSeconds(record, policy, referenceIso = "", paidFilter = null) {
  if (!record) {
    return 0;
  }
  const referenceMs = Date.parse(String(referenceIso || new Date().toISOString()));
  const safeReferenceMs = Number.isFinite(referenceMs) ? referenceMs : Date.now();
  const clockOutMs = Date.parse(String(record.clockOutAt || ""));
  const breaks = Array.isArray(record.breaks) ? record.breaks : [];
  return breaks.reduce((sum, entry) => {
    const typeConfig = getAttendanceBreakTypeForEntry(entry, policy);
    const isPaid = typeConfig ? Boolean(typeConfig.paid) : Boolean(entry?.paid);
    if (paidFilter === true && !isPaid) {
      return sum;
    }
    if (paidFilter === false && isPaid) {
      return sum;
    }
    const startMs = Date.parse(String(entry?.startAt || ""));
    if (!Number.isFinite(startMs)) {
      return sum;
    }
    let endMs = Date.parse(String(entry?.endAt || ""));
    if (!Number.isFinite(endMs)) {
      endMs = Number.isFinite(clockOutMs) ? clockOutMs : safeReferenceMs;
    }
    if (endMs <= startMs) {
      return sum;
    }
    return sum + Math.max(0, Math.floor((endMs - startMs) / 1000));
  }, 0);
}

export function getAttendanceWorkedMinutes(record, policy, referenceIso = "") {
  if (!record) {
    return 0;
  }
  const startMs = Date.parse(String(record.clockInAt || ""));
  if (!Number.isFinite(startMs)) {
    return 0;
  }
  const endRaw = record.clockOutAt ? record.clockOutAt : referenceIso || new Date().toISOString();
  const endMs = Date.parse(String(endRaw));
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  const grossMinutes = Math.round((endMs - startMs) / 60000);
  return Math.max(0, grossMinutes - getAttendanceBreakMinutes(record, policy, referenceIso, false));
}

export function getAttendanceWorkedSeconds(record, policy, referenceIso = "") {
  if (!record) {
    return 0;
  }
  const startMs = Date.parse(String(record.clockInAt || ""));
  if (!Number.isFinite(startMs)) {
    return 0;
  }
  const endRaw = record.clockOutAt ? record.clockOutAt : referenceIso || new Date().toISOString();
  const endMs = Date.parse(String(endRaw));
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  const grossSeconds = Math.floor((endMs - startMs) / 1000);
  return Math.max(0, grossSeconds - getAttendanceBreakSeconds(record, policy, referenceIso, false));
}

export function getAttendanceStatus(record) {
  if (!record || String(record.clockOutAt || "").trim()) {
    return "off";
  }
  return getAttendanceOpenBreak(record) ? "on-break" : "working";
}

export function getCurrentActiveAttendanceLog(data) {
  ensureAttendanceCollections(data);
  return [...data.attendanceLogs]
    .filter((record) => attendanceMatchesCurrentUser(record, data) && !String(record.clockOutAt || "").trim())
    .sort((left, right) => Date.parse(String(right.clockInAt || "")) - Date.parse(String(left.clockInAt || "")))[0] || null;
}

export function getCurrentTodayAttendanceLog(data, dateIso = todayIsoLocal(0)) {
  ensureAttendanceCollections(data);
  return [...data.attendanceLogs]
    .filter((record) => attendanceMatchesCurrentUser(record, data) && String(record.date || "").trim() === String(dateIso || "").trim())
    .sort((left, right) => Date.parse(String(right.clockInAt || "")) - Date.parse(String(left.clockInAt || "")))[0] || null;
}

export function formatAttendanceDuration(minutesValue) {
  const safe = Math.max(0, Number(minutesValue || 0));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatAttendanceDurationClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatAttendanceTime(value, timeZone = "") {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "--";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: resolveAttendanceTimeZone({ timezone: timeZone }) || undefined
  }).format(date);
}

export function getAttendancePrimaryAction(status) {
  if (status === "on-break") {
    return { id: "attendance-end-break", label: "End Break", icon: "bi bi-play-circle" };
  }
  if (status === "working") {
    return { id: "attendance-start-break", label: "Start Break", icon: "bi bi-pause-circle" };
  }
  return { id: "attendance-clock-in", label: "Clock In", icon: "bi bi-clock-history" };
}

export function canCurrentUserManageAttendance(data, manageRoles) {
  const normalizedRole = resolveCurrentUserRole(data).toLowerCase();
  return manageRoles.includes(normalizedRole);
}

export function getAttendanceSnapshot(data, referenceNowIso = "", manageRoles = []) {
  const nowIso = String(referenceNowIso || new Date().toISOString()).trim() || new Date().toISOString();
  const policy = data.attendancePolicy && typeof data.attendancePolicy === "object" ? data.attendancePolicy : defaultAttendancePolicy();
  const activeLog = getCurrentActiveAttendanceLog(data);
  const timeZone = resolveAttendanceTimeZone(policy);
  const shiftContext = getAttendanceReferenceShiftContext(nowIso, policy);
  const shiftDateIso = String(shiftContext.shiftDateIso || getDatePartsInTimeZone(nowIso, timeZone)?.isoDate || nowIso.slice(0, 10));
  const todayLog = getCurrentTodayAttendanceLog(data, shiftDateIso);
  const summaryLog = todayLog || activeLog;
  const status = getAttendanceStatus(activeLog);
  const statusLabel = status === "on-break" ? "On Break" : status === "working" ? "Working" : "Off";
  const primaryAction = getAttendancePrimaryAction(status);
  const workedMinutes = getAttendanceWorkedMinutes(summaryLog, policy, nowIso);
  const workedSeconds = getAttendanceWorkedSeconds(summaryLog, policy, nowIso);
  const breakMinutes = getAttendanceBreakMinutes(summaryLog, policy, nowIso);
  const breakSeconds = getAttendanceBreakSeconds(summaryLog, policy, nowIso);
  const paidBreakMinutes = getAttendanceBreakMinutes(summaryLog, policy, nowIso, true);
  const unpaidBreakMinutes = getAttendanceBreakMinutes(summaryLog, policy, nowIso, false);
  const breakUsage = getAttendanceBreakUsage(summaryLog, policy, nowIso);
  const openBreak = getAttendanceOpenBreak(activeLog);
  const openBreakType = openBreak && policy ? getAttendanceBreakTypeForEntry(openBreak, policy) : null;
  const breakElapsed = openBreak && policy ? getAttendanceBreakMinutes({ breaks: [openBreak], clockOutAt: "" }, policy, nowIso) : 0;
  const breakElapsedSeconds =
    openBreak && policy ? getAttendanceBreakSeconds({ breaks: [openBreak], clockOutAt: "" }, policy, nowIso) : 0;
  const metaLabel =
    status === "on-break"
      ? `On ${openBreakType?.label || "Break"} | ${formatAttendanceDurationClock(breakElapsedSeconds)}`
      : status === "working"
        ? `Working | ${formatAttendanceDurationClock(workedSeconds)}`
        : "Off shift";
  return {
    status,
    statusLabel,
    primaryAction,
    activeLog,
    summaryLog,
    workedMinutes,
    workedSeconds,
    breakMinutes,
    breakSeconds,
    paidBreakMinutes,
    unpaidBreakMinutes,
    breakUsage,
    breakElapsed,
    breakElapsedSeconds,
    metaLabel,
    policy,
    canManage: canCurrentUserManageAttendance(data, manageRoles)
  };
}

export function updateAttendanceRecord(data, actionId, options = {}) {
  ensureAttendanceCollections(data);
  const nowIso = new Date().toISOString();
  const policy = data.attendancePolicy;
  const shiftContext = getAttendanceReferenceShiftContext(nowIso, policy);
  const workDate = String(shiftContext.shiftDateIso || todayIsoLocal(0));
  const userId = resolveCurrentUserId(data);
  const userName = resolveCurrentUserName(data);
  const activeLog = getCurrentActiveAttendanceLog(data);
  const openBreak = getAttendanceOpenBreak(activeLog);

  if (actionId === "attendance-clock-in") {
    if (activeLog) {
      return false;
    }
    data.attendanceLogs.unshift({
      id: createId("att"),
      userId,
      userName,
      date: workDate,
      clockInAt: nowIso,
      clockOutAt: "",
      breaks: [],
      source: "manual",
      createdAt: nowIso,
      updatedAt: nowIso
    });
    return true;
  }

  if (actionId === "attendance-start-break") {
    if (!activeLog || openBreak) {
      return false;
    }
    const requestedBreakTypeId = String(options?.breakTypeId || "").trim().toLowerCase();
    const breakType =
      getAttendancePolicyBreakTypes(policy).find((entry) => entry.id === requestedBreakTypeId) ||
      getAttendanceAutoBreakTypeForStart(nowIso, policy);
    if (!Array.isArray(activeLog.breaks)) {
      activeLog.breaks = [];
    }
    activeLog.breaks.push({
      id: createId("brk"),
      breakTypeId: String(breakType?.id || ""),
      breakTypeLabel: String(breakType?.label || "Break"),
      paid: Boolean(breakType?.paid),
      startAt: nowIso,
      endAt: ""
    });
    activeLog.updatedAt = nowIso;
    return true;
  }

  if (actionId === "attendance-end-break") {
    if (!activeLog || !openBreak) {
      return false;
    }
    openBreak.endAt = nowIso;
    activeLog.updatedAt = nowIso;
    return true;
  }

  if (actionId === "attendance-clock-out") {
    if (!activeLog) {
      return false;
    }
    if (openBreak) {
      openBreak.endAt = nowIso;
    }
    activeLog.clockOutAt = nowIso;
    activeLog.updatedAt = nowIso;
    return true;
  }

  return false;
}
