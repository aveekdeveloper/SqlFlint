/**
 * `-- @key: value`. Keys may contain letters, digits, `_` and `-`
 * (hyphenated keys such as `@saved-query` are part of the manifest grammar).
 */
export const ANNOTATION_PATTERN = /^--\s*@([a-zA-Z0-9_-]+):\s*(.*?)\s*$/;

/**
 * Parse only leading SQL comment annotations.
 * Format: -- @key: value
 *
 * Leading blank lines and ordinary comments are allowed.
 * Parsing stops at the first SQL statement line.
 */
export function parseAnnotations(sql: string): Record<string, string> {
  const annotations: Record<string, string> = {};

  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (!trimmed.startsWith('--')) break;

    const match = trimmed.match(ANNOTATION_PATTERN);

    if (match) {
      annotations[match[1].toLowerCase()] = match[2];
    }
  }

  return annotations;
}

/**
 * Set, replace, or remove one annotation in a SQL string.
 *
 * The annotation block stays leading; when the key is absent a new
 * annotation is inserted after the existing annotation block, so the
 * SQL body is never touched. `value === null` removes the annotation.
 */
export function setAnnotation(
  sql: string,
  key: string,
  value: string | null,
): string {
  const lines = sql.split(/\r?\n/);
  const targetKey = key.toLowerCase();
  const pattern = new RegExp(`^--\\s*@${targetKey}:`, 'i');

  let lastCommentIndex = -1;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!trimmed) continue;

    if (!trimmed.startsWith('--')) break;

    if (pattern.test(trimmed)) {
      if (value === null) {
        lines.splice(i, 1);
      } else {
        lines[i] = `-- @${targetKey}: ${value}`;
      }
      found = true;
      break;
    }

    lastCommentIndex = i;
  }

  if (!found && value !== null) {
    const line = `-- @${targetKey}: ${value}`;
    if (lastCommentIndex === -1) {
      lines.unshift(line);
    } else {
      lines.splice(lastCommentIndex + 1, 0, line);
    }
  }

  return lines.join('\n');
}

/**
 * Parse `-- @semantic: column: Type, other: Type` overrides.
 */
export function parseSemanticOverrides(
  value: string | undefined,
): Record<string, string> {
  const overrides: Record<string, string> = {};

  if (!value) return overrides;

  for (const pair of value.split(',')) {
    const separator = pair.indexOf(':');

    if (separator === -1) continue;

    const column = pair.slice(0, separator).trim();
    const type = pair.slice(separator + 1).trim();

    if (column && type) overrides[column] = type;
  }

  return overrides;
}
