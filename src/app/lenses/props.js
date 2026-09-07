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

/* The switch: a panel-mount rocker set into the source lead.
 *
 * It is drawn in its own frame so that the markings stay level whichever way
 * the branch runs beneath it, and the body is opaque so that the wire it sits
 * on visibly ends at its two faces. The paddle is a see-saw: the half that is
 * pressed down is the one in shadow, and the marks are the ones stamped into
 * every rocker made, a bar for the closed circuit and a ring for the open one.
 * Pressing the bar end down drives the current, which is what the bar means.
 */
export function switchMarkup(at, direction, closed) {
  // Markings printed upside down are worse than a switch mounted the other way
  // round, and the body is symmetric, so a branch running to the left flips.
  const flipped = direction.x < 0;
  const facing = flipped ? { x: -direction.x, y: -direction.y } : direction;
  const angle = (Math.atan2(facing.y, facing.x) * 180) / Math.PI;
  // The bar sits at the downstream end, so that pressing the end the current
  // would leave by is what lets it leave.
  const bar = flipped ? -1 : 1;
  // Whichever half is held down is the one the paddle has sunk into.
  const sunk = closed ? bar : -bar;

  return `
    <g class="rocker${closed ? " closed" : " open"}" data-switch="${
      closed ? "off" : "on"
    }" transform="translate(${round(at.x)} ${round(at.y)}) rotate(${angle.toFixed(1)})">
      <rect class="hit-node" x="-32" y="-23" width="64" height="46"/>
      <rect class="rocker-bezel" x="-23" y="-15" width="46" height="30" rx="3.5"/>
      <rect class="rocker-paddle" x="-19" y="-11.5" width="38" height="23" rx="2"/>
      <rect class="rocker-pressed" x="${sunk < 0 ? -19 : 0}" y="-11.5" width="19" height="23" rx="2"/>
      <line class="rocker-mark${sunk === bar ? " sunk" : ""}" x1="${bar * 9.5}" y1="-5.5" x2="${
        bar * 9.5
      }" y2="5.5"/>
      <circle class="rocker-mark${sunk === bar ? "" : " sunk"}" cx="${
        -bar * 9.5
      }" cy="0" r="4.2"/>
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
