# Memory Dogfooding Plan

Goal: evaluate whether Joi memory is useful in daily work without letting noisy candidates become confirmed facts automatically.

## Rules

- Candidate memories enter Memory Inbox first.
- Do not automatically confirm every candidate memory.
- Confirm only stable user preferences, project facts, recurring constraints, and useful anti-patterns.
- Disable stale or low-confidence memories.
- Mark conflicts instead of overwriting silently.

## Three Day Log

Record these daily:

- false positive write proposals
- duplicates
- stale facts
- conflicts
- retrieval misses
- useful hits
- disabled memory leaks

## Console Workflow

Use Memory Studio -> Memory Inbox:

- Confirm: promote a candidate memory after review.
- Disable: prevent retrieval.
- Conflict: mark a suspected contradiction for later merge.
- Pin: prioritize a high-value memory.

## Success Criteria

- No disabled memories are retrieved.
- Pin priority works for high-value facts.
- Duplicates and conflicts are visible before they pollute confirmed memory.
- Real daily recall failures can be turned into eval cases.
