import { NextResponse } from 'next/server';
import { loadLatestSweep } from '@/lib/data-loader';

export const dynamic = 'force-dynamic';

/** GET latest competitor sweep. Missing => 200 with status:'missing'. */
export async function GET(): Promise<NextResponse> {
  const result = await loadLatestSweep();
  if (result.status === 'error') {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result, { status: 200 });
}
