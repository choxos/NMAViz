import { test } from "node:test";
import assert from "node:assert/strict";
import { practice, assessPractice } from "../src/app/learning.js";

test("practice evaluates numerical predictions without accepting blanks or nonfinite values", () => {
  const c = practice("springs");
  assert.equal(c.answer, 0.8);
  for (const wrong of ["", " ", "Infinity", "NaN", "4"])
    assert.equal(assessPractice(c, wrong).correct, false);
  assert.equal(assessPractice(c, "0.8").correct, true);
});

test("practice preserves covariance, nonlinear averaging, and signed-weight identities", () => {
  assert.equal(practice("reconstruction", 1).answer, 3);
  assert.equal(practice("hodge", 0).answer, 1);
  assert.equal(practice("hodge", 1).answer, 0);
  assert.equal(practice("contributions", 1).answer, 1);
  assert.ok(Math.abs(practice("population", 1).answer - 0.30960146101105877) < 1e-12);
  assert.equal(practice("population", 0).answer, 8 / 3);
});
