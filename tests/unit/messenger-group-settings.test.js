import assert from "node:assert/strict";
import test from "node:test";

import {
  getMessengerGroupRemovedMembers,
  hasMessengerGroupChanges,
  isMessengerGroupMemberProtected,
  resolveMessengerGroupInitialMemberIds
} from "../../public/src/modules/messenger-group-settings.js";
import {
  renderMessengerGroupEditor,
  renderMessengerGroupReview
} from "../../public/src/modules/messenger-group-settings-view.js";

const teamMembers = [
  { id: "owner", name: "Joy N.", role: "Owner", status: "Active" },
  { id: "member", name: "Ken Li", role: "Member", status: "Active" },
  { id: "inactive", name: "Former User", role: "Member", status: "Inactive" }
];

test("group settings use saved members when available", () => {
  assert.deepEqual(
    resolveMessengerGroupInitialMemberIds({ memberIds: ["member"] }, teamMembers, "owner"),
    ["member", "owner"]
  );
});

test("demo groups fall back to active workspace members", () => {
  assert.deepEqual(
    resolveMessengerGroupInitialMemberIds({}, teamMembers, "owner"),
    ["owner", "member"]
  );
});

test("unmatched session ids do not create invisible member changes", () => {
  assert.deepEqual(
    resolveMessengerGroupInitialMemberIds({}, teamMembers, "session-user"),
    ["owner", "member"]
  );
});

test("current users and existing workspace owners are protected", () => {
  assert.equal(isMessengerGroupMemberProtected(teamMembers[0], ["owner"], "member"), true);
  assert.equal(isMessengerGroupMemberProtected(teamMembers[1], ["owner", "member"], "member"), true);
  assert.equal(isMessengerGroupMemberProtected(teamMembers[1], ["member"], "owner"), false);
});

test("group changes compare names and member sets without relying on order", () => {
  assert.equal(hasMessengerGroupChanges("Sales", "Sales", ["owner", "member"], ["member", "owner"]), false);
  assert.equal(hasMessengerGroupChanges("Sales", "Sales Team", ["owner", "member"], ["owner", "member"]), true);
});

test("removed members are returned for confirmation copy", () => {
  assert.deepEqual(
    getMessengerGroupRemovedMembers(["owner", "member"], ["owner"], teamMembers).map((member) => member.name),
    ["Ken Li"]
  );
});

test("group settings render a focused editor and removal confirmation", () => {
  const editor = renderMessengerGroupEditor({
    conversationName: "Sales <Core>",
    conversationKey: "channel:one",
    memberRows: ""
  });
  const review = renderMessengerGroupReview({
    removedMembers: [{ name: "Ken <Li>" }],
    conversationKey: "channel:one"
  });

  assert.match(editor, /Search active members/);
  assert.match(editor, /Sales &lt;Core&gt;/);
  assert.match(editor, /Save changes/);
  assert.match(review, /Remove 1 member/);
  assert.match(review, /Ken &lt;Li&gt;/);
  assert.match(review, /messenger-group-review-confirm/);
});
