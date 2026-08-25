const PRICE_LEVEL_SCORE = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function analyzeAgeGroups(ages) {
  const groups = { infant: 0, kid: 0, teen: 0, young: 0, middle: 0, senior: 0 };
  for (const age of ages) {
    if (age <= 6) groups.infant++;
    else if (age <= 12) groups.kid++;
    else if (age <= 18) groups.teen++;
    else if (age <= 35) groups.young++;
    else if (age <= 59) groups.middle++;
    else groups.senior++;
  }
  const total = ages.length || 1;
  const ratio = {};
  for (const k in groups) ratio[k] = groups[k] / total;
  return { counts: groups, ratio, hasYoungChildren: groups.infant + groups.kid > 0, hasSenior: groups.senior > 0 };
}

function budgetTier(totalBudget, peopleCount, days = 1) {
  const perPersonPerDay = totalBudget / Math.max(peopleCount, 1) / Math.max(days, 1);
  if (perPersonPerDay < 50000) return { tier: 'budget', maxPriceLevel: 1, label: '알뜰형' };
  if (perPersonPerDay < 120000) return { tier: 'mid', maxPriceLevel: 2, label: '표준형' };
  if (perPersonPerDay < 250000) return { tier: 'comfort', maxPriceLevel: 3, label: '여유형' };
  return { tier: 'luxury', maxPriceLevel: 4, label: '프리미엄형' };
}

function scorePlace(place, ageProfile, tier) {
  let score = 0;
  if (place.rating) score += (place.rating / 5) * 40;
  if (place.ratingCount) score += Math.min(place.ratingCount / 500, 1) * 15;
  const placeLevel = place.priceLevel ? PRICE_LEVEL_SCORE[place.priceLevel] : tier.maxPriceLevel;
  if (placeLevel <= tier.maxPriceLevel) score += 25;
  else score += Math.max(0, 25 - (placeLevel - tier.maxPriceLevel) * 12);
  const types = place.types.join(' ');
  if (ageProfile.hasYoungChildren) {
    if (/park|amusement_park|zoo|aquarium|museum|playground/.test(types)) score += 20;
    else if (/bar|night_club/.test(types)) score -= 20;
    else score += 8;
  } else if (ageProfile.hasSenior) {
    if (/park|museum|temple|garden|spa/.test(types)) score += 15;
    else score += 8;
  } else {
    score += 12;
  }
  return Math.max(0, Math.round(score));
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function buildRoute(places) {
  if (places.length === 0) return [];
  const remaining = [...places];
  const route = [remaining.shift()];
  while (remaining.length) {
    const last = route[route.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((p, i) => {
      if (last.lat == null || p.lat == null) return;
      const d = distanceKm(last, p);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    route.push(remaining.splice(bestIdx, 1)[0]);
  }
  return route;
}

function rankPlaces(places, ageProfile, tier, topN = 5) {
  return places
    .map((p) => ({ ...p, score: scorePlace(p, ageProfile, tier) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

module.exports = { analyzeAgeGroups, budgetTier, scorePlace, buildRoute, rankPlaces, distanceKm };
