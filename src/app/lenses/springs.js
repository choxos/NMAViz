/* Springs.
 *
 * Papakonstantinou et al (2020) point out that meta-analysis is a system of
 * linear springs: a study is a spring whose natural length is its effect and
 * whose stiffness is its precision. Studies of the same comparison hang in
 * parallel, and their equilibrium is the pooled estimate; comparisons along a
 * route hang in series, and their lengths add, which is the indirect estimate.
 * Stiffnesses add in parallel and their reciprocals add in series, which is why
 * a long route is imprecise and why a comparison is only as strong as its
 * weakest link.
 *
 * This lens leaves the network map behind and draws the mechanism instead, on
 * the effect axis: the studies on the direct comparison hanging in parallel,
 * the routes through the network hanging in series, and the whole assembly
 * settling at the network estimate. A reader who has never accepted an
 * inverse-variance weight on faith can see one here.
 */

import { evidenceFlow, flowPaths } from "../../nma/flow.js";
import { effect, escape, isRatio, percent, shortLabel } from "../ui.js";

/* A coil drawn between two points on one line. More turns and a thicker wire
 * mean a stiffer spring, which is a more precise study. */
function coil(x1, x2, y, stiffness) {
  const span = x2 - x1;
  const direction = Math.sign(span) || 1;
  const length = Math.abs(span);
  const turns = Math.max(3, Math.min(18, Math.round(4 + stiffness * 14)));
  const lead = Math.min(14, length * 0.16);
  const body = Math.max(6, length - 2 * lead);
  const step = body / turns;
  const amplitude = 6;

  let d = `M${x1} ${y}L${x1 + direction * lead} ${y}`;
  for (let i = 0; i < turns; i++) {
    const start = x1 + direction * (lead + i * step);
    d += `L${start + direction * step * 0.25} ${y - amplitude}`;
    d += `L${start + direction * step * 0.75} ${y + amplitude}`;
    d += `L${start + direction * step} ${y}`;
  }
  return `${d}L${x2} ${y}`;
}

export const springs = {
  id: "springs",
  name: "Springs",
  tagline: "The mechanism: studies in parallel, routes in series",
  reference:
    "Papakonstantinou T, Nikolakopoulou A, Egger M, Salanti G. Meta-analysis as a system of springs. Res Synth Methods. 2021;12(2):176-186.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2-5 3 10 3-10 3 10 2-5h3"/></svg>',

  draw(context) {
    const { model, state, measure, width, height, dataset } = context;
    if (!state.contrast) return { stage: "", inspector: "", note: "" };
    const { treat1, treat2 } = state.contrast;
    const a = model.index.get(treat1);
    const b = model.index.get(treat2);

    const direct = model.direct.find(
      (e) =>
        (e.treat1 === treat1 && e.treat2 === treat2) ||
        (e.treat1 === treat2 && e.treat2 === treat1)
    );
    const orient = (edge, from) => (edge.treat1 === from ? 1 : -1);

    // The routes through the network, from the flow decomposition, with the
    // effect each one implies for this comparison.
    const flow = evidenceFlow(model, treat1, treat2);
    const routes = flowPaths(flow)
      .slice(0, 5)
      .map((path) => {
        let TE = 0;
        let variance = 0;
        const links = path.edges.map((step) => {
          const edge = step.comparison;
          const sign = orient(edge, step.from);
          TE += sign * edge.TE;
          variance += edge.seTE ** 2;
          return { from: step.from, to: step.to, TE: sign * edge.TE, seTE: edge.seTE };
        });
        return { ...path, TE, seTE: Math.sqrt(variance), links };
      });

    // One shared effect axis for everything drawn.
    const values = [
      model.TE[a][b],
      ...(direct ? [orient(direct, treat1) * direct.TE] : []),
      ...routes.map((r) => r.TE),
    ].filter(Number.isFinite);
    const spread = Math.max(...values.map(Math.abs), 1e-6) * 1.35;
    // The controls panel floats over the bottom left of the window, so nothing
    // in this diagram, labels included, is drawn to the left of here.
    const left = Math.max(348, width * 0.28);
    const right = width - Math.min(400, width * 0.34);
    const middle = (left + right) / 2;
    const scale = (right - left) / (2 * spread);
    const at = (value) => middle + value * scale;

    const stiffnesses = [
      ...(direct?.rows ?? []).map((r) => 1 / r.seTE ** 2),
      ...routes.map((r) => 1 / r.seTE ** 2),
    ];
    const strongest = Math.max(...stiffnesses, 1e-9);
    const relative = (se) => Math.min(1, 1 / se ** 2 / strongest);

    // Lay the mechanism out from the top: the direct studies, then the routes.
    const rows = [];
    if (direct)
      direct.rows.forEach((row) =>
        rows.push({
          kind: "study",
          label: row.studlab,
          TE: orient(direct, treat1) * row.TE,
          seTE: row.seTE,
        })
      );
    if (direct)
      rows.push({
        kind: "pooled",
        label: `Direct: ${direct.studies} in parallel`,
        TE: orient(direct, treat1) * direct.TE,
        seTE: direct.seTE,
      });
    routes.forEach((route) =>
      rows.push({
        kind: "route",
        label: route.treatments.map((t) => shortLabel(t, 10)).join(" → "),
        TE: route.TE,
        seTE: route.seTE,
        links: route.links,
        share: route.share,
      })
    );
    rows.push({
      kind: "network",
      label: "The whole network",
      TE: model.TE[a][b],
      seTE: model.seTE[a][b],
    });

    const top = 158;
    const gap = Math.min(54, (height - top - 120) / Math.max(1, rows.length));
    const nullAt = at(0);

    const axis = `
      <g class="spring-axis">
        <line x1="${nullAt}" y1="${top - 34}" x2="${nullAt}" y2="${
          top + rows.length * gap + 10
        }"/>
        <text x="${nullAt}" y="${top - 42}" text-anchor="middle">${
          isRatio(measure) ? "1" : "0"
        }, no difference</text>
        <text x="${left}" y="${top + rows.length * gap + 34}" text-anchor="start">${escape(
          treat1
        )} lower</text>
        <text x="${right}" y="${top + rows.length * gap + 34}" text-anchor="end">${escape(
          treat1
        )} higher</text>
      </g>`;

    const drawn = rows
      .map((row, index) => {
        const y = top + index * gap;
        const x = at(row.TE);
        const stiffness = relative(row.seTE);
        const lower = at(row.TE - 1.96 * row.seTE);
        const upper = at(row.TE + 1.96 * row.seTE);

        // A route is a chain of springs; everything else is a single spring
        // anchored at the no-difference line.
        let body;
        if (row.kind === "route") {
          let cursor = nullAt;
          body = row.links
            .map((link) => {
              const next = cursor + link.TE * scale;
              const path = coil(cursor, next, y, relative(link.seTE));
              const joint = `<circle class="spring-joint" cx="${next}" cy="${y}" r="3"/>`;
              cursor = next;
              return `<path class="spring-coil" d="${path}"/>${joint}`;
            })
            .join("");
        } else {
          body = `<path class="spring-coil" d="${coil(nullAt, x, y, stiffness)}"/>`;
        }

        return `
          <g class="spring-row ${row.kind}">
            <title>${escape(row.label)}: ${effect(row.TE, row.seTE, measure)}</title>
            <line class="spring-interval" x1="${lower}" y1="${y}" x2="${upper}" y2="${y}"/>
            ${body}
            <circle class="spring-end" cx="${x}" cy="${y}" r="${(4 + 4 * stiffness).toFixed(1)}"/>
            <text class="spring-label" x="${left}" y="${y - 13}" text-anchor="start"
              >${escape(shortLabel(row.label, 44))}</text>
          </g>`;
      })
      .join("");

    const inspector = `
      <header class="inspector-head">
        <span class="inspector-kind">Springs</span>
        <h2>${escape(treat1)} <span class="versus">vs</span> ${escape(treat2)}</h2>
        <p class="inspector-scale">${escape(dataset?.outcome ?? "Effect")}</p>
      </header>

      <dl class="estimates">
        <div>
          <dt>Direct, in parallel</dt>
          <dd>${
            direct
              ? effect(orient(direct, treat1) * direct.TE, direct.seTE, measure)
              : "no direct comparison"
          }</dd>
        </div>
        <div>
          <dt>Stiffest route</dt>
          <dd>${routes[0] ? effect(routes[0].TE, routes[0].seTE, measure) : "–"}</dd>
        </div>
        <div>
          <dt>The whole assembly</dt>
          <dd>${effect(model.TE[a][b], model.seTE[a][b], measure)}</dd>
        </div>
      </dl>

      <section class="inspector-section">
        <h3>How the assembly settles</h3>
        <p class="inspector-note">
          A spring's natural length is an effect and its stiffness is a precision. Studies of the
          same comparison hang in parallel, so their stiffnesses add and the assembly settles at
          the inverse-variance weighted average. Comparisons along a route hang in series, so
          their lengths add and their compliances, the reciprocals of stiffness, add too: that is
          why an indirect route is longer, weaker, and wider than any comparison in it.
        </p>
        <p class="inspector-note">
          The routes drawn here are the ones the evidence actually travels, in the order the flow
          decomposition finds them. The stiffest carries ${
            routes[0] ? percent(routes[0].share, 1) : "–"
          } of the estimate.
        </p>
      </section>
    `;

    return {
      stage: `${axis}<g class="springs">${drawn}</g>`,
      inspector,
      note: `Each coil is a spring: its length is an effect, its stiffness is a precision. Parallel is pooling, series is an indirect route.`,
    };
  },
};
