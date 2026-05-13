export type Palette = {
  bg: string; surface: string; surface2: string; raised: string;
  ink: string; muted: string; subtle: string; faint: string;
  border: string; borderHi: string;
  accent: string; accentInk: string; accentBg: string;
  error: string; errorBg: string;
  success: string; successBg: string;
  warn: string;
  userBubble: string;
};

export const DODO_LIGHT: Palette = {
  bg:        '#f5f2ea',
  surface:   '#fbfaf5',
  surface2:  '#ffffff',
  raised:    '#ffffff',
  ink:       '#1a1813',
  muted:     '#6b6457',
  subtle:    '#9c9684',
  faint:     '#c5beac',
  border:    '#dcd6c7',
  borderHi:  '#c7c0ad',
  accent:    '#6b4ea3',
  accentInk: '#3d2a66',
  accentBg:  '#ece5f7',
  error:     '#b8442e',
  errorBg:   '#f7e6e0',
  success:   '#4a7a4a',
  successBg: '#e3eede',
  warn:      '#a87a1f',
  userBubble:'#ebe6d8',
};

export const DODO_DARK: Palette = {
  bg:        '#15131a',
  surface:   '#1e1b25',
  surface2:  '#26222e',
  raised:    '#2a2632',
  ink:       '#ebe7f0',
  muted:     '#8d869a',
  subtle:    '#6a6478',
  faint:     '#3e394a',
  border:    '#322d3c',
  borderHi:  '#433d50',
  accent:    '#a583da',
  accentInk: '#cdb6f0',
  accentBg:  '#2a2138',
  error:     '#dc7a63',
  errorBg:   '#3a221c',
  success:   '#86b285',
  successBg: '#1f2c1f',
  warn:      '#d4a85a',
  userBubble:'#2a2632',
};

export const DODO_FONT = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace';
export const DODO_FONT_SANS = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif';

export const PANEL_W = 400;
export const PANEL_H = 860;
