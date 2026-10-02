export function canManageLeadArchive(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return normalizedRole === "owner" || normalizedRole === "admin";
}

export function createEmptyLeadArchiveData(overrides = {}) {
  return {
    rows: [],
    totalCount: 0,
    page: 1,
    pageSize: 25,
    statusFilter: "all",
    loading: false,
    loaded: false,
    error: "",
    hasMore: false,
    busyIds: [],
    lastLoadedAt: 0,
    ...overrides
  };
}

function matchesLocalArchiveSearch(lead, searchTerm) {
  const normalizedSearch = String(searchTerm || "").trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }
  return [lead?.name, lead?.company, lead?.email, lead?.phone, lead?.source, lead?.status]
    .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
}

export function buildLocalArchivedLeadPage(leads = [], options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.max(1, Number(options.pageSize) || 25);
  const statusFilter = String(options.statusFilter || "all").trim();
  const filtered = (Array.isArray(leads) ? leads : [])
    .filter((lead) => Boolean(lead?.archived || String(lead?.archivedAt || "").trim()))
    .filter((lead) => statusFilter === "all" || String(lead?.status || "").trim() === statusFilter)
    .filter((lead) => matchesLocalArchiveSearch(lead, options.searchTerm))
    .sort((left, right) => String(right?.archivedAt || "").localeCompare(String(left?.archivedAt || "")));
  const startIndex = (page - 1) * pageSize;
  return {
    rows: filtered.slice(startIndex, startIndex + pageSize),
    totalCount: filtered.length,
    page,
    pageSize,
    hasMore: startIndex + pageSize < filtered.length
  };
}

export function createLeadArchivePageController({
  state,
  canManage,
  isLiveEnabled,
  fetchPage,
  restoreRemote,
  deleteRemote,
  openConfirmModal,
  renderRoute,
  renderRoutePreservingInput,
  onRestored,
  onDeleted,
  showToast
}) {
  let refreshSequence = 0;
  let searchTimer = 0;

  function getArchiveData() {
    if (!state.leadArchiveData || typeof state.leadArchiveData !== "object") {
      state.leadArchiveData = createEmptyLeadArchiveData();
    }
    return state.leadArchiveData;
  }

  function getArchivedLead(leadId) {
    const normalizedId = String(leadId || "").trim();
    return getArchiveData().rows.find((lead) => String(lead?.id || "").trim() === normalizedId) || null;
  }

  function setBusy(leadId, busy) {
    const normalizedId = String(leadId || "").trim();
    const current = new Set(getArchiveData().busyIds || []);
    if (busy) {
      current.add(normalizedId);
    } else {
      current.delete(normalizedId);
    }
    state.leadArchiveData = { ...getArchiveData(), busyIds: [...current] };
  }

  async function refresh(options = {}) {
    if (!canManage()) {
      return false;
    }
    const current = getArchiveData();
    const request = {
      page: Math.max(1, Number(current.page) || 1),
      pageSize: Math.max(1, Number(current.pageSize) || 25),
      statusFilter: String(current.statusFilter || "all").trim() || "all",
      searchTerm: String(state.searchTerm || "").trim(),
      teamMembers: state.data.teamMembers || []
    };
    const requestSequence = ++refreshSequence;
    state.leadArchiveData = createEmptyLeadArchiveData({
      ...current,
      loading: true,
      error: ""
    });
    if (options.renderStart !== false) {
      renderRoute();
    }

    try {
      const pageData = isLiveEnabled()
        ? await fetchPage(String(state.data.workspace?.id || "").trim(), request)
        : buildLocalArchivedLeadPage(state.data.leads || [], request);
      if (requestSequence !== refreshSequence) {
        return true;
      }
      state.leadArchiveData = createEmptyLeadArchiveData({
        ...current,
        ...pageData,
        statusFilter: request.statusFilter,
        loading: false,
        loaded: true,
        error: "",
        lastLoadedAt: Date.now()
      });
      if (options.preserveInput) {
        const { inputId, caretStart, caretEnd } = options.preserveInput;
        renderRoutePreservingInput(inputId, caretStart, caretEnd);
      } else {
        renderRoute();
      }
      return true;
    } catch (error) {
      if (requestSequence !== refreshSequence) {
        return false;
      }
      state.leadArchiveData = createEmptyLeadArchiveData({
        ...current,
        loading: false,
        loaded: true,
        error: String(error?.message || error || "Archived leads could not be loaded.")
      });
      renderRoute();
      return false;
    }
  }

  function scheduleSearch(value, preserveInput) {
    state.searchTerm = String(value || "");
    state.leadArchiveData = createEmptyLeadArchiveData({ ...getArchiveData(), page: 1 });
    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }
    searchTimer = window.setTimeout(() => {
      searchTimer = 0;
      void refresh({ preserveInput });
    }, 280);
  }

  function setStatusFilter(value) {
    state.leadArchiveData = createEmptyLeadArchiveData({
      ...getArchiveData(),
      page: 1,
      statusFilter: String(value || "all").trim() || "all"
    });
    void refresh();
  }

  function changePage(direction) {
    const current = getArchiveData();
    const nextPage = String(direction || "").toLowerCase() === "prev"
      ? Math.max(1, Number(current.page || 1) - 1)
      : Number(current.page || 1) + 1;
    if (nextPage === current.page || (nextPage > current.page && !current.hasMore)) {
      return;
    }
    state.leadArchiveData = createEmptyLeadArchiveData({ ...current, page: nextPage });
    void refresh();
  }

  function restore(leadId) {
    const lead = getArchivedLead(leadId);
    if (!lead) {
      showToast("That archived lead is no longer available.", { tone: "warning" });
      return;
    }
    openConfirmModal({
      title: "Restore lead?",
      message: `Restore “${lead.name}” to the active Leads list?`,
      confirmLabel: "Restore",
      onConfirm: async () => {
        setBusy(lead.id, true);
        renderRoute();
        try {
          if (isLiveEnabled()) {
            await restoreRemote(lead.id);
          }
          onRestored(lead);
          showToast(`${lead.name} was restored to Leads.`, { tone: "success" });
          setBusy(lead.id, false);
          const current = getArchiveData();
          if (current.rows.length === 1 && current.page > 1) {
            state.leadArchiveData = createEmptyLeadArchiveData({ ...current, page: current.page - 1 });
          }
          await refresh({ renderStart: false });
        } catch (error) {
          setBusy(lead.id, false);
          renderRoute();
          showToast(`Restore failed: ${String(error?.message || error)}`, { tone: "danger" });
        }
      }
    });
  }

  function permanentlyDelete(leadId) {
    const lead = getArchivedLead(leadId);
    if (!lead) {
      showToast("That archived lead is no longer available.", { tone: "warning" });
      return;
    }
    openConfirmModal({
      title: "Permanently delete lead?",
      message: `Permanently delete “${lead.name}”? This cannot be undone.`,
      confirmLabel: "Delete permanently",
      danger: true,
      onConfirm: async () => {
        setBusy(lead.id, true);
        renderRoute();
        try {
          if (isLiveEnabled()) {
            await deleteRemote(lead.id);
          }
          onDeleted(lead);
          showToast(`${lead.name} was permanently deleted.`, { tone: "success" });
          setBusy(lead.id, false);
          const current = getArchiveData();
          if (current.rows.length === 1 && current.page > 1) {
            state.leadArchiveData = createEmptyLeadArchiveData({ ...current, page: current.page - 1 });
          }
          await refresh({ renderStart: false });
        } catch (error) {
          setBusy(lead.id, false);
          renderRoute();
          showToast(`Permanent delete failed: ${String(error?.message || error)}`, { tone: "danger" });
        }
      }
    });
  }

  return {
    changePage,
    permanentlyDelete,
    refresh,
    restore,
    scheduleSearch,
    setStatusFilter
  };
}
