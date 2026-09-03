require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { searchPlaces } = require('./lib/places');
const { searchLocal, searchBlog } = require('./lib/naver');
const {
  analyzeAgeGroups, computeBudgetTiers, priceLevelsForTier, rankPlaces,
  buildDayItinerary, filterOutChains, filterByLocation, markCrossVerified,
} = require('./lib/recommend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/** 블로그 검색 결과에서 쓸만한 문장 하나를 골라요 */
function pickBlogQuote(blogItems) {
  const candidate = blogItems.find((b) => b.description && b.description.length >= 15);
  if (!candidate) return null;
  const text = candidate.description;
  return text.length > 55 ? text.slice(0, 55) + '…' : text;
}

/** 후보 장소들에 네이버 블로그 후기 문구를 붙여서 reason을 다시 만들어요 */
async function attachBlogQuotes(places, location) {
  const results = await Promise.all(
    places.map((p) => searchBlog(`${location} ${p.name} 후기`, 3))
  );
  places.forEach((p, i) => {
    const quote = pickBlogQuote(results[i]);
    if (quote) {
      const restOfReason = (p.reason || '').replace(/^방문자 리뷰: "[^"]*"\s*·?\s*/, '');
      p.blogQuote = quote;
      p.reason = `네이버 블로그 후기: "${quote}"${restOfReason ? ' · ' + restOfReason : ''}`;
    }
  });
  return places;
}

app.post('/api/recommend', async (req, res) => {
  try {
    const { people, location, budget, days, lodgingName, flightDeparture, flightReturn } = req.body;

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

    // 숙소
    let lodging = null;
    if (lodgingName && lodgingName.trim()) {
      const named = await searchPlaces(lodgingName.trim(), { maxResultCount: 1 });
      if (named[0]) {
        lodging = rankPlaces(named, ageProfile, tiers.lodging, 1, 'lodging')[0];
      }
    }
    if (!lodging) {
      let lodgingResults = await searchPlaces(`${location} 조식 포함 숙소`, { maxResultCount: 10, minRating: 3.5 });
      if (!lodgingResults.length) {
        lodgingResults = await searchPlaces(`${location} 숙소`, { maxResultCount: 10, minRating: 3.0 });
      }
      lodgingResults = filterByLocation(lodgingResults, location);
      lodging = rankPlaces(lodgingResults, ageProfile, tiers.lodging, 3, 'lodging')[0] || null;
    }

    const [
      restaurantsA, restaurantsB, cafesRaw, attrMorningRaw, attrAfternoonRaw,
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
      searchLocal(`${location} 맛집`, 30),
      searchLocal(`${location} 카페`, 30),
    ]);

    const restaurantMap = new Map();
    [...restaurantsA, ...restaurantsB].forEach((p) => restaurantMap.set(p.id, p));
    let mergedRestaurants = filterByLocation([...restaurantMap.values()], location);
    let cafes = filterByLocation(filterOutChains(cafesRaw), location);
    const attrMorning = filterByLocation(attrMorningRaw, location);
    const attrAfternoon = filterByLocation(attrAfternoonRaw, location);

    mergedRestaurants = markCrossVerified(mergedRestaurants, naverRestaurants);
    cafes = markCrossVerified(cafes, naverCafes);

    const topRestaurants = rankPlaces(mergedRestaurants, ageProfile, tiers.food, 12, 'restaurant');
    const topCafes = rankPlaces(cafes, ageProfile, tiers.food, 8, 'cafe');
    const topAttractionsMorning = rankPlaces(attrMorning, ageProfile, tiers.food, 6, 'attraction');
    const topAttractionsAfternoon = rankPlaces(attrAfternoon, ageProfile, tiers.food, 6, 'attraction');

    // 최종 후보들에만 네이버 블로그 후기 붙이기 (API 호출 절약)
    await attachBlogQuotes(topRestaurants, location);
    await attachBlogQuotes(topCafes, location);
    if (lodging) await attachBlogQuotes([lodging], location);

    const itinerary = buildDayItinerary(
      dayCount, topRestaurants, topCafes, topAttractionsMorning, topAttractionsAfternoon,
      lodging, { departureTime: flightDeparture || null, returnTime: flightReturn || null }
    );

    res.json({
      ageProfile,
      genderCounts,
      budgetTiers: tiers,
      recommendations: {
        restaurants: topRestaurants,
        cafes: topCafes,
        lodgings: lodging ? [lodging] : [],
        attractionsMorning: topAttractionsMorning,
        attractionsAfternoon: topAttractionsAfternoon,
      },
      itinerary,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Trip planner API running on port ${PORT}`));
