// 반도체 뉴스 수집 스크립트
// 실행 방법: node fetch-news.js
// 하는 일: 아래 소스들에서 최신 뉴스를 가져와 data.js 파일로 저장한다.
//         그 다음 index.html을 열면 data.js를 읽어서 화면에 보여준다.

const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');
const fs = require('fs');

// 이 중 하나라도 제목/요약에 있으면 통과시키는 소스들이 있음 (filter: true).
// '반도체'라는 글자가 없어도 메모리·HBM·파운드리·AI 반도체 관련 기사면 잡히도록 넓게 잡았다.
const KEYWORDS = [
  '반도체', '메모리', 'HBM', 'D램', '디램', '낸드', 'NAND',
  '파운드리', '웨이퍼', '팹리스', 'GPU', 'AI칩', 'AI 반도체', 'EUV', '노광',
];

function hasKeyword(text) {
  const lower = String(text || '').toLowerCase();
  return KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// RSS로 가져오는 소스 목록
const RSS_SOURCES = [
  { name: '전자신문', url: 'http://rss.etnews.com/06.xml', type: 'kr', filter: true },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/all-news', type: 'kr', filter: true },
  { name: '삼성 뉴스룸', url: 'https://news.samsung.com/kr/feed', type: 'corp', filter: true },
  { name: 'SK하이닉스 뉴스룸', url: 'https://news.skhynix.co.kr/feed/', type: 'corp', filter: false },
  { name: 'EE Times', url: 'https://www.eetimes.com/feed/', type: 'intl', filter: false },
  { name: 'Semiconductor Engineering', url: 'https://semiengineering.com/feed/', type: 'intl', filter: false },
  { name: 'SPTA TIMES', url: 'https://www.sptatimeskorea.com/blog-feed.xml', type: 'digest', filter: false },
];

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchRSS(source) {
  const res = await fetch(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, htmlEntities: true });
  const data = parser.parse(xml);
  let items = data && data.rss && data.rss.channel ? data.rss.channel.item : [];
  if (!items) items = [];
  if (!Array.isArray(items)) items = [items];

  return items
    .map((item) => {
      const desc = stripHtml(item.description || item['content:encoded'] || '').slice(0, 140);
      return {
        source: source.name,
        type: source.type,
        title: stripHtml(item.title || ''),
        link: item.link || '',
        date: item.pubDate || '',
        desc,
      };
    })
    .filter((item) => !source.filter || hasKeyword(item.title) || hasKeyword(item.desc));
}

// SK 뉴스는 RSS가 없어서 페이지 HTML을 직접 읽어서 뽑아낸다 (= 크롤링)
async function fetchSK() {
  const res = await fetch('https://www.sk.co.kr/ko/media/news.jsp', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];
  $('.news_banner_list li').each((_, el) => {
    const a = $(el).find('a');
    const onclickAttr = a.attr('onclick') || '';
    const match = onclickAttr.match(/goView\((\d+)\)/);
    const idx = match ? match[1] : null;
    const title = $(el).find('.banner_cont_title').text().trim();
    const category = $(el).find('.banner_cont_cate').text().trim();
    const dateText = $(el).find('.banner_cont_date').text().replace('등록일 : ', '').trim();

    if (idx && title) {
      items.push({
        source: 'SK 뉴스',
        type: 'corp',
        title,
        link: `https://www.sk.co.kr/ko/media/news_view.jsp?idx=${idx}`,
        date: dateText.replace(/\./g, '-'), // 2026.07.25 -> 2026-07-25 (날짜 정렬을 위해)
        desc: category ? `계열사: ${category}` : '',
      });
    }
  });

  return items.filter((item) => hasKeyword(item.title));
}

async function main() {
  console.log('반도체 뉴스 수집을 시작합니다...\n');
  const results = [];

  for (const source of RSS_SOURCES) {
    try {
      const items = await fetchRSS(source);
      console.log(`  [RSS] ${source.name}: ${items.length}건`);
      results.push(...items);
    } catch (err) {
      console.log(`  [RSS] ${source.name}: 실패 - ${err.message}`);
    }
  }

  try {
    const skItems = await fetchSK();
    console.log(`  [크롤링] SK 뉴스: ${skItems.length}건`);
    results.push(...skItems);
  } catch (err) {
    console.log(`  [크롤링] SK 뉴스: 실패 - ${err.message}`);
  }

  results.sort((a, b) => new Date(b.date) - new Date(a.date));

  const payload = { fetchedAt: new Date().toISOString(), items: results };
  const output = 'window.NEWS_DATA = ' + JSON.stringify(payload, null, 2) + ';\n';
  fs.writeFileSync('data.js', output, 'utf-8');

  console.log(`\n총 ${results.length}건을 data.js에 저장했습니다.`);
  console.log('index.html을 브라우저로 열어서 확인하세요.');
}

main();
