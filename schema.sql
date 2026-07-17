PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  membership TEXT NOT NULL DEFAULT 'free' CHECK(membership IN ('free','plus','premium','elite','legend')),
  billing_cycle TEXT NOT NULL DEFAULT 'none' CHECK(billing_cycle IN ('none','monthly','yearly','lifetime')),
  theme TEXT NOT NULL DEFAULT 'dark' CHECK(theme IN ('dark','light')),
  newsletter INTEGER NOT NULL DEFAULT 0 CHECK(newsletter IN (0,1)),
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0,1)),
  avatar TEXT NOT NULL DEFAULT 'spark',
  coins INTEGER NOT NULL DEFAULT 300 CHECK(coins >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  tournament_banned INTEGER NOT NULL DEFAULT 0 CHECK(tournament_banned IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  species TEXT NOT NULL CHECK(species IN ('hamster','cat','dog','dino','alien')),
  name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK(gender IN ('female','male','neutral')),
  color TEXT NOT NULL,
  pattern TEXT NOT NULL,
  eye_color TEXT NOT NULL,
  personality TEXT NOT NULL,
  favorite_food TEXT NOT NULL,
  difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 0 AND 50),
  stage TEXT NOT NULL DEFAULT 'egg',
  stats_json TEXT NOT NULL,
  traits_json TEXT NOT NULL,
  room_json TEXT NOT NULL,
  born_at TEXT NOT NULL,
  last_tick_at TEXT NOT NULL,
  last_action_at TEXT NOT NULL,
  alive INTEGER NOT NULL DEFAULT 1 CHECK(alive IN (0,1)),
  death_cause TEXT,
  care_errors INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price >= 0),
  rarity TEXT NOT NULL DEFAULT 'common',
  emoji TEXT NOT NULL,
  effects_json TEXT NOT NULL,
  min_membership TEXT NOT NULL DEFAULT 'free',
  seasonal INTEGER NOT NULL DEFAULT 0 CHECK(seasonal IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE IF NOT EXISTS inventory (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  equipped INTEGER NOT NULL DEFAULT 0 CHECK(equipped IN (0,1)),
  PRIMARY KEY(user_id,item_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  reward INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY(user_id,achievement_id)
);

CREATE TABLE IF NOT EXISTS minigame_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score >= 0),
  duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_nonces (
  nonce TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  theme TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  rewards_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  season_id TEXT REFERENCES seasons(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  registration_deadline TEXT NOT NULL,
  allowed_species_json TEXT NOT NULL,
  min_stage TEXT NOT NULL DEFAULT 'child',
  reward_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming'
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  score REAL,
  breakdown_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'registered',
  created_at TEXT NOT NULL,
  UNIQUE(tournament_id,user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS newsletter_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent INTEGER NOT NULL CHECK(consent IN (0,1)),
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  ip_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_events (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pets_user ON pets(user_id);
CREATE INDEX IF NOT EXISTS idx_events_pet_created ON game_events(pet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scores_game_score ON minigame_scores(game, score DESC);
CREATE INDEX IF NOT EXISTS idx_entries_tournament_score ON tournament_entries(tournament_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
