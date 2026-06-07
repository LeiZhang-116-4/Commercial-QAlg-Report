(function () {
  const report = JSON.parse(document.getElementById("report-data").textContent);
  window.qalgReportData = report;
  const reader = report.reader || {};
  const timelineMonths = (report.aggregates && report.aggregates.months) || [];
  const maxMonthIndex = Math.max(1, ...timelineMonths.map((item) => Number(item.month_index || 0)));
  const MAP_VIEW = {
    world: { layoutCenter: ["50%", "52%"], layoutSize: "195%" },
    china: { layoutCenter: ["50%", "65%"], layoutSize: "250%" }
  };
  const state = {
    startMonth: 1,
    month: maxMonthIndex,
    query: "",
    applications: [],
    companyIds: [],
    mapMode: "world",
    selectedMaterialId: "",
    detailOpen: false,
    sortMode: "newest",
    hoverRegion: null,
    pinnedRegion: null
  };
  const charts = {};
  let mapSwitchTimer = null;
  const featureCountryAliases = {
    "United States of America": "United States",
    "Taiwan Province": "China"
  };
  const countryZh = reader.countries || {};
  const evidenceTypeZh = reader.evidence_types || {};
  const provinceZh = reader.provinces || {};

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function asScore(material) {
    return Number(material.score.commercialization_progress_score || 0);
  }

  function shortScore(material) {
    return `${asScore(material).toFixed(1)}${report.score_display.unit || "/100"}`;
  }

  function cardScore(material) {
    return asScore(material).toFixed(1);
  }

  function fullMonthLabel(material) {
    return material.month_label || `${material.year} 年 ${material.month_index} 月`;
  }

  function scoreColor(score) {
    const bounded = Math.max(0, Math.min(100, Number(score || 0)));
    const hue = 34 + (bounded / 100) * 126;
    const lightness = 36 - (bounded / 100) * 8;
    return `hsl(${hue.toFixed(1)} 48% ${lightness.toFixed(1)}%)`;
  }

  function displayKeyword(value) {
    if (value && typeof value === "object") {
      return value.reader_label || value.value || "";
    }
    return String(value || "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function readerEventTitle(material) {
    return material.reader_summary_zh || material.title || "";
  }

  function keywordChips(keywords, limit) {
    const items = (keywords || []).map(displayKeyword).filter(Boolean);
    const limited = typeof limit === "number" ? items.slice(0, limit) : items;
    return limited.map((keyword) => `<span>${escapeHtml(keyword)}</span>`).join("");
  }

  function materialCardBadges(material) {
    if (Array.isArray(material.card_badges) && material.card_badges.length) {
      return material.card_badges.slice(0, 5);
    }
    const applications = (material.applications || []).slice(0, 2).map((label) => ({
      kind: "application",
      reader_label: label
    }));
    const topics = (material.reader_topics || []).slice(0, 1).map((item) => ({
      kind: "topic",
      reader_label: item.reader_label || item.value || ""
    }));
    const techniques = (material.reader_techniques || []).slice(0, 2).map((item) => ({
      kind: "technique",
      reader_label: item.reader_label || item.value || ""
    }));
    return [...applications, ...topics, ...techniques].filter((item) => item.reader_label).slice(0, 5);
  }

  function renderMaterialBadge(item) {
    const kind = String(item.kind || "keyword").replace(/[^a-z-]/g, "");
    const label = item.reader_label || item.value || "";
    return `<span class="material-badge is-${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
  }

  function normalizedTag(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function companyTermSet(material) {
    const terms = new Set();
    (material.companies || []).forEach((company) => {
      [
        company.display_name,
        company.canonical_display_name,
        company.organization,
        ...(company.aliases || [])
      ].forEach((term) => {
        const normalized = normalizedTag(term);
        if (normalized) terms.add(normalized);
      });
    });
    return terms;
  }

  function detailKeywordItems(material) {
    const companyTerms = companyTermSet(material);
    const seen = new Set();
    const result = [];
    const push = (raw) => {
      const label = raw && typeof raw === "object" ? (raw.reader_label || displayKeyword(raw)) : displayKeyword(raw);
      const value = raw && typeof raw === "object" ? (raw.value || label) : label;
      const normalizedLabel = normalizedTag(label);
      const normalizedValue = normalizedTag(value);
      if (!label || companyTerms.has(normalizedLabel) || companyTerms.has(normalizedValue) || seen.has(normalizedLabel)) {
        return;
      }
      seen.add(normalizedLabel);
      result.push({ label, value });
    };
    (material.reader_keywords || material.keywords || []).forEach(push);
    [
      ...(material.card_badges || []),
      ...(material.reader_topics || []),
      ...(material.reader_techniques || []),
      ...(material.applications || []).map((label) => ({ reader_label: label, value: label }))
    ].forEach((item) => {
      if (result.length < 4) push(item);
    });
    return result.slice(0, 6);
  }

  function currentMonthLabel() {
    return monthLabelForIndex(state.month);
  }

  function monthLabelForIndex(index) {
    const match = timelineMonths.find((item) => Number(item.month_index) === Number(index));
    return match ? match.label : `${report.year} 年 ${index} 月`;
  }

  function clampMonth(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(maxMonthIndex, Math.round(parsed)));
  }

  function monthToPercent(month) {
    const denominator = Math.max(1, maxMonthIndex - 1);
    return ((clampMonth(month) - 1) / denominator) * 100;
  }

  function timelineMetrics() {
    const track = byId("timeline-track");
    const style = window.getComputedStyle(track);
    const edgePad = Number.parseFloat(style.getPropertyValue("--timeline-edge-pad")) || 10;
    const width = track.getBoundingClientRect().width;
    return {
      edgePad,
      width,
      usableWidth: Math.max(1, width - edgePad * 2)
    };
  }

  function monthToTrackX(month) {
    const metrics = timelineMetrics();
    return metrics.edgePad + (monthToPercent(month) / 100) * metrics.usableWidth;
  }

  function setStartMonth(value) {
    state.startMonth = Math.min(clampMonth(value), state.month);
    render();
  }

  function setEndMonth(value) {
    state.month = Math.max(clampMonth(value), state.startMonth);
    render();
  }

  function setTimelineRange(start, end) {
    const startMonth = clampMonth(start);
    const endMonth = clampMonth(end);
    state.startMonth = Math.min(startMonth, endMonth);
    state.month = Math.max(endMonth, state.startMonth);
    render();
  }

  function updateTimelineControls() {
    const startLabel = byId("start-month-label");
    const endLabel = byId("month-label");
    const startHandle = byId("start-month-handle");
    const endHandle = byId("month-handle");
    const windowEl = byId("timeline-window");
    if (!startLabel || !endLabel || !startHandle || !endHandle || !windowEl) return;

    const startX = monthToTrackX(state.startMonth);
    const endX = monthToTrackX(state.month);
    startLabel.textContent = monthLabelForIndex(state.startMonth);
    endLabel.textContent = currentMonthLabel();
    startHandle.style.left = `${startX}px`;
    endHandle.style.left = `${endX}px`;
    windowEl.style.left = `${startX}px`;
    windowEl.style.width = `${Math.max(0, endX - startX)}px`;
    startHandle.setAttribute("role", "slider");
    startHandle.setAttribute("aria-valuemin", "1");
    startHandle.setAttribute("aria-valuemax", String(state.month));
    startHandle.setAttribute("aria-valuenow", String(state.startMonth));
    startHandle.setAttribute("aria-valuetext", startLabel.textContent);
    endHandle.setAttribute("role", "slider");
    endHandle.setAttribute("aria-valuemin", String(state.startMonth));
    endHandle.setAttribute("aria-valuemax", String(maxMonthIndex));
    endHandle.setAttribute("aria-valuenow", String(state.month));
    endHandle.setAttribute("aria-valuetext", endLabel.textContent);
  }

  function monthFromPointer(event) {
    const rect = byId("timeline-track").getBoundingClientRect();
    const metrics = timelineMetrics();
    const relative = Math.max(metrics.edgePad, Math.min(metrics.width - metrics.edgePad, event.clientX - rect.left));
    return clampMonth(((relative - metrics.edgePad) / metrics.usableWidth) * Math.max(1, maxMonthIndex - 1) + 1);
  }

  function worldFeatureCountry(feature) {
    const name = feature.properties.name;
    return featureCountryAliases[name] || name;
  }

  function worldBucketCountry(country) {
    return country === "Taiwan Province" ? "China" : country;
  }

  function displayCountry(name) {
    if (name === "Taiwan Province") return "台湾 · 中国";
    return countryZh[name] || name;
  }

  function displayWorldFeatureCountry(feature, country) {
    if (feature.properties.name === "Taiwan Province") return "台湾 · 中国";
    return displayCountry(country);
  }

  function materialMatchesRegion(material) {
    return true;
  }

  function materialHasChinaLocation(material) {
    return (material.affiliations || []).some((item) => item.country === "China" || item.country === "Taiwan Province")
      || (material.companies || []).some((company) => company.country === "China" || company.country === "Taiwan Province");
  }

  function materialMatchesProvince(material, province) {
    return (material.affiliations || []).some((item) => (
      (item.country === "China" && item.region === province)
      || (province === "Taiwan Province" && item.country === "Taiwan Province")
    ))
      || (material.companies || []).some((company) => (
        (company.country === "China" && company.region === province)
        || (province === "Taiwan Province" && company.country === "Taiwan Province")
      ));
  }

  function materialMatchesMapRegion(material, region) {
    if (!region) return state.mapMode === "china" ? materialHasChinaLocation(material) : true;
    if (region.mode === "world") {
      return (material.affiliations || []).some((item) => worldBucketCountry(item.country) === region.key)
        || (material.companies || []).some((company) => worldBucketCountry(company.country) === region.key);
    }
    if (region.mode === "china") {
      return materialMatchesProvince(material, region.key);
    }
    return true;
  }

  function visibleMaterials() {
    const query = state.query.trim().toLowerCase();
    const materials = report.materials
      .filter((material) => material.month_index >= state.startMonth && material.month_index <= state.month)
      .filter((material) => !state.companyIds.length || state.companyIds.some((id) => material.company_ids.includes(id)))
      .filter((material) => !state.applications.length || state.applications.some((app) => material.applications.includes(app)))
      .filter((material) => !query || String(material.reader_search_text || material.search_text || "").includes(query))
      .filter(materialMatchesRegion);
    return materials.sort((a, b) => {
      if (state.sortMode === "score") {
        return asScore(b) - asScore(a) || b.month_index - a.month_index || a.title.localeCompare(b.title);
      }
      return b.month_index - a.month_index || asScore(b) - asScore(a) || a.title.localeCompare(b.title);
    });
  }

  function visibleCompanySummaries(materials) {
    const materialSet = new Set(materials.map((item) => item.material_id));
    return report.companies
      .map((company) => {
        const companyMaterials = company.materials
          .map((id) => report.materials.find((material) => material.material_id === id))
          .filter((material) => material && materialSet.has(material.material_id));
        return {
          ...company,
          visible_count: companyMaterials.length,
          visible_applications: Array.from(new Set(companyMaterials.flatMap((item) => item.applications))).sort(),
          latest_month: Math.max(0, ...companyMaterials.map((item) => item.month_index))
        };
      })
      .filter((company) => !state.companyIds.length || state.companyIds.includes(company.company_id))
      .filter((company) => company.visible_count > 0)
      .sort((a, b) => b.visible_count - a.visible_count || a.display_name.localeCompare(b.display_name));
  }

  function bucketTemplate(names) {
    const buckets = {};
    names.forEach((name) => {
      buckets[name] = { contribution_total: 0, entry_count: 0, company_count: 0, progress_index: 0, entry_ids: new Set(), company_ids: new Set() };
    });
    return buckets;
  }

  function addBucket(buckets, name, value, materialId) {
    if (!name) return;
    if (!buckets[name]) {
      buckets[name] = { contribution_total: 0, entry_count: 0, company_count: 0, progress_index: 0, entry_ids: new Set(), company_ids: new Set() };
    }
    buckets[name].contribution_total += value;
    buckets[name].entry_ids.add(materialId);
  }

  function addCompanyBucket(buckets, name, companyId) {
    if (!name || !companyId) return;
    if (!buckets[name]) {
      buckets[name] = { contribution_total: 0, entry_count: 0, company_count: 0, progress_index: 0, entry_ids: new Set(), company_ids: new Set() };
    }
    buckets[name].company_ids.add(companyId);
  }

  function finalizeBuckets(buckets) {
    const values = Object.values(buckets);
    const max = Math.max(0, ...values.map((item) => item.contribution_total));
    Object.values(buckets).forEach((item) => {
      item.entry_count = item.entry_ids.size;
      item.company_count = item.company_ids.size;
      item.progress_index = max ? (item.contribution_total / max) * 100 : 0;
    });
    return buckets;
  }

  function aggregateForMaterials(materials) {
    const countryNames = Array.from(new Set(report.maps.world_regions.features.map(worldFeatureCountry)));
    const world = bucketTemplate(countryNames);
    const provinceNames = report.maps.china_provinces.features.map((feature) => feature.properties.name);
    const china = bucketTemplate(provinceNames);
    if (!china["Taiwan Province"]) {
      china["Taiwan Province"] = { contribution_total: 0, entry_count: 0, company_count: 0, progress_index: 0, entry_ids: new Set(), company_ids: new Set() };
    }
    materials.forEach((material) => {
      (material.companies || []).forEach((company) => {
        addCompanyBucket(world, worldBucketCountry(company.country), company.company_id);
        if (company.country === "China" && company.region) {
          addCompanyBucket(china, company.region, company.company_id);
        }
      });
      const affiliations = (material.affiliations || []).filter((item) => item.country);
      if (!affiliations.length) return;
      const weight = asScore(material) / affiliations.length;
      affiliations.forEach((affiliation) => {
        addBucket(world, worldBucketCountry(affiliation.country), weight, material.material_id);
        if (affiliation.country === "China" && affiliation.region) {
          addBucket(china, affiliation.region, weight, material.material_id);
        }
      });
    });
    return { world: finalizeBuckets(world), china: finalizeBuckets(china) };
  }

  function mapDataFromBuckets(buckets, names) {
    return names.map((name) => {
      const item = buckets[name] || { contribution_total: 0, entry_count: 0, progress_index: 0 };
      return {
        name,
        value: Number(item.progress_index.toFixed(2)),
        contribution_total: Number(item.contribution_total.toFixed(2)),
        entry_count: item.entry_count,
        company_count: item.company_count
      };
    });
  }

  function worldMapDataFromBuckets(buckets) {
    return report.maps.world_regions.features.map((feature) => {
      const country = worldFeatureCountry(feature);
      const item = buckets[country] || { contribution_total: 0, entry_count: 0, company_count: 0, progress_index: 0 };
      return {
        name: feature.properties.name,
        country_key: country,
        display_name: displayWorldFeatureCountry(feature, country),
        value: Number(item.progress_index.toFixed(2)),
        contribution_total: Number(item.contribution_total.toFixed(2)),
        entry_count: item.entry_count,
        company_count: item.company_count
      };
    });
  }

  function renderCompanies(companies) {
    byId("company-count").textContent = String(companies.length);
    byId("company-list").innerHTML = companies.map((company) => {
      const selected = state.companyIds.includes(company.company_id) ? " is-selected" : "";
      const mark = escapeHtml(company.icon && (company.icon.lettermark || company.display_name.slice(0, 2)));
      const applications = company.visible_applications.slice(0, 2).map(escapeHtml).join("、") || "暂无事件";
      const countryLabel = countryZh[company.country] || company.country || "未知地区";
      const regionLabel = company.region_label || company.region || "";
      return `<article class="company-card${selected}" tabindex="0" role="button" data-company="${escapeHtml(company.company_id)}">
        <span class="lettermark">${mark}</span>
        <span class="company-main">
          <strong>${escapeHtml(company.display_name)}</strong>
          <span>${escapeHtml(countryLabel)}${regionLabel ? ` · ${escapeHtml(regionLabel)}` : ""}</span>
        </span>
        <span class="company-meta">${company.visible_count} 个事件</span>
        <span class="company-apps">${applications}</span>
        ${selected ? renderCompanyProfile(company, applications) : ""}
      </article>`;
    }).join("");
  }

  function financeLabel(company) {
    const finance = company.finance || {};
    if (finance.status === "public") {
      return finance.ticker ? `上市公司 · ${finance.ticker}` : "上市公司";
    }
    if (finance.status === "private") return "非上市公司";
    return "市场状态待补充";
  }

  function renderCompanyProfile(company, applications) {
    const profile = company.profile || {};
    const summary = profile.reader_summary || "公司背景资料待补充。";
    const relevance = profile.reader_quantum_relevance || "量子相关性资料待补充。";
    const market = profile.reader_market_context || "市场背景资料待补充。";
    const marketDisplay = company.market_display || { label: "市场数值", value: "待补充" };
    const officialUrl = profile.official_url || company.official_url || "";
    const sourceLinks = [
      officialUrl
        ? `<a class="official-link" href="${escapeHtml(officialUrl)}" target="_blank" rel="noreferrer">官网</a>`
        : `<span>官网待补充</span>`,
      marketDisplay.source_url
        ? `<a href="${escapeHtml(marketDisplay.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(marketDisplay.source_title || "来源")}</a>`
        : "<span>资料待补充</span>"
    ].join("");
    const regionLabel = company.region_label || company.region || "";
    const hq = `${countryZh[company.country] || company.country || "未知地区"}${regionLabel ? ` · ${regionLabel}` : ""}`;
    return `<section class="company-profile" aria-label="${escapeHtml(company.display_name)} 公司背景">
      <strong>公司背景</strong>
      <p>${escapeHtml(summary)}</p>
      <dl>
        <div><dt>量子相关性</dt><dd>${escapeHtml(relevance)}</dd></div>
        <div><dt>市场背景</dt><dd>${escapeHtml(market)}</dd></div>
        <div><dt>${escapeHtml(marketDisplay.label || "市场数值")}</dt><dd>${escapeHtml(marketDisplay.value || "待补充")}${marketDisplay.estimate ? " · 估算" : ""}</dd></div>
        <div><dt>总部</dt><dd>${escapeHtml(hq)}</dd></div>
        <div><dt>市场状态</dt><dd>${escapeHtml(financeLabel(company))}</dd></div>
        <div><dt>本年度事件</dt><dd>${company.visible_count} 个 · ${applications}</dd></div>
        <div><dt>资料来源</dt><dd class="profile-source-links">${sourceLinks}</dd></div>
      </dl>
    </section>`;
  }

  function topEventMaterials(materials) {
    const region = state.pinnedRegion || state.hoverRegion;
    return materials
      .filter((material) => materialMatchesMapRegion(material, region))
      .sort((a, b) => asScore(b) - asScore(a) || b.month_index - a.month_index || a.title.localeCompare(b.title))
      .slice(0, 5);
  }

  function renderTopEvents(materials) {
    const items = topEventMaterials(materials);
    byId("top-events").innerHTML = `
      <div class="top-events-heading">
        <h2>Top 事件</h2>
      </div>
      <div class="top-event-list">
        ${items.map((material) => `
          <button class="top-event-card" type="button" data-top-material="${escapeHtml(material.material_id)}">
            <strong>${escapeHtml(readerEventTitle(material))}</strong>
            <small>${escapeHtml(material.company_names.join("、"))}</small>
            <time class="top-event-year" datetime="${escapeHtml(material.year)}">${escapeHtml(material.year)}</time>
          </button>`).join("") || `<p class="empty-state">当前范围暂无事件。</p>`}
      </div>`;
  }

  function renderMaterials(materials) {
    byId("material-count").textContent = String(materials.length);
    byId("material-list").innerHTML = materials.map((material) => {
      const selected = state.detailOpen && state.selectedMaterialId === material.material_id ? " is-selected" : "";
      const companies = material.company_names.map(escapeHtml).join("、");
      const badges = materialCardBadges(material).map(renderMaterialBadge).join("");
      return `<article class="material-card${selected}" tabindex="0" role="button" data-material="${escapeHtml(material.material_id)}" data-month-index="${Number(material.month_index || 0)}" data-score="${escapeHtml(cardScore(material))}">
        <div class="material-title-row">
          <h3>${escapeHtml(readerEventTitle(material))}</h3>
          <time class="material-date">${escapeHtml(material.month_label)}</time>
        </div>
        <div class="material-info-row">
          <p>${companies}</p>
          ${badges ? `<div class="material-badges">${badges}</div>` : ""}
        </div>
      </article>`;
    }).join("") || `<p class="empty-state">当前筛选下暂无事件。</p>`;
  }

  function renderFilterPopover(materials) {
    const applications = Array.from(new Set(report.materials.flatMap((material) => material.applications))).sort();
    byId("filter-popover").innerHTML = `
      <div class="filter-section">
        <strong>应用方向</strong>
        <button type="button" data-application="">全部</button>
        ${applications.map((application) => {
          const count = materials.filter((material) => material.applications.includes(application)).length;
          const active = state.applications.includes(application) ? " class=\"is-selected\"" : "";
          return `<button type="button" data-application="${escapeHtml(application)}"${active}>${escapeHtml(application)} <small>${count}</small></button>`;
        }).join("")}
      </div>`;
  }

  function renderActiveFilters() {
    const companiesById = Object.fromEntries(report.companies.map((company) => [company.company_id, company]));
    const badges = [
      ...state.applications.map((application) => ({
        type: "application",
        value: application,
        label: `应用：${application}`
      })),
      ...state.companyIds.map((companyId) => ({
        type: "company",
        value: companyId,
        label: `公司：${(companiesById[companyId] && companiesById[companyId].display_name) || companyId}`
      }))
    ];
    byId("active-filters").innerHTML = badges.map((badge) => `
      <button class="filter-badge" type="button" data-remove-filter="${escapeHtml(badge.type)}" data-filter-value="${escapeHtml(badge.value)}">
        ${escapeHtml(badge.label)} <span aria-hidden="true">×</span>
      </button>`).join("");
  }

  function displayEvidenceType(value) {
    return evidenceTypeZh[value] || value || "正式来源";
  }

  function relationLabel(value) {
    return {
      cites: "引用",
      cited_by: "被引用",
      related: "相关"
    }[value] || "相关";
  }

  function relatedEvents(material) {
    const relationGraph = (report.relations && report.relations.entries) || {};
    const related = (relationGraph[material.material_id] && relationGraph[material.material_id].related) || [];
    return related
      .map((relation) => {
        const target = report.materials.find((item) => item.material_id === relation.entry_id);
        return target ? { relation: relation.relation, material: target } : null;
      })
      .filter(Boolean);
  }

  function renderRelatedEvents(material) {
    const items = relatedEvents(material);
    if (!items.length) return "";
    const cards = items.map((item) => `
      <button class="related-event-card" type="button" data-related-material="${escapeHtml(item.material.material_id)}">
        <span>${escapeHtml(relationLabel(item.relation))}</span>
        <strong>${escapeHtml(readerEventTitle(item.material))}</strong>
        <small>${escapeHtml(item.material.month_label || fullMonthLabel(item.material))}</small>
      </button>
    `).join("");
    return `
      <section class="related-events">
        <h3>相关事件</h3>
        <div class="related-event-list">${cards}</div>
      </section>
    `;
  }

  function renderDetail(materials) {
    const selected = materials.find((item) => item.material_id === state.selectedMaterialId);
    const panel = byId("detail-panel");
    const overlay = byId("detail-overlay");
    if (!state.detailOpen || !selected) {
      panel.hidden = true;
      overlay.hidden = true;
      panel.innerHTML = "";
      return;
    }
    const keywords = detailKeywordItems(selected).map((keyword) => (
      `<button class="detail-keyword-chip" type="button" data-keyword-filter="${escapeHtml(keyword.label)}" data-keyword-value="${escapeHtml(keyword.value)}">${escapeHtml(keyword.label)}</button>`
    )).join("");
    const companyChips = (selected.companies || []).map((company) => `
      <button class="detail-company-chip" type="button" data-company-filter="${escapeHtml(company.company_id)}">${escapeHtml(company.display_name)}</button>
    `).join("");
    const assessmentItems = Object.values(selected.assessments).map((item) => `
      <li>
        <strong>${escapeHtml(item.axis_zh)} ${Number(item.points || 0)}/${Number(item.assessment_max_points || 0)}</strong>
        <span>${escapeHtml(item.zh_label)}</span>
        <p>${escapeHtml(item.reader_rationale || item.rationale)}</p>
      </li>`).join("");
    const evidenceItems = selected.evidence_items.map((item) => `
      <li>
        <a href="${escapeHtml(item.url)}" title="${escapeHtml(item.title)}">${escapeHtml(item.evidence_short_label || item.title)}</a>
        <span>${escapeHtml(item.published_date)} · ${escapeHtml(displayEvidenceType(item.evidence_type))}</span>
      </li>`).join("");
    panel.hidden = false;
    overlay.hidden = false;
    panel.innerHTML = `
      <button class="detail-close" type="button" data-close-detail aria-label="关闭事件详情">×</button>
      <div class="detail-heading">
        <p class="detail-kicker">事件详情</p>
        <h2>${escapeHtml(selected.title)}</h2>
      </div>
      <div class="detail-meta">
        <span>日期：${escapeHtml(selected.date_label || fullMonthLabel(selected))}</span>
      </div>
      <div class="detail-body">
        <div class="detail-main">
          <section class="score-summary">
            <h3>商业化进展指数</h3>
            <div class="score-summary-body">
              <strong>${escapeHtml(shortScore(selected))}</strong>
              <p>${escapeHtml(selected.score_comment || "")}</p>
            </div>
          </section>
          ${companyChips ? `<section>
            <h3>相关公司</h3>
            <div class="detail-chip-row">${companyChips}</div>
          </section>` : ""}
          ${keywords ? `<section>
            <h3>关键词</h3>
            <div class="detail-keywords detail-chip-row">${keywords}</div>
          </section>` : ""}
          <section>
            <h3>正式来源</h3>
            <ul class="evidence-list">${evidenceItems}</ul>
          </section>
        </div>
        <section class="detail-support">
          <h3>判断依据</h3>
          <ul class="detail-list">${assessmentItems}</ul>
        </section>
      </div>
      ${renderRelatedEvents(selected)}`;
  }

  function renderAdvanced(materials) {
    byId("advanced-body").innerHTML = materials.map((material) => `
      <tr>
        <td>${escapeHtml(material.title)}</td>
        <td>${escapeHtml(material.month_label)}</td>
        <td>${escapeHtml(material.company_names.join("、"))}</td>
        <td>${escapeHtml(material.applications.join("、"))}</td>
        <td>${escapeHtml(shortScore(material))}</td>
      </tr>`).join("");
  }

  function renderCharts(materials) {
    if (!window.echarts) return;
    const geo = aggregateForMaterials(materials);
    const worldData = worldMapDataFromBuckets(geo.world);
    const provinceNames = report.maps.china_provinces.features.map((feature) => feature.properties.name);
    const chinaData = mapDataFromBuckets(geo.china, provinceNames);
    const tooltip = {
      trigger: "item",
      backgroundColor: "rgba(255, 255, 255, 0.96)",
      borderColor: "#d9dfd6",
      borderWidth: 1,
      padding: [10, 12],
      textStyle: {
        color: "#18221f",
        fontSize: 12,
        lineHeight: 20
      },
      extraCssText: "border-radius:8px;box-shadow:0 16px 34px rgba(49,73,63,.14);",
      formatter(params) {
        const item = params.data || {};
        const displayName = item.display_name || provinceZh[params.name] || displayCountry(params.name);
        return `<strong>${escapeHtml(displayName)}</strong><br>活跃指数：${Number(item.value || 0).toFixed(1)}`;
      }
    };
    const visualMap = {
      type: "piecewise",
      min: 0,
      max: 100,
      show: false,
      pieces: [
        { min: 0, max: 0, color: "#f5f6f2" },
        { min: 0.01, max: 12, color: "#b7d5c4" },
        { min: 12.01, max: 35, color: "#78aa94" },
        { min: 35.01, max: 65, color: "#3e7868" },
        { min: 65.01, max: 100, color: "#18473d" }
      ]
    };
    echarts.registerMap("worldRegions", report.maps.world_regions);
    echarts.registerMap("chinaProvinces", report.maps.china_provinces);
    if (!charts.world) {
      charts.world = echarts.init(byId("world-map"));
      charts.world.on("click", (params) => {
        charts.world.dispatchAction({ type: "unselect", seriesIndex: 0, name: params.name });
        const key = params.data && params.data.country_key;
        if (params.name === "China" || key === "China" || params.name === "Taiwan Province" || key === "Taiwan Province") {
          state.pinnedRegion = null;
          showChina();
          return;
        }
        setPinnedRegion("world", key);
      });
      charts.world.on("mouseover", (params) => {
        const key = params.data && params.data.country_key;
        state.hoverRegion = key ? { mode: "world", key } : null;
        renderTopEvents(visibleMaterials());
      });
      charts.world.on("mouseout", () => {
        state.hoverRegion = null;
        renderTopEvents(visibleMaterials());
      });
    }
    charts.world.setOption({
      tooltip,
      visualMap,
      series: [{
        name: "活跃指数",
        type: "map",
        map: "worldRegions",
        roam: false,
        selectedMode: false,
        layoutCenter: MAP_VIEW.world.layoutCenter,
        layoutSize: MAP_VIEW.world.layoutSize,
        itemStyle: {
          borderColor: "#8a9690",
          borderWidth: 0.55,
          areaColor: "#f5f6f2"
        },
        emphasis: {
          label: { show: false },
          itemStyle: { areaColor: "#dce7e1" }
        },
        select: {
          label: { show: false },
          itemStyle: { areaColor: "#dce7e1", borderColor: "#8a9690" }
        },
        data: worldData
      }]
    });
    if (!charts.china && !byId("china-map-panel").hidden) {
      charts.china = echarts.init(byId("china-map"));
      charts.china.on("click", (params) => {
        charts.china.dispatchAction({ type: "unselect", seriesIndex: 0, name: params.name });
        setPinnedRegion("china", params.name);
      });
      charts.china.on("mouseover", (params) => {
        state.hoverRegion = params.name ? { mode: "china", key: params.name } : null;
        renderTopEvents(visibleMaterials());
      });
      charts.china.on("mouseout", () => {
        state.hoverRegion = null;
        renderTopEvents(visibleMaterials());
      });
    }
    if (charts.china) {
      charts.china.setOption({
        tooltip,
        visualMap,
        series: [{
          name: "活跃指数",
          type: "map",
          map: "chinaProvinces",
          roam: false,
          selectedMode: false,
          layoutCenter: MAP_VIEW.china.layoutCenter,
          layoutSize: MAP_VIEW.china.layoutSize,
          itemStyle: {
            borderColor: "#8a9690",
            borderWidth: 0.55,
            areaColor: "#f5f6f2"
          },
        emphasis: {
          label: { show: false },
            itemStyle: { areaColor: "#dce7e1" }
          },
          select: {
            label: { show: false },
            itemStyle: { areaColor: "#dce7e1", borderColor: "#8a9690" }
          },
          data: chinaData
        }]
      });
    }
  }

  function switchMap(targetMode) {
    if (state.mapMode === targetMode) return;
    const shell = byId("map-shell");
    window.clearTimeout(mapSwitchTimer);
    shell.classList.add("is-switching");
    mapSwitchTimer = window.setTimeout(() => {
      state.mapMode = targetMode;
      state.hoverRegion = null;
      state.pinnedRegion = null;
      byId("world-map-panel").hidden = targetMode !== "world";
      byId("china-map-panel").hidden = targetMode !== "china";
      if (targetMode === "china" && !charts.china && window.echarts) {
        charts.china = echarts.init(byId("china-map"));
      }
      render();
      window.requestAnimationFrame(() => {
        Object.values(charts).forEach((chart) => chart && chart.resize());
        shell.classList.remove("is-switching");
      });
    }, 130);
  }

  function showChina() {
    switchMap("china");
  }

  function showWorld() {
    switchMap("world");
  }

  function render() {
    updateTimelineControls();
    const materials = visibleMaterials();
    const companies = visibleCompanySummaries(materials);
    if (state.selectedMaterialId && !materials.some((material) => material.material_id === state.selectedMaterialId)) {
      state.selectedMaterialId = "";
      state.detailOpen = false;
    }
    renderCompanies(companies);
    renderTopEvents(materials);
    renderMaterials(materials);
    renderFilterPopover(materials);
    renderActiveFilters();
    renderDetail(materials);
    renderAdvanced(materials);
    renderCharts(materials);
  }

  function exportMaterials(format) {
    const materials = visibleMaterials();
    const text = format === "json"
      ? JSON.stringify(materials, null, 2)
      : [
        ["title", "month", "companies", "applications", "score"].join(","),
        ...materials.map((material) => [
          `"${material.title.replace(/"/g, '""')}"`,
          material.month_label,
          `"${material.company_names.join("、").replace(/"/g, '""')}"`,
          `"${material.applications.join("、").replace(/"/g, '""')}"`,
          asScore(material).toFixed(2)
        ].join(","))
      ].join("\n");
    const blob = new Blob([text], { type: format === "json" ? "application/json" : "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `commercial-quantum-algorithm-report-${report.year_label || report.year}.${format === "json" ? "json" : "csv"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function bindEvents() {
    function bindTimelineHandle(handleId, type) {
      const handle = byId(handleId);
      const move = (event) => {
        event.preventDefault();
        const month = monthFromPointer(event);
        if (type === "start") setStartMonth(month);
        if (type === "end") setEndMonth(month);
      };
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        handle.draggable = false;
        handle.setPointerCapture(event.pointerId);
        move(event);
      });
      handle.addEventListener("pointermove", (event) => {
        if (handle.hasPointerCapture(event.pointerId)) move(event);
      });
      handle.addEventListener("pointerup", (event) => {
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      });
      handle.addEventListener("pointercancel", (event) => {
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      });
      handle.addEventListener("keydown", (event) => {
        const current = type === "start" ? state.startMonth : state.month;
        let next = current;
        if (event.key === "ArrowLeft") next = current - 1;
        if (event.key === "ArrowRight") next = current + 1;
        if (event.key === "Home") next = type === "start" ? 1 : state.startMonth;
        if (event.key === "End") next = type === "start" ? state.month : maxMonthIndex;
        if (next === current && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        if (type === "start") setStartMonth(next);
        if (type === "end") setEndMonth(next);
      });
    }

    bindTimelineHandle("start-month-handle", "start");
    bindTimelineHandle("month-handle", "end");
    byId("timeline-track").addEventListener("pointerdown", (event) => {
      if (event.target.closest(".timeline-handle")) return;
      const month = monthFromPointer(event);
      const startDistance = Math.abs(month - state.startMonth);
      const endDistance = Math.abs(month - state.month);
      if (startDistance <= endDistance) setStartMonth(month);
      else setEndMonth(month);
    });
    byId("reader-search").addEventListener("input", (event) => {
      state.query = event.target.value;
      render();
    });
    byId("sort-select").addEventListener("change", (event) => {
      state.sortMode = event.target.value;
      render();
    });
    byId("filter-toggle").addEventListener("click", () => {
      byId("filter-popover").hidden = !byId("filter-popover").hidden;
    });
    byId("advanced-toggle").addEventListener("click", () => {
      const panel = byId("advanced-panel");
      panel.hidden = !panel.hidden;
      byId("advanced-toggle").setAttribute("aria-expanded", String(!panel.hidden));
    });
    byId("map-back").addEventListener("click", showWorld);
    byId("export-csv").addEventListener("click", () => exportMaterials("csv"));
    byId("export-json").addEventListener("click", () => exportMaterials("json"));
    document.addEventListener("click", (event) => {
      const closeDetail = event.target.closest("[data-close-detail]");
      if (closeDetail || event.target.id === "detail-overlay") {
        state.detailOpen = false;
        render();
        return;
      }
      const removeFilter = event.target.closest("[data-remove-filter]");
      if (removeFilter) {
        const type = removeFilter.getAttribute("data-remove-filter");
        const value = removeFilter.getAttribute("data-filter-value");
        if (type === "application") {
          state.applications = state.applications.filter((item) => item !== value);
        }
        if (type === "company") {
          state.companyIds = state.companyIds.filter((item) => item !== value);
        }
        render();
        return;
      }
      const company = event.target.closest("[data-company]");
      if (company) {
        if (event.target.closest(".company-profile a")) return;
        const value = company.getAttribute("data-company");
        state.companyIds = state.companyIds.length === 1 && state.companyIds[0] === value ? [] : [value];
        render();
        return;
      }
      const topMaterial = event.target.closest("[data-top-material]");
      if (topMaterial) {
        state.selectedMaterialId = topMaterial.getAttribute("data-top-material");
        state.detailOpen = true;
        render();
        window.requestAnimationFrame(() => {
          const card = document.querySelector(`[data-material="${CSS.escape(state.selectedMaterialId)}"]`);
          if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
      const detailCompany = event.target.closest("[data-company-filter]");
      if (detailCompany) {
        state.companyIds = [detailCompany.getAttribute("data-company-filter")];
        render();
        return;
      }
      const detailKeyword = event.target.closest("[data-keyword-filter]");
      if (detailKeyword) {
        const value = detailKeyword.getAttribute("data-keyword-filter");
        state.query = value;
        byId("reader-search").value = value;
        render();
        return;
      }
      const relatedMaterial = event.target.closest("[data-related-material]");
      if (relatedMaterial) {
        state.selectedMaterialId = relatedMaterial.getAttribute("data-related-material");
        state.detailOpen = true;
        render();
        return;
      }
      const material = event.target.closest("[data-material]");
      if (material) {
        state.selectedMaterialId = material.getAttribute("data-material");
        state.detailOpen = true;
        render();
        return;
      }
      const application = event.target.closest("[data-application]");
      if (application) {
        const value = application.getAttribute("data-application");
        state.applications = value
          ? (state.applications.includes(value)
            ? state.applications.filter((item) => item !== value)
            : [...state.applications, value])
          : [];
        render();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.detailOpen) {
        state.detailOpen = false;
        render();
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      const company = event.target.closest("[data-company]");
      const material = event.target.closest("[data-material]");
      if (!company && !material) return;
      event.preventDefault();
      event.target.click();
    });
    window.addEventListener("resize", () => {
      Object.values(charts).forEach((chart) => chart && chart.resize());
    });
  }

  bindEvents();
  render();
  function setHoverRegion(mode, key) {
    state.hoverRegion = key ? { mode, key } : null;
    renderTopEvents(visibleMaterials());
  }

  function setPinnedRegion(mode, key) {
    state.pinnedRegion = key ? { mode, key } : null;
    renderTopEvents(visibleMaterials());
  }

  window.qalgReportState = {
    state,
    visibleMaterials,
    render,
    showChina,
    showWorld,
    setHoverRegion,
    setPinnedRegion,
    setTimelineRange
  };
})();
