import { describe, expect, it } from 'vitest';
import { isIssueNumberConfirmationValid, stopIssueDeleteModalPropagation } from './dangerConfirm';

describe('isIssueNumberConfirmationValid', () => {
  it('requires the typed issue number to match exactly after trimming', () => {
    expect(isIssueNumberConfirmationValid('2652', 2652)).toBe(true);
    expect(isIssueNumberConfirmationValid(' 2652 ', 2652)).toBe(true);
    expect(isIssueNumberConfirmationValid('2653', 2652)).toBe(false);
    expect(isIssueNumberConfirmationValid('', 2652)).toBe(false);
  });
});

describe('stopIssueDeleteModalPropagation', () => {
  it('stops modal clicks from bubbling to a parent issue row', () => {
    let stopped = false;

    stopIssueDeleteModalPropagation({
      stopPropagation: () => {
        stopped = true;
      },
    });

    expect(stopped).toBe(true);
  });
});
