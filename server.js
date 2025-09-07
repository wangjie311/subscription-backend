const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const MarkdownIt = require('markdown-it');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

// Render PG 提供的 DATABASE_URL；使用内置 SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const md = new MarkdownIt();

// 简单管理员鉴权（环境变量 ADMIN_TOKEN）
const requireAdmin = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
};

app.get('/health', (_, res) => res.json({ ok: true }));

// 获取最新内容（v1：返回标题/发布时间/摘要；后续带 JWT 再返回全文）
app.get('/content/latest', async (_, res) => {
  const { rows } = await pool.query(`
    select id, title, body_md, published_at
    from posts
    where is_premium = true and published_at is not null
    order by published_at desc
    limit 1
  `);
  if (!rows.length) return res.json({ item: null });

  const item = rows[0];
  const excerpt = (item.body_md || '').slice(0, 80);
  res.json({
    item: {
      id: item.id,
      title: item.title,
      published_at: item.published_at,
      excerpt
      // 需要全文时：html: md.render(item.body_md)
    }
  });
});

// 管理员发布/更新（id 存在则更新；publish=true 时写入发布时间）
app.post('/admin/content', requireAdmin, async (req, res) => {
  const { id, title, body_md, publish } = req.body || {};
  if (!title || !body_md) return res.status(400).json({ error: 'title/body_md required' });

  const publishedAt = publish ? new Date().toISOString() : null;

  if (id) {
    const { rows } = await pool.query(
      `update posts
       set title=$1, body_md=$2, published_at = coalesce($3, published_at), updated_at = now()
       where id=$4 returning id`,
      [title, body_md, publishedAt, id]
    );
    return res.json({ id: rows[0]?.id });
  } else {
    const { rows } = await pool.query(
      `insert into posts(title, body_md, is_premium, published_at)
       values ($1,$2,true,$3) returning id`,
      [title, body_md, publishedAt]
    );
    return res.json({ id: rows[0].id });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('server on', port));
