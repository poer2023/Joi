# Golden Cases

Run:

```bash
cd /Users/hao/project/Joi
./evals/run_evals.sh
```

The suite validates structure, not exact model wording:

- selected agent
- capability request/tool run
- memory context pack usage
- model call presence
- run trace presence
- prompt cache fields
- main-node assignment
- safety denial for destructive requests

It assumes Orchestrator is running on `ORCHESTRATOR_URL` or `http://localhost:8080`.
