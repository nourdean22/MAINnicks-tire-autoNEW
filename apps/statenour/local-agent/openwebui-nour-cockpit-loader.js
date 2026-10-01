(() => {
  'use strict';

  const VERSION = '2026-10-01.1';
  const COCKPIT_MODEL_LABEL = 'NOUR Cockpit';
  let scheduled = false;

  const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');

  function cockpitSelected() {
    const selector = document.getElementById('model-selector-model-button');
    if (!selector) return false;
    const aria = selector.getAttribute('aria-label') || '';
    return aria === 'Selected model: ' + COCKPIT_MODEL_LABEL
      || normalize(selector.innerText) === COCKPIT_MODEL_LABEL;
  }

  function sectionButton(container, label) {
    return [...container.querySelectorAll('button')].find(
      (button) => normalize(button.innerText) === label
    ) || null;
  }

  function makeSummary(wrapper, list) {
    let summary = list.querySelector(':scope > .nour-cockpit-summary');
    if (summary) return summary;

    summary = document.createElement('div');
    summary.className = 'nour-cockpit-summary';
    summary.setAttribute('data-nour-ui-version', VERSION);
    summary.innerHTML = [
      '<div class="nour-cockpit-summary-title">NOUR Cockpit manages these automatically</div>',
      '<div class="nour-cockpit-summary-copy">This model routes across providers. Sampling and Ollama-specific overrides are hidden because the gateway only supports tool calling here.</div>',
      '<div class="nour-cockpit-summary-pills">',
      '<span>Routing: Auto</span><span>Tools: Auto</span><span>Provider params: Auto</span>',
      '</div>',
      '<button type="button" class="nour-cockpit-raw-toggle">Show raw overrides</button>',
    ].join('');

    const toggle = summary.querySelector('.nour-cockpit-raw-toggle');
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !wrapper.classList.contains('nour-show-raw');
      wrapper.classList.toggle('nour-show-raw', open);
      toggle.textContent = open ? 'Hide raw overrides' : 'Show raw overrides';
    });

    list.insertBefore(summary, list.firstChild);
    return summary;
  }

  function markRawRows(list) {
    for (const child of [...list.children]) {
      if (child.classList.contains('nour-cockpit-summary')) continue;
      if (child.querySelector('.inline-tooltip')) {
        child.classList.add('nour-cockpit-raw-row');
        continue;
      }
      const text = normalize(child.innerText);
      if (text === 'Add Custom Parameter') {
        child.classList.add('nour-cockpit-raw-row');
      }
    }
  }

  function optimizeControls() {
    const container = document.getElementById('controls-container');
    if (!container) return;

    const active = cockpitSelected();
    container.classList.toggle('nour-cockpit-controls', active);
    container.setAttribute('data-nour-controls-mode', active ? 'cockpit' : 'standard');

    if (!active) return;

    const advancedButton = sectionButton(container, 'Advanced Params');
    if (!advancedButton) return;
    const wrapper = advancedButton.parentElement;
    if (!wrapper) return;

    wrapper.classList.add('nour-cockpit-advanced');
    const content = wrapper.querySelector('[slot="content"]');
    const list = content?.querySelector('.space-y-1.pb-safe-bottom');
    if (!list) return;

    markRawRows(list);
    makeSummary(wrapper, list);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      optimizeControls();
    });
  }

  function start() {
    schedule();
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'aria-expanded'],
    });
    document.addEventListener('click', schedule, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
