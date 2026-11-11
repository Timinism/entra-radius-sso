CREATE TABLE IF NOT EXISTS harbor_state (
  stage text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
