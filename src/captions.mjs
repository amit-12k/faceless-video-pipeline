import { CAPTION_STYLES } from "../remotion/layout.js";
import { FPS } from "./timing.mjs";

// Caption phrases are built per sentence, so a phrase never spans two sentences or two scenes. Long
// sentences are split at punctuation first, then at the most natural grammatical point that keeps each
// phrase within the speech bubble on a phone screen.

export const CAPTION_LIMITS = { maxChars: 44, minPhraseFrames: 18, linger: 12 };

// Words that should not end a caption phrase (they lean on the word after them).
const LEANING = new Set(("a an the of to in on at by for with from into onto over under via per as and or but nor "
  + "is are was were be been being has have had do does did can could will would should may might must "
  + "this that these those its their his her our your my which who whose whom than then if so such very "
  + "more most less least each every some any no not inside outside about above below behind beyond within without "
  + "toward towards across between through during against among around upon near like based due according relative "
  + "such").split(" "));
// Words that make a natural start for a new phrase.
const OPENERS = new Set(("and but or so because while when where which who that whose if unless until after "
  + "before since though although whereas to with without by using from across between into through for "
  + "during like instead then").split(" "));

export const endsOnLeaningWord = (text) => LEANING.has(bare(String(text).trim().split(/\s+/).pop() || ""));
const bare = (word) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const charCount = (words) => words.reduce((sum, word) => sum + word.length, 0) + Math.max(0, words.length - 1);
const isCapitalised = (word) => /^[^\p{L}]*\p{Lu}/u.test(word);
const isNumeric = (word) => /^[^\p{N}]*\p{N}/u.test(word);

// Cost of ending a phrase between words[at - 1] and words[at]. `terms` holds word pairs known to form a
// term (repeated in the narration or named in the scene's graphics), which should stay together.
// `gaps[at]` is the silence (frames) the narrator leaves before words[at], when real timings are known.
function boundaryCost(words, at, terms = new Set(), gaps = null) {
  const last = words[at - 1];
  const next = words[at];
  if (/[,;:)\]]$|[—–]$/.test(last)) return -6;
  let cost = terms.has(bare(last) + " " + bare(next)) ? 10 : 0;
  if (gaps && gaps[at] >= 6) cost -= 4;
  else if (gaps && gaps[at] <= 1) cost += 1;
  if (LEANING.has(bare(last))) cost += 8;
  // Keep multi-word names ("Round Robin", "Least Connections") and numbers with their units together.
  if (isCapitalised(last) && isCapitalised(next) && at > 1) cost += 10;
  if (isNumeric(last)) cost += 6;
  if (/-$/.test(last) || /^-/.test(next)) cost += 10;
  if (OPENERS.has(bare(next)) || LEANING.has(bare(next))) cost -= 2;
  else cost += 4; // two content words in a row usually belong together ("weight parameter")
  return cost;
}

function phraseCost(words) {
  const chars = charCount(words);
  let cost = Math.abs(chars - 26) / 10;
  if (chars < 12) cost += 2 + (12 - chars) * 0.5;
  if (words.length === 1) cost += 4;
  return cost;
}

// Splits a clause into phrases of at most maxChars, choosing the lowest-cost set of breaks overall.
function splitPhrase(words, terms, gaps) {
  const n = words.length;
  if (charCount(words) <= CAPTION_LIMITS.maxChars || n < 2) return [words];
  const best = [{ cost: 0, from: -1 }];
  for (let i = 1; i <= n; i += 1) {
    best[i] = { cost: Infinity, from: -1 };
    for (let j = i - 1; j >= 0; j -= 1) {
      const phrase = words.slice(j, i);
      if (phrase.length > 1 && charCount(phrase) > CAPTION_LIMITS.maxChars) break;
      const total = best[j].cost + phraseCost(phrase) + (i < n ? boundaryCost(words, i, terms, gaps) : 0);
      if (total < best[i].cost) best[i] = { cost: total, from: j };
    }
  }
  const phrases = [];
  for (let i = n; i > 0; i = best[i].from) phrases.unshift(words.slice(best[i].from, i));
  return phrases;
}

// Groups a sentence's words into phrases: clause punctuation first, then grammatical splitting.
export function segmentSentence(words, terms = new Set()) {
  const clauses = [];
  let current = [];
  words.forEach((word, i) => {
    current.push(word);
    if (/[,;:]$|[—–]$/.test(word.text) && i < words.length - 1) { clauses.push(current); current = []; }
  });
  if (current.length) clauses.push(current);
  // Very short clauses ("By default,") join the following clause when the result still fits.
  const merged = [];
  for (const clause of clauses) {
    const previous = merged[merged.length - 1];
    const previousShort = previous && previous.length <= 2;
    if (previous && (previousShort || clause.length <= 1)
      && charCount([...previous, ...clause].map((word) => word.text)) <= CAPTION_LIMITS.maxChars) {
      merged[merged.length - 1] = [...previous, ...clause];
    } else merged.push(clause);
  }
  return merged.flatMap((clause) => {
    const texts = clause.map((word) => word.text);
    const gaps = clause.map((word, i) => (i > 0 && Number.isFinite(word.start) ? word.start - clause[i - 1].end : 0));
    let index = 0;
    return splitPhrase(texts, terms, gaps).map((part) => {
      const slice = clause.slice(index, index + part.length);
      index += part.length;
      return slice;
    });
  });
}

// Wraps a phrase into as few balanced lines as fit its caption style (subtitle band or speech bubble).
export function wrapPhrase(texts, terms = new Set(), style = CAPTION_STYLES.subtitle) {
  if (charCount(texts) <= style.lineChars || texts.length < 2) return [texts];
  const score = (lines) => {
    const widths = lines.map(charCount);
    const overflow = widths.reduce((sum, width) => sum + Math.max(0, width - style.lineChars) * 3, 0);
    let breaks = 0;
    let at = 0;
    for (const line of lines.slice(0, -1)) { at += line.length; breaks += boundaryCost(texts, at, terms) / 2; }
    return Math.max(...widths) + overflow + breaks + (lines.length - 1) * 2;
  };
  let best = null;
  const consider = (lines) => {
    const value = score(lines);
    if (!best || value < best.value) best = { value, lines };
  };
  for (let a = 1; a < texts.length; a += 1) {
    consider([texts.slice(0, a), texts.slice(a)]);
    if (style.maxLines >= 3) {
      for (let b = a + 1; b < texts.length; b += 1) consider([texts.slice(0, a), texts.slice(a, b), texts.slice(b)]);
    }
  }
  return best.lines;
}

// Word pairs that occur more than once in the narration, or inside a graphic's label, are treated as terms.
export function findTerms(words, labels = []) {
  const counts = new Map();
  const pairs = (list) => list.slice(1).map((word, i) => bare(list[i]) + " " + bare(word));
  for (const pair of pairs(words.map((word) => word.text))) counts.set(pair, (counts.get(pair) || 0) + 1);
  const terms = new Set([...counts].filter(([pair, count]) => count > 1 && !pair.split(" ").some((part) => LEANING.has(part))).map(([pair]) => pair));
  for (const label of labels) for (const pair of pairs(String(label).split(/\s+/))) terms.add(pair);
  return terms;
}

export function buildPhrases(words, sceneBounds, keywords = [], labels = []) {
  const keywordSet = new Set(keywords.flatMap((name) => String(name).split(/\s+/)).map(bare).filter((word) => word.length > 2));
  const terms = findTerms(words, [...keywords, ...labels]);
  const bySentence = new Map();
  for (const word of words) {
    if (!bySentence.has(word.sentence)) bySentence.set(word.sentence, []);
    bySentence.get(word.sentence).push(word);
  }
  const phrases = [];
  for (const sentenceWords of bySentence.values()) {
    for (const group of segmentSentence(sentenceWords, terms)) {
      const texts = group.map((word) => word.text);
      const lines = wrapPhrase(texts, terms);
      let offset = 0;
      phrases.push({
        style: "subtitle",
        start: group[0].start,
        spokenEnd: group[group.length - 1].end,
        segment: group[0].segment,
        sentence: group[0].sentence,
        text: texts.join(" "),
        lines: lines.map((line) => {
          const indices = line.map((_, i) => offset + i);
          offset += line.length;
          return indices;
        }),
        words: group.map((word) => ({
          text: word.text, start: word.start, end: word.end,
          keyword: keywordSet.has(bare(word.text)) || /^[A-Z0-9]{2,}[^a-z]*$/.test(word.text.replace(/[^\w-]/g, ""))
        }))
      });
    }
  }
  // Each phrase stays up until the next one starts, but never across a scene cut or a long silence.
  phrases.forEach((phrase, i) => {
    const next = phrases[i + 1];
    const sceneEnd = sceneBounds[phrase.segment]?.[1] ?? Infinity;
    const lingerEnd = phrase.spokenEnd + CAPTION_LIMITS.linger;
    const minEnd = phrase.start + CAPTION_LIMITS.minPhraseFrames;
    let end = Math.max(lingerEnd, minEnd);
    if (next) end = next.segment === phrase.segment && next.start - phrase.spokenEnd < 18 ? next.start : Math.min(end, next.start);
    phrase.end = Math.min(end, sceneEnd);
  });
  return phrases;
}

// Re-wraps a phrase's lines for another caption style (used when a scene speaks through the bubble).
export function restylePhrase(phrase, styleName) {
  const texts = phrase.words.map((word) => word.text);
  const lines = wrapPhrase(texts, new Set(), CAPTION_STYLES[styleName]);
  let offset = 0;
  return {
    ...phrase, style: styleName,
    lines: lines.map((line) => { const indices = line.map((_, i) => offset + i); offset += line.length; return indices; })
  };
}

const timecode = (frames) => {
  const ms = Math.max(0, Math.round(frames / FPS * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":") + "," + String(ms % 1000).padStart(3, "0");
};

export function toSrt(phrases) {
  return phrases.map((phrase, i) => [
    String(i + 1),
    timecode(phrase.start) + " --> " + timecode(phrase.end),
    phrase.lines.map((line) => line.map((index) => phrase.words[index].text).join(" ")).join("\n"),
    ""
  ].join("\n")).join("\n");
}
