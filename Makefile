.PHONY: dev migrate seed test smoke build demo-reset down logs export aws-preflight

dev:
	docker compose up --build -d

migrate:
	docker compose up -d --wait db
	docker compose run --rm migrate

seed:
	docker compose exec backend python scripts/seed_demo.py

test:
	docker compose exec backend ruff check app tests scripts
	docker compose exec backend sh -c 'export TEST_DATABASE_URL="$${TEST_DATABASE_URL:-$$DATABASE_URL}"; test -n "$$TEST_DATABASE_URL" && pytest -q'
	docker compose exec frontend npm run typecheck

smoke:
	docker compose exec backend python scripts/smoke_test.py

build:
	docker build --target production -f backend/Dockerfile -t sevaro-api:local .
	cd frontend && npm ci && npm run build

demo-reset:
	@test -n "$(DATASET)" || (echo 'Choose the synthetic dataset explicitly: make demo-reset DATASET=<dataset-id>'; exit 2)
	docker compose exec backend python scripts/seed_demo.py --reset --dataset "$(DATASET)"

down:
	docker compose down

logs:
	docker compose logs --tail=100 backend frontend migrate

export:
	./scripts/export-local.sh

aws-preflight:
	./scripts/aws-preflight.sh
