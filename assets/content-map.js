// 後台「頁面內容」可編輯的欄位：key 對應網頁上的 data-content（文字）或 data-content-img（圖片）。
// 預設值直接讀取 sources 列出的網頁原始 HTML；由程式產生的文字（商店頁面開頭）與不在 HTML 裡的圖片在此列出預設值。
// 每個項目：[key, 名稱, 預設值（文字或圖片網址，選填）, 圖片說明預設值（選填）]
window.COFFEE_CONTENT_MAP = [
  { id: 'site', name: '頁首與頁尾', sources: ['index.html', 'story.html', 'shop.html'], edit: [['shop.html', '頁首與頁尾']], note: '所有頁面共用（含深色頁尾）：改一次，每一頁都會跟著變。', groups: [
    { title: '頁首', items: [
      ['site.brand.sub', 'Logo 下方英文小字'],
      ['site.nav.home', '選單：首頁'], ['site.nav.shop', '選單：咖啡選購'], ['site.nav.treats', '選單：點心'], ['site.nav.subscribe', '選單：月費訂購'],
      ['site.nav.story', '選單：品牌故事'], ['site.nav.cart', '選單：購物車']
    ] },
    { title: '頁尾', items: [
      ['home.footer.tagline', '頁尾標語'],
      ['home.footer.col1', '第 1 欄標題'], ['home.footer.all', '第 1 欄：所有咖啡'], ['home.footer.treats', '第 1 欄：手作點心'], ['home.footer.subscribe', '第 1 欄：月費訂購'], ['home.footer.flavor', '第 1 欄：依風味選豆'],
      ['home.footer.col2', '第 2 欄標題'], ['home.footer.story', '第 2 欄：品牌故事'],
      ['home.footer.col3', '第 3 欄標題'], ['home.footer.faq', '第 3 欄：常見問題'], ['home.footer.contact', '第 3 欄：聯絡與合作（點了會寄信到客服信箱）'], ['home.footer.checkout', '第 3 欄：購物車與結帳'],
      ['home.footer.top', '回到頂部連結'], ['site.footer.copyright', '最下方版權文字']
    ] }
  ] },
  { id: 'index.html', name: '首頁', sources: ['index.html'], groups: [
    { title: '主視覺（最上方大圖區）', items: [
      ['home.hero.img1', '輪播大圖 1'], ['home.hero.img2', '輪播大圖 2'], ['home.hero.img3', '輪播大圖 3'],
      ['home.hero.eyebrow', '標題上方英文小字'], ['home.hero.title', '大標題'], ['home.hero.desc', '標題下方介紹'],
      ['home.hero.buy', '左邊按鈕文字'], ['home.hero.story', '右邊按鈕文字'], ['home.hero.note1', '左下角標語 1'], ['home.hero.note2', '左下角標語 2'], ['home.hero.scroll', '下方「往下捲動」英文小字']
    ] },
    { title: '品牌堅持（主視覺下方三欄）', items: [
      ['home.notes.k1', '第 1 欄英文小字'], ['home.notes.t1', '第 1 欄文字'], ['home.notes.k2', '第 2 欄英文小字'], ['home.notes.t2', '第 2 欄文字'], ['home.notes.k3', '第 3 欄英文小字'], ['home.notes.t3', '第 3 欄文字']
    ] },
    { title: '品牌介紹', items: [['home.intro.kicker', '英文小標'], ['home.intro.title', '標題'], ['home.intro.copy', '內文'], ['home.intro.link', '連結文字']] },
    { title: '挑豆工藝', items: [
      ['home.process.kicker', '英文小標'], ['home.process.title', '標題'], ['home.process.desc', '說明'], ['home.process.label', '圖片下方英文小字'],
      ['home.process.img1', '第 1 道圖片'], ['home.process.s1t', '第 1 道名稱'], ['home.process.s1p', '第 1 道說明'],
      ['home.process.img2', '第 2 道圖片', 'assets/dfbb85dbab88.jpg', '光學色選機篩選生豆'], ['home.process.s2t', '第 2 道名稱'], ['home.process.s2p', '第 2 道說明'],
      ['home.process.img3', '第 3 道圖片', 'assets/be6d8bdd4156.jpg', '以人工檢視咖啡生豆的細節'], ['home.process.s3t', '第 3 道名稱'], ['home.process.s3p', '第 3 道說明'],
      ['home.process.img4', '第 4 道圖片', 'assets/5f4e97466f3f.jpg', '剛烘焙完成、正在冷卻的咖啡豆'], ['home.process.s4t', '第 4 道名稱'], ['home.process.s4p', '第 4 道說明'],
      ['home.process.link', '連結文字']
    ] },
    { title: '精選咖啡', items: [['home.collection.kicker', '英文小標'], ['home.collection.title', '標題'], ['home.collection.link', '連結文字']] },
    { title: '手作點心（精選咖啡下方）', items: [['home.treatblock.kicker', '英文小標'], ['home.treatblock.title', '標題'], ['home.treatblock.link', '連結文字']] },
    { title: '常見問題', items: [
      ['home.faq.kicker', '英文小標'], ['home.faq.title', '標題'], ['home.faq.link', '連結文字'],
      ['home.faq.q1', '問題 1'], ['home.faq.a1', '回答 1'], ['home.faq.q2', '問題 2'], ['home.faq.a2', '回答 2'],
      ['home.faq.q3', '問題 3'], ['home.faq.a3', '回答 3'], ['home.faq.q4', '問題 4'], ['home.faq.a4', '回答 4'],
      ['home.faq.q5', '問題 5（回答含連結，固定不變）']
    ] }
  ] },
  { id: 'store', name: '商店頁面', sources: [], edit: [['shop.html', '咖啡選購'], ['treats.html', '點心'], ['subscribe.html', '月費訂購']], note: '各商店頁最上方的標題與介紹。商品本身請到「商品管理」「點心管理」修改。', groups: [
    { title: '咖啡選購', items: [['shop.kicker', '英文小標', 'ROASTED COFFEE COLLECTION'], ['shop.title', '標題', '選一款，喜歡的風味。']] },
    { title: '點心', items: [['treats.kicker', '英文小標', 'HANDMADE TREATS'], ['treats.title', '標題', '配一口，剛剛好的甜。'], ['treats.intro', '介紹', '手作小點，與咖啡最好的相遇。\n點心為新鮮製作，下單後約 3–5 天出貨，請盡早享用。'], ['treats.note', '點心列表下方說明', '點心圖片為示意插圖。點心屬易腐食品，不適用七天猶豫期；收到時若有破損請 3 日內聯繫我們。']] },
    { title: '月費訂購', items: [['subscribe.kicker', '英文小標', 'COFFEE SUBSCRIPTION'], ['subscribe.title', '標題', '讓好咖啡，按時來找你。'], ['subscribe.intro', '介紹', '每月固定寄出當季精選，可隨時取消。所有方案皆免運。']] },
    { title: '月費訂購・常見問題', items: [
      ['subscribe.faq.title', '標題', '常見問題'],
      ['subscribe.faq.q1', '問題 1', '可以隨時取消嗎？'], ['subscribe.faq.a1', '回答 1', '可以。來信或 LINE 告訴我們，在下次扣款日前取消，之後就不會再扣款；已扣款的當期會照常出貨。'],
      ['subscribe.faq.q2', '問題 2', '什麼時候扣款與出貨？'], ['subscribe.faq.a2', '回答 2', '首次於訂閱當下扣款，之後每期同一日自動以信用卡扣款，扣款後 3–7 天內出貨。'],
      ['subscribe.faq.q3', '問題 3', '月費方案要付運費嗎？'], ['subscribe.faq.a3', '回答 3', '不用，所有月費方案皆免運費。'],
      ['subscribe.faq.q4', '問題 4', '可以換口味嗎？'], ['subscribe.faq.a4', '回答 4', '每期由烘豆師依季節挑選，你也可以隨時聯繫我們調整烘焙度偏好。']
    ] },
  ] },
  { id: 'checkout', name: '購物車', sources: [], edit: [['checkout.html', '購物車']], note: '購物車是空的時候，編輯頁面會同時顯示「空購物車」和結帳表單，兩邊都能直接修改。運費、免運門檻請到「商店與資料設定」修改。', groups: [
    { title: '開頭', items: [['checkout.kicker', '英文小標', 'YOUR COFFEE BAG'], ['checkout.title', '標題', '把喜歡的風味，帶回日常。'], ['checkout.intro', '介紹', '確認品項與配送方式，填好收件資料後前往綠界付款。']] },
    { title: '購物車是空的時候', items: [['checkout.empty.kicker', '英文小標', 'YOUR COFFEE BAG'], ['checkout.empty.title', '標題', '購物車還沒有咖啡。'], ['checkout.empty.copy', '說明', '選一款喜歡的豆，加入購物車。'], ['checkout.empty.shop', '按鈕文字', '探索 10 款熟豆'], ['checkout.empty.treats', '連結文字', '看看點心']] },
    { title: '商品列表', items: [['checkout.treatNote', '有點心時的出貨說明', '點心為新鮮製作，下單後約 3–5 天出貨，請盡早享用。']] },
    { title: '訂購資料表單', items: [
      ['checkout.form.title', '表單標題', '訂購資料'], ['checkout.form.name', '欄位：姓名', '姓名'], ['checkout.form.email', '欄位：電子信箱', '電子信箱'], ['checkout.form.phone', '欄位：手機', '手機'],
      ['checkout.form.delivery', '配送方式標題', '配送方式'], ['checkout.form.pay', '付款方式標題', '付款方式'],
      ['checkout.pay.credit', '付款按鈕：信用卡', '信用卡'], ['checkout.pay.atm', '付款按鈕：ATM', 'ATM 轉帳'], ['checkout.pay.cvs', '付款按鈕：超商代碼', '超商代碼繳費'],
      ['checkout.form.storeHint', '選擇門市按鈕旁說明', '開啟超商官方門市地圖，選好後會自動帶回。'], ['checkout.form.note', '欄位：備註', '備註（選填）'],
      ['checkout.form.submit', '付款按鈕文字', '前往付款'], ['checkout.form.secure', '付款按鈕下方說明', '付款由綠界科技 ECPay 處理，本站不會經手你的卡號。']
    ] },
    { title: '訂單明細（右側）', items: [
      ['checkout.sum.title', '標題', '訂單明細'], ['checkout.sum.count', '商品包數', '商品包數'], ['checkout.sum.subtotal', '商品小計', '商品小計'], ['checkout.sum.total', '應付總額', '應付總額']
    ] }
  ] },
  { id: 'story.html', name: '品牌故事', sources: ['story.html'], groups: [
    { title: '開頭', items: [['story.kicker', '英文小標'], ['story.title', '大標題'], ['story.intro', '介紹'], ['story.img', '主圖']] },
    { title: '內文段落', items: [['story.s1t', '段落 1 標題'], ['story.s1p', '段落 1 內文'], ['story.s2t', '段落 2 標題'], ['story.s2p', '段落 2 內文']] },
    { title: '四道挑豆', items: [
      ['story.step1k', '第 1 道英文小字'], ['story.step2k', '第 2 道英文小字'], ['story.step3k', '第 3 道英文小字'], ['story.step4k', '第 4 道英文小字'],
      ['story.step1t', '第 1 道名稱'], ['story.step1p', '第 1 道說明'], ['story.step2t', '第 2 道名稱'], ['story.step2p', '第 2 道說明'],
      ['story.step3t', '第 3 道名稱'], ['story.step3p', '第 3 道說明'], ['story.step4t', '第 4 道名稱'], ['story.step4p', '第 4 道說明']
    ] }
  ] }
];
