/**
 * Oxygen and MiniOxygen have no `process` global, and dependencies often read `process.env.X` or
 * `process.platform` while they load. The Worker entry imports this module first, so it runs before
 * any dependency evaluates, in dev as well as in the production bundle (which also gets a banner).
 * Listed in `package.json#sideEffects` so bundlers keep the bare import.
 */
const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
g.process ??= {};
g.process.env ??= {};

export {};
