-- Digital Soul - Phase 1 schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)

create table if not exists users_entities (
  user_id uuid primary key default gen_random_uuid(),
  whatsapp_number text unique not null,
  entity_state jsonb not null default '{
    "happiness": 70,
    "energy": 70,
    "bond": 0,
    "last_interaction": null
  }'::jsonb,
  inventory jsonb not null default '[]'::jsonb,
  preferences jsonb not null default '{
    "schedule_morning": "09:00",
    "schedule_lunch": "13:00",
    "voice_vibe": "playful"
  }'::jsonb,
  social_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Conversation history, used as Claude context window
create table if not exists conversation_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references users_entities(user_id) on delete cascade,
  role text not null check (role in ('user','entity')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_history_user_id
  on conversation_history(user_id, created_at desc);

-- Keep updated_at fresh automatically
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_entities_updated_at on users_entities;
create trigger trg_users_entities_updated_at
  before update on users_entities
  for each row execute function set_updated_at();
