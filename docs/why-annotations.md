# Why SQL-based annotations

The claim: a chart definition belongs in the same file as the query that
produces its data, expressed as a handful of leading comment annotations. This
page expands the argument from the README - the agentic workflow, token costs,
governance, testing, and the honest trade-offs.

## The agentic loop

The compiler is deterministic and its diagnostics are machine-readable, which
turns chart authoring into a closed feedback loop instead of a
render-and-eyeball cycle:

1. Write or reuse the SQL (aggregate with `GROUP BY`). Zero annotations.
2. Compile with `compileSqlToFlint({ sql, data })`.
3. Read `diagnostics` - each item is `{ severity, code, message }`.
4. Add or adjust exactly one annotation line.
5. Recompile. Stop when diagnostics are clean and the spec matches intent.

A concrete session:

```ts
import { compileSqlToFlint } from 'sql-to-flint';

// Step 1: zero annotations - just the query
let sql = `
SELECT region, SUM(revenue) AS revenue
FROM data
GROUP BY region;
`;

let result = compileSqlToFlint({ sql, data });
// diagnostics: [{ severity: 'info', code: 'DEFAULT_ENCODINGS', ... }]
// flint.chart_spec: { chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' } }

// Step 2: the user asks for a pie - one line changes
sql = `-- @viz: pie\n${sql}`;
result = compileSqlToFlint({ sql, data });
// flint.chart_spec: { chartType: 'Pie Chart', encodings: { color: 'region', size: 'revenue' } }
```

If a column name is wrong, the agent receives `MISSING_COLUMN` with the column
name and fixes exactly one line. It never has to look at a rendered chart to
know whether the compile worked.

## Token costs (order-of-magnitude estimates)

For a typical grouped bar chart (one dimension, one measure, one series):

| Artifact | Approximate tokens |
| --- | --- |
| Annotation block (5-7 comment lines) | 15-30 |
| Equivalent minimal Flint spec (JSON) | 150-300 |
| Compiled ECharts options (output, not authored) | 400-800 |
| Agent-generated rendering code | 2,000+ |

Agents read and write the top row; the compiler produces everything below it.
Reading stays cheap too: diagnostics are short and coded, so an agent can
triage a compile in a few tokens.

## Governance

Because annotations are lines in a SQL file, ordinary git answers chart
governance questions:

- **Who changed the chart title?** `git blame` on the `-- @title:` line.
- **When did this chart become a pie?** `git log -p` on the SQL file.
- **Roll back a dashboard regression.** `git revert` the commit that touched
  the annotation block.
- **Review a chart change.** The pull request diff shows the intent change
  next to the query change that motivated it:

```diff
--- a/charts/regional_revenue.sql
+++ b/charts/regional_revenue.sql
@@ -1,4 +1,4 @@
--- @viz: bar
+-- @viz: pie
 -- @x: region
 -- @y: revenue
```

(Removed annotation lines read as `--- @viz` because the annotations
themselves start with `--`.)

## Testing in CI

Treat chart definitions like code:

```ts
import { describe, expect, it } from 'vitest';
import { compileSqlToFlint } from 'sql-to-flint';

it('regional revenue compiles cleanly as a bar chart', () => {
  const sql = `
-- @viz: bar
-- @x: region
-- @y: revenue
SELECT region, SUM(revenue) AS revenue FROM data GROUP BY region;
`;
  const { flint, diagnostics } = compileSqlToFlint({ sql, data: fixture });

  expect(flint.chart_spec.chartType).toBe('Bar Chart');
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
});
```

Snapshot the spec if you want byte-stable output. The compiler is
deterministic: identical input produces identical specs.

## Honest trade-offs

- **Expressiveness ceiling.** Comments cannot express everything Flint can.
  The `-- @flint: { ... }` hatch deep-merges a partial spec for the rest - and
  at that point you are deliberately writing a spec, which is fine.
- **Aggregation belongs in SQL.** The compiler sums duplicate key cells but
  always says so (`DUPLICATE_CELLS`). `GROUP BY` is the source of truth.
- **Comments can be stripped.** Some SQL proxies and BI tools strip comments
  before execution. If your pipeline does, keep the annotated SQL as the
  source and strip only at execution time.
- **Inference is heuristic.** Names and values drive it; the long tail will be
  wrong sometimes. `-- @semantic:` overrides exist for exactly that.

## Related

- [Viz grammar reference](./viz-grammar.md)
- [Agent skill](../agent-skills/sql-to-flint-author/SKILL.md)
- [Demo](../demo/index.html)
