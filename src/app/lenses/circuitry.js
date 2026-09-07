/* Drawing the network as the circuit it actually is.
 *
 * Rücker's construction is not a metaphor. A comparison carrying studies of
 * variance v_1 ... v_k is a set of conductances 1/v_i in parallel, the network
 * estimate for a pair of treatments is the potential difference when one unit
 * of current is driven between them, and its variance is the effective
 * resistance. So the network can be drawn as a circuit diagram without adding
 * or removing a single claim.
 *
 * The one thing a textbook circuit diagram does that cannot be done here is
 * route its wires on a rectangular grid. The arrangement on this canvas already
 * means something, since the straight-line distance between two treatments is
 * the standard error of comparing them, and bending a wire around a corner
 * would make that distance longer than the quantity it stands for. The wires
 * therefore run straight and the resistor symbol is drawn along them, which
 * reads perfectly well at any angle: what makes a resistor legible is the
 * zigzag, not the right angles either side of it.
 *
 * What the symbols carry:
 *
 *   wire width      the precision of the comparison, as everywhere else
 *   wire length     the standard error the arrangement claims, to its stress
 *   zigzag          that this connection has resistance, and nothing more
 *   current source  the comparison being asked about
 *
 * The zigzag is deliberately the same on every wire. Amplitude, period and the
 * number of teeth are constants in screen pixels, because a varying zigzag
 * invites a reading nobody can check: more teeth would say more studies to one
 * reader, more resistance to another, and more uncertainty to a third. Width
 * and length already carry precision and standard error; the symbol's job is to
 * say what kind of thing this is.
 *
 * The source is a current source and not a battery, which matters. Rücker's
 * construction drives one unit of current between two treatments and reads off
 * the potential difference; the current is what is imposed and the voltage is
 * what the network answers. A battery is a voltage source and would state that
 * backwards.
 */

const TEETH = 6;
const AMPLITUDE = 4.5;
const BODY = 28;
/* Below this the leads either side would vanish and the symbol would read as a
 * kink rather than a component. A wire too short for one is a very precisely
 * estimated comparison, and it still has resistance: the note says so, because
 * in a real schematic a bare wire would mean none. */
const SHORTEST = 52;
const SOURCE_R = 13;

/* A wire from a to b with a resistor in the middle of it.
 *
 * Returns a single path: straight wire up to the symbol, the zigzag, straight
 * wire out the other side. One path rather than three keeps the stroke joins
 * continuous and keeps the markup small on a network of sixty comparisons.
 */
export function resistorPath(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < SHORTEST) return { d: `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`, symbol: false };

  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular, for the teeth.
  const px = -uy;
  const py = ux;

  const span = Math.min(BODY, length * 0.42);
  const start = length / 2 - span / 2;
  const steps = TEETH * 2;

  const at = (along, offset) => ({
    x: a.x + ux * along + px * offset,
    y: a.y + uy * along + py * offset,
  });

  const points = [at(0, 0), at(start, 0)];
  for (let k = 1; k < steps; k++)
    points.push(at(start + (span * k) / steps, k % 2 ? AMPLITUDE : -AMPLITUDE));
  points.push(at(start + span, 0), at(length, 0));

  const d = points
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join("");
  return { d, symbol: true };
}

/* The source.
 *
 * One unit of current enters at a and leaves at b, so the circuit is completed
 * by a return branch that is not part of the evidence at all: it is the
 * question being asked of it. That branch is drawn outside the network, bowed
 * away from the middle so it does not cross the comparisons, and it is the one
 * dashed line on the canvas, because nothing in the data corresponds to it.
 *
 * The branch runs from b back to a, which is the direction the current takes
 * outside the network, and the arrow inside the source points that way.
 */
export function sourceBranch(a, b, box) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;

  // Bow away from the middle of the drawing, so the source loop sits outside
  // the network rather than through it.
  let ax = mx - cx;
  let ay = my - cy;
  const away = Math.hypot(ax, ay);
  if (away < 1e-6) {
    ax = 0;
    ay = -1;
  } else {
    ax /= away;
    ay /= away;
  }
  // Far enough out that the branch and its battery clear the network rather
  // than sitting on top of the treatment they leave from.
  const bow = Math.max(118, Math.hypot(b.x - a.x, b.y - a.y) * 0.55);

  // Where the quadratic curve actually reaches, which is where the source
  // belongs: halfway along the branch, not halfway to the control point.
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const margin = SOURCE_R + 26;
  const apex = {
    x: clamp(mx + ax * bow, box.left + margin, box.right - margin),
    y: clamp(my + ay * bow, box.top + margin, box.bottom - margin),
  };
  // A branch bowed far enough to leave the canvas would put its source under a
  // panel, so the control point is derived back from the clamped apex.
  const control = { x: 2 * apex.x - (a.x + b.x) / 2, y: 2 * apex.y - (a.y + b.y) / 2 };
  // The direction of the curve at its apex is the chord from a to b.
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const tl = Math.hypot(tx, ty) || 1;

  // The switch is mounted on the half of the branch that runs into a, the
  // treatment the current is driven into, because that is where a reader looks
  // for the thing that decides whether the source reaches the network at all.
  // Where exactly on that half is not fixed: the leg is short when the two
  // treatments are close together, so the switch takes the point on it that is
  // as far from the treatment and from the source symbol as the leg allows. On
  // a short leg that still leaves it touching one of them; searching only this
  // half is what keeps it from wandering onto a wire that carries evidence.
  const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const on = (t) => lerp(lerp(b, control, t), lerp(control, a, t), t);
  const tangent = (t) => {
    const from = lerp(b, control, t);
    const to = lerp(control, a, t);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };

  const clearance = (t) => {
    const p = on(t);
    return Math.min(
      Math.hypot(p.x - a.x, p.y - a.y),
      Math.hypot(p.x - apex.x, p.y - apex.y)
    );
  };
  let SWITCH = 0.75;
  for (let t = 0.56; t <= 0.94; t += 0.02) if (clearance(t) > clearance(SWITCH)) SWITCH = t;

  return {
    // Drawn from b to a: outside the network the current returns to where it
    // was injected.
    d: `M${b.x.toFixed(1)} ${b.y.toFixed(1)}Q${control.x.toFixed(1)} ${control.y.toFixed(
      1
    )} ${a.x.toFixed(1)} ${a.y.toFixed(1)}`,
    // Where the switch sits on that branch, and which way it lies along it.
    switchAt: on(SWITCH),
    switchDirection: tangent(SWITCH),
    source: sourceMarkup(apex, { x: -tx / tl, y: -ty / tl }),
    sourceAt: apex,
  };
}

/* An ideal current source: a circle with an arrow through it, pointing the way
 * the current is driven. The unit is deliberately not an amp; these are
 * variances and standard errors, not a bench measurement. */
function sourceMarkup(at, direction) {
  const reach = SOURCE_R - 4;
  const tail = {
    x: at.x - direction.x * reach,
    y: at.y - direction.y * reach,
  };
  const head = {
    x: at.x + direction.x * reach,
    y: at.y + direction.y * reach,
  };
  // A small arrowhead, drawn rather than markered, so it inherits the stroke.
  const wing = (sign) => ({
    x: head.x - direction.x * 5 + -direction.y * 3.4 * sign,
    y: head.y - direction.y * 5 + direction.x * 3.4 * sign,
  });
  const left = wing(1);
  const right = wing(-1);

  return `
    <g class="current-source">
      <circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="${SOURCE_R}"/>
      <path d="M${tail.x.toFixed(1)} ${tail.y.toFixed(1)}L${head.x.toFixed(1)} ${head.y.toFixed(
        1
      )}M${left.x.toFixed(1)} ${left.y.toFixed(1)}L${head.x.toFixed(1)} ${head.y.toFixed(
        1
      )}L${right.x.toFixed(1)} ${right.y.toFixed(1)}"/>
      <text x="${at.x.toFixed(1)}" y="${(at.y + SOURCE_R + 13).toFixed(
        1
      )}" text-anchor="middle">I = 1</text>
    </g>`;
}
