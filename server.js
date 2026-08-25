require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { searchPlaces } = require('./lib/places');
const { analyzeAgeGroups, budgetTier, rankPlaces, buildRoute } = require('./lib/recommend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/recommend', async (req, res) => {
  try {
    const { people, location, budget, days } = req.body;

    if (!Array.isArray(people) || people.length === 0 || !location || !budget) {
      return res.status(400).json({
        error: 'people(배열), location, budget은 필수입니다.',
      });
    }

    const ages = people.map((p) => Number(p.age));
    const genderCounts = people.reduce((acc, p) => {
      acc[p.gender] = (acc[p.gender] || 0) + 1;
      return acc;
    }, {});

    const ageProfile = analyzeAgeGroups(ages);
    const tier = budgetTier(Number(budget), people.length, Number(days) || 1);

    const [restaurants, cafes, lodgings, attractions] = await Promise.all([
      searchPlaces(`${location} 맛집`, { maxResultCount: 12, minRating: 3.5 }),
      searchPlaces(`${location} 카페`, { maxResultCount: 12, minRating: 3.5 }),
      searchPlaces(`${location} 숙소`, { maxResultCount: 10, minRating: 3.5 }),
      searchPlaces(
        ageProfile.hasYoungChildren ? `${location} 아이와 가볼만한 곳` : `${location} 가볼만한 곳`,
        { maxResultCount: 12, minRating: 3.5 }
      ),
    ]);

    const topRestaurants = rankPlaces(restaurants, ageProfile, tier, 5);
    const topCafes = rankPlaces(cafes, ageProfile, tier, 5);
    const topLodgings = rankPlaces(lodgings, ageProfile, tier, 3);
    const topAttractions = rankPlaces(attractions, ageProfile, tier, 6);

    const routeCandidates = [
      ...topAttractions.slice(0, 4),
      topRestaurants[0],
      topCafes[0],
    ].filter(Boolean);
    const route = buildRoute(routeCandidates);

    res.json({
      ageProfile,
      genderCounts,
      budgetTier: tier,
      recommendations: {
        restaurants: topRestaurants,
        cafes: topCafes,
        lodgings: topLodgings,
        attractions: topAttractions,
      },
      route,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Trip planner API running on port ${PORT}`));
