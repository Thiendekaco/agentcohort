/**
 * Minimal, dependency-free, cross-platform colored logger.
 *
 * Color is disabled automatically when:
 *  - stdout is not a TTY (piped / redirected output), or
 *  - the NO_COLOR env var is set (https://no-color.org), or
 *  - FORCE_COLOR=0.
 *
 * The Logger is an injectable interface so tests can capture output instead
 * of writing to the real console.
 */

export interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  plain(msg: string): void;
}

const ESC = String.fromCharCode(27);
const RAW = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  cyan: `${ESC}[36m`,
  gray: `${ESC}[90m`,
} as const;

type ColorName = keyof typeof RAW;

export function colorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR === '0') return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout && process.stdout.isTTY);
}

export function makePaint(enabled: boolean) {
  return (text: string, ...names: ColorName[]): string => {
    if (!enabled || names.length === 0) return text;
    const open = names.map((n) => RAW[n]).join('');
    return `${open}${text}${RAW.reset}`;
  };
}

export interface ConsoleLike {
  log(msg: string): void;
  error(msg: string): void;
}

export function createLogger(
  opts: { console?: ConsoleLike; color?: boolean } = {}
): Logger {
  const sink: ConsoleLike = opts.console ?? {
    log: (m) => process.stdout.write(m + '\n'),
    error: (m) => process.stderr.write(m + '\n'),
  };
  const enabled = opts.color ?? colorEnabled();
  const p = makePaint(enabled);

  return {
    plain: (m) => sink.log(m),
    info: (m) => sink.log(`${p('•', 'cyan')} ${m}`),
    success: (m) => sink.log(`${p('✓', 'green')} ${m}`),
    warn: (m) => sink.log(`${p('!', 'yellow')} ${m}`),
    error: (m) => sink.error(`${p('✗', 'red')} ${m}`),
  };
}

/** Shared painter for one-off styling outside the Logger (banners, summaries). */
export const paint = makePaint(colorEnabled());
