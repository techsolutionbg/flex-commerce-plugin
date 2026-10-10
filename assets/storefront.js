import {
  requestCart,
  subscribeCart,
  getCartSnapshot,
} from "./cart.js?v=10";
import { openLightbox } from "/assets/flex-lightbox.js";
import { toastSuccess, toastError } from "./toast.js?v=3";
function notifySuccess(message) {
  if (typeof toastSuccess === "function") toastSuccess(message);
}
function notifyError(message) {
  if (typeof toastError === "function") toastError(message);
}
function productCardSkeletonHtml(count = 8) {
  const card =
    '<article class="commerce-product-card commerce-product-card-skeleton" aria-hidden="true"><div class="commerce-card-media"><div class="commerce-card-image"><span class="commerce-skeleton-block is-image"></span></div></div><div class="commerce-card-details"><span class="commerce-skeleton-block is-title"></span><span class="commerce-skeleton-block is-price"></span><span class="commerce-skeleton-block is-action" aria-hidden="true"><span></span><span></span><span></span></span></div></article>';
  return Array.from({ length: count }, () => card).join("");
}
function showProductGridSkeleton(grid, count = 8) {
  if (!grid) return;
  grid.innerHTML = productCardSkeletonHtml(count);
  grid.setAttribute("aria-busy", "true");
  grid.setAttribute("data-commerce-skeleton", "1");
  grid.removeAttribute("data-commerce-booting");
}
function clearProductGridSkeleton(grid) {
  if (!grid?.hasAttribute("data-commerce-skeleton")) return;
  grid.removeAttribute("aria-busy");
  grid.removeAttribute("data-commerce-skeleton");
}
function revealCatalogBootGrids() {
  for (const grid of document.querySelectorAll(".commerce-product-grid")) {
    const skeleton = grid.querySelector(":scope > [data-commerce-boot-skeleton]");
    const items = grid.querySelector(":scope > [data-commerce-boot-items]");
    if (!items) {
      grid.removeAttribute("data-commerce-booting");
      continue;
    }
    while (items.firstChild) grid.appendChild(items.firstChild);
    items.remove();
    skeleton?.remove();
    grid.querySelectorAll(":scope > script").forEach((node) => node.remove());
    grid.removeAttribute("data-commerce-booting");
    grid.removeAttribute("aria-busy");
    grid.removeAttribute("data-commerce-skeleton");
  }
}
const pageCleanups = [];
function cleanupStorefrontPage() {
  while (pageCleanups.length) pageCleanups.pop()();
}
function initializeProductGalleries() {
  for (const gallery of document.querySelectorAll("[data-commerce-gallery]")) {
    const main = gallery.querySelector("[data-commerce-main]");
    const opener = gallery.querySelector("[data-commerce-open]");
    if (!main || !opener || gallery.dataset.initialized) continue;
    gallery.dataset.initialized = "1";
    const hoverZoom = window.matchMedia("(hover: hover) and (pointer: fine)");
    let zoomFrame = 0,
      zoomPoint = null;
    function resetHoverZoom() {
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      zoomFrame = 0;
      zoomPoint = null;
      opener.classList.remove("is-hover-zoomed");
      main.style.removeProperty("transform-origin");
    }
    opener.addEventListener("pointermove", (event) => {
      if (
        !hoverZoom.matches ||
        event.pointerType !== "mouse" ||
        event.buttons ||
        !main.complete ||
        !main.naturalWidth
      )
        return;
      const bounds = opener.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      zoomPoint = {
        x: Math.max(
          0,
          Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100),
        ),
        y: Math.max(
          0,
          Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100),
        ),
      };
      if (zoomFrame) return;
      zoomFrame = requestAnimationFrame(() => {
        zoomFrame = 0;
        if (!zoomPoint) return;
        main.style.transformOrigin = zoomPoint.x + "% " + zoomPoint.y + "%";
        opener.classList.add("is-hover-zoomed");
      });
    });
    opener.addEventListener("pointerleave", resetHoverZoom);
    opener.addEventListener("pointercancel", resetHoverZoom);
    opener.addEventListener("blur", resetHoverZoom);
    main.addEventListener("error", resetHoverZoom);
    hoverZoom.addEventListener("change", resetHoverZoom);
    pageCleanups.push(() => {
      resetHoverZoom();
      hoverZoom.removeEventListener("change", resetHoverZoom);
    });
    opener.addEventListener("dragstart", (event) => event.preventDefault());
    for (const button of gallery.querySelectorAll(
      "[data-commerce-thumbnail]",
    )) {
      button.addEventListener("click", () => {
        resetHoverZoom();
        main.src = button.dataset.src;
        main.alt = button.dataset.alt || "";
        main.title = button.dataset.title || "";
        opener.href = button.dataset.src;
        gallery.querySelector("[data-commerce-caption]").textContent =
          button.dataset.caption || "";
        gallery.querySelector("[data-commerce-image-description]").textContent =
          button.dataset.description || "";
        for (const item of gallery.querySelectorAll(
          "[data-commerce-thumbnail]",
        ))
          item.setAttribute("aria-pressed", String(item === button));
      });
    }
    opener.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      if (
        typeof HTMLDialogElement === "undefined" ||
        !HTMLDialogElement.prototype.showModal
      )
        return;
      event.preventDefault();
      resetHoverZoom();
      const thumbnails = Array.from(
        gallery.querySelectorAll("[data-commerce-thumbnail]"),
      );
      const images = thumbnails.length
        ? thumbnails.map((button) => ({
            src: button.dataset.src,
            alt: button.dataset.alt || "",
            title: button.dataset.title || "",
            caption: button.dataset.caption || "",
            description: button.dataset.description || "",
            thumbnail: button.querySelector("img").src,
          }))
        : [
            {
              src: main.src,
              alt: main.alt,
              title: main.title,
              caption: gallery.querySelector("[data-commerce-caption]")
                .textContent,
              description: gallery.querySelector(
                "[data-commerce-image-description]",
              ).textContent,
            },
          ];
      openLightbox({
        images,
        position: Math.max(
          0,
          thumbnails.findIndex(
            (button) => button.getAttribute("aria-pressed") === "true",
          ),
        ),
        title:
          document.querySelector(".commerce-product-title")?.textContent ||
          main.title ||
          "Изображения на продукта",
        opener,
      });
    });
  }
}

// Column layout icons: list (1) and product-card grids (2–4).
const columnIconNodes = [
  // 1 column — stacked list rows
  [
    ["rect", { x: 3, y: 4, width: 18, height: 4, rx: 1 }],
    ["rect", { x: 3, y: 10, width: 18, height: 4, rx: 1 }],
    ["rect", { x: 3, y: 16, width: 18, height: 4, rx: 1 }],
  ],
  // 2 columns — 2×2 cards
  [
    ["rect", { x: 3, y: 3, width: 8, height: 8, rx: 1.5 }],
    ["rect", { x: 13, y: 3, width: 8, height: 8, rx: 1.5 }],
    ["rect", { x: 3, y: 13, width: 8, height: 8, rx: 1.5 }],
    ["rect", { x: 13, y: 13, width: 8, height: 8, rx: 1.5 }],
  ],
  // 3 columns
  [
    ["rect", { x: 2, y: 3, width: 5.5, height: 8, rx: 1.2 }],
    ["rect", { x: 9.25, y: 3, width: 5.5, height: 8, rx: 1.2 }],
    ["rect", { x: 16.5, y: 3, width: 5.5, height: 8, rx: 1.2 }],
    ["rect", { x: 2, y: 13, width: 5.5, height: 8, rx: 1.2 }],
    ["rect", { x: 9.25, y: 13, width: 5.5, height: 8, rx: 1.2 }],
    ["rect", { x: 16.5, y: 13, width: 5.5, height: 8, rx: 1.2 }],
  ],
  // 4 columns
  [
    ["rect", { x: 2, y: 3, width: 4, height: 8, rx: 1 }],
    ["rect", { x: 7.333, y: 3, width: 4, height: 8, rx: 1 }],
    ["rect", { x: 12.667, y: 3, width: 4, height: 8, rx: 1 }],
    ["rect", { x: 18, y: 3, width: 4, height: 8, rx: 1 }],
    ["rect", { x: 2, y: 13, width: 4, height: 8, rx: 1 }],
    ["rect", { x: 7.333, y: 13, width: 4, height: 8, rx: 1 }],
    ["rect", { x: 12.667, y: 13, width: 4, height: 8, rx: 1 }],
    ["rect", { x: 18, y: 13, width: 4, height: 8, rx: 1 }],
  ],
];
function initializeCatalogueColumns(runtime) {
  const { React } = runtime;
  function ColumnSelector({ section }) {
    const [selected, setSelected] = React.useState(() => {
      try {
        const value = Number(localStorage.getItem("flex-commerce-columns"));
        return [1, 2, 3, 4].includes(value) ? value : 4;
      } catch {
        return 4;
      }
    });
    const [maximum, setMaximum] = React.useState(4);
    React.useEffect(() => {
      const observer = new ResizeObserver(([entry]) =>
        setMaximum(
          entry.contentRect.width < 360
            ? 1
            : entry.contentRect.width < 600
              ? 2
              : window.innerWidth < 1200
                ? 3
                : 4,
        ),
      );
      observer.observe(section);
      return () => observer.disconnect();
    }, [section]);
    const effective = Math.min(selected, maximum);
    React.useEffect(() => {
      section.style.setProperty("--commerce-columns", String(effective));
      section.dataset.columns = String(effective);
      return () => {
        section.style.removeProperty("--commerce-columns");
        delete section.dataset.columns;
      };
    }, [effective, section]);
    function choose(value) {
      setSelected(value);
      try {
        localStorage.setItem("flex-commerce-columns", String(value));
      } catch {}
    }
    return React.createElement(
      "div",
      {
        className: "commerce-column-options",
        role: "group",
        "aria-label": "Брой колони с продукти",
      },
      [1, 2, 3, 4].map((count) =>
        React.createElement(
          "button",
          {
            key: count,
            type: "button",
            title: count === 1 ? "Една колона" : count + " колони",
            "aria-label": count === 1 ? "Една колона" : count + " колони",
            "aria-pressed": effective === count,
            disabled: count > maximum,
            onClick: () => choose(count),
          },
          React.createElement(
            "svg",
            {
              viewBox: "0 0 24 24",
              width: 20,
              height: 20,
              fill: "currentColor",
              "aria-hidden": true,
            },
            ...columnIconNodes[count - 1].map(([tag, attributes], index) =>
              React.createElement(tag, { ...attributes, key: index }),
            ),
          ),
        ),
      ),
    );
  }
  // Module can load more than once (?v= differs); share registration across instances.
  if (!window.__flexCommerceColumnsRegistered) {
    runtime.register("commerce.columns", ColumnSelector);
    window.__flexCommerceColumnsRegistered = true;
  }
  for (const element of document.querySelectorAll("[data-commerce-columns]")) {
    if (element.dataset.flexReactMounted) continue;
    pageCleanups.push(() => runtime.unmount(element));
    runtime.mount("commerce.columns", element, {
      section: element.closest(".commerce-products"),
    });
  }
}
if (window.FlexStorefront) initializeCatalogueColumns(window.FlexStorefront);
else
  window.addEventListener(
    "flex:storefront-ready",
    (event) => initializeCatalogueColumns(event.detail),
    { once: true },
  );

function initializeCatalogueSidebars() {
  for (const layout of document.querySelectorAll(".commerce-catalog-layout")) {
    if (layout.dataset.sidebarReady) continue;
    layout.dataset.sidebarReady = "1";
    const sidebar = layout.querySelector(".commerce-categories");
    const toggle = layout.querySelector(".commerce-sidebar-toggle");
    if (!sidebar || !toggle || !HTMLDialogElement.prototype.showModal) continue;
    const placeholder = document.createComment("catalogue sidebar");
    sidebar.before(placeholder);
    const dialog = document.createElement("dialog");
    dialog.className = "flex-commerce-storefront commerce-sidebar-dialog";
    dialog.setAttribute("aria-label", "Категории и филтри");
    const header = document.createElement("div");
    header.className = "commerce-sidebar-dialog-header";
    const title = document.createElement("span");
    title.textContent = "Категории и филтри";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Затвори категориите и филтрите");
    header.append(title, close);
    dialog.append(header);
    document.body.append(dialog);
    let previousOverflow = "";
    toggle.addEventListener("click", () => {
      previousOverflow = document.body.style.overflow;
      dialog.showModal();
      document.body.style.overflow = "hidden";
      toggle.setAttribute("aria-expanded", "true");
    });
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      const rect = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        dialog.close();
    });
    dialog.addEventListener("close", () => {
      document.body.style.overflow = previousOverflow;
      toggle.setAttribute("aria-expanded", "false");
      if (!toggle.hidden) toggle.focus();
    });
    const mobile = window.matchMedia("(max-width: 899px)");
    function updateSidebar() {
      if (dialog.open) dialog.close();
      toggle.hidden = !mobile.matches;
      toggle.setAttribute("aria-expanded", "false");
      layout.classList.toggle("has-sidebar-drawer", mobile.matches);
      if (mobile.matches) dialog.append(sidebar);
      else placeholder.after(sidebar);
    }
    mobile.addEventListener("change", updateSidebar);
    pageCleanups.push(() => {
      if (dialog.open) dialog.close();
      mobile.removeEventListener("change", updateSidebar);
      dialog.remove();
    });
    updateSidebar();
  }
}

function initializeProductTabs() {
  // Keep both sections readable without JavaScript; enhance them to accessible tabs.
  document.querySelectorAll("[data-commerce-product-tabs]").forEach((root) => {
    if (root.dataset.tabsReady) return;
    root.dataset.tabsReady = "1";
    const bar = root.querySelector(".commerce-tab-buttons");
    const buttons = Array.from(root.querySelectorAll("[data-commerce-tab]"));
    const panels = Array.from(root.querySelectorAll("[data-commerce-panel]"));
    bar.hidden = false;
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "Подробности за продукта");
    function select(index, focus = false) {
      buttons.forEach((button, i) => {
        button.setAttribute("aria-selected", String(i === index));
        button.tabIndex = i === index ? 0 : -1;
        panels[i].hidden = i !== index;
      });
      if (focus) buttons[index].focus();
    }
    buttons.forEach((button, index) => {
      button.id = panels[index].id + "-tab";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", panels[index].id);
      panels[index].setAttribute("role", "tabpanel");
      panels[index].setAttribute("aria-labelledby", button.id);
      panels[index].tabIndex = 0;
      button.addEventListener("click", () => select(index));
      button.addEventListener("keydown", (event) => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
        if (event.key === "ArrowLeft")
          next = (index + buttons.length - 1) % buttons.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next !== undefined) {
          event.preventDefault();
          select(next, true);
        }
      });
    });
    select(0);
  });
}

function initializeProductPurchases() {
  for (const form of document.querySelectorAll("[data-commerce-purchase]")) {
    if (form.dataset.purchaseReady) continue;
    form.dataset.purchaseReady = "1";
    const quantity = form.querySelector('[name="quantity"]');
    const submit = form.querySelector('[type="submit"]');
    const quickOrder = form.querySelector("[data-commerce-quick-order]");
    const submitLabel =
      submit.querySelector("[data-commerce-cart-label]") || submit;
    const quickOrderLabel =
      quickOrder?.querySelector("[data-commerce-cart-label]") || quickOrder;
    const controls = Array.from(
      form.querySelectorAll("[data-quantity-change]"),
    );
    const hint = form.querySelector("[data-commerce-quantity-hint]");
    const status = form.querySelector("[data-commerce-purchase-status]");
    const productId = Number(form.dataset.productId);
    let remaining = Number(form.dataset.stock),
      busy = true,
      cart = { items: [], count: 0 };
    function update(data) {
      cart = data.cart || cart;
      const item = cart.items.find((item) => item.id === productId);
      const stock = Number.isInteger(data.stock)
        ? data.stock
        : Number(form.dataset.stock);
      form.dataset.stock = String(stock);
      remaining = Math.max(0, stock - (item?.quantity || 0));
      quantity.max = String(remaining);
      quantity.value = remaining
        ? String(Math.min(remaining, Math.max(1, Number(quantity.value) || 1)))
        : "0";
      hint.textContent =
        (item ? "В количката: " + item.quantity + " бр. · " : "") +
        (remaining
          ? "Можете да добавите до " + remaining + " бр."
          : "Няма повече налични бройки за добавяне.");
      refresh();
    }
    function refresh() {
      const value = Number(quantity.value);
      const blocked =
        busy ||
        remaining === 0 ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > remaining;
      quantity.disabled = busy || remaining === 0;
      submit.disabled = blocked;
      if (quickOrder) quickOrder.disabled = blocked;
      controls[0].disabled = busy || value <= 1 || remaining === 0;
      controls[1].disabled = busy || value >= remaining || remaining === 0;
      form.setAttribute("aria-busy", String(busy));
    }
    async function request(body) {
      const result = await requestCart(body, productId);
      update(result);
      return result;
    }
    async function addToCart({ redirect = false } = {}) {
      if (busy || !form.reportValidity()) return;
      busy = true;
      refresh();
      status.textContent = "";
      const active = redirect && quickOrder ? quickOrder : submit;
      const label = redirect ? quickOrderLabel : submitLabel;
      const readyText = redirect ? "Бърза поръчка" : "Добавяне";
      let leaving = false;
      if (label) label.textContent = "Добавяне…";
      active?.setAttribute("aria-busy", "true");
      try {
        await request({
          product_id: productId,
          quantity: Number(quantity.value),
        });
        if (redirect) {
          leaving = true;
          window.location.assign("/cart");
          return;
        }
        notifySuccess("Продуктът е добавен в количката.");
      } catch (error) {
        const message =
          error.message || "Неуспешно добавяне. Опитайте отново.";
        status.textContent = message;
        notifyError(message);
      } finally {
        if (leaving) return;
        busy = false;
        if (label) label.textContent = readyText;
        active?.removeAttribute("aria-busy");
        refresh();
      }
    }
    const unsubscribe = subscribeCart(() => {
      const snapshot = getCartSnapshot();
      if (snapshot.loaded) {
        const item = snapshot.cart.items.find((item) => item.id === productId);
        update({
          cart: snapshot.cart,
          stock: item?.stock ?? Number(form.dataset.stock),
        });
      }
    });
    pageCleanups.push(unsubscribe);
    quantity.addEventListener("input", refresh);
    controls.forEach((control) =>
      control.addEventListener("click", () => {
        quantity.value = String(
          Math.min(
            remaining,
            Math.max(
              1,
              Number(quantity.value) + Number(control.dataset.quantityChange),
            ),
          ),
        );
        refresh();
      }),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      addToCart();
    });
    quickOrder?.addEventListener("click", () => addToCart({ redirect: true }));
    request()
      .then(() => {
        busy = false;
        refresh();
      })
      .catch(() => {
        status.textContent =
          "Не можем да заредим количката. Презаредете страницата и опитайте отново.";
        hint.textContent = ""; // Keep purchase disabled until the server has confirmed the session.
      });
  }
}

function initializeCatalogFilters() {
  for (const form of document.querySelectorAll(
    "form.commerce-filters[data-commerce-live-filters]",
  )) {
    if (form.dataset.liveFiltersReady) continue;
    form.dataset.liveFiltersReady = "1";
    let debounceTimer = 0;
    const moneyPattern = /^\d{1,8}(?:[.,]\d{1,2})?$/;
    function priceInputsReady() {
      for (const input of form.querySelectorAll(
        'input[name="min_price"], input[name="max_price"]',
      )) {
        const value = input.value.trim();
        if (value !== "" && !moneyPattern.test(value)) return false;
      }
      return true;
    }
    function applyFilters() {
      if (!priceInputsReady()) return;
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
    form.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !form.contains(target)) return;
      if (target.matches('input[name="min_price"], input[name="max_price"]'))
        return;
      clearTimeout(debounceTimer);
      applyFilters();
    });
    form.addEventListener("input", (event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLInputElement) ||
        !target.matches('input[name="min_price"], input[name="max_price"]')
      )
        return;
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(applyFilters, 350);
    });
    pageCleanups.push(() => {
      clearTimeout(debounceTimer);
      delete form.dataset.liveFiltersReady;
    });
  }
}

function initializeCatalogPagination() {
  if (!/^\/catalog(?:\/category\/|$)/.test(location.pathname)) return;
  if (!new URLSearchParams(location.search).has("page")) return;
  const target = document.getElementById("commerce-catalog-results");
  if (!target) return;
  target.scrollIntoView({ block: "start", behavior: "smooth" });
}

function initializeStorefrontPage() {
  revealCatalogBootGrids();
  initializeProductGalleries();
  initializeCatalogueSidebars();
  initializeCatalogFilters();
  initializeCatalogPagination();
  initializeProductTabs();
  initializeProductPurchases();
}
initializeStorefrontPage();

document.addEventListener("flex:page-before-change", cleanupStorefrontPage);
document.addEventListener("flex:page-ready", () => {
  initializeStorefrontPage();
  if (window.FlexStorefront) initializeCatalogueColumns(window.FlexStorefront);
  document.dispatchEvent(new CustomEvent("commerce:catalogue-updated"));
});

// Visitor favourites are kept on this device until customer accounts are available.
const favouritesKey = "flex-commerce-favourites";
function readFavourites() {
  try {
    const saved = JSON.parse(localStorage.getItem(favouritesKey) || "[]");
    return new Set(
      Array.isArray(saved)
        ? saved
            .filter((id) => Number.isSafeInteger(id) && id > 0)
            .slice(0, 1000)
        : [],
    );
  } catch {
    return new Set();
  }
}
let favourites = readFavourites();
const favouriteStatus = document.createElement("p");
favouriteStatus.className = "visually-hidden";
favouriteStatus.setAttribute("role", "status");
document.body.append(favouriteStatus);
function refreshFavourites() {
  for (const badge of document.querySelectorAll(
    "[data-commerce-favourites-count]",
  )) {
    badge.textContent = String(favourites.size);
    badge.hidden = favourites.size === 0;
  }
  for (const link of document.querySelectorAll(
    "[data-commerce-favourites-link]",
  ))
    link.setAttribute("aria-label", "Любими (" + favourites.size + ")");
  const root = document.querySelector("[data-commerce-favourites]");
  if (root) {
    for (const card of root.querySelectorAll(
      ".commerce-product-card:not(.commerce-product-card-skeleton)",
    )) {
      const button = card.querySelector("[data-commerce-favorite]");
      if (!button) continue;
      if (!favourites.has(Number(button.dataset.commerceFavorite)))
        card.remove();
    }
    if (root.dataset.loaded) syncFavouritesToolbar(root);
  }
  for (const button of document.querySelectorAll("[data-commerce-favorite]")) {
    const selected = favourites.has(Number(button.dataset.commerceFavorite));
    const action = selected ? "Премахни" : "Добави";
    button.disabled = false;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute(
      "aria-label",
      action +
        " " +
        button.dataset.productName +
        (selected ? " от любими" : " към любими"),
    );
    button.title = selected ? "Премахни от любими" : "Добави към любими";
  }
}
document.addEventListener("click", (event) => {
  const clearAll = event.target.closest("[data-favourites-clear]");
  if (clearAll) {
    favourites = readFavourites();
    if (!favourites.size) return;
    if (
      !window.confirm(
        "Сигурни ли сте, че искате да премахнете всички любими продукти?",
      )
    )
      return;
    favourites = new Set();
    try {
      localStorage.setItem(favouritesKey, JSON.stringify([]));
    } catch {
      favourites = readFavourites();
      favouriteStatus.textContent =
        "Любимите не могат да се запазят в този браузър.";
      notifyError("Любимите не могат да се запазят в този браузър.");
      refreshFavourites();
      return;
    }
    refreshFavourites();
    favouriteStatus.textContent = "Всички любими продукти са премахнати.";
    notifySuccess("Всички любими продукти са премахнати.");
    return;
  }
  const button = event.target.closest("[data-commerce-favorite]");
  if (!button || button.disabled) return;
  const id = Number(button.dataset.commerceFavorite);
  if (!Number.isSafeInteger(id) || id < 1) return;
  favourites = readFavourites();
  const selected = !favourites.has(id);
  if (selected && favourites.size >= 1000) {
    const message = "Достигнат е лимитът от 1000 любими продукта.";
    favouriteStatus.textContent = message;
    notifyError(message);
    return;
  }
  if (selected) favourites.add(id);
  else favourites.delete(id);
  try {
    localStorage.setItem(favouritesKey, JSON.stringify([...favourites]));
  } catch {
    favourites = readFavourites();
    const message = "Любимите не могат да се запазят в този браузър.";
    favouriteStatus.textContent = message;
    notifyError(message);
    refreshFavourites();
    return;
  }
  refreshFavourites();
  const message =
    button.dataset.productName +
    (selected ? " е добавен към любими." : " е премахнат от любими.");
  favouriteStatus.textContent = message;
  notifySuccess(message);
});
window.addEventListener("storage", (event) => {
  if (event.key === favouritesKey || event.key === null) {
    favourites = readFavourites();
    refreshFavourites();
    loadFavourites();
  }
});
document.addEventListener("flex:page-ready", () => {
  favourites = readFavourites();
  refreshFavourites();
  loadFavourites();
});
let favouritesRequestSequence = 0;
function syncFavouritesToolbar(root) {
  if (!root?.dataset.loaded) return;
  const cards = root.querySelectorAll(
    ".commerce-product-card:not(.commerce-product-card-skeleton)",
  );
  const empty = cards.length === 0;
  const toolbar = root.querySelector(".commerce-products-toolbar");
  const status = root.querySelector("[data-favourites-status]");
  const columns = root.querySelector("[data-commerce-columns]");
  const clear = root.querySelector("[data-favourites-clear]");
  root.querySelector("[data-favourites-empty]").hidden = !empty;
  if (toolbar) toolbar.hidden = empty;
  if (status) {
    status.hidden = empty;
    if (!empty) status.textContent = cards.length + " любими продукта";
  }
  if (columns) columns.hidden = empty;
  if (clear) clear.hidden = empty;
}
refreshFavourites();
loadFavourites();
async function loadFavourites() {
  const root = document.querySelector("[data-commerce-favourites]");
  if (!root) return;
  const sequence = ++favouritesRequestSequence;
  const requestedIds = [...readFavourites()].join(",");
  const status = root.querySelector("[data-favourites-status]");
  const retry = root.querySelector("[data-favourites-retry]");
  const toolbar = root.querySelector(".commerce-products-toolbar");
  const grid = root.querySelector("[data-favourites-grid]");
  const empty = root.querySelector("[data-favourites-empty]");
  retry.onclick = loadFavourites;
  retry.hidden = true;
  if (toolbar) toolbar.hidden = false;
  if (status) {
    status.hidden = false;
    status.textContent = "Зареждане на любимите…";
  }
  if (empty) empty.hidden = true;
  showProductGridSkeleton(grid, requestedIds ? 8 : 4);
  delete root.dataset.loaded;
  root.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(
      "/plugins/flex/commerce/favourites/data?ids=" +
        encodeURIComponent(requestedIds),
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (!response.ok)
      throw new Error("Не можем да заредим любимите. Опитайте отново.");
    const data = await response.json();
    if (!root.isConnected || sequence !== favouritesRequestSequence) return;
    if (requestedIds !== [...readFavourites()].join(",")) {
      loadFavourites();
      return;
    }
    clearProductGridSkeleton(grid);
    grid.innerHTML = data.html;
    // Remove references to products which are no longer publicly available.
    favourites = new Set(data.ids.filter((id) => readFavourites().has(id)));
    try {
      localStorage.setItem(favouritesKey, JSON.stringify([...favourites]));
    } catch {}
    root.dataset.loaded = "1";
    refreshFavourites();
    document.dispatchEvent(new CustomEvent("commerce:catalogue-updated"));
  } catch (error) {
    if (!root.isConnected || sequence !== favouritesRequestSequence) return;
    clearProductGridSkeleton(grid);
    grid.replaceChildren();
    status.textContent = error.message;
    status.hidden = false;
    if (toolbar) toolbar.hidden = false;
    retry.hidden = false;
  } finally {
    if (sequence === favouritesRequestSequence)
      root.removeAttribute("aria-busy");
  }
}
document.addEventListener("flex:page-loading", (event) => {
  if (event.detail !== true) return;
  const layout = document.querySelector(
    ".commerce-catalog-layout:not(.commerce-catalog-layout--favourites)",
  );
  if (!layout) return;
  const grid = layout.querySelector(".commerce-product-grid");
  const results = layout.querySelector(".commerce-results");
  const empty = layout.querySelector(".commerce-empty");
  const pagination = layout.querySelector(".commerce-pagination");
  if (empty) empty.hidden = true;
  if (pagination) pagination.hidden = true;
  if (results) results.textContent = "Зареждане…";
  const columns = Number(
    layout.querySelector(".commerce-products")?.dataset.columns || 4,
  );
  const count = columns <= 1 ? 4 : Math.max(columns * 2, 8);
  showProductGridSkeleton(grid, count);
});

let activePreview = null;
let activePreviewSlug = "";
let syncingPreviewUrl = false;
function previewSlugFromUrl() {
  return new URL(location.href).searchParams.get("preview") || "";
}
function writePreviewUrl(slug) {
  const url = new URL(location.href);
  if (slug) url.searchParams.set("preview", slug);
  else url.searchParams.delete("preview");
  const next = url.pathname + url.search + url.hash;
  const current =
    location.pathname + location.search + location.hash;
  if (next === current) return;
  syncingPreviewUrl = true;
  history.pushState(
    {
      ...(history.state && typeof history.state === "object" ? history.state : {}),
      commercePreviewOnly: true,
      commercePreview: slug || null,
    },
    "",
    next,
  );
  syncingPreviewUrl = false;
}
async function openQuickView(slug, { opener = null, syncUrl = true } = {}) {
  if (!slug || typeof slug !== "string") return;
  const productUrl = "/product/" + encodeURIComponent(slug);
  if (
    typeof HTMLDialogElement === "undefined" ||
    !HTMLDialogElement.prototype.showModal
  ) {
    window.location.href = productUrl;
    return;
  }
  if (activePreview && activePreviewSlug === slug) return;
  activePreview?.close();
  const escaped =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(slug)
      : slug.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const trigger =
    opener ||
    document.querySelector('[data-commerce-preview="' + escaped + '"]');
  const dialog = document.createElement("dialog");
  dialog.className = "commerce-quick-view flex-commerce-storefront";
  dialog.setAttribute("aria-label", "Бърз преглед на продукта");
  dialog.dataset.commercePreviewSlug = slug;
  dialog.innerHTML =
    '<button type="button" class="commerce-preview-close" aria-label="Затвори бързия преглед"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><div class="commerce-preview-content" aria-live="polite" aria-busy="true"><div class="commerce-preview-skeleton" role="status" aria-label="Зареждане на продукта"><div class="commerce-product-layout"><div class="commerce-preview-skeleton-media" aria-hidden="true"></div><div class="commerce-preview-skeleton-summary" aria-hidden="true"><span class="commerce-preview-skeleton-line is-title"></span><span class="commerce-preview-skeleton-line is-price"></span><span class="commerce-preview-skeleton-line is-meta"></span><span class="commerce-preview-skeleton-line is-button"></span><span class="commerce-preview-skeleton-line is-link"></span></div></div><span class="visually-hidden">Зареждане на продукта…</span></div></div>';
  const content = dialog.querySelector(".commerce-preview-content");
  const controller = new AbortController();
  const previousOverflow = document.documentElement.style.overflow;
  let cleanups = [];
  dialog.addEventListener(
    "close",
    () => {
      controller.abort();
      for (const cleanup of cleanups) {
        const index = pageCleanups.indexOf(cleanup);
        if (index >= 0) {
          pageCleanups.splice(index, 1);
          cleanup();
        }
      }
      dialog.remove();
      document.documentElement.style.overflow = previousOverflow;
      if (activePreview === dialog) {
        activePreview = null;
        activePreviewSlug = "";
      }
      if (!syncingPreviewUrl && previewSlugFromUrl() === slug)
        writePreviewUrl("");
      if (trigger?.isConnected) trigger.focus();
    },
    { once: true },
  );
  dialog
    .querySelector("button")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      dialog.close();
  });
  document.body.append(dialog);
  activePreview = dialog;
  activePreviewSlug = slug;
  dialog.showModal();
  document.documentElement.style.overflow = "hidden";
  if (syncUrl && previewSlugFromUrl() !== slug) writePreviewUrl(slug);
  try {
    const response = await fetch(
      "/plugins/flex/commerce/preview/" + encodeURIComponent(slug),
      { signal: controller.signal, headers: { Accept: "application/json" } },
    );
    const data = await response.json();
    if (!response.ok || typeof data.html !== "string")
      throw new Error(data.error || "Продуктът не може да бъде зареден.");
    if (!dialog.isConnected) return;
    content.removeAttribute("aria-busy");
    content.innerHTML = data.html;
    if (!content.querySelector("[data-commerce-favorite]")) {
      const favorite = trigger
        ?.closest(".commerce-product-card")
        ?.querySelector("[data-commerce-favorite]")
        ?.cloneNode(true);
      if (favorite) {
        favorite.classList.add("commerce-preview-favorite");
        favorite.classList.remove("commerce-card-favorite");
        const actions = content.querySelector(".commerce-purchase-actions");
        const summary = content.querySelector(".commerce-product-summary");
        if (actions) actions.append(favorite);
        else summary?.append(favorite);
      }
    }
    refreshFavourites();
    const start = pageCleanups.length;
    initializeProductGalleries();
    initializeProductTabs();
    initializeProductPurchases();
    cleanups = pageCleanups.slice(start);
  } catch (error) {
    if (controller.signal.aborted) return;
    content.removeAttribute("aria-busy");
    content.replaceChildren();
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = error.message || "Неуспешно зареждане.";
    const link = document.createElement("a");
    link.href = productUrl;
    link.textContent = "Отвори продуктовата страница";
    content.append(message, link);
  }
}
function syncPreviewFromUrl() {
  const slug = previewSlugFromUrl();
  if (slug) {
    if (activePreviewSlug !== slug) openQuickView(slug, { syncUrl: false });
    return;
  }
  if (activePreview) {
    syncingPreviewUrl = true;
    activePreview.close();
    syncingPreviewUrl = false;
  }
}
document.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-commerce-preview]");
  if (!opener) return;
  event.preventDefault();
  openQuickView(opener.dataset.commercePreview, { opener });
});
document.addEventListener("commerce:preview-url", syncPreviewFromUrl);
document.addEventListener("flex:page-before-change", () => {
  syncingPreviewUrl = true;
  activePreview?.close();
  syncingPreviewUrl = false;
});
document.addEventListener("flex:page-ready", syncPreviewFromUrl);
syncPreviewFromUrl();
