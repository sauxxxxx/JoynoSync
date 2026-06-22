export function createConfirmModalController({ state, closeModal, escapeModalText }) {
  let pendingConfirmAction = null;
  let pendingCancelAction = null;
  let confirmModalBusy = false;
  let boundModalForm = null;
  let boundModalOverlay = null;
  let boundModalCloseButton = null;

  function handleModalFormClick(event) {
    const actionButton = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    const action = String(actionButton?.dataset?.action || "").trim();
    if (action !== "confirm-accept" && action !== "confirm-cancel") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void resolve(action === "confirm-accept");
  }

  function handleModalOverlayClick(event) {
    if (event.target !== boundModalOverlay) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void resolve(false);
  }

  function handleModalCloseClick(event) {
    event.preventDefault();
    event.stopPropagation();
    void resolve(false);
  }

  function unbindInteractions() {
    if (boundModalForm) {
      boundModalForm.removeEventListener("click", handleModalFormClick);
      boundModalForm = null;
    }
    if (boundModalOverlay) {
      boundModalOverlay.removeEventListener("click", handleModalOverlayClick);
      boundModalOverlay = null;
    }
    if (boundModalCloseButton) {
      boundModalCloseButton.removeEventListener("click", handleModalCloseClick);
      boundModalCloseButton = null;
    }
  }

  function bindInteractions(modalOverlay, modalForm, modalCloseButton) {
    unbindInteractions();
    boundModalForm = modalForm;
    boundModalOverlay = modalOverlay;
    boundModalCloseButton = modalCloseButton instanceof HTMLButtonElement ? modalCloseButton : null;
    boundModalForm.addEventListener("click", handleModalFormClick);
    boundModalOverlay.addEventListener("click", handleModalOverlayClick);
    if (boundModalCloseButton) {
      boundModalCloseButton.addEventListener("click", handleModalCloseClick);
    }
  }

  function reset() {
    unbindInteractions();
    pendingConfirmAction = null;
    pendingCancelAction = null;
    confirmModalBusy = false;
  }

  function setBusyState(busy) {
    const modalForm = document.getElementById("modalForm");
    if (!(modalForm instanceof HTMLFormElement) || modalForm.dataset.mode !== "confirm-action") {
      return;
    }
    const confirmButton = modalForm.querySelector("[data-action='confirm-accept']");
    if (confirmButton instanceof HTMLButtonElement) {
      confirmButton.disabled = busy;
      const baseLabel = confirmButton.dataset.confirmLabel || confirmButton.textContent || "Confirm";
      confirmButton.textContent = busy ? "Working..." : baseLabel;
    }
    const cancelButton = modalForm.querySelector("[data-action='confirm-cancel']");
    if (cancelButton instanceof HTMLButtonElement) {
      cancelButton.disabled = busy;
    }
  }

  function open(options = {}) {
    const {
      title = "Confirm action",
      message = "Are you sure?",
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      danger = true,
      onConfirm = null,
      onCancel = null
    } = options;
    const modalOverlay = document.getElementById("modalOverlay");
    const modalTitle = document.getElementById("modalTitle");
    const modalForm = document.getElementById("modalForm");
    const modalCard = document.querySelector(".modal-card");
    const modalCloseButton = document.getElementById("modalCloseButton");

    if (!modalOverlay || !modalTitle || !modalForm || !modalCard) {
      if (typeof onConfirm === "function" && window.confirm(String(message || title))) {
        onConfirm();
      } else if (typeof onCancel === "function") {
        onCancel();
      }
      return;
    }

    state.leadConversionDraft = null;
    pendingConfirmAction = typeof onConfirm === "function" ? onConfirm : null;
    pendingCancelAction = typeof onCancel === "function" ? onCancel : null;
    confirmModalBusy = false;
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
    modalCard.classList.add("is-confirm");
    if (modalCloseButton instanceof HTMLButtonElement) {
      modalCloseButton.dataset.action = "confirm-cancel";
    }

    const confirmButtonClass = danger ? "btn-danger" : "btn-accent";
    modalTitle.textContent = title;
    modalForm.dataset.mode = "confirm-action";
    modalForm.innerHTML = `
      <section class="confirm-modal-shell">
        <p class="confirm-modal-message">${escapeModalText(message)}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-light" data-action="confirm-cancel">${escapeModalText(cancelLabel)}</button>
          <button
            type="button"
            class="btn ${confirmButtonClass}"
            data-action="confirm-accept"
            data-confirm-label="${escapeModalText(confirmLabel)}"
          >${escapeModalText(confirmLabel)}</button>
        </div>
      </section>
    `;
    setBusyState(false);
    bindInteractions(modalOverlay, modalForm, modalCloseButton);
    modalOverlay.hidden = false;
    window.setTimeout(() => {
      const confirmButton = modalForm.querySelector("[data-action='confirm-accept']");
      if (confirmButton instanceof HTMLElement && typeof confirmButton.focus === "function") {
        confirmButton.focus({ preventScroll: true });
      }
    }, 0);
  }

  async function resolve(confirmed) {
    if (confirmModalBusy) {
      return;
    }
    const confirmCallback = pendingConfirmAction;
    const cancelCallback = pendingCancelAction;
    pendingConfirmAction = null;
    pendingCancelAction = null;
    const callback = confirmed ? confirmCallback : cancelCallback;

    if (typeof callback !== "function") {
      closeModal();
      return;
    }

    confirmModalBusy = true;
    setBusyState(true);
    try {
      const shouldClose = await callback();
      if (shouldClose !== false) {
        closeModal();
      } else {
        reset();
      }
    } finally {
      confirmModalBusy = false;
      setBusyState(false);
    }
  }

  return {
    open,
    resolve,
    reset,
    setBusyState
  };
}
