import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createNarrationAudio, researchTopic, writeScript } from "./gemini.mjs";
import { checkVideo, renderVideo } from "./render.mjs";
import { validateProject } from "./validate.mjs";

const topic = (process.env.VIDEO_TOPIC || "").trim();
const style = (process.env.VIDEO_STYLE || "explainer").trim();
const language = (process.env.VIDEO_LANGUAGE || "English").trim();
const jobId = process.env.GITHUB_RUN_ID || String(Date.now());
const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join("artifacts", jobId));
const log = (stage, message) => console.log(JSON.stringify({ time: new Date().toISOString(), stage, message }));
const saveJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");

async function main() {
  if (!topic || topic.length > 240) throw new Error("Topic is required and must be 240 characters or fewer.");
  if (!language || language.length > 80) throw new Error("Narration language is required and must be 80 characters or fewer.");
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  try {
    log("research", "Searching the web for source-backed claims.");
    const research = await researchTopic(topic, style, language);
    await saveJson(path.join(outputDir, "research.json"), {
      topic, summary: research.data.summary, claims: research.data.claims,
      search_sources: research.searchSources, model: research.model
    });

    log("script", "Writing a scene script from supported claims.");
    const scriptResult = await writeScript(topic, style, language, research.data);
    const validation = validateProject(research.data, scriptResult.data, research.searchSources);
    await saveJson(path.join(outputDir, "script.json"), scriptResult.data);
    await saveJson(path.join(outputDir, "validation-report.json"), {
      ...validation, research_model: research.model, script_model: scriptResult.model,
      tts_model: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts",
      checks: ["Structure, scene count, word count, claim references, and source links checked.",
        "Uncertain and unsupported research claims recorded as flags."]
    });
    if (!validation.passed) throw new Error("Script validation failed: " + validation.errors.join(" "));

    const narration = [scriptResult.data.hook, ...scriptResult.data.scenes.map((scene) => scene.narration)].join("\n\n");
    await writeFile(path.join(outputDir, "narration.txt"), narration + "\n", "utf8");
    await saveJson(path.join(outputDir, "metadata.json"), {
      job_id: jobId, topic, style, language, title: scriptResult.data.title,
      created_at: new Date().toISOString(), publication_status: "not_published", output: "video.mp4"
    });

    log("narration", "Generating voiceover.");
    const voice = await createNarrationAudio(narration, language);
    const audioPath = path.join(outputDir, "narration.wav");
    await writeFile(audioPath, voice.audio);
    log("render", "Rendering vertical motion-graphics scenes and subtitles.");
    const rendered = await renderVideo(scriptResult.data, audioPath, outputDir);
    const quality = await checkVideo(rendered.videoPath);
    await saveJson(path.join(outputDir, "quality-report.json"), quality);
    log("complete", "Video passed stream, dimensions, duration, and file-size checks.");
  } catch (error) {
    const report = {
      job_id: jobId, stage_error: error.message || String(error), occurred_at: new Date().toISOString(),
      note: "See the GitHub Actions log for stage output. API keys are not written to diagnostics."
    };
    await saveJson(path.join(outputDir, "error-report.json"), report).catch(() => {});
    console.error(JSON.stringify({ stage: "failed", ...report }));
    throw error;
  }
}
main().catch(() => { process.exitCode = 1; });
