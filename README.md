# sql-to-flint

The smallest bridge between SQL and [Flint](https://microsoft.github.io/flint-chart/):
annotate a SQL result set and get a portable Flint chart spec, compiled options
for ECharts / Vega-Lite / Chart.js / Plotly, and BI-grade diagnostics.

Flint owns visualization complexity (52 chart types, 5 backends, 14 themes,
interactions). `sql-to-flint` owns the SQL-native experience, semantic
inference and diagnostics.

## Why SQL-based annotations

The chart definition lives inside the SQL file, as leading comments. That one
decision changes what the artifact is:

### Versioned as code

Query and presentation intent live in one file. Git diffs cover both, pull
requests review both, `git blame` answers "who changed this chart title", and
revert undoes a chart change like any other change. There is no sidecar spec
to drift out of sync with the query.

### Built for agentic development

Agents author intent, not rendering code.

- **Token cost.** An annotation block is roughly 15-30 tokens. The equivalent
  hand-written chart spec is hundreds; generated rendering code is thousands.
- **Stable diffs.** One intent change is one comment line, so agent edit loops
  and code review stay small.
- **Deterministic output.** The compiler produces the spec, so there is no
  hallucinated chart code to debug.
- **Closed feedback loop.** Diagnostics are machine-readable
  (`{ severity, code, message }`). An agent reads `MISSING_COLUMN`, fixes one
  line, and recompiles. No eyeballing rendered output to know it worked.

### Portable and lock-in free

The SQL stays valid on any engine (comments are ignored by the database), and
one file compiles to ECharts, Vega-Lite, Chart.js, Plotly and Excel through
Flint. The same file serves a notebook, a dashboard and an agent app.

### Trustworthy defaults

- **Inference first.** A plain query with zero annotations already produces a
  sensible chart. Annotations are overrides, not boilerplate.
- **Diagnostics catch drift.** Renamed a column? `MISSING_COLUMN` points at
  the stale annotation. Negative pie values, near-unique series, mixed-sign
  stacks and temporal-measure mixups are flagged before anyone renders.

### Production-grade

- **CI-testable.** Compile SQL plus a fixture in a test, snapshot the spec,
  assert on diagnostics. Charts get the same guarantees as code.
- **Reproducible.** One file is the complete recipe (data logic and
  presentation intent) for the same chart anywhere.
- **Auditable.** Chart changes go through the same review and history as code.

### How it compares

|  | Annotations (this library) | Hand-written spec | GUI-configured chart |
| --- | --- | --- | --- |
| Versioned with the data logic | same file | separate file | outside git |
| Token cost for an agent | ~15-30 | hundreds | n/a |
| Reviewable in a pull request | yes | spec diffs | no |
| Backend portability | one file, all backends | per-backend spec | vendor-specific |
| Learning curve | ~10 comment lines | full spec format | per-tool UI |
| Audit trail (blame, revert) | git | git | tool history |

### For BI leads

Chart definitions move into the same pull requests as the queries behind
them: reviewers see the intent, git records who changed it, and nothing is
locked inside a BI tool's config store.

Deep dive: [docs/why-annotations.md](./docs/why-annotations.md)

## Use with your coding agent

Point your agent at the skill file and let it run the loop:

```
Read the sql-to-flint chart authoring skill in this repository:
agent-skills/sql-to-flint-author/SKILL.md

Chart this SQL: <paste your query>. Compile it, fix any diagnostics,
then render with ECharts and show me the result.
```

The skill teaches the grammar, the compile-diagnose-adjust loop and the
anti-patterns (never hand-write rendering code when annotations suffice).

If `sql-to-flint` is installed as a dependency, the same skill ships inside
the package, so agents can read it from
`node_modules/sql-to-flint/agent-skills/sql-to-flint-author/SKILL.md`.

## Install

```bash
npm install sql-to-flint
```

## Usage

```ts
import { compileSqlToFlint } from 'sql-to-flint';

const { flint, echarts, diagnostics } = compileSqlToFlint({
  sql: `
-- @viz: bar
-- @x: month
-- @y: revenue
-- @groupby: region
-- @stack: true
-- @theme: powerbi-light
SELECT month, region, SUM(revenue) AS revenue
FROM orders
GROUP BY month, region;
  `,
  data: [
    { month: '2026-01', region: 'NA', revenue: 10 },
    { month: '2026-01', region: 'EU', revenue: 20 },
  ],
});

// flint   -> portable Flint spec
// echarts -> compiled ECharts options
```

Compile to other backends with `backends: ['vegalite', 'chartjs', 'plotly']`.

## Annotations

- `-- @viz: bar | line | area | scatter | pie | heatmap` (or any Flint template)
- `-- @x`, `-- @y`, `-- @groupby` / `-- @series`, `-- @value`
- `-- @stack: true | false | name`
- `-- @title`, `-- @subtitle`, `-- @theme`
- `-- @semantic: col: Type, ...` (override inferred semantic types)
- `-- @flint: { ... }` (deep-merged partial Flint spec escape hatch)

See [docs/viz-grammar.md](./docs/viz-grammar.md) for the full grammar.

## Semantic inference

Every column gets a Flint semantic type inferred from its name and values:
temporal (`YearMonth`, `Date`, `Quarter`, ...), measures (`Price`,
`Percentage`, `Count`, `Quantity`, ...), categoricals (`Region`, `Country`,
`Status`, `Category`, ...) and identifiers (`ID`). Override with `@semantic`.

## Diagnostics

Every compile returns `diagnostics: { severity, code, message, column? }[]`.
See the viz grammar doc for the full code list.

## Demo

```
npm run demo        # builds and copies the demo page into dist/
npx serve dist     # then open the served URL
```

Three stages: explore with SQL (DuckDB-WASM), turn SQL into a chart (theme
and backend pickers, spec/options/diagnostics views), compose a dashboard
(pinboard). Power BI light chrome.

## Docs

- [Why SQL-based annotations](./docs/why-annotations.md) - the argument, token math, agentic workflow, trade-offs
- [Viz grammar reference](./docs/viz-grammar.md) - every annotation and diagnostic
- [Agent skill](./agent-skills/sql-to-flint-author/SKILL.md) - chart authoring for coding agents

## License

MIT
