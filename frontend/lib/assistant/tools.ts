/**
 * MiK Executive Chief of Staff — draft-only assistant tools (server-safe, pure).
 *
 * These four functions are the "Executive Life Admin" capability set layered on
 * top of the existing read-only retail-intelligence copilot. Each one is a PURE
 * FORMATTING function: it takes typed parameters and returns a nicely formatted
 * MARKDOWN draft as a string. That is the ENTIRE contract.
 *
 * ┌─ NON-NEGOTIABLE SECURITY BOUNDARY (enforced structurally, not by policy) ─┐
 * │ • DRAFT-ONLY: there is NO send / dispatch / transmit path anywhere in this │
 * │   module. `draftEmail` renders text; there is deliberately no `sendEmail`. │
 * │ • READ-ONLY: no Dutchie POS / METRC / compliance write-backs. These        │
 * │   functions perform NO I/O at all — no fetch, no fs, no network, no env.    │
 * │ • STUB/SCAFFOLD ONLY: calendar / travel / reminder helpers do NOT touch any │
 * │   live OAuth flow, Google Calendar API, or booking API. They only return   │
 * │   formatted draft text for the operator to review and act on manually.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Because every function is side-effect free and returns a string, the security
 * guarantees above hold by construction: there is simply no code path that could
 * send, book, or persist anything.
 *
 * Style follows the rest of frontend/lib/* : explicit interfaces, defensive
 * handling of optional/empty inputs, no `any`, strict-mode clean.
 */

/** The four draft-only tools the copilot can invoke. */
export type ToolName =
  | 'draft_email'
  | 'draft_calendar_invite'
  | 'draft_travel_itinerary'
  | 'draft_reminder_checklist';

/** Uniform result envelope: which tool produced the draft + its markdown body. */
export interface ToolResult {
  readonly tool: ToolName;
  readonly output: string;
}

// ---------------------------------------------------------------------------
// Small shared formatting helpers (pure).
// ---------------------------------------------------------------------------

const DRAFT_ONLY_FOOTER =
  '_Draft only — nothing has been sent, scheduled, or booked. Review and act on this manually._';

/** Trim + collapse to a safe single-line value, with a fallback when empty. */
function line(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v.length > 0 ? v : fallback;
}

/** Trim a free-text block, preserving intentional newlines; fallback if empty. */
function block(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : fallback;
}

/** Normalize a list of strings, dropping empties. */
function cleanList(items: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((i) => (i ?? '').trim()).filter((i) => i.length > 0);
}

/** Render a string[] as a markdown bullet list, or a fallback line. */
function bullets(items: string[], fallback: string): string {
  if (items.length === 0) {
    return fallback;
  }
  return items.map((i) => `- ${i}`).join('\n');
}

// ---------------------------------------------------------------------------
// 1) Email draft
// ---------------------------------------------------------------------------

export interface DraftEmailParams {
  /** Recipient (name and/or address). Free text — never used to actually send. */
  readonly to: string;
  readonly subject: string;
  /** Full body text; if omitted, `keyPoints` are used to scaffold one. */
  readonly body?: string;
  /** Alternative to `body`: bullet points to expand into the draft. */
  readonly keyPoints?: string[];
  readonly cc?: string;
  /** Sign-off name; defaults handled by the caller/persona, not hardcoded here. */
  readonly from?: string;
  /** Desired tone hint (e.g. "professional", "warm", "firm"). */
  readonly tone?: string;
}

/**
 * Render an email DRAFT as markdown. No send path exists — this only returns
 * text for the operator to copy/adapt.
 */
export function draftEmail(params: DraftEmailParams): ToolResult {
  const to = line(params.to, '[recipient]');
  const subject = line(params.subject, '[subject]');
  const cc = line(params.cc, '');
  const from = line(params.from, '');
  const tone = line(params.tone, '');

  const points = cleanList(params.keyPoints);
  const bodyText = block(
    params.body,
    points.length > 0
      ? points.map((p) => `- ${p}`).join('\n')
      : '[Draft the message body here.]',
  );

  const lines: string[] = [];
  lines.push('### 📧 Email Draft');
  lines.push('');
  lines.push(`**To:** ${to}`);
  if (cc) {
    lines.push(`**Cc:** ${cc}`);
  }
  lines.push(`**Subject:** ${subject}`);
  if (tone) {
    lines.push(`**Tone:** ${tone}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(bodyText);
  if (from) {
    lines.push('');
    lines.push(`Best regards,  \n${from}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(DRAFT_ONLY_FOOTER);

  return { tool: 'draft_email', output: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// 2) Calendar invite draft
// ---------------------------------------------------------------------------

export interface DraftCalendarInviteParams {
  readonly title: string;
  /** Human-readable date (e.g. "2026-09-24" or "next Tuesday"). */
  readonly date: string;
  /** Human-readable time (e.g. "10:00 AM ET"). */
  readonly time?: string;
  readonly durationMinutes?: number;
  readonly attendees?: string[];
  readonly location?: string;
  readonly agenda?: string[];
  readonly notes?: string;
}

/**
 * Render a calendar-invite DRAFT as markdown. STUB ONLY — no calendar API / no
 * OAuth. Returns text only.
 */
export function draftCalendarInvite(
  params: DraftCalendarInviteParams,
): ToolResult {
  const title = line(params.title, '[meeting title]');
  const date = line(params.date, '[date]');
  const time = line(params.time, 'TBD');
  const location = line(params.location, 'TBD (add video link or room)');
  const attendees = cleanList(params.attendees);
  const agenda = cleanList(params.agenda);
  const duration =
    typeof params.durationMinutes === 'number' &&
    Number.isFinite(params.durationMinutes) &&
    params.durationMinutes > 0
      ? `${Math.round(params.durationMinutes)} min`
      : '30 min';
  const notes = block(params.notes, '');

  const lines: string[] = [];
  lines.push('### 📅 Calendar Invite Draft');
  lines.push('');
  lines.push(`**Title:** ${title}`);
  lines.push(`**Date:** ${date}`);
  lines.push(`**Time:** ${time}`);
  lines.push(`**Duration:** ${duration}`);
  lines.push(`**Location:** ${location}`);
  lines.push(
    `**Attendees:** ${attendees.length > 0 ? attendees.join(', ') : '[add attendees]'}`,
  );
  lines.push('');
  lines.push('**Agenda:**');
  lines.push(bullets(agenda, '- [Add agenda items]'));
  if (notes) {
    lines.push('');
    lines.push('**Notes:**');
    lines.push(notes);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(DRAFT_ONLY_FOOTER);

  return { tool: 'draft_calendar_invite', output: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// 3) Travel itinerary draft
// ---------------------------------------------------------------------------

export interface ItineraryDay {
  /** Label for the day, e.g. "Day 1 — 2026-10-02". */
  readonly label?: string;
  readonly items: string[];
}

export interface DraftTravelItineraryParams {
  readonly destination: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly purpose?: string;
  readonly travelers?: string[];
  /** Explicit day-by-day plan; if omitted, a scaffold is generated. */
  readonly days?: ItineraryDay[];
  readonly notes?: string;
}

/**
 * Render a travel-itinerary DRAFT as a day-by-day markdown plan. STUB ONLY — no
 * booking API, no fares/availability lookups. Returns text only.
 */
export function draftTravelItinerary(
  params: DraftTravelItineraryParams,
): ToolResult {
  const destination = line(params.destination, '[destination]');
  const startDate = line(params.startDate, 'TBD');
  const endDate = line(params.endDate, 'TBD');
  const purpose = line(params.purpose, '');
  const travelers = cleanList(params.travelers);

  const lines: string[] = [];
  lines.push('### ✈️ Travel Itinerary Draft');
  lines.push('');
  lines.push(`**Destination:** ${destination}`);
  lines.push(`**Dates:** ${startDate} → ${endDate}`);
  if (purpose) {
    lines.push(`**Purpose:** ${purpose}`);
  }
  lines.push(
    `**Travelers:** ${travelers.length > 0 ? travelers.join(', ') : '[add travelers]'}`,
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  const days = Array.isArray(params.days) ? params.days : [];
  if (days.length > 0) {
    days.forEach((day, idx) => {
      const label = line(day.label, `Day ${idx + 1}`);
      const items = cleanList(day.items);
      lines.push(`#### ${label}`);
      lines.push(bullets(items, '- [Plan activities for this day]'));
      lines.push('');
    });
  } else {
    // Scaffold a standard 3-phase plan so the operator has a starting frame.
    lines.push('#### Day 1 — Arrival');
    lines.push('- [ ] Travel to destination / check-in');
    lines.push('- [ ] Confirm local transport');
    lines.push('');
    lines.push('#### Day 2 — Core Agenda');
    lines.push('- [ ] Primary meetings / site visits');
    lines.push('- [ ] Working lunch / follow-ups');
    lines.push('');
    lines.push('#### Day 3 — Wrap & Return');
    lines.push('- [ ] Closeout meetings');
    lines.push('- [ ] Return travel');
    lines.push('');
  }

  const notes = block(params.notes, '');
  if (notes) {
    lines.push('**Notes:**');
    lines.push(notes);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(DRAFT_ONLY_FOOTER);

  return { tool: 'draft_travel_itinerary', output: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// 4) Reminder / task checklist draft
// ---------------------------------------------------------------------------

export interface DraftReminderChecklistParams {
  readonly title: string;
  readonly items: string[];
  /** Optional due date / cadence, e.g. "today", "by EOD Friday". */
  readonly due?: string;
}

/**
 * Render a reminder/task checklist DRAFT as a markdown checklist. STUB ONLY — no
 * reminder service / no scheduling side effects. Returns text only.
 */
export function draftReminderChecklist(
  params: DraftReminderChecklistParams,
): ToolResult {
  const title = line(params.title, 'Task Checklist');
  const due = line(params.due, '');
  const items = cleanList(params.items);

  const lines: string[] = [];
  lines.push(`### ✅ ${title}`);
  if (due) {
    lines.push('');
    lines.push(`**Due:** ${due}`);
  }
  lines.push('');
  if (items.length > 0) {
    for (const item of items) {
      lines.push(`- [ ] ${item}`);
    }
  } else {
    lines.push('- [ ] [Add the first task]');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(DRAFT_ONLY_FOOTER);

  return { tool: 'draft_reminder_checklist', output: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// LLM tool-calling glue: JSON-schema specs + a safe dispatcher.
// ---------------------------------------------------------------------------

/** OpenAI-compatible function/tool spec shape (kept local to avoid a dep). */
export interface ToolSpec {
  readonly type: 'function';
  readonly function: {
    readonly name: ToolName;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

/**
 * JSON-schema descriptions of the four tools, for native LLM function-calling.
 * Descriptions reinforce the draft-only contract so the model never implies a
 * send/booking happened.
 */
export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'draft_email',
      description:
        'Draft (do NOT send) a professional email. Returns formatted markdown for the operator to review. There is no send capability.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient name and/or address.' },
          subject: { type: 'string', description: 'Email subject line.' },
          body: {
            type: 'string',
            description: 'Full body text. Optional if keyPoints are given.',
          },
          keyPoints: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bullet points to expand into the body.',
          },
          cc: { type: 'string', description: 'Optional Cc recipients.' },
          from: { type: 'string', description: 'Sign-off name.' },
          tone: {
            type: 'string',
            description: 'Desired tone, e.g. professional, warm, firm.',
          },
        },
        required: ['to', 'subject'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_calendar_invite',
      description:
        'Draft (do NOT schedule) a calendar invite. Returns formatted markdown only — no calendar API or OAuth is used.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string', description: 'Date, e.g. 2026-09-24.' },
          time: { type: 'string', description: 'Time, e.g. 10:00 AM ET.' },
          durationMinutes: { type: 'number' },
          attendees: { type: 'array', items: { type: 'string' } },
          location: {
            type: 'string',
            description: 'Room or video link placeholder.',
          },
          agenda: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['title', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_travel_itinerary',
      description:
        'Draft (do NOT book) a day-by-day travel itinerary. Returns formatted markdown only — no booking or fare APIs are used.',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          purpose: { type: 'string' },
          travelers: { type: 'array', items: { type: 'string' } },
          days: {
            type: 'array',
            description: 'Optional explicit day-by-day plan.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                items: { type: 'array', items: { type: 'string' } },
              },
              required: ['items'],
            },
          },
          notes: { type: 'string' },
        },
        required: ['destination'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_reminder_checklist',
      description:
        'Draft (do NOT set) a reminder/task checklist. Returns a formatted markdown checklist only — no reminder service is called.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          due: { type: 'string' },
        },
        required: ['items'],
      },
    },
  },
];

/** Type guard: is `name` one of the four known tools? */
export function isToolName(name: string): name is ToolName {
  return (
    name === 'draft_email' ||
    name === 'draft_calendar_invite' ||
    name === 'draft_travel_itinerary' ||
    name === 'draft_reminder_checklist'
  );
}

/**
 * Safely dispatch a tool call by name with already-parsed arguments. Returns a
 * ToolResult, or null if the name is unknown. All argument access is defensive —
 * every function tolerates missing/empty fields and never throws.
 */
export function runTool(
  name: string,
  args: Record<string, unknown>,
): ToolResult | null {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : undefined;

  switch (name) {
    case 'draft_email':
      return draftEmail({
        to: str(args['to']) ?? '',
        subject: str(args['subject']) ?? '',
        body: str(args['body']),
        keyPoints: strArr(args['keyPoints']),
        cc: str(args['cc']),
        from: str(args['from']),
        tone: str(args['tone']),
      });
    case 'draft_calendar_invite':
      return draftCalendarInvite({
        title: str(args['title']) ?? '',
        date: str(args['date']) ?? '',
        time: str(args['time']),
        durationMinutes: num(args['durationMinutes']),
        attendees: strArr(args['attendees']),
        location: str(args['location']),
        agenda: strArr(args['agenda']),
        notes: str(args['notes']),
      });
    case 'draft_travel_itinerary': {
      const rawDays = args['days'];
      const days: ItineraryDay[] | undefined = Array.isArray(rawDays)
        ? rawDays
            .filter(
              (d): d is Record<string, unknown> =>
                typeof d === 'object' && d !== null,
            )
            .map((d) => ({
              label: str(d['label']),
              items: strArr(d['items']) ?? [],
            }))
        : undefined;
      return draftTravelItinerary({
        destination: str(args['destination']) ?? '',
        startDate: str(args['startDate']),
        endDate: str(args['endDate']),
        purpose: str(args['purpose']),
        travelers: strArr(args['travelers']),
        ...(days ? { days } : {}),
        notes: str(args['notes']),
      });
    }
    case 'draft_reminder_checklist':
      return draftReminderChecklist({
        title: str(args['title']) ?? '',
        items: strArr(args['items']) ?? [],
        due: str(args['due']),
      });
    default:
      return null;
  }
}
