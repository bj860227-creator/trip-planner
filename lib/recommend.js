// 인원 연령대 분석 + 예산(숙박/식사 분리) 계산 + 장소 스코어링 + 시간대별 일정표 생성

const PRICE_LEVEL_SCORE = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};
const PRICE_LEVEL_NAMES = ['PRICE_LEVEL_FREE','PRICE_LEVEL_INEXPENSIVE','PRICE_LEVEL_MODERATE','PRICE_LEVEL_EXPENSIVE','PRICE_LEVEL_VERY_EXPENSIVE'];

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

// 흔한 카페 체인 — 웬만하면 개인 카페를 추천하기 위해 걸러내요
const CHAIN_KEYWORDS = [
  '스타벅스', 'starbucks', '투썸플레이스', 'twosome', '이디야', 'ediya', '커피빈', 'coffee bean',
  '메가커피', 'mega coffee', '컴포즈커피', 'compose coffee', '빽다방', '폴바셋', 'paul bassett',
  '할리스', 'hollys', '탐앤탐스', '파스쿠찌', 'pascucci', '엔제리너스', 'angel-in-us',
  '드롭탑', 'droptop', '커피니', '매머드커피', '요거프레소', '던킨', 'dunkin',
];
function filterOutChains(places) {
  return places.filter((p) => !CHAIN_KEYWORDS.some((k) => p.name.toLowerCase().includes(k.toLowerCase())));
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

/**
 * 총 여행경비를 "숙박 몫"과 "식사·카페·관광 몫"으로 나눠서 각각 등급 계산
 * (총 경비를 그대로 1인 1일 식비처럼 계산하면 항상 과대평가되는 문제를 방지)
 */
function computeBudgetTiers(totalBudget, peopleCount, days) {
  const FOOD_RATIO = 0.28;
  const LODGING_RATIO = 0.35;
  const foodPerPersonPerDay = (totalBudget * FOOD_RATIO) / Math.max(peopleCount, 1) / Math.max(days, 1);
  const lodgingPerNight = (totalBudget * LODGING_RATIO) / Math.max(days, 1);

  const food = tierFromAmount(foodPerPersonPerDay, [15000, 35000, 70000], ['알뜰형', '표준형', '여유형', '프리미엄형']);
  const lodging = tierFromAmount(lodgingPerNight, [60000, 120000, 250000], ['알뜰형', '표준형', '여유형', '프리미엄형']);
  return { food, lodging };
}

/** 이 등급 이하 가격대만 검색되도록 구글 API에 넘길 priceLevels 배열 생성 */
function priceLevelsForTier(tier) {
  return PRICE_LEVEL_NAMES.slice(0, tier.maxPriceLevel + 1);
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

/**
 * 시간대별 일정표 생성
 * - 첫날: 조식 없음(아직 체크인 전), 체크인 시간 명시
 * - 마지막날: 체크아웃 시간 명시, 저녁 없음
 * - 오전/오후 관광지는 서로 다른 후보군에서 선택
 * - 비행기 시간을 직접 입력했으면 그 시간에 맞춰 앞뒤 배치
 */
function buildDayItinerary(days, restaurants, cafes, attractionsMorning, attractionsAfternoon, lodging, flightInfo = {}) {
  const pickRest = makePicker(restaurants);
  const pickCafe = makePicker(cafes);
  const pickMorningAttr = makePicker(attractionsMorning);
  const pickAfternoonAttr = makePicker(attractionsAfternoon);
  const itinerary = [];

  for (let day = 1; day <= days; day++) {
    const slots = [];
    const isFirst = day === 1;
    const isLast = day === days;

    if (isFirst && flightInfo.departureTime) {
      slots.push({ time: flightInfo.departureTime, label: '출국', type: 'flight',
        options: [{ name: '공항 출발', address: '', menu: null, reason: '입력하신 출국 항공편 시간 기준', priceEstimate: null }] });
    }

    if (!isFirst && lodging) {
      slots.push({ time: '08:00', label: '조식', type: 'breakfast',
        options: [{ name: lodging.name, address: lodging.address, menu: '숙소 조식', reason: '묵고 계신 숙소에서 아침 식사', priceEstimate: null }] });
    }

    if (!(isFirst && flightInfo.departureTime)) {
      const morningAttrs = pickMorningAttr(1).map((p) => toOption(p, '오전 관광'));
      if (morningAttrs.length) slots.push({ time: '10:30', label: '오전 관광', type: 'attraction', options: morningAttrs });
    }

    const lunchOpts = pickRest(2).map((p) => toOption(p, '식당'));
    if (lunchOpts.length) slots.push({ time: '12:30', label: '점심', type: 'meal', options: lunchOpts });

    if (!(isLast && flightInfo.returnTime)) {
      const afternoonAttrs = pickAfternoonAttr(1).map((p) => toOption(p, '오후 관광'));
      if (afternoonAttrs.length) slots.push({ time: '14:30', label: '오후 관광', type: 'attraction', options: afternoonAttrs });

      const cafeOpts = pickCafe(2).map((p) => toOption(p, '카페'));
      if (cafeOpts.length) slots.push({ time: '16:00', label: '카페', type: 'cafe', options: cafeOpts });
    }

    if (!isLast) {
      const dinnerOpts = pickRest(2).map((p) => toOption(p, '식당'));
      if (dinnerOpts.length) slots.push({ time: '18:00', label: '저녁', type: 'meal', options: dinnerOpts });
    }

    if (lodging) {
      if (isFirst) {
        slots.push({ time: '체크인 15:00', label: '숙소 체크인', type: 'lodging',
          options: [{ name: lodging.name, address: lodging.address, menu: null, reason: lodging.reason, priceEstimate: lodging.priceEstimate }] });
      } else if (!isLast) {
        slots.push({ time: '숙박', label: '숙소', type: 'lodging',
          options: [{ name: lodging.name, address: lodging.address, menu: null, reason: null, priceEstimate: null }] });
      } else {
        slots.push({ time: '체크아웃 11:00', label: '숙소 체크아웃', type: 'lodging',
          options: [{ name: lodging.name, address: lodging.address, menu: null, reason: null, priceEstimate: null }] });
      }
    }

    if (isLast && flightInfo.returnTime) {
      slots.push({ time: flightInfo.returnTime, label: '귀국', type: 'flight',
        options: [{ name: '공항 출발', address: '', menu: null, reason: '입력하신 귀국 항공편 시간 기준', priceEstimate: null }] });
    }

    itinerary.push({ day, slots });
  }
  return itinerary;
}

module.exports = {
  analyzeAgeGroups, computeBudgetTiers, priceLevelsForTier, scorePlace,
  buildDayItinerary, rankPlaces, filterOutChains,
};
