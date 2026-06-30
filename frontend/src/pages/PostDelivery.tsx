import { Card, Empty, Typography } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

export default function PostDelivery() {
  return (
    <div>
      <Title level={3}>物流管理 · 邮局投递</Title>
      <Card>
        <Empty
          image={<InboxOutlined style={{ fontSize: 56, color: '#cbd5e1' }} />}
          description={
            <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'left' }}>
              <Paragraph style={{ marginBottom: 8 }}>
                <Text strong>邮局投递</Text> 板块占位页 —— 用于管理走
                <Text strong>邮局（post_office）</Text>渠道的投递清单，与「ZTO-MF（中通）」并列。
              </Paragraph>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                目前尚未接入具体功能。可行做法：复用发货明细，按渠道 = 邮局过滤，提供录入 / 导入 /
                导出邮局投递清单。告诉我这里要放什么，我来接。
              </Paragraph>
            </div>
          }
        />
      </Card>
    </div>
  );
}
