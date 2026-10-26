import { describe, expect, it } from 'vitest';
import { compileSqlToFlint } from '../src/index.js';
import type { CompileResult } from '../src/index.js';

const sql = (annotations: string[]) =>
  `${annotations.join('\n')}\nSELECT month, region, revenue FROM sales;`;

const salesRows = [
  { month: '2026-01', region: 'NA', revenue: 10 },
  { month: '2026-01', region: 'EU', revenue: 20 },
  { month: '2026-02', region: 'NA', revenue: 30 },
  { month: '2026-02', region: 'EU', revenue: 40 },
];

const compile = (annotations: string[], data: Record<string, unknown>[] = salesRows): CompileResult =>
  compileSqlToFlint({ sql: sql(annotations), data });

const hasCode = (result: CompileResult, code: string) =>
  result.diagnostics.some((diagnostic) => diagnostic.code === code);

const errorCodes = (result: CompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((d) => d.code);

describe('compileSqlToFlint cartesian charts', () => {
  it('builds a grouped bar chart from annotations', () => {
    const result = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue', '-- @groupby: region']);

    expect(result.flint.chart_spec.chartType).toBe('Grouped Bar Chart');
    expect(result.flint.chart_spec.encodings).toEqual({
      x: 'month',
      y: 'revenue',
      color: 'region',
    });
    expect(result.flint.semantic_types).toEqual({
      month: 'YearMonth',
      region: 'Region',
      revenue: 'Price',
    });

    expect(result.echarts).toBeTruthy();
    const series = (result.echarts as { series?: Array<{ type?: string }> }).series;
    expect(series).toBeTruthy();
    expect(series!.length).toBe(2);
    expect(series!.every((entry) => entry.type === 'bar')).toBe(true);
    expect(errorCodes(result)).toEqual([]);
  });

  it('stacks bars with @stack: true', () => {
    const result = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue', '-- @series: region', '-- @stack: true']);
    expect(result.flint.chart_spec.chartType).toBe('Stacked Bar Chart');
    expect(result.echarts).toBeTruthy();
  });

  it('defaults to a line chart for temporal data without @viz', () => {
    const data = [
      { month: '2026-01', revenue: 10 },
      { month: '2026-02', revenue: 20 },
    ];
    const result = compile(['-- @title: Revenue by month'], data);

    expect(result.flint.chart_spec.chartType).toBe('Line Chart');
    expect(result.flint.chart_spec.encodings).toEqual({ x: 'month', y: 'revenue' });
    expect(hasCode(result, 'DEFAULT_ENCODINGS')).toBe(true);
    expect(result.echarts).toBeTruthy();
  });

  it('matches unknown viz names against Flint templates', () => {
    const result = compile(['-- @viz: waterfall', '-- @x: month', '-- @y: revenue']);
    expect(result.flint.chart_spec.chartType).toBe('Waterfall Chart');
    expect(hasCode(result, 'CHART_TYPE_MATCHED')).toBe(true);
    expect(result.echarts).toBeTruthy();
  });
});

describe('compileSqlToFlint pie and heatmap', () => {
  it('builds a pie chart with color and size encodings', () => {
    const result = compile(['-- @viz: pie', '-- @x: region', '-- @y: revenue']);

    expect(result.flint.chart_spec.chartType).toBe('Pie Chart');
    expect(result.flint.chart_spec.encodings).toEqual({ color: 'region', size: 'revenue' });

    expect(result.echarts).toBeTruthy();
    const series = (result.echarts as { series?: Array<{ type?: string }> }).series;
    expect(series?.[0]?.type).toBe('pie');
  });

  it('builds a heatmap with two dimensions and a color measure', () => {
    const result = compile(['-- @viz: heatmap']);

    expect(result.flint.chart_spec.chartType).toBe('Heatmap');
    expect(result.flint.chart_spec.encodings).toEqual({
      x: 'month',
      y: 'region',
      color: 'revenue',
    });
  });

  it('warns on negative pie values', () => {
    const data = [
      { region: 'NA', revenue: -10 },
      { region: 'EU', revenue: 20 },
    ];
    const result = compileSqlToFlint({
      sql: '-- @viz: pie\n-- @x: region\n-- @y: revenue\nSELECT region, revenue FROM t;',
      data,
    });

    expect(hasCode(result, 'PIE_NEGATIVE')).toBe(true);
  });
});

describe('compileSqlToFlint diagnostics', () => {
  it('errors when an annotated column is missing', () => {
    const result = compile(['-- @viz: bar', '-- @x: nope', '-- @y: revenue']);
    expect(hasCode(result, 'MISSING_COLUMN')).toBe(true);
  });

  it('warns and sums duplicate key cells', () => {
    const data = [
      { month: '2026-01', region: 'NA', revenue: 10 },
      { month: '2026-01', region: 'NA', revenue: 25 },
      { month: '2026-02', region: 'NA', revenue: 30 },
      { month: '2026-02', region: 'EU', revenue: 40 },
    ];
    const result = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue', '-- @series: region'], data);

    expect(hasCode(result, 'DUPLICATE_CELLS')).toBe(true);
    expect(result.flint.data.values).toHaveLength(3);

    const naJanuary = result.flint.data.values.find(
      (row) => row.month === '2026-01' && row.region === 'NA',
    );
    expect(naJanuary?.revenue).toBe(35);
  });

  it('warns when stacking mixed signs', () => {
    const data = [
      { month: '2026-01', region: 'NA', revenue: -10 },
      { month: '2026-01', region: 'EU', revenue: 20 },
    ];
    const result = compile(['-- @viz: bar', '-- @stack: true', '-- @x: month', '-- @y: revenue', '-- @series: region'], data);
    expect(hasCode(result, 'STACKED_MIXED_SIGNS')).toBe(true);
  });

  it('errors on empty data', () => {
    const result = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue'], []);
    expect(hasCode(result, 'NO_DATA')).toBe(true);
    expect(result.echarts).toBeNull();
  });
});

describe('compileSqlToFlint themes and overrides', () => {
  it('passes a known theme into the spec', () => {
    const result = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue', '-- @theme: powerbi-light']);
    expect(result.flint.theme_spec).toBe('powerbi-light');
  });

  it('warns on an unknown theme and omits it', () => {
    const result = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue', '-- @theme: nope']);
    expect(hasCode(result, 'UNKNOWN_THEME')).toBe(true);
    expect(result.flint.theme_spec).toBeUndefined();
  });

  it('merges the @flint JSON override into the spec', () => {
    const baseline = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue']);
    const result = compile([
      '-- @viz: bar',
      '-- @x: month',
      '-- @y: revenue',
      '-- @flint: {"chart_spec":{"title":"Custom title"}}',
    ]);

    expect(result.flint.chart_spec.title).toBe('Custom title');
    expect(result.flint.chart_spec.chartType).toBe(baseline.flint.chart_spec.chartType);
  });

  it('warns on invalid @flint JSON', () => {
    const result = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue', '-- @flint: not json']);
    expect(hasCode(result, 'INVALID_FLINT_OVERRIDE')).toBe(true);
  });
});

describe('compileSqlToFlint portable output', () => {
  it('compiles to Vega-Lite when requested', () => {
    const result = compileSqlToFlint({
      sql: sql(['-- @viz: bar', '-- @x: month', '-- @y: revenue']),
      data: [
        { month: '2026-01', region: 'NA', revenue: 10 },
        { month: '2026-02', region: 'EU', revenue: 20 },
      ],
      backends: ['vegalite'],
    });

    expect(result.compiled.vegalite).toBeTruthy();
    expect((result.compiled.vegalite as { mark?: string }).mark).toBe('bar');
    expect(result.echarts).toBeNull();
  });

  it('defaults to ECharts output', () => {
    const result = compile(['-- @viz: bar', '-- @x: month', '-- @y: revenue']);
    expect(result.echarts).toBeTruthy();
    expect(result.compiled.echarts).toBe(result.echarts);
  });
});
