-- Usage metering for managed models (blaze-auth 0.9.0). Apply with:
--   npx wrangler d1 migrations apply blaze-usage --remote
CREATE TABLE IF NOT EXISTS usage (
  uid TEXT NOT NULL,
  day TEXT NOT NULL,              -- YYYY-MM-DD, UTC
  tokens INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, day)
);

CREATE TABLE IF NOT EXISTS rate (
  uid TEXT NOT NULL,
  minute INTEGER NOT NULL,        -- unix seconds / 60
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, minute)
);

CREATE INDEX IF NOT EXISTS usage_day ON usage (day);
CREATE INDEX IF NOT EXISTS rate_minute ON rate (minute);
