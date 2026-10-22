# Faceless Video Pipeline

Cloud-only MVP for making one original vertical MP4 from a topic. GitHub Actions runs the pipeline; Tavily web search finds sources, Gemini extracts source-backed claims from them, Gemini writes the structured script and voiceover, and FFmpeg renders motion-graphics cards with subtitles. The workflow never publishes content. Artifacts are available only to users who can access this private repository and are retained for seven days.

## Browser-only setup

1. Open **Settings → Secrets and variables → Actions → New repository secret**.
2. Add a secret named GEMINI_API_KEY using an API key from Google AI Studio. Never put the key in source code or workflow inputs.
3. Add a secret named TAVILY_API_KEY using an API key from [tavily.com](https://tavily.com).
3. After this PR is merged, open **Actions → Generate faceless video → Run workflow**.
4. Enter the topic, style, and narration language. Download the faceless-video artifact from the completed workflow run.

The runner installs Node.js, FFmpeg, and fonts in the cloud. Nothing needs to be installed on your laptop.

## Pipeline and outputs

The workflow searches the web with Tavily, asks Gemini for structured claims that cite only the returned result URLs, writes 5–8 scenes using supported claims, validates word count and claim links, creates WAV narration, writes timestamped subtitles, renders a 1080 × 1920 MP4, and checks streams, dimensions, duration, and file size.

A successful artifact contains the MP4, SRT subtitles, research notes, structured script, narration text and WAV, validation report, quality report, and metadata. Failed runs upload diagnostics and any files already generated. Re-running one Actions run overwrites the artifact with the same run-ID name; a new manual dispatch creates a new job.

Structural and source-link checks do not prove factual accuracy. Read the cited sources and review the video before publication.

## Cost and data notes

- GitHub Free currently includes 2,000 Actions minutes and 500 MB artifact storage per month for private repositories. Usage beyond included limits may be billed. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- Gemini free-tier availability and limits depend on model, region, quota, and account. The workflow uses Gemini 3.5 Flash-Lite for research and script writing and Gemini 3.8 Flash-Lite TTS for narration, both of which have free standard-tier quota at the time of writing. It does not use Gemini Search grounding, which has no free-tier quota for Gemini 3 and newer. Check current [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Tavily's free plan includes 1,000 API credits per month; each video runs one basic search (1 credit). Topics are sent to Tavily as search queries. Check current [Tavily pricing](https://docs.tavily.com/faq/faq).
- Google says content submitted through the unpaid Gemini API tier may be used to improve its products. Do not submit confidential or personal data. See [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- This MVP uses no paid video-generation API, database, storage service, or publishing integration.

## Troubleshooting

- **Missing key:** confirm the Actions secrets are named exactly GEMINI_API_KEY and TAVILY_API_KEY.
- **401/403:** verify the key, Gemini API access, and model availability.
- **429/5xx:** rate limits and server errors retry up to three times, honouring Retry-After. "Exceeded your current quota" errors fail immediately; check the model's limits on the AI Studio Rate Limit page.
- **Research validation failed:** inspect the research artifact and Actions log. Rendering stops if search returns no sources, a supported claim cites a URL outside the search results, or a scene uses an unsupported claim.
- **FFmpeg failed:** review the render step log and failure artifact, if present.
- **No artifact:** open the specific workflow run and confirm the always-run upload step completed.

## Configuration

Manual inputs are topic, editorial style, and narration language. Model IDs are in the workflow environment and should be checked against Google's current [models list](https://ai.google.dev/gemini-api/docs/models). The pipeline is limited to 5–8 scenes, 80–170 narration words, and 10–180 seconds. Gemini calls have two-minute timeouts and up to three attempts. Artifacts use the workflow run ID for retry-safe naming.

## Official API references

[Tavily Search](https://docs.tavily.com/api-reference/endpoint/search) · [Structured output](https://ai.google.dev/gemini-api/docs/structured-output) · [Speech generation](https://ai.google.dev/gemini-api/docs/speech-generation)
