/* Working the mechanism rather than looking at it.
 *
 * Papakonstantinou et al say a study is a spring: its natural length is its
 * effect and its stiffness is its precision. If that is true then the pooled
 * estimate is not a formula to be taken on trust, it is where the assembly
 * comes to rest, and the only honest way to show that is to let someone pull it
 * out of place and watch it come back.
 *
 * The arithmetic is exact and worth stating. Springs in parallel from natural
 * lengths y_i with stiffnesses k_i put a total force
 *
 *     F(x) = Σ k_i (y_i − x)
 *
 * on the common bob, which vanishes at
 *
 *     x* = Σ k_i y_i / Σ k_i
 *
 * and with k_i = 1/se_i² that is the inverse-variance weighted mean, which is
 * the common-effect pooled estimate to the last digit. So the resting place of
 * this toy IS the number in the panel. Nothing is faked to make it land there.
 *
 * What is chosen rather than derived is only the feel: the mass and the damping
 * are picked so that any dataset, on any scale, oscillates a few times over
 * about a second. Those two constants change how long the animation lasts and
 * nothing about where it stops.
 */

/* About one swing per this many seconds, whatever the data's units. */
const PERIOD = 0.85;
/* Underdamped, so the assembly visibly overshoots. A critically damped rig
 * would settle faster and teach nothing. */
const DAMPING_RATIO = 0.11;
const SETTLED = 1e-4;

export function makeRig(springs) {
  const total = springs.reduce((s, spring) => s + spring.k, 0);
  if (!(total > 0)) return null;
  const equilibrium = springs.reduce((s, spring) => s + spring.k * spring.y, 0) / total;

  // The spread of the natural lengths sets what "settled" means on this data's
  // own scale, so the rig stops at the same visual precision for a log odds
  // ratio and for a difference in millilitres.
  const lengths = springs.map((spring) => spring.y);
  const span = Math.max(...lengths) - Math.min(...lengths) || Math.abs(equilibrium) || 1;

  const omega = (2 * Math.PI) / PERIOD;
  const mass = total / (omega * omega);
  const damping = 2 * DAMPING_RATIO * Math.sqrt(total * mass);

  return {
    springs,
    equilibrium,
    span,
    mass,
    damping,
    total,
    x: equilibrium,
    v: 0,
    running: false,
    held: false,
  };
}

/* One step of the motion, integrated semi-implicitly so that energy does not
 * creep upward over a long swing. Returns whether the rig is still moving. */
export function stepRig(rig, seconds) {
  if (!rig || rig.held) return false;
  // A tab that was in the background hands back an enormous first frame, which
  // would fling the bob across the screen.
  const dt = Math.min(0.04, Math.max(0, seconds));
  if (dt === 0) return rig.running;

  const force = rig.springs.reduce((s, spring) => s + spring.k * (spring.y - rig.x), 0);
  const acceleration = (force - rig.damping * rig.v) / rig.mass;
  rig.v += acceleration * dt;
  rig.x += rig.v * dt;

  const offset = Math.abs(rig.x - rig.equilibrium) / rig.span;
  const speed = Math.abs(rig.v) / rig.span;
  if (offset < SETTLED && speed < SETTLED) {
    rig.x = rig.equilibrium;
    rig.v = 0;
    rig.running = false;
  }
  return rig.running;
}

/* Pull the bob to a value and let go of it. */
export function releaseFrom(rig, value) {
  if (!rig) return;
  rig.x = value;
  rig.v = 0;
  rig.held = false;
  rig.running = true;
}

/* The energy stored in the assembly, which is what the reader is putting in by
 * pulling on it and what the damping takes back out. */
export const rigEnergy = (rig) =>
  rig
    ? rig.springs.reduce((s, spring) => s + 0.5 * spring.k * (spring.y - rig.x) ** 2, 0) +
      0.5 * rig.mass * rig.v ** 2
    : 0;
