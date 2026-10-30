/**
 * Dashboard manifests: SQL-first, round-trippable documents.
 *
 * A dashboard serializes to a single SQL-annotated document:
 *
 *   -- @dashboard: Sample Sales Dashboard
 *   -- @description: Revenue overview
 *   -- @grid: 12
 *
 *   -- @block: Monthly Revenue
 *   -- @type: chart
 *   -- @layout: 0,0,6,4
 *   -- @connection: warehouse
 *   -- @viz: bar
 *   -- @x: month
 *   -- @y: revenue
 *   SELECT month, SUM(revenue) AS revenue FROM orders GROUP BY month;
 *
 * `parseManifest` and `serializeManifest` are inverses for canonical input.
 * Every annotation key the parser understands has a serializer counterpart;
 * anything else is preserved verbatim in the block's SQL body.
 *
 * Block-level annotations are parsed with the same scanner used for single
 * queries (`parseAnnotations`), so there is exactly one annotation grammar in
 * this package.
 */

import { ANNOTATION_PATTERN, parseAnnotations } from './annotations.js';
import type { Diagnostic } from './types.js';

export type DashboardBlockType = 'chart' | 'metric' | 'table' | 'text';

export interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MetricFormat = 'number' | 'currency' | 'percent' | 'compact';

export interface ManifestConnection {
  id: number;
  name: string;
}

export interface ManifestSavedQuery {
  id: number;
  name: string;
  sql: string;
  connectionId: number;
}

export interface ManifestItem {
  id?: number;
  title: string;
  sql: string;
  connectionId: number;
  savedQueryId?: number | null;
  blockType: DashboardBlockType;
  config: Record<string, unknown> | null;
  layout: Layout;
}

export type ManifestFilterType =
  | 'select'
  | 'multiselect'
  | 'tabs'
  | 'buttons'
  | 'date'
  | 'daterange';

export interface ManifestFilter {
  name: string;
  type: ManifestFilterType;
  presentation?: ManifestFilterType;
  connectionId?: number;
  sql?: string;
  values?: string[];
  defaultValue?: string | string[] | null;
}

export interface ManifestDashboard {
  name: string;
  description: string | null;
  filters: ManifestFilter[];
  theme?: string;
  colors?: string[];
  items: ManifestItem[];
}

export interface ManifestDiagnostic extends Diagnostic {
  /** Title of the block or filter the diagnostic refers to. */
  block?: string;
}

export interface ParseManifestResult {
  dashboard: ManifestDashboard;
  diagnostics: ManifestDiagnostic[];
}

const BLOCK_LINE = /^--\s*@block:\s*(.*?)\s*$/;
const FILTER_LINE = /^--\s*@filter:\s*(.*?)\s*$/;
/**
 * Annotations owned by the manifest document itself. They are consumed during
 * parse and must not leak into the block's SQL body, otherwise every
 * serialize/parse cycle would duplicate them.
 */
const MANIFEST_KEYS = new Set([
  'type',
  'layout',
  'connection',
  'connection-id',
  'connectionid',
  'block',
  'saved-query',
  'saved_query',
  'savedquery',
  'timeformat',
  'xformat',
  'yformat',
]);
const TRUTHY = new Set(['true', 'yes', '1', 'on']);
const FILTER_TYPES: readonly ManifestFilterType[] = [
  'select',
  'multiselect',
  'tabs',
  'buttons',
  'date',
  'daterange',
];

const DEFAULT_LAYOUT: Record<DashboardBlockType, Layout> = {
  chart: { x: 0, y: 0, w: 6, h: 8 },
  metric: { x: 0, y: 0, w: 3, h: 3 },
  table: { x: 0, y: 0, w: 6, h: 8 },
  text: { x: 0, y: 0, w: 12, h: 3 },
};

const oneLine = (value: string | null | undefined): string =>
  (value ?? '').replace(/\r?\n/g, ' ').trim();

const escapeMarkdownBody = (value: string): string => value.replace(/\*\//g, '* /').trim();

function parseLayout(value: string | undefined): Layout | null {
  if (!value) return null;
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [x, y, w, h] = parts.map((part) => Math.max(0, Math.round(part)));
  return { x, y, w: Math.max(1, Math.min(12, w)), h: Math.max(1, Math.min(60, h)) };
}

function layoutFor(
  raw: string | undefined,
  type: DashboardBlockType,
  bottom: number,
): { layout: Layout; diagnostic?: ManifestDiagnostic } {
  const parsed = parseLayout(raw);
  if (parsed) return { layout: parsed };
  const fallback = { ...DEFAULT_LAYOUT[type], y: bottom };
  if (raw?.trim()) {
    return {
      layout: fallback,
      diagnostic: {
        severity: 'warning',
        code: 'INVALID_LAYOUT',
        message: `'${raw.trim()}' is not a valid x,y,w,h layout; using ${fallback.x},${fallback.y},${fallback.w},${fallback.h}.`,
      },
    };
  }
  return { layout: fallback };
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return TRUTHY.has(value.trim().toLowerCase());
}

function parseFormat(value: string | undefined): Record<string, MetricFormat> | undefined {
  if (!value?.trim()) return undefined;
  const output: Record<string, MetricFormat> = {};
  for (const entry of value.split(',')) {
    const index = entry.indexOf(':');
    if (index === -1) continue;
    const column = entry.slice(0, index).trim();
    const format = entry.slice(index + 1).trim() as MetricFormat;
    if (column && ['number', 'currency', 'percent', 'compact'].includes(format)) {
      output[column] = format;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export function metricConfig(annotations: Record<string, string>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (annotations.metric) config.metricColumn = annotations.metric;
  if (annotations.prior) config.priorColumn = annotations.prior;
  if (annotations.sparkline) config.sparklineColumn = annotations.sparkline;
  if (annotations.format) config.format = annotations.format;
  if (annotations.higherisbetter !== undefined) {
    config.higherIsBetter = booleanValue(annotations.higherisbetter) ?? true;
  }
  const target = numberValue(annotations.target);
  if (target !== undefined) {
    const thresholds: Record<string, number> = {};
    const amber = numberValue(annotations.targetamber);
    const red = numberValue(annotations.targetred);
    if (amber !== undefined) thresholds.amber = amber;
    if (red !== undefined) thresholds.red = red;
    config.target = {
      value: target,
      direction: annotations.targetdirection === 'below' ? 'below' : 'above',
      ...(Object.keys(thresholds).length > 0 ? { thresholds } : {}),
    };
  }
  return config;
}

function tableConfig(annotations: Record<string, string>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (annotations.columns) {
    config.columns = annotations.columns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
  }
  const pageSize = numberValue(annotations.pagesize);
  if (pageSize !== undefined) config.pageSize = pageSize;
  if (annotations.density === 'comfortable' || annotations.density === 'compact') {
    config.density = annotations.density;
  }
  const maxRows = numberValue(annotations.maxrows);
  if (maxRows !== undefined) config.maxRows = maxRows;
  const format = parseFormat(annotations.format);
  if (format) config.format = format;
  if (annotations.rownumbers !== undefined) {
    config.rowNumbers = booleanValue(annotations.rownumbers) ?? false;
  }
  return config;
}

function chartConfig(annotations: Record<string, string>): Record<string, unknown> | null {
  const config: Record<string, unknown> = {};
  if (annotations.timeformat) config.timeFormat = annotations.timeformat.trim();
  if (annotations.xformat) config.xFormat = annotations.xformat.trim();
  if (annotations.yformat) config.yFormat = annotations.yformat.trim();
  return Object.keys(config).length > 0 ? config : null;
}

function inferType(annotations: Record<string, string>, body: string): DashboardBlockType {
  const explicit = annotations.type?.trim().toLowerCase();
  if (explicit === 'chart' || explicit === 'metric' || explicit === 'table' || explicit === 'text') {
    return explicit;
  }
  if (annotations.metric) return 'metric';
  if (annotations.columns && !annotations.viz) return 'table';
  if (body.trimStart().startsWith('/*')) return 'text';
  return 'chart';
}

function configFor(
  type: DashboardBlockType,
  annotations: Record<string, string>,
  markdown: string,
): Record<string, unknown> | null {
  if (type === 'metric') return metricConfig(annotations);
  if (type === 'table') return tableConfig(annotations);
  if (type === 'text') return { markdown };
  if (type === 'chart') return chartConfig(annotations);
  return null;
}

function configAnnotations(
  type: DashboardBlockType,
  config: Record<string, unknown> | null,
): string[] {
  if (!config) return [];
  const lines: string[] = [];
  const push = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    lines.push(`-- @${key}: ${oneLine(String(value))}`);
  };

  if (type === 'metric') {
    push('metric', config.metricColumn);
    push('prior', config.priorColumn);
    push('sparkline', config.sparklineColumn);
    push('format', config.format);
    if (config.higherIsBetter !== undefined) push('higherIsBetter', config.higherIsBetter);
    const target = config.target as
      | { value?: number; direction?: string; thresholds?: { amber?: number; red?: number } }
      | undefined;
    if (target?.value !== undefined) {
      push('target', target.value);
      push('targetDirection', target.direction ?? 'above');
      if (target.thresholds?.amber !== undefined) push('targetAmber', target.thresholds.amber);
      if (target.thresholds?.red !== undefined) push('targetRed', target.thresholds.red);
    }
  }

  if (type === 'table') {
    const columns = config.columns as string[] | undefined;
    if (columns?.length) push('columns', columns.join(', '));
    push('pageSize', config.pageSize);
    push('density', config.density);
    push('maxRows', config.maxRows);
    const format = config.format as Record<string, string> | undefined;
    if (format && Object.keys(format).length > 0) {
      push(
        'format',
        Object.entries(format)
          .map(([column, value]) => `${column}: ${value}`)
          .join(', '),
      );
    }
    if (config.rowNumbers !== undefined) push('rowNumbers', config.rowNumbers);
  }

  if (type === 'chart') {
    push('timeFormat', config.timeFormat);
    push('xFormat', config.xFormat);
    push('yFormat', config.yFormat);
  }

  return lines;
}

export function serializeManifest(
  dashboard: ManifestDashboard,
  connections: ManifestConnection[],
  savedQueries: ManifestSavedQuery[] = [],
): string {
  const byId = new Map(connections.map((connection) => [connection.id, connection.name]));
  const lines: string[] = [`-- @dashboard: ${oneLine(dashboard.name) || 'Untitled dashboard'}`];
  if (dashboard.description) lines.push(`-- @description: ${oneLine(dashboard.description)}`);
  lines.push('-- @grid: 12');
  if (dashboard.theme) lines.push(`-- @theme: ${oneLine(dashboard.theme)}`);
  if (dashboard.colors?.length) {
    lines.push(`-- @colors: ${dashboard.colors.map(oneLine).join(', ')}`);
  }

  for (const filter of dashboard.filters) {
    const connection = filter.connectionId ? byId.get(filter.connectionId) : undefined;
    lines.push('');
    lines.push(`-- @filter: ${oneLine(filter.name) || 'Untitled filter'}`);
    lines.push(`-- @type: ${filter.type}`);
    if (filter.presentation && filter.presentation !== filter.type) {
      lines.push(`-- @presentation: ${filter.presentation}`);
    }
    if (filter.connectionId && connection) {
      lines.push(`-- @connection: ${filter.connectionId}`);
    }
    if (filter.sql) lines.push(`-- @sql: ${oneLine(filter.sql)}`);
    if (filter.values?.length) lines.push(`-- @values: ${filter.values.map(oneLine).join(', ')}`);
    if (filter.defaultValue !== undefined && filter.defaultValue !== null) {
      const value = Array.isArray(filter.defaultValue)
        ? filter.defaultValue.map(oneLine).join(', ')
        : oneLine(String(filter.defaultValue));
      lines.push(`-- @default: ${value}`);
    }
  }

  for (const item of dashboard.items) {
    lines.push('');
    lines.push(`-- @block: ${oneLine(item.title) || 'Untitled block'}`);
    lines.push(`-- @type: ${item.blockType}`);
    lines.push(`-- @layout: ${item.layout.x},${item.layout.y},${item.layout.w},${item.layout.h}`);
    if (item.blockType !== 'text') {
      lines.push(`-- @connection: ${item.connectionId}`);
      const savedQuery = savedQueries.find((query) => query.id === item.savedQueryId);
      if (savedQuery) lines.push(`-- @saved-query: ${oneLine(savedQuery.name)}`);
    }
    lines.push(...configAnnotations(item.blockType, item.config));

    if (item.blockType === 'text') {
      const markdown = escapeMarkdownBody(
        String((item.config as { markdown?: string } | null)?.markdown ?? ''),
      );
      lines.push('/*');
      if (markdown) lines.push(markdown);
      lines.push('*/');
    } else {
      lines.push(item.sql.trim());
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function parseManifest(
  code: string,
  connections: ManifestConnection[],
  savedQueries: ManifestSavedQuery[] = [],
): ParseManifestResult {
  const diagnostics: ManifestDiagnostic[] = [];
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const blockStarts: number[] = [];
  const filterStarts: number[] = [];

  lines.forEach((line, index) => {
    if (BLOCK_LINE.test(line)) blockStarts.push(index);
    if (FILTER_LINE.test(line)) filterStarts.push(index);
  });

  const headerEnd = [...blockStarts, ...filterStarts].sort((a, b) => a - b)[0] ?? lines.length;
  const dashboardAnnotations = parseAnnotations(lines.slice(0, headerEnd).join('\n'));

  const name = dashboardAnnotations.dashboard?.trim() || 'Untitled dashboard';
  const description = dashboardAnnotations.description?.trim() || null;
  const dashboardTheme = dashboardAnnotations.theme?.trim();
  const dashboardColors = dashboardAnnotations.colors?.trim();
  const byName = new Map<string, ManifestConnection>();
  for (const connection of connections) {
    const key = connection.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, connection);
  }
  const byId = new Map<number, ManifestConnection>();
  for (const connection of connections) {
    if (!byId.has(connection.id)) byId.set(connection.id, connection);
  }
  const savedByName = new Map<string, ManifestSavedQuery>();
  for (const savedQuery of savedQueries) {
    const key = savedQuery.name.trim().toLowerCase();
    if (!savedByName.has(key)) savedByName.set(key, savedQuery);
  }

  const filters: ManifestFilter[] = [];
  for (let index = 0; index < filterStarts.length; index += 1) {
    const start = filterStarts[index];
    const end = filterStarts[index + 1] ?? blockStarts[0] ?? lines.length;
    const segment = lines.slice(start, end);
    const name = segment[0].match(FILTER_LINE)?.[1]?.trim() || `Filter ${index + 1}`;
    const annotations = parseAnnotations(segment.slice(1).join('\n'));

    const type = (annotations.type?.trim().toLowerCase() as ManifestFilterType) || 'select';
    const presentation =
      (annotations.presentation?.trim().toLowerCase() as ManifestFilterType) || type;
    const connectionName = annotations.connection?.trim() ?? '';
    const connectionIdAnnotation =
      annotations['connection-id']?.trim() ?? annotations.connectionid?.trim() ?? '';
    let connection: ManifestConnection | undefined;
    if (connectionIdAnnotation) {
      const numeric = Number(connectionIdAnnotation);
      if (Number.isFinite(numeric)) connection = byId.get(numeric);
      else connection = byName.get(connectionIdAnnotation.toLowerCase());
    } else if (connectionName) {
      if (/^\d+$/.test(connectionName)) connection = byId.get(Number(connectionName));
      else connection = byName.get(connectionName.toLowerCase());
    }
    if ((connectionName || connectionIdAnnotation) && !connection) {
      diagnostics.push({
        severity: 'error',
        code: 'UNKNOWN_CONNECTION',
        message: `Connection '${connectionName || connectionIdAnnotation}' was not found (filter '${name}').`,
        block: name,
      });
    }
    const values = annotations.values
      ? annotations.values
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
    const defaultValueRaw = annotations.default?.trim();
    const defaultValue =
      defaultValueRaw && values && values.length > 0 && defaultValueRaw.includes(',')
        ? defaultValueRaw
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : defaultValueRaw || null;
    filters.push({
      name,
      type: FILTER_TYPES.includes(type) ? type : 'select',
      presentation: FILTER_TYPES.includes(presentation) ? presentation : undefined,
      connectionId: connection?.id,
      sql: annotations.sql?.trim() || undefined,
      values,
      defaultValue,
    });
  }

  const items: ManifestItem[] = [];
  let bottom = 0;

  blockStarts.forEach((start, blockIndex) => {
    const end = blockStarts[blockIndex + 1] ?? lines.length;
    const segment = lines.slice(start, end);
    const title = segment[0].match(BLOCK_LINE)?.[1]?.trim() || `Block ${blockIndex + 1}`;

    // Collect the leading comment block. `parseAnnotations` turns it into a map;
    // the raw lines are kept because non-manifest annotations belong to the
    // chart's SQL body (e.g. @viz, @x, @y for sqlFlint).
    let cursor = 1;
    const rawAnnotationLines: string[] = [];
    for (; cursor < segment.length; cursor += 1) {
      const line = segment[cursor];
      if (line.trim() === '') {
        rawAnnotationLines.push(line);
        continue;
      }
      if (!line.trimStart().startsWith('--')) break;
      rawAnnotationLines.push(line);
    }
    const annotations = parseAnnotations(rawAnnotationLines.join('\n'));

    const body = segment.slice(cursor).join('\n').trim();
    const type = inferType(annotations, body);
    if (!annotations.type) {
      diagnostics.push({
        severity: 'info',
        code: 'BLOCK_TYPE_INFERRED',
        message: `Block '${title}' has no @type; treating it as '${type}'.`,
        block: title,
      });
    }

    if (type === 'metric' && annotations.viz) {
      diagnostics.push({
        severity: 'error',
        code: 'VIZ_ON_METRIC',
        message: `Metric block '${title}' must not use @viz; use @metric to bind the value column.`,
        block: title,
      });
    }
    if (type !== 'metric' && annotations.metric) {
      diagnostics.push({
        severity: 'error',
        code: 'METRIC_ON_NON_METRIC',
        message: `@metric is only valid on @type: metric blocks ('${title}').`,
        block: title,
      });
    }
    if (type === 'text' && annotations.viz) {
      diagnostics.push({
        severity: 'warning',
        code: 'VIZ_ON_TEXT',
        message: `Text block '${title}' ignores @viz.`,
        block: title,
      });
    }

    let markdown = '';
    if (type === 'text') {
      const open = body.indexOf('/*');
      const close = body.lastIndexOf('*/');
      if (open !== -1 && close > open) {
        markdown = body.slice(open + 2, close).replace(/^\n/, '').trim();
      } else {
        markdown = body;
        diagnostics.push({
          severity: 'warning',
          code: 'TEXT_NOT_COMMENTED',
          message: `Text block '${title}' should wrap markdown in /* ... */.`,
          block: title,
        });
      }
    }

    const keptAnnotations =
      type === 'chart'
        ? rawAnnotationLines.filter((line) => {
            const match = line.match(ANNOTATION_PATTERN);
            return !match || !MANIFEST_KEYS.has(match[1].toLowerCase());
          })
        : [];
    const savedQueryName = (
      annotations.savedquery ??
      annotations.saved_query ??
      annotations['saved-query']
    )?.trim();
    const savedQuery = savedQueryName ? savedByName.get(savedQueryName.toLowerCase()) : undefined;
    let sql = type === 'text' ? '' : [...keptAnnotations, body].join('\n').trim();
    if (type !== 'text' && savedQuery && !sql.trim()) sql = savedQuery.sql;
    if (type === 'chart') {
      if (dashboardTheme && !/^\s*--\s*@theme\s*:/im.test(sql)) {
        sql = `-- @theme: ${dashboardTheme}\n${sql}`.trim();
      }
      if (dashboardColors && !/^\s*--\s*@colors\s*:/im.test(sql)) {
        sql = `-- @colors: ${dashboardColors}\n${sql}`.trim();
      }
    }

    if (type !== 'text' && type !== 'chart' && !sql) {
      diagnostics.push({
        severity: 'error',
        code: 'MISSING_SQL',
        message: `Block '${title}' has no SQL.`,
        block: title,
      });
    }

    const connectionName = annotations.connection?.trim() ?? '';
    const connectionIdAnnotation =
      (annotations['connection-id'] ?? annotations.connectionid)?.trim() ?? '';
    let connectionId = 0;
    let savedQueryId: number | undefined = savedQuery?.id;
    if (type !== 'text') {
      let resolved: ManifestConnection | undefined;
      const lookupKey = connectionIdAnnotation || connectionName;
      if (lookupKey) {
        if (/^\d+$/.test(lookupKey)) resolved = byId.get(Number(lookupKey));
        else resolved = byName.get(lookupKey.toLowerCase());
      }
      if (lookupKey && !resolved) {
        diagnostics.push({
          severity: 'error',
          code: 'UNKNOWN_CONNECTION',
          message: `Connection '${lookupKey}' was not found (block '${title}').`,
          block: title,
        });
      } else if (resolved) {
        connectionId = resolved.id;
      }
      if (!lookupKey) {
        diagnostics.push({
          severity: 'error',
          code: 'MISSING_CONNECTION',
          message: `Block '${title}' needs @connection with a connection name or id.`,
          block: title,
        });
      }
      if (savedQueryName) {
        const resolvedQuery = savedByName.get(savedQueryName.toLowerCase());
        if (resolvedQuery) {
          savedQueryId = resolvedQuery.id;
          if (!lookupKey) connectionId = resolvedQuery.connectionId;
        } else {
          diagnostics.push({
            severity: 'error',
            code: 'UNKNOWN_SAVED_QUERY',
            message: `Saved query '${savedQueryName}' was not found (block '${title}').`,
            block: title,
          });
        }
      }
    }

    const { layout, diagnostic } = layoutFor(annotations.layout, type, bottom);
    if (diagnostic) diagnostics.push({ ...diagnostic, block: title });
    bottom = Math.max(bottom, layout.y + layout.h);

    if (type === 'metric' && !annotations.metric) {
      diagnostics.push({
        severity: 'warning',
        code: 'METRIC_COLUMN_MISSING',
        message: `Metric block '${title}' has no @metric; the first numeric column will be used.`,
        block: title,
      });
    }
    if (type === 'table' && annotations.columns) {
      const selected = annotations.columns
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      if (selected.length === 0) {
        diagnostics.push({
          severity: 'warning',
          code: 'EMPTY_COLUMNS',
          message: `Table block '${title}' has an empty @columns list.`,
          block: title,
        });
      }
    }

    items.push({
      title,
      sql,
      connectionId,
      savedQueryId: type === 'text' ? null : savedQueryId ?? null,
      blockType: type,
      config: configFor(type, annotations, markdown),
      layout,
    });
  });

  if (blockStarts.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'NO_BLOCKS',
      message: 'The manifest has no -- @block: sections.',
    });
  }

  return {
    dashboard: {
      name,
      description,
      filters,
      theme: dashboardTheme,
      colors: dashboardColors
        ? dashboardColors
            .split(',')
            .map((color) => color.trim())
            .filter(Boolean)
        : undefined,
      items,
    },
    diagnostics,
  };
}

/** @deprecated Use {@link parseManifest}. */
export const parseDashboardManifest = parseManifest;

/** @deprecated Use {@link serializeManifest}. */
export const serializeDashboardManifest = serializeManifest;
