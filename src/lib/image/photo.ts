// Облегчённый вход для преобразования фотографий: выход JPEG/PNG/WebP.
// Если полный фасад уже загружен, не перезаписываем пользовательский реестр.
import { hasFullEntry, registerPhotoCodecs } from './photo-builtins.js';
if (!hasFullEntry()) registerPhotoCodecs();
export { image } from './pipeline.js';
