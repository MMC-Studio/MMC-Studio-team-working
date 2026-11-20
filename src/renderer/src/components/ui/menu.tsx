import { DropdownMenu } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/** Menu thả xuống nhỏ (vd ⋯ của dự án): bàn phím, Esc, bấm ra ngoài đều do radix lo. */
export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent({ className, children, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={4}
        className={cn(
          'z-50 min-w-40 rounded-lg border bg-card p-1 text-sm shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0',
          className
        )}
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  )
}

export function MenuItem({
  className,
  icon,
  destructive,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & { icon?: ReactNode; destructive?: boolean }) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground',
        destructive && 'text-destructive [&_svg]:text-destructive',
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  )
}
