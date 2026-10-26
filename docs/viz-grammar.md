# sql-to-flint viz grammar

This page documents the annotation grammar that `sql-to-flint` reads from the
leading comments of a SQL query. Annotations are the only input the compiler
needs beyond the query result rows.

## Format

Annotations are leading SQL comments of the form `-- @key: value`. Parsing stops
at the first non-comment, non-blank line, so the SQL body is never touched.

```sql
-- @viz: bar
-- @x: month
-- @y: revenue
-- @groupby: region
SELECT month, region, SUM(revenue) AS revenue
FROM orders
GROUP BY month, region;
```

Keys are case-insensitive. Unknown keys are ignored, so you can keep your own
comments in the same block.

## Chart type (`@viz`)

Accepted shorthands: `bar`, `line`, `area`, `scatter`, `pie`, `heatmap`.
Aliases: `column`/`columns`/`bars` → bar, `lines`/`timeseries` → line,
`points` → scatter, `donut` → pie, `heat` → heatmap.

If `@viz` is omitted, the compiler infers the chart type from the data: a
temporal x-axis gives a line chart, otherwise a bar chart.

Any other value is matched against Flint's template registry (37 ECharts / 39
Vega-Lite templates), so you can write `-- @viz: waterfall`, `-- @viz: gauge`,
`-- @viz: sankey diagram`, etc. and get the matching Flint chart type.

## Encodings

| Annotation | Channel | Notes |
|------------|---------|-------|
| `@x` | x | Category or measure on the x axis |
| `@y` | y | Measure on the y axis |
| `@groupby` / `@series` | color | Series / legend column |
| `@value` | color (heatmap) | Measure column for heatmap colour |
| `@z` / `@size` | size | Bubble / pie size |

If an annotation references a column that is not in the query result, the
compiler emits a `MISSING_COLUMN` error and skips that annotation. If no
annotations are given, the compiler infers encodings from column profiles:
temporal columns become x, the first measure becomes y, and the first
categorical becomes the series.

## Aggregation

| Annotation | Values | Default |
|------------|--------|---------|
| `@aggregate` | `sum`, `avg`, `min`, `max`, `count`, `first` | `sum` |

Aggregation applies when the same key (x + series) appears more than once in
the data: duplicate cells are summed and a `DUPLICATE_CELLS` warning is
emitted. Prefer aggregating in SQL with `GROUP BY`; the compiler keeps this as
a safety net.

## Layout and stacking

| Annotation | Values | Notes |
|------------|--------|-------|
| `@stack` | `true`, `false`, or a stack name | `true` stacks into one bar; a name groups stacks |
| `@zoom` | `inside`, `slider` (comma-separated) | Adds ECharts dataZoom |

## Presentation

| Annotation | Notes |
|------------|-------|
| `@title` | Chart headline |
| `@subtitle` | Deck / description |
| `@theme` | A Flint theme preset id (`powerbi-light`, `nyt`, `economist`, …) |
| `@echarts_override` | JSON object deep-merged into the ECharts output |

## Semantic types

Flint's power comes from semantic types (`YearMonth`, `Price`, `Percentage`,
…). `sql-to-flint` infers one for every column from its name and values. Override
with:

```sql
-- @semantic: revenue: Price, month: YearMonth
```

Unknown types produce an `UNKNOWN_SEMANTIC_TYPE` warning and fall back to the
inferred type.

## Escape hatch

For anything the annotations cannot express (interactions, advanced chart
properties, custom encodings), pass a partial Flint spec:

```sql
-- @flint: {"chart_spec":{"title":"Custom title"},"interaction_spec":{"interactions":[{"type":"brush-x"}]}}
```

It is deep-merged over the generated spec, so inferred fields are preserved.

## Diagnostics

Every compile returns a `diagnostics` array. Codes you may see:

- `MISSING_COLUMN` (error) — an annotation references an unknown column
- `NO_DATA` (error) — the query returned no rows
- `NO_MEASURE` (error) — no numeric column found
- `CHART_TYPE_UNKNOWN` (error) — `@viz` could not be resolved
- `HEATMAP_NEEDS_DIMENSIONS` (error) — heatmap needs two category columns
- `DUPLICATE_CELLS` (warning) — duplicate key cells were summed
- `PIE_NEGATIVE` (warning) — pie chart with negative values
- `PIE_TOO_MANY_SLICES` (warning) — more than 8 slices
- `STACKED_MIXED_SIGNS` (warning) — stacking positive and negative values
- `ID_AS_SERIES` (warning) — near-unique column used as a series
- `TEMPORAL_AS_MEASURE` (warning) — temporal column used as the measure
- `MEASURE_AS_X` (warning) — measure used on the category axis
- `HIGH_CARDINALITY_X` (info) — more than 30 categories on x
- `DEFAULT_ENCODINGS` (info) — encodings were inferred with no annotations
- `UNKNOWN_THEME`, `UNKNOWN_SEMANTIC_TYPE`, `INVALID_FLINT_OVERRIDE` (warning)

## Output

`compileSqlToFlint` returns:

```ts
{
  flint: FlintChartSpec,        // portable Flint spec
  echarts: EChartsOption | null, // compiled ECharts options (default backend)
  compiled: { echarts?, vegalite?, chartjs?, plotly? },
  diagnostics: Diagnostic[],
}
```

Pass `backends: ['echarts', 'vegalite', 'chartjs', 'plotly']` (or `backend`)
to compile to the backends you need. Flint owns visualization complexity;
`sql-to-flint` owns the SQL-native experience, semantic inference and
diagnostics.
