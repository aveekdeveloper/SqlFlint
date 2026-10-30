import { describe, expect, it } from 'vitest';
import {
  parseManifest,
  serializeManifest,
  type ManifestConnection,
  type ManifestDashboard,
  type ManifestSavedQuery,
} from '../src/index.js';

const connections: ManifestConnection[] = [{ id: 1, name: 'warehouse' }];
const savedQueries: ManifestSavedQuery[] = [
  { id: 5, name: 'Monthly Revenue', sql: 'SELECT month, revenue FROM sales', connectionId: 1 },
];

const fullDashboard: ManifestDashboard = {
  name: 'Revenue',
  description: 'Quarterly overview',
  extra: { refreshSeconds: 300 },
  filters: [
    {
      name: 'Region',
      type: 'multiselect',
      presentation: 'tabs',
      connectionId: 1,
      sql: 'SELECT region FROM dim_region',
      values: ['NA', 'EU'],
      defaultValue: 'NA',
    },
  ],
  items: [
    {
      title: 'By month',
      sql: '-- @viz: line\n-- @x: month\n-- @y: revenue\nSELECT month, revenue FROM sales',
      connectionId: 1,
      savedQueryId: null,
      blockType: 'chart',
      config: { timeFormat: '%Y-%m' },
      layout: { x: 0, y: 0, w: 6, h: 4 },
    },
    {
      title: 'Total',
      sql: 'SELECT SUM(revenue) AS total FROM sales',
      connectionId: 1,
      savedQueryId: null,
      blockType: 'metric',
      config: {
        metricColumn: 'total',
        target: { value: 100, direction: 'above', thresholds: { amber: 80, red: 50 } },
      },
      layout: { x: 6, y: 0, w: 3, h: 3 },
    },
    {
      title: 'Rows',
      sql: 'SELECT region, revenue FROM sales',
      connectionId: 1,
      savedQueryId: null,
      blockType: 'table',
      config: {
        columns: ['region', 'revenue'],
        pageSize: 25,
        density: 'compact',
        maxRows: 500,
        format: { revenue: 'currency' },
        rowNumbers: true,
      },
      layout: { x: 0, y: 4, w: 6, h: 6 },
    },
    {
      title: 'Note',
      sql: '',
      connectionId: 0,
      savedQueryId: null,
      blockType: 'text',
      config: { markdown: '# Notes\n\nBody.' },
      layout: { x: 6, y: 3, w: 6, h: 3 },
    },
  ],
};

describe('serializeManifest', () => {
  it('emits a canonical document', () => {
    const text = serializeManifest(
      {
        name: 'Revenue',
        description: 'Quarterly overview',
        filters: [],
        items: [
          {
            title: 'By month',
            sql: '-- @viz: line\n-- @x: month\n-- @y: revenue\nSELECT month, revenue FROM sales',
            connectionId: 1,
            savedQueryId: null,
            blockType: 'chart',
            config: null,
            layout: { x: 0, y: 0, w: 6, h: 4 },
          },
        ],
      },
      connections,
    );

    expect(text).toBe(
      [
        '-- @spec: 1',
        '-- @dashboard: Revenue',
        '-- @description: Quarterly overview',
        '-- @grid: 12',
        '',
        '-- @block: By month',
        '-- @type: chart',
        '-- @layout: 0,0,6,4',
        '-- @connection: 1',
        '-- @viz: line',
        '-- @x: month',
        '-- @y: revenue',
        'SELECT month, revenue FROM sales',
        '',
      ].join('\n'),
    );
  });

  it('wraps markdown bodies in a block comment', () => {
    const text = serializeManifest(
      {
        name: 'Notes',
        description: null,
        filters: [],
        items: [
          {
            title: 'Intro',
            sql: '',
            connectionId: 0,
            savedQueryId: null,
            blockType: 'text',
            config: { markdown: 'Hello */ world' },
            layout: { x: 0, y: 0, w: 12, h: 3 },
          },
        ],
      },
      connections,
    );

    expect(text).toContain('/*\nHello * / world\n*/');
  });
});

describe('parseManifest', () => {
  it('round-trips a full dashboard', () => {
    const text = serializeManifest(fullDashboard, connections, savedQueries);
    const { dashboard, diagnostics } = parseManifest(text, connections, savedQueries);

    expect(diagnostics).toEqual([]);
    expect(dashboard).toEqual(fullDashboard);
  });

  it('is idempotent under repeated serialize/parse cycles', () => {
    const first = serializeManifest(fullDashboard, connections, savedQueries);
    const second = serializeManifest(parseManifest(first, connections, savedQueries).dashboard, connections, savedQueries);
    const third = serializeManifest(parseManifest(second, connections, savedQueries).dashboard, connections, savedQueries);

    expect(second).toBe(first);
    expect(third).toBe(second);
  });

  it('resolves connections by name and by id', () => {
    const text = [
      '-- @dashboard: Connections',
      '',
      '-- @block: By name',
      '-- @type: chart',
      '-- @layout: 0,0,6,4',
      '-- @connection: warehouse',
      'SELECT 1 AS x',
      '',
      '-- @block: By id',
      '-- @type: chart',
      '-- @layout: 0,4,6,4',
      '-- @connection: 1',
      'SELECT 2 AS x',
      '',
    ].join('\n');

    const { dashboard, diagnostics } = parseManifest(text, connections);
    expect(diagnostics).toEqual([]);
    expect(dashboard.items.map((item) => item.connectionId)).toEqual([1, 1]);
  });

  it('resolves hyphenated @saved-query and falls back to its SQL', () => {
    const text = [
      '-- @dashboard: Saved',
      '',
      '-- @block: Monthly',
      '-- @type: chart',
      '-- @layout: 0,0,6,4',
      '-- @connection: 1',
      '-- @saved-query: Monthly Revenue',
      '',
    ].join('\n');

    const { dashboard, diagnostics } = parseManifest(text, connections, savedQueries);
    expect(diagnostics).toEqual([]);
    expect(dashboard.items[0].savedQueryId).toBe(5);
    expect(dashboard.items[0].sql).toBe('SELECT month, revenue FROM sales');
  });

  it('keeps chart annotations in SQL but strips manifest-owned ones', () => {
    const text = serializeManifest(fullDashboard, connections, savedQueries);
    const chart = parseManifest(text, connections, savedQueries).dashboard.items[0];

    expect(chart.sql).toContain('-- @viz: line');
    expect(chart.sql).not.toContain('@layout');
    expect(chart.sql).not.toContain('@timeFormat');
    expect(chart.config).toEqual({ timeFormat: '%Y-%m' });
  });

  it('propagates dashboard theme and colors into chart SQL', () => {
    const text = [
      '-- @dashboard: Themed',
      '-- @theme: swiss',
      '-- @colors: #111, #222',
      '',
      '-- @block: Chart',
      '-- @type: chart',
      '-- @layout: 0,0,6,4',
      '-- @connection: 1',
      'SELECT 1 AS x',
      '',
    ].join('\n');

    const { dashboard } = parseManifest(text, connections);
    expect(dashboard.theme).toBe('swiss');
    expect(dashboard.colors).toEqual(['#111', '#222']);
    expect(dashboard.items[0].sql).toBe('-- @colors: #111, #222\n-- @theme: swiss\nSELECT 1 AS x');
  });

  it('infers block types when @type is absent', () => {
    const text = [
      '-- @dashboard: Inferred',
      '',
      '-- @block: A metric',
      '-- @layout: 0,0,3,3',
      '-- @connection: 1',
      '-- @metric: total',
      'SELECT 1 AS total',
      '',
      '-- @block: A table',
      '-- @layout: 0,3,6,4',
      '-- @connection: 1',
      '-- @columns: a, b',
      'SELECT 1 AS a, 2 AS b',
      '',
      '-- @block: A note',
      '-- @layout: 0,7,12,3',
      '/*',
      'Hello',
      '*/',
      '',
      '-- @block: A chart',
      '-- @layout: 0,10,6,4',
      '-- @connection: 1',
      'SELECT 1 AS x',
      '',
    ].join('\n');

    const { dashboard, diagnostics } = parseManifest(text, connections);
    expect(dashboard.items.map((item) => item.blockType)).toEqual([
      'metric',
      'table',
      'text',
      'chart',
    ]);
    expect(diagnostics.filter((d) => d.code === 'BLOCK_TYPE_INFERRED')).toHaveLength(4);
  });

  it('tolerates a @spec header', () => {
    const text = [
      '-- @spec: 1',
      '-- @dashboard: Versioned',
      '',
      '-- @block: Chart',
      '-- @type: chart',
      '-- @layout: 0,0,6,4',
      '-- @connection: 1',
      'SELECT 1 AS x',
      '',
    ].join('\n');

    const { dashboard, diagnostics } = parseManifest(text, connections);
    expect(diagnostics).toEqual([]);
    expect(dashboard.name).toBe('Versioned');
  });

  it('round-trips @extra payloads at dashboard and block level', () => {
    const text = serializeManifest(fullDashboard, connections, savedQueries);
    expect(text).toContain('-- @extra: {"refreshSeconds":300}');

    const { dashboard, diagnostics } = parseManifest(text, connections, savedQueries);
    expect(diagnostics).toEqual([]);
    expect(dashboard.extra).toEqual({ refreshSeconds: 300 });
  });

  it('reports an unsupported spec version', () => {
    const { diagnostics } = parseManifest(
      ['-- @spec: 99', '-- @dashboard: Future', '', '-- @block: Chart', '-- @type: chart', 'SELECT 1 AS x', ''].join('\n'),
      connections,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'UNSUPPORTED_SPEC' }),
    );
  });

  it('reports malformed @extra JSON', () => {
    const { diagnostics } = parseManifest(
      [
        '-- @spec: 1',
        '-- @dashboard: Broken',
        '',
        '-- @block: Chart',
        '-- @type: chart',
        '-- @layout: 0,0,6,4',
        '-- @connection: 1',
        '-- @extra: {nope',
        'SELECT 1 AS x',
        '',
      ].join('\n'),
      connections,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'INVALID_EXTRA' }),
    );
  });
});

describe('parseManifest diagnostics', () => {
  const parse = (body: string) => parseManifest(body, connections).diagnostics;

  it('reports an unknown connection', () => {
    const diagnostics = parse(
      [
        '-- @dashboard: Bad',
        '',
        '-- @block: Chart',
        '-- @type: chart',
        '-- @layout: 0,0,6,4',
        '-- @connection: nowhere',
        'SELECT 1 AS x',
        '',
      ].join('\n'),
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'UNKNOWN_CONNECTION', block: 'Chart' }),
    );
  });

  it('reports a missing connection', () => {
    const diagnostics = parse(
      ['-- @dashboard: Bad', '', '-- @block: Chart', '-- @type: chart', 'SELECT 1 AS x', ''].join(
        '\n',
      ),
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'MISSING_CONNECTION' }),
    );
  });

  it('warns about an invalid layout and falls back', () => {
    const { dashboard, diagnostics } = parseManifest(
      [
        '-- @dashboard: Bad',
        '',
        '-- @block: Chart',
        '-- @type: chart',
        '-- @layout: 1,2,3',
        '-- @connection: 1',
        'SELECT 1 AS x',
        '',
      ].join('\n'),
      connections,
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'INVALID_LAYOUT' }),
    );
    expect(dashboard.items[0].layout).toEqual({ x: 0, y: 0, w: 6, h: 8 });
  });

  it('warns when there are no blocks', () => {
    expect(parse('-- @dashboard: Empty\n')).toContainEqual(
      expect.objectContaining({ code: 'NO_BLOCKS' }),
    );
  });

  it('warns when markdown is not wrapped in a block comment', () => {
    const diagnostics = parse(
      ['-- @dashboard: Notes', '', '-- @block: Note', '-- @type: text', 'Hello', ''].join('\n'),
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'TEXT_NOT_COMMENTED' }),
    );
  });

  it('warns when a metric has no @metric', () => {
    const diagnostics = parse(
      [
        '-- @dashboard: Metrics',
        '',
        '-- @block: Total',
        '-- @type: metric',
        '-- @layout: 0,0,3,3',
        '-- @connection: 1',
        'SELECT 1 AS total',
        '',
      ].join('\n'),
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'METRIC_COLUMN_MISSING' }),
    );
  });

  it('rejects @viz on a metric block', () => {
    const diagnostics = parse(
      [
        '-- @dashboard: Metrics',
        '',
        '-- @block: Total',
        '-- @type: metric',
        '-- @metric: total',
        '-- @viz: bar',
        '-- @layout: 0,0,3,3',
        '-- @connection: 1',
        'SELECT 1 AS total',
        '',
      ].join('\n'),
    );

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'VIZ_ON_METRIC' }),
    );
  });
});
