import { toastSuccess, toastError } from "./toast.js?v=3";

const endpoint = "/plugins/flex/commerce/cart/data";
let state = {
  cart: { items: [], count: 0, totals: [] },
  busy: false,
  loaded: false,
  error: "",
};
let csrf = "",
  queue = Promise.resolve(),
  runtime = null,
  drawer = null;
const listeners = new Set();
export function getCartSnapshot() {
  return state;
}
export function subscribeCart(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
  updateBadge();
  if (Object.prototype.hasOwnProperty.call(patch, "cart") && typeof CustomEvent === "function") {
    window.dispatchEvent?.(new CustomEvent("flex-commerce-cart", { detail: state.cart }));
  }
}
function updateBadge() {
  document.querySelectorAll("[data-commerce-cart-add]").forEach((button) => {
    const item = state.cart.items.find(
      (item) => item.id === Number(button.dataset.commerceCartAdd),
    );
    button.disabled =
      state.busy ||
      !state.loaded ||
      button.dataset.available !== "1" ||
      item?.remaining === 0;
  });
  document.querySelectorAll("[data-commerce-cart-count]").forEach((badge) => {
    badge.textContent = String(state.cart.count);
    badge.hidden = state.cart.count === 0;
  });
  document.querySelectorAll("[data-commerce-cart-open]").forEach((button) => {
    button.setAttribute("aria-label", "Количка (" + state.cart.count + ")");
  });
}
async function fetchCart(body, productId) {
  const response = await fetch(endpoint + "?product_id=" + productId, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body
        ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  csrf = result.csrf_token || csrf;
  if (result.cart) emit({ cart: result.cart, loaded: true });
  if (!response.ok)
    throw new Error(
      result.error?.message ||
        "Неуспешна заявка. Презаредете страницата и опитайте отново.",
    );
  return result;
}
const channel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("flex-commerce-cart")
    : null;
export function requestCart(body = null, productId = 0) {
  const task = queue
    .catch(() => {})
    .then(async () => {
      emit({ busy: true, error: "" });
      try {
        if (body && !csrf) await fetchCart(null, productId);
        const result = await fetchCart(body, productId);
        if (body) channel?.postMessage("changed");
        return result;
      } catch (error) {
        emit({ error: error.message || "Количката не може да бъде заредена." });
        throw error;
      } finally {
        emit({ busy: false });
      }
    });
  queue = task;
  return task;
}
channel?.addEventListener("message", () => requestCart().catch(() => {}));
window.addEventListener("focus", () => requestCart().catch(() => {}));
// Revalidate current prices and stock while a cart surface is visible.
setInterval(() => {
  if (
    document.visibilityState === "visible" &&
    !state.busy &&
    (drawer?.open || document.querySelector("[data-commerce-cart-page]"))
  )
    requestCart().catch(() => {});
}, 15000);

export async function openCart(opener) {
  if (!runtime) {
    opener?.setAttribute("aria-busy", "true");
    const rt = await storefrontRuntime();
    opener?.removeAttribute("aria-busy");
    if (!rt) {
      window.location.href = "/cart";
      return;
    }
    initialize(rt);
  }
  if (drawer?.open) return;
  drawer = document.createElement("dialog");
  drawer.className = "commerce-cart-drawer";
  drawer.setAttribute("aria-label", "Вашата количка");
  const root = document.createElement("div");
  drawer.append(root);
  document.body.append(drawer);
  const overflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  let closing = false;
  function finishClose() {
    if (!drawer?.open) return;
    drawer.close();
  }
  function closeDrawer() {
    if (!drawer || closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClose();
      return;
    }
    closing = true;
    drawer.classList.add("is-closing");
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      drawer.removeEventListener("animationend", onEnd);
      finishClose();
    };
    const onEnd = (event) => {
      if (event.target !== drawer) return;
      if (event.animationName && event.animationName !== "commerce-cart-exit")
        return;
      settle();
    };
    drawer.addEventListener("animationend", onEnd);
    setTimeout(settle, 280);
  }
  runtime.mount("commerce.cart", root, {
    drawer: true,
    close: closeDrawer,
  });
  drawer.addEventListener(
    "close",
    () => {
      runtime.unmount(root);
      drawer.remove();
      drawer = null;
      document.body.style.overflow = overflow;
      if (opener?.isConnected && !opener.hidden) opener.focus();
    },
    { once: true },
  );
  drawer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer();
  });
  drawer.addEventListener("click", (event) => {
    const rect = drawer.getBoundingClientRect();
    if (
      event.target === drawer &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      closeDrawer();
  });
  drawer.showModal();
  requestCart().catch(() => {});
}
function initialize(rt) {
  if (runtime || window.__flexCommerceCartReady) return;
  window.__flexCommerceCartReady = true;
  runtime = rt;
  const { React } = rt,
    h = React.createElement;
  function Quantity({ item, busy }) {
    const [draft, setDraft] = React.useState(String(item.quantity));
    const editing = React.useRef(false);
    const pendingEdit = React.useRef(null);
    React.useEffect(() => () => clearTimeout(pendingEdit.current), []);
    React.useEffect(() => {
      if (!editing.current) setDraft(String(item.quantity));
    }, [item.quantity]);
    function save(value) {
      clearTimeout(pendingEdit.current);
      if (busy) return;
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1 || number > item.stock) {
        setDraft(String(item.quantity));
        emit({ error: "Въведете количество от 1 до " + item.stock + " бр." });
        return;
      }
      editing.current = false;
      if (number !== item.quantity)
        requestCart({
          action: "set",
          product_id: item.id,
          quantity: number,
        }).catch(() =>
          setDraft(
            String(
              state.cart.items.find((row) => row.id === item.id)?.quantity ??
                item.quantity,
            ),
          ),
        );
    }
    return h(
      "div",
      { className: "commerce-quantity-controls" },
      h(
        "button",
        {
          type: "button",
          disabled: busy || item.quantity <= 1,
          "aria-label": "Намали количеството на " + item.name,
          onClick: () => save(item.quantity - 1),
        },
        "−",
      ),
      h("input", {
        type: "number",
        min: 1,
        max: item.stock,
        step: 1,
        inputMode: "numeric",
        value: draft,
        disabled: busy,
        "aria-label": "Количество за " + item.name,
        onFocus: () => {
          editing.current = true;
        },
        onChange: (event) => {
          const value = event.target.value;
          setDraft(value);
          clearTimeout(pendingEdit.current);
          if (
            value &&
            Number.isInteger(Number(value)) &&
            Number(value) >= 1 &&
            Number(value) <= item.stock
          )
            pendingEdit.current = setTimeout(() => save(value), 450);
        },
        onBlur: () => {
          editing.current = false;
          save(draft);
        },
        onKeyDown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        },
      }),
      h(
        "button",
        {
          type: "button",
          disabled: busy || item.quantity >= item.stock,
          "aria-label": "Увеличи количеството на " + item.name,
          onClick: () => save(item.quantity + 1),
        },
        "+",
      ),
    );
  }
  function CartTable({ cart, busy }) {
    const [removingId, setRemovingId] = React.useState(null);
    async function removeItem(item) {
      if (busy || removingId !== null) return;
      setRemovingId(item.id);
      try {
        await requestCart({ action: "remove", product_id: item.id });
      } catch {
        /* cart error state already set by requestCart */
      } finally {
        setRemovingId(null);
      }
    }
    return h(
      "div",
      { className: "commerce-cart-table-box" },
      h(
        "table",
        { className: "commerce-cart-table" },
        h("caption", { className: "visually-hidden" }, "Продукти в количката"),
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", { scope: "col" }, "Продукт"),
            h("th", { scope: "col" }, "Цена"),
            h("th", { scope: "col" }, "Количество"),
            h("th", { scope: "col" }, "Сума"),
            h(
              "th",
              { scope: "col" },
              h("span", { className: "visually-hidden" }, "Премахване"),
            ),
          ),
        ),
        h(
          "tbody",
          null,
          cart.items.map((item) => {
            const removing = removingId === item.id;
            return h(
              "tr",
              { key: item.id },
              h(
                "td",
                { className: "commerce-cart-product-cell" },
                h(
                  "div",
                  { className: "commerce-cart-product-info" },
                  h(
                    "a",
                    {
                      href: item.url,
                      className: "commerce-cart-image",
                      tabIndex: -1,
                      "aria-hidden": true,
                    },
                    item.image &&
                      h("img", {
                        src: item.image,
                        alt: "",
                        width: 96,
                        height: 96,
                        loading: "lazy",
                      }),
                  ),
                  h(
                    "a",
                    { href: item.url, className: "commerce-cart-name" },
                    item.name,
                  ),
                ),
              ),
              h(
                "td",
                { className: "commerce-cart-unit-cell", "data-label": "Цена" },
                item.price + " " + item.currency,
              ),
              h(
                "td",
                {
                  className: "commerce-cart-quantity-cell",
                  "data-label": "Количество",
                },
                h(Quantity, { item, busy }),
              ),
              h(
                "td",
                { className: "commerce-cart-sum-cell", "data-label": "Сума" },
                item.line_total + " " + item.currency,
              ),
              h(
                "td",
                { className: "commerce-cart-remove-cell" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "commerce-cart-table-remove",
                    disabled: busy || removingId !== null,
                    "aria-busy": removing ? "true" : undefined,
                    "aria-label": removing
                      ? "Премахване на " + item.name
                      : "Премахни " + item.name,
                    title: "Премахни продукта",
                    onClick: () => removeItem(item),
                  },
                  removing
                    ? h("span", {
                        className: "commerce-cart-remove-spinner",
                        "aria-hidden": true,
                      })
                    : h(
                        "svg",
                        {
                          viewBox: "0 0 24 24",
                          width: 22,
                          height: 22,
                          fill: "none",
                          stroke: "currentColor",
                          strokeWidth: 2.4,
                          strokeLinecap: "round",
                          "aria-hidden": true,
                        },
                        h("path", { d: "M6 6l12 12M18 6L6 18" }),
                      ),
                ),
              ),
            );
          }),
        ),
      ),
      h(
        "footer",
        { className: "commerce-cart-table-footer" },
        h("a", { href: "/catalog" }, "← Продължи пазаруването"),
        h("span", null, "Промените се запазват автоматично."),
      ),
    );
  }
  function CartSkeleton({ drawer: isDrawer = false }) {
    const rows = isDrawer ? 2 : 3;
    return h(
      "div",
      {
        className:
          "commerce-cart-skeleton" + (isDrawer ? " is-drawer" : " is-page"),
        role: "status",
        "aria-label": "Зареждане на количката",
      },
      h(
        "div",
        { className: "commerce-cart-layout", "aria-hidden": true },
        h(
          "div",
          { className: "commerce-cart-skeleton-main" },
          !isDrawer &&
            h("span", { className: "commerce-cart-skeleton-line is-feedback" }),
          Array.from({ length: rows }, (_, index) =>
            h(
              "div",
              { className: "commerce-cart-skeleton-row", key: index },
              h("span", { className: "commerce-cart-skeleton-media" }),
              h(
                "span",
                { className: "commerce-cart-skeleton-copy" },
                h("span", { className: "commerce-cart-skeleton-line is-name" }),
                h("span", { className: "commerce-cart-skeleton-line is-price" }),
                h("span", { className: "commerce-cart-skeleton-line is-qty" }),
              ),
              h("span", { className: "commerce-cart-skeleton-line is-total" }),
            ),
          ),
        ),
        h(
          "aside",
          { className: "commerce-cart-skeleton-summary" },
          h("span", { className: "commerce-cart-skeleton-line is-heading" }),
          h("span", { className: "commerce-cart-skeleton-line is-sum" }),
          h("span", { className: "commerce-cart-skeleton-line is-note" }),
          h("span", { className: "commerce-cart-skeleton-line is-button" }),
          h("span", { className: "commerce-cart-skeleton-line is-link" }),
        ),
      ),
      h("span", { className: "visually-hidden" }, "Зареждане на количката…"),
    );
  }
  function Cart({ drawer: isDrawer = false, close }) {
    const snapshot = React.useSyncExternalStore(subscribeCart, () => state);
    const { cart, busy, loaded, error } = snapshot;
    const [checkoutPending, setCheckoutPending] = React.useState(false);
    return h(
      "div",
      {
        className: isDrawer
          ? "commerce-cart-content is-drawer"
          : "commerce-cart-content is-page",
        "aria-busy": busy || !loaded || checkoutPending,
      },
      isDrawer &&
        h(
          "header",
          { className: "commerce-cart-header" },
          h("h2", null, "Вашата количка"),
          h(
            "button",
            {
              type: "button",
              className: "commerce-cart-close",
              onClick: close,
              "aria-label": "Затвори количката",
              autoFocus: true,
            },
            "×",
          ),
        ),
      !loaded
        ? h(CartSkeleton, { drawer: isDrawer })
        : h(
            React.Fragment,
            null,
            h(
              "p",
              {
                className: "commerce-cart-feedback",
                role: "status",
                "aria-live": "polite",
              },
              error ||
                (busy
                  ? "Обновяване…"
                  : cart.count + " бр. в количката"),
            ),
            !cart.items.length
              ? h(
                  "div",
                  { className: "commerce-cart-empty" },
                  h("h2", null, "Количката е празна"),
                  h(
                    "p",
                    null,
                    "Разгледайте продуктите и добавете нещо, което харесвате.",
                  ),
                  h(
                    "a",
                    { href: "/catalog", className: "flex-btn flex-btn--primary commerce-cart-primary" },
                    "Към каталога",
                  ),
                )
              : h(
                  "div",
                  { className: "commerce-cart-layout" },
                  isDrawer
                    ? h(
                        "div",
                        { className: "commerce-cart-items" },
                        cart.items.map((item) =>
                          h(
                            "article",
                            { className: "commerce-cart-row", key: item.id },
                            h(
                              "a",
                              {
                                href: item.url,
                                className: "commerce-cart-image",
                                tabIndex: -1,
                                "aria-hidden": true,
                              },
                              item.image
                                ? h("img", {
                                    src: item.image,
                                    alt: "",
                                    loading: "lazy",
                                    width: 96,
                                    height: 96,
                                  })
                                : null,
                            ),
                            h(
                              "div",
                              { className: "commerce-cart-details" },
                              h(
                                "a",
                                {
                                  href: item.url,
                                  className: "commerce-cart-name",
                                },
                                item.name,
                              ),
                              h(
                                "p",
                                null,
                                item.price + " " + item.currency + " / бр.",
                              ),
                              h(Quantity, { item, busy }),
                              h(
                                "button",
                                {
                                  type: "button",
                                  className: "commerce-cart-remove",
                                  disabled: busy,
                                  "aria-label": "Премахни " + item.name,
                                  onClick: () =>
                                    requestCart({
                                      action: "remove",
                                      product_id: item.id,
                                    }).catch(() => {}),
                                },
                                "Премахни",
                              ),
                            ),
                            h(
                              "p",
                              { className: "commerce-cart-line-total" },
                              item.line_total + " " + item.currency,
                            ),
                          ),
                        ),
                      )
                    : h(CartTable, { cart, busy }),
                  h(
                    "aside",
                    {
                      className: "commerce-cart-summary",
                      "aria-label": "Обобщение на количката",
                    },
                    h(
                      "h2",
                      null,
                      isDrawer ? "Обобщение" : "Общо в количката",
                    ),
                    cart.totals.map((total) =>
                      h(
                        "div",
                        {
                          className: "commerce-cart-total",
                          key: total.currency,
                        },
                        h("span", null, "Сума на продуктите"),
                        h(
                          "strong",
                          null,
                          total.amount + " " + total.currency,
                        ),
                      ),
                    ),
                    h(
                      "p",
                      { className: "commerce-cart-note" },
                      "Доставката се изчислява при завършване на поръчката. Добавянето в количката не резервира наличност.",
                    ),
                    isDrawer
                      ? h(
                          "a",
                          {
                            className: "flex-btn flex-btn--primary commerce-cart-primary",
                            href: "/cart",
                          },
                          "Към страницата на количката",
                        )
                      : h(
                          "a",
                          {
                            href: "/checkout",
                            className:
                              "flex-btn flex-btn--primary commerce-cart-primary" +
                              (checkoutPending ? " is-loading" : ""),
                            "aria-busy": checkoutPending || undefined,
                            onClick: (event) => {
                              if (checkoutPending) {
                                event.preventDefault();
                                return;
                              }
                              setCheckoutPending(true);
                            },
                          },
                          checkoutPending &&
                            h("span", {
                              className: "commerce-cart-btn-spinner",
                              "aria-hidden": true,
                            }),
                          checkoutPending
                            ? "Зареждане…"
                            : "Завършване на поръчката",
                        ),
                    h(
                      "a",
                      {
                        href: "/catalog",
                        className: "commerce-cart-continue",
                      },
                      "Продължи пазаруването",
                    ),
                  ),
                ),
            error &&
              h(
                "button",
                {
                  type: "button",
                  className: "commerce-cart-retry",
                  disabled: busy,
                  onClick: () => requestCart().catch(() => {}),
                },
                "Опитай отново",
              ),
            isDrawer &&
              !cart.items.length &&
              h(
                "a",
                {
                  href: "/cart",
                  className: "commerce-cart-continue",
                },
                "Към страницата на количката",
              ),
          ),
    );
  }
  rt.register("commerce.cart", Cart);
  document.addEventListener("flex:page-before-change", () => {
    for (const root of document.querySelectorAll("[data-commerce-cart-page]"))
      rt.unmount(root);
  });
}

/**
 * The theme's React runtime for the drawer and the cart page: at once when it is loaded, through the theme's
 * lazy loader (Flex Starter 1.2.0+), or when an older theme announces it. Null if it does not come in time.
 */
export function storefrontRuntime() {
  if (window.FlexStorefront) return Promise.resolve(window.FlexStorefront);
  // The theme's scripts come after the plugins' ones, so its loader is looked for once all of them have run.
  // Modules run before DOMContentLoaded; the navigation timing tells whether it has already fired.
  const loaded = (performance.getEntriesByType?.("navigation")[0]?.domContentLoadedEventStart ?? 0) > 0;
  const ready =
    loaded || document.readyState === "complete"
      ? Promise.resolve()
      : new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  const loading = ready.then(() => {
    if (window.FlexStorefront) return window.FlexStorefront;
    if (window.FlexStorefrontLoader) return window.FlexStorefrontLoader.load();
    return new Promise((resolve) =>
      window.addEventListener("flex:storefront-ready", (event) => resolve(event.detail), { once: true }),
    );
  });
  return Promise.race([
    loading.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(window.FlexStorefront || null), 10000)),
  ]);
}
// Tells the theme's loader that this cart starts without React and asks for it only when needed.
window.FlexStorefrontLazyClients = true;

function mountCartPages() {
  if (!document.querySelector("[data-commerce-cart-page]")) return;
  storefrontRuntime().then((rt) => {
    if (!rt) return;
    initialize(rt);
    for (const root of document.querySelectorAll("[data-commerce-cart-page]"))
      rt.mount("commerce.cart", root, {});
  });
}
function bindOpenButtons() {
  for (const button of document.querySelectorAll("[data-commerce-cart-open]")) {
    if (button.dataset.cartOpenBound) continue;
    button.dataset.cartOpenBound = "1";
    button.disabled = false;
    button.addEventListener("click", () => openCart(button));
    // Start loading the drawer while the pointer is on its way to the button.
    button.addEventListener("pointerenter", () => storefrontRuntime(), { once: true });
  }
}
function bindCatalogueButtons() {
  for (const button of document.querySelectorAll(
    "[data-commerce-cart-add]",
  )) {
    if (button.dataset.cartBound) continue;
    button.dataset.cartBound = "1";
    button.addEventListener("click", async () => {
      if (state.busy) return;
      const redirect = button.getAttribute("data-commerce-redirect") || "";
      const label =
        button.querySelector("[data-commerce-cart-label]") || button;
      const readyText = label.textContent;
      let leaving = false;
      label.textContent = "Добавяне…";
      button.setAttribute("aria-busy", "true");
      try {
        await requestCart({
          product_id: Number(button.dataset.commerceCartAdd),
          quantity: 1,
        });
        if (redirect) {
          leaving = true;
          window.location.assign(redirect);
          return;
        }
        toastSuccess("Продуктът е добавен в количката.");
      } catch (error) {
        toastError(
          error?.message || "Неуспешно добавяне. Опитайте отново.",
        );
      } finally {
        if (leaving) return;
        label.textContent = readyText;
        button.removeAttribute("aria-busy");
      }
    });
  }
}
// The count, the cart button and "add to cart" work at once; React loads only for the drawer and cart page.
if (!window.__flexCommerceCartStarted) {
  window.__flexCommerceCartStarted = true;
  bindOpenButtons();
  bindCatalogueButtons();
  mountCartPages();
  document.addEventListener("flex:page-ready", () => {
    mountCartPages();
    bindOpenButtons();
    bindCatalogueButtons();
    updateBadge();
    if (document.querySelector("[data-commerce-cart-page]"))
      requestCart().catch(() => {});
  });
  document.addEventListener("commerce:catalogue-updated", () => {
    bindCatalogueButtons();
    updateBadge();
  });
  // Only pages that show the cart (header count, buttons, cart page) ask the server for it.
  if (document.querySelector("[data-commerce-cart-count], [data-commerce-cart-open], [data-commerce-cart-add], [data-commerce-cart-page]"))
    requestCart().catch(() => {});
}
