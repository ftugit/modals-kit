// Тестовый шов для реальных wasm-кодеков в Node: делегирует серверному
// инициализатору `./node.ts`, чтобы в проекте была одна точка загрузки `.wasm`.
export { ensureNodeImageCodecs as ensureWasm, decodeWithNode } from './node.js'
