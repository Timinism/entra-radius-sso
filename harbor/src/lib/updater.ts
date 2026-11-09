import semver from "semver";

export type ReleaseMeta = {
  version: string;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  enginesNode?: string;
  deprecated: boolean;
};

export type Packument = {
  name: string;
  distTags: Record<string, string>;
  versions: Record<string, ReleaseMeta>;
};

export type Hold = {
  source: string;
  range: string;
};

export type Selection = {
  name: string;
  version: string;
  latest: string;
  heldBy: Hold | null;
  nodeRange: string | null;
  pairedWith: string[];
};

type Constraint = {
  direct: string;
  target: string;
  notes: Hold[];
  ranges: string[];
};

const DEFAULT_LOCKSTEP = [
  ["react", "react-dom"],
  ["next", "eslint-config-next"],
];

export function parsePackument(raw: unknown): Packument | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.versions || typeof record.versions !== "object") return null;
  const versions: Record<string, ReleaseMeta> = {};
  for (const value of Object.values(record.versions as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const meta = value as Record<string, unknown>;
    if (typeof meta.version !== "string" || !semver.valid(meta.version)) continue;
    const engines = meta.engines && typeof meta.engines === "object" ? (meta.engines as Record<string, unknown>) : {};
    versions[meta.version] = {
      version: meta.version,
      dependencies: stringMap(meta.dependencies),
      peerDependencies: stringMap(meta.peerDependencies),
      enginesNode: typeof engines.node === "string" ? engines.node : undefined,
      deprecated: typeof meta.deprecated === "string" && meta.deprecated.length > 0,
    };
  }
  const distTags = stringMap(record["dist-tags"]);
  return { name: record.name, distTags, versions };
}

export function selectSupported(input: {
  names: string[];
  docs: Record<string, Packument>;
  extras?: Record<string, Packument>;
  nodeVersion: string;
  lockstep?: string[][];
}): Selection[] {
  const extras = input.extras ?? {};
  const lockstep = input.lockstep ?? DEFAULT_LOCKSTEP;
  const names = input.names;
  for (const name of names) {
    if (!input.docs[name]) throw new Error(`Missing registry data for ${name}.`);
  }
  const caps = new Map<string, string>();
  let selected: Record<string, string> = {};
  let lastConflict = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    selected = {};
    for (const name of names) {
      const version = highest(input.docs[name], input.nodeVersion, caps.get(name) ?? null);
      if (!version) throw new Error(`No supported release of ${name} runs on Node ${input.nodeVersion}.`);
      selected[name] = version;
    }
    const constraints = constraintsFor(selected, input.docs, extras, names, input.nodeVersion);
    const broken = constraints.find((constraint) => !fits(selected[constraint.target], constraint.ranges));
    if (!broken) {
      const aligned = alignLockstep(selected, input.docs, extras, names, input.nodeVersion, lockstep, caps);
      return names.map((name) =>
        describe(
          name,
          aligned[name],
          selected[name],
          input.docs[name],
          constraintsFor(aligned, input.docs, extras, names, input.nodeVersion),
          input.nodeVersion,
          aligned,
        ),
      );
    }
    const allowed = candidates(input.docs[broken.target], input.nodeVersion, caps.get(broken.target) ?? null)
      .filter((version) => fits(version, broken.ranges))
      .sort(semver.rcompare)[0];
    if (allowed && semver.lt(allowed, selected[broken.target])) {
      caps.set(broken.target, allowed);
      continue;
    }
    const current = selected[broken.direct];
    const lower = candidates(input.docs[broken.direct], input.nodeVersion, null)
      .filter((version) => semver.lt(version, current))
      .sort(semver.rcompare)[0];
    lastConflict = `${broken.notes.map((note) => note.source).join(", ")} asks for ${broken.target} ${broken.ranges.join(" and ")}`;
    if (!lower) throw new Error(`No supported set. ${lastConflict}.`);
    caps.set(broken.direct, lower);
    if (broken.target !== broken.direct) caps.delete(broken.target);
  }
  throw new Error(`Could not settle on a supported set of releases. ${lastConflict}`);
}

export function explain(choice: Selection, nodeVersion: string): string {
  if (choice.version === choice.latest && choice.pairedWith.length === 0) {
    return `${choice.version} is the latest stable release.`;
  }
  const parts: string[] = [];
  if (choice.nodeRange) {
    parts.push(`${choice.latest} wants Node ${choice.nodeRange}. This host runs Node ${nodeVersion}.`);
  }
  if (choice.heldBy) {
    parts.push(`${choice.latest} is newer than ${choice.heldBy.source} allows (${choice.heldBy.range}).`);
  }
  if (choice.pairedWith.length > 0) {
    parts.push(`${choice.version} is the newest release ${choice.pairedWith.join(" and ")} also publishes.`);
  }
  if (parts.length === 0) {
    return `${choice.latest} is the vendor's latest stable release. ${choice.version} is the newest one this set can run together.`;
  }
  return `${parts.join(" ")} ${choice.version} is the newest release that still fits.`;
}

function describe(
  name: string,
  version: string,
  unconstrained: string,
  doc: Packument,
  constraints: Constraint[],
  nodeVersion: string,
  aligned: Record<string, string>,
): Selection {
  const latest = latestStable(doc);
  const latestMeta = doc.versions[latest];
  const nodeRange = latestMeta && !nodeOk(latestMeta.enginesNode, nodeVersion) ? (latestMeta.enginesNode ?? null) : null;
  const blocking = constraints.find(
    (constraint) => constraint.target === name && !fits(latest, constraint.ranges) && fits(version, constraint.ranges),
  );
  const heldBy = blocking?.notes.find((note) => !safeSatisfies(latest, note.range)) ?? null;
  const pairedWith =
    version !== unconstrained
      ? Object.entries(aligned)
          .filter(([other, otherVersion]) => other !== name && otherVersion === version)
          .map(([other]) => other)
      : [];
  return {
    name,
    version,
    latest,
    heldBy: heldBy ? { source: heldBy.source, range: heldBy.range } : null,
    nodeRange,
    pairedWith,
  };
}

function alignLockstep(
  selected: Record<string, string>,
  docs: Record<string, Packument>,
  extras: Record<string, Packument>,
  names: string[],
  nodeVersion: string,
  lockstep: string[][],
  caps: Map<string, string>,
): Record<string, string> {
  const aligned = { ...selected };
  for (const group of lockstep) {
    const members = group.filter((name) => names.includes(name));
    if (members.length < 2) continue;
    const lists = members.map((name) => candidates(docs[name], nodeVersion, caps.get(name) ?? null));
    const shared = lists[0].filter((version) => lists.every((list) => list.includes(version)));
    const fitting = shared.filter((version) => {
      const trial = { ...aligned };
      for (const name of members) trial[name] = version;
      return constraintsFor(trial, docs, extras, names, nodeVersion).every((constraint) =>
        fits(trial[constraint.target], constraint.ranges),
      );
    });
    if (fitting.length === 0) continue;
    const best = fitting.sort(semver.rcompare)[0];
    for (const name of members) aligned[name] = best;
  }
  return aligned;
}

function constraintsFor(
  selected: Record<string, string>,
  docs: Record<string, Packument>,
  extras: Record<string, Packument>,
  names: string[],
  nodeVersion: string,
): Constraint[] {
  const direct = new Set(names);
  const buckets = new Map<string, { parent: string; target: string; own?: string; nested: Hold[] }>();
  const bucket = (parent: string, target: string) => {
    const key = `${parent}\0${target}`;
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: { parent: string; target: string; own?: string; nested: Hold[] } = {
      parent,
      target,
      nested: [],
    };
    buckets.set(key, created);
    return created;
  };
  for (const name of names) {
    const meta = docs[name]?.versions[selected[name]];
    if (!meta) continue;
    for (const [target, range] of Object.entries(meta.peerDependencies)) {
      if (direct.has(target) && isRange(range)) bucket(name, target).own = range;
    }
    for (const [dep, range] of Object.entries(meta.dependencies)) {
      if (!isRange(range) || direct.has(dep)) continue;
      const extra = extras[dep];
      if (!extra) continue;
      const depVersion = semver.maxSatisfying(candidates(extra, nodeVersion, null), range);
      const depMeta = depVersion ? extra.versions[depVersion] : undefined;
      if (!depMeta) continue;
      for (const [target, peerRange] of Object.entries(depMeta.peerDependencies)) {
        if (!direct.has(target) || !isRange(peerRange)) continue;
        bucket(name, target).nested.push({ source: `${name} via ${dep}`, range: peerRange });
      }
    }
  }
  const constraints: Constraint[] = [];
  for (const row of buckets.values()) {
    const pool = candidates(docs[row.target], nodeVersion, null);
    const notes: Hold[] = [];
    if (row.own) notes.push({ source: row.parent, range: row.own });
    const nested = [...row.nested].sort((a, b) => a.source.localeCompare(b.source));
    for (const note of nested) {
      const trial = [...notes, note];
      if (pool.some((version) => fits(version, trial.map((item) => item.range)))) notes.push(note);
    }
    if (notes.length === 0) continue;
    constraints.push({
      direct: row.parent,
      target: row.target,
      notes,
      ranges: notes.map((note) => note.range),
    });
  }
  return constraints;
}

function fits(version: string, ranges: string[]): boolean {
  return ranges.every((range) => safeSatisfies(version, range));
}

function safeSatisfies(version: string, range: string): boolean {
  try {
    return semver.satisfies(version, range);
  } catch {
    return false;
  }
}

function highest(doc: Packument, nodeVersion: string, cap: string | null): string | null {
  return candidates(doc, nodeVersion, cap)[0] ?? null;
}

function candidates(doc: Packument, nodeVersion: string, cap: string | null): string[] {
  const stable = Object.values(doc.versions).filter(
    (meta) => semver.valid(meta.version) === meta.version && semver.prerelease(meta.version) === null && nodeOk(meta.enginesNode, nodeVersion),
  );
  const supported = stable.filter((meta) => !meta.deprecated);
  const pool = supported.length > 0 ? supported : stable;
  return pool
    .map((meta) => meta.version)
    .filter((version) => cap === null || semver.lte(version, cap))
    .sort(semver.rcompare);
}

function latestStable(doc: Packument): string {
  const stable = Object.values(doc.versions).filter(
    (meta) => semver.valid(meta.version) === meta.version && semver.prerelease(meta.version) === null,
  );
  const supported = stable.filter((meta) => !meta.deprecated);
  const pool = (supported.length > 0 ? supported : stable).map((meta) => meta.version).sort(semver.rcompare);
  if (!pool[0]) throw new Error(`No stable release for ${doc.name}.`);
  return pool[0];
}

function nodeOk(range: string | undefined, nodeVersion: string): boolean {
  if (!range) return true;
  try {
    return semver.satisfies(nodeVersion, range);
  } catch {
    return true;
  }
}

function isRange(range: string): boolean {
  return semver.validRange(range) !== null;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}
