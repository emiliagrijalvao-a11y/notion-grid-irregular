// /api/grid.js
const { Client } = require('@notionhq/client');

module.exports = async (req, res) => {
  const token = process.env.NOTION_TOKEN || '';
  const DB_ID =
    process.env.NOTION_DB_CONTENT ||
    process.env.NOTION_DATABASE_ID ||
    '';

  if (!token || !DB_ID) {
    return res.status(200).json({
      ok: false,
      error: 'Missing NOTION_TOKEN or NOTION_DATABASE_ID'
    });
  }

  const notion = new Client({ auth: token });

  // util
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  try {
    // 1) leer metadatos de la DB
    const meta = await notion.databases.retrieve({ database_id: DB_ID });
    const props = meta.properties || {};

    // detectar nombres reales
    const nameKey =
      Object.keys(props).find(k => props[k].type === 'title') || 'Name';

    // Publish Date puede llamarse "Publish Date", "Fecha", "Date"
    const dateKey =
      Object.keys(props).find(
        k =>
          props[k].type === 'date' &&
          ['publish date', 'fecha', 'date'].includes(k.toLowerCase())
      ) || null;

    // Status puede ser status o select
    const statusKey =
      Object.keys(props).find(
        k => props[k].type === 'status' || props[k].type === 'select'
      ) || null;

    // checkboxes
    const hideKey = Object.keys(props).find(
      k => props[k].type === 'checkbox' && k.toLowerCase().includes('hide')
    );
    const archivedKey = Object.keys(props).find(
      k =>
        props[k].type === 'checkbox' &&
        (k.toLowerCase().includes('archiv') || k.toLowerCase().includes('archive'))
    );

    // rollups
    const clientRollKey = Object.keys(props).find(
      k => props[k].type === 'rollup' && k.toLowerCase().includes('client')
    );
    const projectRollKey = Object.keys(props).find(
      k => props[k].type === 'rollup' && k.toLowerCase().includes('project')
    );
    const brandRollKey = Object.keys(props).find(
      k => props[k].type === 'rollup' && k.toLowerCase().includes('brand')
    );

    // attachments
    const attachKey = Object.keys(props).find(k => {
      const t = props[k].type;
      return t === 'files' || t === 'file';
    });

    // copy
    const copyKey = Object.keys(props).find(
      k =>
        props[k].type === 'rich_text' &&
        (k.toLowerCase().includes('copy') || k.toLowerCase().includes('caption'))
    );

    // owner
    const ownerKey = Object.keys(props).find(
      k => props[k].type === 'people' && k.toLowerCase().includes('owner')
    );

    // platform
    const platformKey = Object.keys(props).find(
      k => props[k].type === 'multi_select' && k.toLowerCase().includes('platform')
    );

    // type
    const typeKey = Object.keys(props).find(
      k => props[k].type === 'select' && k.toLowerCase().includes('type')
    );

    // pinned
    const pinnedKey = Object.keys(props).find(
      k => props[k].type === 'checkbox' && k.toLowerCase().includes('pinned')
    );

    // === leer query
    const url = new URL(req.url, 'http://x');
    const limit = clamp(parseInt(url.searchParams.get('limit') || '12', 10), 1, 100);
    const cursor = url.searchParams.get('cursor') || null;
    const statusQ = (url.searchParams.get('status') || 'published').toLowerCase();
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const clientQ = (url.searchParams.get('client') || '').trim();
    const projectQ = (url.searchParams.get('project') || '').trim();
    const brandQ = (url.searchParams.get('brand') || '').trim();
    const platformQ = (url.searchParams.get('platform') || '').trim();

    // 2) construir filtro seguro
    const AND = [];

    if (hideKey) {
      AND.push({ property: hideKey, checkbox: { equals: false } });
    }
    if (archivedKey) {
      AND.push({ property: archivedKey, checkbox: { equals: false } });
    }

    // published only
    if (statusKey && statusQ !== 'all') {
      const pubStatuses = ['publicado', 'entregado', 'scheduled', 'aprobado', 'published'];
      const or = pubStatuses.map(s => {
        if (props[statusKey].type === 'status') {
          return { property: statusKey, status: { equals: s } };
        }
        return { property: statusKey, select: { equals: s } };
      });
      AND.push({ or });
    }

    // client / project / brand
    if (clientQ && clientRollKey) {
      AND.push({
        property: clientRollKey,
        rollup: { any: { rich_text: { equals: clientQ } } }
      });
    }
    if (projectQ && projectRollKey) {
      AND.push({
        property: projectRollKey,
        rollup: { any: { rich_text: { equals: projectQ } } }
      });
    }
    if (brandQ && brandRollKey) {
      AND.push({
        property: brandRollKey,
        rollup: { any: { rich_text: { equals: brandQ } } }
      });
    }

    if (platformQ && platformQ !== 'all' && platformKey) {
      AND.push({
        property: platformKey,
        multi_select: { contains: platformQ }
      });
    }

    // search
    if (q) {
      const OR = [];
      if (nameKey) {
        OR.push({ property: nameKey, title: { contains: q } });
      }
      if (copyKey) {
        OR.push({ property: copyKey, rich_text: { contains: q } });
      }
      if (OR.length) AND.push({ or: OR });
    }

    const query = {
      database_id: DB_ID,
      page_size: limit,
      filter: AND.length ? { and: AND } : undefined,
      sorts: []
    };

    if (pinnedKey) {
      query.sorts.push({ property: pinnedKey, direction: 'descending' });
    }
    if (dateKey) {
      query.sorts.push({ property: dateKey, direction: 'descending' });
    }

    if (cursor) {
      query.start_cursor = cursor;
    }

    // 3) hacer query real
    const resp = await notion.databases.query(query);

    // 4) mapear resultados
    const posts = resp.results.map(page => {
      const p = page.properties || {};

      // título
      let title = page.id;
      if (nameKey && p[nameKey]?.title) {
        title = p[nameKey].title.map(t => t.plain_text).join('') || page.id;
      }

      // fecha
      let date = null;
      if (dateKey && p[dateKey]?.date) {
        date = p[dateKey].date.start || null;
      }

      // status
      let status = null;
      if (statusKey) {
        const def = p[statusKey];
        if (def.type === 'status') status = def.status?.name || null;
        else if (def.type === 'select') status = def.select?.name || null;
      }

      // copy
      let copy = '';
      if (copyKey && p[copyKey]?.rich_text) {
        copy = p[copyKey].rich_text.map(t => t.plain_text).join('');
      }

      // rollups
      function rollupToString(key) {
        if (!key || !p[key] || p[key].type !== 'rollup') return null;
        const arr = p[key].rollup?.array || [];
        const texts = arr.map(x => {
          const title = x?.title || x?.rich_text || [];
          return (title || []).map(z => z.plain_text).join('');
        }).filter(Boolean);
        return texts[0] || null;
      }

      const client = rollupToString(clientRollKey);
      const project = rollupToString(projectRollKey);
      const brand = rollupToString(brandRollKey);

      // owner
      let owner = null;
      if (ownerKey && p[ownerKey]?.people?.length) {
        owner = p[ownerKey].people[0].name;
      }

      // platforms
      let platforms = [];
      if (platformKey && p[platformKey]?.multi_select) {
        platforms = p[platformKey].multi_select.map(o => o.name);
      }

      // type
      let type = null;
      if (typeKey && p[typeKey]?.select) {
        type = p[typeKey].select.name;
      }

      // pinned/hide/archivado
      const pinned = pinnedKey ? !!p[pinnedKey]?.checkbox : false;
      const hidden = hideKey ? !!p[hideKey]?.checkbox : false;
      const archived = archivedKey ? !!p[archivedKey]?.checkbox : false;

      // assets
      const assets = [];
      if (attachKey && p[attachKey]?.files) {
        for (const f of p[attachKey].files) {
          if (f.type === 'external') {
            assets.push({ url: f.external.url, type: guessType(f.external.url), source: 'attachment' });
          } else if (f.type === 'file') {
            assets.push({ url: f.file.url, type: guessType(f.file.url), source: 'attachment' });
          }
        }
      }

      return {
        id: page.id,
        title,
        date,
        status,
        type,
        platforms,
        client,
        project,
        brand,
        owner,
        pinned,
        archived,
        hidden,
        copy,
        assets
      };
    });

    // 5) construir filtros desde lo que sí vino
    const uniq = arr => [...new Set(arr.filter(Boolean))];
    const filters = {
      clients: uniq(posts.map(p => p.client)).sort(),
      projects: uniq(posts.map(p => p.project)).sort(),
      brands: uniq(posts.map(p => p.brand)).sort(),
      platforms: ['Instagram','Tiktok','Youtube','Facebook','Página web','Pantalla'],
      owners: uniq(posts.map(p => p.owner)).map((n,i) => ({
        name: n,
        color: pickColor(i),
        initials: (n || '??').slice(0,2).toUpperCase(),
        count: posts.filter(p => p.owner === n).length
      }))
    };

    return res.status(200).json({
      ok: true,
      posts,
      filters,
      has_more: resp.has_more,
      next_cursor: resp.next_cursor || null,
      // esto es temporal para depurar, lo puedes borrar luego 👇
      debug: {
        nameKey,
        dateKey,
        statusKey,
        clientRollKey,
        projectRollKey,
        brandRollKey,
        attachKey,
        copyKey,
        ownerKey,
        platformKey,
        pinnedKey
      }
    });
  } catch (err) {
    console.error('[api/grid] FATAL:', err?.body || err);
    return res.status(500).json({
      ok: false,
      error: (err?.body && err.body.message) || err?.message || String(err)
    });
  }

  function guessType(url = '') {
    const u = url.toLowerCase();
    if (u.endsWith('.mp4') || u.endsWith('.mov') || u.includes('video')) return 'video';
    return 'image';
  }
  function pickColor(i){
    const colors = ['#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6','#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'];
    return colors[i % colors.length];
  }
};
