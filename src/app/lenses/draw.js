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
 * that it does not land on top of the network. */
function labelFor(name, point, radius, width, height) {
  const dx = point.x - width / 2;
  const dy = point.y - height / 2;
  const length = Math.hypot(dx, dy) || 1;
  const offset = radius + 13;
  const x = point.x + (dx / length) * offset;
  const y = point.y + (dy / length) * offset;
  const anchor = dx > 12 ? "start" : dx < -12 ? "end" : "middle";
  const baseline = dy > 12 ? "hanging" : dy < -12 ? "auto" : "middle";
  return `<text class="node-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
    text-anchor="${anchor}" dominant-baseline="${baseline}">${escape(shortLabel(name))}</text>`;
}

export function drawNodes(context, { emphasis = new Map(), radii } = {}) {
  const { model, points, width, height, state } = context;
  const sizes = radii ?? nodeRadii(model);
  return model.treatments
    .map((name, i) => {
      const point = points[i];
      const role = emphasis.get(name) ?? "";
      const selected = state.selection?.kind === "treatment" && state.selection.id === name;
      return `
        <g class="node ${role}${selected ? " selected" : ""}" data-treatment="${escape(name)}">
          <title>${escape(name)}</title>
          <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${sizes[i].toFixed(1)}"/>
          ${labelFor(name, point, sizes[i], width, height)}
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

/* The arrow marker every directed lens uses. */
export const DEFS = `
  <defs>
    <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"
      markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/>
    </marker>
  </defs>`;
