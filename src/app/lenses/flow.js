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
import { DEFS, arc, contrastEmphasis, drawNodes, hit, nodeRadii, scaleBetween } from "./draw.js";
import { leadPath, meterMarkup, probeMarkup } from "./props.js";

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
  // Draws the treatments where the shared arrangement puts them, so the
  // reader can pick one up and move it.
  spatial: true,
  id: "flow",
  name: "Flow",
  tagline: "Where one estimate actually comes from",
  reference:
    "Koenig J, Krahn U, Binder H. Visualizing the flow of evidence in network meta-analysis and characterizing mixed treatment comparisons. Stat Med. 2013;32(30):5414-5429.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h13M12 7l5 5-5 5M18.5 12H21"/></svg>',

  /* An arrow in this lens is a current, which the shared describer knows
   * nothing about, so the flow through it is added on top. */
  describe(context, target) {
    if (target.kind !== "edge" || !context.state.contrast) return null;
    const { model, state } = context;
    const network = evidenceFlow(model, state.contrast.treat1, state.contrast.treat2);
    const [treat1, treat2] = target.id.split(" ");
    const edge = network?.edges.find(
      (e) => e.comparison.treat1 === treat1 && e.comparison.treat2 === treat2
    );
    if (!edge) return null;
    return {
      kicker: "Evidence flow",
      title: `${edge.from} → ${edge.to}`,
      rows: [
        ["Current along it", percent(edge.flow, 1)],
        ["Of the estimate for", `${state.contrast.treat1} vs ${state.contrast.treat2}`],
      ],
      note:
        edge.flow > 1e-6
          ? "Evidence travels this way. Width is how much."
          : "No evidence for this comparison travels along here.",
    };
  },

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
        // The current is drawn twice: a still band at the full width, and a
        // dashed band sliding along it at a constant speed. Speed is the same
        // everywhere on purpose, because in a conductor it is the cross section
        // that carries the current, so here it is the width and only the width
        // that means how much evidence travels this way.
        const path = arc(a, tip);
        return `
          <g class="flow-edge${carrying ? "" : " idle"}${edge.isTarget ? " target" : ""}"
             data-edge="${escape(`${edge.comparison.treat1} ${edge.comparison.treat2}`)}">
            <title>${escape(edge.from)} to ${escape(edge.to)}: ${percent(edge.flow, 1)} of the estimate</title>
            ${hit(path)}
            <path class="flow-band" d="${path}" stroke-width="${width.toFixed(2)}"
              ${carrying ? 'marker-end="url(#flow-arrow)"' : ""}/>
            ${
              carrying
                ? `<path class="flow-current" d="${path}" stroke-width="${(width * 0.55).toFixed(
                    2
                  )}"/>`
                : ""
            }
          </g>`;
      })
      .join("");

    // The meter and its two probes.
    //
    // Which treatments the probes touch is which comparison is being measured,
    // and that is not a display setting: it is the question the whole site is
    // answering, shared by every lens. So the probes are the visible primary
    // way to ask it, and the two menus in the panel are the same control for
    // anyone not using a pointer.
    const carried = context.carrying;
    const airborne = (role) =>
      carried?.kind === `probe-${role}` && carried.moved && carried.at
        ? {
            x: context.box.left + carried.at.u * (context.box.right - context.box.left),
            y: context.box.top + carried.at.v * (context.box.bottom - context.box.top),
          }
        : null;

    const from = airborne("from") ?? points[model.index.get(state.contrast.treat1)];
    const to = airborne("to") ?? points[model.index.get(state.contrast.treat2)];
    const meterAt = {
      x: (context.box.left + context.box.right) / 2,
      y: context.box.bottom - 6,
    };
    const jackFrom = { x: meterAt.x - 26, y: meterAt.y + 26 };
    const jackTo = { x: meterAt.x + 26, y: meterAt.y + 26 };
    const facing = (tip) => {
      const dx = tip.x - jackFrom.x;
      const dy = tip.y - (jackFrom.y + 40);
      const len = Math.hypot(dx, dy) || 1;
      return { x: -dx / len, y: -dy / len };
    };
    const radii = nodeRadii(model);
    const touch = (tip, i, loose) =>
      loose
        ? tip
        : {
            x: tip.x - facing(tip).x * (radii[i] + 1),
            y: tip.y - facing(tip).y * (radii[i] + 1),
          };

    // What a probe in the air would land on, said out loud before it lands.
    const calling =
      carried?.candidate && carried.kind?.startsWith("probe")
        ? `<text class="probe-call" x="${(
            (carried.kind === "probe-from" ? from : to).x + 16
          ).toFixed(1)}" y="${((carried.kind === "probe-from" ? from : to).y - 16).toFixed(
            1
          )}">${escape(carried.candidate)}</text>`
        : "";

    const meter = `
      <g class="meter-rig">
        <path class="probe-lead from" d="${leadPath(jackFrom, from)}"/>
        <path class="probe-lead to" d="${leadPath(jackTo, to)}"/>
        ${meterMarkup(
          meterAt,
          escape(
            effect(
              model.TE[model.index.get(state.contrast.treat1)][
                model.index.get(state.contrast.treat2)
              ],
              null,
              context.measure
            )
          ),
          escape(`${state.contrast.treat1} minus ${state.contrast.treat2}`)
        )}
        ${probeMarkup(
          touch(from, model.index.get(state.contrast.treat1), Boolean(airborne("from"))),
          facing(from),
          "from",
          state.contrast.treat1
        )}
        ${probeMarkup(
          touch(to, model.index.get(state.contrast.treat2), Boolean(airborne("to"))),
          facing(to),
          "to",
          state.contrast.treat2
        )}
        ${calling}
      </g>`;

    return {
      stage: `${DEFS}<g class="flow-edges">${edges}</g><g class="nodes">${drawNodes(context, {
        emphasis: contrastEmphasis(state),
      })}</g>${meter}`,
      inspector: inspector(context, flowNetwork, paths),
      note: `One unit of evidence enters at ${state.contrast.treat1} and leaves at ${state.contrast.treat2}. Arrow width is the share of the estimate travelling that way.`,
    };
  },
};
