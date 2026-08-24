// 인원 연령대 분석 + 예산 티어 계산 + 장소 스코어링 + 동선(경로) 생성

const PRICE_LEVEL_SCORE = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** 만 나이 배열을 연령 그룹 비율로 변환 */
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

/** 1인당 예산으로 가격대 티어 결정 (전체 여행 기준, 원화) */
function budgetTier(totalBudget, peopleCount, days = 1) {
  const perPersonPerDay = totalBudget / Math.max(peopleCount, 1) / Math.max(days, 1);
  if (perPersonPerDay < 50000) return { tier: 'budget', maxPriceLevel: 1, label: '알뜰형' };
  if (perPersonPerDay < 120000) return { tier: 'mid', maxPriceLevel: 2, label: '표준형' };
  if (perPersonPerDay < 250000) return { tier: 'comfort', maxPriceLevel: 3, label: '여유형' };
  return { tier: 'luxury', maxPriceLevel: 4, label: '프리미엄형' };
}

/** 장소 하나에 대한 적합도 점수 계산 (0~100) */
function scorePlace(place, ageProfile, tier) {
  let score = 0;

  // 평점 기반 (최대 40점)
  if (place.rating) score += (place.rating / 5) * 40;

  // 리뷰 수 기반 신뢰도 (최대 15점)
  if (place.ratingCount) score += Math.min(place.ratingCount / 500, 1) * 15;

  // 예산 적합도 (최대 25점) - 가격대가 예산 티어 이하면 만점, 초과하면 감점
  const placeLevel = place.priceLevel ? PRICE_LEVEL_SCORE[place.priceLevel] : tier.maxPriceLevel;
  if (placeLevel <= tier.maxPriceLevel) score += 25;
  else score += Math.max(0, 25 - (placeLevel - tier.maxPriceLevel) * 12);

  // 연령대 적합도 (최대 20점)
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

/** 두 좌표간 거리(km, 하버사인) */
function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** 최근접 이웃 방식으로 동선(방문 순서) 생성 */
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

/** 장소 목록을 점수순 정렬 후 상위 N개 반환 */
function rankPlaces(places, ageProfile, tier, topN = 5) {
  return places
    .map((p) => ({ ...p, score: scorePlace(p, ageProfile, tier) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

module.exports = { analyzeAgeGroups, budgetTier, scorePlace, buildRoute, rankPlaces, distanceKm };
