-- PostgreSQL production schema (the local development adapter stores the same fields encrypted at rest).
create table if not exists users (
  id uuid primary key, email text unique, display_name text not null,
  avatar_url text, timezone text not null default 'UTC', streak integer not null default 0,
  last_active_on date, created_at timestamptz not null default now()
);
create table if not exists conversations (
  id uuid primary key, user_id uuid not null references users(id) on delete cascade,
  title text not null default 'A quiet moment', created_at timestamptz not null default now()
);
create table if not exists messages (
  id uuid primary key, conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','companion')), ciphertext bytea not null,
  iv bytea not null, tag bytea not null, model_tier text, effort integer, created_at timestamptz not null default now()
);
create table if not exists tasks (
  id uuid primary key, user_id uuid not null references users(id) on delete cascade,
  title text not null, due_at timestamptz, routine boolean not null default false,
  completed boolean not null default false, created_at timestamptz not null default now()
);
