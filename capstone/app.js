const pickupRows = document.querySelector('#pickup-rows');
const pickupSearch = document.querySelector('#pickup-search');
const globalSearch = document.querySelector('#global-search');
const statusFilter = document.querySelector('#status-filter');
const emptyState = document.querySelector('#empty-state');
const pickupDialog = document.querySelector('#pickup-dialog');
const pickupForm = document.querySelector('#pickup-form');
const toast = document.querySelector('#toast');
const connectionBanner = document.querySelector('#connection-banner');

const $ = (selector) => document.querySelector(selector);
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const safeText = (selector, value) => {
  const element = $(selector);
  if (element) element.textContent = value;
};

document.body.classList.toggle('compact-mode', localStorage.getItem('recollect-compact') === 'true');
document.body.classList.toggle('reduce-motion', localStorage.getItem('recollect-reduce-motion') === 'true');

const statusLabels = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  planned: 'Planned',
  received: 'Received',
  processing: 'Processing',
  rejected: 'Rejected',
};
const categoryColors = ['#36794b', '#8eb68c', '#e2b270', '#789ca0', '#c58d72', '#a799c1'];
let toastTimeout;
let searchTimeout;
let currentPage = 1;
let totalPages = 1;
let totalCount = 0;
let latestCategories = [];
let latestDistricts = [];
let latestDeviceOptions = [];
let selectedPickup = null;
let openMenu = null;

async function apiRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Could not reach the dashboard server. Start it with npm start and reload this page.');
  }

  const text = await response.text();
  let result = {};
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      result = {};
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      const endpoint = new URL(url, window.location.href).pathname;
      throw new Error(
        `API endpoint ${endpoint} was not found. Run npm start from this project, then open the dashboard URL printed in the terminal (not a static Live Server page).`,
      );
    }
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return result;
}

function showError(message) {
  if (!connectionBanner) return;
  connectionBanner.textContent = message;
  connectionBanner.hidden = false;
}

function clearError() {
  if (!connectionBanner) return;
  connectionBanner.textContent = '';
  connectionBanner.hidden = true;
}

function closeActionMenu() {
  if (!openMenu) return;
  openMenu.button.setAttribute('aria-expanded', 'false');
  openMenu.element.remove();
  openMenu = null;
}

function showActionMenu(button, actions) {
  if (openMenu?.button === button) {
    closeActionMenu();
    return;
  }
  closeActionMenu();

  const menu = document.createElement('div');
  menu.className = 'action-menu';
  menu.setAttribute('role', 'menu');
  actions.forEach(({ label, action, disabled = false }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'action-menu-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    item.disabled = disabled;
    item.addEventListener('click', () => {
      closeActionMenu();
      action();
    });
    menu.append(item);
  });

  button.parentElement.append(menu);
  button.setAttribute('aria-expanded', 'true');
  openMenu = { button, element: menu };
  menu.querySelector('button:not(:disabled)')?.focus();
}

function openSettings() {
  closeActionMenu();
  const compact = $('#compact-setting');
  const reduceMotion = $('#motion-setting');
  compact.checked = localStorage.getItem('recollect-compact') === 'true';
  reduceMotion.checked = localStorage.getItem('recollect-reduce-motion') === 'true';
  document.body.classList.toggle('compact-mode', compact.checked);
  document.body.classList.toggle('reduce-motion', reduceMotion.checked);
  $('#settings-dialog').showModal();
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refreshDashboard() {
  await loadDashboard();
}

function showPageView(name, { updateHistory = true, loadData = true } = {}) {
  const viewId = `view-${name.toLowerCase()}`;
  const targetView = $(`#${viewId}`);
  if (!targetView) return false;

  document.querySelectorAll('[data-page-view]').forEach((view) => {
    view.hidden = view !== targetView;
  });
  document.querySelectorAll('.nav-link[data-view]').forEach((link) => {
    const active = link.dataset.view === name;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  safeText('.breadcrumbs strong', name);
  window.scrollTo({ top: 0, behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth' });

  if (updateHistory && window.location.hash !== `#${viewId}`) {
    window.history.pushState({ view: name }, '', `#${viewId}`);
  }

  if (loadData) {
    if (name === 'Pickups') loadPickups(1);
    if (name === 'Routes') loadRoutes();
    if (name === 'Recycling') loadRecycling();
    if (name === 'Partners') loadPartners();
    if (name === 'Reports') loadReports();
  }

  return true;
}

function formatNumber(value, maximumFractionDigits = 0) {
  return toNumber(value, 0).toLocaleString(undefined, { maximumFractionDigits });
}

function formatDate(value, options = { month: 'short', day: '2-digit', year: 'numeric' }) {
  if (!value) return 'Not scheduled';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
}

function renderMetricData(metrics = {}) {
  const recycledKg = toNumber(metrics.recycled_weight_kg_this_month, 0);
  const goalKg = toNumber(metrics.recycling_goal_kg, 0);
  const progress = goalKg > 0 ? Math.min(100, (recycledKg / goalKg) * 100) : 0;

  safeText('#metric-pickups', formatNumber(metrics.pickups_requested_this_month));
  safeText('#metric-awaiting', formatNumber(metrics.awaiting_collection));
  safeText('#metric-attention', `${formatNumber(metrics.needing_attention)} need attention`);
  safeText('#metric-recycled', formatNumber(recycledKg, 1));
  safeText('#metric-partners', formatNumber(metrics.active_partners));
  safeText('#metric-goal-label', goalKg > 0 ? `of ${formatNumber(goalKg)} kg monthly goal` : 'No monthly goal set');
  const goalProgress = $('#goal-progress');
  if (goalProgress) goalProgress.style.width = `${progress}%`;

  const impactCopy = $('#impact-copy');
  if (impactCopy) {
    impactCopy.textContent = `Your community has recycled ${formatNumber(recycledKg, 1)} kg of e-waste this month.`;
  }
  const impactProgress = document.querySelector('.impact-progress span');
  if (impactProgress) impactProgress.style.width = `${progress}%`;
  const impactGoal = $('#impact-goal');
  if (impactGoal) impactGoal.textContent = `${formatNumber(progress)}% of monthly goal`;
}

function renderImpact(impact = {}) {
  const co2 = toNumber(impact.co2SavedKg, 0);
  const trees = toNumber(impact.treesEquivalent, 0);
  const toxic = toNumber(impact.toxicPreventedGrams, 0);
  const energy = toNumber(impact.energySavedKwh, 0);
  const homes = toNumber(impact.homesPoweredDays, 0);
  const metals = toNumber(impact.preciousMetalsGrams, 0);

  // Overview eco panel
  safeText('#eco-co2', formatNumber(co2, 1));
  safeText('#eco-trees', `Equivalent to ~${formatNumber(trees, 1)} mature trees / yr`);
  safeText('#eco-toxic', formatNumber(toxic, 1));
  safeText('#eco-energy', formatNumber(energy, 1));
  safeText('#eco-homes', `Powers average home for ~${formatNumber(homes, 1)} days`);
  safeText('#eco-metals', formatNumber(metals, 2));

  // Reports eco audit
  safeText('#report-eco-co2', formatNumber(co2, 1));
  safeText('#report-eco-trees', `Equivalent to ~${formatNumber(trees, 1)} mature trees`);
  safeText('#report-eco-toxic', formatNumber(toxic, 1));
  safeText('#report-eco-energy', formatNumber(energy, 1));
  safeText('#report-eco-homes', `Saves ~${formatNumber(homes, 1)} days of home power`);
  safeText('#report-eco-metals', formatNumber(metals, 2));
}

async function updatePickupStatus(pickupId, newStatus) {
  try {
    const result = await apiRequest(`/api/pickups/${pickupId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    showToast('Status updated', `Pickup #${result.pickup.request_code} is now marked as ${statusLabels[newStatus] || newStatus}.`);
    if ($('#pickup-details-dialog').open) {
      $('#pickup-details-dialog').close();
    }
    await loadDashboard();
  } catch (error) {
    showToast('Status update failed', error.message);
  }
}

async function deletePickup(pickup) {
  const confirmed = window.confirm(
    `Are you sure you want to permanently delete collection request #${pickup.request_code} (${pickup.location_name})?\n\nThis will remove the pickup and related consignment records.`,
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/pickups/${pickup.id}`, { method: 'DELETE' });
    showToast('Pickup deleted', `Request #${pickup.request_code} was removed.`);
    if ($('#pickup-details-dialog').open) {
      $('#pickup-details-dialog').close();
    }
    await loadDashboard();
  } catch (error) {
    showToast('Delete failed', error.message);
  }
}

async function openEditPickup(pickup) {
  try {
    const result = await apiRequest(`/api/pickups/${pickup.id}`);
    const fullPickup = result.pickup;
    selectedPickup = fullPickup;

    const editForm = $('#pickup-edit-form');
    editForm.elements.location.value = fullPickup.location_name || '';
    renderOptions(editForm.elements.district, latestDistricts, 'Select district');
    renderOptions(editForm.elements.device, latestDeviceOptions, 'Select device category');
    editForm.elements.district.value = fullPickup.district_id || '';
    editForm.elements.device.value = fullPickup.device_category_id || '';
    editForm.elements.weight.value = toNumber(fullPickup.estimated_weight_kg, 1);
    editForm.elements.date.value = fullPickup.scheduled_for ? String(fullPickup.scheduled_for).slice(0, 10) : '';
    editForm.elements.notes.value = fullPickup.notes || '';

    safeText('#edit-dialog-subtitle', `Modifying Request #${fullPickup.request_code}`);
    if ($('#pickup-details-dialog').open) {
      $('#pickup-details-dialog').close();
    }
    $('#pickup-edit-dialog').showModal();
  } catch (error) {
    showToast('Loading error', error.message);
  }
}

async function openCertificate(requestCode) {
  try {
    const cert = await apiRequest(`/api/certificates/${encodeURIComponent(requestCode)}`);
    safeText('#cert-id', cert.certificateId);
    safeText('#cert-hash', cert.verificationCode);
    safeText('#cert-workspace', cert.workspaceName);
    safeText('#cert-client', cert.organizationName);
    safeText('#cert-district', cert.district);
    safeText('#cert-date', formatDate(cert.collectionDate));
    safeText('#cert-categories', cert.categories);
    safeText('#cert-weight', `${formatNumber(cert.weightKg, 1)} kg`);

    safeText('#cert-co2', formatNumber(cert.environmentalImpact.co2OffsetKg, 1));
    safeText('#cert-trees', formatNumber(cert.environmentalImpact.treesEquivalent, 1));
    safeText('#cert-toxic', formatNumber(cert.environmentalImpact.toxicPreventedGrams, 1));
    safeText('#cert-metals', formatNumber(cert.environmentalImpact.preciousMetalsGrams, 2));

    if ($('#pickup-details-dialog').open) {
      $('#pickup-details-dialog').close();
    }
    $('#certificate-dialog').showModal();
  } catch (error) {
    showToast('Certificate unavailable', error.message);
  }
}

function renderCategories(categories = []) {
  latestCategories = Array.isArray(categories) ? categories : [];
  const legend = $('#category-legend');
  const donut = document.querySelector('.donut');
  const total = latestCategories.reduce((sum, category) => sum + toNumber(category.item_count, 0), 0);
  safeText('#category-total', formatNumber(total));
  if (!legend) return;
  legend.replaceChildren();

  if (total === 0) {
    const message = document.createElement('span');
    message.className = 'category-empty';
    message.textContent = 'No collected items this month';
    legend.append(message);
    if (donut) donut.style.background = '#e8ece6';
    return;
  }

  let offset = 0;
  const segments = [];
  latestCategories.forEach((category, index) => {
    const count = toNumber(category.item_count, 0);
    if (count === 0) return;
    const percentage = (count / total) * 100;
    const color = categoryColors[index % categoryColors.length];
    segments.push(`${color} ${offset}% ${offset + percentage}%`);
    offset += percentage;

    const row = document.createElement('div');
    const colorDot = document.createElement('i');
    colorDot.className = 'category-color';
    colorDot.style.backgroundColor = color;
    const name = document.createElement('span');
    name.textContent = category.name;
    const amount = document.createElement('b');
    amount.textContent = `${Math.round(percentage)}%`;
    row.append(colorDot, name, amount);
    legend.append(row);
  });

  if (donut) donut.style.background = `conic-gradient(${segments.join(', ')})`;
}

function getInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'EW';
}

function renderPickups(pickups) {
  pickupRows.replaceChildren();
  pickups.forEach((pickup) => {
    const row = document.createElement('tr');
    row.dataset.status = pickup.status;
    row.pickup = pickup;

    const idCell = row.insertCell();
    const requestCode = document.createElement('span');
    requestCode.className = 'request-id';
    requestCode.textContent = `#${pickup.request_code}`;
    idCell.append(requestCode);

    const locationCell = row.insertCell();
    const location = document.createElement('div');
    location.className = 'location-cell';
    const avatar = document.createElement('span');
    avatar.className = 'location-avatar mint';
    avatar.textContent = getInitials(pickup.location_name);
    const locationDetails = document.createElement('span');
    const locationName = document.createElement('strong');
    locationName.textContent = pickup.location_name;
    const districtName = document.createElement('small');
    districtName.textContent = pickup.district_name;
    locationDetails.append(locationName, districtName);
    location.append(avatar, locationDetails);
    locationCell.append(location);

    const deviceCell = row.insertCell();
    const devicePill = document.createElement('span');
    devicePill.className = 'device-pill';
    const deviceDot = document.createElement('i');
    deviceDot.className = 'device-dot';
    const deviceName = document.createElement('span');
    deviceName.textContent = pickup.device_types;
    devicePill.append(deviceDot, deviceName);
    deviceCell.append(devicePill);

    const weightCell = row.insertCell();
    weightCell.textContent = `${formatNumber(pickup.estimated_weight_kg, 1)} kg`;
    const dateCell = row.insertCell();
    dateCell.textContent = formatDate(pickup.scheduled_for);

    const statusCell = row.insertCell();
    const badge = document.createElement('span');
    badge.className = `status-badge ${pickup.status.replace('_', '-')}`;
    const badgeDot = document.createElement('i');
    badge.append(badgeDot, document.createTextNode(statusLabels[pickup.status] || pickup.status));
    statusCell.append(badge);

    const actionCell = row.insertCell();
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'row-more';
    actionButton.setAttribute('aria-label', `Options for ${pickup.request_code}`);
    actionButton.setAttribute('aria-haspopup', 'menu');
    actionButton.textContent = '···';
    actionButton.addEventListener('click', (event) => {
      event.stopPropagation();
      showActionMenu(actionButton, [
        { label: 'View details', action: () => showPickupDetails(pickup) },
        { label: 'Status: In progress', action: () => updatePickupStatus(pickup.id, 'in_progress'), disabled: pickup.status === 'in_progress' },
        { label: 'Status: Completed', action: () => updatePickupStatus(pickup.id, 'completed'), disabled: pickup.status === 'completed' },
        { label: 'Status: Scheduled', action: () => updatePickupStatus(pickup.id, 'scheduled'), disabled: pickup.status === 'scheduled' },
        { label: 'Status: Cancelled', action: () => updatePickupStatus(pickup.id, 'cancelled'), disabled: pickup.status === 'cancelled' },
        { label: 'Edit pickup', action: () => openEditPickup(pickup) },
        { label: 'Green certificate', action: () => openCertificate(pickup.request_code) },
        { label: 'Delete pickup', action: () => deletePickup(pickup) },
      ]);
    });
    actionCell.append(actionButton);
    row.style.cursor = 'pointer';
    row.addEventListener('click', (event) => {
      if (event.target.closest('.row-more') || event.target.closest('.action-menu')) return;
      showPickupDetails(pickup);
    });
    pickupRows.append(row);
  });
  emptyState.hidden = pickups.length > 0;
}

function showPickupDetails(pickup) {
  selectedPickup = pickup;
  safeText('#pickup-details-title', `Pickup #${pickup.request_code}`);
  safeText('#pickup-details-subtitle', `Requested ${formatDate(pickup.requested_at)}`);
  safeText('#detail-location', pickup.location_name || '—');
  safeText('#detail-district', pickup.district_name || '—');
  safeText('#detail-device', pickup.device_types || '—');
  safeText('#detail-weight', `${formatNumber(pickup.estimated_weight_kg, 1)} kg`);
  safeText('#detail-date', formatDate(pickup.scheduled_for));

  const badgeBox = $('#detail-status-badge');
  if (badgeBox) {
    badgeBox.replaceChildren(makeStatusBadge(pickup.status));
  }
  const statusSelect = $('#detail-status-select');
  if (statusSelect) {
    statusSelect.value = '';
  }

  $('#pickup-details-dialog').showModal();
}

function renderPagination() {
  const pagination = document.querySelector('#pagination');
  if (!pagination) return;
  pagination.replaceChildren();
  if (totalPages <= 1) return;

  const makeButton = (label, page, accessibleLabel, disabled = false, current = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', accessibleLabel);
    button.disabled = disabled;
    if (current) {
      button.className = 'current-page';
      button.setAttribute('aria-current', 'page');
    }
    button.addEventListener('click', () => loadPickups(page));
    pagination.append(button);
  };

  makeButton('‹', Math.max(1, currentPage - 1), 'Previous page', currentPage <= 1);
  const firstPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const lastPage = Math.min(totalPages, firstPage + 4);
  for (let page = firstPage; page <= lastPage; page += 1) {
    makeButton(String(page), page, `Page ${page}`, false, page === currentPage);
  }
  makeButton('›', Math.min(totalPages, currentPage + 1), 'Next page', currentPage >= totalPages);
}

async function loadPickups(page = 1) {
  currentPage = page;
  const query = (pickupSearch.value || globalSearch.value).trim();
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set('q', query);
  if (statusFilter.value !== 'all') params.set('status', statusFilter.value);

  try {
    const result = await apiRequest(`/api/pickups?${params}`);
    clearError();
    totalCount = toNumber(result.totalCount, 0);
    totalPages = Math.max(1, toNumber(result.totalPages, 1));
    currentPage = Math.max(1, toNumber(result.page, page));
    const pickups = Array.isArray(result.pickups) ? result.pickups : [];
    renderPickups(pickups);
    safeText('#visible-count', String(pickups.length));
    safeText('#showing-count', String(pickups.length));
    safeText('#total-count', formatNumber(totalCount));
    renderPagination();
  } catch (error) {
    showError(error.message);
    pickupRows.replaceChildren();
    emptyState.hidden = false;
    emptyState.textContent = 'Pickups could not be loaded.';
    safeText('#visible-count', '0');
    safeText('#showing-count', '0');
    safeText('#total-count', '0');
  }
}

function renderOptions(select, options, placeholder) {
  if (!select) return;
  select.replaceChildren(new Option(placeholder, ''));
  const safeOptions = Array.isArray(options) ? options : [];
  safeOptions.forEach((item) => select.add(new Option(item.name, item.id)));
  select.disabled = safeOptions.length === 0;
}

function renderNotifications(notifications) {
  const list = document.querySelector('#notification-list');
  const safeNotifications = Array.isArray(notifications) ? notifications : [];
  const unreadCount = safeNotifications.filter((notification) => !notification.read_at).length;
  safeText('#notification-count', unreadCount
    ? `${unreadCount} new`
    : 'All caught up');
  $('#mark-notifications-read').disabled = unreadCount === 0;
  $('#notification-button').setAttribute('aria-label', unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications');
  $('.notification-dot').hidden = unreadCount === 0;
  list.replaceChildren();

  if (safeNotifications.length === 0) {
    const item = document.createElement('div');
    item.className = 'notification-item';
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = 'You’re all caught up';
    text.append(title);
    item.append(text);
    list.append(item);
    return;
  }

  safeNotifications.forEach((notification) => {
    const item = document.createElement('div');
    item.className = 'notification-item';
    const dot = document.createElement('i');
    if (!notification.read_at) dot.className = 'notification-indicator';
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = notification.title;
    const message = document.createElement('small');
    message.textContent = notification.message;
    text.append(title, message);
    item.append(dot, text);
    list.append(item);
  });
}

async function markNotificationsRead() {
  try {
    await apiRequest('/api/notifications/read', { method: 'POST' });
    const result = await apiRequest('/api/notifications');
    renderNotifications(result.notifications);
    clearError();
    showToast('Notifications updated', 'All notifications have been marked as read.');
  } catch (error) {
    showError(error.message);
  }
}

function addTableCell(row, value) {
  const cell = row.insertCell();
  cell.textContent = value || '—';
  return cell;
}

function makeStatusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `status-badge ${String(status).replaceAll('_', '-')}`;
  const dot = document.createElement('i');
  badge.append(dot, document.createTextNode(statusLabels[status] || status || 'Unknown'));
  return badge;
}

async function loadRoutes() {
  try {
    const result = await apiRequest('/api/routes');
    const routes = Array.isArray(result.routes) ? result.routes : [];
    const rows = $('#route-rows');
    rows.replaceChildren();
    routes.forEach((route) => {
      const row = rows.insertRow();
      addTableCell(row, route.route_name);
      addTableCell(row, formatDate(route.route_date));
      addTableCell(row, route.driver_name);
      addTableCell(row, formatNumber(route.stop_count));
      addTableCell(row, '').append(makeStatusBadge(route.status));
    });
    $('#routes-empty').hidden = routes.length > 0;
    safeText('#routes-total', formatNumber(routes.length));
    safeText('#routes-planned', formatNumber(routes.filter((route) => route.status === 'planned').length));
    safeText('#routes-active', formatNumber(routes.filter((route) => route.status === 'in_progress').length));
    safeText('#routes-stops', formatNumber(routes.reduce((sum, route) => sum + toNumber(route.stop_count, 0), 0)));
    clearError();
  } catch (error) {
    showError(error.message);
    $('#route-rows').replaceChildren();
    $('#routes-empty').hidden = false;
    $('#routes-empty').textContent = 'Routes could not be loaded.';
  }
}

async function loadRecycling() {
  try {
    const result = await apiRequest('/api/recycling');
    const batches = Array.isArray(result.batches) ? result.batches : [];
    const rows = $('#recycling-rows');
    rows.replaceChildren();
    batches.forEach((batch) => {
      const row = rows.insertRow();
      addTableCell(row, batch.batch_code);
      addTableCell(row, batch.partner_name);
      addTableCell(row, batch.categories || 'Uncategorized');
      addTableCell(row, `${formatNumber(batch.recycled_weight_kg, 1)} kg`);
      addTableCell(row, formatDate(batch.received_at));
      addTableCell(row, '').append(makeStatusBadge(batch.status));
    });
    $('#recycling-empty').hidden = batches.length > 0;
    safeText('#recycling-total', formatNumber(batches.length));
    safeText('#recycling-active', formatNumber(batches.filter((batch) => batch.status === 'processing').length));
    safeText('#recycling-completed', formatNumber(batches.filter((batch) => batch.status === 'completed').length));
    safeText('#recycling-weight', formatNumber(
      batches.reduce((sum, batch) => sum + toNumber(batch.recycled_weight_kg, 0), 0),
      1,
    ));
    clearError();
  } catch (error) {
    showError(error.message);
    $('#recycling-rows').replaceChildren();
    $('#recycling-empty').hidden = false;
    $('#recycling-empty').textContent = 'Recycling batches could not be loaded.';
  }
}

async function loadPartners() {
  try {
    const result = await apiRequest('/api/partners');
    const partners = Array.isArray(result.partners) ? result.partners : [];
    const rows = $('#partner-rows');
    rows.replaceChildren();
    partners.forEach((partner) => {
      const row = rows.insertRow();
      addTableCell(row, partner.name);
      addTableCell(row, partner.organization_type === 'collection_partner' ? 'Collection' : 'Recycling');
      const emailCell = row.insertCell();
      if (partner.contact_email) {
        const email = document.createElement('a');
        email.href = `mailto:${partner.contact_email}`;
        email.textContent = partner.contact_email;
        emailCell.append(email);
      } else {
        emailCell.textContent = '—';
      }
      const phoneCell = row.insertCell();
      if (partner.phone) {
        const phone = document.createElement('a');
        phone.href = `tel:${partner.phone}`;
        phone.textContent = partner.phone;
        phoneCell.append(phone);
      } else {
        phoneCell.textContent = '—';
      }
      addTableCell(row, partner.is_active ? 'Active' : 'Inactive');
    });
    $('#partners-empty').hidden = partners.length > 0;
    safeText('#partners-total', formatNumber(partners.length));
    safeText('#partners-active', formatNumber(partners.filter((partner) => partner.is_active).length));
    safeText('#partners-collection', formatNumber(partners.filter((partner) => partner.organization_type === 'collection_partner').length));
    safeText('#partners-recycling', formatNumber(partners.filter((partner) => partner.organization_type === 'recycling_partner').length));
    clearError();
  } catch (error) {
    showError(error.message);
    $('#partner-rows').replaceChildren();
    $('#partners-empty').hidden = false;
    $('#partners-empty').textContent = 'Partners could not be loaded.';
  }
}

async function loadReports() {
  try {
    const [dashboard, volume, impact] = await Promise.all([
      apiRequest('/api/dashboard'),
      apiRequest('/api/volume?range=30D'),
      apiRequest('/api/impact'),
    ]);
    renderImpact(impact);
    const categories = Array.isArray(dashboard.categories) ? dashboard.categories : [];
    const metrics = dashboard.metrics || {};
    const recycled = toNumber(metrics.recycled_weight_kg_this_month, 0);
    const goal = toNumber(metrics.recycling_goal_kg, 0);
    const totalItems = categories.reduce((sum, category) => sum + toNumber(category.item_count, 0), 0);
    const rows = $('#report-category-rows');
    rows.replaceChildren();
    categories.filter((category) => toNumber(category.item_count, 0) > 0).forEach((category) => {
      const row = rows.insertRow();
      const count = toNumber(category.item_count, 0);
      addTableCell(row, category.name);
      addTableCell(row, formatNumber(count));
      addTableCell(row, `${totalItems ? Math.round((count / totalItems) * 100) : 0}%`);
    });
    $('#reports-empty').hidden = rows.rows.length > 0;
    safeText('#report-pickups', formatNumber(metrics.pickups_requested_this_month));
    safeText('#report-collected', formatNumber(
      (Array.isArray(volume.points) ? volume.points : [])
        .reduce((sum, point) => sum + toNumber(point.collected_weight_kg, 0), 0),
      1,
    ));
    safeText('#report-recycled', formatNumber(recycled, 1));
    safeText('#report-progress', formatNumber(goal ? Math.min(100, (recycled / goal) * 100) : 0));
    latestCategories = categories;
    clearError();
  } catch (error) {
    showError(error.message);
    $('#report-category-rows').replaceChildren();
    $('#reports-empty').hidden = false;
    $('#reports-empty').textContent = 'Reports could not be loaded.';
  }
}

function renderVolume(points = []) {
  const safePoints = Array.isArray(points) ? points : [];
  const collected = safePoints.map((point) => toNumber(point.collected_weight_kg, 0));
  const recycled = safePoints.map((point) => toNumber(point.recycled_weight_kg, 0));
  const totalCollected = collected.reduce((sum, value) => sum + value, 0);
  safeText('#chart-total', formatNumber(totalCollected, 1));

  const maxValue = Math.max(0, ...collected, ...recycled);
  const chartMax = maxValue > 0 ? Math.ceil(maxValue / 10) * 10 : 10;
  const yLabels = document.querySelector('.y-labels');
  if (yLabels) {
    yLabels.replaceChildren();
    for (let index = 4; index >= 0; index -= 1) {
      const label = document.createElement('span');
      label.textContent = formatNumber((chartMax * index) / 4);
      yLabels.append(label);
    }
  }

  const makePath = (values) => {
    if (!values.length) return '';
    return values.map((value, index) => {
      const x = values.length <= 1 ? 360 : (index / (values.length - 1)) * 720;
      const y = 174 - (value / chartMax) * 145;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  };
  const line = makePath(collected);
  const recycledLine = makePath(recycled);
  const area = collected.length ? `${line} L720 190 L0 190 Z` : '';

  const linePath = document.querySelector('.line-path');
  const areaPath = document.querySelector('.area-path');
  const recycledPath = document.querySelector('.recycled-path');
  const chartPoint = document.querySelector('.chart-point');
  const recycledPoint = document.querySelector('.recycled-point');
  if (linePath) linePath.setAttribute('d', line);
  if (areaPath) areaPath.setAttribute('d', area);
  if (recycledPath) recycledPath.setAttribute('d', recycledLine);

  const lastIndex = Math.max(0, safePoints.length - 1);
  const lastX = safePoints.length <= 1 ? 360 : (lastIndex / (safePoints.length - 1 || 1)) * 720;
  if (chartPoint) {
    chartPoint.setAttribute('cx', lastX);
    chartPoint.setAttribute('cy', 174 - ((collected[lastIndex] || 0) / chartMax) * 145);
  }
  if (recycledPoint) {
    recycledPoint.setAttribute('cx', lastX);
    recycledPoint.setAttribute('cy', 174 - ((recycled[lastIndex] || 0) / chartMax) * 145);
  }

  const labels = document.querySelector('.x-labels');
  if (labels) {
    labels.replaceChildren();
    const labelCount = safePoints.length > 0 ? 6 : 0;
    for (let index = 0; index < labelCount; index += 1) {
      const pointIndex = Math.max(0, Math.round((index / Math.max(1, labelCount - 1)) * (safePoints.length - 1)));
      const label = document.createElement('span');
      label.textContent = formatDate(safePoints[pointIndex]?.activity_date, { month: 'short', day: '2-digit' });
      labels.append(label);
    }
  }
}

async function loadVolume(range) {
  const result = await apiRequest(`/api/volume?range=${encodeURIComponent(range)}`);
  renderVolume(result.points);
}

async function loadDashboard() {
  document.querySelector('#current-date').textContent = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date()).toUpperCase();

  try {
    const [dashboard, pickupResult, options, volume, notificationResult, impact] = await Promise.all([
      apiRequest('/api/dashboard'),
      apiRequest('/api/pickups?page=1'),
      apiRequest('/api/options'),
      apiRequest('/api/volume?range=30D'),
      apiRequest('/api/notifications'),
      apiRequest('/api/impact'),
    ]);
    clearError();
    latestDistricts = Array.isArray(options.districts) ? options.districts : [];
    latestDeviceOptions = Array.isArray(options.categories) ? options.categories : [];
    renderMetricData(dashboard.metrics);
    renderCategories(dashboard.categories);
    renderImpact(impact);
    renderOptions(pickupForm.elements.district, latestDistricts, 'Select district');
    renderOptions(pickupForm.elements.device, latestDeviceOptions, 'Select device type');
    renderNotifications(notificationResult.notifications);
    renderVolume(volume.points);
    totalCount = pickupResult.totalCount;
    totalPages = pickupResult.totalPages;
    currentPage = pickupResult.page;
    renderPickups(pickupResult.pickups);
    safeText('#pickup-nav-count', formatNumber(pickupResult.totalCount));
    document.querySelector('#visible-count').textContent = pickupResult.pickups.length;
    document.querySelector('#showing-count').textContent = pickupResult.pickups.length;
    document.querySelector('#total-count').textContent = formatNumber(totalCount);
    renderPagination();
    document.querySelector('#new-pickup-button').disabled = false;
    document.querySelector('#new-pickup-page-button').disabled = false;
    pickupForm.querySelector('[type="submit"]').disabled = false;
  } catch (error) {
    showError(error.message);
    document.querySelector('#new-pickup-button').disabled = true;
    document.querySelector('#new-pickup-page-button').disabled = true;
    pickupForm.querySelector('[type="submit"]').disabled = true;
    pickupRows.replaceChildren();
    emptyState.hidden = false;
    emptyState.textContent = 'Connect to the database to load pickup requests.';
  }
}

function schedulePickupSearch() {
  window.clearTimeout(searchTimeout);
  searchTimeout = window.setTimeout(() => loadPickups(1), 250);
}

pickupSearch.addEventListener('input', () => {
  globalSearch.value = '';
  schedulePickupSearch();
});
globalSearch.addEventListener('input', () => {
  pickupSearch.value = '';
  if (globalSearch.value.trim() && $('#view-pickups').hidden) {
    showPageView('Pickups');
    return;
  }
  schedulePickupSearch();
});
statusFilter.addEventListener('change', () => loadPickups(1));

document.querySelectorAll('.range-button').forEach((button) => {
  button.addEventListener('click', async () => {
    const previousButton = document.querySelector('.range-button.active');
    document.querySelector('.range-button.active')?.classList.remove('active');
    button.classList.add('active');
    button.disabled = true;
    try {
      await loadVolume(button.dataset.range);
      clearError();
    } catch (error) {
      button.classList.remove('active');
      previousButton?.classList.add('active');
      showError(error.message);
    } finally {
      button.disabled = false;
    }
  });
});

document.querySelector('#new-pickup-button').addEventListener('click', () => pickupDialog.showModal());
$('#new-pickup-page-button').addEventListener('click', () => pickupDialog.showModal());
document.querySelector('#close-dialog').addEventListener('click', () => pickupDialog.close());
document.querySelector('#cancel-dialog').addEventListener('click', () => pickupDialog.close());
pickupDialog.addEventListener('click', (event) => {
  if (event.target === pickupDialog) pickupDialog.close();
});
$('#close-pickup-details').addEventListener('click', () => $('#pickup-details-dialog').close());
$('#close-details-done').addEventListener('click', () => $('#pickup-details-dialog').close());
$('#pickup-details-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$('#copy-request-code').addEventListener('click', async () => {
  if (!selectedPickup) return;
  try {
    await navigator.clipboard.writeText(selectedPickup.request_code);
    showToast('Request ID copied', selectedPickup.request_code);
  } catch {
    showToast('Unable to copy request ID', 'Your browser did not grant clipboard access.');
  }
});

$('#detail-status-select')?.addEventListener('change', async (event) => {
  const newStatus = event.target.value;
  if (!newStatus || !selectedPickup) return;
  await updatePickupStatus(selectedPickup.id, newStatus);
});

$('#detail-delete-button')?.addEventListener('click', async () => {
  if (!selectedPickup) return;
  await deletePickup(selectedPickup);
});

$('#detail-edit-button')?.addEventListener('click', () => {
  if (!selectedPickup) return;
  openEditPickup(selectedPickup);
});

$('#detail-cert-button')?.addEventListener('click', () => {
  if (!selectedPickup) return;
  openCertificate(selectedPickup.request_code);
});

// Edit Dialog Form
const editForm = $('#pickup-edit-form');
if (editForm) {
  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editForm.reportValidity() || !selectedPickup) return;
    const submitBtn = editForm.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      const result = await apiRequest(`/api/pickups/${selectedPickup.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          location: $('#edit-location').value.trim(),
          districtId: $('#edit-district').value,
          deviceCategoryId: $('#edit-device').value,
          weight: Number($('#edit-weight').value),
          scheduledFor: $('#edit-date').value,
          notes: $('#edit-notes').value.trim(),
        }),
      });
      $('#pickup-edit-dialog').close();
      showToast('Pickup updated', `Request #${result.pickup.request_code} details saved.`);
      await loadDashboard();
    } catch (error) {
      showToast('Update failed', error.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

$('#close-edit-dialog')?.addEventListener('click', () => $('#pickup-edit-dialog').close());
$('#cancel-edit-dialog')?.addEventListener('click', () => $('#pickup-edit-dialog').close());
$('#pickup-edit-dialog')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

// Certificate Dialog
$('#close-cert')?.addEventListener('click', () => $('#certificate-dialog').close());
$('#print-cert-button')?.addEventListener('click', () => window.print());
$('#certificate-dialog')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

$('#open-cert-generator-button')?.addEventListener('click', async () => {
  try {
    const result = await apiRequest('/api/pickups?status=completed&page=1');
    const completed = result.pickups?.[0];
    if (completed) {
      openCertificate(completed.request_code);
    } else {
      const allResult = await apiRequest('/api/pickups?page=1');
      const anyPickup = allResult.pickups?.[0];
      if (anyPickup) {
        openCertificate(anyPickup.request_code);
      } else {
        showToast('No pickups found', 'Create and schedule a pickup first to generate certificates.');
      }
    }
  } catch (error) {
    showToast('Certificate error', error.message);
  }
});

$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
$('#close-settings-done').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$('#compact-setting').addEventListener('change', (event) => {
  document.body.classList.toggle('compact-mode', event.target.checked);
  localStorage.setItem('recollect-compact', String(event.target.checked));
});
$('#motion-setting').addEventListener('change', (event) => {
  document.body.classList.toggle('reduce-motion', event.target.checked);
  localStorage.setItem('recollect-reduce-motion', String(event.target.checked));
});

pickupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pickupForm.reportValidity()) return;
  const formData = new FormData(pickupForm);
  const submitButton = pickupForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await apiRequest('/api/pickups', {
      method: 'POST',
      body: JSON.stringify({
        location: String(formData.get('location')).trim(),
        districtId: formData.get('district'),
        deviceCategoryId: formData.get('device'),
        weight: Number(formData.get('weight')),
        scheduledFor: formData.get('date'),
      }),
    });
    pickupForm.reset();
    pickupDialog.close();
    pickupSearch.value = '';
    globalSearch.value = '';
    statusFilter.value = 'all';
    await loadDashboard();
    showToast('Pickup created', `${result.pickup.request_code} has been saved to the database.`);
  } catch (error) {
    showToast('Pickup not saved', error.message);
  } finally {
    submitButton.disabled = false;
  }
});

function showToast(title, message) {
  document.querySelector('#toast-title').textContent = title;
  document.querySelector('#toast-message').textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove('visible'), 4000);
}

document.querySelector('#notification-button').addEventListener('click', () => {
  const popover = document.querySelector('#notification-popover');
  popover.hidden = !popover.hidden;
  document.querySelector('#notification-button').setAttribute('aria-expanded', String(!popover.hidden));
});
$('#mark-notifications-read').addEventListener('click', markNotificationsRead);
document.addEventListener('click', (event) => {
  const notificationWrap = document.querySelector('.notification-wrap');
  if (!notificationWrap.contains(event.target)) {
    document.querySelector('#notification-popover').hidden = true;
    document.querySelector('#notification-button').setAttribute('aria-expanded', 'false');
  }
  if (openMenu && !openMenu.element.contains(event.target) && !openMenu.button.contains(event.target)) {
    closeActionMenu();
  }
});

function closeMobileNavigation() {
  document.querySelector('#sidebar').classList.remove('mobile-open');
  document.querySelector('#mobile-scrim').classList.remove('visible');
  document.querySelector('#mobile-menu').setAttribute('aria-expanded', 'false');
}

document.querySelectorAll('[data-view]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const name = link.dataset.view;
    if (name === 'Pickups') {
      pickupSearch.value = '';
      globalSearch.value = '';
      statusFilter.value = 'all';
    }
    showPageView(name);
    closeMobileNavigation();
  });
});
window.addEventListener('popstate', () => {
  const navLink = document.querySelector(`.nav-link[data-view][href="${window.location.hash}"]`);
  showPageView(navLink?.dataset.view || 'Overview', { updateHistory: false });
});
document.querySelectorAll('.nav-link[data-nav="Settings"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    document.querySelectorAll('.nav-link').forEach((navLink) => navLink.classList.remove('active'));
    link.classList.add('active');
    safeText('.breadcrumbs strong', 'Settings');
    openSettings();
    closeMobileNavigation();
  });
});
document.querySelector('#routes-pickups-button').addEventListener('click', () => {
  pickupSearch.value = '';
  globalSearch.value = '';
  statusFilter.value = 'scheduled';
  showPageView('Pickups');
});
$('#export-recycling-button').addEventListener('click', async () => {
  try {
    const result = await apiRequest('/api/recycling');
    const batches = Array.isArray(result.batches) ? result.batches : [];
    downloadCsv('recollect-recycling-batches.csv', [
      ['Batch', 'Partner', 'Categories', 'Weight (kg)', 'Received', 'Completed', 'Status'],
      ...batches.map((batch) => [
        batch.batch_code,
        batch.partner_name,
        batch.categories,
        batch.recycled_weight_kg,
        batch.received_at,
        batch.completed_at,
        statusLabels[batch.status] || batch.status,
      ]),
    ]);
    showToast('Recycling batches exported', `${formatNumber(batches.length)} batches downloaded.`);
    clearError();
  } catch (error) {
    showError(error.message);
  }
});
$('#export-report-button').addEventListener('click', async () => {
  try {
    const [dashboard, volume] = await Promise.all([
      apiRequest('/api/dashboard'),
      apiRequest('/api/volume?range=30D'),
    ]);
    const categories = Array.isArray(dashboard.categories) ? dashboard.categories : [];
    const totalItems = categories.reduce((sum, category) => sum + toNumber(category.item_count, 0), 0);
    const metrics = dashboard.metrics || {};
    const collected = (Array.isArray(volume.points) ? volume.points : [])
      .reduce((sum, point) => sum + toNumber(point.collected_weight_kg, 0), 0);
    downloadCsv('recollect-monthly-report.csv', [
      ['Metric', 'Value'],
      ['Pickups requested this month', metrics.pickups_requested_this_month],
      ['Collected weight (last 30 days, kg)', collected.toFixed(1)],
      ['Recycled weight this month (kg)', metrics.recycled_weight_kg_this_month],
      ['Recycling goal (kg)', metrics.recycling_goal_kg],
      [],
      ['Device category', 'Collected items', 'Share'],
      ...categories.map((category) => {
        const count = toNumber(category.item_count, 0);
        return [category.name, count, `${totalItems ? Math.round((count / totalItems) * 100) : 0}%`];
      }),
    ]);
    showToast('Monthly report exported', 'Your report has been downloaded as a CSV file.');
    clearError();
  } catch (error) {
    showError(error.message);
  }
});
document.querySelector('#mobile-menu').addEventListener('click', (event) => {
  const isOpen = document.querySelector('#sidebar').classList.toggle('mobile-open');
  document.querySelector('#mobile-scrim').classList.toggle('visible', isOpen);
  event.currentTarget.setAttribute('aria-expanded', String(isOpen));
});
document.querySelector('#mobile-scrim').addEventListener('click', () => {
  document.querySelector('#sidebar').classList.remove('mobile-open');
  document.querySelector('#mobile-scrim').classList.remove('visible');
  document.querySelector('#mobile-menu').setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeActionMenu();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    globalSearch.focus();
  }
});

$('#workspace-switcher').addEventListener('click', (event) => {
  showActionMenu(event.currentTarget, [
    { label: 'Greenloop Co. (current workspace)', action: () => showToast('Current workspace', 'You are viewing Greenloop Co.') },
    { label: 'Refresh dashboard data', action: refreshDashboard },
  ]);
});

const openAccountMenu = (button) => showActionMenu(button, [
  { label: 'Kinshuk Karol · Operations manager', action: () => showToast('Signed in', 'You are using the operations manager profile.') },
  { label: 'Dashboard settings', action: openSettings },
  { label: 'Refresh dashboard data', action: refreshDashboard },
]);
$('#account-menu').addEventListener('click', (event) => openAccountMenu(event.currentTarget));
$('#profile-more').addEventListener('click', (event) => openAccountMenu(event.currentTarget));

$('#category-options').addEventListener('click', (event) => {
  showActionMenu(event.currentTarget, [
    {
      label: 'Download category report',
      action: () => {
        const total = latestCategories.reduce((sum, category) => sum + toNumber(category.item_count, 0), 0);
        const rows = [['Category', 'Collected items', 'Share']];
        latestCategories.forEach((category) => {
          const count = toNumber(category.item_count, 0);
          rows.push([category.name, count, `${total ? Math.round((count / total) * 100) : 0}%`]);
        });
        downloadCsv('recollect-category-report.csv', rows);
        showToast('Category report downloaded', `${latestCategories.length} categories included.`);
      },
    },
    { label: 'Refresh dashboard data', action: refreshDashboard },
  ]);
});

document.querySelector('#export-button').addEventListener('click', async () => {
  const query = (pickupSearch.value || globalSearch.value).trim();
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (statusFilter.value !== 'all') params.set('status', statusFilter.value);
  try {
    const result = await apiRequest(`/api/pickups/export?${params}`);
    const pickups = Array.isArray(result.pickups) ? result.pickups : [];
    const csvRows = pickups.map((pickup) => [
      pickup.request_code,
      pickup.location_name,
      pickup.district_name,
      pickup.device_types,
      `${pickup.estimated_weight_kg} kg`,
      formatDate(pickup.scheduled_for),
      statusLabels[pickup.status] || pickup.status,
    ]);
    downloadCsv('recollect-pickups.csv', [
      ['Request ID', 'Location', 'District', 'Device type', 'Weight', 'Scheduled date', 'Status'],
      ...csvRows,
    ]);
    clearError();
    showToast('Pickups exported', `${formatNumber(pickups.length)} requests downloaded as CSV.`);
    if (result.truncated) {
      showToast('Export limited', `Exported the first 5,000 of ${formatNumber(result.totalCount)} matching pickups.`);
    }
  } catch (error) {
    showError(error.message);
  }
});

const initialNavLink = document.querySelector(`.nav-link[data-view][href="${window.location.hash}"]`);
const initialView = initialNavLink?.dataset.view || 'Overview';
showPageView(initialView, { updateHistory: false, loadData: initialView !== 'Overview' });
loadDashboard();
