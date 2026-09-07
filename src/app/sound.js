/* The noises a cheap handheld makes.
 *
 * A piezo buzzer soldered to a 4-bit chip has one voice, no envelope worth the
 * name, and a click at every edge. That is what is synthesized here: square
 * waves, a few tens of milliseconds, no reverb, no samples to download. The
 * point is not fidelity, it is that pressing a button on the machine makes the
 * machine answer.
 *
 * Nothing here is allowed to matter. Audio is a courtesy: it is off until the
 * reader turns it on, it never blocks a state change, and if the browser
 * refuses to give us a context at all the rest of the site does not notice.
 */

const KEY = "nmaviz-sound";

let context = null;
let on = false;
try {
  on = localStorage.getItem(KEY) === "on";
} catch {
  // A browser with storage blocked simply starts quiet every time.
}

export const soundIsOn = () => on;

export function setSound(next) {
  on = Boolean(next);
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  // Turning it on is itself a gesture, which is the moment a browser will let
  // an audio context start.
  if (on) beep("power");
  return on;
}

/* The voices. Frequencies are in the register a piezo can actually reach, and
 * the sequences are short enough to read as one event rather than a tune. */
const VOICES = {
  // A button under a rubber dome.
  press: [{ hz: 1320, ms: 18, gain: 0.05 }],
  // The machine coming on: the two-tone chirp every one of these plays.
  power: [
    { hz: 660, ms: 60, gain: 0.06 },
    { hz: 990, ms: 90, gain: 0.06 },
  ],
  // The machine going off: the same two notes, the other way up.
  off: [
    { hz: 880, ms: 60, gain: 0.05 },
    { hz: 440, ms: 110, gain: 0.05 },
  ],
  // Something came to rest.
  settle: [
    { hz: 1046, ms: 45, gain: 0.05 },
    { hz: 1568, ms: 110, gain: 0.045 },
  ],
  // A guess was tested.
  score: [
    { hz: 784, ms: 50, gain: 0.055 },
    { hz: 1046, ms: 50, gain: 0.055 },
    { hz: 1318, ms: 120, gain: 0.05 },
  ],
  // A refusal: the network came apart, the control does nothing here.
  deny: [{ hz: 180, ms: 130, gain: 0.05 }],
};

export function beep(voice = "press") {
  if (!on) return;
  const notes = VOICES[voice];
  if (!notes) return;
  try {
    context ??= new (window.AudioContext ?? window.webkitAudioContext)();
    if (context.state === "suspended") context.resume();
    let at = context.currentTime;
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      // Square, because that is the only wave a buzzer knows.
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(note.hz, at);
      // A hard edge would click; a few milliseconds of ramp is what the
      // speaker itself would have done.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(note.gain, at + 0.004);
      gain.gain.setValueAtTime(note.gain, at + note.ms / 1000 - 0.006);
      gain.gain.linearRampToValueAtTime(0, at + note.ms / 1000);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + note.ms / 1000 + 0.01);
      at += note.ms / 1000;
    }
  } catch {
    // No audio available. The machine is silent; nothing else changes.
    on = false;
  }
}
