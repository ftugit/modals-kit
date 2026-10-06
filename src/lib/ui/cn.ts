import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Склейка классов с разрешением конфликтов Tailwind-утилит (последний побеждает). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type VariantMap = Record<string, Record<string, string>>;

export type VariantValue<T> = T extends 'true' | 'false'
  ? boolean | 'true' | 'false'
  : T | null | false | undefined;

export type VariantProps<T> = T extends (props?: infer P) => string
  ? P extends object
    ? { [K in keyof Omit<P, 'class'>]?: P[K] }
    : Record<string, never>
  : T extends VariantMap
    ? { [K in keyof T]?: VariantValue<keyof T[K]> }
    : Record<string, never>;

/**
 * Мини-cva: базовые классы + словарь вариантов + значения по умолчанию.
 *   const button = variants('inline-flex …', { variant: { default: '…', outline: '…' }, size: { sm: '…' } }, { variant: 'default', size: 'md' })
 *   button({ variant: 'outline' }) → строка классов
 */
export function variants<V extends VariantMap>(
  base: string,
  map: V,
  defaults: { [K in keyof V]: keyof V[K] | boolean },
) {
  const fn = (props?: { [K in keyof V]?: VariantValue<keyof V[K]> } & { class?: ClassValue | null | undefined }): string => {
    const parts: ClassValue[] = [base];
    for (const key in map) {
      const rawVal = props?.[key] ?? defaults[key];
      const picked = (typeof rawVal === 'boolean' ? String(rawVal) : rawVal) as string;
      if (picked && map[key]?.[picked]) parts.push(map[key][picked]);
    }
    if (props?.class) parts.push(props.class);
    return cn(parts);
  };
  return fn;
}
