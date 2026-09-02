# CMSC Lighting Client — Product Requirements Document

Version 1.0 · 2026-09-01 · Status: Draft for review

This document expands the original `PRD.md` into a complete requirements specification. It reflects the answers gathered during discovery (see §2.4) and the results of a code-level survey of the Thorium repository (see Appendix A).

---

## 1. Summary

The CMSC Lighting Client is a desktop application that turns **events** from several sources into **DMX output**. It replaces the browser-based lighting kiosk on the "Camera" computer and the DMX feature built into Thorium with a single, purpose-built tool that:

- connects to a Thorium server as a client and listens for lighting-relevant events (alert level changes, macros, timeline items, macro buttons, power and battery state, and any user-defined event);
- connects to an MQTT broker and listens on user-defined topics;
- provides manual controls in its own UI;
- maps all of those inputs to DMX **scenes** (explicit channel values on one or more universes) through a user-editable, code-free rules table;
- outputs to a Pharos Mosaic controller over sACN (E1.31) and to an Enttec USB DMX Pro over USB serial;
- makes every link in that chain testable from the UI.

The app must be reliable enough to run unattended after boot and simple enough that front-line staff never need to open a settings page.

## 2. Background

### 2.1 Current state

- Six simulators (Magellan, Cassini, Phoenix, Odyssey, Galileo, Falcon) plus a lobby.
- **Pharos Mosaic** is the real lighting controller. It *outputs* sACN universe 1 (Lobby), universes 2–5 (Magellan, Cassini, Phoenix) and 6–8 (Odyssey, Galileo, Falcon) to the fixtures.
- Mosaic also *listens* on sACN universes **10 and 11** for trigger signals. Magellan, Cassini and Phoenix share universe 10; Odyssey, Galileo and Falcon share universe 11. A trigger is a DMX channel in a specific address range going to a specific value. Mosaic is happiest with one or two devices talking to it per universe.
- Thorium transmits those trigger signals today and has no idea which ship it is talking to; the physical patch decides.
- The "Camera" computer (now Windows) runs a browser with the camera feeds, a tab that plays Thorium sounds, and a kiosk that handles SFX keystrokes and drives an **Enttec USB DMX Pro**.
- Lighting triggers come primarily from Thorium alert level changes, and secondarily from macros, timeline items and macro buttons.

### 2.2 Problems with the current state

1. Thorium's built-in DMX client is fixture-oriented (color, intensity, tags) and is tightly coupled to Thorium's alert level and lighting effect model. The set actually needs raw channel triggers for Mosaic.
2. Adding a new lighting trigger requires either a Thorium change or knowledge of Thorium's macro system.
3. There is no way to verify the DMX link without watching the lights.
4. Startup involves several browser tabs and a kiosk; troubleshooting is hard for staff.
5. There is no MQTT integration at all.

### 2.3 Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | Any lighting change can be triggered from Thorium, MQTT or the UI without a code change. | New trigger added in under two minutes from the UI. |
| G2 | The DMX path is observable and testable. | A tech can prove a channel is being sent, at what value, and that the device is alive, from the app alone. |
| G3 | Zero-touch startup. | Power on → app launches, connects, and outputs the correct base state with no clicks. |
| G4 | A UI that staff will actually use. | Status at a glance; common actions one click deep; nothing destructive without confirmation; no dead ends. |
| G5 | Works for both deployment layouts. | One central machine driving universes 10 and 11 for all six ships, or one machine per ship, differ only in config. |

### 2.4 Decisions made during discovery

| Topic | Decision |
|-------|----------|
| Topology | One instance per control room is the primary layout (no single point of failure; Thorium runs one flight per room, and the FD assigns each lighting client to its room's flight). A central instance following every flight remains possible. Hot-standby pairs use sACN priority. |
| DMX drivers (v1) | sACN (E1.31) and Enttec USB DMX Pro. Art-Net is out of scope for v1. |
| Output model | Raw channels only. A scene is a list of universe/channel/value entries. No fixture profiles or color model in v1. |
| Thorium edits | None. Use Thorium's existing GraphQL API as it stands today. |
| MQTT | Subscribe and publish. JSON payloads by default, plain strings tolerated. The app publishes its own status. |
| Conflict resolution | Priority layers. Higher priority wins per channel; when a timed scene ends the layer below shows through. |
| Keyboard hotkeys | None in v1. UI buttons only. |
| Platform | Windows primary, macOS for development. Auto-start, auto-connect, restore last config. |

### 2.5 Non-goals (v1)

- Art-Net output, DMX input, RDM.
- Fixture profiles, color pickers, or effect engines (strobe, chase, fade curves beyond simple linear fades).
- Keyboard hotkeys (in-app or global).
- Editing Thorium's macros, timelines or DMX config from this app.
- Replacing the sound playback tab on the Camera computer.
- Multi-user editing or a server-side config store.

## 3. Users

| Persona | Needs | Typical interaction |
|---------|-------|---------------------|
| **Set staff / bridge operator** | Confirm the lighting client is healthy; occasionally press a manual scene or blackout. | Glances at the status bar; presses a big button on the Dashboard. |
| **Flight Director** | Never touches this app. Their actions in Thorium must "just work". | None directly. |
| **Tech / admin (you)** | Configure connections, build mappings and scenes, test channels, debug why a light didn't change. | Settings, Mappings, Scenes, Diagnostics screens. |
| **Product manager** | Confidence the universe/address plan is honored and staff startup is easy. | Reads the Dashboard; exports config. |

## 4. Glossary

- **Source** — a producer of events: Thorium, MQTT, or the app's own UI.
- **Event** — a normalized message `{ source, type, simulator?, payload, timestamp }` emitted by a source.
- **Trigger** — a user-defined condition that matches events (e.g. "Thorium event `changeSimulatorAlertLevel` where `alertLevel == "1"`").
- **Scene** — a named set of `{ universe, channel, value }` entries, with optional fade-in, hold duration and fade-out. Scene channels may be **absolute** or **relative** to a simulator's base address.
- **Mapping** (rule) — Trigger → Action. Actions are: *activate scene*, *release scene*, *release layer*, *blackout*, *publish MQTT message*.
- **Layer** — a priority band. Each active scene lives on a layer; the output for a channel is the value from the highest-priority active scene that sets that channel, otherwise the value from the layer below, down to the default (0).
- **Output** — a configured DMX destination (sACN universe on an IP, or an Enttec on a serial port).
- **Simulator profile** — a Thorium simulator name mapped to a default output universe and a base address, so relative scenes can be reused across ships.

## 5. System overview

```
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Thorium       │   │ MQTT broker   │   │ App UI        │
│ (GraphQL WS)  │   │ (mqtt/ws)     │   │ (buttons)     │
└──────┬────────┘   └──────┬────────┘   └──────┬────────┘
       │ raw events        │ messages          │ actions
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│ Source adapters → normalized Event stream → Event log    │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Rules engine: match Triggers → run Actions              │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer compositor: active scenes → per-universe 512 bytes │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌───────────────────────┐  ┌──────────────────────────────┐
│ sACN output(s)        │  │ Enttec USB DMX Pro output(s) │
└───────────────────────┘  └──────────────────────────────┘
```

All source adapters, the rules engine, compositor and drivers run in the Electron **main** process so they keep running when the window is hidden or minimized to the tray. The **renderer** is a pure view over main-process state via IPC.

## 6. Functional requirements

Requirement IDs are stable and referenced from the ERD. Priority: **P0** must ship in v1; **P1** should ship in v1; **P2** nice to have.

### 6.1 DMX output (F-DMX)

| ID | Priority | Requirement |
|----|----------|-------------|
| F-DMX-01 | P0 | The user can create any number of **Outputs**. Each Output has a name, a driver (`sacn` or `enttec-pro`), a DMX universe number (1–63999 for sACN; the Enttec always carries the single universe the user assigns it), an enabled flag, and driver-specific settings. |
| F-DMX-02 | P0 | **sACN settings**: destination mode `multicast` (default) or `unicast` with an IP address; sACN priority (default 100); source name; optional bind interface. Frames are sent at a configurable rate (default 40 Hz) and continue at a keep-alive rate (≥ 1 Hz) when nothing changes, so Mosaic never marks the source as lost. |
| F-DMX-03 | P0 | **Enttec settings**: serial port path chosen from a live list of detected serial devices (name, manufacturer, serial number). The app opens the port at 250 000 baud, 8N2, sends the Enttec Pro "Send DMX" packet at the configured rate, and reconnects automatically if the device is unplugged and replugged. |
| F-DMX-12 | P0 | An Output can be limited to a **channel range**; everything outside is transmitted as 0 so room instances sharing a universe cannot write another ship's block. The Output test reports other sACN senders heard on the universe. |
| F-DMX-04 | P0 | Several Outputs may target the same universe (e.g. sACN universe 10 and an Enttec both carrying universe 10). The compositor produces one 512-byte frame per universe and every Output subscribed to that universe sends it. |
| F-DMX-05 | P0 | Each Output shows a live **health state**: `disabled`, `starting`, `ok`, `error` with a human-readable reason (port not found, permission denied, socket error), the frame rate actually achieved, and the time of the last successful send. |
| F-DMX-06 | P0 | **Channel tester**: pick a universe and channel, set a value with a slider or number, press "Send" or "Hold". The value is sent on a dedicated *Test* layer above all others, so it is visible regardless of scenes, and it is released when the tester closes. |
| F-DMX-07 | P0 | **Universe monitor**: a live grid of 512 channels for any universe showing the current composited value, the layer that owns it, and a highlight when it changes. |
| F-DMX-08 | P0 | **Blackout**: one click sets every channel on every universe to 0 on the highest layer until released. Visible as a persistent red banner. |
| F-DMX-09 | P1 | **Identify / flash**: for an Output, send a short on-off pattern on a chosen channel to confirm which physical device is which. |
| F-DMX-10 | P1 | **Output test report**: "Run test" on an Output performs a self-check (port opens, socket binds, N frames sent without error) and reports pass/fail with details. |
| F-DMX-11 | P2 | **sACN receiver** for a chosen universe, to watch what an existing Thorium instance sends during the transition. |

### 6.2 Thorium source (F-THOR)

| ID | Priority | Requirement |
|----|----------|-------------|
| F-THOR-01 | P0 | The user configures the Thorium server address (host, port, http/https). Defaults: port 4444 (production Thorium), with 3001 offered as the dev alternative. |
| F-THOR-02 | P0 | The app connects using Thorium's WebSocket subscription protocol (Apollo Server 2 / `subscriptions-transport-ws`) and HTTP for queries and mutations, with automatic reconnect and exponential backoff. |
| F-THOR-03 | P0 | The app **registers as a Thorium client** via `clientConnect` with a stable client id and a user-set label (default `Lighting Client – <hostname>`), so it appears in the Flight Director's client list and can be assigned to a flight and simulator like any other client. It sends `clientDisconnect` on shutdown. |
| F-THOR-04 | P0 | **Simulator scope** is configurable per instance: *Assigned flight* (every simulator of the flight the FD assigns this client to; recommended per room), *Follow FD assignment* (only the assigned simulator), *Pinned* (simulator names; when several running flights share a name the newest flight wins), or *All*. Assignment-based modes act on nothing until the FD assigns the client. Thorium may run several flights concurrently; all are tracked. When the FD moves the client to another flight (clean slate after training) the previous flight's scenes are released or held per setting. |
| F-THOR-05 | P0 | The app subscribes to the global `events` subscription so **every Thorium event** (mutations, macro actions, timeline items, macro buttons, keyboard actions, trigger outputs) is available for matching, with its arguments. |
| F-THOR-06 | P0 | The app subscribes to state streams that carry lighting-relevant data and derives **state-change events** from them: `simulatorsUpdate` (alert level, training mode, lighting action/intensity), `reactorUpdate` (battery level, reactor power output, efficiency, ejected, external power), `systemsUpdate` (per-system power and damage), `flightsUpdate` (running/paused), `clientChanged` (this client's assignment), `notify`. Derived events fire only on change and support thresholds (e.g. battery crossed below 25%). |
| F-THOR-07 | P0 | **Built-in trigger catalog**: the Trigger editor offers friendly presets for the most useful events (Appendix A), each with its own small form: alert level equals, alert level changed, training mode on/off, lighting action (blackout, work, shake, etc.), generic macro key equals, macro triggered (by name), macro button pressed (by name), timeline item executed (by mission and step name), `triggerAction` (flash, spark, power loss…), battery level crossed threshold, reactor ejected, system damaged/repaired, flight paused/resumed/reset, shields raised/lowered, self-destruct armed, transporter/torpedo/phaser fired. |
| F-THOR-08 | P0 | **Custom trigger**: the user enters any event name (with autocomplete from events seen so far and from the schema's mutation list) and zero or more conditions on the event arguments using a path (`args.alertLevel`), an operator (`equals`, `not equals`, `contains`, `>`, `<`, `regex`, `exists`) and a value. Conditions AND together. |
| F-THOR-09 | P0 | Every trigger is scoped to the instance's simulator scope automatically. A trigger can additionally be restricted to a specific simulator name. |
| F-THOR-10 | P0 | **Event inspector**: a live, filterable log of events with source, type, simulator, arguments and which mappings (if any) matched. Any log row can be turned into a new trigger with one click ("Create trigger from this"). |
| F-THOR-11 | P0 | **Connection test**: shows server version, reachable status, round-trip time, current flight, simulators in the flight, and this client's assignment. |
| F-THOR-12 | P1 | The app can **send** a small set of Thorium mutations as actions: trigger a macro by name, set alert level, send a `notify` to the FD. This lets a UI button or MQTT message drive Thorium, not just lights. |
| F-THOR-13 | P1 | Macro, macro-button and mission/timeline names are fetched and cached so the trigger editor can present names instead of ids and the app can re-resolve ids if Thorium's snapshot is rebuilt. |

### 6.3 MQTT source and sink (F-MQTT)

| ID | Priority | Requirement |
|----|----------|-------------|
| F-MQTT-01 | P0 | The user configures a broker (URL with `mqtt://`, `mqtts://`, `ws://` or `wss://`, port, username, password, client id, keep-alive, clean session, optional TLS settings). Passwords are stored encrypted with the OS keychain. Auto-reconnect with backoff. |
| F-MQTT-02 | P0 | The user adds any number of **subscriptions** (topic filters with `+`/`#` wildcards and QoS). Each received message becomes an event `{ type: "mqtt", topic, payload, json? }` where `json` is the parsed payload when it is valid JSON. |
| F-MQTT-03 | P0 | MQTT triggers match on topic (exact or wildcard) and optional conditions on `payload` (string) or `json.<path>` using the same operators as F-THOR-08. |
| F-MQTT-04 | P0 | The app **publishes status** to a configurable base topic (default `cmsc/lighting/<instance>`): `status` (online/offline, retained, with last-will), `outputs/<name>` health, `scenes/active`, `thorium/alertLevel/<simulator>`. Payloads are JSON. |
| F-MQTT-05 | P0 | **Publish action**: a mapping can publish a message (topic, payload with `{{ }}` templates from the event, QoS, retain). |
| F-MQTT-06 | P0 | **Test tools**: publish an arbitrary message from the UI; live view of received messages; connection test showing broker, connected since, subscriptions and their message counts. |
| F-MQTT-07 | P1 | Optional **command topic** (`<base>/cmd`) accepting JSON commands: activate/release scene by name, blackout on/off, set channel. This makes the app controllable from Node-RED, Home Assistant, etc. without creating mappings. |

### 6.4 UI source (F-UI)

| ID | Priority | Requirement |
|----|----------|-------------|
| F-UI-01 | P0 | The Dashboard shows **scene buttons** for scenes marked "show on dashboard", grouped by category, with the simulator selector applied for relative scenes. Pressing activates; pressing again releases (for latching scenes) or re-fires (for timed scenes). |
| F-UI-02 | P0 | Global controls: Blackout (latching, confirmed on release only if it was activated automatically), Release All (drops every non-base layer), and a **Grand Master** (0–100% scaling all output). |
| F-UI-03 | P0 | UI actions are also events (`{ source: "ui", type: "scene.activate", ... }`) so they appear in the inspector and can trigger MQTT publishes. |
| F-UI-04 | P1 | Manual **alert level override** per simulator that behaves exactly like a Thorium alert level change for mapping purposes (useful when Thorium is down). |

### 6.5 Mapping and scene engine (F-MAP)

| ID | Priority | Requirement |
|----|----------|-------------|
| F-MAP-01 | P0 | **Scene** = name, category, color tag, list of channel entries, addressing mode (`absolute` or `relative`), behavior (`latch` or `timed` with hold ms), fade-in ms, fade-out ms, default layer, "show on dashboard" flag. |
| F-MAP-02 | P0 | Channel entries: universe (absolute mode) or *simulator's universe* (relative mode), channel 1–512 (or offset from base in relative mode), value 0–255. Bulk entry supports ranges (`10-20 = 255`) and pasting a list. |
| F-MAP-03 | P0 | **Simulator profiles**: simulator name → output universe, base address, display color. A relative scene activated for simulator X resolves to X's universe and `base + offset`. **No profiles are seeded**; the setup wizard and the Simulators page can read the running flights from a Thorium server (`thorium.probe`) and lay out one channel block per ship (configurable first universe, first address, block size, ships per universe), or the user adds ships by name. Every generated profile is `confirmed: false` until checked against the controller. |
| F-MAP-04 | P0 | **Layers**: named priority bands with a numeric priority. Seeded: `Base (0)`, `Alert (10)`, `Scene (20)`, `Effect (30)`, `Manual (40)`, `Test (90)`, `Blackout (100)`. Users can add or reorder. |
| F-MAP-05 | P0 | **Compositor**: for every universe, each channel takes the value from the highest-priority *active* scene that sets it; fades interpolate linearly between the previous composited value and the target over the fade time; the Grand Master scales the result; blackout forces zero. Output frames are produced at the configured rate and only when something changed, except for keep-alive. |
| F-MAP-06 | P0 | **Mapping** = name, enabled flag, trigger (F-THOR-07/08 or F-MQTT-03 or a UI event), one or more actions (`activateScene`, `releaseScene`, `releaseLayer`, `blackout on/off`, `publishMqtt`, `thoriumMutation`), optional simulator restriction, optional debounce ms, notes. |
| F-MAP-07 | P0 | Activating a scene that is already active on the same layer for the same simulator **replaces** its entries (no stacking). Activating a scene for simulator A and simulator B keeps both active. |
| F-MAP-08 | P0 | **Alert base behavior**: a seeded set of mappings maps alert levels 5→1 and `p` to seeded example scenes on the Alert layer so the app produces sensible output on first run; users edit or delete them. |
| F-MAP-09 | P0 | **Dry-run / simulate**: from the Mappings screen the user can fire a synthetic event (choose trigger preset, fill values) and see which mappings match and what the compositor would output, without sending DMX (or with, when "Live" is toggled). |
| F-MAP-10 | P1 | Mapping list shows last-fired time and a fire count; a mapping can be temporarily disabled. |
| F-MAP-11 | P2 | Conditional actions (e.g. only if scene X is active) and simple delays between actions. |

### 6.6 Configuration and persistence (F-CFG)

| ID | Priority | Requirement |
|----|----------|-------------|
| F-CFG-01 | P0 | All configuration lives in one human-readable JSON file in the app's user-data directory, with a schema version. Writes are atomic (temp file + rename) and a rolling set of backups is kept. |
| F-CFG-02 | P0 | Import and export the whole config, or just scenes/mappings/simulator profiles, as JSON, so a config can be moved between the central machine and per-ship machines. |
| F-CFG-03 | P0 | Config edits apply immediately (hot-reload of adapters when connection settings change) with an explicit "unsaved changes" indicator and save action for form-heavy screens. |
| F-CFG-04 | P0 | Secrets (MQTT password) are stored via Electron `safeStorage`, never in plain text in the JSON. |
| F-CFG-05 | P1 | Multiple named **profiles** (e.g. "Central", "Magellan station") with a quick switcher, so one build serves both topologies. |
| F-CFG-06 | P1 | Config validation on load with clear error messages and a "restore last good backup" action. |

### 6.7 Startup, kiosk and reliability (F-OPS)

| ID | Priority | Requirement |
|----|----------|-------------|
| F-OPS-01 | P0 | Optional **launch at login** (Windows and macOS), single-instance lock, start minimized to tray option, close-to-tray option, tray menu with status, Blackout, Show, Quit. |
| F-OPS-02 | P0 | On start the app auto-enables all enabled Outputs, connects to Thorium and MQTT if configured, and re-applies the base state (e.g. current alert level fetched from Thorium) without user interaction. |
| F-OPS-03 | P0 | Adapters recover from failure independently (Thorium down does not affect MQTT or DMX). Backoff is capped and visible in the UI. |
| F-OPS-04 | P0 | On quit or crash of the renderer, DMX output continues from the main process; on app exit, outputs send a final zero frame (configurable) and close cleanly. |
| F-OPS-05 | P0 | Rolling log files on disk (info level, 7 days) with a "Open logs folder" button and a "Copy diagnostics" button that assembles versions, config summary (secrets redacted), output health and the last 200 events. |
| F-OPS-06 | P1 | A `--headless` flag runs without a window for a future service-style install. |

### 6.8 User interface (F-UX)

The UI is a first-class requirement, not a wrapper. It is judged against the principles below and the screen list in §7.

| ID | Priority | Requirement |
|----|----------|-------------|
| F-UX-01 | P0 | **Status at a glance**: a persistent status bar shows Thorium, MQTT and each Output as a colored pill with a one-word state; hovering or clicking gives the reason and a "Fix" shortcut to the relevant settings. |
| F-UX-02 | P0 | **Dark, high-contrast theme** designed for a dim control room, with a light theme available. Minimum 14px body text; controls at least 36px tall so they are usable on a touch screen. |
| F-UX-03 | P0 | **Progressive disclosure**: Dashboard is safe for staff (no destructive actions without confirmation); configuration screens are grouped under "Setup" and can be locked behind a simple PIN. |
| F-UX-04 | P0 | Every list (scenes, mappings, outputs, events) supports search, and the trigger editor supports "pick from a recent event". |
| F-UX-05 | P0 | Every configuration form has inline validation, sensible defaults, and a "Test" affordance where applicable (Test connection, Send test frame, Fire trigger). |
| F-UX-06 | P0 | Empty states explain what the screen is for and offer the first action (e.g. "No outputs yet. Add sACN universe 10"). |
| F-UX-07 | P0 | No blocking modal dialogs for routine work; confirmations use inline "Are you sure? Yes / No" buttons. Destructive actions are undoable for 10 seconds via a toast. |
| F-UX-08 | P0 | First-run **setup wizard**: choose profile type (Central or Single ship), add Thorium address and test it, add an sACN output and send a test frame, optionally add MQTT, done. |
| F-UX-09 | P1 | Keyboard focus order and visible focus rings throughout; all controls reachable by Tab. |
| F-UX-10 | P1 | Window state (size, position, last screen) is remembered. |

## 7. Screens

1. **Dashboard** — status header; simulator selector (when more than one is in scope); scene button grid; Blackout, Release All, Grand Master; "Recent activity" ticker showing the last few events and what they did.
2. **Scenes** — list with category filter; editor with channel grid (a 512-cell picker plus a table), addressing mode toggle, fade/hold settings, live preview toggle ("Preview sends to DMX on the Test layer while this editor is open").
3. **Mappings** — table (enabled, name, trigger summary, actions summary, last fired, count); editor with trigger preset picker, custom event builder, action list, simulator restriction, debounce; "Simulate" panel.
4. **Sources › Thorium** — connection form, test panel, simulator scope, live event inspector with filters and "Create trigger from this".
5. **Sources › MQTT** — broker form, subscriptions table, status publishing settings, publish tester, live message view.
6. **Outputs** — cards per Output with health, achieved frame rate, last send; add/edit forms for sACN and Enttec; Universe monitor; Channel tester; Identify.
7. **Simulators** — simulator profiles table (name, universe, base address, color) with a visual of which channel ranges each ship occupies per universe, flagging overlaps.
8. **Layers** — ordered list with priorities and which scenes are currently active on each.
9. **Settings** — profiles, startup options, tray behavior, logging, import/export, PIN lock, about/diagnostics.

## 8. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Latency | Event received → first DMX frame reflecting it in under 50 ms on the local machine (excluding configured fades). |
| Output rate | 40 Hz default per universe, configurable 1–44 Hz; keep-alive at least every 1 s for sACN. Frame timing jitter under 5 ms. |
| Reliability | Runs for weeks unattended; no unbounded memory growth in the event log (ring buffer, default 2 000 events); adapters reconnect indefinitely. |
| Compatibility | Windows 10/11 x64 (primary), macOS 13+ (development). Node 22 per `.nvmrc`; Electron 39. |
| Security | Listens on no network ports by default. MQTT secrets encrypted at rest. Config file readable by the user only. |
| Performance | Idle CPU under 3% with two universes at 40 Hz; renderer updates throttled to 10 Hz for monitors. |
| Observability | Structured logs; per-adapter metrics (messages/s, reconnects, errors); diagnostics bundle. |
| Accessibility | WCAG AA contrast in both themes; keyboard operable. |
| Packaging | Installable build for Windows (NSIS) and macOS (DMG) via electron-builder; native serialport prebuilt for Electron. |

## 9. Acceptance criteria (v1)

1. Fresh install on Windows → wizard → sACN universe 10 output added → channel tester sets channel 5 to 255 → Mosaic (or an sACN monitor tool) sees it within one second.
2. Thorium alert level changed by the FD → mapped scene appears on the Alert layer for the right simulator within 50 ms; changing to another level replaces it; training mode maps to level 5.
3. A Thorium macro button containing `generic(key: "lights-hyperspace")` fires a timed scene for 3 s, after which the alert scene shows through again.
4. A custom trigger on event `shieldRaised` (no code change) activates a scene.
5. MQTT message `{"scene":"party"}` on `cmsc/lighting/central/cmd` activates a scene; the app publishes `status` retained JSON and `thorium/alertLevel/Magellan` on change.
6. Unplugging the Enttec shows `error: port not found` within 5 s; replugging restores `ok` without a restart.
7. Kill the app; relaunch at login; it reconnects and reproduces the current alert level's lighting with no clicks.
8. Export config on the central machine, import on a ship machine with a "Single ship" profile, and the same relative scenes work with that ship's base address.

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Mosaic trigger address ranges unknown at build time. | Fully configurable simulator profiles; seeded placeholders clearly flagged "confirm with PM". |
| Thorium's legacy WebSocket protocol (`subscriptions-transport-ws`) is deprecated. | Implement a small, self-contained client for that protocol; isolate behind an interface so a `graphql-ws` variant can be added if Thorium upgrades. |
| Native `serialport` module must match Electron's ABI. | Use `electron-builder install-app-deps` (already in `postinstall`) and prebuilt binaries; document the rebuild command. |
| sACN multicast on Windows with multiple NICs. | Expose interface binding and a unicast fallback; show the chosen interface in Output health. |
| `events` firehose volume during busy flights. | Filter by simulator scope early in the main process; ring buffer for the inspector; only forward to the renderer at 10 Hz batches. |
| Staff confusion. | Dashboard-only mode with PIN-locked setup; status pills with plain-language reasons. |

## 11. Open items

1. **Mosaic address ranges per ship** — needed to finalize seeded simulator profiles. The app ships with placeholders.
2. **MQTT broker details** — host, credentials, and whether any existing topics must be honored. The app ships fully generic with a built-in test publisher.
3. **Which Thorium events beyond alert level are used today** by the existing kiosk (if any), so they can be seeded as example mappings.

---

## Appendix A — Thorium event and state catalog

Gathered from the Thorium repository (`server/typeDefs`, `server/events`, `server/processes`, `src/schema.graphql`). Names are exact GraphQL/event names.

### A.1 Transport

| Item | Value |
|------|-------|
| HTTP endpoint | `http://<host>:<port>/graphql` (port 4444 in production builds, 3001 in dev) |
| WebSocket endpoint | `ws://<host>:<port>/graphql`, subprotocol `graphql-ws` as implemented by `subscriptions-transport-ws` 0.9 (`connection_init` / `start` / `data` / `stop`) |
| Connection params | `{ clientId }`; HTTP requests send header `clientid` |
| Client registration | `clientConnect(client: ID!, label: String, mobile: Boolean, cards: [String])`, `clientDisconnect(client: ID!)`, `clientPing` subscription for liveness |
| Client assignment | `clientChanged(clientId)` subscription returns `flight { id name running }`, `simulator { id name }`, `station { name }` |

### A.2 The `events` firehose

`subscription { events(includeEvents: [String!], omitEvents: [String!]) }` returns JSON:

```json
{ "event": "changeSimulatorAlertLevel", "clientId": "core-…", "isMutation": true, "core": "true",
  "simulatorId": "…", "alertLevel": "1" }
```

Every mutation and every macro action (timeline items, macro buttons, keyboard keys, trigger outputs) passes through `App.handleEvent` and is published here with its arguments. This is the single most useful subscription for a code-free trigger system.

### A.3 High-value events for lighting

| Event name | Key arguments | When it fires | Suggested use |
|------------|---------------|---------------|---------------|
| `changeSimulatorAlertLevel` | `simulatorId`, `alertLevel` (`"1"`–`"5"`, `"p"`) | FD or macro changes alert level | Primary base lighting |
| `setAlertConditionLock` | `simulatorId`, `lock` | Alert lock toggled | Optional indicator |
| `trainingMode` | `simulatorId`, `training` | Training mode on/off | Force level-5 look |
| `generic` | `simulatorId`, `key` | Timeline item / macro "Generic: Do a generic thing" | The intended custom hook; match on `key` |
| `triggerMacroAction` | `simulatorId`, `macroId` | A macro is run | Match by macro name |
| `triggerMacroButton` | `simulatorId`, `configId`, `buttonId` | Macro button pressed | Match by button name |
| `triggerMacros` | `simulatorId`, `macros[]` (`event`, `args`, `stepId`) | Timeline step or button executed, before each action fires | Match timeline step ids |
| `triggerAction` | `simulatorId`, `action` (`flash`, `spark`, `sound`, `movie`, `beep`, `speak`, `message`, `blackout`, `online`, `offline`, `power`, `lockdown`, `maintenance`, `soviet`, `crack`, `uncrack`, `reload`), `stationId`, `duration` | FD "Actions" panel or macro | Flash → strobe scene; `power` → dim; `blackout` → blackout |
| `lightingSetEffect` | `simulatorId`, `effect` (`normal`, `darken`, `blackout`, `work`, `fade`, `shake`, `strobe`, `oscillate`), `strength`, `duration` | FD Lighting core / macro | Map Thorium's own lighting effects to scenes |
| `lightingSetIntensity` | `simulatorId`, `intensity` (0–1) | Lighting core | Grand-master-like dimming |
| `lightingShakeLights` | `simulatorId`, `strength`, `duration` | Macro | Timed shake scene |
| `lightingFadeLights` | `simulatorId`, `duration`, `endIntensity`, `startIntensity` | Macro | Fade scene |
| `updateSimulatorLighting` | `id`, `lighting { action intensity … }` | FD Lighting core sliders | Same as above |
| `reactorBatteryChargeLevel` | `id` (system id), `level` (0–1) | Battery process, on every change | Use derived threshold events instead (A.4) |
| `reactorEject` | `id`, `tf` | Reactor ejected | Emergency look |
| `reactorChangeEfficiency` | `id`, `efficiency`, `simulatorId` (via trigger transform) | Reactor output changed | Power-level look |
| `fluxPower` / `damageSystem` / `repairSystem` | `simulatorId`, `systemId` | System power flux, break, fix | Damage indicator |
| `shieldRaised` / `shieldLowered` | `id` | Shields | Accent color |
| `firePhasers` / `fireTorpedo` | `id` | Weapons | Flash |
| `setSelfDestructTime` / `setSelfDestructAuto` | `simulatorId` | Self-destruct armed | Pulse |
| `pauseFlight` / `resumeFlight` / `resetFlight` | `flightId` | Flight control | Work lights on reset |
| `startFlight` / `deleteFlight` | | | Base state |
| `notify` | `simulatorId`, `title`, `body`, `color`, `type` | FD notification | Optional |
| `playSound` | `sound { asset }`, `clients[]` | Sound played | Sync SFX lighting |
| `triggerKeyboardAction` | `simulatorId`, `id`, `key`, `keyCode`, `meta[]` | Thorium keyboard set key pressed | Replace kiosk keystroke behavior |
| `clientSetFlight` / `clientSetSimulator` / `clientSetStation` | `client`, ids | FD assigns this client | Re-scope |

### A.4 State subscriptions and derived events

| Subscription | Fields used | Derived events |
|--------------|-------------|----------------|
| `simulatorsUpdate(simulatorId)` | `id name alertlevel alertLevelLock training lighting { intensity action actionStrength transitionDuration }` | `alertLevel.changed`, `training.changed`, `lighting.actionChanged`, `lighting.intensityChanged` |
| `reactorUpdate(simulatorId)` | `id model powerOutput efficiency batteryChargeLevel batteryChargeRate depletion ejected externalPower heat` | `battery.below(threshold)`, `battery.above(threshold)`, `reactor.ejected`, `reactor.externalPower`, `reactor.heatAbove(threshold)`, `power.outputChanged` |
| `systemsUpdate(simulatorId, power: true)` | `id name displayName type power { power powerLevels } damage { damaged destroyed }` | `system.damaged`, `system.repaired`, `system.powerChanged`, `power.totalDrawChanged` |
| `flightsUpdate` | `id name running simulators { id name }` | `flight.started`, `flight.paused`, `flight.resumed`, `flight.ended` |
| `clientChanged(clientId)` | `flight simulator station` | `client.assigned` |
| `notify(simulatorId)` | `title body color type` | passthrough |
| `shieldsUpdate(simulatorId)` | `id state integrity` | `shields.raised`, `shields.lowered` |
| `stealthFieldUpdate(simulatorId)` | `state charge` | `stealth.on/off` |

### A.5 Reference data queries

Used to present names instead of ids in the trigger editor and to resolve names at runtime.

- `macros { id name }` and `macrosUpdate`
- `macroButtons { id name buttons { id name category color } }` and `macroButtonsUpdate`
- `missions { id name timeline { id name timelineItems { id name event args } } }`
- `flights(running: true) { id name simulators { id name } }`
- `simulators(template: false) { id name alertlevel training }`
- `thorium { thoriumId version }` (for the connection test)

### A.6 Thorium's built-in DMX model (for reference only)

Thorium models `DMXDevice` (channel order), `DMXFixture` (start channel, tags, active/passive), `DMXSet` and `DMXConfig` (alert level × tag → color/intensity). Its client renders a 512-channel universe at 40 Hz from `simulatorsUpdate.lighting` and alert level, and sends via Enttec USB DMX Pro or sACN unicast. This app does not use that model; it uses raw scenes. Thorium's DMX pages can remain configured or be ignored.

## Appendix B — MQTT contract (default)

Base topic `cmsc/lighting/<instanceName>` (configurable).

| Topic | Direction | Payload | Notes |
|-------|-----------|---------|-------|
| `…/status` | publish, retained | `{"online":true,"version":"1.0.0","profile":"Central","uptimeSec":123}` | Last-will sets `{"online":false}` |
| `…/outputs/<outputName>` | publish, retained | `{"state":"ok","driver":"sacn","universe":10,"fps":40,"lastSend":"…"}` | On change |
| `…/thorium` | publish, retained | `{"connected":true,"flight":"…","simulators":["Magellan"]}` | On change |
| `…/thorium/alertLevel/<simulatorName>` | publish, retained | `{"level":"3","training":false}` | On change |
| `…/scenes/active` | publish, retained | `[{"scene":"Red Alert","simulator":"Magellan","layer":"Alert"}]` | On change |
| `…/events` | publish | normalized event JSON | Optional, off by default |
| `…/cmd` | subscribe | `{"action":"activateScene","scene":"Party","simulator":"Magellan"}`, `{"action":"releaseScene",…}`, `{"action":"blackout","on":true}`, `{"action":"setChannel","universe":10,"channel":5,"value":255,"holdMs":500}` | F-MQTT-07 |
| user-defined | subscribe | any | Matched by mappings |

## Appendix C — Seeded defaults on first run

- Layers: Base 0, Alert 10, Scene 20, Effect 30, Manual 40, Test 90, Blackout 100.
- Simulator profiles: Magellan (U10), Cassini (U10), Phoenix (U10), Odyssey (U11), Galileo (U11), Falcon (U11); base addresses 1, 51, 101 on each universe as placeholders flagged "confirm".
- Scenes (relative, Alert layer): `Alert 5 – Normal`, `Alert 4`, `Alert 3`, `Alert 2`, `Alert 1 – Red Alert`, `Alert P – Pause`; each sets `base+0`…`base+5` to a distinct single channel at 255 as a Mosaic-style trigger pattern. Users replace the values.
- Mappings: alert level 5…1 and p → matching scene; training on → Alert 5; `triggerAction action=blackout` → Blackout on; `triggerAction action=online` → Blackout off; `generic key=lights-*` examples disabled.
- Outputs: none (wizard creates the first).
