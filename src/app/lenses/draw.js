/* Drawing pieces shared by every lens.
 *
 * All lenses put the treatments in the same places and draw the same nodes, so
 * that switching lens changes what is being said about the network rather than
 * where the network is. Only the edges change.
 */

import { escape, shortLabel } from "../ui.js";

export const scaleBetween = (value, min, max, lowest, highest) => {
  if (!(max > min)) return (lowest + highest) / 2;
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return lowest + t * (highest - lowest);
};

/* How many studies touch each treatment, which is what the node size shows. */
export function nodeWeights(model) {
  const counts = model.treatments.map(() => 0);
  for (const edge of model.direct) {
    counts[model.index.get(edge.treat1)] += edge.studies;
    counts[model.index.get(edge.treat2)] += edge.studies;
  }
  return counts;
}

export function nodeRadii(model) {
  const counts = nodeWeights(model);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return counts.map((c) => scaleBetween(Math.sqrt(c), Math.sqrt(min), Math.sqrt(max), 9, 24));
}

/* A label placed outside its node, pushed away from the middle of the canvas so
 * that it does not land on top of the network, with the box it will occupy.
 *
 * Outward is right for a node in the middle of the drawing and wrong for one at
 * its edge, where outward means under a floating panel. A label that would
 * leave the clear rectangle is turned back toward the middle instead, which is
 * always empty on that side because the node is at the edge.
 */
function labelBox(label, point, radius, width, height, box) {
  const dx = point.x - width / 2;
  const dy = point.y - height / 2;
  const length = Math.hypot(dx, dy) || 1;
  const offset = radius + 13;
  let x = point.x + (dx / length) * offset;
  const y = point.y + (dy / length) * offset;
  let anchor = dx > 12 ? "start" : dx < -12 ? "end" : "middle";

  const room = label.length * 6.1 + 6;
  const limits = box ?? { left: 4, right: width - 4 };
  if (anchor === "start" && x + room > limits.right) {
    anchor = "end";
    x = point.x - offset;
  } else if (anchor === "end" && x - room < limits.left) {
    anchor = "start";
    x = point.x + offset;
  }
  const baseline = dy > 12 ? "hanging" : dy < -12 ? "auto" : "middle";
  // Inter at 11px runs to about 6.1 pixels a character, which is close enough
  // to reserve space with.
  const w = label.length * 6.1 + 6;
  const h = 15;
  const cx = anchor === "start" ? x + w / 2 : anchor === "end" ? x - w / 2 : x;
  const cy = baseline === "hanging" ? y + h / 2 : baseline === "auto" ? y - h / 2 : y;
  return {
    cx,
    cy,
    w,
    h,
    markup: `<text class="node-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
      text-anchor="${anchor}" dominant-baseline="${baseline}">${escape(label)}</text>`,
  };
}

/* Labels, placed where they fit.
 *
 * On a network of twenty treatments there is not room for twenty labels, and
 * printing them all produces a pile of overlapping words that names nothing.
 * Labels are placed in order of importance, the comparison being studied first
 * and then the treatments carrying the most evidence, and one that would land
 * on a label already placed is left out. Every treatment keeps its tooltip, so
 * nothing becomes unreachable, only unprinted.
 */
function placeLabels(context, sizes, emphasis) {
  const { model, points, width, height, state } = context;
  const counts = nodeWeights(model);
  const order = model.treatments
    .map((name, i) => ({ name, i }))
    .sort((a, b) => {
      const rank = (x) =>
        (emphasis.get(x.name) ? 2 : 0) +
        (state.selection?.id === x.name ? 1 : 0);
      return rank(b) - rank(a) || counts[b.i] - counts[a.i];
    });

  const boxes = [];
  const placed = new Map();
  for (const { name, i } of order) {
    const label = shortLabel(name);
    const geometry = labelBox(label, points[i], sizes[i], width, height, context.box);
    const clashes = boxes.some(
      (b) =>
        Math.abs(b.cx - geometry.cx) * 2 < b.w + geometry.w &&
        Math.abs(b.cy - geometry.cy) * 2 < b.h + geometry.h
    );
    // A treatment in the comparison being studied is always named, even if it
    // has to sit close to another label.
    if (clashes && !emphasis.get(name) && state.selection?.id !== name) continue;
    boxes.push(geometry);
    placed.set(i, geometry.markup);
  }
  return placed;
}

export function drawNodes(context, { emphasis = new Map(), radii } = {}) {
  const { model, points, state } = context;
  const sizes = radii ?? nodeRadii(model);
  const labels = placeLabels(context, sizes, emphasis);
  return model.treatments
    .map((name, i) => {
      const point = points[i];
      const role = emphasis.get(name) ?? "";
      const selected = state.selection?.kind === "treatment" && state.selection.id === name;
      const pinned = context.pinned?.has(i) ? " pinned" : "";
      return `
        <g class="node ${role}${selected ? " selected" : ""}${pinned}" data-treatment="${escape(
          name
        )}">
          <circle class="hit-node" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(
            1
          )}" r="${(sizes[i] + 9).toFixed(1)}"/>
          <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${sizes[i].toFixed(1)}"/>
          ${labels.get(i) ?? ""}
        </g>`;
    })
    .join("");
}

/* The two endpoints of the comparison of interest, marked so that they can be
 * found at a glance in every lens. */
export function contrastEmphasis(state) {
  const emphasis = new Map();
  if (state.contrast) {
    emphasis.set(state.contrast.treat1, "from");
    emphasis.set(state.contrast.treat2, "to");
  }
  return emphasis;
}

/* An invisible band along an edge, wide enough to be aimed at.
 *
 * A comparison carrying little evidence is drawn as a hairline, and a hairline
 * is not a target: the reader would have to place the pointer within a pixel of
 * it to read what it says. Every edge therefore carries a transparent stroke of
 * a usable width underneath, which is what the pointer actually hits.
 */
export const hit = (d) => `<path class="hit" d="${d}"/>`;

/* A gentle arc between two points. Straight lines through a dense middle are
 * hard to follow; a shallow curve separates the two directions of a pair and
 * keeps parallel evidence visible. */
export function arc(a, b, bend = 0) {
  if (!bend) return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const cx = mx - (dy / length) * bend;
  const cy = my + (dx / length) * bend;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(
    1
  )} ${b.y.toFixed(1)}`;
}

/* A comparison taken apart into the studies behind it.
 *
 * Every comparison on this canvas is a bundle of conductances in parallel: the
 * studies on it, each of weight 1/se². Whatever the comparison carries, those
 * studies carry in proportion to their weights, and that is one fact rather
 * than several: it is why a comparison's precision is the sum of its studies',
 * why the current through it splits the way it does, and why a walker crossing
 * it picks a study with that probability. So every lens that fans a comparison
 * open fans it the same way, from here.
 *
 * The spread is perpendicular to the comparison and symmetric about it, so the
 * bundle opens around the line it replaces instead of drifting off it. At a
 * separation of zero every strand lies exactly on that line, which is what
 * makes the control continuous rather than a switch between two pictures.
 */
export function strandsOf(edge, a, b, separation, { spread = 26 } = {}) {
  const weights = edge.rows.map((row) => 1 / row.seTE ** 2);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const middle = (edge.rows.length - 1) / 2;
  return edge.rows.map((row, k) => {
    const bend = (k - middle) * spread * separation;
    return {
      row,
      bend,
      // A comparison with no usable weight anywhere splits evenly rather than
      // dividing by zero; it has nothing to say about which study matters.
      share: total > 0 ? weights[k] / total : 1 / edge.rows.length,
      path: arc(a, b, bend),
    };
  });
}

/* Whether the strands would be legible at all.
 *
 * Past this many comparisons the fans of neighboring comparisons overlap and
 * the picture says less than the single lines it replaced, so the lenses stop
 * offering it rather than drawing a thicket.
 */
export const CROWDED = 26;
export const separable = (model) => model.direct.length <= CROWDED;

/* The arrow marker every directed lens uses.
 *
 * Marker units default to the stroke width, which would make the head of a
 * thick arrow enormous; userSpaceOnUse keeps every head the same size, so the
 * width of a line means the size of a flow and nothing else. */
export const DEFS = `
  <defs>
    <marker id="flow-arrow" viewBox="0 0 10 10" refX="8.5" refY="5"
      markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13"
      orient="auto-start-reverse">
      <path d="M0 0.6 L10 5 L0 9.4 z" fill="context-stroke"/>
    </marker>
  </defs>`;
