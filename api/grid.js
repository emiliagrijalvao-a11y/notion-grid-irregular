// /api/grid.js - VERSIÓN FINAL CORRECTA
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

async function getPageImage(pageId) {
  try {
    const resp = await notionFetch(`/blocks/${pageId}/children`, { page_size: 10 });
    for (const block of resp.results || []) {
      if (block.type === "image") {
        const img = block.image;
        if (img?.external?.url) return img.external.url;
        if (img?.file?.url) return img.file.url;
      }
    }
  } catch (e) {
    console.error(`Error getting image for ${pageId}:`, e);
  }
  return null;
}

export default async function handler(req, res) {
  try {
    const dbId = process.env.NOTION_DATABASE_ID;
    const query = await notionFetch(`/databases/${dbId}/query`, { page_size: 100 });

    const items = [];
    const projects = new Map();
    const clients = new Map();
    const brands = new Map();

    // Obtener imágenes en paralelo
    const itemsWithImages = await Promise.all(
      (query.results || []).map(async (r) => {
        const p = r.properties || {};
        const titleProp = p[""] || p["Name"];
        const title = rtText(titleProp) || "Untitled";
        const hideVal = checkbox(p["Hide"]);
        
        if (hideVal) return null;

        let thumb = null;
        // Intentar obtener imagen de Attachment
        if (p.Attachment?.files?.length > 0) {
          const f = p.Attachment.files[0];
          thumb = f.external?.url || f.file?.url;
        }
        // Si no, intentar del Link
        if (!thumb && p.Link?.url) {
          thumb = p.Link.url;
        }
        // Si aún no, buscar en los bloques de la página
        if (!thumb) {
          thumb = await getPageImage(r.id);
        }

        return { r, p, title, thumb };
      })
    );

    for (const item of itemsWithImages) {
      if (!item) continue;
      const { r, p, title, thumb } = item;

      const draftFormula = p.Draft?.formula?.boolean || false;
      const status = p.Status?.status?.name || "";
      const isDraft = draftFormula;

      const projectIds = (p.PostProject?.relation || []).map(x => x.id);
      const clientIds = (p.PostClient?.rollup?.array || [])
        .filter(x => x.type === "relation")
        .map(x => x.id);
      const brandIds = (p.PostBrands?.rollup?.array || [])
        .filter(x => x.type === "relation")
        .map(x => x.id);

      items.push({
        id: r.id,
        title,
        status,
        isDraft,
        pinned: checkbox(p.Pinned),
        thumb,
        assets: thumb ? [{ type: "image", url: thumb }] : [],
        isVideo: false,
        projectIds,
        clientIds,
        brandIds,
      });

      projectIds.forEach(id => {
        if (!projects.has(id)) projects.set(id, { id, name: id });
      });
      clientIds.forEach(id => {
        if (!clients.has(id)) clients.set(id, { id, name: id });
      });
      brandIds.forEach(id => {
        if (!brands.has(id)) brands.set(id, { id, name: id, clientIds: [...clientIds] });
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
