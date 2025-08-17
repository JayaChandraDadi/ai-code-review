CREATE TABLE IF NOT EXISTS review_events (
  id UUID PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INT NOT NULL,
  head_sha TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_events_repo_pr ON review_events(repo, pr_number);