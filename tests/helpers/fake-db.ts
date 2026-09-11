/**
 * Shared in-memory fake for the Drizzle `getDb()` surface — lets DB-backed
 * tests run with ZERO database (no live Neon, never prod).
 *
 * Supports the query shapes the app uses:
 *  - db.select().from(t).where(cond).limit(n) / .orderBy(...)   (awaitable)
 *  - db.insert(t).values(row|rows).onConflictDoNothing(...).returning(...)
 *  - db.insert(t).values(rows) plain await (throws on duplicate PK)
 *  - db.update(t).set({...}).where(cond)
 *  - db.delete(t).where(cond)
 *
 * `where(cond)` accepts REAL drizzle conditions (from drizzle-orm's eq/and):
 * constraints are extracted by walking the SQL chunk tree (Column nodes have
 * `.name` + `.table`; Param nodes carry a primitive `.value`).
 */

type Row = Record<string, unknown>;
type EqCond = Row | null;

const norm = (k: string) => k.replace(/_/g, "").toLowerCase();

function matches(row: Row, cond: EqCond): boolean {
  if (!cond) return true;
  const normRow: Row = {};
  for (const [k, v] of Object.entries(row)) normRow[norm(k)] = v;
  return Object.entries(cond).every(([k, v]) => normRow[norm(k)] === v);
}

/**
 * Extract column=value constraints from a REAL drizzle where() condition.
 * Chunk tree for `and(eq(col1, v1), eq(col2, v2))`:
 *   root SQL → queryChunks [StringChunk, eq-SQL, StringChunk, eq-SQL, ...]
 *   eq-SQL  → queryChunks [StringChunk, Column(.name,.table), StringChunk, Param(.value), ...]
 * Column nodes: `.name` string + `.table` object. Param nodes: primitive `.value`.
 * Pair columns with params in encounter order. Returns null → match-all.
 */
function constraintsFromDrizzle(w: unknown): EqCond {
  if (!w || typeof w !== "object") return null;
  const columns: string[] = [];
  const values: unknown[] = [];

  function walk(node: unknown, depth: number): void {
    if (!node || typeof node !== "object" || depth > 8) return;
    const o = node as Record<string, unknown>;
    // Column node: string .name + .table object
    if (typeof o.name === "string" && o.table) columns.push(o.name);
    // Param node: has an encoder; StringChunk nodes also have .value but are
    // raw SQL text fragments (" = "), so exclude them.
    if ("value" in o && "encoder" in o) {
      const v = o.value;
      if (typeof v !== "object" || v === null) values.push(v);
      else if (v instanceof Date) values.push(v);
      else if (Array.isArray(v)) values.push(v);
    }
    if (Array.isArray(o.queryChunks)) for (const c of o.queryChunks) walk(c, depth + 1);
  }

  walk(w, 0);
  if (!columns.length) return null;
  const out: Row = {};
  for (let i = 0; i < Math.min(columns.length, values.length); i++) {
    out[columns[i]] = values[i];
  }
  return out;
}

export interface FakeDbState {
  [table: string]: Row[];
}

export function makeDbMock(state: FakeDbState) {
  function table(name: string): Row[] {
    return (state[name] ??= []);
  }

  function tableNameOf(t: object | string): string {
    if (typeof t === "string") return t;
    const sym = Object.getOwnPropertySymbols(t).find(
      (s) => String(s) === "Symbol(drizzle:Name)"
    );
    return sym ? String((t as Record<PropertyKey, unknown>)[sym]) : String(t);
  }

  /** Build the query surface bound to one table. */
  function target(name: string) {
    const pkOf = (v: Row): string[] =>
      "scope" in v && "key" in v ? ["scope", "key"] : ["id"];

    const select = () => {
      const runFiltered = (cond: EqCond) => {
        const filtered = cond ? table(name).filter((r) => matches(r, cond)) : table(name);
        return {
          limit: async (n: number) => filtered.slice(0, n),
          orderBy: async () => filtered,
          then: (res: any, rej: any) => Promise.resolve(filtered).then(res, rej),
        };
      };
      return {
        from: () => ({
          where: (w: unknown) => runFiltered(constraintsFromDrizzle(w)),
          limit: async (_n: number) => table(name),
          orderBy: async () => table(name),
          then: (res: any, rej: any) => Promise.resolve(table(name)).then(res, rej),
        }),
      };
    };

    return {
      select,
      insert: () => ({
        values: (vals: Row | Row[]) => {
          const list = Array.isArray(vals) ? vals : [vals];
          const exec = async () => {
            const inserted: Row[] = [];
            for (const v of list) {
              // PK semantics: (scope, key) for idempotency_keys, id elsewhere.
              const pkCols = "scope" in v && "key" in v ? ["scope", "key"] : ["id"];
              const dup = table(name).some((r) =>
                pkCols.every((k) => k in v && r[k] === v[k])
              );
              if (dup) continue;
              table(name).push({ ...v });
              inserted.push({ ...v });
            }
            return inserted;
          };
          return {
            onConflictDoNothing: () => {
              const executed = exec(); // fire immediately like real Drizzle
              return {
                returning: async () => executed,
                then: (res: any, rej: any) => executed.then(res, rej),
              };
            },
            // plain await db.insert(t).values(v) → execute; duplicate PK throws
            then: (res: any, rej: any) =>
              exec()
                .then((rows) => {
                  if (rows.length < list.length) {
                    return Promise.reject(
                      Object.assign(
                        new Error("duplicate key value violates unique constraint"),
                        { code: "23505" }
                      )
                    );
                  }
                  return Promise.resolve(rows);
                })
                .then(res, rej),
          };
        },
      }),
      update: () => ({
        set: (set: Row) => ({
          where: async (w: unknown) => {
            const cond = constraintsFromDrizzle(w);
            for (const r of table(name)) {
              if (matches(r, cond)) Object.assign(r, set);
            }
          },
        }),
      }),
      delete: () => ({
        where: async (w: unknown) => {
          const cond = constraintsFromDrizzle(w);
          state[name] = table(name).filter((r) => !matches(r, cond));
        },
      }),
    };
  }

  return {
    getDb: () => ({
      select: () => ({
        from: (t: object | string) => target(tableNameOf(t)).select().from(),
      }),
      insert: (t: object | string) => target(tableNameOf(t)).insert(),
      update: (t: object | string) => target(tableNameOf(t)).update(),
      delete: (t: object | string) => target(tableNameOf(t)).delete(),
      /**
       * Batch of pre-built Drizzle query builders (as passed to db.batch()).
       * Each entry is one of the thenable/async objects produced by
       * insert/update/delete above; executing them in sequence matches the
       * real driver's semantics closely enough for tests (the real Neon HTTP
       * driver wraps a batch in one non-interactive transaction; we don't
       * model rollback because the fakes' operations can't fail halfway).
       */
      batch: async (queries: unknown[]) => {
        const results: unknown[] = [];
        for (const q of queries) {
          results.push(await q);
        }
        return results;
      },
    }),
  };
}
