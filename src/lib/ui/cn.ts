import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Склейка классов с разрешением конфликтов Tailwind-утилит (последний побеждает). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

type VariantMap = Record<string, Record<string, string>>;
type VariantProps<V extends VariantMap> = { [K in keyof V]?: keyof V[K] | null | false };

/**
 * Мини-cva: базовые классы + словарь вариантов + значения по умолчанию.
 *   const button = variants('inline-flex …', { variant: { default: '…', outline: '…' }, size: { sm: '…' } }, { variant: 'default', size: 'md' })
 *   button({ variant: 'outline' }) → строка классов
 */
export function variants<V extends VariantMap>(
  base: string,
  map: V,
  defaults: { [K in keyof V]: keyof V[K] },
) {
  const fn = (props?: VariantProps<V> & { class?: ClassValue | null | undefined }): string => {
    const parts: ClassValue[] = [base];
    for (const key in map) {
      const picked = (props?.[key] ?? defaults[key]) as string;
      if (picked && map[key]?.[picked]) parts.push(map[key][picked]);
    }
    if (props?.class) parts.push(props.class);
    return cn(parts);
  };
  return fn;
}

export type { VariantProps };
