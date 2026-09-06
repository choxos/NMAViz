/* Evidence flow, against netmeta's netmeasures.
 *
 * The direct evidence proportion is checked on every fixture. The mean path
 * length and the minimal parallelism are computed here over the comparisons,
 * while netmeta groups a multi-arm study's comparisons into one design first,
 * so those two are checked only on the networks whose studies are all two-arm,
 * where the two definitions coincide.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";
import { evidenceFlow, flowPaths } from "../src/nma/flow.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures");
const names = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const load = (name) => JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8"));

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
  const rows = rowsOf(fixture.comparisons);
  const twoArmOnly = fixture.prepared.narms.every((p) => p === 2);

  const pairs = [];
  for (let i = 0; i < fixture.n - 1; i++)
    for (let j = i + 1; j < fixture.n; j++)
      pairs.push([fixture.treatments[i], fixture.treatments[j]]);

  test(`${name}: the current obeys Kirchhoff's law and sums to one`, () => {
    const model = fitNetwork(rows).common;
    for (const [a, b] of pairs.slice(0, 12)) {
      const flow = evidenceFlow(model, a, b);

      // One unit of current enters at the first treatment and leaves at the
      // second; nothing accumulates anywhere else.
      const balance = new Map(model.treatments.map((t) => [t, 0]));
      for (const edge of flow.edges) {
        balance.set(edge.from, balance.get(edge.from) + edge.flow);
        balance.set(edge.to, balance.get(edge.to) - edge.flow);
      }
      for (const [treatment, net] of balance) {
        const expected = treatment === a ? 1 : treatment === b ? -1 : 0;
        assert.ok(
          Math.abs(net - expected) < 1e-8,
          `${name} ${a} vs ${b}: ${treatment} has a net current of ${net}, expected ${expected}`
        );
      }
    }
  });

  test(`${name}: the direct evidence proportion matches netmeta`, () => {
    const model = fitNetwork(rows).common;
    pairs.forEach(([a, b], index) => {
      const flow = evidenceFlow(model, a, b);
      const expected = fixture.measures["proportion.direct"][index];
      assert.ok(
        Math.abs(flow.directProportion - expected) < 1e-8,
        `${name} ${a} vs ${b}: direct proportion ${flow.directProportion} differs from netmeta's ${expected}`
      );
      // The hat matrix entry is the same number when no multi-arm study sits on
      // the comparison, and a different one when one does.
      if (twoArmOnly)
        assert.ok(
          Math.abs(flow.directFlow - expected) < 1e-8,
          `${name} ${a} vs ${b}: the current along the direct comparison is ${flow.directFlow}, but netmeta reports a proportion of ${expected}`
        );
    });
  });

  if (twoArmOnly) {
    test(`${name}: mean path length and minimal parallelism match netmeta`, () => {
      const model = fitNetwork(rows).common;
      pairs.forEach(([a, b], index) => {
        const flow = evidenceFlow(model, a, b);
        assert.ok(
          Math.abs(flow.meanPathLength - fixture.measures.meanpath[index]) < 1e-8,
          `${name} ${a} vs ${b}: mean path length ${flow.meanPathLength} differs from netmeta's ${fixture.measures.meanpath[index]}`
        );
        assert.ok(
          Math.abs(flow.minimalParallelism - fixture.measures.minpar[index]) < 1e-8,
          `${name} ${a} vs ${b}: minimal parallelism ${flow.minimalParallelism} differs from netmeta's ${fixture.measures.minpar[index]}`
        );
      });
    });
  }

  test(`${name}: the path decomposition accounts for the whole estimate`, () => {
    const model = fitNetwork(rows).common;
    for (const [a, b] of pairs.slice(0, 8)) {
      const flow = evidenceFlow(model, a, b);
      const paths = flowPaths(flow);
      const carried = paths.reduce((s, p) => s + p.share, 0);
      assert.ok(
        Math.abs(carried - 1) < 1e-6,
        `${name} ${a} vs ${b}: the paths carry ${carried} of the estimate, not all of it`
      );
      // Every path must actually run from one endpoint to the other.
      for (const path of paths) {
        assert.equal(path.treatments[0], a);
        assert.equal(path.treatments.at(-1), b);
      }
    }
  });
}
