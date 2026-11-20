const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const record = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x, names) =>
  record(x) &&
  Object.keys(x).length === names.length &&
  names.every((name) => Object.hasOwn(x, name));
const name = (x) =>
  typeof x === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$(?![\s\S])/.test(x);
const identifier = (x) =>
  typeof x === "string" &&
  /^[a-z][a-z0-9_-]{0,11}$(?![\s\S])/.test(x) &&
  !["constructor", "prototype", "__proto__", "unknown"].includes(x);
function normalizedNamespace(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 32)
    throw new Error("Expected 1–32 namespace entries.");
  const ids = new Set(),
    names = new Set();
  return Array.from(raw, (row) => {
    if (
      !exact(row, ["id", "name"]) ||
      !identifier(row.id) ||
      !name(row.name) ||
      ids.has(row.id) ||
      names.has(row.name)
    )
      throw new Error("Invalid or duplicate namespace identity.");
    ids.add(row.id);
    names.add(row.name);
    return { ...row };
  }).sort((a, b) => order(a.id, b.id));
}

/** Array-based simulation checks each step independently of the planner's maps. */
export function simulateRenames(rawNamespace, steps) {
  const rows = normalizedNamespace(rawNamespace);
  if (!Array.isArray(steps) || steps.length > 16)
    throw new Error("Expected at most 16 rename steps.");
  for (const step of Array.from(steps)) {
    if (
      !exact(step, ["fileId", "from", "to"]) ||
      !identifier(step.fileId) ||
      !name(step.from) ||
      !name(step.to) ||
      step.from === step.to
    )
      throw new Error("Invalid rename step.");
    const source = rows.find((row) => row.name === step.from);
    if (
      !source ||
      source.id !== step.fileId ||
      rows.some((row) => row.name === step.to)
    )
      throw new Error(
        "Step reads the wrong file or overwrites an occupied basename.",
      );
    source.name = step.to;
  }
  return rows;
}

/** Pure plan for a declared flat, exact case-sensitive namespace; performs no file I/O. */
export function planRenames(rawNamespace, rawMapping) {
  const namespace = normalizedNamespace(rawNamespace);
  if (
    !Array.isArray(rawMapping) ||
    rawMapping.length < 1 ||
    rawMapping.length > 8
  )
    throw new Error("Expected 1–8 file mappings.");
  const seen = new Set();
  const mapping = Array.from(rawMapping, (row) => {
    if (
      !exact(row, ["fileId", "from", "to"]) ||
      !identifier(row.fileId) ||
      !name(row.from) ||
      !name(row.to) ||
      seen.has(row.fileId) ||
      !namespace.some(
        (entry) => entry.id === row.fileId && entry.name === row.from,
      )
    )
      throw new Error(
        "Mapping must reference distinct original file identities.",
      );
    seen.add(row.fileId);
    return { ...row };
  }).sort((a, b) => order(a.fileId, b.fileId));
  const conflicts = [];
  for (const target of [...new Set(mapping.map((row) => row.to))].sort(order)) {
    const selected = mapping.filter((row) => row.to === target);
    if (selected.length > 1)
      conflicts.push({
        type: "duplicate-target",
        target,
        fileIds: selected.map((row) => row.fileId),
      });
    const occupant = namespace.find((row) => row.name === target);
    if (occupant && !seen.has(occupant.id))
      conflicts.push({
        type: "unmoved-occupant",
        target,
        fileIds: selected.map((row) => row.fileId),
        occupantId: occupant.id,
      });
  }
  const common = {
    mapping,
    initialNamespace: namespace,
    namespacePolicy: "exact-ascii-case-sensitive",
    filesRenamed: false,
  };
  if (conflicts.length)
    return {
      ...common,
      status: "conflict",
      conflicts,
      temporaryNames: [],
      forward: null,
      reverse: null,
      finalNamespace: null,
      verified: false,
    };
  const positions = new Map(namespace.map((row) => [row.id, row.name])),
    occupied = new Map(namespace.map((row) => [row.name, row.id]));
  const pending = new Map(
    mapping
      .filter((row) => row.from !== row.to)
      .map((row) => [row.fileId, row.to]),
  );
  const reserved = new Set([
      ...namespace.map((row) => row.name),
      ...mapping.map((row) => row.to),
    ]),
    temporaryNames = [],
    forward = [];
  let counter = 1;
  const move = (fileId, to) => {
    const from = positions.get(fileId);
    if (occupied.has(to)) throw new Error("Internal occupied destination.");
    forward.push({ fileId, from, to });
    occupied.delete(from);
    occupied.set(to, fileId);
    positions.set(fileId, to);
  };
  while (pending.size) {
    const ready = [...pending.keys()]
      .filter((id) => !occupied.has(pending.get(id)))
      .sort(order)[0];
    if (ready !== undefined) {
      move(ready, pending.get(ready));
      pending.delete(ready);
      continue;
    }
    const fileId = [...pending.keys()].sort(order)[0];
    let temporary;
    do {
      temporary = `pingroom-tmp-${String(counter++).padStart(4, "0")}`;
    } while (reserved.has(temporary));
    reserved.add(temporary);
    temporaryNames.push(temporary);
    move(fileId, temporary);
  }
  const reverse = forward
    .toReversed()
    .map(({ fileId, from, to }) => ({ fileId, from: to, to: from }));
  const finalNamespace = simulateRenames(namespace, forward),
    restored = simulateRenames(finalNamespace, reverse);
  const expected = namespace.map((row) => ({
    id: row.id,
    name: mapping.find((move) => move.fileId === row.id)?.to ?? row.name,
  }));
  if (
    JSON.stringify(expected) !== JSON.stringify(finalNamespace) ||
    JSON.stringify(restored) !== JSON.stringify(namespace)
  )
    throw new Error("Plan simulation failed.");
  return {
    ...common,
    status: "ready",
    conflicts: [],
    temporaryNames,
    forward,
    reverse,
    finalNamespace,
    verified: true,
  };
}
