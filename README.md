# Faceless Video Pipeline

Cloud-only MVP for making one original vertical MP4 from a topic. GitHub Actions runs the pipeline; Gemini Search grounding researches claims, Gemini writes the structured script and voiceover, and FFmpeg renders motion-graphics cards with subtitles. The workflow never publishes content. Artifacts remain in this private repository.

## Browser-only setup

1. Open **Settings → Secrets and variables → Actions → New repository secret**.
2. Add \`GEMINI_API_KEY\` using an API key from Google AI Studio. Never put the key in source code or workflow inputs.
3. Open **Actions → Generate faceless video → Run workflow**.
4. Enter the topic, style, and narration language. Download the \`faceless-video-<run id>\` artifact from the completed workflow run.

The runner installs Node.js, FFmpeg, and fonts in the cloud. Nothing needs to be installed on your laptop.

## Pipeline and outputs

The workflow researches with Google Search grounding, requests structured claims and source URLs, writes 5–8 scenes using supported claims, validates word count and claim links, creates WAV narration, writes timestamped subtitles, renders a 1080 × 1920 MP4, and checks streams, dimensions, duration, and file size.

A successful artifact contains \`video.mp4\`, \`subtitles.srt\`, \`research.json\`, \`script.json\`, \`narration.txt\`, \`narration.wav\`, \`validation-report.json\`, \`quality-report.json\`, and \`metadata.json\`. Failed runs upload diagnostics and any files already generated. Artifacts are retained for 7 days. Re-running one workflow run overwrites the artifact with the same run-ID name; a new manual dispatch creates a new job.

Structural and source-link checks do not prove factual accuracy. The validation report says so explicitly. Read the cited sources and review the video before publication.

## Cost and data notes

- GitHub Free currently includes 2,000 Actions minutes and 500 MB artifact storage per month for private repositories. Usage beyond included limits may be billed. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- Gemini free-tier availability and limits depend on model, region, quota, and account. Google currently lists free standard-tier use for Gemini 3.8 Flash and Gemini 3.8 Flash-Lite TTS, and 5,000 free Search grounding requests/month for Gemini 3 and newer; grounding beyond quota may cost extra. Check the current [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Google says content submitted through the unpaid Gemini API tier may be used to improve its products. Do not submit confidential or personal data. See [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- This MVP uses no paid video-generation API, database, storage service, or publishing integration.

## Troubleshooting

- **Missing key:** confirm the Actions secret is named exactly \`GEMINI_API_KEY\`.
- **401/403:** verify the key, Gemini API access, and model availability.
- **429/5xx:** requests retry up to three times with bounded backoff; retry manually if quota is available.
- **Research validation failed:** inspect \`research.json\` and the Actions log. Rendering stops if grounding citations are missing or a scene uses an unsupported claim.
- **FFmpeg failed:** review the render step log and the failure artifact if present.
- **No artifact:** open the specific workflow run and confirm the always-run upload step completed.

## Configuration

Manual inputs: topic, editorial style, and narration language. Model IDs are in the workflow environment and should be checked against Google's current [models list](https://ai.google.dev/gemini-api/docs/models). The pipeline is limited to 5–8 scenes, 80–170 narration words, and 10–180 seconds. Gemini calls have two-minute timeouts and up to three attempts. Artifacts use the workflow run ID for retry-safe naming.

## Official API references

[Search grounding](https://ai.google.dev/gemini-api/docs/grounding) · [Structured output](https://ai.google.dev/gemini-api/docs/structured-output) · [Speech generation](https://ai.google.dev/gemini-api/docs/speech-generation)
