import { matchTemplateName } from './flint.js';
import type { ColumnProfile } from './semantics.js';
import type { Diagnostic } from './types.js';

export interface ChartPlan {
  chartType: string;
  encodings: Record<string, string>;
  series: string | null;
  measureColumn: string | null;
  dimensionColumn: string | null;
  temporalSortColumn: string | null;
}

const VIZ_ALIASES: Record<string, string> = {
  column: 'bar',
  columns: 'bar',
  bars: 'bar',
  lines: 'line',
  timeseries: 'line',
  points: 'scatter',
  donut: 'pie',
  heat: 'heatmap',
};

const TRUTHY = new Set(['true', 'yes', '1']);

function cartesianPlan(
  viz: 'bar' | 'line' | 'area',
  xOverride: ColumnProfile | null,
  yOverride: ColumnProfile | null,
  seriesOverride: ColumnProfile | null,
  temporals: ColumnProfile[],
  categoricals: ColumnProfile[],
  measures: ColumnProfile[],
  stack: boolean,
): ChartPlan {
  const x = xOverride ?? temporals[0] ?? categoricals[0] ?? measures[0] ?? null;
  const y = yOverride ?? measures.find((profile) => profile.name !== x?.name) ?? null;
  const series = seriesOverride ?? categoricals.find((profile) => profile.name !== x?.name) ?? null;

  const chartType =
    viz === 'bar'
      ? series
        ? stack
          ? 'Stacked Bar Chart'
          : 'Grouped Bar Chart'
        : 'Bar Chart'
      : viz === 'line'
        ? 'Line Chart'
        : 'Area Chart';

  return {
    chartType,
    encodings: {
      ...(x ? { x: x.name } : {}),
      ...(y ? { y: y.name } : {}),
      ...(series ? { color: series.name } : {}),
    },
    series: series?.name ?? null,
    measureColumn: y?.name ?? null,
    dimensionColumn: x?.name ?? null,
    temporalSortColumn: x?.kind === 'temporal' ? x.name : null,
  };
}

export function resolveChartPlan(
  annotations: Record<string, string>,
  profiles: ColumnProfile[],
): { plan: ChartPlan; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  const emptyPlan: ChartPlan = {
    chartType: 'Bar Chart',
    encodings: {},
    series: null,
    measureColumn: null,
    dimensionColumn: null,
    temporalSortColumn: null,
  };

  if (profiles.length === 0) return { plan: emptyPlan, diagnostics };

  const byLower = new Map(profiles.map((profile) => [profile.name.toLowerCase(), profile]));

  const findColumn = (raw: string | undefined): ColumnProfile | null => {
    const trimmed = raw?.trim();
    if (!trimmed) return null;
    return (
      profiles.find((profile) => profile.name === trimmed) ??
      byLower.get(trimmed.toLowerCase()) ??
      null
    );
  };

  const temporals = profiles.filter((profile) => profile.kind === 'temporal');
  const categoricals = profiles.filter((profile) => profile.kind === 'categorical');
  const measures = profiles.filter((profile) => profile.kind === 'measure');

  const xOverride = findColumn(annotations.x);
  const yOverride = findColumn(annotations.y);
  const seriesRaw = (annotations.series ?? annotations.groupby ?? '').trim();
  const seriesKey = annotations.groupby ? 'groupby' : 'series';
  const seriesOverride = findColumn(seriesRaw);
  const valueOverride = findColumn(annotations.value);

  const declaredOverrides: Array<[string, string | undefined, ColumnProfile | null]> = [
    ['x', annotations.x, xOverride],
    ['y', annotations.y, yOverride],
    [seriesKey, seriesRaw || undefined, seriesOverride],
    ['value', annotations.value, valueOverride],
  ];

  for (const [key, raw, profile] of declaredOverrides) {
    if (raw?.trim() && !profile) {
      diagnostics.push({
        severity: 'error',
        code: 'MISSING_COLUMN',
        message: `@${key} references column '${raw.trim()}' which is not in the query result.`,
        column: raw.trim(),
      });
    }
  }

  const stackRaw = (annotations.stack ?? '').trim().toLowerCase();
  const stack = TRUTHY.has(stackRaw);

  const requestedViz = (annotations.viz ?? '').trim().toLowerCase();
  const viz = requestedViz
    ? (VIZ_ALIASES[requestedViz] ?? requestedViz)
    : temporals.length > 0
      ? 'line'
      : 'bar';

  let plan: ChartPlan;

  if (viz === 'pie') {
    const dimension = xOverride ?? temporals[0] ?? categoricals[0] ?? null;
    const measure = yOverride ?? measures.find((profile) => profile.name !== dimension?.name) ?? null;

    if (seriesOverride) {
      diagnostics.push({
        severity: 'warning',
        code: 'PIE_IGNORES_SERIES',
        message: `Pie charts encode a single category; @${seriesKey} is ignored.`,
        column: seriesOverride.name,
      });
    }

    plan = {
      chartType: 'Pie Chart',
      encodings: {
        ...(dimension ? { color: dimension.name } : {}),
        ...(measure ? { size: measure.name } : {}),
      },
      series: null,
      measureColumn: measure?.name ?? null,
      dimensionColumn: dimension?.name ?? null,
      temporalSortColumn: dimension?.kind === 'temporal' ? dimension.name : null,
    };
  } else if (viz === 'heatmap') {
    const candidates = [...temporals, ...categoricals];
    const dimensionX = xOverride ?? candidates[0] ?? null;
    const dimensionY = yOverride ?? candidates.find((profile) => profile.name !== dimensionX?.name) ?? null;
    const measure =
      valueOverride ??
      measures.find(
        (profile) => profile.name !== dimensionX?.name && profile.name !== dimensionY?.name,
      ) ??
      null;

    if (seriesOverride) {
      diagnostics.push({
        severity: 'warning',
        code: 'HEATMAP_IGNORES_SERIES',
        message: `Heatmaps encode two category columns; @${seriesKey} is ignored.`,
        column: seriesOverride.name,
      });
    }

    if (!dimensionX || !dimensionY) {
      diagnostics.push({
        severity: 'error',
        code: 'HEATMAP_NEEDS_DIMENSIONS',
        message: 'Heatmaps need two category columns; only one was found. Falling back to a bar chart.',
      });
      plan = cartesianPlan('bar', xOverride, yOverride, seriesOverride, temporals, categoricals, measures, stack);
    } else {
      plan = {
        chartType: 'Heatmap',
        encodings: {
          x: dimensionX.name,
          y: dimensionY.name,
          ...(measure ? { color: measure.name } : {}),
        },
        series: null,
        measureColumn: measure?.name ?? null,
        dimensionColumn: dimensionX.name,
        temporalSortColumn: dimensionX.kind === 'temporal' ? dimensionX.name : null,
      };
    }
  } else if (viz === 'scatter') {
    const x = xOverride ?? measures[0] ?? temporals[0] ?? categoricals[0] ?? null;
    const y = yOverride ?? measures.find((profile) => profile.name !== x?.name) ?? null;
    const series = seriesOverride ?? categoricals[0] ?? null;

    plan = {
      chartType: 'Scatter Plot',
      encodings: {
        ...(x ? { x: x.name } : {}),
        ...(y ? { y: y.name } : {}),
        ...(series ? { color: series.name } : {}),
      },
      series: series?.name ?? null,
      measureColumn: y?.name ?? null,
      dimensionColumn: x?.name ?? null,
      temporalSortColumn: null,
    };
  } else if (viz === 'bar' || viz === 'line' || viz === 'area') {
    plan = cartesianPlan(viz, xOverride, yOverride, seriesOverride, temporals, categoricals, measures, stack);
  } else {
    const template = matchTemplateName(requestedViz);

    if (template) {
      diagnostics.push({
        severity: 'info',
        code: 'CHART_TYPE_MATCHED',
        message: `'${annotations.viz}' matched the Flint chart type '${template}'.`,
      });
      plan = cartesianPlan('bar', xOverride, yOverride, seriesOverride, temporals, categoricals, measures, stack);
      plan.chartType = template;
    } else {
      diagnostics.push({
        severity: 'error',
        code: 'CHART_TYPE_UNKNOWN',
        message: `Unknown chart type '${annotations.viz}'. Use bar, line, area, pie, scatter, heatmap, or a Flint chart type name. Falling back to a bar chart.`,
      });
      plan = cartesianPlan('bar', xOverride, yOverride, seriesOverride, temporals, categoricals, measures, stack);
    }
  }

  if (!requestedViz && !annotations.x && plan.dimensionColumn) {
    diagnostics.push({
      severity: 'info',
      code: 'DEFAULT_ENCODINGS',
      message: `No @viz or @x annotations: inferred ${plan.chartType} with ${Object.entries(plan.encodings)
        .map(([channel, column]) => `${channel}='${column}'`)
        .join(', ')}.`,
    });
  }

  if (measures.length === 0 && plan.chartType !== 'Heatmap') {
    diagnostics.push({
      severity: 'error',
      code: 'NO_MEASURE',
      message: 'No numeric column was found to measure; annotate one with @y or add an aggregate to the query.',
    });
  }

  return { plan, diagnostics };
}
