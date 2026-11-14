/** Temporary page body until the real content lands (Phase 3 and later). */
export function PagePlaceholder({ title, lead, note }: { title: string; lead?: string; note: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight text-forest-900 sm:text-4xl">{title}</h1>
      {lead !== undefined && <p className="mt-4 text-lg leading-relaxed">{lead}</p>}
      <p className="mt-8 rounded-md border border-sand-300 bg-sand-100 px-4 py-3 text-ink-muted">{note}</p>
    </div>
  );
}
