// 인원 연령대 분석 + 예산(숙박/식사 분리) 계산 + 장소 스코어링(구글+네이버 교차검증) + 시간대별 일정표 생성

const PRICE_LEVEL_SCORE = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};
const PRICE_LEVEL_NAMES = ['PRICE_LEVEL_INEXPENSIVE','PRICE_LEVEL_MODERATE','PRICE_LEVEL_EXPENSIVE','PRICE_LEVEL_VERY_EXPENSIVE'];

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
  garden: '정원', lodging: '숙소', hotel: '호텔', art_gallery: '미술관',
  natural_feature: '자연명소', shopping_mall: '쇼핑몰',
};
function typeLabel(types = []) {
  for (const t of types) if (TYPE_LABELS[t]) return TYPE_LABELS[t];
  return null;
}

const CHAIN_KEYWORDS = [
  '스타벅스', 'starbucks', '투썸플레이스', 'twosome', '이디야', 'ediya', '커피빈', 'coffee bean',
  '메가커피', 'mega coffee', '컴포즈커피', 'compose coffee', '빽다방', '폴바셋', 'paul bassett',
  '할리스', 'hollys', '탐앤탐스', '파스쿠찌', 'pascucci', '엔제리너스', 'angel-in-us',
  '드롭탑', 'droptop', '커피니', '매머드커피', '요거프레소', '던킨', 'dunkin',
];
function filterOutChains(places) {
  return places.filter((p) => !CHAIN_KEYWORDS.some((k) => p.name.toLowerCase().includes(k.toLowerCase())));
}

function filterByLocation(places, locationKeyword) {
  if (!locationKeyword) return places;
  const key = locationKeyword.trim();
  if (!key) return places;
  const filtered = places.filter((p) => (p.address || '').includes(key));
  return filtered.length ? filtered : places;
}

function isResortLike(lodging) {
  if (!lodging) return false;
  return /리조트|resort|콘도|펜션|글램핑/i.test(lodging.name);
}

/** 이름 비교용 정규화 (공백/특수문자 제거, 소문자화) */
function normalizeName(name = '') {
  return name.replace(/[\s\-·,.()]/g, '').toLowerCase();
}

/** 구글 결과 목록에 "네이버에서도 검색되는지" 표시를 붙여요 (교차검증) */
function markCrossVerified(places, naverPlaces) {
  const naverNorms = (naverPlaces || []).map((p) => normalizeName(p.name));
  return places.map((p) => {
    const norm = normalizeName(p.name);
    const verified = norm.length >= 2 && naverNorms.some((n) => n.length >= 2 && (n.includes(norm) || norm.includes(n)));
    return { ...p, crossVerified: verified };
  });
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

function tierFromAmount(amount, thresholds, labels) {
  for (let i = 0; i < thresholds.length; i++) {
    if (amount < thresholds[i]) return { tier: i, label: labels[i], maxPriceLevel: i + 1 };
  }
  return { tier: labels.length - 1, label: labels[labels.length - 1], maxPriceLevel: labels.length };
}

function computeBudgetTiers(totalBudget, peopleCount, days) {
  const FOOD_RATIO = 0.28;
  const LODGING_RATIO = 0.35;
  const foodPerPersonPerDay = (totalBudget * FOOD_RATIO) / Math.max(peopleCount, 1) / Math.max(days, 1);
  const lodgingPerNight = (totalBudget * LODGING_RATIO) / Math.max(days, 1);

  const food = tierFromAmount(foodPerPersonPerDay, [15000, 35000, 70000], ['알뜰형', '표준형', '여유형', '프리미엄형']);
  const lodging = tierFromAmount(lodgingPerNight, [60000, 120000, 250000], ['알뜰형', '표준형', '여유형', '프리미엄형']);
  return { food, lodging };
}

function priceLevelsForTier(tier) {
  return PRICE_LEVEL_NAMES.slice(0, tier.maxPriceLevel);
}

function scorePlace(place, ageProfile, tier) {
  let score = 0;
  if (place.rating) score += (place.rating / 5) * 35;
  if (place.ratingCount) score += Math.min(place.ratingCount / 500, 1) * 12;
  if (place.crossVerified) score += 15; // 구글+네이버 둘 다에서 검색되면 가산점
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
  if (place.crossVerified) reasons.push('네이버에서도 많이 찾는 곳');
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

function rankPlaces(places, ageProfile, tier, topN = 5, category = 'restaurant') {
  return places
    .map((p) => ({
      ...p,
      score: scorePlace(p, ageProfile, tier),
      priceEstimate: buildPriceEstimate(p.priceLevel, category),
      reason: buildReason(p, ageProfile, tier),
      typeLabel: typeLabel(p.types) || (category === 'restaurant' ? '식당' : category === 'cafe' ? '카페' : category === 'attraction' ? '관광지' : '숙소'),
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

function resortOption(lodging) {
  return {
    name: lodging.name, address: lodging.address, menu: '숙소 내 부대시설',
    reason: '이동 없이 숙소 안에서 스파·수영장 등 편하게 즐기기 좋음', priceEstimate: null,
  };
}

function buildDayItinerary(days, restaurants, cafes, attractionsMorning, attractionsAfternoon, lodging, flightInfo = {}) {
  const pickRest = makePicker(restaurants);
  const pickCafe = makePicker(cafes);
  const pickMorningAttr = makePicker(attractionsMorning);
  const pickAfternoonAttr = makePicker(attractionsAfternoon);
  const resort = isResortLike(lodging);
  const itinerary = [];

  for (let day = 1; day <= days; day++) {
    const slots = [];
    const isFirst = day === 1;
    const isLast = day === days;

    if (isFirst) {
      if (flightInfo.departureTime) {
        slots.push({ time: flightInfo.departureTime, label: '출국', type: 'flight',
          options: [{ name: '공항 출발', address: '', menu: null, reason: '입력하신 출국 항공편 시간 기준', priceEstimate: null }] });
      }
      const lunchOpts = pickRest(2).map((p) => toOption(p, '식당'));
      if (lunchOpts.length) slots.push({ time: '12:30', label: '점심', type: 'meal', options: lunchOpts });

      if (lodging) {
        slots.push({ time: '15:00', label: '숙소 체크인', type: 'lodging',
          options: [{ name: lodging.name, address: lodging.address, menu: null, reason: lodging.reason, priceEstimate: lodging.priceEstimate }] });
      }

      const afterCheckinOpts = pickAfternoonAttr(1).map((p) => toOption(p, '오후 관광'));
      if (resort && lodging) afterCheckinOpts.push(resortOption(lodging));
      if (afterCheckinOpts.length) slots.push({ time: '15:30', label: '체크인 후 자유시간', type: 'attraction', options: afterCheckinOpts });

      const cafeOpts = pickCafe(2).map((p) => toOption(p, '카페'));
      if (cafeOpts.length) slots.push({ time: '16:30', label: '카페', type: 'cafe', options: cafeOpts });

      if (!isLast) {
        const dinnerOpts = pickRest(2).map((p) => toOption(p, '식당'));
        if (dinnerOpts.length) slots.push({ time: '18:30', label: '저녁', type: 'meal', options: dinnerOpts });
      }
    } else if (isLast) {
      if (lodging) {
        slots.push({ time: '08:00', label: '조식', type: 'breakfast',
          options: [{ name: lodging.name, address: lodging.address, menu: '숙소 조식', reason: '묵고 계신 숙소에서 아침 식사', priceEstimate: null }] });
      }
      const morningOpts = pickMorningAttr(1).map((p) => toOption(p, '오전 관광'));
      if (resort && lodging) morningOpts.push(resortOption(lodging));
      if (morningOpts.length) slots.push({ time: '10:00', label: '오전 관광', type: 'attraction', options: morningOpts });

      if (lodging) {
        slots.push({ time: '11:00', label: '숙소 체크아웃', type: 'lodging',
          options: [{ name: lodging.name, address: lodging.address, menu: null, reason: null, priceEstimate: null }] });
      }
      const lunchOpts = pickRest(2).map((p) => toOption(p, '식당'));
      if (lunchOpts.length) slots.push({ time: '12:30', label: '점심', type: 'meal', options: lunchOpts });

      if (flightInfo.returnTime) {
        slots.push({ time: flightInfo.returnTime, label: '귀국', type: 'flight',
          options: [{ name: '공항 출발', address: '', menu: null, reason: '입력하신 귀국 항공편 시간 기준', priceEstimate: null }] });
      }
    } else {
      if (lodging) {
        slots.push({ time: '08:00', label: '조식', type: 'breakfast',
          options: [{ name: lodging.name, address: lodging.address, menu: '숙소 조식', reason: '묵고 계신 숙소에서 아침 식사', priceEstimate: null }] });
      }
      const morningOpts = pickMorningAttr(1).map((p) => toOption(p, '오전 관광'));
      if (morningOpts.length) slots.push({ time: '10:00', label: '오전 관광', type: 'attraction', options: morningOpts });

      const lunchOpts = pickRest(2).map((p) => toOption(p, '식당'));
      if (lunchOpts.length) slots.push({ time: '12:30', label: '점심', type: 'meal', options: lunchOpts });

      const afternoonOpts = pickAfternoonAttr(1).map((p) => toOption(p, '오후 관광'));
      if (resort && lodging) afternoonOpts.push(resortOption(lodging));
      if (afternoonOpts.length) slots.push({ time: '14:30', label: '오후 관광', type: 'attraction', options: afternoonOpts });

      const cafeOpts = pickCafe(2).map((p) => toOption(p, '카페'));
      if (cafeOpts.length) slots.push({ time: '16:00', label: '카페', type: 'cafe', options: cafeOpts });

      const dinnerOpts = pickRest(2).map((p) => toOption(p, '식당'));
      if (dinnerOpts.length) slots.push({ time: '18:00', label: '저녁', type: 'meal', options: dinnerOpts });
    }

    itinerary.push({ day, slots });
  }
  return itinerary;
}

module.exports = {
  analyzeAgeGroups, computeBudgetTiers, priceLevelsForTier, scorePlace,
  buildDayItinerary, rankPlaces, filterOutChains, filterByLocation, markCrossVerified,
};
