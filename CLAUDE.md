# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Electron desktop app that turns events from **Thorium** (the starship-bridge simulator in the sibling repo `../thorium`), **MQTT** and its own UI into **DMX output** (sACN/E1.31 to a lighting controller — Pharos Mosaic on this site — or an Enttec USB DMX Pro). Requirements live in `docs/PRD_claude.md`, the design in `docs/ERD_claude.md`; read those before changing behavior. Thorium itself is never modified.

## Commands

Node 22 is required (`.nvmrc`). If the shell defaults to another Node, prefix commands with `export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"`. Installing under Node 20 fails on `@electron/rebuild`. Package manager is yarn 1; `postinstall` rebuilds `serialport` for Electron.

| Task | Command |
|---|---|
| Dev with hot reload | `yarn dev` |
| Typecheck (main+preload+shared, then renderer) | `yarn typecheck` |
| Lint (ESLint + Prettier rules) | `yarn lint` — run `npx prettier --write "src/**/*.{ts,tsx}"` first; Prettier violations are lint errors |
| All tests | `yarn test` |
| One test file | `npx vitest run src/main/core/compositor/compositor.test.ts` |
| Tests matching a name | `npx vitest run -t "fade in"` |
| Production bundle to `out/` | `npx electron-vite build` (or `yarn build`, which typechecks first) |
| Run the built app against a scratch profile | `npx electron out/main/index.js --user-data-dir=/tmp/somedir` (add `--remote-debugging-port=9333` to drive the renderer over CDP) |
| Installers | `yarn build:win` / `yarn build:mac` |
| Regenerate Thorium event-name list | `yarn gen:thorium-events` (reads `../thorium/src/schema.graphql`) |

Tests use Vitest in a Node environment. Main-process modules that import `../logging` (electron-log) must be mocked in tests with `vi.mock('../logging', ...)`; see `protocol.test.ts` for the pattern. The Thorium adapter test spins up a fake `subscriptions-transport-ws` server and stubs `fetch`.

## Architecture

Three Electron layers with a strict split:

- `src/shared/` — pure TypeScript imported by **both** main and renderer (no Node or Electron imports). Holds the zod config schema (`schema/config.schema.ts`, the single source of truth for types), migrations, the trigger catalog/matcher, seed data and IPC contracts.
- `src/main/` — everything that must keep running when the window is closed: sources, rules engine, compositor, DMX drivers, config store, tray.
- `src/renderer/` — React 19 + Tailwind 4 + Zustand + Radix. Renderer is sandboxed and only talks to main through `window.api.invoke` / `window.api.on` (contract in `shared/types/ipc.ts`, implemented in `main/ipc/router.ts`, exposed by `preload/index.ts`).

### Data flow (main process)

```
ThoriumAdapter / MqttAdapter / UI ──► EventBus ──► RulesEngine (matcher + ActionRunner)
                                          │                       │
                                       EventLog            Compositor (layers, fades, blackout, GM)
                                                                  │  40 Hz Scheduler tick
                                                           OutputManager ──► SacnOutput / EnttecProOutput
```

`main/services.ts` wires all of this together and is the command surface used by IPC, the tray and the MQTT `cmd` topic. Every source emits a normalized `AppEvent` (`shared/types/events.ts`); trigger conditions resolve dot-paths against `event.data`.

### Key concepts that span files

- **Trigger presets** (`shared/triggers/catalog.ts`) are UI sugar: each preset declares a form and a `compile()` that produces `{types, names, conditions}` for the generic matcher. Adding a trigger type means adding a preset there; the renderer's `TriggerPicker` renders forms from the descriptor automatically. Presets whose params reference Thorium objects by name (macros, buttons, timeline items) resolve ids through `ReferenceData` and report `unresolved` until data arrives; the engine skips those and the UI shows a warning.
- **Nothing site-specific is seeded.** Simulator names, universes and addresses come from the first-run wizard, which can read running flights from Thorium (`thorium.probe`, a one-off HTTP read that does not disturb the live adapter) and lay out a channel block per ship via the pure helper `shared/simulatorLayout.ts`. Don't reintroduce hardcoded ship names or universe numbers in seeds or UI copy.
- **Scenes are raw channel values**, not fixtures. *Relative* scenes are offsets from a `SimulatorProfile.baseAddress` on that profile's universe; the `ActionRunner` resolves the event's simulator to a profile by name. *Absolute* scenes name universe/channel directly.
- **Layers**: higher priority wins per channel; within a layer the latest activation wins; fades crossfade against the layer below. `Test` (90) and `Blackout` (100) are reserved (ids in `LAYER_IDS`).
- **Scope and assignment** (`main/core/simulators.ts`): Thorium runs several flights concurrently and simulator names repeat across flights, so scoping is assignment-based. `follow-assignment` (room default) follows the FD-assigned simulator, or the whole assigned flight until one is picked; nothing fires while unassigned. Name-based modes (`pinned`, `all`) exist for a central instance and prefer the newest flight on name conflicts. Events with a `simulatorId` outside scope are dropped in `ThoriumAdapter.onFirehose` before reaching the bus; flight-level events are filtered by `isFlightInScope`.
- **GraphQL correctness is enforced by a test.** `operations.test.ts` validates every document in `operations.ts` against `../thorium/src/schema.graphql` (skipped if that checkout is absent). Apollo rejects a request naming an unknown field with a blanket **HTTP 400**, which presents as a connection failure; a stubbed `fetch` in a unit test cannot catch it. Run it after touching any query.
- **Thorium protocol**: Apollo Server 2 legacy `subscriptions-transport-ws` (`main/sources/thorium/protocol.ts`, hand-written). The `events` GraphQL subscription is a firehose of every mutation and macro action; state subscriptions are diffed into derived events in `derived.ts` (`alertLevel.changed`, `battery.below`, `flight.reset`, …). GraphQL strings live in `operations.ts`; handlers tolerate missing fields because the Thorium schema drifts. Production Thorium is port 4444, dev 3001.
- **Config** (`main/config/store.ts`): one `config.json` in userData, atomic writes, backups only when profile content changes, zod validation with human-readable errors returned (never thrown) to the renderer. Bump `CONFIG_SCHEMA_VERSION` and add a step in `shared/schema/migrations.ts` for any breaking config change. Secrets go through `SecretVault` (Electron `safeStorage`), never into config.json.
- **Renderer editing model**: `store/config.ts` keeps a `draft` of the active profile; pages mutate the draft via `update()` and the AppShell banner saves it. Zustand selectors must return stable references (no `.map`/`?? []` inside a selector) or React throws update-depth errors.

### Deployment assumptions baked into defaults

One app instance per control room, each pointing at that room's Thorium server; the FD assigns the client to a flight and simulator from Thorium's Clients list. Where rooms share a universe, outputs support a `channelRange` guard so an instance can only write its own ship's block, and the output test reports other sACN senders it hears on that universe. Generated simulator profiles are always `confirmed: false` until a human checks them against the controller.
