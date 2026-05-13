const PREFIX = '%c[dodo]';
const STYLE = 'color:#6b4ea3;font-weight:600';

export const log = {
  info: (...args: unknown[]) => console.log(PREFIX, STYLE, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, STYLE, ...args),
  err: (...args: unknown[]) => console.error(PREFIX, STYLE, ...args),
  group: (label: string) => console.groupCollapsed(PREFIX + ' ' + label, STYLE),
  groupEnd: () => console.groupEnd(),
};
