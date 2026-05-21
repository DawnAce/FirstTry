import { describe, expect, it } from 'vitest';
import { isIssueNumberConfirmationValid } from './dangerConfirm';

describe('isIssueNumberConfirmationValid', () => {
  it('requires the typed issue number to match exactly after trimming', () => {
    expect(isIssueNumberConfirmationValid('2652', 2652)).toBe(true);
    expect(isIssueNumberConfirmationValid(' 2652 ', 2652)).toBe(true);
    expect(isIssueNumberConfirmationValid('2653', 2652)).toBe(false);
    expect(isIssueNumberConfirmationValid('', 2652)).toBe(false);
  });
});
