"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { HarborError, harborFetch, usePoll } from "@/components/api";
import { AttrTable, ErrorNote, ResultText, VendorMark } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { formatCt } from "@/lib/time";

type Approval = {
  id: string;
  username: string;
  deviceName: string;
  vendor: "cisco" | "paloalto";
  os: string;
  service: string;
  status: string;
  expiresAt: string;
  signedInUpn: string | null;
  groups: string[];
  method: string | null;
  denyReason: string | null;
  result: { code: string; reason: string; attributes: { name: string; value: string; id: string }[]; policyName: string | null } | null;
};

type Directory = {
  users: { id: string; upn: string; displayName: string; groups: string[]; emergency: boolean }[];
  settings: { mode: "entra" | "sample" };
};

const ERRORS: Record<string, string> = {
  entra: "Microsoft did not complete the sign-in. Check the redirect URI, the client secret, and admin consent for group reads.",
  mismatch: "The Microsoft account did not match the username the device sent.",
  verify: "Harbor could not verify the Microsoft token.",
  state: "That sign-in attempt expired. Start it again from this page.",
  config: "Entra is not connected yet. Harbor is still on the sample directory.",
  groups: "Microsoft signed the person in, but returned no groups to match a policy.",
};

export default function ApprovalPage() {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-sm text-muted-foreground">Loading sign-in…</p>}>
      <ApprovalView />
    </Suspense>
  );
}

function ApprovalView() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params.id;
  const { data, error, reload } = usePoll<{ approval: Approval }>(id ? `/api/approvals/${id}` : null, 1000);
  const directory = usePoll<Directory>("/api/directory", 0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const approval = data?.approval;
  const [now, setNow] = useState(() => Date.now());
  const code = search.get("error");
  const notice = code && ERRORS[code] ? ERRORS[code] : null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!approval || approval.status !== "pending") return;
    if (Date.parse(approval.expiresAt) > Date.now()) return;
    void harborFetch(`/api/approvals/${approval.id}/expire`, { method: "POST" }).then(() => reload());
  }, [approval, now, reload]);

  const left = approval ? Math.max(0, Date.parse(approval.expiresAt) - now) : 0;
  const seconds = Math.ceil(left / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const match = directory.data?.users.find(
    (user) => !user.emergency && user.upn.toLowerCase().split("@")[0] === approval?.username.toLowerCase().split("@")[0]?.split("\\").pop(),
  );

  async function run(path: string, body?: object) {
    if (!approval) return;
    setBusy(true);
    setActionError(null);
    try {
      await harborFetch(path, { method: "POST", body: body ? JSON.stringify(body) : "{}" });
      await reload();
    } catch (caught) {
      setActionError(caught instanceof HarborError ? caught.message : "Could not update the sign-in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <Link href="/approvals" className="text-sm text-muted-foreground hover:text-foreground">
        All approvals
      </Link>
      {error ? <div className="mt-4"><ErrorNote>{error.message}</ErrorNote></div> : null}
      {!approval && !error ? <p className="mt-8 text-sm text-muted-foreground">Loading this sign-in…</p> : null}
      {approval ? (
        <article className="mt-4 rounded-2xl bg-card ring-1 ring-foreground/10 p-5 md:p-8">
          <div className="flex items-center gap-3">
            <VendorMark vendor={approval.vendor} />
            <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
              {approval.service === "globalprotect" ? "GlobalProtect" : approval.os === "panorama" ? "Panorama admin" : "Device admin"}
            </p>
          </div>
          <h1 className="mt-4 font-display text-4xl tracking-tight md:text-5xl">{approval.deviceName}</h1>
          <p className="mt-2 text-lg">
            wants to log in as <span className="font-mono">{approval.username}</span>
          </p>
          {approval.status === "pending" ? (
            <p className="mt-4 font-mono text-3xl tabular-nums text-wait">{clock}</p>
          ) : (
            <div className="mt-4">
              <ResultText result={approval.result?.code ?? approval.status} />
            </div>
          )}
          {notice ? <p className="mt-4 text-sm text-destructive">{notice}</p> : null}
          {actionError ? <p className="mt-4 text-sm text-destructive">{actionError}</p> : null}
          {approval.status === "pending" && directory.data?.settings.mode !== "entra" ? (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" disabled={!match || busy} onClick={() => match && run(`/api/approvals/${approval.id}/sample`, { userId: match.id })}>
                {match ? `Sign in as ${match.displayName}` : "No sample account matches this username"}
              </Button>
              <Button size="lg" variant="outline" disabled={busy} onClick={() => run(`/api/approvals/${approval.id}/deny`)}>
                Deny
              </Button>
            </div>
          ) : null}
          {approval.status === "pending" && directory.data?.settings.mode === "entra" ? (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" render={<a href={`/api/entra/start?approval=${approval.id}`} />}>
                Sign in with Microsoft
              </Button>
              <Button size="lg" variant="outline" disabled={busy} onClick={() => run(`/api/approvals/${approval.id}/deny`)}>
                Deny
              </Button>
            </div>
          ) : null}
          {match && approval.status === "pending" && directory.data?.settings.mode !== "entra" ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Sample groups: {match.groups.join(", ")}. This does not contact Microsoft.
            </p>
          ) : null}
          {approval.result ? (
            <div className="mt-8">
              <h2 className="font-display text-2xl">RADIUS reply</h2>
              <p className="mt-1 text-sm text-muted-foreground">{approval.result.reason}</p>
              {approval.signedInUpn ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {approval.signedInUpn} · {approval.method} · {formatCt(approval.expiresAt)}
                </p>
              ) : null}
              <div className="mt-3">
                <AttrTable rows={approval.result.attributes} />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                If the CLI is still waiting, it continues on its own once this reply is on the wire.
              </p>
            </div>
          ) : null}
        </article>
      ) : null}
    </main>
  );
}
