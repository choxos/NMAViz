/* Contribution matrices, against netmeta's netcontrib.
 *
 * netcontrib is expensive on large networks, so the fixtures carry it only for
 * the small ones; those are also the networks where a wrong answer is easiest
 * to see, and the textbook example's contributions are printed in the paper.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";
import { evidenceFlow } from "../src/nma/flow.js";
import {
  randomWalkContributions,
  shortestPathContributions,
} from "../src/nma/contributions.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures");
const load = (name) => JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8"));
const names = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const rowsOf = (columns) =>
  columns.treat1.map((_, i) => ({
    treat1: columns.treat1[i],
    treat2: columns.treat2[i],
    studlab: String(columns.studlab[i]),
    TE: columns.TE[i],
    seTE: columns.seTE[i],
  }));

for (const name of names) {
  const fixture = load(name);
  if (!fixture.contrib?.target) continue;
  const model = fitNetwork(rowsOf(fixture.comparisons)).common;

  // The random walk has a closed form, so it must agree with netmeta exactly.
  // The shortest path method does not: when several routes of equal length are
  // available it drains whichever the implementation happens to find first, and
  // that choice moves a little weight between comparisons. This is the
  // ambiguity Davies et al set out to remove, so the looser tolerance here is
  // the property under test, not a concession.
  for (const [method, compute, tolerance] of [
    ["shortest path", (flow) => shortestPathContributions(flow), 1e-3],
    ["random walk", (flow) => randomWalkContributions(flow, model.treatments.length), 1e-8],
  ]) {
    const column = method === "shortest path" ? "shortestpath" : "randomwalk";

    test(`${name}: ${method} contributions match netmeta`, () => {
      fixture.contrib.target.forEach((target, row) => {
        const [a, b] = target.split(":");
        const contributions = compute(evidenceFlow(model, a, b));

        fixture.contrib.comparison.forEach((comparison, column_index) => {
          const [t1, t2] = comparison.split(":");
          const mine = contributions.get(`${t1} ${t2}`) ?? contributions.get(`${t2} ${t1}`) ?? 0;
          const expected = fixture.contrib[column][row][column_index];
          assert.ok(
            Math.abs(mine - expected) < tolerance,
            `${name} ${target}, ${comparison}: ${method} gives ${mine}, netmeta gives ${expected}`
          );
        });
      });
    });
  }

  test(`${name}: contributions add to the whole estimate`, () => {
    for (const target of fixture.contrib.target) {
      const [a, b] = target.split(":");
      const flow = evidenceFlow(model, a, b);
      for (const contributions of [
        shortestPathContributions(flow),
        randomWalkContributions(flow, model.treatments.length),
      ]) {
        const total = [...contributions.values()].reduce((s, v) => s + v, 0);
        assert.ok(
          Math.abs(total - 1) < 1e-8,
          `${name} ${target}: contributions add to ${total}, not to one`
        );
        for (const [comparison, value] of contributions)
          assert.ok(value >= -1e-12, `${name} ${target}: ${comparison} has a negative contribution`);
      }
    }
  });
}
