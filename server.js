// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const MarkdownIt = require('markdown-it');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const md = new MarkdownIt();

// 管理员鉴权（Render 环境变量里设置 ADMIN_TOKEN）
const requireAdmin = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
};

app.get('/health', (_, res) => res.json({ ok: true }));

// 获取最新每日内容（v1 仅返回标题/发布时间/摘要，后续带 JWT 再返回全文）
app.get('/content/latest', async (_req, res) => {
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

// 管理：发布/更新每日内容
app.post('/admin/content', requireAdmin, async (req, res) => {
  const { id, title, body_md, publish } = req.body || {};
  if (!title || !body_md) return res.status(400).json({ error: 'title/body_md required' });
  const publishedAt = publish ? new Date().toISOString() : null;

  if (id) {
    const { rows } = await pool.query(
      `update posts
       set title=$1, body_md=$2, published_at=coalesce($3, published_at), updated_at=now()
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

// ====== 新增：空投日历相关接口 ======

// 今日空投（读）
app.get('/airdrops/today', async (_req, res) => {
  const { rows } = await pool.query(
    `select id, name, subtitle, score, amount, time_text, badge
     from airdrops
     where category='today' and published_at is not null
     order by sort asc, published_at desc`
  );
  res.json({ items: rows });
});

// 空投预告（读）
app.get('/airdrops/upcoming', async (_req, res) => {
  const { rows } = await pool.query(
    `select id, name, subtitle, score, amount, time_text, badge
     from airdrops
     where category='upcoming' and published_at is not null
     order by sort asc, published_at desc`
  );
  res.json({ items: rows });
});

// 管理：发布/更新空投项
app.post('/admin/airdrop', requireAdmin, async (req, res) => {
  const { id, category, name, subtitle, score, amount, time_text, badge, sort, publish } = req.body || {};
  if (!category || !name) return res.status(400).json({ error: 'category/name required' });
  if (!['today','upcoming'].includes(category)) return res.status(400).json({ error: 'bad category' });

  const publishedAt = publish ? new Date().toISOString() : null;

  if (id) {
    const { rows } = await pool.query(
      `update airdrops set
         category=$1, name=$2, subtitle=$3, score=$4, amount=$5,
         time_text=$6, badge=$7, sort=coalesce($8, sort),
         published_at=coalesce($9, published_at), updated_at=now()
       where id=$10 returning id`,
      [category, name, subtitle, score, amount, time_text, badge || null, sort, publishedAt, id]
    );
    return res.json({ id: rows[0]?.id });
  } else {
    const { rows } = await pool.query(
      `insert into airdrops(category, name, subtitle, score, amount, time_text, badge, sort, published_at)
       values($1,$2,$3,$4,$5,$6,$7,coalesce($8,0),$9) returning id`,
      [category, name, subtitle, score, amount, time_text, badge || null, sort, publishedAt]
    );
    return res.json({ id: rows[0].id });
  }
});
// 一键清空空投项（支持按分类或全部清空）
// POST /admin/airdrop/clear  body: { category?: 'today' | 'upcoming' }
app.post('/admin/airdrop/clear', requireAdmin, async (req, res) => {
  const { category } = req.body || {};
  try {
    if (category === 'today' || category === 'upcoming') {
      await pool.query('delete from airdrops where category=$1', [category]);
    } else {
      await pool.query('truncate table airdrops');
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => console.log('server on', port));
