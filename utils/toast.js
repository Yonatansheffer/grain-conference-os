const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6h.01"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>'
};

// Non-blocking, auto-dismissing toast. Replaces alert() so a rep is never frozen
// mid-task by a modal dialog (especially on a busy show floor).
function showToast(message, type = "info", options = {}) {
  const region = document.getElementById("toastRegion");
  if (!region) return null;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
  toast.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <span class="toast-message"></span>
    <button class="toast-close" type="button" aria-label="Dismiss notification">&times;</button>`;
  toast.querySelector(".toast-message").textContent = message;
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 240);
  };

  toast.querySelector(".toast-close").addEventListener("click", remove);
  const duration = options.duration ?? 3600;
  if (duration > 0) setTimeout(remove, duration);
  return toast;
}
