/**
 * Errors surfaced to the MCP client (yitam) when a knowledge search cannot run.
 *
 * Before, failures were swallowed and the tool answered `{ success: true, results: [] }`, which the
 * chat model reads as "the knowledge base has nothing on this". Every failure now becomes a
 * KnowledgeSearchError with a short, actionable message (no secrets) and the tool call is marked
 * as an error.
 */

export type KnowledgeSearchErrorKind =
  | 'config'          // missing / inconsistent configuration (e.g. vector dimension mismatch)
  | 'embedding_auth'  // Gemini key rejected
  | 'embedding_billing' // Gemini credits / quota exhausted
  | 'embedding_rate_limit'
  | 'embedding'       // other Gemini failure
  | 'database'        // Qdrant / Chroma request failed
  | 'invalid_request';

export class KnowledgeSearchError extends Error {
  constructor(
    message: string,
    public readonly kind: KnowledgeSearchErrorKind,
    public readonly status?: number,
  ) {
    super(redactSecrets(message));
    this.name = 'KnowledgeSearchError';
  }
}

const SECRET_ENV_NAMES = ['GEMINI_API_KEY', 'QDRANT_API_KEY'];

/** Removes configured secrets (and anything that looks like an API key) from a message. */
export function redactSecrets(text: string): string {
  let out = String(text ?? '');
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join('<REDACTED>');
  }
  return out
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '<REDACTED>')
    .replace(/([?&](?:key|api_key)=)[^&\s"']+/gi, '$1<REDACTED>')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/g, '$1<REDACTED>');
}

/** HTTP status from the various client error shapes (Qdrant REST client, @google/genai, fetch). */
export function errorStatus(error: any): number | undefined {
  const s = error?.status ?? error?.code ?? error?.response?.status ?? error?.error?.code;
  const n = typeof s === 'string' ? parseInt(s, 10) : s;
  return Number.isInteger(n) && n >= 100 && n < 600 ? n : undefined;
}

/** Best-effort human-readable message from a client error (incl. Qdrant's `data.status.error`). */
export function errorText(error: any): string {
  const qdrant = error?.data?.status?.error;
  if (typeof qdrant === 'string' && qdrant) return qdrant;
  const msg = error?.message ?? error?.error?.message ?? error;
  return redactSecrets(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 500);
}

/** Text returned to the chat model. */
export function describeForClient(error: unknown): { error: string; errorKind: KnowledgeSearchErrorKind } {
  if (error instanceof KnowledgeSearchError) return { error: error.message, errorKind: error.kind };
  return { error: `Knowledge search failed: ${errorText(error)}`, errorKind: 'database' };
}
