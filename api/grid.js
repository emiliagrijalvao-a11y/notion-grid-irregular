// /api/grid.js - VERSION DEBUG
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

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
      return res.status(500).json({ error: "Missing credentials" });
    }

    const query = await notionFetch(`/databases/${dbId}/query`, {
      page_size: 10,
    });

    // DEBUG: Mostrar TODO sin procesar
    const debug = {
      totalResults: query.results.length,
      results: query.results.map(r => ({
        id: r.id,
        properties: Object.keys(r.properties || {}),
        rawProperties: r.properties
      }))
    };

    res.status(200).json(debug);

  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
