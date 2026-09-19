'use client';

/**
 * MiK Copilot — floating conversational drawer.
 *
 * A bottom-right floating action button that expands into a chat panel. Sends
 * the user's message (plus recent history) to POST /api/chat, which grounds the
 * answer in the latest dossier / margin scan / competitor sweep artifacts.
 *
 * Styled with the existing mik-* / tier-* design tokens so it matches the rest
 * of the console. Client-only state; no persistent history storage.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Suggestion chips. Each has a short display `label` and a fuller natural-language
 * `prompt` sent on click — covering both executive life-admin (draft-only) and
 * retail-intelligence domains.
 */
interface Suggestion {
  readonly label: string;
  readonly prompt: string;
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    label: 'Draft Vendor Email',
    prompt:
      'Draft a professional email to a vendor about a wholesale reorder and pricing terms.',
  },
  {
    label: 'Schedule Strategy Review',
    prompt:
      'Draft a calendar invite for a weekly strategy review covering both stores.',
  },
  {
    label: 'Plan Travel Itinerary',
    prompt:
      'Draft a travel itinerary for an upcoming industry conference trip.',
  },
  {
    label: 'Audit Margin Anomalies',
    prompt:
      'Which SKUs have margin anomalies I should act on, based on the latest margin scan?',
  },
  {
    label: 'Set Daily Task Reminders',
    prompt:
      'Draft a daily task reminder checklist for running the dispensary operation.',
  },
];

const GREETING: ChatMessage = {
  role: 'assistant',
  content:
    "Good day, Arvin. I'm your MiK Executive Assistant. I can handle **executive life admin** — drafting emails, calendar invites, travel itineraries, and task reminders (draft-only, nothing is ever sent or booked) — and deliver **retail intelligence** on inventory, margins, dead stock, and competitors, grounded in your latest dossier and scans. How can I help?",
};

// ---------------------------------------------------------------------------
// Lightweight markdown renderer (no dependency, no dangerouslySetInnerHTML).
// Supports: #/##/### headings, --- / *** rules, - / * bullets, - [ ] / - [x]
// checkboxes, 1. ordered lists, GFM tables, **bold**, *italic*, `code`,
// blank-line paragraphs and single line breaks. Enough for the exec drafts.
// ---------------------------------------------------------------------------

/** Render inline spans: **bold**, *italic*, `code`. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Tokenize on the three inline markers; keep the delimiters via capture group.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-i${i}`;
    i += 1;
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-mik-text">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-mik-bg px-1 py-0.5 font-mono text-[0.85em] text-mik-accent"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

/** Split a GFM table row into trimmed cells. */
function splitRow(row: string): string[] {
  return row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function isTableSeparator(row: string): boolean {
  return /^\|?[\s:-]+\|[\s:|-]*$/.test(row) && row.includes('-');
}

function Markdown({ content }: { content: string }): ReactNode {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();

    // Blank line — skip (paragraph separation handled below).
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      blocks.push(<hr key={`b${key++}`} className="my-2 border-mik-border" />);
      i += 1;
      continue;
    }

    // Headings.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = (heading[1] ?? '').length;
      const body = heading[2] ?? '';
      const sizes: Record<number, string> = {
        1: 'text-base font-bold',
        2: 'text-sm font-bold',
        3: 'text-sm font-semibold',
        4: 'text-xs font-semibold uppercase tracking-wide',
        5: 'text-xs font-semibold',
        6: 'text-xs font-semibold',
      };
      blocks.push(
        <div
          key={`b${key++}`}
          className={`mt-2 mb-1 text-mik-text ${sizes[level] ?? 'text-sm font-semibold'}`}
        >
          {renderInline(body, `h${key}`)}
        </div>,
      );
      i += 1;
      continue;
    }

    // GFM table: header row + separator row.
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      isTableSeparator((lines[i + 1] ?? '').trim())
    ) {
      const header = splitRow(trimmed);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(splitRow((lines[i] ?? '').trim()));
        i += 1;
      }
      blocks.push(
        <div key={`b${key++}`} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="border border-mik-border bg-mik-panel2 px-2 py-1 text-left font-semibold text-mik-text"
                  >
                    {renderInline(h, `th${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className="border border-mik-border px-2 py-1 text-mik-muted"
                    >
                      {renderInline(c, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Checkbox list.
    if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) {
      const items: { checked: boolean; text: string }[] = [];
      while (i < lines.length) {
        const m = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec((lines[i] ?? '').trim());
        if (!m) break;
        items.push({
          checked: (m[1] ?? '').toLowerCase() === 'x',
          text: m[2] ?? '',
        });
        i += 1;
      }
      blocks.push(
        <ul key={`b${key++}`} className="my-1 space-y-0.5">
          {items.map((it, ii) => (
            <li key={ii} className="flex items-start gap-2">
              <span
                className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                  it.checked
                    ? 'border-mik-accent bg-mik-accent text-white'
                    : 'border-mik-border'
                } text-[9px] leading-none`}
                aria-hidden
              >
                {it.checked ? '✓' : ''}
              </span>
              <span>{renderInline(it.text, `cb${key}-${ii}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\d+\.\s+(.*)$/.exec((lines[i] ?? '').trim());
        if (!m) break;
        items.push(m[1] ?? '');
        i += 1;
      }
      blocks.push(
        <ol
          key={`b${key++}`}
          className="my-1 list-decimal space-y-0.5 pl-5 marker:text-mik-faint"
        >
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ol${key}-${ii}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^[-*]\s+(.*)$/.exec((lines[i] ?? '').trim());
        if (!m || /^[-*]\s+\[[ xX]\]\s+/.test((lines[i] ?? '').trim())) break;
        items.push(m[1] ?? '');
        i += 1;
      }
      blocks.push(
        <ul
          key={`b${key++}`}
          className="my-1 list-disc space-y-0.5 pl-5 marker:text-mik-faint"
        >
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ul${key}-${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-special lines.
    const paraLines: string[] = [];
    while (i < lines.length) {
      const t = (lines[i] ?? '').trim();
      if (
        t.length === 0 ||
        t === '---' ||
        t === '***' ||
        t === '___' ||
        /^#{1,6}\s+/.test(t) ||
        /^[-*]\s+/.test(t) ||
        /^\d+\.\s+/.test(t) ||
        t.startsWith('|')
      ) {
        break;
      }
      paraLines.push(t);
      i += 1;
    }
    blocks.push(
      <p key={`b${key++}`} className="my-1 leading-relaxed">
        {paraLines.map((pl, pi) => (
          <span key={pi}>
            {renderInline(pl, `p${key}-${pi}`)}
            {pi < paraLines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="space-y-0.5">{blocks}</div>;
}

export default function MikCopilot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || loading) {
      return;
    }
    setError(null);
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: trimmed },
    ];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    // Send prior turns (exclude the synthetic greeting) as history.
    const history = nextMessages
      .filter((m, i) => !(i === 0 && m === GREETING))
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data: unknown = await res.json();
      const obj = (data ?? {}) as Record<string, unknown>;
      if (!res.ok || obj['ok'] !== true) {
        const msg =
          typeof obj['error'] === 'string'
            ? (obj['error'] as string)
            : `Request failed (${res.status})`;
        throw new Error(msg);
      }
      const answer =
        typeof obj['answer'] === 'string'
          ? (obj['answer'] as string)
          : 'No answer returned.';
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Floating action button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open MiK copilot"
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-mik-accent text-white shadow-lg shadow-black/40 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-mik-accent focus:ring-offset-2 focus:ring-offset-mik-bg"
        >
          <MessageSquare size={22} />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[min(70vh,560px)] w-[min(92vw,400px)] flex-col overflow-hidden rounded-xl border border-mik-border bg-mik-panel shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-mik-border bg-mik-panel2 px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-mik-accentSoft text-mik-accent">
              <MessageSquare size={16} />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold text-mik-text">Aria</span>
              <span className="text-mik-faint">|</span>
              <span className="text-xs text-mik-muted">
                MiK Executive Chief of Staff
              </span>
            </div>
            <span className="ml-auto rounded border border-mik-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-mik-faint">
              Read-only
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close MiK copilot"
              className="ml-1 rounded p-1 text-mik-muted transition-colors hover:bg-mik-panel hover:text-mik-text"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={[
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'whitespace-pre-wrap bg-mik-accent text-white'
                      : 'bg-mik-panel2 text-mik-text',
                  ].join(' ')}
                >
                  {m.role === 'user' ? (
                    m.content
                  ) : (
                    <Markdown content={m.content} />
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-mik-panel2 px-3 py-2 text-sm text-mik-muted">
                  <Loader2 size={14} className="animate-spin" />
                  MiK is thinking…
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-tier-t3 bg-tier-t3bg px-3 py-2 text-xs text-tier-t3">
                {error}
              </div>
            )}

            {/* Suggestion chips (only before the first user turn) */}
            {messages.length === 1 && !loading && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => void send(s.prompt)}
                    className="rounded-full border border-mik-border px-3 py-1 text-xs text-mik-muted transition-colors hover:border-mik-accent hover:text-mik-accent"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-end gap-2 border-t border-mik-border bg-mik-panel2 p-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Draft an email, plan travel, or ask about inventory & margins…"
              className="max-h-28 min-h-[38px] flex-1 resize-none rounded-md border border-mik-border bg-mik-bg px-3 py-2 text-sm text-mik-text placeholder:text-mik-faint focus:border-mik-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              aria-label="Send message"
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md bg-mik-accent text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
