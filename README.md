# sql-to-flint

🪄 **sql-to-flint** is the SQL-native front door to
[Flint](https://microsoft.github.io/flint-chart/): annotate a SQL result set
and get a portable chart spec, compiled options for any backend, and
BI-grade diagnostics.

Flint owns visualization complexity — 52 chart types across 5 rendering
backends (Vega-Lite, ECharts, Chart.js, Plotly, native Excel), 14 themes and
23 interaction presets. `sql-to-flint` owns the SQL-native experience:
semantic inference, the annotation grammar, and diagnostics. Together they
make the smallest possible bridge between SQL and a chart.

**Live demo:** https://aveekdeveloper.github.io/SqlFlint/

## Quick start

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

## Why SQL-based annotations

The chart definition lives inside the SQL file, as leading comments. That one
decision buys a lot:

- **Versioned as code.** Query and presentation intent in one file: git diffs,
  pull-request review, `git blame` and `git revert` cover chart changes too.
- **Built for agentic development.** An agent authors ~15-30 tokens of intent
  instead of hundreds of tokens of JSON or thousands of lines of rendering
  code. The compiler produces the spec deterministically, and diagnostics
  (`{ severity, code, message }`) close a self-correction loop without
  eyeballing rendered output.
- **Portable and lock-in free.** The SQL stays valid on any engine (comments
  are ignored), and one file compiles to ECharts, Vega-Lite, Chart.js,
  Plotly and Excel through Flint.
- **Trustworthy defaults.** Inference first: a plain query with zero
  annotations already produces a sensible chart. Annotations are overrides,
  not boilerplate. Diagnostics catch drift before anyone renders.
- **Production-grade.** Compile and snapshot specs in CI, assert on
  diagnostics, and keep a complete reproducible recipe in one file.

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

## How it works

Four stages, mirroring Flint's pipeline — but you only author the first:

1. **Describe data with semantic types.** Inferred automatically from each
   column's name and values (`YearMonth`, `Price`, `Region`, `Count`, ...).
   Override with `-- @semantic:` when inference is wrong.
2. **Build charts once, render on any backend.** The compiler turns the
   annotated SQL plus rows into one Flint spec; Flint compiles it to
   ECharts, Vega-Lite, Chart.js, Plotly or Excel.
3. **Unify the look with a theme.** Pick one of Flint's 14 presets
   (`powerbi-light`, `nyt`, `economist`, `swiss`, ...) via `-- @theme`.
4. **Add interactions.** Brush, inspect, legend toggle and 20 more presets
   through the `-- @flint:` escape hatch.

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

## Dashboards

A dashboard is also just a SQL file. `parseManifest` / `serializeManifest`
read and write one document that holds every block:

```sql
-- @spec: 1
-- @dashboard: Revenue
-- @description: Quarterly overview
-- @grid: 12

-- @block: By month
-- @type: chart
-- @layout: 0,0,6,4
-- @connection: warehouse
-- @viz: line
-- @x: month
-- @y: revenue
SELECT month, revenue FROM sales

-- @block: Total
-- @type: metric
-- @layout: 6,0,3,3
-- @connection: warehouse
-- @metric: total
SELECT SUM(revenue) AS total FROM sales
```

```ts
import { parseManifest, serializeManifest } from 'sql-to-flint';

const { dashboard, diagnostics } = parseManifest(code, connections, savedQueries);
const canonical = serializeManifest(dashboard, connections, savedQueries);
```

- `@spec` declares the grammar version; newer documents are rejected with
  `UNSUPPORTED_SPEC`, so consumers never silently misread them.
- Block types: `chart`, `metric`, `table`, `text`. Chart annotations
  (`@viz`, `@x`, `@y`, ...) stay in the block's SQL and compile as usual.
- `@extra: {"...": ...}` round-trips fields that have no first-class
  annotation. (`@x` is already the chart's x-encoding.)
- Connections and saved queries resolve by name or id; `serializeManifest`
  always emits ids so output is stable.

The same operations are available from the CLI:

```bash
sqlflint manifest spec                                       # print the spec version
sqlflint manifest check dashboard.sql --connections '[...]'   # exit 1 on errors
sqlflint manifest check dashboard.sql --json                  # machine-readable
sqlflint manifest format dashboard.sql --connections '[...]'  # canonical output
```

`--connections` accepts `[{"id":1,"name":"warehouse"}]` or `{"1":"warehouse"}`.

## Use with your coding agent

Point your agent at the skill file and let it run the loop:

```
Read the sql-to-flint chart authoring skill in this repository:
agent-skills/sql-to-flint-author/SKILL.md

Chart this SQL: <paste your query>. Compile it, fix any diagnostics,
then render with ECharts and show me the result.
```

The skill teaches the grammar, the compile-diagnose-adjust loop and the
anti-patterns (never hand-write rendering code when annotations suffice). If
`sql-to-flint` is installed as a dependency, the same skill ships inside the
package at `node_modules/sql-to-flint/agent-skills/sql-to-flint-author/SKILL.md`.

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
