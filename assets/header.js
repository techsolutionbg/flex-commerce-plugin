// The favourites count in the site header, on every page. The rest of the storefront (storefront.js) loads only
// on pages with products, which also keep the count up to date when favourites change there.
const favouritesKey = "flex-commerce-favourites";

function favouritesCount() {
  try {
    const saved = JSON.parse(localStorage.getItem(favouritesKey) || "[]");
    return Array.isArray(saved) ? new Set(saved.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 1000)).size : 0;
  } catch {
    return 0;
  }
}

function refreshFavouritesBadge() {
  const count = favouritesCount();
  for (const badge of document.querySelectorAll("[data-commerce-favourites-count]")) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }
  for (const link of document.querySelectorAll("[data-commerce-favourites-link]")) {
    link.setAttribute("aria-label", "Любими (" + count + ")");
  }
}

window.addEventListener("storage", (event) => {
  if (event.key === favouritesKey || event.key === null) refreshFavouritesBadge();
});
document.addEventListener("flex:page-ready", refreshFavouritesBadge);
refreshFavouritesBadge();
