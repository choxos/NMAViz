/* Reconstruction.
 *
 * Every other view says which studies matter. This one says what each of them
 * did: a signed amount, in the units of the outcome, that adds up to the
 * network estimate with nothing left over. The bars are a waterfall, so the
 * running total walks across the effect axis one trial at a time and lands
 * exactly on the estimate the model reports. If it did not land there, the
 * arithmetic would be wrong, and a reader can see that it does.
 *
 * The panel beside it is the tension plot: the direct part, the indirect part,
 * and the network estimate that sits between them, with the covariance between
 * the two kept, because a multi-arm trial can feed both at once.
 */

import { studyContributions } from "../../nma/projection.js";
import { effect, escape, isRatio, number, onScale, percent, shortLabel } from "../ui.js";

/* The label hangs from the left end of the interval, which on a narrow panel
 * puts the end of it past the right edge of the drawing. There is no measuring
 * of text here, so the width is estimated from the count of characters at the
 * size the stylesheet sets, and the label is pushed back until it fits. */
function tensionRow(label, estimate, seTE, measure, x, bounds, y, emphasis = "") {
  if (!Number.isFinite(estimate)) return "";
  const lower = x(estimate - 1.96 * seTE);
  const upper = x(estimate + 1.96 * seTE);
  const printed = label.length * 5.8;
  const at = Math.max(4, Math.min(lower, bounds.right - printed));
  return `
    <g class="tension ${emphasis}">
      <line x1="${lower.toFixed(1)}" y1="${y}" x2="${upper.toFixed(1)}" y2="${y}"/>
      <circle cx="${x(estimate).toFixed(1)}" cy="${y}" r="5"/>
      <text x="${at.toFixed(1)}" y="${y - 12}">${escape(label)}</text>
    </g>`;
}

export const reconstruction = {
  separates: "The reconstruction draws treatments, not comparisons.",
  id: "reconstruction",
  name: "Reconstruction",
  tagline: "What each trial did to this estimate, adding up to the estimate",
  reference:
    "Wang C, Zhang Y, Jin Z, O'Connor A. Contrast-space projection for network meta-analysis: an exact and invariant study-based decomposition of direct and indirect contributions. 2026.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 19h4v-5H3zM10 19h4V8h-4zM17 19h4v-9h-4z"/></svg>',

  draw(context) {
    const { model, state, measure, width, height, dataset } = context;
    if (!state.contrast) return { stage: "", inspector: "", note: "" };
    const { treat1, treat2 } = state.contrast;

    const projection = studyContributions(model, treat1, treat2);
    // The tension plot needs the bottom of the window, so only as many trials
    // are drawn as fit above it; the rest are gathered into one bar. The list
    // is sorted by size, so what is dropped is always what moved the estimate
    // least.
    const top = Math.max(46, Math.min(132, height * 0.19));
    // The tension block sits at the foot of the drawing and the waterfall takes
    // what is left above it. On a short panel the block is given a share rather
    // than a fixed 208 pixels, which used to leave it above the first bar.
    const tensionTop = height - Math.max(96, Math.min(208, height * 0.3));
    // What is actually left between the top of the walk and the tension block,
    // not a floor of 120 that the panel may not have: claiming space that is
    // not there is what put the caption across the first tension label.
    const available = Math.max(60, tensionTop - top - 70);
    const capacity = Math.max(3, Math.min(18, Math.floor(available / 26)));
    const shown = projection.studies.slice(0, capacity);
    const rest = projection.studies.slice(capacity);
    const restTotal = rest.reduce((s, r) => s + r.contribution, 0);

    const steps = [
      ...shown.map((study) => ({
        label: study.studlab,
        amount: study.contribution,
        study,
      })),
      ...(rest.length
        ? [{ label: `${rest.length} further studies`, amount: restTotal, study: null }]
        : []),
    ];

    // The waterfall runs left to right across the effect axis; the running
    // total after the last step is the network estimate itself.
    let running = 0;
    const walk = steps.map((step) => {
      const from = running;
      running += step.amount;
      return { ...step, from, to: running };
    });

    const estimate = projection.total;
    const bounds = walk.flatMap((s) => [s.from, s.to]).concat([0, estimate]);
    const low = Math.min(...bounds);
    const high = Math.max(...bounds);
    const pad = (high - low || 1) * 0.16;

    // A column down the left for the pair each bar belongs to, sized to the
    // drawing rather than to the panels that used to float over it.
    const labelColumn = Math.max(78, width * 0.22);
    const left = labelColumn + Math.max(40, width * 0.1);
    const right = width - Math.max(40, width * 0.11);
    const x = (value) => left + ((value - (low - pad)) / (high - low + 2 * pad)) * (right - left);

    const gap = Math.min(28, available / Math.max(1, walk.length));
    const zero = x(0);
    // The names end where the bars begin, so what fits is whatever the column
    // to the left of that holds at the size the stylesheet sets.
    const nameRoom = Math.max(6, Math.floor((left - 14) / 5.6));

    const bars = walk
      .map((step, index) => {
        const y = top + index * gap;
        const from = x(step.from);
        const to = x(step.to);
        const rising = step.amount >= 0;
        return `
          <g class="waterfall ${rising ? "up" : "down"}">
            <title>${escape(step.label)}: ${rising ? "raised" : "lowered"} the estimate by ${number(
              Math.abs(step.amount),
              4
            )}</title>
            <line class="waterfall-carry" x1="${from.toFixed(1)}" y1="${y - gap / 2}" x2="${from.toFixed(
              1
            )}" y2="${y}"/>
            <rect x="${Math.min(from, to).toFixed(1)}" y="${(y - 6).toFixed(1)}"
              width="${Math.max(1.4, Math.abs(to - from)).toFixed(1)}" height="12" rx="2.5"/>
            <text class="waterfall-label" x="${(left - 10).toFixed(1)}" y="${y}"
              dominant-baseline="middle">${escape(shortLabel(step.label, nameRoom))}</text>
          </g>`;
      })
      .join("");

    const finalY = top + walk.length * gap + 24;
    // The caption belongs under the last bar of the walk, but a panel short
    // enough that the bars and the tension plot are competing for the same
    // band would otherwise print it across the first tension label.
    const captionY = Math.max(
      top + (walk.length - 1) * gap + 22,
      Math.min(finalY + 30, tensionTop - 24)
    );

    // A caption centered on the total runs off the drawing when the total sits
    // near one end of the axis, which on a panel means the last few characters
    // are simply cut off. Near an edge it hangs from that edge instead.
    const totalLabelAnchor =
      x(estimate) > right - 92 ? "end" : x(estimate) < left + 92 ? "start" : "middle";
    const totalLabelAt = Math.min(right, Math.max(left, x(estimate)));

    const scaleLabel = (value) =>
      number(onScale(value, measure), isRatio(measure) ? 2 : 3);

    const axis = `
      <g class="spring-axis">
        <line x1="${zero}" y1="${top - 26}" x2="${zero}" y2="${(captionY + 12).toFixed(1)}"/>
        <text x="${zero}" y="${top - 34}" text-anchor="middle">${
          isRatio(measure) ? "1" : "0"
        }, where the walk starts</text>
      </g>
      <g class="waterfall-total">
        <line x1="${x(estimate).toFixed(1)}" y1="${top - 20}" x2="${x(estimate).toFixed(
          1
        )}" y2="${(captionY - 20).toFixed(1)}"/>
        <text x="${totalLabelAt.toFixed(1)}" y="${captionY.toFixed(1)}" text-anchor="${
          totalLabelAnchor
        }">the network estimate, ${scaleLabel(estimate)}</text>
      </g>`;

    // The tension plot: direct, indirect, and the network estimate between them.
    const tensionValues = [
      projection.direct.estimate,
      projection.indirect.estimate,
      estimate,
    ].filter(Number.isFinite);
    const tensionSpread = Math.max(
      ...[projection.direct, projection.indirect].map((p) =>
        Number.isFinite(p.seTE) ? 1.96 * p.seTE : 0
      ),
      1e-9
    );
    const tensionLow = Math.min(...tensionValues) - tensionSpread * 1.2;
    const tensionHigh = Math.max(...tensionValues) + tensionSpread * 1.2;
    const tx = (value) =>
      left + ((value - tensionLow) / (tensionHigh - tensionLow || 1)) * (right - left);
    const tensionGap = 38;

    const tension = `
      ${tensionRow(
        `Direct, ${percent(projection.direct.weight, 0)} of the weight`,
        projection.direct.estimate,
        projection.direct.seTE,
        measure,
        tx,
        { left, right },
        tensionTop
      )}
      ${tensionRow(
        `Indirect, ${percent(projection.indirect.weight, 0)} of the weight`,
        projection.indirect.estimate,
        projection.indirect.seTE,
        measure,
        tx,
        { left, right },
        tensionTop + tensionGap
      )}
      ${tensionRow(
        "Network",
        estimate,
        model.seTE[model.index.get(treat1)][model.index.get(treat2)],
        measure,
        tx,
        { left, right },
        tensionTop + 2 * tensionGap,
        "network"
      )}`;

    const rows = shown
      .map(
        (study) => `
        <tr>
          <td>${escape(study.studlab)}${
            study.arms.length > 2 ? ` <span class="hop">${study.arms.length} arms</span>` : ""
          }</td>
          <td class="numeric ${study.contribution >= 0 ? "up" : "down"}">${number(
            study.contribution,
            4
          )}</td>
          <td class="numeric">${percent(study.directWeight, 0)}</td>
        </tr>`
      )
      .join("");

    const difference = projection.direct.estimate - projection.indirect.estimate;
    const z = Number.isFinite(projection.seDifference)
      ? difference / projection.seDifference
      : NaN;

    const inspector = `
      <header class="inspector-head">
        <span class="inspector-kind">Reconstruction</span>
        <h2>${escape(treat1)} <span class="versus">vs</span> ${escape(treat2)}</h2>
        <p class="inspector-scale">${escape(dataset?.outcome ?? "Effect")}</p>
      </header>

      <dl class="estimates">
        <div>
          <dt>Direct part</dt>
          <dd>${effect(projection.direct.estimate, projection.direct.seTE, measure)}</dd>
        </div>
        <div>
          <dt>Indirect part</dt>
          <dd>${effect(projection.indirect.estimate, projection.indirect.seTE, measure)}</dd>
        </div>
        <div>
          <dt>They differ by</dt>
          <dd>${
            Number.isFinite(z)
              ? `${number(difference, 3)} (z = ${number(z, 2)})`
              : "only one part carries weight"
          }</dd>
        </div>
        <div>
          <dt>Adds back to</dt>
          <dd>${number(projection.total, 6)}</dd>
        </div>
      </dl>

      <section class="inspector-section">
        <h3>Canonical route ledger</h3>
        <p class="inspector-note">Direct evidence is allocated first. Remaining treatment balances use the largest feasible transfer; study-labelled routes are then extracted by largest bottleneck, with fixed label ordering for ties.</p>
        <p>${projection.paths.length} indirect routes · ${percent(projection.indirect.weight, 1)} total weight</p>
        ${projection.paths.map((path, i) => `<details>
          <summary>Route ${i + 1}: ${percent(path.weight, 1)} · contribution ${number(path.contribution, 4)}</summary>
          <ol>${path.edges.map(edge => `<li>${escape(edge.from)} → ${escape(edge.to)} · ${escape(edge.studlab)}: ${number(edge.estimate, 4)}</li>`).join("")}</ol>
          <p class="inspector-note">Route contrast ${number(path.estimate, 4)} × weight ${number(path.weight, 4)} = ${number(path.contribution, 4)} on the analysis scale.</p>
        </details>`).join("")}
        <p class="inspector-note">${projection.pathResidual < 1e-8 ? "All residual study-edge coefficients exhausted." : `Unexhausted residual coefficient: ${projection.pathResidual.toExponential(3)}. Complete path decomposition is unavailable for this covariance geometry.`}</p>
        <p class="inspector-note">Direct plus route sum: ${number(projection.canonicalTotal, 8)}.
          Effect reconstruction residual (network minus this sum): ${projection.effectResidual.toExponential(3)} on the analysis scale.
          ${Math.abs(projection.effectResidual) <= 1e-10 * Math.max(1, Math.abs(projection.total), Math.abs(projection.canonicalTotal)) ? "The effect sum agrees within numerical precision." : "These routes do not exactly reconstruct the fitted effect; rounded within-study nonclosure or unexhausted edges leave the reported residual."}
        </p>
      </section>

      <section class="inspector-section">
        <h3>What each trial did</h3>
        <table class="study-table">
          <thead><tr><th>Study</th><th class="numeric">Moved it by</th><th class="numeric">Direct</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="inspector-note">
          Signed amounts on the analysis scale, not percentages: they add to the estimate itself.
          The last column is how much of a trial's contribution ran along the
          ${escape(treat1)} against ${escape(treat2)} comparison rather than round through the
          network.
        </p>
        <p class="inspector-note">
          The direct and indirect parts are correlated whenever one multi-arm trial feeds both,
          and the difference above keeps that covariance. It is a description of where the two
          halves of the evidence sit, not a test of inconsistency.
        </p>
      </section>
    `;

    return {
      stage: `${axis}<g class="waterfalls">${bars}</g><g class="tensions">${tension}</g>`,
      inspector,
      note: `Each bar is one trial's signed contribution. The running total walks to the network estimate and stops there, with nothing left over.`,
    };
  },
};
