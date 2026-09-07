/* Inconsistency, split into the part triangles can see and the part they
 * cannot.
 *
 * The direct estimates form a flow on the treatment graph. The consistency
 * model is the part of that flow which is the difference of a score attached to
 * each treatment; whatever is left over is inconsistency. Hodge theory splits
 * the leftover into a part that closes up around triangles, which is the loop
 * inconsistency everyone already looks for, and a harmonic part that lives on
 * long loops with no chord and that no triangle-by-triangle check can reach.
 *
 * The two parts are orthogonal, so their energies add to the between-comparison
 * part of Cochran's Q. That is what makes this a decomposition of a number the
 * reader already has rather than a new statistic.
 */

import { hodge, hodgeRanking, sparseCyclic } from "../../nma/hodge.js";
import { effect, escape, number, percent } from "../ui.js";
import { arc, drawNodes, hit, scaleBetween } from "./draw.js";

const COMPONENTS = {
  residual: { label: "All", pick: (h, i) => h.residual[i] },
  curl: { label: "Around triangles", pick: (h, i) => h.curl[i] },
  harmonic: { label: "Long loops", pick: (h, i) => h.harmonic[i] },
};

function inspector(context, h, component) {
  const { measure, state } = context;
  const ranking = hodgeRanking(context.model, h);
  const sparse = state.options.hodgeSparse === "show" ? sparseCyclic(h) : null;
  const share = (part) => (h.energyResidual > 1e-12 ? part / h.energyResidual : 0);

  const pills = Object.entries(COMPONENTS)
    .map(([id, c]) => {
      const empty = id === "harmonic" && h.harmonicDimension === 0;
      return `<button type="button" data-option="hodge" data-value="${id}" class="${
        component === id ? "active" : ""
      }"${empty ? ' disabled title="This network has no long-loop inconsistency to show"' : ""}>${
        c.label
      }</button>`;
    })
    .join("");

  const loops = h.loops
    .slice(0, 8)
    .map(
      (loop) => `
      <tr>
        <td class="route">${loop.treatments.map((t) => escape(t)).join(" <span class='hop'>→</span> ")}</td>
        <td class="numeric">${number(loop.gap, 3)}</td>
      </tr>`
    )
    .join("");

  const worst = h.edges
    .map((edge, i) => ({ edge, value: COMPONENTS[component].pick(h, i), weight: h.weight[i] }))
    .sort((a, b) => b.weight * b.value ** 2 - a.weight * a.value ** 2)
    .slice(0, 8)
    .map(
      (row) => `
      <tr>
        <td>${escape(row.edge.treat1)} <span class="hop">vs</span> ${escape(row.edge.treat2)}</td>
        <td class="numeric">${number(row.value, 3)}</td>
      </tr>`
    )
    .join("");

  return `
    <header class="inspector-head">
      <span class="inspector-kind">Inconsistency</span>
      <h2>Where the model does not fit</h2>
      <p class="inspector-scale">${h.triangleCount} ${
        h.triangleCount === 1 ? "triangle" : "triangles"
      } across ${h.edges.length} comparisons</p>
    </header>

    ${h.omittedZeroInformation ? `<p class="inspector-note">${h.omittedZeroInformation} comparison(s) have zero adjusted information and are omitted from this weighted graph, including its triangle and cycle counts. Their original study data remain in the analysis.</p>` : ""}
    <dl class="estimates">
      <div>
        <dt>Between comparisons</dt>
        <dd>Q = ${number(h.energyResidual, 2)}</dd>
      </div>
      <div>
        <dt>Around triangles</dt>
        <dd>${percent(share(h.energyCurl), 1)}</dd>
      </div>
      <div>
        <dt>On long loops</dt>
        <dd>${
          h.harmonicDimension === 0
            ? "none possible"
            : percent(share(h.energyHarmonic), 1)
        }</dd>
      </div>
    </dl>

    <section class="inspector-section">
      <h3>Challenge: find the invisible disagreement</h3>
      <p class="inspector-note">Load the four-cycle. Predict whether any triangle check can see its nonzero loop sum. Then add the A-C chord and compare harmonic dimension and curl energy. The chord changes what is detectable; it does not guarantee agreement.</p>
      <div class="pills"><button type="button" data-hodge-example="cycle">Load four-cycle</button><button type="button" data-hodge-example="chord">Add A-C chord</button></div>
      <p class="inspector-note">Harmonic dimension: ${h.harmonicDimension}. Curl energy: ${number(h.energyCurl, 3)}. Harmonic energy: ${number(h.energyHarmonic, 3)}.</p>
    </section>
    <section class="inspector-section">
      <h3>Show</h3>
      <div class="pills">${pills}</div>
      <p class="inspector-note">
        The two parts are orthogonal, so these shares add up. A network whose inconsistency is
        mostly harmonic has disagreement that no triangle contains, and checking its loops one
        triangle at a time will not find it.
      </p>
      <p class="inspector-note">
        ${
          h.harmonicDimension === 0
            ? `This network has no long-loop inconsistency to find, and that is a fact about its
               shape rather than about its data. The space such disagreement would live in has
               dimension zero here, so triangle boundaries span the cycle space and checking the triangles checks everything. Most published networks are like
               this; the reading matters for the ones that are not.`
            : `The space of long-loop inconsistency has dimension ${h.harmonicDimension} on this
               network, so there are ${
                 h.harmonicDimension === 1 ? "directions" : "directions"
               } of disagreement no triangle can reach. Checking loops one triangle at a time
               would miss them.`
        }
      </p>
    </section>

    <section class="inspector-section">
      <h3>Comparisons the model fits worst</h3>
      <table class="study-table">
        <thead><tr><th>Comparison</th><th class="numeric">Departure</th></tr></thead>
        <tbody>${worst}</tbody>
      </table>
    </section>

    ${
      h.triangleCount
        ? `<section class="inspector-section">
             <h3>Loops that do not close</h3>
             <table class="study-table">
               <thead><tr><th>Loop</th><th class="numeric">Gap</th></tr></thead>
               <tbody>${loops}</tbody>
             </table>
             <p class="inspector-note">
               The gap is how far the three direct estimates are from adding to zero, on the
               ${escape(measure)} scale the model is fitted on.
             </p>
           </section>`
        : ""
    }

    <section class="inspector-section">
      <h3>Ranking laboratory</h3>
      <p class="inspector-note">Higher numerical effect comes first here. This is a descriptive ranking exercise, not clinical benefit, a P-score, or a recommendation. Jiang's ordinary Borda equivalence requires complete, balanced binary preference data; the score extension below also accepts cardinal data.</p>
      <table class="study-table"><thead><tr><th>Item</th><th>Gradient score</th><th>Weighted net score</th></tr></thead><tbody>${ranking.scores.sort((a, b) => b.gradient - a.gradient).map((s) => `<tr><td>${escape(s.treatment)}</td><td>${number(s.gradient, 3)}</td><td>${number(s.borda, 3)}</td></tr>`).join("")}</tbody></table>
      <p class="inspector-note">${ranking.balancedComplete ? "Complete equal-weight graph: gradient and net-score orders coincide (ties allowed)." : "Incomplete or unequal-weight graph: net-score and Hodge orders need not agree."}</p>
      <p class="inspector-note">${ranking.kemeny ? `Exact Kemeny-type order: ${ranking.kemeny.order.map(escape).join(" → ")}. Weighted squared sign-fit loss: ${number(ranking.kemeny.objective, 3)}. This minimizes the discrete sign model; ties return one optimum.` : "Exact Kemeny optimization is limited to 12 items; its exponential computation is not approximated silently."}</p>
      <button type="button" data-option="hodgeSparse" data-value="${state.options.hodgeSparse === "show" ? "hide" : "show"}">${state.options.hodgeSparse === "show" ? "Hide" : "Compute"} sparse cyclic representative</button>
      ${state.options.hodgeSparse === "show" ? sparse ? `<p class="inspector-note">Jiang §5.1: minimize ‖residual − curl*φ‖₁. L1 objective ${number(sparse.objective, 4)}; ${sparse.converged ? "converged" : "iteration limit; not certified converged"} after ${sparse.iterations} iterations; residual ${sparse.residual.toExponential(2)}. Sparse representatives need not be unique; this does not authorize dropping trials.</p><table class="study-table"><thead><tr><th>Comparison</th><th>Representative</th></tr></thead><tbody>${h.edges.map((e, i) => `<tr><td>${escape(e.treat1)} / ${escape(e.treat2)}</td><td>${number(sparse.values[i], 4)}</td></tr>`).join("")}</tbody></table>` : '<p class="inspector-note">Sparse solver limited to 100 comparisons.</p>' : ""}
    </section>
    <p class="inspector-note">
      Computed on one pooled estimate per comparison, using the weights the model itself uses.
      Disagreement between studies of the same comparison is heterogeneity, not inconsistency,
      and is not part of this split. Read it as a diagnostic alongside a design-by-treatment
      interaction model, not as a replacement for one.
    </p>
  `;
}

export const hodgeLens = {
  // Draws the treatments where the shared arrangement puts them, so the
  // reader can pick one up and move it.
  spatial: true,
  separates: "A loop's inconsistency belongs to the comparisons in it, not to any one study.",
  id: "hodge",
  name: "Inconsistency",
  tagline: "The disagreement triangles can see, and the disagreement they cannot",
  reference:
    "Jiang X, Lim LH, Yao Y, Ye Y. Statistical ranking and combinatorial Hodge theory. Math Program. 2011;127(1):203-244.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 4 21 19H3z"/><path d="M12 10v4M12 16.6v.4"/></svg>',

  /* The whole claim of this lens is that one number splits into three that
   * add back up, so a hover on a comparison shows the split for that one. */
  describe(context, target) {
    if (target.kind !== "edge") return null;
    const h = hodge(context.model);
    const [treat1, treat2] = target.id.split(" ");
    const i = h.edges.findIndex(
      (e) =>
        (e.treat1 === treat1 && e.treat2 === treat2) ||
        (e.treat1 === treat2 && e.treat2 === treat1)
    );
    if (i === -1) return null;
    const flip = h.edges[i].treat1 === treat1 ? 1 : -1;
    return {
      kicker: "Inconsistency",
      title: `${treat1} vs ${treat2}`,
      rows: [
        ["Observed direct", number(flip * h.observed[i], 3)],
        ["Consistency fit", number(flip * h.gradient[i], 3)],
        ["Around triangles", number(flip * h.curl[i], 3)],
        [
          "Long loops",
          h.harmonicDimension === 0 ? "none possible" : number(flip * h.harmonic[i], 3),
        ],
      ],
      note: "The last three add to the first. The two below it are what no consistency model can explain.",
    };
  },

  draw(context) {
    const { model, points, state } = context;
    const h = hodge(model);
    const component = COMPONENTS[state.options.hodge] ? state.options.hodge : "residual";

    const values = h.edges.map((_, i) => COMPONENTS[component].pick(h, i));
    const largest = Math.max(...values.map(Math.abs), 1e-9);

    // Triangles that fail to close, drawn as faint plates so the reader sees
    // where a loop check would fire.
    const worstGap = Math.max(...h.loops.map((l) => Math.abs(l.gap)), 1e-9);
    const plates =
      component === "harmonic"
        ? ""
        : h.loops
            .slice(0, 10)
            .map((loop) => {
              const [i, j, k] = loop.indices;
              const path = [points[i], points[j], points[k]]
                .map((p, index) => `${index ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                .join("");
              return `<path class="hodge-plate" d="${path}Z" opacity="${(
                0.03 +
                0.16 * (Math.abs(loop.gap) / worstGap)
              ).toFixed(3)}"><title>${escape(loop.treatments.join(" to "))}: the loop misses by ${number(
                loop.gap,
                3
              )}</title></path>`;
            })
            .join("");

    const edges = h.edges
      .map((edge, i) => {
        const value = values[i];
        const a = points[model.index.get(edge.treat1)];
        const b = points[model.index.get(edge.treat2)];
        const strength = Math.abs(value) / largest;
        return `
          <g class="hodge-edge ${value >= 0 ? "over" : "under"}" data-edge="${escape(
            `${edge.treat1} ${edge.treat2}`
          )}">
            <title>${escape(edge.treat1)} vs ${escape(edge.treat2)}: the direct estimate sits ${number(
              value,
              3
            )} ${value >= 0 ? "above" : "below"} the consistency model</title>
            ${hit(arc(a, b))}
            <path d="${arc(a, b)}" stroke-width="${scaleBetween(strength, 0, 1, 1.2, 10).toFixed(
              2
            )}" opacity="${(0.25 + 0.7 * strength).toFixed(3)}"/>
          </g>`;
      })
      .join("");

    return {
      stage: `<g class="hodge-plates">${plates}</g><g class="hodge-edges">${edges}</g>
        <g class="nodes">${drawNodes(context, {})}</g>`,
      inspector: inspector(context, h, component),
      note:
        component === "harmonic"
          ? "Inconsistency that no triangle contains. It lives on loops of four treatments or more with no shortcut across them."
          : component === "curl"
            ? "Inconsistency that closes up around triangles, which is what a loop-by-loop check finds."
            : "How far each direct estimate sits from the consistency model. Warm means above it, cool means below.",
    };
  },
};
