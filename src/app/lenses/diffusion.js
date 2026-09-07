/* Diffusion.
 *
 * The covariance matrix of a network meta-analysis is usually obtained by
 * inverting the Laplacian, which says nothing about where the precision came
 * from. Ruecker, Davies and Schwarzer (2026) show it is also the sum of a
 * geometric series of diffusion matrices, and a partial sum of a convergent
 * series is a real quantity: after k steps it is the part of the covariance
 * that a walker who has taken at most k steps can account for.
 *
 * So this lens animates the sum rather than decorating it. The mass spreading
 * across the network is a walker released at the first treatment, and the
 * number beside it is the share of the comparison's variance that walks of at
 * most that many steps account for. Note the direction: the partial sum is
 * always below the true variance and rises to it, because the series is being
 * added up, not because short walks are more certain. What the animation shows
 * is how far a reader has to look before the uncertainty of a comparison is
 * fully accounted for. A network that reaches its final value in two steps is
 * one whose estimates are local; a network still accumulating at step eight is
 * drawing on evidence a long way from the comparison being made.
 */

import { absorbingWalk, diffusionEstimates, diffusionMass, diffusionPartials, varianceFrom } from "../../nma/diffusion.js";
import { effect, escape, number, onScale, percent } from "../ui.js";
import {
  arc,
  contrastEmphasis,
  drawNodes,
  hit,
  nodeRadii,
  scaleBetween,
  separable,
  strandsOf,
} from "./draw.js";
import { dropperMarkup } from "./props.js";

const STEPS = 22;

// Recomputing the whole series on every animation frame would be wasteful, and
// nothing in it changes while the data and the model do not.
let cache = { key: null, partials: null, mass: null };

/* Where the walk is released.
 *
 * The capsule chooses this, and it is a real initial condition rather than a
 * setting: the mass that spreads is the mass released at that treatment, and
 * the picture is of that walk and no other. It defaults to the first treatment
 * of the comparison because that is the walk the variance series below is
 * built from, and when the reader moves it somewhere else the drawing says so
 * rather than quietly showing one walk under another walk's caption.
 */
export function originOf(state, model) {
  const chosen = state.options.origin;
  if (chosen && model.index.get(chosen) != null) return chosen;
  return state.contrast?.treat1;
}

function series(context) {
  const { model, state, dataset } = context;
  const origin = originOf(state, model);
  const key = `${dataset?.id}|${state.model}|${state.contrast?.treat1}|${origin}|${state.options.solverFull}`;
  if (cache.key !== key || cache.model !== model || cache.finish !== state.contrast?.treat2) {
    cache = {
      key, model, finish: state.contrast?.treat2,
      solver: diffusionEstimates(model, { maxSteps: state.options.solverFull === "true" ? 2000 : STEPS, tolerance: 1e-10 }),
      absorbing: absorbingWalk(model, state.contrast.treat1, state.contrast.treat2, STEPS),
      partials: diffusionPartials(model, STEPS),
      mass: diffusionMass(model, origin, STEPS),
    };
  }
  return cache;
}

function inspector(context, step, partials) {
  const { model, state, measure } = context;
  const a = model.index.get(state.contrast.treat1);
  const b = model.index.get(state.contrast.treat2);
  const exact = model.seTE[a][b];
  const TE = model.TE[a][b];

  const rows = [0, 1, 2, 3, 5, 8, 13, STEPS]
    .filter((k) => k <= STEPS)
    .map((k) => {
      const variance = varianceFrom(partials[k], a, b);
      const se = Math.sqrt(Math.max(0, variance));
      return `
        <tr class="${k === step ? "current" : ""}">
          <td>${k}</td>
          <td class="numeric">${Number.isFinite(se) ? number(se, 4) : "–"}</td>
          <td class="numeric">${percent(Math.min(1, variance / Math.max(exact ** 2, 1e-12)), 0)}</td>
        </tr>`;
    })
    .join("");

  const variance = varianceFrom(partials[step], a, b);
  const se = Math.sqrt(Math.max(0, variance));

  return `
    <header class="inspector-head">
      <span class="inspector-kind">Diffusion, step ${step}</span>
      <h2>${escape(state.contrast.treat1)} <span class="versus">vs</span> ${escape(
        state.contrast.treat2
      )}</h2>
      <p class="inspector-scale">After ${step} ${step === 1 ? "step" : "steps"} of diffusion</p>
    </header>

    <dl class="estimates">
      <div>
        <dt>Square root of partial variance</dt>
        <dd>${Number.isFinite(se) ? number(se, 4) : "not yet defined"}</dd>
      </div>
      <div>
        <dt>The whole series</dt>
        <dd>${effect(TE, exact, measure)}</dd>
      </div>
      <div>
        <dt>Variance reached</dt>
        <dd>${percent(
          Math.min(1, varianceFrom(partials[step], a, b) / Math.max(exact ** 2, 1e-12)),
          1
        )}</dd>
      </div>
    </dl>

    <section class="inspector-section">
      <h3>How the precision accumulates</h3>
      <table class="study-table">
        <thead><tr><th>Step</th><th class="numeric">Standard error</th><th class="numeric">Of the variance</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="inspector-note">
        Each row is the part of this comparison's variance that walks of at most that many steps
        account for, so the figures rise to the network's own standard error rather than falling
        to it. The point estimate never moves; this is a decomposition of the uncertainty by how
        far the evidence had to travel. Partial variances are not valid interim confidence intervals.
      </p>
    </section>
  `;
}

export const diffusionLens = {
  // Draws the treatments where the shared arrangement puts them, so the
  // reader can pick one up and move it.
  spatial: true,
  separates: true,
  // The dropper stands above the treatment it releases the walk on.
  headroom: 48,
  id: "diffusion",
  name: "Diffusion",
  tagline: "How far the evidence had to travel to explain the uncertainty",
  reference:
    "Ruecker G, Davies AL, Schwarzer G. Network meta-analysis and diffusion. Res Synth Methods. 2026.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="12" r="6" opacity="0.6"/><circle cx="12" cy="12" r="9.6" opacity="0.3"/></svg>',
  animate: true,
  deck: true,

  draw(context) {
    const { model, points, state, frame = 0 } = context;
    if (!state.contrast) return { stage: "", inspector: "", note: "" };

    const { partials, mass, absorbing, solver } = series(context);
    const mode = state.options.diffusionMode ?? "variance";
    // The walk runs on its own until the reader takes hold of it, at which
    // point they own the clock: a process worth watching is a process worth
    // stopping in the middle of.
    const held = state.options.walk;
    // Hold on the settled picture for a moment before starting again, so the
    // loop reads as a process that finishes rather than a spinner.
    const cycle = STEPS + 8;
    const step =
      held == null ? Math.min(STEPS, frame % cycle) : Math.max(0, Math.min(STEPS, Number(held)));
    const here = mode === "absorbing" ? absorbing.history[step] : mass[step];
    const largest = Math.max(...here, 1e-9);
    const radii = nodeRadii(model);

    const halo = model.treatments
      .map((name, i) => {
        const share = here[i];
        if (share < 1e-4) return "";
        const radius = radii[i] + scaleBetween(Math.sqrt(share), 0, Math.sqrt(largest), 0, 34);
        return `<circle class="diffusion-halo" cx="${points[i].x.toFixed(1)}" cy="${points[
          i
        ].y.toFixed(1)}" r="${radius.toFixed(1)}" opacity="${(0.1 + 0.5 * (share / largest)).toFixed(
          3
        )}"/>`;
      })
      .join("");

    // A walker standing on a treatment leaves along one of the comparisons
    // with probability in proportion to its weight, and a comparison's weight
    // is the sum of its studies'. So a walker is really choosing a study, and
    // the separation control shows the choice it is making: strand width is
    // the share of the crossings that go through that trial.
    const fanned = state.separation > 0.02 && separable(model);
    const edges = model.direct
      .map((edge) => {
        const a = points[model.index.get(edge.treat1)];
        const b = points[model.index.get(edge.treat2)];
        const parallel = fanned
          ? strandsOf(edge, a, b, state.separation)
              .map(
                (strand) =>
                  `<path class="diffusion-strand" data-study="${escape(
                    strand.row.studlab
                  )}" d="${strand.path}" stroke-width="${(0.6 + 2.4 * strand.share).toFixed(
                    2
                  )}"><title>${escape(strand.row.studlab)}: ${percent(
                    strand.share,
                    0
                  )} of the crossings</title></path>`
              )
              .join("")
          : "";
        return `<g class="diffusion-edge${parallel ? " fanned" : ""}" data-edge="${escape(
          `${edge.treat1} ${edge.treat2}`
        )}">${hit(arc(a, b))}<path d="${arc(a, b)}"/>${parallel}</g>`;
      })
      .join("");

    const origin = mode === "absorbing" ? state.contrast.treat1 : originOf(state, model);
    const originPoint =
      context.carrying?.kind === "dropper" && context.carrying.at
        ? {
            x: context.box.left + context.carrying.at.u * (context.box.right - context.box.left),
            y: context.box.top + context.carrying.at.v * (context.box.bottom - context.box.top),
          }
        : points[model.index.get(origin)];
    const calling =
      context.carrying?.kind === "dropper" && context.carrying.candidate
        ? `<text class="probe-call" x="${(originPoint.x + 18).toFixed(1)}" y="${(
            originPoint.y - 46
          ).toFixed(1)}">${escape(context.carrying.candidate)}</text>`
        : "";

    return {
      stage: `<g class="diffusion-edges">${edges}</g><g class="diffusion-halos">${halo}</g>
        <g class="nodes">${drawNodes(context, {
          emphasis: contrastEmphasis(state),
          radii,
        })}</g>${dropperMarkup(originPoint, step === 0)}${calling}`,
      inspector: mode === "variance" ? inspector(context, step, partials) : methodInspector(context, mode, step, absorbing, solver),
      controls: `
        <div class="console-group"><span class="console-label">Experiment</span>${[["variance", "Variance"], ["estimates", "Estimate solver"], ["absorbing", "Absorbing walk"]].map(([value, label]) => `<button class="deck-button" type="button" data-option="diffusionMode" data-value="${value}" aria-pressed="${mode === value}">${label}</button>`).join("")}</div>
        <div class="console-group">
          <span class="console-label">Released at</span>
          <span class="deck-reading">${escape(origin)}</span>
          ${
            origin === state.contrast.treat1
              ? ""
              : `<button type="button" class="deck-button" data-option="origin" data-value="auto">Back to ${escape(
                  state.contrast.treat1
                )}</button>`
          }
        </div>
        <div class="console-group">
          <span class="console-label">Walk</span>
          <button type="button" class="deck-button" data-option="walk" data-value="${Math.max(
            0,
            step - 1
          )}" aria-label="One step back">&#8592;</button>
          <button type="button" class="deck-button${
            held == null ? " primary" : ""
          }" data-option="walk" data-value="${held == null ? String(step) : "auto"}">${
            held == null ? "Hold" : "Run"
          }</button>
          <button type="button" class="deck-button" data-option="walk" data-value="${Math.min(
            STEPS,
            step + 1
          )}" aria-label="One step forward">&#8594;</button>
        </div>
        <div class="console-group">
          <span class="console-label">Step</span>
          <span class="deck-reading">${step} of ${STEPS}</span>
          <span class="console-label">${mode === "absorbing" ? "Absorbed" : "Variance explained"}</span>
          <span class="deck-reading">${(() => {
            if (mode === "absorbing") return percent(absorbing.history[step][model.index.get(state.contrast.treat2)], 1);
            const a = model.index.get(state.contrast.treat1);
            const b = model.index.get(state.contrast.treat2);
            const exact = model.seTE[a][b] ** 2;
            return percent(
              Math.min(1, varianceFrom(partials[step], a, b) / Math.max(exact, 1e-12)),
              1
            );
          })()}</span>
        </div>`,
      note: mode === "absorbing" ? `Walkers start at ${escape(state.contrast.treat1)} and stay at ${escape(state.contrast.treat2)} when they arrive. Net crossings equal the evidence-flow hat coefficients, even though individual walkers can backtrack.` : `A walker released at ${escape(origin)}, ${step} ${
        step === 1 ? "step" : "steps"
      } in.${
        origin === state.contrast.treat1
          ? ""
          : ` The variance series below is the one for a walk from ${escape(
              state.contrast.treat1
            )}, so it is the comparison of interest that it explains, not this walk.`
      } Half the mass stays behind at each step, which is what makes the series converge on a network with no loop of odd length.`,
    };
  },
};

function methodInspector(context, mode, step, absorbing, solver) {
  const { model, state } = context;
  const a = model.index.get(state.contrast.treat1), b = model.index.get(state.contrast.treat2);
  if (mode === "absorbing") return `<header class="inspector-head"><span class="inspector-kind">Absorbing random walk</span><h2>Reach ${escape(state.contrast.treat2)}</h2></header>
    <dl class="estimates"><div><dt>Absorbed by step ${step}</dt><dd>${percent(absorbing.history[step][b], 1)}</dd></div><div><dt>Expected steps to absorption</dt><dd>${number(absorbing.expectedSteps, 2)}</dd></div></dl>
    <section class="inspector-section"><h3>Expected visits before absorption</h3><table class="study-table"><tbody>${model.treatments.map((name, i) => `<tr><td>${escape(name)}</td><td>${number(absorbing.visits[i], 3)}</td></tr>`).join("")}</tbody></table>
    <h3>Crossings until absorption</h3><table class="study-table"><thead><tr><th>Edge</th><th>Forward</th><th>Backward</th><th>Net = hat</th></tr></thead><tbody>${absorbing.crossings.map((edge) => `<tr><td>${escape(edge.treat1)} → ${escape(edge.treat2)}</td><td>${number(edge.forward, 3)}</td><td>${number(edge.backward, 3)}</td><td>${number(edge.net, 3)}</td></tr>`).join("")}</tbody></table><p class="inspector-note">The initial placement counts as a visit; the final arrival at the absorbing treatment does not. These expectations use the complete absorbing chain, not just the displayed animation steps. Davies et al. (2022), supplement F to G.</p></section>`;
  const current = solver.history[state.options.solverFull === "true" ? solver.history.length - 1 : Math.min(step, solver.history.length - 1)];
  const hats = model.rows.map((row, r) => {
    const i = model.index.get(row.treat1), j = model.index.get(row.treat2);
    return model.w[r] * (current.M[a][i] - current.M[a][j] - current.M[b][i] + current.M[b][j]);
  });
  return `<header class="inspector-head"><span class="inspector-kind">Iterative NMA solver</span><h2>Build the estimate</h2></header>
    <dl class="estimates"><div><dt>At step ${current.step}</dt><dd>${effect(current.TE[a][b], null, context.measure)}</dd></div><div><dt>Exact network estimate</dt><dd>${effect(model.TE[a][b], null, context.measure)}</dd></div><div><dt>Transition remainder</dt><dd>${current.residual.toExponential(3)}</dd></div></dl>
    <p class="inspector-note">${current.residual <= solver.tolerance ? "Converged to tolerance." : "Not converged to tolerance (1e-10). A step limit is not a convergence claim."} The geometric sum constructs the covariance C, hat matrix H = CW, and estimates H y without a matrix inverse. Ruecker et al. (2026), equations 3 and 4 and section 3.3.1.</p>
    <button type="button" class="deck-button" data-option="solverFull" data-value="${state.options.solverFull === "true" ? "false" : "true"}">${state.options.solverFull === "true" ? "Return to animation steps" : "Solve to tolerance (up to 2000 steps)"}</button>
    <table class="study-table"><thead><tr><th>Step</th><th>Estimate</th><th>Remainder</th></tr></thead><tbody>${solver.history.filter((row) => [0, 1, 2, 3, 5, 8, 13, 22].includes(row.step) || row.step === current.step).map((row) => `<tr><td>${row.step}</td><td>${effect(row.TE[a][b], null, context.measure)}</td><td>${row.residual.toExponential(2)}</td></tr>`).join("")}</tbody></table>
    <h3>Iterative hat row at step ${current.step}</h3><table class="study-table"><thead><tr><th>Study contrast</th><th>Coefficient</th></tr></thead><tbody>${model.rows.map((row, r) => `<tr><td>${escape(row.studlab)}: ${escape(row.treat1)} → ${escape(row.treat2)}</td><td>${number(hats[r], 4)}</td></tr>`).join("")}</tbody></table>`;
}
