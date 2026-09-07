/* Things on the canvas you work with your hands.
 *
 * A label that says ON is a claim about the model written as text. A rocker
 * switch sitting in the lead, pressed to OFF, is the same claim made out of the
 * thing itself, and it is better for one reason that has nothing to do with
 * charm: the reader can see the state without reading a word, and can change it
 * without being told how. An open circuit carries no current, and a switch
 * broken open IS an open circuit, so the picture and the arithmetic agree.
 *
 * Every prop here controls something the model actually has a degree of freedom
 * in. The switch decides whether current is driven at all. The probes decide
 * which pair of treatments the potential is measured across, which is the
 * comparison of interest the whole site is built around. The dropper decides
 * where a random walk is released, which changes the walk and not the drawing
 * of it. Nothing here is a display setting wearing a costume.
 */

const round = (n) => n.toFixed(1);

/* The switch: an inline rocker in the source lead, the kind molded into the
 * cable of a lamp.
 *
 * It is drawn in its own frame so that the printed word stays level whichever
 * way the branch runs beneath it, and the body is opaque so that the wire it
 * sits on visibly ends at its two faces. The word rides on the paddle rather
 * than beside it, because the branch it sits on is short on a crowded network
 * and a switch that needs room for a second panel of text would land on the
 * treatment or on the source.
 */
export function switchMarkup(at, direction, closed) {
  // A word printed upside down is worse than a switch mounted the other way
  // round, and the body is symmetric, so a branch running to the left flips.
  const flipped = direction.x < 0;
  const facing = flipped ? { x: -direction.x, y: -direction.y } : direction;
  const angle = (Math.atan2(facing.y, facing.x) * 180) / Math.PI;
  // Which way along the wire the current would run, in the flipped frame.
  const downstream = flipped ? -1 : 1;
  // Pressed toward the network when the circuit is made and backed off toward
  // the source when it is broken, so the paddle says which way current is let
  // through. That also keeps the word OFF, the one a reader must be able to
  // read, at the end away from the treatment and its label.
  const side = closed ? downstream : -downstream;

  return `
    <g class="rocker${closed ? " closed" : " open"}" data-switch="${
      closed ? "off" : "on"
    }" transform="translate(${round(at.x)} ${round(at.y)}) rotate(${angle.toFixed(1)})">
      <rect class="hit-node" x="-32" y="-19" width="64" height="38"/>
      <rect class="rocker-body" x="-22" y="-11" width="44" height="22" rx="6"/>
      <rect class="rocker-paddle" x="${side * 10 - 10}" y="-8" width="20" height="16" rx="3.5"/>
      <text class="rocker-label" x="${side * 10}" y="3" text-anchor="middle">${
        closed ? "ON" : "OFF"
      }</text>
    </g>`;
}

/* The meter the probes belong to, drawn where the leads come from so that they
 * are visibly one instrument and not two loose wires. */
export function meterMarkup(at, reading, label) {
  return `
    <g class="meter">
      <rect class="meter-body" x="${round(at.x - 62)}" y="${round(
        at.y - 26
      )}" width="124" height="52" rx="9"/>
      <text class="meter-reading" x="${round(at.x)}" y="${round(at.y - 2)}" text-anchor="middle">${
        reading
      }</text>
      <text class="meter-label" x="${round(at.x)}" y="${round(at.y + 14)}" text-anchor="middle">${
        label
      }</text>
      <circle class="meter-jack from" cx="${round(at.x - 26)}" cy="${round(at.y + 26)}" r="4"/>
      <circle class="meter-jack to" cx="${round(at.x + 26)}" cy="${round(at.y + 26)}" r="4"/>
    </g>`;
}

/* A lead from the meter to a probe tip.
 *
 * It drops out of the jack and comes at the treatment from below, so that it
 * never lies along the line between two treatments where it could be read as a
 * comparison. It is drawn thick and cased, unlike every evidence line on the
 * canvas.
 */
export function leadPath(jack, tip) {
  const sag = Math.max(30, Math.abs(tip.x - jack.x) * 0.35);
  return `M${round(jack.x)} ${round(jack.y)}C${round(jack.x)} ${round(jack.y + sag)} ${round(
    tip.x
  )} ${round(tip.y + sag + 20)} ${round(tip.x)} ${round(tip.y + 18)}`;
}

/* A meter probe: a needle touching a treatment, with its lead running back off
 * toward the instrument. Two of them, and which treatments they touch is which
 * comparison is being measured. */
export function probeMarkup(at, direction, role, treatment) {
  const px = -direction.y;
  const py = direction.x;
  const point = (along, across) => ({
    x: at.x + direction.x * along + px * across,
    y: at.y + direction.y * along + py * across,
  });

  const tip = point(0, 0);
  const shoulderA = point(11, -4.5);
  const shoulderB = point(11, 4.5);
  const back = point(30, 0);

  return `
    <g class="probe ${role}" data-prop="probe-${role}"${
      treatment ? ` data-on="${treatment}"` : ""
    }>
      <circle class="hit-node" cx="${round(point(16, 0).x)}" cy="${round(point(16, 0).y)}" r="22"/>
      <path class="probe-needle" d="M${round(tip.x)} ${round(tip.y)}L${round(
        shoulderA.x
      )} ${round(shoulderA.y)}L${round(back.x)} ${round(back.y)}L${round(shoulderB.x)} ${round(
        shoulderB.y
      )}Z"/>
      <circle class="probe-collar" cx="${round(point(24, 0).x)}" cy="${round(
        point(24, 0).y
      )}" r="4.4"/>
    </g>`;
}

/* The dropper: what releases the walk, and where. Drawn as a pipette with a
 * bulb, over the treatment the walk starts from. */
export function dropperMarkup(at, charged) {
  const x = at.x;
  const y = at.y - 44;
  return `
    <g class="dropper${charged ? " charged" : ""}" data-prop="dropper">
      <circle class="hit-node" cx="${round(x)}" cy="${round(y + 8)}" r="26"/>
      <path class="dropper-body" d="M${round(x - 5)} ${round(y - 20)}L${round(x + 5)} ${round(
        y - 20
      )}L${round(x + 5)} ${round(y + 2)}L${round(x)} ${round(y + 16)}L${round(x - 5)} ${round(
        y + 2
      )}Z"/>
      <path class="dropper-bulb" d="M${round(x - 7)} ${round(y - 20)}q7 -12 14 0Z"/>
      ${charged ? `<circle class="dropper-drop" cx="${round(x)}" cy="${round(y + 24)}" r="3.4"/>` : ""}
    </g>`;
}
