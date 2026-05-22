import { useState } from 'react';
import { Alert, Button, Input, Modal, Typography } from 'antd';
import type { ButtonProps } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { isIssueNumberConfirmationValid, stopIssueDeleteModalPropagation } from './dangerConfirm';

interface IssueDeleteConfirmButtonProps {
  issueNumber: number;
  onConfirm: () => Promise<void>;
  buttonProps?: ButtonProps;
  buttonText?: string;
}

export function IssueDeleteConfirmButton({
  issueNumber,
  onConfirm,
  buttonProps,
  buttonText = '删除',
}: IssueDeleteConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const isMatched = isIssueNumberConfirmationValid(confirmText, issueNumber);

  const close = () => {
    setOpen(false);
    setConfirmText('');
  };

  const handleConfirm = async () => {
    if (!isMatched) return;
    setConfirming(true);
    try {
      await onConfirm();
      close();
    } finally {
      setConfirming(false);
    }
  };

  const { onClick, ...restButtonProps } = buttonProps ?? {};

  return (
    <>
      <Button
        danger
        icon={<DeleteOutlined />}
        {...restButtonProps}
        onClick={(event) => {
          onClick?.(event);
          setOpen(true);
        }}
      >
        {buttonText}
      </Button>
      <Modal
        title={`强确认：删除第 ${issueNumber} 期`}
        open={open}
        okText="确认删除整期"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: !isMatched }}
        confirmLoading={confirming}
        onOk={handleConfirm}
        onCancel={close}
        modalRender={(node) => (
          <div
            onClick={stopIssueDeleteModalPropagation}
            onMouseDown={stopIssueDeleteModalPropagation}
          >
            {node}
          </div>
        )}
      >
        <Alert
          type="error"
          showIcon
          message="此操作不可恢复"
          description="会同时删除该期报数、发货记录、临时加印和中通发货明细。请确认你要删除的是整期数据，而不是只清空中通发货明细。"
          style={{ marginBottom: 16 }}
        />
        <Typography.Paragraph>
          请输入期号 <Typography.Text strong>{issueNumber}</Typography.Text> 后才能删除。
        </Typography.Paragraph>
        <Input
          value={confirmText}
          placeholder={`输入 ${issueNumber} 确认删除`}
          onChange={(event) => setConfirmText(event.target.value)}
        />
      </Modal>
    </>
  );
}
