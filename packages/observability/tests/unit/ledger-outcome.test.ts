import { trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotateLedgerOutcome } from '../../src/ledger-metrics.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('annotateLedgerOutcome', () => {
  it('adds safe attributes to the active span', () => {
    const setAttribute = vi.fn();

    const span = {
      setAttribute,
    } as unknown as Span;

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span);

    annotateLedgerOutcome('posted', 2);

    expect(setAttribute).toHaveBeenCalledWith('ledger.operation', 'post_journal');

    expect(setAttribute).toHaveBeenCalledWith('ledger.outcome', 'posted');

    expect(setAttribute).toHaveBeenCalledWith('ledger.posting_count', 2);

    expect(setAttribute).toHaveBeenCalledWith('db.system.name', 'postgresql');

    expect(setAttribute).toHaveBeenCalledTimes(4);
  });

  it('does not add a posting count for failed operations', () => {
    const setAttribute = vi.fn();

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      setAttribute,
    } as unknown as Span);

    annotateLedgerOutcome('failed');

    expect(setAttribute).not.toHaveBeenCalledWith('ledger.posting_count', expect.anything());
  });

  it('ignores invalid posting counts', () => {
    const setAttribute = vi.fn();

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      setAttribute,
    } as unknown as Span);

    annotateLedgerOutcome('posted', -1);

    expect(setAttribute).not.toHaveBeenCalledWith('ledger.posting_count', -1);
  });

  it('does not throw when no span is active', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);

    expect(() => {
      annotateLedgerOutcome('replayed', 2);
    }).not.toThrow();
  });

  it('does not propagate telemetry attribute failures', () => {
    const setAttribute = vi.fn(() => {
      throw new Error('Telemetry unavailable');
    });

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      setAttribute,
    } as unknown as Span);

    expect(() => {
      annotateLedgerOutcome('conflict');
    }).not.toThrow();
  });
});
