-- PostgreSQL 15+. Run: psql $DATABASE_URL -f db/schema.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  profession    text NOT NULL,              -- feeds the question bank
  timezone      text NOT NULL DEFAULT 'UTC',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Relationship mapping: exactly two users per couple
CREATE TABLE couples (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a      uuid NOT NULL REFERENCES users(id),
  user_b      uuid REFERENCES users(id),     -- null until partner joins
  invite_code text UNIQUE NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (user_b IS NULL OR user_a <> user_b)
);
CREATE UNIQUE INDEX one_couple_per_user_a ON couples(user_a);
CREATE UNIQUE INDEX one_couple_per_user_b ON couples(user_b) WHERE user_b IS NOT NULL;

CREATE TABLE puzzles (
  id         serial PRIMARY KEY,
  slug       text UNIQUE NOT NULL,
  title      text NOT NULL,
  variables  jsonb NOT NULL,   -- [{key,label,min,max,unit}]
  difficulty smallint NOT NULL DEFAULT 1
);

-- Asymmetric state. `targets` and `hints` are NEVER sent to Player One.
CREATE TABLE puzzle_states (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id  uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  puzzle_id  int  NOT NULL REFERENCES puzzles(id),
  player_one uuid NOT NULL REFERENCES users(id),   -- manipulates variables
  player_two uuid NOT NULL REFERENCES users(id),   -- holds hints
  targets    jsonb NOT NULL,                       -- {key: number}
  hints      jsonb NOT NULL,                       -- {key: "clue text"}
  variables  jsonb NOT NULL,                       -- current values set by P1
  alignment  jsonb NOT NULL DEFAULT '{}',          -- {key: 0..1}
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','solved','abandoned')),
  attempts   int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  solved_at  timestamptz
);
CREATE INDEX ON puzzle_states(couple_id, status);

CREATE TABLE progression_logs (
  id       bigserial PRIMARY KEY,
  state_id uuid NOT NULL REFERENCES puzzle_states(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  event    text NOT NULL,            -- start | adjust | solved
  payload  jsonb NOT NULL DEFAULT '{}',
  at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id       serial PRIMARY KEY,
  template text NOT NULL,            -- {{a}} {{b}} = professions, {{name_a}} {{name_b}}
  tags     text[] NOT NULL DEFAULT '{}'
);

-- Shared digital timeline; answers are unstructured JSON keyed by user id
CREATE TABLE memory_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id   uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  state_id    uuid REFERENCES puzzle_states(id),
  question_id int  REFERENCES questions(id),
  prompt_text text NOT NULL,                    -- rendered prompt, frozen when asked
  answers     jsonb NOT NULL DEFAULT '{}',      -- {"<userId>": {text, mood, anything}}
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, state_id, question_id)
);
CREATE INDEX ON memory_logs(couple_id, created_at DESC);
CREATE INDEX memory_answers_gin ON memory_logs USING gin (answers);

INSERT INTO puzzles(slug,title,variables) VALUES
('lighthouse','The Lighthouse Keepers','[
 {"key":"lamp","label":"Lamp","min":0,"max":100,"unit":"%"},
 {"key":"tide","label":"Tide","min":0,"max":10,"unit":"m"},
 {"key":"wind","label":"Wind","min":0,"max":60,"unit":"kn"},
 {"key":"fog","label":"Fog","min":0,"max":100,"unit":"%"}]');

INSERT INTO questions(template,tags) VALUES
('As a {{a}}, what is one problem you would solve differently if you saw it through {{b}} eyes?','{craft}'),
('Explain your hardest week to {{name_b}} using only the vocabulary of {{b}}.','{work}'),
('What would a project that needs both a {{a}} and a {{b}} look like for the two of you?','{future}'),
('Which everyday habit of {{name_b}} would you call "good {{a}} practice"?','{play}'),
('Teach {{name_b}} one concept from your field in three sentences, no jargon.','{teach}');
CREATE TABLE game_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id  uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  game       text NOT NULL CHECK (game IN ('tod','sync','notes')),
  state      jsonb NOT NULL,                 -- full game state, role-filtered when sent
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON game_sessions(couple_id, game, status);
