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

/* Under random effects each study spring gains the heterogeneity spring in
 * series, which is what makes the assembly rest where the random-effects model
 * pools to rather than where the common-effect one does. */
const rigForEdge = (edge, tau = 0) =>
  makeRig(edge.rows.map((row) => ({ k: 1 / (row.seTE ** 2 + tau ** 2), y: row.TE })));

test("the assembly rests exactly at the pooled estimate, under both models", () => {
  let checked = 0;
  for (const example of examples) {
    const fit = fitNetwork(rowsOf(example));
    for (const [which, model] of [
      ["common", fit.common],
      ["random", fit.random],
    ]) {
      for (const edge of model.direct) {
        if (edge.rows.length < 2) continue;
        const rig = rigForEdge(edge, model.tau ?? 0);
        // Not a tolerance chosen to pass: the equilibrium of springs whose
        // stiffnesses are 1/(se² + tau²) IS the weighted mean the engine pools
        // to, so the toy cannot settle anywhere the panel does not report.
        assert.ok(
          Math.abs(rig.equilibrium - edge.TE) < 1e-12,
          `${example.id} ${which} ${edge.treat1} vs ${edge.treat2}: rests at ${rig.equilibrium}, pools to ${edge.TE}`
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked > 80, `only ${checked} bundles were available to check`);
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
    // Stated for the common-effect assembly, which is the one Cochran's Q is
    // computed on: under random effects the springs are softer and hold less.
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

/* The same identity under random effects, which is a different number.
 *
 * The springs are softened by tau, so the assembly holds less than half the
 * common-effect Q. The lens prints the energy beside the Q it is half of, so
 * that Q has to be formed at the weights the springs actually have; printing
 * the common-effect Q there would put two numbers side by side that are equal
 * only when tau is zero.
 */
test("under random effects the assembly holds half the Q at its own weights", () => {
  let softer = 0;
  for (const example of examples) {
    const fit = fitNetwork(rowsOf(example));
    const tau = fit.random.tau ?? 0;
    if (!(tau > 0)) continue;
    for (const edge of fit.common.direct) {
      if (edge.rows.length < 2) continue;
      const rig = rigForEdge(edge, tau);
      const Q = rig.springs.reduce(
        (sum, spring) => sum + spring.k * (spring.y - rig.equilibrium) ** 2,
        0
      );
      assert.ok(
        Math.abs(rigEnergy(rig) - Q / 2) < 1e-9,
        `${example.id} ${edge.treat1} vs ${edge.treat2}: holds ${rigEnergy(rig)}, not ${Q / 2}`
      );
      // And it is not the common-effect Q, which is what the deck used to show.
      if (Math.abs(rigEnergy(rig) - edge.Q / 2) > 1e-6) softer += 1;
    }
  }
  assert.ok(softer > 10, `only ${softer} bundles differed between the two models`);
});

test("an assembly cannot be built from a single study", () => {
  assert.equal(makeRig([]), null);
});
