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

  return json.results.map(post => ({
    id: post.id,
    title: post.properties.Name.title.map(t => t.plain_text).join(" "),
    archived: post.properties.Archivado.checkbox,
    hidden: post.properties.Hidden.checkbox,
    date: post.properties.Fecha?.date?.start || "",
    assets: extractAssets(post.properties),
  })).filter(post => !post.hidden && !post.archived);
}

function extractAssets(props) {
  const files = props.Files?.files || [];
  return files.map(f => ({
    url: f.type === "external" ? f.external.url : f.file.url,
    type: isVideo(f.name) ? "video" : "image"
  }));
}

function isVideo(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return [".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"].some(ext => lower.endsWith(ext));
}

export default async function handler(req, res) {
  try {
    const posts = await getPosts();
    res.status(200).json({ posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
