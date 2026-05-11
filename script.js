/**
 * =========================================================
 *  PULSE — Social Media Mini Clone  |  script.js
 *  Modular, event-delegated, localStorage-backed.
 * =========================================================
 */

'use strict';

/* ── 1. CONSTANTS & CONFIG ─────────────────────────────── */

const STORAGE_KEYS = {
  POSTS    : 'pulse_posts',
  LIKES    : 'pulse_likes',
  REACTIONS: 'pulse_reactions',
  THEME    : 'pulse_theme',
  USER     : 'pulse_user',
};

const POSTS_PER_PAGE = 5;

const AVATAR_COLORS = [
  '#e8410a','#0ea5e9','#8b5cf6','#10b981',
  '#f59e0b','#ec4899','#14b8a6','#6366f1',
];

const EMOJIS = [
  '😊','😂','❤️','🔥','👍','🎉','😍','🤔',
  '😢','😎','🙌','💯','🚀','✨','👏','🤣',
  '😅','🥰','💪','🎊','🌟','💥','🙏','😤',
];

const REACTIONS = ['👍','❤️','😂','😮','😢','🔥'];

/* ── 2. STATE ─────────────────────────────────────────── */

let state = {
  posts         : [],   // array of post objects
  likedPosts    : [],   // array of post IDs
  reactions     : {},   // { postId: { emoji: count } }
  filter        : 'all',
  searchQuery   : '',
  currentPage   : 1,
  editingPostId : null,
  pendingImage  : null, // base64 data-URL
  openDropdown  : null, // postId with open dropdown
};

/* ── 3. LOCAL STORAGE HELPERS ─────────────────────────── */

const storage = {
  get   : (key, fallback = null)  => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set   : (key, value)            => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { showToast('Storage full – some data may not save.', 'error'); } },
  remove: (key)                   => localStorage.removeItem(key),
};

/* ── 4. INITIALISATION ────────────────────────────────── */

function init() {
  loadState();
  applyTheme(storage.get(STORAGE_KEYS.THEME, 'light'));
  restoreUsername();
  renderFeed();
  renderTrending();
  updateStats();
  populateEmojiPicker();
  bindEvents();
}

function loadState() {
  state.posts      = storage.get(STORAGE_KEYS.POSTS,     []);
  state.likedPosts = storage.get(STORAGE_KEYS.LIKES,     []);
  state.reactions  = storage.get(STORAGE_KEYS.REACTIONS, {});
}

function saveState() {
  storage.set(STORAGE_KEYS.POSTS,     state.posts);
  storage.set(STORAGE_KEYS.LIKES,     state.likedPosts);
  storage.set(STORAGE_KEYS.REACTIONS, state.reactions);
}

function restoreUsername() {
  const saved = storage.get(STORAGE_KEYS.USER, '');
  if (saved) qs('#usernameInput').value = saved;
}

/* ── 5. POST CREATION ─────────────────────────────────── */

function createPost() {
  const usernameEl = qs('#usernameInput');
  const contentEl  = qs('#postContent');
  const username   = usernameEl.value.trim();
  const content    = contentEl.value.trim();

  if (!username) { shake(usernameEl); showToast('Please enter your name.', 'error'); return; }
  if (!content && !state.pendingImage) { shake(contentEl); showToast('Post cannot be empty.', 'error'); return; }

  const post = {
    id       : generateId(),
    username,
    content,
    image    : state.pendingImage || null,
    timestamp: Date.now(),
    likes    : 0,
    comments : [],
  };

  state.posts.unshift(post);
  saveState();
  storage.set(STORAGE_KEYS.USER, username);

  // Reset composer
  contentEl.value       = '';
  state.pendingImage    = null;
  updateCharCounter(qs('#charCounter'), 500, 500);
  hideImagePreview();

  state.currentPage = 1;
  renderFeed();
  updateStats();
  renderTrending();
  showToast('Post published! ✦', 'success');

  // Scroll to top of feed
  qs('#feed').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── 6. POST MANIPULATION ─────────────────────────────── */

function deletePost(postId) {
  state.posts      = state.posts.filter(p => p.id !== postId);
  state.likedPosts = state.likedPosts.filter(id => id !== postId);
  delete state.reactions[postId];
  saveState();
  renderFeed();
  updateStats();
  renderTrending();
  showToast('Post deleted.', 'info');
}

function openEditModal(postId) {
  const post = findPost(postId);
  if (!post) return;
  state.editingPostId = postId;

  const modal   = qs('#editModalOverlay');
  const textarea = qs('#editContent');
  textarea.value = post.content;
  updateCharCounter(qs('#editCharCounter'), 500 - post.content.length, 500);
  modal.classList.remove('hidden');
  textarea.focus();
}

function saveEdit() {
  const newContent = qs('#editContent').value.trim();
  if (!newContent) { showToast('Post content cannot be empty.', 'error'); return; }

  const post = findPost(state.editingPostId);
  if (!post) return;
  post.content  = newContent;
  post.edited   = true;
  saveState();
  closeEditModal();
  renderFeed();
  showToast('Post updated!', 'success');
}

function closeEditModal() {
  qs('#editModalOverlay').classList.add('hidden');
  state.editingPostId = null;
}

/* ── 7. LIKES ─────────────────────────────────────────── */

function toggleLike(postId) {
  const post   = findPost(postId);
  const liked  = state.likedPosts.includes(postId);
  const card   = qs(`[data-post-id="${postId}"]`);

  if (liked) {
    state.likedPosts = state.likedPosts.filter(id => id !== postId);
    post.likes = Math.max(0, post.likes - 1);
  } else {
    state.likedPosts.push(postId);
    post.likes++;
    // ripple feedback on card
    if (card) card.classList.add('liked-flash');
    setTimeout(() => card && card.classList.remove('liked-flash'), 400);
  }

  saveState();
  updateLikeBtn(postId, post.likes, !liked);
  updateStats();

  // If filtered to "liked" and just unliked, re-render
  if (state.filter === 'liked' && liked) renderFeed();
}

function updateLikeBtn(postId, count, isLiked) {
  const btn = qs(`[data-post-id="${postId}"] .like-btn`);
  if (!btn) return;
  btn.classList.toggle('liked', isLiked);
  btn.querySelector('.count').textContent = count;
  btn.querySelector('.action-icon').textContent = isLiked ? '♥' : '♡';
}

/* ── 8. REACTIONS ─────────────────────────────────────── */

function toggleReaction(postId, emoji) {
  if (!state.reactions[postId]) state.reactions[postId] = {};
  const r = state.reactions[postId];
  r[emoji] = (r[emoji] || 0) + 1;
  // simple toggle: if count > 2 (spam protection), cap
  saveState();
  rerenderReactionStrip(postId);
}

function rerenderReactionStrip(postId) {
  const card  = qs(`[data-post-id="${postId}"]`);
  const strip = card && card.querySelector('.reaction-strip');
  if (!strip) return;
  strip.innerHTML = buildReactionStrip(postId);
}

/* ── 9. COMMENTS ──────────────────────────────────────── */

function addComment(postId, text) {
  const post   = findPost(postId);
  const author = qs('#usernameInput').value.trim() || 'Anonymous';
  if (!text.trim()) return;

  post.comments.push({
    id       : generateId(),
    author,
    text     : text.trim(),
    timestamp: Date.now(),
  });

  saveState();
  rerenderCommentList(postId);
  updateStats();
}

function rerenderCommentList(postId) {
  const card = qs(`[data-post-id="${postId}"]`);
  if (!card) return;
  const list = card.querySelector('.comments-list');
  if (list) {
    list.innerHTML = buildCommentList(findPost(postId).comments);
  }
  // Update comment count
  const commentBtn = card.querySelector('.comment-btn .count');
  if (commentBtn) commentBtn.textContent = findPost(postId).comments.length;
  updateStats();
}

function toggleCommentSection(postId) {
  const section = qs(`[data-post-id="${postId}"] .comment-section`);
  if (!section) return;
  section.classList.toggle('open');
  if (section.classList.contains('open')) {
    const input = section.querySelector('.comment-input');
    input && input.focus();
  }
}

/* ── 10. RENDERING ────────────────────────────────────── */

function renderFeed() {
  const feed = qs('#feed');
  const filtered = getFilteredPosts();
  const paginated = filtered.slice(0, state.currentPage * POSTS_PER_PAGE);

  feed.innerHTML = '';

  if (filtered.length === 0) {
    show(qs('#emptyState'));
    hide(qs('#loadMoreWrap'));
    return;
  }

  hide(qs('#emptyState'));

  paginated.forEach((post, i) => {
    const el = buildPostCard(post);
    el.style.animationDelay = `${i * 40}ms`;
    feed.appendChild(el);
  });

  // Load more
  if (paginated.length < filtered.length) {
    show(qs('#loadMoreWrap'));
  } else {
    hide(qs('#loadMoreWrap'));
  }
}

function getFilteredPosts() {
  let posts = [...state.posts];

  // Filter tab
  if (state.filter === 'liked') {
    posts = posts.filter(p => state.likedPosts.includes(p.id));
  } else if (state.filter === 'mine') {
    const username = qs('#usernameInput').value.trim();
    if (username) posts = posts.filter(p => p.username.toLowerCase() === username.toLowerCase());
  }

  // Search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    posts = posts.filter(p =>
      p.content.toLowerCase().includes(q) ||
      p.username.toLowerCase().includes(q)
    );
  }

  return posts;
}

function buildPostCard(post) {
  const liked   = state.likedPosts.includes(post.id);
  const color   = avatarColor(post.username);
  const initial = (post.username[0] || '?').toUpperCase();
  const el      = document.createElement('article');
  el.className  = 'post-card';
  el.dataset.postId = post.id;

  el.innerHTML = `
    <div class="post-header">
      <div class="post-avatar" style="background:${color}" aria-hidden="true">${initial}</div>
      <div class="post-meta">
        <div class="post-author">${escHtml(post.username)}</div>
        <div class="post-time">
          <abbr title="${new Date(post.timestamp).toLocaleString()}">${timeAgo(post.timestamp)}</abbr>
          ${post.edited ? '<span class="edited-badge"> · edited</span>' : ''}
        </div>
      </div>
      <div class="post-options">
        <button class="options-btn" data-action="options" title="Post options" aria-label="Post options" aria-haspopup="true">···</button>
        <div class="options-dropdown hidden" data-dropdown="${post.id}">
          <button class="dropdown-item" data-action="edit" data-id="${post.id}">✏ Edit post</button>
          <button class="dropdown-item" data-action="copy" data-id="${post.id}">⎘ Copy text</button>
          <button class="dropdown-item delete" data-action="delete" data-id="${post.id}">✕ Delete</button>
        </div>
      </div>
    </div>

    <div class="post-body">
      <p class="post-text">${linkify(escHtml(post.content))}</p>
    </div>

    ${post.image ? `
      <div class="post-image">
        <img src="${post.image}" alt="Post image" loading="lazy" />
      </div>` : ''}

    <div class="reaction-strip">
      ${buildReactionStrip(post.id)}
    </div>

    <div class="post-actions">
      <button class="action-btn like-btn ${liked ? 'liked' : ''}" data-action="like" data-id="${post.id}" aria-label="Like post" aria-pressed="${liked}">
        <span class="action-icon">${liked ? '♥' : '♡'}</span>
        <span class="count">${post.likes}</span>
      </button>
      <button class="action-btn comment-btn" data-action="comment-toggle" data-id="${post.id}" aria-label="Comment on post" aria-expanded="false">
        <span class="action-icon">💬</span>
        <span class="count">${post.comments.length}</span>
      </button>
      <button class="action-btn share" data-action="share" data-id="${post.id}" aria-label="Share post">
        <span class="action-icon">↗</span>
        <span>Share</span>
      </button>
    </div>

    <div class="comment-section" data-comments-id="${post.id}">
      <div class="comments-list">
        ${buildCommentList(post.comments)}
      </div>
      <div class="comment-composer">
        <input
          type="text"
          class="comment-input"
          placeholder="Write a comment…"
          maxlength="300"
          data-comment-post="${post.id}"
          aria-label="Write a comment"
        />
        <button class="comment-send" data-action="comment-send" data-id="${post.id}" aria-label="Send comment">→</button>
      </div>
    </div>
  `;

  // Double-click to edit
  el.querySelector('.post-body').addEventListener('dblclick', () => openEditModal(post.id));

  return el;
}

function buildReactionStrip(postId) {
  const r = state.reactions[postId] || {};
  return REACTIONS.map(emoji => {
    const count = r[emoji] || 0;
    return `
      <button class="reaction-chip ${count > 0 ? 'active' : ''}" data-action="react" data-id="${postId}" data-emoji="${emoji}" title="React with ${emoji}" aria-label="React with ${emoji}">
        ${emoji}${count > 0 ? `<span class="count">${count}</span>` : ''}
      </button>`;
  }).join('');
}

function buildCommentList(comments) {
  if (!comments.length) return '';
  return comments.map(c => {
    const color   = avatarColor(c.author);
    const initial = (c.author[0] || '?').toUpperCase();
    return `
      <div class="comment-item">
        <div class="comment-avatar" style="background:${color}" aria-hidden="true">${initial}</div>
        <div class="comment-bubble">
          <div class="comment-author">${escHtml(c.author)}</div>
          <div class="comment-text">${escHtml(c.text)}</div>
          <div class="comment-time">${timeAgo(c.timestamp)}</div>
        </div>
      </div>`;
  }).join('');
}

function renderTrending() {
  const el = qs('#trendingList');
  if (!el) return;

  // Extract words from all posts and count frequency
  const freq = {};
  state.posts.forEach(p => {
    p.content.split(/\s+/).forEach(w => {
      const clean = w.replace(/[^a-zA-Z0-9#@]/g, '').toLowerCase();
      if (clean.length > 3) freq[clean] = (freq[clean] || 0) + 1;
    });
  });

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!sorted.length) {
    el.innerHTML = '<li style="padding:0 0 8px;font-size:13px;color:var(--text-muted)">No trending topics yet.</li>';
    return;
  }

  el.innerHTML = sorted.map(([word, count], i) => `
    <li class="trending-item" data-word="${escHtml(word)}">
      <span class="trending-rank">${i + 1}</span>
      <span class="trending-word">${escHtml(word)}</span>
      <span class="trending-count">${count}</span>
    </li>
  `).join('');
}

function updateStats() {
  const totalLikes    = state.posts.reduce((a, p) => a + p.likes, 0);
  const totalComments = state.posts.reduce((a, p) => a + p.comments.length, 0);

  animateNum(qs('#statPosts'),    state.posts.length);
  animateNum(qs('#statLikes'),    totalLikes);
  animateNum(qs('#statComments'), totalComments);
}

function animateNum(el, newVal) {
  if (!el) return;
  if (el.textContent !== String(newVal)) {
    el.textContent = newVal;
    el.classList.remove('bump');
    void el.offsetWidth; // reflow
    el.classList.add('bump');
  }
}

/* ── 11. EMOJI PICKER ─────────────────────────────────── */

function populateEmojiPicker() {
  const grid = qs('#emojiGrid');
  grid.innerHTML = EMOJIS.map(e =>
    `<button class="emoji-btn" data-emoji="${e}" title="${e}" aria-label="Insert ${e}">${e}</button>`
  ).join('');
}

/* ── 12. IMAGE UPLOAD ─────────────────────────────────── */

function handleImageUpload(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please select a valid image.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image must be under 5MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    state.pendingImage = e.target.result;
    qs('#imagePreview').src = e.target.result;
    show(qs('#imagePreviewWrap'));
    showToast('Image attached!', 'success');
  };
  reader.readAsDataURL(file);
}

function hideImagePreview() {
  qs('#imagePreviewWrap').classList.add('hidden');
  qs('#imagePreview').src = '';
  qs('#imageUpload').value = '';
  state.pendingImage = null;
}

/* ── 13. THEME ────────────────────────────────────────── */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storage.set(STORAGE_KEYS.THEME, theme);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ── 14. SEARCH ───────────────────────────────────────── */

let searchDebounce = null;
function handleSearch(query) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.searchQuery = query.trim();
    state.currentPage = 1;
    renderFeed();
  }, 250);
}

/* ── 15. FILTER ───────────────────────────────────────── */

function setFilter(filter) {
  state.filter      = filter;
  state.currentPage = 1;

  // sync all filter buttons (sidebar + mobile bar)
  qsa('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  renderFeed();
}

/* ── 16. EVENT BINDING ─────────────────────────────────── */

function bindEvents() {

  /* Publish */
  qs('#postBtn').addEventListener('click', createPost);

  /* Ctrl+Enter to publish */
  qs('#postContent').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') createPost();
  });

  /* Char counter – composer */
  qs('#postContent').addEventListener('input', e => {
    const remaining = 500 - e.target.value.length;
    updateCharCounter(qs('#charCounter'), remaining, 500);
  });

  /* Char counter – edit modal */
  qs('#editContent').addEventListener('input', e => {
    const remaining = 500 - e.target.value.length;
    updateCharCounter(qs('#editCharCounter'), remaining, 500);
  });

  /* Theme toggle */
  qs('#themeToggle').addEventListener('click', toggleTheme);

  /* Search */
  qs('#searchInput').addEventListener('input', e => handleSearch(e.target.value));

  /* Filter buttons (ALL .filter-btn including mobile bar) */
  document.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (btn && btn.dataset.filter) setFilter(btn.dataset.filter);
  });

  /* Image upload */
  qs('#imageUpload').addEventListener('change', e => {
    if (e.target.files[0]) handleImageUpload(e.target.files[0]);
  });

  /* Remove image */
  qs('#removeImage').addEventListener('click', hideImagePreview);

  /* Emoji toggle */
  qs('#emojiBtn').addEventListener('click', e => {
    e.stopPropagation();
    qs('#emojiPicker').classList.toggle('hidden');
  });

  /* Emoji selection */
  qs('#emojiGrid').addEventListener('click', e => {
    const btn = e.target.closest('.emoji-btn');
    if (!btn) return;
    const ta  = qs('#postContent');
    const pos = ta.selectionStart;
    const val = ta.value;
    ta.value  = val.slice(0, pos) + btn.dataset.emoji + val.slice(pos);
    ta.focus();
    const newPos = pos + btn.dataset.emoji.length;
    ta.setSelectionRange(newPos, newPos);
    updateCharCounter(qs('#charCounter'), 500 - ta.value.length, 500);
    qs('#emojiPicker').classList.add('hidden');
  });

  /* Close emoji picker on outside click */
  document.addEventListener('click', e => {
    if (!e.target.closest('#emojiBtn') && !e.target.closest('#emojiPicker')) {
      qs('#emojiPicker').classList.add('hidden');
    }
  });

  /* Edit modal controls */
  qs('#closeEditModal').addEventListener('click', closeEditModal);
  qs('#cancelEdit').addEventListener('click', closeEditModal);
  qs('#saveEdit').addEventListener('click', saveEdit);
  qs('#editModalOverlay').addEventListener('click', e => {
    if (e.target === qs('#editModalOverlay')) closeEditModal();
  });

  /* Load more */
  qs('#loadMoreBtn').addEventListener('click', () => {
    state.currentPage++;
    renderFeed();
  });

  /* Drag & drop image onto composer */
  const composer = qs('.composer');
  composer.addEventListener('dragover', e => { e.preventDefault(); composer.style.outline = '2px dashed var(--accent)'; });
  composer.addEventListener('dragleave', ()=> { composer.style.outline = ''; });
  composer.addEventListener('drop', e => {
    e.preventDefault();
    composer.style.outline = '';
    const file = e.dataTransfer.files[0];
    if (file) handleImageUpload(file);
  });

  /* ── EVENT DELEGATION on #feed ── */
  qs('#feed').addEventListener('click', handleFeedClick);
  qs('#feed').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const sendBtn = e.target.closest('[data-action="comment-send"]');
      if (sendBtn) handleFeedClick(e);
    }
  });

  /* Trending click → search */
  qs('#trendingList').addEventListener('click', e => {
    const item = e.target.closest('.trending-item');
    if (!item) return;
    const word = item.dataset.word;
    qs('#searchInput').value = word;
    handleSearch(word);
  });

  /* Close dropdowns on outside click */
  document.addEventListener('click', e => {
    if (!e.target.closest('.post-options')) closeAllDropdowns();
  });

  /* Escape key */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
      closeEditModal();
      qs('#emojiPicker').classList.add('hidden');
    }
  });
}

/* ── 17. FEED EVENT HANDLER ──────────────────────────── */

function handleFeedClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const postId = target.dataset.id;

  switch (action) {
    case 'like':
      toggleLike(postId);
      break;

    case 'comment-toggle': {
      toggleCommentSection(postId);
      const expanded = qs(`[data-post-id="${postId}"] .comment-section`).classList.contains('open');
      target.setAttribute('aria-expanded', expanded);
      break;
    }

    case 'comment-send': {
      const section = qs(`[data-post-id="${postId}"] .comment-section`);
      const input   = section.querySelector('.comment-input');
      if (!input.value.trim()) { shake(input); return; }
      addComment(postId, input.value);
      input.value = '';
      break;
    }

    case 'react':
      toggleReaction(postId, target.dataset.emoji);
      break;

    case 'options':
      toggleDropdown(postId, target);
      break;

    case 'edit':
      closeAllDropdowns();
      openEditModal(postId);
      break;

    case 'delete':
      closeAllDropdowns();
      if (confirm('Delete this post? This cannot be undone.')) deletePost(postId);
      break;

    case 'copy': {
      closeAllDropdowns();
      const post = findPost(postId);
      if (!post) break;
      navigator.clipboard.writeText(post.content)
        .then(() => showToast('Text copied!', 'success'))
        .catch(() => showToast('Could not copy.', 'error'));
      break;
    }

    case 'share': {
      const post = findPost(postId);
      if (!post) break;
      const text = `${post.username} on Pulse:\n\n${post.content}`;
      if (navigator.share) {
        navigator.share({ title: 'Pulse post', text }).catch(() => {});
      } else {
        navigator.clipboard.writeText(text)
          .then(() => showToast('Link copied to clipboard!', 'success'))
          .catch(() => showToast('Share not supported.', 'error'));
      }
      break;
    }
  }
}

/* ── 18. DROPDOWN ─────────────────────────────────────── */

function toggleDropdown(postId, triggerBtn) {
  const dropdown = qs(`[data-dropdown="${postId}"]`);
  if (!dropdown) return;

  const isOpen = !dropdown.classList.contains('hidden');
  closeAllDropdowns();
  if (!isOpen) {
    dropdown.classList.remove('hidden');
    state.openDropdown = postId;
    triggerBtn.setAttribute('aria-expanded', 'true');
  }
}

function closeAllDropdowns() {
  qsa('.options-dropdown').forEach(d => d.classList.add('hidden'));
  qsa('.options-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  state.openDropdown = null;
}

/* ── 19. TOAST NOTIFICATIONS ─────────────────────────── */

function showToast(message, type = 'info') {
  const container = qs('#toastContainer');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon"></span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 3200);
}

/* ── 20. UTILITIES ───────────────────────────────────── */

function qs(sel, root = document)   { return root.querySelector(sel); }
function qsa(sel, root = document)  { return [...root.querySelectorAll(sel)]; }
function show(el)                   { el && el.classList.remove('hidden'); }
function hide(el)                   { el && el.classList.add('hidden'); }
function findPost(id)               { return state.posts.find(p => p.id === id); }
function generateId()               { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function avatarColor(name = '')     { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkify(text) {
  return text.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function updateCharCounter(el, remaining, max) {
  if (!el) return;
  el.textContent = remaining;
  el.classList.toggle('warning', remaining < max * 0.2 && remaining >= max * 0.1);
  el.classList.toggle('danger',  remaining < max * 0.1);
}

function shake(el) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = 'shake 400ms ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

/* Inject shake keyframes dynamically */
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }`;
document.head.appendChild(shakeStyle);

/* ── 21. START ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);