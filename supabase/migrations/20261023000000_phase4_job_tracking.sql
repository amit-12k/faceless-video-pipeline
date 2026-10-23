-- Phase 4: a queue of video topics and a history of video jobs.
--
-- Apply once through the Supabase dashboard: SQL Editor -> New query -> paste this file -> Run.
-- It runs in one transaction, so it either applies completely or not at all; running it a second time
-- fails on "already exists" without changing anything.
--
-- Only server-side callers holding a secret (or legacy service_role) key can read or write these tables:
-- Row Level Security is on, there are no policies, and anon/authenticated have no privileges.

begin;

-- Keeps updated_at current on every change.
create function public.content_topics_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.content_topics_touch_updated_at() from public, anon, authenticated;

create table public.content_topics (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (char_length(btrim(topic)) between 5 and 240),
  style text not null default 'explainer'
    check (style in ('explainer', 'documentary', 'myth-busting', 'practical')),
  language text not null default 'English' check (char_length(btrim(language)) between 2 and 40),
  presenter boolean not null default true,
  -- Higher priority is dispatched first; equal priorities go oldest first.
  priority integer not null default 100,
  status text not null default 'queued'
    check (status in ('queued', 'dispatching', 'dispatched', 'completed', 'failed', 'paused')),
  last_error text,
  github_run_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz
);

comment on table public.content_topics is
  'Topics waiting to be turned into videos. The Make.com scheduler claims one queued topic per run.';

-- The scheduler's query: status = queued order by priority desc, created_at asc limit 1.
create index content_topics_queue_idx on public.content_topics (priority desc, created_at asc)
  where status = 'queued';
create index content_topics_status_idx on public.content_topics (status, updated_at desc);

create trigger content_topics_set_updated_at
  before update on public.content_topics
  for each row execute function public.content_topics_touch_updated_at();

create table public.video_jobs (
  -- Also the correlation ID: Make.com sends it to GitHub Actions as the job_id workflow input.
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.content_topics (id) on delete set null,
  -- Snapshot of the settings used for this run (the topic row may change later). The topic can be
  -- unknown when a manual run resumes an earlier run without retyping it.
  topic text check (topic is null or char_length(topic) <= 240),
  style text check (style is null or style in ('explainer', 'documentary', 'myth-busting', 'practical')),
  language text,
  presenter boolean,
  source text not null default 'manual' check (source in ('manual', 'make')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'dispatch_failed')),
  github_run_id bigint,
  github_run_url text,
  -- GitHub artifacts expire (seven days for this workflow); these links do not store the video.
  artifact_name text,
  artifact_url text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

comment on table public.video_jobs is
  'One row per video generation run. Written by the Make.com scheduler and by the GitHub Actions workflow.';

create index video_jobs_recent_idx on public.video_jobs (created_at desc);
create index video_jobs_status_idx on public.video_jobs (status, created_at desc);
create index video_jobs_topic_idx on public.video_jobs (topic_id, created_at desc) where topic_id is not null;
create index video_jobs_run_idx on public.video_jobs (github_run_id) where github_run_id is not null;

-- Server-side access only.
alter table public.content_topics enable row level security;
alter table public.video_jobs enable row level security;

revoke all on table public.content_topics from anon, authenticated;
revoke all on table public.video_jobs from anon, authenticated;
grant select, insert, update, delete on table public.content_topics to service_role;
grant select, insert, update, delete on table public.video_jobs to service_role;

commit;
