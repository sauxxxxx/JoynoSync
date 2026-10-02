const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value) {
  const normalized = String(value || "").trim();
  if (!ISO_DATE_PATTERN.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeMonth(value, fallbackDate) {
  const date = parseIsoDate(value) || parseIsoDate(fallbackDate) || new Date();
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

function formatSelectedDate(value) {
  const date = parseIsoDate(value);
  if (!date) return "Choose a date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatMonth(value) {
  const date = parseIsoDate(value);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date || new Date());
}

function renderCalendar(target, selectedDate, visibleMonth, rangeStart, rangeEnd) {
  const monthDate = parseIsoDate(visibleMonth);
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();
  const firstDayOffset = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const gridStart = new Date(Date.UTC(year, month, 1 - firstDayOffset));
  const targetLabel = target === "start" ? "Start" : "End";
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const isoDate = toIsoDate(date);
    const outsideMonth = date.getUTCMonth() !== month;
    const isSelected = isoDate === selectedDate;
    const isInRange = isoDate >= rangeStart && isoDate <= rangeEnd;
    const classes = [
      "attendance-range-calendar-day",
      outsideMonth ? "is-outside" : "",
      isInRange ? "is-in-range" : "",
      isSelected ? "is-selected" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <button
        type="button"
        class="${classes}"
        data-action="attendance-range-calendar-day"
        data-id="${target}::${isoDate}"
        aria-label="Set ${targetLabel.toLowerCase()} date to ${formatSelectedDate(isoDate)}"
        aria-pressed="${isSelected ? "true" : "false"}"
      >${date.getUTCDate()}</button>
    `;
  }).join("");

  return `
    <section class="attendance-range-calendar" aria-label="${targetLabel} date calendar">
      <div class="attendance-range-calendar-heading">
        <div>
          <span>${targetLabel}</span>
          <strong>${formatSelectedDate(selectedDate)}</strong>
        </div>
        <div class="attendance-range-calendar-nav">
          <button type="button" data-action="attendance-range-calendar-month" data-id="${target}::prev" aria-label="Previous month">
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
          </button>
          <button type="button" data-action="attendance-range-calendar-month" data-id="${target}::next" aria-label="Next month">
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="attendance-range-calendar-month">${formatMonth(visibleMonth)}</div>
      <div class="attendance-range-calendar-weekdays" aria-hidden="true">
        ${["S", "M", "T", "W", "T", "F", "S"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="attendance-range-calendar-days">${days}</div>
    </section>
  `;
}

export function shiftAttendanceRangeMonth(value, offset) {
  const date = parseIsoDate(value) || new Date();
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(offset || 0), 1)));
}

export function renderAttendanceRangeCalendars({ startDate, endDate, startMonth, endMonth }) {
  const normalizedStartMonth = normalizeMonth(startMonth, startDate);
  const normalizedEndMonth = normalizeMonth(endMonth, endDate);
  return [
    renderCalendar("start", startDate, normalizedStartMonth, startDate, endDate),
    renderCalendar("end", endDate, normalizedEndMonth, startDate, endDate)
  ].join("");
}
