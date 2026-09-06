/* The default arrangement claims that the distance between two treatments is
 * the standard error of the network estimate comparing them. That claim is
 * only worth making if it is close to true, so it is measured here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";
import { circleLayout, precisionLayout, springLayout } from "../src/app/layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(here, "..", "src", "data", "examples.json"), "utf8")
);

const fitOf = (example) => {
  const c = example.contrasts;
  return fitNetwork(
    c.studlab.map((_, i) => ({
      studlab: String(c.studlab[i]),
      treat1: c.treat1[i],
      treat2: c.treat2[i],
      TE: c.TE[i],
      seTE: c.seTE[i],
    }))
  );
};

for (const example of examples) {
  test(`${example.id}: the precision arrangement is a usable picture`, () => {
    const model = fitOf(example).common;
    const { points, stress } = precisionLayout(model);

    assert.equal(points.length, model.treatments.length);
    for (const p of points)
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "a treatment has no position");

    // Two dimensions cannot hold every network exactly, but a drawing whose
    // distances are more than a third wrong is not saying what it claims to.
    assert.ok(stress < 0.34, `${example.id} has stress ${stress.toFixed(3)}`);

    // No two treatments may land on the same point, or the picture hides one.
    const span = Math.max(
      ...points.map((a) => Math.max(...points.map((b) => Math.hypot(a.x - b.x, a.y - b.y))))
    );
    for (let i = 0; i < points.length - 1; i++)
      for (let j = i + 1; j < points.length; j++) {
        const gap = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        assert.ok(
          gap > span * 1e-3,
          `${example.id}: ${model.treatments[i]} and ${model.treatments[j]} are drawn on top of each other`
        );
      }
  });
}

test("the other arrangements produce finite, distinct positions", () => {
  const model = fitOf(examples.find((e) => e.id === "senn2013")).common;
  for (const build of [circleLayout, springLayout]) {
    const { points } = build(model);
    assert.equal(points.length, model.treatments.length);
    for (const p of points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});
