CREATE TABLE IF NOT EXISTS installations (
  installation_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('trial', 'paid', 'expired')),
  trial_ends_at INTEGER NOT NULL,
  paid_at INTEGER,
  customer_email TEXT,
  stripe_session_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS installations_status_idx
  ON installations(status);

CREATE INDEX IF NOT EXISTS installations_customer_email_idx
  ON installations(customer_email);
