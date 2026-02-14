export default function Home() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-800 bg-gray-900 p-4">
        <h1 className="mb-6 text-xl font-bold tracking-tight">
          <span className="text-amber-400">Open</span>Lares
        </h1>
        <nav className="flex flex-col gap-2 text-sm text-gray-400">
          <span className="rounded px-2 py-1 bg-gray-800 text-gray-100">Dashboard</span>
          <span className="rounded px-2 py-1 hover:bg-gray-800">Personality</span>
          <span className="rounded px-2 py-1 hover:bg-gray-800">Activity</span>
          <span className="rounded px-2 py-1 hover:bg-gray-800">Settings</span>
        </nav>
        <div className="mt-auto">
          <ConnectionStatus />
        </div>
      </aside>

      {/* Main canvas area */}
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-dashed border-gray-700">
            <span className="text-4xl">🏛️</span>
          </div>
          <p className="text-lg text-gray-400">Avatar canvas goes here</p>
          <p className="mt-1 text-sm text-gray-600">PixiJS will render in this area</p>
        </div>
      </main>

      {/* Activity panel */}
      <aside className="flex w-80 flex-col border-l border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Activity
        </h2>
        <div className="flex flex-1 items-center justify-center text-sm text-gray-600">
          No activity yet — connect to a Gateway
        </div>
      </aside>
    </div>
  );
}

function ConnectionStatus() {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-2 w-2 rounded-full bg-red-500" />
      <span className="text-gray-500">Disconnected</span>
    </div>
  );
}
