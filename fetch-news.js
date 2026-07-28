// 반도체 뉴스 수집 스크립트
// 실행 방법: node fetch-news.js
// 하는 일: 아래 소스들에서 최신 뉴스를 가져와 data.js 파일로 저장한다.
//         그 다음 index.html을 열면 data.js를 읽어서 화면에 보여준다.

const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');
const fs = require('fs');

// 이 중 하나라도 제목/요약에 있으면 통과시키는 소스들이 있음 (filter: true).
// 'AI'나 '인공지능'만 넣으면 반도체와 상관없는 AI 소프트웨어/인사 뉴스까지 다 걸려서,
// 반도체 제조 용어 + AI 중에서도 하드웨어와 확실히 관련된 단어들로만 좁혔다.
const KEYWORDS = [
  '반도체', '메모리', 'HBM', 'D램', '디램', '낸드', 'NAND',
  '파운드리', '웨이퍼', '팹리스', 'GPU', 'NPU', 'EUV', '노광',
  'AI칩', 'AI 칩', 'AI 반도체', 'AI 서버', 'AI 인프라',
];

function hasKeyword(text) {
  const lower = String(text || '').toLowerCase();
  return KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// RSS로 가져오는 소스 목록
const RSS_SOURCES = [
  { name: '전자신문', url: 'http://rss.etnews.com/06.xml', type: 'kr', filter: true },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/all-news', type: 'kr', filter: true },
  { name: '디일렉', url: 'https://www.thelec.kr/rss/S1N2.xml', type: 'kr', filter: false },
  { name: 'ZDNet Korea', url: 'https://feeds.feedburner.com/zdkorea', type: 'kr', filter: true },
  { name: '삼성 뉴스룸', url: 'https://news.samsung.com/kr/feed', type: 'corp', filter: true },
  { name: 'SK하이닉스 뉴스룸', url: 'https://news.skhynix.co.kr/feed/', type: 'corp', filter: false },
  { name: 'EE Times', url: 'https://www.eetimes.com/feed/', type: 'intl', filter: false },
  { name: 'Semiconductor Engineering', url: 'https://semiengineering.com/feed/', type: 'intl', filter: false },
  { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/topic/semiconductors.rss', type: 'intl', filter: false },
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
      const categories = Array.isArray(item.category) ? item.category : item.category ? [item.category] : [];
      return {
        source: source.name,
        type: source.type,
        title: stripHtml(item.title || ''),
        link: item.link || '',
        date: item.pubDate || '',
        desc,
        categories,
      };
    })
    // SK하이닉스 뉴스룸의 'MEDIA' 카테고리는 실제 기사가 아니라 같은 콘텐츠에 딸린
    // 사진/영상 자료를 각각 별도 글로 등록해둔 것이라, 제목이 통째로 중복돼서 나온다.
    // 그래서 이 카테고리는 애초에 뉴스 목록에서 제외한다.
    .filter((item) => !item.categories.includes('MEDIA'))
    .map(({ categories, ...item }) => item)
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

  // 같은 소스가 제목이 완전히 같은 글을 여러 링크로 중복 발행하는 경우가 있어서
  // (예: SK하이닉스 뉴스룸이 "미래인재 CLASS 제2강"을 몇 초 간격으로 6번 발행한 사례),
  // 소스+제목이 같으면 가장 최근 글 하나만 남기고 나머지는 걸러낸다.
  const seen = new Set();
  const deduped = results.filter((item) => {
    const key = item.source + '|' + item.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < results.length) {
    console.log(`\n중복 제목 ${results.length - deduped.length}건을 걸러냈습니다.`);
  }

  const payload = { fetchedAt: new Date().toISOString(), items: deduped };
  const output = 'window.NEWS_DATA = ' + JSON.stringify(payload, null, 2) + ';\n';
  fs.writeFileSync('data.js', output, 'utf-8');

  console.log(`\n총 ${deduped.length}건을 data.js에 저장했습니다.`);
  console.log('index.html을 브라우저로 열어서 확인하세요.');
}

main();
