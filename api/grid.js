// /api/grid.js (Vercel Serverless Function)

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/* ----------------------------- helpers ----------------------------- */

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
  if (p.select && p.select.name) return p.select.name;
  if (p.status && p.status.name) return p.status.name;
  return "";
}

function checkbox(p) {
  return !!(p && p.checkbox);
}

function dateStr(p) {
  const v = p?.date?.start || "";
  return v || "";
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
    const type = isVideo ? "video" : "image";
    return { type, url };
  }).filter(a => a.url);
}

function getTitleFromProps(p = {}) {
  const candidates = [p?.Title?.title, p?.Name?.title];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      const t = firstText(c);
      if (t) return t;
    }
  }
  const rt = [p?.Title?.rich_text, p?.Name?.rich_text];
  for (const c of rt) {
    if (Array.isArray(c) && c.length) {
      const t = firstText(c);
      if (t) return t;
    }
  }
  return "";
}

function getUrlFromProps(p = {}, keys = ["URL", "Url", "Link", "Website", "Web", "Sitio"]) {
  for (const k of keys) {
    if (p[k]?.type === "url" && p[k]?.url) return p[k].url;
    if (p[k]?.rich_text?.length) {
      const t = firstText(p[k].rich_text);
      if (t) return t;
    }
  }
  return null;
}

function getSelect(p, keyList) {
  for (const k of keyList) {
    const v = p?.[k]?.select?.name || p?.[k]?.status?.name;
    if (v) return v;
  }
  return null;
}

function getCheckbox(p, keyList) {
  for (const k of keyList) {
    const v = p?.[k]?.checkbox;
    if (typeof v === "boolean") return v;
  }
  return false;
}

function getRelation(p, keyList) {
  for (const k of keyList) {
    const rel = p?.[k]?.relation || [];
    if (rel.length) return rel.map(r => r.id);
  }
  return [];
}

function isHidden(props = {}) {
  if (getCheckbox(props, ["Hidden", "Hide", "Oculto"])) return true;
  for (const [name, val] of Object.entries(props)) {
    if (val?.type === "checkbox" && val.checkbox) {
      const n = name.toLowerCase();
      if (/hide|hidden|ocult/.test(n)) return true;
    }
  }
  return false;
}

function freqSort(arr) {
  const count = {};
  arr.forEach(x => { count[x] = (count[x] || 0) + 1; });
  return [...new Set(arr)].sort((a, b) => (count[b] || 0) - (count[a] || 0));
}

/* ----------------------------- Notion ----------------------------- */

async function notionFetch(path, body) {
  const r = await fetch(`${NOTION_API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`Notion ${r.status}: ${t}`);
  }
  return r.json();
}

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  try {
    const dbId = process.env.NOTION_DATABASE_ID;
    if (!process.env.NOTION_TOKEN || !dbId) {
      return res.status(200).json({ ok:false, error:"Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    // Params filtros
    const url = new URL(req.url, `http://${req.headers.host}`);
    const qText = url.searchParams.get("q") || "";
    const projectFilter = url.searchParams.get("project") || "";
    const clientFilter = url.searchParams.get("client") || "";
    const brandFilter = url.searchParams.get("brand") || "";
    const draftOnly = url.searchParams.get("draft") === "1";

    // 1) GRID PAGES
    const q = await notionFetch(`/databases/${dbId}/query`, {
      sorts: [{ property: "Publish Date", direction: "descending" }],
      page_size: 100,
    });

    const items = [];
    for (const r of (q.results || [])) {
      const p = r.properties || {};
      if (isHidden(p)) continue;

      const assets =
        filesToAssets(p["Attachment"]) ||
        filesToAssets(p["Attachments"]) ||
        filesToAssets(p["Media"]) ||
        filesToAssets(p["Image"]) ||
        [];
      const thumb = assets[0]?.url || null;

      const status = getSelect(p, ["Status", "Estado"]) || null;
      const isDraft = status && status.toLowerCase() === "draft";

      const projectIds = getRelation(p, ["Project", "PostProject", "Proyecto"]);
      const clientIds = getRelation(p, ["Client", "PostClient", "PostMain", "Main"]);
      const brandIds = getRelation(p, ["Brand", "PostBrand", "PostBrands", "Brands", "Marca"]);

      const title = getTitleFromProps(p);
      const caption = rtText(p["Caption"]) || rtText(p["Description"]) || rtText(p["Text"]) || "";

      // Filtros
      if (projectFilter && !projectIds.includes(projectFilter)) continue;
      if (clientFilter && !clientIds.includes(clientFilter)) continue;
      if (brandFilter && !brandIds.includes(brandFilter)) continue;
      if (draftOnly && !isDraft) continue;
      if (qText) {
        const q = qText.toLowerCase();
        const match = [title, caption].some(t => (t || "").toLowerCase().includes(q));
        if (!match) continue;
      }

      items.push({
        id: r.id,
        title,
        caption,
        platform: getSelect(p, ["Platform", "Platforms", "Channel", "Social", "Plataforma"]) || "Other",
        status,
        isDraft,
        pinned: getCheckbox(p, ["Pinned", "Pin", "Destacado", "Fijado"]) || false,
        date: dateStr(p["Publish Date"]) || dateStr(p["Date"]) || dateStr(p["Fecha"]) || "",
        link: getUrlFromProps(p) || null,
        assets,
        isVideo: assets.some(a => a.type === "video"),
        image: thumb,
        projectIds,
        clientIds,
        brandIds,
      });
    }

    // 2) BIO (opcional, mantén igual)
    let bio = null;
    const bioDb = process.env.BIO_DATABASE_ID || process.env.BIO_SETTINGS_DATABASE_ID;
    if (bioDb) {
      const qb = await notionFetch(`/databases/${bioDb}/query`, {
        page_size: 1,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      });
      const row = (qb.results || [])[0];
      if (row) {
        const bp = row.properties || {};
        const avatarFiles = filesToAssets(bp["Avatar"]);
        const bioText = rtText(bp["Bio"]) || rtText(bp["Text"]) || "";
        bio = {
          username: rtText(bp["Username"]) || rtText(bp["Handle"]) || "",
          name: rtText(bp["Name"]) || "",
          textLines: bioText ? bioText.split("\n").map(s=>s.trim()).filter(Boolean) : [],
          url: urlProp(bp["URL"]) || urlProp(bp["Link"]) || "",
          avatar: avatarFiles[0]?.url || "",
        };
      }
    }
    if (!bio) {
      bio = {
        username: process.env.BIO_USERNAME || "",
        name: process.env.BIO_NAME || "",
        textLines: (process.env.BIO_TEXT || "").split("\n").map(s=>s.trim()).filter(Boolean),
        url: process.env.BIO_URL || "",
        avatar: process.env.BIO_AVATAR || "",
      };
    }

    // 3) Filtros dinámicos
    const platforms = items.map(i => i.platform).filter(Boolean);
    const statuses = items.map(i => i.status).filter(Boolean);
    const P = freqSort(platforms);
    const S = freqSort(statuses);
    const igIndex = P.findIndex(x => (x||"").toLowerCase() === "instagram");
    if (igIndex > 0) { P.splice(0, 0, P.splice(igIndex, 1)[0]); }

    res.status(200).json({
      ok: true,
      dbId,
      items,
      bio,
      filters: { platforms: P, status: S }
    });
  } catch (err) {
    res.status(200).json({ ok:false, error: String(err.message || err) });
  }
}
