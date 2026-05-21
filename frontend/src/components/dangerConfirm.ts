export function isIssueNumberConfirmationValid(input: string, issueNumber: number): boolean {
  return input.trim() === String(issueNumber);
}
