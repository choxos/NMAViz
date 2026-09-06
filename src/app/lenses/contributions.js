/* Contributions.
 *
 * The flow lens says how much evidence travels along each comparison; this one
 * says how much of the estimate each comparison is responsible for, which is
 * not the same thing, because a long route uses several comparisons and the
 * credit has to be shared among them.
 *
 * Two published methods are shown together rather than one being chosen for the
 * reader. They usually agree closely, and where they do not, that disagreement
 * is itself the finding: it means several routes of the same length were
 * available and the shortest path method had to pick one.
 *
 * The second table pushes the same arithmetic down to individual studies, by
 * splitting each comparison's contribution among the studies on it in
 * proportion to their weights. That is the question a reader usually has:
 * not which comparison, but which trial.
 */

import {
  randomWalkContributions,
  shortestPathContributions,
} from "../../nma/contributions.js";
import { evidenceFlow } from "../../nma/flow.js";
import { escape, percent } from "../ui.js";
import { arc, contrastEmphasis, drawNodes, scaleBetween } from "./draw.js";

function studyShares(model, contributions) {
  const shares = [];
  for (const edge of model.direct) {
    const share = contributions.get(`${edge.treat1} ${edge.treat2}`) ?? 0;
    if (share <= 1e-9) continue;
    const total = edge.rows.reduce((s, r) => s + 1 / r.seTE ** 2, 0);
    for (const row of edge.rows)
      shares.push({
        studlab: row.studlab,
        comparison: `${edge.treat1} vs ${edge.treat2}`,
        share: (share * (1 / row.seTE ** 2)) / total,
      });
  }
  return shares.sort((a, b) => b.share - a.share);
}

function bar(label, primary, secondary, scale) {
  const spread = Math.abs(primary - secondary) > 0.005;
  return `
    <div class="contribution">
      <div class="contribution-label">${label}</div>
      <div class="contribution-track">
        <div class="contribution-fill" style="width:${(100 * primary) / scale}%"></div>
        ${
          spread
            ? `<div class="contribution-tick" style="left:${
                (100 * secondary) / scale
              }%" title="Random walk: ${percent(secondary, 1)}"></div>`
            : ""
        }
      </div>
      <div class="contribution-value">${percent(primary, 1)}</div>
    </div>`;
}

function inspector(context, shortest, walk) {
  const { model, state } = context;
  const rows = model.direct
    .map((edge) => ({
      key: `${edge.treat1} ${edge.treat2}`,
      label: `${escape(edge.treat1)} <span class="hop">vs</span> ${escape(edge.treat2)}`,
      shortest: shortest.get(`${edge.treat1} ${edge.treat2}`) ?? 0,
      walk: walk.get(`${edge.treat1} ${edge.treat2}`) ?? 0,
    }))
    .filter((r) => r.shortest > 1e-9 || r.walk > 1e-9)
    .sort((a, b) => b.shortest - a.shortest);

  const scale = Math.max(...rows.map((r) => Math.max(r.shortest, r.walk)), 0.01);
  const disagreement = rows.reduce((s, r) => s + Math.abs(r.shortest - r.walk), 0) / 2;

  const studies = studyShares(model, shortest).slice(0, 10);
  const studyScale = Math.max(...studies.map((s) => s.share), 0.01);

  return `
    <header class="inspector-head">
      <span class="inspector-kind">Contributions</span>
      <h2>${escape(state.contrast.treat1)} <span class="versus">vs</span> ${escape(
        state.contrast.treat2
      )}</h2>
      <p class="inspector-scale">
        ${rows.length} of ${model.direct.length} comparisons contribute anything at all.
      </p>
    </header>

    <section class="inspector-section">
      <h3>By comparison</h3>
      <div class="contributions">${rows
        .map((r) => bar(r.label, r.shortest, r.walk, scale))
        .join("")}</div>
      <p class="inspector-note">
        Bars are the shortest path method. A tick marks the random walk answer where the two
        differ by more than half a percentage point; together they disagree about
        ${percent(disagreement, 1)} of the estimate.
      </p>
    </section>

    <section class="inspector-section">
      <h3>By study</h3>
      <div class="contributions">${studies
        .map((s) =>
          bar(
            `${escape(s.studlab)} <span class="hop">${escape(s.comparison)}</span>`,
            s.share,
            s.share,
            studyScale
          )
        )
        .join("")}</div>
      <p class="inspector-note">
        Each comparison's contribution divided among the studies on it, in proportion to their
        weights. This is what "which trials is this estimate resting on" means.
      </p>
    </section>
  `;
}

export const contributions = {
  id: "contributions",
  name: "Contributions",
  tagline: "Which comparisons, and which trials, the estimate rests on",
  reference:
    "Davies AL, Papakonstantinou T, Nikolakopoulou A, Ruecker G, Galla T. Network meta-analysis and random walks. Stat Med. 2022;41(12):2091-2114.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 18V9M10 18V5M16 18v-6M22 18H2"/></svg>',

  draw(context) {
    const { model, points, state } = context;
    if (!state.contrast) return { stage: "", inspector: "", note: "" };

    const flow = evidenceFlow(model, state.contrast.treat1, state.contrast.treat2);
    const shortest = shortestPathContributions(flow);
    const walk = randomWalkContributions(flow, model.treatments.length);
    const largest = Math.max(...shortest.values(), 1e-9);

    const edges = model.direct
      .map((edge) => {
        const key = `${edge.treat1} ${edge.treat2}`;
        const share = shortest.get(key) ?? 0;
        const a = points[model.index.get(edge.treat1)];
        const b = points[model.index.get(edge.treat2)];
        const carrying = share > 1e-6;
        return `
          <g class="contribution-edge${carrying ? "" : " idle"}" data-edge="${escape(key)}">
            <title>${escape(edge.treat1)} vs ${escape(edge.treat2)}: ${percent(share, 1)}</title>
            <path d="${arc(a, b)}" stroke-width="${
              carrying ? scaleBetween(share, 0, largest, 1.8, 13).toFixed(2) : "1"
            }"/>
          </g>`;
      })
      .join("");

    return {
      stage: `<g class="contribution-edges">${edges}</g><g class="nodes">${drawNodes(context, {
        emphasis: contrastEmphasis(state),
      })}</g>`,
      inspector: inspector(context, shortest, walk),
      note: `Line width is the share of the ${escape(state.contrast.treat1)} versus ${escape(
        state.contrast.treat2
      )} estimate that each comparison is responsible for. The shares add to one.`,
    };
  },
};
