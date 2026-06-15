/**
 * Professional Newspaper Advertisement Dummy Planner
 * Core Application Engine - Vanilla JS
 */

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import './style.css';

// Core Constants
const BASE_DPI = 1.5; // pixel density per millimeter for base design scaling (at zoom 100%)
const MIN_AD_SIZE_MM = 15; // Minimum size for width and height in mm
const SPACING_BUFFER_MM = 3; // Enforced 3mm gap between Advertisements

// System State
let state = {
  layouts: [],
  activeLayoutId: null,
  pages: [],
  activePageId: null,
  zoom: 1.0,
  history: [],
  historyIndex: -1
};

// Drag & Resize Temp Interaction State
let interactState = {
  mode: null,          // 'drag' | 'resize' | null
  adId: null,          // target ad ID
  startX: 0,           // initial screen mouse/touch point X
  startY: 0,           // Y
  startW: 0,           // ad starting dimensions (mm)
  startH: 0,
  startXmm: 0,         // ad starting coordinates (mm)
  startYmm: 0,
  origX: 0,            // unmodified backup values (in case of overlap revert)
  origY: 0,
  origW: 0,
  origH: 0,
  tempX: 0,            // active drag coordinates
  tempY: 0,
  tempW: 0,            // active resize dimensions
  tempH: 0,
  tempValid: true,     // indicator if active coordinates are non-colliding
  element: null        // DOM node of active ad box
};

// Clipboard/Context target
let contextTargetAdId = null;

// Touch hold (long press) for mobile/tablet support
let touchHoldTimer = null;
let touchHoldActive = false;

// Expose key handlers globally since index.html executes them inline from templates within an ES module scope
window.openPageEditor = openPageEditor;
window.duplicatePageLayout = duplicatePageLayout;
window.deletePageLayout = deletePageLayout;
window.loadFormAdConfigure = loadFormAdConfigure;
window.deleteAdFromPage = deleteAdFromPage;
window.triggerEmptySpaceClickForm = triggerEmptySpaceClickForm;
window.moveAdToAlternativePage = moveAdToAlternativePage;
window.switchActiveLayout = switchActiveLayout;
window.createNewLayoutPrompt = createNewLayoutPrompt;
window.renameActiveLayoutPrompt = renameActiveLayoutPrompt;
window.deleteActiveLayoutConfirm = deleteActiveLayoutConfirm;
window.openPageSettings = openPageSettings;
window.triggerDirectSwap = triggerDirectSwap;

// Initialize Application on DOM Ready
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
  });
} else {
  initApp();
  setupEventListeners();
}

// Primary Initializer for Multiple Layouts support
function initApp() {
  const savedV2 = localStorage.getItem('newspaper_ad_planner_layouts_v2');
  let loadedSuccessfully = false;

  if (savedV2) {
    try {
      const parsed = JSON.parse(savedV2);
      if (parsed && Array.isArray(parsed.layouts) && parsed.layouts.length > 0) {
        state.layouts = parsed.layouts.map((l, index) => {
          if (index === 0) {
            l.name = "Primary Layout 01";
            if (!l.date) {
              l.date = new Date().toISOString().split('T')[0];
            }
          }
          const lowCenters = (l.centers || '').toLowerCase();
          if (lowCenters.includes("vijayawada") || lowCenters.includes("hyderabad") || lowCenters.includes("vizag")) {
            l.centers = "";
          } else {
            l.centers = l.centers || "";
          }
          if (!l.date) {
            l.date = new Date().toISOString().split('T')[0];
          }
          return l;
        });
        state.activeLayoutId = parsed.activeLayoutId || state.layouts[0].id;
        
        const activeLayout = state.layouts.find(l => l.id === state.activeLayoutId) || state.layouts[0];
        state.activeLayoutId = activeLayout.id;
        state.pages = clonePages(activeLayout.pages);
        loadedSuccessfully = true;
        saveLayoutsToLocalStorageSilently(); // Save mapped, sanitized layouts immediately
        showToast("Layout plans loaded successfully", "success");
      }
    } catch (e) {
      console.error("Error loading V2 layouts database:", e);
    }
  }

  // Fallback to legacy single layout data
  if (!loadedSuccessfully) {
    const savedLegacy = localStorage.getItem('newspaper_ad_planner_layouts');
    if (savedLegacy) {
      try {
        const legacyPages = JSON.parse(savedLegacy);
        if (Array.isArray(legacyPages)) {
          state.pages = legacyPages;
          const defaultL = {
            id: 'layout-primary',
            name: 'Primary Layout 01',
            date: new Date().toISOString().split('T')[0],
            centers: '',
            pages: clonePages(state.pages)
          };
          state.layouts = [defaultL];
          state.activeLayoutId = defaultL.id;
          loadedSuccessfully = true;
          saveLayoutsToLocalStorageSilently();
          showToast("Migrated legacy layout to system", "info");
        }
      } catch (e) {
        console.error("Error loading legacy layout:", e);
      }
    }
  }

  // Ultimate fallback to default sample layouts
  if (!loadedSuccessfully) {
    loadSamplePages(); // populates state.pages
    const defaultL = {
      id: 'layout-primary',
      name: 'Primary Layout 01',
      date: new Date().toISOString().split('T')[0],
      centers: '',
      pages: clonePages(state.pages)
    };
    state.layouts = [defaultL];
    state.activeLayoutId = defaultL.id;
    saveLayoutsToLocalStorageSilently();
  }

  // Set up initial deep-clone snapshot in history stack
  state.history = [clonePages(state.pages)];
  state.historyIndex = 0;

  // Render layouts drop options & flatplans
  renderLayoutSelectorDropdown();
  renderAllLayouts();
}

// Populate sample pages with exactly 1 empty blank page
function loadSamplePages() {
  state.pages = [
    {
      id: "page-" + Date.now() + "-1",
      pageNumber: 1,
      width: 329,
      height: 525,
      comments: "",
      ads: []
    }
  ];
}

// Create a deep copy of pages hierarchy
function clonePages(val) {
  return JSON.parse(JSON.stringify(val));
}

// Push a deep copied pages state to history stack (discards redo states)
function commitHistory() {
  const currentSnapshot = clonePages(state.pages);
  
  // Cut off any future indices if undo is currently active
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(currentSnapshot);

  // Keep a maximum of 60 states for memory hygiene
  if (state.history.length > 60) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }

  updateUndoRedoControls();
}

// Undo action
function triggerUndo() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    state.pages = clonePages(state.history[state.historyIndex]);
    renderAllLayouts();
    showToast("Undo applied successfully", "info");
  }
}

// Redo action
function triggerRedo() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    state.pages = clonePages(state.history[state.historyIndex]);
    renderAllLayouts();
    showToast("Redo applied successfully", "info");
  }
}

// Update undo/redo tool buttons states in UI
function updateUndoRedoControls() {
  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.history.length - 1;

  // Main UI
  const btnUndoMain = document.getElementById('btn-undo-main');
  const btnRedoMain = document.getElementById('btn-redo-main');
  if (btnUndoMain) btnUndoMain.disabled = !canUndo;
  if (btnRedoMain) btnRedoMain.disabled = !canRedo;

  // Editor Modal UI
  const btnUndoEditor = document.getElementById('btn-undo-editor');
  const btnRedoEditor = document.getElementById('btn-redo-editor');
  if (btnUndoEditor) btnUndoEditor.disabled = !canUndo;
  if (btnRedoEditor) btnRedoEditor.disabled = !canRedo;
}

// Sync and save all layouts registry values silently to LocalStorage
function saveLayoutsToLocalStorageSilently() {
  const activeL = state.layouts.find(l => l.id === state.activeLayoutId);
  if (activeL) {
    activeL.pages = clonePages(state.pages);
  }
  const payload = {
    layouts: state.layouts,
    activeLayoutId: state.activeLayoutId
  };
  localStorage.setItem('newspaper_ad_planner_layouts_v2', JSON.stringify(payload));
  // Keep legacy single-layout format updated as safe secondary guard
  localStorage.setItem('newspaper_ad_planner_layouts', JSON.stringify(state.pages));
}

// User-triggered Save all plans to LocalStorage with alert Toast feedback
function saveToLocalStorage() {
  saveLayoutsToLocalStorageSilently();
  showToast("Planning database and drafts saved successfully!", "success");
}

// Render option values inside the Layout drop-select element 
function renderLayoutSelectorDropdown() {
  const dropdown = document.getElementById('selector-active-layout');
  if (!dropdown) return;
  
  dropdown.innerHTML = state.layouts.map(l => {
    const selected = l.id === state.activeLayoutId ? 'selected' : '';
    return `<option value="${l.id}" ${selected}>${escapeHtml(l.name)}</option>`;
  }).join('');


}

// HTML safe escaping sanitizer
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Switch current workspace layout draft
function switchActiveLayout(newLayoutId) {
  if (state.activeLayoutId === newLayoutId) return;
  
  // Cache active pages in current layout slot
  const currentActive = state.layouts.find(l => l.id === state.activeLayoutId);
  if (currentActive) {
    currentActive.pages = clonePages(state.pages);
  }
  
  const targetLayout = state.layouts.find(l => l.id === newLayoutId);
  if (!targetLayout) return;
  
  state.activeLayoutId = targetLayout.id;
  state.pages = clonePages(targetLayout.pages);
  
  // Wipes history stack relative to old file layouts
  state.history = [clonePages(state.pages)];
  state.historyIndex = 0;
  
  saveLayoutsToLocalStorageSilently();
  renderLayoutSelectorDropdown();
  renderAllLayouts();
  
  showToast(`Active Layout changed to: "${targetLayout.name}"`, "success");
}

// Generic dynamic helper to execute custom prompt/confirm modals flawlessly in iframe scope
function showCustomDialog({ title, message, isPrompt = false, defaultValue = '', inputLabel = 'Value', showDatePicker = false, defaultDateValue = '', showCentersPicker = false, defaultCentersValue = '', confirmText = 'Confirm', cancelText = 'Cancel', theme = 'blue', hideCancel = false, onConfirm }) {
  const modal = document.getElementById('general-dialog-modal');
  const titleEl = document.getElementById('dialog-title');
  const msgEl = document.getElementById('dialog-message');
  const inputContainer = document.getElementById('dialog-input-container');
  const inputLabelEl = document.getElementById('dialog-input-label');
  const inputEl = document.getElementById('dialog-input');
  const dateContainer = document.getElementById('dialog-date-container');
  const dateInputEl = document.getElementById('dialog-date-input');
  const centersContainer = document.getElementById('dialog-centers-container');
  const centersInputEl = document.getElementById('dialog-centers-input');
  const btnCancel = document.getElementById('btn-dialog-cancel');
  const btnSubmit = document.getElementById('btn-dialog-submit');
  const iconBg = document.getElementById('dialog-icon-bg');
  const icon = document.getElementById('dialog-icon');

  if (!modal) return;

  // Set message text
  titleEl.textContent = title;
  msgEl.textContent = message;

  // Toggle prompt inputs
  if (isPrompt) {
    inputContainer.classList.remove('hidden');
    inputLabelEl.textContent = inputLabel;
    inputEl.value = defaultValue;
    setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 80);
  } else {
    inputContainer.classList.add('hidden');
  }

  // Toggle date selection input
  if (showDatePicker && dateContainer && dateInputEl) {
    dateContainer.classList.remove('hidden');
    dateInputEl.value = defaultDateValue || new Date().toISOString().split('T')[0];
  } else if (dateContainer) {
    dateContainer.classList.add('hidden');
  }

  // Toggle centers selection input
  if (showCentersPicker && centersContainer && centersInputEl) {
    centersContainer.classList.remove('hidden');
    centersInputEl.value = defaultCentersValue || '';
  } else if (centersContainer) {
    centersContainer.classList.add('hidden');
  }

  // Toggle visibility of cancel button dynamically
  if (hideCancel && btnCancel) {
    btnCancel.classList.add('hidden');
  } else if (btnCancel) {
    btnCancel.classList.remove('hidden');
  }

  // Customize buttons text
  btnCancel.textContent = cancelText;
  btnSubmit.textContent = confirmText;

  // Set Theme Visual Accents
  if (theme === 'red') {
    iconBg.className = "flex-shrink-0 p-2 rounded-full bg-red-50 text-red-600";
    btnSubmit.className = "flex-1 py-2.5 bg-red-600 hover:bg-red-700 rounded-lg text-white font-semibold transition cursor-pointer text-center shadow";
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>`;
  } else {
    iconBg.className = "flex-shrink-0 p-2 rounded-full bg-blue-50 text-blue-600";
    btnSubmit.className = "flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-semibold transition cursor-pointer text-center shadow";
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>`;
  }

  // Show modal
  modal.classList.remove('hidden');

  // Handle dismissals and submit
  const cleanup = () => {
    modal.classList.add('hidden');
    const swapContainer = document.getElementById('dialog-swap-container');
    if (swapContainer) {
      swapContainer.classList.add('hidden');
    }
    // Remove listeners by cloning elements
    const newSubmit = btnSubmit.cloneNode(true);
    btnSubmit.parentNode.replaceChild(newSubmit, btnSubmit);
    const newCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newCancel, btnCancel);
  };

  btnSubmit.addEventListener('click', () => {
    const rawVal = inputEl.value;
    const dateVal = dateInputEl ? dateInputEl.value : '';
    const centersVal = centersInputEl ? centersInputEl.value : '';
    cleanup();
    if (onConfirm) onConfirm(rawVal, dateVal, centersVal);
  });

  btnCancel.addEventListener('click', () => {
    cleanup();
  });
}

// Interactive prompt dialog to draft an alternative layout
function createNewLayoutPrompt() {
  const currentActive = state.layouts.find(l => l.id === state.activeLayoutId);
  const defaultDate = currentActive ? currentActive.date : new Date().toISOString().split('T')[0];

  showCustomDialog({
    title: "Create alternative draft",
    message: "Enter a descriptive name, choose a publication issue date, and specify publication center(s) for the new layout draft.",
    isPrompt: true,
    defaultValue: `Draft Layout ${state.layouts.length + 1}`,
    inputLabel: "Draft Layout Name",
    showDatePicker: true,
    defaultDateValue: defaultDate,
    showCentersPicker: true,
    defaultCentersValue: '',
    confirmText: "Create Layout",
    theme: "blue",
    onConfirm: (typedName, selectedDate, typedCenters) => {
      const finalName = typedName.trim() || `Draft Layout ${state.layouts.length + 1}`;
      const finalDate = selectedDate || defaultDate;
      const newId = 'layout-' + Date.now();
      
      // Initialize with exactly 1 empty page canvas
      const emptyPages = [{
        id: "page-" + Date.now(),
        pageNumber: 1,
        ads: []
      }];
      
      const newLayout = {
        id: newId,
        name: finalName,
        date: finalDate,
        centers: typedCenters || '',
        pages: emptyPages
      };
      
      state.layouts.push(newLayout);
      switchActiveLayout(newId);
      const clientNameEl = document.getElementById('form-client-name');
      if (clientNameEl) {
        clientNameEl.value = '';
      }
      showToast(`Created layout draft "${finalName}" with issue date ${finalDate} successfully`, "success");
    }
  });
}

// Prompt renaming layout handles
function renameActiveLayoutPrompt() {
  const currentActive = state.layouts.find(l => l.id === state.activeLayoutId);
  if (!currentActive) return;

  const lowCenters = (currentActive.centers || '').toLowerCase();
  const isDefaultCenters = lowCenters.includes("vijayawada") || lowCenters.includes("hyderabad") || lowCenters.includes("vizag");
  const initialCenters = isDefaultCenters ? '' : (currentActive.centers || '');

  showCustomDialog({
    title: "Rename / Edit Layout Details",
    message: `Provide a new name, issue date, or publication centers for the active layout draft "${currentActive.name}":`,
    isPrompt: true,
    defaultValue: currentActive.name,
    inputLabel: "Layout Name",
    showDatePicker: true,
    defaultDateValue: currentActive.date || new Date().toISOString().split('T')[0],
    showCentersPicker: true,
    defaultCentersValue: initialCenters,
    confirmText: "Save Details",
    theme: "blue",
    onConfirm: (typedName, typedDate, typedCenters) => {
      const finalName = typedName.trim();
      if (!finalName) return;
      currentActive.name = finalName;
      currentActive.date = typedDate || currentActive.date || new Date().toISOString().split('T')[0];
      if (typedCenters !== undefined) {
        const checkLow = typedCenters.toLowerCase();
        const isDefault = checkLow.includes("vijayawada") || checkLow.includes("hyderabad") || checkLow.includes("vizag");
        currentActive.centers = isDefault ? "" : typedCenters;
      }
      
      saveLayoutsToLocalStorageSilently();
      renderLayoutSelectorDropdown();
      renderAllLayouts();
      showToast(`Layout details for "${finalName}" saved successfully.`, "success");
    }
  });
}

// Prompt duplicating layout with a rename option
function duplicateActiveLayoutPrompt() {
  const currentActive = state.layouts.find(l => l.id === state.activeLayoutId);
  if (!currentActive) return;

  // Sync current active layout's state.pages first
  currentActive.pages = clonePages(state.pages);

  const lowCenters = (currentActive.centers || '').toLowerCase();
  const isDefaultCenters = lowCenters.includes("vijayawada") || lowCenters.includes("hyderabad") || lowCenters.includes("vizag");
  const initialCenters = isDefaultCenters ? '' : (currentActive.centers || '');

  showCustomDialog({
    title: "Duplicate Layout",
    message: `Enter details to duplicate "${currentActive.name}". All scheduled ads, pages, and positions will be copied.`,
    isPrompt: true,
    defaultValue: `${currentActive.name} (Copy)`,
    inputLabel: "New Layout Name",
    showDatePicker: true,
    defaultDateValue: currentActive.date || new Date().toISOString().split('T')[0],
    showCentersPicker: true,
    defaultCentersValue: initialCenters,
    confirmText: "Duplicate",
    theme: "blue",
    onConfirm: (typedName, selectedDate, typedCenters) => {
      const finalName = typedName.trim() || `${currentActive.name} (Copy)`;
      const finalDate = selectedDate || currentActive.date || new Date().toISOString().split('T')[0];
      const newId = 'layout-' + Date.now();
      
      const duplicatedPages = clonePages(currentActive.pages);
      
      const checkLow = (typedCenters || '').toLowerCase();
      const isDefault = checkLow.includes("vijayawada") || checkLow.includes("hyderabad") || checkLow.includes("vizag");
      const finalCenters = isDefault ? '' : (typedCenters || '');

      const newLayout = {
        id: newId,
        name: finalName,
        date: finalDate,
        centers: finalCenters,
        pages: duplicatedPages
      };
      
      state.layouts.push(newLayout);
      switchActiveLayout(newId);
      const clientNameEl = document.getElementById('form-client-name');
      if (clientNameEl) {
        clientNameEl.value = '';
      }
      showToast(`Duplicated layout into "${finalName}" successfully`, "success");
    }
  });
}

// Permanently delete layout
function deleteActiveLayoutConfirm() {
  if (state.layouts.length <= 1) {
    showToast("Error: Deletion blocked! You must retain a minimum of one layout draft.", "error");
    return;
  }
  
  const currentActive = state.layouts.find(l => l.id === state.activeLayoutId);
  if (!currentActive) return;

  showCustomDialog({
    title: "Delete Layout Draft",
    message: `Are you absolutely sure you want to permanently delete "${currentActive.name}"? This action is irreversible.`,
    isPrompt: false,
    confirmText: "Delete Permanently",
    theme: "red",
    onConfirm: () => {
      const deletedIndex = state.layouts.findIndex(l => l.id === state.activeLayoutId);
      state.layouts.splice(deletedIndex, 1);
      
      // Switch to first remaining
      state.activeLayoutId = state.layouts[0].id;
      state.pages = clonePages(state.layouts[0].pages);
      
      // Reload baseline state
      state.history = [clonePages(state.pages)];
      state.historyIndex = 0;
      
      saveLayoutsToLocalStorageSilently();
      renderLayoutSelectorDropdown();
      renderAllLayouts();
      
      showToast(`Deleted layout draft successfully`, "info");
    }
  });
}

// Move ads from one broad sheet page to another with self-healing placement
function moveAdToAlternativePage(fromPageId, adId, toPageId) {
  const fromPage = state.pages.find(p => p.id === fromPageId);
  const toPage = state.pages.find(p => p.id === toPageId);
  if (!fromPage || !toPage) return;

  const adIndex = fromPage.ads.findIndex(a => a.id === adId);
  if (adIndex === -1) return;

  const ad = fromPage.ads[adIndex];

  let foundX = -1;
  let foundY = -1;
  let spaceDiscovered = false;

  const pageW = toPage.width || 329;
  const pageH = toPage.height || 525;

  // Search boundaries width: pageW, height: pageH
  // Let's scan in tidy steps 5mm
  const step = 5;
  const maxW = pageW - ad.width;
  const maxH = pageH - ad.height;

  for (let y = 0; y <= maxH; y += step) {
    for (let x = 0; x <= maxW; x += step) {
      if (!checkCollision(toPageId, null, x, y, ad.width, ad.height)) {
        foundX = x;
        foundY = y;
        spaceDiscovered = true;
        break;
      }
    }
    if (spaceDiscovered) break;
  }

  // Exact fallback check: standard centering coordinates case or original coordinates if they match or are free!
  if (!spaceDiscovered && !checkCollision(toPageId, null, ad.x, ad.y, ad.width, ad.height)) {
    foundX = ad.x;
    foundY = ad.y;
    spaceDiscovered = true;
  }

  if (!spaceDiscovered) {
    showToast(`Allocation Error: No free space slot found on Page ${toPage.pageNumber} for ad size ${ad.width}x${ad.height}mm. Try restructuring or resizing first.`, "error");
    renderAllLayouts(); // Refresh to reset dropdown index back to fallback
    return;
  }

  // Perform transfer and commit to undo histories
  fromPage.ads.splice(adIndex, 1);
  const movedAd = {
    ...ad,
    x: foundX,
    y: foundY
  };
  toPage.ads.push(movedAd);

  commitHistory();
  saveLayoutsToLocalStorageSilently();
  renderAllLayouts();

  showToast(`Successfully moved advertisement for "${ad.client}" to Page ${toPage.pageNumber} at coordinate position (${foundX}mm, ${foundY}mm)!`, "success");
}

// =========================================================================
// RENDER FLATPLAN GALLERY (DASHBOARD GRID)
// =========================================================================

function renderAllLayouts() {
  const grid = document.getElementById('pages-grid');
  const emptyState = document.getElementById('empty-state');
  const totalPagesEl = document.getElementById('stat-total-pages');
  const totalAdsEl = document.getElementById('stat-total-ads');
  const avgFilledEl = document.getElementById('stat-avg-filled');
  const totalAdVolumeEl = document.getElementById('stat-total-ad-volume');
  const totalEditVolumeEl = document.getElementById('stat-total-edit-volume');
  const totalVolumeEl = document.getElementById('stat-total-volume');
  const badgePageCount = document.getElementById('badge-page-count');
  const badgeLayoutName = document.getElementById('badge-layout-name');
  const badgeLayoutDate = document.getElementById('badge-layout-date');
  const badgeLayoutCentersLabel = document.getElementById('badge-layout-centers-label');
  const badgeLayoutCenters = document.getElementById('badge-layout-centers');

  if (!grid) return;

  // Render Stats calculations
  const totalPages = state.pages.length;
  let totalAds = 0;
  let accumulatedPercent = 0;
  let totalAdAreaMm2 = 0;
  let totalPageAreaMm2 = 0;
  let totalRevenue = 0;

  state.pages.forEach(p => {
    totalAds += p.ads.length;
    accumulatedPercent += Number(calculatePageFillPercentage(p.id));

    const pageW = p.width || 329;
    const pageH = p.height || 525;
    totalPageAreaMm2 += pageW * pageH;

    p.ads.forEach(ad => {
      totalAdAreaMm2 += ad.width * ad.height;
      totalRevenue += Number(ad.revenue || 0);
    });
  });

  const avgFilled = totalPages > 0 ? Math.round(accumulatedPercent / totalPages) : 0;
  const totalAdVolumeSqcm = totalAdAreaMm2 / 100;
  const totalEditVolumeSqcm = (totalPageAreaMm2 - totalAdAreaMm2) / 100;
  const totalVolumeSqcm = totalPageAreaMm2 / 100;

  // Write Stats UI
  if (totalPagesEl) totalPagesEl.textContent = totalPages;
  if (totalAdsEl) totalAdsEl.textContent = totalAds;
  if (avgFilledEl) avgFilledEl.textContent = avgFilled + "%";
  const totalRevenueEl = document.getElementById('stat-total-revenue');
  if (totalRevenueEl) {
    totalRevenueEl.textContent = "₹" + totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  }
  if (totalAdVolumeEl) {
    totalAdVolumeEl.textContent = totalAdVolumeSqcm.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " Sqcm";
  }
  if (totalEditVolumeEl) {
    totalEditVolumeEl.textContent = totalEditVolumeSqcm.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " Sqcm";
  }
  if (totalVolumeEl) {
    totalVolumeEl.textContent = totalVolumeSqcm.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " Sqcm";
  }
  
  if (badgePageCount) badgePageCount.textContent = totalPages + " " + (totalPages === 1 ? "Page" : "Pages");

  const activeL = state.layouts.find(l => l.id === state.activeLayoutId);
  if (activeL) {
    if (badgeLayoutName) {
      badgeLayoutName.textContent = activeL.name;
      badgeLayoutName.classList.remove('hidden');
    }
    if (badgeLayoutDate) {
      if (activeL.date && activeL.date.trim() !== '') {
        badgeLayoutDate.textContent = getFormattedLayoutDate(activeL.date);
        badgeLayoutDate.classList.remove('hidden');
      } else {
        badgeLayoutDate.classList.add('hidden');
      }
    }
    if (badgeLayoutCenters) {
      if (activeL.centers && activeL.centers.trim() !== '') {
        badgeLayoutCenters.textContent = activeL.centers;
        badgeLayoutCenters.classList.remove('hidden');
        if (badgeLayoutCentersLabel) badgeLayoutCentersLabel.classList.remove('hidden');
      } else {
        badgeLayoutCenters.classList.add('hidden');
        if (badgeLayoutCentersLabel) badgeLayoutCentersLabel.classList.add('hidden');
      }
    }
  }

  if (totalPages === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  grid.innerHTML = '';

  // Render each page card flatplan
  state.pages.forEach(page => {
    const pageCard = document.createElement('div');
    pageCard.className = "group bg-white border border-slate-200/80 rounded-xl overflow-hidden p-4 flex flex-col shadow-sm hover:shadow-md hover:border-blue-500/30 transition-all";
    pageCard.id = "flatplan-card-" + page.id;

    const pageW = page.width || 329;
    const pageH = page.height || 525;

    // Mini preview visual ads boxes scale (container max width: 180px, max height: 287px with padding)
    const maxWidth = 156;
    const maxHeight = 263;
    const pageRatio = pageW / pageH;
    const maxRatio = maxWidth / maxHeight;
    
    let thumbW = maxWidth;
    let thumbH = maxHeight;
    if (pageRatio > maxRatio) {
      thumbW = maxWidth;
      thumbH = Math.round(maxWidth / pageRatio);
    } else {
      thumbH = maxHeight;
      thumbW = Math.round(maxHeight * pageRatio);
    }

    const thumbScaleX = thumbW / pageW;
    const thumbScaleY = thumbH / pageH;
    
    // Generate 8-column dashed guidelines inside thumbnail (width: thumbW px)
    let thumbColLinesHtml = '';
    const colWidthMm = pageW / 8;
    for (let i = 1; i <= 7; i++) {
      const colX = i * colWidthMm * thumbScaleX;
      thumbColLinesHtml += `<span class="absolute top-0 bottom-0 pointer-events-none border-l border-dashed border-slate-200/80" style="left: ${colX}px; z-index: 2;"></span>`;
    }
    
    let miniAdsHtml = '';
    page.ads.forEach(ad => {
      let catColor = '#2563eb';
      if (ad.category === 'classified') catColor = '#059669';
      if (ad.category === 'editorial') catColor = '#ea580c';
      if (ad.category === 'political') catColor = '#c026d3';
      if (ad.category === 'finance') catColor = '#4f46e5';
      if (ad.category === 'special') catColor = '#9333ea';

      let bgStyle = `background-color:${catColor}14; border-color:${catColor};`;
      if (ad.isTentative) {
        bgStyle = `background-color:#fee2e2; border-color:#f43f5e;`;
      }

      miniAdsHtml += `
        <div class="absolute rounded-[1px] border border-opacity-70 flex flex-col justify-center items-center overflow-hidden" 
             style="left:${ad.x * thumbScaleX}px; top:${ad.y * thumbScaleY}px; width:${ad.width * thumbScaleX}px; height:${ad.height * thumbScaleY}px; ${bgStyle}">
          <span style="font-size: 8px; transform: scale(0.8); line-height: 1; color: #1e293b; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 95%; font-weight: 700;">
            ${ad.client}
          </span>
        </div>
      `;
    });

    const pagePercentOccupied = calculatePageFillPercentage(page.id);

    let adListHtml = '';
    if (page.ads.length === 0) {
      adListHtml = `<p class="text-[9px] text-slate-400 italic text-center py-2 bg-slate-50 border border-dashed border-slate-200/60 rounded-lg">No Advertisements on this layout</p>`;
    } else {
      let adItemsHtml = '';
      page.ads.forEach(ad => {
        let catColor = '#2563eb';
        let catText = 'Retail';
        if (ad.category === 'classified') { catColor = '#059669'; catText = 'Health Care'; }
        if (ad.category === 'editorial') { catColor = '#ea580c'; catText = 'Real Estate'; }
        if (ad.category === 'political') { catColor = '#c026d3'; catText = 'Education'; }
        if (ad.category === 'finance') { catColor = '#4f46e5'; catText = 'B2B'; }
        if (ad.category === 'special') { catColor = '#9333ea'; catText = ad.customCategoryName || 'Others'; }

        let pageOptions = state.pages.map(p => {
          if (p.id === page.id) return '';
          return `<option value="${p.id}">Page ${p.pageNumber}</option>`;
        }).join('');

        let tentativeBadge = ad.isTentative ? '<span class="text-[7.5px] font-sans font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1 py-0.2 rounded scale-90 flex-shrink-0">TENTATIVE</span>' : '';

        adItemsHtml += `
          <div class="flex items-center justify-between text-[10px] bg-white p-1.5 rounded border border-slate-150 shadow-sm gap-1 hover:border-slate-300">
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <span class="w-1.5 h-3 rounded-full flex-shrink-0" style="background-color: ${catColor};" title="${catText}"></span>
              <div class="truncate leading-tight flex-1">
                <p class="font-bold text-slate-700 truncate flex items-center gap-1">
                  <span class="truncate">${escapeHtml(ad.client)}</span>
                  ${tentativeBadge}
                </p>
                <p class="text-[8px] text-slate-400 font-mono">${ad.width}x${ad.height}mm${ad.revenue ? ` • ₹${ad.revenue.toLocaleString()}` : ''}</p>
              </div>
            </div>
            <select onchange="event.stopPropagation(); moveAdToAlternativePage('${page.id}', '${ad.id}', this.value)" class="text-[9px] border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50 hover:bg-slate-100 text-slate-500 cursor-pointer focus:ring-1 focus:ring-blue-500 font-medium">
              <option value="" disabled selected>Move to...</option>
              ${pageOptions}
            </select>
          </div>
        `;
      });
      adListHtml = `<div class="space-y-1 max-h-[120px] overflow-y-auto pr-0.5">${adItemsHtml}</div>`;
    }

    // Page comments / notes preview element
    let commentHtml = '';
    if (page.comments && page.comments.trim().length > 0) {
      commentHtml = `
        <div class="mt-2 text-[10px] text-amber-850 bg-amber-50/40 hover:bg-amber-50 p-2 rounded-lg border border-amber-100/50 shadow-inner flex gap-1.5 items-start">
          <span class="flex-shrink-0 text-amber-500 font-bold select-none">💬</span>
          <span class="italic max-h-[48px] overflow-hidden text-ellipsis line-clamp-2" title="${escapeHtml(page.comments)}">${escapeHtml(page.comments)}</span>
        </div>
      `;
    }

    const pagePosition = page.position || (page.pageNumber % 2 === 0 ? "LEFT" : "RIGHT");

    pageCard.innerHTML = `
      <!-- Card Title -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-bold text-slate-800 tracking-tight uppercase">Page ${page.pageNumber}</span>
          <span class="text-[9px] font-bold px-1 py-0.5 rounded ${pagePosition === 'LEFT' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' : 'bg-purple-50 text-purple-600 border border-purple-200'}">${pagePosition}</span>
        </div>
        <span class="text-[10px] font-mono font-bold text-slate-500 bg-slate-100/60 px-1.5 py-0.5 rounded border border-slate-200/40">Broad Sheet</span>
      </div>

      <!-- Thumbnail Wrapper with hover editors overlays -->
      <div class="relative mx-auto rounded bg-slate-50 border border-slate-200 overflow-hidden flex flex-col items-center justify-end pb-3 shadow-inner mb-3 cursor-pointer group-hover:shadow-blue-500/5 transition-shadow" style="width: 180px; height: 287px;" onclick="openPageEditor('${page.id}')">
        <!-- Perfectly-centered crisp thumbnail with visible borders on all sides -->
        <div class="relative border border-slate-950 bg-white overflow-hidden shadow-md" style="width: ${thumbW}px; height: ${thumbH}px;">
          <!-- 8-Column dashed guidelines -->
          ${thumbColLinesHtml}
          ${miniAdsHtml}
        </div>
        
        <!-- Hover visual overlay layout buttons -->
        <div class="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-2.5 transition-opacity duration-150 rounded">
          <button class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-[11px] font-bold text-white shadow-lg shadow-blue-600/20 flex items-center gap-1.5 transition-transform scale-90 group-hover:scale-100 cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
            Edit Layout
          </button>
          <div class="flex gap-1 box-border">
            <button class="p-1 px-2.5 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-slate-100 font-medium cursor-pointer" onclick="event.stopPropagation(); duplicatePageLayout('${page.id}')" title="Duplicate physical page and active ads">Duplicate</button>
            <button class="p-1 px-2.5 bg-red-700 hover:bg-red-800 rounded text-[10px] text-white font-medium cursor-pointer" onclick="event.stopPropagation(); deletePageLayout('${page.id}')" title="Delete page permanently">Delete</button>
          </div>
        </div>
      </div>

      <!-- Detail elements summary row -->
      <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-mono mb-1.5">
        <span class="flex items-center gap-1">
          <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          ${page.ads.length} Advertisements
        </span>
        <span class="${pagePercentOccupied > 70 ? 'text-rose-600 font-bold' : pagePercentOccupied > 40 ? 'text-amber-600 font-semibold' : 'text-blue-600 font-semibold'}">
          ${pagePercentOccupied}% Advt Space Filled
        </span>
      </div>

      <!-- Space details & Configure trigger Row -->
      <div class="text-[10px] text-slate-400 flex justify-between items-center gap-1 font-mono mb-2">
        <div class="flex items-center gap-1 flex-wrap">
          <span class="bg-slate-100/70 px-1 py-0.5 rounded border border-slate-200/40 font-semibold" title="Dimensions">${pageW} &times; ${pageH} mm</span>
          <span class="bg-blue-50/80 text-blue-700 px-1 py-0.5 rounded border border-blue-200/30 font-bold" title="Total Page Volume">${((pageW * pageH) / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} Sqcm</span>
        </div>
        <button class="p-1 px-1.5 hover:bg-slate-50 text-[9px] hover:text-slate-800 text-slate-500 border border-slate-200/80 rounded cursor-pointer flex items-center gap-1 transition-colors group-hover:border-slate-350" onclick="event.stopPropagation(); openPageSettings('${page.id}')" title="Page settings">
          <svg class="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>
          Modify Page Size
        </button>
      </div>

      <!-- Add comments block visually if exists -->
      ${commentHtml}

      <!-- Quick scheduling transfer list widget -->
      <div class="mt-auto pt-2 border-t border-slate-100 bg-slate-50/60 p-2 rounded-lg border border-slate-200/40">
        <h4 class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Scheduled Advt</h4>
        ${adListHtml}
      </div>
    `;

    grid.appendChild(pageCard);
  });

  // Keep undo buttons up-to-date
  updateUndoRedoControls();
}

// Calculate the percentage of physical page area filled by ad sizes
function calculatePageFillPercentage(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page || page.ads.length === 0) return 0;

  const pageW = page.width || 329;
  const pageH = page.height || 525;
  const totalPageArea = pageW * pageH;
  let filledArea = 0;

  page.ads.forEach(ad => {
    filledArea += ad.width * ad.height;
  });

  return Math.min(100, Math.round((filledArea / totalPageArea) * 100));
}

// Add a new broad sheet page
function addNewBroadSheetPage() {
  const newNum = state.pages.length > 0 ? (Math.max(...state.pages.map(p => p.pageNumber)) + 1) : 1;
  const newPage = {
    id: "page-" + Date.now(),
    pageNumber: newNum,
    width: 329,
    height: 525,
    comments: "",
    ads: []
  };

  state.pages.push(newPage);
  commitHistory();
  renderAllLayouts();
  showToast(`New page ${newNum} added successfully`, "success");
}

// Duplicate a page (and clone all ads inside)
function duplicatePageLayout(pageId) {
  const index = state.pages.findIndex(p => p.id === pageId);
  if (index === -1) return;

  const originalPage = state.pages[index];
  const newNum = Math.max(...state.pages.map(p => p.pageNumber)) + 1;
  
  // Custom deep clone ads with new unique ids
  const clonedAds = originalPage.ads.map(ad => ({
    ...ad,
    id: "ad-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6)
  }));

  const newPage = {
    id: "page-" + Date.now(),
    pageNumber: newNum,
    width: originalPage.width || 329,
    height: originalPage.height || 525,
    comments: originalPage.comments || "",
    ads: clonedAds
  };

  state.pages.push(newPage);
  commitHistory();
  renderAllLayouts();
  showToast(`Duplicated Page ${originalPage.pageNumber} as Page ${newNum}`, "success");
}

// Delete a page configuration permanently (checks safe thresholds)
function deletePageLayout(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return;

  if (state.pages.length <= 1) {
    showToast("Application requires keeping at least 1 active page planning sheet.", "error");
    return;
  }

  showConfirmDialog(
    "DELETE PHYSICAL PAGE?",
    `Are you sure you want to delete Page ${page.pageNumber}? All scheduled advertising layouts inside the page will be lost.`,
    () => {
      state.pages = state.pages.filter(p => p.id !== pageId);
      
      // Regenerate sequential numbers to avoid layout index jumps
      state.pages.forEach((p, idx) => {
        p.pageNumber = idx + 1;
      });

      commitHistory();
      renderAllLayouts();
      showToast(`Page deleted permanently`, "success");
    }
  );
}

// Reset Entire planning board
function triggerResetAll() {
  showConfirmDialog(
    "RESET SYSTEM PLANNER DATABASE?",
    "Do you want to restore the layout planner database to its original empty state? This action wipes all local pages entirely.",
    () => {
      loadSamplePages();
      const defaultL = {
        id: 'layout-primary',
        name: 'Primary Layout 01',
        date: new Date().toISOString().split('T')[0],
        centers: '',
        pages: clonePages(state.pages)
      };
      state.layouts = [defaultL];
      state.activeLayoutId = defaultL.id;
      commitHistory();
      renderLayoutSelectorDropdown();
      renderAllLayouts();
      saveLayoutsToLocalStorageSilently();
      showToast("Planner database reset successfully", "success");
    }
  );
}

// =========================================================================
// INTERACTIVE PAGE CANVAS COMPRESSION EDITOR
// =========================================================================

// Open Modal edit workspace for pageId
function openPageEditor(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return;

  state.activePageId = pageId;
  
  const modal = document.getElementById('editor-modal');
  modal.classList.remove('hidden');

  // Trigger auto fit scaling mapping
  autoFitEditorCanvas();
  renderActiveEditorBoard();

  showToast(`Opened layout workspace for Page ${page.pageNumber}`, "info");
}

// Search for and return all active layout violations on a page (unlocked checks)
function findLayoutViolations(page) {
  const violations = [];
  const pageW = page.width || 329;
  const pageH = page.height || 525;

  // 1. Check boundary violations for each ad
  for (const ad of page.ads) {
    if (ad.x < 0 || ad.y < 0 || (ad.x + ad.width) > pageW || (ad.y + ad.height) > pageH) {
      violations.push(`Ad "${ad.client}" goes out of the page boundaries`);
    }
  }

  // 2. Check collision/gap violations between pairs of ads
  const len = page.ads.length;
  for (let i = 0; i < len; i++) {
    const adA = page.ads[i];
    for (let j = i + 1; j < len; j++) {
      const adB = page.ads[j];
      // Check if they are overlapping or violating 3mm spacing buffer
      if (
        adA.x < adB.x + adB.width + SPACING_BUFFER_MM &&
        adB.x < adA.x + adA.width + SPACING_BUFFER_MM &&
        adA.y < adB.y + adB.height + SPACING_BUFFER_MM &&
        adB.y < adA.y + adA.height + SPACING_BUFFER_MM
      ) {
        // Find whether it is exact overlap or spacing overlap
        const isExactOverlap = (
          adA.x < adB.x + adB.width &&
          adB.x < adA.x + adA.width &&
          adA.y < adB.y + adB.height &&
          adB.y < adA.y + adA.height
        );
        if (isExactOverlap) {
          violations.push(`Ad "${adA.client}" overlaps with Ad "${adB.client}"`);
        } else {
          violations.push(`Ad "${adA.client}" and Ad "${adB.client}" violate the 3mm safety gap`);
        }
      }
    }
  }
  return violations;
}

// Close Modal editor panel
function closePageEditor() {
  const page = state.pages.find(p => p.id === state.activePageId);
  if (page) {
    const violations = findLayoutViolations(page);
    if (violations.length > 0) {
      showToast("Cannot Exit: Mandatory layout configuration rules violated!", "error");
      
      const errorMsg = "This page cannot be closed because of the following layout violations:\n" + 
                       violations.map((v, idx) => `${idx + 1}. ${v}`).join('\n') + 
                       "\n\nPlease adjust, move, resize, swap, or remove the advertisements to construct a valid non-overlapping layout (with 3mm spacing) before exiting.";
      
      showCustomDialog({
        title: "Mandatory Layout Integrity Check",
        message: errorMsg,
        confirmText: "Fix Layout Issues",
        theme: "red",
        hideCancel: true,
        onConfirm: () => {
          // Stay inside workspace to let them resolve
        }
      });
      return;
    }
  }

  state.activePageId = null;
  const modal = document.getElementById('editor-modal');
  modal.classList.add('hidden');
  renderAllLayouts();
}

// Open Page Space Settings and Comments Configuration
function openPageSettings(pageId) {
  const targetId = pageId || state.activePageId;
  const page = state.pages.find(p => p.id === targetId);
  if (!page) return;

  const modal = document.getElementById('page-settings-modal');
  if (!modal) return;

  const titleEl = document.getElementById('page-settings-title');
  if (titleEl) {
    titleEl.textContent = `PAGE ${page.pageNumber} SPACE CONFIGURATION`;
  }

  const idInput = document.getElementById('form-page-id');
  if (idInput) idInput.value = targetId;

  const positionInput = document.getElementById('form-page-position');
  if (positionInput) positionInput.value = page.position || (page.pageNumber % 2 === 0 ? "LEFT" : "RIGHT");

  const widthInput = document.getElementById('form-page-width');
  if (widthInput) widthInput.value = page.width || 329;

  const heightInput = document.getElementById('form-page-height');
  if (heightInput) heightInput.value = page.height || 525;

  const commentsText = document.getElementById('form-page-comments');
  if (commentsText) commentsText.value = page.comments || '';

  modal.classList.remove('hidden');
}

// Close Page Settings modal
function closePageSettings() {
  const modal = document.getElementById('page-settings-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Handle Page Settings Submission
function handlePageSettingsFormSubmit(e) {
  e.preventDefault();
  const pageId = document.getElementById('form-page-id').value;
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return;

  const position = document.getElementById('form-page-position').value;
  const width = parseInt(document.getElementById('form-page-width').value, 10);
  const height = parseInt(document.getElementById('form-page-height').value, 10);
  const comments = document.getElementById('form-page-comments').value;

  if (isNaN(width) || width < 100 || width > 800) {
    showToast("Width must be between 100mm and 800mm", "error");
    return;
  }
  if (isNaN(height) || height < 100 || height > 1200) {
    showToast("Height must be between 100mm and 1200mm", "error");
    return;
  }

  // Check if any existing ads exceed the new dimensions considering bottom alignment
  const oldHeight = page.height || 525;
  const deltaHeight = height - oldHeight;

  const exceedingAds = page.ads.filter(ad => {
    const newY = ad.y + deltaHeight;
    return (ad.x < 0) || (ad.x + ad.width > width) || (newY < 0) || (newY + ad.height > height);
  });

  if (exceedingAds.length > 0) {
    showToast(`Cannot resize: ${exceedingAds.length} existing ad placement(s) would exceed boundaries!`, "error");
    return;
  }

  // Shift ads vertically to remain aligned with the page bottom
  page.ads.forEach(ad => {
    ad.y = ad.y + deltaHeight;
  });

  // Save changes
  page.position = position;
  page.width = width;
  page.height = height;
  page.comments = comments;

  closePageSettings();
  commitHistory();
  renderAllLayouts();
  if (state.activePageId === pageId) {
    // If we edited the page currently active in the editor, we should re-render it
    autoFitEditorCanvas();
    renderActiveEditorBoard();
  }
  saveToLocalStorage();
  showToast(`Page ${page.pageNumber} settings updated`, "success");
}

// Render active page canvas grids
function renderActiveEditorBoard() {
  if (!state.activePageId) return;

  const page = state.pages.find(p => p.id === state.activePageId);
  if (!page) return;

  const pageTitle = document.getElementById('lbl-active-page-title');
  const pageStats = document.getElementById('lbl-active-page-stats');
  
  const pagePosition = page.position || (page.pageNumber % 2 === 0 ? "LEFT" : "RIGHT");
  if (pageTitle) pageTitle.textContent = `PAGE ${page.pageNumber} (${pagePosition}) LAYOUT EDITOR`;
  
  const pageW = page.width || 329;
  const pageH = page.height || 525;
  const totalArea = pageW * pageH;
  let filledArea = 0;
  page.ads.forEach(ad => filledArea += ad.width * ad.height);
  const fillPercent = Math.round((filledArea / totalArea) * 100);

  if (pageStats) {
    pageStats.textContent = `${page.ads.length} Advt | ${fillPercent}% Advt Space Filled | ${pageW}mm × ${pageH}mm`;
  }

  // Update Side Panel Ads summary calculations
  const sideAdArea = document.getElementById('lbl-sidebar-ad-area');
  const sideRemainArea = document.getElementById('lbl-sidebar-remain-area');
  if (sideAdArea) sideAdArea.textContent = filledArea.toLocaleString() + " mm²";
  if (sideRemainArea) sideRemainArea.textContent = (totalArea - filledArea).toLocaleString() + " mm²";

  // Update sidebar page comments notes block
  const sidebarComments = document.getElementById('editor-sidebar-comments');
  if (sidebarComments) {
    if (page.comments && page.comments.trim().length > 0) {
      sidebarComments.textContent = page.comments;
      sidebarComments.classList.remove('text-slate-400', 'italic');
      sidebarComments.classList.add('text-slate-600');
    } else {
      sidebarComments.textContent = "No comments written yet. Click edit to add notes.";
      sidebarComments.classList.remove('text-slate-600');
      sidebarComments.classList.add('text-slate-400', 'italic');
    }
  }

  // Build Board Canvas Style Dims
  const canvas = document.getElementById('editor-page-canvas');
  if (!canvas) return;

  const mmPx = BASE_DPI * state.zoom;
  canvas.style.width = `${pageW * mmPx}px`;
  canvas.style.height = `${pageH * mmPx}px`;

  // Set plain white background
  canvas.style.backgroundImage = 'none';
  canvas.style.backgroundColor = '#ffffff';

  // Render rulers scales marks
  renderRulers(state.zoom);

  // Render scheduled boxes
  let adsHtml = '';
  page.ads.forEach(ad => {
    // Determine category details
    let catHeadline = 'Retail';
    if (ad.category === 'classified') catHeadline = 'Health Care';
    if (ad.category === 'editorial') catHeadline = 'Real Estate';
    if (ad.category === 'political') catHeadline = 'Education';
    if (ad.category === 'finance') catHeadline = 'B2B';
    if (ad.category === 'special') catHeadline = ad.customCategoryName || 'Others';

    const tentativeClass = ad.isTentative ? 'ad-box-tentative' : '';
    const tentativeLabelStr = ad.isTentative ? ' • Tentative' : '';

    adsHtml += `
      <div id="${ad.id}" 
           class="ad-box group absolute rounded border-2 select-none shadow-md overflow-hidden cursor-grab flex flex-col justify-between p-2.5 box-border ad-box-cat-${ad.category} ${tentativeClass}"
           style="left:${ad.x * mmPx}px; top:${ad.y * mmPx}px; width:${ad.width * mmPx}px; height:${ad.height * mmPx}px; z-index: 20;"
           data-ad-id="${ad.id}">
        
        <!-- Category bottom accent tag -->
        <div class="cat-accent absolute left-0 right-0 bottom-0 h-1.5"></div>

        <!-- Meta elements row (Close and Info) -->
        <div class="flex items-start justify-between gap-1 w-full pl-1">
          <div class="overflow-hidden">
            <h5 class="text-[11px] leading-tight font-bold text-slate-800 truncate font-display" title="${ad.client}">
              ${ad.client}
            </h5>
            <span class="text-[8px] font-medium text-slate-500 scale-95 origin-left block mt-0.5">
              ${catHeadline}${ad.revenue ? ` • ₹${ad.revenue.toLocaleString()}` : ''}${tentativeLabelStr}
            </span>
          </div>
          
          <!-- Fast Action Buttons (Perfect touch screen convenience) -->
          <div class="flex items-center gap-1 opacity-0 hover:opacity-100 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button class="p-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition cursor-pointer" onclick="event.stopPropagation(); loadFormAdConfigure('${ad.id}')" title="Configure metrics">
              <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
            </button>
            <button class="p-0.5 bg-slate-200 hover:bg-rose-600 hover:text-white text-slate-700 rounded transition cursor-pointer" onclick="event.stopPropagation(); deleteAdFromPage('${ad.id}')" title="Wipe advertisement">
              <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>

        <!-- Metrics scale label -->
        <div class="flex items-center justify-between pl-1">
          <span class="text-[8px] text-slate-400 font-mono scale-90 origin-left">
            (${ad.x}, ${ad.y})
          </span>
          <span class="info-dimensions text-[9px] font-bold font-mono text-slate-700 px-1 py-0.5 bg-white/70 rounded shadow-sm border border-slate-200 flex-shrink-0">
            ${ad.width} &times; ${ad.height} mm
          </span>
        </div>
      </div>
    `;
  });

  // Draw 8-Column dashed guidelines inside active editor canvas
  let editorColLinesHtml = '';
  const colWidthMmVal = pageW / 8;
  for (let i = 1; i <= 7; i++) {
    const colX = i * colWidthMmVal * mmPx;
    editorColLinesHtml += `
      <div class="absolute top-0 bottom-0 pointer-events-none border-l border-dashed border-slate-200" style="left: ${colX}px; z-index: 5;">
        <span class="absolute top-1 left-1 bg-white/90 border border-slate-200 text-[8px] font-mono font-bold text-slate-400 px-1 rounded-sm transform -translate-x-1/2 select-none pointer-events-none">Col ${i}</span>
      </div>
    `;
  }

  canvas.innerHTML = editorColLinesHtml + adsHtml;

  // Setup contextual click event listeners on freshly bound HTML ad-box elements
  const boxes = canvas.querySelectorAll('.ad-box');
  boxes.forEach(box => {
    box.addEventListener('contextmenu', triggerContextAdBoxClick);
    box.addEventListener('mousedown', initiateControlInteraction);
    box.addEventListener('touchstart', initiateControlInteraction, { passive: false });
  });

  // Render Sidebar Left Item list
  renderLeftSidebarMenuIndex(page);

  // Sync Global controls
  updateUndoRedoControls();
}

// Render Ruler indicators
function renderRulers(zoom) {
  const topRuler = document.getElementById('top-ruler');
  const leftRuler = document.getElementById('left-ruler');
  if (!topRuler || !leftRuler) return;

  const page = state.pages.find(p => p.id === state.activePageId);
  if (!page) return;

  const pageW = page.width || 329;
  const pageH = page.height || 525;
  const mmPx = BASE_DPI * zoom;

  // Horizontal top centimeter increments ticks (total: pageW mm)
  let topHtml = '';
  for (let mm = 0; mm <= pageW; mm += 10) {
    const pos = mm * mmPx;
    topHtml += `
      <div class="absolute text-[8px] font-mono border-l border-slate-600 pl-0.5" style="left: ${pos}px; height: 14px; top: 0; line-height: 14px;">
        ${mm / 10}
      </div>
    `;
  }
  topRuler.innerHTML = topHtml;

  // Vertical left centimeter ticks (total: pageH mm)
  let leftHtml = '';
  for (let mm = 0; mm <= pageH; mm += 10) {
    const pos = mm * mmPx;
    leftHtml += `
      <div class="absolute text-[8px] font-mono border-t border-slate-600 pt-0.5" style="top: ${pos}px; width: 14px; left: 0; text-align: center; line-height: 10px;">
        ${mm / 10}
      </div>
    `;
  }
  leftRuler.innerHTML = leftHtml;
}

// Left side layout index list render
function renderLeftSidebarMenuIndex(page) {
  const container = document.getElementById('editor-sidebar-ads-list');
  if (!container) return;

  if (page.ads.length === 0) {
    container.innerHTML = `
      <div class="text-slate-500 text-xs italic text-center py-12 flex flex-col items-center justify-center gap-1.5">
        <span>No ad boxes placed</span>
        <button class="text-[10px] text-indigo-400 font-semibold underline hover:text-indigo-300" onclick="triggerEmptySpaceClickForm(50, 50)">Place standard box</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  page.ads.forEach(ad => {
    const item = document.createElement('div');
    item.className = "p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 hover:border-slate-700 hover:bg-slate-850 cursor-pointer flex justify-between items-center transition-all group/sidebar-item";
    
    let colorText = 'bg-blue-600';
    if (ad.category === 'classified') colorText = 'bg-emerald-600';
    if (ad.category === 'editorial') colorText = 'bg-orange-600';
    if (ad.category === 'political') colorText = 'bg-fuchsia-600';
    if (ad.category === 'finance') colorText = 'bg-indigo-600';
    if (ad.category === 'special') colorText = 'bg-purple-600';

    item.innerHTML = `
      <div class="overflow-hidden flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${colorText} flex-shrink-0"></span>
        <div class="overflow-hidden min-w-[130px]">
          <h6 class="text-[11px] font-bold text-white leading-tight truncate tracking-tight flex items-center gap-1.5">
            <span class="truncate">${escapeHtml(ad.client)}</span>
            ${ad.isTentative ? '<span class="text-[7.5px] font-sans font-medium text-rose-400 border border-rose-500/30 bg-rose-950/40 px-1 py-0.1 rounded flex-shrink-0 select-none">Tentative</span>' : ''}
          </h6>
          <span class="text-[9px] font-mono text-slate-500 mt-0.5 block">${ad.width} &times; ${ad.height} mm${ad.revenue ? ` • ₹${ad.revenue.toLocaleString()}` : ''}</span>
        </div>
      </div>
      <div class="flex items-center gap-1 opacity-0 group-hover/sidebar-item:opacity-100 transition-opacity">
        <button class="p-1 hover:bg-slate-705 hover:text-amber-400 text-slate-400 rounded transition" onclick="event.stopPropagation(); triggerDirectSwap('${ad.id}')" title="Swap Position">
          <svg class="w-3" style="width: 12px; height: 12px; fill: none; stroke: currentColor;" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
        </button>
        <button class="p-1 hover:bg-slate-700 text-slate-400 hover:text-white rounded transition" onclick="event.stopPropagation(); loadFormAdConfigure('${ad.id}')" title="Configure">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
        </button>
        <button class="p-1 hover:bg-red-950/60 hover:text-red-400 text-slate-400 rounded transition" onclick="event.stopPropagation(); deleteAdFromPage('${ad.id}')" title="Delete">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
      </div>
    `;

    // Click item highlight focus
    item.addEventListener('click', () => {
      const boxNode = document.getElementById(ad.id);
      if (boxNode) {
        boxNode.classList.add('ring-4', 'ring-indigo-500', 'scale-105', 'z-50');
        setTimeout(() => {
          boxNode.classList.remove('ring-4', 'ring-indigo-500', 'scale-105');
        }, 1200);
        
        // Scroll workspace to element
        boxNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    });

    container.appendChild(item);
  });
}

// Auto Fit algorithm - Computes zoom precisely to fill physical page layout nicely inside screen bounds
function autoFitEditorCanvas() {
  const container = document.getElementById('editor-workspace-viewport');
  if (!container) return;

  const wView = container.clientWidth - 80; // horizontal margins padding
  const hView = container.clientHeight - 80; // vertical padding margins

  const page = state.pages.find(p => p.id === state.activePageId);
  const pageW = page ? (page.width || 329) : 329;
  const pageH = page ? (page.height || 525) : 525;

  // standard physical layout pixels: width pageW * 1.5, height: pageH * 1.5
  const baseW = pageW * BASE_DPI;
  const baseH = pageH * BASE_DPI;

  const scaleW = wView / baseW;
  const scaleH = hView / baseH;
  
  // Choose the tighter bound to prevent overflow off-screen
  let bestZoom = Math.min(scaleW, scaleH);

  // clamp to logical scales sizes (minimum 25%, maximum 250%)
  bestZoom = Math.max(0.25, Math.min(2.50, bestZoom));

  // Round off nicely
  state.zoom = Math.round(bestZoom * 10) / 10;
  if (state.zoom === 0) state.zoom = 0.1;

  updateZoomUI();
}

// Change Zoom Factor
function adjustZoom(delta) {
  state.zoom = Math.max(0.2, Math.min(2.5, Math.round((state.zoom + delta) * 10) / 10));
  updateZoomUI();
  renderActiveEditorBoard();
}

// Update Zoom level counters
function updateZoomUI() {
  const lbl = document.getElementById('lbl-zoom-perc');
  if (lbl) lbl.textContent = Math.round(state.zoom * 100) + "%";
}

// =========================================================================
// DRAG, REPOSITION, RESIZE WORKSPACE CONTROLLERS
// =========================================================================

function initiateControlInteraction(e) {
  // If we clicked or touched a button (Fast Action buttons on target ad-box), do not drag/interfere
  if (e.target.closest('button')) {
    return;
  }

  // Prevent default gesture scaling on mobile
  if (e.type === 'touchstart') {
    // Only intercept if we touch inside handles or ad bounds
    e.preventDefault();
  }

  const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
  const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;

  // Distinguish between drag body and resize handle
  const handle = e.target.closest('.resize-handle');
  const edge = handle ? handle.getAttribute('data-edge') : null;
  const adNode = e.target.closest('.ad-box');

  if (!adNode) return;
  const adId = adNode.getAttribute('data-ad-id');
  const page = state.pages.find(p => p.id === state.activePageId);
  const ad = page ? page.ads.find(a => a.id === adId) : null;

  if (!ad) return;

  // Manage mobile touch hold gesture (long press)
  if (touchHoldTimer) {
    clearTimeout(touchHoldTimer);
  }
  if (e.type === 'touchstart') {
    touchHoldActive = true;
    touchHoldTimer = setTimeout(() => {
      if (touchHoldActive) {
        if (navigator.vibrate) {
          try { navigator.vibrate(60); } catch(err) {}
        }
        touchHoldActive = false;
        
        // Unbind any move tracking listeners
        document.removeEventListener('touchmove', handleControlInteractionMove);
        document.removeEventListener('touchend', endControlInteraction);
        
        // Remove active visual indicators
        adNode.classList.remove('ad-box-dragging');
        
        // Reset interaction reference
        interactState = {
          mode: null,
          adId: null,
          tempValid: true
        };
        
        // Trigger customized Context Options Modal
        showContextMenuAt(adId, clientX, clientY);
      }
    }, 600); // 600ms hold threshold
  }

  // Load clean baseline reference to undo-revert in case of spatial violation
  interactState = {
    mode: handle ? 'resize' : 'drag',
    edge: edge,
    adId: adId,
    startX: clientX,
    startY: clientY,
    startW: ad.width,
    startH: ad.height,
    startXmm: ad.x,
    startYmm: ad.y,
    origX: ad.x,
    origY: ad.y,
    origW: ad.width,
    origH: ad.height,
    tempX: ad.x,
    tempY: ad.y,
    tempW: ad.width,
    tempH: ad.height,
    tempValid: true,
    element: adNode
  };

  // Visually flags active element
  adNode.classList.add('ad-box-dragging');

  // Register move listeners on document (prevents coordinate drift drop and stuck triggers)
  if (e.type === 'touchstart') {
    document.addEventListener('touchmove', handleControlInteractionMove, { passive: false });
    document.addEventListener('touchend', endControlInteraction, { passive: false });
  } else {
    document.addEventListener('mousemove', handleControlInteractionMove);
    document.addEventListener('mouseup', endControlInteraction);
  }
}

function handleControlInteractionMove(e) {
  if (!interactState.mode || !interactState.adId) return;

  const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
  const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

  // Cancel touch hold timer if the user dragged more than 10 pixels
  if (e.type === 'touchmove' && touchHoldActive) {
    const dist = Math.hypot(clientX - interactState.startX, clientY - interactState.startY);
    if (dist > 10) {
      if (touchHoldTimer) clearTimeout(touchHoldTimer);
      touchHoldActive = false;
    }
  }

  const mmPx = BASE_DPI * state.zoom;
  const dxPx = clientX - interactState.startX;
  const dyPx = clientY - interactState.startY;

  // Convert pixels offset to millimeter offset at current zoom ratio
  const dxMm = dxPx / mmPx;
  const dyMm = dyPx / mmPx;

  const page = state.pages.find(p => p.id === state.activePageId);
  const ad = page ? page.ads.find(a => a.id === interactState.adId) : null;
  if (!ad) return;

  const warningLabel = document.getElementById('lbl-editor-warning');

  const activePage = state.pages.find(p => p.id === state.activePageId);
  const pageW = activePage ? (activePage.width || 329) : 329;
  const pageH = activePage ? (activePage.height || 525) : 525;

  const chkSnapGap = document.getElementById('chk-snap-gap');
  const shouldSnap = chkSnapGap ? chkSnapGap.checked : true;

  if (interactState.mode === 'drag') {
    // Absolute candidates bounds before snapping
    const rawCandX = Math.round(interactState.startXmm + dxMm);
    const rawCandY = Math.round(interactState.startYmm + dyMm);

    let candX = Math.max(0, Math.min(pageW - ad.width, rawCandX));
    let candY = Math.max(0, Math.min(pageH - ad.height, rawCandY));

    let snapped = false;

    if (shouldSnap) {
      const SNAP_THRESHOLD = 8; // Snap threshold in mm
      let minDiffX = Infinity;
      let minDiffY = Infinity;
      let targetX = candX;
      let targetY = candY;

      // Snapping candidates for X axis (relative to page edges and other ads with 3mm gap or alignments)
      const xTargets = [0, pageW - ad.width];
      const yTargets = [0, pageH - ad.height];

      if (page) {
        for (const otherAd of page.ads) {
          if (otherAd.id === ad.id) continue;
          
          // Gap snaps: place left of otherAd, or place right of otherAd with a 3mm gap
          xTargets.push(otherAd.x - ad.width - SPACING_BUFFER_MM);
          xTargets.push(otherAd.x + otherAd.width + SPACING_BUFFER_MM);

          // Flush alignments: align left edges, or right edges
          xTargets.push(otherAd.x);
          xTargets.push(otherAd.x + otherAd.width - ad.width);

          // Gap snaps: place above otherAd, or place below otherAd with a 3mm gap
          yTargets.push(otherAd.y - ad.height - SPACING_BUFFER_MM);
          yTargets.push(otherAd.y + otherAd.height + SPACING_BUFFER_MM);

          // Flush alignments: align top edges, or bottom edges
          yTargets.push(otherAd.y);
          yTargets.push(otherAd.y + otherAd.height - ad.height);
        }
      }

      // Find closest within threshold for X
      for (const tx of xTargets) {
        if (tx < 0 || tx > pageW - ad.width) continue;
        const diff = Math.abs(rawCandX - tx);
        if (diff < SNAP_THRESHOLD && diff < minDiffX) {
          minDiffX = diff;
          targetX = tx;
        }
      }

      // Find closest within threshold for Y
      for (const ty of yTargets) {
        if (ty < 0 || ty > pageH - ad.height) continue;
        const diff = Math.abs(rawCandY - ty);
        if (diff < SNAP_THRESHOLD && diff < minDiffY) {
          minDiffY = diff;
          targetY = ty;
        }
      }

      // Propose snapping coordinates if they are collision free
      const snapBothCollide = checkCollision(state.activePageId, ad.id, targetX, targetY, ad.width, ad.height);

      if (!snapBothCollide) {
        if (targetX !== candX || targetY !== candY) {
          candX = targetX;
          candY = targetY;
          snapped = true;
        }
      } else {
        const snapXOnlyCollide = checkCollision(state.activePageId, ad.id, targetX, candY, ad.width, ad.height);
        if (!snapXOnlyCollide && targetX !== candX) {
          candX = targetX;
          snapped = true;
        }
        
        const snapYOnlyCollide = checkCollision(state.activePageId, ad.id, candX, targetY, ad.width, ad.height);
        if (!snapYOnlyCollide && targetY !== candY) {
          candY = targetY;
          snapped = true;
        }
      }
    }

    if (snapped) {
      interactState.element.classList.add('ad-box-snapped');
    } else {
      interactState.element.classList.remove('ad-box-snapped');
    }

    // Spatial validation overlap check
    const spaceIsBlocked = checkCollision(state.activePageId, ad.id, candX, candY, ad.width, ad.height);

    interactState.tempX = candX;
    interactState.tempY = candY;
    interactState.tempValid = !spaceIsBlocked;

    // Direct rapid DOM writes (smoother, avoids full virtual re-render cycles)
    interactState.element.style.left = `${candX * mmPx}px`;
    interactState.element.style.top = `${candY * mmPx}px`;

    // Update temporal UI counters live
    const posLabel = interactState.element.querySelector('.text-\\[8px\\]');
    if (posLabel) posLabel.textContent = `(${candX}, ${candY})`;

    if (!interactState.tempValid) {
      interactState.element.classList.add('ad-box-invalid');
      if (warningLabel) {
        warningLabel.classList.remove('hidden');
        document.getElementById('lbl-editor-warning-text').textContent = "Overlap Collision Blocked! Restoring 3mm space buffer";
      }
    } else {
      interactState.element.classList.remove('ad-box-invalid');
      if (warningLabel) warningLabel.classList.add('hidden');
    }

  } else if (interactState.mode === 'resize') {
    const edge = interactState.edge || 'br';

    let candX = ad.x;
    let candY = ad.y;
    let candW = ad.width;
    let candH = ad.height;

    if (edge === 'r') {
      const rawCandW = Math.round(interactState.startW + dxMm);
      candW = Math.max(MIN_AD_SIZE_MM, Math.min(pageW - ad.x, rawCandW));
    } else if (edge === 'b') {
      const rawCandH = Math.round(interactState.startH + dyMm);
      candH = Math.max(MIN_AD_SIZE_MM, Math.min(pageH - ad.y, rawCandH));
    } else if (edge === 'l') {
      const rawCandX = Math.round(interactState.startXmm + dxMm);
      candX = Math.max(0, Math.min(interactState.startXmm + interactState.startW - MIN_AD_SIZE_MM, rawCandX));
      candW = interactState.startXmm + interactState.startW - candX;
    } else if (edge === 't') {
      const rawCandY = Math.round(interactState.startYmm + dyMm);
      candY = Math.max(0, Math.min(interactState.startYmm + interactState.startH - MIN_AD_SIZE_MM, rawCandY));
      candH = interactState.startYmm + interactState.startH - candY;
    } else { // 'br' or other corner
      const rawCandW = Math.round(interactState.startW + dxMm);
      const rawCandH = Math.round(interactState.startH + dyMm);
      candW = Math.max(MIN_AD_SIZE_MM, Math.min(pageW - ad.x, rawCandW));
      candH = Math.max(MIN_AD_SIZE_MM, Math.min(pageH - ad.y, rawCandH));
    }

    const spaceIsBlocked = checkCollision(state.activePageId, ad.id, candX, candY, candW, candH);

    interactState.tempX = candX;
    interactState.tempY = candY;
    interactState.tempW = candW;
    interactState.tempH = candH;
    interactState.tempValid = !spaceIsBlocked;

    // Direct UI CSS resize updates
    interactState.element.style.left = `${candX * mmPx}px`;
    interactState.element.style.top = `${candY * mmPx}px`;
    interactState.element.style.width = `${candW * mmPx}px`;
    interactState.element.style.height = `${candH * mmPx}px`;

    const dimLabel = interactState.element.querySelector('.info-dimensions');
    if (dimLabel) dimLabel.innerHTML = `${candW} &times; ${candH} mm`;

    const posLabel = interactState.element.querySelector('.text-slate-400.font-mono');
    if (posLabel) posLabel.innerHTML = `(${candX}, ${candY})`;

    if (!interactState.tempValid) {
      interactState.element.classList.add('ad-box-invalid');
      if (warningLabel) {
        warningLabel.classList.remove('hidden');
        document.getElementById('lbl-editor-warning-text').textContent = "Size overlap blocked! 3mm boundaries gap required";
      }
    } else {
      interactState.element.classList.remove('ad-box-invalid');
      if (warningLabel) warningLabel.classList.add('hidden');
    }
  }
}

function endControlInteraction(e) {
  // Cancel touch hold timer if interaction completes or touches are lifted
  if (touchHoldTimer) {
    clearTimeout(touchHoldTimer);
  }
  touchHoldActive = false;

  // Unbind window document listeners
  if (e.type === 'touchend') {
    document.removeEventListener('touchmove', handleControlInteractionMove);
    document.removeEventListener('touchend', endControlInteraction);
  } else {
    document.removeEventListener('mousemove', handleControlInteractionMove);
    document.removeEventListener('mouseup', endControlInteraction);
  }

  if (!interactState.mode || !interactState.adId) return;

  const page = state.pages.find(p => p.id === state.activePageId);
  const ad = page ? page.ads.find(a => a.id === interactState.adId) : null;

  const warningLabel = document.getElementById('lbl-editor-warning');
  if (warningLabel) warningLabel.classList.add('hidden');

  if (ad) {
    // Check if the landing position is valid. We preserve manual placement (drag/resize) coordinates directly as requested!
    // The user's request: "if i move ads manually to top or any other place to adjust other ads, it should be there, only new ad placing time automatically bottom aligne should work"
    const isBlocked = checkCollision(state.activePageId, ad.id, interactState.tempX, interactState.tempY, interactState.tempW, interactState.tempH);
    interactState.tempValid = !isBlocked;

    if (interactState.tempValid) {
      // Commit placement variables
      let changeFired = false;
      if (ad.x !== interactState.tempX || ad.y !== interactState.tempY || ad.width !== interactState.tempW || ad.height !== interactState.tempH) {
        ad.x = interactState.tempX;
        ad.y = interactState.tempY;
        ad.width = interactState.tempW;
        ad.height = interactState.tempH;
        changeFired = true;
      }

      if (changeFired) {
        commitHistory();
        showToast("Placement configuration updated", "success");
      }
    } else {
      // Validation failed overlap triggers - Restore physical default positions
      ad.x = interactState.origX;
      ad.y = interactState.origY;
      ad.width = interactState.origW;
      ad.height = interactState.origH;
      
      showToast("Placement rolled back: Collision/boundary conflict detected at this position.", "error");
    }
  }

  // Restore DOM clean rendering indexes
  if (interactState.element) {
    interactState.element.classList.remove('ad-box-dragging', 'ad-box-invalid', 'ad-box-snapped');
  }
  
  // Wipe state
  interactState = { mode: null, adId: null, element: null };

  // Trigger global layout refresh
  renderActiveEditorBoard();
}

// Spatial check routine (returns true on bounds violations or overlap buffer conflicts)
function checkCollision(pageId, excludeAdId, x, y, w, h) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return false;

  const pageW = page.width || 329;
  const pageH = page.height || 525;

  // Page boundaries check
  if (x < 0 || y < 0 || (x + w) > pageW || (y + h) > pageH) {
    return true; // Exceeds custom page dimensions bounds
  }

  // Check if allow overlap exists and is checked
  const chkAllowOverlap = document.getElementById('chk-allow-overlap');
  if (chkAllowOverlap && chkAllowOverlap.checked) {
    return false; // Bypass advertisement intersection checks
  }

  for (const ad of page.ads) {
    if (excludeAdId && ad.id === excludeAdId) {
      continue; // Skip evaluation against itself
    }

    // Mathematical overlap validation + 3mm layout space buffer rule:
    // They overlap if each rectangle's bounds, extended by a 3mm gap, collide with each other. 
    // Two ads A & B violate the 3mm spacing rule if they are too close.
    if (
      ad.x < x + w + SPACING_BUFFER_MM &&
      x < ad.x + ad.width + SPACING_BUFFER_MM &&
      ad.y < y + h + SPACING_BUFFER_MM &&
      y < ad.y + ad.height + SPACING_BUFFER_MM
    ) {
      return true; // Intersection confirmed
    }
  }

  return false;
}

// Finds the bottom-most available position for a given horizontal targetX
function gravitateToBottom(pageId, w, h, excludeAdId = null, targetX = 0) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return null;

  const pageW = page.width || 329;
  const pageH = page.height || 525;

  if (w > pageW || h > pageH) return null;

  // Clamp targetX to make sure width fits the page dimensions properly
  const clampedX = Math.max(0, Math.min(pageW - w, Math.round(targetX)));

  // Scan from the absolute bottom of the page (pageH - h) upwards to 0 to find the first collision-free Y coordinate.
  // This automatically bottom-aligns the ad box with high precision.
  for (let ty = pageH - h; ty >= 0; ty--) {
    if (!checkCollision(pageId, excludeAdId, clampedX, ty, w, h)) {
      return { x: clampedX, y: ty };
    }
  }

  return null;
}

// Finds the nearest available coordinate on a page that can fit an ad of width `w` and height `h`
// with 3mm safety gap (SPACING_BUFFER_MM).
function autoFindAvailableSpace(pageId, w, h, excludeAdId = null, preferredX = 0, preferredY = 0) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return null;

  const pageW = page.width || 329;
  const pageH = page.height || 525;

  if (w > pageW || h > pageH) return null;

  // Compile candidate anchors
  const xCandidates = new Set([0, pageW - w]);
  const yCandidates = new Set([0, pageH - h]);

  const clampedPrefX = Math.max(0, Math.min(pageW - w, preferredX));
  const clampedPrefY = Math.max(0, Math.min(pageH - h, preferredY));
  xCandidates.add(clampedPrefX);
  yCandidates.add(clampedPrefY);

  const colW = pageW / 8;
  for (let i = 1; i <= 7; i++) {
    const cx = Math.round(i * colW);
    if (cx >= 0 && cx <= pageW - w) {
      xCandidates.add(cx);
    }
  }

  page.ads.forEach(otherAd => {
    if (excludeAdId && otherAd.id === excludeAdId) return;

    const leftGap = otherAd.x - w - SPACING_BUFFER_MM;
    const rightGap = otherAd.x + otherAd.width + SPACING_BUFFER_MM;
    const flushLeft = otherAd.x;
    const flushRight = otherAd.x + otherAd.width - w;

    if (leftGap >= 0 && leftGap <= pageW - w) xCandidates.add(leftGap);
    if (rightGap >= 0 && rightGap <= pageW - w) xCandidates.add(rightGap);
    if (flushLeft >= 0 && flushLeft <= pageW - w) xCandidates.add(flushLeft);
    if (flushRight >= 0 && flushRight <= pageW - w) xCandidates.add(flushRight);

    const topGap = otherAd.y - h - SPACING_BUFFER_MM;
    const bottomGap = otherAd.y + otherAd.height + SPACING_BUFFER_MM;
    const flushTop = otherAd.y;
    const flushBottom = otherAd.y + otherAd.height - h;

    if (topGap >= 0 && topGap <= pageH - h) yCandidates.add(topGap);
    if (bottomGap >= 0 && bottomGap <= pageH - h) yCandidates.add(bottomGap);
    if (flushTop >= 0 && flushTop <= pageH - h) yCandidates.add(flushTop);
    if (flushBottom >= 0 && flushBottom <= pageH - h) yCandidates.add(flushBottom);
  });

  // Dense step fallback anchors
  for (let sx = 0; sx <= pageW - w; sx += 10) {
    xCandidates.add(sx);
  }
  for (let sy = 0; sy <= pageH - h; sy += 10) {
    yCandidates.add(sy);
  }

  const xArr = Array.from(xCandidates);
  const yArr = Array.from(yCandidates);

  let bestX = null;
  let bestY = null;
  let minDistance = Infinity;

  // Evaluate candidate combinations using Euclidean proximity-based search to (preferredX, preferredY)
  // This satisfies the request to place "on top of bottom ad" or "beside that ad" right near the target location!
  for (const xVal of xArr) {
    for (const yVal of yArr) {
      if (xVal < 0 || (xVal + w) > pageW || yVal < 0 || (yVal + h) > pageH) continue;

      const isBlocked = checkCollision(pageId, excludeAdId, xVal, yVal, w, h);
      if (!isBlocked) {
        const dx = xVal - preferredX;
        const dy = yVal - preferredY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < minDistance) {
          minDistance = distance;
          bestX = xVal;
          bestY = yVal;
        }
      }
    }
  }

  if (bestX !== null && bestY !== null) {
    return { x: bestX, y: bestY };
  }

  // Backup step scan search at 5mm increments
  minDistance = Infinity;
  for (let ty = 0; ty <= pageH - h; ty += 5) {
    for (let tx = 0; tx <= pageW - w; tx += 5) {
      if (!checkCollision(pageId, excludeAdId, tx, ty, w, h)) {
        const dx = tx - preferredX;
        const dy = ty - preferredY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < minDistance) {
          minDistance = distance;
          bestX = tx;
          bestY = ty;
        }
      }
    }
  }

  if (bestX !== null && bestY !== null) {
    return { x: bestX, y: bestY };
  }

  return null;
}

// =========================================================================
// CREATE / EDIT AD FORM MODAL IMPLEMENTATION
// =========================================================================

// Visual click empty space setup suggestion handler
// Trigger modal placement right at coordinate pointers on double click/touch
function setupPageEmptyClickListener() {
  const canvas = document.getElementById('editor-page-canvas');
  if (!canvas) return;

  function handleDoubleGesture(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mmPx = BASE_DPI * state.zoom;

    // Retrieve pixel drop point
    const dxPx = clientX - rect.left;
    const dyPx = clientY - rect.top;

    // Map pixel drop to physical millimeters location
    let dropXmm = Math.round(dxPx / mmPx);
    let dropYmm = Math.round(dyPx / mmPx);

    triggerEmptySpaceClickForm(dropXmm, dropYmm);
  }

  // 1. Desktop double click
  canvas.addEventListener('dblclick', (e) => {
    // Assure we clicked empty grid, and NOT an ad box or resize handle
    if (e.target !== canvas) return;
    handleDoubleGesture(e.clientX, e.clientY);
  });

  // 2. Mobile / Tablet double touch (double tap) detection
  let lastTapTime = 0;
  canvas.addEventListener('touchend', (e) => {
    if (e.target !== canvas) return;

    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;

    if (tapLength < 350 && tapLength > 0) {
      e.preventDefault();
      // Target first changed touch coordinate
      const touch = e.changedTouches[0] || e.touches[0];
      if (touch) {
        handleDoubleGesture(touch.clientX, touch.clientY);
      }
    }
    lastTapTime = currentTime;
  });
}

function triggerEmptySpaceClickForm(mmX, mmY) {
  // Clear config ids for pristine create
  document.getElementById('form-ad-id').value = '';
  document.getElementById('ad-form-title').textContent = "CREATE NEW AD BOX DUMMY";
  document.getElementById('btn-submit-form').textContent = "Insert Dummy Box";

  // Fit placement default standard size inside boundaries mapping
  let defaultW = 100;
  let defaultH = 80;

  const activePage = state.pages.find(p => p.id === state.activePageId);
  const pageW = activePage ? (activePage.width || 329) : 329;
  const pageH = activePage ? (activePage.height || 525) : 525;

  // If called from top header button (passing 15, 15), automatically find bottom-most empty space!
  if (mmX === 15 && mmY === 15) {
    const freeSpace = autoFindAvailableSpace(state.activePageId, defaultW, defaultH, null, pageW / 2, pageH - defaultH);
    if (freeSpace) {
      mmX = freeSpace.x;
      mmY = freeSpace.y;
    } else {
      mmX = Math.round((pageW - defaultW) / 2);
      mmY = pageH - defaultH;
    }
  } else {
    // Assure boundaries bounds logic doesn't drop off board
    mmX = Math.max(0, Math.min(pageW - defaultW, mmX));
    mmY = Math.max(0, Math.min(pageH - defaultH, mmY));
  }

  // Pre-load default values inside modal input fields
  document.getElementById('form-ad-x').value = mmX;
  document.getElementById('form-ad-y').value = mmY;
  document.getElementById('form-width-mm').value = defaultW;
  document.getElementById('form-height-mm').value = defaultH;
  document.getElementById('form-client-name').value = '';
  const revenueInput = document.getElementById('form-ad-revenue');
  if (revenueInput) revenueInput.value = '';
  
  const customInput = document.getElementById('form-custom-category');
  if (customInput) customInput.value = '';

  const tentativeCheck = document.getElementById('form-is-tentative');
  if (tentativeCheck) tentativeCheck.checked = false;

  // Standard category
  selectCategoryThemeRadio('retail');

  // Display configurations modal form
  const modal = document.getElementById('ad-form-modal');
  modal.classList.remove('hidden');
  document.getElementById('form-client-name').focus();
}

// Load configurations update dialogue popup
function loadFormAdConfigure(adId) {
  const page = state.pages.find(p => p.id === state.activePageId);
  const ad = page ? page.ads.find(a => a.id === adId) : null;
  if (!ad) return;

  document.getElementById('form-ad-id').value = ad.id;
  document.getElementById('form-ad-x').value = ad.x;
  document.getElementById('form-ad-y').value = ad.y;
  
  document.getElementById('form-client-name').value = ad.client;
  document.getElementById('form-width-mm').value = ad.width;
  document.getElementById('form-height-mm').value = ad.height;
  const revenueInput2 = document.getElementById('form-ad-revenue');
  if (revenueInput2) {
    revenueInput2.value = ad.revenue !== undefined ? ad.revenue : 0;
  }
  const customInput2 = document.getElementById('form-custom-category');
  if (customInput2) customInput2.value = ad.customCategoryName || '';

  const tentativeCheck2 = document.getElementById('form-is-tentative');
  if (tentativeCheck2) tentativeCheck2.checked = ad.isTentative || false;

  // Set category selector radio visually up to match
  selectCategoryThemeRadio(ad.category || 'retail');

  // Change UI Title label
  document.getElementById('ad-form-title').textContent = `CONFIGURE AD: ${ad.client.toUpperCase()}`;
  document.getElementById('btn-submit-form').textContent = "Save Changes";

  const modal = document.getElementById('ad-form-modal');
  modal.classList.remove('hidden');
}

// Helpers category highlight radios selector
function selectCategoryThemeRadio(catVal) {
  const customContainer = document.getElementById('custom-category-container');
  if (customContainer) {
    if (catVal === 'special') {
      customContainer.classList.remove('hidden');
    } else {
      customContainer.classList.add('hidden');
    }
  }

  const rGroup = document.querySelectorAll('input[name="form-cat"]');
  rGroup.forEach(radio => {
    const isMatched = radio.value === catVal;
    radio.checked = isMatched;
    
    // Style adjustments
    const containerLabel = radio.closest('label');
    if (containerLabel) {
      if (isMatched) {
        containerLabel.className = "flex flex-col items-center gap-1.5 p-2 rounded border border-blue-500 bg-blue-50 text-blue-700 cursor-pointer text-center select-none shadow shadow-blue-500/10 font-semibold";
      } else {
        containerLabel.className = "flex flex-col items-center gap-1.5 p-2 rounded border border-slate-200 bg-slate-50 text-slate-500 cursor-pointer text-center select-none hover:bg-slate-100 transition-colors";
      }
    }
  });
}

// Intercept Modal submit event handler
function handleFormAdSubmission(e) {
  e.preventDefault();

  const adId = document.getElementById('form-ad-id').value;
  const clientName = document.getElementById('form-client-name').value.trim() || "Anonymous Advertiser";
  const reqW = parseInt(document.getElementById('form-width-mm').value, 10);
  const reqH = parseInt(document.getElementById('form-height-mm').value, 10);
  const mmX = parseInt(document.getElementById('form-ad-x').value, 10);
  const mmY = parseInt(document.getElementById('form-ad-y').value, 10);
  const revenueInput3 = document.getElementById('form-ad-revenue');
  const revenueVal = revenueInput3 ? (parseFloat(revenueInput3.value) || 0) : 0;
  
  const selectedRadio = document.querySelector('input[name="form-cat"]:checked');
  const catTheme = selectedRadio ? selectedRadio.value : 'retail';
  const customCatInput = document.getElementById('form-custom-category');
  const customCategoryName = customCatInput ? customCatInput.value.trim() : '';

  const tentativeCheck = document.getElementById('form-is-tentative');
  const isTentative = tentativeCheck ? tentativeCheck.checked : false;

  const page = state.pages.find(p => p.id === state.activePageId);
  if (!page) return;

  const pageW = page.width || 329;
  const pageH = page.height || 525;

  // Bounds checks validation
  if (reqW < MIN_AD_SIZE_MM || reqW > pageW) {
    showToast(`Ad Width must be between ${MIN_AD_SIZE_MM}mm and ${pageW}mm`, "error");
    return;
  }
  if (reqH < MIN_AD_SIZE_MM || reqH > pageH) {
    showToast(`Ad Height must be between ${MIN_AD_SIZE_MM}mm and ${pageH}mm`, "error");
    return;
  }

  // Adjust/clamp candidates spatial offsets to align with board dimensions securely
  const placementX = Math.max(0, Math.min(pageW - reqW, mmX));
  const placementY = Math.max(0, Math.min(pageH - reqH, mmY));

  // Automatically find the position of the advertisement:
  // - If the chosen coordinates fit perfectly without collision (both for brand-new and edited ads), KEEP them!
  // - If they collide, search for the nearest available non-colliding spot (e.g. above/beside colliding bottom ads)
  let placementXFinal = placementX;
  let placementYFinal = placementY;

  const isCollision = checkCollision(state.activePageId, adId || null, placementX, placementY, reqW, reqH);
  if (!isCollision) {
    // Keep target coordinates exactly where clicked/configured
    placementXFinal = placementX;
    placementYFinal = placementY;
  } else {
    // Spot is blocked, find nearest available spot
    const freeSpaceAnywhere = autoFindAvailableSpace(state.activePageId, reqW, reqH, adId || null, placementX, placementY);
    if (freeSpaceAnywhere) {
      placementXFinal = freeSpaceAnywhere.x;
      placementYFinal = freeSpaceAnywhere.y;
      showToast(`Position adjusted to the closest non-overlapping space`, "success");
    } else {
      showToast("Layout collision conflict! No empty space (with 3mm gap) fits this ad size on page.", "error");
      return;
    }
  }

  if (adId) {
    // MODE: Configure updates
    const adObj = page.ads.find(a => a.id === adId);
    if (adObj) {
      adObj.client = clientName;
      adObj.width = reqW;
      adObj.height = reqH;
      adObj.x = placementXFinal;
      adObj.y = placementYFinal;
      adObj.category = catTheme;
      adObj.customCategoryName = customCategoryName;
      adObj.revenue = revenueVal;
      adObj.isTentative = isTentative;
      
      commitHistory();
      showToast(`Ad "${clientName}" updated successfully`, "success");
    }
  } else {
    // MODE: Create new box
    const newAd = {
      id: "ad-" + Date.now(),
      client: clientName,
      x: placementXFinal,
      y: placementYFinal,
      width: reqW,
      height: reqH,
      category: catTheme,
      customCategoryName: customCategoryName,
      revenue: revenueVal,
      isTentative: isTentative
    };

    page.ads.push(newAd);
    commitHistory();
    showToast(`Ad "${clientName}" scheduled successfully`, "success");
  }

  // Close dialogues
  closeFormModalAd();
  renderActiveEditorBoard();
}

function closeFormModalAd() {
  const modal = document.getElementById('ad-form-modal');
  modal.classList.add('hidden');
}

// Delete ad container permanently
function deleteAdFromPage(adId) {
  const page = state.pages.find(p => p.id === state.activePageId);
  if (!page) return;

  const ad = page.ads.find(a => a.id === adId);
  if (!ad) return;

  page.ads = page.ads.filter(a => a.id !== adId);
  commitHistory();
  renderActiveEditorBoard();
  showToast(`Ad "${ad.client}" deleted`, "success");
}

// Duplicate Ad (Shifted placement lookup search using auto placement)
function duplicateAdOnActivePage(adId) {
  const page = state.pages.find(p => p.id === state.activePageId);
  if (!page) return;

  const target = page.ads.find(a => a.id === adId);
  if (!target) return;

  // Search for the nearest vacant space with 3mm safety gap
  const freeSpace = autoFindAvailableSpace(state.activePageId, target.width, target.height, null, target.x + 12, target.y + 12);
  
  if (!freeSpace) {
    showToast("No layout space found to duplicate ad with 3mm safety gap.", "error");
    return;
  }

  const dupAd = {
    id: "ad-" + Date.now() + "-dup",
    client: `${target.client} (Copy)`,
    x: freeSpace.x,
    y: freeSpace.y,
    width: target.width,
    height: target.height,
    category: target.category || 'retail'
  };

  page.ads.push(dupAd);
  commitHistory();
  renderActiveEditorBoard();
  showToast(`Duplicated scheduled ad layout: "${target.client}"`, "success");
}

// =========================================================================
// RIGHT CLICK CONTEXT DIALOG ENGINE
// =========================================================================

function closeContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu) {
    menu.classList.add('hidden');
  }
  if (window._activeCloseContextMenuRoutine) {
    window.removeEventListener('click', window._activeCloseContextMenuRoutine);
    window.removeEventListener('touchstart', window._activeCloseContextMenuRoutine);
    window._activeCloseContextMenuRoutine = null;
  }
}

function showContextMenuAt(adId, clientX, clientY) {
  closeContextMenu();

  contextTargetAdId = adId;

  // Show customized context elements
  const menu = document.getElementById('context-menu');
  if (!menu) return;

  // Keep inside viewport bounds safely on smaller / mobile screens
  const menuWidth = 176; // w-44 is 11rem = 176px
  const menuHeight = 120; // approximate height for context menu
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let posX = clientX;
  let posY = clientY;

  if (posX + menuWidth > viewportWidth) {
    posX = viewportWidth - menuWidth - 8;
  }
  if (posY + menuHeight > viewportHeight) {
    posY = viewportHeight - menuHeight - 8;
  }

  menu.style.left = `${Math.max(8, posX)}px`;
  menu.style.top = `${Math.max(8, posY)}px`;
  menu.classList.remove('hidden');

  // Auto close context on outer window click / touch
  const closeRoutine = (e) => {
    if (e && e.target && menu.contains(e.target)) {
      return;
    }
    closeContextMenu();
  };
  
  window._activeCloseContextMenuRoutine = closeRoutine;

  // Timeout ensures instant clicks/touches don't double toggle
  setTimeout(() => {
    if (window._activeCloseContextMenuRoutine === closeRoutine) {
      window.addEventListener('click', closeRoutine);
      window.addEventListener('touchstart', closeRoutine);
    }
  }, 100);
}

function triggerContextAdBoxClick(e) {
  e.preventDefault();
  
  const box = e.target.closest('.ad-box');
  if (!box) return;

  const adId = box.getAttribute('data-ad-id');
  showContextMenuAt(adId, e.clientX, e.clientY);
}

// Bind Context Event Hooks
function setupContextHandlers() {
  const ctxEdit = document.getElementById('ctx-edit');
  const ctxDuplicate = document.getElementById('ctx-duplicate');
  const ctxDelete = document.getElementById('ctx-delete');

  if (ctxEdit) {
    ctxEdit.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (contextTargetAdId) loadFormAdConfigure(contextTargetAdId);
    });
    ctxEdit.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (contextTargetAdId) loadFormAdConfigure(contextTargetAdId);
    }, { passive: true });
  }

  if (ctxDuplicate) {
    ctxDuplicate.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (contextTargetAdId) duplicateAdOnActivePage(contextTargetAdId);
    });
    ctxDuplicate.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (contextTargetAdId) duplicateAdOnActivePage(contextTargetAdId);
    }, { passive: true });
  }

  const ctxSwap = document.getElementById('ctx-swap');
  if (ctxSwap) {
    ctxSwap.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (contextTargetAdId) triggerDirectSwap(contextTargetAdId);
    });
    ctxSwap.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (contextTargetAdId) triggerDirectSwap(contextTargetAdId);
    }, { passive: true });
  }

  if (ctxDelete) {
    ctxDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (contextTargetAdId) deleteAdFromPage(contextTargetAdId);
    });
    ctxDelete.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      closeContextMenu();
      if (contextTargetAdId) deleteAdFromPage(contextTargetAdId);
    }, { passive: true });
  }
}

// =========================================================================
// SYSTEM EVENTS LISTENERS CONFIGURATIONS
// =========================================================================

function setupEventListeners() {
  // Add broad sheet page buttons
  const btnAddPage = document.getElementById('btn-add-page');
  if (btnAddPage) btnAddPage.addEventListener('click', addNewBroadSheetPage);

  const btnEmptyAddPage = document.getElementById('btn-empty-add-page');
  if (btnEmptyAddPage) btnEmptyAddPage.addEventListener('click', addNewBroadSheetPage);

  // Global Undo/Redo button binds
  const btnUndoMain = document.getElementById('btn-undo-main');
  const btnRedoMain = document.getElementById('btn-redo-main');
  if (btnUndoMain) btnUndoMain.addEventListener('click', triggerUndo);
  if (btnRedoMain) btnRedoMain.addEventListener('click', triggerRedo);

  const btnUndoEditor = document.getElementById('btn-undo-editor');
  const btnRedoEditor = document.getElementById('btn-redo-editor');
  if (btnUndoEditor) btnUndoEditor.addEventListener('click', triggerUndo);
  if (btnRedoEditor) btnRedoEditor.addEventListener('click', triggerRedo);

  // Key combination binds (Ctrl+Z / Ctrl+Y / Ctrl+N / Ctrl+S / Esc)
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        triggerUndo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        triggerRedo();
      } else if (e.key === 'n' || e.key === 'N') {
        // Trigger empty space form only if editor modal is active
        if (state.activePageId) {
          const adFormModal = document.getElementById('ad-form-modal');
          if (adFormModal && adFormModal.classList.contains('hidden')) {
            e.preventDefault();
            triggerEmptySpaceClickForm(15, 15);
          }
        }
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        saveToLocalStorage();
      }
    } else if (e.key === 'Escape' || e.key === 'Esc') {
      const generalDialog = document.getElementById('general-dialog-modal');
      const confirmModal = document.getElementById('confirm-modal');
      const pageSettingsModal = document.getElementById('page-settings-modal');
      const adFormModal = document.getElementById('ad-form-modal');
      const contextMenu = document.getElementById('context-menu');
      const editorModal = document.getElementById('editor-modal');

      if (generalDialog && !generalDialog.classList.contains('hidden')) {
        const cancelBtn = document.getElementById('btn-dialog-cancel');
        if (cancelBtn) {
          e.preventDefault();
          cancelBtn.click();
        }
      } else if (confirmModal && !confirmModal.classList.contains('hidden')) {
        const cancelBtn = document.getElementById('btn-confirm-cancel');
        if (cancelBtn) {
          e.preventDefault();
          cancelBtn.click();
        }
      } else if (pageSettingsModal && !pageSettingsModal.classList.contains('hidden')) {
        e.preventDefault();
        closePageSettings();
      } else if (adFormModal && !adFormModal.classList.contains('hidden')) {
        e.preventDefault();
        closeFormModalAd();
      } else if (contextMenu && !contextMenu.classList.contains('hidden')) {
        e.preventDefault();
        closeContextMenu();
      } else if (editorModal && !editorModal.classList.contains('hidden')) {
        e.preventDefault();
        closePageEditor();
      }
    }
  });

  // Save triggers Binds
  const selectorActiveLayout = document.getElementById('selector-active-layout');
  if (selectorActiveLayout) {
    selectorActiveLayout.addEventListener('change', (e) => {
      switchActiveLayout(e.target.value);
    });
  }

  const btnNewLayout = document.getElementById('btn-new-layout');
  if (btnNewLayout) {
    btnNewLayout.addEventListener('click', createNewLayoutPrompt);
  }

  const btnRenameLayout = document.getElementById('btn-rename-layout');
  if (btnRenameLayout) {
    btnRenameLayout.addEventListener('click', renameActiveLayoutPrompt);
  }

  const btnDuplicateLayout = document.getElementById('btn-duplicate-layout');
  if (btnDuplicateLayout) {
    btnDuplicateLayout.addEventListener('click', duplicateActiveLayoutPrompt);
  }

  const btnDeleteLayout = document.getElementById('btn-delete-layout');
  if (btnDeleteLayout) {
    btnDeleteLayout.addEventListener('click', deleteActiveLayoutConfirm);
  }

  const btnSaveMain = document.getElementById('btn-save-main');
  if (btnSaveMain) btnSaveMain.addEventListener('click', saveToLocalStorage);

  const btnSaveEditor = document.getElementById('btn-save-editor');
  if (btnSaveEditor) btnSaveEditor.addEventListener('click', saveToLocalStorage);

  // Full-screen Modal control panels exit
  const btnCloseEditor = document.getElementById('btn-close-editor');
  const btnCloseEditorArrow = document.getElementById('btn-close-editor-arrow');
  if (btnCloseEditor) btnCloseEditor.addEventListener('click', closePageEditor);
  if (btnCloseEditorArrow) btnCloseEditorArrow.addEventListener('click', closePageEditor);

  // Reset entire planning workspace
  const btnResetMain = document.getElementById('btn-reset-main');
  if (btnResetMain) btnResetMain.addEventListener('click', triggerResetAll);

  // Zoom bindings
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => adjustZoom(0.1));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => adjustZoom(-0.1));
  if (btnZoomFit) btnZoomFit.addEventListener('click', autoFitEditorCanvas);

  // Sync zoom during browser window scales
  window.addEventListener('resize', () => {
    if (state.activePageId) autoFitEditorCanvas();
  });

  // Create Ad Box on Modal forms Triggers
  const btnAddAd = document.getElementById('btn-add-ad');
  if (btnAddAd) btnAddAd.addEventListener('click', () => triggerEmptySpaceClickForm(15, 15));

  // Visual grid clicks listens (click empty grids suggest drop coordinates)
  setupPageEmptyClickListener();

  // Setup contextual click elements events
  setupContextHandlers();

  // Dialog modals Form handlers
  const btnCancelForm = document.getElementById('btn-cancel-form');
  const btnCloseForm = document.getElementById('btn-close-form');
  if (btnCancelForm) btnCancelForm.addEventListener('click', closeFormModalAd);
  if (btnCloseForm) btnCloseForm.addEventListener('click', closeFormModalAd);

  const formElement = document.getElementById('ad-modal-form');
  if (formElement) formElement.addEventListener('submit', handleFormAdSubmission);

  // Dynamic style updates to the visual category form theme buttons on click
  const categoryLabels = document.querySelectorAll('#category-selector-container label');
  categoryLabels.forEach(label => {
    label.addEventListener('click', () => {
      const radio = label.querySelector('input[type="radio"]');
      if (radio) {
        selectCategoryThemeRadio(radio.value);
      }
    });
  });

  // PDF Compilation Report Trigger
  const btnExportPdf = document.getElementById('btn-export-pdf');
  if (btnExportPdf) btnExportPdf.addEventListener('click', triggerPageReportPDFExport);

  // Page Settings Modals Triggers
  const btnPageSettingsHeader = document.getElementById('btn-page-settings-header');
  if (btnPageSettingsHeader) {
    btnPageSettingsHeader.addEventListener('click', () => openPageSettings());
  }

  const btnSidebarEditComments = document.getElementById('btn-sidebar-edit-comments');
  if (btnSidebarEditComments) {
    btnSidebarEditComments.addEventListener('click', () => openPageSettings());
  }

  const btnClosePageSettings = document.getElementById('btn-close-page-settings');
  if (btnClosePageSettings) {
    btnClosePageSettings.addEventListener('click', closePageSettings);
  }

  const btnCancelPageSettings = document.getElementById('btn-cancel-page-settings');
  if (btnCancelPageSettings) {
    btnCancelPageSettings.addEventListener('click', closePageSettings);
  }

  const pageSettingsForm = document.getElementById('page-settings-form');
  if (pageSettingsForm) {
    pageSettingsForm.addEventListener('submit', handlePageSettingsFormSubmit);
  }
}

// =========================================================================
// PDF EXPORT COMPILATION GENERATORS
// =========================================================================

function getFormattedLayoutDate(dateStr) {
  if (!dateStr) return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
  } catch (e) {
    // fallback
  }
  return dateStr;
}

async function triggerPageReportPDFExport() {
  if (state.pages.length === 0) {
    showToast("Error: No planned layout pages exist to export.", "error");
    return;
  }

  showToast("Compiling Landscape A4 PDF Report...", "info");

  const savedStyleElements = [];

  try {
    // Temporarily detach style elements and non-font stylesheets to bypass html2canvas oklch parsing failure
    const styleElements = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).filter(el => {
      const href = el.getAttribute('href') || '';
      if (href.includes('fonts.googleapis') || href.includes('fonts.gstatic')) {
        return false; // Keep Google Fonts styles attached so they render correctly in html2canvas
      }
      return true;
    });
    styleElements.forEach(el => {
      const parent = el.parentNode;
      const nextSibling = el.nextSibling;
      savedStyleElements.push({ el, parent, nextSibling });
      el.remove();
    });

    // Horizontal A4 Landscape dimensions [297, 210] mm
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const exportRoot = document.getElementById('export-invisible-host');
    exportRoot.innerHTML = ''; // Fresh clean

    const activeL = state.layouts.find(l => l.id === state.activeLayoutId);
    const currentLayout = activeL;
    const layoutDateFormatted = getFormattedLayoutDate(activeL?.date);
    const layoutDateFormattedVal = layoutDateFormatted;
    const centersFormatted = escapeHtml(activeL?.centers || '');

    const totalPageAreaMm2Pdf = state.pages.reduce((acc, p) => acc + (p.width || 329) * (p.height || 525), 0);
    const totalVolumeSqcmPdf = totalPageAreaMm2Pdf / 100;

    // Calculate overall stats for bottom block summary
    let sumTotalAdAreaMm2 = 0;
    let sumTotalPageAreaMm2 = 0;
    let sumTotalRevenue = 0;

    state.pages.forEach(p => {
      const pageW = p.width || 329;
      const pageH = p.height || 525;
      sumTotalPageAreaMm2 += pageW * pageH;
      p.ads.forEach(ad => {
        sumTotalAdAreaMm2 += ad.width * ad.height;
        sumTotalRevenue += Number(ad.revenue || 0);
      });
    });

    const sumTotalAdVolumeSqcm = sumTotalAdAreaMm2 / 100;
    const sumTotalEditVolumeSqcm = (sumTotalPageAreaMm2 - sumTotalAdAreaMm2) / 100;

    // Gather all tabular rows first so we know how many tabular pages there will be!
    const tableRows = [];
    state.pages.forEach(page => {
      const pagePosition = page.position || (page.pageNumber % 2 === 0 ? "LEFT" : "RIGHT");
      tableRows.push(`
        <tr style="background-color: #eff6ff; border-bottom: 1.5px solid #cbd5e1;">
          <td colspan="6" style="padding: 4px 10px; color: #dc2626; font-weight: 700; font-family: 'Space Grotesk', sans-serif; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px;">
            PAGE - ${page.pageNumber} (${pagePosition})
          </td>
        </tr>
      `);

      if (page.ads.length === 0) {
        tableRows.push(`
          <tr style="border-bottom: 1.5px solid #cbd5e1; background-color: #ffffff;">
            <td style="padding: 4px 10px; text-align: center; color: #94a3b8; border-right: 1px solid #cbd5e1; font-family: 'Inter', sans-serif; font-weight: bold; font-size: 9px;">
              -
            </td>
            <td colspan="5" style="padding: 4px 10px; font-style: italic; color: #94a3b8; text-align: center; font-family: 'Inter', sans-serif; font-size: 9px;">No Advertisements scheduled on this page</td>
          </tr>
        `);
      } else {
        page.ads.forEach((ad, idx) => {
          let categoryLabel = 'Retail';
          if (ad.category === 'classified') categoryLabel = 'Health Care';
          if (ad.category === 'editorial') categoryLabel = 'Real Estate';
          if (ad.category === 'political') categoryLabel = 'Education';
          if (ad.category === 'finance') categoryLabel = 'B2B';
          if (ad.category === 'special') categoryLabel = ad.customCategoryName || 'Others';

          const singleAdVolume = (ad.width * ad.height) / 100;
          const adRevenueDisplay = ad.revenue ? `${ad.revenue.toLocaleString()}` : '0';

          const rowBgColor = ad.isTentative ? '#fef2f2' : '#ffffff';
          const nameLabelHtml = ad.isTentative
            ? `${escapeHtml(ad.client)} <span style="font-family: 'Space Grotesk', 'Inter', sans-serif; font-size: 6.5px; font-weight: bold; color: #dc2626; border: 0.35px solid #fca5a5; background-color: #fee2e2; padding: 1px 3px; border-radius: 2px; margin-left: 4px; display: inline-block; vertical-align: middle;">TENTATIVE</span>`
            : escapeHtml(ad.client);

          tableRows.push(`
            <tr style="border-bottom: 1px solid #cbd5e1; background-color: ${rowBgColor};">
              <td style="padding: 4px 10px; text-align: center; color: #0f172a; font-weight: bold; border-right: 1px solid #cbd5e1; font-family: 'JetBrains Mono', monospace; font-size: 9px;">
                ${idx + 1}
              </td>
              <td style="padding: 4px 10px; border-right: 1px solid #cbd5e1; font-weight: 600; color: #0f172a; font-size: 9px; font-family: 'Inter', sans-serif;">
                ${nameLabelHtml}
              </td>
              <td style="padding: 4px 10px; border-right: 1px solid #cbd5e1; text-align: center; font-family: 'JetBrains Mono', monospace; font-weight: 500; color: #334155; font-size: 8.5px;">
                ${ad.width} x ${ad.height} mm
              </td>
              <td style="padding: 4px 10px; border-right: 1px solid #cbd5e1; text-align: center; font-family: 'JetBrains Mono', monospace; font-weight: bold; color: #1e40af; font-size: 8.5px;">
                ${singleAdVolume.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Sqcm
              </td>
              <td style="padding: 4px 10px; border-right: 1px solid #cbd5e1; text-align: center; font-family: 'JetBrains Mono', monospace; font-weight: bold; color: #15803d; font-size: 8.5px;">
                ${adRevenueDisplay}
              </td>
              <td style="padding: 4px 10px; text-align: center; color: #475569; font-weight: 500; font-family: 'Inter', sans-serif; font-size: 8.5px;">
                ${categoryLabel}
              </td>
            </tr>
          `);
        });
      }
    });

    const totalOverviewSheets = Math.ceil(state.pages.length / 14);
    
    // Calculate tabularPages list using our new smart chunking algorithm to optimize page space usage
    const tabularPages = [];
    let tempRows = [...tableRows];
    while (tempRows.length > 0) {
      if (tempRows.length <= 18) {
        tabularPages.push(tempRows.splice(0, tempRows.length));
      } else if (tempRows.length >= 19 && tempRows.length <= 22) {
        const half = Math.ceil(tempRows.length / 2);
        tabularPages.push(tempRows.splice(0, half));
      } else {
        tabularPages.push(tempRows.splice(0, 22));
      }
    }
    const totalTabularSheets = tabularPages.length;
    const totalPdfSheets = totalOverviewSheets + totalTabularSheets;

    const maxThumbH = Math.max(...state.pages.map(p => {
      const pageW = p.width || 329;
      const pageH = p.height || 525;
      return Math.round(90 * (pageH / pageW));
    }));

    let isFirstPage = true;

    // 1. RENDER PAGE(S) FOR OVERVIEW (GRAPHICAL FLATPLAN)
    for (let sheetIdx = 0; sheetIdx < totalOverviewSheets; sheetIdx++) {
      const startIdx = sheetIdx * 14;
      const endIdx = Math.min(startIdx + 14, state.pages.length);
      const pagesSlice = state.pages.slice(startIdx, endIdx);

      const overviewEl = document.createElement('div');
      overviewEl.style.width = '891px';     // 297mm * 3px
      overviewEl.style.height = '630px';    // 210mm * 3px
      overviewEl.style.backgroundColor = '#ffffff';
      overviewEl.style.border = '1px solid #cbd5e1';
      overviewEl.style.boxSizing = 'border-box';
      overviewEl.style.position = 'relative';
      overviewEl.style.padding = '20px 32px 14px 32px';
      overviewEl.style.display = 'flex';
      overviewEl.style.flexDirection = 'column';
      overviewEl.style.justifyContent = 'flex-start';

      const sheetNum = sheetIdx + 1;
      let sheetTitleSuffix = totalOverviewSheets > 1 ? ` (Page ${sheetNum} of ${totalOverviewSheets})` : '';

      let overviewHtml = `
        <!-- Title Header Block -->
        <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px; width: 100%; display: flex; justify-content: space-between; align-items: flex-end; font-family: 'Space Grotesk', 'Inter', sans-serif;">
          <div>
            <h1 style="font-size: 19px; font-weight: 700; text-transform: uppercase; margin: 0; color: #0f172a; letter-spacing: -0.5px; font-family: 'Space Grotesk', sans-serif;"><span style="color: #ea580c;">${escapeHtml(activeL?.name || 'Default Layout')}</span> DUMMY LAYOUT${sheetTitleSuffix}</h1>
            <div style="margin-top: 4px; display: flex; align-items: center; gap: 8px; font-family: 'Inter', sans-serif;">
              <span style="font-size: 10px; color: #4f46e5; background-color: #f5f3ff; border: 1px solid #ddd6fe; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: 0.3px;">ISSUE DATE: <span style="color: #312e81;">${layoutDateFormatted}</span></span>
              ${centersFormatted ? `<span style="font-size: 10px; color: #7c3aed; background-color: #faf5ff; border: 1px solid #f3e8ff; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: 0.3px;">CENTERS: <span style="color: #581c87;">${centersFormatted}</span></span>` : ''}
            </div>
          </div>
          <div style="text-align: right; font-family: 'Inter', sans-serif; font-size: 9px; color: #64748b; line-height: 1.4;">
            <span style="font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; display: block; font-size: 8px; margin-bottom: 2px;">Response Art Planner</span>
            <strong>Printed:</strong> <span style="font-weight: 700; color: #0f172a;">${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          </div>
        </div>
        
        <!-- Stats Brief Panel -->
        <div style="display: flex; gap: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-family: 'Inter', sans-serif; font-size: 9px;">
          <div style="flex: 1; border-right: 1.5px solid #cbd5e1; padding-left: 2px;">
            <span style="color: #000000; font-size: 8.5px; text-transform: uppercase; display: block; font-weight: 700; font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif-condensed, sans-serif; font-stretch: condensed; letter-spacing: 0.2px;">Total Pagination Pages</span>
            <span style="font-size: 13px; font-weight: 700; color: #1e293b; font-family: 'Space Grotesk', sans-serif;">${state.pages.length} Pages</span>
          </div>
          <div style="flex: 1; border-right: 1.5px solid #cbd5e1;">
            <span style="color: #000000; font-size: 8.5px; text-transform: uppercase; display: block; font-weight: 700; font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif-condensed, sans-serif; font-stretch: condensed; letter-spacing: 0.2px;">Total Placed Advt</span>
            <span style="font-size: 13px; font-weight: 700; color: #16a34a; font-family: 'Space Grotesk', sans-serif;">${state.pages.reduce((acc, p) => acc + p.ads.length, 0)} Ads</span>
          </div>
          <div style="flex: 1; border-right: 1.5px solid #cbd5e1;">
            <span style="color: #000000; font-size: 8.5px; text-transform: uppercase; display: block; font-weight: 700; font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif-condensed, sans-serif; font-stretch: condensed; letter-spacing: 0.2px;">Average Fill Density</span>
            <span style="font-size: 13px; font-weight: 700; color: #2563eb; font-family: 'Space Grotesk', sans-serif;">
              ${state.pages.length > 0 ? Math.round(state.pages.reduce((acc, p) => acc + Number(calculatePageFillPercentage(p.id)), 0) / state.pages.length) : 0}% Filled
            </span>
          </div>
          <div style="flex: 1;">
            <span style="color: #000000; font-size: 8.5px; text-transform: uppercase; display: block; font-weight: 700; font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif-condensed, sans-serif; font-stretch: condensed; letter-spacing: 0.2px;">Total Page Space (Advt + Edit)</span>
            <span style="font-size: 13px; font-weight: 700; color: #ea580c; font-family: 'Space Grotesk', sans-serif;">${totalVolumeSqcmPdf.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} Sqcm</span>
          </div>
        </div>

        <!-- Thumbnails Flex List -->
        <div style="display: flex; flex-wrap: wrap; gap: 11px; flex-grow: 1; justify-content: flex-start; align-content: flex-start; overflow: hidden; width: 100%;">
      `;

      pagesSlice.forEach(page => {
        const pageW = page.width || 329;
        const pageH = page.height || 525;
        const thumbW = 90;
        const thumbH = Math.round(thumbW * (pageH / pageW));

        const scaleX = thumbW / pageW;
        const scaleY = thumbH / pageH;

        let colGuidelines = '';
        const colWidth8 = pageW / 8;
        for (let i = 1; i <= 7; i++) {
          const colX = i * colWidth8 * scaleX;
          colGuidelines += `<div style="position: absolute; top: 0; bottom: 0; left: ${colX}px; width: 0; border-left: 1px dashed rgba(0,0,0,0.06); z-index: 1;"></div>`;
        }

        let miniAds = '';
        page.ads.forEach(ad => {
          const adBg = ad.isTentative ? '#fee2e2' : '#f8fafc';
          const adBorder = ad.isTentative ? '0.4px solid rgba(239, 68, 68, 0.5)' : '0.4px solid rgba(0, 0, 0, 0.25)';
          const adTextColor = ad.isTentative ? '#991b1b' : '#1e293b';
          const nameLabel = ad.isTentative ? `${escapeHtml(ad.client)} [T]` : escapeHtml(ad.client);

          miniAds += `
            <div style="position: absolute; left: ${ad.x * scaleX}px; top: ${ad.y * scaleY}px; width: ${ad.width * scaleX}px; height: ${ad.height * scaleY}px; background-color: ${adBg}; border: ${adBorder}; border-radius: 0; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; align-items: center; overflow: hidden; padding: 2px; text-align: center; line-height: 1.15; z-index: 5;">
              <span style="font-family: 'Arial Narrow', 'sans-serif-condensed', ui-sans-serif, system-ui, sans-serif; font-size: 5.5px; font-weight: 500; color: ${adTextColor}; max-width: 100%; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${nameLabel}
              </span>
              <span style="font-family: ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', 'Roboto Mono', 'Oxygen Mono', 'Ubuntu Monospace', 'Source Code Pro', 'Fira Mono', 'Droid Sans Mono', 'Courier New', monospace; font-size: 4px; font-weight: 500; color: #64748b; display: block; margin-top: 1px; white-space: nowrap;">
                ${ad.width}x${ad.height}
              </span>
            </div>
          `;
        });

        const fillPercent = calculatePageFillPercentage(page.id);

        const pagePosition = page.position || (page.pageNumber % 2 === 0 ? "LEFT" : "RIGHT");
        const posColor = pagePosition === 'LEFT' ? '#4338ca' : '#7e22ce'; // indigo-700 / purple-700

        overviewHtml += `
          <div style="background-color: #fafbfb; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px 6px; display: flex; flex-direction: column; align-items: center; width: 108px; box-sizing: border-box;">
            <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
              <span style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 8.5px; font-weight: bold; color: #1e293b; display: block;">PAGE ${page.pageNumber}</span>
              <span style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 6.5px; font-weight: bold; color: ${posColor}; background-color: #f1f5f9; padding: 1px 3px; border-radius: 3px; border: 1px solid #e2e8f0;">${pagePosition}</span>
            </div>
            <span style="font-family: ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', 'Roboto Mono', 'Oxygen Mono', 'Ubuntu Monospace', 'Source Code Pro', 'Fira Mono', 'Droid Sans Mono', 'Courier New', monospace; font-size: 6.5px; color: #64748b; margin-bottom: 2px; font-weight: 500;">${pageW} &times; ${pageH} mm</span>
            
            <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; width: 100%; height: ${maxThumbH}px; margin-bottom: 4px; background: transparent;">
              <div style="position: relative; width: ${thumbW}px; height: ${thumbH}px; background-color: #ffffff; border: 0.4px solid rgba(0, 0, 0, 0.35); border-radius: 0; overflow: hidden; box-shadow: none;">
                ${colGuidelines}
                ${miniAds}
              </div>
            </div>
            
            <div style="width: 100%; display: flex; justify-content: space-between; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 7.5px; color: #475569; margin-top: 3px; box-sizing: border-box; line-height: 1;">
              <span>${page.ads.length} Advt</span>
              <span style="font-weight: bold; color: ${fillPercent > 70 ? '#e11d48' : fillPercent > 40 ? '#d97706' : '#2563eb'}">${fillPercent}%</span>
            </div>
          </div>
        `;
      });

      overviewHtml += `
        </div>

        <!-- Page Footer -->
        <div style="position: absolute; bottom: 12px; left: 32px; right: 32px; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 8.5px; color: #94a3b8; box-sizing: border-box;">
          <span>Draft Flatplan Index Matrix &bull; Horizontal A4 White Edition</span>
          <span>Page ${sheetNum} of ${totalPdfSheets}</span>
        </div>
      `;

      overviewEl.innerHTML = overviewHtml;
      exportRoot.innerHTML = ''; // Fresh clean
      exportRoot.appendChild(overviewEl);

      const oCanvas = await html2canvas(overviewEl, { scale: 2 });
      const overviewImgData = oCanvas.toDataURL('image/jpeg', 0.98);

      if (isFirstPage) {
        isFirstPage = false;
      } else {
        doc.addPage();
      }
      doc.addImage(overviewImgData, 'JPEG', 0, 0, 297, 210);
    }

    // 2. RENDER PAGES FOR TABULAR INDEX
    for (let tabIdx = 0; tabIdx < totalTabularSheets; tabIdx++) {
      const rowsSlice = tabularPages[tabIdx];

      const detailsEl = document.createElement('div');
      detailsEl.style.width = '891px';     // 297mm * 3px
      detailsEl.style.height = '630px';    // 210mm * 3px
      detailsEl.style.backgroundColor = '#ffffff';
      detailsEl.style.border = '1px solid #cbd5e1';
      detailsEl.style.boxSizing = 'border-box';
      detailsEl.style.position = 'relative';
      detailsEl.style.padding = '24px 32px 14px 32px';
      detailsEl.style.display = 'flex';
      detailsEl.style.flexDirection = 'column';
      detailsEl.style.justifyContent = 'flex-start';

      const sheetNum = totalOverviewSheets + tabIdx + 1;
      let tabTitleSuffix = totalTabularSheets > 1 ? ` (Part ${tabIdx + 1} of ${totalTabularSheets})` : '';

      let detailsHtml = `
        <!-- Title Header Block -->
        <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px; width: 100%; display: flex; justify-content: space-between; align-items: flex-end; font-family: 'Space Grotesk', 'Inter', sans-serif;">
          <div>
            <h1 style="font-size: 17px; font-weight: 700; text-transform: uppercase; margin: 0; color: #0f172a; letter-spacing: -0.5px; font-family: 'Space Grotesk', sans-serif;"><span style="color: #ea580c;">${escapeHtml(currentLayout?.name || 'Default Layout')}</span> DUMMY LAYOUT AD INDEX${tabTitleSuffix}</h1>
            <div style="margin-top: 4px; display: flex; align-items: center; gap: 8px; font-family: 'Inter', sans-serif;">
              <span style="font-size: 10px; color: #4f46e5; background-color: #f5f3ff; border: 1px solid #ddd6fe; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: 0.3px;">ISSUE DATE: <span style="color: #312e81;">${layoutDateFormattedVal}</span></span>
              ${centersFormatted ? `<span style="font-size: 10px; color: #7c3aed; background-color: #faf5ff; border: 1px solid #f3e8ff; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: 0.3px;">CENTERS: <span style="color: #581c87;">${centersFormatted}</span></span>` : ''}
            </div>
          </div>
          <div style="text-align: right; font-family: 'Inter', sans-serif; font-size: 9px; color: #64748b; line-height: 1.4;">
            <span style="font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; display: block; font-size: 8px; margin-bottom: 2px;">Response Art Planner</span>
            <strong>Printed:</strong> <span style="font-weight: 700; color: #0f172a;">${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          </div>
        </div>

        <!-- Schedule Table list -->
        <div style="flex-grow: 1; overflow-y: auto; padding-right: 5px; width: 100%;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-family: 'Inter', sans-serif; font-size: 9px; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; box-sizing: border-box;">
            <thead>
              <tr style="background-color: #f8fafc; color: #1e293b; font-weight: 700; border-bottom: 1.5px solid #cbd5e1; font-family: 'Space Grotesk', sans-serif;">
                <th style="padding: 6px 10px; width: 110px; border-right: 1px solid #cbd5e1; text-transform: uppercase; font-size: 7.5px; letter-spacing: 0.5px;">PAGE NUMBER</th>
                <th style="padding: 6px 10px; border-right: 1px solid #cbd5e1; text-transform: uppercase; font-size: 7.5px; letter-spacing: 0.5px;">CLIENT NAME</th>
                <th style="padding: 6px 10px; text-align: center; border-right: 1px solid #cbd5e1; width: 120px; text-transform: uppercase; font-size: 7.5px; letter-spacing: 0.5px;">SIZE (W x H)</th>
                <th style="padding: 6px 10px; text-align: center; border-right: 1px solid #cbd5e1; width: 110px; text-transform: uppercase; font-size: 7.5px; letter-spacing: 0.5px;">VOLUME (SQCM)</th>
                <th style="padding: 6px 10px; text-align: center; border-right: 1px solid #cbd5e1; width: 110px; text-transform: uppercase; font-size: 7.5px; letter-spacing: 0.5px;">AD REVENUE</th>
                <th style="padding: 6px 10px; text-align: center; width: 120px; text-transform: uppercase; font-size: 7.5px; letter-spacing: 0.5px;">AD CATEGORY</th>
              </tr>
            </thead>
            <tbody>
              ${rowsSlice.join('')}
            </tbody>
          </table>
        </div>

        ${tabIdx === totalTabularSheets - 1 ? `
        <!-- Totals Summary Box -->
        <div style="margin-top: 14px; margin-bottom: 12px; display: flex; gap: 16px; background-color: #fafbfb; border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 12px; font-family: 'Inter', sans-serif; box-sizing: border-box;">
          <div style="flex: 1; border-right: 1.5px solid #cbd5e1; padding-left: 4px;">
            <span style="color: #000000; font-size: 9px; text-transform: uppercase; display: block; font-weight: 700; font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif-condensed, sans-serif; font-stretch: condensed; letter-spacing: 0.2px;">Total Ad Volume</span>
            <span style="font-size: 14px; font-weight: 700; color: #4f46e5; font-family: 'Space Grotesk', sans-serif;">${sumTotalAdVolumeSqcm.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} Sqcm</span>
          </div>
          <div style="flex: 1; border-right: 1.5px solid #cbd5e1;">
            <span style="color: #000000; font-size: 9px; text-transform: uppercase; display: block; font-weight: 700; font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif-condensed, sans-serif; font-stretch: condensed; letter-spacing: 0.2px;">Total Edit Volume</span>
            <span style="font-size: 14px; font-weight: 700; color: #d97706; font-family: 'Space Grotesk', sans-serif;">${sumTotalEditVolumeSqcm.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} Sqcm</span>
          </div>
          <div style="flex: 1; border-right: 1.5px solid #cbd5e1;">
            <span style="color: #000000; font-size: 9px; text-transform: uppercase; display: block; font-weight: 700; font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif-condensed, sans-serif; font-stretch: condensed; letter-spacing: 0.2px;">Total Page Space (Advt + Edit)</span>
            <span style="font-size: 14px; font-weight: 700; color: #2563eb; font-family: 'Space Grotesk', sans-serif;">${(sumTotalPageAreaMm2 / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} Sqcm</span>
          </div>
          <div style="flex: 1;">
            <span style="color: #000000; font-size: 9px; text-transform: uppercase; display: block; font-weight: 700; font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif-condensed, sans-serif; font-stretch: condensed; letter-spacing: 0.2px;">Feature Ad Revenue</span>
            <span style="font-size: 14px; font-weight: 700; color: #059669; font-family: 'Space Grotesk', sans-serif;">₹${sumTotalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}</span>
          </div>
        </div>
        ` : ''}

        <!-- Page 2 Footer -->
        <div style="position: absolute; bottom: 12px; left: 32px; right: 32px; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between; font-family: 'Inter', sans-serif; font-size: 8.5px; color: #94a3b8; box-sizing: border-box;">
          <span>Page-wise Schedules Table listings index &bull; Parameter Specs only</span>
          <span>Page ${sheetNum} of ${totalPdfSheets}</span>
        </div>
      `;

      detailsEl.innerHTML = detailsHtml;
      exportRoot.innerHTML = ''; // Fresh clean
      exportRoot.appendChild(detailsEl);

      const dCanvas = await html2canvas(detailsEl, { scale: 2 });
      const detailsImgData = dCanvas.toDataURL('image/jpeg', 0.98);

      if (isFirstPage) {
        isFirstPage = false;
      } else {
        doc.addPage();
      }
      doc.addImage(detailsImgData, 'JPEG', 0, 0, 297, 210);
    }

    // Trigger download
    exportRoot.innerHTML = ''; // Clear invisible host
    const rawLayoutName = activeL?.name || 'Layout';
    const cleanLayoutName = rawLayoutName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanLayoutDate = activeL?.date || new Date().toISOString().split('T')[0];
    const filename = `${cleanLayoutName}_${cleanLayoutDate}.pdf`;
    doc.save(filename);
    showToast("Landscape A4 PDF downloaded successfully!", "success");

  } catch (error) {
    console.error("Landscape A4 Layout generator failing", error);
    showToast(`PDF Landscape Export error: ${error.message || 'Check console logs.'}`, "error");
    const exportRoot = document.getElementById('export-invisible-host');
    if (exportRoot) exportRoot.innerHTML = '';
  } finally {
    // Restore all style sheets and styled links to the DOM in correct reverse order to preserve relative sibling indices
    for (let i = savedStyleElements.length - 1; i >= 0; i--) {
      const { el, parent, nextSibling } = savedStyleElements[i];
      if (parent) {
        if (nextSibling && nextSibling.parentNode === parent) {
          parent.insertBefore(el, nextSibling);
        } else {
          parent.appendChild(el);
        }
      }
    }
  }
}

// =========================================================================
// TOAST MESSAGING NOTIFICATION ALERTS
// =========================================================================

function showToast(message, type = "success") {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  // Type borders/colors config
  let colors = 'bg-white border-slate-200 text-slate-800 shadow-xl';
  let badgeColor = 'bg-blue-50 text-blue-600';
  let title = 'System Info';

  if (type === "success") {
    colors = 'bg-white border-emerald-200 text-slate-800 shadow-xl';
    badgeColor = 'bg-emerald-50 text-emerald-600';
    title = 'Success Alert';
  } else if (type === "error") {
    colors = 'bg-white border-rose-200 text-slate-800 shadow-xl';
    badgeColor = 'bg-rose-50 text-rose-600';
    title = 'System Warning';
  }

  // Create Toast
  toast.className = `p-3.5 rounded-xl border flex gap-3 shadow-2xl items-start justify-between text-xs font-sans min-w-[280px] leading-relaxed transition-all duration-300 origin-bottom transform translate-y-3 opacity-0 cursor-pointer select-none pointer-events-auto ${colors}`;
  
  toast.innerHTML = `
    <div class="flex gap-2.5 items-start">
      <span class="p-1 rounded-md text-[9px] font-bold font-mono uppercase tracking-wider ${badgeColor}">${title}</span>
      <div>
        <p class="font-medium text-slate-800 mt-0.5">${message}</p>
      </div>
    </div>
    <button class="text-slate-400 hover:text-slate-700 cursor-pointer select-none text-base">&times;</button>
  `;

  // Manual close click
  const triggerClose = () => {
    toast.className = toast.className.replace('translate-y-0 opacity-100', 'translate-y-3 opacity-0');
    setTimeout(() => toast.remove(), 350);
  };
  
  toast.addEventListener('click', triggerClose);

  container.appendChild(toast);

  // Transition entrance animations trigger
  setTimeout(() => {
    toast.className = toast.className.replace('translate-y-3 opacity-0', 'translate-y-0 opacity-100');
  }, 30);

  // Auto clean delay
  setTimeout(triggerClose, 3600);
}

// =========================================================================
// SYSTEM MODAL DIALOG CONFIRMATION BOX
// =========================================================================

let activeConfirmProceedAction = null;

function showConfirmDialog(title, text, proceedCallback) {
  const modal = document.getElementById('confirm-modal');
  if (!modal) return;

  document.getElementById('confirm-title').textContent = title.toUpperCase();
  document.getElementById('confirm-message').textContent = text;
  
  activeConfirmProceedAction = proceedCallback;

  modal.classList.remove('hidden');

  // Set cancel/close listeners
  const cancelBtn = document.getElementById('btn-confirm-cancel');
  const proceedBtn = document.getElementById('btn-confirm-proceed');

  // Fresh hooks
  const closeRoutineConfirm = () => {
    modal.classList.add('hidden');
    activeConfirmProceedAction = null;
    cancelBtn.removeEventListener('click', closeRoutineConfirm);
    proceedBtn.removeEventListener('click', proceedRoutineConfirm);
  };

  const proceedRoutineConfirm = () => {
    if (activeConfirmProceedAction) activeConfirmProceedAction();
    closeRoutineConfirm();
  };

  cancelBtn.addEventListener('click', closeRoutineConfirm);
  proceedBtn.addEventListener('click', proceedRoutineConfirm);
}

function triggerDirectSwap(adId) {
  const page = state.pages.find(p => p.id === state.activePageId);
  if (!page) return;
  const currentAd = page.ads.find(a => a.id === adId);
  if (!currentAd) return;

  const otherAds = page.ads.filter(a => a.id !== adId);
  if (otherAds.length === 0) {
    showToast("There are no other ads on this page to swap with.", "error");
    return;
  }

  // Populate select dropdown
  const selectEl = document.getElementById('dialog-swap-select');
  if (!selectEl) return;
  selectEl.innerHTML = '';
  otherAds.forEach(ad => {
    const opt = document.createElement('option');
    opt.value = ad.id;
    opt.textContent = `${ad.client} (${ad.width}x${ad.height} mm)`;
    selectEl.appendChild(opt);
  });

  const dialogSwapContainer = document.getElementById('dialog-swap-container');
  if (dialogSwapContainer) dialogSwapContainer.classList.remove('hidden');

  showCustomDialog({
    title: `Swap Positions`,
    message: `Choose an advertisement box to swap positions & dimensions with "${currentAd.client}". They will exchange their coordinates and sizes atomically.`,
    isPrompt: false, // hide regular prompt input
    theme: 'blue',
    confirmText: "Swap Positions",
    onConfirm: () => {
      const targetAdId = selectEl.value;
      const targetAd = page.ads.find(a => a.id === targetAdId);
      if (!targetAd) return;

      // Swap physical properties
      const tempX = currentAd.x;
      const tempY = currentAd.y;
      const tempW = currentAd.width;
      const tempH = currentAd.height;

      currentAd.x = targetAd.x;
      currentAd.y = targetAd.y;
      currentAd.width = targetAd.width;
      currentAd.height = targetAd.height;

      targetAd.x = tempX;
      targetAd.y = tempY;
      targetAd.width = tempW;
      targetAd.height = tempH;

      // Save changes
      commitHistory();
      renderActiveEditorBoard();
      saveLayoutsToLocalStorageSilently();
      showToast(`Positions swapped between "${currentAd.client}" and "${targetAd.client}"!`, "success");
    }
  });
}

