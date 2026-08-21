import { FileClock } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';

/**
 * Provenance stamp — always visible when a run happened, even if it returned
 * nothing. Shows the artifact's own generated/started timestamp plus the source
 * filename, so the operator can trust WHAT they are looking at and WHEN.
 */
export default function DataStamp({
  generatedAt,
  sourceFile,
  loadedAt,
}: {
  generatedAt?: string | null;
  sourceFile?: string;
  loadedAt?: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mik-faint">
      <span className="inline-flex items-center gap-1.5">
        <FileClock size={13} />
        Generated: {fmtDateTime(generatedAt)}
      </span>
      {sourceFile ? <span>Source: {sourceFile}</span> : null}
      {loadedAt ? <span>Loaded: {fmtDateTime(loadedAt)}</span> : null}
    </div>
  );
}
