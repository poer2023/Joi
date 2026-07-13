# Joi CLI-first acceptance contract

## Objective

Joi must expose every `DesktopBindings` business operation through a stable local CLI. Electron renderer IPC and the CLI must invoke the same handler map; the renderer may present and compose commands, but it must not own a separate implementation of business behavior.

Verified installed coverage: **144/144** interface operations (135 business bindings + 9 auxiliary operations).

## Gate 0 — current-state inventory

- Source of truth: `packages/shared-types/src/desktop-api.ts`.
- Current contract size: every entry in `desktopBindingMethods` (135 at the start of this migration).
- Current implementation source: the `sqliteApi` handler map in `apps/joi-electron/src/main/ipc.ts`.
- Existing browser bridge is a development aid and is not the production CLI transport.

Stop condition: the contract list and handler list have zero missing or extra methods.

## Gate 1 — command plane

- A local Unix domain socket is created inside the Joi user-data directory with owner-only permissions.
- `describe`, `ping`, and `invoke` use the project response envelope: `{ ok, data, error, trace_id }`.
- `invoke` accepts every method in `desktopBindingMethods` without a second business implementation.
- Run Trace subscriptions expose replay plus live JSONL events using stable `id`, `run_id`, `seq`, `type`, `status`, and `created_at` fields.
- Persistent terminal start/input/resize/kill/status and terminal-event subscriptions use the same `TerminalSessionManager` as the GUI.
- Destructive or secret-changing methods require an explicit CLI confirmation flag.
- The CLI accepts JSON from an argument, file, stdin, or repeated `--set key=value` entries.
- The CLI can auto-start an installed, hidden Joi runtime when no GUI process is running.
- Starting the CLI against an already-running GUI must not focus or open the GUI.

Stop condition: an automated contract test proves 144/144 interface-operation coverage and a live headless CLI can call `GetSystemHealth`, `ListCapabilities`, a write operation, `SendChat`, Run Trace follow, and the complete persistent PTY lifecycle through shared handlers.

## Gate 2 — distribution and installed proof

- The macOS application contains the self-contained CLI client.
- Packaging installs an executable `joi` launcher into `~/.local/bin` without requiring a separate Node installation.
- `joi commands`, `joi health`, `joi chat`, and `joi invoke <DesktopBinding>` work against `/Applications/Joi.app`.
- Existing `~/Library/Application Support/Joi` data and Keychain secrets remain in place.
- Electron contract tests, CLI tests, TypeScript checks, packaging, codesign, and installed-app smoke all pass.

Stop condition: the installed CLI proves all contract methods are discoverable and the GUI still completes its normal installed-app smoke using the same handler map.

## Non-goals

- The GUI will not shell out to the `joi` executable for each click; both clients share the same in-process command bus instead.
- No public TCP API or unauthenticated remote control surface is introduced.
- No existing user data, model credentials, plugin state, conversations, or backups are reset during the migration.
