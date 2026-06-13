// Vercel serverless entry point.
// It reuses the EXACT same Express app that runs on Render — no logic is
// duplicated. server.js detects process.env.VERCEL and skips app.listen(),
// so importing it here just hands us the configured app.
import app from '../server.js';

export default function handler(req, res) {
  // Be tolerant of how the platform forwards the path. Every route in server.js
  // is defined under /api/..., so if the prefix is ever missing we re-add it.
  // (No-op when the path already starts with /api, which is the normal case.)
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
}
