/**
 * Embedding Client — OpenAI text-embedding-3-small wrapper.
 *
 * Generates 1536-dimensional embeddings for node content and search queries.
 * Uses native fetch() — no SDK dependency.
 *
 * Graceful fallback: if OPENAI_API_KEY is not set, returns empty arrays
 * and SSA falls back to BM25-only seeding (existing behavior).
 */

const OPENAI_URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_CHARS = 30_000; // ~8K tokens safety margin

/**
 * Batch-embed multiple texts via OpenAI API.
 * Returns one Float32Array per input text.
 * Returns empty arrays if no API key or on error.
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[embed] OPENAI_API_KEY not set — skipping embedding');
    return texts.map(() => new Float32Array(0));
  }

  if (texts.length === 0) return [];

  // Truncate long texts
  const truncated = texts.map((t) => t.slice(0, MAX_CHARS));

  try {
    const resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: truncated,
        dimensions: DIMENSIONS,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('[embed] OpenAI API error:', resp.status, err);
      return texts.map(() => new Float32Array(0));
    }

    const json = (await resp.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index (OpenAI may return out of order)
    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  } catch (e: any) {
    console.error('[embed] Failed to call OpenAI:', e.message);
    return texts.map(() => new Float32Array(0));
  }
}

/**
 * Embed a single query string.
 * Returns empty Float32Array on failure (SSA gracefully handles this).
 */
export async function embedQuery(query: string): Promise<Float32Array> {
  const results = await embedTexts([query]);
  return results[0] ?? new Float32Array(0);
}

/**
 * Build the text to embed for a node.
 * Concatenates title + summary + body, capped at MAX_CHARS.
 */
export function buildNodeText(
  title: string | null,
  summary: string | null,
  body: string | null,
): string {
  const parts: string[] = [];
  if (title) parts.push(title);
  if (summary) parts.push(summary);
  if (body) parts.push(body);
  return parts.join(' ').slice(0, MAX_CHARS);
}

/**
 * Build a simple context prefix for embedding.
 * Maps node subtype to a human-readable label prepended to the text.
 * This gives the embedding model context about what kind of content it is.
 */
export function buildContextPrefix(
  type: string,
  subtype: string | null,
): string {
  if (!subtype) return `[${type}]`;

  const labels: Record<string, string> = {
    'custom:watchpoint': '[watchpoint]',
    'custom:curiosity': '[curiosity]',
    'custom:lesson': '[lesson]',
    'custom:thesis': '[thesis]',
    'custom:market_event': '[market event]',
    'custom:trade': '[trade]',
    'custom:signal': '[signal]',
    'custom:turn_summary': '[conversation summary]',
    'custom:session_summary': '[session summary]',
    'custom:trade_entry': '[trade entry]',
    'custom:trade_close': '[trade close]',
    'custom:trade_modify': '[trade modify]',
  };

  return labels[subtype] ?? `[${subtype.replace('custom:', '')}]`;
}
