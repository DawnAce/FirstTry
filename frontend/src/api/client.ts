import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

const requestStartedAt = new WeakMap<object, number>();

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  requestStartedAt.set(config, performance.now());
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (response) => {
    if (import.meta.env.DEV) {
      const startedAt = requestStartedAt.get(response.config);
      const elapsed = startedAt == null ? 0 : performance.now() - startedAt;
      console.info(
        `[api-performance] ${response.config.method?.toUpperCase()} ${response.config.url}`,
        `${elapsed.toFixed(1)}ms`,
        response.headers['server-timing'] ?? '',
      );
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401 && !error.config.url?.includes('/auth/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
