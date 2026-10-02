import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveMessengerAccess,
  setMessengerBootstrapError
} from "../../public/src/modules/messenger-bootstrap-state.js";
import { renderMessengerLoadError } from "../../public/src/modules/messenger-load-state-view.js";
import { runMessengerRequest } from "../../public/src/modules/messenger-request.js";

test("member Messenger access is independent from managed communications", () => {
  assert.deepEqual(resolveMessengerAccess({ messenger: true, managedComms: false }), {
    messenger: true,
    managedComms: false
  });
});

test("terminal bootstrap failures resolve to an error instead of a skeleton", () => {
  const state = { messengerLoading: true, messengerSnapshotReady: false, messengerSnapshotError: "" };
  setMessengerBootstrapError(state, "Workspace information is unavailable.");
  assert.equal(state.messengerLoading, false);
  assert.equal(state.messengerSnapshotReady, false);
  assert.match(state.messengerSnapshotError, /Workspace information is unavailable/);
});

test("Messenger load errors provide a retry action and escape details", () => {
  const markup = renderMessengerLoadError("Failed <again>");
  assert.match(markup, /messenger-retry-load/);
  assert.match(markup, /Failed &lt;again&gt;/);
});

test("hanging Messenger requests settle as timeout errors", async () => {
  let requestSignal = null;
  const hangingRequest = new Promise(() => {});
  hangingRequest.abortSignal = (signal) => {
    requestSignal = signal;
    return hangingRequest;
  };

  await assert.rejects(
    runMessengerRequest(() => hangingRequest, { timeoutMs: 5 }),
    /Messenger request timed out/
  );
  assert.equal(requestSignal?.aborted, true);
});
