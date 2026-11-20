# Filename rename sequences with PingRoom

Plan filename swaps and chains from a frozen folder inventory. A named owner chooses each file's intended target basename in PingRoom. Code detects conflicting destinations, reserves temporary names for cycles, and simulates both the forward sequence and its reverse while preserving file identities.

The result is a local JSON plan. This starter never scans a folder or moves a file. It models a flat, exact ASCII case-sensitive namespace; an actual filesystem may have different rules.

## Run offline

Choose **Use this template**, clone your copy, and install Node.js 22 or newer with npm:

```sh
npm ci
npm test
npm run demo
```

Tests and demo use pinned `@pingroom/sdk` 0.8.0 with local mock transports. After installation they need no credentials or network and send no live pings. The demo covers a swap plus a chain, an occupied destination and an Unknown answer, then removes its temporary directories. The lockfile pins dependencies; `.npmrc` requests a 14-day minimum release age where supported by npm.

## Describe the namespace

```sh
cp examples/rename.json rename.json
cp config.example.json config.json
npm run preview
```

Edit `rename.json` before starting. Preview prints the normalized input, exact Questions and policy locally. Include **every occupied basename**, including files that will remain unchanged.

| Field | Meaning |
| --- | --- |
| `renameId` | 1–40 characters: lowercase letter first, then lowercase letters, digits, `_` or `-`. |
| `title`, `context` | Nonempty single-line text, at most 32 and 60 UTF-16 code units. |
| `namespace` | 1–32 entries, each exactly `{ "id": "file_id", "name": "original.txt" }`. IDs and names must be distinct. |
| `files` | 1–8 entries, each exactly `id`, `source`, `targets`. `id` and `source` must identify the same existing namespace entry. |
| `targets` | 1–3 candidates per file, each exactly `id` and `name`. IDs and basenames must be distinct within that file. |
| File and target `id` | 1–12 characters using the `renameId` alphabet. `unknown`, `constructor`, `prototype` and `__proto__` are reserved. |
| Basename | 1–40 ASCII characters: letter or digit first, then letters, digits, `.`, `_` or `-`. No paths, spaces or Unicode. |

File declarations, namespace entries and candidates are sorted by ID. Case matters: `Name.txt` and `name.txt` are different names in this model. An unchanged name is a valid target. Extra fields, sparse arrays, duplicate identities, control characters and changed source names are rejected before sending a Question. Every Question must fit 500 UTF-16 code units.

The example contains `a.txt` ↔ `b.txt`, a chain `c.txt` → `d.txt` → `e.txt`, and two bystanders. One bystander already occupies `pingroom-tmp-0001`, so the cycle uses `pingroom-tmp-0002`. Selecting `notes.txt` for `alpha` demonstrates a blocked collision.

## Connect the owner

Install [PingRoom](https://pingroom.io/i) and create a private standard room containing the namespace owner:

```sh
npm run connect
npm run inspect
```

Approve the printed pairing link and grant that room with room-list and create/read Questions permissions. Verify the person in the app, then set their exact member UUID and label in `config.json`. A display name alone does not establish identity.

For an existing granted connection, copy `.env.example` to `.env` and set both `PINGROOM_TOKEN` and the 12-character `PINGROOM_ROOM`. Partial credential pairs are rejected.

```sh
npm start
```

Each invocation creates at most one direct 15-minute Question or reads the active Question. Run again after the owner answers to record the result, then again to ask about the next file. There are at most eight Questions.

The buttons show candidate basenames plus **Unknown**. The Question includes the rename ID, title/context, file ID, source name, target names, participant UUID and input/file/policy hashes. The full namespace inventory stays local. Unknown, missing, expired, cancelled, invalid or misattributed answers withhold the entire sequence. This is target selection, not permission to execute file operations.

## Inspect and export

```sh
npm run status
npm run report
npm run export
```

These commands are local and require no credentials. `report` writes `.renames/report.json`, including incomplete answers or conflict diagnostics. `export` requires every target to be known and conflict-free, then atomically writes `.renames/plan.json`. Repeated export creates no Questions.

The export contains the normalized source, policy, owner, Question evidence and `analysis`:

- `mapping` binds each file ID to its original and final basename.
- `forward` contains ordered `{fileId, from, to}` steps. Every destination is free immediately before its step.
- `reverse` reverses those exact steps. It restores the declared original namespace only when started from the unmodified simulated final namespace.
- `temporaryNames` lists names reserved outside all original and selected target names.
- `initialNamespace` and `finalNamespace` retain all file IDs, including bystanders.
- `verified: true` means both sequences passed the independent local simulator. `filesRenamed` remains `false`.

Code rejects duplicate final targets and destinations occupied by unmoved files. Their report status is `conflict`, with null step sequences. A file whose target equals its source takes no steps. Among pending files, the planner first moves the smallest file ID with a free target. If none is ready, it moves the smallest pending file ID to a fresh temporary basename and continues. At most 16 steps cover eight files. The independent simulator checks source identity and destination vacancy for every step, then confirms the final mapping and full reverse restoration.

## Adapt it

Convert a retained folder export or asset manifest into the input schema, assign stable file IDs, include bystanders, and supply candidate target names from your naming rules. Have an owner who can inspect the original assets choose among them. Consume `plan.json` in a review tool or a separately implemented executor.

No executor is included. A real adapter must establish the filesystem's equality rules, reserved names, permissions and current occupancy, then protect against changes during execution. The flat model does not cover directories, symlinks, case-insensitive filesystems, Unicode normalization, platform-reserved names, concurrent writers, crash recovery or rollback of external changes. The reverse sequence describes restoration under this model; external changes can make it unusable. Do not feed its steps directly to a shell.

## Resume safely

Real inputs, credentials, state and exports are ignored by Git. Keep `.renames/` and `.pingroom/` private and intact. Changed input, participant, room or credentials cannot reuse a session. Input/config reads are limited to 64/16 KiB; state and output writes are bounded, private and atomic under a local lock.

A lost creation response leaves `create_unknown` and is never automatically resent:

```sh
npm run status
npm run find-id
npm run recover -- EXACT-QUESTION-UUID
```

Recover only the original Question. An empty bounded search does not prove creation failed. Resolve or revoke uncertain/expired pairing in Connected Agents before archiving its pending file. Remove a stale `.lock` only after confirming its process stopped. Resolve the original session before archiving it for changed inputs; never delete state to retry.

Run commands serially. Exit codes: `0` complete/local result; `1` invalid setup/evidence or refused export; `2` incomplete, unknown, conflict or failed answer; `3` pending/ready/interrupted; `4` uncertain creation. Local `status` and `report` exit 0 even when reporting an incomplete or conflicting plan; inspect the JSON `status`.

Tests include 5,913 filename permutations, collision enumeration, eight-file cycles, reverse restoration, durable recovery, attribution, pairing and the real CLI. GitHub Actions checks Node.js 22 and 24. Live phone delivery is not tested. MIT licensed.
