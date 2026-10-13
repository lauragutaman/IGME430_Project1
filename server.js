import http from 'http';
import fs from 'fs/promises';
import path from 'path';

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.resolve('./client');

let countriesData = [];
const visitedCountries = []; // filled by POST /api/addVisited
const soloRatings = []; // filled by POST /api/addRating

// ======================= Helpers =======================

// Sends a JSON response. HEAD requests get the same headers as GET
// (including the real Content-Length) but no body. 204 has no body at all.
function sendJSON(req, res, statusCode, data) {
  if (statusCode === 204) {
    res.writeHead(204);
    return res.end();
  }
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(payload);
}

// Reads a POST body. Supports JSON and x-www-form-urlencoded.
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          return resolve(JSON.parse(body));
        } catch (err) {
          return reject(err);
        }
      }
      return resolve(Object.fromEntries(new URLSearchParams(body)));
    });
    req.on('error', reject);
  });
}

const clean = (value) => (value || '').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

const findCountry = (name) => countriesData.find((c) => same(c.name, name));

// The fields we show for a country in list results
const summarize = (c) => ({
  name: clean(c.name),
  capital: c.capital || 'N/A',
  region: c.region || 'N/A',
  subregion: c.subregion || 'N/A',
  currency: c.finance.currency,
  currencyName: c.finance.currency_name,
});

// Haversine formula: straight-line distance between two lat/long points
function distanceKm(a, b) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRad(b.longitude) - toRad(a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h)); // 6371 = Earth's radius in km
}

// ======================= Static client files =======================

const MIME_TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

async function serveStatic(req, res, pathname) {
  const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(CLIENT_DIR, fileName);
  const type = MIME_TYPES[path.extname(filePath)];

  // Only known file types, and never anything outside the client folder
  if (!type || !filePath.startsWith(CLIENT_DIR)) return false;

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  } catch {
    return false;
  }
}

// ======================= GET / HEAD endpoints =======================

const getRoutes = {
  // GET /api/getAllCountries -> every country with all of its data
  '/api/getAllCountries': (req, res) => sendJSON(req, res, 200, countriesData),

  // GET /api/getCountries?region=Europe&subregion=Southern Europe
  '/api/getCountries': (req, res, query) => {
    if (!query.region && !query.subregion) {
      return sendJSON(req, res, 400, { error: 'Provide a region and/or subregion' });
    }
    let results = countriesData;
    if (query.region) results = results.filter((c) => same(c.region, query.region));
    if (query.subregion) results = results.filter((c) => same(c.subregion, query.subregion));

    if (results.length === 0) {
      return sendJSON(req, res, 404, { error: 'No countries match that region/subregion' });
    }
    return sendJSON(req, res, 200, results.map(summarize));
  },

  // GET /api/getCountriesByCurrency?currency=EUR&region=Europe&subregion=...
  // currency can be a code (EUR) or a name (euro)
  '/api/getCountriesByCurrency': (req, res, query) => {
    if (!query.currency) return sendJSON(req, res, 400, { error: 'currency is required' });

    let results = countriesData.filter((c) => same(c.finance.currency, query.currency)
      || same(c.finance.currency_name, query.currency));
    if (query.region) results = results.filter((c) => same(c.region, query.region));
    if (query.subregion) results = results.filter((c) => same(c.subregion, query.subregion));

    if (results.length === 0) {
      return sendJSON(req, res, 404, { error: `No countries use "${query.currency}" with those filters` });
    }
    return sendJSON(req, res, 200, results.map(summarize));
  },

  // GET /api/getDistance?from=France&to=Peru
  '/api/getDistance': (req, res, query) => {
    if (!query.from || !query.to) {
      return sendJSON(req, res, 400, { error: 'Both from and to are required' });
    }
    const a = findCountry(query.from);
    const b = findCountry(query.to);
    if (!a || !b) {
      const missing = !a ? query.from : query.to;
      return sendJSON(req, res, 404, { error: `Country "${missing}" not found` });
    }
    const km = distanceKm(a, b);
    return sendJSON(req, res, 200, {
      from: clean(a.name),
      to: clean(b.name),
      km: Math.round(km),
      miles: Math.round(km * 0.621371),
    });
  },

  // GET /api/getVisited -> countries added with POST /api/addVisited
  '/api/getVisited': (req, res) => sendJSON(req, res, 200, visitedCountries),

  // GET /api/getRatings -> solo-travel ratings, highest first
  '/api/getRatings': (req, res) => {
    const sorted = [...soloRatings].sort((x, y) => y.rating - x.rating);
    return sendJSON(req, res, 200, sorted);
  },
};

// ======================= POST endpoints =======================

const postRoutes = {
  // POST /api/addVisited  body: name (required), capital, region, subregion
  // 201 = added, 204 = already there so its details were updated
  '/api/addVisited': async (req, res) => {
    const body = await parseRequestBody(req);
    if (!clean(body.name)) return sendJSON(req, res, 400, { error: 'name is required' });

    const country = findCountry(body.name);
    if (!country) return sendJSON(req, res, 404, { error: `Country "${body.name}" not found` });

    // Blank fields fall back to the dataset's values
    const entry = {
      name: clean(country.name),
      capital: clean(body.capital) || country.capital || 'N/A',
      region: clean(body.region) || country.region || 'N/A',
      subregion: clean(body.subregion) || country.subregion || 'N/A',
    };

    const existing = visitedCountries.find((v) => v.name === entry.name);
    if (existing) {
      Object.assign(existing, entry);
      return sendJSON(req, res, 204);
    }
    visitedCountries.push(entry);
    return sendJSON(req, res, 201, entry);
  },

  // POST /api/addRating  body: name (required), capital, rating 1-5 (required), comment
  // How friendly is this country for women traveling solo?
  // 201 = new rating, 204 = existing rating updated
  '/api/addRating': async (req, res) => {
    const body = await parseRequestBody(req);
    if (!clean(body.name) || body.rating === undefined || body.rating === '') {
      return sendJSON(req, res, 400, { error: 'name and rating are required' });
    }

    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return sendJSON(req, res, 400, { error: 'rating must be a whole number from 1 to 5' });
    }

    const country = findCountry(body.name);
    if (!country) return sendJSON(req, res, 404, { error: `Country "${body.name}" not found` });

    const entry = {
      name: clean(country.name),
      capital: clean(body.capital) || country.capital || 'N/A',
      rating,
      comment: clean(body.comment),
    };

    const existing = soloRatings.find((r) => r.name === entry.name);
    if (existing) {
      Object.assign(existing, entry);
      return sendJSON(req, res, 204);
    }
    soloRatings.push(entry);
    return sendJSON(req, res, 201, entry);
  },
};

// ======================= Server =======================

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = parsedUrl;
  const query = Object.fromEntries(parsedUrl.searchParams);
  const { method } = req;
  const isGet = method === 'GET' || method === 'HEAD';

  try {
    if (isGet && getRoutes[pathname]) return getRoutes[pathname](req, res, query);
    if (method === 'POST' && postRoutes[pathname]) return await postRoutes[pathname](req, res);
    if (isGet && await serveStatic(req, res, pathname)) return undefined;
  } catch {
    // Usually a malformed JSON body
    return sendJSON(req, res, 400, { error: 'Invalid request body' });
  }

  return sendJSON(req, res, 404, { error: `${method} ${pathname} not found` });
});

// Load the data first, then start listening
async function start() {
  const raw = await fs.readFile(path.resolve('./countries.json'), 'utf8');
  countriesData = JSON.parse(raw);
  server.listen(PORT, () => {
    console.log(`Loaded ${countriesData.length} countries. Running on http://localhost:${PORT}`);
  });
}

start();
