const { Client } = require('@notionhq/client');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const notion = new Client({
      auth: process.env.NOTION_TOKEN
    });

    const databaseId = process.env.NOTION_DATABASE_ID;
    const clientsDbId = process.env.NOTION_CLIENTS_DB_ID;
    const projectsDbId = process.env.NOTION_PROJECTS_DB_ID;
    const brandsDbId = process.env.NOTION_BRANDS_DB_ID;

    // Obtener opciones de cada database
    const [postsDb, clientsDb, projectsDb, brandsDb] = await Promise.all([
      notion.databases.retrieve({ database_id: databaseId }),
      clientsDbId ? notion.databases.retrieve({ database_id: clientsDbId }) : null,
      projectsDbId ? notion.databases.retrieve({ database_id: projectsDbId }) : null,
      brandsDbId ? notion.databases.retrieve({ database_id: brandsDbId }) : null
    ]);

    // Extraer opciones de Platform desde Posts
    const platformOptions = postsDb.properties.Platform?.select?.options || [];

    // Obtener clientes activos
    let clients = [];
    if (clientsDb) {
      const clientsQuery = await notion.databases.query({
        database_id: clientsDbId,
        filter: {
          property: 'Status',
          select: {
            equals: 'Active'
          }
        },
        sorts: [{ property: 'Name', direction: 'ascending' }]
      });
      clients = clientsQuery.results.map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || 'Sin nombre'
      }));
    }

    // Obtener proyectos activos
    let projects = [];
    if (projectsDb) {
      const projectsQuery = await notion.databases.query({
        database_id: projectsDbId,
        sorts: [{ property: 'Name', direction: 'ascending' }]
      });
      projects = projectsQuery.results.map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || 'Sin nombre',
        client: page.properties.Client?.relation?.[0]?.id
      }));
    }

    // Obtener brands
    let brands = [];
    if (brandsDb) {
      const brandsQuery = await notion.databases.query({
        database_id: brandsDbId,
        sorts: [{ property: 'Name', direction: 'ascending' }]
      });
      brands = brandsQuery.results.map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || 'Sin nombre',
        client: page.properties.Client?.relation?.[0]?.id
      }));
    }

    return res.status(200).json({
      platforms: platformOptions.map(opt => ({ name: opt.name, color: opt.color })),
      clients,
      projects,
      brands
    });

  } catch (error) {
    console.error('Error en schema.js:', error);
    return res.status(500).json({ 
      error: 'Error cargando schema',
      details: error.message 
    });
  }
}
