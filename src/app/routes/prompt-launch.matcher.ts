import type { UrlMatchResult, UrlSegment } from '@angular/router';

/**
 * Matches URL patterns like `/some-slug/GPT`, `/some-slug/Grok`, `/some-slug/Claude`, or `/some-slug/ROCKET`.
 * Keeps conflicts low by only consuming URLs whose second segment is gpt/grok/claude/rocket (case-insensitive).
 */
export function promptLaunchMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length !== 2) {
    return null;
  }

  const [slugSegment, targetSegment] = segments;
  const target = targetSegment.path.toLowerCase();

  if (target !== 'gpt' && target !== 'grok' && target !== 'claude' && target !== 'rocket') {
    return null;
  }

  return {
    consumed: segments,
    posParams: {
      customUrl: slugSegment,
      target: targetSegment
    }
  };
}
