import { createHash } from "node:crypto";

export const TTL = 900;
export const CLOCK_SKEW_MS = 60000;
export const TOKEN = /^[^\s\x00-\x1f\x7f]{1,8192}(?![\s\S])/;
export const ROOM = /^[A-Z0-9]{12}$(?![\s\S])/;
export const isId = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/.test(
    value,
  );
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) => {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort(),
    wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
};
const word = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{0,39}$(?![\s\S])/.test(value);
const line = (value, max) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  value.isWellFormed() &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) &&
  value.trim() === value;
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : record(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

export function iso(raw) {
  if (
    typeof raw !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$(?![\s\S])/.test(
      raw,
    )
  )
    throw new Error("Expected a UTC timestamp.");
  const time = Date.parse(raw);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 19) !== raw.slice(0, 19)
  )
    throw new Error("Invalid UTC timestamp.");
  return new Date(time).toISOString();
}

import { planRenames } from "./planner.js";

const safeId = (value) =>
  word(value) &&
  value.length <= 12 &&
  !["constructor", "prototype", "__proto__", "unknown"].includes(value);
const basename = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$(?![\s\S])/.test(value);
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const POLICY = Object.freeze({
  name: "flat-ascii-rename-v1",
  namespace:
    "complete supplied flat namespace, exact ASCII case-sensitive equality",
  selection:
    "one named owner chooses a supplied target for each file; Unknown withholds the plan",
  conflicts:
    "reject duplicate final targets and targets occupied by unmoved files",
  sequence:
    "smallest ready file ID first; otherwise smallest pending file moves to a reserved temporary name",
  verification:
    "simulate forward from original namespace, then reverse from final namespace, preserving file IDs",
  execution: "local plan only; never scans or renames actual files",
});
export const POLICY_HASH = hash(POLICY);
function promptFor(input, file) {
  return `${input.title} (${input.renameId})\n${input.context}\nFile ${file.id}: ${file.source}\nChoose its intended final basename from the buttons. Exact ASCII case-sensitive namespace. Unknown withholds the plan. This selects a local plan only; no files are renamed.`;
}
export function validateInput(input) {
  if (
    !keys(input, ["renameId", "title", "context", "namespace", "files"]) ||
    !word(input.renameId) ||
    !line(input.title, 32) ||
    !line(input.context, 60) ||
    !Array.isArray(input.namespace) ||
    input.namespace.length < 1 ||
    input.namespace.length > 32 ||
    !Array.isArray(input.files) ||
    input.files.length < 1 ||
    input.files.length > 8
  )
    throw new Error(
      "Supply rename metadata, 1–32 occupied basenames and 1–8 moving files.",
    );
  const ids = new Set(),
    names = new Set();
  const namespace = Array.from(input.namespace, (entry) => {
    if (
      !keys(entry, ["id", "name"]) ||
      !safeId(entry.id) ||
      ids.has(entry.id) ||
      !basename(entry.name) ||
      names.has(entry.name)
    )
      throw new Error(
        "Namespace needs distinct safe file IDs and distinct ASCII basenames.",
      );
    ids.add(entry.id);
    names.add(entry.name);
    return { ...entry };
  }).sort((a, b) => order(a.id, b.id));
  const moving = new Set();
  const files = Array.from(input.files, (file) => {
    if (
      !keys(file, ["id", "source", "targets"]) ||
      !safeId(file.id) ||
      moving.has(file.id) ||
      !namespace.some(
        (entry) => entry.id === file.id && entry.name === file.source,
      ) ||
      !Array.isArray(file.targets) ||
      file.targets.length < 1 ||
      file.targets.length > 3
    )
      throw new Error(
        "Moving files need distinct existing file IDs, exact source names and 1–3 targets.",
      );
    moving.add(file.id);
    const targetIds = new Set(),
      targetNames = new Set();
    const targets = Array.from(file.targets, (target) => {
      if (
        !keys(target, ["id", "name"]) ||
        !safeId(target.id) ||
        targetIds.has(target.id) ||
        !basename(target.name) ||
        targetNames.has(target.name)
      )
        throw new Error(
          "Targets need distinct safe option IDs and distinct ASCII basenames.",
        );
      targetIds.add(target.id);
      targetNames.add(target.name);
      return { ...target };
    }).sort((a, b) => order(a.id, b.id));
    return { id: file.id, source: file.source, targets };
  }).sort((a, b) => order(a.id, b.id));
  const result = {
    renameId: input.renameId,
    title: input.title,
    context: input.context,
    namespace,
    files,
  };
  if (files.some((file) => promptFor(result, file).length > 500))
    throw new Error("Filename Question exceeds 500 UTF-16 units.");
  return result;
}
export function validateConfig(config) {
  if (
    !keys(config, ["participant"]) ||
    !keys(config.participant, ["id", "label"]) ||
    !isId(config.participant.id) ||
    !line(config.participant.label, 60)
  )
    throw new Error("Config requires an exact namespace owner UUID and label.");
  return structuredClone(config);
}
export const itemsFor = (input) => validateInput(input).files;
export function previewInput(rawInput) {
  const source = validateInput(rawInput);
  return {
    source,
    sourceHash: hash(source),
    policy: POLICY,
    policyHash: POLICY_HASH,
    questions: source.files.map((file) => ({
      fileId: file.id,
      prompt: promptFor(source, file),
      choices: [
        ...file.targets.map((target) => ({
          value: target.id,
          label: target.name,
        })),
        { value: "unknown", label: "Unknown" },
      ],
    })),
  };
}
export function requestFor(rawInput, config, itemId, attemptId) {
  const input = validateInput(rawInput);
  validateConfig(config);
  const file = input.files.find((file) => file.id === itemId);
  if (!file || !isId(attemptId))
    throw new Error("Invalid moving file or attempt.");
  const key = `rename-${attemptId}`;
  return {
    prompt: promptFor(input, file),
    context: `To ${config.participant.id}`,
    options: [
      ...file.targets.map((target) => ({
        value: target.id,
        label: target.name,
        style: "default",
      })),
      { value: "unknown", label: "Unknown", style: "default" },
    ],
    responder_scope: "direct",
    target_user_id: config.participant.id,
    ttl: TTL,
    correlation_id: key,
    data: {
      input_hash: hash(input),
      file_hash: hash(file),
      policy_hash: POLICY_HASH,
      item_id: file.id,
      attempt_id: attemptId,
    },
    idempotencyKey: key,
  };
}
export function renamePlan(rawInput, answers) {
  const input = validateInput(rawInput);
  if (
    !Array.isArray(answers) ||
    answers.length !== input.files.length ||
    Array.from(answers).some(
      (row, i) =>
        !keys(row, ["fileId", "choice"]) ||
        row.fileId !== input.files[i].id ||
        ![
          null,
          "unknown",
          ...input.files[i].targets.map((target) => target.id),
        ].includes(row.choice),
    )
  )
    throw new Error(
      "Supply one ordered supplied target, Unknown or null decision per file.",
    );
  const missingFileIds = answers
      .filter((row) => row.choice === null)
      .map((row) => row.fileId),
    unknownFileIds = answers
      .filter((row) => row.choice === "unknown")
      .map((row) => row.fileId);
  if (missingFileIds.length || unknownFileIds.length)
    return {
      status: missingFileIds.length ? "incomplete" : "unknown",
      missingFileIds,
      unknownFileIds,
      analysis: null,
    };
  const mapping = input.files.map((file, i) => ({
    fileId: file.id,
    from: file.source,
    to: file.targets.find((target) => target.id === answers[i].choice).name,
  }));
  const analysis = planRenames(input.namespace, mapping);
  return {
    status: analysis.status === "ready" ? "complete" : "conflict",
    missingFileIds,
    unknownFileIds,
    analysis,
  };
}

export function validateState(state, rawInput) {
  const input = validateInput(rawInput);
  if (
    !keys(state, [
      "version",
      "inputHash",
      "config",
      "room",
      "credentialHash",
      "startedAt",
      "attempts",
    ]) ||
    state.version !== 1 ||
    state.inputHash !== hash(input) ||
    typeof state.room !== "string" ||
    !ROOM.test(state.room) ||
    typeof state.credentialHash !== "string" ||
    !/^[0-9a-f]{64}$(?![\s\S])/.test(state.credentialHash) ||
    !Array.isArray(state.attempts) ||
    state.attempts.length > itemsFor(input).length ||
    iso(state.startedAt) !== state.startedAt
  )
    throw new Error(
      "Invalid state or changed rename input. Restore the original input and configuration.",
    );
  validateConfig(state.config);
  const items = itemsFor(input),
    ids = new Set(),
    questionIds = new Set();
  let previous = state.startedAt,
    askerId;
  for (const [index, attempt] of state.attempts.entries()) {
    if (
      !keys(attempt, [
        "id",
        "itemId",
        "createdAt",
        "request",
        "questionId",
        "status",
        "observation",
      ]) ||
      !isId(attempt.id) ||
      ids.has(attempt.id) ||
      attempt.itemId !== items[index].id ||
      iso(attempt.createdAt) !== attempt.createdAt ||
      attempt.createdAt < previous ||
      hash(attempt.request) !==
        hash(requestFor(input, state.config, attempt.itemId, attempt.id)) ||
      ![
        "creating",
        "pending",
        "answered",
        "expired",
        "cancelled",
        "invalid_answer",
      ].includes(attempt.status)
    )
      throw new Error("Invalid saved filename selection or order.");
    ids.add(attempt.id);
    previous = attempt.createdAt;
    if (attempt.status === "creating") {
      if (attempt.questionId !== null || attempt.observation !== null)
        throw new Error("Invalid uncertain creation state.");
    } else {
      if (!isId(attempt.questionId) || questionIds.has(attempt.questionId))
        throw new Error("Invalid or repeated Question ID.");
      questionIds.add(attempt.questionId);
      validateObservation(attempt.observation, attempt.status, attempt.request);
      if (attempt.observation.checkedAt < attempt.createdAt)
        throw new Error("Observation predates its saved creation intent.");
      previous = attempt.observation.checkedAt;
      if (
        Date.parse(attempt.observation.createdAt) <
        Date.parse(attempt.createdAt) - CLOCK_SKEW_MS
      )
        throw new Error("Question predates its saved creation intent.");
      if (askerId !== undefined && attempt.observation.askerId !== askerId)
        throw new Error("Questions belong to different asking registrations.");
      askerId = attempt.observation.askerId;
    }
    if (
      ["creating", "pending"].includes(attempt.status) &&
      index !== state.attempts.length - 1
    )
      throw new Error(
        "Only the last confirmation may have an active Question.",
      );
  }
  return state;
}

export function report(state, rawInput) {
  const input = validateInput(rawInput);
  validateState(state, input);
  const answers = input.files.map((file) => {
    const attempt = state.attempts.find((row) => row.itemId === file.id),
      answer = attempt?.observation?.answer;
    return {
      fileId: file.id,
      status:
        attempt?.status === "creating"
          ? "create_unknown"
          : (attempt?.status ?? "unasked"),
      choice: answer?.value ?? null,
      label: answer?.label ?? null,
      questionId: attempt?.questionId ?? null,
      attemptId: attempt?.id ?? null,
      responderId: answer?.responderId ?? null,
      answeredAt: answer?.answeredAt ?? null,
      askerId: attempt?.observation?.askerId ?? null,
      observedAt: attempt?.observation?.checkedAt ?? null,
    };
  });
  const calculation = renamePlan(
    input,
    answers.map(({ fileId, choice }) => ({ fileId, choice })),
  );
  const active = answers.find((row) =>
    ["create_unknown", "pending"].includes(row.status),
  );
  const status =
    active?.status ??
    (answers.some((row) => row.status === "unasked")
      ? "ready"
      : calculation.status);
  return {
    version: 1,
    renameId: input.renameId,
    sourceHash: hash(input),
    source: input,
    policy: POLICY,
    policyHash: POLICY_HASH,
    participant: state.config.participant,
    room: state.room,
    configHash: hash(state.config),
    answers,
    ...calculation,
    status,
  };
}

function validateObservation(observation, status, request) {
  if (
    !keys(observation, [
      "createdAt",
      "expiresAt",
      "checkedAt",
      "askerId",
      "resolvedAt",
      "answer",
    ]) ||
    !isId(observation.askerId)
  )
    throw new Error("Invalid saved observation.");
  for (const key of ["createdAt", "expiresAt", "checkedAt"])
    if (iso(observation[key]) !== observation[key])
      throw new Error("Invalid saved timestamp.");
  const duration =
    Date.parse(observation.expiresAt) - Date.parse(observation.createdAt);
  if (duration < TTL * 1000 - 1000 || duration > TTL * 1000 + 1000)
    throw new Error("Question lifetime differs from the saved request.");
  const latest = Date.parse(observation.checkedAt) + CLOCK_SKEW_MS;
  if (Date.parse(observation.createdAt) > latest)
    throw new Error(
      "Question creation is implausibly in the future. Check the local clock.",
    );
  if (status === "pending") {
    if (observation.resolvedAt !== null)
      throw new Error("Pending Question has a resolution timestamp.");
  } else if (
    iso(observation.resolvedAt) !== observation.resolvedAt ||
    observation.resolvedAt < observation.createdAt ||
    Date.parse(observation.resolvedAt) > latest ||
    (status === "expired"
      ? observation.resolvedAt < observation.expiresAt
      : observation.resolvedAt > observation.expiresAt)
  )
    throw new Error("Invalid Question resolution time.");
  if (status === "answered") {
    const answer = observation.answer;
    if (
      !keys(answer, ["value", "label", "responderId", "answeredAt"]) ||
      answer.responderId !== request.target_user_id ||
      !request.options.some(
        (option) =>
          option.value === answer.value && option.label === answer.label,
      ) ||
      iso(answer.answeredAt) !== answer.answeredAt ||
      answer.answeredAt !== observation.resolvedAt ||
      answer.answeredAt < observation.createdAt ||
      answer.answeredAt > observation.expiresAt
    )
      throw new Error("Invalid saved filename selection evidence.");
  } else if (observation.answer !== null)
    throw new Error(
      "Unanswered filename selections must not contain filename selection evidence.",
    );
}

export function observeQuestion(q, request, questionId, room, checkedAt) {
  if (
    !isId(questionId) ||
    q?.id !== questionId ||
    q.kind !== "question" ||
    (q.is_handoff !== undefined && q.is_handoff !== false) ||
    q.asker?.type !== "agent" ||
    !isId(q.asker?.id) ||
    q.prompt !== request.prompt ||
    q.context !== request.context ||
    q.responder_scope !== "direct" ||
    q.target_user_id !== request.target_user_id ||
    q.resolution_policy !== "first" ||
    (q.results !== undefined && q.results !== null) ||
    q.text_input !== null ||
    q.correlation_id !== request.correlation_id ||
    q.reply_to !== null ||
    hash(q.data) !== hash(request.data) ||
    (q.room_code ?? q.room?.code) !== room ||
    (q.room_code !== undefined && q.room_code !== room) ||
    (q.room !== undefined && q.room?.code !== room) ||
    !["pending", "answered", "expired", "cancelled"].includes(q.state) ||
    !Array.isArray(q.options) ||
    q.options.length !== request.options.length ||
    Array.from(q.options).some(
      (option, index) =>
        option?.value !== request.options[index].value ||
        option?.label !== request.options[index].label ||
        (option?.primary !== undefined && option.primary !== false) ||
        (option?.destructive !== undefined && option.destructive !== false),
    )
  )
    throw new Error(
      "Question does not match the saved configuration, room, or reviewer.",
    );
  const observation = {
    createdAt: iso(q.created_at),
    expiresAt: iso(q.expires_at),
    checkedAt: iso(checkedAt),
    askerId: q.asker.id,
    resolvedAt: q.resolved_at === null ? null : iso(q.resolved_at),
    answer: null,
  };
  let status = q.state === "answered" ? "invalid_answer" : q.state;
  if (q.state !== "answered" && q.answer !== null)
    throw new Error("Unresolved Question includes an unexpected answer.");
  if (q.state === "answered") {
    const answer = q.answer;
    try {
      if (
        !answer ||
        answer.text !== null ||
        answer.responder?.id !== request.target_user_id ||
        !request.options.some(
          (option) =>
            option.value === answer.value && option.label === answer.label,
        )
      )
        throw new Error("Invalid answer.");
      observation.answer = {
        value: answer.value,
        label: answer.label,
        responderId: answer.responder.id,
        answeredAt: iso(answer.answered_at),
      };
      validateObservation(observation, "answered", request);
      status = "answered";
    } catch {
      observation.answer = null;
    }
  }
  validateObservation(observation, status, request);
  return { status, observation };
}

export function assertParticipantRoom(rooms, room, participantId) {
  if (!Array.isArray(rooms) || rooms.length > 1000)
    throw new Error("Invalid room inventory.");
  const matches = rooms.filter((item) => item?.invite_code === room),
    selected = matches[0];
  if (
    matches.length !== 1 ||
    selected.type !== "standard" ||
    selected.is_public !== false ||
    !Array.isArray(selected.members) ||
    selected.members.length > 1000 ||
    !selected.members.some((member) => member?.user_id === participantId)
  )
    throw new Error(
      "Use a granted standard private room containing the named participant.",
    );
}
