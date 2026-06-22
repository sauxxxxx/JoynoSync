export function createLeadArchiveActions({
  state,
  getSelectedLeads,
  openConfirmModal,
  persistLeadArchiveState,
  pushLeadActivity,
  clearLeadSelection,
  createEmptyLeadProfileData,
  saveData,
  renderRoute,
  isSupabaseCrmWriteEnabled,
  refreshSupabaseCrmData,
  getLeadById,
  persistDataAndRefresh,
  setRoute
}) {
  const LEAD_ARCHIVE_HIDE_DELAY_MS = 1500;

  const wait = (ms) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });

  const normalizeLeadId = (value) => String(value || "").trim();

  function beginLeadArchiving(ids = []) {
    ids.forEach((id) => {
      const leadId = normalizeLeadId(id);
      if (!leadId) {
        return;
      }
      state.leadArchivingIds.add(leadId);
      state.leadArchiveHiddenIds.delete(leadId);
    });
    renderRoute();
  }

  function hideLeadRows(ids = []) {
    ids.forEach((id) => {
      const leadId = normalizeLeadId(id);
      if (!leadId || !state.leadArchivingIds.has(leadId)) {
        return;
      }
      state.leadArchiveHiddenIds.add(leadId);
      state.selectedLeadIds.delete(leadId);
    });
    renderRoute();
  }

  function finishLeadArchiving(ids = []) {
    ids.forEach((id) => {
      const leadId = normalizeLeadId(id);
      if (!leadId) {
        return;
      }
      state.leadArchivingIds.delete(leadId);
      state.leadArchiveHiddenIds.delete(leadId);
    });
  }

  function openBulkArchiveConfirm() {
    const selected = getSelectedLeads();
    if (!selected.length) {
      return;
    }
    state.leadBulkStatusOpen = false;
    state.leadBulkStatusPlacement = "up";
    state.leadBulkStatusPopoverStyle = "";
    openConfirmModal({
      title: "Archive selected leads?",
      message: `Archive ${selected.length} selected lead${selected.length === 1 ? "" : "s"}? This will remove ${selected.length === 1 ? "it" : "them"} from the active list.`,
      confirmLabel: "Archive",
      danger: true,
      onConfirm: async () => {
        const selectedIds = selected.map((lead) => normalizeLeadId(lead?.id)).filter(Boolean);
        const failedIds = new Set();
        beginLeadArchiving(selectedIds);
        try {
          const archiveTasks = selected.map(async (lead) => {
            const leadId = normalizeLeadId(lead?.id);
            try {
              const changed = await persistLeadArchiveState(lead.id, new Date().toISOString());
              if (!changed) {
                failedIds.add(leadId);
              }
              return {
                lead,
                leadId,
                changed,
                error: null
              };
            } catch (error) {
              failedIds.add(leadId);
              return {
                lead,
                leadId,
                changed: false,
                error
              };
            }
          });

          await wait(LEAD_ARCHIVE_HIDE_DELAY_MS);
          hideLeadRows(selectedIds.filter((leadId) => !failedIds.has(leadId)));

          const results = await Promise.all(archiveTasks);
          const archivedIds = new Set();
          const errors = [];
          results.forEach(({ lead, leadId, changed, error }) => {
            if (changed) {
              archivedIds.add(leadId);
              pushLeadActivity({
                leadId: lead.id,
                type: "lead-archived",
                text: "Lead moved to archive."
              });
              return;
            }
            if (error) {
              errors.push(error);
            }
          });

          finishLeadArchiving(selectedIds);
          if (archivedIds.has(normalizeLeadId(state.selectedLeadId))) {
            state.selectedLeadId = "";
            state.leadProfileData = createEmptyLeadProfileData();
          }

          if (archivedIds.size) {
            selectedIds.forEach((leadId) => {
              if (!failedIds.has(leadId)) {
                state.selectedLeadIds.delete(leadId);
              }
            });
            saveData(state.data);
          }
          renderRoute();
          if (archivedIds.size && isSupabaseCrmWriteEnabled()) {
            void refreshSupabaseCrmData({ render: false, persist: false, alertOnError: false });
          }
          if (failedIds.size) {
            const firstError = errors[0];
            window.alert(
              archivedIds.size
                ? `Archived ${archivedIds.size} lead${archivedIds.size === 1 ? "" : "s"}, but ${failedIds.size} failed${firstError?.message ? `: ${firstError.message}` : "."}`
                : `Bulk lead archive failed${firstError?.message ? `: ${firstError.message}` : "."}`
            );
          }
        } catch (error) {
          finishLeadArchiving(selectedIds);
          renderRoute();
          window.alert(`Bulk lead archive failed: ${error.message}`);
        }
      }
    });
  }

  function openSingleArchiveConfirm(id) {
    const lead = getLeadById(id);
    if (!lead) {
      window.alert("Lead not found.");
      return;
    }
    openConfirmModal({
      title: "Archive lead?",
      message: `Archive lead "${lead.name}"? This will remove it from the active list. You can restore it later if needed.`,
      confirmLabel: "Archive",
      danger: true,
      onConfirm: async () => {
        const leadId = normalizeLeadId(lead.id);
        beginLeadArchiving([leadId]);
        try {
          const shouldReturnToLeads =
            state.routeId === "lead-profile" &&
            normalizeLeadId(state.selectedLeadId) === leadId;
          let archiveError = null;
          let changed = false;
          const archiveTask = (async () => {
            try {
              changed = await persistLeadArchiveState(lead.id, new Date().toISOString());
            } catch (error) {
              archiveError = error;
            }
          })();

          await wait(LEAD_ARCHIVE_HIDE_DELAY_MS);
          if (!archiveError) {
            hideLeadRows([leadId]);
          }

          await archiveTask;
          finishLeadArchiving([leadId]);
          if (!changed) {
            renderRoute();
            if (archiveError) {
              window.alert(`Archive lead failed: ${archiveError.message}`);
            }
            return;
          }
          pushLeadActivity({
            leadId: lead.id,
            type: "lead-archived",
            text: "Lead moved to archive."
          });
          state.selectedLeadIds.delete(leadId);
          persistDataAndRefresh();
          if (isSupabaseCrmWriteEnabled()) {
            void refreshSupabaseCrmData({ render: false, persist: false, alertOnError: false });
          }
          if (normalizeLeadId(state.selectedLeadId) === leadId) {
            state.selectedLeadId = "";
            state.leadProfileData = createEmptyLeadProfileData();
          }
          if (shouldReturnToLeads) {
            setRoute("leads");
          }
        } catch (error) {
          finishLeadArchiving([normalizeLeadId(lead.id)]);
          renderRoute();
          window.alert(`Archive lead failed: ${error.message}`);
        }
      }
    });
  }

  return {
    openBulkArchiveConfirm,
    openSingleArchiveConfirm
  };
}
