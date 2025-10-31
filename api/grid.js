// pages/api/grid.js
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_CONTENT = process.env.NOTION_DATABASE_ID;

// (Opcional) si quieres meta super-rápida:
const DB_CLIENTS  = process.env.NOTION_CLIENTS_DB_ID || null;
const DB_PROJECTS = process.env.NOTION_PROJECTS_DB_ID || null;
const DB_BRANDS   = process.env.NOTION_BRANDS_DB_ID || null;

/** Mapea EXACTAMENTE tus nombres de propiedades en Notion */
const PROPS = {
  title:         'Name',            // Title
  date:          'Publish Date',    // Date
  status:        'Status',          // Status
  platform:      'Platform',        // Multi-select
  type:          'Type',            // Select
  owner:         'Owner',           // Person (usaremos el primero)
  postClient:    'PostClient',      // Relation -> Clients
  postProject:   'PostProject',     // Relation -> Projects
  postBrand:     'PostBrand',       // Relation -> Brands
  rollClient:    'ClientName',      // Rollup -> Name (Show original)
  rollProject:   'ProjectName',     // Rollup -> Name (Show original)
  rollBrand:     'BrandName',       // Rollup -> Name(s)
  attachment:    'Attachment',      // Files & Media
  link:          'Link',            // URL
  canva:         'Canva',           // URL
  copy:          'Copy',            // Rich text
  pinned:        'Pinned',          // Checkbox
  archivedFlag:  'Archivado',       // Checkbox (interno)
  hideFlag:      'Hide',            // Checkbox (interno)
};

/** Conjunto de Status para "Published Only" (puedes ajustar casing) */
const PUBLISHED_STATUSES = new Set([
  'Publicado', 'Entregado', 'Scheduled', 'Aprobado'
]);

/** Construye filtro base para Notion */
function buildNotionFilter({ statusMode, client, project, brand }) {
  const and = [];

  // Excluir SIEMPRE por flags internos (seguimos excluyendo Hide/Archivado checkbox)
  and.push({ property: PROPS.hideFlag, checkbox: { equals: false } });
  and.push({ property: PROPS.archivedFlag, checkbox: { equals: false } });

  // Status
  if (statusMode === 'published') {
    and.push({
      or: [...PUBLISHED_STATUSES].map(name => ({
        property: PROPS.status,
        status: { equals: name }
      }))
    });
  }
  // Si es "all", no filtramos por Status (pero sí por flags internos arriba)

  // Intentamos filtrar por rollups si existen (mejor rendimiento)
  if (client) {
    and.push({
      property: PROPS.rollClient,
      rich_text: { equals: client }
    });
  }
  if (project) {
    and.push({
      property: PROPS.rollProject,
      rich_text: { equals: project }
    });
  }
  if (brand) {
    and.push({
      property: PROPS.rollBrand,
      rich_text: { equals: brand }
    });
  }

  return { and };
}

/** Helpers para extraer campos */
const getTitle = (p) => (p?.title || []).map(t => t.plain_text).join('').trim();
const getRich  = (p) => (p?.rich_text || []).map(t => t.plain_text).join('');
const getDate  = (p) => p?.date?.start || null;
const getSelect = (p) => p?.select?.name || null;
const getMulti  = (p) => (p?.multi_select || []).map(x => x.name);
const getCheck  = (p) => !!p?.checkbox;
const getPeople = (p) => (p?.people || []).map(x => x.name).filter(Boolean);
const getRollText = (p) => {
  // Rollup Show original de Title -> llega como array de rich_text
  if (!p) return null;
  if (p.type === 'rich_text') return (p.rich_text || []).map(t=>t.plain_text).join('') || null;
  if (p.type === 'title')     return (p.title || []).map(t=>t.plain_text).join('') || null;
  if (typeof p?.formula?.string === 'string') return p.formula.string;
  return null;
};
const isVideo = (url='') => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
const isImage = (url='') => /\.(jpe?g|png|gif|webp|heic|avif)(\?|$)/i.test(url);

function extractAssets(props) {
  const files = props[PROPS.attachment]?.files || [];
  const assets = [];

  // 1) Attachment
  for (const f of files) {
    const url = f.file?.url || f.external?.url || '';
    if (!url) continue;
    const type = isVideo(url) ? 'video' : 'image';
    assets.push({ url, type, source: 'attachment' });
  }

  // 2) Link
  const linkUrl = props[PROPS.link]?.url || '';
  if (linkUrl) {
    assets.push({ url: linkUrl, type: isVideo(linkUrl) ? 'video' : 'image', source: 'link' });
  }

  // 3) Canva
  const canvaUrl = props[PROPS.canva]?.url || '';
  if (canvaUrl) {
    assets.push({ url: canvaUrl, type: isVideo(canvaUrl) ? 'video' : 'image', source: 'canva' });
  }

  return assets;
}

function processPost(page) {
  const p = page.properties || {};
  const title = getTitle(p[PROPS.title]);
  const date  = getDate(p[PROPS.date]);
  const status = p[PROPS.status]?.status?.name || null;
  const platforms = getMulti(p[PROPS.platform]);
  const type = getSelect(p[PROPS.type]);
  const owners = getPeople(p[PROPS.owner]);
  const owner = owners[0] || null;
  const pinned = getCheck(p[PROPS.pinned]);
  const hidden = getCheck(p[PROPS.hideFlag]);
  const archived = getCheck(p[PROPS.archivedFlag]);
  const client = getRollText(p[PROPS.rollClient]);
  const project = getRollText(p[PROPS.rollProject]);
  const brand = getRollText(p[PROPS.rollBrand]);
  const copy = getRich(p[PROPS.copy]);

  const assets = extractAssets(p);

  return {
    id: page.id,
    title, date, status, platforms, type,
    client, project, brand,
    owner, pinned, hidden, archived,
    copy,
    assets
  };
}

function stableOwnerColor(name) {
  if (!name) return '#6B7280';
  const palette = ['#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6','#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'];
  let h=0; for (let i=0;i<name.length;i++) h=((h*31)+name.charCodeAt(i))|0;
  return palette[Math.abs(h)%palette.length];
}
const initials = (s) => (s||'').trim().slice(0,2).toUpperCase();

/** Meta por DBs auxiliares (rápido) */
async function readSimpleList(dbId) {
  const out = [];
  if (!dbId) return out;
  let cursor = undefined;
  do {
    const r = await notion.databases.query({
      database_id: dbId,
      page_size: 100,
      start_cursor: cursor
    });
    for (const res of r.results) {
      const name = getTitle(res.properties?.Name);
      if (name) out.push(name);
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

export default async function handler(req, res) {
  try {
    const {
      cursor,
      limit = '12',
      q = '',
      client = '',
      project = '',
      brand = '',
      platform = '',   // comma separated
      owner = '',      // comma separated
      status = 'published', // published | all
      meta = ''
    } = req.query;

    const pageSize = Math.max(1, Math.min(parseInt(limit,10) || 12, 100));
    const statusMode = (status === 'all') ? 'all' : 'published';

    // --- Query base a Notion ---
    const filter = buildNotionFilter({ statusMode, client, project, brand });
    const sorts = [
      // Si tienes fórmula PinnedRank (1/0), úsala aquí DESC primero
      // { property: 'PinnedRank', direction: 'descending' },
      { property: PROPS.date, direction: 'descending' }
    ];

    const queryPayload = {
      database_id: DB_CONTENT,
      filter,
      sorts,
      page_size: pageSize
    };
    if (cursor) queryPayload.start_cursor = cursor;

    const r = await notion.databases.query(queryPayload);

    let posts = r.results.map(processPost);

    // --- Filtros que Notion no hace (q, platform, owner) ---
    const qLower = (q || '').trim().toLowerCase();
    if (qLower) {
      posts = posts.filter(p =>
        (p.title || '').toLowerCase().includes(qLower) ||
        (p.client || '').toLowerCase().includes(qLower) ||
        (p.project || '').toLowerCase().includes(qLower)
      );
    }

    if (platform) {
      const want = new Set(platform.split(',').map(s => s.trim()).filter(Boolean));
      posts = posts.filter(p => (p.platforms || []).some(pl => want.has(pl)));
    }

    if (owner) {
      const want = new Set(owner.split(',').map(s => s.trim()).filter(Boolean));
      posts = posts.filter(p => p.owner && want.has(p.owner));
    }

    // Reordenar por pinned primero (si no usas fórmula PinnedRank)
    posts.sort((a,b) => {
      if (a.pinned !== b.pinned) return (a.pinned ? -1 : 1);
      // fecha desc
      return (a.date || '') < (b.date || '') ? 1 : -1;
    });

    // --- META (opcional) ---
    let filters = undefined;
    if (meta === '1') {
      // Intento rápido por DBs auxiliares
      let clients = [], projects = [], brands = [];
      if (DB_CLIENTS && DB_PROJECTS) {
        clients  = await readSimpleList(DB_CLIENTS);
        projects = await readSimpleList(DB_PROJECTS);
        if (DB_BRANDS) brands = await readSimpleList(DB_BRANDS);
      } else {
        // Fallback: derivar de este batch (limitado)
        clients  = Array.from(new Set(posts.map(p=>p.client).filter(Boolean))).sort();
        projects = Array.from(new Set(posts.map(p=>p.project).filter(Boolean))).sort();
        brands   = Array.from(new Set(posts.map(p=>p.brand).filter(Boolean))).sort();
      }

      // Owners (conteo aprox en batch actual)
      const ownerMap = new Map();
      for (const p of posts) {
        if (!p.owner) continue;
        const c = ownerMap.get(p.owner) || 0;
        ownerMap.set(p.owner, c+1);
      }
      const owners = Array.from(ownerMap.entries()).map(([name,count]) => ({
        name, count,
        color: stableOwnerColor(name),
        initials: initials(name)
      })).sort((a,b)=> a.name.localeCompare(b.name));

      // Platforms actuales desde batch (o podrías leer schema de la DB)
      const platforms = Array.from(new Set(posts.flatMap(p => p.platforms || []))).sort();

      filters = { clients, projects, brands, owners, platforms };
    }

    res.status(200).json({
      posts,
      hasMore: r.has_more,
      nextCursor: r.has_more ? r.next_cursor : null,
      filters
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'grid_failed', message: err.message });
  }
}
