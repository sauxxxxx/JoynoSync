function getSettingsForm(source) {
  if (source instanceof HTMLFormElement) {
    return source.matches(".settings-editor") ? source : null;
  }
  return source?.closest?.(".settings-editor") || null;
}

function getControlSnapshot(editor) {
  return Array.from(editor.querySelectorAll("input, select, textarea")).map((control) => ({
    checked: "checked" in control ? Boolean(control.checked) : undefined,
    value: String(control.value || "")
  }));
}

function restoreControlSnapshot(editor) {
  const snapshot = JSON.parse(editor.dataset.settingsOriginal || "[]");
  Array.from(editor.querySelectorAll("input, select, textarea")).forEach((control, index) => {
    const original = snapshot[index];
    if (!original) {
      return;
    }
    control.value = original.value;
    if (typeof original.checked === "boolean" && "checked" in control) {
      control.checked = original.checked;
    }
  });
  editor.querySelectorAll("[data-settings-picker]").forEach(syncSettingsPicker);
}

function getSettingsPickerParts(picker) {
  return {
    input: picker?.querySelector?.("[data-settings-picker-input]"),
    trigger: picker?.querySelector?.("[data-settings-picker-trigger]"),
    menu: picker?.querySelector?.("[data-settings-picker-menu], .settings-picker-menu")
  };
}

function closeSettingsPicker(picker, { focus = false } = {}) {
  const { trigger, menu } = getSettingsPickerParts(picker);
  if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) {
    return;
  }
  trigger.setAttribute("aria-expanded", "false");
  picker.classList.remove("is-open");
  menu.hidden = true;
  if (focus) {
    trigger.focus();
  }
}

function closeSettingsPickers(root = document, except = null) {
  root.querySelectorAll("[data-settings-picker].is-open").forEach((picker) => {
    if (picker !== except) {
      closeSettingsPicker(picker);
    }
  });
}

function openSettingsPicker(picker, { focusOption = false } = {}) {
  const { trigger, menu } = getSettingsPickerParts(picker);
  if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) {
    return;
  }
  closeSettingsPickers(picker.ownerDocument, picker);
  trigger.setAttribute("aria-expanded", "true");
  picker.classList.add("is-open");
  menu.hidden = false;
  const triggerRect = trigger.getBoundingClientRect();
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const availableAbove = Math.max(0, triggerRect.top - 12);
  const availableBelow = Math.max(0, viewportHeight - triggerRect.bottom - 12);
  const menuHeight = Math.min(240, menu.scrollHeight || 240);
  const prefersUpward = Boolean(picker.closest("#settings-operations"));
  const opensUpward = (prefersUpward && availableAbove >= 96) || (availableBelow < menuHeight && availableAbove > availableBelow);
  picker.classList.toggle("is-upward", opensUpward);
  const availableSpace = opensUpward ? availableAbove : availableBelow;
  menu.style.maxHeight = `${Math.max(96, Math.min(240, availableSpace))}px`;
  if (focusOption) {
    window.requestAnimationFrame(() =>
      (menu.querySelector("[data-settings-picker-option].is-selected") || menu.querySelector("[data-settings-picker-option]"))?.focus()
    );
  }
}

function syncSettingsPicker(picker) {
  const { input, trigger } = getSettingsPickerParts(picker);
  if (!(input instanceof HTMLInputElement) || !(trigger instanceof HTMLButtonElement)) {
    return;
  }
  const options = Array.from(picker.querySelectorAll("[data-settings-picker-option]"));
  const selected = options.find((option) => option.dataset.value === input.value) || options[0];
  options.forEach((option) => {
    const isSelected = option === selected;
    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
  const label = selected?.querySelector("span")?.textContent?.trim() || "Choose an option";
  const triggerLabel = trigger.querySelector("[data-settings-picker-label]");
  if (triggerLabel) {
    triggerLabel.textContent = label;
  }
  const fieldLabel = picker.closest(".settings-field")?.querySelector(":scope > span:first-child")?.textContent?.trim() || "Setting";
  trigger.setAttribute("aria-label", `${fieldLabel}: ${label}`);
}

function selectSettingsPickerOption(option) {
  const picker = option?.closest?.("[data-settings-picker]");
  const { input } = getSettingsPickerParts(picker);
  if (!(picker instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
    return;
  }
  input.value = String(option.dataset.value || "");
  syncSettingsPicker(picker);
  closeSettingsPicker(picker, { focus: true });
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function handleSettingsPickerClick(event, root = document) {
  const target = event.target instanceof Element ? event.target : null;
  const option = target?.closest?.("[data-settings-picker-option]");
  if (option instanceof HTMLButtonElement) {
    event.preventDefault();
    selectSettingsPickerOption(option);
    return true;
  }
  const trigger = target?.closest?.("[data-settings-picker-trigger]");
  if (trigger instanceof HTMLButtonElement) {
    event.preventDefault();
    const picker = trigger.closest("[data-settings-picker]");
    if (picker?.classList.contains("is-open")) {
      closeSettingsPicker(picker);
    } else {
      openSettingsPicker(picker);
    }
    return true;
  }
  closeSettingsPickers(root);
  return false;
}

function syncFormDirtyState(form) {
  const isDirty = Boolean(form?.querySelector("[data-settings-inline-editor][data-settings-dirty='true']"));
  form?.classList.toggle("is-dirty", isDirty);
  if (form) {
    form.dataset.settingsDirty = isDirty ? "true" : "false";
  }
}

function getSettingsSaveParts(source) {
  const editor = source?.closest?.("[data-settings-inline-editor]");
  return {
    editor,
    form: editor?.closest?.(".settings-editor"),
    saveButton: editor?.querySelector?.(".settings-save-action"),
    confirmation: editor?.querySelector?.("[data-settings-save-confirm]")
  };
}

function closeSettingsSaveConfirmation(source, { focus = false } = {}) {
  const { editor, saveButton, confirmation } = getSettingsSaveParts(source);
  if (!(editor instanceof HTMLElement) || !(saveButton instanceof HTMLButtonElement) || !(confirmation instanceof HTMLElement)) {
    return;
  }
  confirmation.hidden = true;
  editor.classList.remove("is-confirming");
  saveButton.setAttribute("aria-expanded", "false");
  if (focus) {
    saveButton.focus();
  }
}

export function openSettingsSaveConfirmation(submitter) {
  const { editor, saveButton, confirmation } = getSettingsSaveParts(submitter);
  if (!(editor instanceof HTMLElement) || !(saveButton instanceof HTMLButtonElement) || !(confirmation instanceof HTMLElement)) {
    return;
  }
  confirmation.hidden = false;
  editor.classList.add("is-confirming");
  saveButton.setAttribute("aria-expanded", "true");
  window.requestAnimationFrame(() => confirmation.querySelector("[data-action='settings-confirm-save']")?.focus());
}

export function cancelSettingsSaveConfirmation(source) {
  closeSettingsSaveConfirmation(source, { focus: true });
}

export function confirmSettingsSave(source) {
  const { editor, form, saveButton } = getSettingsSaveParts(source);
  if (!(editor instanceof HTMLElement) || !(form instanceof HTMLFormElement) || !(saveButton instanceof HTMLButtonElement)) {
    return;
  }
  form.dataset.settingsConfirmedField = String(editor.dataset.id || "");
  closeSettingsSaveConfirmation(source);
  form.requestSubmit(saveButton);
}

export function consumeSettingsSaveConfirmation(form, submitter) {
  const editor = submitter?.closest?.("[data-settings-inline-editor]");
  const fieldId = String(editor?.dataset?.id || "");
  const isConfirmed = Boolean(fieldId && form?.dataset?.settingsConfirmedField === fieldId);
  if (form) {
    delete form.dataset.settingsConfirmedField;
  }
  return isConfirmed;
}

function closeSettingsInlineEditor(editor, { restore = false } = {}) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }
  if (restore) {
    restoreControlSnapshot(editor);
  }
  closeSettingsPickers(editor.ownerDocument);
  closeSettingsSaveConfirmation(editor);
  const trigger = editor.ownerDocument.querySelector(`[data-action='settings-edit-field'][data-id='${CSS.escape(editor.dataset.id || "")}']`);
  trigger?.setAttribute("aria-expanded", "false");
  editor.closest(".settings-summary-row")?.classList.remove("is-editing");
  editor.hidden = true;
  delete editor.dataset.settingsDirty;
  editor.querySelectorAll("[data-settings-save-status]").forEach((status) => {
    status.textContent = status.dataset.cleanText || "Save this setting to apply the change.";
  });
  syncFormDirtyState(editor.closest(".settings-editor"));
}

export function openSettingsInlineEditor(fieldId, root = document) {
  const id = String(fieldId || "").trim();
  const editor = root.querySelector(`[data-settings-inline-editor][data-id='${CSS.escape(id)}']`);
  if (!(editor instanceof HTMLElement)) {
    return;
  }
  const openEditors = Array.from(root.querySelectorAll("[data-settings-inline-editor]:not([hidden])")).filter(
    (openEditor) => openEditor !== editor
  );
  const hasDirtyEditor = openEditors.some((openEditor) => openEditor.dataset.settingsDirty === "true");
  if (hasDirtyEditor && !window.confirm("Discard the unsaved setting and edit another one?")) {
    openEditors.find((openEditor) => openEditor.dataset.settingsDirty === "true")?.querySelector("[data-settings-picker-trigger], input:not([type='hidden']), select, textarea")?.focus();
    return;
  }
  openEditors.forEach((openEditor) => closeSettingsInlineEditor(openEditor, { restore: true }));
  if (!editor.dataset.settingsOriginal) {
    editor.dataset.settingsOriginal = JSON.stringify(getControlSnapshot(editor));
  }
  editor.hidden = false;
  editor.closest(".settings-summary-row")?.classList.add("is-editing");
  root.querySelector(`[data-action='settings-edit-field'][data-id='${CSS.escape(id)}']`)?.setAttribute("aria-expanded", "true");
  window.requestAnimationFrame(() => editor.querySelector("[data-settings-picker-trigger], input:not([type='hidden']), select, textarea")?.focus());
}

export function cancelSettingsInlineEditor(fieldId, root = document) {
  const id = String(fieldId || "").trim();
  const editor = root.querySelector(`[data-settings-inline-editor][data-id='${CSS.escape(id)}']`);
  const trigger = root.querySelector(`[data-action='settings-edit-field'][data-id='${CSS.escape(id)}']`);
  closeSettingsInlineEditor(editor, { restore: true });
  trigger?.focus();
}

export function handleSettingsEditorKeydown(event) {
  const editor = event.target?.closest?.("[data-settings-inline-editor]:not([hidden])");
  if (!(editor instanceof HTMLElement)) {
    return false;
  }
  const saveConfirmation = editor.querySelector("[data-settings-save-confirm]:not([hidden])");
  if (event.key === "Escape" && saveConfirmation instanceof HTMLElement) {
    event.preventDefault();
    cancelSettingsSaveConfirmation(saveConfirmation);
    return true;
  }
  const picker = event.target?.closest?.("[data-settings-picker]");
  const pickerOption = event.target?.closest?.("[data-settings-picker-option]");
  const pickerTrigger = event.target?.closest?.("[data-settings-picker-trigger]");
  if (picker instanceof HTMLElement) {
    const options = Array.from(picker.querySelectorAll("[data-settings-picker-option]"));
    if (event.key === "Escape" && picker.classList.contains("is-open")) {
      event.preventDefault();
      closeSettingsPicker(picker, { focus: true });
      return true;
    }
    if (pickerTrigger && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      openSettingsPicker(picker, { focusOption: true });
      return true;
    }
    if (pickerOption && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectSettingsPickerOption(pickerOption);
      return true;
    }
    if (pickerOption && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const currentIndex = options.indexOf(pickerOption);
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[nextIndex]?.focus();
      return true;
    }
    if (pickerOption && event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const query = event.key.toLocaleLowerCase();
      const nextOption = options.find((option) => option.textContent.trim().toLocaleLowerCase().startsWith(query));
      if (nextOption) {
        event.preventDefault();
        nextOption.focus();
        return true;
      }
    }
    if (event.key === "Tab") {
      closeSettingsPicker(picker);
    }
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelSettingsInlineEditor(editor.dataset.id || "", editor.ownerDocument);
    return true;
  }
  const canSubmitWithEnter =
    event.key === "Enter" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.target?.matches?.("input:not([type='checkbox']):not([type='color'])");
  if (!canSubmitWithEnter) {
    return false;
  }
  event.preventDefault();
  const form = editor.closest("form");
  const submitButton = editor.querySelector("button[type='submit']");
  form?.requestSubmit(submitButton instanceof HTMLButtonElement ? submitButton : undefined);
  return true;
}

export function markSettingsFormDirty(source) {
  const form = getSettingsForm(source);
  if (!form || form.getAttribute("aria-busy") === "true") {
    return;
  }
  form.classList.add("is-dirty");
  form.dataset.settingsDirty = "true";
  const editor = source?.closest?.("[data-settings-inline-editor]");
  if (editor) {
    editor.dataset.settingsDirty = "true";
  }
  (editor || form).querySelectorAll("[data-settings-save-status]").forEach((status) => {
    if (!status.dataset.cleanText) {
      status.dataset.cleanText = String(status.textContent || "").trim();
    }
    status.textContent = "Unsaved changes";
  });
}

export function hasUnsavedSettingsChanges(root = document) {
  return Boolean(root.querySelector(".settings-editor[data-settings-dirty='true']"));
}

export function confirmSettingsNavigation(root = document) {
  if (!hasUnsavedSettingsChanges(root)) {
    return true;
  }
  return window.confirm("Leave Settings? Your unsaved changes will be lost.");
}

export function setSettingsFormBusy(form, busy, activeButton = null) {
  const settingsForm = getSettingsForm(form);
  if (!settingsForm) {
    return;
  }
  settingsForm.setAttribute("aria-busy", busy ? "true" : "false");
  const buttons = activeButton instanceof HTMLButtonElement
    ? [activeButton]
    : Array.from(settingsForm.querySelectorAll("button[type='submit']"));
  buttons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const label = button.querySelector("span");
    const icon = button.querySelector("i");
    const editor = button.closest("[data-settings-inline-editor]");
    if (!button.dataset.idleLabel) {
      button.dataset.idleLabel = String(label?.textContent || button.textContent || "Save").trim();
      button.dataset.idleTitle = String(button.title || "Save");
      button.dataset.idleIcon = String(icon?.className || "bi bi-check2");
    }
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
    button.setAttribute("aria-busy", busy ? "true" : "false");
    button.title = busy ? "Saving" : button.dataset.idleTitle;
    if (label) {
      label.textContent = busy ? `Saving${String.fromCharCode(8230)}` : button.dataset.idleLabel;
    }
    if (icon) {
      icon.className = busy ? "bi bi-arrow-repeat settings-save-spinner" : button.dataset.idleIcon;
    }
    editor?.classList.toggle("is-saving", busy);
    if (editor instanceof HTMLElement) {
      editor.inert = busy;
      editor.setAttribute("aria-busy", busy ? "true" : "false");
    }
  });
}

export async function runSettingsSave(form, submitter, saveAction) {
  const startedAt = performance.now();
  setSettingsFormBusy(form, true, submitter);
  try {
    await saveAction();
  } finally {
    const remainingDelay = Math.max(0, 180 - (performance.now() - startedAt));
    if (remainingDelay) {
      await new Promise((resolve) => window.setTimeout(resolve, remainingDelay));
    }
    if (document.contains(form)) {
      setSettingsFormBusy(form, false, submitter);
    }
  }
}

export function scrollToSettingsSection(sectionId, root = document) {
  const normalizedId = String(sectionId || "").trim();
  const section = root.getElementById(`settings-${normalizedId}`);
  if (!section) {
    return;
  }
  root.querySelectorAll("[data-action='settings-scroll']").forEach((button) => {
    const isCurrent = String(button.dataset.id || "") === normalizedId;
    button.classList.toggle("is-current", isCurrent);
    if (isCurrent) {
      button.setAttribute("aria-current", "location");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  const heading = section.querySelector("h2[tabindex='-1']");
  window.requestAnimationFrame(() => heading?.focus({ preventScroll: true }));
}

export function syncSettingsThemeChoice(themeValue, root = document) {
  const selectedTheme = String(themeValue || "light").trim().toLowerCase();
  root.querySelectorAll(".settings-choice[data-action='ui-theme']").forEach((button) => {
    const isSelected = String(button.dataset.id || "") === selectedTheme;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
}
