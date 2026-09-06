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
import { arc, contrastEmphasis, drawNodes, hit, nodeRadii, scaleBetween } from "./draw.js";
import { resistorPath, sourceBranch } from "./circuitry.js";
import { evidenceFlow } from "../../nma/flow.js";

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

/* Plain wires or circuit symbols. Rücker's reading is not an alternative model,
 * it is what the model already is, so this is a style rather than a lens. */
const STYLES = { plain: "Plain", circuit: "Circuit" };

function stylePills(state) {
  return Object.entries(STYLES)
    .map(
      ([id, label]) =>
        `<button type="button" data-option="style" data-value="${id}" class="${
          (state.options.style ?? "plain") === id ? "active" : ""
        }">${label}</button>`
    )
    .join("");
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

/* The same network, drawn as the circuit it is.
 *
 * Nothing here is a different model. Every wire is the same comparison at the
 * same place with the same width; what is added is the resistor symbol, the
 * junction dots, and the source branch that says which question is being put to
 * the circuit. See circuitry.js for what each symbol carries.
 */
function circuit(context, geometry, emphasis) {
  const { model, state, box } = context;

  // On a large network a resistor on every wire is a field of zigzags. Above
  // this many comparisons the symbol is kept for the wires that carry the
  // current for the comparison being asked about, and the rest stay plain.
  const powered = state.options.power !== "off";
  const dense = model.direct.length > 26;
  const flowing = powered && state.contrast
    ? new Map(
        evidenceFlow(model, state.contrast.treat1, state.contrast.treat2)?.edges.map((e) => [
          `${e.comparison.treat1} ${e.comparison.treat2}`,
          e.flow,
        ]) ?? []
      )
    : null;
  // On a large network the symbol is kept only where the current runs.
  const currents = dense ? flowing : null;
  const liveEdges = flowing;
  let suppressed = 0;

  const wires = geometry
    .map(({ edge, a, b, width, strands }) => {
      const key = `${edge.treat1} ${edge.treat2}`;
      const carrying =
        state.contrast &&
        ((edge.treat1 === state.contrast.treat1 && edge.treat2 === state.contrast.treat2) ||
          (edge.treat2 === state.contrast.treat1 && edge.treat1 === state.contrast.treat2));
      const wanted = !dense || (currents?.get(key) ?? 0) > 1e-6;
      const drawn = wanted ? resistorPath(a, b) : { d: arc(a, b), symbol: false };
      const { d, symbol } = drawn;
      if (!symbol) suppressed += 1;

      // With the separation control open the comparison comes apart into its
      // studies, which in circuit terms is what it always was: conductances in
      // parallel between the same two junctions.
      const parallel =
        state.separation > 0.02
          ? strands
              .map(
                (strand) =>
                  `<path class="wire-strand" data-study="${escape(
                    strand.row.studlab
                  )}" d="${strand.path}" stroke-width="${strand.width.toFixed(2)}"/>`
              )
              .join("")
          : "";

      // Where current actually runs, a second stroke slides along the wire. The
      // speed is the same everywhere on purpose: in a conductor it is the cross
      // section that carries the current, so here it is the width and only the
      // width that says how much evidence travels this way.
      const live = powered ? ((currents ?? liveEdges)?.get(key) ?? 0) : 0;
      return `
        <g class="wire${carrying ? " carrying" : ""}${symbol ? "" : " bare"}" data-edge="${escape(
          key
        )}">
          ${hit(arc(a, b))}
          <path class="wire-line" d="${d}" stroke-width="${width.toFixed(2)}"/>
          ${
            live > 1e-4
              ? `<path class="wire-current" d="${d}" stroke-width="${Math.max(
                  1,
                  width * 0.5
                ).toFixed(2)}"/>`
              : ""
          }
          ${parallel}
        </g>`;
    })
    .join("");

  // The source is not evidence, so it is drawn outside the network and dashed.
  let source = "";
  if (state.contrast) {
    const a = context.points[model.index.get(state.contrast.treat1)];
    const b = context.points[model.index.get(state.contrast.treat2)];
    if (a && b) {
      const branch = sourceBranch(a, b, box);
      source = `
        <g class="source${powered ? " live" : " off"}">
          <path class="source-wire" d="${branch.d}"/>
          ${branch.source}
        </g>`;
    }
  }

  return {
    stage: `<g class="source-layer">${source}</g><g class="wires">${wires}</g>
      <g class="nodes">${drawNodes(context, { emphasis, radii: nodeRadii(model) })}</g>`,
    inspector: inspector(context),
    style: "circuit",
    controls: `
      <div class="console-group">
        <span class="console-label">Drawing</span>
        <div class="pills">${stylePills(state)}</div>
      </div>
      <div class="console-group">
        <span class="console-label">Source</span>
        <button type="button" class="switch" id="power" data-option="power"
          data-value="${powered ? "off" : "on"}" aria-pressed="${powered}"
          aria-label="${powered ? "Switch the source off" : "Switch the source on"}"></button>
        <span class="lamp${powered && state.contrast ? " lit" : ""}"></span>
      </div>
      <div class="console-group">
        <span class="console-label">Potential across</span>
        <span class="deck-reading">${
          state.contrast && powered
            ? number(
                model.TE[model.index.get(state.contrast.treat1)][
                  model.index.get(state.contrast.treat2)
                ],
                3
              )
            : "—"
        }</span>
        <span class="console-label">${
          state.contrast
            ? `${escape(state.contrast.treat1)}, ${escape(state.contrast.treat2)}${
                context.dataset?.unit ? `, ${escape(context.dataset.unit)}` : ""
              }`
            : "—"
        }</span>
      </div>`,
    note:
      (!powered
        ? "The source is off, so nothing is flowing. What is left is the network itself: every comparison, its resistance, and the studies wired in parallel behind it. "
        : state.contrast
          ? `The source drives one unit of current from ${escape(
              state.contrast.treat1
            )} to ${escape(
              state.contrast.treat2
            )}; the potential difference it produces is the estimate and the resistance it meets is the variance. `
          : "") +
      `Wire width is precision and wire length is the standard error, as closely as two dimensions allow.` +
      (suppressed
        ? ` ${suppressed} ${
            suppressed === 1 ? "wire is" : "wires are"
          } drawn plain for room; a plain wire here still has resistance.`
        : ""),
  };
}

export const network = {
  // Offers controls that work the mechanism, so the canvas leaves room for
  // the deck under it.
  deck: true,
  // Draws the treatments where the shared arrangement puts them, so the
  // reader can pick one up and move it.
  spatial: true,
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
    const style = state.options.style === "circuit" ? "circuit" : "plain";

    if (style === "circuit") return circuit(context, geometry, emphasis);

    const edges = geometry
      .map(({ edge, a, b, strands, width }) => {
        const key = `${edge.treat1} ${edge.treat2}`;
        const highlighted =
          state.contrast &&
          ((edge.treat1 === state.contrast.treat1 && edge.treat2 === state.contrast.treat2) ||
            (edge.treat2 === state.contrast.treat1 && edge.treat1 === state.contrast.treat2));
        const strandPaths = strands
          .map(
            (s) =>
              `<path class="strand" data-study="${escape(s.row.studlab)}" d="${s.path}" stroke-width="${
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
        )}">${hit(arc(a, b))}${strandPaths}</g>`;
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
      controls: `
        <div class="console-group">
          <span class="console-label">Drawing</span>
          <div class="pills">${stylePills(state)}</div>
        </div>
        <div class="console-group">
          <span class="console-label">Separation</span>
          <span class="deck-reading">${percent(state.separation, 0)}</span>
          <span class="console-label">${
            state.separation > 0.02 ? "studies shown apart" : "comparisons pooled"
          }</span>
        </div>`,
      note,
    };
  },
};
