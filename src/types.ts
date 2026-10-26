export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  column?: string;
}

export type Backend = 'echarts' | 'vegalite' | 'chartjs' | 'plotly';

export interface FlintChartSpec {
  data: { values: Record<string, unknown>[] };
  semantic_types?: Record<string, string>;
  chart_spec: {
    chartType: string;
    title?: string;
    subtitle?: string;
    encodings: Record<string, string>;
    [key: string]: unknown;
  };
  theme_spec?: string;
  interaction_spec?: Record<string, unknown>;
  options?: Record<string, unknown>;
  field_display_names?: Record<string, string>;
  [key: string]: unknown;
}

export interface CompileOptions {
  sql: string;
  data: Record<string, unknown>[];
  theme?: string;
  backend?: Backend;
  backends?: Backend[];
}

export interface CompileResult {
  flint: FlintChartSpec;
  echarts: Record<string, unknown> | null;
  compiled: Partial<Record<Backend, Record<string, unknown>>>;
  diagnostics: Diagnostic[];
}
