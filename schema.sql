-- 在 Render PG 控制台或任何 SQL 客户端执行
-- 如果缺少扩展，先启用：
-- create extension if not exists "pgcrypto";

create table if not exists posts (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  body_md text not null,
  is_premium boolean not null default true,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_posts_published_at on posts (published_at desc);
