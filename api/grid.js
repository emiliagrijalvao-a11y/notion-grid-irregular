// /api/grid.js
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function firstText(arr = []) {
  return (arr[0]?.plain_text ?? "").trim();
}

function rtText(p) {
  if (!p) return "";
  const arr = p.rich_text || p.title || [];
  return arr.map(x => x.plain_text || "").join("").trim();
}

function sel(p) {
  if (!p) return "";
  if (p.select?.name) return p.select.name;
  if (p.status?.name) return p.status.name;
  return "";
}

function checkbox(p) {
  return !!(p && p.checkbox);
}

function dateStr(p) {
  return p?.date?.start || "";
}

function urlProp(p) {
  return p?.url || "";
}

function fileUrl(f) {
  if (!f) return null;
  if (f.type === "file") return f.file?.url || null;
  if (f.type === "external") return f.external?.url || null;
  return null;
}

function filesToAssets(p) {
  const files = p?.files || [];
  return files.map(f => {
    const url = f.external?.url || f.file?.url || "";
    const name = f.name || "";
    const lower = (name || url).toLowerCase();
    const isVideo = /\.(mp4|webm|mov|m4v|avi|mkv)$/.test(lower);
    return { type: isVideo ? "video" : "image", url };
  }).filter(a => a.url);
}

function getRollupRelations(p) {
  if (!p) return [];
  const rollup = p.rollup;
  if (!rollup) return [];
  if (rollup.type === "array") {
    return rollup.array
      .filter(item => item.type === "relation")
      .map(item => item.id);
  }
  return [];
}

function getRelationIds(p) {
  if (!p) return [];
  const relation = p.relation || [];
  return relation.map(r => r.id);
}

function isHidden(p) {
  return checkbox(p["Hidden"]) || checkbox(p["Hide"]) || checkbox(p["Oculto"]);
}

async function notionFetch(path, body) {
  const r = await fetch(`${NOTION_API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Notion ${r.status}: ${text}`);
  }
  return r.json();
}

export default async function handler(req, res) {
  try {
    const dbId = process.env.NOTION_DATABASE_ID;
    if (!process.env.NOTION_TOKEN || !dbId) {
      return res.status(500).json({ error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    // Query params para filtros
    const url = new URL(req.url, `http://${req.headers.host}`);
    const qText = (url.searchParams.get("q") || "").toLowerCase();
    const projectFilter = url.searchParams.get("project") || "";
    const clientFilter = url.searchParams.get("client") || "";
    const brandFilter = url.searchParams.get("brand") || "";
    const draftOnly = url.searchParams.get("draft") === "1";

    // Consultar base Content/Posts
    const query = await notionFetch(`/databases/${dbId}/query`, {
      sorts: [{ property: "Created time", direction: "descending" }],
      page_size: 100,
    });

    const items = [];
    const projects = new Map();
    const clients = new Map();
    const brands = new Map();

    for (const r of (query.results || [])) {
      const p = r.properties || {};
      
      // Ocultar Hidden
      if (isHidden(p)) continue;

      // Cover/Media
      const coverFiles = p.Cover?.files || [];
      const mediaFiles = p.Media?.files || [];
      const assets = filesToAssets({ files: coverFiles.length ? coverFiles : mediaFiles });
      const thumb = assets[0]?.url || null;

      // Title
      const title = rtText(p.Name) || "Untitled";

      // Status y Draft
      const status = sel(p.Status) || "";
      const draftCheckbox = checkbox(p.Draft);
      const isDraft = draftCheckbox || status.toLowerCase() === "draft";

      // Relaciones: PostProject (relation directa), PostMain y PostBrands (rollups)
      const projectIds = getRelationIds(p.PostProject);
      const clientIds = getRollupRelations(p.PostMain);
      const brandIds = getRollupRelations(p.PostBrands);

      // Aplicar filtros
      if (projectFilter && !projectIds.includes(projectFilter)) continue;
      if (clientFilter && !clientIds.includes(clientFilter)) continue;
      if (brandFilter && !brandIds.includes(brandFilter)) continue;
      if (draftOnly && !isDraft) continue;
      if (qText && !title.toLowerCase().includes(qText)) continue;

      // Agregar a resultados
      items.push({
        id: r.id,
        title,
        status,
        isDraft,
        pinned: checkbox(p.Pinned),
        thumb,
        assets,
        isVideo: assets.some(a => a.type === "video"),
        projectIds,
        clientIds,
        brandIds,
      });

      // Construir listas de filtros (Projects/Clients/Brands únicos)
      projectIds.forEach(id => {
        if (!projects.has(id)) projects.set(id, { id, name: id });
      });
      clientIds.forEach(id => {
        if (!clients.has(id)) clients.set(id, { id, name: id });
      });
      brandIds.forEach(id => {
        if (!brands.has(id)) {
          brands.set(id, { id, name: id, clientIds: [...clientIds] });
        }
      });
    }

    res.status(200).json({
      ok: true,
      items,
      filters: {
        projects: Array.from(projects.values()),
        clients: Array.from(clients.values()),
        brands: Array.from(brands.values()),
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
