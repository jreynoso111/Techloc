import { createConstellationBackground } from './constellation.js';
import { createSnowBackground } from './snow.js';
import { getCoordsIpFirst } from './geoResolver.js';

const STORAGE_KEY = 'techloc-background-mode';
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const WEATHER_URL = (lat, lon) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code&timezone=auto`;

const getStoredMode = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'snow' || stored === 'constellation' || stored === 'auto' ? stored : 'auto';
};

const saveMode = (mode) => localStorage.setItem(STORAGE_KEY, mode);

export const setupBackgroundManager = ({
  canvasId = 'constellation-canvas',
  controlButton,
  controlMenu,
  statusLabel,
} = {}) => {
  let currentMode = getStoredMode();
  let activeCleanup = null;
  let menuOpen = false;
  let appliedVariant = null;
  let weatherIntervalId = null;

  const fetchIsSnowing = async () => {
    try {
      const coords = await getCoordsIpFirst();
      if (!coords?.lat || !coords?.lon) {
        return { snowing: false, reason: null };
      }

      const response = await fetch(WEATHER_URL(coords.lat, coords.lon), { cache: 'no-store' });
      if (!response.ok) {
        return { snowing: false, reason: null };
      }

      const data = await response.json();
      const code = Number(data?.current?.weather_code);
      const snowing = SNOW_CODES.has(code);

      return {
        snowing,
        reason: snowing ? 'Snow detected in your area' : 'No snow right now',
      };
    } catch (error) {
      return { snowing: false, reason: null };
    }
  };

  const stopWeatherInterval = () => {
    if (weatherIntervalId) {
      clearInterval(weatherIntervalId);
      weatherIntervalId = null;
    }
  };

  const checkAutoWeather = async () => {
    if (currentMode !== 'auto') return;
    setStatus('Checking local weather for background…');
    const { snowing, reason } = await fetchIsSnowing();
    if (currentMode !== 'auto') return;
    applyVariant(snowing ? 'snow' : 'constellation');
    setStatus(reason || '');
  };

  const startWeatherInterval = () => {
    stopWeatherInterval();
    checkAutoWeather();
    weatherIntervalId = setInterval(checkAutoWeather, 10 * 60 * 1000);
  };

  const setStatus = (text) => {
    if (statusLabel) statusLabel.textContent = text;
  };

  const closeMenu = () => {
    if (controlMenu) controlMenu.classList.add('hidden');
    menuOpen = false;
  };

  const openMenu = () => {
    if (controlMenu) controlMenu.classList.remove('hidden');
    menuOpen = true;
  };

  const toggleMenu = () => (menuOpen ? closeMenu() : openMenu());

  const applyVariant = (variant) => {
    appliedVariant = variant;
    if (activeCleanup) activeCleanup();
    const runner =
      variant === 'snow'
        ? createSnowBackground(canvasId)
        : createConstellationBackground(canvasId);
    activeCleanup = runner?.cleanup || null;
  };

  const highlightActiveOption = () => {
    if (!controlMenu) return;
    controlMenu.querySelectorAll('[data-bg-option]').forEach((option) => {
      const optionValue = option.getAttribute('data-bg-option');
      if (optionValue === currentMode) {
        option.classList.add('bg-slate-800', 'text-white');
      } else {
        option.classList.remove('bg-slate-800', 'text-white');
      }
    });
  };

  const updateButtonLabel = () => {
    if (!controlButton) return;
    const labelEl = controlButton.querySelector('[data-bg-label]');
    if (labelEl) {
      const labels = {
        auto: 'Background: Auto',
        snow: 'Background: Snow',
        constellation: 'Background: Constellations',
      };
      labelEl.textContent = labels[currentMode] || 'Background';
    }

    const icon = controlButton.querySelector('[data-bg-icon]');
    if (icon) {
      icon.setAttribute(
        'data-lucide',
        currentMode === 'snow' ? 'snowflake' : currentMode === 'constellation' ? 'sparkles' : 'cloud-sun'
      );
      if (window.lucide) window.lucide.createIcons();
    }
  };

  const applyMode = async (mode = currentMode) => {
    currentMode = mode;
    saveMode(mode);
    highlightActiveOption();
    updateButtonLabel();

    if (mode === 'auto') {
      startWeatherInterval();
      return;
    }

    stopWeatherInterval();
    applyVariant(mode === 'snow' ? 'snow' : 'constellation');
    setStatus(mode === 'snow' ? 'Snow mode active' : 'Constellations mode active');
  };

  const handleMenuSelection = (event) => {
    const option = event.target.closest('[data-bg-option]');
    if (!option) return;
    const selectedMode = option.getAttribute('data-bg-option');

    if (selectedMode === 'auto') {
      const cycle = ['auto', 'constellation', 'snow'];
      const currentIndex = cycle.indexOf(currentMode);
      const nextMode = cycle[(currentIndex + 1) % cycle.length];
      applyMode(nextMode);
      return;
    }

    closeMenu();
    applyMode(selectedMode);
  };

  if (controlButton) {
    controlButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu();
    });
  }

  if (controlMenu) {
    controlMenu.addEventListener('click', handleMenuSelection);
  }

  document.addEventListener('click', (event) => {
    if (!menuOpen) return;
    if (controlMenu && controlMenu.contains(event.target)) return;
    if (controlButton && controlButton.contains(event.target)) return;
    closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuOpen) {
      closeMenu();
    }
  });

  applyMode(currentMode);

  return {
    applyMode,
    setAuto: () => applyMode('auto'),
    setConstellations: () => applyMode('constellation'),
    setSnow: () => applyMode('snow'),
    get mode() {
      return currentMode;
    },
    get variant() {
      return appliedVariant;
    },
  };
};
