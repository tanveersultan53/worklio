.PHONY: up down logs migrate revision test api-shell web desktop

up:            ## Start backend infra + api + worker
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f api worker

migrate:
	docker compose exec api alembic upgrade head

revision:      ## make revision m="add something"
	docker compose exec api alembic revision --autogenerate -m "$(m)"

test:
	docker compose exec api pytest -q

api-shell:
	docker compose exec api bash

desktop:       ## Run the desktop app against http://localhost:3000
	cd desktop && npm install && WORKLIO_URL=http://localhost:3000 npm start

web:           ## Run the Next.js dev server
	cd frontend && npm run dev
