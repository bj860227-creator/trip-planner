const fetch = require('node-fetch');

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const BASE_URL = 'https://openapi.naver.com/v1/search/local.json';

function stripTags(str = '') {
  return str.replace(/<[^>]*>/g, '');
}

/** 네이버 지역검색 — 실패하거나 키가 없으면 빈 배열 반환 (구글 결과는 그대로 살아있게) */
async function searchLocal(query, display = 20) {
  if (!CLIENT_ID || !CLIENT_SECRET) return [];
  try {
    const url = `${BASE_URL}?query=${encodeURIComponent(query)}&display=${display}&sort=comment`;
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((item) => ({
      name: stripTags(item.title),
      address: item.roadAddress || item.address || '',
      category: item.category || '',
    }));
  } catch (e) {
    return [];
  }
}

module.exports = { searchLocal };
