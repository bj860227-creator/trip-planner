require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { searchPlaces } = require('./lib/places');
const { searchLocal, searchBlog } = require('./lib/naver');
const {
  analyzeAgeGroups, computeBudgetTiers, priceLevelsForTier, rankPlaces,
  buildDayItinerary, filterOutChains, filterByLocation, filterByDistance, markCrossVerified,
} = require('./lib/recommend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function pickBlogQuote(blogItems) {
  const candidate = blogItems.find((b) => b.description && b.description.length >= 15);
  if (!candidate) return null;
  const text = candidate.description;
  return text.length > 55 ? text.slice(0, 55) + '…' : text;
}

async function attachBlogQuotes(places, location) {
  const results = await Promise.all(
    places.map((p) => searchBlog(`${location} ${p.name} 후기`, 3))
  );
  places.forEach((p, i) => {
    const quote = pickBlogQuote(results[i]);
    if (quote) {
      const restOfReason = (p.reason || '').replace(/^(숙소 내 시설\(이동 없이 이용 가능\)\s*·?\s*)?방문자 리뷰: "[^"]*"\s*·?\s*/, '');
      p.blogQuote = quote;
      p.reason = `네이버 블로그 후기: "${quote}"${restOfReason ? ' · ' + restOfReason : ''}`;
    }
  });
  return places;
}

app.post('/api/recommend', async (req, res) => {
  try {
    const { people, location, budget, days, lodgingName, departureLocation, flightDeparture, flightReturn } = req.body;

    if (!Array.isArray(people) || people.length === 0 || !location || !budget) {
      return res.status(400).json({ error: 'people(배열), location, budget은 필수입니다.' });
    }

    const ages = people.map((p) => Number(p.age));
    const genderCounts = people.reduce((acc, p) => {
      acc[p.gender] = (acc[p.gender] || 0) + 1;
      return acc;
    }, {});
    const dayCount = Number(days) || 1;
    const ageProfile = analyzeAgeGroups(ages);
    const tiers = computeBudgetTiers(Number(budget), people.length, dayCount);

    let center = null;
    try {
      const centerResult = await searchPlaces(location, { maxResultCount: 1 });
      if (centerResult[0] && centerResult[0].lat != null) {
        center = { lat: centerResult[0].lat, lng: centerResult[0].lng };
      }
    } catch (e) { /* 무시하고 계속 */ }

    // 숙소
    let lodging = null;
    if (lodgingName && lodgingName.trim()) {
      const named = await searchPlaces(lodgingName.trim(), { maxResultCount: 1 });
      if (named[0]) {
        lodging = rankPlaces(named, ageProfile, tiers.lodging, 1, 'lodging')[0];
        if (!center && lodging.lat != null) center = { lat: lodging.lat, lng: lodging.lng };
      }
    }
    if (!lodging) {
      let lodgingResults = await searchPlaces(`${location} 조식 포함 숙소`, { maxResultCount: 10, minRating: 3.5 });
      if (!lodgingResults.length) {
        lodgingResults = await searchPlaces(`${location} 숙소`, { maxResultCount: 10, minRating: 3.0 });
      }
      lodgingResults = center ? filterByDistance(lodgingResults, center, 20) : filterByLocation(lodgingResults, location);
      lodging = rankPlaces(lodgingResults, ageProfile, tiers.lodging, 3, 'lodging')[0] || null;
    }
    if (!center && lodging && lodging.lat != null) center = { lat: lodging.lat, lng: lodging.lng };

    // 숙소 내 식당/카페
    let lodgingRestaurants = [];
    let lodgingCafes = [];
    if (lodging) {
      const lodgingCenter = { lat: lodging.lat, lng: lodging.lng };
      const [lr, lc] = await Promise.all([
        searchPlaces(`${lodging.name} 레스토랑`, { maxResultCount: 5 }),
        searchPlaces(`${lodging.name} 카페`, { maxResultCount: 5 }),
      ]);
      lodgingRestaurants = filterByDistance(lr, lodgingCenter, 2).map((p) => ({ ...p, isInHouse: true }));
      lodgingCafes = filterByDistance(lc, lodgingCenter, 2).map((p) => ({ ...p, isInHouse: true }));
    }

    const clinicPromise = ageProfile.hasYoungChildren
      ? searchPlaces(`${location} 소아과`, { maxResultCount: 5, minRating: 3.0 })
      : Promise.resolve([]);

    const restStopQuery = departureLocation && departureLocation.trim()
      ? `${departureLocation.trim()}에서 ${location} 가는 길 고속도로 휴게소`
      : `${location} 고속도로 휴게소`;

    const [
      restaurantsA, restaurantsB, cafesRaw, attrA, attrB, activityRaw, restStopRaw, clinicRaw,
      naverRestaurants, naverCafes,
    ] = await Promise.all([
      searchPlaces(`${location} 맛집`, { maxResultCount: 10, minRating: 3.8, priceLevels: priceLevelsForTier(tiers.food) }),
      searchPlaces(`${location} 현지인 맛집`, { maxResultCount: 10, minRating: 3.8, priceLevels: priceLevelsForTier(tiers.food) }),
      searchPlaces(`${location} 개인 카페`, { maxResultCount: 12, minRating: 3.8 }),
      searchPlaces(
        ageProfile.hasYoungChildren ? `${location} 아이와 가기 좋은 놀이공원 동물원 아쿠아리움` : `${location} 대표 관광명소`,
        { maxResultCount: 10, minRating: 3.5 }
      ),
      searchPlaces(
        ageProfile.hasYoungChildren ? `${location} 아이와 가기 좋은 박물관 체험관` : `${location} 박물관 공원 정원`,
        { maxResultCount: 10, minRating: 3.5 }
      ),
      searchPlaces(`${location} 케이블카 출렁다리 전망대`, { maxResultCount: 8, minRating: 3.5 }),
      searchPlaces(restStopQuery, { maxResultCount: 8, minRating: 3.5 }),
      clinicPromise,
      searchLocal(`${location} 맛집`, 30),
      searchLocal(`${location} 카페`, 30),
    ]);

    const restaurantMap = new Map();
    [...restaurantsA, ...restaurantsB, ...lodgingRestaurants].forEach((p) => restaurantMap.set(p.id, p));
    let mergedRestaurants = center ? filterByDistance([...restaurantMap.values()], center, 20) : filterByLocation([...restaurantMap.values()], location);

    const cafeMap = new Map();
    [...filterOutChains(cafesRaw), ...lodgingCafes].forEach((p) => cafeMap.set(p.id, p));
    let cafes = center ? filterByDistance([...cafeMap.values()], center, 15) : filterByLocation([...cafeMap.values()], location);

    const attrMap = new Map();
    [...attrA, ...attrB, ...activityRaw].forEach((p) => attrMap.set(p.id, p));
    let attractions = center ? filterByDistance([...attrMap.values()], center, 30) : filterByLocation([...attrMap.values()], location);

    mergedRestaurants = markCrossVerified(mergedRestaurants, naverRestaurants);
    cafes = markCrossVerified(cafes, naverCafes);

    const topRestaurants = rankPlaces(mergedRestaurants, ageProfile, tiers.food, 14, 'restaurant');
    const topCafes = rankPlaces(cafes, ageProfile, tiers.food, 10, 'cafe');
    const topAttractions = rankPlaces(attractions, ageProfile, tiers.food, 14, 'attraction');
    const topRestStops = rankPlaces(restStopRaw, ageProfile, tiers.food, 2, 'restaurant');

    await attachBlogQuotes(topRestaurants, location);
    await attachBlogQuotes(topCafes, location);
    if (lodging) await attachBlogQuotes([lodging], location);

    const itinerary = buildDayItinerary(
      dayCount, topRestaurants, topCafes, topAttractions,
      lodging, topRestStops, { departureTime: flightDeparture || null, returnTime: flightReturn || null }
    );

    const clinicSorted = center ? filterByDistance(clinicRaw, center, 15) : clinicRaw;
    const clinic = clinicSorted.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0))[0] || null;

    res.json({
      ageProfile,
      genderCounts,
      budgetTiers: tiers,
      recommendations: {
        restaurants: topRestaurants,
        cafes: topCafes,
        lodgings: lodging ? [lodging] : [],
        attractions: topAttractions,
      },
      itinerary,
      pediatricClinic: clinic ? { name: clinic.name, address: clinic.address, rating: clinic.rating } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Trip planner API running on port ${PORT}`));
