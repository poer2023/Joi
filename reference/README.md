# Reference Snapshots

This directory is for local, non-product source snapshots used by analysis documents.

Do not use `/Users/hao/Documents/Joi/reference` as a source path. The active Joi repo is `/Users/hao/project/Joi`, and the old Documents path is stale.

`docs/51_CODEX_PARITY_GAP_ANALYSIS.md` references an optional Codex snapshot expected at:

```text
reference/openai-codex
```

Rehydrate it only when you need to refresh or verify that analysis:

```bash
cd /Users/hao/project/Joi
mkdir -p reference
git clone https://github.com/openai/codex.git reference/openai-codex
cd reference/openai-codex
git checkout 2d5c264ebc26c276ca6cc312389abde453ca69aa
```

`reference/openai-codex/` is intentionally ignored so the external repository is not committed into Joi.
