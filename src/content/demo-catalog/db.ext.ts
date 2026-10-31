import type { DbModuleExtension } from '#hooks/module-ext.js'
import { posts } from './posts/posts.js'

export const dbExtension: DbModuleExtension = {
  resources: [posts],
  sql: [
    {
      id: 'demo-post-seed-500',
      text: `INSERT INTO public.demo_post (title, created_at)
               SELECT 'Запись ' || n, clock_timestamp() - (501 - n) * interval '1 minute'
               FROM generate_series(1, 500) n
               WHERE NOT EXISTS (SELECT 1 FROM public.demo_post)`,
    },
    {
      id: 'demo-user-seed-100',
      text: `INSERT INTO public.user_auth (seed, permissions, subnet_salt, created_at, updated_at, deleted_at)
               SELECT 'demo-' || substr(md5('seed-' || n), 1, 19) || substr(md5('salt-' || n), 1, 19),
                      '{}',
                      substr(md5('sub-' || n), 1, 32),
                      clock_timestamp() - (n * interval '1.3 days'),
                      clock_timestamp() - (n * interval '1.3 days'),
                      CASE WHEN n <= 20 THEN clock_timestamp() - (n * interval '1.3 days') + interval '20 days' END
                 FROM generate_series(1, 100) n
                WHERE NOT EXISTS (SELECT 1 FROM public.user_auth WHERE seed LIKE 'demo-%')`,
    },
    {
      id: 'demo-profile-seed-100',
      text: `INSERT INTO public.user_profile (auth_id, nickname, created_at, updated_at)
               SELECT a.id, 'demo-user-' || lpad(a.rn::text, 3, '0'), a.created_at, a.created_at
                 FROM (SELECT id, created_at, row_number() OVER (ORDER BY created_at) AS rn
                         FROM public.user_auth WHERE seed LIKE 'demo-%') a
                WHERE NOT EXISTS (SELECT 1 FROM public.user_profile p WHERE p.auth_id = a.id)`,
    },
  ],
}
