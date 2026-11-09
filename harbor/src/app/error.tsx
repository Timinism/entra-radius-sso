"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-serif text-4xl">Harbor could not draw this page</h1>
      <p className="mt-3 text-sm text-muted-foreground">The directory is still there. Try the page again.</p>
      <button type="button" className="mt-4 text-sm underline" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
