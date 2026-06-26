# Joi Settings Content Width Alignment Acceptance

- [x] Token usage page uses the same settings detail content rail as the other settings pages.
- [x] Every settings detail topbar resolves to the same width.
- [x] Every settings detail panel resolves to the same width when present.
- [x] Settings pages without forms still keep their main content inside the shared detail rail.
- [x] Chat page empty state and message rail use the same content width as the composer.
- [x] Frontend build completes.
- [x] Browser preview confirms there are no remaining settings detail width outliers.

Verified in the in-app browser at `http://127.0.0.1:5173/`: Token usage, DeepSeek, log cleanup, memory search, custom tools, and raw data resolve to a `1040px` settings rail; chat empty state and composer both resolve to `760px`.
