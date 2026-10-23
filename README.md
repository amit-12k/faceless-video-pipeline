# Faceless Video Pipeline

Cloud-only MVP for making one original vertical MP4 from a topic. GitHub Actions runs the pipeline; Tavily web search finds sources, Gemini extracts source-backed claims from them, Gemini writes the structured script and voiceover, and [Remotion](https://www.remotion.dev) renders animated scenes with tech icons, word-by-word captions, and a robot presenter whose mouth follows the narration. The workflow never publishes content. Artifacts are available only to users who can access this private repository and are retained for seven days.

## Browser-only setup

1. Open **Settings → Secrets and variables → Actions → New repository secret**.
2. Add a secret named GEMINI_API_KEY using an API key from Google AI Studio. Never put the key in source code or workflow inputs.
3. Add a secret named TAVILY_API_KEY using an API key from [tavily.com](https://tavily.com).
4. Open **Actions → Generate faceless video → Run workflow**.
5. Enter the topic, style, and narration language. Download the faceless-video artifact from the completed workflow run.

The runner installs Node.js, npm packages, FFmpeg, fonts, and headless Chrome for Remotion in the cloud. Nothing needs to be installed on your laptop.

## Pipeline and outputs

1. **Research** (`src/tavily.mjs`, `src/gemini.mjs`): Tavily web search, then Gemini extracts claims that cite only the returned URLs.
2. **Script** (`src/gemini.mjs`, `src/validate.mjs`): a hook plus 5–8 scenes, each one complete idea with a suggested graphic. A draft that fails validation is rewritten once with the failures as feedback.
3. **Narration** (`src/audio.mjs`): Gemini TTS (only the narration is sent as spoken text; the speaking style goes in the style field), then silence trimming, short fades, and two-pass loudness normalisation to about -16 LUFS with true peak under -1.5 dBTP.
4. **Timing** (`src/transcribe.mjs`, `src/align.mjs`): whisper.cpp transcribes the narration on the runner and its words are aligned to the script, so captions keep the script's spelling with the real spoken timing. Speech outside the script at either end (for example an instruction read aloud) is cut; if the voice adds or skips words, the narration is generated once more. If transcription is unavailable, `src/timing.mjs` estimates timings from pauses and QA reports it. Scenes change only between sentences.
5. **Storyboard** (`src/storyboard.mjs`): the hook becomes a short title card; each scene uses a layout that fits its content (flow, fanout with rotate/least/hash/weighted strategies, compare, steps, code, stat, list, or focus), falling back when data is missing and avoiding back-to-back repeats. The last scene is the conclusion.
6. **Direction** (`src/direction.mjs`, `remotion/geometry.js`): each scene gets a presentation mode (presenter, diagram, comparison, process, code) that sets the diagram scale and the robot's size (about 26% of the frame height when presenting, 13–15% as a guide, absent over code). The robot is placed where it covers no diagram region, or left out. Diagram elements, points, and code lines react when the narration first mentions them, and the robot points at them at that moment.
7. **Captions** (`src/captions.mjs`): subtitles in their own band, independent of the robot. Phrases follow sentences, punctuation, grammar, and real pauses; repeated terms and product names stay together. Only a short opening remark appears in the robot's speech bubble.
8. **Render** (`src/render.mjs`, `remotion/`): Remotion draws the scenes with crossfades, the subtitles, and the robot. `remotion/rig.js` is the robot's animation controller: one canonical rig, with idle, speaking, explaining, pointing (aimed at the actual target), thinking (questions), emphasis, and conclusion states, eased transitions, blinks, gaze, and mouth shapes approximated from the transcript's word timings and spelling (not phoneme-accurate lip sync). The last frame holds for 0.6 s after the narration.
9. **Quality checks** (`src/qa.mjs`): the robot and bubble never cover diagram or code regions and stay in frame; the robot is sized for its mode, absent over code, and points at its targets; the video ends on a conclusion that holds past the last word; captions match the narration and never cross scenes or end mid-sentence at a cut; scenes cover the video; the file is complete h264/AAC 1080 × 1920 at 30 fps with no black frames or decode errors; loudness, peaks, silent gaps, and durations are measured. A defective encode is re-rendered once; any remaining error fails the job and the file is kept as `video-rejected.mp4`.

A successful artifact contains the MP4, SRT subtitles, research notes, structured script, narration text, the raw (`narration-source.wav`) and processed (`narration.wav`) audio, `transcript.json` (heard words and how they matched the script), scene plan, validation report, `qa-report.json` with measurements and warnings, and metadata. Failed runs upload diagnostics and any files already generated. Re-running one Actions run overwrites the artifact with the same run-ID name; a new manual dispatch creates a new job.

Structural and source-link checks do not prove factual accuracy. Read the cited sources and review the video before publication.

## Cost and data notes

- GitHub Free currently includes 2,000 Actions minutes and 500 MB artifact storage per month for private repositories. Usage beyond included limits may be billed. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- Gemini free-tier availability and limits depend on model, region, quota, and account. The workflow uses Gemini 3.5 Flash-Lite for research and script writing and Gemini 3.8 Flash-Lite TTS for narration, both of which have free standard-tier quota at the time of writing. It does not use Gemini Search grounding, which has no free-tier quota for Gemini 3 and newer. Check current [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Word timings use whisper.cpp with the free `base.en` model (`base` for other languages, about 150 MB). The first run builds it (about two minutes); the workflow caches it afterwards.
- Remotion is free for individuals and companies with up to three employees; larger companies need a [Remotion company license](https://www.remotion.dev/license). Product logos come from [Simple Icons](https://simpleicons.org) (CC0 icons; the brands remain their owners' trademarks) and generic icons from [Lucide](https://lucide.dev).
- Tavily's free plan includes 1,000 API credits per month; each video runs one basic search (1 credit). Topics are sent to Tavily as search queries. Check current [Tavily pricing](https://docs.tavily.com/faq/faq).
- Google says content submitted through the unpaid Gemini API tier may be used to improve its products. Do not submit confidential or personal data. See [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- The pipeline uses no paid video-generation API, storage service, or publishing integration. Phase 4 job tracking is optional and fits the free tiers of Supabase and Make.com (see below).

## Troubleshooting

- **Missing key:** confirm the Actions secrets are named exactly GEMINI_API_KEY and TAVILY_API_KEY.
- **401/403:** verify the key, Gemini API access, and model availability.
- **429/5xx:** rate limits and server errors retry up to three times, honouring Retry-After. "Exceeded your current quota" errors fail immediately; check the model's limits on the AI Studio Rate Limit page.
- **Research validation failed:** inspect the research artifact and Actions log. Rendering stops if search returns no sources, a supported claim cites a URL outside the search results, or a scene uses an unsupported claim.
- **"Timings were estimated" warning:** whisper.cpp could not build or run; check the transcription line in the log. Captions still render, with estimated timing.
- **Render failed:** review the Remotion progress lines in the render step log and failure artifact, if present.
- **Quality checks failed:** open `qa-report.json` in the artifact; each error names the caption, scene, or measurement that failed.
- **No artifact:** open the specific workflow run and confirm the always-run upload step completed.

## Configuration

Manual inputs are topic, editorial style, and narration language. Model IDs are in the workflow environment and should be checked against Google's current [models list](https://ai.google.dev/gemini-api/docs/models). The pipeline is limited to 5–8 scenes, 80–170 narration words, and 10–180 seconds. Gemini calls have two-minute timeouts and up to three attempts. Artifacts use the workflow run ID for retry-safe naming.

To re-render an earlier run without calling Gemini or Tavily again, run the workflow with **resume_from_run** set to that run's ID (the number in its URL). Its research, script, and narration are reused when they are still valid; only missing or invalid stages are regenerated.

Run `npm test` for the regression tests (no API keys or network needed); they use recorded scripts and narration loudness from earlier runs in `tests/fixtures`, and mock every Supabase request in `tests/job-tracker.test.mjs`.

## Phase 4: scheduled runs and job tracking

Phase 4 is optional. A daily [Make.com](https://www.make.com) scenario takes the next topic from a Supabase queue and starts this workflow, and the workflow records each run in Supabase. Videos are still never published. Setup is done entirely in the browser; see **[docs/phase4-make-setup.md](docs/phase4-make-setup.md)** for every module, endpoint, header, body and filter.

```
Make.com (daily) ──▶ Supabase content_topics: claim one queued topic (queued → dispatching)
                 ──▶ Supabase video_jobs: new job (queued), returns its UUID
                 ──▶ GitHub: dispatch generate-video.yml with topic settings + job_id + topic_id
GitHub Actions   ──▶ start: job running, topic dispatched … finish: job succeeded/failed, topic completed/failed
```

- **Tables:** the migration [supabase/migrations/20261023000000_phase4_job_tracking.sql](supabase/migrations/20261023000000_phase4_job_tracking.sql) creates `content_topics` (the queue) and `video_jobs` (one row per run). Apply it once in the Supabase dashboard: **SQL Editor → New query**, paste the file, **Run**. It runs in one transaction, and a repeated run fails without changing anything. Row Level Security is on with no policies, and `anon`/`authenticated` have no access, so only server-side secret keys can use the tables.
- **Tracking code:** [src/job-tracker.mjs](src/job-tracker.mjs) is a small Supabase REST client with built-in `fetch` and no new dependencies. The workflow runs it through [src/track-job.mjs](src/track-job.mjs).
  - **Start step** (before generation): it reuses the `job_id` input or creates a UUID for manual runs, exports it as `VIDEO_JOB_ID`, marks the job `running`, and marks the related topic `dispatched`.
  - **Finish step** (after the artifact upload, runs even when generation fails or the run is cancelled): it derives the status from the actual outcomes of the generate and upload steps, then records the artifact name and link and any error.
  - **Job and topic are updated separately.** A failed status update is a warning only: it never fails the run, never changes a rendered video's result, never hides the original error, and never triggers a retry or a new dispatch.
- **Reports:** `metadata.json` and `error-report.json` carry the job UUID as `job_id` (with `github_run_id` beside it). Output folders and artifacts keep their run-ID names, so resuming works as before.

### GitHub secrets

| Secret | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY`, `TAVILY_API_KEY` | yes | video generation (unchanged) |
| `SUPABASE_URL` | for tracking | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | for tracking | a Supabase secret key (`sb_secret_…`) created just for GitHub Actions |
| `SUPABASE_SERVICE_ROLE_KEY` | fallback | legacy `service_role` key, used only when `SUPABASE_SECRET_KEY` is not set |

The Supabase secrets are passed only to the two tracking steps. If they are missing, tracking is off and the log says so. Make.com uses its own Supabase secret key and a fine-grained GitHub token limited to this repository with **Actions: Read and write**. Both are stored as Make API key credentials, never in mapped fields.

### Manual runs still work as before

**Actions → Generate faceless video → Run workflow** still takes topic, style, language, presenter, and resume_from_run. There are two new optional inputs, both normally left blank:
- **job_id:** the scheduler's `video_jobs` UUID. Leave it blank and a new UUID is created, recorded as a `manual` job when tracking is configured.
- **topic_id:** link the run to a `content_topics` row.

A value that is not a UUID stops the run before Gemini or Tavily is called. A `topic_id` that does not exist is ignored with a warning.

### Job and topic statuses

| `video_jobs.status` | Meaning |
|---|---|
| `queued` | Created by Make.com; not yet started on GitHub |
| `running` | The workflow's start step ran (also set again when a run is re-run) |
| `succeeded` | Generation, all quality checks, and the artifact upload succeeded |
| `failed` | Generation failed, the run was cancelled, an earlier step failed, or the upload failed after a good render (`error_message` says which) |
| `dispatch_failed` | GitHub rejected the dispatch request; no run was started |

| `content_topics.status` | Meaning |
|---|---|
| `queued` | Waiting; the highest `priority`, then the oldest, is taken first |
| `dispatching` | Claimed by the scheduler, dispatch in progress |
| `dispatched` | A workflow run was started for it |
| `completed` | Its run succeeded (`completed_at`, `github_run_id`) |
| `failed` | Its run failed (`last_error`); set it back to `queued` to retry |
| `paused` | Skipped by the scheduler and never changed by the workflow |

Statuses only move forward. The workflow never sets `queued`, `dispatching` or `dispatch_failed`, never marks a completed topic failed, and never touches a paused one. Re-running an Actions run reuses its job, which goes back to `running`.

### Failure and retry behaviour

- **Rejected dispatch** (`4xx`/`5xx` from GitHub): the job becomes `dispatch_failed`, and the topic goes back to `queued` with the reason, so the next daily run tries again.
- **Ambiguous dispatch** (timeout or network error): the scenario stops and the topic stays `dispatching`. GitHub may still have started the run, so nothing is requeued automatically; see *Recovering stuck rows* in the setup guide.
- **Failed generation:** the job and topic are marked `failed` with the stage error. Fix the cause and set the topic to `queued`, or re-run the Actions run.
- **Overlapping runs:** sequential processing in Make plus the atomic `queued → dispatching` claim mean a topic is dispatched at most once per claim.
- **Tracking outages:** the run continues and records nothing for that step; the video and artifact are unaffected.

### Cost and security notes

- **Supabase:** two small tables fit the Free plan. Free projects can be paused after a period of inactivity; check [Supabase pricing](https://supabase.com/pricing).
- **Make.com:** about 2 operations per run with an empty queue and about 8 when a topic is dispatched, so one video a day is roughly 250 operations a month. Check your [Make plan](https://www.make.com/en/pricing).
- **GitHub Actions:** minutes are the same as for a manual run of each video.
- **Artifact links expire.** `artifact_url` points to a GitHub artifact kept for seven days. Supabase keeps the job history, not the video file; download videos you want to keep.
- **Secrets stay out of logs and the database:** keys are never logged or stored, and error text is cleaned of key-like strings before it is written. Never put a Supabase secret key in browser code or a public app; use one key per service so each can be revoked alone.

## Official API references

[Tavily Search](https://docs.tavily.com/api-reference/endpoint/search) · [Structured output](https://ai.google.dev/gemini-api/docs/structured-output) · [Speech generation](https://ai.google.dev/gemini-api/docs/speech-generation) · [Supabase REST API](https://supabase.com/docs/guides/api) · [Supabase API keys](https://supabase.com/docs/guides/api/api-keys) · [GitHub workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
