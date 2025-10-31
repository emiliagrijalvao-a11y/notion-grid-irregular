// /api/grid.js
// ❗ Esto es para Next.js / Vercel Functions (Node 18+)

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;

// --- helpers de Notion ---
async function notionQuery(body) {
  const res = await fetch("https://api.notion.com/v1/databases/" + NOTION_DB_ID + "/query", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("Notion error:", res.status, txt);
    throw new Error("Notion query failed: " + res.status);
  }

  return res.json();
}

// saca texto plano de title/rich_text
function toPlain(richArray = []) {
  return richArray.map(t => t.plain_text).join("");
}

// saca nombre de relation/rollup (page → title)
function relationToName(rel) {
  if (!rel) return null;
  if (Array.isArray(rel) && rel.length === 0) return null;
  // una relation en Notion es array de pages
  const first = Array.isArray(rel) ? rel[0] : rel;
  // a veces viene como {rich_text:...} si es rollup
  if (first?.title) {
    return toPlain(first.title);
  }
  if (first?.name) {
    return first.name;
  }
  if (first?.plain_text) {
    return first.plain_text;
  }
  // si viene como page_id solo, no podemos leer el nombre aquí
  return null;
}

// saca files
function extractAssets(props) {
  // prioridad de campos de media
  const mediaKeys = ["Attachment", "Attachments", "Media", "File", "Files", "Link", "Canva"];
  let mediaProp = null;
  for (const key of mediaKeys) {
    if (props[key]) {
      mediaProp = props[key];
      break;
    }
  }

  if (!mediaProp) return [];

  // según tipo
  if (mediaProp.type === "files" && Array.isArray(mediaProp.files)) {
    return mediaProp.files.map(f => ({
      url: f.external?.url || f.file?.url,
      type: guessType(f.external?.url || f.file?.url),
      source: "attachment"
    })).filter(x => x.url);
  }

  if (mediaProp.type === "url" && mediaProp.url) {
    return [{
      url: mediaProp.url,
      type: guessType(mediaProp.url),
      source: "link"
    }];
  }

  return [];
}

function guessType(url = "") {
  const u = url.toLowerCase();
  if (u.endsWith(".mp4") || u.includes("vimeo") || u.includes("youtube")) return "video";
  return "image";
}

// mapea 1 página de notion → objeto del widget
function mapPost(page) {
  const props = page.properties || {};

  const title = props["Post"]?.title ? toPlain(props["Post"].title) : (
    props["Name"]?.title ? toPlain(props["Name"].title) : ""
  );

  const date = props["Publish Date"]?.date?.start || null;
  const status = props["Status"]?.status?.name || null;

  // relations
  const clientRel = props["PostClient"]?.relation || [];
  const projectRel = props["PostProject"]?.relation || [];
  const brandRel = props["PostBrands"]?.relation || props["PostBrand"]?.relation || [];

  // owner
  const owner = props["Owner"]?.people?.[0]?.name || null;

  // copy
  const copy = props["Copy"]?.rich_text ? toPlain(props["Copy"].rich_text) : "";

  const assets = extractAssets(props);

  const pinned = props["Pinned"]?.checkbox || false;
  const archived = props["Archivado"]?.checkbox || false;
  const hidden = props["Hide"]?.checkbox || false;

  // platforms (multi-select)
  const platforms = props["Platform"]?.multi_select?.map(p => p.name) || [];

  return {
    id: page.id,
    title,
    date,
    status,
    type: props["Type"]?.select?.name || null,
    platforms,
    client: clientRel.length ? "__REL__" + clientRel[0].id : null,
    project: projectRel.length ? "__REL__" + projectRel[0].id : null,
    brand: brandRel.length ? "__REL__" + brandRel[0].id : null,
    owner,
    pinned,
    archived,
    hidden,
    copy,
    assets
  };
}

// saca nombres legibles de relations (segundo query)
async function fillRelationNames(list) {
  // recolectamos ids
  const clientIds = new Set();
  const projectIds = new Set();
  const brandIds = new Set();

  list.forEach(p => {
    if (p.client && p.client.startsWith("__REL__")) clientIds.add(p.client.replace("__REL__", ""));
    if (p.project && p.project.startsWith("__REL__")) projectIds.add(p.project.replace("__REL__", ""));
    if (p.brand && p.brand.startsWith("__REL__")) brandIds.add(p.brand.replace("__REL__", ""));
  });

  // si no hay relations, nada
  if (!clientIds.size && !projectIds.size && !brandIds.size) return list;

  // función para leer 1 page
  async function fetchPage(id) {
    const r = await fetch("https://api.notion.com/v1/pages/" + id, {
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28"
      }
    });
    if (!r.ok) return null;
    return r.json();
  }

  // resolver clients
  const clientMap = {};
  for (const id of clientIds) {
    const page = await fetchPage(id);
    const titleProp = page?.properties?.Name?.title;
    clientMap[id] = titleProp ? toPlain(titleProp) : "Client";
  }

  const projectMap = {};
  for (const id of projectIds) {
    const page = await fetchPage(id);
    const titleProp = page?.properties?.Name?.title;
    projectMap[id] = titleProp ? toPlain(titleProp) : "Project";
  }

  const brandMap = {};
  for (const id of brandIds) {
    const page = await fetchPage(id);
    const titleProp = page?.properties?.Name?.title;
    brandMap[id] = titleProp ? toPlain(titleProp) : "Brand";
  }

  // reemplazar en posts
  return list.map(p => {
    if (p.client && p.client.startsWith("__REL__")) {
      const id = p.client.replace("__REL__", "");
      p.client = clientMap[id] || p.client;
    }
    if (p.project && p.project.startsWith("__REL__")) {
      const id = p.project.replace("__REL__", "");
      p.project = projectMap[id] || p.project;
    }
    if (p.brand && p.brand.startsWith("__REL__")) {
      const id = p.brand.replace("__REL__", "");
      p.brand = brandMap[id] || p.brand;
    }
    return p;
  });
}

export default async function handler(req, res) {
  try {
    if (!NOTION_TOKEN || !NOTION_DB_ID) {
      return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DB_ID" });
    }

    const {
      cursor,
      limit = "12",
      client,
      project,
      brand,
      platform,
      status = "published",
      q
    } = req.query;

    // filtros base (no archivados, no ocultos)
    const andFilters = [
      {
        property: "Archivado",
        checkbox: { equals: false }
      },
      {
        property: "Hide",
        checkbox: { equals: false }
      }
    ];

    // status
    if (status !== "all") {
      andFilters.push({
        property: "Status",
        status: {
          does_not_equal: "Draft"
        }
      });
      // tu definición de "published only"
      // (Aprobado, Scheduled, Entregado, Publicado)
      andFilters.push({
        property: "Status",
        status: {
          is_not_empty: true
        }
      });
    }

    // client / project / brand / platform / q
    // OJO: como ahora son relations reales, filtramos por "contains" en title con un filter extra
    // pero ojo: Notion no filtra directamente por nombre de relation, así que estos filtros
    // los vamos a hacer en MEMORIA después de traerlos.
    const body = {
      page_size: Number(limit),
      sorts: [
        { property: "Pinned", direction: "descending" },
        { property: "Publish Date", direction: "descending" }
      ],
      filter: {
        and: andFilters
      }
    };

    if (cursor) {
      body.start_cursor = cursor;
    }

    const notionData = await notionQuery(body);

    // mapear posts
    let posts = (notionData.results || []).map(mapPost);

    // rellenar nombres de relations
    posts = await fillRelationNames(posts);

    // filtros en memoria (porque Notion no nos deja filtrar por nombre de relation)
    if (client) {
      posts = posts.filter(p => (p.client || "").toLowerCase() === client.toLowerCase());
    }
    if (project) {
      posts = posts.filter(p => (p.project || "").toLowerCase() === project.toLowerCase());
    }
    if (brand) {
      posts = posts.filter(p => (p.brand || "").toLowerCase() === brand.toLowerCase());
    }
    if (platform) {
      posts = posts.filter(p => (p.platforms || []).includes(platform));
    }
    if (q) {
      const ql = q.toLowerCase();
      posts = posts.filter(p =>
        (p.title || "").toLowerCase().includes(ql) ||
        (p.client || "").toLowerCase().includes(ql) ||
        (p.project || "").toLowerCase().includes(ql)
      );
    }

    // armar filtros a partir de lo que ya trajimos
    const filters = {
      clients: Array.from(new Set(posts.map(p => p.client).filter(Boolean))).sort(),
      projects: Array.from(new Set(posts.map(p => p.project).filter(Boolean))).sort(),
      brands: Array.from(new Set(posts.map(p => p.brand).filter(Boolean))).sort(),
      platforms: ["Instagram","Tiktok","Youtube","Facebook","Página web","Pantalla"],
      owners: Array.from(new Set(posts.map(p => p.owner).filter(Boolean))).map((name, i) => ({
        name,
        color: OWNER_COLORS[i % OWNER_COLORS.length],
        initials: name.slice(0,2).toUpperCase(),
        count: posts.filter(p => p.owner === name).length
      }))
    };

    return res.status(200).json({
      ok: true,
      posts,
      filters,
      has_more: notionData.has_more,
      next_cursor: notionData.next_cursor || null
    });

  } catch (err) {
    console.error("API /grid error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

const OWNER_COLORS = [
  "#10B981",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#3B82F6",
  "#EF4444",
  "#FCD34D",
  "#14B8A6",
  "#A855F7",
  "#22C55E"
];
