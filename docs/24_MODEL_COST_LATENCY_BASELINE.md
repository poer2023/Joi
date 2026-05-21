# Model Cost and Latency Baseline

Generated at: 2026-05-22 00:14:21

## Sample

- Requested calls: 50
- Run IDs: run_91d4f57d76ab77f2d3adc68b, run_a717f8ec507ae85913a86a50, run_1467462a36deda50ea3ea426, run_18d73662af202566fe95d8e5, run_c4c147cf77c59cf41a447196, run_e4081f367173505fe5dfea50, run_566761a7214380545e5c9d66, run_cbfe69e0cbf6e23d22adc14d, run_78d5784a3e4bb8228248876c, run_707eee75a2a8b542d11bbf61 ...

## Metrics

- Average latency: 3026 ms
- p95 latency: 5415 ms
- Fallback calls in recent window: 0
- Error calls in recent window: 0
- Estimated total cost in summary window: $0.088467

## Provider / Model / Agent

```json
[
  {
    "agent": "general_agent",
    "avg_latency_ms": 3216.7272727272725,
    "cache_hit_ratio": 0.8773068273506034,
    "cached_input_tokens": 408832,
    "calls": 99,
    "error_calls": 0,
    "estimated_cost": 0.026763296000000002,
    "fallback_calls": 0,
    "input_tokens": 466008,
    "model": "deepseek-v4-flash",
    "output_tokens": 26112,
    "provider": "openai_compatible"
  },
  {
    "agent": "research_agent",
    "avg_latency_ms": 2929.8101265822784,
    "cache_hit_ratio": 0.8617838237004617,
    "cached_input_tokens": 318592,
    "calls": 79,
    "error_calls": 0,
    "estimated_cost": 0.021772716,
    "fallback_calls": 0,
    "input_tokens": 369689,
    "model": "deepseek-v4-flash",
    "output_tokens": 20352,
    "provider": "openai_compatible"
  },
  {
    "agent": "memory_agent",
    "avg_latency_ms": 3038.746031746032,
    "cache_hit_ratio": 0.6920877864274091,
    "cached_input_tokens": 251776,
    "calls": 63,
    "error_calls": 0,
    "estimated_cost": 0.027094368,
    "fallback_calls": 0,
    "input_tokens": 363792,
    "model": "deepseek-v4-flash",
    "output_tokens": 15580,
    "provider": "openai_compatible"
  },
  {
    "agent": "devops_agent",
    "avg_latency_ms": 0,
    "cache_hit_ratio": 0,
    "cached_input_tokens": 0,
    "calls": 119,
    "error_calls": 0,
    "estimated_cost": 0,
    "fallback_calls": 50,
    "input_tokens": 235292,
    "model": "mock-model",
    "output_tokens": 4055,
    "provider": "mock_provider"
  },
  {
    "agent": "general_agent",
    "avg_latency_ms": 0,
    "cache_hit_ratio": 0,
    "cached_input_tokens": 0,
    "calls": 62,
    "error_calls": 0,
    "estimated_cost": 0,
    "fallback_calls": 8,
    "input_tokens": 159737,
    "model": "mock-model",
    "output_tokens": 1961,
    "provider": "mock_provider"
  },
  {
    "agent": "devops_agent",
    "avg_latency_ms": 3280.84375,
    "cache_hit_ratio": 0.7318008169308252,
    "cached_input_tokens": 110720,
    "calls": 32,
    "error_calls": 0,
    "estimated_cost": 0.011329360000000002,
    "fallback_calls": 0,
    "input_tokens": 151298,
    "model": "deepseek-v4-flash",
    "output_tokens": 9101,
    "provider": "openai_compatible"
  },
  {
    "agent": "research_agent",
    "avg_latency_ms": 0,
    "cache_hit_ratio": 0,
    "cached_input_tokens": 0,
    "calls": 60,
    "error_calls": 0,
    "estimated_cost": 0,
    "fallback_calls": 15,
    "input_tokens": 147468,
    "model": "mock-model",
    "output_tokens": 1906,
    "provider": "mock_provider"
  },
  {
    "agent": "memory_agent",
    "avg_latency_ms": 0,
    "cache_hit_ratio": 0,
    "cached_input_tokens": 0,
    "calls": 32,
    "error_calls": 0,
    "estimated_cost": 0,
    "fallback_calls": 14,
    "input_tokens": 86618,
    "model": "mock-model",
    "output_tokens": 1116,
    "provider": "mock_provider"
  },
  {
    "agent": "product_agent",
    "avg_latency_ms": 0,
    "cache_hit_ratio": 0,
    "cached_input_tokens": 0,
    "calls": 4,
    "error_calls": 0,
    "estimated_cost": 0,
    "fallback_calls": 0,
    "input_tokens": 11514,
    "model": "mock-model",
    "output_tokens": 124,
    "provider": "mock_provider"
  },
  {
    "agent": "product_agent",
    "avg_latency_ms": 4092,
    "cache_hit_ratio": 0.05342794531983721,
    "cached_input_tokens": 512,
    "calls": 2,
    "error_calls": 0,
    "estimated_cost": 0.0015074360000000002,
    "fallback_calls": 0,
    "input_tokens": 9583,
    "model": "deepseek-v4-flash",
    "output_tokens": 797,
    "provider": "openai_compatible"
  }
]
```

## Conclusions

- cheap_model: not urgent for this baseline. Total estimated real-model cost is still low; general_agent is the largest real-model call volume, but not an immediate cost outlier.
- memory_context_pack: memory_agent has the lowest core-agent cache hit ratio among active real-model traffic, so shorten or stabilize its dynamic retrieval pack first if costs grow.
- prompt prefix: general_agent and research_agent cache well in this run; product_agent has too few real calls to judge.
- Historical mock_provider rows are retained in the aggregate table, but the recent 50-call window had fallback=0 and error=0.
