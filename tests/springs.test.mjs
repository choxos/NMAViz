/* The coil.
 *
 * A spring is drawn rather than suggested, so what the drawing says about a
 * study has to be what a spring would say. The stiffness of a real helical
 * spring is
 *
 *     k = G d^4 / (8 D^3 n)
 *
 * for wire gauge d, coil diameter D and turns n, so a stiff spring is thick
 * wire wound tight with few turns. The drawing used to give the stiffest
 * springs the most turns, which is the wrong way round in the one place a
 * reader who knows what a spring is would look first.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { coil } from "../src/app/lenses/springs.js";

const numbersIn = (d) =>
  d
    .slice(1)
    .split(/[ML]/)
    .filter(Boolean)
    .map((pair) => pair.trim().split(" ").map(Number));

test("a stiffer spring is wound from thicker wire", () => {
  const floppy = coil(0, 200, 50, 0);
  const stiff = coil(0, 200, 50, 1);
  assert.ok(stiff.gauge > floppy.gauge, `${stiff.gauge} is not thicker than ${floppy.gauge}`);
});

test("a stiffer spring has fewer turns and a tighter coil", () => {
  // Turns are counted from the drawing: one turn is one full swing across the
  // axis and back, so the wire crosses the center line twice per turn.
  const crossings = (d, y) => {
    const points = numbersIn(d);
    let count = 0;
    for (let i = 1; i < points.length; i++) {
      const before = points[i - 1][1] - y;
      const after = points[i][1] - y;
      if (before < 0 !== after < 0) count += 1;
    }
    return count;
  };
  const spread = (d, y) => Math.max(...numbersIn(d).map(([, py]) => Math.abs(py - y)));

  const floppy = coil(0, 200, 50, 0);
  const stiff = coil(0, 200, 50, 1);
  assert.ok(crossings(floppy.d, 50) > crossings(stiff.d, 50), "the floppy one has more turns");
  assert.ok(spread(stiff.d, 50) < spread(floppy.d, 50), "and the stiff one is wound tighter");
});

test("pulling a spring changes its pitch and not its turns", () => {
  const crossings = (d) => {
    const points = numbersIn(d);
    let count = 0;
    for (let i = 1; i < points.length; i++)
      if (points[i - 1][1] - 50 < 0 !== points[i][1] - 50 < 0) count += 1;
    return count;
  };
  const relaxed = coil(0, 90, 50, 0.5);
  const stretched = coil(0, 320, 50, 0.5);
  assert.equal(crossings(relaxed.d), crossings(stretched.d));
});

test("no part of the wire reaches past what the spring is anchored to", () => {
  for (const stiffness of [0, 0.25, 0.5, 0.75, 1]) {
    for (const [x1, x2] of [
      [0, 200],
      [200, 0],
      [40, 62],
      [-100, 260],
    ]) {
      const points = numbersIn(coil(x1, x2, 50, stiffness).d);
      const low = Math.min(x1, x2);
      const high = Math.max(x1, x2);
      for (const [px] of points)
        assert.ok(
          px >= low - 0.6 && px <= high + 0.6,
          `${px} is outside ${low} to ${high} at stiffness ${stiffness}`
        );
    }
  }
});

test("a spring drawn backwards is the same spring", () => {
  const forward = coil(0, 180, 50, 0.6);
  const backward = coil(180, 0, 50, 0.6);
  assert.equal(forward.gauge, backward.gauge);
  assert.equal(numbersIn(forward.d).length, numbersIn(backward.d).length);
});
