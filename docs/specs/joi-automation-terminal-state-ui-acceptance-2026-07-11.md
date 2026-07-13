# Joi automation terminal-state UI acceptance — 2026-07-11

## Scope

- Project: Joi Desktop
- Target: installed `/Applications/Joi.app`, automation conversation transcript
- User job: tell whether an automation is still running after its answer is complete

## Reference

- Primary reference: user Appshot showing one `已完成 53s / 11 步` block followed by a second `运行中 237m / 1 步` block for the same run
- Live run: `run_mrfnr7gp4l1bne`
- Database truth: run `completed`, automation run `succeeded`, duration `53031ms`, finished at `2026-07-11 01:01:19`

## Information structure

- Keep: the final assistant answer and its completed execution summary
- Remove: successful automation lifecycle noise after the answer
- Keep in Run Trace: trigger, claim, start, completion and notification events
- Do not add: new status cards, banners, controls or destructive recovery actions

## Interaction rules

- Terminal event types (`*.completed`, `*.failed`, `*.cancelled`) override a contradictory legacy payload status
- A terminal run must never keep a one-second elapsed-time timer alive
- Automation failure remains visible; successful internal lifecycle events remain trace-only
- Restarting the installed app must preserve the terminal rendering

## Verification

- Unit: normalize a legacy `automation.run_completed` event carrying `status: running` to `completed`
- Projection: successful automation lifecycle events do not render as chat transcript items; failure still does
- Installed app: reopen the same conversation and confirm there is no `运行中` card for this run
- Evidence: Computer Use accessibility tree and screenshot after reinstall
- Installed evidence: `docs/specs/joi-automation-terminal-state-installed.jpeg`

## Done means

- [x] Only the final completed execution state remains visible for the run
- [x] Elapsed time no longer grows after 53 seconds
- [x] Run Trace retains automation lifecycle evidence
- [x] Source tests, package build and installed-app visual verification pass
