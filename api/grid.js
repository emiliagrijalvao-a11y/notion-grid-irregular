// api/grid.js (parche corregido)

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function getPosts() {
  const response = await fetch(`${NOTION_API}/databases/${process.env.NOTION_DATABASE_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filter: {
        and: [
          { property: "Archivado", checkbox: { equals: false } },
          { property: "Hidden", checkbox: { equals: false } }
        ]
      },
      sorts: [{ property: "Fecha", direction: "descending" }]
    })
  });

  if (!response.ok) {
    throw new Error("Error fetching posts from Notion.");
  }

  const json = await response.json();

  return json.results.map(post => {
    // Parse post properties and assets
    // ... (pasa según tu código original)
    return {
      id: post.id,
      title: post.properties.Name.title.map(t => t.plain_text).join(" "),
      archived: post.properties.Archivado.checkbox,
      hidden: post.properties.Hidden.checkbox,
      assets: extractAssets(post.properties),
      // ... otros campos
    };
  }).filter(post => !post.hidden && !post.archived);
}

export default async function handler(req, res) {
  try {
    const posts = await getPosts();
    // Arma filtros dinámicos si aplicas
    res.status(200).json({ posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function extractAssets(props) {
  // Extrae archivos (imágenes/videos) de propiedades files
  // según estructura de props.files
  // Implementa según tu código original
  return props.Files.files.map(f => ({
    url: f.type === "external" ? f.external.url : f.file.url,
    type: isVideo(f.name) ? "video" : "image"
  }));
}

function isVideo(filename) {
  if (!filename) return false;
  const ext = filename.toLowerCase();
  return [".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"].some(e => ext.endsWith(e));
}
