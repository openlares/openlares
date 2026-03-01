'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Project } from '@/components/tasks/types';

interface ProjectWithStats extends Project {
  totalTasks: number;
  queueCount: number;
}

interface ProjectsGridProps {
  initialProjects: ProjectWithStats[];
}

export function ProjectsGrid({ initialProjects }: ProjectsGridProps) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const refreshProjects = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const created = (await res.json()) as Project;
        setNewName('');
        setShowNewForm(false);
        router.push(`/projects/${created.id}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePin = async (e: React.MouseEvent, project: ProjectWithStats) => {
    e.stopPropagation();
    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: !project.pinned }),
    });
    if (res.ok) {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, pinned: !p.pinned } : p)),
      );
      refreshProjects();
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">
          <span className="text-amber-400">Projects</span>
        </h1>
        <button
          onClick={() => setShowNewForm(true)}
          className="rounded bg-amber-400 px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-amber-300"
        >
          + New Project
        </button>
      </div>

      {showNewForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-100">New Project</h2>
            <form onSubmit={handleCreateProject} className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Project name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 placeholder-gray-500 outline-none focus:border-amber-400"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="flex-1 rounded bg-amber-400 py-2 text-sm font-medium text-gray-900 hover:bg-amber-300 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewForm(false);
                    setNewName('');
                  }}
                  className="flex-1 rounded border border-gray-700 py-2 text-sm text-gray-400 hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-4 text-gray-500">
          <div className="text-5xl">&#x1F4CB;</div>
          <p className="text-lg">No projects yet</p>
          <p className="text-sm">Create your first project to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => router.push(`/projects/${project.id}`)}
              className="group relative flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900 p-5 text-left transition-colors hover:border-gray-700 hover:bg-gray-800"
            >
              <button
                onClick={(e) => handleTogglePin(e, project)}
                className={`absolute right-4 top-4 text-lg transition-opacity ${
                  project.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
                }`}
                title={project.pinned ? 'Unpin project' : 'Pin project'}
              >
                &#x1F4CC;
              </button>

              <div className="pr-8">
                <h2 className="font-semibold text-gray-100">{project.name}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {project.totalTasks} task{project.totalTasks !== 1 ? 's' : ''} &#xB7;{' '}
                  {project.queueCount} queue{project.queueCount !== 1 ? 's' : ''}
                </p>
              </div>

              {project.lastAccessedAt && (
                <p className="text-xs text-gray-600">
                  Last visited{' '}
                  {new Date(project.lastAccessedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
