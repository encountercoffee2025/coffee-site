// 後台「頁面內容」可編輯的欄位：key 對應網頁上的 data-content（文字）或 data-content-img（圖片）。
// 預設值直接讀取 sources 列出的網頁原始 HTML；由程式產生的文字（商店頁面開頭）與不在 HTML 裡的圖片在此列出預設值。
// 每個項目：[key, 名稱, 預設值（文字或圖片網址，選填）, 圖片說明預設值（選填）]
window.COFFEE_CONTENT_MAP = [
  { id: 'site', name: '頁首與頁尾', sources: ['index.html', 'story.html', 'shop.html'], edit: [['shop.html', '頁首與頁尾']], note: '所有頁面共用：改一次，每一頁都會跟著變。', groups: [
    { title: '頁首', items: [
      ['site.brand.sub', 'Logo 下方英文小字'],
      ['site.nav.home', '選單：首頁'], ['site.nav.shop', '選單：咖啡選購'], ['site.nav.treats', '選單：點心'], ['site.nav.subscribe', '選單：月費訂購'],
      ['site.nav.story', '選單：品牌故事'], ['site.nav.about', '選單：關於我們'], ['site.nav.cart', '選單：購物車']
    ] },
    { title: '頁尾', items: [
      ['site.footer.copyright', '版權文字（首頁、品牌故事、關於我們）'], ['site.footer.explore', '品牌故事、關於我們頁尾連結'],
      ['site.footer.tag', '商店頁尾品牌標語（一遇 · 之後的文字）']
    ] }
  ] },
  { id: 'index.html', name: '首頁', sources: ['index.html'], groups: [
    { title: '主視覺（最上方大圖區）', items: [
      ['home.hero.img1', '輪播大圖 1'], ['home.hero.img2', '輪播大圖 2'], ['home.hero.img3', '輪播大圖 3'],
      ['home.hero.eyebrow', '標題上方英文小字'], ['home.hero.title', '大標題'], ['home.hero.desc', '標題下方介紹'],
      ['home.hero.buy', '左邊按鈕文字'], ['home.hero.story', '右邊按鈕文字'], ['home.hero.note1', '左下角標語 1'], ['home.hero.note2', '左下角標語 2']
    ] },
    { title: '品牌介紹', items: [['home.intro.kicker', '英文小標'], ['home.intro.title', '標題'], ['home.intro.copy', '內文'], ['home.intro.link', '連結文字']] },
    { title: '精選咖啡', items: [['home.collection.kicker', '英文小標'], ['home.collection.title', '標題'], ['home.collection.link', '連結文字']] },
    { title: '烘焙故事', items: [
      ['home.roastery.img', '圖片'], ['home.roastery.kicker', '英文小標'], ['home.roastery.title', '標題'], ['home.roastery.copy', '內文'], ['home.roastery.link', '連結文字'],
      ['home.roastery.tag1', '小標籤 1'], ['home.roastery.tag2', '小標籤 2'], ['home.roastery.tag3', '小標籤 3']
    ] },
    { title: '挑豆工藝', items: [
      ['home.process.kicker', '英文小標'], ['home.process.title', '標題'], ['home.process.desc', '說明'], ['home.process.label', '圖片下方英文小字'],
      ['home.process.img1', '第 1 道圖片'], ['home.process.s1t', '第 1 道名稱'], ['home.process.s1p', '第 1 道說明'],
      ['home.process.img2', '第 2 道圖片', 'assets/dfbb85dbab88.jpg', '光學色選機篩選生豆'], ['home.process.s2t', '第 2 道名稱'], ['home.process.s2p', '第 2 道說明'],
      ['home.process.img3', '第 3 道圖片', 'assets/be6d8bdd4156.jpg', '以人工檢視咖啡生豆的細節'], ['home.process.s3t', '第 3 道名稱'], ['home.process.s3p', '第 3 道說明'],
      ['home.process.img4', '第 4 道圖片', 'assets/5f4e97466f3f.jpg', '剛烘焙完成、正在冷卻的咖啡豆'], ['home.process.s4t', '第 4 道名稱'], ['home.process.s4p', '第 4 道說明'],
      ['home.process.link', '連結文字']
    ] },
    { title: '品飲日常', items: [
      ['home.ritual.kicker', '英文小標'], ['home.ritual.title', '標題'], ['home.ritual.copy', '說明'], ['home.ritual.img', '圖片'],
      ['home.ritual.s1t', '步驟 1 標題'], ['home.ritual.s1p', '步驟 1 說明'],
      ['home.ritual.s2t', '步驟 2 標題'], ['home.ritual.s2p', '步驟 2 說明'],
      ['home.ritual.s3t', '步驟 3 標題'], ['home.ritual.s3p', '步驟 3 說明'], ['home.ritual.link', '連結文字']
    ] },
    { title: '常見問題', items: [
      ['home.faq.kicker', '英文小標'], ['home.faq.title', '標題'], ['home.faq.link', '連結文字'],
      ['home.faq.q1', '問題 1'], ['home.faq.a1', '回答 1'], ['home.faq.q2', '問題 2'], ['home.faq.a2', '回答 2'],
      ['home.faq.q3', '問題 3'], ['home.faq.a3', '回答 3'], ['home.faq.q4', '問題 4'], ['home.faq.a4', '回答 4'],
      ['home.faq.q5', '問題 5（回答含連結，固定不變）']
    ] },
    { title: '點心與月費卡片', items: [
      ['home.offer.treat.img', '點心卡片圖片'], ['home.offer.treat.kicker', '點心卡片英文小標'], ['home.offer.treat.title', '點心卡片標題'], ['home.offer.treat.copy', '點心卡片說明'], ['home.offer.treat.link', '點心卡片連結文字'],
      ['home.offer.sub.kicker', '月費卡片英文小標'], ['home.offer.sub.title', '月費卡片標題'], ['home.offer.sub.copy', '月費卡片說明'], ['home.offer.sub.link', '月費卡片連結文字']
    ] },
    { title: '頁尾', items: [
      ['home.closing.kicker', '頁尾上方英文小標'], ['home.closing.title', '頁尾上方大標題'], ['home.closing.button', '頁尾上方按鈕文字'], ['home.footer.tagline', '頁尾標語'],
      ['home.footer.col1', '第 1 欄標題'], ['home.footer.all', '第 1 欄：所有咖啡'], ['home.footer.treats', '第 1 欄：手作點心'], ['home.footer.subscribe', '第 1 欄：月費訂購'], ['home.footer.flavor', '第 1 欄：依風味選豆'], ['home.footer.guide', '第 1 欄：品飲指南'],
      ['home.footer.col2', '第 2 欄標題'], ['home.footer.story', '第 2 欄：品牌故事'], ['home.footer.process', '第 2 欄：挑豆工藝'], ['home.footer.about', '第 2 欄：關於一遇'],
      ['home.footer.col3', '第 3 欄標題'], ['home.footer.faq', '第 3 欄：常見問題'], ['home.footer.contact', '第 3 欄：聯絡與合作'], ['home.footer.checkout', '第 3 欄：購物車與結帳'],
      ['home.footer.top', '回到頂部連結']
    ] }
  ] },
  { id: 'store', name: '商店頁面', sources: [], edit: [['shop.html', '咖啡選購'], ['treats.html', '點心'], ['subscribe.html', '月費訂購'], ['checkout.html', '購物車']], note: '各商店頁最上方的標題與介紹。商品本身請到「商品管理」「點心管理」修改。', groups: [
    { title: '咖啡選購', items: [['shop.kicker', '英文小標', 'ROASTED COFFEE COLLECTION'], ['shop.title', '標題', '選一款，喜歡的風味。']] },
    { title: '點心', items: [['treats.kicker', '英文小標', 'HANDMADE TREATS'], ['treats.title', '標題', '配一口，剛剛好的甜。'], ['treats.intro', '介紹', '手作小點，與咖啡最好的相遇。\n點心為新鮮製作，下單後約 3–5 天出貨，請盡早享用。']] },
    { title: '月費訂購', items: [['subscribe.kicker', '英文小標', 'COFFEE SUBSCRIPTION'], ['subscribe.title', '標題', '讓好咖啡，按時來找你。'], ['subscribe.intro', '介紹', '每月固定寄出當季精選，可隨時暫停或取消。所有方案皆免運。']] },
    { title: '購物車', items: [['checkout.kicker', '英文小標', 'YOUR COFFEE BAG'], ['checkout.title', '標題', '把喜歡的風味，帶回日常。'], ['checkout.intro', '介紹', '確認品項與配送方式，填好收件資料後前往綠界付款。']] }
  ] },
  { id: 'story.html', name: '品牌故事', sources: ['story.html'], groups: [
    { title: '開頭', items: [['story.kicker', '英文小標'], ['story.title', '大標題'], ['story.intro', '介紹'], ['story.img', '主圖']] },
    { title: '內文段落', items: [['story.s1t', '段落 1 標題'], ['story.s1p', '段落 1 內文'], ['story.s2t', '段落 2 標題'], ['story.s2p', '段落 2 內文']] },
    { title: '四道挑豆', items: [
      ['story.step1t', '第 1 道名稱'], ['story.step1p', '第 1 道說明'], ['story.step2t', '第 2 道名稱'], ['story.step2p', '第 2 道說明'],
      ['story.step3t', '第 3 道名稱'], ['story.step3p', '第 3 道說明'], ['story.step4t', '第 4 道名稱'], ['story.step4p', '第 4 道說明']
    ] }
  ] },
  { id: 'about.html', name: '關於我們', sources: ['about.html'], note: '聯絡 Email 會自動使用「商店與資料設定」裡的客服電子信箱。', groups: [
    { title: '開頭', items: [['about.kicker', '英文小標'], ['about.title', '大標題'], ['about.intro', '介紹'], ['about.img', '主圖']] },
    { title: '內文段落', items: [['about.s1t', '段落 1 標題'], ['about.s1p', '段落 1 內文'], ['about.s2t', '段落 2 標題'], ['about.s2p', '段落 2 內文']] },
    { title: '聯絡', items: [['about.contact.kicker', '聯絡英文小標'], ['about.contact.title', '聯絡標題'], ['about.contact.copy', '聯絡說明']] }
  ] }
];
