# AI Code Review Assistant — Sprint 1 Skeleton

## Prereqs
- Docker + Docker Compose
- Node 20+ (for local dev)

## Setup
1. Copy `.env.example` to `.env` and fill `GITHUB_WEBHOOK_SECRET`.
2. Build & run stack: `docker compose -f infra/docker-compose.dev.yml up --build`
3. Health check: `curl http://localhost:8080/healthz` → `{ "ok": true }`

## GitHub App (for webhooks)
- Create a GitHub App (Settings → Developer settings → GitHub Apps):
  - Permissions: Pull requests (Read), Contents (Read), Metadata (Read).
  - Subscribe to events: `pull_request`.
  - Webhook URL: `https://<your-tunnel>/webhooks/github`
  - Secret: same as `GITHUB_WEBHOOK_SECRET`.
- Install the app on your test repo.

## Local tunnel options
- ngrok: `ngrok http 8080` → use the https URL as webhook URL.

## Test flow
- Open a PR in the test repo.
- Watch logs: `docker logs -f <api-gateway-container>` and `docker logs -f <worker-container>`
- Verify DB row: `docker exec -it <postgres-container> psql -U review -d reviewdb -c "select id, repo, pr_number, head_sha, status from review_events order by received_at desc limit 5;"`