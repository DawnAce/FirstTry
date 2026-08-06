import { describe, expect, it } from 'vitest';
import { capabilitiesForRole } from './permissions';

describe('role capabilities', () => {
  it('keeps viewer accounts strictly read-only', () => {
    expect(capabilitiesForRole('viewer')).toEqual({
      isAdmin: false,
      isViewer: true,
      canMutate: false,
      canDownload: true,
    });
  });

  it('allows operators to perform normal writes without admin privileges', () => {
    expect(capabilitiesForRole('operator')).toMatchObject({
      isAdmin: false,
      isViewer: false,
      canMutate: true,
    });
  });

  it('fails closed for unknown or missing roles', () => {
    expect(capabilitiesForRole('unexpected').canMutate).toBe(false);
    expect(capabilitiesForRole(null).canDownload).toBe(false);
  });
});
