const statusEl = document.querySelector('#status');
const metaEl = document.querySelector('#meta');
const outputEl = document.querySelector('#output');

const STATUS_TEXT = {
  200: 'OK',
  201: 'Created',
  204: 'No Content (updated)',
  400: 'Bad Request',
  404: 'Not Found',
};

let allCountries = []; // loaded once on page load, used for dropdowns + autofill

//  Show a response 

async function showResponse(response, method, url) {
  statusEl.textContent = `${method} ${url} → ${response.status} ${STATUS_TEXT[response.status] || ''}`;
  statusEl.className = response.ok ? 'ok' : 'error';
  const length = response.headers.get('Content-Length');
  metaEl.textContent = length ? `Content-Length: ${length} bytes` : '';

  if (method === 'HEAD') {
    outputEl.textContent = 'HEAD returns headers only, no body.';
    return null;
  }
  if (response.status === 204) {
    outputEl.textContent = 'No body. The existing entry was updated.';
    return null;
  }

  const data = await response.json();
  if (Array.isArray(data)) metaEl.textContent += ` · ${data.length} results`;
  outputEl.textContent = JSON.stringify(data, null, 2);
  return data;
}

function buildUrl(base, form) {
  const params = new URLSearchParams();
  new FormData(form).forEach((value, key) => {
    if (key !== 'method' && value !== '') params.append(key, value);
  });
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

//  GET / HEAD forms

function hookGetForm(formId, endpoint) {
  const form = document.querySelector(formId);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const method = form.elements.method.value;
    const url = buildUrl(endpoint, form);
    const response = await fetch(url, { method });
    showResponse(response, method, url);
  });
}

hookGetForm('#regionForm', '/api/getCountries');
hookGetForm('#currencyForm', '/api/getCountriesByCurrency');
hookGetForm('#distanceForm', '/api/getDistance');
hookGetForm('#allForm', '/api/getAllCountries');

//  Lists of data 

function renderList(listId, items, makeText) {
  const list = document.querySelector(listId);
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<li class="muted">Nothing yet.</li>';
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = makeText(item); 
    list.appendChild(li);
  });
}

async function refreshLists() {
  const visited = await (await fetch('/api/getVisited')).json();
  renderList('#visitedList', visited, (v) => `${v.name} · ${v.capital} · ${v.subregion}`);

  const ratings = await (await fetch('/api/getRatings')).json();
  renderList('#ratingList', ratings, (r) => `${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}  ${r.name}${r.comment ? ` — ${r.comment}` : ''}`);
}

// 
document.querySelectorAll('button[data-get]').forEach((button) => {
  button.addEventListener('click', async () => {
    const url = button.dataset.get;
    const response = await fetch(url);
    showResponse(response, 'GET', url);
  });
});

//  POST forms 

// POST addVisited sends JSON
document.querySelector('#visitedForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = '/api/addVisited';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
  });
  await showResponse(response, 'POST', url);
  if (response.ok) e.target.reset();
  refreshLists();
});

// POST addRating sends form url encoded (so the server handles both body types)
document.querySelector('#ratingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = '/api/addRating';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(new FormData(e.target)).toString(),
  });
  await showResponse(response, 'POST', url);
  if (response.ok) e.target.reset();
  refreshLists();
});

//  Dropdowns + autofill 

const unique = (values) => [...new Set(values.filter(Boolean))].sort();

// When a region is picked, only show that region's subregions
function fillSubregions(form) {
  const region = form.querySelector('.region-select').value;
  const subSelect = form.querySelector('.subregion-select');
  const matches = allCountries.filter((c) => !region || c.region === region);
  subSelect.innerHTML = '<option value="">Any</option>';
  unique(matches.map((c) => c.subregion)).forEach((s) => subSelect.add(new Option(s, s)));
}

// When a country is typed/picked, fill in its capital/region/subregion
function autofill(input) {
  const form = input.closest('form');
  const country = allCountries.find((c) => c.name.trim().toLowerCase() === input.value.trim().toLowerCase());
  if (!country) return;
  const set = (cls, value) => {
    const field = form.querySelector(cls);
    if (field) field.value = value || '';
  };
  set('.fill-capital', country.capital);
  set('.fill-region', country.region);
  set('.fill-subregion', country.subregion);
}

async function init() {
  allCountries = await (await fetch('/api/getAllCountries')).json();

  const countryList = document.querySelector('#countryList');
  allCountries.forEach((c) => countryList.appendChild(new Option(c.name.trim())));

  const currencyList = document.querySelector('#currencyList');
  unique(allCountries.map((c) => c.finance.currency)).forEach((code) => {
    const name = allCountries.find((c) => c.finance.currency === code).finance.currency_name;
    currencyList.appendChild(new Option(code, name));
  });

  const regions = unique(allCountries.map((c) => c.region));
  document.querySelectorAll('.region-select').forEach((select) => {
    regions.forEach((r) => select.add(new Option(r, r)));
    select.addEventListener('change', () => fillSubregions(select.closest('form')));
    fillSubregions(select.closest('form'));
  });

  document.querySelectorAll('.country-input').forEach((input) => {
    input.addEventListener('change', () => autofill(input));
  });

  refreshLists();
}

init();
