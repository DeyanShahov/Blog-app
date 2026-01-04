/**
 * ==============================================
 * ГЛОБАЛНИ ПРОМЕНЛИВИ И КОНФИГУРАЦИЯ
 * ==============================================
 */
const PAGE_SIZE = 5;
let ALL_POSTS = []; // Глобален кеш за всички публикации

const BLOGGER_URL = "https://www.lichna-prizma.eu/";  //"https://lichna-prizma.blogspot.com/";

/**
 * ==============================================
 * ОСНОВНА ЛОГИКА
 * ==============================================
 */

async function init() {
  document.getElementById('app').setAttribute('aria-busy', 'true');
  try {
    const { posts, author } = await fetchPosts();
    ALL_POSTS = posts.slice().sort((a, b) => b.date.localeCompare(a.date));
    renderSidebar(ALL_POSTS);
    renderAuthor(author);
    router();
  } catch (err) {
    console.error("Грешка при зареждане на публикациите:", err);
    document.getElementById('app').innerHTML = "<p>Възникна грешка при зареждане на съдържанието. Моля, опитайте по-късно.</p>";
  } finally {
    document.getElementById('app').setAttribute('aria-busy', 'false');
  }
}

async function fetchPosts() {
  const callbackName = 'jsonpCallback' + Date.now();
  const script = document.createElement('script');

  return new Promise((resolve, reject) => {
    window[callbackName] = (json) => {
      if (!json.feed || !json.feed.entry) {
        console.error("Грешен формат на JSON отговора", json);
        reject(new Error('Невалиден формат на данните от Blogger.'));
        return;
      }
      const posts = json.feed.entry.map(entry => {
        const id = entry.id.$t.split('.post-')[1];
        const linkObj = entry.link.find(l => l.rel === 'alternate');
        const url = linkObj ? linkObj.href : null;
        const coverMatch = entry.content && entry.content.$t ? entry.content.$t.match(/<img[^>]+src="([^">]+)"/) : null;
        const cover = entry.media$thumbnail ? entry.media$thumbnail.url : (coverMatch ? coverMatch[1] : null);

        // Debug logging for YouTube embeds - temporarily activated
        const rawHtml = entry.content?.$t || '';
        const processedHtml = processYouTubeEmbeds(rawHtml);
        const sanitizedHtml = DOMPurify.sanitize(processedHtml, { ADD_TAGS: ['iframe'], ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'src', 'width', 'height', 'title', 'data-thumbnail-src', 'allowtransparency', 'referrerpolicy'] });

        // Check if post contains YouTube content and log debug info
        const hasYouTube = rawHtml.includes('youtube.com') || rawHtml.includes('youtu.be') || rawHtml.includes('share-widget');

        if (hasYouTube) {
          // Extract YouTube iframes info
          const rawIframes = (rawHtml.match(/<iframe[^>]*>.*?<\/iframe>/gs) || []).filter(iframe =>
            iframe.includes('youtube.com') || iframe.includes('youtu.be') || iframe.includes('share-widget')
          );

          const processedIframes = (processedHtml.match(/<iframe[^>]*>.*?<\/iframe>/gs) || []).filter(iframe =>
            iframe.includes('youtube.com') || iframe.includes('youtu.be')
          );

          // console.log('🎬 YOUTUBE DEBUG -', entry.title.$t);
          // console.log('Raw YouTube iframes:', rawIframes.length, rawIframes);
          // console.log('Processed YouTube iframes:', processedIframes.length, processedIframes);
          // console.log('---');
        }

        return {
          id: id,
          title: entry.title.$t,
          date: entry.published.$t.slice(0, 10),
          tags: (entry.category || []).map(c => c.term),
          html: sanitizedHtml,
          cover: cover,
          excerpt: toExcerpt(entry.content?.$t, 150),
          url: url
        };
      });

      const author = {
          name: json.feed.author[0].name.$t,
          avatar: json.feed.author[0].gd$image.src
      };

      resolve({ posts, author });

      delete window[callbackName];
      document.head.removeChild(script);
    };

    script.src = `${BLOGGER_URL}/feeds/posts/default?alt=json-in-script&callback=${callbackName}&max-results=500`;
    script.onerror = () => {
        reject(new Error('Неуспешно зареждане на скрипта за публикации.'));
        delete window[callbackName];
        document.head.removeChild(script);
    };

    document.head.appendChild(script);
  });
}

/**
 * ==============================================
 * РЕНДЪР ФУНКЦИИ (UI)
 * ==============================================
 */

const fmtDate = (iso) => new Date(iso).toLocaleDateString('bg-BG', { day: '2-digit', month: 'long', year: 'numeric' });

function toExcerpt(html, max = 180) {
  if (!html) return '';
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trim() + '…' : text;
}

function processYouTubeEmbeds(html) {
  if (!html) return html;

  // Create a temporary DOM element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  // AGGRESSIVE CLEANUP: Remove ALL script tags to prevent any dynamic loading
  const allScripts = tempDiv.querySelectorAll('script');
  allScripts.forEach(script => script.remove());

  // Find all iframes BEFORE removing Google elements (since some iframes might have Google classes)
  const allIframes = Array.from(tempDiv.querySelectorAll('iframe'));

  // Remove all Google/Blogger related elements EXCEPT iframes (we'll handle them separately)
  const googleElements = tempDiv.querySelectorAll('[class*="google"], [id*="google"], [class*="blogger"], [id*="blogger"], [class*="share"], [id*="share"], [class*="widget"], [id*="widget"]');
  googleElements.forEach(element => {
    // Don't remove iframes yet - we'll handle them in the processing loop
    if (element.tagName !== 'IFRAME') {
      element.remove();
    }
  });

  // Remove elements that contain Google URLs or services (but preserve iframes)
  const allElements = tempDiv.querySelectorAll('*');
  allElements.forEach(element => {
    if (element.tagName === 'IFRAME') return; // Skip iframes

    const htmlContent = element.innerHTML;
    const attributes = Array.from(element.attributes).map(attr => attr.value).join(' ');

    // Remove if content or attributes contain Google services
    if (htmlContent.includes('google') ||
        htmlContent.includes('blogger.com') ||
        htmlContent.includes('share-widget') ||
        attributes.includes('google') ||
        attributes.includes('blogger') ||
        attributes.includes('share-widget')) {
      element.remove();
    }
  });

  // Process YouTube embeds by replacing iframe elements in the HTML string
  let htmlString = tempDiv.innerHTML;

  // Find all iframe elements in the current HTML
  const iframes = tempDiv.querySelectorAll('iframe');

  iframes.forEach(iframe => {
    const src = iframe.getAttribute('src');
    let videoId = null;

    // Handle direct YouTube embeds (our test case)
    if (src && (src.includes('youtube.com') || src.includes('youtu.be'))) {
      // Handle youtube.com/embed/VIDEO_ID
      if (src.includes('youtube.com/embed/')) {
        videoId = src.split('youtube.com/embed/')[1].split(/[?&]/)[0];
      }
      // Handle youtube.com/watch?v=VIDEO_ID
      else if (src.includes('youtube.com/watch?v=')) {
        videoId = src.split('v=')[1].split('&')[0];
      }
      // Handle youtu.be/VIDEO_ID
      else if (src.includes('youtu.be/')) {
        videoId = src.split('youtu.be/')[1].split(/[?&]/)[0];
      }
    }
    // Handle Blogger share widget iframes
    else if (src && src.includes('/share-widget') && src.includes('u=')) {
      try {
        // Extract the encoded URL from the share widget
        const urlParams = new URLSearchParams(src.split('?')[1]);
        const encodedUrl = urlParams.get('u');

        if (encodedUrl) {
          // Decode the URL
          const decodedUrl = decodeURIComponent(encodedUrl);

          // Extract video ID from the decoded YouTube URL
          if (decodedUrl.includes('youtube.com/watch?v=')) {
            videoId = decodedUrl.split('v=')[1].split('&')[0];
          } else if (decodedUrl.includes('youtu.be/')) {
            videoId = decodedUrl.split('youtu.be/')[1].split(/[?&]/)[0];
          } else if (decodedUrl.includes('youtube.com/embed/')) {
            videoId = decodedUrl.split('youtube.com/embed/')[1].split(/[?&]/)[0];
          }
        }
      } catch (e) {
        console.warn('Failed to decode Blogger share widget URL:', src);
      }
    }

    if (videoId) {
      // Create clean YouTube embed HTML string
      const embedUrl = `https://www.youtube.com/embed/${videoId}`;
      const newIframeHtml = `<iframe src="${embedUrl}" ` +
                           `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; compute-pressure" ` +
                           `allowfullscreen="" ` +
                           `frameborder="0" ` +
                           `style="width: 100%; height: auto; aspect-ratio: 16/9; max-width: 100%;"></iframe>`;

      // Replace the iframe in the HTML string
      const iframeHtml = iframe.outerHTML;
      htmlString = htmlString.replace(iframeHtml, newIframeHtml);
    }
  });

  // Return the processed HTML
  return htmlString;
}

function computeTaxonomies(posts) {
  const tags = new Map();
  const archive = new Map();
  for (const p of posts) {
    (p.tags || []).forEach(t => tags.set(t, (tags.get(t) || 0) + 1));
    const ym = p.date.slice(0, 7);
    archive.set(ym, (archive.get(ym) || 0) + 1);
  }
  return {
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]),
    archive: [...archive.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  };
}

function renderSidebar(posts) {
    const SIDE_POST_LIMIT = 6;
    const TAG_LIMIT = 5;
    const ARCHIVE_LIMIT = 5;

    const side = document.getElementById('side-latest');
    if (side) {
        side.innerHTML = posts.slice(0, SIDE_POST_LIMIT).map(p => {
            const imageUrl = p.cover ? p.cover.replace(/\/s\d+(-c)?\//, '/s72-c/') : 'https://picsum.photos/72?grayscale';
            return `
            <article class="mini-post">
              <a href="#post/${p.id}" data-link>
                <img src="${imageUrl}" alt="${escapeHtml(p.title)}" loading="lazy" />
              </a>
              <div>
                <a class="mini-title" href="#post/${p.id}" data-link>${escapeHtml(p.title)}</a>
                <div class="meta">${fmtDate(p.date)}</div>
              </div>
            </article>
          `
        }).join('');
    }

    const { tags, archive } = computeTaxonomies(posts);

    const tcloud = document.getElementById('tag-cloud');
    if (tcloud) {
        const tagRenderer = ([t, c], index) => {
            const isHidden = index >= TAG_LIMIT;
            return `<a class="tag sidebar-item ${isHidden ? 'hidden-item' : ''}" href="#tag/${encodeURIComponent(t)}" data-link style="${isHidden ? 'display:none;' : ''}">${escapeHtml(t)} <span class="count">(${c})</span></a>`;
        };
        let tagsHtml = tags.map(tagRenderer).join('');
        if (tags.length > TAG_LIMIT) {
            tagsHtml += `<button class="toggle-list-btn" data-target-selector=".sidebar-item.hidden-item" data-container="tag-cloud" data-total="${tags.length}" data-show-text="Покажи всички" data-hide-text="Покажи по-малко">Покажи всички (${tags.length})</button>`;
        }
        tcloud.innerHTML = tagsHtml;
    }

    const alist = document.getElementById('archive-list');
    if (alist) {
        const archiveRenderer = ([ym, c], index) => {
            const d = new Date(`${ym}-01T12:00:00Z`);
            const label = d.toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' });
            const isHidden = index >= ARCHIVE_LIMIT;
            return `<li class="archive-item ${isHidden ? 'hidden-item' : ''}" style="${isHidden ? 'display:none;' : ''}"><a href="#archive/${ym}" data-link><span>${label}</span><span class="muted">${c}</span></a></li>`;
        };
        let archiveHtml = archive.map(archiveRenderer).join('');
        if (archive.length > ARCHIVE_LIMIT) {
            archiveHtml += `<li><button class="toggle-list-btn" data-target-selector=".archive-item.hidden-item" data-container="archive-list" data-total="${archive.length}" data-show-text="Покажи всички" data-hide-text="Покажи по-малко">Покажи всички (${archive.length})</button></li>`;
        }
        alist.innerHTML = archiveHtml;
    }
}

function renderAuthor(author) {
    const authorCard = document.getElementById('author-card');
    if (!authorCard || !author) return;

    const img = authorCard.querySelector('.author img');
    const nameEl = authorCard.querySelector('.author strong');

    if (img && author.avatar) {
        // Зареждаме по-голяма снимка, ако е налична
        img.src = author.avatar.replace(/\/s\d+(-c)?\//, '/s128-c/');
        img.alt = `Автор – ${author.name}`;
    }
    if (nameEl && author.name) {
        nameEl.textContent = `Автор: ${author.name}`;
    }
}

function renderHome(page = 1, list = ALL_POSTS) {
  const app = document.getElementById('app');
  const start = (page - 1) * PAGE_SIZE;
  const slice = list.slice(start, start + PAGE_SIZE);

  const baseRoute = list === ALL_POSTS ? '#page' : location.hash.split('/').slice(0, 2).join('/');

  app.innerHTML = slice.map(p => {
    const imageUrl = p.cover ? p.cover.replace(/\/s\d+(-c)?\//, '/s400/') : '';
    return `
    <article class="post-card">
      ${p.cover ? `
        <div class="post-media-container">
          <a href="#post/${p.id}" data-link>
            <img class="post-media" src="${imageUrl}" alt="${escapeHtml(p.title)}" loading="lazy" />
          </a>
        </div>
      ` : ''}
      <div class="post-body">
        <div>
          <h2><a href="#post/${p.id}" data-link>${escapeHtml(p.title)}</a></h2>
          <div class="meta">${fmtDate(p.date)}</div>
          <p>${p.excerpt}</p>
        </div>
        <div class="post-actions">
          <div class="meta">
            ${(p.tags || []).map(t => `<a href="#tag/${encodeURIComponent(t)}" data-link class="chip">${escapeHtml(t)}</a>`).join(' ')}
          </div>
          <a class="chip" href="#post/${p.id}" data-link>Прочети →</a>
        </div>
      </div>
    </article>
  `}).join('') + renderPagination(page, Math.ceil(list.length / PAGE_SIZE), baseRoute);
  window.scrollTo({top:0, behavior:'smooth'});
}

function renderPagination(page, pages, baseRoute = '#page') {
    if (pages <= 1) return '';

    const prev = page > 1 ? `<a href="${baseRoute}/${page - 1}" data-link>← Предишни</a>` : '<span></span>';
    const next = page < pages ? `<a href="${baseRoute}/${page + 1}" data-link>Следващи →</a>` : '<span></span>';

    const maxVisibleButtons = 7;
    let pageNumbers = [];

    if (pages <= maxVisibleButtons) {
        for (let i = 1; i <= pages; i++) {
            pageNumbers.push(i);
        }
    } else {
        pageNumbers.push(1);
        let start = Math.max(2, page - 2);
        let end = Math.min(pages - 1, page + 2);

        if (page <= 4) {
            start = 2;
            end = 5;
        }

        if (page >= pages - 3) {
            start = pages - 4;
            end = pages - 1;
        }

        if (start > 2) {
            pageNumbers.push('...');
        }

        for (let i = start; i <= end; i++) {
            pageNumbers.push(i);
        }

        if (end < pages - 1) {
            pageNumbers.push('...');
        }

        pageNumbers.push(pages);
    }

    const nums = pageNumbers.map(num => {
        if (num === '...') {
            return `<span class="muted">...</span>`;
        }
        return `<a href="${baseRoute}/${num}" data-link ${num === page ? 'aria-current="page"' : ''}>${num}</a>`;
    }).join('');

    return `<nav class="pagination" aria-label="Навигация между страници">
        ${prev}
        <div class="pages">${nums}</div>
        ${next}
    </nav>`;
}

function renderPost(id) {
  const app = document.getElementById('app');
  const p = ALL_POSTS.find(x=> String(x.id) === String(id));
  if(!p){ app.innerHTML = `<p>Статията не е намерена.</p>`; return; }
  const imageUrl = p.cover ? p.cover.replace(/\/s\d+(-c)?\//, '/s1600/') : '';

  app.innerHTML = `
    <article class="single">
      ${p.cover ? `<img class="hero" src="${imageUrl}" alt="${escapeHtml(p.title)}" />` : ''}
      <div class="wrap">
        <a class="back-link" href="#" data-link>← Към началото</a>
        <h1>${escapeHtml(p.title)}</h1>
        <div class="meta">Публикувано: ${fmtDate(p.date)} · Теми: ${(p.tags||[]).map(t=>`<a href="#tag/${encodeURIComponent(t)}" data-link>${escapeHtml(t)}</a>`).join(', ') || '—'}</div>
        <div class="content">${p.html}</div>
        <div class="post-actions" style="padding-left:0">
          ${shareButtons(p)}
        </div>
        <section class="comments" aria-labelledby="comments-h">
          <h3 id="comments-h">Коментари</h3>
          <div id="comments-list"></div>
        </section>
      </div>
    </article>
  `;
  window.scrollTo({top:0, behavior:'smooth'});
}

function renderByTag(tag, page = 1) {
  const list = ALL_POSTS.filter(p => (p.tags || []).map(t => t.toLowerCase()).includes(tag.toLowerCase()));
  const app = document.getElementById('app');
  if (list.length === 0) {
    app.innerHTML = `<p>Няма публикации с тема „${escapeHtml(tag)}“.</p>`;
    return;
  }
  app.innerHTML = `<h2>Тема: ${escapeHtml(tag)}</h2>`;
  renderHome(page, list);
}

function renderArchive(ym, page = 1) {
  const list = ALL_POSTS.filter(p => p.date.startsWith(ym));
  const d = new Date(ym + '-01T12:00:00Z');
  const label = d.toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' });
  const app = document.getElementById('app');
  app.innerHTML = `<h2>Архив: ${label}</h2>`;
  renderHome(page, list);
}

function renderPageByPath(pageName) {
    const app = document.getElementById('app');

    // Special handling for privacy policy (placeholder page)
    if (pageName === 'privacy') {
        app.innerHTML = `
            <article class="single">
              <div class="wrap">
                <h1>Политика на поверителност</h1>
                <div class="content">
                  <p><em>Тази страница е в процес на разработка. Политиката на поверителност ще бъде добавена скоро.</em></p>

                  <h2>Събиране на информация</h2>
                  <p>Ние уважаваме вашата поверителност и се стремим да бъдем прозрачни относно начина, по който събираме и използваме вашата информация.</p>

                  <h2>Използване на бисквитки</h2>
                  <p>Този сайт използва бисквитки за подобряване на потребителското изживяване.</p>

                  <h2>Контакти</h2>
                  <p>Ако имате въпроси относно политиката на поверителност, моля свържете се с нас.</p>
                </div>
              </div>
            </article>
        `;
        window.scrollTo({top:0, behavior:'smooth'});
        return;
    }

    // Special handling for author page (custom content)
    if (pageName === 'author') {
        app.innerHTML = `
            <article class="single">
              <div class="wrap">
                <h1>За автора</h1>

                <!-- Hero Section -->
                <div class="author-hero" style="text-align: center; margin: 2rem 0; padding: 2rem; background: var(--surface); border-radius: var(--radius); border: 1px solid var(--border);">
                  <div style="font-size: 1.2rem; color: var(--brand); margin-bottom: 0.5rem;">Blogger & Creative Writer</div>
                  <h2 style="margin-bottom: 1rem; color: var(--ink);">Stranded</h2>
                  <p style="font-size: 1.1rem; color: var(--ink-muted); max-width: 600px; margin: 0 auto;">
                    I am a blogger, Zumba lover, wine admirer, mom, free-spirited, and a thinking woman.
                  </p>
                  <div style="margin-top: 1rem;">
                    <a href="https://www.youtube.com/channel/UCkJwJyPNLu7zMseDETu7TJw" target="_blank" rel="noopener" style="color: var(--brand); text-decoration: none; padding: 0.5rem 1rem; border: 1px solid var(--brand); border-radius: 20px; display: inline-block;">
                      📺 YouTube Channel
                    </a>
                  </div>
                </div>

                <!-- Details Grid -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin: 2rem 0;">

                  <!-- Basic Info -->
                  <div class="card" style="padding: 1.5rem;">
                    <h3 style="margin-bottom: 1rem; color: var(--brand);">Основна информация</h3>
                    <div style="display: grid; gap: 0.75rem;">
                      <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
                        <span style="font-weight: 500;">Gender:</span>
                        <span>Female</span>
                      </div>
                      <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
                        <span style="font-weight: 500;">Industry:</span>
                        <span>Publishing</span>
                      </div>
                      <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
                        <span style="font-weight: 500;">Occupation:</span>
                        <span>Blogger</span>
                      </div>
                      <div style="display: flex; justify-content: space-between; padding: 0.5rem 0;">
                        <span style="font-weight: 500;">Location:</span>
                        <span>Burgas, Bulgaria</span>
                      </div>
                    </div>
                  </div>

                  <!-- Interests -->
                  <div class="card" style="padding: 1.5rem;">
                    <h3 style="margin-bottom: 1rem; color: var(--brand);">Интереси</h3>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                      <span class="chip">Zumba</span>
                      <span class="chip">Wine</span>
                      <span class="chip">Blogging</span>
                      <span class="chip">Travelling</span>
                      <span class="chip">Creative writing</span>
                      <span class="chip">Dancing</span>
                    </div>
                  </div>

                </div>

                <!-- Favorites Section -->
                <div style="margin: 3rem 0;">
                  <h3 style="text-align: center; margin-bottom: 2rem; color: var(--brand);">Любими неща</h3>

                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">

                    <div class="card" style="padding: 1.5rem; text-align: center;">
                      <div style="font-size: 2rem; margin-bottom: 1rem;">🎬</div>
                      <h4 style="margin-bottom: 0.5rem;">Любими филми</h4>
                      <p style="color: var(--ink-muted); margin: 0;">
                        "The Great Gatsby" and "Interview with the Vampire"
                      </p>
                    </div>

                    <div class="card" style="padding: 1.5rem; text-align: center;">
                      <div style="font-size: 2rem; margin-bottom: 1rem;">🎵</div>
                      <h4 style="margin-bottom: 0.5rem;">Любима музика</h4>
                      <p style="color: var(--ink-muted); margin: 0;">
                        Retro, Rock, Gothic, Jazz, and Relaxing
                      </p>
                    </div>

                    <div class="card" style="padding: 1.5rem; text-align: center;">
                      <div style="font-size: 2rem; margin-bottom: 1rem;">📚</div>
                      <h4 style="margin-bottom: 0.5rem;">Любими книги</h4>
                      <p style="color: var(--ink-muted); margin: 0;">
                        "The three musketeers" by Alexander Dumas
                      </p>
                    </div>

                  </div>
                </div>

                <!-- Quote Section -->
                <div style="text-align: center; margin: 3rem 0; padding: 2rem; background: var(--surface); border-radius: var(--radius); border: 1px solid var(--border);">
                  <blockquote style="font-size: 1.2rem; font-style: italic; color: var(--ink); margin: 0; position: relative;">
                    "Животът е пъзел, който се подрежда с всяко ново преживяване и урок, който учим."
                  </blockquote>
                  <cite style="display: block; margin-top: 1rem; color: var(--brand); font-weight: 500;">- Stranded</cite>
                </div>

              </div>
            </article>
        `;
        window.scrollTo({top:0, behavior:'smooth'});
        return;
    }

    app.innerHTML = `<p>Зареждане...</p>`;

    // Карта на имената на страниците към техните пътища в Blogger
    const pageConfigs = {
        'contact': { path: '/p/blog-page.html', feed: 'pages' },
        'author': { path: '/profile/17690316785048504560', feed: 'posts' }, // Blogger profile
        'zumba-steps': { path: '/2000/08/blog-post_78.html', feed: 'posts' },
        'video-messages': { path: '/2000/08/blog-post_30.html', feed: 'posts' },
        'one-more': { path: '/2000/08/one-more-international.html', feed: 'posts' },
        'poetry': { path: '/2000/08/blog-post_54.html', feed: 'posts' }
    };

    const config = pageConfigs[pageName];
    if (!config) {
        app.innerHTML = `<p>Страницата не е намерена.</p>`;
        return;
    }

    const callbackName = 'jsonpPageCallback' + Date.now();
    const script = document.createElement('script');

    window[callbackName] = (json) => {
        if (!json.feed || !json.feed.entry || json.feed.entry.length === 0) {
            console.error("Грешен формат на JSON отговора за страница", json);
            app.innerHTML = `<p>Възникна грешка при зареждане на съдържанието или страницата е празна.</p>`;
            delete window[callbackName];
            document.head.removeChild(script);
            return;
        }

        const page = json.feed.entry[0]; // Взимаме първия резултат
        const title = page.title.$t;

        // Debug logging for page content - commented out
        // const rawPageHtml = page.content?.$t || '';
        // const processedPageHtml = processYouTubeEmbeds(rawPageHtml);
        // const sanitizedPageHtml = DOMPurify.sanitize(processedPageHtml, { ADD_TAGS: ['iframe'], ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'src', 'width', 'height', 'title', 'data-thumbnail-src', 'allowtransparency', 'referrerpolicy'] });

        // console.log('=== BLOGGER PAGE DEBUG ===');
        // console.log('Page Title:', title);
        // console.log('Raw Page HTML:', rawPageHtml);
        // console.log('After processYouTubeEmbeds:', processedPageHtml);
        // console.log('Final sanitized Page HTML:', sanitizedPageHtml);
        // console.log('===========================');

        const content = page.content ? DOMPurify.sanitize(processYouTubeEmbeds(page.content.$t), { ADD_TAGS: ['iframe'], ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'style', 'src', 'width', 'height', 'title', 'data-thumbnail-src', 'allowtransparency', 'referrerpolicy'] }) : '';

        app.innerHTML = `
            <article class="single">
              <div class="wrap">
                <h1>${escapeHtml(title)}</h1>
                <div class="content">${content}</div>
              </div>
            </article>
        `;
        window.scrollTo({top:0, behavior:'smooth'});

        delete window[callbackName];
        document.head.removeChild(script);
    };

    script.src = `${BLOGGER_URL}/feeds/${config.feed}/default?path=${config.path}&alt=json-in-script&callback=${callbackName}`;
    script.onerror = () => {
        app.innerHTML = `<p>Възникна грешка при зареждане на съдържанието.</p>`;
        delete window[callbackName];
        document.head.removeChild(script);
    };

    document.head.appendChild(script);
}

/**
 * ==============================================
 * ПОМОЩНИ ФУНКЦИИ И МАРШРУТИЗАЦИЯ
 * ==============================================
 */

function router() {
  const h = location.hash.replace(/^#/, '');
  document.getElementById('app').setAttribute('aria-busy', 'true');

  if (!h || h === 'topics' || h === 'archive' || h === 'contact') {
    renderHome(1, ALL_POSTS);
  } else if (h.startsWith('post/')) {
    const id = h.split('/')[1];
    renderPost(id);
  } else if (h.startsWith('page/')) {
    const n = Math.max(1, parseInt(h.split('/')[1] || '1', 10));
    renderHome(n, ALL_POSTS);
  } else if (h.startsWith('view/')) {
    const pageName = h.split('/')[1];
    renderPageByPath(pageName);
  } else if (h.startsWith('tag/')) {
    const parts = h.split('/');
    const tag = decodeURIComponent(parts[1]);
    const page = Math.max(1, parseInt(parts[2] || '1', 10));
    renderByTag(tag, page);
  } else if (h.startsWith('archive/')) {
    const parts = h.split('/');
    const ym = parts[1];
    const page = Math.max(1, parseInt(parts[2] || '1', 10));
    renderArchive(ym, page);
  } else {
    renderHome(1, ALL_POSTS);
  }
  document.getElementById('app').setAttribute('aria-busy', 'false');
}

function shareButtons(p) {
  const url = p.url || (location.origin + location.pathname + `#post/${p.id}`);
  const title = encodeURIComponent(p.title);
  const u = encodeURIComponent(url);
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${u}`;
  const x = `https://twitter.com/intent/tweet?url=${u}&text=${title}`;
  const mail = `mailto:?subject=${title}&body=${u}`;
  return `
    <button class="chip" onclick="shareNative('${escapeQuotes(p.title)}','${escapeQuotes(url)}')">Сподели</button>
    <a class="chip" href="${fb}" target="_blank" rel="noopener">Facebook</a>
    <a class="chip" href="${x}" target="_blank" rel="noopener">X/Twitter</a>
    <a class="chip" href="${mail}">Имейл</a>`;
}

async function shareNative(title, url) {
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
    } else {
      alert('Функцията за споделяне не се поддържа от този браузър. Моля, използвайте бутоните за социални мрежи.');
    }
  } catch (e) { /* Потребителят е отказал споделянето */ }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>()"']/g, m => ({ '&': '&', '<': '<', '>': '>', '(': '&#40;', ')': '&#41;', '"': '"', "'": '&#39;' }[m]));
}
function escapeQuotes(s) {
    if (!s) return '';
    return String(s).replace(/["']/g, m => ({'"':'"',"'":'&#39;'}[m]));
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  window.addEventListener('hashchange', router);

  document.getElementById('sidebar').addEventListener('click', e => {
      if (e.target.classList.contains('toggle-list-btn')) {
          const btn = e.target;
          const containerId = btn.dataset.container;
          const container = document.getElementById(containerId);
          const targetSelector = btn.dataset.targetSelector;

          if (container && targetSelector) {
              const itemsToToggle = container.querySelectorAll(targetSelector);
              let isNowVisible;

              itemsToToggle.forEach(item => {
                  const isHidden = item.style.display === 'none';
                  item.style.display = isHidden ? '' : 'none';
                  if (isNowVisible === undefined) {
                      isNowVisible = isHidden;
                  }
              });

              if (isNowVisible !== undefined) {
                  btn.textContent = isNowVisible
                      ? btn.dataset.hideText
                      : `${btn.dataset.showText} (${btn.dataset.total})`;
              }
          }
      }
  });

  document.body.addEventListener('click', e => {
    const element = e.target.closest('[data-link]'); // Find ANY clicked element with data-link

    // If an element was clicked AND it has the data-link attribute, handle as a route.
    if (element && element.hasAttribute('data-link')) {
      e.preventDefault();

      // For anchor tags, use href attribute; for other elements, use data-link attribute
      const href = element.tagName === 'A' ? element.getAttribute('href') : element.getAttribute('data-link');

      if (href && location.hash !== href) {
        location.hash = href;
      }
    }
    // Otherwise, do nothing and let the browser handle the click normally.
  });
});
