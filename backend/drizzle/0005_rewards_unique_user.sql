-- One reward balance per (household, user).
--
-- The completion path used find-then-insert with no unique constraint, so
-- concurrent completions could race into duplicate reward rows, after which
-- points silently split across them. Merge any existing duplicates into the
-- oldest row (repointing history and summing balances), then add the unique
-- constraint the new upsert path relies on.

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY household_id, user_id
           ORDER BY updated_at ASC, id ASC
         ) AS keep_id
  FROM rewards
),
dups AS (
  SELECT id, keep_id FROM ranked WHERE id <> keep_id
)
UPDATE reward_history rh
SET reward_id = d.keep_id
FROM dups d
WHERE rh.reward_id = d.id;
--> statement-breakpoint

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY household_id, user_id
           ORDER BY updated_at ASC, id ASC
         ) AS keep_id
  FROM rewards
),
dup_totals AS (
  SELECT r.keep_id,
         sum(rw.points) AS extra_points,
         sum(rw.lifetime_points) AS extra_lifetime
  FROM ranked r
  JOIN rewards rw ON rw.id = r.id
  WHERE r.id <> r.keep_id
  GROUP BY r.keep_id
)
UPDATE rewards
SET points = rewards.points + dup_totals.extra_points,
    lifetime_points = rewards.lifetime_points + dup_totals.extra_lifetime
FROM dup_totals
WHERE rewards.id = dup_totals.keep_id;
--> statement-breakpoint

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY household_id, user_id
           ORDER BY updated_at ASC, id ASC
         ) AS keep_id
  FROM rewards
)
DELETE FROM rewards
WHERE id IN (SELECT id FROM ranked WHERE id <> keep_id);
--> statement-breakpoint

ALTER TABLE rewards
  ADD CONSTRAINT rewards_household_user_unique UNIQUE (household_id, user_id);
