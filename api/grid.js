// api/grid.js
const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const POSTS_DB = process.env.NOTION_POSTS_DB_ID;

function t(p) {
  if (!p) return "";
  if (p.type === "title") return (p.title||[]).map(x=>x.plain_text).join("").trim();
  if (p.type === "rich_text") return (p.rich_text||[]).map(x=>x.plain_text).join("").trim();
  if (p.type === "select") return p.select?.name || "";
  if (p.type === "url") return p.url || "";
  return "";
}
function rel(prop) {
  if (!prop) return [];
  if (prop.type === "relation") return (prop.relation||[]).map(r=>({ id:r.id, name:"" }));
  if (prop.type === "rollup" && prop.rollup?.type === "array") {
    return prop.rollup.array.map(a=>{
      if (a.type === "title")     return { id:"", name:(a.title||[]).map(x=>x.plain_text).join("") };
      if (a.type === "rich_text") return { id:"", name:(a.rich_text||[]).map(x=>x.plain_text).join("") };
      if (a.type === "relation")  return { id:a.relation?.id||"", name:"" };
      if (a.type === "people")    return { id:"", name:(a.people?.[0]?.name||a.people?.[0]?.id||"") };
      return { id:"", name:"" };
    });
  }
  return [];
}
function firstFileUrl(prop){
  const arr = prop?.files || [];
  const f = arr[0];
  if (!f) return null;
  if (f.type === "file")     return f.file.url;
  if (f.type === "external") return f.external.url;
  return null;
}
function isVideoUrl(url="") {
  const lower = url.toLowerCase();
  return [".mp4",".webm",".mov",".m4v",".avi",".mkv"].some(ext => lower.endsWith(ext));
}
function buildAssets(props) {
  // Prioridad y orden: Attachment -> Canva -> (Link si es un media directo)
  const buckets = [];
  const pushFiles = (prop) => {
    const arr = prop?.files || [];
    arr.forEach(f=>{
      const url = f.type === "file" ? f.file.url : f.external?.url;
      if (!url) return;
      buckets.push({ url, type: isVideoUrl(url) ? "video" : "image" });
    });
  };
  if (props.Attachment || props.Files) pushFiles(props.Attachment || props.Files);
  if (props.Canva) pushFiles(props.Canva);
  const linkUrl = t(props.Link);
  if (linkUrl && /^https?:\/\//i.test(linkUrl)) {
    buckets.push({ url: linkUrl, type: isVideoUrl(linkUrl) ? "video" : "image" });
  }
  return buckets;
}

function mapPageToPost(page) {
  const p = page.properties || {};
  const Name   = p.Name || p.Title || p.Título;
  const Status = p.Status || p.Estado;
  const Hide   = p.Hide || p.Archivado;
  const Date   = p.Fecha || p.PublishDate || p["Publish Date"];

  const ProjectProp = p.PostProject || p.Project || null;      // Relation → Projects
  const MainProp    = p.PostMain    || p.Main || p.Client;     // Rollup: Project → Client
  const BrandsProp  = p.PostBrands  || p.Brands || null;       // Rollup: Project → Brands

  const project = rel(ProjectProp)[0] || { id:"", name:"" };
  const client  = rel(MainProp)[0]    || { id:"", name:"" };
  const brands  = rel(BrandsProp).map(b=>({ id:b.id||"", name:b.name||"" }));

  return {
    id: page.id,
    title: t(Name) || "Untitled",
    date: (Date?.date?.start || "").slice(0,10),
    archived: !!(Hide?.checkbox),     // para compatibilidad con tu index actual
    hidden: !!(Hide?.checkbox),
    status: (Status?.select?.name || "").trim(),
    project,
    client,
    brands,
    assets: buildAssets(p)
  };
}

function isDraft(post){ return (post.status||"").toLowerCase() === "draft"; }
function matchQ(post, q){
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    (post.title||"").toLowerCase().includes(s) ||
    (post.project?.name||"").toLowerCase().includes(s) ||
    (post.client?.name||"").toLowerCase().includes(s) ||
    (post.brands||[]).map(x=>x.name).join(" ").toLowerCase().includes(s)
  );
}

async function fetchAllPosts(){
  if (!POSTS_DB) throw new Error("Missing NOTION_POSTS_DB_ID");
  let cursor, out=[];
  do {
    const resp = await notion.databases.query({
      database_id: POSTS_DB,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ timestamp: "created_time", direction: "descending" }]
    });
    out = out.concat(resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return out.map(mapPageToPost);
}

module.exports = async (req, res) => {
  try {
    const base = new URL(req.url, "http://localhost");
    const q       = base.searchParams.get("q") || "";
    const project = base.searchParams.get("project") || "";
    const client  = base.searchParams.get("client") || "";
    const brand   = base.searchParams.get("brand") || "";
    const draft   = base.searchParams.get("draft") === "1";
    const page    = Math.max(1, parseInt(base.searchParams.get("page") || "1", 10));
    const pageSize= Math.min(60, Math.max(1, parseInt(base.searchParams.get("pageSize") || "24", 10)));

    const all = (await fetchAllPosts())
      .filter(p => !p.hidden && !p.archived)
      .filter(p => !project || p.project.id===project || p.project.name===project)
      .filter(p => !client  || p.client.id===client   || p.client.name===client)
      .filter(p => !brand   || (p.brands||[]).some(b => b.id===brand || b.name===brand))
      .filter(p => !draft   || isDraft(p))
      .filter(p => matchQ(p, q));

    const total = all.length;
    const start = (page-1)*pageSize;
    const posts = all.slice(start, start+pageSize);

    res.setHeader("Cache-Control","s-maxage=120, stale-while-revalidate=600");
    res.status(200).json({ page, pageSize, total, posts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Grid API error", detail: String(e?.message||e) });
  }
};
