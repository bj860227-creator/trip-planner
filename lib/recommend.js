// 인원 연령대 분석 + 예산 티어 계산 + 장소 스코어링 + 시간대별 선택지 일정표 생성

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

function toOption(place, fallbackLabel) {
  if (!place) return null;
  return {
    name: place.name,
    address: place.address,
    menu: place.typeLabel || fallbackLabel,
    reason: place.reason || null,
    priceEstimate: place.priceEstimate || null,
  };
}

/** 겹치지 않게 목록에서 n개씩 순환하며 꺼내는 헬퍼 */
function makePicker(list) {
  let idx = 0;
  return (n) => {
    const picked = [];
    for (let i = 0; i < n && list.length; i++) {
      picked.push(list[idx % list.length]);
      idx++;
    }
    return picked;
  };
}

/** 시간대별 슬롯 + 선택지(2~3개) 형태의 여유로운 일정표 생성 */
function buildDayItinerary(days, restaurants, cafes, attractions, lodgings) {
  const lodging = lodgings[0] || null;
  const pickRest = makePicker(restaurants);
  const pickCafe = makePicker(cafes);
  const pickAttr = makePicker(attractions);
  const itinerary = [];

  for (let day = 1; day <= days; day++) {
    const slots = [];

    if (lodging) {
      slots.push({
        time: '09:00', label: '조식', type: 'breakfast',
        options: [{ name: lodging.name, address: lodging.address, menu: '숙소 조식', reason: '묵고 계신 숙소에서 여유롭게 아침 식사', priceEstimate: null }],
      });
    }

    const morningAttrs = pickAttr(1).map((p) => toOption(p, '관광'));
    if (morningAttrs.length) slots.push({ time: '10:30', label: '오전 관광', type: 'attraction', options: morningAttrs });

    const lunchOpts = pickRest(2).map((p) => toOption(p, '식당'));
    if (lunchOpts.length) slots.push({ time: '12:30', label: '점심', type: 'meal', options: lunchOpts });

    const afternoonAttrs = pickAttr(1).map((p) => toOption(p, '관광'));
    if (afternoonAttrs.length) slots.push({ time: '14:30', label: '오후 관광', type: 'attraction', options: afternoonAttrs });

    const cafeOpts = pickCafe(2).map((p) => toOption(p, '카페'));
    if (cafeOpts.length) slots.push({ time: '16:00', label: '카페', type: 'cafe', options: cafeOpts });

    const dinnerOpts = pickRest(2).map((p) => toOption(p, '식당'));
    if (dinnerOpts.length) slots.push({ time: '18:00', label: '저녁', type: 'meal', options: dinnerOpts });

    if (lodging) {
      const isLast = day === days;
      slots.push({
        time: isLast ? '체크아웃' : '21:00',
        label: isLast ? '숙소 체크아웃' : '숙소',
        type: 'lodging',
        options: [{ name: lodging.name, address: lodging.address, menu: null, reason: lodging.reason, priceEstimate: isLast ? null : lodging.priceEstimate }],
      });
    }

    itinerary.push({ day, slots });
  }
  return itinerary;
}

module.exports = { analyzeAgeGroups, budgetTier, scorePlace, buildDayItinerary, rankPlaces, distanceKm };
