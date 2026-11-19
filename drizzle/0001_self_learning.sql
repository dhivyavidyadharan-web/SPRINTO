ALTER TABLE emails ADD COLUMN IF NOT EXISTS trial_rule_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE emails ADD COLUMN IF NOT EXISTS variant jsonb;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'human';
ALTER TABLE rules ADD COLUMN IF NOT EXISTS evidence jsonb;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
CREATE TABLE IF NOT EXISTS experiments (
  id serial PRIMARY KEY,
  dimension text NOT NULL,
  arm_a text NOT NULL,
  arm_b text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  winner text,
  result jsonb,
  winner_rule_id integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  concluded_at timestamptz
);
CREATE TABLE IF NOT EXISTS learning_suggestions (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  target text NOT NULL,
  company_id integer REFERENCES companies(id) ON DELETE CASCADE,
  current jsonb,
  proposed jsonb,
  rationale text NOT NULL,
  evidence jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
