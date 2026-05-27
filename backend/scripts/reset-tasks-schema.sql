-- Phase 1: Nuke and recreate tasks/rewards schema.
-- Drops the legacy tables, achievements system, and old enums; recreates with
-- the new task/chore model.

BEGIN;

-- Drop legacy tables (CASCADE clears FK dependents).
DROP TABLE IF EXISTS user_achievements CASCADE;
DROP TABLE IF EXISTS achievements CASCADE;
DROP TABLE IF EXISTS reward_history CASCADE;
DROP TABLE IF EXISTS rewards CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;

-- Drop old enums so we can redefine task_status with new values.
DROP TYPE IF EXISTS task_status CASCADE;
DROP TYPE IF EXISTS task_kind CASCADE;
DROP TYPE IF EXISTS recurrence_mode CASCADE;
DROP TYPE IF EXISTS achievement_criteria_type CASCADE;

-- New enums.
CREATE TYPE task_kind AS ENUM ('task', 'chore');
CREATE TYPE task_status AS ENUM ('pending', 'completed');
CREATE TYPE recurrence_mode AS ENUM ('schedule', 'reset_on_complete');

-- Tasks (covers both kinds).
CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    kind task_kind NOT NULL DEFAULT 'task',
    title varchar(255) NOT NULL,
    description text,

    assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    assignee_group_id uuid REFERENCES groups(id) ON DELETE SET NULL,

    due_date timestamp,
    cadence_days integer,

    recurrence_mode recurrence_mode,
    recurrence_rule varchar(255),

    status task_status NOT NULL DEFAULT 'pending',
    last_completed_at timestamp,
    last_completed_by uuid REFERENCES users(id) ON DELETE SET NULL,

    pinned boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,

    reward_points integer NOT NULL DEFAULT 0,

    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),

    CONSTRAINT tasks_assignee_xor CHECK (
        assignee_user_id IS NULL OR assignee_group_id IS NULL
    )
);

CREATE INDEX tasks_household_kind_idx ON tasks(household_id, kind);
CREATE INDEX tasks_assignee_user_idx ON tasks(assignee_user_id);
CREATE INDEX tasks_assignee_group_idx ON tasks(assignee_group_id);

-- Rewards (current + lifetime points per user).
CREATE TABLE rewards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points integer NOT NULL DEFAULT 0,
    lifetime_points integer NOT NULL DEFAULT 0,
    updated_at timestamp NOT NULL DEFAULT now(),
    UNIQUE (household_id, user_id)
);

-- Reward history (audit of point changes).
CREATE TABLE reward_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reward_id uuid NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
    task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
    points_change integer NOT NULL,
    reason varchar(255) NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX reward_history_reward_idx ON reward_history(reward_id);

COMMIT;
