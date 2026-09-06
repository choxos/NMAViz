/* The springs rig.
 *
 * The claim the lens makes is that the pooled estimate is not a formula to be
 * taken on trust but the place a mechanism comes to rest. That is only worth
 * saying if it is exactly true, so it is checked against the engine's own
 * pooled estimate on every bundled network rather than against a tolerance
 * chosen to make it pass.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";
import { makeRig, releaseFrom, rigEnergy, stepRig } from "../src/app/play.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(here, "..", "src", "data", "examples.json"), "utf8")
);

const rowsOf = (example) => {
  const c = example.contrasts;
  return c.studlab.map((_, i) => ({
    studlab: String(c.studlab[i]),
    treat1: c.treat1[i],
    treat2: c.treat2[i],
    TE: c.TE[i],
    seTE: c.seTE[i],
  }));
};

const rigForEdge = (edge) =>
  makeRig(edge.rows.map((row) => ({ k: 1 / row.seTE ** 2, y: row.TE })));

test("the assembly rests exactly at the pooled estimate, on every network", () => {
  let checked = 0;
  for (const example of examples) {
    const fit = fitNetwork(rowsOf(example));
    for (const edge of fit.common.direct) {
      if (edge.rows.length < 2) continue;
      const rig = rigForEdge(edge);
      // Not a tolerance chosen to pass: the equilibrium of springs whose
      // stiffnesses are 1/se² IS the inverse-variance weighted mean, which is
      // what the engine pools to.
      assert.ok(
        Math.abs(rig.equilibrium - edge.TE) < 1e-12,
        `${example.id} ${edge.treat1} vs ${edge.treat2}: rests at ${rig.equilibrium}, pools to ${edge.TE}`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 40, `only ${checked} bundles were available to check`);
});

test("a pulled assembly gives back what was put into it and comes to rest", () => {
  const fit = fitNetwork(rowsOf(examples.find((e) => e.id === "senn2013")));
  const edge = fit.common.direct.find((e) => e.rows.length >= 3);
  const rig = rigForEdge(edge);

  const atRest = rigEnergy(rig);
  releaseFrom(rig, rig.equilibrium + rig.span);
  const started = rigEnergy(rig);
  assert.ok(started > atRest, "pulling it should store energy");

  let overshot = false;
  const side = Math.sign(rig.x - rig.equilibrium);
  for (let i = 0; i < 4000 && rig.running; i++) {
    stepRig(rig, 1 / 120);
    if (Math.sign(rig.x - rig.equilibrium) === -side) overshot = true;
  }

  assert.equal(rig.running, false, "it should stop rather than swing for ever");
  assert.ok(overshot, "an underdamped assembly should cross the resting point");
  assert.ok(Math.abs(rig.x - rig.equilibrium) < 1e-12, "and stop exactly on it");
  // Everything the reader put in comes back out through the damping. What is
  // left is what the assembly was holding before they touched it.
  assert.ok(Math.abs(rigEnergy(rig) - atRest) < 1e-12, "leaving only what it started with");
});

/* Papakonstantinou et al's headline: the energy an assembly holds at rest is
 * half Cochran's Q. It is not an analogy, it is the same sum: both are
 * Σ w_i (y_i − ȳ_w)², one of them halved. */
test("the energy the assembly holds at rest is half Cochran's Q", () => {
  let checked = 0;
  for (const example of examples) {
    const fit = fitNetwork(rowsOf(example));
    for (const edge of fit.common.direct) {
      if (edge.rows.length < 2) continue;
      const rig = rigForEdge(edge);
      assert.ok(
        Math.abs(rigEnergy(rig) - edge.Q / 2) < 1e-9,
        `${example.id} ${edge.treat1} vs ${edge.treat2}: holds ${rigEnergy(rig)}, Q/2 is ${
          edge.Q / 2
        }`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 40, `only ${checked} bundles were available to check`);
});

test("an assembly cannot be built from a single study", () => {
  assert.equal(makeRig([]), null);
});
