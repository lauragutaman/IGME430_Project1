import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import url from 'url';

const PORT = process.env.PORT || 3000;
let countriesData = [];
let userTravelList = [];

function sendResponse(res, statusCode, data, contentType = 'application/json') {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

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
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(body);
        const parsed = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        resolve(parsed);
      } else {
        resolve({ raw: body });
      }
    });
    req.on('error', (err) => reject(err));
  });
}

// Load countries.json into memory
async function initData() {
  try {
    const rawData = await fs.readFile(path.resolve('./countries.json'), 'utf8');
    countriesData = JSON.parse(rawData);
    console.log(`Loaded ${countriesData.length} countries from countries.json`);
  } catch (err) {
    console.error('Failed to load countries.json:', err.message);
  }
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const { pathname, query } = parsedUrl;
  const method = req.method;

  // GET / API Endpoints (Support HEAD as well)

  // GET Endpoint 1: Search / Filter countries
  if (pathname === '/api/countries' && (method === 'GET' || method === 'HEAD')) {
    let results = countriesData;
    if (query.search) {
      const q = query.search.toLowerCase();
      results = results.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.capital && c.capital.toLowerCase().includes(q))
      );
    }
    if (query.limit) {
      results = results.slice(0, parseInt(query.limit, 10));
    }
    return sendResponse(res, 200, method === 'HEAD' ? '' : results);
  }

  // GET Endpoint 2: Get user travel entries
  if (pathname === '/api/travel' && (method === 'GET' || method === 'HEAD')) {
    return sendResponse(res, 200, method === 'HEAD' ? '' : userTravelList);
  }

  // GET Endpoint 3: Filter countries by region
  if (pathname === '/api/regions' && (method === 'GET' || method === 'HEAD')) {
    const regions = [...new Set(countriesData.map((c) => c.region).filter(Boolean))];
    return sendResponse(res, 200, method === 'HEAD' ? '' : regions);
  }

  // GET Endpoint 4: Get server/API statistics
  if (pathname === '/api/stats' && (method === 'GET' || method === 'HEAD')) {
    const stats = {
      totalCountries: countriesData.length,
      savedTravelEntries: userTravelList.length,
    };
    return sendResponse(res, 200, method === 'HEAD' ? '' : stats);
  }

  // POST API Endpoints

  // POST Endpoint 1: Add a country to travel list
  if (pathname === '/api/travel' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      if (!body.countryName) {
        return sendResponse(res, 400, { error: 'countryName is required' });
      }

      const countryDetails = countriesData.find(
        (c) => c.name.toLowerCase() === body.countryName.toLowerCase()
      );

      if (!countryDetails) {
        return sendResponse(res, 404, { error: 'Country not found in dataset' });
      }

      const newEntry = {
        id: Date.now(),
        countryName: countryDetails.name,
        capital: countryDetails.capital || 'N/A',
        region: countryDetails.region || 'N/A',
        listType: body.listType || 'wishlist',
        notes: body.notes || '',
      };

      userTravelList.push(newEntry);
      return sendResponse(res, 201, newEntry);
    } catch {
      return sendResponse(res, 400, { error: 'Invalid body payload' });
    }
  }

  // POST Endpoint 2: Update an existing travel record
  if (pathname === '/api/travel/update' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      const id = parseInt(body.id, 10);
      const entry = userTravelList.find((item) => item.id === id);

      if (!entry) {
        return sendResponse(res, 404, { error: 'Entry not found' });
      }

      if (body.listType) entry.listType = body.listType;
      if (body.notes) entry.notes = body.notes;

      return sendResponse(res, 200, entry);
    } catch {
      return sendResponse(res, 400, { error: 'Invalid body payload' });
    }
  }

  // Handle 404 for unknown endpoints
  return sendResponse(res, 404, { error: '404 - Endpoint Not Found' });
});

server.listen(PORT, async () => {
  await initData();
  console.log(`Server executing on port ${PORT}`);
});