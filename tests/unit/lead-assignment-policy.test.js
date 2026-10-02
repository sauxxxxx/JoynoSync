import assert from "node:assert/strict";
import test from "node:test";

import {
  isActiveSalesMember,
  isInformationTechnologyMember,
  isLeadAssignableMember
} from "../../public/src/modules/lead-assignment-policy.js";

test("IT teammates are excluded from lead assignment", () => {
  assert.equal(isInformationTechnologyMember({ team: "IT" }), true);
  assert.equal(isInformationTechnologyMember({ department: "Information Technology" }), true);
  assert.equal(isLeadAssignableMember({ status: "Active", role: "Member", team: "IT" }), false);
  assert.equal(isLeadAssignableMember({ status: "Active", role: "Admin", department: "IT Support" }), false);
});

test("active non-IT teammates remain assignable", () => {
  assert.equal(isLeadAssignableMember({ status: "Active", role: "Member", team: "Sales" }), true);
  assert.equal(isLeadAssignableMember({ status: "Active", role: "Manager", department: "Operations" }), true);
  assert.equal(isLeadAssignableMember({ status: "Inactive", role: "Member", team: "Sales" }), false);
  assert.equal(isLeadAssignableMember({ status: "Active", role: "Guest", team: "Sales" }), false);
});

test("lead owner filters include active Sales members only", () => {
  assert.equal(isActiveSalesMember({ status: "Active", role: "Member", team: "Sales" }), true);
  assert.equal(isActiveSalesMember({ status: "Active", role: "Manager", department: "Sales" }), true);
  assert.equal(isActiveSalesMember({ status: "Inactive", role: "Member", team: "Sales" }), false);
  assert.equal(isActiveSalesMember({ status: "Active", role: "Guest", team: "Sales" }), false);
  assert.equal(isActiveSalesMember({ status: "Active", role: "Member", team: "Operations" }), false);
  assert.equal(isActiveSalesMember({ status: "Active", role: "Admin", department: "IT" }), false);
});
