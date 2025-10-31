// /api/grid.js - CON FILTROS DE STATUS Y DRAFT
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
    const statuses = new Map();
    const drafts = new Map();

    for (const r of (query.results || [])) {
      const p = r.properties || {};
      
      const hideVal = checkbox(p["Hide"]);
      if (hideVal) continue;

      const titleProp = p[""] || p["Name"];
      const title = rtText(titleProp) || "Untitled";

      const attachmentFiles = p.Attachment?.files || [];
      let assets = attachmentFiles.map(f => ({
        type: "image",
        url: f.external?.url || f.file?.url
      })).filter(a => a.url);

      let thumb = assets[0]?.url || (p.Link?.url ? p.Link.url : null);

      const draftFormula = p.Draft?.formula?.boolean || false;
      const status = p.Status?.status?.name || "Sin estado";
      const isDraft = draftFormula;

      items.push({
        id: r.id,
        title,
        status,
        isDraft,
        pinned: checkbox(p.Pinned),
        thumb,
        assets,
        isVideo: false,
      });

      // Recolectar filtros
      const statusKey = status || "Sin estado";
      if (!statuses.has(statusKey)) {
        statuses.set(statusKey, { name: statusKey, count: 0 });
      }
      statuses.get(statusKey).count++;

      const draftKey = isDraft ? "Draft" : "Published";
      if (!drafts.has(draftKey)) {
        drafts.set(draftKey, { name: draftKey, count: 0 });
      }
      drafts.get(draftKey).count++;
    }

    res.status(200).json({
      ok: true,
      items,
      filters: {
        statuses: Array.from(statuses.values()),
        drafts: Array.from(drafts.values()),
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
