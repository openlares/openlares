import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listProjects, createProjectWithDefaults, createProjectFromTemplate } from '@openlares/db';

export async function GET() {
  const db = getDb();
  return NextResponse.json(listProjects(db));
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string; templateId?: string };
  if (!body.name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const db = getDb();

  if (body.templateId) {
    const result = createProjectFromTemplate(db, { name: body.name, templateId: body.templateId });
    if (!result) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json(result.project, { status: 201 });
  }

  const { project } = createProjectWithDefaults(db, { name: body.name });
  return NextResponse.json(project, { status: 201 });
}
