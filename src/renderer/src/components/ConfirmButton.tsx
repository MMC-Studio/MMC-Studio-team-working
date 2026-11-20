import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@renderer/components/ui/button'

/**
 * Nút làm việc khó hoàn tác (gỡ skill / MCP server, ngắt tài khoản Gmail, đăng xuất Telegram): bấm lần đầu chỉ đổi thành
 * nút đỏ "… hẳn?" (testid `<testId>-confirm`), bấm lần hai trong 4 giây mới chạy. Hết 4 giây → về như cũ.
 */
export function ConfirmButton({
  icon,
  label,
  confirmLabel,
  onConfirm,
  testId,
  size = 'sm',
  variant = 'outline',
  disabled
}: {
  icon?: ReactNode
  label: ReactNode
  confirmLabel: ReactNode
  onConfirm(): void
  testId: string
  size?: 'sm' | 'icon-sm'
  variant?: 'outline' | 'ghost'
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])

  if (armed) {
    return (
      <Button
        size="sm"
        variant="destructive"
        disabled={disabled}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
        data-testid={`${testId}-confirm`}
      >
        {confirmLabel}
      </Button>
    )
  }
  return (
    <Button size={size} variant={variant} disabled={disabled} onClick={() => setArmed(true)} data-testid={testId}>
      {icon}
      {label}
    </Button>
  )
}
