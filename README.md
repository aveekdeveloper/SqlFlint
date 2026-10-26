# sql-to-flint

The smallest bridge between SQL and [Flint](https://microsoft.github.io/flint-chart/):
annotate a SQL result set and get a portable Flint chart spec, compiled options
for ECharts / Vega-Lite / Chart.js / Plotly, and BI-grade diagnostics.

Flint owns visualization complexity (52 chart types, 5 backends, 14 themes,
interactions). `sql-to-flint` owns the SQL-native experience, semantic
inference and diagnostics.

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

// flint  -> portable Flint spec
// echarts -> compiled ECharts options
```

Compile to other backends with `backends: ['vegalite', 'chartjs', 'plotly']`.

## Annotations

See [docs/viz-grammar.md](./docs/viz-grammar.md) for the full grammar.

- `-- @viz: bar | line | area | scatter | pie | heatmap` (or any Flint template)
- `-- @x`, `-- @y`, `-- @groupby` / `-- @series`, `-- @value`, `-- @size`
- `-- @aggregate: sum | avg | min | max | count | first`
- `-- @stack: true | false | name`, `-- @zoom: inside,slider`
- `-- @title`, `-- @subtitle`, `-- @theme`, `-- @echarts_override`
- `-- @semantic: col: Type, ...` (override inferred semantic types)
- `-- @flint: { ... }` (deep-merged partial Flint spec escape hatch)

## Semantic inference

Every column gets a Flint semantic type inferred from its name and values:
temporal (`YearMonth`, `Date`, `Quarter`, …), measures (`Price`, `Percentage`,
`Count`, `Quantity`, …), categoricals (`Region`, `Country`, `Status`,
`Category`, …), identifiers (`ID`). Override with `@semantic`.

## Diagnostics

Every compile returns `diagnostics: { severity, code, message, column? }[]`.
See the viz grammar doc for the full code list.

## Demo

Run the demo locally by serving the `demo/` directory after `npm run build`
(the demo imports `./compiler.js` from the build output). The live demo uses
DuckDB-WASM for in-browser SQL and ships a Power BI light chrome with a
theme picker and a dashboard pinboard.

## License

MIT
