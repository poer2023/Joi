# Legacy Wails Desktop Tech Selection

Status: superseded by the Electron-native refactor in `docs/53_ELECTRON_NATIVE_REFACTOR.md`.

## Decision

- Historical default: Wails
- Current default: Electron-native
- Not first choice: Tauri
- Backup option: Tauri + Go sidecar

## Why Wails Was Chosen

Joi's core backend is already Go. Wails lets the desktop application bind Go methods directly to a modern frontend without making the desktop shell call its own localhost HTTP server.

This matches the product target:

- lightweight local app
- embedded Go AppCore
- embedded UI
- local SQLite
- no default Docker
- no default Postgres
- no default NATS
- minimal operational surface for the user

## Why Electron Became Default Later

The current refactor moves the long-term desktop runtime to Electron main/preload/renderer plus TypeScript services, removing the Go sidecar as the default architecture. This changes the earlier tradeoff: Electron is now the target shell, while Wails remains a legacy/parity path during cutover.

## Why Not Tauri First

Tauri is a strong desktop framework, but Joi's backend is Go. A Tauri design would typically require a Rust shell plus Go sidecar. That is a valid fallback, not the shortest path to reusing AppCore.

## Legacy Wails Boundary

Wails binds a `DesktopApp` object:

```go
type DesktopApp struct {
    core *appcore.AppCore
}
```

The legacy frontend calls bound methods:

- `SendChat`
- `GetRunTrace`
- `ListMemories`
- `ListNodes`
- `GetSystemHealth`

The Electron renderer now calls the controlled `window.joi` preload API instead of Wails bindings.

## Server Mode Remains

The existing Web Console and Docker Compose deployment are retained as Server Mode and Dev Mode. They are not deleted; they are no longer the default product path.
