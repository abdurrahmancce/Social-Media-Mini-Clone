/**
 * =========================================================
 *  PULSE — Social Media Mini Clone  |  script.js
 *
 *  Architecture:
 *   • State object  — single source of truth
 *   • localStorage  — persistence layer (JSON)
 *   • Event delegation on #feed for all post interactions
 *   • Dedicated delete flow: dropdown → confirmation modal
 *     → animated card removal → localStorage cleanup
 * =========================================================
 */

'use strict';

/* ─────────────────────────────────────────────────────────
   1.  CONSTANTS
───────────────────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────────────────
   2.  STATE
───────────────────────────────────────────────────────── */

const state = {
  posts          : [],   // Array of post objects
  likedPosts     : [],   // Array of liked post IDs
  reactions      : {},   // { postId: { emoji: count } }
  filter         : 'all',
  searchQuery    : '',
  currentPage    : 1,
  editingPostId  : null,
  deletingPostId : null, // ID queued for delete confirmation
  pendingImage   : null, // base64 data-URL of attached image
  openDropdown   : null, // postId whose dropdown is open
};

/* ─────────────────────────────────────────────────────────
   3.  LOCAL STORAGE HELPERS
───────────────────────────────────────────────────────── */

const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      showToast('Storage is full — some data may not save.', 'error');
    }
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};

/* ─────────────────────────────────────────────────────────
   4.  BOOTSTRAP
───────────────────────────────────────────────────────── */

function init() {
  loadState();
  applyTheme(storage.get(STORAGE_KEYS.THEME, 'light'));
  restoreUsername();
  populateEmojiPicker();
  bindGlobalEvents();
  renderFeed();
  renderTrending();
  updateStats();
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

/* ─────────────────────────────────────────────────────────
   5.  CREATE POST
───────────────────────────────────────────────────────── */

function createPost() {
  const usernameEl = qs('#usernameInput');
  const contentEl  = qs('#postContent');
  const username   = usernameEl.value.trim();
  const content    = contentEl.value.trim();

  // Validation
  if (!username) {
    shakeElement(usernameEl);
    showToast('Please enter your name.', 'error');
    usernameEl.focus();
    return;
  }
  if (!content && !state.pendingImage) {
    shakeElement(contentEl);
    showToast("Post can't be empty.", 'error');
    contentEl.focus();
    return;
  }

  const post = {
    id       : generateId(),
    username,
    content,
    image    : state.pendingImage || null,
    timestamp: Date.now(),
    likes    : 0,
    comments : [],
    edited   : false,
  };

  state.posts.unshift(post);
  saveState();
  storage.set(STORAGE_KEYS.USER, username); // remember name

  // Reset composer
  contentEl.value = '';
  state.pendingImage = null;
  updateCharCounter(qs('#charCounter'), 500, 500);
  hideImagePreview();
  qs('#emojiPicker').classList.add('hidden');

  state.currentPage = 1;
  renderFeed();
  updateStats();
  renderTrending();
  showToast('Post published! ✦', 'success');

  qs('#feed').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ─────────────────────────────────────────────────────────
   6.  DELETE POST  (full working flow)
       Step 1 — dropdown "Delete" → openDeleteModal(postId)
       Step 2 — modal "Yes, delete" → confirmDelete()
       Step 3 — animate card out → removePostFromDom()
       Step 4 — purge from state + localStorage
───────────────────────────────────────────────────────── */

/**
 * Step 1: Store the postId and show the confirmation modal.
 */
function openDeleteModal(postId) {
  state.deletingPostId = postId;
  const overlay = qs('#deleteModalOverlay');
  overlay.classList.remove('hidden');
  // Focus the "Keep it" button first (safer default)
  setTimeout(() => qs('#cancelDelete').focus(), 50);
}

/**
 * Step 2: Called by the "Yes, delete" button.
 * Closes the modal, animates the card out, then purges data.
 */
function confirmDelete() {
  const postId = state.deletingPostId;
  if (!postId) return;

  closeDeleteModal();

  const card = qs(`[data-post-id="${postId}"]`);
  if (card) {
    // Step 3: play exit animation, then remove from DOM + state
    card.classList.add('deleting');
    card.addEventListener('animationend', () => {
      removePostData(postId);  // Step 4
    }, { once: true });
  } else {
    // Card not currently rendered (filtered out) — delete silently
    removePostData(postId);
  }
}

/**
 * Step 4: Purge from state arrays + localStorage, then re-render.
 */
function removePostData(postId) {
  // Remove from posts array
  state.posts = state.posts.filter(p => p.id !== postId);
  // Remove from liked list
  state.likedPosts = state.likedPosts.filter(id => id !== postId);
  // Remove reactions object
  delete state.reactions[postId];

  // Persist to localStorage immediately
  saveState();

  // Reset tracking
  state.deletingPostId = null;

  // Refresh UI
  renderFeed();
  updateStats();
  renderTrending();

  showToast('Post deleted.', 'info');
}

function closeDeleteModal() {
  qs('#deleteModalOverlay').classList.add('hidden');
  state.deletingPostId = null;
}

/* ─────────────────────────────────────────────────────────
   7.  EDIT POST
───────────────────────────────────────────────────────── */

function openEditModal(postId) {
  const post = findPost(postId);
  if (!post) return;
  state.editingPostId = postId;

  const textarea = qs('#editContent');
  textarea.value = post.content;
  updateCharCounter(qs('#editCharCounter'), 500 - post.content.length, 500);
  qs('#editModalOverlay').classList.remove('hidden');
  textarea.focus();
}

function saveEdit() {
  const newContent = qs('#editContent').value.trim();
  if (!newContent) {
    shakeElement(qs('#editContent'));
    showToast('Post content cannot be empty.', 'error');
    return;
  }
  const post = findPost(state.editingPostId);
  if (!post) return;

  post.content = newContent;
  post.edited  = true;
  saveState();
  closeEditModal();
  renderFeed();
  showToast('Post updated!', 'success');
}

function closeEditModal() {
  qs('#editModalOverlay').classList.add('hidden');
  state.editingPostId = null;
}

/* ─────────────────────────────────────────────────────────
   8.  LIKES
───────────────────────────────────────────────────────── */

function toggleLike(postId) {
  const post  = findPost(postId);
  if (!post) return;
  const liked = state.likedPosts.includes(postId);

  if (liked) {
    state.likedPosts = state.likedPosts.filter(id => id !== postId);
    post.likes = Math.max(0, post.likes - 1);
  } else {
    state.likedPosts.push(postId);
    post.likes++;
  }

  saveState();
  refreshLikeButton(postId, post.likes, !liked);
  updateStats();

  // Re-render if "Liked" filter is active and user just un-liked
  if (state.filter === 'liked' && liked) renderFeed();
}

function refreshLikeButton(postId, count, isLiked) {
  const btn = qs(`[data-post-id="${postId}"] .like-btn`);
  if (!btn) return;
  btn.classList.toggle('liked', isLiked);
  btn.setAttribute('aria-pressed', String(isLiked));
  btn.querySelector('.count').textContent = count;
  btn.querySelector('.action-icon').textContent = isLiked ? '♥' : '♡';
}

/* ─────────────────────────────────────────────────────────
   9.  REACTIONS
───────────────────────────────────────────────────────── */

function toggleReaction(postId, emoji) {
  if (!state.reactions[postId]) state.reactions[postId] = {};
  const r = state.reactions[postId];
  r[emoji] = (r[emoji] || 0) + 1;
  saveState();
  refreshReactionStrip(postId);
}

function refreshReactionStrip(postId) {
  const card  = qs(`[data-post-id="${postId}"]`);
  const strip = card && card.querySelector('.reaction-strip');
  if (strip) strip.innerHTML = buildReactionStrip(postId);
}

/* ─────────────────────────────────────────────────────────
   10.  COMMENTS
───────────────────────────────────────────────────────── */

function addComment(postId, text) {
  const post   = findPost(postId);
  if (!post || !text.trim()) return;

  const author = qs('#usernameInput').value.trim() || 'Anonymous';
  post.comments.push({
    id       : generateId(),
    author,
    text     : text.trim(),
    timestamp: Date.now(),
  });

  saveState();
  refreshCommentList(postId);
  updateStats();
}

function refreshCommentList(postId) {
  const card = qs(`[data-post-id="${postId}"]`);
  if (!card) return;

  const list = card.querySelector('.comments-list');
  if (list) list.innerHTML = buildCommentList(findPost(postId).comments);

  const countEl = card.querySelector('.comment-btn .count');
  if (countEl) countEl.textContent = findPost(postId).comments.length;
}

function toggleCommentSection(postId) {
  const section = qs(`[data-post-id="${postId}"] .comment-section`);
  if (!section) return;
  section.classList.toggle('open');
  if (section.classList.contains('open')) {
    section.querySelector('.comment-input')?.focus();
  }
}

/* ─────────────────────────────────────────────────────────
   11.  RENDER — FEED
───────────────────────────────────────────────────────── */

function renderFeed() {
  const feed     = qs('#feed');
  const filtered = getFilteredPosts();
  const page     = filtered.slice(0, state.currentPage * POSTS_PER_PAGE);

  feed.innerHTML = '';

  if (filtered.length === 0) {
    show(qs('#emptyState'));
    hide(qs('#loadMoreWrap'));
    return;
  }

  hide(qs('#emptyState'));

  page.forEach((post, i) => {
    const el = buildPostCard(post);
    el.style.animationDelay = `${i * 40}ms`;
    feed.appendChild(el);
  });

  if (page.length < filtered.length) {
    show(qs('#loadMoreWrap'));
  } else {
    hide(qs('#loadMoreWrap'));
  }
}

function getFilteredPosts() {
  let posts = [...state.posts];

  if (state.filter === 'liked') {
    posts = posts.filter(p => state.likedPosts.includes(p.id));
  } else if (state.filter === 'mine') {
    const username = qs('#usernameInput').value.trim().toLowerCase();
    if (username) posts = posts.filter(p => p.username.toLowerCase() === username);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    posts = posts.filter(p =>
      p.content.toLowerCase().includes(q) ||
      p.username.toLowerCase().includes(q)
    );
  }

  return posts;
}

/* ─────────────────────────────────────────────────────────
   12.  BUILD POST CARD HTML
───────────────────────────────────────────────────────── */

function buildPostCard(post) {
  const liked   = state.likedPosts.includes(post.id);
  const color   = avatarColor(post.username);
  const initial = (post.username[0] || '?').toUpperCase();

  const el      = document.createElement('article');
  el.className  = 'post-card';
  el.setAttribute('data-post-id', post.id);
  el.setAttribute('role', 'article');

  el.innerHTML = `
    <!-- Header -->
    <div class="post-header">
      <div class="post-avatar" style="background:${color}" aria-hidden="true">${initial}</div>
      <div class="post-meta">
        <div class="post-author">${escHtml(post.username)}</div>
        <div class="post-time">
          <abbr title="${new Date(post.timestamp).toLocaleString()}">${timeAgo(post.timestamp)}</abbr>
          ${post.edited ? '<span class="edited-badge"> · edited</span>' : ''}
        </div>
      </div>

      <!-- 3-dot options menu -->
      <div class="post-options">
        <button
          class="options-btn"
          data-action="options"
          data-id="${post.id}"
          aria-label="Post options"
          aria-haspopup="true"
          aria-expanded="false"
          title="More options"
        >···</button>

        <div class="options-dropdown hidden" data-dropdown="${post.id}" role="menu">
          <button class="dropdown-item" role="menuitem" data-action="edit"   data-id="${post.id}">✏ Edit post</button>
          <button class="dropdown-item" role="menuitem" data-action="copy"   data-id="${post.id}">⎘ Copy text</button>
          <button class="dropdown-item" role="menuitem" data-action="share"  data-id="${post.id}">↗ Share</button>
          <button class="dropdown-item delete" role="menuitem" data-action="delete" data-id="${post.id}">🗑 Delete post</button>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div class="post-body" title="Double-click to edit">
      <p class="post-text">${linkify(escHtml(post.content))}</p>
    </div>

    ${post.image ? `
    <div class="post-image">
      <img src="${post.image}" alt="Post image" loading="lazy" />
    </div>` : ''}

    <!-- Reaction strip -->
    <div class="reaction-strip">${buildReactionStrip(post.id)}</div>

    <!-- Action bar -->
    <div class="post-actions">
      <button
        class="action-btn like-btn ${liked ? 'liked' : ''}"
        data-action="like"
        data-id="${post.id}"
        aria-label="${liked ? 'Unlike post' : 'Like post'}"
        aria-pressed="${liked}"
      >
        <span class="action-icon">${liked ? '♥' : '♡'}</span>
        <span class="count">${post.likes}</span>
      </button>

      <button
        class="action-btn comment-btn"
        data-action="comment-toggle"
        data-id="${post.id}"
        aria-label="Toggle comments"
        aria-expanded="false"
      >
        <span class="action-icon">💬</span>
        <span class="count">${post.comments.length}</span>
      </button>

      <button
        class="action-btn share"
        data-action="share"
        data-id="${post.id}"
        aria-label="Share post"
      >
        <span class="action-icon">↗</span>
        <span>Share</span>
      </button>
    </div>

    <!-- Comment section (hidden by default) -->
    <div class="comment-section" data-comments-id="${post.id}">
      <div class="comments-list">${buildCommentList(post.comments)}</div>
      <div class="comment-composer">
        <input
          type="text"
          class="comment-input"
          placeholder="Write a comment…"
          maxlength="300"
          data-comment-post="${post.id}"
          aria-label="Write a comment"
        />
        <button
          class="comment-send"
          data-action="comment-send"
          data-id="${post.id}"
          aria-label="Post comment"
        >→</button>
      </div>
    </div>
  `;

  // Double-click on post body to edit
  el.querySelector('.post-body').addEventListener('dblclick', () => {
    openEditModal(post.id);
  });

  return el;
}

/* ─────────────────────────────────────────────────────────
   13.  BUILD HELPERS (reactions, comments)
───────────────────────────────────────────────────────── */

function buildReactionStrip(postId) {
  const r = state.reactions[postId] || {};
  return REACTIONS.map(emoji => {
    const count = r[emoji] || 0;
    return `
      <button
        class="reaction-chip ${count > 0 ? 'active' : ''}"
        data-action="react"
        data-id="${postId}"
        data-emoji="${emoji}"
        title="React with ${emoji}"
        aria-label="React with ${emoji}"
      >${emoji}${count > 0 ? `<span class="count">${count}</span>` : ''}</button>
    `;
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
      </div>
    `;
  }).join('');
}

/* ─────────────────────────────────────────────────────────
   14.  TRENDING + STATS
───────────────────────────────────────────────────────── */

function renderTrending() {
  const el = qs('#trendingList');
  if (!el) return;

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
  animateStatNum(qs('#statPosts'),    state.posts.length);
  animateStatNum(qs('#statLikes'),    totalLikes);
  animateStatNum(qs('#statComments'), totalComments);
}

function animateStatNum(el, newVal) {
  if (!el) return;
  if (el.textContent !== String(newVal)) {
    el.textContent = newVal;
    el.classList.remove('bump');
    void el.offsetWidth; // force reflow
    el.classList.add('bump');
  }
}

/* ─────────────────────────────────────────────────────────
   15.  EMOJI PICKER
───────────────────────────────────────────────────────── */

function populateEmojiPicker() {
  qs('#emojiGrid').innerHTML = EMOJIS.map(e =>
    `<button class="emoji-btn" data-emoji="${e}" title="${e}" aria-label="Insert ${e}">${e}</button>`
  ).join('');
}

/* ─────────────────────────────────────────────────────────
   16.  IMAGE UPLOAD
───────────────────────────────────────────────────────── */

function handleImageUpload(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please select a valid image file.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image must be smaller than 5 MB.', 'error');
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

/* ─────────────────────────────────────────────────────────
   17.  THEME
───────────────────────────────────────────────────────── */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storage.set(STORAGE_KEYS.THEME, theme);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ─────────────────────────────────────────────────────────
   18.  SEARCH + FILTER
───────────────────────────────────────────────────────── */

let searchTimer = null;
function handleSearch(query) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = query.trim();
    state.currentPage = 1;
    renderFeed();
  }, 260);
}

function setFilter(filter) {
  state.filter      = filter;
  state.currentPage = 1;
  qsa('.filter-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.filter === filter)
  );
  renderFeed();
}

/* ─────────────────────────────────────────────────────────
   19.  DROPDOWN (3-dot menu)
───────────────────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────────────────
   20.  EVENT DELEGATION — feed clicks
───────────────────────────────────────────────────────── */

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
      const isOpen = qs(`[data-post-id="${postId}"] .comment-section`).classList.contains('open');
      target.setAttribute('aria-expanded', String(isOpen));
      break;
    }

    case 'comment-send': {
      const section = qs(`[data-post-id="${postId}"] .comment-section`);
      const input   = section.querySelector('.comment-input');
      if (!input.value.trim()) { shakeElement(input); return; }
      addComment(postId, input.value);
      input.value = '';
      break;
    }

    case 'react':
      toggleReaction(postId, target.dataset.emoji);
      break;

    case 'options':
      e.stopPropagation();
      toggleDropdown(postId, target);
      break;

    case 'edit':
      closeAllDropdowns();
      openEditModal(postId);
      break;

    /* ── DELETE: open confirmation modal ── */
    case 'delete':
      closeAllDropdowns();
      openDeleteModal(postId);   // <-- shows the delete confirmation modal
      break;

    case 'copy': {
      closeAllDropdowns();
      const post = findPost(postId);
      if (!post) break;
      navigator.clipboard.writeText(post.content)
        .then(() => showToast('Text copied to clipboard!', 'success'))
        .catch(() => showToast('Could not copy text.', 'error'));
      break;
    }

    case 'share': {
      closeAllDropdowns();
      const post = findPost(postId);
      if (!post) break;
      const text = `${post.username} on Pulse:\n\n${post.content}`;
      if (navigator.share) {
        navigator.share({ title: 'Pulse post', text }).catch(() => {});
      } else {
        navigator.clipboard.writeText(text)
          .then(() => showToast('Post link copied!', 'success'))
          .catch(() => showToast('Share not available.', 'error'));
      }
      break;
    }
  }
}

/* Enter key on comment input triggers send */
function handleFeedKeydown(e) {
  if (e.key !== 'Enter') return;
  const input = e.target.closest('.comment-input');
  if (!input) return;
  const postId = input.dataset.commentPost;
  if (!input.value.trim()) { shakeElement(input); return; }
  addComment(postId, input.value);
  input.value = '';
}

/* ─────────────────────────────────────────────────────────
   21.  GLOBAL EVENT BINDING
───────────────────────────────────────────────────────── */

function bindGlobalEvents() {

  /* Publish button */
  qs('#postBtn').addEventListener('click', createPost);

  /* Ctrl+Enter to publish */
  qs('#postContent').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') createPost();
  });

  /* Char counter — composer */
  qs('#postContent').addEventListener('input', e => {
    updateCharCounter(qs('#charCounter'), 500 - e.target.value.length, 500);
  });

  /* Char counter — edit modal */
  qs('#editContent').addEventListener('input', e => {
    updateCharCounter(qs('#editCharCounter'), 500 - e.target.value.length, 500);
  });

  /* Theme */
  qs('#themeToggle').addEventListener('click', toggleTheme);

  /* Search */
  qs('#searchInput').addEventListener('input', e => handleSearch(e.target.value));

  /* Filter buttons (sidebar + mobile) */
  document.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (btn && btn.dataset.filter) setFilter(btn.dataset.filter);
  });

  /* Image upload */
  qs('#imageUpload').addEventListener('change', e => {
    if (e.target.files[0]) handleImageUpload(e.target.files[0]);
  });

  /* Remove attached image */
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
    ta.value  = ta.value.slice(0, pos) + btn.dataset.emoji + ta.value.slice(pos);
    ta.focus();
    const newPos = pos + btn.dataset.emoji.length;
    ta.setSelectionRange(newPos, newPos);
    updateCharCounter(qs('#charCounter'), 500 - ta.value.length, 500);
    qs('#emojiPicker').classList.add('hidden');
  });

  /* Feed delegation */
  qs('#feed').addEventListener('click',   handleFeedClick);
  qs('#feed').addEventListener('keydown', handleFeedKeydown);

  /* ── EDIT MODAL ── */
  qs('#closeEditModal').addEventListener('click', closeEditModal);
  qs('#cancelEdit').addEventListener('click', closeEditModal);
  qs('#saveEdit').addEventListener('click', saveEdit);
  qs('#editModalOverlay').addEventListener('click', e => {
    if (e.target === qs('#editModalOverlay')) closeEditModal();
  });

  /* ── DELETE CONFIRMATION MODAL ── */
  qs('#closeDeleteModal').addEventListener('click', closeDeleteModal);
  qs('#cancelDelete').addEventListener('click', closeDeleteModal);
  qs('#confirmDelete').addEventListener('click', confirmDelete);   // ← the real delete
  qs('#deleteModalOverlay').addEventListener('click', e => {
    if (e.target === qs('#deleteModalOverlay')) closeDeleteModal();
  });

  /* Load more */
  qs('#loadMoreBtn').addEventListener('click', () => {
    state.currentPage++;
    renderFeed();
  });

  /* Drag & drop image onto composer */
  const composer = qs('.composer');
  composer.addEventListener('dragover', e => {
    e.preventDefault();
    composer.style.outline = '2px dashed var(--accent)';
  });
  composer.addEventListener('dragleave', () => { composer.style.outline = ''; });
  composer.addEventListener('drop', e => {
    e.preventDefault();
    composer.style.outline = '';
    const file = e.dataTransfer.files[0];
    if (file) handleImageUpload(file);
  });

  /* Close dropdowns / emoji picker on outside click */
  document.addEventListener('click', e => {
    if (!e.target.closest('.post-options')) closeAllDropdowns();
    if (!e.target.closest('#emojiBtn') && !e.target.closest('#emojiPicker')) {
      qs('#emojiPicker').classList.add('hidden');
    }
  });

  /* Escape key — close modals, dropdowns, picker */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
      closeEditModal();
      closeDeleteModal();
      qs('#emojiPicker').classList.add('hidden');
    }
  });

  /* Trending click → fill search */
  qs('#trendingList').addEventListener('click', e => {
    const item = e.target.closest('.trending-item');
    if (!item) return;
    const word = item.dataset.word;
    qs('#searchInput').value = word;
    handleSearch(word);
  });
}

/* ─────────────────────────────────────────────────────────
   22.  TOAST NOTIFICATIONS
───────────────────────────────────────────────────────── */

function showToast(message, type = 'info') {
  const container = qs('#toastContainer');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 3000);
}

/* ─────────────────────────────────────────────────────────
   23.  UTILITY FUNCTIONS
───────────────────────────────────────────────────────── */

/** querySelector shorthand */
function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** querySelectorAll → Array */
function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

/** Show an element (removes .hidden) */
function show(el) { el && el.classList.remove('hidden'); }

/** Hide an element (adds .hidden) */
function hide(el) { el && el.classList.add('hidden'); }

/** Find a post in state by ID */
function findPost(id) {
  return state.posts.find(p => p.id === id) || null;
}

/** Generate a reasonably unique ID */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Deterministic avatar colour from username string */
function avatarColor(name = '') {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Escape HTML special chars to prevent XSS */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap URLs in anchor tags */
function linkify(text) {
  return text.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

/** Human-readable relative time */
function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Update character counter colour + value */
function updateCharCounter(el, remaining, max) {
  if (!el) return;
  el.textContent = remaining;
  el.classList.toggle('warning', remaining < max * 0.2 && remaining >= max * 0.1);
  el.classList.toggle('danger',  remaining < max * 0.1);
}

/** Shake animation for validation feedback */
function shakeElement(el) {
  if (!el) return;
  el.style.animation = 'none';
  void el.offsetWidth; // reflow
  el.style.animation = 'shake 380ms ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

/* Inject shake keyframes once */
const _shakeStyle = document.createElement('style');
_shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20%,60%  { transform: translateX(-6px); }
    40%,80%  { transform: translateX(6px); }
  }
`;
document.head.appendChild(_shakeStyle);

/* ─────────────────────────────────────────────────────────
   24.  START
───────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', init);