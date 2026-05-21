SHELL := /usr/bin/env bash

.PHONY: dev-up dev-down prod-up worker-up e2e-real model-baseline cost-latency-baseline telegram-check vps-worker-check prod-status soak-test test build backup restore

dev-up:
	./scripts/dev_up.sh

dev-down:
	./scripts/dev_down.sh

prod-up:
	./scripts/prod_up.sh

worker-up:
	./scripts/worker_up.sh

e2e-real:
	ALLOW_MOCK_PROVIDER=false REQUIRE_REAL_MODEL=true REQUIRE_REAL_TELEGRAM=true ./scripts/e2e_real_check.sh

model-baseline:
	ALLOW_MOCK_PROVIDER=false REQUIRE_REAL_MODEL=true ./scripts/run_model_baseline.sh

cost-latency-baseline:
	ALLOW_MOCK_PROVIDER=false REQUIRE_REAL_MODEL=true ./scripts/run_cost_latency_baseline.sh

telegram-check:
	./scripts/run_telegram_real_check.sh

vps-worker-check:
	./scripts/check_vps_worker.sh

prod-status:
	./scripts/check_prod_status.sh

soak-test:
	./scripts/soak_test_24h.sh

test:
	cd services/orchestrator-core && go test ./...
	cd services/worker-runtime && go test ./...
	cd services/telegram-gateway && go test ./...
	./evals/run_evals.sh
	./scripts/run_security_evals.sh
	./scripts/run_memory_evals.sh
	./scripts/run_agent_evals.sh

build:
	cd apps/console-web && npm run build

backup:
	./scripts/backup.sh

restore:
	./scripts/restore.sh "$(BACKUP)"
