import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { getMe } from '../api/auth';
import type { UserInfo } from '../api/auth';
import { capabilitiesForRole } from '../permissions';

const AUTH_VALIDATED_AT_KEY = 'auth_validated_at';
const AUTH_VALIDATION_TTL_MS = 5 * 60 * 1000;

interface AuthContextType {
  user: UserInfo | null;
  isAdmin: boolean;
  isViewer: boolean;
  canMutate: boolean;
  isLoggedIn: boolean;
  setAuth: (token: string, user: UserInfo) => void;
  logout: () => void;
}

// 导出 context 本身，便于 Storybook 等通过 Provider 注入假登录态
export const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  isViewer: false,
  canMutate: false,
  isLoggedIn: false,
  setAuth: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const validationStartedRef = useRef(false);
  const [user, setUser] = useState<UserInfo | null>(() => {
    if (!localStorage.getItem('token')) {
      localStorage.removeItem('user');
      localStorage.removeItem(AUTH_VALIDATED_AT_KEY);
      return null;
    }
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    const lastValidated = Number(localStorage.getItem(AUTH_VALIDATED_AT_KEY) || 0);
    const shouldValidate = !storedUser || Date.now() - lastValidated >= AUTH_VALIDATION_TTL_MS;
    if (token && shouldValidate && !validationStartedRef.current) {
      validationStartedRef.current = true;
      getMe().then(res => {
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        localStorage.setItem(AUTH_VALIDATED_AT_KEY, String(Date.now()));
      }).catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem(AUTH_VALIDATED_AT_KEY);
        setUser(null);
      });
    }
  }, []);

  const setAuth = (token: string, userInfo: UserInfo) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userInfo));
    localStorage.setItem(AUTH_VALIDATED_AT_KEY, String(Date.now()));
    setUser(userInfo);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(AUTH_VALIDATED_AT_KEY);
    setUser(null);
    window.location.href = '/login';
  };

  const capabilities = capabilitiesForRole(user?.role);

  return (
    <AuthContext.Provider value={{
      user,
      isAdmin: capabilities.isAdmin,
      isViewer: capabilities.isViewer,
      canMutate: capabilities.canMutate,
      isLoggedIn: !!user,
      setAuth,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
