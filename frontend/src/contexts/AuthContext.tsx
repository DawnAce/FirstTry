import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { getMe } from '../api/auth';
import type { UserInfo } from '../api/auth';

interface AuthContextType {
  user: UserInfo | null;
  isAdmin: boolean;
  isLoggedIn: boolean;
  setAuth: (token: string, user: UserInfo) => void;
  logout: () => void;
}

// 导出 context 本身，便于 Storybook 等通过 Provider 注入假登录态
export const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  isLoggedIn: false,
  setAuth: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      // Always validate token with backend on startup
      getMe().then(res => {
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
      }).catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      });
    } else {
      // No token — clear any stale user data
      localStorage.removeItem('user');
      setUser(null);
    }
  }, []);

  const setAuth = (token: string, userInfo: UserInfo) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userInfo));
    setUser(userInfo);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAdmin: user?.role === 'admin',
      isLoggedIn: !!user,
      setAuth,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
