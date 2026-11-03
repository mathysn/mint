import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from 'react';
import { Link } from 'react-router';
import s from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'ghost';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: 44 | 48 | 52 | 56;
  /** Primary only: bevel size (12 px default) or none (flat confirm buttons). */
  bevel?: 12 | 10 | 14 | 'none';
  block?: boolean;
  /** Renders a router link instead of a button. */
  to?: string;
  /** Router state of that link ("← Back" targets). */
  linkState?: unknown;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'primary', size = 48, bevel = 12, block, to, linkState, children, className, ...rest }: Props) {
  const classes = [
    s.btn,
    s[variant],
    s[`s${size}`],
    variant === 'primary' && bevel === 'none' && s.flat,
    variant === 'primary' && bevel === 10 && s.bevel10,
    variant === 'primary' && bevel === 14 && s.bevel14,
    block && s.block,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  if (to) {
    return (
      <Link to={to} state={linkState} className={classes} style={rest.style} aria-label={rest['aria-label']}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}

/** Mono note inside a button, e.g. "Recycle +2,500 CR". */
export const ButtonNote = ({ children }: { children: ReactNode }) => <span className={s.btnNote}>{children}</span>;
