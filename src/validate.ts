import type { ChartPlan } from './infer.js';
import type { ColumnProfile } from './semantics.js';
import type { Diagnostic } from './types.js';

export interface ValidationInput {
  annotations: Record<string, string>;
  profiles: ColumnProfile[];
  plan: ChartPlan;
  rows: Record<string, unknown>[];
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export function validateChartConfig(input: ValidationInput): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { plan, rows } = input;
  const profileOf = new Map(input.profiles.map((profile) => [profile.name, profile]));

  if (rows.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'NO_DATA',
      message: 'The query returned no rows; there is nothing to chart.',
    });
    return diagnostics;
  }

  const measureProfile = plan.measureColumn ? profileOf.get(plan.measureColumn) : undefined;
  const dimensionProfile = plan.dimensionColumn ? profileOf.get(plan.dimensionColumn) : undefined;
  const chartType = plan.chartType;

  if (measureProfile?.kind === 'temporal' && plan.measureColumn) {
    diagnostics.push({
      severity: 'warning',
      code: 'TEMPORAL_AS_MEASURE',
      message: `'${plan.measureColumn}' is temporal but used as the measure; did you mean @x?`,
      column: plan.measureColumn,
    });
  }

  if (dimensionProfile?.kind === 'measure' && plan.dimensionColumn && !chartType.includes('Scatter')) {
    diagnostics.push({
      severity: 'warning',
      code: 'MEASURE_AS_X',
      message: `'${plan.dimensionColumn}' is a measure but used on the category axis; consider swapping @x and @y.`,
      column: plan.dimensionColumn,
    });
  }

  if (chartType === 'Heatmap') {
    const yField = plan.encodings.y;
    const yProfile = yField ? profileOf.get(yField) : undefined;
    if (yProfile?.kind === 'measure') {
      diagnostics.push({
        severity: 'warning',
        code: 'HEATMAP_DIMENSION_IS_MEASURE',
        message: `Heatmaps expect two category columns; '${yField}' is a measure.`,
        column: yField,
      });
    }
  }

  const measureColumn = plan.measureColumn;
  const measureValues = measureColumn
    ? rows.map((row) => toNumber(row[measureColumn])).filter((value): value is number => value !== null)
    : [];

  if (chartType === 'Pie Chart') {
    if (measureValues.some((value) => value < 0)) {
      diagnostics.push({
        severity: 'warning',
        code: 'PIE_NEGATIVE',
        message: 'Pie charts cannot show negative values; some rows are negative.',
        column: measureColumn ?? undefined,
      });
    }

    if (plan.dimensionColumn) {
      const slices = new Set(rows.map((row) => String(row[plan.dimensionColumn!]))).size;
      if (slices > 8) {
        diagnostics.push({
          severity: 'warning',
          code: 'PIE_TOO_MANY_SLICES',
          message: `${slices} slices is hard to read; consider a bar chart.`,
          column: plan.dimensionColumn,
        });
      }
    }
  }

  if (
    chartType === 'Stacked Bar Chart' &&
    measureValues.some((value) => value < 0) &&
    measureValues.some((value) => value > 0)
  ) {
    diagnostics.push({
      severity: 'warning',
      code: 'STACKED_MIXED_SIGNS',
      message: 'Stacking positive and negative values in one bar is hard to read; consider grouping instead.',
      column: measureColumn ?? undefined,
    });
  }

  if (plan.series) {
    const seriesProfile = profileOf.get(plan.series);
    if (
      seriesProfile?.kind === 'identifier' ||
      (seriesProfile && rows.length > 10 && seriesProfile.distinct > rows.length * 0.9)
    ) {
      diagnostics.push({
        severity: 'warning',
        code: 'ID_AS_SERIES',
        message: `'${plan.series}' has near-unique values; one series per row will be unreadable.`,
        column: plan.series,
      });
    }
  }

  if (dimensionProfile && dimensionProfile.distinct > 30) {
    diagnostics.push({
      severity: 'info',
      code: 'HIGH_CARDINALITY_X',
      message: `'${dimensionProfile.name}' has ${dimensionProfile.distinct} categories; the chart may truncate or overflow.`,
      column: dimensionProfile.name,
    });
  }

  if (
    (chartType === 'Line Chart' || chartType === 'Area Chart') &&
    dimensionProfile &&
    dimensionProfile.distinct === 1
  ) {
    diagnostics.push({
      severity: 'info',
      code: 'SINGLE_POINT',
      message: 'Only one category on the x axis; a line or area chart needs a series to be meaningful.',
      column: dimensionProfile?.name,
    });
  }

  for (const column of [plan.measureColumn, plan.dimensionColumn, plan.series]) {
    if (!column) continue;
    const profile = profileOf.get(column);
    if (
      profile &&
      profile.kind === 'measure' &&
      profile.semanticType === 'Quantity' &&
      profile.evidence === 'mostly numeric values' &&
      profile.distinct <= 10
    ) {
      diagnostics.push({
        severity: 'info',
        code: 'AMBIGUOUS_NUMERIC',
        message: `'${column}' has only ${profile.distinct} distinct values and may be a category; override with -- @semantic: ${column}: <Flint type>.`,
        column,
      });
    }
  }

  return diagnostics;
}
