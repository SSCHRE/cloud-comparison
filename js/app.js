const STATUS_LABEL = {
  yes: "Yes",
  partial: "Partial",
  no: "No",
};

const STATUS_SCORE = {
  yes: 2,
  partial: 1,
  no: 0,
};

const AVATAR_PALETTES = [
  ["#d6ff4b", "#9ad4ff"],
  ["#ffc857", "#d6ff4b"],
  ["#7dffb3", "#9ad4ff"],
  ["#ff8fab", "#ffc857"],
  ["#b8a1ff", "#7dffb3"],
  ["#9ad4ff", "#ffc857"],
];

const BANDWIDTH_LABEL_TIP =
  "Bandwidth is how much data you can upload/download. Hover a value for what the short label means.";

const FILE_LIMIT_LABEL_TIP =
  "Maximum size allowed for a single file upload (where the provider documents one).";

const BANDWIDTH_TIPS = {
  Unlimited: "No stated monthly upload/download traffic cap for normal personal use.",
  "Plan traffic cap":
    "Transfer/download allowance is capped by your plan tier (often resets monthly).",
  "Plan-based":
    "Limits depend on which subscription you buy — check that provider’s pricing for exact traffic amounts.",
  "Fair use / plan":
    "Usually generous for normal use, but the provider may throttle or restrict heavy/abusive traffic.",
  "Fair use":
    "No hard published cap, but excessive or commercial-scale use may be slowed or limited.",
  "Egress priced":
    "Storage itself may be cheap; you mainly pay when downloading data out of the cloud (egress).",
  "Transfer quota":
    "A separate transfer allowance (often similar to your storage size) that refills on a schedule.",
  "Host-dependent":
    "Limits come from your own server/VPS host, not a fixed consumer SaaS plan.",
  "Upload ~750 GB/day":
    "Uploads are generally open, but Google may temporarily restrict after roughly 750 GB uploaded in a day.",
  "No egress fees*":
    "Marketed as free outbound transfer with fair-use conditions — confirm current Wasabi terms.",
  "Plan egress":
    "Outbound download traffic is included up to plan amounts; beyond that it may cost extra.",
  "Included traffic":
    "Your hosting plan includes a traffic allotment; going over may mean charges or throttling.",
  "Capped on free":
    "Free accounts have tighter download/traffic limits than paid plans.",
};

const state = {
  data: null,
  search: "",
  requiredFeatures: new Set(),
  regions: new Set(),
  strictYes: false,
  freeTierOnly: false,
  hideNotRecommended: false,
  showPricing: false,
  sort: "name-asc",
  view: "browse",
  shortlist: new Set(),
  drawerProviderId: null,
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Plain text for tips/search: strip note markup. */
function stripRichNote(value) {
  return String(value ?? "")
    .replace(/<a\s[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g, "$1")
    .replace(/<\/?(?:b|strong|em|i|br)\s*\/?>/gi, " ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function safeNoteLink(url, labelHtml) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
  } catch {
    return null;
  }
}

/**
 * Safe rich text for important notes.
 * Supports: <b>, <strong>, <em>, <i>, <br>, <a href="https://...">,
 * **bold**, [label](https://...), and newlines.
 */
function formatRichNote(value) {
  let html = escapeHtml(value);
  html = html
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/&lt;(\/?)(b|strong|em|i)&gt;/gi, "<$1$2>")
    .replace(
      /&lt;a\s+href=&quot;(https?:\/\/[^&]+?)&quot;&gt;([\s\S]*?)&lt;\/a&gt;/gi,
      (match, url, label) => safeNoteLink(url, label) || match
    )
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (match, label, url) => {
      return safeNoteLink(url, label) || match;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  return html;
}

const UI_ICONS = {
  plus: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9.8 16.6a1 1 0 0 1-.7-.3l-3.2-3.2a1 1 0 1 1 1.4-1.4l2.5 2.5 6.1-6.1a1 1 0 1 1 1.4 1.4l-6.8 6.8a1 1 0 0 1-.7.3z"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 3.2a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3zM11 11h2v6h-2v-6z"/></svg>`,
};

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function avatarStyle(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
  return `--avatar-a:${a};--avatar-b:${b}`;
}

function providerIconSrc(provider) {
  return provider.icon || `icons/${provider.id}.png`;
}

function providerAvatar(provider) {
  const src = providerIconSrc(provider);
  return `
    <div class="avatar" style="${avatarStyle(provider.id)}" aria-hidden="true">
      <img
        class="avatar-img"
        src="${escapeHtml(src)}"
        alt=""
        loading="lazy"
        decoding="async"
        onerror="this.closest('.avatar').classList.add('is-fallback')"
      />
      <span class="avatar-fallback">${escapeHtml(initials(provider.name))}</span>
    </div>
  `;
}

function parseFreeGb(value) {
  if (!value) return -1;
  const normalized = value.toLowerCase();
  if (normalized.includes("self-hosted")) return 9999;
  if (normalized.includes("none") || normalized.includes("n/a")) return 0;
  const match = normalized.match(/([\d.]+)\s*(tb|gb|mb)/);
  if (!match) return -1;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "tb") return amount * 1024;
  if (unit === "mb") return amount / 1024;
  return amount;
}

function parsePriceSortValue(raw) {
  if (raw == null) return Number.POSITIVE_INFINITY;
  const text = String(raw).trim().toLowerCase();
  if (!text || text === "—" || text === "–" || text === "-" || text === "n/a") {
    return Number.POSITIVE_INFINITY;
  }
  if (text.startsWith("free")) return 0;
  if (
    text === "premium" ||
    text === "host cost" ||
    text === "varies" ||
    text === "bundle"
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const match = text.replace(/,/g, "").match(/([\d.]+)/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]);
}

function formatPriceDisplay(raw) {
  if (raw == null) return "—";
  const text = String(raw).trim();
  if (!text) return "—";
  if (/[€$£]|usd|eur|gbp|free|premium|n\/a|host|varies|bundle/i.test(text)) {
    return text;
  }
  // Plain number (optional ~) → default to euro
  const match = text.match(/^(~)?(\d+(?:[.,]\d+)?)$/);
  if (match) {
    const approx = match[1] || "";
    const amount = match[2].replace(",", ".");
    return `${approx}€${amount}`;
  }
  return text;
}

function normalizePricingKey(key) {
  return String(key).trim().toLowerCase().replace(/\s+/g, "");
}

function parsePricingKey(key) {
  const normalized = normalizePricingKey(key);
  const match = normalized.match(/^(\d+(?:\.\d+)?)(gb|tb)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const gb = unit === "tb" ? amount * 1024 : amount;
  const nice = Number.isInteger(amount) ? String(amount) : String(amount);
  const label = `${nice} ${unit.toUpperCase()}`;
  return { id: `${nice}${unit}`, label, gb, amount, unit };
}

function getPricingValue(provider, tierId) {
  const pricing = provider.pricing || {};
  if (pricing[tierId] != null && String(pricing[tierId]).trim() !== "") {
    return pricing[tierId];
  }
  const wanted = normalizePricingKey(tierId);
  const wantedParsed = parsePricingKey(tierId);
  for (const [key, value] of Object.entries(pricing)) {
    if (value == null || String(value).trim() === "") continue;
    if (normalizePricingKey(key) === wanted) return value;
    const parsed = parsePricingKey(key);
    if (parsed && wantedParsed && parsed.gb === wantedParsed.gb) return value;
  }
  return "";
}

function priceForTier(provider, tierId) {
  return parsePriceSortValue(getPricingValue(provider, tierId));
}

function isPriceSort(sortValue = state.sort) {
  return String(sortValue).startsWith("price-");
}

function priceSortTierId(sortValue = state.sort) {
  return String(sortValue).replace(/^price-/, "");
}

function hasFreeTier(provider) {
  const gb = parseFreeGb(provider.free_storage);
  return gb > 0 || /self-hosted/i.test(provider.free_storage);
}

function getStatus(provider, featureId) {
  return provider.features?.[featureId]?.status ?? "no";
}

function getNote(provider, featureId) {
  return provider.features?.[featureId]?.note ?? "";
}

function matchesFeatureRequirement(provider, featureId) {
  const status = getStatus(provider, featureId);
  // E2EE is always full Yes only — Partial (paid add-on / vault-only) does not count
  if (featureId === "e2ee" || state.strictYes) return status === "yes";
  return status === "yes" || status === "partial";
}

function scoreProvider(provider) {
  const features = state.data.features;
  let score = 0;
  for (const feature of features) {
    score += STATUS_SCORE[getStatus(provider, feature.id)] ?? 0;
  }
  if (state.requiredFeatures.size) {
    let matched = 0;
    for (const featureId of state.requiredFeatures) {
      if (matchesFeatureRequirement(provider, featureId)) matched += 1;
    }
    score += matched * 10;
  }
  return score;
}

function getFilteredProviders() {
  const query = state.search.trim().toLowerCase();

  let list = state.data.providers.filter((provider) => {
    if (query) {
      const haystack = [
        provider.name,
        provider.hq,
        provider.region,
        provider.summary,
        provider.free_storage,
        provider.bandwidth,
        provider.file_limit,
        provider.file_limit_tip,
        provider.speed_warning,
        provider.important_note,
        provider.important_note_label,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (state.regions.size) {
      if (!state.regions.has(provider.region)) return false;
    } else if (provider.region === "Self-hosted") {
      // Self-hosted is opt-in via the region chip
      return false;
    }
    if (state.freeTierOnly && !hasFreeTier(provider)) return false;
    if (state.hideNotRecommended && provider.not_recommended) return false;

    for (const featureId of state.requiredFeatures) {
      if (!matchesFeatureRequirement(provider, featureId)) return false;
    }

    return true;
  });

  const sorters = {
    "name-asc": (a, b) => a.name.localeCompare(b.name),
    "name-desc": (a, b) => b.name.localeCompare(a.name),
    "score-desc": (a, b) => scoreProvider(b) - scoreProvider(a) || a.name.localeCompare(b.name),
    region: (a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name),
    "free-desc": (a, b) => parseFreeGb(b.free_storage) - parseFreeGb(a.free_storage) || a.name.localeCompare(b.name),
  };

  if (isPriceSort()) {
    const tierId = priceSortTierId();
    list = [...list].sort(
      (a, b) =>
        priceForTier(a, tierId) - priceForTier(b, tierId) || a.name.localeCompare(b.name)
    );
  } else {
    list = [...list].sort(sorters[state.sort] ?? sorters["name-asc"]);
  }
  return list;
}

function maxCompare() {
  return state.data?.meta?.maxCompare ?? 8;
}

function toggleShortlist(providerId) {
  if (state.shortlist.has(providerId)) {
    state.shortlist.delete(providerId);
  } else {
    if (state.shortlist.size >= maxCompare()) {
      alert(`You can compare up to ${maxCompare()} providers at once.`);
      return;
    }
    state.shortlist.add(providerId);
  }
  render();

  if ($("drawer").open && state.drawerProviderId === providerId) {
    openDrawer(providerId);
  }
}

const PARTIAL_FALLBACK_TIP =
  "Limited, paid, local-only, or folder-scoped support — not a full Yes.";

function statusPill(status, note, { showNote = true } = {}) {
  const label = STATUS_LABEL[status] ?? status;
  const visibleNote = showNote && note ? `<span class="note-tip">${escapeHtml(note)}</span>` : "";
  const tipText =
    note || (status === "partial" ? PARTIAL_FALLBACK_TIP : "");
  const tipAttrs = tipText
    ? ` tabindex="0" data-tip="${escapeHtml(tipText)}" class="status-pill ${status} has-tip"`
    : ` class="status-pill ${status}"`;

  return `
    <div class="status-cell">
      <span${tipAttrs}>
        <i class="dot ${status}" aria-hidden="true"></i>
        ${label}
      </span>
      ${visibleNote}
    </div>
  `;
}

function speedWarning(provider) {
  if (!provider.speed_warning) return "";
  return `
    <div class="speed-warning" title="${escapeHtml(provider.speed_warning)}">
      <span class="speed-warning-label">Speed</span>
      <span>${escapeHtml(provider.speed_warning)}</span>
    </div>
  `;
}

function importantNoteTeaser(text) {
  const compact = stripRichNote(text);
  if (!compact) return "";
  if (compact.length <= 160) return compact;
  return `${compact.slice(0, 157).trimEnd()}…`;
}

function importantNote(provider, { open = false } = {}) {
  if (!provider.important_note) return "";
  const label = provider.important_note_label || "Important";
  const tip = importantNoteTeaser(provider.important_note);
  return `
    <details class="provider-note" ${open ? "open" : ""}>
      <summary class="provider-note-summary has-tip" tabindex="0" data-tip="${escapeHtml(tip)}">
        <span class="provider-note-label">${escapeHtml(label)}</span>
        <span class="provider-note-hint">Hover or expand</span>
      </summary>
      <div class="provider-note-body">${formatRichNote(provider.important_note)}</div>
    </details>
  `;
}

function notRecommendedBadge(provider) {
  if (!provider.not_recommended) return "";
  return `<span class="not-recommended-badge" title="Marked not recommended">Not recommended</span>`;
}

function providerCell(provider, { compact = false } = {}) {
  const shortlisted = state.shortlist.has(provider.id);
  const badge = notRecommendedBadge(provider);
  return `
    <div class="provider-cell${provider.not_recommended ? " has-not-recommended" : ""}">
      ${providerAvatar(provider)}
      <div class="provider-meta">
        <span class="provider-name">
          <span class="provider-name-text">${escapeHtml(provider.name)}</span>
        </span>
        <span class="provider-sub">${escapeHtml(provider.region)} · ${escapeHtml(provider.hq)}</span>
        ${speedWarning(provider)}
        ${importantNote(provider)}
      </div>
      ${
        compact
          ? badge
            ? `<div class="provider-aside">${badge}</div>`
            : ""
          : `<div class="provider-aside">
              ${badge}
              <div class="row-actions">
                <button
                  type="button"
                  class="icon-action ${shortlisted ? "is-active" : ""}"
                  data-action="shortlist"
                  data-id="${provider.id}"
                  title="${shortlisted ? "Remove from shortlist" : "Add to shortlist"}"
                  aria-label="${shortlisted ? "Remove from shortlist" : "Add to shortlist"}"
                  aria-pressed="${shortlisted}"
                >${shortlisted ? UI_ICONS.check : UI_ICONS.plus}</button>
                <button
                  type="button"
                  class="icon-action"
                  data-action="details"
                  data-id="${provider.id}"
                  title="Details"
                  aria-label="Details"
                >${UI_ICONS.info}</button>
              </div>
            </div>`
      }
    </div>
  `;
}

function bandwidthTip(value) {
  if (!value) return BANDWIDTH_LABEL_TIP;
  return BANDWIDTH_TIPS[value] || BANDWIDTH_LABEL_TIP;
}

function tippedValue(value, tip) {
  const text = escapeHtml(value || "—");
  return `<span class="value has-tip" tabindex="0" data-tip="${escapeHtml(tip)}">${text}</span>`;
}

function bandwidthValue(provider) {
  const value = provider.bandwidth || "—";
  return tippedValue(value, bandwidthTip(provider.bandwidth));
}

function tipLabel(text, tip) {
  return `
    <span class="label tip-label has-tip" tabindex="0" data-tip="${escapeHtml(tip)}">
      ${escapeHtml(text)}
      <span class="tip-mark" aria-hidden="true">?</span>
    </span>
  `;
}

function bandwidthLabel() {
  return tipLabel("Band.", BANDWIDTH_LABEL_TIP);
}

function fileLimitLabel() {
  return tipLabel("File", FILE_LIMIT_LABEL_TIP);
}

function fileLimitTip(provider) {
  if (provider.file_limit_tip) return provider.file_limit_tip;
  return FILE_LIMIT_LABEL_TIP;
}

function fileLimitValue(provider) {
  return tippedValue(provider.file_limit || "—", fileLimitTip(provider));
}

function limitsCell(provider) {
  return `
    <div class="limits-cell">
      <div class="limit-row">
        <span class="label">Free</span>
        <span class="value">${escapeHtml(provider.free_storage || "—")}</span>
      </div>
      <div class="limit-row">
        ${bandwidthLabel()}
        ${bandwidthValue(provider)}
      </div>
      <div class="limit-row">
        ${fileLimitLabel()}
        ${fileLimitValue(provider)}
      </div>
    </div>
  `;
}

const DEFAULT_PRICING_TIERS = ["1tb"];

function pricingTiers() {
  const byGb = new Map();

  for (const key of DEFAULT_PRICING_TIERS) {
    const parsed = parsePricingKey(key);
    if (!parsed) continue;
    byGb.set(parsed.gb, {
      id: parsed.id,
      label: parsed.label,
      gb: parsed.gb,
    });
  }

  for (const provider of state.data?.providers ?? []) {
    for (const key of Object.keys(provider.pricing || {})) {
      const parsed = parsePricingKey(key);
      if (!parsed) continue;
      if (!byGb.has(parsed.gb)) {
        byGb.set(parsed.gb, {
          id: parsed.id,
          label: parsed.label,
          gb: parsed.gb,
        });
      }
    }
  }
  return [...byGb.values()].sort((a, b) => a.gb - b.gb);
}

function fillPriceSortOptions() {
  const group = $("sort-price-group");
  if (!group) return;
  const tiers = pricingTiers();
  group.hidden = tiers.length === 0;
  group.innerHTML = tiers
    .map(
      (tier) =>
        `<option value="price-${tier.id}">Price /mo · ${escapeHtml(tier.label)}</option>`
    )
    .join("");
}

function enablePricingView() {
  if (state.showPricing) return;
  state.showPricing = true;
  const checkbox = $("show-pricing");
  if (checkbox) checkbox.checked = true;
}

function pricingCell(provider) {
  const tiers = pricingTiers();
  if (!tiers.length) {
    return `<div class="limits-cell pricing-cell"><span class="value">—</span></div>`;
  }
  const rows = tiers
    .map((tier) => {
      const value = formatPriceDisplay(getPricingValue(provider, tier.id));
      return `
        <div class="limit-row">
          <span class="label">${escapeHtml(tier.label)}</span>
          <span class="value">${escapeHtml(value)}</span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="limits-cell pricing-cell">
      ${rows}
    </div>
  `;
}

function ensureFloatingTip() {
  let tip = document.querySelector(".floating-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "floating-tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  return tip;
}

function placeFloatingTip(anchor, tipEl) {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  tipEl.style.left = "0px";
  tipEl.style.top = "0px";
  const tipRect = tipEl.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top - tipRect.height - margin;

  if (top < margin) top = rect.bottom + margin;
  if (left + tipRect.width > window.innerWidth - margin) {
    left = window.innerWidth - tipRect.width - margin;
  }
  if (left < margin) left = margin;

  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}

function showFloatingTip(anchor) {
  const text = anchor.getAttribute("data-tip");
  if (!text) return;
  const tipEl = ensureFloatingTip();
  tipEl.textContent = text;
  tipEl.classList.add("is-visible");
  placeFloatingTip(anchor, tipEl);
}

function hideFloatingTip() {
  const tipEl = document.querySelector(".floating-tip");
  if (tipEl) tipEl.classList.remove("is-visible");
}

function bindTooltipDelegation() {
  document.addEventListener("pointerover", (event) => {
    const anchor = event.target.closest("[data-tip]");
    if (!anchor) return;
    showFloatingTip(anchor);
  });

  document.addEventListener("pointerout", (event) => {
    const anchor = event.target.closest("[data-tip]");
    if (!anchor) return;
    const next = event.relatedTarget;
    if (next && anchor.contains(next)) return;
    hideFloatingTip();
  });

  document.addEventListener("focusin", (event) => {
    const anchor = event.target.closest("[data-tip]");
    if (anchor) showFloatingTip(anchor);
  });

  document.addEventListener("focusout", (event) => {
    const anchor = event.target.closest("[data-tip]");
    if (anchor) hideFloatingTip();
  });

  document.addEventListener("scroll", hideFloatingTip, true);
}

function renderFilterControls() {
  const featureBox = $("feature-filters");
  featureBox.innerHTML = state.data.features
    .map(
      (feature) => `
      <label class="check-chip">
        <input type="checkbox" data-feature-filter="${feature.id}" ${
          state.requiredFeatures.has(feature.id) ? "checked" : ""
        } />
        <span>${escapeHtml(feature.short || feature.label)}</span>
      </label>
    `
    )
    .join("");

  const regions = [...new Set(state.data.providers.map((p) => p.region))].sort((a, b) => {
    if (a === "Self-hosted") return 1;
    if (b === "Self-hosted") return -1;
    return a.localeCompare(b);
  });
  $("region-filters").innerHTML = regions
    .map(
      (region) => `
      <button
        type="button"
        class="chip ${state.regions.has(region) ? "is-active" : ""} ${
          region === "Self-hosted" ? "chip-optional" : ""
        }"
        data-region="${escapeHtml(region)}"
        title="${
          region === "Self-hosted"
            ? "Opt-in: show self-hosted options like Nextcloud"
            : escapeHtml(region)
        }"
      >${escapeHtml(region)}${
        region === "Self-hosted" ? '<span class="chip-note">opt-in</span>' : ""
      }</button>
    `
    )
    .join("");
}

function renderBrowseTable(providers) {
  const table = $("browse-table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  const features = state.data.features;

  thead.innerHTML = `
    <tr>
      <th scope="col" class="col-provider">Provider</th>
      <th scope="col" class="col-limits">Free / Limits</th>
      ${
        state.showPricing
          ? `<th scope="col" class="col-pricing">Pricing /mo</th>`
          : ""
      }
      ${features
        .map(
          (feature) => `
        <th scope="col" title="${escapeHtml(feature.description)}">
          ${escapeHtml(feature.short || feature.label)}
        </th>
      `
        )
        .join("")}
    </tr>
  `;

  tbody.innerHTML = providers
    .map((provider) => {
      const cells = features
        .map((feature) => {
          const status = getStatus(provider, feature.id);
          const note = getNote(provider, feature.id);
          return `<td>${statusPill(status, note, { showNote: false })}</td>`;
        })
        .join("");

      return `
        <tr class="${[
          state.shortlist.has(provider.id) ? "is-shortlisted" : "",
          provider.not_recommended ? "is-not-recommended" : "",
        ]
          .filter(Boolean)
          .join(" ")}" data-provider-row="${provider.id}">
          <th scope="row" class="col-provider">${providerCell(provider)}</th>
          <td class="col-limits">${limitsCell(provider)}</td>
          ${state.showPricing ? `<td class="col-pricing">${pricingCell(provider)}</td>` : ""}
          ${cells}
        </tr>
      `;
    })
    .join("");
}

function renderCompareTable() {
  const selected = state.data.providers.filter((p) => state.shortlist.has(p.id));
  const empty = $("compare-empty");
  const wrap = $("compare-wrap");
  const table = $("compare-table");

  if (selected.length < 2) {
    empty.hidden = false;
    wrap.hidden = true;
    return;
  }

  empty.hidden = true;
  wrap.hidden = false;

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = `
    <tr>
      <th scope="col">Feature</th>
      ${selected
        .map(
          (provider) => `
        <th scope="col" class="compare-provider">
          <a class="provider-name-text" href="${escapeHtml(provider.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(provider.name)}</a>
          ${notRecommendedBadge(provider)}
          <div class="provider-sub">${escapeHtml(provider.region)}</div>
        </th>
      `
        )
        .join("")}
    </tr>
  `;

  const limitRows = [
    {
      label: "Free storage",
      description: "Storage included without paying.",
      render: (provider) =>
        `<span class="value">${escapeHtml(provider.free_storage || "—")}</span>`,
    },
    {
      label: "Bandwidth",
      description: BANDWIDTH_LABEL_TIP,
      render: (provider) => bandwidthValue(provider),
    },
    {
      label: "File size limit",
      description: FILE_LIMIT_LABEL_TIP,
      render: (provider) => fileLimitValue(provider),
    },
    {
      label: "Speed warning",
      description: "Only shown when a provider throttles download speed.",
      render: (provider) =>
        provider.speed_warning
          ? `<div class="compare-speed">${speedWarning(provider)}</div>`
          : `<span class="value">—</span>`,
    },
    {
      label: "Important note",
      description: "Longer caveats that do not fit in a single feature cell.",
      render: (provider) =>
        provider.important_note
          ? `<div class="compare-note">${importantNote(provider, { open: true })}</div>`
          : `<span class="value">—</span>`,
    },
  ];

  if (state.showPricing) {
    for (const tier of pricingTiers()) {
      limitRows.push({
        label: `Price /mo · ${tier.label}`,
        description: "Approximate monthly plan price for this capacity.",
        render: (provider) => {
          const value = formatPriceDisplay(getPricingValue(provider, tier.id));
          return `<span class="value">${escapeHtml(value)}</span>`;
        },
      });
    }
  }

  const limitHtml = limitRows
    .map(
      (row) => `
      <tr>
        <th scope="row">
          <div class="feature-head">
            <span>${escapeHtml(row.label)}</span>
            <small>${escapeHtml(row.description)}</small>
          </div>
        </th>
        ${selected.map((provider) => `<td>${row.render(provider)}</td>`).join("")}
      </tr>
    `
    )
    .join("");

  const featureHtml = state.data.features
    .map((feature) => {
      const cells = selected
        .map((provider) => {
          const status = getStatus(provider, feature.id);
          const note = getNote(provider, feature.id);
          return `<td>${statusPill(status, note)}</td>`;
        })
        .join("");

      return `
        <tr>
          <th scope="row">
            <div class="feature-head">
              <span>${escapeHtml(feature.label)}</span>
              <small>${escapeHtml(feature.description)}</small>
            </div>
          </th>
          ${cells}
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = limitHtml + featureHtml;
}

function renderShortlistBar() {
  const bar = $("shortlist-bar");
  const chips = $("shortlist-chips");
  const count = state.shortlist.size;
  $("shortlist-count").textContent = String(count);

  if (!count) {
    bar.hidden = true;
    chips.innerHTML = "";
    return;
  }

  bar.hidden = false;
  const selected = state.data.providers.filter((p) => state.shortlist.has(p.id));
  chips.innerHTML = selected
    .map(
      (provider) => `
      <span class="shortlist-chip">
        ${escapeHtml(provider.name)}
        <button type="button" data-action="shortlist" data-id="${provider.id}" aria-label="Remove ${escapeHtml(provider.name)}">×</button>
      </span>
    `
    )
    .join("");
}

function openDrawer(providerId) {
  const provider = state.data.providers.find((p) => p.id === providerId);
  if (!provider) return;

  state.drawerProviderId = provider.id;
  const shortlisted = state.shortlist.has(provider.id);
  $("drawer-content").innerHTML = `
    <div class="drawer-hero">
      ${providerAvatar(provider)}
      <div>
        <h2><span class="provider-name-text">${escapeHtml(provider.name)}</span> ${notRecommendedBadge(provider)}</h2>
        <p>${escapeHtml(provider.hq)} · ${escapeHtml(provider.region)}</p>
      </div>
    </div>
    <div class="limits-cell drawer-limits">
      <div class="limit-row">
        <span class="label">Free</span>
        <span class="value">${escapeHtml(provider.free_storage || "—")}</span>
      </div>
      <div class="limit-row">
        ${bandwidthLabel()}
        ${bandwidthValue(provider)}
      </div>
      <div class="limit-row">
        ${fileLimitLabel()}
        ${fileLimitValue(provider)}
      </div>
      ${
        provider.speed_warning
          ? `<div class="speed-warning-slot">${speedWarning(provider)}</div>`
          : ""
      }
      ${
        provider.important_note
          ? `<div class="provider-note-slot">${importantNote(provider, {
              open: true,
            })}</div>`
          : ""
      }
      ${
        state.showPricing
          ? `<div class="drawer-pricing">${pricingCell(provider)}</div>`
          : ""
      }
    </div>
    <p class="drawer-summary">${escapeHtml(provider.summary)}</p>
    <div class="drawer-actions">
      <a class="btn-primary" href="${escapeHtml(provider.url)}" target="_blank" rel="noopener noreferrer">Visit site</a>
      <button type="button" class="btn-ghost" data-action="shortlist" data-id="${provider.id}">
        ${shortlisted ? "Remove from shortlist" : "Add to shortlist"}
      </button>
    </div>
    <div class="drawer-features">
      ${state.data.features
        .map((feature) => {
          const status = getStatus(provider, feature.id);
          const note = getNote(provider, feature.id);
          return `
            <article class="drawer-feature">
              <div class="drawer-feature-top">
                <h3>${escapeHtml(feature.label)}</h3>
                <span${
                  status === "partial"
                    ? ` class="status-pill ${status} has-tip" tabindex="0" data-tip="${escapeHtml(note || PARTIAL_FALLBACK_TIP)}"`
                    : ` class="status-pill ${status}"`
                }>
                  <i class="dot ${status}" aria-hidden="true"></i>
                  ${STATUS_LABEL[status]}
                </span>
              </div>
              <p>${escapeHtml(note || feature.description)}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;

  $("drawer").showModal();
}

function renderMeta() {
  $("tagline").textContent = state.data.meta.tagline;
  $("updated").textContent = `Updated ${state.data.meta.updated} · ${state.data.providers.length} providers in dataset`;
  $("disclaimer").textContent = state.data.meta.disclaimer;
  $("max-compare").textContent = String(maxCompare());
  document.querySelectorAll(".max-compare-label").forEach((el) => {
    el.textContent = String(maxCompare());
  });
  document.title = state.data.meta.title;
}

function render() {
  const providers = getFilteredProviders();
  $("result-count").textContent = `${providers.length} of ${state.data.providers.length} providers`;
  $("empty-state").hidden = providers.length > 0;
  $("browse-table").hidden = providers.length === 0;

  renderBrowseTable(providers);
  renderCompareTable();
  renderShortlistBar();

  const browse = $("browse-view");
  const compare = $("compare-view");
  const browseBtn = $("view-browse");
  const compareBtn = $("view-compare");

  const showCompare = state.view === "compare";
  browse.hidden = showCompare;
  compare.hidden = !showCompare;
  browseBtn.classList.toggle("is-active", !showCompare);
  compareBtn.classList.toggle("is-active", showCompare);
}

function bindEvents() {
  $("search").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  $("sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    if (isPriceSort(state.sort)) enablePricingView();
    render();
  });

  $("strict-yes").addEventListener("change", (event) => {
    state.strictYes = event.target.checked;
    render();
  });

  $("free-tier-only").addEventListener("change", (event) => {
    state.freeTierOnly = event.target.checked;
    render();
  });

  $("hide-not-recommended").addEventListener("change", (event) => {
    state.hideNotRecommended = event.target.checked;
    render();
  });

  $("show-pricing").addEventListener("change", (event) => {
    state.showPricing = event.target.checked;
    render();
  });

  $("feature-filters").addEventListener("change", (event) => {
    const input = event.target.closest("[data-feature-filter]");
    if (!input) return;
    const id = input.dataset.featureFilter;
    if (input.checked) state.requiredFeatures.add(id);
    else state.requiredFeatures.delete(id);
    render();
  });

  $("region-filters").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-region]");
    if (!chip) return;
    const region = chip.dataset.region;
    if (state.regions.has(region)) state.regions.delete(region);
    else state.regions.add(region);
    chip.classList.toggle("is-active");
    render();
  });

  $("clear-filters").addEventListener("click", () => {
    state.search = "";
    state.requiredFeatures.clear();
    state.regions.clear();
    state.strictYes = false;
    state.freeTierOnly = false;
    state.hideNotRecommended = false;
    state.showPricing = false;
    state.sort = "name-asc";
    $("search").value = "";
    $("sort").value = "name-asc";
    $("strict-yes").checked = false;
    $("free-tier-only").checked = false;
    $("hide-not-recommended").checked = false;
    $("show-pricing").checked = false;
    renderFilterControls();
    render();
  });

  $("view-browse").addEventListener("click", () => {
    state.view = "browse";
    render();
  });

  $("view-compare").addEventListener("click", () => {
    state.view = "compare";
    render();
  });

  $("open-compare").addEventListener("click", () => {
    state.view = "compare";
    render();
  });

  $("clear-shortlist").addEventListener("click", () => {
    state.shortlist.clear();
    render();
  });

  document.addEventListener("click", (event) => {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const { action, id } = actionEl.dataset;
    if (action === "shortlist") toggleShortlist(id);
    if (action === "details") openDrawer(id);
  });

  $("drawer").addEventListener("click", (event) => {
    if (event.target === $("drawer")) $("drawer").close();
  });
}

async function loadData() {
  const response = await fetch("./data/providers.json");
  if (!response.ok) {
    throw new Error(`Could not load providers.json (${response.status})`);
  }
  return response.json();
}

async function init() {
  try {
    state.data = await loadData();
    if (state.data.providers.length > 50) {
      console.warn("UI is tuned for up to 50 providers; dataset is larger.");
    }
    renderMeta();
    fillPriceSortOptions();
    renderFilterControls();
    bindEvents();
    bindTooltipDelegation();
    render();
  } catch (error) {
    $("browse-view").innerHTML = `<p class="error">${escapeHtml(error.message)}. Serve this folder over HTTP (for example <code>npx serve</code>) so the JSON can load.</p>`;
  }
}

init();
