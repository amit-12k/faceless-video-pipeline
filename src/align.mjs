import { FPS, splitSentences, splitWords } from "./timing.mjs";

// Aligns the script's words with the words whisper heard, so captions keep the script's spelling ("NGINX")
// while taking their timing from the real audio ("EngineX" at 5.19s). Extra speech before or after the
// script (for example a prompt read aloud by the voice) is reported instead of being forced onto the script.

const normalize = (word) => String(word).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - rows[a.length][b.length] / Math.max(a.length, b.length);
}

// scriptWords: strings. spoken: [{ text, start, end }] in seconds.
export function alignTranscript(scriptWords, spoken) {
  const a = scriptWords.map(normalize);
  const b = spoken.map((word) => normalize(word.text));
  const n = a.length;
  const m = b.length;
  const score = (i, j) => {
    const s = similarity(a[i], b[j]);
    return s === 1 ? 2 : s >= 0.5 ? 1 : -1;
  };
  const SKIP_SCRIPT = -1;
  const SKIP_SPOKEN = -0.8;
  // Semi-global alignment: spoken words before the script starts or after it ends cost nothing here.
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i += 1) { best[i][0] = best[i - 1][0] + SKIP_SCRIPT; move[i][0] = 2; }
  for (let j = 1; j <= m; j += 1) { best[0][j] = 0; move[0][j] = 3; }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diagonal = best[i - 1][j - 1] + score(i - 1, j - 1);
      const up = best[i - 1][j] + SKIP_SCRIPT;
      const left = best[i][j - 1] + (i === n ? 0 : SKIP_SPOKEN);
      if (diagonal >= up && diagonal >= left) { best[i][j] = diagonal; move[i][j] = 1; }
      else if (up >= left) { best[i][j] = up; move[i][j] = 2; }
      else { best[i][j] = left; move[i][j] = 3; }
    }
  }
  const pairs = new Array(n).fill(-1);
  const inserted = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const step = i === 0 ? 3 : j === 0 ? 2 : move[i][j];
    if (step === 1) { if (score(i - 1, j - 1) > 0) pairs[i - 1] = j - 1; i -= 1; j -= 1; }
    else if (step === 2) i -= 1;
    else { inserted.unshift(j - 1); j -= 1; }
  }
  const matchedSpoken = pairs.filter((j) => j >= 0);
  const first = matchedSpoken.length ? Math.min(...matchedSpoken) : 0;
  const last = matchedSpoken.length ? Math.max(...matchedSpoken) : m - 1;
  const leading = spoken.slice(0, first).map((word) => word.text);
  const trailing = spoken.slice(last + 1).map((word) => word.text);
  const extra = inserted.filter((j) => j > first && j < last).map((j) => spoken[j].text);
  return {
    pairs,
    stats: {
      script_words: n, matched_ratio: n ? matchedSpoken.length / n : 0,
      leading_words: leading, trailing_words: trailing, extra_words: extra,
      skipped_words: scriptWords.filter((_, i) => pairs[i] < 0)
    }
  };
}

// Script word timings (seconds) from an alignment: matched words take whisper's times, unmatched words are
// spread between their matched neighbours by length.
export function wordTimesFromAlignment(scriptWords, spoken, pairs, duration) {
  const times = scriptWords.map((_, i) => (pairs[i] >= 0 ? { start: spoken[pairs[i]].start, end: spoken[pairs[i]].end } : null));
  for (let i = 0; i < times.length; i += 1) {
    if (times[i]) continue;
    let right = i;
    while (right < times.length && !times[right]) right += 1;
    const from = i > 0 ? times[i - 1].end : (times[right]?.start ?? 0) - 0.3 * (right - i);
    const to = right < times.length ? times[right].start : Math.min(duration, from + 0.35 * (right - i));
    const lengths = scriptWords.slice(i, right).map((word) => normalize(word).length + 1);
    const total = lengths.reduce((x, y) => x + y, 0);
    let cursor = Math.max(0, from);
    for (let k = i; k < right; k += 1) {
      const span = (Math.max(to, cursor) - cursor) * lengths[k - i] / total;
      times[k] = { start: cursor, end: cursor + span };
      cursor += span;
    }
    i = right - 1;
  }
  // Keep times ordered even when whisper's token times overlap slightly.
  for (let i = 1; i < times.length; i += 1) {
    if (times[i].start < times[i - 1].start) times[i].start = times[i - 1].start;
    if (times[i].end < times[i].start) times[i].end = times[i].start;
  }
  return times;
}

// Whisper marks where words start well but runs each word's end into the next one, hiding pauses. Where the
// audio is silent between two words, end the first word where the silence begins.
function endWordsAtSilence(words, speaking) {
  if (!speaking) return;
  for (let i = 0; i + 1 < words.length; i += 1) {
    const next = words[i + 1].start;
    for (let f = words[i].start + 2, run = 0; f < next; f += 1) {
      run = speaking[f] === false ? run + 1 : 0;
      if (run >= 4) { words[i].end = Math.max(words[i].start + 1, f - run + 1); break; }
    }
  }
}

// Builds the same timeline shape as buildTimeline() from per-word times in seconds.
export function timelineFromWordTimes(segments, times, frames, speaking = null) {
  const toFrame = (seconds) => Math.max(0, Math.min(frames, Math.round(seconds * FPS)));
  const sentences = segments.flatMap((text, segment) => splitSentences(text).map((sentence) => ({ text: sentence, segment })));
  const words = [];
  let index = 0;
  sentences.forEach((sentence, s) => {
    for (const text of splitWords(sentence.text)) {
      const time = times[index];
      index += 1;
      words.push({ text, start: toFrame(time.start), end: Math.max(toFrame(time.start) + 1, toFrame(time.end)), sentence: s, segment: sentence.segment });
    }
  });
  for (let i = 0; i + 1 < words.length; i += 1) words[i].end = Math.min(Math.max(words[i].end, words[i].start + 1), Math.max(words[i + 1].start, words[i].start + 1));
  endWordsAtSilence(words, speaking);
  const pauses = [];
  for (let i = 0; i + 1 < words.length; i += 1) {
    const gap = words[i + 1].start - words[i].end;
    if (gap >= 6) pauses.push({ start: words[i].end, end: words[i + 1].start, length: gap });
  }
  const sentenceTimes = sentences.map((sentence, s) => {
    const own = words.filter((word) => word.sentence === s);
    return { ...sentence, start: own[0]?.start ?? 0, end: own[own.length - 1]?.end ?? 0 };
  });
  // Cut between scenes in the gap after the last word of the previous scene, a little after it ends.
  const sceneStarts = segments.map((_, segment) => {
    const first = words.findIndex((word) => word.segment === segment);
    if (first < 0) return null;
    if (first === 0) return 0;
    const gapStart = words[first - 1].end;
    const gapEnd = words[first].start;
    return Math.round(gapStart + Math.min(gapEnd - gapStart, 12) / 2);
  });
  const sceneBounds = segments.map((_, segment) => {
    const start = sceneStarts[segment] ?? 0;
    const later = sceneStarts.slice(segment + 1).find((value) => value !== null);
    return [start, later ?? frames];
  });
  return { sentences: sentenceTimes, words, sceneBounds, pauses, source: "transcript" };
}
