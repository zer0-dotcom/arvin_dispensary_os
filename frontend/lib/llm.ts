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

/** Result of running a draft-only tool: markdown output (or null if unknown). */
export interface ToolRunResult {
  readonly output: string;
}

/**
 * A tool runner supplied by the caller (route.ts passes `runTool` from
 * lib/assistant/tools.ts). Given a tool name + already-parsed args, it returns
 * the draft markdown, or null when the name is unknown. It performs NO I/O.
 */
export type ToolRunner = (
  name: string,
  args: Record<string, unknown>,
) => ToolRunResult | null;

/** OpenAI-compatible tool/function spec (opaque here; defined in tools.ts). */
export type ToolSpecLike = {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
};

/** Optional knobs for askMik — lets route.ts drive persona + tool-calling. */
export interface AskMikOptions {
  /** Override the default read-only system prompt. */
  readonly systemPrompt?: string;
  /** Function-calling tool specs to advertise to the model. */
  readonly tools?: readonly ToolSpecLike[];
  /** Callback that actually runs a chosen tool (pure, no side effects). */
  readonly toolRunner?: ToolRunner;
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

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: { content?: string; tool_calls?: OpenAiToolCall[] };
  }>;
}

/** Chat message shape we send upstream (system/user/assistant/tool). */
type OutboundMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls: OpenAiToolCall[];
    }
  | { role: 'tool'; content: string; tool_call_id: string };

const MAX_TOKENS = 1500;

/**
 * Safely JSON-parse tool-call arguments into a plain object. Tolerates the
 * model returning `""` or malformed JSON.
 */
function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to empty args
  }
  return {};
}

/**
 * Ask the LLM a question grounded in the provided data context.
 * `history` is prior turns (excluding the newest user message, which is passed
 * as `userMessage`).
 *
 * When `options.tools` + `options.toolRunner` are supplied, the model may invoke
 * one or more draft-only tools. We run them locally via the (pure) toolRunner
 * and return their verbatim markdown output, guaranteeing the drafts are never
 * truncated or hallucinated by a second generation pass.
 */
export async function askMik(
  userMessage: string,
  grounding: string,
  history: ChatTurn[] = [],
  options: AskMikOptions = {},
): Promise<LlmAnswer> {
  const { baseUrl, apiKey, model } = resolveConfig();

  if (!apiKey) {
    return fallbackAnswer(userMessage, grounding);
  }

  const systemPrompt = options.systemPrompt?.trim() || SYSTEM_PROMPT;
  const tools = options.tools;
  const toolRunner = options.toolRunner;
  const useTools =
    Array.isArray(tools) && tools.length > 0 && typeof toolRunner === 'function';

  const messages: OutboundMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: `GROUNDED DATA:\n${grounding}` },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: userMessage },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const baseBody = {
      model,
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
    };

    const firstResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ...baseBody,
        messages,
        ...(useTools ? { tools, tool_choice: 'auto' } : {}),
      }),
      signal: controller.signal,
    });

    if (!firstResponse.ok) {
      return fallbackAnswer(userMessage, grounding);
    }

    const firstData = (await firstResponse.json()) as OpenAiChatResponse;
    const choice = firstData.choices?.[0]?.message;
    const toolCalls = choice?.tool_calls;

    // ── Tool-calling path ──────────────────────────────────────────────────
    if (
      useTools &&
      toolRunner &&
      Array.isArray(toolCalls) &&
      toolCalls.length > 0
    ) {
      const drafts: string[] = [];
      for (const call of toolCalls) {
        const name = call.function?.name;
        if (typeof name !== 'string') {
          continue;
        }
        const args = parseToolArgs(call.function?.arguments);
        const result = toolRunner(name, args);
        if (result && result.output.trim().length > 0) {
          drafts.push(result.output.trim());
        }
      }
      if (drafts.length > 0) {
        // Return the drafts verbatim (never truncated by a 2nd generation).
        return {
          answer: drafts.join('\n\n---\n\n'),
          mode: 'llm',
          model,
        };
      }
      // Tools were requested but produced nothing usable — fall through to any
      // text content, then to fallback.
    }

    const content = choice?.content;
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
