import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Message } from '@arco-design/web-react';
import { IconUser, IconLock } from '@arco-design/web-react/icon';
import { login } from '../api/auth';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await login(values);
      const { access_token, username, role } = res.data;
      setAuth(access_token, { id: 0, username, role });
      Message.success(`欢迎，${username}`);
      navigate('/');
    } catch (err: any) {
      Message.error(err.response?.data?.detail || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg, #f5f5f7)',
    }}>
      <div style={{
        width: 360,
        padding: 40,
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <h2 style={{ textAlign: 'center', marginBottom: 8, color: '#1d1d1f' }}>
          印数报数系统
        </h2>
        <p style={{ textAlign: 'center', color: '#86868b', marginBottom: 32, fontSize: 14 }}>
          中国经营报
        </p>
        <Form onSubmit={handleSubmit} autoComplete="off" layout="vertical" style={{ width: '100%' }}>
          <Form.Item field="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<IconUser />} placeholder="用户名" size="large" />
          </Form.Item>
          <Form.Item field="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<IconLock />} placeholder="密码" size="large" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" long size="large" loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
