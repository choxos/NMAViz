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

import { diffusionMass, diffusionPartials, varianceFrom } from "../../nma/diffusion.js";
import { effect, escape, number, onScale, percent } from "../ui.js";
import { arc, contrastEmphasis, drawNodes, hit, nodeRadii, scaleBetween } from "./draw.js";

const STEPS = 22;

// Recomputing the whole series on every animation frame would be wasteful, and
// nothing in it changes while the data and the model do not.
let cache = { key: null, partials: null, mass: null };

function series(context) {
  const { model, state, dataset } = context;
  const key = `${dataset?.id}|${state.model}|${state.contrast?.treat1}`;
  if (cache.key !== key) {
    cache = {
      key,
      partials: diffusionPartials(model, STEPS),
      mass: diffusionMass(model, state.contrast.treat1, STEPS),
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
        <dt>Accounted for so far</dt>
        <dd>${Number.isFinite(se) ? effect(TE, se, measure) : "not yet defined"}</dd>
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
        far the evidence had to travel, not a sequence of better and better estimates.
      </p>
    </section>
  `;
}

export const diffusionLens = {
  // Draws the treatments where the shared arrangement puts them, so the
  // reader can pick one up and move it.
  spatial: true,
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

    const { partials, mass } = series(context);
    // The walk runs on its own until the reader takes hold of it, at which
    // point they own the clock: a process worth watching is a process worth
    // stopping in the middle of.
    const held = state.options.walk;
    // Hold on the settled picture for a moment before starting again, so the
    // loop reads as a process that finishes rather than a spinner.
    const cycle = STEPS + 8;
    const step =
      held == null ? Math.min(STEPS, frame % cycle) : Math.max(0, Math.min(STEPS, Number(held)));
    const here = mass[step];
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

    const edges = model.direct
      .map((edge) => {
        const a = points[model.index.get(edge.treat1)];
        const b = points[model.index.get(edge.treat2)];
        return `<g class="diffusion-edge" data-edge="${escape(
          `${edge.treat1} ${edge.treat2}`
        )}">${hit(arc(a, b))}<path d="${arc(a, b)}"/></g>`;
      })
      .join("");

    return {
      stage: `<g class="diffusion-edges">${edges}</g><g class="diffusion-halos">${halo}</g>
        <g class="nodes">${drawNodes(context, { emphasis: contrastEmphasis(state), radii })}</g>`,
      inspector: inspector(context, step, partials),
      controls: `
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
          <span class="console-label">Variance explained</span>
          <span class="deck-reading">${percent(
            partials[step] / (partials[partials.length - 1] || 1),
            1
          )}</span>
        </div>`,
      note: `A walker released at ${escape(state.contrast.treat1)}, ${step} ${
        step === 1 ? "step" : "steps"
      } in. Half the mass stays behind at each step, which is what makes the series converge on a network with no loop of odd length.`,
    };
  },
};
