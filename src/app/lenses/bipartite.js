/* Trials and treatments.
 *
 * The usual network drawing has one kind of node and cannot say what a trial
 * is. A three-arm trial appears as three separate edges, indistinguishable from
 * three separate two-arm trials, although the two situations carry different
 * information and different correlations. Davies (2026) fixes that by giving
 * trials nodes of their own: the graph becomes bipartite, treatments on one
 * side and trials on the other, and an edge is an arm.
 *
 * Drawn that way, a multi-arm trial is a single object touching three or more
 * treatments, the designs of the network are visible as repeated shapes, and
 * the reader can see that a comparison rests on four trials rather than on four
 * independent pieces of evidence. This is also Senn's reading of a network as
 * an incomplete block design: the trials are the blocks, and what the network
 * can identify depends on which treatments the blocks happen to contain.
 */

import { studyContributions } from "../../nma/projection.js";
import { effect, escape, number, percent, shortLabel } from "../ui.js";
import { contrastEmphasis, drawNodes, nodeRadii, scaleBetween } from "./draw.js";
import { sensitivityOf } from "../state.js";

/* Trials grouped by the set of treatments they compare. Two trials with the
 * same set have the same design, in the sense of the design-by-treatment
 * literature, and are drawn as a cluster. */
export function designs(model) {
  const byStudy = new Map();
  model.rows.forEach((row, index) => {
    if (!byStudy.has(row.studlab)) byStudy.set(row.studlab, []);
    byStudy.get(row.studlab).push(index);
  });

  const grouped = new Map();
  for (const [studlab, indices] of byStudy) {
    const arms = [...new Set(indices.flatMap((i) => [model.rows[i].treat1, model.rows[i].treat2]))]
      .sort((a, b) => a.localeCompare(b, "en"));
    const key = arms.join(" · ");
    if (!grouped.has(key)) grouped.set(key, { key, arms, trials: [] });
    grouped.get(key).trials.push({
      studlab,
      arms,
      indices,
      weight: indices.reduce((s, i) => s + model.w[i], 0),
    });
  }
  return [...grouped.values()].sort((a, b) => b.trials.length - a.trials.length);
}

/* The two results, side by side, with the original first. */
function sensitivityPanel(context, check) {
  if (!check) return "";
  const { state, measure } = context;
  const names = state.excluded.join(", ");

  if (check.error)
    return `
      <section class="inspector-section sensitivity broken">
        <h3>Without ${escape(names)}</h3>
        <p class="inspector-note">
          ${escape(check.error)} Leaving ${
            state.excluded.length === 1 ? "that trial" : "those trials"
          } out does not widen this estimate, it removes it: there is no longer a chain of
          comparisons connecting every treatment, so no network estimate exists at all.
        </p>
      </section>`;

  if (!check.full || !check.without) return "";
  const widened = check.without.seTE / check.full.seTE;
  const moved = Math.abs(check.without.TE - check.full.TE) / check.full.seTE;

  return `
    <section class="inspector-section sensitivity">
      <h3>With and without ${escape(names)}</h3>
      <dl class="estimates">
        <div>
          <dt>All trials</dt>
          <dd>${effect(check.full.TE, check.full.seTE, measure)}</dd>
        </div>
        <div>
          <dt>Without ${state.excluded.length === 1 ? "it" : "them"}</dt>
          <dd>${effect(check.without.TE, check.without.seTE, measure)}</dd>
        </div>
      </dl>
      <p class="inspector-note">
        The standard error ${
          widened >= 1 ? "grows" : "shrinks"
        } by a factor of ${number(widened, 2)}, and the estimate moves
        ${number(moved, 2)} of its own standard errors. A trial that carries a lot of current is
        not automatically a trial whose removal matters: those are different quantities, and this
        is the one that answers what happens if it is not there.
      </p>
    </section>`;
}

/* Where excluded trials sit. Bottom left of the clear area, out of the way of
 * the network and never over it. */
function trayBox(box) {
  const width = Math.min(300, (box.right - box.left) * 0.42);
  const height = 78;
  return { x: box.left + 4, y: box.bottom - height, width, height };
}

export const bipartite = {
  // The tray is a control that changes the evidence, so the canvas leaves
  // room for the deck that reports what it did.
  deck: true,
  // Draws the treatments where the shared arrangement puts them, so the
  // reader can pick one up and move it.
  spatial: true,
  id: "bipartite",
  name: "Trials",
  tagline: "Trials as nodes, so a multi-arm trial is one object",
  reference:
    "Davies AL. The bipartite structure of treatment-trial networks reveals the flow of information in network meta-analysis. J R Stat Soc Ser A. 2026.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><rect x="16" y="4" width="4" height="4" rx="1"/><rect x="16" y="16" width="4" height="4" rx="1"/><path d="M7 6.6 16 7M7 17.4 16 17M7 7.4l9 9.2"/></svg>',

  draw(context) {
    const { model, points, state } = context;
    const groups = designs(model);
    const radii = nodeRadii(model);

    // Which trials moved the comparison of interest, and by how much, so the
    // reader can see the multi-arm structure and its influence at once.
    const projection = state.contrast
      ? studyContributions(model, state.contrast.treat1, state.contrast.treat2)
      : null;
    const influence = new Map(
      projection?.studies.map((s) => [s.studlab, Math.abs(s.contribution)]) ?? []
    );
    const strongest = Math.max(...influence.values(), 1e-9);

    // A trial sits at the middle of the treatments it compares. Trials of the
    // same design would land on the same point, so they are fanned around it,
    // which is what makes a repeated design read as a cluster.
    const placed = [];
    for (const group of groups) {
      const center = group.arms.reduce(
        (sum, arm) => {
          const p = points[model.index.get(arm)];
          return { x: sum.x + p.x / group.arms.length, y: sum.y + p.y / group.arms.length };
        },
        { x: 0, y: 0 }
      );
      const spread = 9 + 5 * Math.sqrt(group.trials.length) + 30 * state.separation;
      group.trials.forEach((trial, index) => {
        const angle = (2 * Math.PI * index) / Math.max(1, group.trials.length) - Math.PI / 2;
        const distance = group.trials.length === 1 ? 0 : spread;
        placed.push({
          ...trial,
          design: group.key,
          x: center.x + Math.cos(angle) * distance,
          y: center.y + Math.sin(angle) * distance,
        });
      });
    }

    const weights = placed.map((t) => t.weight);
    const arms = placed
      .flatMap((trial) =>
        trial.arms.map((arm) => {
          const p = points[model.index.get(arm)];
          return `<line class="arm${trial.arms.length > 2 ? " multi" : ""}"
            x1="${trial.x.toFixed(1)}" y1="${trial.y.toFixed(1)}"
            x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`;
        })
      )
      .join("");

    const left = new Set(state.excluded);
    const sizeOf = (trial) =>
      scaleBetween(
        Math.sqrt(trial.weight),
        Math.sqrt(Math.min(...weights)),
        Math.sqrt(Math.max(...weights)),
        5,
        13
      );

    const trialNodes = placed
      .filter((trial) => !left.has(trial.studlab))
      .map((trial) => {
        const size = sizeOf(trial);
        const share = (influence.get(trial.studlab) ?? 0) / strongest;
        const carried =
          context.carrying?.kind === `trial:${trial.studlab}` && context.carrying.at
            ? {
                x: context.box.left + context.carrying.at.u * (context.box.right - context.box.left),
                y: context.box.top + context.carrying.at.v * (context.box.bottom - context.box.top),
              }
            : null;
        const x = carried?.x ?? trial.x;
        const y = carried?.y ?? trial.y;
        return `
          <g class="trial${trial.arms.length > 2 ? " multi" : ""}${
            carried ? " lifted" : ""
          }" data-study="${escape(trial.studlab)}" data-prop="trial:${escape(trial.studlab)}">
            <circle class="hit-node" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14"/>
            <rect x="${(x - size / 2).toFixed(1)}" y="${(y - size / 2).toFixed(1)}"
              width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="2.5"
              opacity="${(0.35 + 0.65 * share).toFixed(3)}"/>
          </g>`;
      })
      .join("");

    // The tray. A trial dropped into it comes out of the analysis, which is
    // refitted without it; a trial dragged back out goes in again. It is the
    // one control on this site that changes the evidence, so it is drawn as a
    // separate place with a lid on it rather than as a control among controls.
    const tray = trayBox(context.box);
    const shelved = placed
      .filter((trial) => left.has(trial.studlab))
      .map((trial, i) => {
        const perRow = Math.max(1, Math.floor((tray.width - 22) / 26));
        const size = sizeOf(trial);
        const x = tray.x + 18 + (i % perRow) * 26;
        const y = tray.y + 26 + Math.floor(i / perRow) * 24;
        return `
          <g class="trial shelved" data-study="${escape(trial.studlab)}" data-prop="trial:${escape(
            trial.studlab
          )}">
            <circle class="hit-node" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14"/>
            <rect x="${(x - size / 2).toFixed(1)}" y="${(y - size / 2).toFixed(1)}"
              width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="2.5"/>
          </g>`;
      })
      .join("");

    const trayMarkup = `
      <g class="tray${left.size ? " loaded" : ""}${
        context.carrying?.kind?.startsWith("trial:") ? " open" : ""
      }">
        <rect class="tray-body" x="${tray.x}" y="${tray.y}" width="${tray.width}" height="${
          tray.height
        }" rx="10"/>
        <text class="tray-label" x="${tray.x + 12}" y="${tray.y + 15}">${
          left.size
            ? `Left out: ${left.size} ${left.size === 1 ? "trial" : "trials"}`
            : "Drag a trial here to leave it out"
        }</text>
        ${shelved}
      </g>`;

    const multiArm = placed.filter((t) => t.arms.length > 2);
    const rows = groups
      .slice(0, 12)
      .map(
        (group) => `
        <tr>
          <td>${group.arms.map((a) => escape(shortLabel(a, 14))).join(" <span class='hop'>·</span> ")}</td>
          <td class="numeric">${group.trials.length}</td>
        </tr>`
      )
      .join("");

    const influential = projection
      ? projection.studies
          .slice(0, 8)
          .map(
            (study) => `
        <tr>
          <td>${escape(study.studlab)}${
            study.arms.length > 2 ? ` <span class="hop">${study.arms.length} arms</span>` : ""
          }</td>
          <td class="numeric">${number(study.contribution, 4)}</td>
        </tr>`
          )
          .join("")
      : "";

    const inspector = `
      <header class="inspector-head">
        <span class="inspector-kind">Trials and designs</span>
        <h2>${model.rows.length ? new Set(model.rows.map((r) => r.studlab)).size : 0} trials,
          ${groups.length} designs</h2>
        <p class="inspector-scale">${multiArm.length} ${
          multiArm.length === 1 ? "trial compares" : "trials compare"
        } more than two treatments</p>
      </header>

      <section class="inspector-section">
        <h3>Designs</h3>
        <table class="study-table">
          <thead><tr><th>Treatments compared</th><th class="numeric">Trials</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${
          groups.length > 12
            ? `<p class="inspector-note">${groups.length - 12} further designs.</p>`
            : ""
        }
        <p class="inspector-note">
          A design is the set of treatments a trial compares. Read this way the network is an
          incomplete block design: the trials are the blocks, and what can be identified depends
          on which treatments happen to share a block, not on how many trials there are.
        </p>
      </section>

      ${
        projection
          ? `<section class="inspector-section">
               <h3>Trials moving ${escape(state.contrast.treat1)} against ${escape(
                 state.contrast.treat2
               )}</h3>
               <table class="study-table">
                 <thead><tr><th>Trial</th><th class="numeric">Moved it by</th></tr></thead>
                 <tbody>${influential}</tbody>
               </table>
               <p class="inspector-note">
                 Trial squares are shaded by how far they moved this comparison. A multi-arm trial
                 is drawn once, with an arm to each of its treatments, so it is visible as the
                 single correlated object it is.
               </p>
             </section>`
          : ""
      }
    `;

    // What leaving those trials out did to the comparison being looked at. The
    // original stays on screen beside it: a sensitivity analysis that replaces
    // the result rather than sitting next to it is a way to lose track of which
    // number is which.
    const check = state.excluded.length ? sensitivityOf(state.contrast, state.model) : null;

    return {
      stage: `<g class="arms">${arms}</g><g class="trials">${trialNodes}</g>
        <g class="nodes">${drawNodes(context, {
          emphasis: contrastEmphasis(state),
          radii,
        })}</g>${trayMarkup}`,
      inspector: `${sensitivityPanel(context, check)}${inspector}`,
      controls: state.excluded.length
        ? `
          <div class="console-group">
            <span class="console-label">Left out</span>
            <span class="deck-reading">${state.excluded.length}</span>
            <button type="button" class="deck-button primary" data-restore="all">Put them all back</button>
          </div>
          <div class="console-group">
            <span class="console-label">${
              check?.error ? "Result" : "Standard error"
            }</span>
            <span class="deck-reading">${
              check?.error
                ? "no estimate"
                : check?.full && check?.without
                  ? `${number(check.full.seTE, 3)} → ${number(check.without.seTE, 3)}`
                  : "—"
            }</span>
          </div>`
        : "",
      note: state.excluded.length
        ? `${state.excluded.length} ${
            state.excluded.length === 1 ? "trial is" : "trials are"
          } out of the analysis. The network is refitted without ${
            state.excluded.length === 1 ? "it" : "them"
          }, tau squared included, and both results are shown.`
        : `Circles are treatments, squares are trials, and a line is an arm. Multi-arm trials touch three or more treatments at once. Drag a trial into the tray to see what the network looks like without it.`,
    };
  },
};
