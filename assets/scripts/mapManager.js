export function initMapManager({ data, state, utils, config, callbacks }) {
  let map = null;
  let techLayer = null;
  let targetLayer = null;
  let connectionLayer = null;
  let serviceLayer = null;
  let serviceConnectionLayer = null;
  let vehicleLayer = null;
  let highlightLayer = null;
  let resellerLayer = null;
  let repairLayer = null;
  let customServiceLayer = null;
  let hotspotLayer = null;
  let blacklistLayer = null;

  const createPartnerClusterIcon = (cluster, color = '#334155') => {
    const count = cluster.getChildCount();
    return L.divIcon({
      html: `<div class="relative text-xs font-semibold rounded-full flex items-center justify-center w-8 h-8 border-2 shadow-md bg-slate-900/90" style="color:${color}; border-color:${color}">${count}</div>`,
      className: 'partner-cluster-icon',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  };

  const createPartnerClusterGroup = (color = '#334155') => L.markerClusterGroup({
    maxClusterRadius: 45,
    disableClusteringAtZoom: 17,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: (cluster) => createPartnerClusterIcon(cluster, color)
  });

  const createServiceIcon = (color, { unauthorized = false, checkPulseColor = null } = {}) => L.divIcon({
    className: 'service-triangle-icon',
    html: `<div class="service-icon-wrapper"><svg width="18" height="16" viewBox="0 0 18 16" fill="${color}" stroke="#0f172a" stroke-width="1.4" xmlns="http://www.w3.org/2000/svg"><path d="M9 1.1L17 14.8H1L9 1.1Z"/></svg>${unauthorized ? '<span class="service-cross">✕</span>' : ''}${checkPulseColor ? `<span class="service-check" style="--service-check-accent:${checkPulseColor}">✓</span>` : ''}</div>`,
    iconSize: [18, 16],
    iconAnchor: [9, 14],
    popupAnchor: [0, -10]
  });

  const createVehicleMarkerIcon = (markerColor, borderColor, isStopped) => L.divIcon({
    className: 'vehicle-marker-wrapper',
    html: `<div class="vehicle-marker-icon"><span class="vehicle-marker-dot" style="background:${markerColor}; border-color:${borderColor}"></span>${isStopped ? '<span class="vehicle-cross-badge">✕</span>' : ''}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  const createBlacklistIcon = () => L.divIcon({
    className: 'blacklist-triangle-icon',
    html: `<div class="blacklist-marker">!</div>`,
    iconSize: [18, 24],
    iconAnchor: [9, 20],
    popupAnchor: [0, -18]
  });

  const setLayerVisible = (layer, visible) => {
    if (!map || !layer) return;
    if (!visible) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      return;
    }
    if (!map.hasLayer(layer)) layer.addTo(map);
  };

  const showServicePreviewCard = (partner) => {
    if (!map || !partner) return;
    const locationText = utils.formatPartnerLocation(partner) || 'Location unavailable';
    const zipText = partner.zip || 'N/A';
    const noteText = partner.notes || partner.note || partner.details?.note || '';
    const popup = L.popup({
      className: 'service-mini-popup',
      closeButton: true,
      autoClose: true,
      closeOnClick: true,
      maxWidth: 220,
      offset: [0, -6]
    })
      .setLatLng([partner.lat, partner.lng])
      .setContent(`
        <div class="service-mini-card">
          <p class="service-mini-title">${utils.escapeHTML(partner.company || partner.name || 'Service')}</p>
          <p class="service-mini-location">${utils.escapeHTML(locationText)}</p>
          <p class="service-mini-meta"><span class="service-mini-label">ZIP</span><span>${utils.escapeHTML(zipText)}</span></p>
          ${noteText ? `<p class="service-mini-note"><span class="service-mini-label">Note</span> ${utils.escapeHTML(noteText)}</p>` : ''}
        </div>
      `);

    popup.openOn(map);
  };

  const initMap = () => {
    map = L.map('tech-map', {
      renderer: L.canvas(),
      zoomControl: false,
      minZoom: 3,
      zoomSnap: 0.25,
      zoomDelta: 0.5
    }).setView([39.8, -98.5], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, minZoom: 3 }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { maxZoom: 19, minZoom: 3, opacity: 0.95 }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    hotspotLayer = L.layerGroup().addTo(map);
    blacklistLayer = L.layerGroup().addTo(map);
    techLayer = createPartnerClusterGroup(config.SERVICE_COLORS.tech);
    vehicleLayer = L.markerClusterGroup({
      maxClusterRadius: 35,
      disableClusteringAtZoom: 17,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        let sizeClass = 'w-8 h-8 text-xs';
        let iconSize = [32, 32];

        if (count > 100) {
          sizeClass = 'w-10 h-10 text-sm';
          iconSize = [40, 40];
        } else if (count > 10) {
          sizeClass = 'w-9 h-9 text-sm';
          iconSize = [36, 36];
        }

        const childMarkers = typeof cluster.getAllChildMarkers === 'function' ? cluster.getAllChildMarkers() : [];
        let hasRed = false;
        let hasAmber = false;
        let allGreen = true;
        let hasStopped = false;

        childMarkers.forEach((marker) => {
          const markerColor = marker?.options?.markerColor || (marker?.options?.vehicleData ? utils.getVehicleMarkerColor(marker.options.vehicleData) : null);
          const isStopped = marker?.options?.isStopped || (marker?.options?.vehicleData ? utils.isVehicleNotMoving(marker.options.vehicleData) : false);

          if (isStopped) {
            hasStopped = true;
          }

          if (markerColor) {
            const colorValue = `${markerColor}`.toLowerCase();
            if (colorValue === '#ef4444') {
              hasRed = true;
              allGreen = false;
            } else if (colorValue === '#f59e0b' || colorValue === '#fbbf24') {
              hasAmber = true;
              allGreen = false;
            } else if (colorValue !== '#22c55e') {
              allGreen = false;
            }
          } else {
            allGreen = false;
          }
        });

        let clusterColor = '#f59e0b';
        if (hasRed) {
          clusterColor = '#ef4444';
        } else if (hasAmber) {
          clusterColor = '#f59e0b';
        } else if (allGreen && childMarkers.length > 0) {
          clusterColor = '#22c55e';
        }

        const badgeHtml = hasStopped ? '<span class="vehicle-cross-badge absolute inset-0 flex items-center justify-center pointer-events-none">✕</span>' : '';
        const [width, height] = iconSize;
        return L.divIcon({
          html: `<div class="relative border-2 font-bold rounded-full flex items-center justify-center shadow-lg bg-slate-900/90 ${sizeClass}" style="color:${clusterColor}; border-color:${clusterColor}">${badgeHtml}<span>${count}</span></div>`,
          className: 'vehicle-cluster-icon',
          iconSize,
          iconAnchor: [width / 2, height / 2]
        });
      }
    }).addTo(map);
    targetLayer = L.layerGroup().addTo(map);
    connectionLayer = L.layerGroup().addTo(map);
    serviceLayer = L.layerGroup().addTo(map);
    serviceConnectionLayer = L.layerGroup().addTo(map);
    highlightLayer = L.layerGroup().addTo(map);
    resellerLayer = createPartnerClusterGroup(config.SERVICE_COLORS.reseller);
    repairLayer = createPartnerClusterGroup(config.SERVICE_COLORS.repair);
    customServiceLayer = createPartnerClusterGroup(config.SERVICE_COLORS.custom);

    const invalidateMapSize = () => map?.invalidateSize();

    const mapContainer = document.getElementById('tech-map');
    if (mapContainer && typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        invalidateMapSize();
      });
      resizeObserver.observe(mapContainer);
    }

    const authBlock = document.querySelector('[data-auth-protected]');
    if (authBlock && typeof MutationObserver !== 'undefined') {
      const authObserver = new MutationObserver(() => {
        if (!authBlock.classList.contains('hidden')) {
          requestAnimationFrame(() => invalidateMapSize());
        }
      });
      authObserver.observe(authBlock, { attributes: true, attributeFilter: ['class'] });
    }

    map.on('click', (e) => {
      if (e.originalEvent?.handledByMarker) return;

      const lat = parseFloat(e.latlng.lat.toFixed(6));
      const lng = parseFloat(e.latlng.lng.toFixed(6));

      const hasActiveMapSelection = state.selectedVehicleId !== null || state.lastClientLocation !== null || state.lastOriginPoint !== null;
      if (hasActiveMapSelection) {
        callbacks.resetSelection();
        state.lastOriginPoint = null;
        state.lastClientLocation = null;
        clearTargetLayer();
        callbacks.renderVisibleSidebars();
        return;
      }

      callbacks.resetSelection();
      clearTargetLayer();
      const locationPoint = { lat, lng, name: 'Pinned location' };
      state.lastClientLocation = locationPoint;
      state.lastOriginPoint = locationPoint;
      addTargetLocation({ location: locationPoint, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, title: 'Selected point' });

      showServicesFromOrigin(locationPoint, { forceType: callbacks.isAnyServiceSidebarOpen() ? callbacks.getActivePartnerType() : null });
      callbacks.renderVisibleSidebars();
    });
  };

  const addTargetLocation = ({ location, label, title }) => {
    if (!location || !targetLayer) return;
    const targetIcon = L.divIcon({
      className: '',
      html: `<div class="w-4 h-4 bg-red-600 rounded-full border-2 border-white animate-ping"></div>`
    });
    L.marker([location.lat, location.lng], { icon: targetIcon }).addTo(targetLayer);
    const popup = L.marker([location.lat, location.lng]).addTo(targetLayer);
    popup.bindPopup(`<b>${title}</b><br>${label || location.name || ''}`).openPopup();
  };

  const clearTargetLayer = () => {
    targetLayer?.clearLayers();
  };

  const clearConnections = () => {
    connectionLayer?.clearLayers();
    serviceConnectionLayer?.clearLayers();
  };

  const clearServiceLayers = () => {
    serviceLayer?.clearLayers();
    serviceConnectionLayer?.clearLayers();
  };

  const clearHighlightLayer = () => {
    highlightLayer?.clearLayers();
  };

  const closePopup = () => {
    map?.closePopup();
  };

  const flyTo = (coords, options = { duration: 1.2 }) => {
    if (!map || !coords) return;
    map.flyTo(coords, options.zoom || 15, { duration: options.duration ?? 1.2 });
  };

  const invalidateSize = () => {
    map?.invalidateSize();
  };

  const distanceBetween = (pointA, pointB) => {
    if (!map || !pointA || !pointB) return null;
    return map.distance([pointA.lat, pointA.lng], [pointB.lat, pointB.lng]);
  };

  const renderHotspots = (hotspots = []) => {
    if (!hotspotLayer) return;
    hotspotLayer.clearLayers();

    hotspots.filter(utils.hasValidCoords).forEach((hotspot) => {
      const circle = L.circle([hotspot.lat, hotspot.lng], {
        radius: hotspot.radiusMiles * utils.MILES_TO_METERS,
        color: '#22c55e',
        weight: 1.5,
        fillColor: '#22c55e',
        fillOpacity: 0.18,
        opacity: 0.7,
      }).addTo(hotspotLayer);

      circle?.bringToBack?.();

      const locationText = [hotspot.city, hotspot.state, hotspot.zip].filter(Boolean).join(', ');
      circle.bindPopup(`
        <div class="text-xs text-slate-100 space-y-1">
          <p class="font-bold text-white text-sm">Hotspot</p>
          <p class="text-[11px] text-slate-300">${locationText || 'Location unavailable'}</p>
          <p class="text-[11px] text-emerald-300">Coverage radius: ${hotspot.radiusMiles} miles</p>
        </div>
      `);
    });
  };

  const renderBlacklistSites = (blacklistSites = []) => {
    if (!blacklistLayer) return;
    blacklistLayer.clearLayers();

    blacklistSites.filter(utils.hasValidCoords).forEach((entry) => {
      const marker = L.marker([entry.lat, entry.lng], { icon: createBlacklistIcon() }).addTo(blacklistLayer);
      marker.on('click', (e) => { e.originalEvent.handledByMarker = true; });

      marker.bindPopup(`
        <div class="text-xs text-slate-100 space-y-1">
          <p class="font-bold text-amber-200 flex items-center gap-2 text-sm">
            <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/60">!</span>
            Device removal location
          </p>
          <p class="text-[11px] text-slate-300"><span class="text-slate-400">Company:</span> ${utils.escapeHTML(entry.company || 'Unknown')}</p>
          ${entry.assocUnit ? `<p class="text-[11px] text-slate-300"><span class="text-slate-400">Assoc. Unit:</span> ${utils.escapeHTML(entry.assocUnit)}</p>` : ''}
          ${entry.note ? `<p class="text-[11px] text-amber-200 font-semibold">${utils.escapeHTML(entry.note)}</p>` : ''}
        </div>
      `);
    });
  };

  const renderTechMarkers = (techList = [], { onMarkerClick } = {}) => {
    if (!techLayer) return;
    techLayer.clearLayers();

    techList.forEach((tech) => {
      const marker = L.marker([tech.lat, tech.lng], {
        icon: createServiceIcon(config.SERVICE_COLORS.tech)
      }).addTo(techLayer);

      marker.bindPopup(`
        <div class="text-slate-900 p-1 font-sans">
          <strong class="block text-sm font-bold mb-1">${tech.company}</strong>
          <div class="text-xs text-slate-500 mb-2">${tech.city}, ${tech.state} ${tech.zip}</div>
          <a href="tel:${tech.phoneDial || tech.phone}" class="block bg-blue-100 text-blue-700 px-2 py-1 rounded text-center text-xs font-bold mb-1">${tech.phone}</a>
          <div class="text-[10px] text-slate-400 truncate">${tech.email}</div>
        </div>
      `);

      marker.on('click', (e) => {
        e.originalEvent.handledByMarker = true;
        if (typeof onMarkerClick === 'function') {
          onMarkerClick(tech);
        }
      });
    });
  };

  const renderPartnerMarkers = ({
    partners = [],
    layer,
    type,
    accentColor,
    markerLimit = 75,
    onMarkerClick
  }) => {
    if (!layer) return;
    layer.clearLayers();

    partners.slice(0, markerLimit).forEach((partner) => {
      const unauthorized = utils.isUnauthorizedPartner(partner);
      const markerColor = utils.getPartnerColor(partner, accentColor);
      const checkPulseColor =
        !unauthorized && type === 'reseller' && utils.isAuthorizedReseller(partner)
          ? markerColor
          : null;

      const marker = L.marker([partner.lat, partner.lng], {
        icon: createServiceIcon(markerColor, { unauthorized, checkPulseColor })
      }).addTo(layer);

      const locationText = utils.formatPartnerLocation(partner);

      marker.bindPopup(`
        <div class="text-slate-900 p-1 font-sans">
          <strong class="block text-sm font-bold mb-1">${partner.company}</strong>
          <div class="text-xs text-slate-500 mb-2">${locationText || 'US'}</div>
          <a href="tel:${partner.phoneDial || partner.phone}" class="block bg-slate-100 text-slate-800 px-2 py-1 rounded text-center text-xs font-bold mb-1">${partner.phone || 'Contact'}</a>
          <div class="text-[10px] text-slate-500">${partner.availability || ''}</div>
        </div>
      `);

      marker.on('click', (e) => {
        e.originalEvent.handledByMarker = true;
        if (typeof onMarkerClick === 'function') {
          onMarkerClick(partner);
        }
      });
    });
  };

  const renderCustomServiceMarkers = ({
    partners = [],
    customCategories,
    markersAllowed,
    onMarkerClick
  }) => {
    customCategories.forEach(({ layer }) => layer?.clearLayers?.());
    if (!markersAllowed || !map) return;

    partners.forEach((partner) => {
      if (!utils.hasValidCoords(partner)) return;
      const meta = customCategories.get(partner.categoryKey);
      if (!meta?.layer) return;

      if (!map.hasLayer(meta.layer)) {
        meta.layer.addTo(map);
      }

      const checkPulseColor =
        (utils.isRepoAgentPartner(partner) && utils.hasSpAgentNote(partner)) ||
        (utils.isParkingStoragePartner(partner) && utils.hasSpStorageNote(partner))
          ? meta.color
          : null;
      const icon = createServiceIcon(meta.color, { unauthorized: utils.isUnauthorizedPartner(partner), checkPulseColor });
      const marker = L.marker([partner.lat, partner.lng], { icon });
      marker.on('click', (e) => {
        e.originalEvent.handledByMarker = true;
        if (typeof onMarkerClick === 'function') {
          onMarkerClick(partner, meta);
        }
      });
      marker.addTo(meta.layer);
    });
  };

  const syncVehicleMarkers = ({ vehiclesWithCoords, vehicleMarkers, vehicleMarkersVisible }) => {
    if (!vehicleLayer) return;

    if (!vehicleMarkersVisible) {
      vehicleLayer.clearLayers();
      vehicleMarkers.clear();
      return;
    }

    const activeIds = new Set();

    vehiclesWithCoords.forEach(({ vehicle, coords, focusHandler }) => {
      if (!coords) return;

      const markerColor = utils.getVehicleMarkerColor(vehicle);
      const borderColor = utils.getVehicleMarkerBorderColor(markerColor);
      const isStopped = utils.isVehicleNotMoving(vehicle);
      const icon = createVehicleMarkerIcon(markerColor, borderColor, isStopped);

      const stored = vehicleMarkers.get(vehicle.id);
      let marker = stored?.marker;

      if (marker) {
        marker.setLatLng([coords.lat, coords.lng]);
        marker.setIcon(icon);
        marker.setZIndexOffset(isStopped ? 500 : 0);
        marker.options.vehicleData = vehicle;
        marker.options.markerColor = markerColor;
        marker.options.isStopped = isStopped;
      } else {
        marker = L.marker([coords.lat, coords.lng], { icon, zIndexOffset: isStopped ? 500 : 0, vehicleData: vehicle, markerColor, isStopped }).addTo(vehicleLayer);
        marker.on('click', (e) => { e.originalEvent.handledByMarker = true; focusHandler(); });
      }

      vehicleMarkers.set(vehicle.id, { marker });
      activeIds.add(vehicle.id);
    });

    [...vehicleMarkers.keys()].forEach((id) => {
      if (activeIds.has(id)) return;
      const stored = vehicleMarkers.get(id);
      if (stored?.marker) vehicleLayer.removeLayer(stored.marker);
      vehicleMarkers.delete(id);
    });
  };

  const focusVehicle = ({ vehicle, vehicleMarkers, vehicleMarkersVisible, vehicleCardHtml, onAttachPopupHandlers, onAfterFocus }) => {
    if (!vehicle) return;
    if (!utils.hasValidCoords(vehicle)) return;
    if (!vehicleMarkersVisible) return;
    highlightLayer.clearLayers();

    const storedMarker = vehicleMarkers.get(vehicle.id)?.marker;
    const markerColor = utils.getVehicleMarkerColor(vehicle);
    const anchorMarker = storedMarker || L.circleMarker([vehicle.lat, vehicle.lng], {
      radius: 9,
      color: '#0b1220',
      weight: 2.8,
      fillColor: markerColor,
      fillOpacity: 0.95,
      opacity: 0.98,
      className: 'vehicle-dot'
    }).addTo(highlightLayer);

    const halo = L.circleMarker([vehicle.lat, vehicle.lng], { radius: 12, color: markerColor, weight: 1.2, fillColor: markerColor, fillOpacity: 0.18 }).addTo(highlightLayer);
    halo.bringToBack();

    if (utils.isVehicleNotMoving(vehicle)) {
      L.marker([vehicle.lat, vehicle.lng], {
        icon: L.divIcon({ className: 'vehicle-cross', html: '<div class="vehicle-cross-badge">✕</div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        interactive: false,
        zIndexOffset: 500
      }).addTo(highlightLayer);
    }

    anchorMarker.bindPopup(vehicleCardHtml, {
      className: 'vehicle-popup',
      autoPan: false,
      keepInView: false,
    }).openPopup();

    if (typeof onAttachPopupHandlers === 'function') {
      setTimeout(onAttachPopupHandlers, 50);
    }

    if (typeof onAfterFocus === 'function') {
      onAfterFocus();
    }
  };

  const addLabeledConnection = (layer, start, end, distance, color, options = {}) => {
    if (!layer || !start || !end) return null;
    const { dashArray = '6 4', weight = 3, opacity = 0.85 } = options;

    L.polyline(
      [
        [start.lat, start.lng],
        [end.lat, end.lng]
      ],
      { color, weight, opacity, dashArray }
    ).addTo(layer);

    const midLat = (start.lat + end.lat) / 2;
    const midLng = (start.lng + end.lng) / 2;
    const label = L.marker([midLat, midLng], {
      icon: L.divIcon({
        className: 'distance-label-wrapper',
        html: `<div class="distance-label" style="--line-color:${color}">${distance.toFixed(1)} mi</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      }),
      interactive: false
    });

    label.addTo(layer);
    return label;
  };

  const showServicesFromOrigin = (origin, { forceType = null } = {}) => {
    serviceLayer?.clearLayers();
    serviceConnectionLayer?.clearLayers();
    const hasSidebarOpen = callbacks.isAnyServiceSidebarOpen();
    const hasExplicitType = !!forceType;
    if (!origin || (!hasSidebarOpen && !hasExplicitType)) return;

    state.lastOriginPoint = { lat: origin.lat, lng: origin.lng, name: origin.name || origin.customer || '' };

    const visibleTypes = callbacks.getVisibleServiceTypes();
    const activeTypes = forceType
      ? [forceType]
      : visibleTypes;

    activeTypes.forEach((type) => {
      const baseList = callbacks.getPartnerListByType(type);
      if (!baseList.length) return;
      const filtered = callbacks.applyServiceFilter(baseList, type);
      const selectedPartner = callbacks.getSelectedService(type);
      const chosen = selectedPartner || callbacks.getNearestFromList(origin, filtered, type)?.entry;
      if (!chosen) return;

      const unauthorized = utils.isUnauthorizedPartner(chosen);
      let color = config.SERVICE_COLORS[type] || '#38bdf8';

      if (type === 'custom' || type.startsWith('custom-')) {
        const categoryKey = chosen.categoryKey || state.selectedCustomCategoryKey;
        const meta = data.customCategories.get(categoryKey);
        if (meta) color = meta.color;
      } else {
        color = utils.getPartnerColor(chosen, color);
      }
      const marker = L.marker([chosen.lat, chosen.lng], {
        icon: createServiceIcon(color, { unauthorized })
      }).addTo(serviceLayer);

      marker.on('click', (e) => {
        e.originalEvent.handledByMarker = true;
        state.sidebarStateController?.setState?.(config.SERVICE_SIDEBAR_KEYS[type] || 'left', true);
        data.selectedServiceByType[type] = chosen;
        callbacks.filterSidebarForPartner(type, chosen);
        showServicePreviewCard(chosen);
        map.flyTo([chosen.lat, chosen.lng], 15, { duration: 1.2 });
      });

      const distance = utils.getDistance(origin.lat, origin.lng, chosen.lat, chosen.lng);
      addLabeledConnection(
        serviceConnectionLayer,
        origin,
        chosen,
        Math.max(distance, 0),
        color,
        { dashArray: '6 4', weight: 3, opacity: 0.85 }
      );
    });
  };

  const drawConnection = (origin, partnerInfo) => {
    const type = partnerInfo?.type || callbacks.getActivePartnerType();
    const target = partnerInfo?.entry || partnerInfo;
    const isVisible = callbacks.isServiceSidebarVisible(type);
    if (!target || !origin || !isVisible) return;
    const baseColor = config.SERVICE_COLORS[type] || '#818cf8';
    const color = utils.getPartnerColor(target, baseColor);
    connectionLayer.clearLayers();
    const miles = utils.getDistance(origin.lat, origin.lng, target.lat, target.lng);
    addLabeledConnection(
      connectionLayer,
      origin,
      target,
      miles,
      color,
      { dashArray: '6 6', weight: 3, opacity: 0.8 }
    );
  };

  return {
    initMap,
    createPartnerClusterGroup,
    showServicePreviewCard,
    createServiceIcon,
    createVehicleMarkerIcon,
    createBlacklistIcon,
    setLayerVisible,
    renderHotspots,
    renderBlacklistSites,
    renderTechMarkers,
    renderPartnerMarkers,
    renderCustomServiceMarkers,
    syncVehicleMarkers,
    focusVehicle,
    addLabeledConnection,
    showServicesFromOrigin,
    drawConnection,
    addTargetLocation,
    clearTargetLayer,
    clearConnections,
    clearServiceLayers,
    clearHighlightLayer,
    closePopup,
    flyTo,
    invalidateSize,
    distanceBetween,
    getLayers: () => ({
      techLayer,
      targetLayer,
      connectionLayer,
      serviceLayer,
      serviceConnectionLayer,
      vehicleLayer,
      highlightLayer,
      resellerLayer,
      repairLayer,
      customServiceLayer,
      hotspotLayer,
      blacklistLayer
    })
  };
}
