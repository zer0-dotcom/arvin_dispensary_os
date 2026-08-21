import { NextResponse } from 'next/server';
import { loadLatestMarginScan } from '@/lib/data-loader';

export const dynamic = 'force-dynamic';

/** GET latest margin & dead-stock scan. Missing => 200 with status:'missing'. */
export async function GET(): Promise<NextResponse> {
  const result = await loadLatestMarginScan();
  if (result.status === 'error') {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result, { status: 200 });
}
