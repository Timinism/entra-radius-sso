import assert from "node:assert/strict";
import test from "node:test";

import { usernamesMatch } from "./username";

test("device usernames match an Entra UPN", () => {
  assert.equal(usernamesMatch("maya.chen", "maya.chen@northline.example"), true);
  assert.equal(usernamesMatch("NORTHLINE\\maya.chen", "Maya.Chen@northline.example"), true);
  assert.equal(usernamesMatch("maya.chen@northline.example", "maya.chen@northline.example"), true);
  assert.equal(usernamesMatch("jordan.hale", "maya.chen@northline.example"), false);
});
