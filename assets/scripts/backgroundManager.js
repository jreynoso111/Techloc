import { createConstellationBackground } from './constellation.js';
import { createSnowBackground } from './snow.js';

const STORAGE_KEY = 'techloc-background-mode';
const SNOW_CODES = new Set([70, 71, 72, 73, 75, 77, 85, 86]);

const getStoredMode = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'snow' || stored === 'constellation' || stored === 'auto' ? stored : 'auto';
};

const saveMode = (mode) => localStorage.setItem(STORAGE_KEY, mode);

const requestPosition = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not available'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 15 * 60 * 1000,
      timeout: 8000,
    });
  });

const fetchIsSnowing = async () => {
  try {
    const position = await requestPosition();
    const { latitude, longitude } = position.coords || {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return { snowing: false, reason: 'Ubicación no disponible' };
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,precipitation&timezone=auto`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return { snowing: false, reason: 'No se pudo leer el clima' };
    }

    const data = await response.json();
    const code = Number(data?.current?.weather_code);
    const precipitation = Number(data?.current?.precipitation ?? 0);
    const snowing = SNOW_CODES.has(code) || (precipitation > 0 && code >= 70 && code < 80);

    return {
      snowing,
      reason: snowing ? 'Nieve detectada en tu zona' : 'Sin nieve ahora',
    };
  } catch (error) {
    if (error?.code === error?.PERMISSION_DENIED) {
      return { snowing: false, reason: 'Permiso de ubicación denegado' };
    }
    return { snowing: false, reason: 'No fue posible detectar clima' };
  }
};

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
        auto: 'Fondo: Automático',
        snow: 'Fondo: Nieve',
        constellation: 'Fondo: Constelaciones',
      };
      labelEl.textContent = labels[currentMode] || 'Fondo';
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
      setStatus('Detectando clima para el fondo…');
      const { snowing, reason } = await fetchIsSnowing();
      applyVariant(snowing ? 'snow' : 'constellation');
      setStatus(reason);
      return;
    }

    applyVariant(mode === 'snow' ? 'snow' : 'constellation');
    setStatus(mode === 'snow' ? 'Modo nieve activo' : 'Modo constelaciones activo');
  };

  const handleMenuSelection = (event) => {
    const option = event.target.closest('[data-bg-option]');
    if (!option) return;
    const selectedMode = option.getAttribute('data-bg-option');
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
