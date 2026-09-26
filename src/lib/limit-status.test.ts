import assert from "node:assert/strict";
import { test } from "node:test";
import { displayLimitStatus } from "./limit-status";

test("displayLimitStatus: wallet short stays watching in storage", () => {
  assert.equal(displayLimitStatus({ status: "watching", last_result: "" }), "watching");
  assert.equal(
    displayLimitStatus({ status: "watching", last_result: "Wallet is short by £8.00" }),
    "wallet short",
  );
  assert.equal(displayLimitStatus({ status: "filled", last_result: "bought JD at £36.00" }), "filled");
  assert.equal(displayLimitStatus({ status: "paused", last_result: "" }), "paused");
});
