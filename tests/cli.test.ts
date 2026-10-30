import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { MANIFEST_SPEC_VERSION } from '../src/index.js';

const manifest = [
  '-- @spec: 1',
  '-- @dashboard: Revenue',
  '',
  '-- @block: By month',
  '-- @type: chart',
  '-- @layout: 0,0,6,4',
  '-- @connection: warehouse',
  '-- @viz: line',
  '-- @x: month',
  '-- @y: revenue',
  'SELECT month, revenue FROM sales',
  '',
].join('\n');

const read = () => manifest;
const connections = JSON.stringify([{ id: 1, name: 'warehouse' }]);

describe('sqlflint cli', () => {
  it('prints the spec version', () => {
    const result = run(['node', 'sqlflint', 'manifest', 'spec']);
    expect(result).toEqual({ exitCode: 0, stdout: `${MANIFEST_SPEC_VERSION}\n`, stderr: '' });
  });

  it('checks a valid manifest', () => {
    const result = run(
      ['node', 'sqlflint', 'manifest', 'check', 'dashboard.sql', '--connections', connections],
      read,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('dashboard.sql: ok\n');
  });

  it('exits 1 on error diagnostics and reports them', () => {
    const result = run(
      ['node', 'sqlflint', 'manifest', 'check', 'dashboard.sql', '--connections', '[]'],
      read,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('error UNKNOWN_CONNECTION [By month]');
  });

  it('emits machine-readable diagnostics with --json', () => {
    const result = run(
      [
        'node',
        'sqlflint',
        'manifest',
        'check',
        'dashboard.sql',
        '--connections',
        '[]',
        '--json',
      ],
      read,
    );
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as { errorCount: number };
    expect(payload.errorCount).toBe(1);
  });

  it('formats a manifest canonically', () => {
    const result = run(
      ['node', 'sqlflint', 'manifest', 'format', 'dashboard.sql', '--connections', connections],
      read,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith('-- @spec: 1\n-- @dashboard: Revenue\n')).toBe(true);
    expect(result.stdout).toContain('-- @connection: 1');
  });

  it('accepts an id→name connection object', () => {
    const result = run(
      [
        'node',
        'sqlflint',
        'manifest',
        'check',
        'dashboard.sql',
        '--connections',
        JSON.stringify({ '1': 'warehouse' }),
      ],
      read,
    );
    expect(result.exitCode).toBe(0);
  });

  it('returns usage errors with exit code 2', () => {
    const result = run(['node', 'sqlflint', 'manifest', 'check', 'x.sql', '--connections', '{'], read);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--connections is not valid JSON.');
  });

  it('shows usage with no arguments', () => {
    const result = run(['node', 'sqlflint'], read);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });
});
