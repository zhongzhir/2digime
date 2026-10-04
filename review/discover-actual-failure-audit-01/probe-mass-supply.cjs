/** 大众供给候选探测。本机 200 ≠ 国内已验证。 */
'use strict';
const urls = [
  ['动漫', 'https://api.bgm.tv/calendar'],
  ['动漫', 'https://api.bgm.tv/search/subject/%E6%B8%B8%E6%88%8F?type=4&responseGroup=small'],
  ['游戏', 'https://store.steampowered.com/feeds/news/?l=schinese'],
  ['游戏', 'https://store.steampowered.com/feeds/featured/'],
  ['旅游', 'https://zh.wikivoyage.org/w/api.php?action=query&list=search&srsearch=%E6%9D%AD%E5%B7%9E&srlimit=3&format=json'],
  ['课程', 'https://www.icourse163.org/rss'],
  ['课程', 'https://open.163.com/special/opencourse/tedrss.xml'],
  ['课程', 'https://www.xuetangx.com/rss'],
  ['网文', 'https://www.qidian.com/rss'],
  ['影视', 'https://archive.org/advancedsearch.php?q=collection%3Afeature_films&fl[]=identifier,title&output=json&rows=3'],
];
(async () => {
  for (const [topic, url] of urls) {
    const started = Date.now();
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 12_000);
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ac.signal,
        headers: { accept: 'application/json, application/rss+xml, application/xml, */*', 'user-agent': 'DigitalMe-feed-probe/1.0' },
      });
      clearTimeout(timer);
      const text = await res.text();
      const kind = /<rss[\s>]/i.test(text) ? 'rss' : /<feed[\s>]/i.test(text) ? 'atom' : /[{[]/.test(text.trim()[0] || '') ? 'json' : 'other';
      console.log(JSON.stringify({ topic, url, http: res.status, ms: Date.now() - started, kind, bytes: text.length, head: text.slice(0, 180).replace(/\s+/g, ' ') }));
    } catch (err) {
      console.log(JSON.stringify({ topic, url, error: String(err && err.message || err), ms: Date.now() - started }));
    }
  }
})();
