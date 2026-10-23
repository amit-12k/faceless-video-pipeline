# Phase 4: Supabase job tracking and the Make.com scheduler

Once a day, Make.com takes the next topic from a Supabase queue and starts the existing **Generate faceless video** workflow. The workflow records its progress and result in Supabase. Nothing is published: finished videos stay in the GitHub Actions artifact for seven days.

Everything below happens in a browser: the Supabase dashboard, GitHub settings, and the Make.com scenario editor.

```
Make.com (daily)                        Supabase (REST)                    GitHub Actions
────────────────                        ───────────────                    ──────────────
1 GET next queued topic ──────────────▶ content_topics
2 Iterator (no topic → stop)
3 PATCH queued → dispatching ─────────▶ content_topics  (only if still queued)
4 POST job (status queued) ───────────▶ video_jobs      (returns the job UUID)
5 POST workflow dispatch ─────────────────────────────────────────────────▶ generate-video.yml
6a accepted → topic dispatched ───────▶ content_topics                      │ start: job → running,
6b rejected → job dispatch_failed,  ──▶ video_jobs + content_topics         │        topic → dispatched
             topic back to queued                                           │ finish: job → succeeded/failed,
                                                                            ▼        topic → completed/failed
```

## 1. Create the tables in Supabase

1. Open your project in the [Supabase dashboard](https://supabase.com/dashboard) and choose **SQL Editor → New query**.
2. Paste the whole of [`supabase/migrations/20261023000000_phase4_job_tracking.sql`](../supabase/migrations/20261023000000_phase4_job_tracking.sql), read it, and choose **Run**.
3. Open **Table Editor**. You should see `content_topics` and `video_jobs`, both marked as using Row Level Security.

The migration runs in one transaction. Running it a second time fails with "already exists" and changes nothing.

Both tables have Row Level Security on and no policies, and `anon` and `authenticated` have no privileges, so the publishable (anon) key cannot read or write them. Only server-side callers holding a secret key can. Never put a secret key in a browser app, a public page, or a mobile app.

## 2. Create one secret key for each service

Under **Project Settings → API Keys**, use **Secret keys → New secret key** to create two keys:

| Key name | Used by | Where it is stored |
|---|---|---|
| `github-actions` | the workflow's tracking steps | GitHub secret `SUPABASE_SECRET_KEY` |
| `make-scheduler` | the Make.com scenario | a Make.com API key credential |

Separate keys can be revoked independently, for example if one leaks. Secret keys start with `sb_secret_`.

If your project still uses only the **legacy** keys, the workflow accepts the legacy `service_role` key in a GitHub secret named `SUPABASE_SERVICE_ROLE_KEY`. Create a secret key for Make.com anyway: a Make API key credential sets one header, and the legacy key also needs an `Authorization` header.

Also copy the **Project URL**, which looks like `https://<project-ref>.supabase.co`.

## 3. Add the GitHub secrets

In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` (no trailing path) |
| `SUPABASE_SECRET_KEY` | the `github-actions` secret key |

Only the two tracking steps receive these secrets. Without them the workflow still generates videos exactly as before, and the log says that tracking is off.

## 4. Create the GitHub token for Make.com

1. Open **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Fill in the token's settings:
   - **Resource owner:** `amit-12k`.
   - **Expiration:** pick a date, and put a reminder in your calendar to rotate the token before then.
   - **Repository access:** **Only select repositories**, then choose `faceless-video-pipeline`.
   - **Permissions → Repository permissions → Actions:** **Read and write**. GitHub adds Metadata (read) automatically. Grant nothing else.
3. Generate the token and copy it once. It starts with `github_pat_`.

This token can start and cancel workflows in this one repository and nothing more.

## 5. Build the Make.com scenario

Create a new scenario named **Daily faceless video**.

Each Supabase or GitHub request below is an **HTTP → Make a request** module, set up like this:

- **Authentication type:** API key, with **Credentials** set to the credential named below. Make stores the key in a keychain, so it never appears in a mapped field or in the logged request.
- **Body content type:** application/JSON.
- **Body input method:** Data structure. Make then escapes quotes and other special characters in topic text. A hand-written JSON string can break on a topic that contains quotes.
- **Parse response:** Yes.

Create the two credentials the first time you need them, from the module's **Credentials → Add** button:

| Credential name | Key | API key placement | API key parameter name |
|---|---|---|---|
| `Supabase make-scheduler` | the `make-scheduler` `sb_secret_...` key | In the header | `apikey` |
| `GitHub dispatch (faceless-video-pipeline)` | `Bearer github_pat_...` (include the word `Bearer` and one space) | In the header | `Authorization` |

Below, `SUPABASE` stands for your project URL, for example `https://abcd1234.supabase.co`.

### Module 1: Get the next queued topic (HTTP)

- **URL:** `SUPABASE/rest/v1/content_topics`
- **Method:** GET
- **Credentials:** Supabase make-scheduler
- **Query parameters:**

  | Name | Value |
  |---|---|
  | `select` | `id,topic,style,language,presenter` |
  | `status` | `eq.queued` |
  | `order` | `priority.desc,created_at.asc` |
  | `limit` | `1` |

- **Headers:** `Accept: application/json`
- **Return error if HTTP request fails:** Yes

The response is an array with zero or one topic, for example:

```json
[{ "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "topic": "How Kafka moves millions of events", "style": "explainer", "language": "English", "presenter": true }]
```

### Module 2: Iterator (Flow Control)

- **Array:** `{{1.data}}`

With an empty queue the iterator emits nothing and the scenario ends, so no GitHub request is made. With `limit=1` it emits at most one topic. Later modules map that topic's fields as `{{2.id}}`, `{{2.topic}}`, `{{2.style}}`, `{{2.language}}` and `{{2.presenter}}`.

### Module 3: Claim the topic (HTTP)

- **URL:** `SUPABASE/rest/v1/content_topics`
- **Method:** PATCH
- **Credentials:** Supabase make-scheduler
- **Query parameters:** `id` = `eq.{{2.id}}` and `status` = `eq.queued`
- **Headers:** `Prefer: return=representation`
- **Body (data structure):**

  | Key | Value |
  |---|---|
  | `status` | `dispatching` |

- **Return error if HTTP request fails:** Yes

The `status=eq.queued` filter makes this an atomic claim. The response is `[ { …the updated topic… } ]`, or `[]` if another run claimed it or someone paused it in the meantime.

**Filter between modules 3 and 4**, labelled "Claimed": `{{length(3.data)}}` *Numeric operators: Greater than* `0`. If nothing was claimed, the scenario stops here.

### Module 4: Create the job (HTTP)

- **URL:** `SUPABASE/rest/v1/video_jobs`
- **Method:** POST
- **Credentials:** Supabase make-scheduler
- **Headers:**
  - `Prefer: return=representation`
  - `Accept: application/vnd.pgrst.object+json`. This returns the new row as a single object instead of an array.
- **Body (data structure):**

  | Key | Value |
  |---|---|
  | `topic_id` | `{{2.id}}` |
  | `topic` | `{{2.topic}}` |
  | `style` | `{{2.style}}` |
  | `language` | `{{2.language}}` |
  | `presenter` | `{{2.presenter}}` (Boolean) |
  | `source` | `make` |
  | `status` | `queued` |

- **Return error if HTTP request fails:** Yes

Supabase generates the job UUID. The response looks like `{ "id": "0f8fad5b-…", "status": "queued", "source": "make", … }`, and `{{4.data.id}}` is the correlation ID sent to GitHub.

Do not set `metadata` here: the workflow owns that column and replaces it.

### Module 5: Start the GitHub workflow (HTTP)

- **URL:** `https://api.github.com/repos/amit-12k/faceless-video-pipeline/actions/workflows/generate-video.yml/dispatches`
- **Method:** POST
- **Credentials:** GitHub dispatch (faceless-video-pipeline)
- **Headers:**
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2026-03-10`
- **Body (data structure):**

  | Key | Value |
  |---|---|
  | `ref` | `main` |
  | `inputs` (collection) → `topic` | `{{2.topic}}` |
  | `inputs` → `style` | `{{2.style}}` |
  | `inputs` → `language` | `{{2.language}}` |
  | `inputs` → `presenter` | `{{if(2.presenter; "true"; "false")}}` (text) |
  | `inputs` → `job_id` | `{{4.data.id}}` |
  | `inputs` → `topic_id` | `{{2.id}}` |

- **Return error if HTTP request fails:** **No**, so that module 6 can branch on the status code.
- **Timeout:** 60 seconds

The JSON that is sent:

```json
{ "ref": "main", "inputs": { "topic": "How Kafka moves millions of events", "style": "explainer", "language": "English", "presenter": "true", "job_id": "0f8fad5b-d9cb-469f-a165-70867728950e", "topic_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7" } }
```

The responses you can get:
- **Accepted, with API version `2026-03-10`:** `200` and `{ "workflow_run_id": 18800000001, "run_url": "https://api.github.com/…/actions/runs/18800000001", "html_url": "https://github.com/amit-12k/faceless-video-pipeline/actions/runs/18800000001" }`.
- **Accepted, with older API versions:** `204` and an empty body.
- **Rejected:** `401` (bad or expired token), `403` (missing Actions: write), `404` (wrong repository or workflow file), or `422` (for example, the workflow on `main` does not define `job_id`/`topic_id`, or a value is invalid). The reason is in `{{5.data.message}}`.

### Module 6: Router with two routes

**Route A, "Dispatch accepted".** Filter: `{{5.statusCode}}` *Numeric: Less than* `300`.

**Module 7: Mark the topic dispatched (HTTP)**

- **URL:** `SUPABASE/rest/v1/content_topics`
- **Method:** PATCH
- **Credentials:** Supabase make-scheduler
- **Query parameters:** `id` = `eq.{{2.id}}` and `status` = `in.(dispatching,dispatched)`
- **Headers:** `Prefer: return=minimal`
- **Body (data structure):**

  | Key | Value |
  |---|---|
  | `status` | `dispatched` |
  | `dispatched_at` | `{{formatDate(now; "YYYY-MM-DDTHH:mm:ssZ")}}` |
  | `github_run_id` | `{{5.data.workflow_run_id}}` (empty with a `204` response) |

The filter accepts `dispatched` as well, in case the workflow's start step marked the topic first. It never touches a topic that someone has since paused. The response is `204` with no body.

**Route B, "Dispatch rejected".** Filter: `{{5.statusCode}}` *Numeric: Greater than or equal to* `300`.

**Module 8: Mark the job dispatch_failed (HTTP)**

- **URL:** `SUPABASE/rest/v1/video_jobs`
- **Method:** PATCH
- **Credentials:** Supabase make-scheduler
- **Query parameters:** `id` = `eq.{{4.data.id}}` and `status` = `eq.queued`
- **Headers:** `Prefer: return=minimal`
- **Body (data structure):**

  | Key | Value |
  |---|---|
  | `status` | `dispatch_failed` |
  | `error_message` | `GitHub dispatch returned HTTP {{5.statusCode}}: {{5.data.message}}` |
  | `finished_at` | `{{formatDate(now; "YYYY-MM-DDTHH:mm:ssZ")}}` |

**Module 9: Return the topic to the queue (HTTP)**

- **URL:** `SUPABASE/rest/v1/content_topics`
- **Method:** PATCH
- **Credentials:** Supabase make-scheduler
- **Query parameters:** `id` = `eq.{{2.id}}` and `status` = `eq.dispatching`
- **Headers:** `Prefer: return=minimal`
- **Body (data structure):**

  | Key | Value |
  |---|---|
  | `status` | `queued` |
  | `last_error` | `GitHub dispatch returned HTTP {{5.statusCode}}: {{5.data.message}}` |

The next daily run picks the topic up again. A dispatch that keeps failing, for example with an expired token, is retried once a day. It does not loop, and each attempt leaves one `dispatch_failed` job.

### Scenario settings and schedule

Open the scenario settings (gear icon) and set:

- **Sequential processing** (called *Process data in order* in newer versions): **On**. Only one execution runs at a time, so two runs can never claim topics at once.
- **Allow storing of incomplete executions:** **Off**. A stored execution resumed later could repeat a dispatch.
- **Data is confidential:** **On** (optional). Make then keeps no request or response data, such as topic text, in the execution history. Credentials are never shown either way.

**Schedule:** open the clock icon on module 1 and choose **Run scenario: Every day**, then set the **Time**. Make uses the scenario's time zone, set in your profile or organization settings. Turn the scenario **On**.

### Operation cost

A run with an empty queue uses 2 operations (modules 1–2). A dispatched topic uses about 7 or 8. One topic a day is roughly 250 operations a month. Check your Make plan's current monthly allowance.

## 6. Add topics

Add topics in **Table Editor → content_topics → Insert row**, or in the SQL Editor:

```sql
insert into public.content_topics (topic, style, language, presenter, priority) values
  ('How Kafka moves millions of events', 'explainer', 'English', true, 100),
  ('Why database indexes make queries fast', 'practical', 'English', false, 200);
```

Higher `priority` goes first. To hold a topic back without deleting it, set its status to `paused`, and set it back to `queued` to release it.

## 7. Recovering stuck rows

**A topic stuck in `dispatching`.** This means the scenario stopped between claiming the topic and recording the dispatch result: a network timeout to GitHub, a Make error, or a scenario that was switched off mid-run. A timeout is ambiguous, because GitHub may still have started the run, so nothing requeues the topic automatically. Check the repository's **Actions** tab for a run with that topic, then pick one:

```sql
-- No run started: put the topic back in the queue.
update public.content_topics set status = 'queued', last_error = 'Requeued manually after an interrupted dispatch'
where id = '<topic id>' and status = 'dispatching';

-- And close the job that was never dispatched.
update public.video_jobs set status = 'dispatch_failed', error_message = 'Dispatch interrupted', finished_at = now()
where topic_id = '<topic id>' and status = 'queued';
```

If a run did start, leave the rows alone. Its start step marks the topic `dispatched` and the job `running`.

**A job stuck in `queued` or `running`.** A run that GitHub cancelled before checkout, or one that never started, cannot report back. Compare the job's row with its `github_run_url`, then set the outcome by hand if needed.

**A failed topic.** It stays `failed` with the reason in `last_error`. Fix the cause, then set `status = 'queued'` to try again. A re-run from the GitHub Actions page reuses the same job and topic.

## Testing Phase 4 without paying for a full generation

1. Merge the Phase 4 branch into `main`. GitHub rejects `job_id`/`topic_id` inputs with `422` until the workflow on `main` defines them.
2. Run **Actions → Generate faceless video → Run workflow**, setting **resume_from_run** to a recent successful run ID whose artifact has not expired. This reuses that run's research, script and narration and only re-renders, so Gemini and Tavily are not called. Check the results:
   - **The workflow log:** "Assign job ID and record the start" prints the job ID.
   - **Supabase:** `video_jobs` gains a `manual` row that moves from `running` to `succeeded`, with the run URL and artifact link.
3. Test the scheduler: insert one topic, open the scenario, and choose **Run once**.
   - **Expected:** the topic goes from `queued` to `dispatching` to `dispatched`, and then to `completed` or `failed` when the run ends. A `make` job row follows the run.
   - **Cost:** this performs one real generation, the same as a daily run.
4. Test the empty-queue case: with no queued topics, choose **Run once** again. Module 1 should return `[]` and the scenario should stop after module 2, with no GitHub request.
