import test from "node:test";
import assert from "node:assert/strict";
import { planRenames, simulateRenames } from "../src/planner.js";
import {
  validateInput,
  previewInput,
  renamePlan,
  requestFor,
} from "../src/model.js";
import { readJson } from "../src/storage.js";
import { CONFIG, id } from "../src/mock.js";
const example = await readJson(
  new URL("../examples/rename.json", import.meta.url),
);
const namespace = (names) => names.map((name, i) => ({ id: `f${i}`, name }));
const mapping = (entries, targets) =>
  entries.map((entry, i) => ({
    fileId: entry.id,
    from: entry.name,
    to: targets[i],
  }));
function oracle(entries, moves, steps) {
  const byIdentity = Object.fromEntries(
      entries.map((row) => [row.id, row.name]),
    ),
    initial = structuredClone(byIdentity);
  for (const step of steps) {
    assert.equal(byIdentity[step.fileId], step.from);
    assert.equal(Object.values(byIdentity).includes(step.to), false);
    byIdentity[step.fileId] = step.to;
    assert.equal(new Set(Object.values(byIdentity)).size, entries.length);
  }
  for (const [fileId, name] of Object.entries(initial))
    assert.equal(
      byIdentity[fileId],
      moves.find((row) => row.fileId === fileId)?.to ?? name,
    );
  return byIdentity;
}
function permutations(values) {
  if (!values.length) return [[]];
  return values.flatMap((value, i) =>
    permutations(values.filter((_, j) => i !== j)).map((rest) => [
      value,
      ...rest,
    ]),
  );
}

test("swap plus chain preserves bystanders and avoids original and target temporary names", () => {
  const input = validateInput(example),
    result = renamePlan(
      input,
      input.files.map((file) => ({ fileId: file.id, choice: "target1" })),
    );
  assert.equal(result.status, "complete");
  assert.deepEqual(result.analysis.temporaryNames, ["pingroom-tmp-0002"]);
  assert.equal(result.analysis.forward.length, 5);
  oracle(input.namespace, result.analysis.mapping, result.analysis.forward);
  assert.deepEqual(
    simulateRenames(result.analysis.finalNamespace, result.analysis.reverse),
    input.namespace,
  );
  const reserved = namespace(["a", "b", "pingroom-tmp-0001"]);
  const plan = planRenames(reserved, [
    { fileId: "f0", from: "a", to: "b" },
    { fileId: "f1", from: "b", to: "a" },
    { fileId: "f2", from: "pingroom-tmp-0001", to: "pingroom-tmp-0002" },
  ]);
  assert.deepEqual(plan.temporaryNames, ["pingroom-tmp-0003"]);
});
test("all permutations through seven files independently restore identities with bounded steps", () => {
  let count = 0;
  for (let n = 1; n <= 7; n++) {
    const entries = namespace(Array.from({ length: n }, (_, i) => `n${i}`));
    for (const targets of permutations(entries.map((row) => row.name))) {
      const moves = mapping(entries, targets),
        plan = planRenames(entries, moves);
      assert.equal(plan.status, "ready");
      assert.ok(plan.forward.length <= 2 * n);
      const final = oracle(entries, moves, plan.forward);
      oracle(
        Object.entries(final).map(([id, name]) => ({ id, name })),
        entries.map((row) => ({
          fileId: row.id,
          from: final[row.id],
          to: row.name,
        })),
        plan.reverse,
      );
      assert.deepEqual(
        planRenames(entries.toReversed(), moves.toReversed()),
        plan,
      );
      count++;
    }
  }
  assert.equal(count, 5913);
});
test("every three-file target combination identifies collisions before making a plan", () => {
  const entries = namespace(["a", "b", "c", "bystander"]);
  let count = 0;
  for (const a of ["a", "b", "c", "bystander", "new"])
    for (const b of ["a", "b", "c", "bystander", "new"])
      for (const c of ["a", "b", "c", "bystander", "new"]) {
        const targets = [a, b, c],
          moves = mapping(entries.slice(0, 3), targets),
          plan = planRenames(entries, moves),
          conflict = new Set(targets).size < 3 || targets.includes("bystander");
        assert.equal(plan.status, conflict ? "conflict" : "ready");
        if (conflict) {
          assert.equal(plan.forward, null);
          assert.equal(plan.reverse, null);
          assert.equal(plan.verified, false);
          assert.ok(plan.conflicts.length > 0);
        } else oracle(entries, moves, plan.forward);
        count++;
      }
  assert.equal(count, 125);
});
test("no-op and exact-case rename have explicit narrow semantics", () => {
  const entries = namespace(["name.txt", "Name.txt"]),
    same = planRenames(entries, [
      { fileId: "f0", from: "name.txt", to: "name.txt" },
    ]);
  assert.deepEqual(same.forward, []);
  assert.deepEqual(same.reverse, []);
  assert.equal(
    planRenames(entries, [{ fileId: "f0", from: "name.txt", to: "Name.txt" }])
      .status,
    "conflict",
  );
  const changed = planRenames(namespace(["name.txt"]), [
    { fileId: "f0", from: "name.txt", to: "NAME.txt" },
  ]);
  assert.equal(changed.forward.length, 1);
  assert.equal(changed.namespacePolicy, "exact-ascii-case-sensitive");
});
test("eight-file cycle and multiple disjoint swaps have reversible bounded output", () => {
  const entries = namespace(Array.from({ length: 8 }, (_, i) => `n${i}`));
  for (const targets of [
    [...entries.slice(1).map((row) => row.name), "n0"],
    ["n1", "n0", "n3", "n2", "n5", "n4", "n7", "n6"],
  ]) {
    const moves = mapping(entries, targets),
      plan = planRenames(entries, moves);
    oracle(entries, moves, plan.forward);
    assert.deepEqual(
      simulateRenames(plan.finalNamespace, plan.reverse),
      entries,
    );
    assert.ok(plan.forward.length <= 16);
  }
});
test("independent simulator rejects overwritten, misidentified, missing, malformed or no-op steps", () => {
  const entries = namespace(["a", "b"]);
  for (const step of [
    { fileId: "f0", from: "a", to: "b" },
    { fileId: "f1", from: "a", to: "c" },
    { fileId: "f0", from: "missing", to: "c" },
    { fileId: "f0", from: "a", to: "a" },
    { fileId: "f0", from: "a", to: "../c" },
    { fileId: "f0", from: "a", to: "c", extra: true },
  ])
    assert.throws(() => simulateRenames(entries, [step]));
  assert.throws(() => simulateRenames(entries, new Array(1)));
});
test("selection binds option identity to basename and never guesses Unknown or missing choices", () => {
  const input = validateInput(example),
    choices = input.files.map((file) => ({
      fileId: file.id,
      choice: "target1",
    }));
  assert.equal(renamePlan(input, choices).status, "complete");
  choices[0].choice = "unknown";
  assert.equal(renamePlan(input, choices).status, "unknown");
  assert.equal(renamePlan(input, choices).analysis, null);
  choices[1].choice = null;
  assert.equal(renamePlan(input, choices).status, "incomplete");
  choices[0].choice = "b.txt";
  assert.throws(() => renamePlan(input, choices));
  assert.throws(() => renamePlan(input, []));
  assert.throws(() => renamePlan(input, new Array(input.files.length)));
  const request = requestFor(input, CONFIG, "alpha", id(1));
  assert.equal(request.options[0].value, "target1");
  assert.equal(request.options[0].label, "b.txt");
  assert.equal(request.options.at(-1).value, "unknown");
});
test("source validation refuses unsafe names, changed identities, duplicate targets and sparse declarations", () => {
  for (const mutate of [
    (x) => {
      x.namespace[0].name = "../bad";
    },
    (x) => {
      x.namespace[0].name = "é.txt";
    },
    (x) => {
      x.namespace[0].name = "a.txt\n";
    },
    (x) => {
      x.namespace[0].name = "a b";
    },
    (x) => {
      x.namespace[0].name = ".";
    },
    (x) => {
      x.namespace[0].id = "constructor";
    },
    (x) => {
      x.files[0].source = "missing";
    },
    (x) => {
      x.files[0].targets.push({ ...x.files[0].targets[0] });
    },
    (x) => {
      x.files[0].targets[0].id = "unknown";
    },
    (x) => {
      x.files = [];
    },
    (x) => {
      x.files = new Array(1);
    },
    (x) => {
      x.namespace = new Array(1);
    },
    (x) => {
      x.files[0].targets = new Array(1);
    },
    (x) => {
      x.extra = true;
    },
    (x) => {
      x.namespace.push({ ...x.namespace[0] });
    },
  ]) {
    const input = structuredClone(example);
    mutate(input);
    assert.throws(() => validateInput(input));
  }
  assert.throws(() =>
    planRenames(namespace(["a"]), [{ fileId: "f0", from: "wrong", to: "b" }]),
  );
  assert.throws(() => planRenames(namespace(["a"]), new Array(1)));
});
test("preview preflights all exact prompts and canonical ordering without modifying source", () => {
  const input = structuredClone(example),
    before = structuredClone(input);
  input.files.reverse();
  input.namespace.reverse();
  input.files.forEach((file) => file.targets.reverse());
  const preview = previewInput(input);
  assert.deepEqual(preview.source, validateInput(before));
  assert.ok(
    preview.questions.every(
      (q) =>
        q.prompt.length <= 500 &&
        q.choices.length >= 2 &&
        q.choices.length <= 4,
    ),
  );
  assert.equal(input.files[0].id, "delta");
  assert.ok(preview.questions[0].prompt.includes("a.txt"));
});
