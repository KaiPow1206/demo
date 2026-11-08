/* =========================================================
   Hoa Viên — main.js
   Dữ liệu, bộ lọc, lightbox và các lớp hiệu ứng khu vườn.
   ========================================================= */

const API_URL = "https://key-demo.nguyennhoanhthai.workers.dev";

const CACHE_STORAGE_KEY = "flower_library_cache_v2";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 60 * 1000;
const MIN_REFRESH_GAP_MS = 15 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const SEARCH_DEBOUNCE_MS = 180;
const HERO_ROTATE_MS = 5000;
const DESKTOP_PAGE_SIZE = 12;
const MOBILE_PAGE_SIZE = 6;
const CARD_TRANSFORM = "c_fill,w_640,h_400,g_south,q_auto,f_auto";
const HERO_TRANSFORM = "c_fill,w_1200,h_800,g_south,q_auto,f_auto";
const LIGHTBOX_TRANSFORM = "q_auto,f_auto";
const MAX_DECODED_IMAGE_CACHE_ENTRIES = 1000;
const GUARD_BLOCKED_MESSAGE = "__curiosity_guard_blocked__";

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const mobileQuery = window.matchMedia("(max-width: 640px)");
const finePointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
const numberFormatter = new Intl.NumberFormat("vi-VN");

const QUALITY_META = {
  "đỏ": { label: "Đỏ", slug: "do", order: 0 },
  cam: { label: "Cam", slug: "cam", order: 1 },
  "tím": { label: "Tím", slug: "tim", order: 2 },
};

const state = {
  flowers: [],
  byId: new Map(),
  filtered: [],
  activeQuality: "all",
  search: "",
  sort: "name-asc",
  page: 1,
  pageSize: mobileQuery.matches ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE,
  duplicateGroups: new Map(),
  ready: false,
};

let searchTimer = null;
let refreshInFlight = null;
let nextRefreshAt = 0;
let scrollFrame = 0;
let dialogList = [];
let dialogIndex = 0;
let sequence = 0;
let guardReleaseHooked = false;

const $ = (id) => document.getElementById(id);

/* ---------- DOM ---------- */
const gardenShader = $("gardenShader");
const petalCanvas = $("petalCanvas");
const cursorGlow = $("cursorGlow");
const petalBurst = $("petalBurst");
const heroInner = $("heroInner");
const heroArt = document.querySelector(".hero-art");

const siteHeader = $("siteHeader");
const scrollProgress = $("scrollProgress");
const searchInput = $("searchInput");
const searchClear = $("searchClear");
const sortSelect = $("sortSelect");
const flowerGrid = $("flowerGrid");
const gallerySkeleton = $("gallerySkeleton");
const emptyState = $("emptyState");
const emptyReset = $("emptyReset");
const pagination = $("pagination");
const resultsText = $("resultsText");
const collectionNote = $("collectionNote");
const statusArea = $("statusArea");
const statusMessage = $("statusMessage");
const retryButton = $("retryButton");
const filterChips = Array.from(document.querySelectorAll(".chip[data-quality]"));
const qualityRows = Array.from(document.querySelectorAll(".quality-row[data-quality]"));
const statTotal = $("statTotal");
const statQuality = $("statQuality");
const footerCount = $("footerCount");
const menuCount = $("menuCount");

const heroImage = $("heroImage");
const heroImageNext = $("heroImageNext");
const heroImages = [heroImage, heroImageNext].filter(Boolean);
const heroPlaceholder = $("heroPlaceholder");
const heroName = $("heroName");
const heroQuality = $("heroQuality");
const heroDot = $("heroDot");

const menuToggle = $("menuToggle");
const menuDialog = $("menuDialog");
const menuClose = $("menuClose");
const menuNav = menuDialog.querySelector(".menu-nav");

const flowerDialog = $("flowerDialog");
const lightboxImage = $("lightboxImage");
const lightboxShimmer = $("lightboxShimmer");
const lightboxFallback = $("lightboxFallback");
const lightboxClose = $("lightboxClose");
const dialogTitle = $("dialogTitle");
const dialogKicker = $("dialogKicker");
const dialogQuality = $("dialogQuality");
const dialogNote = $("dialogNote");
const dialogQualityText = $("dialogQualityText");
const dialogFile = $("dialogFile");
const dialogPosition = $("dialogPosition");
const dialogPrev = $("dialogPrev");
const dialogNext = $("dialogNext");

const statementSection = $("cau-chuyen");
const statementText = $("statementText");

const randomButtons = ["randomNav", "randomHero", "randomFiltered", "randomMobile"]
  .map($)
  .filter(Boolean);

const cardPlaceholderMarkup = `
  <span class="flower-card__placeholder" aria-hidden="true">
    <svg viewBox="0 0 64 64" fill="none">
      <path d="M32 54V28" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M32 38c0-9 6-16 15-18 1.5 9.5-5 17-15 18Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M32 46c0-6-4-11-10-12.5-1 6.5 3.5 12 10 12.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>
    <span>Chưa có ảnh</span>
  </span>
`;

/* =========================================================
   Helpers
   ========================================================= */
function normalizeQuality(quality) {
  return String(quality || "").trim().toLowerCase();
}

function qualityInfo(quality) {
  return (
    QUALITY_META[normalizeQuality(quality)] || {
      label: "Chưa phân loại",
      slug: "none",
      order: 3,
    }
  );
}

function safeImageUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function cloudinaryVariant(url, transform) {
  const safeUrl = safeImageUrl(url);
  if (!safeUrl) return "";
  if (!safeUrl.includes("res.cloudinary.com") || !safeUrl.includes("/image/upload/")) {
    return safeUrl;
  }
  return safeUrl.replace("/image/upload/", `/image/upload/${transform}/`);
}

function normalizeForSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function formatNumber(value) {
  return numberFormatter.format(value);
}

function imageFileName(url) {
  if (!url) return "";

  try {
    const path = new URL(url).pathname;
    const lastSegment = path.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(lastSegment)
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/_/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function scrollToCollection() {
  const target = $("bo-suu-tap");
  if (!target) return;
  target.scrollIntoView({
    behavior: motionQuery.matches ? "auto" : "smooth",
    block: "start",
  });
}

function prefersReducedMotion() {
  return motionQuery.matches;
}

function byName(first, second) {
  return first.name.localeCompare(second.name, "vi", { sensitivity: "base" });
}

function setCssVar(element, name, value) {
  if (element) element.style.setProperty(name, value);
}

/* =========================================================
   Encrypted image decoding — giữ nguyên cơ chế cũ
   ========================================================= */
const utf8Decoder = new TextDecoder("UTF-8");
const decodedImageCache = new Map();
// Giá trị đã là URL hoàn chỉnh (ví dụ dữ liệu đọc từ cache) thì không giải mã lại.
const PLAIN_IMAGE_URL_PATTERN = /^(?:https?:\/\/|\/\/|data:|blob:)/i;
let decodeImageWarningLogged = false;

function rememberDecodedImage(key, value) {
  if (decodedImageCache.size >= MAX_DECODED_IMAGE_CACHE_ENTRIES) {
    const oldestKey = decodedImageCache.keys().next().value;
    if (oldestKey !== undefined) decodedImageCache.delete(oldestKey);
  }

  decodedImageCache.set(key, value);
}

function decodeImageUrl(encryptedText) {
  if (!encryptedText) return "";

  const value = String(encryptedText).trim();
  if (!value) return "";

  if (PLAIN_IMAGE_URL_PATTERN.test(value)) return value;

  const cachedValue = decodedImageCache.get(value);
  if (cachedValue !== undefined) return cachedValue;

  try {
    // Tách phần Base64 và chữ ký HMAC ở dấu chấm đầu tiên.
    const separatorIndex = value.indexOf(".");
    const encoded = separatorIndex === -1 ? value : value.slice(0, separatorIndex);

    if (!encoded) return "";

    // Chuyển Base64 URL-safe về Base64 thông thường và bổ sung padding.
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

    const binary = atob(padded);

    // Duyệt tuần tự nhanh hơn Uint8Array.from(binary, callback) đáng kể.
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const decoded = utf8Decoder.decode(bytes);
    rememberDecodedImage(value, decoded);
    return decoded;
  } catch (error) {
    // Ghi nhớ cả kết quả lỗi để không thử lại và không spam console.
    rememberDecodedImage(value, "");
    if (!decodeImageWarningLogged) {
      decodeImageWarningLogged = true;
      console.warn("Một số URL ảnh không giải mã được và sẽ bị bỏ qua.", error);
    }
    return "";
  }
}

/* =========================================================
   Data
   ========================================================= */
function normalizeFlowerEntry(raw) {
  if (!raw || typeof raw !== "object") return null;

  const name = String(raw.name || "").trim();
  if (!name) return null;

  return {
    id: `flower-${sequence++}`,
    name,
    quality: normalizeQuality(raw.quality),
    image: decodeImageUrl(String(raw.image || "").trim()),
  };
}

function prepareFlowers(rawFlowers) {
  return rawFlowers
    .map(normalizeFlowerEntry)
    .filter(Boolean)
    .sort(byName);
}

function parseApiData(data) {
  if (!Array.isArray(data)) {
    throw new Error("Dữ liệu máy chủ không đúng định dạng.");
  }

  const flowers = data.filter((item) => item && typeof item === "object" && item.name);
  if (flowers.length === 0) {
    throw new Error("Bộ sưu tập hiện chưa có dữ liệu.");
  }

  return prepareFlowers(flowers);
}

function buildDuplicateGroups(flowers) {
  const groups = new Map();

  flowers.forEach((flower) => {
    const key = normalizeForSearch(flower.name);
    if (!key) return;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(flower);
  });

  return groups;
}

function getDuplicateGroup(flower) {
  return state.duplicateGroups.get(normalizeForSearch(flower.name)) || [flower];
}

function getFilteredFlowers() {
  const query = normalizeForSearch(state.search);

  const filtered = state.flowers.filter((flower) => {
    const matchesQuality =
      state.activeQuality === "all" || flower.quality === state.activeQuality;
    const matchesSearch = !query || normalizeForSearch(flower.name).includes(query);
    return matchesQuality && matchesSearch;
  });

  if (state.sort === "name-desc") {
    return filtered.sort((first, second) => byName(second, first));
  }

  if (state.sort === "quality") {
    return filtered.sort((first, second) => {
      const qualityDiff = qualityInfo(first.quality).order - qualityInfo(second.quality).order;
      return qualityDiff || byName(first, second);
    });
  }

  return filtered.sort(byName);
}

function getCounts() {
  const counts = { all: state.flowers.length, "đỏ": 0, cam: 0, "tím": 0 };

  state.flowers.forEach((flower) => {
    if (flower.quality in counts) counts[flower.quality] += 1;
  });

  return counts;
}

/* =========================================================
   Animated counters
   ========================================================= */
const animatedCounters = new WeakSet();

function setCounter(element, value, { pad = 0 } = {}) {
  if (!element) return;

  const target = Math.max(0, Number(value) || 0);

  if (prefersReducedMotion() || animatedCounters.has(element)) {
    element.textContent = formatNumber(target).padStart(pad, "0");
    return;
  }

  animatedCounters.add(element);
  const startTime = performance.now();
  const duration = 950;

  const tick = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = formatNumber(Math.round(target * eased)).padStart(pad, "0");

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.textContent = formatNumber(target).padStart(pad, "0");
    }
  };

  requestAnimationFrame(tick);
}

function updateCountsUI() {
  const counts = getCounts();

  document.querySelectorAll("[data-count]").forEach((element) => {
    setCounter(element, counts[element.dataset.count] || 0);
  });

  qualityRows.forEach((row) => {
    const key = row.dataset.quality;
    row.setAttribute(
      "aria-label",
      `Lọc sắc ${qualityInfo(key).label} · ${formatNumber(counts[key] || 0)} mẫu vật`
    );
  });
}

function updateMetadata() {
  const total = state.flowers.length;
  const qualities = new Set(state.flowers.map((flower) => flower.quality).filter(Boolean));

  setCounter(statTotal, total);
  setCounter(statQuality, qualities.size, { pad: 2 });
  footerCount.textContent = `${formatNumber(total)} đóa hoa`;
  menuCount.textContent = formatNumber(total);
  collectionNote.textContent = `${formatNumber(total)} mẫu vật · cập nhật trực tiếp`;
  document.title = `Hoa Viên — Bộ sưu tập ${formatNumber(total)} loài hoa`;
}

/* =========================================================
   Hero
   ========================================================= */
/* The first loaded image uses #heroImage; later rotations alternate slots. */
const heroStage = {
  currentId: "",
  visible: 1,
  timer: 0,
  paused: false,
  inView: true,
  token: 0,
  pendingSource: "",
};

function pickDefaultHero() {
  return (
    state.flowers.find(
      (flower) => flower.image && normalizeForSearch(flower.name) === "ca chep vuot song"
    ) ||
    state.flowers.find((flower) => flower.image) ||
    state.flowers[0]
  );
}

function setHeroCaption(flower) {
  const info = qualityInfo(flower.quality);
  heroName.textContent = flower.name;
  heroQuality.textContent = info.label;
  heroDot.className = `dot dot--${info.slug}`;
}

function showHeroPlaceholder() {
  heroImages.forEach((image) => {
    image.hidden = true;
    image.classList.remove("is-active");
  });
  heroPlaceholder.hidden = false;
}

function updateHeroImage(flower) {
  const source = flower.image ? cloudinaryVariant(flower.image, HERO_TRANSFORM) : "";

  if (!source) {
    showHeroPlaceholder();
    setHeroCaption(flower);
    return;
  }

  const visibleImage = heroImages[heroStage.visible];

  if (visibleImage && visibleImage.dataset.source === source && !visibleImage.hidden) {
    setHeroCaption(flower);
    return;
  }

  if (heroStage.pendingSource === source) return;
  heroStage.pendingSource = source;

  const nextIndex = heroImages.length > 1 ? 1 - heroStage.visible : 0;
  const nextImage = heroImages[nextIndex] || heroImage;
  const token = (heroStage.token += 1);
  let triedOriginal = source === flower.image;

  nextImage.onload = () => {
    if (token !== heroStage.token) return;

    heroStage.pendingSource = "";
    nextImage.dataset.source = source;
    nextImage.alt = `${flower.name} — ${qualityInfo(flower.quality).label}`;
    nextImage.hidden = false;
    heroPlaceholder.hidden = true;
    setHeroCaption(flower);

    requestAnimationFrame(() => {
      if (token !== heroStage.token) return;

      heroImages.forEach((image, index) => {
        image.classList.toggle("is-active", index === nextIndex);
      });
      heroStage.visible = nextIndex;

      window.setTimeout(() => {
        if (token !== heroStage.token) return;
        heroImages.forEach((image, index) => {
          if (index !== heroStage.visible) image.hidden = true;
        });
      }, 900);
    });
  };

  nextImage.onerror = () => {
    if (token !== heroStage.token) return;

    if (!triedOriginal && flower.image && source !== flower.image) {
      triedOriginal = true;
      nextImage.src = flower.image;
      return;
    }

    heroStage.pendingSource = "";
    nextImage.hidden = true;
    nextImage.classList.remove("is-active");
    setHeroCaption(flower);

    if (!heroImages.some((image) => image.classList.contains("is-active"))) {
      heroPlaceholder.hidden = false;
    }
  };

  nextImage.src = source;
}

function setHero(flower) {
  if (!flower) return;
  heroStage.currentId = flower.id;
  updateHeroImage(flower);
}

function clearHeroTimer() {
  if (!heroStage.timer) return;
  window.clearTimeout(heroStage.timer);
  heroStage.timer = 0;
}

function canRotateHero() {
  return (
    state.ready &&
    !prefersReducedMotion() &&
    !document.hidden &&
    heroStage.inView &&
    !heroStage.paused &&
    !flowerDialog.open &&
    !menuDialog.open
  );
}

function scheduleHeroRotation() {
  clearHeroTimer();
  if (!canRotateHero()) return;

  heroStage.timer = window.setTimeout(() => {
    heroStage.timer = 0;
    if (!canRotateHero()) return;

    const pool = state.flowers.filter(
      (flower) => flower.image && flower.id !== heroStage.currentId
    );

    if (pool.length) {
      setHero(pool[Math.floor(Math.random() * pool.length)]);
    }

    scheduleHeroRotation();
  }, HERO_ROTATE_MS);
}

function setupHeroRotation() {
  if (!("IntersectionObserver" in window)) {
    heroStage.inView = true;
    scheduleHeroRotation();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        heroStage.inView = entry.isIntersecting;
        scheduleHeroRotation();
      });
    },
    { threshold: 0.12 }
  );

  observer.observe(heroArt);
}

function updateHero() {
  const current = heroStage.currentId ? state.byId.get(heroStage.currentId) : null;
  const hero = current || pickDefaultHero();

  if (!hero) return;

  setHero(hero);
  scheduleHeroRotation();
}

/* =========================================================
   Gallery
   ========================================================= */
function createQualityTag(flower) {
  const info = qualityInfo(flower.quality);
  const tag = document.createElement("span");
  tag.className = "quality-tag";

  const dot = document.createElement("span");
  dot.className = `dot dot--${info.slug}`;
  dot.setAttribute("aria-hidden", "true");

  tag.append(dot, document.createTextNode(info.label));
  return tag;
}

function createFlowerCard(flower, index) {
  const info = qualityInfo(flower.quality);
  const duplicates = getDuplicateGroup(flower);
  const card = document.createElement("button");

  card.type = "button";
  card.className = "flower-card";
  card.dataset.id = flower.id;
  card.style.setProperty("--i", String(index));
  card.setAttribute(
    "aria-label",
    `Xem chi tiết ${flower.name}, sắc ${info.label}${
      duplicates.length > 1 ? `, tên trùng ${duplicates.length} mục` : ""
    }`
  );

  const media = document.createElement("span");
  media.className = "flower-card__media";

  if (flower.image) {
    const image = document.createElement("img");
    image.alt = flower.name;
    image.loading = "lazy";
    image.decoding = "async";
    image.src = cloudinaryVariant(flower.image, CARD_TRANSFORM);
    image.addEventListener(
      "error",
      () => {
        card.classList.add("has-no-image");
      },
      { once: true }
    );
    media.appendChild(image);
  } else {
    card.classList.add("has-no-image");
  }

  media.insertAdjacentHTML("beforeend", cardPlaceholderMarkup);
  media.appendChild(createQualityTag(flower));

  const body = document.createElement("span");
  body.className = "flower-card__body";

  const name = document.createElement("span");
  name.className = "flower-card__name";
  name.textContent = flower.name;

  body.appendChild(name);

  if (duplicates.length > 1) {
    const meta = document.createElement("span");
    meta.className = "flower-card__meta";

    const flag = document.createElement("span");
    flag.className = "dup-flag";
    flag.textContent = `${duplicates.length} ảnh`;
    flag.title = `Tên này xuất hiện ${duplicates.length} lần với các ảnh khác nhau`;
    meta.appendChild(flag);

    body.appendChild(meta);
  }

  card.append(media, body);

  return card;
}

function renderResultsText(total, start, end) {
  if (!state.ready) {
    resultsText.textContent = "Đang tải bộ sưu tập…";
    return;
  }

  if (total === 0) {
    resultsText.textContent = state.flowers.length
      ? "Không tìm thấy mẫu vật phù hợp"
      : "Chưa có dữ liệu mẫu vật";
    return;
  }

  const query = state.search.trim();
  const suffix = query ? ` · “${query}”` : "";
  resultsText.textContent = `Hiển thị ${formatNumber(start)}–${formatNumber(
    end
  )} trong ${formatNumber(total)} mẫu vật${suffix}`;
}

function pageItems(totalPages, currentPage) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);

  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }

  const sorted = Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((first, second) => first - second);

  const result = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });

  return result;
}

function createPageButton(label, ariaLabel, disabled = false, current = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "page-btn";
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  button.disabled = disabled;
  if (current) button.setAttribute("aria-current", "page");
  return button;
}

function goToPage(page) {
  if (page === state.page) return;
  state.page = page;
  renderGallery();
  scrollToCollection();
}

function renderPagination(totalPages) {
  pagination.replaceChildren();

  if (totalPages <= 1) {
    pagination.hidden = true;
    return;
  }

  pagination.hidden = false;

  const previous = createPageButton("←", "Trang trước", state.page === 1);
  previous.addEventListener("click", () => goToPage(state.page - 1));
  pagination.appendChild(previous);

  pageItems(totalPages, state.page).forEach((item) => {
    if (item === "ellipsis") {
      const ellipsis = document.createElement("span");
      ellipsis.className = "page-ellipsis";
      ellipsis.textContent = "…";
      ellipsis.setAttribute("aria-hidden", "true");
      pagination.appendChild(ellipsis);
      return;
    }

    const button = createPageButton(
      String(item),
      `Trang ${item}`,
      false,
      item === state.page
    );
    button.addEventListener("click", () => goToPage(item));
    pagination.appendChild(button);
  });

  const next = createPageButton("→", "Trang sau", state.page === totalPages);
  next.addEventListener("click", () => goToPage(state.page + 1));
  pagination.appendChild(next);
}

function renderGallery() {
  if (!state.ready) return;

  resetTilt();

  const filtered = getFilteredFlowers();
  state.filtered = filtered;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(Math.max(state.page, 1), totalPages);

  const startIndex = (state.page - 1) * state.pageSize;
  const pageFlowers = filtered.slice(startIndex, startIndex + state.pageSize);

  const fragment = document.createDocumentFragment();
  pageFlowers.forEach((flower, index) => {
    fragment.appendChild(createFlowerCard(flower, index));
  });

  flowerGrid.replaceChildren(fragment);
  flowerGrid.hidden = total === 0;
  emptyState.hidden = total !== 0;
  gallerySkeleton.hidden = true;

  const endIndex = Math.min(startIndex + state.pageSize, total);
  renderResultsText(total, total > 0 ? startIndex + 1 : 0, endIndex);
  renderPagination(totalPages);
}

/* =========================================================
   Filter controls
   ========================================================= */
function syncQualityControls() {
  filterChips.forEach((chip) => {
    const active = chip.dataset.quality === state.activeQuality;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));
  });

  qualityRows.forEach((row) => {
    const active = row.dataset.quality === state.activeQuality;
    row.classList.toggle("is-active", active);
    row.setAttribute("aria-pressed", String(active));
  });
}

function setQuality(quality) {
  state.activeQuality = quality;
  state.page = 1;
  syncQualityControls();
  renderGallery();
}

function syncSearchClear() {
  searchClear.hidden = !searchInput.value;
}

function resetFilters() {
  state.activeQuality = "all";
  state.search = "";
  state.sort = "name-asc";
  state.page = 1;
  searchInput.value = "";
  sortSelect.value = "name-asc";
  syncSearchClear();
  syncQualityControls();
  renderGallery();
}

/* =========================================================
   Lightbox
   ========================================================= */
const preloadedLightboxImages = new Set();
const whenIdle =
  window.requestIdleCallback || ((callback) => window.setTimeout(callback, 200));

function preloadLightboxImage(flower) {
  if (!flower || !flower.image) return;

  const source = cloudinaryVariant(flower.image, LIGHTBOX_TRANSFORM) || flower.image;
  if (!source || preloadedLightboxImages.has(source)) return;

  preloadedLightboxImages.add(source);
  if (preloadedLightboxImages.size > 48) {
    const oldest = preloadedLightboxImages.values().next().value;
    if (oldest) preloadedLightboxImages.delete(oldest);
  }

  whenIdle(() => {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
  });
}

function syncBodyLock() {
  const locked = flowerDialog.open || menuDialog.open;
  document.body.classList.toggle("modal-open", locked);
}

function renderDialog() {
  const flower = dialogList[dialogIndex];
  if (!flower) return;

  const info = qualityInfo(flower.quality);
  const duplicates = getDuplicateGroup(flower);
  const fileLabel = imageFileName(flower.image);

  dialogKicker.textContent = `Mẫu vật · ${info.label}`;
  dialogTitle.textContent = flower.name;

  const dot = document.createElement("span");
  dot.className = `dot dot--${info.slug}`;
  dot.setAttribute("aria-hidden", "true");
  dialogQuality.replaceChildren(dot, document.createTextNode(info.label));

  dialogQualityText.textContent = info.label;
  dialogFile.textContent = fileLabel || "Không có tệp ảnh";
  dialogPosition.textContent = `${dialogIndex + 1} / ${dialogList.length} mục trong danh sách đang xem`;

  if (duplicates.length > 1) {
    dialogNote.hidden = false;
    dialogNote.textContent = `Tên này xuất hiện ${duplicates.length} lần trong bộ sưu tập với các ảnh khác nhau. Ảnh đang xem: ${
      fileLabel || "không rõ nguồn"
    }.`;
  } else {
    dialogNote.hidden = true;
    dialogNote.textContent = "";
  }

  lightboxImage.onload = null;
  lightboxImage.onerror = null;
  lightboxImage.hidden = true;
  lightboxImage.style.opacity = "0";
  lightboxImage.removeAttribute("src");
  lightboxImage.alt = flower.name;
  lightboxFallback.hidden = true;
  lightboxShimmer.hidden = false;

  if (!flower.image) {
    lightboxShimmer.hidden = true;
    lightboxFallback.hidden = false;
  } else {
    const source = cloudinaryVariant(flower.image, LIGHTBOX_TRANSFORM) || flower.image;
    let triedOriginal = source === flower.image;

    lightboxImage.hidden = false;
    lightboxImage.loading = "eager";

    lightboxImage.onload = () => {
      lightboxShimmer.hidden = true;
      lightboxFallback.hidden = true;
      lightboxImage.style.opacity = "1";
    };
    lightboxImage.onerror = () => {
      if (!triedOriginal) {
        triedOriginal = true;
        lightboxImage.src = flower.image;
        return;
      }
      lightboxShimmer.hidden = true;
      lightboxImage.style.opacity = "0";
      lightboxFallback.hidden = false;
    };
    lightboxImage.src = source;
  }

  const hasMultiple = dialogList.length > 1;
  dialogPrev.disabled = !hasMultiple;
  dialogNext.disabled = !hasMultiple;

  if (hasMultiple) {
    const next = dialogList[(dialogIndex + 1) % dialogList.length];
    const previous =
      dialogList[(dialogIndex - 1 + dialogList.length) % dialogList.length];
    preloadLightboxImage(next);
    preloadLightboxImage(previous);
  }
}

function openFlowerDialog(flower, list) {
  const source = list && list.length ? list : state.flowers;
  const index = source.findIndex((item) => item.id === flower.id);

  dialogList = source;
  dialogIndex = index >= 0 ? index : 0;
  clearHeroTimer();

  renderDialog();

  if (!flowerDialog.open) {
    flowerDialog.showModal();
    syncBodyLock();
    lightboxClose.focus();
  }
}

function stepDialog(direction) {
  if (dialogList.length < 2) return;
  dialogIndex = (dialogIndex + direction + dialogList.length) % dialogList.length;
  renderDialog();
}

function openRandomFlower() {
  const pool = state.filtered.length ? state.filtered : state.flowers;
  if (!pool.length) return;

  const flower = pool[Math.floor(Math.random() * pool.length)];
  openFlowerDialog(flower, pool);
}

/* =========================================================
   Cache & fetching
   ========================================================= */
function flowerSignature(flower) {
  return `${flower.name}\u0000${flower.quality}\u0000${flower.image}`;
}

function collectionChanged(flowers) {
  if (flowers.length !== state.flowers.length) return true;
  const nextSignature = flowers
    .map(flowerSignature)
    .sort()
    .join("\n");
  const currentSignature = state.flowers
    .map(flowerSignature)
    .sort()
    .join("\n");
  return nextSignature !== currentSignature;
}

function readCachedFlowers() {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed && parsed.flowers;
    if (!Array.isArray(list) || list.length === 0) return null;

    if (
      !Array.isArray(parsed) &&
      parsed.savedAt &&
      Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS
    ) {
      return null;
    }

    const normalized = prepareFlowers(list.filter((item) => item && item.name));
    return normalized.length ? normalized : null;
  } catch {
    return null;
  }
}

function writeCachedFlowers(flowers) {
  try {
    localStorage.setItem(
      CACHE_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        flowers: flowers.map((flower) => ({
          name: flower.name,
          quality: flower.quality,
          image: flower.image,
        })),
      })
    );
  } catch {
    // localStorage có thể đầy hoặc bị chặn ở chế độ ẩn danh.
  }
}

async function fetchFlowersFromApi() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortOnGuard = () => controller.abort();

  window.addEventListener("curiosityguard:block", abortOnGuard, { once: true });

  let response;

  try {
    response = await fetch(API_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (window.__curiosityGuardActive) {
      throw new Error(GUARD_BLOCKED_MESSAGE);
    }
    if (error && error.name === "AbortError") {
      throw new Error("Máy chủ phản hồi quá lâu. Kiểm tra kết nối rồi thử lại.");
    }
    throw new Error("Không thể kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.");
  } finally {
    window.clearTimeout(timeoutId);
    window.removeEventListener("curiosityguard:block", abortOnGuard);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Không có quyền truy cập bộ sưu tập.");
    }
    if (response.status === 404) {
      throw new Error("Không tìm thấy nguồn dữ liệu bộ sưu tập.");
    }
    if (response.status === 429) {
      throw new Error("Máy chủ đang nhận quá nhiều yêu cầu. Chờ một chút rồi thử lại.");
    }
    throw new Error("Máy chủ chưa thể tải bộ sưu tập. Vui lòng thử lại sau.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Dữ liệu máy chủ trả về không đọc được.");
  }

  return parseApiData(data);
}

function applyFlowers(flowers, { preservePage = false } = {}) {
  state.flowers = flowers;
  state.byId = new Map(flowers.map((flower) => [flower.id, flower]));
  state.duplicateGroups = buildDuplicateGroups(flowers);
  state.ready = true;

  if (!preservePage) state.page = 1;

  updateCountsUI();
  updateMetadata();
  updateHero();
  renderGallery();

  statusArea.hidden = true;
  statusArea.setAttribute("aria-busy", "false");
}

function showLoading() {
  gallerySkeleton.hidden = false;
  flowerGrid.hidden = true;
  emptyState.hidden = true;
  pagination.hidden = true;
  statusArea.hidden = true;
  collectionNote.textContent = "Đang kết nối dữ liệu…";
  resultsText.textContent = "Đang tải bộ sưu tập…";
}

function showError(message) {
  gallerySkeleton.hidden = true;
  flowerGrid.hidden = true;
  pagination.hidden = true;
  statusArea.hidden = false;
  statusArea.setAttribute("aria-busy", "false");
  statusMessage.textContent = message;
  resultsText.textContent = "Không thể tải bộ sưu tập";
  clearHeroTimer();
  heroName.textContent = "Chưa có dữ liệu";
  heroQuality.textContent = "Thử lại sau";
  heroDot.className = "dot dot--none";
  showHeroPlaceholder();
}

async function loadData() {
  // DevTools đang mở: không gọi API, chờ đóng DevTools rồi mới tải.
  if (window.__curiosityGuardActive) {
    waitForGuardRelease();
    return;
  }

  const cached = readCachedFlowers();

  if (cached) {
    applyFlowers(cached);
    refreshFlowersInBackground(true);
    return;
  }

  showLoading();
  nextRefreshAt = Date.now() + MIN_REFRESH_GAP_MS;

  try {
    const flowers = await fetchFlowersFromApi();
    writeCachedFlowers(flowers);
    applyFlowers(flowers);
    nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  } catch (error) {
    nextRefreshAt = Date.now() + MIN_REFRESH_GAP_MS;
    if (error && error.message === GUARD_BLOCKED_MESSAGE) {
      waitForGuardRelease();
      return;
    }
    showError(error && error.message ? error.message : "Đã xảy ra lỗi khi tải dữ liệu.");
  }
}

function waitForGuardRelease() {
  if (guardReleaseHooked) return;

  guardReleaseHooked = true;
  window.addEventListener(
    "curiosityguard:release",
    () => {
      guardReleaseHooked = false;
      loadData();
    },
    { once: true }
  );
}

function refreshFlowersInBackground(force = false) {
  if (window.__curiosityGuardActive) {
    waitForGuardRelease();
    return Promise.resolve();
  }

  if (refreshInFlight) return refreshInFlight;
  if (navigator.onLine === false) return Promise.resolve();

  const now = Date.now();
  if (!force && now < nextRefreshAt) return Promise.resolve();

  nextRefreshAt = now + MIN_REFRESH_GAP_MS;

  refreshInFlight = fetchFlowersFromApi()
    .then((freshFlowers) => {
      const changed = !state.ready || collectionChanged(freshFlowers);

      writeCachedFlowers(freshFlowers);
      nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;

      if (changed) applyFlowers(freshFlowers, { preservePage: true });
    })
    .catch((error) => {
      nextRefreshAt = Date.now() + MIN_REFRESH_GAP_MS;
      if (error && error.message === GUARD_BLOCKED_MESSAGE) {
        waitForGuardRelease();
      }
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/* =========================================================
   Statement word highlight
   ========================================================= */
function buildStatementWords() {
  if (!statementText || statementText.dataset.ready === "true") return;

  const sourceNodes = Array.from(statementText.childNodes);
  const fragment = document.createDocumentFragment();
  let wordIndex = 0;

  function appendText(text, accent) {
    String(text)
      .split(/(\s+)/)
      .forEach((token) => {
        if (!token) return;

        if (/^\s+$/.test(token)) {
          fragment.appendChild(document.createTextNode(" "));
          return;
        }

        const word = document.createElement("span");
        word.className = `word${accent ? " word--accent" : ""}`;
        word.textContent = token;
        word.style.setProperty("--d", `${Math.min(wordIndex * 26, 850)}ms`);
        wordIndex += 1;
        fragment.appendChild(word);
      });
  }

  sourceNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent, false);
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "EM") {
      appendText(node.textContent, true);
    } else {
      fragment.appendChild(node.cloneNode(true));
    }
  });

  statementText.replaceChildren(fragment);
  statementText.dataset.ready = "true";

  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    statementSection.classList.add("is-lit");
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        statementSection.classList.add("is-lit");
        observer.disconnect();
      });
    },
    { threshold: 0.35 }
  );

  observer.observe(statementSection);
}

/* =========================================================
   Reveal on scroll
   ========================================================= */
function setupReveals() {
  const items = Array.from(document.querySelectorAll("[data-reveal]"));
  if (!items.length) return;

  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-revealed"));
    return;
  }

  document.body.classList.add("reveal-ready");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.12 }
  );

  items.forEach((item) => observer.observe(item));
}

/* =========================================================
   Garden shader background
   ========================================================= */
const VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.055;

  float n1 = fbm(p * 1.7 + vec2(t * 0.9, -t * 0.55));
  float n2 = fbm(p * 3.1 - vec2(t * 0.6, t * 0.8) + n1 * 1.4);
  float veins = fbm(p * 5.0 + n2 * 1.2 + vec2(-t * 0.4, t * 0.3));

  vec3 cream = vec3(0.973, 0.963, 0.918);
  vec3 mint = vec3(0.717, 0.941, 0.824);
  vec3 rose = vec3(0.988, 0.812, 0.874);
  vec3 gold = vec3(0.968, 0.886, 0.671);

  vec3 color = mix(cream, mint, smoothstep(0.12, 0.82, n1));
  color = mix(color, rose, smoothstep(0.38, 0.94, n2) * 0.62);
  color = mix(color, gold, smoothstep(0.46, 0.98, veins) * 0.34);

  vec2 bloomCenter = vec2(sin(t * 1.1) * 0.36, cos(t * 0.85) * 0.24);
  float bloom = smoothstep(0.58, 0.0, length(p - bloomCenter));
  color += vec3(1.0, 0.94, 0.8) * bloom * 0.2;

  float shade = smoothstep(1.3, 0.15, length(p));
  color = mix(color * 0.965, color, shade);

  gl_FragColor = vec4(color, 1.0);
}
`;

const shaderStage = {
  gl: null,
  program: null,
  buffer: null,
  timeLocation: null,
  resolutionLocation: null,
  resolution: [1, 1],
  ready: false,
};

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function initShader() {
  if (!gardenShader) return;

  let gl = null;
  try {
    gl = gardenShader.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
    });
  } catch {
    gl = null;
  }

  if (!gl) {
    gardenShader.style.display = "none";
    return;
  }

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = vertex && fragment ? gl.createProgram() : null;

  if (!program) {
    gardenShader.style.display = "none";
    return;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gardenShader.style.display = "none";
    return;
  }

  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );

  const positionLocation = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  shaderStage.gl = gl;
  shaderStage.program = program;
  shaderStage.buffer = buffer;
  shaderStage.timeLocation = gl.getUniformLocation(program, "uTime");
  shaderStage.resolutionLocation = gl.getUniformLocation(program, "uRes");
  shaderStage.ready = true;

  resizeShader();

  gardenShader.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      shaderStage.ready = false;
      gardenShader.style.display = "none";
    },
    { once: true }
  );
}

function resizeShader() {
  if (!shaderStage.ready) return;

  const gl = shaderStage.gl;
  const scale = window.innerWidth <= 760 ? 0.36 : window.innerWidth <= 1100 ? 0.44 : 0.5;
  const width = Math.max(1, Math.round(window.innerWidth * scale));
  const height = Math.max(1, Math.round(window.innerHeight * scale));

  if (gardenShader.width !== width || gardenShader.height !== height) {
    gardenShader.width = width;
    gardenShader.height = height;
    gl.viewport(0, 0, width, height);
  }

  shaderStage.resolution = [width, height];
}

function renderShader(now) {
  if (!shaderStage.ready) return;

  const gl = shaderStage.gl;
  gl.uniform1f(shaderStage.timeLocation, now * 0.001);
  gl.uniform2f(
    shaderStage.resolutionLocation,
    shaderStage.resolution[0],
    shaderStage.resolution[1]
  );
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* =========================================================
   Floating petals
   ========================================================= */
const PETAL_COLORS = [
  [243, 166, 192],
  [247, 201, 139],
  [201, 182, 240],
  [159, 227, 189],
  [246, 226, 164],
  [236, 154, 162],
];

const petalStage = {
  ctx: null,
  petals: [],
  width: 0,
  height: 0,
  dpr: 1,
  ready: false,
};

function petalCount() {
  const divisor = window.innerWidth <= 760 ? 96 : 64;
  return Math.max(8, Math.min(22, Math.round(window.innerWidth / divisor)));
}

function makePetal(randomY) {
  const color = PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)];

  return {
    x: Math.random(),
    y: randomY ? Math.random() : -0.08 - Math.random() * 0.12,
    size: 5 + Math.random() * 9,
    speed: 0.018 + Math.random() * 0.045,
    sway: 0.004 + Math.random() * 0.012,
    drift: (Math.random() - 0.5) * 0.006,
    phase: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.5,
    rotation: Math.random() * Math.PI * 2,
    alpha: 0.35 + Math.random() * 0.45,
    color,
  };
}

function initPetals() {
  if (!petalCanvas) return;

  const ctx = petalCanvas.getContext("2d");
  if (!ctx) {
    petalCanvas.style.display = "none";
    return;
  }

  petalStage.ctx = ctx;
  petalStage.ready = true;
  petalStage.petals = Array.from({ length: petalCount() }, () => makePetal(true));
  resizePetals();
}

function resizePetals() {
  if (!petalStage.ready) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  const width = window.innerWidth;
  const height = window.innerHeight;

  petalStage.width = width;
  petalStage.height = height;
  petalStage.dpr = dpr;

  petalCanvas.width = Math.max(1, Math.round(width * dpr));
  petalCanvas.height = Math.max(1, Math.round(height * dpr));
  petalStage.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const target = petalCount();
  while (petalStage.petals.length < target) petalStage.petals.push(makePetal(true));
  if (petalStage.petals.length > target) petalStage.petals.length = target;
}

function drawPetal(petal, time) {
  const ctx = petalStage.ctx;
  const width = petalStage.width;
  const height = petalStage.height;
  const x = petal.x * width;
  const y = petal.y * height;
  const size = petal.size;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(petal.rotation + Math.sin(time * 0.0004 + petal.phase) * 0.6);
  ctx.globalAlpha = petal.alpha;
  ctx.fillStyle = `rgb(${petal.color[0]}, ${petal.color[1]}, ${petal.color[2]})`;

  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.95, -size * 0.55, size * 0.7, size * 0.65, 0, size);
  ctx.bezierCurveTo(-size * 0.7, size * 0.65, -size * 0.95, -size * 0.55, 0, -size);
  ctx.fill();

  ctx.restore();
}

function updatePetals(time, delta) {
  if (!petalStage.ready) return;

  const ctx = petalStage.ctx;
  ctx.clearRect(0, 0, petalStage.width, petalStage.height);

  const step = delta / 1000;

  petalStage.petals.forEach((petal) => {
    petal.y += petal.speed * step;
    petal.x +=
      (Math.sin(time * 0.0006 + petal.phase) * petal.sway + petal.drift) * step;

    if (petal.y > 1.08) {
      petal.y = -0.08;
      petal.x = Math.random();
    }

    if (petal.x > 1.06) petal.x = -0.06;
    if (petal.x < -0.06) petal.x = 1.06;

    drawPetal(petal, time);
  });
}

/* =========================================================
   Cursor glow & petal burst
   ========================================================= */
let glowX = 0;
let glowY = 0;
let glowFrame = 0;

function handleCursorMove(event) {
  if (!cursorGlow || !finePointerQuery.matches || prefersReducedMotion()) return;

  glowX = event.clientX;
  glowY = event.clientY;

  if (glowFrame) return;

  glowFrame = requestAnimationFrame(() => {
    cursorGlow.style.transform = `translate3d(${glowX}px, ${glowY}px, 0)`;
    cursorGlow.classList.add("is-on");
    glowFrame = 0;
  });
}

function hideCursorGlow() {
  if (!cursorGlow) return;
  cursorGlow.classList.remove("is-on");
}

const BURST_COLORS = ["#f3a6c0", "#f7c98b", "#c9b6f0", "#9fe3bd", "#f6e2a4"];

function burstPetals(x, y, amount = 15) {
  if (!petalBurst || prefersReducedMotion()) return;

  if (petalBurst.childElementCount > 70) petalBurst.replaceChildren();

  const fragment = document.createDocumentFragment();

  for (let index = 0; index < amount; index += 1) {
    const petal = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const distance = 50 + Math.random() * 130;
    const duration = 800 + Math.random() * 700;
    const size = 6 + Math.random() * 9;

    petal.className = "petal-burst__item";
    petal.style.left = `${x}px`;
    petal.style.top = `${y}px`;
    petal.style.setProperty("--size", `${size}px`);
    petal.style.setProperty(
      "--petal-color",
      BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)]
    );
    petal.style.setProperty("--tx", `${Math.cos(angle) * distance}px`);
    petal.style.setProperty("--ty", `${Math.sin(angle) * distance + 70}px`);
    petal.style.setProperty("--rot", `${(Math.random() - 0.5) * 540}deg`);
    petal.style.setProperty("--duration", `${duration}ms`);

    petal.addEventListener("animationend", () => petal.remove(), { once: true });
    fragment.appendChild(petal);
  }

  petalBurst.appendChild(fragment);
}

function burstFromButton(button) {
  if (!button) return;
  const rect = button.getBoundingClientRect();
  burstPetals(rect.left + rect.width / 2, rect.top + rect.height / 2, 14);
}

function burstAtEvent(event, amount) {
  if (event.clientX || event.clientY) {
    burstPetals(event.clientX, event.clientY, amount);
  } else if (event.currentTarget instanceof Element) {
    burstFromButton(event.currentTarget);
  }
}

/* =========================================================
   Card tilt
   ========================================================= */
let tiltedCard = null;

function resetTilt(card = tiltedCard) {
  if (!card) return;

  card.style.setProperty("--rx", "0deg");
  card.style.setProperty("--ry", "0deg");
  card.classList.remove("is-tilting");

  if (card === tiltedCard) tiltedCard = null;
}

function handleTiltMove(event) {
  if (!finePointerQuery.matches || prefersReducedMotion()) return;

  const target = event.target instanceof Element ? event.target : null;
  const card = target ? target.closest(".flower-card") : null;

  if (!card) {
    resetTilt();
    return;
  }

  if (tiltedCard && tiltedCard !== card) resetTilt();

  const rect = card.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const px = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  const py = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);

  tiltedCard = card;
  card.classList.add("is-tilting");
  card.style.setProperty("--ry", `${(px - 0.5) * 10}deg`);
  card.style.setProperty("--rx", `${(0.5 - py) * 8}deg`);
  card.style.setProperty("--mx", `${px * 100}%`);
  card.style.setProperty("--my", `${py * 100}%`);
}

/* =========================================================
   Hero pointer tilt
   ========================================================= */
function handleHeroMove(event) {
  if (!heroInner || !finePointerQuery.matches || prefersReducedMotion()) return;

  const rect = heroArt.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const px = (event.clientX - rect.left) / rect.width - 0.5;
  const py = (event.clientY - rect.top) / rect.height - 0.5;

  setCssVar(heroInner, "--hero-ry", `${px * 7}deg`);
  setCssVar(heroInner, "--hero-rx", `${py * -6}deg`);
}

function resetHeroTilt() {
  setCssVar(heroInner, "--hero-ry", "0deg");
  setCssVar(heroInner, "--hero-rx", "0deg");
}

/* =========================================================
   Unified motion loop
   ========================================================= */
const motionStage = {
  running: false,
  frame: 0,
  last: 0,
  scrollUntil: 0,
};

function motionLoop(now) {
  if (!motionStage.running) return;

  const delta = Math.min(now - motionStage.last, 48);
  motionStage.last = now;

  if (!document.hidden) {
    // Ảnh nền tĩnh lại trong lúc cuộn để ưu tiên độ mượt; cánh hoa vẫn chạy mỗi khung hình.
    if (now >= motionStage.scrollUntil) renderShader(now);
    updatePetals(now, delta);
  }

  motionStage.frame = requestAnimationFrame(motionLoop);
}

function startMotion() {
  if (motionStage.running || prefersReducedMotion()) return;

  motionStage.running = true;
  motionStage.last = performance.now();
  motionStage.scrollUntil = 0;
  motionStage.frame = requestAnimationFrame(motionLoop);
}

function stopMotion() {
  motionStage.running = false;
  cancelAnimationFrame(motionStage.frame);
}

function handleMotionPreferenceChange() {
  if (prefersReducedMotion()) {
    stopMotion();
    hideCursorGlow();
    resetTilt();
    resetHeroTilt();
    clearHeroTimer();
    document.querySelectorAll("[data-reveal]").forEach((item) => {
      item.classList.add("is-revealed");
    });
    if (petalStage.ready) {
      petalStage.ctx.clearRect(0, 0, petalStage.width, petalStage.height);
    }
  } else {
    startMotion();
    scheduleHeroRotation();
  }
}

/* =========================================================
   Menu
   ========================================================= */
function openMenu() {
  if (menuDialog.open) return;
  clearHeroTimer();
  menuDialog.showModal();
  menuToggle.setAttribute("aria-expanded", "true");
  syncBodyLock();
  menuClose.focus();
}

function closeMenu() {
  if (menuDialog.open) menuDialog.close();
}

/* =========================================================
   Scroll
   ========================================================= */
function handleScroll() {
  if (scrollFrame) return;

  scrollFrame = requestAnimationFrame(() => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(scrollTop / scrollable, 1) : 0;

    motionStage.scrollUntil = performance.now() + 140;

    scrollProgress.style.transform = `scaleX(${progress})`;
    siteHeader.classList.toggle("is-scrolled", scrollTop > 6);

    if (heroInner && !prefersReducedMotion() && finePointerQuery.matches) {
      setCssVar(heroInner, "--parallax", `${Math.min(scrollTop * 0.06, 46)}px`);
    }

    scrollFrame = 0;
  });
}

/* =========================================================
   Events
   ========================================================= */
filterChips.forEach((chip) => {
  chip.addEventListener("click", () => setQuality(chip.dataset.quality));
});

qualityRows.forEach((row) => {
  row.addEventListener("click", (event) => {
    const quality = row.dataset.quality;
    setQuality(state.activeQuality === quality ? "all" : quality);
    burstAtEvent(event, 12);
    scrollToCollection();
  });
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  syncSearchClear();

  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.page = 1;
    renderGallery();
  }, SEARCH_DEBOUNCE_MS);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  window.clearTimeout(searchTimer);
  state.search = searchInput.value;
  state.page = 1;
  syncSearchClear();
  renderGallery();
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  state.search = "";
  state.page = 1;
  syncSearchClear();
  renderGallery();
  searchInput.focus();
});

sortSelect.addEventListener("change", () => {
  state.sort = sortSelect.value;
  state.page = 1;
  renderGallery();
});

emptyReset.addEventListener("click", () => {
  resetFilters();
  searchInput.focus();
});

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  retryButton.textContent = "Đang tải…";
  await loadData();
  retryButton.disabled = false;
  retryButton.textContent = "Thử lại";
});

randomButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    burstAtEvent(event, 16);
    openRandomFlower();
  });
});

$("randomMenu").addEventListener("click", (event) => {
  burstFromButton(event.currentTarget);
  closeMenu();
  openRandomFlower();
});

flowerGrid.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const card = target ? target.closest(".flower-card") : null;
  if (!card) return;

  const flower = state.byId.get(card.dataset.id);
  if (!flower) return;

  burstAtEvent(event, 10);
  openFlowerDialog(flower, state.filtered.length ? state.filtered : state.flowers);
});

flowerGrid.addEventListener("pointermove", handleTiltMove);
flowerGrid.addEventListener("pointerleave", () => resetTilt());

heroArt.addEventListener("pointermove", handleHeroMove);
heroArt.addEventListener("pointerenter", (event) => {
  if (!finePointerQuery.matches || event.pointerType === "touch") return;
  heroStage.paused = true;
  clearHeroTimer();
});
heroArt.addEventListener("pointerleave", () => {
  resetHeroTilt();
  heroStage.paused = false;
  scheduleHeroRotation();
});

menuToggle.addEventListener("click", openMenu);
menuClose.addEventListener("click", closeMenu);

menuNav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", closeMenu);
});

menuDialog.addEventListener("click", (event) => {
  if (event.target === menuDialog) closeMenu();
});

menuDialog.addEventListener("close", () => {
  menuToggle.setAttribute("aria-expanded", "false");
  syncBodyLock();
  scheduleHeroRotation();
  if (!flowerDialog.open) menuToggle.focus();
});

lightboxClose.addEventListener("click", () => flowerDialog.close());
dialogPrev.addEventListener("click", () => stepDialog(-1));
dialogNext.addEventListener("click", () => stepDialog(1));

flowerDialog.addEventListener("click", (event) => {
  if (event.target === flowerDialog) flowerDialog.close();
});

flowerDialog.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepDialog(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    stepDialog(1);
  }
});

flowerDialog.addEventListener("close", () => {
  syncBodyLock();
  lightboxImage.onload = null;
  lightboxImage.onerror = null;
  lightboxImage.hidden = true;
  lightboxImage.style.opacity = "0";
  lightboxImage.removeAttribute("src");
  scheduleHeroRotation();
});

window.addEventListener("scroll", handleScroll, { passive: true });
window.addEventListener("resize", handleScroll);
window.addEventListener("resize", resizeShader);
window.addEventListener("resize", resizePetals);
window.addEventListener("pointermove", handleCursorMove, { passive: true });
window.addEventListener("blur", hideCursorGlow);
document.addEventListener("mouseleave", hideCursorGlow);

function handleMobilePageSize() {
  const nextSize = mobileQuery.matches ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
  if (nextSize === state.pageSize) return;
  state.pageSize = nextSize;
  if (state.ready) renderGallery();
}

if (typeof mobileQuery.addEventListener === "function") {
  mobileQuery.addEventListener("change", handleMobilePageSize);
} else if (typeof mobileQuery.addListener === "function") {
  mobileQuery.addListener(handleMobilePageSize);
}

if (typeof motionQuery.addEventListener === "function") {
  motionQuery.addEventListener("change", handleMotionPreferenceChange);
} else if (typeof motionQuery.addListener === "function") {
  motionQuery.addListener(handleMotionPreferenceChange);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshFlowersInBackground();
  scheduleHeroRotation();
});

window.addEventListener("focus", () => refreshFlowersInBackground());
window.addEventListener("online", () => {
  if (state.ready) {
    refreshFlowersInBackground(true);
  } else {
    loadData();
  }
});

window.setInterval(() => {
  if (!document.hidden) refreshFlowersInBackground();
}, REFRESH_INTERVAL_MS);

/* =========================================================
   Init
   ========================================================= */
buildStatementWords();
setupReveals();
setupHeroRotation();
initShader();
initPetals();
if (prefersReducedMotion()) renderShader(0);
else startMotion();

syncSearchClear();
syncQualityControls();
handleScroll();
loadData();
