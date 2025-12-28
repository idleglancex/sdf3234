const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

// Cache için basit memory store (Vercel cold start'larda sıfırlanır)
let cachedData = null;
let cacheTime = 0;
const CACHE_DURATION = 30000; // 30 saniye

async function scrapeHaremAltin() {
  // Cache kontrolü
  if (cachedData && Date.now() - cacheTime < CACHE_DURATION) {
    console.log('📦 Cache\'ten döndürülüyor');
    return { ...cachedData, fromCache: true };
  }

  console.log('🔄 Harem Altın scraping başlıyor...');

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  try {
    // User agent ayarla
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Sayfaya git
    await page.goto('https://canlipiyasalar.haremaltin.com/', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    // Verilerin yüklenmesini bekle
    await page.waitForFunction(
      () => {
        const elements = document.querySelectorAll('td, .price, [class*="fiyat"]');
        let hasNumbers = false;
        elements.forEach(el => {
          if (el.innerText && el.innerText.match(/\d{3,}/)) {
            hasNumbers = true;
          }
        });
        return hasNumbers;
      },
      { timeout: 15000 }
    ).catch(() => console.log('Selector timeout, devam ediliyor...'));

    // Ekstra bekleme - SignalR verilerinin tam yüklenmesi için
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verileri çek
    const prices = await page.evaluate(() => {
      const results = {
        altin: [],
        doviz: [],
        gumus: [],
        pilesler: [],
        timestamp: new Date().toISOString()
      };

      // Tüm tabloları bul
      const tables = document.querySelectorAll('table');
      
      tables.forEach(table => {
        const rows = table.querySelectorAll('tr');
        
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const cellTexts = Array.from(cells).map(c => c.innerText.trim());
            const name = cellTexts[0];
            
            // Fiyat değerlerini parse et
            const parsePrice = (str) => {
              if (!str) return null;
              const cleaned = str.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
              const num = parseFloat(cleaned);
              return isNaN(num) ? null : num;
            };

            const alis = parsePrice(cellTexts[1]);
            const satis = parsePrice(cellTexts[2]);
            const degisim = cellTexts[3] || null;

            if (name && (alis || satis)) {
              const item = { name, alis, satis, degisim };
              const nameLower = name.toLowerCase();

              // Kategorize et
              if (nameLower.includes('dolar') || nameLower.includes('euro') || 
                  nameLower.includes('sterlin') || nameLower.includes('frank') ||
                  nameLower.includes('usd') || nameLower.includes('eur') ||
                  nameLower.includes('gbp') || nameLower.includes('chf')) {
                results.doviz.push(item);
              } else if (nameLower.includes('gümüş') || nameLower.includes('gumus') ||
                         nameLower.includes('silver')) {
                results.gumus.push(item);
              } else if (nameLower.includes('altın') || nameLower.includes('altin') ||
                         nameLower.includes('çeyrek') || nameLower.includes('ceyrek') ||
                         nameLower.includes('yarım') || nameLower.includes('yarim') ||
                         nameLower.includes('tam') || nameLower.includes('ata') ||
                         nameLower.includes('reşat') || nameLower.includes('resat') ||
                         nameLower.includes('cumhuriyet') || nameLower.includes('gremse') ||
                         nameLower.includes('ons') || nameLower.includes('has') ||
                         nameLower.includes('gram') || nameLower.includes('22 ayar') ||
                         nameLower.includes('14 ayar') || nameLower.includes('bilezik')) {
                results.altin.push(item);
              } else if (alis > 100) {
                // Diğer değerli veriler
                results.pilesler.push(item);
              }
            }
          }
        });
      });

      // Alternatif: div bazlı kartları da kontrol et
      const priceCards = document.querySelectorAll('[class*="price"], [class*="card"], [class*="item"]');
      priceCards.forEach(card => {
        const text = card.innerText;
        if (!text) return;
        
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length >= 2) {
          const name = lines[0];
          const numbers = text.match(/[\d.,]+/g);
          
          if (numbers && numbers.length >= 1) {
            const parseNum = (str) => {
              const cleaned = str.replace(/\./g, '').replace(',', '.');
              return parseFloat(cleaned);
            };
            
            const nameLower = name.toLowerCase();
            
            // Duplicate kontrolü
            const isDuplicate = (arr) => arr.some(item => item.name === name);
            
            if (!isDuplicate(results.altin) && !isDuplicate(results.doviz) && 
                !isDuplicate(results.gumus)) {
              const item = {
                name,
                alis: numbers[0] ? parseNum(numbers[0]) : null,
                satis: numbers[1] ? parseNum(numbers[1]) : null,
                degisim: null
              };
              
              if (nameLower.includes('altın') || nameLower.includes('altin')) {
                results.altin.push(item);
              } else if (nameLower.includes('dolar') || nameLower.includes('euro')) {
                results.doviz.push(item);
              }
            }
          }
        }
      });

      return results;
    });

    // Cache'e kaydet
    cachedData = prices;
    cacheTime = Date.now();

    console.log(`✅ Scraping tamamlandı: ${prices.altin.length} altın, ${prices.doviz.length} döviz`);

    return prices;

  } finally {
    await browser.close();
  }
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const startTime = Date.now();
    const data = await scrapeHaremAltin();
    const duration = Date.now() - startTime;

    // Query parameter ile filtreleme
    // ?type=gold | ?type=currency | ?type=silver | ?type=all (default)
    const { type } = req.query;
    
    let filteredData;
    switch (type) {
      case 'gold':
      case 'altin':
        filteredData = { altin: data.altin, timestamp: data.timestamp };
        break;
      case 'currency':
      case 'doviz':
        filteredData = { doviz: data.doviz, timestamp: data.timestamp };
        break;
      case 'silver':
      case 'gumus':
        filteredData = { gumus: data.gumus, timestamp: data.timestamp };
        break;
      default:
        filteredData = data;
    }

    return res.status(200).json({
      success: true,
      data: filteredData,
      meta: {
        source: 'Harem Altın',
        scrapedAt: new Date().toISOString(),
        duration: `${duration}ms`,
        fromCache: data.fromCache || false,
        filter: type || 'all'
      }
    });

  } catch (error) {
    console.error('❌ Scraping hatası:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Site yapısı değişmiş olabilir veya geçici bir sorun var.'
    });
  }
};
