/* Where the treatments sit on the canvas.
 *
 * The default is not a decorative arrangement. The Laplacian pseudoinverse of a
 * network is a Gram matrix, so its principal coordinates place the treatments
 * in a space where the straight-line distance between two of them is exactly
 * the standard error of the network estimate comparing them:
 *
 *     |x_i - x_j|^2 = Lplus_ii + Lplus_jj - 2 Lplus_ij = the effective
 *     resistance between i and j = Var(network estimate for i vs j)
 *
 * Two treatments drawn close together are precisely compared; two drawn far
 * apart are not, however many studies sit between them. In two dimensions this
 * is a projection, so the reported stress says how much of the structure the
 * picture actually carries, and the interface shows it rather than hiding it.
 *
 * Two other arrangements are offered because they answer different questions: a
 * circle, which shows the comparison structure without implying anything about
 * distance, and a force layout, which is the system of springs from
 * Papakonstantinou et al with stiffness set to precision.
 */

import { eigenSymmetric } from "../nma/matrix.js";

const kruskalStress = (points, target) => {
  const n = points.length;
  let residual = 0;
  let total = 0;
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) {
      const drawn = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      residual += (target[i][j] - drawn) ** 2;
      total += target[i][j] ** 2;
    }
  return total > 0 ? Math.sqrt(residual / total) : 0;
};

/* Principal coordinates of the pseudoinverse, refined by stress majorization.
 *
 * The principal coordinates alone are the exact embedding truncated to two
 * axes, which is faithful for a network whose geometry is nearly flat and
 * useless for one that is not: a star network is a simplex, its leaves are all
 * the same distance from the hub and from each other, and projecting that onto
 * a plane piles them on top of one another. Stress majorization starts from the
 * projection and then moves the treatments to fit the standard errors as well
 * as two dimensions allow, which spreads the leaves out without inventing an
 * order among them. The residual stress is reported rather than hidden.
 */
export function precisionLayout(fit, { steps = 300 } = {}) {
  const { Lplus, resistance } = fit;
  const n = Lplus.length;
  const { values, vectors } = eigenSymmetric(Lplus);

  const points = Array.from({ length: n }, (_, i) => ({
    x: (vectors[i][0] ?? 0) * Math.sqrt(Math.max(0, values[0] ?? 0)),
    y: (vectors[i][1] ?? 0) * Math.sqrt(Math.max(0, values[1] ?? 0)),
  }));

  // The target distance between two treatments is the standard error of the
  // network estimate comparing them.
  const target = resistance.map((row) => row.map((r) => Math.sqrt(Math.max(0, r))));

  if (n > 2) {
    // Break an exactly degenerate start, which a perfectly symmetric network
    // produces and which the majorization cannot move away from on its own.
    const scale = Math.max(...target.flat()) || 1;
    points.forEach((p, i) => {
      p.x += Math.cos(i * 2.39996) * scale * 1e-3;
      p.y += Math.sin(i * 2.39996) * scale * 1e-3;
    });

    // Guttman transform, uniform weights: X becomes B(X) X / n each step.
    for (let step = 0; step < steps; step++) {
      const next = points.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < n; i++) {
        let sx = 0;
        let sy = 0;
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const dx = points[i].x - points[j].x;
          const dy = points[i].y - points[j].y;
          const distance = Math.hypot(dx, dy);
          const ratio = distance > 1e-12 ? target[i][j] / distance : 0;
          sx += points[j].x + ratio * dx;
          sy += points[j].y + ratio * dy;
        }
        next[i].x = sx / n;
        next[i].y = sy / n;
      }
      let moved = 0;
      for (let i = 0; i < n; i++) {
        moved = Math.max(moved, Math.hypot(next[i].x - points[i].x, next[i].y - points[i].y));
        points[i] = next[i];
      }
      if (moved < 1e-9) break;
    }
  }

  const explained = values.reduce((s, v) => s + Math.max(0, v), 0);
  return {
    points,
    stress: kruskalStress(points, target),
    // Share of the total variance the two drawn axes carry.
    fidelity: explained > 0 ? (Math.max(0, values[0]) + Math.max(0, values[1])) / explained : 1,
    meaning: "distance is the standard error of the network estimate",
  };
}

export function circleLayout(fit) {
  const n = fit.Lplus.length;
  return {
    points: Array.from({ length: n }, (_, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    }),
    stress: null,
    fidelity: null,
    meaning: "an even circle; only the comparisons carry information",
  };
}

/* The mechanical analogue: each comparison is a spring whose stiffness is its
 * precision and whose natural length is the observed effect. Nodes repel so the
 * picture stays readable. Started from the precision layout, so a run is
 * deterministic and short. */
export function springLayout(fit, { steps = 320, repulsion = 0.28 } = {}) {
  const n = fit.Lplus.length;
  const points = precisionLayout(fit).points.map((p) => ({ ...p }));

  const scale = Math.max(
    1e-9,
    Math.max(...points.map((p) => Math.hypot(p.x, p.y)))
  );
  points.forEach((p) => {
    p.x /= scale;
    p.y /= scale;
  });

  // One spring per observed comparison, stiffness proportional to precision.
  const springs = fit.direct.map((edge) => ({
    a: fit.index.get(edge.treat1),
    b: fit.index.get(edge.treat2),
    stiffness: 1 / edge.seTE ** 2,
  }));
  const strongest = Math.max(...springs.map((s) => s.stiffness), 1e-9);
  springs.forEach((s) => (s.stiffness /= strongest));

  const rest = 0.9;
  for (let step = 0; step < steps; step++) {
    const cooling = 1 - step / steps;
    const force = points.map(() => ({ x: 0, y: 0 }));

    for (const { a, b, stiffness } of springs) {
      let dx = points[b].x - points[a].x;
      let dy = points[b].y - points[a].y;
      const distance = Math.hypot(dx, dy) || 1e-6;
      const pull = (stiffness * (distance - rest)) / distance;
      dx *= pull;
      dy *= pull;
      force[a].x += dx;
      force[a].y += dy;
      force[b].x -= dx;
      force[b].y -= dy;
    }

    for (let i = 0; i < n - 1; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = points[j].x - points[i].x;
        const dy = points[j].y - points[i].y;
        const squared = Math.max(dx * dx + dy * dy, 1e-4);
        const push = repulsion / squared;
        force[i].x -= dx * push;
        force[i].y -= dy * push;
        force[j].x += dx * push;
        force[j].y += dy * push;
      }

    points.forEach((p, i) => {
      p.x += force[i].x * 0.08 * cooling;
      p.y += force[i].y * 0.08 * cooling;
    });
  }

  return {
    points,
    stress: null,
    fidelity: null,
    meaning: "springs whose stiffness is the precision of each comparison",
  };
}

export const LAYOUTS = {
  precision: { label: "Precision", build: precisionLayout },
  springs: { label: "Springs", build: springLayout },
  circle: { label: "Circle", build: circleLayout },
};

/* Nudge overlapping treatments apart.
 *
 * A drawing where two circles sit on top of each other hides one of them, and a
 * dense network produces several such pairs. The relief is deliberately weak:
 * it only separates circles that actually overlap, and it moves both ends of a
 * pair equally, so the arrangement's shape survives. What it does cost is
 * fidelity, so the caller measures the stress again afterwards and reports the
 * number that describes the picture on the screen rather than the one before
 * the nudge.
 *
 * A treatment the reader has placed by hand is never nudged. They put it there
 * on purpose, and a drawing that slides out from under the pointer is worse
 * than two circles touching.
 */
export function relieveOverlap(points, radii, { padding = 7, rounds = 60, fixed = null } = {}) {
  const held = (i) => Boolean(fixed?.has(i));
  const moved = points.map((p) => ({ ...p }));
  for (let round = 0; round < rounds; round++) {
    let worst = 0;
    for (let i = 0; i < moved.length - 1; i++)
      for (let j = i + 1; j < moved.length; j++) {
        const wanted = radii[i] + radii[j] + padding;
        let dx = moved[j].x - moved[i].x;
        let dy = moved[j].y - moved[i].y;
        let distance = Math.hypot(dx, dy);
        if (distance >= wanted) continue;
        if (distance < 1e-6) {
          // Exactly coincident: push along a fixed direction so the result is
          // the same on every render.
          dx = Math.cos(i * 2.39996);
          dy = Math.sin(i * 2.39996);
          distance = 1;
        }
        if (held(i) && held(j)) continue;
        // When one end is held the other carries the whole separation, so the
        // pair still parts by the same amount.
        const share = held(i) || held(j) ? 1 : 0.5;
        const push = ((wanted - distance) / distance) * share * 0.6;
        worst = Math.max(worst, wanted - distance);
        if (!held(i)) {
          moved[i].x -= dx * push;
          moved[i].y -= dy * push;
        }
        if (!held(j)) {
          moved[j].x += dx * push;
          moved[j].y += dy * push;
        }
      }
    if (worst < 0.25) break;
  }
  return moved;
}

/* Kruskal stress of a drawing against the standard errors it claims to show,
 * measured in the pixels actually on the screen. */
export function stressOf(points, resistance) {
  const n = points.length;
  let cross = 0;
  let square = 0;
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) {
      const target = Math.sqrt(Math.max(0, resistance[i][j]));
      const drawn = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      cross += target * drawn;
      square += target * target;
    }
  // The best scale is fitted rather than assumed, since a drawing is only ever
  // claimed to show distances up to one common factor.
  const scale = square > 0 ? cross / square : 0;
  let residual = 0;
  let total = 0;
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) {
      const target = scale * Math.sqrt(Math.max(0, resistance[i][j]));
      const drawn = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      residual += (target - drawn) ** 2;
      total += drawn ** 2;
    }
  return total > 0 ? Math.sqrt(residual / total) : 0;
}

/* Fit a set of positions into a box, keeping the aspect ratio so that a
 * distance-carrying arrangement stays a distance-carrying arrangement. The box
 * is the part of the window the floating panels leave clear. */
export function frame(points, box) {
  const width = Math.max(120, box.right - box.left);
  const height = Math.max(120, box.bottom - box.top);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const lowX = Math.min(...xs);
  const highX = Math.max(...xs);
  const lowY = Math.min(...ys);
  const highY = Math.max(...ys);
  const scale = Math.min(width / (highX - lowX || 1), height / (highY - lowY || 1));
  const centerX = (highX + lowX) / 2;
  const centerY = (highY + lowY) / 2;
  return points.map((p) => ({
    x: (box.left + box.right) / 2 + (p.x - centerX) * scale,
    y: (box.top + box.bottom) / 2 + (p.y - centerY) * scale,
  }));
}
