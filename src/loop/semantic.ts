/**
 * Semantic drift detection using TF-IDF cosine similarity.
 * No external dependencies — pure JS computation, <100ms.
 *
 * LE-05: semanticDriftScore (TF-IDF, default)
 * LE-13: semanticDriftScoreWithBackend (opt-in embedding backend)
 */

// Common English stop words to exclude from TF-IDF vectors.
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "not", "no", "nor",
  "so", "yet", "both", "either", "each", "few", "more", "most", "other",
  "such", "than", "too", "very", "just", "that", "this", "these", "those",
  "it", "its", "as", "if", "then", "than", "when", "where", "who", "what",
  "how", "all", "any", "which", "there", "their", "they", "we", "you",
  "he", "she", "my", "your", "his", "her", "our", "up", "out", "about",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "same", "also", "back", "only", "well", "even", "still",
]);

/**
 * Tokenize text into normalized terms:
 * - lowercase
 * - split on non-alphanumeric characters
 * - remove stop words
 * - keep tokens >= 3 characters
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Build a term-frequency map from a list of tokens.
 */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

/**
 * Cosine similarity between two TF maps.
 * Returns 0 if either vector is empty.
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, freqA] of a) {
    normA += freqA * freqA;
    const freqB = b.get(term) ?? 0;
    dot += freqA * freqB;
  }
  for (const [, freqB] of b) {
    normB += freqB * freqB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * LE-05: Semantic drift score using TF-IDF cosine distance.
 *
 * Compares the vocabulary of `diffContent` against `goalText`.
 * Returns a value in [0, 1]:
 *   0 = semantically identical / fully relevant
 *   1 = completely unrelated
 *
 * Runs synchronously in <100ms (pure computation, no IO).
 */
export function semanticDriftScore(diffContent: string, goalText: string): number {
  // Guard: empty inputs — no information to compare, return 0 (no drift detected)
  if (!diffContent.trim() || !goalText.trim()) return 0;

  const diffTokens = tokenize(diffContent);
  const goalTokens = tokenize(goalText);

  if (diffTokens.length === 0 || goalTokens.length === 0) return 0;

  const diffTF = termFrequency(diffTokens);
  const goalTF = termFrequency(goalTokens);

  const similarity = cosineSimilarity(diffTF, goalTF);
  return 1 - similarity;
}

/**
 * LE-13: Semantic drift score with pluggable backend.
 *
 * This is an opt-in extension — the default backend is "tfidf" (LE-05 logic).
 * The "embedding" backend requires the caller to supply an `embedFn`; no
 * embedding library is bundled. This keeps the package dependency-free while
 * allowing users to plug in Anthropic / OpenAI / local ONNX embeddings.
 *
 * Usage (embedding opt-in):
 *   import { OpenAI } from "openai";
 *   const client = new OpenAI();
 *   const score = await semanticDriftScoreWithBackend(diff, goal, {
 *     backend: "embedding",
 *     embedFn: (text) => client.embeddings
 *       .create({ model: "text-embedding-3-small", input: text })
 *       .then(r => r.data[0].embedding),
 *   });
 *
 * @param diffContent - The git diff or changed content
 * @param goalText    - The loop goal / task description
 * @param opts.backend  - "tfidf" (default) | "embedding"
 * @param opts.embedFn  - Required when backend="embedding". Caller-supplied
 *                        function that returns a float[] vector for a text.
 */
export async function semanticDriftScoreWithBackend(
  diffContent: string,
  goalText: string,
  opts?: {
    backend?: "tfidf" | "embedding";
    embedFn?: (text: string) => Promise<number[]>;
  },
): Promise<number> {
  const backend = opts?.backend ?? "tfidf";

  if (backend === "tfidf") {
    // Synchronous TF-IDF path — wrap result in a resolved promise
    return semanticDriftScore(diffContent, goalText);
  }

  // Embedding path: requires embedFn to be provided by the caller
  if (!opts?.embedFn) {
    throw new Error(
      'semanticDriftScoreWithBackend: backend="embedding" requires opts.embedFn. ' +
        "Pass a function that calls your preferred embedding API (Anthropic, OpenAI, etc.).",
    );
  }

  const [diffVec, goalVec] = await Promise.all([
    opts.embedFn(diffContent),
    opts.embedFn(goalText),
  ]);

  // Convert arrays to Maps so we can reuse cosineSimilarity
  const diffMap = new Map<string, number>(diffVec.map((v, i) => [String(i), v]));
  const goalMap = new Map<string, number>(goalVec.map((v, i) => [String(i), v]));

  const similarity = cosineSimilarity(diffMap, goalMap);
  return Math.max(0, Math.min(1, 1 - similarity));
}
