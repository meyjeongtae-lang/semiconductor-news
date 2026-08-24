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

// 기사를 주제별로 자동 분류한다. 제목+요약에 나온 키워드로 판단하는 방식이라 완벽하지는 않지만,
// "메모리 얘기만 보고 싶다"처럼 소스·날짜가 아니라 '무슨 얘기인지'로 걸러보고 싶을 때 쓸 수 있다.
// 위에서부터 순서대로 검사해서 처음 걸리는 카테고리 하나로 정한다 (예: HBM 특허소송 기사는
// '메모리'가 아니라 더 특징적인 이야기인 '특허·소송'으로 분류됨).
const CATEGORIES = [
  { key: 'legal', label: '특허·소송', domain: 'business', keywords: ['특허', '소송', '침해', '판결', '배상', '압수수색', '고소', '변론', '법원', '대법원', '항소', 'patent', 'lawsuit', 'infringement'] },
  { key: 'labor', label: '인력·노사', domain: 'business', keywords: ['노조', '노동조합', '임단협', '성과급', '채용', '영입', '구조조정', '퇴사', 'CEO 교체', 'layoff'] },
  { key: 'deals', label: '인수합병·투자유치', domain: 'business', keywords: ['인수', '합병', 'M&A', '시리즈A', '시리즈 A', '투자 유치', 'IPO', '상장', 'acquisition', 'acquire', 'funding round'] },
  { key: 'policy', label: '정책·무역', domain: 'business', keywords: ['수출규제', '관세', 'entity list', '보조금', '제재', '지정학', 'export control', 'tariff', 'sanctions'] },
  { key: 'research', label: '연구·기술동향', domain: 'tech', keywords: ['논문', '연구팀', '학회', 'technical paper', 'research team'] },
  { key: 'security', label: '보안·검증', domain: 'tech', keywords: ['보안', '검증', 'puf', '취약점', 'security', 'verification', 'vulnerability', 'cybersecurity', '기능안전', 'functional safety'] },
  { key: 'robotics', label: '로보틱스·자동차', domain: 'tech', keywords: ['로봇', 'robot', '휴머노이드', 'humanoid', '자율주행', 'autonomous', '액추에이터', 'actuator', '코봇', 'cobot'] },
  { key: 'equipment', label: '반도체 장비', domain: 'tech', keywords: ['장비', 'asml', '어플라이드머티리얼즈', '어플라이드 머티리얼즈', 'applied materials', '램리서치', 'lam research', '도쿄일렉트론', 'tokyo electron', 'kla', '식각장비', '증착장비', '노광장비'] },
  { key: 'memory', label: '메모리', domain: 'tech', keywords: ['hbm', 'd램', '디램', 'dram', '낸드', 'nand', 'ssd', '메모리', 'hbf'] },
  { key: 'ai-compute', label: 'AI 반도체·컴퓨팅', domain: 'tech', keywords: ['gpu', 'npu', 'ai칩', 'ai 칩', 'ai 가속기', '데이터센터', '엔비디아', 'nvidia', 'amd', 'cxl', 'cpo', '인터커넥트', '양자컴퓨', 'quantum comput'] },
  { key: 'foundry', label: '파운드리·제조공정', domain: 'tech', keywords: ['파운드리', '웨이퍼', '나노', 'euv', '공정', 'tsmc', 'cfet', '트랜지스터', '패키징', '후공정'] },
  { key: 'market', label: '시장·거시경제', domain: 'business', keywords: ['코스피', '증시', '환율', '금리', '연준', '주가', 'nasdaq', 'fed '] },
  { key: 'earnings', label: '기업실적·투자', domain: 'business', keywords: ['실적', '매출', '영업이익', '흑자', '적자', '투자', '팹', '공장', '주주환원', '자사주'] },
];
const DEFAULT_CATEGORY = { key: 'etc', label: '기타', domain: 'etc' };

// 13개 세부 카테고리를 "기술" / "비즈니스·시장" 두 큰 갈래로 미리 묶어둔다.
// 세부 카테고리는 그대로 필터에 쓰고, 이 domain은 "일단 크게 훑어보고 싶을 때" 쓰는 상위 묶음이다.
function categorize(text) {
  const lower = String(text || '').toLowerCase();
  const hit = CATEGORIES.find((cat) => cat.keywords.some((kw) => lower.includes(kw.toLowerCase())));
  return hit || DEFAULT_CATEGORY;
}

// explanations.json에 이미 직접 읽고 쓴 요약·친절한 설명이 있으면 그 텍스트로 분류한다.
// RSS 제목+140자 미리보기보다 훨씬 정보가 많아서("The 1-Megawatt Rack Debate" 같은 제목만으론
// 알 수 없는 내용도, 요약문에는 '전력', '랙', '데이터센터' 같은 실제 키워드가 들어있다) 분류 정확도가 크게 오른다.
// 아직 설명을 안 쓴 기사는 어쩔 수 없이 제목+RSS 미리보기로만 분류한다.
function loadExplanations() {
  try {
    if (!fs.existsSync('explanations.json')) return {};
    return JSON.parse(fs.readFileSync('explanations.json', 'utf-8'));
  } catch (err) {
    console.log(`explanations.json을 불러오지 못했습니다: ${err.message}`);
    return {};
  }
}

// RSS로 가져오는 소스 목록
// excludeCategories: RSS의 <category>가 이 목록에 하나라도 걸리면 광고/홍보성 글로 보고 아예 제외한다.
//  - EE Times의 'Webinars + Bitcasts'(웹세미나 등록), 'Press Releases'(보도자료성 홍보글)
//  - IEEE Spectrum의 'Type-webinar'(웹세미나), 'Type-whitepaper'(가입해야 보는 백서 다운로드 페이지)
//  - SK하이닉스 뉴스룸의 'MEDIA'(기사가 아니라 같은 글에 딸린 사진/영상 자료가 중복 등록된 것)
const RSS_SOURCES = [
  { name: '전자신문', url: 'http://rss.etnews.com/06.xml', type: 'kr', filter: true },
  { name: '한국경제', url: 'https://www.hankyung.com/feed/all-news', type: 'kr', filter: true },
  { name: '디일렉', url: 'https://www.thelec.kr/rss/S1N2.xml', type: 'kr', filter: false },
  { name: 'ZDNet Korea', url: 'https://feeds.feedburner.com/zdkorea', type: 'kr', filter: true },
  { name: '삼성 뉴스룸', url: 'https://news.samsung.com/kr/feed', type: 'corp', filter: true },
  { name: 'SK하이닉스 뉴스룸', url: 'https://news.skhynix.co.kr/feed/', type: 'corp', filter: false, excludeCategories: ['MEDIA'] },
  { name: 'EE Times', url: 'https://www.eetimes.com/feed/', type: 'intl', filter: false, excludeCategories: ['Webinars + Bitcasts', 'Press Releases', 'White Papers', 'Sponsored content'] },
  { name: 'Semiconductor Engineering', url: 'https://semiengineering.com/feed/', type: 'intl', filter: false },
  { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/topic/semiconductors.rss', type: 'intl', filter: false, excludeCategories: ['Type-webinar', 'Type-whitepaper'] },
  { name: 'SPTA TIMES', url: 'https://www.sptatimeskorea.com/blog-feed.xml', type: 'digest', filter: false },
];

// 제목이 이걸로 시작하면 기사가 아니라 자체 행사·세미나 광고인 경우가 많아서 제외한다 (예: 디일렉의 컨퍼런스 홍보).
const TITLE_PREFIX_EXCLUDE = ['[알림]'];

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
    .filter((item) => {
      const exclude = source.excludeCategories || [];
      return !item.categories.some((c) => exclude.includes(c));
    })
    .filter((item) => !TITLE_PREFIX_EXCLUDE.some((prefix) => item.title.startsWith(prefix)))
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

// RSS는 각 소스마다 최근 글 몇십 개까지만 보여주는 '창(window)'이라서, 새 글이 올라오면
// 예전 글은 RSS 목록에서 자연스럽게 밀려나 사라진다. data.js를 매번 새로 덮어쓰기만 하면
// 밀려난 예전 기사가 사이트에서도 통째로 사라져서 '주별로 흐름을 누적해서 본다'는 목적이
// 무너지므로, 기존 data.js에 있던 기사를 읽어와 이번에 새로 가져온 것과 합쳐서 저장한다.
function loadExistingItems() {
  try {
    if (!fs.existsSync('data.js')) return [];
    const raw = fs.readFileSync('data.js', 'utf-8');
    const jsonText = raw.replace(/^window\.NEWS_DATA\s*=\s*/, '').replace(/;\s*$/, '');
    const parsed = JSON.parse(jsonText);
    return parsed.items || [];
  } catch (err) {
    console.log(`기존 data.js를 불러오지 못했습니다 (처음 실행이라면 정상): ${err.message}`);
    return [];
  }
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

  const existingItems = loadExistingItems();
  console.log(`\n기존에 누적된 기사 ${existingItems.length}건과 합칩니다.`);

  // 새로 가져온 것을 앞에 둬서, 같은 기사가 겹칠 때 이번에 새로 읽은 필드(desc 등)가 우선하게 한다.
  const combined = [...results, ...existingItems];

  // 링크가 완전히 같으면 같은 기사이므로 먼저 제거한다.
  const seenLinks = new Set();
  const byLink = combined.filter((item) => {
    if (!item.link) return true;
    if (seenLinks.has(item.link)) return false;
    seenLinks.add(item.link);
    return true;
  });

  // 같은 소스가 제목이 완전히 같은 글을 여러 링크로 중복 발행하는 경우가 있어서
  // (예: SK하이닉스 뉴스룸이 "미래인재 CLASS 제2강"을 몇 초 간격으로 6번 발행한 사례),
  // 소스+제목이 같으면 가장 먼저 나온(=이번에 새로 가져온) 글 하나만 남기고 나머지는 걸러낸다.
  const seen = new Set();
  const deduped = byLink.filter((item) => {
    const key = item.source + '|' + item.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < combined.length) {
    console.log(`중복 기사 ${combined.length - deduped.length}건을 걸러냈습니다.`);
  }

  deduped.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 카테고리 분류 로직이 바뀌거나 explanations.json이 채워질 수도 있으니,
  // 새 기사뿐 아니라 기존에 누적된 기사도 매번 다시 분류한다.
  const explanations = loadExplanations();
  deduped.forEach((item) => {
    const entry = explanations[item.link];
    const text = entry ? `${entry.summary || ''} ${entry.detail || ''}` : `${item.title} ${item.desc}`;
    const cat = categorize(text);
    item.category = cat.key;
    item.domain = cat.domain;
  });
  const byCategory = {};
  const byDomain = {};
  deduped.forEach((item) => {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    byDomain[item.domain] = (byDomain[item.domain] || 0) + 1;
  });
  console.log('카테고리별 분포:', Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('도메인별 분포:', Object.entries(byDomain).map(([k, v]) => `${k}=${v}`).join(', '));

  const payload = { fetchedAt: new Date().toISOString(), items: deduped };
  const output = 'window.NEWS_DATA = ' + JSON.stringify(payload, null, 2) + ';\n';
  fs.writeFileSync('data.js', output, 'utf-8');

  console.log(`\n총 ${deduped.length}건을 data.js에 저장했습니다 (신규 ${results.length}건 + 기존 누적분).`);
  console.log('index.html을 브라우저로 열어서 확인하세요.');
}

main();
