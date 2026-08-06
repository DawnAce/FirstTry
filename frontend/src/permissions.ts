export type AppRole = 'admin' | 'operator' | 'viewer';

export interface RoleCapabilities {
  isAdmin: boolean;
  isViewer: boolean;
  canMutate: boolean;
  canDownload: boolean;
}

const ROLE_CAPABILITIES: Record<AppRole, RoleCapabilities> = {
  admin: { isAdmin: true, isViewer: false, canMutate: true, canDownload: true },
  operator: { isAdmin: false, isViewer: false, canMutate: true, canDownload: true },
  viewer: { isAdmin: false, isViewer: true, canMutate: false, canDownload: true },
};

export function capabilitiesForRole(role: string | null | undefined): RoleCapabilities {
  if (role === 'admin' || role === 'operator' || role === 'viewer') return ROLE_CAPABILITIES[role];
  return { isAdmin: false, isViewer: false, canMutate: false, canDownload: false };
}
