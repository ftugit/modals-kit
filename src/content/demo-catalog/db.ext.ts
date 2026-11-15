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
      // Случайные 50–100 устройств каждому демо-юзеру: список сессий, фильтры по
      // состоянию/стране/смене сети и пагинатор на реальных объёмах. Числа берём из
      // md5 (детерминированно: из минуты в минуту одинаковая картина, в отличие от
      // random()), срок — как у сервера (30 дней), поэтому часть строк уже истекла,
      // а у каждой пятой «устройство заблокировано» (deleted_at).
      id: 'demo-session-seed-50-100',
      text: `INSERT INTO public.user_session (
               auth_id, jti, device_name, subnet_hash, country, subnet_history, version,
               created_at, updated_at, last_seen_at, expires_at, deleted_at)
             SELECT a.id,
                    substr(md5('jti1-' || a.id || '-' || s.n), 1, 32) || substr(md5('jti2-' || a.id || '-' || s.n), 1, 12),
                    (ARRAY['MacBook Pro', 'Ноутбук', 'iPhone', 'Pixel', 'iPad', 'Рабочая станция', 'Chromebook', 'Телевизор'])[1 + (h.b % 8)::int],
                    substr(md5('net-' || a.id || '-' || s.n), 1, 32),
                    CASE WHEN h.b % 10 = 0 THEN NULL
                         ELSE (ARRAY['RU', 'KZ', 'BY', 'DE', 'NL', 'TR', 'GE', 'US', 'FR', 'RS'])[1 + ((h.b / 10) % 10)::int]
                    END,
                    CASE WHEN h.b % 7 = 0
                         THEN jsonb_build_array(jsonb_build_object(
                                'hash', substr(md5('old-' || a.id || '-' || s.n), 1, 32),
                                'country', 'DE',
                                'at', c.created - (interval '1 hour' * (4 + h.b % 20)::double precision)))
                         ELSE '[]'::jsonb
                    END,
                    0,
                    c.created,
                    c.created,
                    LEAST(clock_timestamp(), c.created + (interval '1 hour' * (h.b % 72)::double precision)),
                    c.created + interval '30 days',
                    CASE WHEN h.b % 5 = 0
                         THEN c.created + (interval '1 day' * (1 + h.b % 10)::double precision)
                    END
               FROM public.user_auth a
              CROSS JOIN LATERAL (SELECT abs(('x' || substr(md5('count-' || a.id), 1, 8))::bit(32)::int) AS v) AS k
              CROSS JOIN LATERAL generate_series(1, 50 + (k.v % 51)) AS s(n)
              CROSS JOIN LATERAL (SELECT abs(('x' || substr(md5('h-' || a.id || '-' || s.n), 1, 8))::bit(32)::int) AS v) AS hh
              CROSS JOIN LATERAL (SELECT (hh.v % 1000)::bigint AS b) AS h
              CROSS JOIN LATERAL (SELECT clock_timestamp()
                                       - (interval '1 day' * (h.b % 60)::double precision)
                                       - (interval '1 hour' * ((h.b / 5) % 24)::double precision) AS created) AS c
              WHERE a.seed LIKE 'demo-%'
                AND NOT EXISTS (SELECT 1 FROM public.user_session)`,
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
