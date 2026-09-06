/* The network itself.
 *
 * The starting view, and the one that carries the separation control: at rest
 * each comparison is a single line whose width is its precision, and as the
 * control opens, every comparison fans out into the individual studies behind
 * it, each with its own width. A comparison that looked solid because one large
 * trial sits on it looks different from one that rests on six small ones, and
 * the only way to see which is which is to take it apart.
 */

import { effect, escape, number, percent } from "../ui.js";
import { arc, contrastEmphasis, drawNodes, nodeRadii, scaleBetween } from "./draw.js";

function edgeGeometry(context) {
  const { model, points, state } = context;
  const precisions = model.direct.map((edge) => 1 / edge.seTE ** 2);
  const low = Math.min(...precisions);
  const high = Math.max(...precisions);

  return model.direct.map((edge, index) => {
    const a = points[model.index.get(edge.treat1)];
    const b = points[model.index.get(edge.treat2)];
    const width = scaleBetween(Math.sqrt(precisions[index]), Math.sqrt(low), Math.sqrt(high), 1.4, 8);

    // The individual studies, spread perpendicular to the comparison as the
    // separation control opens.
    const studyPrecisions = edge.rows.map((row) => 1 / row.seTE ** 2);
    const strands = edge.rows.map((row, k) => {
      const centered = k - (edge.rows.length - 1) / 2;
      const bend = centered * 26 * state.separation;
      return {
        row,
        path: arc(a, b, bend),
        width: scaleBetween(
          Math.sqrt(studyPrecisions[k]),
          Math.sqrt(Math.min(...studyPrecisions)),
          Math.sqrt(Math.max(...studyPrecisions)),
          1.2,
          Math.max(1.6, width)
        ),
      };
    });

    return { edge, a, b, width, strands };
  });
}

function inspector(context) {
  const { model, state, measure, dataset } = context;
  if (!state.contrast) return "";
  const i = model.index.get(state.contrast.treat1);
  const j = model.index.get(state.contrast.treat2);
  const direct = model.direct.find(
    (e) =>
      (e.treat1 === state.contrast.treat1 && e.treat2 === state.contrast.treat2) ||
      (e.treat2 === state.contrast.treat1 && e.treat1 === state.contrast.treat2)
  );
  // The direct estimate is stored in one orientation; flip it if the reader is
  // looking at the pair the other way round.
  const flip = direct && direct.treat1 !== state.contrast.treat1;
  const sign = flip ? -1 : 1;

  const studies = direct
    ? direct.rows
        .map(
          (row) => `
        <tr>
          <td>${escape(row.studlab)}</td>
          <td class="numeric">${effect(sign * row.TE, row.seTE, measure)}</td>
          <td class="numeric">${percent(
            1 / row.seTE ** 2 / direct.rows.reduce((s, r) => s + 1 / r.seTE ** 2, 0),
            0
          )}</td>
        </tr>`
        )
        .join("")
    : "";

  return `
    <header class="inspector-head">
      <span class="inspector-kind">Comparison</span>
      <h2>${escape(state.contrast.treat1)} <span class="versus">vs</span> ${escape(
        state.contrast.treat2
      )}</h2>
      <p class="inspector-scale">${escape(dataset?.outcome ?? "Effect")}${
        dataset?.unit ? `, ${escape(dataset.unit)}` : ""
      }</p>
    </header>

    <dl class="estimates">
      <div>
        <dt>Network</dt>
        <dd>${effect(model.TE[i][j], model.seTE[i][j], measure)}</dd>
      </div>
      <div>
        <dt>Direct</dt>
        <dd>${direct ? effect(sign * direct.TE, direct.seTE, measure) : "no direct comparison"}</dd>
      </div>
      <div>
        <dt>Indirect</dt>
        <dd>${
          direct && Number.isFinite(direct.indirectTE)
            ? effect(sign * direct.indirectTE, direct.indirectSe, measure)
            : direct
              ? "the network adds nothing here"
              : effect(model.TE[i][j], model.seTE[i][j], measure)
        }</dd>
      </div>
      <div>
        <dt>Direct evidence</dt>
        <dd>${direct ? percent(direct.proportion, 1) : "0%"} of the network estimate</dd>
      </div>
      <div>
        <dt>Effective resistance</dt>
        <dd>${number(model.resistance[i][j], 4)}</dd>
      </div>
    </dl>

    <p class="inspector-note">
      Read the network as a circuit and the variance of a comparison is the effective resistance
      between its two treatments, with each study a conductance of one over its variance. That is
      why the distance between two treatments in this drawing is the standard error of comparing
      them: the two are the same quantity.
    </p>

    ${
      direct
        ? `<section class="inspector-section">
             <h3>${direct.studies} ${direct.studies === 1 ? "study" : "studies"} on this comparison</h3>
             <table class="study-table">
               <thead><tr><th>Study</th><th class="numeric">Effect</th><th class="numeric">Weight</th></tr></thead>
               <tbody>${studies}</tbody>
             </table>
             <p class="inspector-note">
               Heterogeneity across these studies: Q = ${number(direct.Q, 2)} on
               ${number(direct.df, 0)} ${direct.df === 1 ? "degree" : "degrees"} of freedom.
             </p>
           </section>`
        : `<section class="inspector-section">
             <p class="inspector-note">
               No study compared these two treatments. Everything known about this pair comes
               through the rest of the network, which is what the flow and contribution lenses
               take apart.
             </p>
           </section>`
    }
  `;
}

export const network = {
  id: "network",
  name: "Network",
  tagline: "Every comparison, with the studies behind it",
  reference:
    "Ruecker G. Network meta-analysis, electrical networks and graph theory. Res Synth Methods. 2012;3(4):312-324.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><path d="M10.7 6.7 6.3 15.3M13.3 6.7l4.4 8.6M7 17h10"/></svg>',

  draw(context) {
    const { model, state, measure } = context;
    const geometry = edgeGeometry(context);
    const emphasis = contrastEmphasis(state);

    const edges = geometry
      .map(({ edge, strands, width }) => {
        const key = `${edge.treat1} ${edge.treat2}`;
        const highlighted =
          state.contrast &&
          ((edge.treat1 === state.contrast.treat1 && edge.treat2 === state.contrast.treat2) ||
            (edge.treat2 === state.contrast.treat1 && edge.treat1 === state.contrast.treat2));
        const strandPaths = strands
          .map(
            (s) =>
              `<path class="strand" d="${s.path}" stroke-width="${
                state.separation > 0.02 ? s.width.toFixed(2) : width.toFixed(2)
              }" opacity="${
                state.separation > 0.02 ? 0.85 : 1 / Math.max(1, strands.length) + 0.15
              }"><title>${escape(s.row.studlab)}: ${effect(
                s.row.TE,
                s.row.seTE,
                measure
              )}</title></path>`
          )
          .join("");
        return `<g class="edge${highlighted ? " highlighted" : ""}" data-edge="${escape(
          key
        )}">${strandPaths}</g>`;
      })
      .join("");

    const meta = context.layoutMeta;
    const note =
      state.separation > 0.02
        ? `Each comparison is fanned out into the studies behind it; the width of a strand is that study's precision.`
        : meta?.stress != null
          ? `Distance is the standard error of the network estimate, drawn with ${percent(
              meta.stress,
              0
            )} residual stress in two dimensions.`
          : (meta?.meaning ?? "");

    return {
      stage: `<g class="edges">${edges}</g><g class="nodes">${drawNodes(context, {
        emphasis,
        radii: nodeRadii(model),
      })}</g>`,
      inspector: inspector(context),
      note,
    };
  },
};
