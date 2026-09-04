/**
 * MiK copilot chat route.
 *
 * POST { message: string, history?: { role: 'user'|'assistant', content: string }[] }
 *
 * Flow:
 *   1. Load the latest dossier / margin scan / competitor sweep via the
 *      existing data-loader (buildGroundingContext) — the SAME artifacts the
 *      dashboard pages render, so answers stay consistent with the UI.
 *   2. Ask the LLM (Abacus-native RouteLLM, or graceful deterministic fallback)
 *      to answer the question grounded ONLY in that data.
 *
 * Read-only: this route never writes data or triggers actions.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { buildGroundingContext } from '@/lib/chat-context';
import { askMik, type ChatTurn } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY_TURNS = 8;

interface ChatRequestBody {
  message?: unknown;
  history?: unknown;
}

function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const role = obj['role'];
    const content = obj['content'];
    if (
      (role === 'user' || role === 'assistant') &&
      typeof content === 'string' &&
      content.trim().length > 0
    ) {
      turns.push({ role, content: content.slice(0, MAX_MESSAGE_LEN) });
    }
  }
  // Keep only the most recent turns to bound prompt size.
  return turns.slice(-MAX_HISTORY_TURNS);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const message =
    typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'A non-empty "message" field is required.' },
      { status: 400 },
    );
  }

  const history = parseHistory(body.history);

  try {
    const grounding = await buildGroundingContext();
    const result = await askMik(
      message.slice(0, MAX_MESSAGE_LEN),
      grounding.text,
      history,
    );

    return NextResponse.json(
      {
        ok: true,
        answer: result.answer,
        mode: result.mode,
        ...(result.model ? { model: result.model } : {}),
        sources: grounding.sources,
        hasData: grounding.hasAnyData,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Chat failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }
}
