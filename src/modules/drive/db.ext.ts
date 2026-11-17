/**
 * Подключение схемы «Диска» к общему `defineSchema` (`#core/server/db.server`).
 *
 * Ресурсы описывают колонки; то, чего модель не умеет, живёт здесь:
 * регистронезависимая уникальность имени в живой папке (частичный индекс с
 * `lower(name)`) и индексы под листинг, «недавние», корзину и поиск по
 * префиксу. `NULLS NOT DISTINCT` нужен, чтобы два корня с одинаковым именем
 * (у которых `parent_id IS NULL`) не проходили мимо ограничения.
 */
import type { DbModuleExtension } from '#core/hooks/module-ext.js'
import { driveDavLock, driveDavToken, driveNode, driveShare } from './schema.js'

export const dbExtension: DbModuleExtension = {
  resources: [driveNode, driveShare, driveDavToken, driveDavLock],
  sql: [
    {
      id: 'drive-node-name-uq',
      text: `CREATE UNIQUE INDEX IF NOT EXISTS drive_node_name_uq
             ON public.drive_node (owner_id, parent_id, lower(name)) NULLS NOT DISTINCT
             WHERE trashed_at IS NULL`,
    },
    {
      id: 'drive-node-ix-list',
      text: `CREATE INDEX IF NOT EXISTS drive_node_ix_list
             ON public.drive_node (owner_id, parent_id, lower(name))
             WHERE trashed_at IS NULL`,
    },
    {
      id: 'drive-node-ix-recent',
      text: `CREATE INDEX IF NOT EXISTS drive_node_ix_recent
             ON public.drive_node (owner_id, updated_at DESC)
             WHERE trashed_at IS NULL`,
    },
    {
      id: 'drive-node-ix-trash',
      text: `CREATE INDEX IF NOT EXISTS drive_node_ix_trash
             ON public.drive_node (owner_id)
             WHERE trashed_at IS NOT NULL`,
    },
    {
      id: 'drive-node-ix-search',
      text: `CREATE INDEX IF NOT EXISTS drive_node_ix_search
             ON public.drive_node (owner_id, lower(name) text_pattern_ops)
             WHERE trashed_at IS NULL`,
    },
  ],
}
