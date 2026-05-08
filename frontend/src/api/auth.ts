import api from './client';

export interface LoginData {
  username: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: string;
}

export interface UserInfo {
  id: number;
  username: string;
  role: string;
}

export const login = (data: LoginData) =>
  api.post<AuthResponse>('/auth/login', data);

export const getMe = () =>
  api.get<UserInfo>('/auth/me');
