/**
 * MiK copilot — LLM invocation (server-only).
 *
 * DESIGN: the app calls an OpenAI-compatible chat-completions endpoint. On
 * Abacus.AI infrastructure this is the native RouteLLM gateway (default base
 * URL below), authenticated with the platform key — NO third-party API key and
 * NO per-user key is required. Everything is read from process.env only; no
 * secret is ever hardcoded.
 *
 * Configurable env (all optional — sensible defaults applied):
 *   LLM_API_BASE_URL  OpenAI-compatible base (default Abacus RouteLLM gateway)
 *   LLM_API_KEY       API key/token; falls back to ABACUS_API_KEY
 *   LLM_MODEL         model name (default 'gpt-4o-mini')
 *
 * GRACEFUL DEGRADATION: if no key is configured (or the upstream call fails),
 * we DO NOT error out — we return a deterministic, data-grounded answer built
 * directly from the grounding context so the copilot always responds usefully.
 */

import 'server-only';

export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface LlmAnswer {
  readonly answer: string;
  readonly mode: 'llm' | 'fallback';
  readonly model?: string;
}

const DEFAULT_BASE_URL = 'https://routellm.abacus.ai/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = [
  'You are "MiK", the read-only retail-intelligence copilot for Arvin\'s NYC cannabis dispensary operation (two stores: NODE_5TH_AVE and NODE_9TH_AVE).',
  'Answer questions about catalog inventory, margin alerts, and dead stock / overstock.',
  'CRITICAL GROUNDING RULES:',
  '- Use ONLY the data in the "GROUNDED DATA" block below. Do not invent products, numbers, vendors, or prices.',
  '- If the data needed to answer is not present, say so plainly (e.g. "That is not in the latest dossier/margin scan.") and suggest running a fresh refresh.',
  '- Be concise and operator-friendly. Prefer short bullet lists. Include concrete numbers from the data when relevant.',
  '- You are strictly read-only: never claim to have changed prices, placed orders, or taken any action.',
].join('\n');

function resolveConfig(): { baseUrl: string; apiKey: string | null; model: string } {
  const baseUrl =
    process.env['LLM_API_BASE_URL']?.trim() || DEFAULT_BASE_URL;
  const apiKey =
    process.env['LLM_API_KEY']?.trim() ||
    process.env['ABACUS_API_KEY']?.trim() ||
    null;
  const model = process.env['LLM_MODEL']?.trim() || DEFAULT_MODEL;
  return { baseUrl, apiKey, model };
}

/**
 * Deterministic, data-grounded fallback. Returns the grounding context framed
 * as a helpful answer so the copilot is useful even with no LLM configured.
 */
function fallbackAnswer(userMessage: string, grounding: string): LlmAnswer {
  const answer = [
    "MiK is running without an LLM configured, so here is the latest grounded data relevant to your question. (Set LLM_API_KEY or ABACUS_API_KEY to enable full natural-language answers.)",
    '',
    `Your question: ${userMessage}`,
    '',
    grounding,
  ].join('\n');
  return { answer, mode: 'fallback' };
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Ask the LLM a question grounded in the provided data context.
 * `history` is prior turns (excluding the newest user message, which is passed
 * as `userMessage`).
 */
export async function askMik(
  userMessage: string,
  grounding: string,
  history: ChatTurn[] = [],
): Promise<LlmAnswer> {
  const { baseUrl, apiKey, model } = resolveConfig();

  if (!apiKey) {
    return fallbackAnswer(userMessage, grounding);
  }

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'system' as const, content: `GROUNDED DATA:\n${grounding}` },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: userMessage },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 700,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Upstream failure — degrade gracefully rather than 500.
      return fallbackAnswer(userMessage, grounding);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim().length > 0) {
      return { answer: content.trim(), mode: 'llm', model };
    }
    return fallbackAnswer(userMessage, grounding);
  } catch {
    // Network error / timeout / abort — degrade gracefully.
    return fallbackAnswer(userMessage, grounding);
  } finally {
    clearTimeout(timer);
  }
}
