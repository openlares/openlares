import { NextResponse } from 'next/server';
import { getGatewayClient } from '@/lib/gateway';

export async function GET() {
  const client = getGatewayClient();
  if (!client) return NextResponse.json({ error: 'Not connected to gateway' }, { status: 503 });
  try {
    const result = await client.request<{ agents?: { agentId: string; name?: string }[] }>(
      'agents.list',
      {},
    );
    return NextResponse.json(result.agents ?? []);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
