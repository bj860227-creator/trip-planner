// 인원 연령대 분석 + 예산 티어 계산 + 장소 스코어링 + 시간대별 동선 생성

const PRICE_LEVEL_SCORE = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const PRICE_ESTIMATES = {
  restaurant: {
    PRICE_LEVEL_FREE: '무료', PRICE_LEVEL_INEXPENSIVE: '1인 1만원대',
    PRICE_LEVEL_MODERATE: '1인 2~3만원대', PRICE_LEVEL_EXPENSIVE: '1인 4~6만원대',
    PRICE_LEVEL_VERY_EXPENSIVE: '1인 7만원 이상',
  },
  cafe: {
    PRICE_LEVEL_FREE: '무료', PRICE_LEVEL_INEXPENSIVE: '1인 5천원대',
    PRICE_LEVEL_MODERATE: '1인 7천~1만원대', PRICE_LEVEL_EXPENSIVE: '1인 1만원 이상',
    PRICE_LEVEL_VERY_EXPENSIVE: '1인 1만5천원 이상',
  },
  lodging: {
    PRICE_LEVEL_FREE: '-', PRICE_LEVEL_INEXPENSIVE: '1박 5~8만원대',
    PRICE_LEVEL_MODERATE: '1박 10~15만원대', PRICE_LEVEL_EXPENSIVE: '1박 20~30만원대',
    PRICE_LEVEL_VERY_EXPENSIVE: '1박 30만원 이상',
  },
  attraction: {
    PRICE_LEVEL_FREE: '무료', PRICE_LEVEL_INEXPENSIVE: '입장료 1만원 이하',
    PRICE_LEVEL_MODERATE: '입장료 1~2만원대', PRICE_LEVEL_EXPENSIVE: '입장료 2~4만원대',
    PRICE_LEVEL_VERY_EXPENSIVE: '입장료 4만원 이상',
  },
};

// 정확한 메뉴 정보는 없어서, 대신 대략적인 음식/장소 종류만 안내해요
const TYPE_LABELS = {
  korean_restaurant: '한식', chinese_restaurant: '중식', japanese_restaurant: '일식',
  italian_restaurant: '이탈리안', french_restaurant: '프렌치', seafood_restaurant: '해산물',
  barbecue_restaurant: '고기/구이', bakery: '베이커리', cafe: '카페', bar: '바',
  restaurant: '음식점', tourist_attraction: '관광명소', museum: '박물관', park: '공원',
  amusement_park: '놀이공원', zoo: '동물원', aquarium: '아쿠아리움', temple: '사찰',
  garden: '정원', lodging: '숙소', hotel: '호텔',
};
function typeLabel(types = []) {
  for (const t of types) if (TYPE_LABELS[t]) return TYPE_LABELS[t];
  return null;
}

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

function buildPriceEstimate(priceLevel, category) {
  const table = PRICE_ESTIMATES[category] || PRICE_ESTIMATES.restaurant;
  return table[priceLevel] || '가격 정보 없음';
}

function buildReason(place, ageProfile, tier) {
  const reasons = [];
  if (place.rating) reasons.push(`평점 ${place.rating}`);
  if (place.ratingCount) reasons.push(`리뷰 ${place.ratingCount.toLocaleString()}개`);
  const placeLevel = place.priceLevel ? PRICE_LEVEL_SCORE[place.priceLevel] : tier.maxPriceLevel;
  if (placeLevel <= tier.maxPriceLevel) reasons.push(`${tier.label} 예산에 맞음`);
  const types = place.types.join(' ');
  if (ageProfile.hasYoungChildren && /park|amusement_park|zoo|aquarium|museum|playground/.test(types)) {
    reasons.push('아이와 가기 좋음');
  }
  if (ageProfile.hasSenior && /park|museum|temple|garden|spa/.test(types)) {
    reasons.push('어르신과 편하게 즐기기 좋음');
  }
  return reasons.join(' · ') || '조건에 맞는 장소';
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function rankPlaces(places, ageProfile, tier, topN = 5, category = 'restaurant') {
  return places
    .map((p) => ({
      ...p,
      score: scorePlace(p, ageProfile, tier),
      priceEstimate: buildPriceEstimate(p.priceLevel, category),
      reason: buildReason(p, ageProfile, tier),
      typeLabel: typeLabel(p.types),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

function toStop(place, categoryFallbackLabel) {
  if (!place) return null;
  return {
    name: place.name,
    address: place.address,
    category: categoryFallbackLabel,
    typeLabel: place.typeLabel || categoryFallbackLabel,
    reason: place.reason || null,
    priceEstimate: place.priceEstimate || null,
  };
}

/** 여행사가 짜주는 것처럼, 하루하루 시간대별 동선 생성 (숙소 포함) */
function buildDayItinerary(days, restaurants, cafes, attractions, lodgings) {
  const pick = (arr, i) => (arr.length ? arr[i % arr.length] : null);
  const lodging = lodgings[0] || null;
  let attrIdx = 0, restIdx = 0, cafeIdx = 0;
  const itinerary = [];

  for (let day = 1; day <= days; day++) {
    const stops = [];
    if (day === 1) {
      const s = toStop(pick(attractions, attrIdx++), '관광');
      if (s) stops.push({ time: '오전', ...s });
    } else if (lodging) {
      stops.push({ time: '08:00', name: lodging.name, address: lodging.address, category: '숙소', typeLabel: '숙소 조식', reason: '전날 묵은 숙소에서 아침 식사' });
      const s = toStop(pick(attractions, attrIdx++), '관광');
      if (s) stops.push({ time: '09:30', ...s });
    }
    const lunch = toStop(pick(restaurants, restIdx++), '식사');
    if (lunch) stops.push({ time: '12:00', ...lunch, typeLabel: `점심 · ${lunch.typeLabel || '식사'}` });

    const s2 = toStop(pick(attractions, attrIdx++), '관광');
    if (s2) stops.push({ time: '14:00', ...s2 });

    const cafeStop = toStop(pick(cafes, cafeIdx++), '카페');
    if (cafeStop) stops.push({ time: '16:00', ...cafeStop });

    const dinner = toStop(pick(restaurants, restIdx++), '식사');
    if (dinner) stops.push({ time: '18:30', ...dinner, typeLabel: `저녁 · ${dinner.typeLabel || '식사'}` });

    if (lodging) {
      if (day < days) {
        stops.push({ time: '21:00', name: lodging.name, address: lodging.address, category: '숙소', typeLabel: '숙소 체크인', reason: lodging.reason, priceEstimate: lodging.priceEstimate });
      } else {
        stops.push({ time: '체크아웃', name: lodging.name, address: lodging.address, category: '숙소', typeLabel: '숙소 체크아웃 후 귀가' });
      }
    }
    itinerary.push({ day, stops });
  }
  return itinerary;
}

module.exports = { analyzeAgeGroups, budgetTier, scorePlace, buildDayItinerary, rankPlaces, distanceKm };
