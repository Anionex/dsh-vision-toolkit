import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: string
  variant?: string
  children?: ReactNode
}

/** Test-only HTML substitute for the host button component. */
export function Button({ size, variant, ...props }: ButtonProps): ReactNode {
  return <button data-size={size} data-variant={variant} {...props} />
}

/** Test-only HTML substitute for the host input component. */
export function Input(props: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input {...props} />
}
