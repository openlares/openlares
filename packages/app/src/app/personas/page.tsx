import { PersonaEditor } from '@/components/personas/persona-editor';

export default function PersonasPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <h1 className="mb-6 text-xl font-semibold text-gray-100">Personas</h1>
      <PersonaEditor />
    </div>
  );
}
