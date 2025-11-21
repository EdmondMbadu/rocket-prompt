import type { UrlMatchResult, UrlSegment } from '@angular/router';

/**
 * Matches URL patterns like `/some-slug/GPT` or `/some-slug/Grok`.
 * Keeps conflicts low by only consuming URLs whose second segment is gpt/grok.
 */
export function promptLaunchMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length !== 2) {
    return null;
  }

  const [slugSegment, targetSegment] = segments;
  const target = targetSegment.path.toLowerCase();

  if (target !== 'gpt' && target !== 'grok') {
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
