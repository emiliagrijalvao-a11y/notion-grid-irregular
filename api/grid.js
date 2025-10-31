// /api/grid.js
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const DB_POSTS = process.env.NOTION_DATABASE_ID;

const H = {
  json: (res, code, body) => res.status(code).json(body),
  titleFromProps(props) {
    // Busca la primera propiedad tipo "title"
    for (const [k, v] of Object.entries(props || {})) {
      if (v?.type === "title") {
        return (v.title || []).map(t => t.plain_text).join(" ").trim();
      }
    }
    return "";
  }
};

// ---------- HTTP core -----------
async function notion(path, opt = {}) {
  const r = await fetch(`${NOTION_API}${path}`, {
    method: "GET",
    ...opt,
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(opt.headers || {})
    }
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`Notion ${path} ${r.status}: ${t}`);
  }
  return r.json();
}

async function queryDb(dbId, body) {
  return notion(`/databases/${dbId}/query`, {
    method: "POST",
    body: JSON.stringify(body || {})
  });
}

async function retrievePage(pageId) {
  return notion(`/pages/${pageId}`);
}

const cachePageTitle = new Map();
async function getPageTitle(pageId) {
  if (!pageId) return "";
  if (cachePageTitle.has(pageId)) return cachePageTitle.get(pageId);
  const p = await retrievePage(pageId);
  const title = H.titleFromProps(p.properties);
  cachePageTitle.set(pageId, title);
  return title;
}

// -------- Mapping helpers ----------
function pickProp(props, candidates, type) {
  // Busca por nombre de propiedad candidato y por tipo de Notion
  for (const name of candidates) {
    const p = props?.[name];
    if (!p) continue;
    if (!type || p.type === type) return { name, prop: p };
  }
  // si no por nombre: intenta por tipo
  if (type) {
    for (const [k, v] of Object.entries(props || {})) {
      if (v?.type === type) return { name: k, prop: v };
    }
  }
  return null;
}

function extractFiles(props) {
  // Posibles nombres: Files, Media, Attachment, Attachments, Archivos
  const cand = pickProp(props, ["Files", "Media", "Attachment", "Attachments", "Archivos"], "files");
  const items = cand?.prop?.files || [];
  return items.map(f => {
    const url = f.type === "external" ? f.external.url : f.file?.url;
    const name = f.name || url || "";
    const type = isVideo(name) ? "video" : "image";
    return { url, type };
  }).filter(x => !!x.url);
}

function isVideo(name = "") {
  const n = name.toLowerCase();
  return [".mp4",".webm",".mov",".m4v",".avi",".mkv"].some(ext => n.endsWith(ext));
}

function getCheckbox(props, candidates) {
  const it = pickProp(props, candidates, "checkbox");
  return !!it?.prop?.checkbox;
}

function getDate(props, candidates) {
  const it = pickProp(props, candidates, "date");
  return it?.prop?.date?.start || "";
}

function collectRelationIds(prop) {
  // relation: { relation: [{id}, ...] }
  if (!prop) return [];
  if (prop.type === "relation") return (prop.relation || []).map(r => r.id);
  // rollup "Show original" puede traer arrays; intentamos extraer ids
  if (prop.type === "rollup") {
    const arr = prop.rollup?.array || [];
    const ids = [];
    for (const item of arr) {
      if (item?.type === "relation") {
        ids.push(...(item.relation || []).map(r => r.id));
      }
      if (item?.type === "title") {
        // si vino ya como título, lo devolvemos como marcador especial
        ids.push({ __title: (item.title || []).map(t=>t.plain_text).join(" ").trim() });
      }
    }
    return ids;
  }
  return [];
}

async function resolveManyTitles(idsOrTitles) {
  const out = [];
  for (const it of idsOrTitles) {
    if (!it) continue;
    if (typeof it === "object" && it.__title) {
      out.push(it.__title);
      continue;
    }
    const t = await getPageTitle(it);
    if (t) out.push(t);
  }
  return Array.from(new Set(out));
}

// ---------- Fetch posts (with pagination & filters) ----------
async function fetchAllPosts({ limit = 400 } = {}) {
  const results = [];
  let cursor = undefined;
  while (results.length < limit) {
    const resp = await queryDb(DB_POSTS, {
      start_cursor: cursor,
      page_size: 100,
      filter: {
        and: [
          // Excluye archivado/oculto (si existen)
          ...(true ? [{
            property: "Archivado", checkbox: { equals: false }
          }] : []),
          ...(true ? [{
            property: "Hidden", checkbox: { equals: false }
          }] : []),
          ...(true ? [{
            property: "Oculto", checkbox: { equals: false }
          }] : []),
        ]
      },
      sorts: [{ property: "Fecha", direction: "descending" }]
    }).catch(()=>({ results:[], has_more:false }));
    results.push(...(resp.results || []));
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return results.slice(0, limit);
}

async function shapePost(page) {
  const props = page.properties || {};

  // Título y fecha
  const title = H.titleFromProps(props);
  const date = getDate(props, ["Fecha", "Date", "Published", "Publish Date"]);

  // Banderas
  const archived = getCheckbox(props, ["Archivado", "Archived"]);
  const hidden   = getCheckbox(props, ["Hidden", "Oculto", "Hide", "DraftHide"]);
  const draft    = getCheckbox(props, ["Draft", "Borrador"]);

  // Archivos
  const assets = extractFiles(props);

  // Relaciones / rollups:
  const postProject = pickProp(props, ["PostProject","Project","Proyecto"], "relation") 
                   || pickProp(props, ["PostProject","Project","Proyecto"], "rollup");
  const postClient  = pickProp(props, ["PostClient","Client"], "relation")
                   || pickProp(props, ["PostMain"], "rollup"); // rollup Show original del Client
  const postBrands  = pickProp(props, ["PostBrands","Brands","Brand"], "rollup")
                   || pickProp(props, ["PostBrand"], "relation");

  const projectIds = collectRelationIds(postProject?.prop);
  const clientIds  = collectRelationIds(postClient?.prop);
  const brandIds   = collectRelationIds(postBrands?.prop);

  const [projectName] = await resolveManyTitles(projectIds);
  const clientNames   = await resolveManyTitles(clientIds);
  const brandNames    = await resolveManyTitles(brandIds);

  return {
    id: page.id,
    title, date,
    archived, hidden, draft,
    assets,
    project: projectName || "",
    client:  clientNames[0] || "",
    brands:  brandNames || []
  };
}

function applyFilters(posts, { project, client, brand, q, draft }) {
  const query = (q || "").trim().toLowerCase();
  return posts.filter(p => {
    if (p.hidden || p.archived) return false;
    if (project && p.project !== project) return false;
    if (client && p.client !== client) return false;
    if (brand && !(p.brands || []).includes(brand)) return false;
    if (typeof draft === "boolean") {
      if (draft !== !!p.draft) return false;
    }
    if (query) {
      const hay = `${p.title} ${p.project} ${p.client} ${(p.brands||[]).join(" ")}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

function paginate(arr, page, pageSize) {
  const p = Math.max(1, parseInt(page || "1", 10));
  const s = Math.max(1, Math.min(100, parseInt(pageSize || "24", 10)));
  const start = (p - 1) * s;
  const end = start + s;
  return { slice: arr.slice(start, end), hasMore: end < arr.length };
}

function buildMeta(posts) {
  const projects = new Set();
  const clients = new Set();
  const brandsByClient = {};
  for (const p of posts) {
    if (p.project) projects.add(p.project);
    if (p.client) {
      clients.add(p.client);
      brandsByClient[p.client] = brandsByClient[p.client] || new Set();
      for (const b of (p.brands || [])) brandsByClient[p.client].add(b);
    }
  }
  const brandsByClientObj = {};
  for (const [k, set] of Object.entries(brandsByClient)) {
    brandsByClientObj[k] = Array.from(set).sort();
  }
  return {
    projects: Array.from(projects).sort(),
    clients: Array.from(clients).sort(),
    brandsByClient: brandsByClientObj
  };
}

export default async function handler(req, res) {
  try {
    if (!process.env.NOTION_TOKEN || !DB_POSTS) {
      return H.json(res, 500, { ok:false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    const url = new URL(req.url, "http://x");
    const q = Object.fromEntries(url.searchParams.entries());

    // Lee todo (hasta 400) y mapea
    const raw = await fetchAllPosts();
    const shaped = [];
    for (const page of raw) {
      try { shaped.push(await shapePost(page)); } catch (e) {/* swallow per-page */ }
    }

    if (q.meta === "1") {
      const filters = buildMeta(shaped);
      return H.json(res, 200, { ok:true, filters });
    }

    const wantDraft = q.draft === "1" ? true : (q.draft === "0" ? false : undefined);
    const filtered = applyFilters(shaped, {
      project: q.project || "",
      client:  q.client || "",
      brand:   q.brand || "",
      q:       q.q || "",
      draft:   typeof wantDraft === "boolean" ? wantDraft : undefined
    });

    const { slice, hasMore } = paginate(filtered, q.page, q.pageSize);
    return H.json(res, 200, { ok:true, posts: slice, hasMore });
  } catch (e) {
    return H.json(res, 500, { ok:false, error: e.message });
  }
}
