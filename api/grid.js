// /api/grid.js - DEBUG V2
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

    const debug = query.results.map(r => {
      const p = r.properties || {};
      const titleProp = p[""] || p["Name"];
      const title = rtText(titleProp);
      const hideVal = checkbox(p["Hide"]);
      const attachmentCount = p.Attachment?.files?.length || 0;
      const hasLink = !!p.Link?.url;
      
      return {
        id: r.id,
        title,
        hideVal,
        attachmentCount,
        hasLink,
        linkUrl: p.Link?.url || null,
        willShow: !hideVal && (attachmentCount > 0 || hasLink)
      };
    });

    const willShow = debug.filter(d => d.willShow);

    res.status(200).json({
      total: debug.length,
      willShow: willShow.length,
      items: debug
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
