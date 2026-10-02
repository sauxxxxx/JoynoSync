export function resolveMessengerAccess({ messenger = false, managedComms = false } = {}) {
  return {
    messenger: Boolean(messenger),
    managedComms: Boolean(managedComms)
  };
}

export function setMessengerBootstrapError(state, message) {
  state.messengerLoading = false;
  state.messengerSnapshotReady = false;
  state.messengerSnapshotError = String(message || "Messenger could not load.").trim();
  return state;
}
