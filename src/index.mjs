import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { alignTranscript } from "./align.mjs";
import { measureAudio, prepareNarration, trimAudio } from "./audio.mjs";
import { createNarrationAudio, researchTopic, writeScript } from "./gemini.mjs";
import { analyzeVideo, checkArtifacts, checkAudio, checkCaptions, checkDirection, checkScenes, checkSpeech, checkVideo, combine, mediaDuration } from "./qa.mjs";
import { MIN_TRANSCRIPT_MATCH, planVideo, renderVideo } from "./render.mjs";
import { boundedRetry } from "./retry.mjs";
import { splitWords } from "./timing.mjs";
import { transcribeWords } from "./transcribe.mjs";
import { validateProject } from "./validate.mjs";

const runId = process.env.GITHUB_RUN_ID || String(Date.now());
// Reports carry the tracked job's UUID (VIDEO_JOB_ID) when there is one; files and artifacts stay named
// after the Actions run so resuming and retries work as before.
const jobId = process.env.VIDEO_JOB_ID || runId;
const githubRunId = process.env.GITHUB_RUN_ID || null;
const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join("artifacts", runId));
// Resume mode reuses research, script, and narration already in OUTPUT_DIR (for example a downloaded
// artifact from an earlier run) so only the stages that need fixing call paid APIs again.
const resume = process.env.RESUME === "true";
const log = (stage, message) => console.log(JSON.stringify({ time: new Date().toISOString(), stage, message }));
const saveJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
const exists = (file) => access(file).then(() => true, () => false);
const loadJson = async (name) => (resume && await exists(path.join(outputDir, name))
  ? JSON.parse(await readFile(path.join(outputDir, name), "utf8")) : null);

async function main() {
  if (!resume) await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const previous = await loadJson("metadata.json");
  const topic = (process.env.VIDEO_TOPIC || previous?.topic || "").trim();
  const style = (process.env.VIDEO_STYLE || previous?.style || "explainer").trim();
  const language = (process.env.VIDEO_LANGUAGE || previous?.language || "English").trim();
  if (!topic || topic.length > 240) throw new Error("Topic is required and must be 240 characters or fewer.");
  if (!language || language.length > 80) throw new Error("Narration language is required and must be 80 characters or fewer.");
  try {
    let research = null;
    const savedResearch = await loadJson("research.json");
    if (savedResearch?.claims?.length) {
      log("research", "Reusing research from the previous run.");
      research = {
        data: { summary: savedResearch.summary, claims: savedResearch.claims },
        searchSources: savedResearch.search_sources || savedResearch.grounded_sources || [], model: savedResearch.model
      };
    } else {
      log("research", "Searching the web for source-backed claims.");
      research = await researchTopic(topic, style, language);
      await saveJson(path.join(outputDir, "research.json"), {
        topic, summary: research.data.summary, claims: research.data.claims,
        search_sources: research.searchSources, model: research.model
      });
    }

    let script = await loadJson("script.json");
    let scriptModel = previous?.script_model || null;
    let validation = script ? validateProject(research.data, script, research.searchSources) : null;
    const scriptReused = Boolean(validation?.passed);
    if (scriptReused) log("script", "Reusing the validated script from the previous run.");
    // One bounded retry: a draft that fails validation is rewritten once with the failures as feedback.
    if (!scriptReused) {
      const drafted = await boundedRetry(async (attempt, last) => {
        log("script", attempt === 1 ? "Writing a scene script from supported claims." : "Rewriting the script to fix validation errors.");
        const result = await writeScript(topic, style, language, research.data, last?.validation.errors || validation?.errors || []);
        return { result, validation: validateProject(research.data, result.data, research.searchSources) };
      }, (draft) => draft.validation.passed);
      script = drafted.result.data;
      scriptModel = drafted.result.model;
      validation = drafted.validation;
    }
    await saveJson(path.join(outputDir, "script.json"), script);
    await saveJson(path.join(outputDir, "validation-report.json"), {
      ...validation, research_model: research.model, script_model: scriptModel,
      tts_model: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts",
      checks: ["Structure, scene count, word count, claim references, and source links checked.",
        "Uncertain and unsupported research claims recorded as flags."]
    });
    if (!validation.passed) throw new Error("Script validation failed: " + validation.errors.join(" "));

    const narration = [script.hook, ...script.scenes.map((scene) => scene.narration)].join("\n\n");
    await writeFile(path.join(outputDir, "narration.txt"), narration + "\n", "utf8");
    await saveJson(path.join(outputDir, "metadata.json"), {
      job_id: jobId, github_run_id: githubRunId, topic, style, language, title: script.title, script_model: scriptModel,
      created_at: previous?.created_at || new Date().toISOString(), publication_status: "not_published", output: "video.mp4"
    });

    // narration-source.wav keeps the raw TTS output; narration.wav is the cleaned, loudness-normalised mix.
    const sourcePath = path.join(outputDir, "narration-source.wav");
    const audioPath = path.join(outputDir, "narration.wav");
    if (scriptReused && !(await exists(sourcePath)) && await exists(audioPath)) await copyFile(audioPath, sourcePath);
    const scriptWords = [script.hook, ...script.scenes.map((scene) => scene.narration)].flatMap(splitWords);
    // The narration is transcribed and compared with the script. Speech outside the script at either end is
    // cut; if the voice added or skipped words mid-script, the narration is generated once more.
    const voiceover = await boundedRetry(async (attempt) => {
      if (attempt === 1 && scriptReused && await exists(sourcePath)) log("narration", "Reusing narration from the previous run.");
      else {
        log("narration", attempt === 1 ? "Generating voiceover." : "Generating the voiceover again because it did not follow the script.");
        await writeFile(sourcePath, (await createNarrationAudio(narration, language)).audio);
      }
      log("narration", "Trimming silence and normalising loudness.");
      const preparation = await prepareNarration(sourcePath, audioPath);
      let spoken = null;
      try {
        log("timing", "Transcribing the narration for word timings.");
        spoken = await transcribeWords(audioPath, language);
      } catch (error) {
        log("timing", "Transcription unavailable (" + error.message.slice(0, 200) + "); timings will be estimated from pauses.");
        return { preparation, spoken: null, stats: null };
      }
      let { pairs, stats } = alignTranscript(scriptWords, spoken);
      const matched = pairs.filter((j) => j >= 0).map((j) => spoken[j]);
      if (stats.matched_ratio >= MIN_TRANSCRIPT_MATCH && matched.length && (stats.leading_words.length >= 3 || stats.trailing_words.length >= 3)) {
        const duration = await mediaDuration(audioPath);
        const start = stats.leading_words.length >= 3 ? Math.max(0, matched[0].start - 0.25) : 0;
        const end = stats.trailing_words.length >= 3 ? Math.min(duration, matched[matched.length - 1].end + 0.4) : duration;
        log("narration", "Cutting speech that is not in the script: \"" + [...stats.leading_words, ...stats.trailing_words].join(" ").slice(0, 120) + "\".");
        const trimmed = audioPath.replace(/\.wav$/, "-trimmed.wav");
        await trimAudio(audioPath, trimmed, start, end);
        await rename(trimmed, audioPath);
        preparation.cut_seconds = { start, end };
        spoken = spoken.filter((word) => word.start >= start - 0.05 && word.start < end)
          .map((word) => ({ ...word, start: Math.max(0, word.start - start), end: Math.max(0, Math.min(end, word.end) - start) }));
        ({ pairs, stats } = alignTranscript(scriptWords, spoken));
      }
      return { preparation, spoken, stats };
    }, (result) => !result.stats || checkSpeech(result.stats, "transcript").errors.length === 0);
    const audioPrep = voiceover.preparation;

    log("plan", "Aligning scenes and captions to the narration.");
    // VIDEO_MASCOT=off renders without the robot presenter.
    const plan = await planVideo(script, audioPath, voiceover.spoken, { mascot: process.env.VIDEO_MASCOT !== "off" });
    // The video holds briefly on the conclusion after the narration ends.
    const videoSeconds = plan.frames / 30;
    await saveJson(path.join(outputDir, "transcript.json"), {
      timing_source: plan.timing_source, alignment: plan.alignment, words: voiceover.spoken || []
    });
    log("timing", plan.timing_source === "transcript"
      ? "Using word timings from the transcript (" + Math.round(plan.alignment.matched_ratio * 100) + "% of script words matched)."
      : "Using estimated word timings.");
    const sections = {
      speech: checkSpeech(plan.alignment, plan.timing_source),
      captions: checkCaptions(plan.phrases, { frames: plan.frames, sceneBounds: plan.timeline.sceneBounds, narration: plan.narration }),
      scenes: checkScenes(plan.scenes, plan.frames),
      direction: checkDirection({ ...plan, cues: plan.scenes.flatMap((scene) => scene.cues) }),
      narration: checkAudio(await measureAudio(audioPath), null)
    };
    const planReport = combine(sections);
    if (!planReport.passed) {
      await saveJson(path.join(outputDir, "qa-report.json"), { ...planReport, audio_preparation: audioPrep });
      throw new Error("Quality checks failed before rendering: " + planReport.errors.join(" "));
    }

    // One bounded re-render if the encoded file itself is defective (partial, black, or wrong length).
    const report = await boundedRetry(async (attempt) => {
      log("render", attempt === 1 ? "Rendering animated scenes, presenter, and captions." : "Rendering again after a failed output check.");
      const rendered = await renderVideo(plan, audioPath, outputDir, log);
      log("qa", "Checking the finished video.");
      const analysis = await analyzeVideo(rendered.videoPath);
      const report = combine({
        ...sections,
        video: checkVideo(analysis, videoSeconds),
        final_audio: checkAudio(analysis.audio, videoSeconds),
        artifacts: await checkArtifacts(outputDir, ["research.json", "script.json", "narration.txt", "narration.wav",
          "subtitles.srt", "scene-plan.json", "transcript.json", "metadata.json", "video.mp4"])
      });
      report.measurements = {
        audio_preparation: audioPrep, final_loudness_lufs: analysis.audio.integrated_lufs,
        final_true_peak_dbtp: analysis.audio.true_peak_dbtp, duration_seconds: analysis.audio.duration_seconds,
        caption_count: plan.phrases.length, scene_layouts: plan.scenes.map((scene) => scene.layout)
      };
      await saveJson(path.join(outputDir, "qa-report.json"), report);
      return report;
    }, (result) => result.passed || !result.sections.video.errors.length);
    for (const warning of report.warnings) log("qa", "Warning: " + warning);
    if (!report.passed) {
      // Keep the rejected file for diagnosis under a name that cannot be mistaken for a finished export.
      await rename(path.join(outputDir, "video.mp4"), path.join(outputDir, "video-rejected.mp4")).catch(() => {});
      throw new Error("Quality checks failed: " + report.errors.join(" "));
    }
    await saveJson(path.join(outputDir, "quality-report.json"), {
      width: 1080, height: 1920, duration_seconds: report.measurements.duration_seconds, audio_stream: true,
      qa_passed: true, warnings: report.warnings.length
    });
    log("complete", "Video passed caption, scene, audio, and video quality checks.");
  } catch (error) {
    const report = {
      job_id: jobId, github_run_id: githubRunId, stage_error: error.message || String(error), occurred_at: new Date().toISOString(),
      note: "See the GitHub Actions log for stage output. API keys are not written to diagnostics."
    };
    await saveJson(path.join(outputDir, "error-report.json"), report).catch(() => {});
    console.error(JSON.stringify({ stage: "failed", ...report }));
    throw error;
  }
}
main().catch(() => { process.exitCode = 1; });
