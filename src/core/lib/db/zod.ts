/**
 * НЕОБЯЗАТЕЛЬНЫЙ вход для проектов, где zod уже есть (SolidHono).
 * Ядру хватит любой Standard Schema, поэтому он zod не тянет; импорт этого
 * файла добавляет её как источник схем и позволяет переносить `resources.ts`
 * из SolidHono без правок (`field(z.string().min(1), {...})`).
 */
import { z } from "zod";
export { z };
export { field, f, defineResource } from "./validation";
