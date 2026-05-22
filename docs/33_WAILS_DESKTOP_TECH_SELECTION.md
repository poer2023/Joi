# Wails Desktop Tech Selection

Decision: Joi Desktop uses Wails by default.

## Decision

- Default: Wails
- Not first choice: Electron
- Not first choice: Tauri
- Backup option: Tauri + Go sidecar

## Why Wails

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

## Why Not Electron First

Electron would work, but it would add a heavier runtime and would still need a Go sidecar or a service boundary. That pushes the project back toward "desktop wrapper around local SaaS."

## Why Not Tauri First

Tauri is a strong desktop framework, but Joi's backend is Go. A Tauri design would typically require a Rust shell plus Go sidecar. That is a valid fallback, not the shortest path to reusing AppCore.

## Wails Boundary

Wails binds a `DesktopApp` object:

```go
type DesktopApp struct {
    core *appcore.AppCore
}
```

The frontend calls bound methods:

- `SendChat`
- `GetRunTrace`
- `ListMemories`
- `ListNodes`
- `GetSystemHealth`

The frontend does not call `localhost` in Desktop Mode.

## Server Mode Remains

The existing Web Console and Docker Compose deployment are retained as Server Mode and Dev Mode. They are not deleted; they are no longer the default product path.
