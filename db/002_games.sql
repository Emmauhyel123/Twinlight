CREATE TABLE game_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id  uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  game       text NOT NULL CHECK (game IN ('tod','sync','notes')),
  state      jsonb NOT NULL,                 -- full game state, role-filtered when sent
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON game_sessions(couple_id, game, status);
