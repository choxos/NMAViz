/* Taking a comparison apart into the studies behind it.
 *
 * The claim every lens makes when the separation control opens is that the
 * studies on a comparison are conductances in parallel, so whatever the
 * comparison carries divides between them in proportion to their weights.
 * That is one arithmetic fact, checked here once, rather than four drawings
 * that happen to look similar.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fitNetwork } from "../src/nma/model.js";
import { separable, strandsOf } from "../src/app/lenses/draw.js";

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

const a = { x: 100, y: 100 };
const b = { x: 300, y: 220 };

test("the shares are the studies' weights, and they add to one", () => {
  let checked = 0;
  for (const example of examples) {
    const fit = fitNetwork(rowsOf(example));
    for (const edge of fit.common.direct) {
      const strands = strandsOf(edge, a, b, 0.5);
      assert.equal(strands.length, edge.rows.length);
      const total = strands.reduce((sum, strand) => sum + strand.share, 0);
      assert.ok(Math.abs(total - 1) < 1e-12, `${example.id}: shares add to ${total}`);
      // Each share is that study's weight over the comparison's, which is what
      // makes the strands of a fanned comparison add up to the line.
      const weights = edge.rows.map((row) => 1 / row.seTE ** 2);
      const sum = weights.reduce((s, w) => s + w, 0);
      strands.forEach((strand, k) => {
        assert.ok(Math.abs(strand.share - weights[k] / sum) < 1e-12);
      });
      checked += 1;
    }
  }
  assert.ok(checked > 100, `only ${checked} comparisons were checked`);
});

test("a comparison's precision is the sum of its studies', so the shares are it", () => {
  const fit = fitNetwork(rowsOf(examples[0]));
  for (const edge of fit.common.direct) {
    const precision = 1 / edge.seTE ** 2;
    const carried = strandsOf(edge, a, b, 1).reduce(
      (sum, strand) => sum + strand.share * precision,
      0
    );
    assert.ok(Math.abs(carried - precision) < 1e-9);
  }
});

test("at no separation every strand lies on the comparison itself", () => {
  const fit = fitNetwork(rowsOf(examples[0]));
  for (const edge of fit.common.direct) {
    const strands = strandsOf(edge, a, b, 0);
    for (const strand of strands) {
      // Object.is separates -0 from 0; the drawing does not.
      assert.ok(strand.bend === 0);
      assert.equal(strand.path, strands[0].path);
    }
  }
});

test("the fan is symmetric about the comparison, so it opens rather than drifts", () => {
  const fit = fitNetwork(rowsOf(examples[0]));
  for (const edge of fit.common.direct) {
    if (edge.rows.length < 2) continue;
    const bends = strandsOf(edge, a, b, 0.7).map((strand) => strand.bend);
    const total = bends.reduce((sum, bend) => sum + bend, 0);
    assert.ok(Math.abs(total) < 1e-12, `bends sum to ${total}`);
    assert.ok(bends[bends.length - 1] > bends[0], "and they are spread in order");
  }
});

test("a crowded network is not offered the fan", () => {
  const big = { direct: new Array(27) };
  const small = { direct: new Array(26) };
  assert.equal(separable(big), false);
  assert.equal(separable(small), true);
});
