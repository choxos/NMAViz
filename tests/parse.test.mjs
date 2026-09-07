/* Reading files, and the arm-to-contrast conversion.
 *
 * The conversion is checked against netmeta::pairwise, whose output for the two
 * arm-level example networks is bundled in src/data/examples.json alongside the
 * arm-level tables it was computed from.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { detectLayout, inferMeasure, parseTable, readNetwork } from "../src/nma/parse.js";
import { fitNetwork } from "../src/nma/model.js";

const here = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(here, "..", "src", "data", "examples.json"), "utf8")
);

const csv = (columns, rows) =>
  [columns.join(","), ...rows.map((r) => r.join(","))].join("\n");

test("a comma separated contrast file is read", () => {
  const text = csv(
    ["study", "treat1", "treat2", "TE", "seTE"],
    [
      ["Trial A", "drug", "placebo", "-0.4", "0.2"],
      ["Trial B", "drug", "other", "0.1", "0.3"],
    ]
  );
  const network = readNetwork(text);
  assert.equal(network.layout, "contrast");
  assert.equal(network.contrasts.length, 2);
  assert.deepEqual(network.contrasts[0], {
    studlab: "Trial A",
    treat1: "drug",
    treat2: "placebo",
    TE: -0.4,
    seTE: 0.2,
  });
});

test("tabs, semicolons and quoted fields are handled", () => {
  const text =
    'study\ttreat1\ttreat2\tTE\tseTE\n"Smith, 2001"\ta\tb\t0.5\t0.1';
  const network = readNetwork(text);
  assert.equal(network.contrasts[0].studlab, "Smith, 2001");

  const semicolons = "study;treat1;treat2;TE;seTE\ns1;a;b;0.5;0.1";
  assert.equal(parseTable(semicolons).delimiter, ";");
});

test("column names are recognized under their common aliases", () => {
  const text = csv(
    ["trial", "t1", "t2", "lnOR", "selnOR"],
    [["1", "a", "b", "0.2", "0.4"]]
  );
  const layout = detectLayout(parseTable(text));
  assert.equal(layout.layout, "contrast");
  assert.deepEqual(layout.columns, {
    studlab: "trial",
    treat1: "t1",
    treat2: "t2",
    TE: "lnOR",
    seTE: "selnOR",
  });
});

test("an unreadable header names the columns it found", () => {
  const text = csv(["a", "b", "c"], [["1", "2", "3"]]);
  assert.throws(() => readNetwork(text), /could not be recognized[\s\S]*a, b, c/);
});

test("a ragged line is reported with its line number", () => {
  const text = "study,treat1,treat2,TE,seTE\n1,a,b,0.2";
  assert.throws(() => readNetwork(text), /Line 2 has 4 fields/);
});

for (const example of examples.filter((e) => e.arms)) {
  test(`${example.id}: arm level data converts to netmeta's contrasts`, () => {
    const arms = example.arms;
    const text = csv(
      ["studlab", "treatment", "event", "n"],
      arms.studlab.map((_, i) => [
        JSON.stringify(String(arms.studlab[i])),
        JSON.stringify(arms.treatment[i]),
        arms.event[i],
        arms.n[i],
      ])
    );
    const network = readNetwork(text, { measure: "OR" });

    const expected = new Map();
    example.contrasts.studlab.forEach((studlab, i) => {
      const key = `${studlab}|${example.contrasts.treat1[i]}|${example.contrasts.treat2[i]}`;
      expected.set(key, {
        TE: example.contrasts.TE[i],
        seTE: example.contrasts.seTE[i],
      });
    });

    assert.equal(
      network.contrasts.length,
      example.contrasts.studlab.length,
      "different number of contrasts than netmeta produced"
    );
    for (const row of network.contrasts) {
      const key = `${row.studlab}|${row.treat1}|${row.treat2}`;
      const want = expected.get(key);
      assert.ok(want, `netmeta has no contrast ${key}`);
      assert.ok(
        Math.abs(row.TE - want.TE) < 1e-9,
        `${key}: TE ${row.TE} differs from netmeta's ${want.TE}`
      );
      assert.ok(
        Math.abs(row.seTE - want.seTE) < 1e-9,
        `${key}: seTE ${row.seTE} differs from netmeta's ${want.seTE}`
      );
    }
  });
}

test("every bundled example fits without error", () => {
  for (const example of examples) {
    const c = example.contrasts;
    const rows = c.studlab.map((_, i) => ({
      studlab: String(c.studlab[i]),
      treat1: c.treat1[i],
      treat2: c.treat2[i],
      TE: c.TE[i],
      seTE: c.seTE[i],
    }));
    const fit = fitNetwork(rows);
    assert.ok(fit.treatments.length >= 3, `${example.id} has too few treatments`);
    assert.ok(Number.isFinite(fit.Q), `${example.id} has a non-finite Q`);
  }
});

/* The scale a contrast file is on is a guess, and the default has to be the
 * harmless one: exponentiating a mean difference would move every number and
 * the line of no difference, while leaving a log odds ratio on the log scale
 * only fails to prettify it. */
test("the effect measure is read from the effect column, and defaults to the identity scale", () => {
  assert.equal(inferMeasure("lnOR"), "OR");
  assert.equal(inferMeasure("logRR"), "RR");
  assert.equal(inferMeasure("log_hr"), "HR");
  assert.equal(inferMeasure("SMD"), "SMD");
  // Every neutral alias the column detector accepts has to land on the
  // identity scale, since none of them says anything about the scale.
  for (const name of ["TE", "effect", "yi", "y", "estimate", "md", "diff", undefined])
    assert.equal(inferMeasure(name), "MD", `${name} should be read on the identity scale`);

  const md = readNetwork("study,treat1,treat2,TE,seTE\nA,x,y,-0.42,0.19\nB,y,z,0.10,0.22");
  assert.equal(md.measure, "MD");

  const or = readNetwork("id,treat1,treat2,lnOR,selnOR\nA,x,y,-0.42,0.19\nB,y,z,0.10,0.22");
  assert.equal(or.measure, "OR");
});


test("invalid arm domains and identities are refused before conversion", () => {
  const continuous = (a) => `study,treatment,n,mean,sd\ns,A,${a}\ns,B,10,1,1`;
  for (const a of ["10,2,-1", "0,2,1", "10.5,2,1", "10,,1", "10,2,"])
    assert.throws(() => readNetwork(continuous(a)), /Line 2/);
  for (const [event, n] of [[-1, 10], [11, 10], [1.5, 10], [1, 0], [1, 10.5]])
    assert.throws(() => readNetwork(`study,treatment,n,event\ns,A,${n},${event}\ns,B,10,2`), /Line 2/);
  for (const first of [",A,10,2", "s,,10,2", "s,B,10,2"])
    assert.throws(() => readNetwork(`study,treatment,n,event\n${first}\ns,B,10,2`), /study|treatment|duplicate/i);
  const valid = readNetwork("study,treatment,n,event\ns,A,10,0\ns,B,10,10");
  assert.equal(valid.contrasts.length, 1);
  assert.ok(Number.isFinite(valid.contrasts[0].TE));
  assert.equal(readNetwork(continuous("10,2,0")).contrasts.length, 1);
});
