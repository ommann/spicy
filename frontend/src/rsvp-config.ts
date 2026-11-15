/** Code-only RSVP tuning. Changes apply on reload; no settings UI or storage. */
export interface RsvpConfig {
  wpm: number;
  minWpm: number;
  maxWpm: number;
  speedStep: number;
  seekStep: number;
  startDelayMs: number;
  speedIndicatorMs: number;
  pacing: 'punctuation' | 'steady';
  sentenceMultiplier: number;
  clauseMultiplier: number;
  dashMultiplier: number;
  emphasis: 'all' | 'markdown' | 'code' | 'none';
  highlightFocus: boolean;
  alignment: 'focal' | 'center';
  focalOffsetCh: number;
  fontFamily: string;
  fontSize: { minPx: number; viewportVw: number; maxPx: number };
  fontWeight: number;
  boldWeight: number;
  lineHeight: number;
  textOffsetYPx: number;
  countdown: boolean;
  underlineThicknessPx: number;
  underlineGapPx: number;
}

export const rsvpConfig: Readonly<RsvpConfig> = {
  wpm: 400,
  minWpm: 100,
  maxWpm: 1000,
  speedStep: 25,
  seekStep: 10,
  startDelayMs: 500,
  speedIndicatorMs: 1200,
  // 'steady' gives every token equal time; 'punctuation' uses the multipliers.
  pacing: 'punctuation',
  sentenceMultiplier: 2,
  clauseMultiplier: 1.5,
  dashMultiplier: 1.3,
  // 'markdown': bold/italic/strike; 'code': inline-code color only.
  emphasis: 'none',
  highlightFocus: true,
  alignment: 'focal',
  // Position the focal center slightly left of the viewport center; 0 centers it.
  focalOffsetCh: -2,
  // Proportional type is less widely spaced than the chat's monospace at RSVP sizes.
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: { minPx: 36, viewportVw: 5.5, maxPx: 62 },
  fontWeight: 400,
  boldWeight: 700,
  lineHeight: 1.1,
  textOffsetYPx: -5,
  countdown: true,
  underlineThicknessPx: 3,
  underlineGapPx: 3,
};
