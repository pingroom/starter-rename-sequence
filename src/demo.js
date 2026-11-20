import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson } from "./storage.js";
import { step, exportPlan } from "./engine.js";
import { mockApi, CONFIG, ROOM_CODE } from "./mock.js";

const fixture = await readJson(
  new URL("../examples/rename.json", import.meta.url),
  65536,
);
for (const [scenario, choices] of [
  ["complete", ["target1", "target1", "target1", "target1"]],
  ["conflict", ["target2", "target1", "target1", "target1"]],
  ["unknown", ["target1", "unknown", "target1", "target1"]],
]) {
  const directory = await mkdtemp(join(tmpdir(), "pingroom-rename-demo-"));
  try {
    const now = () => "2026-01-01T09:00:00.000Z",
      api = mockApi(now);
    const options = {
      client: api.client,
      directory,
      input: fixture,
      config: CONFIG,
      token: "offline-fixture-token",
      room: ROOM_CODE,
      now,
    };
    let result;
    for (const choice of choices) {
      const pending = await step(options),
        question = pending.answers.find(
          (answer) => answer.status === "pending",
        );
      api.answer(question.questionId, choice);
      result = await step(options);
    }
    assert.equal(api.calls.filter((call) => call.method === "POST").length, 4);
    assert.equal(result.status, scenario);
    if (scenario === "complete") {
      assert.equal(result.analysis.verified, true);
      await exportPlan(directory, fixture);
    } else await assert.rejects(exportPlan(directory, fixture));
    console.log(
      JSON.stringify(
        {
          scenario,
          transport: "local mock through the real SDK; no live delivery",
          status: result.status,
          analysis: result.analysis,
          unknownFileIds: result.unknownFileIds,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
