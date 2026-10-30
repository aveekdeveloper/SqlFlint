#!/usr/bin/env node
/**
 * sqlflint CLI.
 *
 *   sqlflint manifest check <file> [--connections <json>] [--saved-queries <json>] [--json]
 *   sqlflint manifest format <file> [--connections <json>] [--saved-queries <json>]
 *   sqlflint manifest spec
 *
 * `check` exits 1 when the manifest has error-severity diagnostics.
 * `format` prints the canonical serialization (useful for migrations).
 *
 * Connection lists may be a JSON array (`[{"id":1,"name":"warehouse"}]`)
 * or an id→name object (`{"1":"warehouse"}`).
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  MANIFEST_SPEC_VERSION,
  parseManifest,
  serializeManifest,
  type ManifestConnection,
  type ManifestSavedQuery,
} from './manifest.js';

const USAGE = `sqlflint ${MANIFEST_SPEC_VERSION}

Usage:
  sqlflint manifest check <file> [--connections <json>] [--saved-queries <json>] [--json]
  sqlflint manifest format <file> [--connections <json>] [--saved-queries <json>]
  sqlflint manifest spec

Options:
  --connections    JSON array [{"id":1,"name":"warehouse"}] or {"1":"warehouse"}
  --saved-queries  JSON array [{"id":1,"name":"Monthly","sql":"...","connectionId":1}]
  --json           machine-readable diagnostics (check only)
`;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Thrown internally when the CLI should stop with a usage error (exit 2). */
class UsageError extends Error {}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new UsageError(`${name} requires a value.`);
  return value;
}

function parseConnections(raw: string | undefined): ManifestConnection[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError('--connections is not valid JSON.');
  }
  if (Array.isArray(parsed)) {
    return parsed.map((entry) => ({
      id: Number((entry as ManifestConnection).id),
      name: String((entry as ManifestConnection).name ?? ''),
    }));
  }
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed as Record<string, unknown>).map(([id, name]) => ({
      id: Number(id),
      name: String(name),
    }));
  }
  throw new UsageError('--connections must be a JSON array or object.');
}

function parseSavedQueries(raw: string | undefined): ManifestSavedQuery[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError('--saved-queries is not valid JSON.');
  }
  if (!Array.isArray(parsed)) throw new UsageError('--saved-queries must be a JSON array.');
  return (parsed as ManifestSavedQuery[]).map((entry) => ({
    id: Number(entry.id),
    name: String(entry.name ?? ''),
    sql: String(entry.sql ?? ''),
    connectionId: Number(entry.connectionId ?? 0),
  }));
}

/**
 * Run the CLI. Pure with respect to process state: file contents come from
 * `readFile`, and the result is returned instead of written to stdio.
 */
export function run(
  argv: string[],
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): CliResult {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { exitCode: 0, stdout: USAGE, stderr: '' };
  }

  try {
    if (args[0] !== 'manifest') throw new UsageError(`Unknown command '${args[0]}'.`);
    const command = args[1];
    if (!command) throw new UsageError('Missing manifest command (check | format | spec).');

    if (command === 'spec') {
      return { exitCode: 0, stdout: `${MANIFEST_SPEC_VERSION}\n`, stderr: '' };
    }

    const file = args[2];
    if (!file) throw new UsageError('Missing manifest file.');
    const code = readFile(file);
    const connections = parseConnections(option(args, '--connections'));
    const savedQueries = parseSavedQueries(option(args, '--saved-queries'));
    const { dashboard, diagnostics } = parseManifest(code, connections, savedQueries);

    if (command === 'format') {
      return {
        exitCode: 0,
        stdout: serializeManifest(dashboard, connections, savedQueries),
        stderr: '',
      };
    }

    if (command !== 'check') throw new UsageError(`Unknown manifest command '${command}'.`);

    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (args.includes('--json')) {
      return {
        exitCode: errors.length > 0 ? 1 : 0,
        stdout: `${JSON.stringify({ diagnostics, errorCount: errors.length }, null, 2)}\n`,
        stderr: '',
      };
    }
    if (diagnostics.length === 0) {
      return { exitCode: 0, stdout: `${file}: ok\n`, stderr: '' };
    }
    const lines = diagnostics.map((diagnostic) => {
      const where = diagnostic.block ? ` [${diagnostic.block}]` : '';
      return `${file}: ${diagnostic.severity} ${diagnostic.code}${where}: ${diagnostic.message}\n`;
    });
    return { exitCode: errors.length > 0 ? 1 : 0, stdout: lines.join(''), stderr: '' };
  } catch (error) {
    if (error instanceof UsageError) {
      return { exitCode: 2, stdout: '', stderr: `${error.message}\n\n${USAGE}` };
    }
    throw error;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const result = run(process.argv);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
