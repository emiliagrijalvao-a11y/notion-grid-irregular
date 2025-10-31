// /api/grid.js
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function rtText(p) {
  if (!p) return "";
  const arr = p.rich_text || p.title || [];
  return arr.map(x => x.plain_text || "").join("").trim();
}

function checkbox(p) {
  return !!(p && p.checkbox);
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
  if (!r.ok) throw new Error(`Notion ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  try {
    const dbId = process.env.NOTION_DATABASE_ID;
    const query = await notionFetch(`/databases/${dbId}/query`, { page_size: 100 });

    const items = [];
    const projects = new Map();
    const clients = new Map();
    const brands = new Map();

    for (const r of (query.results || [])) {
      const p = r.properties || {};
      
      const hideVal = checkbox(p["Hide"]);
      if (hideVal) continue;

      // Título
      const titleProp = p[""] || p["Name"];
      const title = rtText(titleProp) || "Untitled";

      // Imágenes
      const attachmentFiles = p.Attachment?.files || [];
      let assets = attachmentFiles.map(f => ({
        type: "image",
        url: f.external?.url || f.file?.url
      })).filter(a => a.url);

      let thumb = assets[0]?.url || (p.Link?.url ? p.Link.url : null);

      // Status y Draft
      const draftFormula = p.Draft?.formula?.boolean || false;
      const status = p.Status?.status?.name || "";
      const isDraft = draftFormula;

      // Relaciones - IMPORTANTES
      // PostProject es una RELATION directa
      const projectIds = (p.PostProject?.relation || []).map(x => x.id);
      
      // PostClient es una ROLLUP (array de people)
      const clientRollup = p.PostClient?.rollup?.array || [];
      const clientIds = clientRollup.map(item => item.id); // IDs de los clientes
      
      // PostBrands es una ROLLUP (array de relations)
      const brandRollup = p.PostBrands?.rollup?.array || [];
      const brandIds = brandRollup.map(item => item.id); // IDs de los brands

      items.push({
        id: r.id,
        title,
        status,
        isDraft,
        pinned: checkbox(p.Pinned),
        thumb,
        assets,
        isVideo: false,
        projectIds,
        clientIds,
        brandIds,
      });

      // Construir filtros
      projectIds.forEach(id => {
        if (!projects.has(id)) projects.set(id, { id, name: id });
      });
      clientIds.forEach(id => {
        if (!clients.has(id)) clients.set(id, { id, name: id });
      });
      brandIds.forEach(id => {
        if (!brands.has(id)) brands.set(id, { id, name: id });
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
