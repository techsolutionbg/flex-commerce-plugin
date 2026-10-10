import { Notyf } from "./vendor/notyf/notyf.es.js?v=1";

const ASSET_BASE = "/extensions/flex/commerce/assets/assets/";
const STYLE_HREFS = [
  ASSET_BASE + "vendor/notyf/notyf.min.css?v=1",
  ASSET_BASE + "toast.css?v=3",
];

function ensureStyles() {
  for (const href of STYLE_HREFS) {
    if (document.querySelector('link[data-flex-toast="' + href + '"]')) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.flexToast = href;
    document.head.append(link);
  }
}

let notyf;

function elevateToastLayer() {
  const root = document.querySelector(".notyf");
  if (!root) return;

  // Popover top-layer sits above modal <dialog>, where z-index alone cannot.
  if (typeof root.showPopover === "function") {
    if (root.getAttribute("popover") !== "manual") {
      root.setAttribute("popover", "manual");
    }
    if (!root.matches(":popover-open")) {
      try {
        root.showPopover();
      } catch {
        /* ignore browsers that reject re-entrant showPopover */
      }
    }
    return;
  }

  const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
  const host = dialog || document.body;
  if (root.parentElement !== host) host.append(root);
}

function clientToast() {
  ensureStyles();
  if (!notyf) {
    notyf = new Notyf({
      duration: 3400,
      ripple: true,
      dismissible: true,
      position: { x: "right", y: "bottom" },
      types: [
        {
          type: "success",
          className: "flex-toast flex-toast--success",
          background: "#203027",
          icon: {
            className: "flex-toast-mark",
            tagName: "span",
            text: "✓",
          },
        },
        {
          type: "error",
          className: "flex-toast flex-toast--error",
          background: "#9b2c2c",
          icon: {
            className: "flex-toast-mark",
            tagName: "span",
            text: "!",
          },
        },
      ],
    });
  }
  elevateToastLayer();
  return notyf;
}

export function toastSuccess(message) {
  if (!message) return;
  clientToast().success(message);
}

export function toastError(message) {
  if (!message) return;
  clientToast().error(message);
}
