import { NextResponse } from 'next/server';
import { getGatewayClient } from '@/lib/gateway';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const client = getGatewayClient();
  if (!client) return NextResponse.json({ error: 'Not connected' }, { status: 503 });
  try {
    const result = await client.request<{ content: string }>('agents.files.get', {
      agentId: id,
      name,
    });
    return NextResponse.json({ content: result.content ?? '' });
  } catch {
    // File not found -> return empty content
    return NextResponse.json({ content: '' });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const client = getGatewayClient();
  if (!client) return NextResponse.json({ error: 'Not connected' }, { status: 503 });
  const body = (await req.json()) as { content?: string };
  if (typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  }
  try {
    await client.request('agents.files.set', { agentId: id, name, content: body.content });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
