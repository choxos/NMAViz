/* Things on the canvas you pick up.
 *
 * A switch that says ON is a claim about the model written as a widget. A plug
 * lying on the bench next to an empty socket is the same claim made out of the
 * thing itself, and it is better for one reason that has nothing to do with
 * charm: the reader can see the state without reading a word. An open circuit
 * carries no current, and a plug out of its socket IS an open circuit, so the
 * picture and the arithmetic agree without anyone having to be told.
 *
 * Every prop here controls something the model actually has a degree of freedom
 * in. The plug decides whether current is driven at all. The probes decide
 * which pair of treatments the potential is measured across, which is the
 * comparison of interest the whole site is built around. The dropper decides
 * where a random walk is released, which changes the walk and not the drawing
 * of it. Nothing here is a display setting wearing a costume.
 */

const round = (n) => n.toFixed(1);

/* A cable with slack in it.
 *
 * Drawn as a curve that sags away from the straight line between its ends, by
 * an amount that grows as the ends come together, because that is what a cable
 * of fixed length does. A taut cable and a coiled one look different and the
 * difference is the whole reason a reader believes the plug is a physical
 * object rather than an icon that moved.
 */
export function cablePath(from, to, length) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy);
  const slack = Math.max(0, length - span);
  // Sag downward on the screen, which is where gravity is even in a diagram.
  const droop = Math.min(70, 12 + slack * 0.55);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + droop };
  return `M${round(from.x)} ${round(from.y)}Q${round(mid.x)} ${round(mid.y)} ${round(to.x)} ${round(
    to.y
  )}`;
}

/* The socket: a body with two contacts in it, mounted on the wire that runs
 * into the treatment the current is driven into. */
export function socketMarkup(at, direction, occupied) {
  const px = -direction.y;
  const py = direction.x;
  const corner = (along, across) => ({
    x: at.x + direction.x * along + px * across,
    y: at.y + direction.y * along + py * across,
  });

  const body = [corner(-9, -11), corner(9, -11), corner(9, 11), corner(-9, 11)]
    .map((p, i) => `${i ? "L" : "M"}${round(p.x)} ${round(p.y)}`)
    .join("");

  const contact = (across) => {
    const a = corner(-4.5, across);
    const b = corner(4.5, across);
    return `<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}"/>`;
  };

  return `
    <g class="socket${occupied ? " occupied" : " empty"}">
      <path class="socket-body" d="${body}Z"/>
      <g class="socket-contacts">${contact(-5)}${contact(5)}</g>
    </g>`;
}

/* The plug: a body and two pins, pointing the way it would go in. */
export function plugMarkup(at, direction) {
  const px = -direction.y;
  const py = direction.x;
  const point = (along, across) => ({
    x: at.x + direction.x * along + px * across,
    y: at.y + direction.y * along + py * across,
  });

  const body = [point(-13, -10), point(1, -10), point(1, 10), point(-13, 10)]
    .map((p, i) => `${i ? "L" : "M"}${round(p.x)} ${round(p.y)}`)
    .join("");

  const pin = (across) => {
    const a = point(1, across);
    const b = point(9.5, across);
    return `<line x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}"/>`;
  };

  return `
    <g class="plug" data-prop="plug">
      <circle class="hit-node" cx="${round(at.x)}" cy="${round(at.y)}" r="24"/>
      <path class="plug-body" d="${body}Z"/>
      <g class="plug-pins">${pin(-5)}${pin(5)}</g>
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
