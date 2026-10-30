(() => {
  'use strict';
  const root=document.documentElement;
  const save=(key,value)=>{try{localStorage.setItem(key,value)}catch(_){}};
  const themeNames={terra:'暖陶日光',forest:'森野苔綠',cobalt:'靛藍檸光',nocturne:'夜焙琥珀'};
  const themeColors={terra:'#f5eee4',forest:'#ecefe2',cobalt:'#eeecf8',nocturne:'#181e1d'};
  const themeButtons=[...document.querySelectorAll('[data-theme-choice]')];
  const themeToggle=document.getElementById('theme-toggle');
  const themeOptions=document.getElementById('theme-options');
  const setTheme=(theme,announce=false)=>{
    if(!Object.hasOwn(themeNames,theme)) return;
    root.dataset.theme=theme;
    themeButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===theme)));
    document.querySelector('meta[name="theme-color"]').content=themeColors[theme];
    if(announce) document.getElementById('theme-status').textContent=`已切換至${themeNames[theme]}配色`;
  };
  const closeThemes=()=>{themeOptions.hidden=true;themeToggle.setAttribute('aria-expanded','false')};
  themeToggle.addEventListener('click',()=>{themeOptions.hidden=!themeOptions.hidden;themeToggle.setAttribute('aria-expanded',String(!themeOptions.hidden))});
  themeButtons.forEach(button=>button.addEventListener('click',()=>{setTheme(button.dataset.themeChoice,true);save('pure-select-theme',button.dataset.themeChoice);closeThemes();themeToggle.focus()}));
  document.addEventListener('click',event=>{if(!event.target.closest('.theme-control')) closeThemes()});
  setTheme(root.dataset.theme||'terra');

  const header=document.querySelector('.site-header');
  const menu=document.getElementById('menu-toggle');
  const closeMenu=()=>{header.classList.remove('is-menu-open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','開啟選單')};
  menu.addEventListener('click',()=>{const open=header.classList.toggle('is-menu-open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'關閉選單':'開啟選單');closeThemes()});
  document.querySelectorAll('#primary-nav a').forEach(link=>link.addEventListener('click',closeMenu));
  new IntersectionObserver(([entry])=>header.classList.toggle('is-scrolled',!entry.isIntersecting),{rootMargin:'-90px 0px 0px 0px'}).observe(document.querySelector('.coffee-hero'));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!themeOptions.hidden){closeThemes();themeToggle.focus()}if(header.classList.contains('is-menu-open')){closeMenu();menu.focus()}}});

  const motionButton=document.getElementById('motion-toggle');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const updateMotion=()=>{const paused=root.dataset.motion==='paused'||reducedMotion.matches;motionButton.setAttribute('aria-pressed',String(paused));motionButton.disabled=reducedMotion.matches;document.getElementById('motion-label').textContent=reducedMotion.matches?'已減少動態效果':paused?'播放動畫':'暫停動畫';motionButton.firstElementChild.textContent=paused?'▷':'Ⅱ'};
  motionButton.addEventListener('click',()=>{root.dataset.motion=root.dataset.motion==='paused'?'running':'paused';save('pure-select-motion',root.dataset.motion);updateMotion()});
  reducedMotion.addEventListener('change',updateMotion);updateMotion();
  const slides=[...document.querySelectorAll('.hero-slide')],slideButtons=[...document.querySelectorAll('[data-slide]')];
  let currentSlide=0,carouselTimer=null,controlsFocused=false;
  const stopCarousel=()=>{clearInterval(carouselTimer);carouselTimer=null};
  const selectSlide=index=>{currentSlide=(index+slides.length)%slides.length;slides.forEach((slide,n)=>slide.classList.toggle('is-active',n===currentSlide));slideButtons.forEach((button,n)=>button.setAttribute('aria-pressed',String(n===currentSlide)));document.getElementById('slide-count').textContent=`${String(currentSlide+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`};
  const syncCarousel=()=>{stopCarousel();if(root.dataset.motion!=='paused'&&!reducedMotion.matches&&!document.hidden&&!controlsFocused){const seconds=window.CoffeeStore?.state().settings.carouselSeconds||6;carouselTimer=setInterval(()=>selectSlide(currentSlide+1),seconds*1000)}};
  document.getElementById('slide-prev').addEventListener('click',()=>{selectSlide(currentSlide-1);syncCarousel()});
  document.getElementById('slide-next').addEventListener('click',()=>{selectSlide(currentSlide+1);syncCarousel()});
  slideButtons.forEach(button=>button.addEventListener('click',()=>{selectSlide(Number(button.dataset.slide));syncCarousel()}));
  const controls=document.querySelector('.carousel-controls');
  controls.addEventListener('focusin',()=>{controlsFocused=true;stopCarousel()});
  controls.addEventListener('focusout',event=>{if(!controls.contains(event.relatedTarget)){controlsFocused=false;syncCarousel()}});
  controls.addEventListener('mouseenter',stopCarousel);controls.addEventListener('mouseleave',syncCarousel);
  motionButton.addEventListener('click',syncCarousel);reducedMotion.addEventListener('change',syncCarousel);document.addEventListener('visibilitychange',syncCarousel);window.addEventListener('coffee:change',syncCarousel);syncCarousel();


  const cards=()=>[...document.querySelectorAll('[data-flavor-card]')];
  const flavorButtons=[...document.querySelectorAll('[data-flavor]')];
  let flavor='all';
  let search='';
  const filterCoffee=()=>{
    let count=0;
    cards().forEach(card=>{const show=(flavor==='all'||card.dataset.flavorCard===flavor)&&(!search||card.dataset.search.toLocaleLowerCase().includes(search));card.hidden=!show;if(show) count++});
    flavorButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.flavor===flavor)));
    document.getElementById('collection-count').textContent=search?`「${search}」：${count} 款咖啡`:`${count} 款精選咖啡`;
    document.getElementById('coffee-empty').hidden=count!==0;
  };
  window.addEventListener('coffee:featuredChanged',filterCoffee);filterCoffee();
  flavorButtons.forEach(button=>button.addEventListener('click',()=>{flavor=button.dataset.flavor;search='';filterCoffee()}));
  document.getElementById('clear-search').addEventListener('click',()=>{flavor='all';search='';filterCoffee();flavorButtons[0].focus()});
  const searchDialog=document.getElementById('coffee-search');
  document.getElementById('search-open').addEventListener('click',()=>{closeMenu();closeThemes();searchDialog.showModal();document.getElementById('coffee-search-input').focus()});
  document.getElementById('coffee-search-form').addEventListener('submit',event=>{event.preventDefault();search=document.getElementById('coffee-search-input').value.trim().toLocaleLowerCase();flavor='all';filterCoffee();searchDialog.close();document.getElementById('products').scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth'});flavorButtons[0].focus({preventScroll:true})});

  const processImages=[
    {src:'assets/ea2b33f262c8.jpg',alt:'產地工作者挑選咖啡果實'},
    {src:'assets/dfbb85dbab88.jpg',alt:'光學色選機篩選生豆'},
    {src:'assets/be6d8bdd4156.jpg',alt:'以人工檢視咖啡生豆的細節'},
    {src:'assets/5f4e97466f3f.jpg',alt:'剛烘焙完成、正在冷卻的咖啡豆'}
  ];
  const processButtons=[...document.querySelectorAll('[data-process]')];
  processButtons.forEach(button=>button.addEventListener('click',()=>{
    processButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    const n=Number(button.dataset.process),image=window.CoffeeContent?.image('home.process.img'+(n+1))||processImages[n];
    document.getElementById('process-image').src=image.src;
    document.getElementById('process-image').alt=image.alt;
    const caption=`${button.querySelector('.step-number').textContent} / ${button.querySelector('strong').textContent}`;
    document.getElementById('process-caption').textContent=caption;
    document.getElementById('process-status').textContent=`已選擇${caption}`;
  }));
})();
