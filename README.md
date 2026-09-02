# CMSC Lighting Client

Desktop app that turns **Thorium**, **MQTT** and **UI** events into **DMX output** (sACN / E1.31 to Pharos Mosaic, or an Enttec USB DMX Pro). Built with Electron, React and TypeScript.

- Product requirements: [`docs/PRD_claude.md`](docs/PRD_claude.md)
- Design and implementation details: [`docs/ERD_claude.md`](docs/ERD_claude.md)

## How it works

```
Thorium (GraphQL WS)  ─┐
MQTT broker           ─┼─► events ─► Mappings (rules) ─► Scenes on priority Layers ─► Compositor ─► sACN / Enttec
Dashboard buttons     ─┘
```

- **Scenes** are raw DMX channel values. _Relative_ scenes address channels as offsets from a simulator's base address (so one scene works for every ship); _absolute_ scenes name a universe and channel directly.
- **Mappings** pair a trigger (alert level, macro, timeline item, generic key, battery threshold, any Thorium event by name, MQTT topic, …) with actions (activate/release scene, release layer, blackout, publish MQTT, send a Thorium mutation).
- **Layers** resolve conflicts: higher priority wins per channel; when a timed scene ends, the layer below shows through. `Test` (90) and `Blackout` (100) are reserved.
- **Simulator profiles** map a Thorium simulator name to a universe and base address. None are assumed: the first-run wizard can read the running flights from Thorium and lay out a channel block per ship, or you add them by name.

No changes to Thorium are required; the app registers as a normal Thorium client and listens to the global `events` subscription plus state streams.

## Deployment model

Run **one instance per control room** (or per ship computer). Each instance registers as its own Thorium client; the Flight Director assigns it to that room's flight from Thorium's Clients list, and the instance acts only on that flight (`Thorium → Simulator scope → "What the FD assigns this client to"`; the assigned simulator, or the whole flight until one is picked). When the FD moves the client to a clean-slate flight, the old flight's scenes are released (configurable) and the new flight is followed automatically. Nothing fires while unassigned.

Because several rooms share sACN universes 10 and 11, set each room's output to **Transmit only channels** covering its own ship's block. sACN receivers merge multiple sources highest-takes-precedence, and zeros never win, so rooms cannot stomp each other. The output test lists any other senders it hears on the universe.

For a hot standby, run a second instance with the same mappings and a lower sACN **priority** (e.g. 90 vs 100): receivers use the highest-priority source and fall back within about 2.5 s if it disappears.

## Setup

Requires Node 22 (`.nvmrc`) and yarn 1.

```bash
nvm use
yarn            # installs deps and rebuilds serialport for Electron
yarn dev        # dev mode with hot reload
```

Other scripts:

| Command                             | What it does                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `yarn typecheck`                    | TypeScript for main, preload, shared and renderer                                                     |
| `yarn lint`                         | ESLint + Prettier                                                                                     |
| `yarn test`                         | Vitest unit + integration tests (`yarn test:watch` for watch mode)                                    |
| `yarn build`                        | Typecheck and bundle to `out/`                                                                        |
| `yarn build:win` / `yarn build:mac` | Installable builds via electron-builder (`dist/`) — see [Building for Windows](#building-for-windows) |
| `yarn build:unpack`                 | Unpacked build for a quick smoke test                                                                 |
| `yarn gen:thorium-events`           | Regenerate the Thorium event-name list from `../thorium/src/schema.graphql`                           |

## Building for Windows

The Windows target is **NSIS x64** (`dist/cmsc-lighting-client-<version>-setup.exe`), pinned in
`electron-builder.yml` so the installer's architecture doesn't follow the build machine's.

### 1. Toolchain

Node 22 and yarn 1. If the shell defaults to another Node, prefix commands with
`export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"` — installing under Node 20 fails on
`@electron/rebuild`.

```bash
nvm use
yarn
```

### 2. Set the version

`package.json` `version` becomes the installer filename, the Add/Remove Programs entry and the
upgrade key NSIS uses to replace an existing install. Bump it for every build you hand out;
shipping two different builds as `1.0.0` makes them indistinguishable on the target machine.

### 3. Gates

```bash
npx prettier --write "src/**/*.{ts,tsx}"   # Prettier violations are lint errors
yarn lint
yarn typecheck
yarn test
```

`yarn build:win` runs `typecheck` itself and aborts the build on failure, but lint and tests are
not part of it — run them first.

### 4. Build

```bash
yarn build:win        # typecheck → electron-vite build → electron-builder --win
```

Output lands in `dist/`: the `setup.exe`, its `.blockmap`, and `win-unpacked/` (the installed tree,
useful for inspecting what shipped). Expect roughly 100 MB for the installer.

### 5. Verify on a Windows machine

The installer is unsigned, so SmartScreen shows _"Windows protected your PC"_ → **More info** →
**Run anyway**. To avoid that on site, sign with an EV or OV code-signing certificate
(`win.certificateFile` / `CSC_LINK` + `CSC_KEY_PASSWORD`).

Smoke test after installing:

1. App launches, tray icon appears, window opens.
2. Thorium page → **Test connection** reaches the room's server (production port 4444).
3. Outputs page → sACN output test; confirm frames on the controller and check the monitor for
   other senders on the universe.
4. If the room uses an **Enttec USB DMX Pro**, plug it in and open the Enttec output — this is the
   only path that loads the native `serialport` binding (see below).
5. Settings → _Launch at login_ / _Close to tray_, then reboot and confirm it comes back.
6. Allow `cmsc-lighting-client.exe` through Windows Firewall for sACN (UDP 5568) and MQTT.

### Cross-building from macOS or Linux

Works without wine: `serialport`'s native binding ships as Node-API prebuilds for every platform,
so nothing is compiled at package time (`npmRebuild: false`). electron-builder downloads the
Windows Electron binaries and NSIS tooling on first run.

One caveat, already handled in `electron-builder.yml`: `yarn`'s postinstall runs
`electron-builder install-app-deps`, which compiles `@serialport/bindings-cpp` for the _build
host_ into `build/Release/bindings.node`. `node-gyp-build` prefers `build/Release` over
`prebuilds/`, so without an exclusion a macOS binary ships inside the Windows package and
`serialport` throws the first time an Enttec output opens. The `files` list excludes that
directory; if you touch it, verify with:

```bash
find dist/win-unpacked -name "bindings.node"   # must print nothing
file dist/win-unpacked/resources/app.asar.unpacked/node_modules/@serialport/bindings-cpp/prebuilds/win32-x64/*.node
```

Code signing is the one thing that cannot be done from macOS in this setup — `signtool.exe` runs
as a no-op there. Build on Windows (or in a Windows CI runner) for a signed installer.

### Auto-update

Disabled: `publish: null`, and nothing in `src/` calls `autoUpdater`. `dev-app-update.yml` points
at a placeholder URL and is excluded from the package. Distribute new installers by hand, or wire
up a `generic` publish provider and add `electron-updater` to the main process before relying on it.

## First run

The wizard walks through: profile type (per room or central) → Thorium host/port + connection test → **simulators** (read from Thorium, or by name, with automatic universe/address layout) → first DMX output + test frames → optional MQTT. Afterwards:

1. **Simulators**: check each universe and address block against your lighting controller and tick _Confirmed_.
2. **Scenes**: set the channel values for each alert level (starter scenes use offsets 0–7 inside each ship's block).
3. Change the alert level in Thorium and watch the **Universe monitor** on the Outputs page.

The Simulators page has the same _Read from Thorium_ import, so you can re-run it whenever ships are added or renamed.

## Where things live

| Path                         | Purpose                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `src/shared/`                | Types, zod config schema, trigger catalog, matcher, seed data (used by main and renderer) |
| `src/main/core/`             | Event bus, rules engine, compositor, scheduler, simulator registry                        |
| `src/main/sources/thorium/`  | `subscriptions-transport-ws` client, GraphQL operations, derived state events, adapter    |
| `src/main/sources/mqtt/`     | MQTT adapter, status publisher, command topic                                             |
| `src/main/outputs/`          | sACN and Enttec drivers, output manager                                                   |
| `src/main/ipc/`              | IPC router (zod-validated) and main→renderer pushes                                       |
| `src/renderer/src/features/` | One folder per screen                                                                     |

Config lives in the Electron user-data folder as `config.json` (atomic writes, 20 rolling backups in `backups/`), secrets in `secrets.json` encrypted via `safeStorage`, logs in `logs/main.log`.

## MQTT contract

Base topic `cmsc/lighting/<instanceName>`. Retained status topics: `status`, `outputs/<name>`, `thorium`, `thorium/alertLevel/<simulator>`, `scenes/active`, `blackout`. Command topic `<base>/cmd` accepts JSON such as:

```json
{"action":"activateScene","scene":"Red Alert","simulator":"Magellan"}
{"action":"blackout","on":true}
{"action":"setChannel","universe":10,"channel":5,"value":255,"holdMs":500}
```

## Diagnostics

Settings → _Copy diagnostics_ puts versions, config summary (secrets redacted), runtime state, the last 200 events and the log tail on the clipboard.
