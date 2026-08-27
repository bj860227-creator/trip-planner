require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { searchPlaces } = require('./lib/places');
const {
  analyzeAgeGroups, computeBudgetTiers, priceLevelsForTier, rankPlaces,
  buildDayItinerary, filterOutChains, filterByLocation,
} = require('./lib/recommend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

    // 숙소: 이름을 지정하셨으면 그 숙소를, 아니면 (가격 필터 없이) 평점순으로 찾고 점수 계산 때 예산 반영
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

    const [restaurantsA, restaurantsB, cafesRaw, attrMorningRaw, attrAfternoonRaw] = await Promise.all([
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
    ]);

    const restaurantMap = new Map();
    [...restaurantsA, ...restaurantsB].forEach((p) => restaurantMap.set(p.id, p));
    const mergedRestaurants = filterByLocation([...restaurantMap.values()], location);
    const cafes = filterByLocation(filterOutChains(cafesRaw), location);
    const attrMorning = filterByLocation(attrMorningRaw, location);
    const attrAfternoon = filterByLocation(attrAfternoonRaw, location);

    const topRestaurants = rankPlaces(mergedRestaurants, ageProfile, tiers.food, 12, 'restaurant');
    const topCafes = rankPlaces(cafes, ageProfile, tiers.food, 8, 'cafe');
    const topAttractionsMorning = rankPlaces(attrMorning, ageProfile, tiers.food, 6, 'attraction');
    const topAttractionsAfternoon = rankPlaces(attrAfternoon, ageProfile, tiers.food, 6, 'attraction');

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
