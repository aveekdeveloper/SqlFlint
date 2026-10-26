import { parseAnnotations, parseSemanticOverrides } from './annotations.js';
import { assembleForBackend, semanticTypeNames, themePresetIds } from './flint.js';
import { resolveChartPlan } from './infer.js';
import { profileColumns } from './semantics.js';
import type { Backend, CompileOptions, CompileResult, Diagnostic, FlintChartSpec } from './types.js';
import { validateChartConfig } from './validate.js';

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toFiniteNumber = (value: unknown): number | null => {
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

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    if (BLOCKED_KEYS.has(key)) continue;

    const sourceValue = source[key];

    if (Array.isArray(sourceValue)) {
      output[key] = sourceValue;
    } else if (isPlainObject(sourceValue)) {
      output[key] = deepMerge(
        isPlainObject(output[key]) ? (output[key] as Record<string, unknown>) : {},
        sourceValue,
      );
    } else {
      output[key] = sourceValue;
    }
  }

  return output;
}

interface AggregationResult {
  rows: Record<string, unknown>[];
  duplicateCells: number;
  example: string | null;
}

function aggregateDuplicates(
  rows: Record<string, unknown>[],
  keyColumns: string[],
  measureColumn: string | null,
): AggregationResult {
  if (!measureColumn || keyColumns.length === 0) {
    return { rows, duplicateCells: 0, example: null };
  }

  const buckets = new Map<string, { row: Record<string, unknown>; values: unknown[] }>();
  let duplicateCells = 0;
  let example: string | null = null;

  for (const row of rows) {
    const key = keyColumns.map((column) => String(row[column])).join(' | ');
    const bucket = buckets.get(key);

    if (bucket) {
      duplicateCells += 1;
      if (!example) example = key;
      bucket.values.push(row[measureColumn]);
    } else {
      buckets.set(key, { row: { ...row }, values: [row[measureColumn]] });
    }
  }

  if (duplicateCells === 0) return { rows, duplicateCells: 0, example: null };

  const aggregated: Record<string, unknown>[] = [];

  for (const { row, values } of buckets.values()) {
    const numbers = values
      .map(toFiniteNumber)
      .filter((value): value is number => value !== null);

    if (numbers.length > 0) {
      row[measureColumn] = numbers.reduce((total, value) => total + value, 0);
    }

    aggregated.push(row);
  }

  return { rows: aggregated, duplicateCells, example };
}

function sortRowsByTemporalColumn(
  rows: Record<string, unknown>[],
  column: string | null,
): Record<string, unknown>[] {
  if (!column) return rows;

  return [...rows].sort((left, right) => {
    const leftValue = left[column];
    const rightValue = right[column];

    if (leftValue instanceof Date && rightValue instanceof Date) {
      return leftValue.getTime() - rightValue.getTime();
    }

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return leftValue - rightValue;
    }

    return String(leftValue).localeCompare(String(rightValue));
  });
}

export function compileSqlToFlint(options: CompileOptions): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const annotations = parseAnnotations(options.sql);

  const rows = Array.isArray(options.data)
    ? (options.data.filter(isPlainObject) as Record<string, unknown>[])
    : [];

  const profiles = profileColumns(rows);
  const overrides = parseSemanticOverrides(annotations.semantic);
  const semanticTypes: Record<string, string> = {};
  const profileByName = new Map(profiles.map((profile) => [profile.name, profile]));

  for (const profile of profiles) {
    const override = overrides[profile.name];

    if (!override) {
      semanticTypes[profile.name] = profile.semanticType;
      continue;
    }

    if (semanticTypeNames.has(override)) {
      semanticTypes[profile.name] = override;
    } else {
      semanticTypes[profile.name] = profile.semanticType;
      diagnostics.push({
        severity: 'warning',
        code: 'UNKNOWN_SEMANTIC_TYPE',
        message: `'${override}' is not a Flint semantic type; using the inferred '${profile.semanticType}' for '${profile.name}'.`,
        column: profile.name,
      });
    }
  }

  for (const column of Object.keys(overrides)) {
    if (!profileByName.has(column)) {
      diagnostics.push({
        severity: 'warning',
        code: 'MISSING_COLUMN',
        message: `@semantic override references column '${column}' which is not in the query result.`,
        column,
      });
    }
  }

  const { plan, diagnostics: planDiagnostics } = resolveChartPlan(annotations, profiles);
  diagnostics.push(...planDiagnostics);

  const theme = options.theme ?? annotations.theme;
  let themeSpec: string | undefined;

  if (theme) {
    if (themePresetIds.has(theme)) {
      themeSpec = theme;
    } else {
      diagnostics.push({
        severity: 'warning',
        code: 'UNKNOWN_THEME',
        message: `Theme '${theme}' is not a Flint preset (available: ${[...themePresetIds].join(', ')}); building the spec without a theme.`,
      });
    }
  }

  let dataRows = rows;

  if (rows.length > 0 && plan.measureColumn) {
    const keyColumns = [plan.dimensionColumn, plan.series].filter(
      (column): column is string => column !== null,
    );

    const aggregated = aggregateDuplicates(rows, keyColumns, plan.measureColumn);

    if (aggregated.duplicateCells > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'DUPLICATE_CELLS',
        message: `${aggregated.duplicateCells} duplicate key cell(s) (e.g. ${aggregated.example}) were summed for the chart. Aggregate in SQL (GROUP BY) to control this.`,
      });
      dataRows = aggregated.rows;
    }
  }

  if (plan.temporalSortColumn) {
    dataRows = sortRowsByTemporalColumn(dataRows, plan.temporalSortColumn);
  }

  const chartSpec: FlintChartSpec = {
    data: { values: dataRows },
    semantic_types: semanticTypes,
    chart_spec: {
      chartType: plan.chartType,
      ...(annotations.title ? { title: annotations.title } : {}),
      ...(annotations.subtitle ? { subtitle: annotations.subtitle } : {}),
      encodings: plan.encodings,
    },
    ...(themeSpec ? { theme_spec: themeSpec } : {}),
  };

  if (annotations.flint) {
    try {
      const override = JSON.parse(annotations.flint);

      if (isPlainObject(override)) {
        const merged = deepMerge(chartSpec as unknown as Record<string, unknown>, override);
        Object.assign(chartSpec as unknown as Record<string, unknown>, merged);
      } else {
        diagnostics.push({
          severity: 'warning',
          code: 'INVALID_FLINT_OVERRIDE',
          message: '@flint override must be a JSON object.',
        });
      }
    } catch {
      diagnostics.push({
        severity: 'warning',
        code: 'INVALID_FLINT_OVERRIDE',
        message: '@flint override is not valid JSON.',
      });
    }
  }

  diagnostics.push(...validateChartConfig({ annotations, profiles, plan, rows: dataRows }));

  const requestedBackends = options.backends ?? [options.backend ?? 'echarts'];
  const compiled: Partial<Record<Backend, Record<string, unknown>>> = {};

  for (const backend of requestedBackends) {
    const { spec, diagnostics: backendDiagnostics } = assembleForBackend(chartSpec, backend);
    diagnostics.push(...backendDiagnostics);
    if (spec) compiled[backend] = spec;
  }

  const echarts = compiled.echarts ?? null;

  return { flint: chartSpec, echarts, compiled, diagnostics };
}
