import type { FilterStatus } from '../core/types.ts';

// Popup states remain immediate. Only the large in-player loading notice has
// a grace period, so normal caption redraws do not flash a warning. Real
// unavailable/error states (including missing dub CC) are always immediate.
export class CoverageBanner {
  private loading = new Map<string, number>();
  text(
    statuses: Record<'audio' | 'subtitles', FilterStatus>,
    enabled: boolean,
    now: number,
  ): string {
    if (!enabled) {
      this.loading.clear();
      return '';
    }
    const reasons: string[] = [];
    for (const kind of ['audio', 'subtitles'] as const) {
      const status = statuses[kind];
      if (status.phase === 'loading') {
        const since = this.loading.get(kind) ?? now;
        this.loading.set(kind, since);
        if (now - since >= 1500) reasons.push(status.reason);
      } else {
        this.loading.delete(kind);
        if (status.phase === 'unavailable' || status.phase === 'error') reasons.push(status.reason);
      }
    }
    return reasons.join('\n');
  }
}
