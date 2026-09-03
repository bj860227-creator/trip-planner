const fetch = require('node-fetch');

const CLIENT_ID = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const LOCAL_URL = 'https://openapi.naver.com/v1/search/local.json';
const BLOG_URL = 'https://openapi.naver.com/v1/search/blog.json';

function stripTags(str = '') {
  return str.replace(/<[^>]*>/g, '');
}

function naverHeaders() {
  return {
    'X-Naver-Client-Id': CLIENT_ID,
    'X-Naver-Client-Secret': CLIENT_SECRET,
  };
}

/** 네이버 지역검색 — 실패하거나 키가 없으면 빈 배열 반환 */
async function searchLocal(query, display = 20) {
  if (!CLIENT_ID || !CLIENT_SECRET) return [];
  try {
    const url = `${LOCAL_URL}?query=${encodeURIComponent(query)}&display=${display}&sort=comment`;
    const res = await fetch(url, { headers: naverHeaders() });
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

/** 네이버 블로그 검색 — 실제 후기 텍스트를 가져오기 위함 */
async function searchBlog(query, display = 3) {
  if (!CLIENT_ID || !CLIENT_SECRET) return [];
  try {
    const url = `${BLOG_URL}?query=${encodeURIComponent(query)}&display=${display}&sort=sim`;
    const res = await fetch(url, { headers: naverHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((item) => ({
      title: stripTags(item.title),
      description: stripTags(item.description),
    }));
  } catch (e) {
    return [];
  }
}

module.exports = { searchLocal, searchBlog };
