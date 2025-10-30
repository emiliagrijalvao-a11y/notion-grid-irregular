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

function getRelation(p, keys) {
  for (const k of keys) {
    const rel = p?.[k]?.relation || [];
    if (rel.length) return rel.map(r => ({ id: r.id }));
  }
  return [];
}

function getRelationIds(p, keys) {
  return getRelation(p, keys).map(r => r.id);
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
  if (!r.ok) throw new Error(`Notion ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  try {
    const dbId = process.env.NOTION_DATABASE_ID;
    if (!process.env.NOTION_TOKEN || !dbId) {
      return res.status(500).json({ error: "Missing credentials" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const qText = url.searchParams.get("q") || "";
    const projectFilter = url.searchParams.get("project") || "";
    const clientFilter = url.searchParams.get("client") || "";
    const brandFilter = url.searchParams.get("brand") || "";
    const draftOnly = url.searchParams.get("draft") === "1";

    const q = await notionFetch(`/databases/${dbId}/query`, {
      sorts: [{ property: "Created time", direction: "descending" }],
      page_size: 100,
    });

    const items = [];
    for (const r of (q.results || [])) {
      const p = r.properties || {};
      if (isHidden(p)) continue;

      const assets = filesToAssets(p["Attachment"]) || filesToAssets(p["Media"]) || [];
      const status = sel(p["Status"]) || "";
      const isDraft = status.toLowerCase() === "draft";

      const projectIds = getRelationIds(p, ["PostProject", "Project"]);
      const clientIds = getRelationIds(p, ["PostMain", "Client", "PostClient"]);
      const brandIds = getRelationIds(p, ["PostBrands", "Brands", "Brand"]);

      const title = rtText(p["Name"]) || rtText(p["Title"]) || "Untitled";

      if (projectFilter && !projectIds.includes(projectFilter)) continue;
      if (clientFilter && !clientIds.includes(clientFilter)) continue;
      if (brandFilter && !brandIds.includes(brandFilter)) continue;
      if (draftOnly && !isDraft) continue;
      if (qText && !title.toLowerCase().includes(qText.toLowerCase())) continue;

      items.push({
        id: r.id,
        title,
        status,
        isDraft,
        pinned: checkbox(p["Pinned"]),
        assets,
        isVideo: assets.some(a => a.type === "video"),
        projectIds,
        clientIds,
        brandIds,
      });
    }

    res.status(200).json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
