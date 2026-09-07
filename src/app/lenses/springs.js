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
import { rigEnergy } from "../play.js";
import { effect, escape, isRatio, number, onScale, percent, shortLabel } from "../ui.js";

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
  // Offers controls that work the mechanism, so the canvas leaves room for
  // the deck under it.
  deck: true,
  separates: "The springs already hang one study per coil.",
  id: "springs",
  name: "Springs",
  tagline: "The mechanism: studies in parallel, routes in series",
  reference:
    "Papakonstantinou T, Nikolakopoulou A, Egger M, Salanti G. Meta-analysis as a system of springs. Res Synth Methods. 2021;12(2):176-186.",
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2-5 3 10 3-10 3 10 2-5h3"/></svg>',

  draw(context) {
    const { model, state, measure, width, height, dataset, box } = context;
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
    // Room down the left for the row labels, and a smaller margin on the right
    // for the numbers. These used to be the width of the panels that floated
    // over the canvas; the canvas is now a panel of its own with nothing on top
    // of it, so they are what the drawing itself needs and no more.
    const left = Math.max(96, width * 0.26);
    const right = width - Math.max(48, width * 0.13);
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

    // The first row sits below the axis caption, and the last one above the
    // axis labels. Both were pixel constants for a canvas the height of a
    // window; on a panel a few hundred pixels tall they left the rows stacked
    // on top of one another.
    const top = Math.max(52, Math.min(158, height * 0.22));
    const floor = (box?.bottom ?? height) - Math.max(26, height * 0.08);
    const gap = Math.min(54, (floor - top) / Math.max(1, rows.length));
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

    // Where the assembly is being held, if the reader is holding it. Only the
    // parallel bundle is playable, because that is the one place where the
    // spring picture is exact: the studies of one comparison really are
    // independent springs, and their resting point really is the pooled
    // estimate. The routes are not independent of one another, so pulling on
    // them would be a lie told with a nice animation.
    const rig = context.rig;
    const pulled = rig && Math.abs(rig.x - rig.equilibrium) > 1e-12;

    // The energy the assembly still holds once it has stopped moving is
    // exactly half the Q formed with the stiffnesses the springs actually
    // have. Under the common-effect model those are 1/se², so it is Cochran's
    // Q; under random effects they are 1/(se² + tau²), so it is the same
    // statistic at the random-effects weights and not the Q reported for the
    // common-effect fit. Taking it from the rig keeps the number beside the
    // energy equal to the energy under both models.
    const restQ = rig
      ? rig.springs.reduce((sum, spring) => sum + spring.k * (spring.y - rig.equilibrium) ** 2, 0)
      : 0;
    const cochran = context.state.model === "random" ? "the Q at these weights" : "Cochran's Q";

    // A wager. The reader places a stop where they think the bundle will come
    // to rest, before being told. While one is open the resting place is not
    // printed anywhere, because a prediction you can read off the panel beside
    // you is not a prediction.
    //
    // Nothing is scored for making Q smaller or an interval narrower. The only
    // thing measured is how close a guess was to a number the model had already
    // computed, and the error is reported in the pooled standard errors of this
    // comparison so that it means the same thing on a log odds ratio and on a
    // difference in millilitres.
    const wager =
      rig && context.state.wager?.contrast === `${treat1}\u0000${treat2}` &&
      context.state.wager.model === context.state.model
        ? context.state.wager
        : null;
    const hidden = Boolean(wager && !wager.settled);

    const drawn = rows
      .map((row, index) => {
        const y = top + index * gap;
        const held = rig && (row.kind === "study" || row.kind === "pooled");
        const x = at(held ? rig.x : row.TE);
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
        } else if (held) {
          // A study spring is stretched between its own effect and wherever the
          // bundle is being held, which is the whole point: the further the
          // bundle is pulled from a precise study, the harder that study pulls
          // back, and precision is exactly how hard.
          body = `<path class="spring-coil" d="${coil(at(row.TE), x, y, stiffness)}"/>
            <circle class="spring-anchor" cx="${at(row.TE)}" cy="${y}" r="2.6"/>`;
        } else {
          body = `<path class="spring-coil" d="${coil(nullAt, x, y, stiffness)}"/>`;
        }

        const grabbable = row.kind === "pooled" && rig;
        return `
          <g class="spring-row ${row.kind}${held && pulled ? " strained" : ""}${
            grabbable ? " grabbable" : ""
          }"${grabbable ? ' data-bob="pooled"' : ""}>
            <title>${escape(row.label)}${
              hidden && (row.kind === "pooled" || row.kind === "network")
                ? ""
                : `: ${effect(row.TE, row.seTE, measure)}`
            }</title>
            ${held ? "" : `<line class="spring-interval" x1="${lower}" y1="${y}" x2="${upper}" y2="${y}"/>`}
            ${body}
            ${
              grabbable
                ? `<circle class="hit-node" cx="${x}" cy="${y}" r="20"/>`
                : ""
            }
            <circle class="spring-end" cx="${x}" cy="${y}" r="${(4 + 4 * stiffness).toFixed(1)}"/>
            <text class="spring-label" x="${left}" y="${y - 13}" text-anchor="start"
              >${escape(shortLabel(row.label, 44))}</text>
          </g>`;
      })
      .join("");

    // The stop the reader places, and the truth once it is revealed.
    const stopMark = wager
      ? `
        <g class="wager${wager.settled ? " settled" : ""}">
          <line class="wager-stop" data-prop="wager" x1="${at(wager.guess).toFixed(1)}" y1="${
            top - 46
          }" x2="${at(wager.guess).toFixed(1)}" y2="${top + rows.length * gap + 16}"/>
          <text class="wager-label" x="${at(wager.guess).toFixed(1)}" y="${top - 54}"
            text-anchor="middle">${wager.settled ? "you said" : "your guess"}</text>
          ${
            wager.settled
              ? `<line class="wager-truth" x1="${at(rig.equilibrium).toFixed(1)}" y1="${
                  top - 46
                }" x2="${at(rig.equilibrium).toFixed(1)}" y2="${top + rows.length * gap + 16}"/>
                 <text class="wager-label truth" x="${at(rig.equilibrium).toFixed(1)}" y="${
                   top + rows.length * gap + 30
                 }" text-anchor="middle">it rests here</text>`
              : ""
          }
        </g>`
      : "";

    // The bar the parallel springs all pull on, drawn only when there is one.
    const bundleRows = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.kind === "study" || row.kind === "pooled");
    const yoke =
      rig && bundleRows.length > 1
        ? `<line class="spring-yoke" x1="${at(rig.x)}" y1="${
            top + bundleRows[0].index * gap - 12
          }" x2="${at(rig.x)}" y2="${top + bundleRows[bundleRows.length - 1].index * gap + 12}"/>`
        : "";

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
            hidden
              ? "hidden while you guess"
              : direct
                ? effect(orient(direct, treat1) * direct.TE, direct.seTE, measure)
                : "no direct comparison"
          }</dd>
        </div>
        <div>
          <dt>Stiffest route</dt>
          <dd>${
            hidden
              ? "hidden while you guess"
              : routes[0]
                ? effect(routes[0].TE, routes[0].seTE, measure)
                : "–"
          }</dd>
        </div>
        <div>
          <dt>The whole assembly</dt>
          <dd>${
            hidden ? "hidden while you guess" : effect(model.TE[a][b], model.seTE[a][b], measure)
          }</dd>
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
        ${
          direct && direct.rows.length > 1 && !hidden
            ? `<p class="inspector-note">
                 Pull the parallel bundle along the axis and let it go. It comes back to
                 ${escape(number(onScale(direct ? orient(direct, treat1) * direct.TE : 0, measure), 3))},
                 the pooled estimate, because that is the only place the studies' pulls cancel.
                 The energy the assembly still holds there,
                 ${escape(number(restQ / 2, 2))}, is exactly half ${cochran} for this
                 comparison: heterogeneity is the work it takes to hold springs of different
                 natural lengths at one common place.
               </p>`
            : ""
        }
        <p class="inspector-note">
          The routes drawn here are the ones the evidence actually travels, in the order the flow
          decomposition finds them. The stiffest carries ${
            routes[0] ? percent(routes[0].share, 1) : "–"
          } of the estimate.
        </p>
      </section>
    `;

    return {
      stage: `${axis}<g class="springs" data-middle="${middle}" data-scale="${scale}">${yoke}${drawn}${stopMark}</g>`,
      inspector,
      controls: rig
        ? `
          <div class="console-group">
            <span class="console-label">Assembly</span>
            <button type="button" class="deck-button primary" data-play="pull">Pull and release</button>
            <button type="button" class="deck-button" data-play="settle">Let it rest</button>
          </div>
          <div class="console-group">
            <span class="console-label">Wager</span>
            ${
              !wager
                ? `<button type="button" class="deck-button" data-wager="open">Guess where it rests</button>`
                : !wager.settled
                  ? `<span class="deck-reading">${number(
                      onScale(wager.guess, measure),
                      3
                    )}</span><button type="button" class="deck-button primary" data-wager="settle">Let go and find out</button>`
                  : `<span class="deck-reading">out by ${number(
                      Math.abs(wager.guess - rig.equilibrium) / (direct?.seTE || 1),
                      2
                    )}</span><span class="console-label">pooled standard errors</span>
                     <button type="button" class="deck-button" data-wager="clear">Again</button>`
            }
          </div>
          <div class="console-group">
            <span class="console-label">Held at</span>
            <span class="deck-reading">${
              // The assembly starts at rest, so where it is being held IS the
              // answer until it has been moved.
              hidden ? "hidden" : number(onScale(rig.x, measure), 3)
            }</span>
            <span class="console-label">Rests at</span>
            <span class="deck-reading">${
              hidden ? "hidden" : number(onScale(rig.equilibrium, measure), 3)
            }</span>
          </div>
          <div class="console-group">
            <span class="console-label">Energy stored</span>
            <span class="deck-reading">${number(rigEnergy(rig), 2)}</span>
            <span class="console-label">at rest, ${
              context.state.model === "random" ? "Q&#8202;at these weights&#8202;/&#8202;2 =" : "Q&#8202;/&#8202;2 ="
            }</span>
            <span class="deck-reading">${hidden ? "hidden" : number(restQ / 2, 2)}</span>
          </div>`
        : `
          <div class="console-group">
            <span class="console-label">Assembly</span>
            <span class="deck-reading">—</span>
            <span class="console-label">${
              direct
                ? "one study on this comparison, so there is nothing to balance"
                : "no direct comparison, so there is no bundle to pull"
            }</span>
          </div>`,
      note: !rig
        ? `Each coil is a spring: its length is an effect, its stiffness is a precision. Parallel is pooling, series is an indirect route.`
        : hidden
          ? `Put your stop where you think the bundle will come to rest, then let it go. A precise study is a stiff spring and pulls harder, so the assembly settles nearest the studies with the least uncertainty. Every number that would give the answer away is covered until you have committed.`
          : `Drag the bundle's weight along the axis and let go. It settles at ${number(
              onScale(rig.equilibrium, measure),
              3
            )}, the inverse-variance weighted mean, because that is the one place where the studies' pulls cancel. A precise study is a stiff spring and pulls harder.`,
    };
  },
};
