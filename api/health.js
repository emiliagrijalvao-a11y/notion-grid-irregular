// /api/health.js
const { Client } = require('@notionhq/client');

module.exports = async (req, res) => {
  try {
    const token = process.env.NOTION_TOKEN || '';
    const dbId = process.env.NOTION_DB_CONTENT || process.env.NOTION_DATABASE_ID || '';

    const out = {
      ok: true,
      hasToken: !!token,
      hasDb: !!dbId,
      env: {
        NOTION_TOKEN: token ? 'present' : 'missing',
        NOTION_DB_CONTENT_or_NOTION_DATABASE_ID: dbId ? 'present' : 'missing'
      },
      props: [],
      errors: []
    };

    if (!token || !dbId) {
      out.ok = false;
      return res.status(200).json(out);
    }

    const notion = new Client({ auth: token });

    try {
      const meta = await notion.databases.retrieve({ database_id: dbId });
      out.dbTitle = meta?.title?.map(t => t.plain_text).join('') || '';
      out.props = Object.keys(meta?.properties || []);
    } catch (e) {
      out.ok = false;
      out.errors.push(e.body || e.message || String(e));
    }

    return res.status(200).json(out);
  } catch (err) {
    console.error('[health] fatal:', err);
    return res.status(500).json({ ok:false, error: String(err) });
  }
};
