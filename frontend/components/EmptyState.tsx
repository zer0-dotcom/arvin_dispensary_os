import { Inbox, FileWarning, FileQuestion } from 'lucide-react';

type Variant = 'empty' | 'missing' | 'error';

const ICONS = {
  empty: Inbox,
  missing: FileQuestion,
  error: FileWarning,
} as const;

/**
 * Canonical "no usable data" panel. Used for:
 *   - missing : no artifact file on disk yet
 *   - empty   : artifact parsed but semantically empty (upstream 403'd)
 *   - error   : artifact present but unparseable
 * NEVER shows fabricated numbers — this is the enforced fallback for Rule §1.3.
 */
export default function EmptyState({
  variant = 'missing',
  title,
  detail,
}: {
  variant?: Variant;
  title: string;
  detail?: string;
}) {
  const Icon = ICONS[variant];
  return (
    <div className="mik-card flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-mik-border bg-mik-panel2 text-mik-faint">
        <Icon size={22} />
      </div>
      <div className="text-sm font-semibold text-mik-text">{title}</div>
      {detail ? (
        <div className="max-w-md text-xs text-mik-muted">{detail}</div>
      ) : null}
    </div>
  );
}
