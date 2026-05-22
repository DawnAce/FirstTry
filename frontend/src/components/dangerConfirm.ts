export function isIssueNumberConfirmationValid(input: string, issueNumber: number): boolean {
  return input.trim() === String(issueNumber);
}

export function stopIssueDeleteModalPropagation(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}
