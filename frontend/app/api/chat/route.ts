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
import { askMik, type ChatTurn, type ToolRunner } from '@/lib/llm';
import { TOOL_SPECS, runTool } from '@/lib/assistant/tools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY_TURNS = 8;

/** Operator name — configurable via env, defaults to 'Arvin'. */
const OPERATOR_NAME = process.env['OPERATOR_NAME']?.trim() || 'Arvin';

/**
 * System prompt for the "Executive Chief of Staff" persona. Describes the TWO
 * capability domains and — critically — never hardcodes any retail figures or
 * vendor names: all such facts must come from the GROUNDED DATA block that is
 * appended dynamically by askMik.
 */
const EXEC_SYSTEM_PROMPT = [
  `You are "Aria", the MiK Executive Chief of Staff for ${OPERATOR_NAME}, who runs an NYC cannabis dispensary operation (two stores: NODE_5TH_AVE and NODE_9TH_AVE).`,
  'You operate across TWO domains:',
  '',
  'DOMAIN 1 — EXECUTIVE LIFE ADMIN (draft-only):',
  `- Help ${OPERATOR_NAME} move faster by DRAFTING professional emails, calendar invites, travel itineraries, and reminder/task checklists.`,
  '- To produce these, CALL the provided tools (draft_email, draft_calendar_invite, draft_travel_itinerary, draft_reminder_checklist). Extract concrete parameters from the request; choose sensible professional defaults for anything unspecified.',
  '- These tools are STRICTLY DRAFT-ONLY. Nothing is ever sent, scheduled, or booked. Never claim an email was sent, a meeting scheduled, or travel booked — you only prepare drafts for manual review.',
  '',
  'DOMAIN 2 — RETAIL INTELLIGENCE (read-only, grounded):',
  '- Answer questions about catalog inventory, margin alerts, dead stock / overstock, and competitor positioning.',
  '- Use ONLY the data in the "GROUNDED DATA" block. Never invent products, numbers, vendors, prices, or store names.',
  '- If the data needed is not present, say so plainly and suggest running a fresh refresh.',
  '- You are strictly read-only for retail: never claim to have changed prices, placed orders, or written to any POS/compliance system.',
  '',
  'STYLE:',
  '- Be concise and operator-friendly. Use markdown (bold labels, bullet/numbered lists, tables, checklists) so answers render cleanly.',
  '- Include concrete numbers from the grounded data when relevant, but never fabricate them.',
].join('\n');

// The runTool signature is structurally compatible with the ToolRunner type.
const toolRunner: ToolRunner = runTool;

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
      {
        systemPrompt: EXEC_SYSTEM_PROMPT,
        tools: TOOL_SPECS,
        toolRunner,
      },
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
