// /api/grid.js
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const DB_ID = process.env.NOTION_DATABASE_ID;
const TOKEN = process.env.NOTION_TOKEN;

function getPlainText(rich) {
  if (!rich || !Array.isArray(rich)) return "";
  return rich.map(t => t.plain_text || "").join("").trim();
}

function getRollupNames(prop) {
  // Rollup puede devolver "array" de relaciones o rich_text.
  if (!prop) return [];
  // Caso rollup -> array de relaciones (con .people/.relation no llega en query)
  // En query de Notion, el rollup normalmente llega como "array" de rich_text/title.
  if (Array.isArray(prop)) {
    return prop.map(getPlainText).filter(Boolean);
  }
  if (prop.type === "array" && Array.isArray(prop.array)) {
    return prop.array.map(getPlainText).filter(Boolean);
  }
  if (prop.rich_text) {
    return [getPlainText(prop.rich_text)].filter(Boolean);
  }
  if (prop.title) {
    return [getPlainText(prop.title)].filter(Boolean);
  }
  // Fallback Notion SDK shape en /databases/query:
  if (Array.isArray(prop)) return prop.map(getPlainText).filter(Boolean);
  return [];
}

function extractAssets(props) {
  const files = (props.Files && props.Files.files) || [];
  return files.map(f => {
    const url = f.type === "external" ? f.external.url : f.file.url;
    const name = f.name || "";
    const lower = name.toLowerCase();
    const isVideo = [".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"].some(ext => lower.endsWith(ext));
    return { url, type: isVideo ? "video" : "image" };
  });
}

function readDraftFlag(p) {
  // Soporta checkbox "Draft" o status "Draft"
  if (p.Draft && p.Draft.type === "checkbox") return !!p.Draft.checkbox;
  if (p.Draft && p.Draft.type === "status") {
    return (p.Draft.status && /draft/i.test(p.Draft.status.name || "")) || false;
  }
  return false;
}

export default async function handler(req, res) {
  try {
    if (!TOKEN || !DB_ID) {
      return res.status(500).json({ error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    const url = `${NOTION_API}/databases/${DB_ID}/query`;
    const { q, draft } = req.query;

    const filters = [
      { property: "Hidden", checkbox: { equals: false } }
    ];

    if (draft === "1") {
      // Mostrar solo borradores
      // Si Draft es checkbox:
      filters.push({
        or: [
          { property: "Draft", checkbox: { equals: true } },
          // Si fuera Status "Draft", este OR no romperá (Notion ignora propiedades inexistentes)
          { property: "Draft", status: { equals: "Draft" } }
        ]
      });
    }

    if (q && q.trim()) {
      filters.push({ property: "Name", title: { contains: q.trim() } });
    }

    const body = {
      filter: { and: filters },
      sorts: [{ property: "Fecha", direction: "descending" }],
      page_size: 100
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Notion query failed: ${r.status} ${txt}`);
    }

    const json = await r.json();

    const items = (json.results || []).map(page => {
      const p = page.properties || {};
      const title = getPlainText((p.Name && p.Name.title) || []);
      const date = (p.Fecha && p.Fecha.date && p.Fecha.date.start) || "";
      const assets = extractAssets(p);
      const isDraft = readDraftFlag(p);

      // Rollups que configuraste en Posts:
      // - PostProjectName (rollup → Projects.Name)
      // - PostMain        (rollup → Projects.Client)   => Client
      // - PostBrands      (rollup → Projects.Brands[]) => Brands array
      const project =
        getRollupNames(p.PostProjectName?.rollup?.array || p.PostProjectName)?.[0] ||
        getRollupNames(p.PostProjectName)?.[0] ||
        "";

      const client =
        getRollupNames(p.PostMain?.rollup?.array || p.PostMain)?.[0] ||
        "";

      const brands =
        getRollupNames(p.PostBrands?.rollup?.array || p.PostBrands) ||
        [];

      return {
        id: page.id,
        title,
        date,
        project,
        client,
        brands,
        assets,
        isDraft
      };
    });

    res.status(200).json({ posts: items });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
