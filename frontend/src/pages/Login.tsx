import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { login } from '../api/auth';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

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
      message.success(`欢迎，${username}`);
      navigate('/');
    } catch (err: any) {
      message.error(err.response?.data?.detail || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-label="发行系统介绍">
        <div className="login-dot-field" />
        <div className="login-brand">
          <div className="login-brand-mark">发</div>
          <div>
            <strong>发行系统</strong>
            <span>中国经营报</span>
          </div>
        </div>

        <div className="login-story-copy">
          <span className="login-overline">发行全链路协同平台</span>
          <h1>让每一份发行数据，<br />都清晰抵达。</h1>
          <p>从订单、印数到投递与结算，让复杂的发行工作回到一条清楚、可靠的业务链路。</p>

          <div className="login-workflow" aria-label="核心业务流程">
            <div className="login-workflow-head">
              <strong>核心业务流程</strong>
              <span className="login-live">系统服务正常</span>
            </div>
            <div className="login-steps">
              <div className="login-step"><i>01</i><b>订单归集</b><small>多渠道统一</small></div>
              <div className="login-step"><i>02</i><b>印数管理</b><small>数据可追溯</small></div>
              <div className="login-step"><i>03</i><b>发行履约</b><small>进度可查看</small></div>
              <div className="login-step"><i>04</i><b>财务结算</b><small>结果可核对</small></div>
            </div>
          </div>
        </div>

        <div className="login-story-footer">中国经营报社 · 内部业务系统</div>
      </section>

      <section className="login-panel">
        <Form
          className="login-form"
          onFinish={handleSubmit}
          autoComplete="off"
          layout="vertical"
          requiredMark={false}
        >
          <p className="login-eyebrow">WELCOME BACK</p>
          <h2>登录发行系统</h2>
          <p className="login-welcome">请输入内部账号与密码，继续处理今天的发行工作。</p>

          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input
              className="login-input"
              prefix={<UserOutlined />}
              placeholder="请输入用户名"
              autoComplete="username"
              size="large"
            />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password
              className="login-input"
              prefix={<LockOutlined />}
              placeholder="请输入密码"
              autoComplete="current-password"
              size="large"
            />
          </Form.Item>
          <Form.Item className="login-submit-item">
            <Button className="login-submit" type="primary" htmlType="submit" block size="large" loading={loading}>
              登录
            </Button>
          </Form.Item>

          <p className="login-security"><SafetyCertificateOutlined />仅限已授权人员访问，登录信息将安全传输</p>
        </Form>
        <div className="login-copyright">© 2026 中国经营报社</div>
      </section>
    </main>
  );
}
