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
    const clients = new Map();
    const brands = new Map();
    const projects = new Map();

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

      const status = p.Status?.status?.name || "Sin estado";
      const isDraft = checkbox(p.Draft?.formula);

      // LEER CLIENTES desde PostClient (ROLLUP)
      const postClientArray = p.PostClient?.rollup?.array || [];
      const clientNames = postClientArray.map(x => {
        if (typeof x === 'string') return x;
        if (x && x.name) return x.name;
        return null;
      }).filter(x => x);

      // LEER BRANDS desde PostBrands (ROLLUP)
      const postBrandsArray = p.PostBrands?.rollup?.array || [];
      const brandNames = postBrandsArray.map(x => {
        if (typeof x === 'string') return x;
        if (x && x.name) return x.name;
        return null;
      }).filter(x => x);

      // LEER PROJECTS desde PostProject (RELATION)
      const projectArray = p.PostProject?.relation || [];
      const projectNames = projectArray.map(x => {
        if (typeof x === 'string') return x;
        if (x && x.title) return x.title;
        if (x && x.name) return x.name;
        return null;
      }).filter(x => x);

      items.push({
        id: r.id,
        title,
        status,
        isDraft,
        pinned: checkbox(p.Pinned),
        thumb,
        assets,
        isVideo: false,
        clientNames,
        brandNames,
        projectNames,
      });

      // Filtros
      const statusKey = status || "Sin estado";
      if (!statuses.has(statusKey)) {
        statuses.set(statusKey, { name: statusKey, count: 0 });
      }
      statuses.get(statusKey).count++;

      clientNames.forEach(cname => {
        if (!clients.has(cname)) {
          clients.set(cname, { name: cname, count: 0 });
        }
        clients.get(cname).count++;
      });

      brandNames.forEach(bname => {
        if (!brands.has(bname)) {
          brands.set(bname, { name: bname, count: 0 });
        }
        brands.get(bname).count++;
      });

      projectNames.forEach(pname => {
        if (!projects.has(pname)) {
          projects.set(pname, { name: pname, count: 0 });
        }
        projects.get(pname).count++;
      });
    }

    res.status(200).json({
      ok: true,
      items,
      filters: {
        statuses: Array.from(statuses.values()),
        clients: Array.from(clients.values()),
        brands: Array.from(brands.values()),
        projects: Array.from(projects.values()),
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
