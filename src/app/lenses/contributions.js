import { CONTRIBUTION_METHODS, randomWalkContributions } from "../../nma/contributions.js";
import { evidenceFlow } from "../../nma/flow.js";
import { escape, percent } from "../ui.js";
import { arc, contrastEmphasis, drawNodes, hit, scaleBetween, separable, strandsOf } from "./draw.js";

const allocationPercent = (value) => percent(value, Math.abs(value) > 1e-9 && Math.abs(value) < 0.0005 ? 4 : 1);

function studyShares(model, contributions) {
  const shares = [];
  for (const edge of model.direct) {
    const share = contributions.get(`${edge.treat1} ${edge.treat2}`) ?? 0;
    if (Math.abs(share) <= 1e-9) continue;
    const total = edge.rows.reduce((s, r) => s + 1 / r.seTE ** 2, 0);
    for (const row of edge.rows)
      shares.push({
        studlab: row.studlab,
        comparison: `${edge.treat1} vs ${edge.treat2}`,
        share: (share * (1 / row.seTE ** 2)) / total,
      });
  }
  return shares.sort((a, b) => Math.abs(b.share) - Math.abs(a.share));
}

function bar(label, primary, secondary, scale) {
  const spread = Math.abs(primary - secondary) > 0.005;
  return `
    <div class="contribution">
      <div class="contribution-label">${label}</div>
      <div class="contribution-track">
        <div class="contribution-fill" style="width:${(100 * Math.abs(primary)) / scale}%;${primary < 0 ? "background:var(--negative, #b34465)" : ""}"></div>
        ${
          spread
            ? `<div class="contribution-tick" style="left:${
                (100 * secondary) / scale
              }%" title="Random walk: ${allocationPercent(secondary)}"></div>`
            : ""
        }
      </div>
      <div class="contribution-value">${allocationPercent(primary)}</div>
    </div>`;
}

const cache = new WeakMap();

function selectedContributions(model, state, flow) {
  const method = state.options?.contributionMethod ?? "shortestpath";
  const descriptor = CONTRIBUTION_METHODS[method] ?? CONTRIBUTION_METHODS.shortestpath;
  if (!cache.has(model)) cache.set(model, new Map());
  const key = JSON.stringify([state.contrast.treat1, state.contrast.treat2, method]);
  if (!cache.get(model).has(key)) {
    try { cache.get(model).set(key, { values: descriptor.compute(flow, model.treatments.length), descriptor, method }); }
    catch (error) { cache.get(model).set(key, { values: new Map(), descriptor, method, error: error.message }); }
  }
  return cache.get(model).get(key);
}

function inspector(context, shortest, walk, selected) {
  const { model, state } = context;
  const rows = model.direct
    .map((edge) => ({
      key: `${edge.treat1} ${edge.treat2}`,
      label: `${escape(edge.treat1)} <span class="hop">vs</span> ${escape(edge.treat2)}`,
      shortest: shortest.get(`${edge.treat1} ${edge.treat2}`) ?? 0,
      walk: walk.get(`${edge.treat1} ${edge.treat2}`) ?? 0,
    }))
    .filter((r) => Math.abs(r.shortest) > 1e-9 || r.walk > 1e-9)
    .sort((a, b) => b.shortest - a.shortest);

  const scale = Math.max(...rows.map((r) => Math.max(Math.abs(r.shortest), r.walk)), 0.01);
  const disagreement = rows.reduce((s, r) => s + Math.abs(r.shortest - r.walk), 0) / 2;

  const studies = studyShares(model, shortest).slice(0, 10);
  const studyScale = Math.max(...studies.map((s) => Math.abs(s.share)), 0.01);

  return `
    <header class="inspector-head">
      <span class="inspector-kind">Contributions</span>
      <h2>${escape(state.contrast.treat1)} <span class="versus">vs</span> ${escape(
        state.contrast.treat2
      )}</h2>
      <p class="inspector-scale">
        ${selected.error ? "Allocation unavailable." : `${rows.length} of ${model.direct.length} comparisons carry an allocation under the selected rule or random walk.`}
      </p>
    </header>

    <section class="inspector-section">
      <h3>Choose the allocation rule</h3>
      <div class="pills">${Object.entries(CONTRIBUTION_METHODS).map(([id, method]) => `<button class="pill${id === selected.method ? " active" : ""}" data-option="contributionMethod" data-value="${id}" aria-pressed="${id === selected.method}">${method.label}</button>`).join("")}</div>
      <p class="inspector-note">${escape(selected.descriptor.note)}</p>
      ${selected.error ? `<p role="alert">${escape(selected.error)}</p>` : ""}
      <p class="inspector-note">L1 and L2 enumerate all directed evidence paths, with limits of 5,000 paths and 150 active edges. An exceeded limit reports an error; it never substitutes another method. L1 uses a convex solver and can differ from the paper's equally optimal cccp allocation.</p>
    </section>
    ${selected.error ? "" : `<section class="inspector-section">
      <h3>By comparison</h3>
      <div class="contributions">${rows
        .map((r) => bar(r.label, r.shortest, r.walk, scale))
        .join("")}</div>
      <p class="inspector-note">
        Bars show the magnitude of the ${escape(selected.descriptor.label)} allocation; signed values are printed alongside. Negative allocations are colored red. A tick marks the random walk answer where the two
        differ by more than half a percentage point; together they disagree about
        ${allocationPercent(disagreement)} of the estimate.
      </p>
    </section>

    <section class="inspector-section">
      <h3>Descriptive split by study</h3>
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
        original inverse-variance weights. This descriptive split is not the covariance-aware study information share; use the bipartite lens for that quantity.
      </p>
    </section>`}
  `;
}

export const contributions = {
  // Draws the treatments where the shared arrangement puts them, so the
  // reader can pick one up and move it.
  spatial: true,
  separates: true,
  id: "contributions",
  name: "Contributions",
  tagline: "Which comparisons, and which trials, the estimate rests on",
  reference:
    "Rücker G et al. Shortest path or random walks? A framework for path weights in network meta-analysis. Stat Med. 2024;43:4287-4304. Davies AL et al. Network meta-analysis and random walks. Stat Med. 2022;41:2091-2114.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 18V9M10 18V5M16 18v-6M22 18H2"/></svg>',

  /* The point of this lens is that the two published methods can disagree
   * about the same comparison, so a hover shows both at once. */
  describe(context, target) {
    if (target.kind !== "edge" || !context.state.contrast) return null;
    const { model, state } = context;
    const network = evidenceFlow(model, state.contrast.treat1, state.contrast.treat2);
    if (!network) return null;
    const selected = selectedContributions(model, state, network);
    const shortest = selected.values;
    const walk = randomWalkContributions(network, model.treatments.length);
    const edge = model.direct.find((edge) => `${edge.treat1} ${edge.treat2}` === target.id || `${edge.treat2} ${edge.treat1}` === target.id);
    if (!edge) return null;
    const { treat1, treat2 } = edge;
    const key = shortest.has(`${treat1} ${treat2}`) ? `${treat1} ${treat2}` : `${treat2} ${treat1}`;
    if (!shortest.has(key)) return null;
    const a = shortest.get(key) ?? 0;
    const b = walk.get(key) ?? 0;
    return {
      kicker: "Contribution",
      title: `${treat1} vs ${treat2}`,
      rows: [
        [selected.descriptor.label, allocationPercent(a)],
        ["Random walk", allocationPercent(b)],
      ],
      note: selected.descriptor.note,
    };
  },

  draw(context) {
    const { model, points, state } = context;
    if (!state.contrast) return { stage: "", inspector: "", note: "" };

    const flow = evidenceFlow(model, state.contrast.treat1, state.contrast.treat2);
    const selected = selectedContributions(model, state, flow);
    const shortest = selected.values;
    const walk = randomWalkContributions(flow, model.treatments.length);
    const largest = Math.max(...[...shortest.values()].map(Math.abs), 1e-9);
    const fanned = state.separation > 0.02 && separable(model);

    const edges = model.direct
      .map((edge) => {
        const key = `${edge.treat1} ${edge.treat2}`;
        const share = shortest.get(key) ?? 0;
        const a = points[model.index.get(edge.treat1)];
        const b = points[model.index.get(edge.treat2)];
        const carrying = Math.abs(share) > 1e-6;
        const stroke = (value) =>
          carrying ? scaleBetween(Math.abs(value), 0, largest, 1.8, 13).toFixed(2) : "1";
        // A comparison's contribution is divided among its studies in
        // proportion to their weights, which is the arithmetic the second
        // table below already reports. Opening the separation control puts
        // that division on the canvas: the strands of one comparison add up to
        // the line they replaced, so a comparison that owes its share to a
        // single large trial looks nothing like one carried by six small ones.
        const parallel =
          fanned && carrying
            ? strandsOf(edge, a, b, state.separation)
                .map(
                  (strand) =>
                    `<path class="contribution-strand" data-study="${escape(
                      strand.row.studlab
                    )}" d="${strand.path}" stroke-width="${stroke(share * strand.share)}"><title>${
                      escape(strand.row.studlab)
                    }: ${allocationPercent(share * strand.share)}</title></path>`
                )
                .join("")
            : "";
        return `
          <g class="contribution-edge${carrying ? "" : " idle"}${
            parallel ? " fanned" : ""
          }" data-edge="${escape(key)}">
            <title>${escape(edge.treat1)} vs ${escape(edge.treat2)}: ${allocationPercent(share)}</title>
            ${hit(arc(a, b))}
            <path d="${arc(a, b)}" stroke-width="${stroke(share)}" ${share < 0 ? 'stroke-dasharray="5 4" style="stroke:var(--negative, #b34465)"' : ""}/>
            ${parallel}
          </g>`;
      })
      .join("");

    return {
      stage: `<g class="contribution-edges">${edges}</g><g class="nodes">${drawNodes(context, {
        emphasis: contrastEmphasis(state),
      })}</g>`,
      inspector: inspector(context, shortest, walk, selected),
      note: selected.error ? escape(selected.error) : `Line width is the magnitude of the ${escape(selected.descriptor.label)} allocation to the ${escape(state.contrast.treat1)} versus ${escape(
        state.contrast.treat2
      )} estimate that each comparison is responsible for. Signed allocations add to one; negative L2 allocations are dashed and are not probabilities.${
        fanned
          ? " Each comparison is fanned into the studies on it, splitting its share by their weights."
          : ""
      }`,
    };
  },
};
