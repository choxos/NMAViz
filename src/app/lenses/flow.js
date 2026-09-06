/* Evidence flow.
 *
 * Pick a comparison and this lens shows where its estimate actually comes from.
 * Each arrow is a comparison, pointing the way the evidence travels, and its
 * width is the share of the estimate that travels along it. Comparisons that
 * carry nothing fade out; what remains is the sub-network that produced the
 * number, which is rarely the whole network and is sometimes surprisingly
 * little of it.
 */

import { evidenceFlow, flowPaths } from "../../nma/flow.js";
import { effect, escape, number, percent } from "../ui.js";
import { DEFS, arc, contrastEmphasis, drawNodes, nodeRadii, scaleBetween } from "./draw.js";

function inspector(context, flow, paths) {
  const { model, measure, dataset } = context;
  const i = model.index.get(flow.treat1);
  const j = model.index.get(flow.treat2);

  const pathRows = paths
    .slice(0, 12)
    .map(
      (path) => `
      <tr>
        <td class="route">${path.treatments.map((t) => escape(t)).join(" <span class='hop'>→</span> ")}</td>
        <td class="numeric">${percent(path.share, 1)}</td>
      </tr>`
    )
    .join("");

  const multiArm = model.narms.some((p) => p > 2);

  return `
    <header class="inspector-head">
      <span class="inspector-kind">Evidence flow</span>
      <h2>${escape(flow.treat1)} <span class="versus">vs</span> ${escape(flow.treat2)}</h2>
      <p class="inspector-scale">${effect(model.TE[i][j], model.seTE[i][j], measure)}${
        dataset?.unit ? ` ${escape(dataset.unit)}` : ""
      }</p>
    </header>

    <dl class="estimates">
      <div>
        <dt>Direct evidence</dt>
        <dd>${percent(flow.directProportion, 1)}</dd>
      </div>
      <div>
        <dt>Mean path length</dt>
        <dd>${number(flow.meanPathLength, 2)} comparisons</dd>
      </div>
      <div>
        <dt>Minimal parallelism</dt>
        <dd>${
          Number.isFinite(flow.minimalParallelism) ? number(flow.minimalParallelism, 2) : "–"
        } streams</dd>
      </div>
    </dl>

    <section class="inspector-section">
      <h3>Where the estimate comes from</h3>
      <table class="study-table">
        <thead><tr><th>Route</th><th class="numeric">Share</th></tr></thead>
        <tbody>${pathRows}</tbody>
      </table>
      ${
        paths.length > 12
          ? `<p class="inspector-note">${paths.length - 12} further routes carry the rest.</p>`
          : ""
      }
      <p class="inspector-note">
        Routes are found by repeatedly taking the shortest remaining path and draining it,
        the shortest path decomposition of Ruecker et al. The shares add to the whole estimate.
      </p>
      ${
        multiArm
          ? `<p class="inspector-note">
               This network has multi-arm studies. The current along the direct comparison is
               ${percent(flow.directFlow, 1)}, which is the hat matrix entry on the model's own
               weights; the ${percent(flow.directProportion, 1)} above is the published direct
               evidence proportion, a ratio of variances computed on the studies' original
               standard errors. The two coincide when every study is two-armed.
             </p>`
          : ""
      }
    </section>
  `;
}

export const flow = {
  id: "flow",
  name: "Flow",
  tagline: "Where one estimate actually comes from",
  reference:
    "Koenig J, Krahn U, Binder H. Visualizing the flow of evidence in network meta-analysis and characterizing mixed treatment comparisons. Stat Med. 2013;32(30):5414-5429.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h13M12 7l5 5-5 5M18.5 12H21"/></svg>',

  draw(context) {
    const { model, points, state } = context;
    if (!state.contrast) return { stage: "", inspector: "", note: "" };

    const flowNetwork = evidenceFlow(model, state.contrast.treat1, state.contrast.treat2);
    const paths = flowPaths(flowNetwork);
    const largest = Math.max(...flowNetwork.edges.map((e) => e.flow), 1e-9);

    const edges = flowNetwork.edges
      .map((edge) => {
        const a = points[model.index.get(edge.from)];
        const b = points[model.index.get(edge.to)];
        const carrying = edge.flow > 1e-6;
        const width = carrying ? scaleBetween(edge.flow, 0, largest, 1.6, 11) : 1;
        // Stop the arrow short of the target node, so the head is visible
        // rather than buried under the circle.
        const radius = nodeRadii(model)[model.index.get(edge.to)] + 5;
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const tip = {
          x: b.x - ((b.x - a.x) / length) * radius,
          y: b.y - ((b.y - a.y) / length) * radius,
        };
        return `
          <g class="flow-edge${carrying ? "" : " idle"}${edge.isTarget ? " target" : ""}"
             data-edge="${escape(`${edge.comparison.treat1} ${edge.comparison.treat2}`)}">
            <title>${escape(edge.from)} to ${escape(edge.to)}: ${percent(edge.flow, 1)} of the estimate</title>
            <path d="${arc(a, tip)}" stroke-width="${width.toFixed(2)}"
              ${carrying ? 'marker-end="url(#flow-arrow)"' : ""}/>
          </g>`;
      })
      .join("");

    return {
      stage: `${DEFS}<g class="flow-edges">${edges}</g><g class="nodes">${drawNodes(context, {
        emphasis: contrastEmphasis(state),
      })}</g>`,
      inspector: inspector(context, flowNetwork, paths),
      note: `One unit of evidence enters at ${state.contrast.treat1} and leaves at ${state.contrast.treat2}. Arrow width is the share of the estimate travelling that way.`,
    };
  },
};
