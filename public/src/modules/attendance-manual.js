export function createAttendanceManualController({
  state,
  ensureAttendanceCollections,
  defaultAttendancePolicy,
  getAttendanceReferenceShiftContext,
  getAttendanceWorkedSeconds,
  getAttendanceBreakSeconds,
  formatAttendanceDuration,
  parseIsoDateLocal,
  normalizeTimeValue,
  formatTimeForInput,
  findAttendanceMemberByValue,
  attendanceUserMatcherFromValue,
  escapeModalText,
  clearFormFeedback,
  showFormFeedback,
  runAttendanceSnapshotMutation,
  attendanceSupabaseUnavailableMessage,
  upsertSupabaseAttendanceManualEntry,
  deleteSupabaseAttendanceManualEntry,
  createId,
  persistDataAndRefresh,
  closeModal,
  openConfirmModal,
  showToast,
  renderRoute
}) {
  function handleManualActionClick(event) {
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement) || form.dataset.mode !== "attendance-manual-compose") {
      return;
    }
    const actionButton = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    const action = String(actionButton?.dataset?.action || "").trim();
    if (!action) {
      return;
    }
    if (action === "attendance-manual-clear-clock-out") {
      event.preventDefault();
      event.stopPropagation();
      clearClockOutDraft(form);
      return;
    }
    if (action === "attendance-manual-remove-break") {
      event.preventDefault();
      event.stopPropagation();
      removeBreakDraft(form);
      return;
    }
    if (action === "attendance-manual-delete") {
      event.preventDefault();
      event.stopPropagation();
      void deleteEntry(form);
    }
  }

  function bindManualActions(form) {
    if (!(form instanceof HTMLFormElement) || form.dataset.attendanceManualActionsBound === "1") {
      return;
    }
    form.addEventListener("click", handleManualActionClick);
    form.dataset.attendanceManualActionsBound = "1";
  }

  function captureAttendanceManualDraft(form) {
    if (!(form instanceof HTMLFormElement)) {
      return null;
    }
    return {
      memberId: String(form.querySelector("select[name='memberId']")?.value || "").trim(),
      date: String(form.querySelector("input[name='date']")?.value || "").trim(),
      clockInTime: String(form.querySelector("input[name='clockInTime']")?.value || "").trim(),
      clockOutTime: String(form.querySelector("input[name='clockOutTime']")?.value || "").trim(),
      hasBreak: Boolean(form.querySelector("[data-attendance-manual-break-toggle]")?.checked),
      breakStartTime: String(form.querySelector("input[name='breakStartTime']")?.value || "").trim(),
      breakEndTime: String(form.querySelector("input[name='breakEndTime']")?.value || "").trim()
    };
  }

  function parseAttendanceManualTarget(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return { memberKey: "", workDate: "" };
    }
    const [memberKey, workDate] = raw.split("::");
    return {
      memberKey: String(memberKey || "").trim(),
      workDate: String(workDate || "").trim()
    };
  }

  function findAttendanceLogForMemberAndDate(memberKey, workDate) {
    const member = findAttendanceMemberByValue(memberKey);
    const matcher = attendanceUserMatcherFromValue(member, memberKey);
    const targetDate = String(workDate || "").trim();
    if (!member || !targetDate || !matcher) {
      return { member, log: null };
    }
    const log =
      [...(state.data.attendanceLogs || [])]
        .filter((record) => matcher(record) && String(record.date || "").trim() === targetDate)
        .sort((left, right) => Date.parse(String(right.clockInAt || "")) - Date.parse(String(left.clockInAt || "")))[0] || null;
    return { member, log };
  }

  function combineAttendanceManualDateTime(workDate, timeValue, dayOffset = 0) {
    const baseDate = parseIsoDateLocal(workDate);
    const normalizedTime = normalizeTimeValue(timeValue, "");
    if (!baseDate || !normalizedTime) {
      return null;
    }
    const [hours, minutes] = normalizedTime.split(":").map(Number);
    baseDate.setDate(baseDate.getDate() + Math.max(0, Number(dayOffset) || 0));
    baseDate.setHours(hours, minutes, 0, 0);
    return baseDate;
  }

  function getAttendanceManualDateOffset(workDate, value) {
    const baseDate = parseIsoDateLocal(workDate);
    const parsed = value ? new Date(value) : null;
    if (!baseDate || !parsed || Number.isNaN(parsed.valueOf())) {
      return 0;
    }
    const startOfBase = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    const startOfParsed = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    return Math.max(0, Math.round((startOfParsed - startOfBase) / 86400000));
  }

  function getAttendanceManualExpectedWorkedMinutes(policy, shiftContext) {
    const context =
      shiftContext && Number.isFinite(shiftContext.shiftStartRelativeMinutes) && Number.isFinite(shiftContext.shiftEndRelativeMinutes)
        ? shiftContext
        : getAttendanceReferenceShiftContext(new Date().toISOString(), policy);
    const durationMinutes = Math.max(
      0,
      Number(context?.shiftEndRelativeMinutes ?? 0) - Number(context?.shiftStartRelativeMinutes ?? 0)
    );
    const unpaidRequiredBreakMinutes = (Array.isArray(policy?.breakTypes) ? policy.breakTypes : []).reduce((sum, entry) => {
      if (entry?.paid) {
        return sum;
      }
      const requiredCount = Math.max(entry?.required ? 1 : 0, Number(entry?.minPerDay || 0));
      return sum + Math.max(0, requiredCount) * Math.max(0, Number(entry?.durationMinutes || 0));
    }, 0);
    return Math.max(0, durationMinutes - unpaidRequiredBreakMinutes);
  }

  function buildAttendanceManualEntryDraft(form) {
    const formData = form instanceof HTMLFormElement ? new FormData(form) : new FormData();
    const memberId = String(formData.get("memberId") || "").trim();
    const workDate = String(formData.get("date") || "").trim();
    const clockInTime = normalizeTimeValue(formData.get("clockInTime"), "");
    const clockOutTime = normalizeTimeValue(formData.get("clockOutTime"), "");
    const hasBreak = formData.has("hasBreak");
    const breakStartTime = normalizeTimeValue(formData.get("breakStartTime"), "");
    const breakEndTime = normalizeTimeValue(formData.get("breakEndTime"), "");

    const clockInAt = clockInTime ? combineAttendanceManualDateTime(workDate, clockInTime, 0) : null;

    let clockOutDayOffset = 0;
    let clockOutAt = clockOutTime ? combineAttendanceManualDateTime(workDate, clockOutTime, 0) : null;
    if (clockInAt && clockOutAt && clockOutAt <= clockInAt) {
      clockOutDayOffset = 1;
      clockOutAt = combineAttendanceManualDateTime(workDate, clockOutTime, clockOutDayOffset);
    }

    let breakStartDayOffset = 0;
    let breakStartAt = hasBreak && breakStartTime ? combineAttendanceManualDateTime(workDate, breakStartTime, 0) : null;
    if (clockInAt && breakStartAt && breakStartAt < clockInAt) {
      breakStartDayOffset = 1;
      breakStartAt = combineAttendanceManualDateTime(workDate, breakStartTime, breakStartDayOffset);
    }

    let breakEndDayOffset = breakStartDayOffset;
    let breakEndAt = hasBreak && breakEndTime ? combineAttendanceManualDateTime(workDate, breakEndTime, breakEndDayOffset) : null;
    if (breakStartAt && breakEndAt && breakEndAt <= breakStartAt) {
      breakEndDayOffset += 1;
      breakEndAt = combineAttendanceManualDateTime(workDate, breakEndTime, breakEndDayOffset);
    }

    return {
      memberId,
      workDate,
      hasBreak,
      clockInTime,
      clockOutTime,
      breakStartTime,
      breakEndTime,
      clockInAt,
      clockOutAt,
      breakStartAt,
      breakEndAt,
      clockOutNextDay: clockOutDayOffset > 0,
      breakStartNextDay: breakStartDayOffset > 0,
      breakEndNextDay: breakEndDayOffset > breakStartDayOffset
    };
  }

  function getAttendanceManualPreviewState(form) {
    const draft = buildAttendanceManualEntryDraft(form);
    const policy = state.data.attendancePolicy || defaultAttendancePolicy();
    let statusLabel = "Not set";
    let statusTone = "off";
    let statusReason = "Add a clock-in time to preview the status.";
    let workedLabel = "--";
    let breakLabel = "0m";

    if (draft.clockInAt) {
      const previewRecord = {
        clockInAt: draft.clockInAt.toISOString(),
        clockOutAt: draft.clockOutAt ? draft.clockOutAt.toISOString() : "",
        breaks:
          draft.hasBreak && draft.breakStartAt && draft.breakEndAt
            ? [
                {
                  id: "manual-preview-break",
                  breakTypeId: "manual",
                  breakTypeLabel: "Manual Break",
                  paid: false,
                  startAt: draft.breakStartAt.toISOString(),
                  endAt: draft.breakEndAt.toISOString()
                }
              ]
            : draft.hasBreak && draft.breakStartAt
              ? [
                  {
                    id: "manual-preview-break",
                    breakTypeId: "manual",
                    breakTypeLabel: "Manual Break",
                    paid: false,
                    startAt: draft.breakStartAt.toISOString(),
                    endAt: ""
                  }
                ]
              : []
      };
      const referenceIso =
        draft.clockOutAt?.toISOString() ||
        draft.breakEndAt?.toISOString() ||
        draft.breakStartAt?.toISOString() ||
        draft.clockInAt.toISOString();
      const shiftContext = getAttendanceReferenceShiftContext(draft.clockInAt.toISOString(), policy);
      const shiftStartMinutes = Number.isFinite(shiftContext?.shiftStartMinutes) ? shiftContext.shiftStartMinutes : 0;
      const firstInMinutes = Number.isFinite(shiftContext?.relativeMinutes) ? shiftContext.relativeMinutes : -1;
      const lateAfterMinutes = Math.max(0, Number(policy.lateAfterMinutes ?? policy.graceMinutes ?? 10) || 0);
      const halfDayAfterMinutes = Math.max(0, Number(policy.halfDayAfterMinutes ?? 120) || 0);
      const workedSeconds = Math.max(0, getAttendanceWorkedSeconds(previewRecord, policy, referenceIso));
      const breakSeconds = Math.max(0, getAttendanceBreakSeconds(previewRecord, policy, referenceIso, null));
      const workedMinutes = Math.max(0, Math.round(workedSeconds / 60));
      const expectedWorkedMinutes = getAttendanceManualExpectedWorkedMinutes(policy, shiftContext);
      const completedExpectedWork = expectedWorkedMinutes > 0 && workedMinutes >= expectedWorkedMinutes;
      const lateDeltaMinutes = firstInMinutes >= 0 ? Math.max(0, firstInMinutes - shiftStartMinutes) : 0;
      const isHalfDay =
        firstInMinutes >= 0 &&
        halfDayAfterMinutes > 0 &&
        !completedExpectedWork &&
        firstInMinutes > shiftStartMinutes + halfDayAfterMinutes;
      const isLate =
        firstInMinutes >= 0 &&
        !isHalfDay &&
        firstInMinutes > shiftStartMinutes + lateAfterMinutes;
      workedLabel = workedMinutes > 0 ? formatAttendanceDuration(workedMinutes) : "0m";
      breakLabel = breakSeconds > 0 ? formatAttendanceDuration(Math.round(breakSeconds / 60)) : "0m";
      if (!draft.clockOutAt) {
        if (draft.hasBreak && draft.breakStartAt && !draft.breakEndAt) {
          statusLabel = "On break";
          statusTone = "on-break";
          statusReason = draft.breakStartNextDay
            ? "Break started next day and is still open."
            : "Break started and is still open.";
        } else {
          statusLabel = "Working";
          statusTone = "working";
          statusReason =
            isLate && lateDeltaMinutes > 0
              ? `Clocked in ${formatAttendanceDuration(lateDeltaMinutes)} after shift start. Session is still open.`
              : "Clocked in and the session is still open.";
        }
      } else if (isHalfDay) {
        statusLabel = "Half day";
        statusTone = "half-day";
        statusReason =
          lateDeltaMinutes > 0
            ? `Started ${formatAttendanceDuration(lateDeltaMinutes)} after shift start and did not reach the expected work time.`
            : "Did not reach the expected work time.";
      } else if (isLate) {
        statusLabel = "Late";
        statusTone = "late";
        statusReason =
          shiftContext?.crossesMidnight && completedExpectedWork
            ? `Clocked in ${formatAttendanceDuration(lateDeltaMinutes)} after shift start but still completed the overnight shift.`
            : `Clocked in ${formatAttendanceDuration(lateDeltaMinutes)} after shift start.`;
      } else {
        statusLabel = "Present";
        statusTone = "present";
        if (shiftContext?.crossesMidnight && completedExpectedWork) {
          statusReason = "Completed full overnight shift.";
        } else if (completedExpectedWork) {
          statusReason = "Within the scheduled start window and completed the shift.";
        } else if (draft.clockOutNextDay) {
          statusReason = `Clocked out next day after ${workedLabel} worked.`;
        } else {
          statusReason = `Clocked out after ${workedLabel} worked.`;
        }
      }
    }

    return {
      ...draft,
      workedLabel,
      breakLabel,
      statusLabel,
      statusTone,
      statusReason
    };
  }

  function syncUi(form) {
    if (!(form instanceof HTMLFormElement) || form.dataset.mode !== "attendance-manual-compose") {
      return;
    }
    const summary = getAttendanceManualPreviewState(form);
    const currentShiftDate = String(form.dataset.currentShiftDate || "").trim();
    const clearClockOutButton = form.querySelector("[data-attendance-manual-clear-clock-out]");
    const removeBreakButton = form.querySelector("[data-attendance-manual-remove-break]");
    const canClearClockOut = Boolean(summary.clockOutTime && summary.workDate && currentShiftDate && summary.workDate === currentShiftDate);
    const canRemoveBreak = Boolean(summary.hasBreak || summary.breakStartTime || summary.breakEndTime);
    form.dataset.attendanceManualBreak = summary.hasBreak ? "1" : "0";
    const breakFields = form.querySelector("[data-attendance-manual-break-fields]");
    const breakEmpty = form.querySelector("[data-attendance-manual-break-empty]");
    const breakToggle = form.querySelector("[data-attendance-manual-break-toggle]");
    if (breakToggle instanceof HTMLInputElement) {
      breakToggle.checked = summary.hasBreak;
    }
    if (breakFields instanceof HTMLElement) {
      breakFields.hidden = !summary.hasBreak;
    }
    if (breakEmpty instanceof HTMLElement) {
      breakEmpty.hidden = summary.hasBreak;
    }
    const workedNode = form.querySelector("[data-attendance-summary-worked]");
    const breakNode = form.querySelector("[data-attendance-summary-break]");
    const statusNode = form.querySelector("[data-attendance-summary-status]");
    const statusReasonNode = form.querySelector("[data-attendance-summary-reason]");
    if (workedNode) {
      workedNode.textContent = summary.workedLabel;
    }
    if (breakNode) {
      breakNode.textContent = summary.breakLabel;
    }
    if (statusNode instanceof HTMLElement) {
      statusNode.textContent = summary.statusLabel;
      statusNode.classList.remove("is-off", "is-working", "is-on-break", "is-present", "is-late", "is-half-day");
      statusNode.classList.add(`is-${summary.statusTone}`);
    }
    if (statusReasonNode instanceof HTMLElement) {
      statusReasonNode.textContent = summary.statusReason;
    }

    const clockOutBadge = form.querySelector("[data-attendance-clockout-badge]");
    if (clockOutBadge instanceof HTMLElement) {
      clockOutBadge.hidden = !summary.clockOutNextDay;
    }
    const breakStartBadge = form.querySelector("[data-attendance-breakstart-badge]");
    if (breakStartBadge instanceof HTMLElement) {
      breakStartBadge.hidden = !summary.breakStartNextDay || !summary.hasBreak;
    }
    const breakEndBadge = form.querySelector("[data-attendance-breakend-badge]");
    if (breakEndBadge instanceof HTMLElement) {
      breakEndBadge.hidden = !summary.breakEndNextDay || !summary.hasBreak;
    }
    if (clearClockOutButton instanceof HTMLElement) {
      clearClockOutButton.hidden = !canClearClockOut;
    }
    if (removeBreakButton instanceof HTMLElement) {
      removeBreakButton.hidden = !canRemoveBreak;
    }
  }

  function clearClockOutDraft(form) {
    if (!(form instanceof HTMLFormElement) || form.dataset.mode !== "attendance-manual-compose") {
      return;
    }
    const clockOutInput = form.querySelector("input[name='clockOutTime']");
    if (clockOutInput instanceof HTMLInputElement) {
      clockOutInput.value = "";
      syncUi(form);
      if (typeof clockOutInput.focus === "function") {
        clockOutInput.focus();
      }
    }
  }

  function removeBreakDraft(form) {
    if (!(form instanceof HTMLFormElement) || form.dataset.mode !== "attendance-manual-compose") {
      return;
    }
    const breakToggle = form.querySelector("[data-attendance-manual-break-toggle]");
    const breakStartInput = form.querySelector("input[name='breakStartTime']");
    const breakEndInput = form.querySelector("input[name='breakEndTime']");
    if (breakToggle instanceof HTMLInputElement) {
      breakToggle.checked = false;
    }
    if (breakStartInput instanceof HTMLInputElement) {
      breakStartInput.value = "";
    }
    if (breakEndInput instanceof HTMLInputElement) {
      breakEndInput.value = "";
    }
    syncUi(form);
  }

  async function deleteEntry(form) {
    if (!(form instanceof HTMLFormElement) || form.dataset.mode !== "attendance-manual-compose") {
      return;
    }
    clearFormFeedback(form);
    const reopenDraft = captureAttendanceManualDraft(form);
    let existingId = String(form.dataset.logId || "").trim();
    let existingLog = existingId
      ? (state.data.attendanceLogs || []).find((entry) => String(entry.id || "").trim() === existingId) || null
      : null;
    const fallbackMemberId =
      String(form.dataset.attendanceManualMemberId || reopenDraft?.memberId || "").trim();
    const fallbackWorkDate =
      String(form.dataset.attendanceManualWorkDate || reopenDraft?.date || "").trim();
    if (!existingLog) {
      const fallbackMatch = findAttendanceLogForMemberAndDate(fallbackMemberId, fallbackWorkDate);
      existingLog = fallbackMatch.log || null;
      existingId = String(existingLog?.id || existingId).trim();
    }
    if (!existingId || !existingLog) {
      showFormFeedback(form, "This attendance record could not be found. Reopen it and try again.");
      return;
    }
    const reopenTarget = `${fallbackMemberId || String(existingLog.userId || "").trim()}::${fallbackWorkDate || String(existingLog.date || "").trim()}`;

    openConfirmModal({
      title: "Delete attendance record?",
      message: "This removes the clock in, clock out, and recorded break for this day.",
      confirmLabel: "Delete record",
      cancelLabel: "Cancel",
      danger: true,
      onCancel: () => {
        openModal(reopenTarget, { draft: reopenDraft });
        return false;
      },
      onConfirm: async () => {
        if (!attendanceSupabaseUnavailableMessage()) {
          const deleted = await runAttendanceSnapshotMutation(() => deleteSupabaseAttendanceManualEntry(existingId), {
            errorPrefix: "Delete attendance failed",
            render: false
          });
          if (!deleted) {
            openModal(reopenTarget, { draft: reopenDraft });
            return false;
          }
          state.attendanceHistorySelectedLogId = "";
          renderRoute();
          showToast("Attendance record deleted.", { tone: "success" });
          return true;
        }

        state.data.attendanceLogs = (state.data.attendanceLogs || []).filter((entry) => String(entry.id || "").trim() !== existingId);
        state.attendanceHistorySelectedLogId = "";
        persistDataAndRefresh();
        showToast("Attendance record deleted.", { tone: "success" });
        return true;
      }
    });
  }

  function openModal(targetValue = "", options = {}) {
    ensureAttendanceCollections(state.data);
    const { memberKey, workDate } = parseAttendanceManualTarget(targetValue);
    const draft = options && typeof options === "object" ? options.draft || null : null;
    const { member, log } = findAttendanceLogForMemberAndDate(memberKey, workDate);
    const modalOverlay = document.getElementById("modalOverlay");
    const modalTitle = document.getElementById("modalTitle");
    const modalForm = document.getElementById("modalForm");
    const modalCard = document.querySelector(".modal-card");
    if (!modalOverlay || !modalTitle || !modalForm || !modalCard) {
      return;
    }

    const firstBreak = Array.isArray(log?.breaks) ? log.breaks.find((entry) => entry?.startAt) || null : null;
    const selectedMemberId = String(draft?.memberId || member?.id || memberKey || "").trim();
    const defaultDate = String(draft?.date || log?.date || workDate || "").trim();
    const initialClockInTime = String(draft?.clockInTime || formatTimeForInput(log?.clockInAt || "")).trim();
    const initialClockOutTime = String(draft?.clockOutTime || formatTimeForInput(log?.clockOutAt || "")).trim();
    const initialHasBreak = typeof draft?.hasBreak === "boolean" ? draft.hasBreak : Boolean(firstBreak);
    const initialBreakStartTime = String(draft?.breakStartTime || formatTimeForInput(firstBreak?.startAt || "")).trim();
    const initialBreakEndTime = String(draft?.breakEndTime || formatTimeForInput(firstBreak?.endAt || "")).trim();
    const policy = state.data.attendancePolicy || defaultAttendancePolicy();
    const currentShiftDate = String(getAttendanceReferenceShiftContext(new Date().toISOString(), policy)?.shiftDateIso || "").trim();
    const clockOutOffset = getAttendanceManualDateOffset(defaultDate, log?.clockOutAt || "");
    const breakStartOffset = getAttendanceManualDateOffset(defaultDate, firstBreak?.startAt || "");
    const breakEndOffset = getAttendanceManualDateOffset(defaultDate, firstBreak?.endAt || "");
    const noteText = state.supabaseConfigured
      ? "Manager edits save directly to the workspace attendance record. Overnight times automatically roll into the next day when needed."
      : "Attendance changes save immediately to the workspace view. Overnight times automatically roll into the next day when needed.";
    const memberOptions = (state.data.teamMembers || [])
      .map((entry) => {
        const optionValue = String(entry.id || entry.name || "").trim();
        const optionLabel = String(entry.name || optionValue || "Member").trim();
        const isSelected = optionValue && optionValue === selectedMemberId;
        return `<option value="${escapeModalText(optionValue)}" ${isSelected ? "selected" : ""}>${escapeModalText(optionLabel)}</option>`;
      })
      .join("");

    state.leadConversionDraft = null;
    modalOverlay.classList.remove("is-lead-drawer");
    modalCard.classList.remove("is-lead-drawer");
    modalCard.classList.remove("is-lead-compose");
    modalCard.classList.remove("is-contact-compose");
    modalCard.classList.remove("is-account-compose");
    modalCard.classList.remove("is-wide");
    modalCard.classList.remove("is-task-compose");
    modalCard.classList.remove("is-project-compose");
    modalCard.classList.remove("is-profile-compose");
    modalCard.classList.remove("is-attendance-policy");
    modalCard.classList.remove("is-attendance-manual");
    modalCard.classList.add("is-attendance-manual");

    modalTitle.textContent = log ? "Edit attendance" : "Add attendance";
    modalForm.dataset.mode = "attendance-manual-compose";
    modalForm.dataset.route = "attendance";
    modalForm.dataset.logId = String(log?.id || "").trim();
    modalForm.dataset.attendanceManualMemberId = selectedMemberId;
    modalForm.dataset.attendanceManualWorkDate = defaultDate;
    modalForm.dataset.currentShiftDate = currentShiftDate;
    modalForm.innerHTML = `
      <div class="attendance-manual-shell">
        <div class="attendance-manual-toprow">
          <label class="form-field">
            <span>Team member</span>
            <select name="memberId" required>
              <option value="">Select team member</option>
              ${memberOptions}
            </select>
          </label>
          <label class="form-field">
            <span>Date</span>
            <input type="date" name="date" value="${escapeModalText(defaultDate)}" required />
          </label>
        </div>

        <section class="attendance-manual-section is-primary">
          <div class="attendance-manual-section-head">
            <div>
              <p class="attendance-manual-eyebrow">Work session</p>
              <h4>Clock in and clock out</h4>
            </div>
          </div>
          <div class="attendance-manual-time-grid">
            <label class="form-field attendance-manual-field">
              <div class="attendance-manual-field-label">
                <span>Clock in</span>
              </div>
              <input type="time" name="clockInTime" step="60" value="${escapeModalText(initialClockInTime)}" required />
            </label>
            <label class="form-field attendance-manual-field">
              <div class="attendance-manual-field-label">
                <span>Clock out</span>
                <small class="attendance-manual-badge" data-attendance-clockout-badge ${clockOutOffset > 0 ? "" : "hidden"}>Next day</small>
              </div>
              <input type="time" name="clockOutTime" step="60" value="${escapeModalText(initialClockOutTime)}" />
              <button type="button" class="mini-btn" data-action="attendance-manual-clear-clock-out" data-attendance-manual-clear-clock-out ${log?.clockOutAt && defaultDate === currentShiftDate ? "" : "hidden"}>Clear clock out</button>
            </label>
          </div>
        </section>

        <section class="attendance-manual-section is-secondary">
          <div class="attendance-manual-section-head">
            <div>
              <p class="attendance-manual-eyebrow">Optional break</p>
              <h4>Track one break if needed</h4>
            </div>
            <div class="attendance-manual-head-actions">
              <label class="attendance-manual-toggle">
                <input
                  type="checkbox"
                  name="hasBreak"
                  value="1"
                  data-attendance-manual-break-toggle
                  ${initialHasBreak ? "checked" : ""}
                />
                <span>Add break</span>
              </label>
              <button type="button" class="mini-btn" data-action="attendance-manual-remove-break" data-attendance-manual-remove-break ${initialHasBreak || initialBreakStartTime || initialBreakEndTime ? "" : "hidden"}>Remove break</button>
            </div>
          </div>
          <p class="attendance-manual-empty" data-attendance-manual-break-empty ${initialHasBreak ? "hidden" : ""}>No break recorded yet.</p>
          <div class="attendance-manual-break-grid" data-attendance-manual-break-fields ${initialHasBreak ? "" : "hidden"}>
            <label class="form-field attendance-manual-field">
              <div class="attendance-manual-field-label">
                <span>Break start</span>
                <small class="attendance-manual-badge" data-attendance-breakstart-badge ${breakStartOffset > 0 ? "" : "hidden"}>Next day</small>
              </div>
              <input type="time" name="breakStartTime" step="60" value="${escapeModalText(initialBreakStartTime)}" />
            </label>
            <label class="form-field attendance-manual-field">
              <div class="attendance-manual-field-label">
                <span>Break end</span>
                <small class="attendance-manual-badge" data-attendance-breakend-badge ${breakEndOffset > breakStartOffset ? "" : "hidden"}>Next day</small>
              </div>
              <input type="time" name="breakEndTime" step="60" value="${escapeModalText(initialBreakEndTime)}" />
            </label>
          </div>
        </section>

        <div class="attendance-manual-summary" data-attendance-manual-summary>
          <div class="attendance-manual-summary-item">
            <span>Worked hours</span>
            <strong data-attendance-summary-worked>--</strong>
          </div>
          <div class="attendance-manual-summary-item">
            <span>Break minutes</span>
            <strong data-attendance-summary-break>0m</strong>
          </div>
          <div class="attendance-manual-summary-item">
            <span>Status preview</span>
            <strong class="attendance-manual-summary-status is-off" data-attendance-summary-status>Not set</strong>
            <small class="attendance-manual-summary-detail" data-attendance-summary-reason>Add a clock-in time to preview the status.</small>
          </div>
        </div>

        ${log
          ? `<div class="attendance-manual-danger">
              <div>
                <strong>Delete this record</strong>
                <p>Removes the clock in, clock out, and break for this day.</p>
              </div>
              <button type="button" class="btn btn-danger" data-action="attendance-manual-delete">Delete record</button>
            </div>`
          : ""}

        <p class="attendance-manual-note">${escapeModalText(noteText)}</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-light" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-accent">${log ? "Save changes" : "Save attendance"}</button>
      </div>
    `;
    bindManualActions(modalForm);
    syncUi(modalForm);
    modalOverlay.hidden = false;
  }

  async function submitForm(form) {
    clearFormFeedback(form);
    ensureAttendanceCollections(state.data);
    const draft = buildAttendanceManualEntryDraft(form);
    const {
      memberId,
      workDate,
      hasBreak,
      clockInTime,
      clockOutTime,
      breakStartTime,
      breakEndTime,
      clockInAt,
      clockOutAt,
      breakStartAt,
      breakEndAt
    } = draft;
    const member = findAttendanceMemberByValue(memberId);

    if (!member) {
      showFormFeedback(form, "Choose a valid team member.", { fieldSelector: "select[name='memberId']" });
      return;
    }
    if (!parseIsoDateLocal(workDate)) {
      showFormFeedback(form, "Choose a valid work date.", { fieldSelector: "input[name='date']" });
      return;
    }
    if (!clockInAt) {
      showFormFeedback(form, "Clock-in time is required.", { fieldSelector: "input[name='clockInTime']" });
      return;
    }
    if (clockOutTime && !clockOutAt) {
      showFormFeedback(form, "Clock-out time is invalid.", { fieldSelector: "input[name='clockOutTime']" });
      return;
    }
    if (clockOutAt && clockOutAt <= clockInAt) {
      showFormFeedback(form, "Clock-out time must be later than clock-in time.", { fieldSelector: "input[name='clockOutTime']" });
      return;
    }
    if (hasBreak && ((breakStartTime && !breakStartAt) || (breakEndTime && !breakEndAt))) {
      showFormFeedback(form, "Break times are invalid.", { fieldSelector: "input[name='breakStartTime']" });
      return;
    }
    if (hasBreak && ((breakStartAt && !breakEndAt) || (!breakStartAt && breakEndAt))) {
      showFormFeedback(form, "Provide both break start and break end.", { fieldSelector: "input[name='breakStartTime']" });
      return;
    }
    if (breakStartAt && breakEndAt) {
      if (breakEndAt <= breakStartAt) {
        showFormFeedback(form, "Break end must be later than break start.", { fieldSelector: "input[name='breakEndTime']" });
        return;
      }
      if (breakStartAt < clockInAt || (clockOutAt && breakEndAt > clockOutAt)) {
        showFormFeedback(form, "Break must stay within the work session.", { fieldSelector: "input[name='breakStartTime']" });
        return;
      }
    }

    const existingId = String(form.dataset.logId || "").trim();
    const existingLog = (state.data.attendanceLogs || []).find((entry) => String(entry.id || "").trim() === existingId) || null;

    if (!attendanceSupabaseUnavailableMessage()) {
      const submitted = await runAttendanceSnapshotMutation(
        () =>
          upsertSupabaseAttendanceManualEntry({
            memberId: String(member.id || "").trim(),
            workDate,
            clockInAt: clockInAt.toISOString(),
            clockOutAt: clockOutAt ? clockOutAt.toISOString() : "",
            breakStartAt: breakStartAt ? breakStartAt.toISOString() : "",
            breakEndAt: breakEndAt ? breakEndAt.toISOString() : "",
            breakCode: String(existingLog?.breaks?.[0]?.breakTypeId || "").trim(),
            breakLabel: String(existingLog?.breaks?.[0]?.breakTypeLabel || "").trim(),
            breakPaid: existingLog?.breaks?.[0]?.paid
          }),
        {
          errorPrefix: existingLog ? "Save attendance failed" : "Add attendance failed",
          render: false
        }
      );
      if (!submitted) {
        return;
      }
      state.attendanceHistorySelectedLogId = "";
      closeModal();
      renderRoute();
      showToast(existingLog ? "Attendance updated." : "Attendance added.", { tone: "success" });
      return;
    }

    const nowIso = new Date().toISOString();
    const nextLog = existingLog || {
      id: createId("att"),
      createdAt: nowIso
    };
    nextLog.userId = String(member.id || "").trim();
    nextLog.userName = String(member.name || "").trim() || String(memberId);
    nextLog.date = workDate;
    nextLog.clockInAt = clockInAt.toISOString();
    nextLog.clockOutAt = clockOutAt ? clockOutAt.toISOString() : "";
    nextLog.breaks = breakStartAt && breakEndAt
      ? [
          {
            id: String(existingLog?.breaks?.[0]?.id || createId("brk")).trim(),
            breakTypeId: String(existingLog?.breaks?.[0]?.breakTypeId || "manual").trim(),
            breakTypeLabel: String(existingLog?.breaks?.[0]?.breakTypeLabel || "Manual Break").trim(),
            paid: Boolean(existingLog?.breaks?.[0]?.paid),
            startAt: breakStartAt.toISOString(),
            endAt: breakEndAt.toISOString()
          }
        ]
      : [];
    nextLog.source = String(existingLog?.source || "manual-admin");
    nextLog.updatedAt = nowIso;

    if (!existingLog) {
      state.data.attendanceLogs.unshift(nextLog);
    }

    state.attendanceHistorySelectedLogId = "";
    closeModal();
    persistDataAndRefresh();
  }

  return {
    openModal,
    submitForm,
    syncUi,
    clearClockOutDraft,
    removeBreakDraft,
    deleteEntry
  };
}
