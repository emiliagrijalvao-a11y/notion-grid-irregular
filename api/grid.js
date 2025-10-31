// /api/grid.js
const { Client } = require('@notionhq/client');

module.exports = async (req, res) => {
  const token = process.env.NOTION_TOKEN || '';
  const DB_ID = process.env.NOTION_DB_CONTENT || process.env.NOTION_DATABASE_ID || '';

  if (!token || !DB_ID) {
    return res.status(200).json({
      ok: false,
      error: 'Missing NOTION_TOKEN or NOTION_DB_CONTENT/NOTION_DATABASE_ID'
    });
  }

  const notion = new Client({ auth: token });
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function getTitle(p) {
    const props = p.properties || {};
    for (const [k, v] of Object.entries(props)) {
      if (v?.type === 'title') {
        return (v.title || []).map(t => t.plain_text).join('') || '';
      }
    }
    return p.id;
  }
  function getDate(p) {
    const v = p.properties?.['Publish Date'];
    if (v?.type === 'date') return v.date?.start || null;
    return null;
  }
  function getCheckbox(p, name) {
    const v = p.properties?.[name];
    return v?.type === 'checkbox' ? !!v.checkbox : false;
  }
  function getStatus(p) {
    const v = p.properties?.['Status'];
    if (v?.type === 'status') return v.status?.name || null;
    if (v?.type === 'select') return v.select?.name || null;
    return null;
  }
  function getSelect(p, name) {
    const v = p.properties?.[name];
    if (v?.type === 'select') return v.select?.name || null;
    return null;
  }
  function getMultiSelect(p, name) {
    const v = p.properties?.[name];
    if (v?.type === 'multi_select') return (v.multi_select || []).map(o => o.name);
    return [];
  }
  function getPeopleName(p, name) {
    const v = p.properties?.[name];
    if (v?.type === 'people') return v.people?.[0]?.name || null;
    return null;
  }
  function getRichText(p, name) {
    const v = p.properties?.[name];
    if (v?.type === 'rich_text') return (v.rich_text || []).map(t => t.plain_text).join('');
    return '';
  }
  function getRollupText(p, name) {
    const v = p.properties?.[name];
    if (v?.type === 'rollup') {
      const arr = v.rollup?.array || [];
      const texts = arr.map(x => {
        const t = x?.title || x?.rich_text || [];
        return (t || []).map(z => z.plain_text).join('');
      }).filter(Boolean);
      return texts[0] || null;
    }
    return null;
  }
  function extractAssets(p) {
    const props = p.properties || {};
    const fileProp = props['Attachment'] || props['Attachments'] || props['Files'];
    const out = [];
    if (fileProp?.type === 'files') {
      (fileProp.files || []).forEach(f => {
        if (f.type === 'external') out.push({ url: f.external.url, type: guessType(f.external.url), source:'attachment' });
        if (f.type === 'file')     out.push({ url: f.file.url,      type: guessType(f.file.url),      source:'attachment' });
      });
    }
    const link = props['Link']?.url;
    if (link) out.push({ url: link, type: guessType(link), source:'link' });
    const canva = props['Canva']?.url;
    if (canva) out.push({ url: canva, type: guessType(canva), source:'canva' });
    return out;
  }
  function guessType(url='') {
    const u = url.toLowerCase();
    if (u.endsWith('.mp4') || u.endsWith('.mov') || u.endsWith('.webm') || u.includes('video')) return 'video';
    return 'image';
  }
  function pickColor(i){
    const colors = ['#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6','#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'];
    return colors[i % colors.length];
  }

  try {
    const url = new URL(req.url, 'http://x');
    const limit     = clamp(parseInt(url.searchParams.get('limit') || '12', 10), 1, 100);
    const cursor    = url.searchParams.get('cursor') || null;
    const statusQ   = (url.searchParams.get('status') || 'published').toLowerCase(); // 'published' | 'all'
    const q         = (url.searchParams.get('q') || '').trim().toLowerCase();
    const client    = (url.searchParams.get('client')  || '').trim();
    const project   = (url.searchParams.get('project') || '').trim();
    const brand     = (url.searchParams.get('brand')   || '').trim();
    const platform  = (url.searchParams.get('platform')|| '').trim();

    const meta = await notion.databases.retrieve({ database_id: DB_ID });
    const props = meta.properties || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(props, k);

    const AND = [];
    if (has('Hide'))      AND.push({ property:'Hide', checkbox:{ equals:false }});
    if (has('Archivado')) AND.push({ property:'Archivado', checkbox:{ equals:false }});

    if (statusQ !== 'all') {
      const targets = ['Publicado','Entregado','Scheduled','Aprobado'];
      if (has('Status')) {
        if (props['Status'].type === 'status') {
          AND.push({ or: targets.map(s => ({ property:'Status', status:{ equals:s }})) });
        } else if (props['Status'].type === 'select') {
          AND.push({ or: targets.map(s => ({ property:'Status', select:{ equals:s }})) });
        }
      }
    }

    if (client && has('ClientName')) {
      AND.push({ property:'ClientName', rollup:{ any:{ rich_text:{ equals: client }}}});
    }
    if (project && has('ProjectName')) {
      AND.push({ property:'ProjectName', rollup:{ any:{ rich_text:{ equals: project }}}});
    }
    if (brand && has('BrandName')) {
      AND.push({ property:'BrandName', rollup:{ any:{ rich_text:{ equals: brand }}}});
    }

    if (platform && platform.toLowerCase() !== 'all' && has('Platform')) {
      AND.push({ property:'Platform', multi_select:{ contains: platform }});
    }

    if (q) {
      const OR = [];
      for (const [key, def] of Object.entries(props)) {
        if (def?.type === 'title') {
          OR.push({ property:key, title:{ contains: q }});
          break;
        }
      }
      if (has('Copy')) OR.push({ property:'Copy', rich_text:{ contains: q }});
      if (OR.length) AND.push({ or: OR });
    }

    const query = {
      database_id: DB_ID,
      page_size: limit,
      filter: AND.length ? { and: AND } : undefined,
      sorts: []
    };
    if (has('Pinned'))        query.sorts.push({ property:'Pinned', direction:'descending' });
    if (has('Publish Date'))  query.sorts.push({ property:'Publish Date', direction:'descending' });
    if (cursor) query.start_cursor = cursor;

    const resp = await notion.databases.query(query);

    const posts = resp.results.map(p => ({
      id: p.id,
      title: getTitle(p),
      date: getDate(p),
      status: getStatus(p),
      type: getSelect(p,'Type'),
      platforms: getMultiSelect(p,'Platform'),
      client: getRollupText(p,'ClientName'),
      project: getRollupText(p,'ProjectName'),
      brand: getRollupText(p,'BrandName'),
      owner: getPeopleName(p,'Owner'),
      pinned: getCheckbox(p,'Pinned'),
      archived: getCheckbox(p,'Archivado'),
      hidden: getCheckbox(p,'Hide'),
      copy: getRichText(p,'Copy'),
      assets: extractAssets(p)
    }));

    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
    const filters = {
      clients:   uniq(posts.map(p => p.client)).sort(),
      projects:  uniq(posts.map(p => p.project)).sort(),
      brands:    uniq(posts.map(p => p.brand)).sort(),
      platforms: ['Instagram','Tiktok','Youtube','Facebook','Página web','Pantalla'],
      owners:    uniq(posts.map(p => p.owner)).map((n,i)=>({ name:n, color:pickColor(i), initials:(n||'??').slice(0,2).toUpperCase(), count: posts.filter(p=>p.owner===n).length }))
    };

    return res.status(200).json({
      ok: true,
      posts,
      filters,
      has_more: resp.has_more,
      next_cursor: resp.next_cursor || null
    });
  } catch (err) {
    console.error('[grid] error:', err?.body || err);
    return res.status(500).json({
      ok:false,
      error: (err?.body && err.body.message) || err?.message || String(err)
    });
  }
};
