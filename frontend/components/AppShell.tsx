import type { ReactNode } from 'react';
import { Cannabis } from 'lucide-react';
import NavSidebar from './NavSidebar';

/**
 * App shell: fixed brand header ("MiK // Retail Intelligence") + left nav +
 * scrollable content region. Server component; nav interactivity is isolated
 * in the client NavSidebar.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-mik-bg text-mik-text">
      {/* Brand header */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-mik-border bg-mik-bg/95 px-5 backdrop-blur">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-mik-accentSoft text-mik-accent">
          <Cannabis size={18} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold tracking-wide text-mik-text">
            MiK
          </span>
          <span className="text-mik-faint">{'//'}</span>
          <span className="text-sm font-medium text-mik-muted">
            Retail Intelligence
          </span>
        </div>
        <span className="ml-auto rounded border border-mik-border px-2 py-0.5 text-[11px] uppercase tracking-wider text-mik-faint">
          Read-only console
        </span>
      </header>

      <div className="mx-auto flex max-w-[1400px]">
        {/* Sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-mik-border md:block">
          <NavSidebar />
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 p-5 md:p-7">{children}</main>
      </div>
    </div>
  );
}
