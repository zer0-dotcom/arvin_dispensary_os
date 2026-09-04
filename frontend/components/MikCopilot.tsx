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

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Which SKUs have critical margins?',
  'What dead stock should I clear?',
  'Top overstock across both stores?',
];

const GREETING: ChatMessage = {
  role: 'assistant',
  content:
    "Hi, I'm MiK — your read-only retail-intelligence copilot. Ask me about catalog inventory, margin alerts, or dead stock / overstock, grounded in the latest dossier and margin scan.",
};

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
              <span className="text-sm font-bold text-mik-text">MiK</span>
              <span className="text-mik-faint">{'//'}</span>
              <span className="text-xs text-mik-muted">Copilot</span>
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
                    'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'bg-mik-accent text-white'
                      : 'bg-mik-panel2 text-mik-text',
                  ].join(' ')}
                >
                  {m.content}
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
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-mik-border px-3 py-1 text-xs text-mik-muted transition-colors hover:border-mik-accent hover:text-mik-accent"
                  >
                    {s}
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
              placeholder="Ask about inventory, margins, dead stock…"
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
