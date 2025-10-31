// api/health.js
module.exports = (req, res) => {
  res.status(200).json({
    ok: !!(process.env.NOTION_TOKEN && process.env.NOTION_POSTS_DB_ID),
    hasToken: !!process.env.NOTION_TOKEN,
    hasDb: !!process.env.NOTION_POSTS_DB_ID,
    now: new Date().toISOString()
  });
};
