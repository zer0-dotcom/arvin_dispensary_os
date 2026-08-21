import { NextResponse } from 'next/server';
import { loadLatestDossier } from '@/lib/data-loader';

// Always read fresh from disk — artifacts change out-of-band.
export const dynamic = 'force-dynamic';

/**
 * GET latest weekly dossier.
 * Returns 200 for ok AND missing (missing is a valid, non-error state — see
 * directive §8.3). Only a parse/error returns a 500.
 */
export async function GET(): Promise<NextResponse> {
  const result = await loadLatestDossier();
  if (result.status === 'error') {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result, { status: 200 });
}
