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

import { detectLayout, parseTable, readNetwork } from "../src/nma/parse.js";
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
