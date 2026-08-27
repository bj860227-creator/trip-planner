const fetch = require('node-fetch');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const BASE_URL = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.photos',
  'places.types',
  'places.currentOpeningHours.openNow',
  'places.websiteUri',
].join(',');

async function searchPlaces(query, opts = {}) {
  if (!API_KEY) {
    throw new Error('GOOGLE_PLACES_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }

  const body = {
    textQuery: query,
    languageCode: 'ko',
    maxResultCount: opts.maxResultCount || 10,
  };
  if (opts.minRating) body.minRating = opts.minRating;
  if (opts.priceLevels && opts.priceLevels.length) body.priceLevels = opts.priceLevels;

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Places API 오류 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.places || []).map(normalizePlace);
}

function normalizePlace(p) {
  return {
    id: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    rating: p.rating || null,
    ratingCount: p.userRatingCount || 0,
    priceLevel: p.priceLevel || null,
    types: p.types || [],
    openNow: p.currentOpeningHours?.openNow ?? null,
    website: p.websiteUri || null,
    photoRef: p.photos?.[0]?.name || null,
  };
}

module.exports = { searchPlaces };
