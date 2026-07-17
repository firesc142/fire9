-- Paperfly Dashboard — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query

-- ── machines table ────────────────────────────────────────────────────────────
-- One row per machine, upserted every 30 seconds by the local server.

create table if not exists machines (
  machine_id     text        primary key,
  machine_name   text        not null,
  platform       text,
  cpu_usage      float8      default 0,
  memory_percent int         default 0,
  used_memory    bigint      default 0,
  total_memory   bigint      default 0,
  uptime         float8      default 0,
  node_version   text,
  load_average   float8[]    default '{0,0,0}',
  last_updated   timestamptz default now()
);

-- ── logs table ────────────────────────────────────────────────────────────────
-- Append-only log entries from all machines.

create table if not exists logs (
  id           text        primary key,
  machine_id   text        not null,
  machine_name text,
  category     text        not null,
  level        text        not null default 'info',
  message      text        not null,
  data         jsonb       default '{}'::jsonb,
  created_at   timestamptz default now()
);

-- Index for fast per-machine log queries sorted by time
create index if not exists logs_machine_time
  on logs (machine_id, created_at desc);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Allow anonymous (public) read so the Cloudflare Worker can read without auth.
-- Writes use the service_role key which bypasses RLS entirely.

alter table machines enable row level security;
alter table logs      enable row level security;

-- Public read policies
create policy "Public can read machines"
  on machines for select using (true);

create policy "Public can read logs"
  on logs for select using (true);

-- ── Optional: auto-prune old logs ─────────────────────────────────────────────
-- Keep only the last 7 days of logs per machine (run manually or as a cron job)
-- delete from logs where created_at < now() - interval '7 days';
