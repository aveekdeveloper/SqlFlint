---
name: sql-to-flint-author
description: Author charts from SQL using sql-to-flint annotations. Use when the user wants a chart or visualization from SQL or tabular data, or wants to change an existing chart's type, axes, series, stacking, or theme. Covers the annotation grammar and the compile-diagnose-adjust loop.
---

# sql-to-flint chart authoring

Produce charts by writing SQL plus a few leading comment annotations, then
compile with `compileSqlToFlint`. Never write rendering code by hand.

## When to use

- The user wants a chart from SQL or from rows of data.
- The user wants to change an existing annotated query's chart type, axes,
  series, stacking, or theme.

Not for pixel-perfect bespoke visuals (custom D3, animation); this path covers
standard chart types across ECharts, Vega-Lite, Chart.js, Plotly and Excel via
Flint.

## The loop

1. Start with zero annotations. Write or reuse the SQL; aggregate with
   `GROUP BY`.
2. Compile: `compileSqlToFlint({ sql, data })` returns
   `{ flint, echarts, compiled, diagnostics }`.
3. Read `diagnostics` (each item is `{ severity, code, message }`).
4. Add or adjust exactly one annotation line to fix errors or match intent.
5. Recompile. Stop when diagnostics are clean and the spec matches intent.
6. Render `compiled.echarts` (or the requested backend) with the matching
   renderer.

## Grammar (leading comments in the SQL)

```
-- @viz: bar | line | area | scatter | pie   (shorthands; heatmap also works)
-- @x: category_or_date_column
-- @y: measure_column
-- @groupby: series_column          (-- @series also works)
-- @value: measure_column           (heatmap colour measure)
-- @stack: true | false | name
-- @title: Chart headline          (also @subtitle)
-- @theme: preset id               (powerbi-light, nyt, economist, swiss, ...)
-- @semantic: col: FlintType       (override inferred types)
-- @flint: { partial spec JSON }   (deep-merged escape hatch)
```

Any other `@viz` value fuzzy-matches a Flint template name: waterfall, gauge,
sankey diagram, treemap, and the rest of the 52 chart types.

## Decision rules

- Aggregate in SQL (`GROUP BY`), not with annotations.
- Trust semantic inference (column names and values map to Flint types); add
  `-- @semantic:` only when inference is wrong.
- Annotate only overrides. If the user just wants "a chart", ship the
  zero-annotation compile and read `DEFAULT_ENCODINGS` to see what was chosen.
- Pie charts: slices come from `@x`, values from `@y`; `@groupby` is ignored.
- Heatmaps: `@x` and `@y` are the two category columns, `@value` is the colour
  measure.
- `@stack` only matters for bar charts with a series.
- Themes render on the Vega-Lite and Plotly backends; ECharts output ignores
  them.

## Diagnostics as feedback

| Code | Action |
| --- | --- |
| MISSING_COLUMN | fix the column name in that annotation |
| NO_DATA, NO_MEASURE | the query needs rows / a numeric column |
| CHART_TYPE_UNKNOWN | use a shorthand or an exact Flint template name |
| HEATMAP_NEEDS_DIMENSIONS | heatmap needs two category columns |
| DUPLICATE_CELLS | prefer GROUP BY in SQL; duplicate cells were summed |
| PIE_NEGATIVE, PIE_TOO_MANY_SLICES | suggest a bar chart |
| STACKED_MIXED_SIGNS | suggest grouping instead of stacking |
| ID_AS_SERIES | drop @groupby; one series per row is unreadable |
| TEMPORAL_AS_MEASURE, MEASURE_AS_X | swap @x and @y |
| PIE_IGNORES_SERIES, HEATMAP_IGNORES_SERIES | remove @groupby for this chart type |
| AMBIGUOUS_NUMERIC | maybe a category; ask the user or set @semantic |
| DEFAULT_ENCODINGS | info only; inference ran |
| CHART_TYPE_MATCHED | info only; the fuzzy match succeeded |
| UNKNOWN_THEME, UNKNOWN_SEMANTIC_TYPE, INVALID_FLINT_OVERRIDE | fix the id or JSON |

## Rendering the output

- ECharts: `chart.setOption(result.echarts)`
- Vega-Lite: `vegaEmbed(el, result.compiled.vegalite)`
- Chart.js: `new Chart(canvas, result.compiled.chartjs)`
- Plotly: `Plotly.newPlot(el, spec.data, spec.layout)`

Request multiple backends with `backends: ['echarts', 'vegalite']`.

## Anti-patterns

- Do not hand-write ECharts options, Vega-Lite specs, or chart components.
- Do not add annotations that duplicate what inference already chose.
- Do not push aggregation into the chart; keep `GROUP BY` in SQL.
- Do not invent theme ids or semantic types; diagnostics will flag them.
- Do not sort rows in application code; keep `ORDER BY` in SQL (temporal x
  axes are sorted automatically).

## References

- npm: `sql-to-flint`
- Grammar and diagnostics: `docs/viz-grammar.md`
- Rationale: `docs/why-annotations.md`
