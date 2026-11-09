"use client";

import { useState } from "react";

import { HarborError, harborFetch, usePoll } from "@/components/api";
import { ErrorNote, PageIntro } from "@/components/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCtDate } from "@/lib/time";

type Row = {
  name: string;
  vendor: string;
  section: "runtime" | "build";
  installed: string | null;
  supported: string;
  latest: string;
  status: "current" | "behind" | "ahead" | "missing" | "held";
  note: string;
};

type Report = {
  checkedAt: string;
  node: string;
  apply: { enabled: boolean; reason: string };
  warning: string | null;
  components: Row[];
};

const STATUS = {
  current: { label: "Current", className: "text-good" },
  behind: { label: "Behind", className: "text-wait" },
  ahead: { label: "Ahead", className: "text-muted-foreground" },
  missing: { label: "Missing", className: "text-destructive" },
  held: { label: "Held", className: "text-muted-foreground" },
} as const;

export default function ComponentsPage() {
  const { data, error, loading, reload } = usePoll<Report>("/api/components", 0);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"check" | "update" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const view = report ?? data;
  const behind = view?.components.filter((row) => row.status === "behind" || row.status === "missing").length ?? 0;
  const held = view?.components.filter((row) => row.status === "held").length ?? 0;

  async function check() {
    setBusy("check");
    setFormError(null);
    setNotice(null);
    try {
      setReport(await harborFetch<Report>("/api/components?refresh=1"));
    } catch (caught) {
      setFormError(caught instanceof HarborError ? caught.message : "Could not check the registries.");
    } finally {
      setBusy(null);
    }
  }

  async function update() {
    setConfirming(false);
    setBusy("update");
    setFormError(null);
    setNotice(null);
    try {
      const next = await harborFetch<Report>("/api/components/update", { method: "POST" });
      setReport(next);
      const remaining = next.components.filter((row) => row.status === "behind" || row.status === "missing").length;
      setNotice(
        remaining === 0
          ? "Every component is on the latest supported release."
          : "Harbor installed the supported releases it could. Check the rows that are still behind.",
      );
      await reload();
    } catch (caught) {
      setFormError(caught instanceof HarborError ? caught.message : "Could not update components.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <PageIntro kicker="Next, React, and the rest of the build" title="Components">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void check()} disabled={busy !== null}>
            {busy === "check" ? "Checking…" : "Check again"}
          </Button>
          {view?.apply.enabled ? (
            <Button onClick={() => setConfirming(true)} disabled={busy !== null || behind === 0}>
              {busy === "update" ? "Updating…" : "Update all"}
            </Button>
          ) : null}
        </div>
      </PageIntro>
      <p className="mb-6 max-w-3xl text-sm leading-6 text-muted-foreground">
        Harbor asks the npm registry for each vendor’s latest stable release, then keeps the newest version the rest of
        this set still supports. Next.js and its ESLint config stay on a release both packages publish. A newer
        TypeScript than the Next.js lint stack accepts stays listed as the vendor latest, and the install stops at the
        newest release that stack allows.
      </p>
      {error && !view ? <ErrorNote>{error.message}</ErrorNote> : null}
      {formError ? <ErrorNote>{formError}</ErrorNote> : null}
      {view?.warning ? <p className="mb-4 text-sm text-wait">{view.warning}</p> : null}
      {notice ? (
        <p className="mb-4 rounded-xl border border-good/40 bg-good/10 px-4 py-3 text-sm text-good">{notice}</p>
      ) : null}
      {view && !view.apply.enabled ? (
        <p className="mb-4 rounded-xl border border-border bg-card/80 px-4 py-3 text-sm text-muted-foreground">
          {view.apply.reason}
        </p>
      ) : null}
      {loading && !view ? <p className="text-sm text-muted-foreground">Asking the registries…</p> : null}
      {view ? (
        <>
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-muted-foreground">
            <span>
              {behind === 0 && held === 0
                ? "All on the latest stable release"
                : [behind > 0 ? `${behind} behind` : null, held > 0 ? `${held} held` : null].filter(Boolean).join(" · ")}
            </span>
            <span>Node {view.node}</span>
            <span>Checked {formatCtDate(view.checkedAt)}</span>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/80">
            {view.components.map((row) => (
              <li key={row.name} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_7rem_7rem_7rem_5rem] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.vendor} · {row.section === "runtime" ? "Runtime" : "Build"}
                  </p>
                  {row.supported !== row.latest || row.status !== "current" ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.note}</p>
                  ) : null}
                </div>
                <Version label="Installed" value={row.installed ?? "—"} />
                <Version label="Supported" value={row.supported} />
                <Version label="Vendor latest" value={row.latest} />
                <p className={`font-mono text-xs tracking-wide uppercase md:text-right ${STATUS[row.status].className}`}>
                  {STATUS[row.status].label}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update every component</DialogTitle>
            <DialogDescription>
              Harbor will install the latest supported release of each library in this checkout. The dev server may
              reload when Next.js or React changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void update()} disabled={busy !== null}>
              Install updates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Version({ label, value }: { label: string; value: string }) {
  return (
    <p className="font-mono text-xs">
      <span className="mr-2 text-muted-foreground md:hidden">{label}</span>
      <span className="hidden text-muted-foreground md:mb-1 md:block">{label}</span>
      {value}
    </p>
  );
}
