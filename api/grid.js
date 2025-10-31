// /api/grid.js
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DATABASE_ID;

const headers = {
  "Authorization": `Bearer ${TOKEN}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json"
};

const VIDEO_EXT = [".mp4",".webm",".mov",".m4v",".avi",".mkv"];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function rt2txt(arr=[]) { return arr.map(t=>t.plain_text).join(""); }
function getTitleFromProps(props) {
  for (const k in props) if (props[k]?.type === "title") return rt2txt(props[k].title || []);
  return "";
}
function isVideo(name="") {
  const s = name.toLowerCase();
  return VIDEO_EXT.some(ext => s.endsWith(ext));
}

function readCheckbox(props, keys) {
  for (const k of keys) if (props[k]?.type === "checkbox") return !!props[k].checkbox;
  return false;
}
function readDate(props, keys) {
  for (const k of keys) if (props[k]?.type === "date") return props[k].date?.start || "";
  return "";
}
function readFiles(props, keys) {
  for (const k of keys) {
    if (props[k]?.type === "files") {
      return (props[k].files || []).map(f => ({
        url: f.type === "external" ? f.external.url : f.file.url,
        name: f.name || "",
        type: isVideo(f.name) ? "video" : "image"
      }));
    }
  }
  return [];
}
function readRelationIds(props, key) {
  const p = props[key];
  if (!p) return [];
  if (p.type === "relation") return (p.relation || []).map(r => r.id);
  if (p.type === "rollup" && Array.isArray(p.rollup?.array)) {
    // rollup "show original" de relations
    return p.rollup.array
      .filter(x => x.type === "relation")
      .flatMap(x => x.relation || [])
      .map(r => r.id);
  }
  return [];
}

async function queryAllPages() {
  let hasMore = true, start_cursor = undefined;
  const results = [];
  while (hasMore) {
    const body = {
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      page_size: 100
    };
    const res = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
      method: "POST", headers, body: JSON.stringify({ start_cursor, ...body })
    });
    if (!res.ok) throw new Error(`Notion query failed: ${res.status}`);
    const json = await res.json();
    results.push(...json.results);
    hasMore = json.has_more;
    start_cursor = json.next_cursor;
    // leve backoff para no saturar
    if (hasMore) await sleep(100);
  }
  return results;
}

async function getPageTitleMap(ids) {
  const map = new Map();
  const unique = [...new Set(ids)];
  for (const id of unique) {
    try {
      const r = await fetch(`${NOTION_API}/pages/${id}`, { headers });
      if (!r.ok) continue;
      const j = await r.json();
      map.set(id, getTitleFromProps(j.properties || {}));
      await sleep(50);
    } catch { /* ignore */ }
  }
  return map;
}

function applyInMemoryFilters(items, q) {
  const { project, client, brand, search, draft } = q;
  return items.filter(p => {
    if (draft === "1" && !p.draft) return false;
    if (project && p.project !== project) return false;
    if (client  && p.client  !== client)  return false;
    if (brand   && !(p.brands || []).includes(brand)) return false;
    if (search) {
      const s = search.toLowerCase();
      const hit = (p.title || "").toLowerCase().includes(s)
        || (p.project || "").toLowerCase().includes(s)
        || (p.client || "").toLowerCase().includes(s)
        || (p.brands || []).some(b => b.toLowerCase().includes(s));
      if (!hit) return false;
    }
    return true;
  });
}

export default async function handler(req, res) {
  try {
    if (!TOKEN || !DB_ID) {
      return res.status(200).json({ ok: false, error: "Missing envs", posts: [] });
    }

    const rows = await queryAllPages();

    // Extrae props base
    const base = rows.map(page => {
      const props = page.properties || {};
      const title = getTitleFromProps(props);
      const hidden = readCheckbox(props, ["Hidden","Oculto"]);
      const archived = readCheckbox(props, ["Archivado","Archived"]);
      const draft = readCheckbox(props, ["Draft","Borrador"]) ||
                    (props.Status?.type === "status" && props.Status.status?.name?.toLowerCase() === "draft");
      const date = readDate(props, ["Fecha","Date","Published","Publicación"]);
      const assets = readFiles(props, ["Files","File","Media","Attachment","Attachments"]);
      const projectIds = readRelationIds(props, "PostProject");
      const clientIds  = readRelationIds(props, "PostClient");   // rollup o relation
      const brandIds   = readRelationIds(props, "PostBrands");   // rollup

      return { id: page.id, title, date, hidden, archived, draft, assets, projectIds, clientIds, brandIds };
    }).filter(p => !p.hidden && !p.archived);

    // Mapea IDs -> nombres (Project/Client/Brand)
    const allIds = [
      ...base.flatMap(b => b.projectIds),
      ...base.flatMap(b => b.clientIds),
      ...base.flatMap(b => b.brandIds)
    ];
    const titleMap = await getPageTitleMap(allIds);

    const posts = base.map(b => ({
      id: b.id,
      title: b.title,
      date: b.date,
      draft: !!b.draft,
      project: b.projectIds.length ? (titleMap.get(b.projectIds[0]) || "") : "",
      client:  b.clientIds.length  ? (titleMap.get(b.clientIds[0])  || "") : "",
      brands:  b.brandIds.map(id => titleMap.get(id)).filter(Boolean),
      assets:  b.assets
    }));

    // Meta (para selects)
    let meta = undefined;
    if (req.query.meta === "1") {
      const projects = [...new Set(posts.map(p => p.project).filter(Boolean))].sort();
      const clients  = [...new Set(posts.map(p => p.client ).filter(Boolean))].sort();
      const brandsByClient = {};
      clients.forEach(c => {
        brandsByClient[c] = [...new Set(
          posts.filter(p => p.client === c).flatMap(p => p.brands)
        )].sort();
      });
      meta = { projects, clients, brandsByClient };
    }

    // Filtros y paginación
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "24", 10), 1), 100);

    const filtered = applyInMemoryFilters(posts, {
      project: req.query.project || "",
      client:  req.query.client  || "",
      brand:   req.query.brand   || "",
      search:  req.query.q       || "",
      draft:   req.query.draft   || "0"
    });

    const start = (page - 1) * pageSize;
    const slice = filtered.slice(start, start + pageSize);
    const hasMore = start + pageSize < filtered.length;

    res.status(200).json({ ok: true, posts: slice, hasMore, filters: meta });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
