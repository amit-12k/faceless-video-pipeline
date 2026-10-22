// Aligns narration text to the voiceover. Gemini TTS returns audio without word timestamps, so timings are
// inferred from loudness: sentences are matched to the pauses between them, then words are spread over the
// frames where the narrator is actually speaking.

export const FPS = 30;
const MIN_PAUSE_FRAMES = 6;
const ABBREVIATION = /^\(?(e\.g|i\.e|vs|etc|approx|mr|mrs|dr|st)\.$/i;

// Splits on words that end a sentence, so decimals ("99.99%") and abbreviations ("e.g.") stay intact.
export function splitSentences(text) {
  const sentences = [];
  let current = [];
  for (const word of String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean)) {
    current.push(word);
    if (/[.!?]+["')\]]*$/.test(word) && !ABBREVIATION.test(word)) {
      sentences.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) sentences.push(current.join(" "));
  return sentences;
}

export const splitWords = (text) => String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
const spokenLength = (text) => (String(text).match(/[\p{L}\p{N}]/gu) || []).length || 1;

export function speakingFrames(loudness) {
  const sorted = [...loudness].sort((a, b) => a - b);
  const peak = sorted[Math.floor((sorted.length - 1) * 0.95)] || 1;
  return { peak, speaking: loudness.map((value) => value > peak * 0.12) };
}

export function findPauses(speaking, minFrames = MIN_PAUSE_FRAMES) {
  const pauses = [];
  let start = -1;
  for (let f = 0; f <= speaking.length; f += 1) {
    const silent = f < speaking.length && !speaking[f];
    if (silent && start < 0) start = f;
    if (!silent && start >= 0) {
      if (f - start >= minFrames && start > 0 && f < speaking.length) pauses.push({ start, end: f, length: f - start });
      start = -1;
    }
  }
  return pauses;
}

// Frame at which `share` of the voiced (non-silent) frames between `from` and `to` has elapsed.
function voicedPosition(speaking, from, to, share) {
  const voiced = [];
  for (let f = from; f < to; f += 1) if (speaking[f]) voiced.push(f);
  if (!voiced.length) return Math.round(from + (to - from) * share);
  return voiced[Math.min(voiced.length - 1, Math.max(0, Math.round(share * voiced.length)))];
}

// Aligns text breaks (sentence ends and commas, in order) with detected pauses (in order). Each break either
// lands on a pause or stays unmatched, and pauses that match no break are breaths. A choice is scored by how
// steady the implied speaking rate is for every stretch of text (a long sentence cannot fit in two seconds),
// plus a preference for long pauses at sentence ends and short ones at commas.
export function alignBreaks(breaks, lengths, pauses, voicedBefore, firstVoice, lastVoice) {
  const n = breaks.length;
  const m = pauses.length;
  const voiced = (from, to) => Math.max(1, voicedBefore[Math.max(from, to)] - voicedBefore[from]);
  const totalLetters = lengths.reduce((a, b) => a + b, 0);
  const rate = totalLetters / voiced(firstVoice, lastVoice);
  const letterSums = [0];
  for (const length of lengths) letterSums.push(letterSums[letterSums.length - 1] + length);
  // Text between matched breaks a and b (break indices, -1 = start, n = end) is clauses a+1..b.
  const rateCost = (a, b, from, to) => {
    const letters = letterSums[b + 1] - letterSums[a + 1];
    const ratio = Math.log((letters / voiced(from, to)) / rate);
    return (ratio * ratio) / 0.04 * Math.min(1, letters / 30);
  };
  const skipBreak = (b) => (b.type === "sentence" ? 3 : 0.6);
  const skipPause = (p) => (p.length >= 18 ? 1 : 0.4);
  const strength = (b, p) => (b.type === "sentence"
    ? -1.5 * Math.min(p.length, 30) / 30
    : -0.8 * Math.min(p.length, 15) / 15 + (p.length > 24 ? 0.5 : 0));
  const skipBreaks = (a, b) => breaks.slice(a + 1, b).reduce((sum, item) => sum + skipBreak(item), 0);
  const skipPauses = (a, b) => pauses.slice(a + 1, b).reduce((sum, item) => sum + skipPause(item), 0);

  // best[i][j]: lowest cost with break i matched to pause j as the latest match (i = -1, j = -1 is the start).
  const key = (i, j) => (i + 1) * (m + 1) + (j + 1);
  const best = new Map([[key(-1, -1), { cost: 0, i: -1, j: -1, previous: null }]]);
  const ordered = [[-1, -1]];
  for (let i = 0; i < n; i += 1) for (let j = 0; j < m; j += 1) ordered.push([i, j]);
  for (const [i, j] of ordered.slice(1)) {
    let choice = null;
    for (const [a, c] of ordered) {
      if (a >= i || c >= j) continue;
      const state = best.get(key(a, c));
      if (!state) continue;
      const from = c < 0 ? firstVoice : pauses[c].end;
      const total = state.cost + rateCost(a, i, from, pauses[j].start) + skipBreaks(a, i) + skipPauses(c, j)
        + strength(breaks[i], pauses[j]);
      if (!choice || total < choice.cost) choice = { cost: total, i, j, previous: state };
    }
    if (choice) best.set(key(i, j), choice);
  }
  let final = null;
  for (const state of best.values()) {
    const from = state.j < 0 ? firstVoice : pauses[state.j].end;
    const total = state.cost + rateCost(state.i, n, from, lastVoice) + skipBreaks(state.i, n) + skipPauses(state.j, m);
    if (!final || total < final.cost) final = { cost: total, state };
  }
  const matched = new Array(n).fill(null);
  for (let state = final.state; state && state.i >= 0; state = state.previous) matched[state.i] = pauses[state.j];
  return matched;
}

// Spreads words over voiced frames between `start` and `end`, weighted by spoken length.
export function timeWords(words, start, end, speaking) {
  let voiced = [];
  for (let f = start; f < end; f += 1) if (speaking[f]) voiced.push(f);
  if (voiced.length < words.length) voiced = Array.from({ length: Math.max(1, end - start) }, (_, i) => start + i);
  const weights = words.map((word) => spokenLength(word) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  const starts = weights.map((weight) => {
    const frame = voiced[Math.min(voiced.length - 1, Math.floor(voiced.length * cumulative / total))];
    cumulative += weight;
    return frame;
  });
  const lastVoiced = voiced[voiced.length - 1] + 1;
  return words.map((text, i) => ({ text, start: starts[i], end: i + 1 < words.length ? Math.max(starts[i] + 1, starts[i + 1]) : Math.max(starts[i] + 1, Math.min(end, lastVoiced)) }));
}

// Builds sentence and word timings for narration segments (one per scene) from per-frame loudness.
// Every scene boundary is a sentence boundary, so a scene never changes in the middle of a sentence.
export function buildTimeline(segments, loudness) {
  const frames = loudness.length;
  const { speaking } = speakingFrames(loudness);
  const pauses = findPauses(speaking);
  const sentences = segments.flatMap((text, segment) => splitSentences(text).map((sentence) => ({ text: sentence, segment })));
  if (!sentences.length) return { sentences: [], words: [], sceneBounds: segments.map(() => [0, frames]), pauses };

  // Clauses are the stretches between breaks; each break is a sentence end or a comma-like pause point.
  const clauses = [];
  sentences.forEach((sentence, index) => {
    let current = [];
    const words = splitWords(sentence.text);
    words.forEach((word, w) => {
      current.push(word);
      const last = w === words.length - 1;
      if (last || /[,;:]$/.test(word)) {
        clauses.push({ words: current, sentence: index, segment: sentence.segment, endsSentence: last });
        current = [];
      }
    });
  });

  const firstVoice = Math.max(0, speaking.indexOf(true));
  const lastVoice = speaking.lastIndexOf(true) + 1 || frames;
  const lengths = clauses.map((clause) => spokenLength(clause.words.join(" ")));
  const total = lengths.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  const breaks = clauses.slice(0, -1).map((clause, i) => {
    cumulative += lengths[i];
    return { type: clause.endsSentence ? "sentence" : "comma", expected: voicedPosition(speaking, firstVoice, lastVoice, cumulative / total) };
  });
  const voicedBefore = [0];
  for (const value of speaking) voicedBefore.push(voicedBefore[voicedBefore.length - 1] + (value ? 1 : 0));
  const matched = alignBreaks(breaks, lengths, pauses, voicedBefore, firstVoice, lastVoice);

  // Unmatched breaks are placed by voiced-time share between the nearest matched neighbours.
  const edges = breaks.map((_, i) => matched[i] ? { start: matched[i].start, end: matched[i].end } : null);
  for (let i = 0; i < edges.length; i += 1) {
    if (edges[i]) continue;
    let left = i - 1;
    while (left >= 0 && !edges[left]) left -= 1;
    let right = i + 1;
    while (right < edges.length && !matched[right]) right += 1;
    const from = left >= 0 ? edges[left].end : firstVoice;
    const to = right < edges.length ? matched[right].start : lastVoice;
    const before = lengths.slice(left + 1, i + 1).reduce((a, b) => a + b, 0);
    const span = lengths.slice(left + 1, right + 1).reduce((a, b) => a + b, 0);
    const frame = voicedPosition(speaking, from, to, before / span);
    edges[i] = { start: frame, end: frame };
  }

  const words = [];
  const clauseSpans = clauses.map((clause, i) => {
    const start = i === 0 ? firstVoice : edges[i - 1].end;
    const end = i === clauses.length - 1 ? lastVoice : edges[i].start;
    for (const word of timeWords(clause.words, start, Math.max(start + 1, end), speaking)) {
      words.push({ ...word, sentence: clause.sentence, segment: clause.segment });
    }
    return [start, Math.max(start + 1, end)];
  });

  const sentenceTimes = sentences.map((sentence, index) => {
    const own = clauses.map((clause, i) => [clause, clauseSpans[i]]).filter(([clause]) => clause.sentence === index);
    return { ...sentence, start: own[0][1][0], end: own[own.length - 1][1][1] };
  });

  // A scene cut sits a little way into the pause before the scene's first sentence.
  const sceneStarts = segments.map((_, segment) => {
    const first = clauses.findIndex((clause) => clause.segment === segment);
    if (first < 0) return null;
    if (first === 0) return 0;
    const edge = edges[first - 1];
    return Math.round(edge.start + Math.min(edge.end - edge.start, 12) / 2);
  });
  const sceneBounds = segments.map((_, segment) => {
    const start = sceneStarts[segment] ?? 0;
    const later = sceneStarts.slice(segment + 1).find((value) => value !== null);
    return [start, later ?? frames];
  });
  return { sentences: sentenceTimes, words, sceneBounds, pauses };
}
