-- Bumps whenever the reaper zeroes an expired lease. release() is scoped to
-- the generation it was handed, so a request that outlives its lease cannot
-- decrement the counter of a request that re-leased the same slot.
ALTER TABLE groq_key_state ADD COLUMN reap_generation INTEGER NOT NULL DEFAULT 0;
