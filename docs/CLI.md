# Joi CLI

Joi is CLI-first. The desktop window and the command line call the same `DesktopBindings` handler map through two local transports: Electron IPC for the renderer and an owner-only Unix socket for the CLI.

Current interface coverage is 144/144: 135 business bindings plus Run events, six persistent-terminal operations, app version, and external opening.

## Everyday commands

```bash
joi health
joi chat "总结当前项目状态"
joi settings
joi models
joi capabilities
joi plugins list
joi logs --set limit=20
joi run run_xxx
```

Output uses the stable envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "trace_id": "cli_xxx"
}
```

## Complete command surface

`joi commands` returns every method from `desktopBindingMethods`, its kebab-case command, risk classification, and whether explicit confirmation is required.

Every business operation supports both forms:

```bash
joi invoke ListCapabilities
joi call list-capabilities
```

Payloads can be supplied in four ways:

```bash
joi invoke GetConversation --json '"conv_xxx"'
joi invoke SaveWorkspaceSettings --input workspace-settings.json
cat request.json | joi invoke SaveAutomation --stdin
joi invoke ListLogs --set limit=20 --set level=error
```

Destructive and secret-changing commands fail closed until `--yes` is present:

```bash
joi plugins remove joi.provider.example --yes
joi invoke DeleteMemory --set id=mem_xxx --yes
```

## Runtime behavior

If Joi is not running, the CLI starts `/Applications/Joi.app` with `--joi-cli-headless`, hides the Dock/window, waits for the Unix socket, then performs the command. Running a CLI command against an open Joi window does not focus it.

```bash
joi status --no-start
joi daemon start
joi gui
```

The socket defaults to `~/Library/Application Support/Joi/joi-cli.sock`, is mode `0600`, and can be overridden with `JOI_CLI_SOCKET`. No public TCP control API is enabled by the CLI.

## Native terminal utility

The CLI exposes the same persistent PTY lifecycle as the renderer:

```bash
joi terminal start --set id=term_demo --set cwd=/Users/hao/project/Joi
joi terminal attach term_demo
joi terminal input term_demo $'pwd\n'
joi terminal resize term_demo --set cols=120 --set rows=36
joi terminal status term_demo
joi terminal kill term_demo
```

`attach` emits replayable JSONL events with `id`, `run_id`, `seq`, `type`, `status`, and `created_at`. Output and errors use `stdout` and `stderr` fields.

For one-shot commands, `terminal exec` runs a bounded local process and returns stdout, stderr, exit code, signal, and duration in the normal response envelope:

```bash
joi terminal exec git status --short
```

## Live Run Trace

Run and terminal events use the same JSONL event contract:

```bash
joi run run_xxx --follow
joi run run_xxx --follow --after-seq 20
joi watch runs
joi watch runs run_xxx
joi watch terminal term_demo
```

Specific run and terminal subscriptions close automatically on terminal completion/failure. Wildcard watches remain open until interrupted or the configured timeout.
